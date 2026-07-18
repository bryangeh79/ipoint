import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  adminUsers,
  marketAccess,
  markets,
  memberKycCases,
  memberKycDocuments,
  memberKycHistory,
  memberKycIdempotencyKeys,
  memberProfiles,
  members,
  type Database,
} from '@ipoint/database';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNull,
  lte,
  type SQL,
} from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type { AdminKycActionDto, KycCaseFilterDto } from './admin-kyc.dto.js';
import {
  adminKycCaseNotFoundError,
  adminKycIdempotencyConflictError,
  adminKycInvalidStateError,
  adminKycInvalidTransitionError,
  adminKycNoMarketAccessError,
  adminKycSelfReviewError,
} from './admin-kyc.errors.js';
import type {
  AdminKycActor,
  AdminKycCaseListItem,
  AdminKycCaseListResponse,
  AdminKycCaseResponse,
  AdminKycStatus,
} from './admin-kyc.types.js';

type KycCaseRow = typeof memberKycCases.$inferSelect;
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

type AdminKycAction =
  | 'start-review'
  | 'request-more-info'
  | 'approve'
  | 'reject'
  | 'require-reverification';

interface LockedCase {
  kycCase: KycCaseRow;
  memberAccountId: string;
  memberId: string;
}

const transitions: Record<
  AdminKycAction,
  { from: AdminKycStatus; to: AdminKycStatus; eventType: string }
> = {
  'start-review': {
    from: 'SUBMITTED',
    to: 'UNDER_REVIEW',
    eventType: 'REVIEW_STARTED',
  },
  'request-more-info': {
    from: 'UNDER_REVIEW',
    to: 'MORE_INFO_REQUIRED',
    eventType: 'MORE_INFO_REQUESTED',
  },
  approve: { from: 'UNDER_REVIEW', to: 'APPROVED', eventType: 'APPROVED' },
  reject: { from: 'UNDER_REVIEW', to: 'REJECTED', eventType: 'REJECTED' },
  'require-reverification': {
    from: 'APPROVED',
    to: 'REVERIFICATION_REQUIRED',
    eventType: 'REVERIFICATION_REQUIRED',
  },
};

@Injectable()
export class AdminKycService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listCases(
    adminActor: AdminKycActor,
    filters: KycCaseFilterDto,
  ): Promise<AdminKycCaseListResponse> {
    const conditions: SQL[] = [
      eq(marketAccess.adminUserId, adminActor.adminUserId),
      isNull(marketAccess.revokedAt),
      eq(markets.status, 'ACTIVE'),
    ];
    if (filters.status)
      conditions.push(eq(memberKycCases.status, filters.status));
    if (filters.marketId)
      conditions.push(eq(memberKycCases.marketId, filters.marketId));
    if (filters.dateFrom)
      conditions.push(gte(memberKycCases.submittedAt, filters.dateFrom));
    if (filters.dateTo)
      conditions.push(lte(memberKycCases.submittedAt, filters.dateTo));

    const where = and(...conditions);
    const baseSelection = {
      kycCase: memberKycCases,
      publicMemberId: members.publicMemberId,
      memberStatus: members.status,
      kycLevel: members.kycLevel,
      displayName: memberProfiles.displayName,
      email: accounts.email,
      accountCountry: accounts.accountCountry,
    };
    const offset = (filters.page - 1) * filters.pageSize;
    const [rows, totalRows] = await Promise.all([
      this.database.db
        .select(baseSelection)
        .from(memberKycCases)
        .innerJoin(members, eq(members.id, memberKycCases.memberId))
        .innerJoin(accounts, eq(accounts.id, members.accountId))
        .leftJoin(memberProfiles, eq(memberProfiles.memberId, members.id))
        .innerJoin(
          marketAccess,
          eq(marketAccess.marketId, memberKycCases.marketId),
        )
        .innerJoin(markets, eq(markets.id, memberKycCases.marketId))
        .where(where)
        .orderBy(
          desc(memberKycCases.submittedAt),
          desc(memberKycCases.createdAt),
        )
        .limit(filters.pageSize)
        .offset(offset),
      this.database.db
        .select({ value: count() })
        .from(memberKycCases)
        .innerJoin(
          marketAccess,
          eq(marketAccess.marketId, memberKycCases.marketId),
        )
        .innerJoin(markets, eq(markets.id, memberKycCases.marketId))
        .where(where),
    ]);

    return {
      items: rows.map((row) => this.listItem(row)),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  async getCase(
    adminActor: AdminKycActor,
    caseId: string,
  ): Promise<AdminKycCaseResponse> {
    const rows = await this.database.db
      .select({ marketId: memberKycCases.marketId })
      .from(memberKycCases)
      .where(eq(memberKycCases.id, caseId))
      .limit(1);
    const current = rows[0];
    if (!current) throw adminKycCaseNotFoundError();
    await this.assertMarketAccess(
      this.database.db,
      adminActor.adminUserId,
      current.marketId,
    );
    return this.caseResponse(this.database.db, caseId);
  }

  startReview(
    adminActor: AdminKycActor,
    caseId: string,
    input: AdminKycActionDto,
    idempotencyKey: string,
  ): Promise<AdminKycCaseResponse> {
    return this.transition(
      adminActor,
      caseId,
      input,
      idempotencyKey,
      'start-review',
    );
  }

  requestMoreInfo(
    adminActor: AdminKycActor,
    caseId: string,
    input: AdminKycActionDto,
    idempotencyKey: string,
  ): Promise<AdminKycCaseResponse> {
    return this.transition(
      adminActor,
      caseId,
      input,
      idempotencyKey,
      'request-more-info',
    );
  }

  approve(
    adminActor: AdminKycActor,
    caseId: string,
    input: AdminKycActionDto,
    idempotencyKey: string,
  ): Promise<AdminKycCaseResponse> {
    return this.transition(
      adminActor,
      caseId,
      input,
      idempotencyKey,
      'approve',
    );
  }

  reject(
    adminActor: AdminKycActor,
    caseId: string,
    input: AdminKycActionDto,
    idempotencyKey: string,
  ): Promise<AdminKycCaseResponse> {
    return this.transition(adminActor, caseId, input, idempotencyKey, 'reject');
  }

  requireReverification(
    adminActor: AdminKycActor,
    caseId: string,
    input: AdminKycActionDto,
    idempotencyKey: string,
  ): Promise<AdminKycCaseResponse> {
    return this.transition(
      adminActor,
      caseId,
      input,
      idempotencyKey,
      'require-reverification',
    );
  }

  private async transition(
    adminActor: AdminKycActor,
    caseId: string,
    input: AdminKycActionDto,
    idempotencyKey: string,
    action: AdminKycAction,
  ): Promise<AdminKycCaseResponse> {
    const transition = transitions[action];
    const scope = `admin-kyc:${action}:${adminActor.adminUserId}:${caseId}`;
    const requestHash = this.hashPayload({
      action,
      caseId,
      reason: input.reason,
    });

    return this.database.runTransaction(async (tx) => {
      const locked = await this.lockCase(tx, caseId);
      const adminAccountId = await this.assertMarketAccess(
        tx,
        adminActor.adminUserId,
        locked.kycCase.marketId,
      );
      if (adminAccountId === locked.memberAccountId) {
        throw adminKycSelfReviewError();
      }

      const cached = await this.readIdempotency(
        tx,
        scope,
        idempotencyKey,
        requestHash,
      );
      if (cached) return cached;
      if (locked.kycCase.status !== transition.from) {
        throw adminKycInvalidStateError(locked.kycCase.status, transition.from);
      }

      const idempotencyRows = await tx
        .insert(memberKycIdempotencyKeys)
        .values({ scope, key: idempotencyKey, requestHash })
        .returning({ id: memberKycIdempotencyKeys.id });
      const idempotencyId = idempotencyRows[0]?.id;
      if (!idempotencyId) {
        throw new Error('Admin KYC idempotency insert returned no row.');
      }

      const now = new Date();
      const updatedRows = await tx
        .update(memberKycCases)
        .set({
          status: transition.to,
          reviewedByAdminUserId: adminActor.adminUserId,
          decisionReason: input.reason,
          reviewedAt: action === 'start-review' ? null : now,
          reverificationRequiredAt:
            action === 'require-reverification' ? now : undefined,
          updatedAt: now,
        })
        .where(
          and(
            eq(memberKycCases.id, caseId),
            eq(memberKycCases.status, transition.from),
          ),
        )
        .returning({ id: memberKycCases.id });
      if (!updatedRows[0]) {
        throw adminKycInvalidTransitionError(
          locked.kycCase.status,
          transition.to,
        );
      }

      if (action === 'approve') {
        const memberRows = await tx
          .update(members)
          .set({ kycLevel: 'LEVEL_2', updatedAt: now })
          .where(eq(members.id, locked.memberId))
          .returning({ id: members.id });
        if (!memberRows[0]) {
          throw new Error('Member KYC level update returned no row.');
        }
      }

      await tx.insert(memberKycHistory).values({
        memberKycCaseId: caseId,
        eventType: transition.eventType,
        actorType: 'ADMIN_USER',
        actorId: adminActor.adminUserId,
        summary: `KYC case changed from ${transition.from} to ${transition.to}.`,
        metadata: {
          fromStatus: transition.from,
          toStatus: transition.to,
          reason: input.reason,
        },
        occurredAt: now,
      });
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: adminActor.adminUserId },
        action: `member.kyc.${action}`,
        entity: { type: 'member_kyc_case', id: caseId },
        marketId: locked.kycCase.marketId,
        before: { status: transition.from },
        after: {
          status: transition.to,
          ...(action === 'approve' ? { memberKycLevel: 'LEVEL_2' } : {}),
        },
        reason: input.reason,
        result: 'SUCCESS',
        requestId: adminActor.requestId,
        ipAddress: adminActor.ipAddress,
        summary: `Member KYC case changed to ${transition.to}.`,
      });

      const response = await this.caseResponse(tx, caseId);
      await tx
        .update(memberKycIdempotencyKeys)
        .set({ response, statusCode: 200, updatedAt: now })
        .where(eq(memberKycIdempotencyKeys.id, idempotencyId));
      return response;
    });
  }

  private async lockCase(
    tx: DbTransaction,
    caseId: string,
  ): Promise<LockedCase> {
    const rows = await tx
      .select({
        kycCase: memberKycCases,
        memberAccountId: members.accountId,
        memberId: members.id,
      })
      .from(memberKycCases)
      .innerJoin(members, eq(members.id, memberKycCases.memberId))
      .where(eq(memberKycCases.id, caseId))
      .for('update');
    if (!rows[0]) throw adminKycCaseNotFoundError();
    return rows[0];
  }

  private async assertMarketAccess(
    db: DbExecutor,
    adminUserId: string,
    marketId: string,
  ): Promise<string> {
    const rows = await db
      .select({ accountId: adminUsers.accountId })
      .from(marketAccess)
      .innerJoin(adminUsers, eq(adminUsers.id, marketAccess.adminUserId))
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, adminUserId),
          eq(marketAccess.marketId, marketId),
          isNull(marketAccess.revokedAt),
          eq(adminUsers.status, 'ACTIVE'),
          eq(markets.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw adminKycNoMarketAccessError();
    return rows[0].accountId;
  }

  private async readIdempotency(
    tx: DbTransaction,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<AdminKycCaseResponse | null> {
    const rows = await tx
      .select()
      .from(memberKycIdempotencyKeys)
      .where(
        and(
          eq(memberKycIdempotencyKeys.scope, scope),
          eq(memberKycIdempotencyKeys.key, key),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw adminKycIdempotencyConflictError();
    }
    if (!existing.response) {
      throw adminKycInvalidStateError(
        undefined,
        'completed idempotent request',
      );
    }
    return existing.response as AdminKycCaseResponse;
  }

  private async caseResponse(
    db: DbExecutor,
    caseId: string,
  ): Promise<AdminKycCaseResponse> {
    const rows = await db
      .select({
        kycCase: memberKycCases,
        publicMemberId: members.publicMemberId,
        memberStatus: members.status,
        kycLevel: members.kycLevel,
        displayName: memberProfiles.displayName,
        email: accounts.email,
        accountCountry: accounts.accountCountry,
      })
      .from(memberKycCases)
      .innerJoin(members, eq(members.id, memberKycCases.memberId))
      .innerJoin(accounts, eq(accounts.id, members.accountId))
      .leftJoin(memberProfiles, eq(memberProfiles.memberId, members.id))
      .where(eq(memberKycCases.id, caseId))
      .limit(1);
    const row = rows[0];
    if (!row) throw adminKycCaseNotFoundError();
    const [documents, history] = await Promise.all([
      db
        .select()
        .from(memberKycDocuments)
        .where(
          and(
            eq(memberKycDocuments.memberKycCaseId, caseId),
            isNull(memberKycDocuments.archivedAt),
          ),
        )
        .orderBy(asc(memberKycDocuments.createdAt)),
      db
        .select()
        .from(memberKycHistory)
        .where(eq(memberKycHistory.memberKycCaseId, caseId))
        .orderBy(asc(memberKycHistory.occurredAt)),
    ]);

    return {
      ...this.listItem(row),
      version: row.kycCase.version,
      legalFullName: row.kycCase.legalFullName,
      identificationType: row.kycCase.identificationType,
      identificationNumber: this.maskIdentificationNumber(
        row.kycCase.identificationNumber,
      ),
      dateOfBirth: row.kycCase.dateOfBirth,
      nationality: row.kycCase.nationality,
      residentialAddress:
        (row.kycCase.residentialAddress as Record<string, unknown> | null) ??
        null,
      accountCountrySnapshot: row.kycCase.accountCountrySnapshot,
      submissionMarketId: row.kycCase.submissionMarketId,
      consentVersion: row.kycCase.consentVersion,
      reviewedByAdminUserId: row.kycCase.reviewedByAdminUserId,
      decisionReason: row.kycCase.decisionReason,
      reverificationRequiredAt:
        row.kycCase.reverificationRequiredAt?.toISOString() ?? null,
      createdAt: row.kycCase.createdAt.toISOString(),
      documents: documents.map((document) => ({
        id: document.id,
        documentType: document.documentType,
        mimeType: document.contentType,
        size: Number(document.byteSize),
        checksum: document.sha256,
        scanStatus: document.scanStatus,
        createdAt: document.createdAt.toISOString(),
      })),
      history: history.map((entry) => ({
        id: entry.id,
        eventType: entry.eventType,
        actorType: entry.actorType,
        actorId: entry.actorId,
        summary: entry.summary,
        metadata: (entry.metadata as Record<string, unknown>) ?? {},
        occurredAt: entry.occurredAt.toISOString(),
      })),
    };
  }

  private listItem(row: {
    kycCase: KycCaseRow;
    publicMemberId: string;
    memberStatus: string;
    kycLevel: string;
    displayName: string | null;
    email: string;
    accountCountry: string;
  }): AdminKycCaseListItem {
    return {
      id: row.kycCase.id,
      marketId: row.kycCase.marketId,
      status: row.kycCase.status,
      levelRequested: row.kycCase.levelRequested,
      member: {
        publicMemberId: row.publicMemberId,
        displayName: row.displayName,
        email: this.maskEmail(row.email),
        accountCountry: row.accountCountry,
        status: row.memberStatus,
        kycLevel: row.kycLevel,
      },
      submittedAt: row.kycCase.submittedAt?.toISOString() ?? null,
      reviewedAt: row.kycCase.reviewedAt?.toISOString() ?? null,
      updatedAt: row.kycCase.updatedAt.toISOString(),
    };
  }

  private maskIdentificationNumber(value: string | null): string | null {
    return value ? `****${value.slice(-4)}` : null;
  }

  private maskEmail(value: string): string {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256')
      .update(this.stableStringify(payload))
      .digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, item]) =>
            `${JSON.stringify(key)}:${this.stableStringify(item)}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
