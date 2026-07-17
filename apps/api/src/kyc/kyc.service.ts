import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  memberKycCases,
  memberKycDocuments,
  memberKycHistory,
  memberKycIdempotencyKeys,
  memberMarketPreferences,
  members,
  type Database,
} from '@ipoint/database';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import type {
  CreateDocumentDto,
  CreateKycDraftDto,
  ResubmitKycDto,
  SubmitKycDto,
  UpdateKycDraftDto,
} from './kyc.dto.js';
import {
  kycDocumentLimitExceededError,
  kycDuplicateDocumentError,
  kycFileTooLargeError,
  kycIdempotencyConflictError,
  kycIdentificationNumberInvalidError,
  kycInvalidFileTypeError,
  kycInvalidStateError,
  kycMissingRequiredFieldsError,
  kycNotFoundError,
} from './kyc.errors.js';
import type { MemberKycResponse } from './kyc.types.js';

type KycCaseRow = typeof memberKycCases.$inferSelect;
type KycDocumentRow = typeof memberKycDocuments.$inferSelect;
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const MEMBER_KYC_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;
export const MEMBER_KYC_MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
export const MEMBER_KYC_MAX_DOCUMENTS = 10;
export const MEMBER_KYC_LEVEL_2_CONSENT_VERSION = 'KYC_LEVEL_2_V1';

@Injectable()
export class KycService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async resolveMemberId(accountId: string): Promise<string> {
    const rows = await this.database.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.accountId, accountId))
      .limit(1);
    if (!rows[0]) throw kycNotFoundError();
    return rows[0].id;
  }

  async getStatus(accountId: string): Promise<MemberKycResponse> {
    const memberId = await this.resolveMemberId(accountId);
    const rows = await this.database.db
      .select()
      .from(memberKycCases)
      .where(eq(memberKycCases.memberId, memberId))
      .limit(1);
    const kycCase = rows[0];
    if (!kycCase) return this.notStartedResponse();
    return this.responseForCase(this.database.db, kycCase);
  }

  async createDraft(
    accountId: string,
    input: CreateKycDraftDto,
  ): Promise<MemberKycResponse> {
    const memberId = await this.resolveMemberId(accountId);
    const operation = async (tx: DbTransaction): Promise<MemberKycResponse> => {
      const existingRows = await tx
        .select()
        .from(memberKycCases)
        .where(eq(memberKycCases.memberId, memberId))
        .limit(1);
      const existing = existingRows[0];
      if (existing?.status === 'DRAFT')
        return this.responseForCase(tx, existing);
      if (existing && existing.status !== 'NOT_STARTED') {
        throw kycInvalidStateError(existing.status, 'NOT_STARTED');
      }

      const marketId = await this.resolveCurrentMarketId(tx, memberId);
      const now = new Date();
      const rows = existing
        ? await tx
            .update(memberKycCases)
            .set({ status: 'DRAFT', marketId, updatedAt: now })
            .where(eq(memberKycCases.id, existing.id))
            .returning()
        : await tx
            .insert(memberKycCases)
            .values({
              memberId,
              marketId,
              status: 'DRAFT',
              levelRequested: 'LEVEL_2',
            })
            .returning();
      const created = rows[0];
      if (!created) throw new Error('KYC draft insert returned no row.');
      await this.appendHistory(tx, created.id, accountId, 'DRAFT_CREATED');
      return this.responseForCase(tx, created);
    };

    if (!input.idempotencyKey) {
      return this.database.runTransaction(operation);
    }
    return this.idempotent(
      `member-kyc:create-draft:${memberId}`,
      input.idempotencyKey,
      input,
      operation,
    );
  }

  async updateDraft(
    accountId: string,
    input: UpdateKycDraftDto,
  ): Promise<MemberKycResponse> {
    const memberId = await this.resolveMemberId(accountId);
    return this.database.runTransaction(async (tx) => {
      const current = await this.getCaseForUpdate(tx, memberId);
      if (current.status !== 'DRAFT') {
        throw kycInvalidStateError(current.status, 'DRAFT');
      }
      if (
        input.identificationNumber !== undefined &&
        !this.isIdentificationNumberValid(input.identificationNumber)
      ) {
        throw kycIdentificationNumberInvalidError();
      }
      const rows = await tx
        .update(memberKycCases)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(memberKycCases.id, current.id),
            eq(memberKycCases.status, 'DRAFT'),
          ),
        )
        .returning();
      const updated = rows[0];
      if (!updated) throw kycInvalidStateError(current.status, 'DRAFT');
      await this.appendHistory(tx, current.id, accountId, 'DRAFT_UPDATED');
      return this.responseForCase(tx, updated);
    });
  }

  async submit(
    accountId: string,
    input: SubmitKycDto,
  ): Promise<MemberKycResponse> {
    const memberId = await this.resolveMemberId(accountId);
    return this.idempotent(
      `member-kyc:submit:${memberId}`,
      input.idempotencyKey,
      input,
      async (tx) =>
        this.submitWithinTransaction(tx, memberId, accountId, false),
    );
  }

  async addDocument(
    accountId: string,
    input: CreateDocumentDto,
  ): Promise<MemberKycResponse> {
    const memberId = await this.resolveMemberId(accountId);
    if (!MEMBER_KYC_ALLOWED_MIME_TYPES.includes(input.mimeType as never)) {
      throw kycInvalidFileTypeError();
    }
    if (input.size > MEMBER_KYC_MAX_FILE_SIZE_BYTES) {
      throw kycFileTooLargeError();
    }

    return this.database.runTransaction(async (tx) => {
      const current = await this.getCaseForUpdate(tx, memberId);
      if (current.status !== 'DRAFT') {
        throw kycInvalidStateError(current.status, 'DRAFT');
      }
      const documentCountRows = await tx
        .select({ value: count() })
        .from(memberKycDocuments)
        .where(
          and(
            eq(memberKycDocuments.memberKycCaseId, current.id),
            isNull(memberKycDocuments.archivedAt),
          ),
        );
      if (
        Number(documentCountRows[0]?.value ?? 0) >= MEMBER_KYC_MAX_DOCUMENTS
      ) {
        throw kycDocumentLimitExceededError();
      }
      const checksum = input.checksum.toLowerCase();
      const duplicates = await tx
        .select({ id: memberKycDocuments.id })
        .from(memberKycDocuments)
        .where(
          and(
            eq(memberKycDocuments.memberKycCaseId, current.id),
            eq(memberKycDocuments.sha256, checksum),
            isNull(memberKycDocuments.archivedAt),
          ),
        )
        .limit(1);
      if (duplicates[0]) throw kycDuplicateDocumentError();

      await tx.insert(memberKycDocuments).values({
        memberKycCaseId: current.id,
        memberId,
        marketId: current.marketId,
        documentType: input.documentType,
        objectKey: `metadata-only/${current.id}/${randomUUID()}`,
        originalFilename: 'metadata-only',
        contentType: input.mimeType,
        byteSize: String(input.size),
        sha256: checksum,
        scanStatus: 'PENDING',
        classification: 'PRIVATE_KYC',
      });
      await this.appendHistory(tx, current.id, accountId, 'DOCUMENT_ADDED');
      const refreshed = await this.getCaseForUpdate(tx, memberId);
      return this.responseForCase(tx, refreshed);
    });
  }

  async resubmit(
    accountId: string,
    input: ResubmitKycDto,
  ): Promise<MemberKycResponse> {
    const memberId = await this.resolveMemberId(accountId);
    return this.idempotent(
      `member-kyc:resubmit:${memberId}`,
      input.idempotencyKey,
      input,
      async (tx) => this.submitWithinTransaction(tx, memberId, accountId, true),
    );
  }

  private async submitWithinTransaction(
    tx: DbTransaction,
    memberId: string,
    accountId: string,
    isResubmission: boolean,
  ): Promise<MemberKycResponse> {
    const current = await this.getCaseForUpdate(tx, memberId);
    const allowedStates = isResubmission
      ? ['MORE_INFO_REQUIRED', 'REVERIFICATION_REQUIRED']
      : ['DRAFT'];
    if (!allowedStates.includes(current.status)) {
      throw kycInvalidStateError(current.status, allowedStates.join(' or '));
    }
    const documents = await this.getDocuments(tx, current.id);
    this.validateRequiredFields(current, documents);
    const accountRows = await tx
      .select({ accountCountry: accounts.accountCountry })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    const accountCountry = accountRows[0]?.accountCountry;
    if (!accountCountry)
      throw kycMissingRequiredFieldsError(['accountCountry']);
    const submissionMarketId = await this.resolveCurrentMarketId(tx, memberId);
    const now = new Date();
    const rows = await tx
      .update(memberKycCases)
      .set({
        status: 'SUBMITTED',
        version: isResubmission ? current.version + 1 : current.version,
        accountCountrySnapshot: accountCountry.toUpperCase(),
        submissionMarketId,
        consentVersion: MEMBER_KYC_LEVEL_2_CONSENT_VERSION,
        submittedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(memberKycCases.id, current.id),
          eq(memberKycCases.status, current.status),
        ),
      )
      .returning();
    const submitted = rows[0];
    if (!submitted) throw kycInvalidStateError(current.status);
    await this.appendHistory(
      tx,
      current.id,
      accountId,
      isResubmission ? 'RESUBMITTED' : 'SUBMITTED',
    );
    return this.responseForCase(tx, submitted);
  }

  private validateRequiredFields(
    row: KycCaseRow,
    documents: KycDocumentRow[],
  ): void {
    const fields: string[] = [];
    if (!row.legalFullName?.trim()) fields.push('legalFullName');
    if (!row.identificationType) fields.push('identificationType');
    if (!row.identificationNumber?.trim()) fields.push('identificationNumber');
    if (!row.dateOfBirth) fields.push('dateOfBirth');
    if (!row.nationality) fields.push('nationality');
    if (!row.residentialAddress) fields.push('residentialAddress');
    if (documents.length === 0) fields.push('documents');
    if (fields.length > 0) throw kycMissingRequiredFieldsError(fields);
    if (!this.isIdentificationNumberValid(row.identificationNumber ?? '')) {
      throw kycIdentificationNumberInvalidError();
    }
  }

  private isIdentificationNumberValid(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9 ./-]{2,63}$/u.test(value.trim());
  }

  private async getCaseForUpdate(
    tx: DbTransaction,
    memberId: string,
  ): Promise<KycCaseRow> {
    const rows = await tx
      .select()
      .from(memberKycCases)
      .where(eq(memberKycCases.memberId, memberId))
      .for('update');
    if (!rows[0]) throw kycNotFoundError();
    return rows[0];
  }

  private async resolveCurrentMarketId(
    tx: DbTransaction,
    memberId: string,
  ): Promise<string> {
    const rows = await tx
      .select({ marketId: memberMarketPreferences.marketId })
      .from(memberMarketPreferences)
      .where(
        and(
          eq(memberMarketPreferences.memberId, memberId),
          eq(memberMarketPreferences.isCurrent, true),
          eq(memberMarketPreferences.isEnabled, true),
        ),
      )
      .limit(1);
    if (!rows[0]) throw kycMissingRequiredFieldsError(['currentMarket']);
    return rows[0].marketId;
  }

  private async getDocuments(
    db: Database | DbTransaction,
    caseId: string,
  ): Promise<KycDocumentRow[]> {
    return db
      .select()
      .from(memberKycDocuments)
      .where(
        and(
          eq(memberKycDocuments.memberKycCaseId, caseId),
          isNull(memberKycDocuments.archivedAt),
        ),
      )
      .orderBy(asc(memberKycDocuments.createdAt));
  }

  private async responseForCase(
    db: Database | DbTransaction,
    row: KycCaseRow,
  ): Promise<MemberKycResponse> {
    const documents = await this.getDocuments(db, row.id);
    return {
      id: row.id,
      status: row.status,
      levelRequested: row.levelRequested === 'LEVEL_2' ? 'LEVEL_2' : null,
      legalFullName: row.legalFullName,
      identificationType: row.identificationType,
      identificationNumber: row.identificationNumber
        ? `****${row.identificationNumber.slice(-4)}`
        : null,
      nationality: row.nationality,
      dateOfBirth: row.dateOfBirth,
      residentialAddress:
        (row.residentialAddress as Record<string, unknown> | null) ?? null,
      accountCountrySnapshot: row.accountCountrySnapshot,
      submissionMarketId: row.submissionMarketId,
      consentVersion: row.consentVersion,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      documents: documents.map((document) => ({
        id: document.id,
        documentType: document.documentType,
        mimeType: document.contentType,
        size: Number(document.byteSize),
        checksum: document.sha256,
        createdAt: document.createdAt.toISOString(),
      })),
    };
  }

  private notStartedResponse(): MemberKycResponse {
    return {
      id: null,
      status: 'NOT_STARTED',
      levelRequested: null,
      legalFullName: null,
      identificationType: null,
      identificationNumber: null,
      nationality: null,
      dateOfBirth: null,
      residentialAddress: null,
      accountCountrySnapshot: null,
      submissionMarketId: null,
      consentVersion: null,
      submittedAt: null,
      createdAt: null,
      updatedAt: null,
      documents: [],
    };
  }

  private async appendHistory(
    tx: DbTransaction,
    caseId: string,
    accountId: string,
    eventType: string,
  ): Promise<void> {
    await tx.insert(memberKycHistory).values({
      memberKycCaseId: caseId,
      eventType,
      actorType: 'ACCOUNT',
      actorId: accountId,
      summary: eventType.replaceAll('_', ' ').toLowerCase(),
      metadata: {},
    });
  }

  private async idempotent(
    scope: string,
    key: string,
    payload: unknown,
    operation: (tx: DbTransaction) => Promise<MemberKycResponse>,
  ): Promise<MemberKycResponse> {
    const requestHash = this.hashPayload(payload);
    return this.database.runTransaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(memberKycIdempotencyKeys)
        .where(
          and(
            eq(memberKycIdempotencyKeys.scope, scope),
            eq(memberKycIdempotencyKeys.key, key),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw kycIdempotencyConflictError();
        }
        if (existing.response) {
          return existing.response as MemberKycResponse;
        }
        throw kycInvalidStateError(undefined, 'completed idempotent request');
      }

      const inserted = await tx
        .insert(memberKycIdempotencyKeys)
        .values({ scope, key, requestHash })
        .returning({ id: memberKycIdempotencyKeys.id });
      const idempotencyId = inserted[0]?.id;
      if (!idempotencyId)
        throw new Error('KYC idempotency insert returned no row.');
      const response = await operation(tx);
      await tx
        .update(memberKycIdempotencyKeys)
        .set({ response, statusCode: 200, updatedAt: new Date() })
        .where(eq(memberKycIdempotencyKeys.id, idempotencyId));
      return response;
    });
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
