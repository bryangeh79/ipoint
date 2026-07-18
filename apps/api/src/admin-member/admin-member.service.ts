import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  adminMemberNotes,
  adminUsers,
  marketAccess,
  markets,
  memberKycCases,
  memberKycIdempotencyKeys,
  memberMarketPreferences,
  memberProfiles,
  memberStatusHistory,
  members,
  sessions,
  type Database,
} from '@ipoint/database';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import { AdminKycService } from '../admin-kyc/admin-kyc.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  AddAdminNoteDto,
  CloseMemberDto,
  MemberListQueryDto,
  ReactivateMemberDto,
  RequireReverificationDto,
  RevokeSessionsDto,
  SuspendMemberDto,
} from './admin-member.dto.js';
import {
  adminNoteEmptyError,
  adminNoteTooLongError,
  kycReverificationNotAllowedError,
  memberAlreadyClosedError,
  memberCloseConfirmationRequiredError,
  memberIdempotencyConflictError,
  memberInvalidStatusError,
  memberMarketAccessDeniedError,
  memberNotFoundError,
  memberStatusTransitionError,
} from './admin-member.errors.js';
import type {
  AdminMemberActor,
  AdminMemberDetailResponse,
  AdminMemberListResponse,
  AdminMemberStatus,
} from './admin-member.types.js';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

interface LockedMember {
  memberId: string;
  accountId: string;
  publicMemberId: string;
  status: AdminMemberStatus;
  marketId: string;
}

@Injectable()
export class AdminMemberService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AdminKycService) private readonly adminKyc: AdminKycService,
  ) {}

  async listMembers(
    adminActor: AdminMemberActor,
    filters: MemberListQueryDto,
  ): Promise<AdminMemberListResponse> {
    const conditions: SQL[] = [
      eq(marketAccess.adminUserId, adminActor.adminUserId),
      isNull(marketAccess.revokedAt),
      eq(memberMarketPreferences.isCurrent, true),
      eq(memberMarketPreferences.isEnabled, true),
      eq(markets.status, 'ACTIVE'),
    ];
    if (filters.status) conditions.push(eq(members.status, filters.status));
    if (filters.kycLevel)
      conditions.push(eq(members.kycLevel, filters.kycLevel));
    if (filters.marketId)
      conditions.push(eq(memberMarketPreferences.marketId, filters.marketId));
    if (filters.createdAfter)
      conditions.push(gte(members.createdAt, filters.createdAfter));
    if (filters.createdBefore)
      conditions.push(lte(members.createdAt, filters.createdBefore));
    if (filters.query) {
      const search = `%${filters.query}%`;
      conditions.push(
        or(
          ilike(members.publicMemberId, search),
          ilike(accounts.email, search),
        )!,
      );
    }
    const where = and(...conditions);
    const order = this.listOrder(filters.sort);
    const offset = (filters.page - 1) * filters.pageSize;
    const [rows, totals] = await Promise.all([
      this.database.db
        .select({
          publicMemberId: members.publicMemberId,
          displayName: memberProfiles.displayName,
          email: accounts.email,
          status: members.status,
          kycLevel: members.kycLevel,
          accountCountry: accounts.accountCountry,
          currentMarketId: memberMarketPreferences.marketId,
          createdAt: members.createdAt,
        })
        .from(members)
        .innerJoin(accounts, eq(accounts.id, members.accountId))
        .leftJoin(memberProfiles, eq(memberProfiles.memberId, members.id))
        .innerJoin(
          memberMarketPreferences,
          eq(memberMarketPreferences.memberId, members.id),
        )
        .innerJoin(
          marketAccess,
          eq(marketAccess.marketId, memberMarketPreferences.marketId),
        )
        .innerJoin(markets, eq(markets.id, memberMarketPreferences.marketId))
        .where(where)
        .orderBy(order)
        .limit(filters.pageSize)
        .offset(offset),
      this.database.db
        .select({ value: count() })
        .from(members)
        .innerJoin(accounts, eq(accounts.id, members.accountId))
        .innerJoin(
          memberMarketPreferences,
          eq(memberMarketPreferences.memberId, members.id),
        )
        .innerJoin(
          marketAccess,
          eq(marketAccess.marketId, memberMarketPreferences.marketId),
        )
        .innerJoin(markets, eq(markets.id, memberMarketPreferences.marketId))
        .where(where),
    ]);
    return {
      members: rows.map((row) => ({
        ...row,
        email: this.maskEmail(row.email),
        createdAt: row.createdAt.toISOString(),
      })),
      total: Number(totals[0]?.value ?? 0),
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  async getMember(
    adminActor: AdminMemberActor,
    publicMemberId: string,
  ): Promise<AdminMemberDetailResponse> {
    const member = await this.findMember(this.database.db, publicMemberId);
    await this.assertMarketAccess(
      this.database.db,
      adminActor.adminUserId,
      member.marketId,
    );
    return this.memberDetail(this.database.db, publicMemberId);
  }

  suspendMember(
    actor: AdminMemberActor,
    publicMemberId: string,
    input: SuspendMemberDto,
  ): Promise<AdminMemberDetailResponse> {
    return this.changeStatus(
      actor,
      publicMemberId,
      input,
      'ACTIVE',
      'SUSPENDED',
    );
  }

  reactivateMember(
    actor: AdminMemberActor,
    publicMemberId: string,
    input: ReactivateMemberDto,
  ): Promise<AdminMemberDetailResponse> {
    return this.changeStatus(
      actor,
      publicMemberId,
      input,
      'SUSPENDED',
      'ACTIVE',
    );
  }

  async closeMember(
    actor: AdminMemberActor,
    publicMemberId: string,
    input: CloseMemberDto,
  ): Promise<AdminMemberDetailResponse> {
    if (input.confirmationText !== 'CONFIRM')
      throw memberCloseConfirmationRequiredError();
    return this.database.runTransaction(async (tx) => {
      const locked = await this.lockMember(tx, publicMemberId);
      await this.assertMarketAccess(tx, actor.adminUserId, locked.marketId);
      const cached = await this.readIdempotency<AdminMemberDetailResponse>(
        tx,
        this.scope('close', actor, publicMemberId),
        input.idempotencyKey,
        this.hashPayload(input),
      );
      if (cached) return cached;
      if (locked.status === 'CLOSED') throw memberAlreadyClosedError();
      if (locked.status !== 'ACTIVE' && locked.status !== 'SUSPENDED')
        throw memberInvalidStatusError(locked.status, 'ACTIVE or SUSPENDED');
      return this.persistStatusChange(tx, actor, locked, input, 'CLOSED', true);
    });
  }

  async revokeSessions(
    actor: AdminMemberActor,
    publicMemberId: string,
    input: RevokeSessionsDto,
  ): Promise<AdminMemberDetailResponse> {
    return this.database.runTransaction(async (tx) => {
      const locked = await this.lockMember(tx, publicMemberId);
      await this.assertMarketAccess(tx, actor.adminUserId, locked.marketId);
      const scope = this.scope('revoke-sessions', actor, publicMemberId);
      const requestHash = this.hashPayload(input);
      const cached = await this.readIdempotency<AdminMemberDetailResponse>(
        tx,
        scope,
        input.idempotencyKey,
        requestHash,
      );
      if (cached) return cached;
      const idempotencyId = await this.createIdempotency(
        tx,
        scope,
        input.idempotencyKey,
        requestHash,
      );
      await this.revokeMemberSessions(tx, locked.accountId, 'ADMIN_REVOKED');
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'member.sessions.revoke',
        entity: { type: 'member', id: locked.memberId },
        marketId: locked.marketId,
        reason: input.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'All member sessions were revoked by an administrator.',
      });
      const response = await this.memberDetail(tx, publicMemberId);
      await this.completeIdempotency(tx, idempotencyId, response);
      return response;
    });
  }

  async requireReverification(
    actor: AdminMemberActor,
    publicMemberId: string,
    input: RequireReverificationDto,
  ): Promise<AdminMemberDetailResponse> {
    const member = await this.findMember(this.database.db, publicMemberId);
    await this.assertMarketAccess(
      this.database.db,
      actor.adminUserId,
      member.marketId,
    );
    const cases = await this.database.db
      .select({ id: memberKycCases.id, status: memberKycCases.status })
      .from(memberKycCases)
      .where(eq(memberKycCases.memberId, member.memberId))
      .limit(1);
    const kycCase = cases[0];
    if (!kycCase || kycCase.status !== 'APPROVED')
      throw kycReverificationNotAllowedError();
    await this.adminKyc.requireReverification(
      {
        adminUserId: actor.adminUserId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
      },
      kycCase.id,
      { reason: input.reason },
      input.idempotencyKey,
    );
    return this.getMember(actor, publicMemberId);
  }

  async addAdminNote(
    actor: AdminMemberActor,
    publicMemberId: string,
    input: AddAdminNoteDto,
  ): Promise<AdminMemberDetailResponse> {
    const content = input.content.trim();
    if (!content) throw adminNoteEmptyError();
    if (content.length > 5000) throw adminNoteTooLongError();
    return this.database.runTransaction(async (tx) => {
      const locked = await this.lockMember(tx, publicMemberId);
      await this.assertMarketAccess(tx, actor.adminUserId, locked.marketId);
      const scope = this.scope('note', actor, publicMemberId);
      const requestHash = this.hashPayload({ ...input, content });
      const cached = await this.readIdempotency<AdminMemberDetailResponse>(
        tx,
        scope,
        input.idempotencyKey,
        requestHash,
      );
      if (cached) return cached;
      const idempotencyId = await this.createIdempotency(
        tx,
        scope,
        input.idempotencyKey,
        requestHash,
      );
      await tx.insert(adminMemberNotes).values({
        memberId: locked.memberId,
        adminUserId: actor.adminUserId,
        marketId: locked.marketId,
        content,
        isInternal: input.isInternal,
      });
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'member.note.add',
        entity: { type: 'member', id: locked.memberId },
        marketId: locked.marketId,
        after: { isInternal: input.isInternal },
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'An administrator added a member note.',
      });
      const response = await this.memberDetail(tx, publicMemberId);
      await this.completeIdempotency(tx, idempotencyId, response);
      return response;
    });
  }

  private async changeStatus(
    actor: AdminMemberActor,
    publicMemberId: string,
    input: SuspendMemberDto | ReactivateMemberDto,
    fromStatus: AdminMemberStatus,
    toStatus: AdminMemberStatus,
  ): Promise<AdminMemberDetailResponse> {
    return this.database.runTransaction(async (tx) => {
      const locked = await this.lockMember(tx, publicMemberId);
      await this.assertMarketAccess(tx, actor.adminUserId, locked.marketId);
      const action = this.actionForStatus(toStatus);
      const cached = await this.readIdempotency<AdminMemberDetailResponse>(
        tx,
        this.scope(action, actor, publicMemberId),
        input.idempotencyKey,
        this.hashPayload(input),
      );
      if (cached) return cached;
      if (locked.status !== fromStatus)
        throw memberInvalidStatusError(locked.status, fromStatus);
      return this.persistStatusChange(
        tx,
        actor,
        locked,
        input,
        toStatus,
        toStatus === 'SUSPENDED',
      );
    });
  }

  private async persistStatusChange(
    tx: DbTransaction,
    actor: AdminMemberActor,
    locked: LockedMember,
    input: SuspendMemberDto | ReactivateMemberDto | CloseMemberDto,
    toStatus: AdminMemberStatus,
    revokeSessions: boolean,
  ): Promise<AdminMemberDetailResponse> {
    const action = this.actionForStatus(toStatus);
    const scope = this.scope(action, actor, locked.publicMemberId);
    const requestHash = this.hashPayload(input);
    const idempotencyId = await this.createIdempotency(
      tx,
      scope,
      input.idempotencyKey,
      requestHash,
    );
    const now = new Date();
    const updated = await tx
      .update(members)
      .set({
        status: toStatus,
        closedAt: toStatus === 'CLOSED' ? now : null,
        updatedAt: now,
      })
      .where(
        and(eq(members.id, locked.memberId), eq(members.status, locked.status)),
      )
      .returning({ id: members.id });
    if (!updated[0]) throw memberStatusTransitionError(locked.status, toStatus);
    if (revokeSessions)
      await this.revokeMemberSessions(
        tx,
        locked.accountId,
        `MEMBER_${toStatus}`,
      );
    await tx.insert(memberStatusHistory).values({
      memberId: locked.memberId,
      fromStatus: locked.status,
      toStatus,
      actorType: 'ADMIN_USER',
      actorId: actor.adminUserId,
      reason: input.reason,
      occurredAt: now,
    });
    await this.audit.appendWithinTransaction(tx, {
      actor: { type: 'ADMIN_USER', id: actor.adminUserId },
      action: `member.${action}`,
      entity: { type: 'member', id: locked.memberId },
      marketId: locked.marketId,
      before: { status: locked.status },
      after: { status: toStatus },
      reason: input.reason,
      result: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      summary: `Member status changed from ${locked.status} to ${toStatus}.`,
    });
    const response = await this.memberDetail(tx, locked.publicMemberId);
    await this.completeIdempotency(tx, idempotencyId, response);
    return response;
  }

  private async revokeMemberSessions(
    tx: DbTransaction,
    accountId: string,
    reason: string,
  ): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(
        and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
      );
  }

  private async lockMember(tx: DbTransaction, publicMemberId: string) {
    const rows = await tx
      .select({
        memberId: members.id,
        accountId: members.accountId,
        publicMemberId: members.publicMemberId,
        status: members.status,
        marketId: memberMarketPreferences.marketId,
      })
      .from(members)
      .innerJoin(
        memberMarketPreferences,
        and(
          eq(memberMarketPreferences.memberId, members.id),
          eq(memberMarketPreferences.isCurrent, true),
        ),
      )
      .where(eq(members.publicMemberId, publicMemberId))
      .for('update');
    if (!rows[0]) throw memberNotFoundError();
    return rows[0] as LockedMember;
  }

  private async findMember(db: DbExecutor, publicMemberId: string) {
    const rows = await db
      .select({
        memberId: members.id,
        accountId: members.accountId,
        marketId: memberMarketPreferences.marketId,
      })
      .from(members)
      .innerJoin(
        memberMarketPreferences,
        and(
          eq(memberMarketPreferences.memberId, members.id),
          eq(memberMarketPreferences.isCurrent, true),
        ),
      )
      .where(eq(members.publicMemberId, publicMemberId))
      .limit(1);
    if (!rows[0]) throw memberNotFoundError();
    return rows[0];
  }

  private async assertMarketAccess(
    db: DbExecutor,
    adminUserId: string,
    marketId: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: adminUsers.id })
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
    if (!rows[0]) throw memberMarketAccessDeniedError();
  }

  private async memberDetail(
    db: DbExecutor,
    publicMemberId: string,
  ): Promise<AdminMemberDetailResponse> {
    const rows = await db
      .select({ member: members, account: accounts, profile: memberProfiles })
      .from(members)
      .innerJoin(accounts, eq(accounts.id, members.accountId))
      .leftJoin(memberProfiles, eq(memberProfiles.memberId, members.id))
      .where(eq(members.publicMemberId, publicMemberId))
      .limit(1);
    const row = rows[0];
    if (!row) throw memberNotFoundError();
    const [currentPrefs, kycRows, notes, history] = await Promise.all([
      db
        .select({
          preference: memberMarketPreferences,
          marketCode: markets.code,
        })
        .from(memberMarketPreferences)
        .innerJoin(markets, eq(markets.id, memberMarketPreferences.marketId))
        .where(eq(memberMarketPreferences.memberId, row.member.id))
        .orderBy(asc(memberMarketPreferences.sortOrder), asc(markets.code)),
      db
        .select()
        .from(memberKycCases)
        .where(eq(memberKycCases.memberId, row.member.id))
        .limit(1),
      db
        .select()
        .from(adminMemberNotes)
        .where(eq(adminMemberNotes.memberId, row.member.id))
        .orderBy(desc(adminMemberNotes.createdAt)),
      db
        .select()
        .from(memberStatusHistory)
        .where(eq(memberStatusHistory.memberId, row.member.id))
        .orderBy(desc(memberStatusHistory.occurredAt)),
    ]);
    const current = currentPrefs.find((item) => item.preference.isCurrent);
    if (!current) throw memberNotFoundError();
    const kyc = kycRows[0];
    return {
      publicMemberId: row.member.publicMemberId,
      displayName: row.profile?.displayName ?? null,
      email: this.maskEmail(row.account.email),
      status: row.member.status,
      kycLevel: row.member.kycLevel,
      accountCountry: row.account.accountCountry,
      currentMarketId: current.preference.marketId,
      createdAt: row.member.createdAt.toISOString(),
      closedAt: row.member.closedAt?.toISOString() ?? null,
      profile: {
        fullName: row.profile?.fullName ?? null,
        phone: this.maskPhone(row.profile?.phone ?? null),
        phoneVerificationStatus:
          row.profile?.phoneVerificationStatus ?? 'NOT_PROVIDED',
        birthDate: row.profile?.birthDate ?? null,
        address:
          (row.profile?.address as Record<string, unknown> | null) ?? null,
        locale: row.profile?.locale ?? null,
        language: row.profile?.language ?? null,
      },
      kyc: kyc
        ? {
            caseId: kyc.id,
            marketId: kyc.marketId,
            status: kyc.status,
            levelRequested: kyc.levelRequested,
            legalFullName: kyc.legalFullName,
            identificationType: kyc.identificationType,
            identificationNumber: this.maskIdentification(
              kyc.identificationNumber,
            ),
            submittedAt: kyc.submittedAt?.toISOString() ?? null,
            reviewedAt: kyc.reviewedAt?.toISOString() ?? null,
            reverificationRequiredAt:
              kyc.reverificationRequiredAt?.toISOString() ?? null,
          }
        : null,
      marketPreferences: currentPrefs.map(({ preference, marketCode }) => ({
        marketId: preference.marketId,
        marketCode,
        isEnabled: preference.isEnabled,
        isCurrent: preference.isCurrent,
        sortOrder: preference.sortOrder,
        lastSelectedAt: preference.lastSelectedAt?.toISOString() ?? null,
      })),
      notes: notes.map((note) => ({
        id: note.id,
        adminUserId: note.adminUserId,
        marketId: note.marketId,
        content: note.content,
        isInternal: note.isInternal,
        createdAt: note.createdAt.toISOString(),
      })),
      statusHistory: history.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        actorType: entry.actorType,
        actorId: entry.actorId,
        reason: entry.reason,
        occurredAt: entry.occurredAt.toISOString(),
      })),
    };
  }

  private listOrder(sort: MemberListQueryDto['sort']) {
    switch (sort) {
      case 'createdAt:asc':
        return asc(members.createdAt);
      case 'publicMemberId:asc':
        return asc(members.publicMemberId);
      case 'publicMemberId:desc':
        return desc(members.publicMemberId);
      default:
        return desc(members.createdAt);
    }
  }

  private actionForStatus(status: AdminMemberStatus): string {
    switch (status) {
      case 'SUSPENDED':
        return 'suspend';
      case 'ACTIVE':
        return 'reactivate';
      case 'CLOSED':
        return 'close';
      default:
        return status.toLowerCase();
    }
  }

  private scope(action: string, actor: AdminMemberActor, memberId: string) {
    return `admin-member:${action}:${actor.adminUserId}:${memberId}`;
  }

  private async readIdempotency<T>(
    tx: DbTransaction,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<T | null> {
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
    if (existing.requestHash !== requestHash)
      throw memberIdempotencyConflictError();
    if (!existing.response) throw memberStatusTransitionError();
    return existing.response as T;
  }

  private async createIdempotency(
    tx: DbTransaction,
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<string> {
    const rows = await tx
      .insert(memberKycIdempotencyKeys)
      .values({ scope, key, requestHash })
      .returning({ id: memberKycIdempotencyKeys.id });
    if (!rows[0]) throw memberStatusTransitionError();
    return rows[0].id;
  }

  private async completeIdempotency(
    tx: DbTransaction,
    id: string,
    response: unknown,
  ) {
    await tx
      .update(memberKycIdempotencyKeys)
      .set({ response, statusCode: 200, updatedAt: new Date() })
      .where(eq(memberKycIdempotencyKeys.id, id));
  }

  private maskEmail(value: string): string {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }

  private maskPhone(value: string | null): string | null {
    if (!value) return null;
    return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
  }

  private maskIdentification(value: string | null): string | null {
    return value ? `****${value.slice(-4)}` : null;
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256')
      .update(this.stableStringify(payload))
      .digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object')
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([key, item]) =>
            `${JSON.stringify(key)}:${this.stableStringify(item)}`,
        )
        .join(',')}}`;
    return JSON.stringify(value);
  }
}
