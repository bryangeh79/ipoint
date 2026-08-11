/**
 * L-06 member QR service - GET/POST/DELETE /members/me/qr.
 *
 * Storage: the frozen `member_qr_identities` table (migration 0007, Phase
 * 2). Only the SHA-256 hex token hash (64 chars, CHECK-constrained) is
 * ever persisted; the plaintext token exists only inside the signed
 * short-lived display token returned to the owner and is never written to
 * any table, log or audit row.
 *
 * Rotation: POST rotates in ONE transaction - the current ACTIVE row is
 * marked ROTATED (rotated_to_id -> new row) and a new ACTIVE row is
 * created (rotated_from_id -> old row). The partial unique index
 * `member_qr_identities_active_unique` (one ACTIVE per member) is the DB
 * backstop for the invariant; a 23505 on that index maps to
 * QR_ACTIVE_EXISTS (race backstop). A per-member row lock serializes
 * concurrent QR operations so a racing second POST observes the committed
 * ACTIVE row and performs a rotation instead of corrupting the chain.
 *
 * Revocation: DELETE flips ACTIVE -> REVOKED (revoked_at, reason).
 *
 * Idempotency: POST/DELETE replay the frozen generic `auth_idempotency_keys`
 * ledger (scope column, (scope,key) unique, request_hash binding) - the
 * codebase's generic idempotency store - with a member-scoped scope so no
 * cross-member key collision is possible. Replays return the stored
 * response and write no duplicate QR rows and no duplicate audit rows.
 *
 * Audit: every route is audited (contract). Success-path audit rows are
 * written inside the write transaction (atomic with the state change);
 * rejection-path audits (revoked/not-found/closed/conflict) are recorded
 * via the standalone audit path. Audit payloads contain only public QR
 * ids and statuses - never token material, never token hashes.
 */

import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  authIdempotencyKeys,
  members,
  memberQrIdentities,
  type Database,
} from '@ipoint/database';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import {
  buildMemberQrTokenClaims,
  resolveMemberQrSigningSecret,
  resolveMemberQrTtlSeconds,
  signMemberQrToken,
} from './member-qr.crypto.js';
import {
  MemberQrError,
  memberClosedError,
  memberNotFoundError,
  qrActiveExistsError,
  qrIdempotencyConflictError,
  qrIdempotencyKeyRequiredError,
  qrNotFoundError,
  qrRevokedError,
  qrStateConflictError,
  type MemberQrRequestMetadata,
  type MemberQrResponse,
  type MemberQrStatus,
} from './member-qr.types.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

interface QrRow {
  id: string;
  memberId: string;
  publicQrId: string;
  status: MemberQrStatus;
  rotatedFromId: string | null;
  rotatedToId: string | null;
  issuedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  reason: string | null;
}

const IDEMPOTENCY_SCOPE_PREFIX = 'member-qr';
const REVOKE_DEFAULT_REASON = 'MEMBER_INITIATED';
const REVOKE_RESPONSE = { revoked: true } as const;

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

@Injectable()
export class MemberQrService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------

  /**
   * GET /members/me/qr - return the member's active QR identity.
   * Member exists but has no QR row: 200 with `qr: null` (documented
   * choice, delivery note §4). Latest row REVOKED: QR_REVOKED.
   */
  async getQr(
    accountId: string,
    metadata: MemberQrRequestMetadata,
  ): Promise<MemberQrResponse> {
    const member = await this.resolveMember(accountId);
    const latest = await this.latestQrRow(member.id);
    if (!latest) {
      await this.auditOutcome(
        {
          actor: { type: 'ACCOUNT', id: accountId },
          action: 'member.qr.read',
          entity: { type: 'member', id: member.id },
          before: null,
          after: null,
          reason: 'Member has no QR identity row yet.',
          result: 'SUCCESS',
          summary: `${member.id} read member QR state (none).`,
        },
        metadata,
      );
      return { qr: null };
    }
    if (latest.status === 'REVOKED') {
      await this.auditOutcome(
        {
          actor: { type: 'ACCOUNT', id: accountId },
          action: 'member.qr.read',
          entity: { type: 'member_qr_identity', id: latest.publicQrId },
          before: { public_qr_id: latest.publicQrId, status: latest.status },
          after: null,
          reason: 'QR identity is revoked.',
          result: 'FAILURE',
          summary: `${latest.publicQrId} read attempted on revoked QR identity.`,
        },
        metadata,
      );
      throw qrRevokedError();
    }
    if (latest.status !== 'ACTIVE') {
      // ROTATED-as-latest is an invariant violation (rotation always
      // leaves an ACTIVE row); the member has no usable QR.
      throw qrStateConflictError();
    }
    const state = this.buildState(latest);
    await this.auditOutcome(
      {
        actor: { type: 'ACCOUNT', id: accountId },
        action: 'member.qr.read',
        entity: { type: 'member_qr_identity', id: latest.publicQrId },
        before: null,
        after: {
          public_qr_id: latest.publicQrId,
          status: latest.status,
          issued_at: latest.issuedAt.toISOString(),
          expires_at: latest.expiresAt?.toISOString() ?? null,
        },
        result: 'SUCCESS',
        summary: `${latest.publicQrId} member QR state read.`,
      },
      metadata,
    );
    return { qr: state };
  }

  /**
   * POST /members/me/qr - issue (no row yet) or rotate (ACTIVE row).
   * Requires an idempotency key (header or body). Replays return the
   * stored response and never create a second row.
   */
  async rotateQr(
    accountId: string,
    idempotencyKey: string | undefined,
    metadata: MemberQrRequestMetadata,
  ): Promise<MemberQrResponse> {
    const member = await this.resolveMember(accountId);
    const key = idempotencyKey?.trim();
    if (!key || key.length === 0 || key.length > 200) {
      throw qrIdempotencyKeyRequiredError();
    }
    const payload = { rotate: true };
    return this.withIdempotency(
      member.id,
      'rotate',
      key,
      payload,
      async (tx) => {
        await this.lockMemberRow(tx, member.id);
        const latest = await this.latestQrRow(member.id, tx);
        if (!latest || latest.status === 'ACTIVE') {
          const issued = await this.insertActiveQr(
            tx,
            member.id,
            latest?.id ?? null,
          );
          await this.writeAudit(
            tx,
            {
              actor: { type: 'ACCOUNT', id: accountId },
              action: latest ? 'member.qr.rotated' : 'member.qr.issued',
              entity: { type: 'member_qr_identity', id: issued.publicQrId },
              before: latest
                ? { public_qr_id: latest.publicQrId, status: 'ACTIVE' }
                : null,
              after: {
                public_qr_id: issued.publicQrId,
                status: 'ACTIVE',
                issued_at: issued.issuedAt.toISOString(),
                expires_at: issued.expiresAt?.toISOString() ?? null,
              },
              reason: latest
                ? 'Rotation from prior active QR identity.'
                : 'Initial member QR identity issuance.',
              result: 'SUCCESS',
              summary: `${issued.publicQrId} member QR ${latest ? 'rotated' : 'issued'}.`,
            },
            metadata,
          );
          return { qr: this.buildState(issued) };
        }
        if (latest.status === 'REVOKED') throw qrRevokedError();
        throw qrStateConflictError();
      },
    );
  }

  /**
   * DELETE /members/me/qr - revoke the active QR identity (204).
   * Replays (same key) return the stored 204 without touching state.
   */
  async revokeQr(
    accountId: string,
    input: { reason?: string },
    idempotencyKey: string | undefined,
    metadata: MemberQrRequestMetadata,
  ): Promise<void> {
    const member = await this.resolveMember(accountId);
    const key = idempotencyKey?.trim();
    if (!key || key.length === 0 || key.length > 200) {
      throw qrIdempotencyKeyRequiredError();
    }
    const payload = { reason: input.reason ?? null };
    await this.withIdempotency<{ revoked: true }>(
      member.id,
      'revoke',
      key,
      payload,
      async (tx) => {
        await this.lockMemberRow(tx, member.id);
        const latest = await this.latestQrRow(member.id, tx);
        if (!latest || latest.status === 'ROTATED') throw qrNotFoundError();
        if (latest.status === 'REVOKED') throw qrRevokedError();
        const now = new Date();
        const reason = input.reason?.trim() || REVOKE_DEFAULT_REASON;
        const rows = await tx
          .update(memberQrIdentities)
          .set({
            status: 'REVOKED',
            revokedAt: now,
            reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(memberQrIdentities.id, latest.id),
              eq(memberQrIdentities.status, 'ACTIVE'),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) throw qrStateConflictError();
        await this.writeAudit(
          tx,
          {
            actor: { type: 'ACCOUNT', id: accountId },
            action: 'member.qr.revoked',
            entity: { type: 'member_qr_identity', id: latest.publicQrId },
            before: { public_qr_id: latest.publicQrId, status: 'ACTIVE' },
            after: {
              public_qr_id: latest.publicQrId,
              status: 'REVOKED',
              revoked_at: now.toISOString(),
            },
            reason,
            result: 'SUCCESS',
            summary: `${latest.publicQrId} member QR identity revoked.`,
          },
          metadata,
        );
        return REVOKE_RESPONSE;
      },
    );
  }

  // ---------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------

  private async resolveMember(accountId: string): Promise<{
    id: string;
    status: string;
  }> {
    const rows = await this.database.db
      .select({ id: members.id, status: members.status })
      .from(members)
      .where(eq(members.accountId, accountId))
      .limit(1);
    const member = rows[0];
    if (!member) throw memberNotFoundError();
    if (member.status === 'CLOSED') throw memberClosedError();
    return member;
  }

  private async latestQrRow(
    memberId: string,
    txOrDb?: DatabaseTransaction | DatabaseService['db'],
  ): Promise<QrRow | null> {
    const executor = txOrDb ?? this.database.db;
    const rows = await executor
      .select({
        id: memberQrIdentities.id,
        memberId: memberQrIdentities.memberId,
        publicQrId: memberQrIdentities.publicQrId,
        status: memberQrIdentities.status,
        rotatedFromId: memberQrIdentities.rotatedFromId,
        rotatedToId: memberQrIdentities.rotatedToId,
        issuedAt: memberQrIdentities.issuedAt,
        expiresAt: memberQrIdentities.expiresAt,
        revokedAt: memberQrIdentities.revokedAt,
        reason: memberQrIdentities.reason,
      })
      .from(memberQrIdentities)
      .where(eq(memberQrIdentities.memberId, memberId))
      .orderBy(desc(memberQrIdentities.createdAt), desc(memberQrIdentities.id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      memberId: row.memberId,
      publicQrId: row.publicQrId,
      status: row.status as MemberQrStatus,
      rotatedFromId: row.rotatedFromId,
      rotatedToId: row.rotatedToId,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      reason: row.reason,
    };
  }

  private async lockMemberRow(
    tx: DatabaseTransaction,
    memberId: string,
  ): Promise<void> {
    const result = await tx.execute(
      sql`SELECT id FROM members WHERE id = ${memberId} FOR UPDATE`,
    );
    if (!result.rows[0]) throw memberNotFoundError();
  }

  /**
   * Insert a new ACTIVE QR identity (first issuance or rotation target).
   * When `rotatedFromId` is given the caller has already validated the
   * prior ACTIVE row; the new row links back via rotated_from_id. The
   * partial unique index is the invariant backstop; a 23505 there is
   * mapped to QR_ACTIVE_EXISTS by withIdempotency's error translation.
   */
  private async insertActiveQr(
    tx: DatabaseTransaction,
    memberId: string,
    rotatedFromId: string | null,
  ): Promise<QrRow> {
    const now = new Date();
    const ttlSeconds = resolveMemberQrTtlSeconds();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const publicQrId = this.generatePublicQrId();
    const rawToken = this.generateOpaqueToken();
    const tokenHash = this.hashToken(rawToken);
    // Rotation order matters for the partial unique index
    // (member_qr_identities_active_unique: one ACTIVE per member): the
    // superseded ACTIVE row is flipped to ROTATED BEFORE the new ACTIVE
    // row is inserted, so the index is satisfied at every instant.
    if (rotatedFromId) {
      const superseded = await tx
        .update(memberQrIdentities)
        .set({ status: 'ROTATED', updatedAt: now })
        .where(
          and(
            eq(memberQrIdentities.id, rotatedFromId),
            eq(memberQrIdentities.status, 'ACTIVE'),
          ),
        )
        .returning({ id: memberQrIdentities.id });
      if (!superseded[0]) throw qrStateConflictError();
    }
    const rows = await tx
      .insert(memberQrIdentities)
      .values({
        memberId,
        publicQrId,
        tokenHash,
        status: 'ACTIVE',
        rotatedFromId,
        rotatedToId: null,
        issuedAt: now,
        expiresAt,
        revokedAt: null,
        reason: null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Member QR identity insert returned no row.');
    // Link the superseded row to the new ACTIVE row (chain tail).
    if (rotatedFromId) {
      await tx
        .update(memberQrIdentities)
        .set({ rotatedToId: row.id, updatedAt: now })
        .where(
          and(
            eq(memberQrIdentities.id, rotatedFromId),
            eq(memberQrIdentities.status, 'ROTATED'),
            isNull(memberQrIdentities.rotatedToId),
          ),
        );
    }
    return {
      id: row.id,
      memberId: row.memberId,
      publicQrId: row.publicQrId,
      status: row.status as MemberQrStatus,
      rotatedFromId: row.rotatedFromId,
      rotatedToId: row.rotatedToId,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      reason: row.reason,
    };
  }

  private buildState(row: QrRow): MemberQrResponse['qr'] {
    const secret = resolveMemberQrSigningSecret();
    const expiresAt = row.expiresAt ?? new Date(row.issuedAt.getTime());
    const claims = buildMemberQrTokenClaims(
      row.publicQrId,
      row.issuedAt,
      expiresAt,
    );
    const displayToken = signMemberQrToken(claims, secret);
    return {
      public_qr_id: row.publicQrId,
      status: 'ACTIVE',
      issued_at: row.issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      display_token: displayToken,
    };
  }

  // ---------------------------------------------------------------------
  // Idempotency (frozen generic ledger reuse: auth_idempotency_keys)
  // ---------------------------------------------------------------------

  private async withIdempotency<T>(
    memberId: string,
    operation: 'rotate' | 'revoke',
    key: string,
    payload: unknown,
    handler: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    const scope = `${IDEMPOTENCY_SCOPE_PREFIX}:${operation}:${memberId}`;
    const requestHash = hashJson(payload);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.resolveIdempotencyTtlSeconds() * 1000,
    );
    try {
      return await this.database.db.transaction(async (tx) => {
        // P8-S6 discipline: bounded transaction-engine timeouts on every
        // write boundary (frozen P4-S7 contract values).
        await tx.execute(sql`
          SELECT
            set_config('statement_timeout', '10000ms', true),
            set_config('lock_timeout', '3000ms', true)
        `);
        const existing = await tx
          .select()
          .from(authIdempotencyKeys)
          .where(
            and(
              eq(authIdempotencyKeys.scope, scope),
              eq(authIdempotencyKeys.key, key),
            ),
          )
          .limit(1);
        const record = existing[0];
        if (record) {
          if (record.requestHash !== requestHash || !record.response) {
            throw qrIdempotencyConflictError();
          }
          return record.response as T;
        }
        await tx.insert(authIdempotencyKeys).values({
          scope,
          key,
          requestHash,
          responseHash: null,
          response: null,
          statusCode: null,
          expiresAt,
        });
        const response = await handler(tx);
        await tx
          .update(authIdempotencyKeys)
          .set({
            responseHash: hashJson(response),
            response,
            statusCode: 200,
          })
          .where(
            and(
              eq(authIdempotencyKeys.scope, scope),
              eq(authIdempotencyKeys.key, key),
            ),
          );
        return response;
      });
    } catch (error) {
      if (error instanceof MemberQrError) throw error;
      if (databaseCode(error) !== '23505') throw error;
      if (databaseConstraint(error) === 'member_qr_identities_active_unique') {
        // Race backstop: a concurrent POST inserted an ACTIVE row while
        // this rotation was in flight.
        throw qrActiveExistsError();
      }
      // Likely a raced idempotency-key insert: resolve the winner.
      const winner = await this.database.db
        .select()
        .from(authIdempotencyKeys)
        .where(
          and(
            eq(authIdempotencyKeys.scope, scope),
            eq(authIdempotencyKeys.key, key),
          ),
        )
        .limit(1);
      const record = winner[0];
      if (record?.requestHash === requestHash && record.response) {
        return record.response as T;
      }
      if (record) throw qrIdempotencyConflictError();
      // Unknown unique violation during a QR write: surface as the
      // one-ACTIVE-per-member conflict (contract code).
      throw qrActiveExistsError();
    }
  }

  private resolveIdempotencyTtlSeconds(): number {
    const raw = process.env['AUTH_IDEMPOTENCY_TTL_SECONDS'];
    if (raw === undefined || raw.trim() === '') return 86_400;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return 86_400;
    return parsed;
  }

  // ---------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------

  private async writeAudit(
    tx: DatabaseTransaction,
    input: Parameters<AuditService['appendWithinTransaction']>[1],
    metadata: MemberQrRequestMetadata,
  ): Promise<void> {
    await this.audit.appendWithinTransaction(tx, {
      ...input,
      requestId: metadata.requestId,
      ipAddress: metadata.ipAddress,
    });
  }

  /**
   * Standalone audit for paths that do not open a write transaction
   * (GET reads, rejection outcomes). Never includes token material; a
   * failure to record a rejection audit must not mask the original error.
   */
  private async auditOutcome(
    input: Parameters<AuditService['recordPrivilegedAction']>[0],
    metadata: MemberQrRequestMetadata,
  ): Promise<void> {
    try {
      await this.audit.recordPrivilegedAction({
        ...input,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
      });
    } catch {
      // Audit is best-effort on read/rejection paths; the response must
      // not be replaced by an audit failure.
    }
  }

  // ---------------------------------------------------------------------
  // Token material helpers (never persisted in plaintext)
  // ---------------------------------------------------------------------

  private generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private generatePublicQrId(): string {
    return `qrv1_${randomBytes(12).toString('base64url')}`;
  }
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; cause?: unknown };
  return typeof record.code === 'string'
    ? record.code
    : databaseCode(record.cause);
}

function databaseConstraint(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { constraint?: unknown; cause?: unknown };
  return typeof record.constraint === 'string'
    ? record.constraint
    : databaseConstraint(record.cause);
}
