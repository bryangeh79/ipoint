import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  adminUsers,
  marketAccess,
  markets,
  merchantApiIdempotencyKeys,
  rewardRuleVersions,
  type Database,
} from '@ipoint/database';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { RbacService } from '../platform-access/rbac.service.js';
import type { RuleListQueryDto, JobListQueryDto } from './admin-reward.dto.js';
import {
  adminRewardActivationNotFutureError,
  adminRewardEffectiveWindowOverlapError,
  adminRewardIdempotencyConflictError,
  adminRewardIdempotencyKeyRequiredError,
  adminRewardJobNotFoundError,
  adminRewardMarketAccessDeniedError,
  adminRewardMarketContextMismatchError,
  adminRewardMarketNotFoundError,
  adminRewardMarketSelectionRequiredError,
  adminRewardPermissionDeniedError,
  adminRewardRateExceedsGovernanceLimitError,
  adminRewardRatePrecisionError,
  adminRewardReasonRequiredError,
  adminRewardRuleVersionNotFoundError,
} from './admin-reward.errors.js';
import type {
  AdminRewardActor,
  AdminRewardJobRunDetailResponse,
  AdminRewardJobRunListResponse,
  AdminRewardRuleVersionCreateResponse,
  AdminRewardRuleVersionDetailResponse,
  AdminRewardRuleVersionListItem,
  AdminRewardRuleVersionListResponse,
  AdminRewardVersionHistoryResponse,
  CreateRuleVersionCommand,
} from './admin-reward.types.js';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

/**
 * §7.1 governance ceiling: 0.05 %/day.
 */
export const REWARD_RATE_GOVERNANCE_MAX = '0.05';

/**
 * §7.1 input precision: at most six decimals.
 */
export const REWARD_RATE_SCALE = 1_000_000n;

/**
 * Idempotency scope namespace for the OWNER command (shared mechanism
 * table, unique (scope, key)).
 */
const REWARD_OWNER_IDEMPOTENCY_SCOPE = 'reward.rule.owner.create';

/** Advisory-lock namespace for the owner reward-rule serialization. */
const REWARD_OWNER_LOCK_NAMESPACE = 0x5f7_0002n; // owner domain constant

@Injectable()
export class AdminRewardService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ─── Rule Versions ─────────────────────────────────────────────────

  async listRuleVersions(
    adminActor: AdminRewardActor,
    query: RuleListQueryDto,
  ): Promise<AdminRewardRuleVersionListResponse> {
    const conditions = this.ruleVersionConditions(query);

    const totalResult = await this.database.db
      .select({ total: count() })
      .from(rewardRuleVersions)
      .where(conditions);

    const total = Number(totalResult[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(conditions)
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    return {
      items: rows.map((r) => this.mapRuleVersionListItem(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getRuleVersion(
    adminActor: AdminRewardActor,
    id: string,
  ): Promise<AdminRewardRuleVersionDetailResponse> {
    const [row] = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.id, id))
      .limit(1);

    if (!row) throw adminRewardRuleVersionNotFoundError();

    // Load version history (all versions for the same name/scope)
    const versions = await this.database.db
      .select({
        id: rewardRuleVersions.id,
        name: rewardRuleVersions.name,
        rewardRate: rewardRuleVersions.rewardRate,
        effectiveFrom: rewardRuleVersions.effectiveFrom,
        effectiveTo: rewardRuleVersions.effectiveTo,
        marketId: rewardRuleVersions.marketId,
        isArchived:
          sql`CASE WHEN ${rewardRuleVersions.archivedAt} IS NULL THEN false ELSE true END`.mapWith(
            Number,
          ),
        createdAt: rewardRuleVersions.createdAt,
      })
      .from(rewardRuleVersions)
      .where(
        and(
          eq(rewardRuleVersions.name, row.name),
          row.marketId
            ? eq(rewardRuleVersions.marketId, row.marketId)
            : isNull(rewardRuleVersions.marketId),
        ),
      )
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(50);

    return {
      ...this.mapRuleVersionListItem(row),
      versionHistory: versions.map((v) => ({
        id: v.id,
        name: v.name,
        rewardRate: String(v.rewardRate),
        effectiveFrom: v.effectiveFrom.toISOString(),
        effectiveTo: v.effectiveTo?.toISOString() ?? null,
        marketId: v.marketId,
        isArchived: Boolean(v.isArchived),
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Secured Phase 3 reward-rule owner command (D-052/D-050).
   *
   * Every control lives HERE — in the owner command layer — so the
   * canonical route AND any in-process caller (Phase 7 adapter) get
   * identical enforcement and the original unsafe raw-insert path no
   * longer exists:
   *
   * 1. Reward configuration permission `reward.rule.schedule` (canonical
   *    catalog, SUPER_ADMIN only) re-checked server-side.
   * 2. Admin identity validation (authenticated ADMIN_USER actor, ACTIVE
   *    admin + account).
   * 3. Selected-market enforcement: a server Current Admin Market is
   *    required and the target market must be granted.
   * 4. Resource-market consistency: body market must equal the server
   *    Current Admin Market (MARKET_CONTEXT_MISMATCH otherwise).
   * 5. Exact 0%–0.05%/day validation with BigInt decimal math.
   * 6. Six-decimal precision (more rejected).
   * 7. Future market-local 00:00 activation ONLY (IANA market timezone;
   *    same-day/backdated and DST-edge rejected).
   * 8. Resolved UTC timestamp returned alongside market-local.
   * 9. Append-only versions (no update/delete of published versions).
   * 10. No overlapping effective ranges (strictly increasing
   *     effective_from per market scope).
   * 11. Transaction-safe concurrency (market-scoped advisory lock;
   *     exactly one winner under race).
   * 12. Mandatory reason (blank/overlength rejected).
   * 13. Durable reason storage on the version row (migration 0030).
   * 14. Atomic immutable audit (owner write + audit in one transaction;
   *     authenticated actor, market, reason, request id).
   * 15. Operation-scoped idempotency (Idempotency-Key mandatory; unique
   *     (scope, key) mechanism row).
   * 16. Canonical payload hash (sorted keys + sha256).
   * 17. Same-key/different-payload rejection (409).
   * 18. No historical reward recalculation (existing rules and issued
   *     rewards are never touched).
   */
  async createRuleVersion(
    adminActor: AdminRewardActor,
    input: CreateRuleVersionCommand,
  ): Promise<AdminRewardRuleVersionCreateResponse> {
    // ── 1+2. Identity + permission (server-side, in-process-safe) ────
    if (!adminActor?.adminUserId) throw adminRewardPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: adminActor.adminUserId,
      permission: 'reward.rule.schedule',
    });
    if (!allowed) throw adminRewardPermissionDeniedError();

    // ── 12. Mandatory reason (blank/overlength rejected) ─────────────
    const reason = input.reason?.trim() ?? '';
    if (!reason || reason.length > 500) throw adminRewardReasonRequiredError();

    // ── 15. Operation-scoped idempotency key (mandatory) ─────────────
    const idempotencyKey = input.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw adminRewardIdempotencyKeyRequiredError();
    }

    // ── 3+4. Selected-market + resource-market consistency ───────────
    const marketId = input.marketId;
    if (!marketId) throw adminRewardMarketSelectionRequiredError();
    if (!adminActor.currentMarketId) {
      throw adminRewardMarketSelectionRequiredError();
    }
    if (adminActor.currentMarketId !== marketId) {
      throw adminRewardMarketContextMismatchError();
    }
    await this.assertMarketAccess(
      this.database.db,
      adminActor.adminUserId,
      marketId,
    );
    const market = await this.marketRow(marketId);
    if (!market) throw adminRewardMarketNotFoundError();

    // ── 5+6. Exact 0%–0.05%/day, ≤6 decimals (BigInt only) ───────────
    const rateScaled = scaledDecimal(input.rewardRate); // throws on precision
    if (rateScaled > scaledDecimal(REWARD_RATE_GOVERNANCE_MAX)) {
      throw adminRewardRateExceedsGovernanceLimitError();
    }

    // ── 7+8. Future market-local 00:00 activation ONLY ───────────────
    const effectiveFrom = new Date(input.effectiveFrom);
    if (
      Number.isNaN(effectiveFrom.getTime()) ||
      !isMarketLocalMidnight(effectiveFrom, market.timezone) ||
      effectiveFrom.getTime() <= Date.now()
    ) {
      throw adminRewardActivationNotFutureError();
    }

    // ── 16. Canonical payload hash (sorted keys + sha256) ────────────
    const payloadHash = canonicalPayloadHash({
      name: input.name,
      description: input.description ?? null,
      effectiveFrom: effectiveFrom.toISOString(),
      rewardRate: input.rewardRate,
      capType: input.capType,
      capValue: input.capValue,
      minimumReward: input.minimumReward,
      marketId,
      reason,
    });

    const scope = `${REWARD_OWNER_IDEMPOTENCY_SCOPE}:${marketId}:${adminActor.adminUserId}`;
    const lockKey = rewardOwnerLockKey(marketId);

    // ── 9/10/11/14/15/17: atomic create with lock, overlap, audit ────
    return this.database.runTransaction(async (tx) => {
      // 11. Serialize the whole operation per market scope. The lock is
      // transaction-scoped: it auto-releases at commit/rollback, so a
      // losing concurrent command waits, then observes the winner's row
      // and returns a stable conflict (frozen contract §14).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      // 15. Claim the operation key. On conflict the row already exists
      // (replay path); on any later throw the claim rolls back with the
      // transaction so the same key can be retried after correction.
      const claimed = await tx
        .insert(merchantApiIdempotencyKeys)
        .values({ scope, key: idempotencyKey, requestHash: payloadHash })
        .onConflictDoNothing({
          target: [
            merchantApiIdempotencyKeys.scope,
            merchantApiIdempotencyKeys.key,
          ],
        })
        .returning({ id: merchantApiIdempotencyKeys.id });

      if (claimed.length === 0) {
        const existing = await tx
          .select()
          .from(merchantApiIdempotencyKeys)
          .where(
            and(
              eq(merchantApiIdempotencyKeys.scope, scope),
              eq(merchantApiIdempotencyKeys.key, idempotencyKey),
            ),
          )
          .limit(1);
        const row = existing[0];
        // 17. Same key + different payload → conflict; otherwise replay
        // the original result exactly.
        if (!row || row.response === null || row.requestHash !== payloadHash) {
          throw adminRewardIdempotencyConflictError();
        }
        return row.response as unknown as AdminRewardRuleVersionCreateResponse;
      }

      // 10. Overlap: effective starts are strictly increasing per market
      // scope (non-archived rows). Pre-check inside the advisory lock —
      // pre-check alone is never sufficient, which is why the lock is
      // held.
      const latest = await tx
        .select({ effectiveFrom: rewardRuleVersions.effectiveFrom })
        .from(rewardRuleVersions)
        .where(
          and(
            eq(rewardRuleVersions.marketId, marketId),
            isNull(rewardRuleVersions.archivedAt),
          ),
        )
        .orderBy(desc(rewardRuleVersions.effectiveFrom))
        .limit(1);
      if (
        latest[0] &&
        latest[0].effectiveFrom.getTime() >= effectiveFrom.getTime()
      ) {
        throw adminRewardEffectiveWindowOverlapError();
      }

      // 9/13. Append-only insert with the durable reason (migration 0030).
      const [version] = await tx
        .insert(rewardRuleVersions)
        .values({
          name: input.name,
          description: input.description ?? null,
          effectiveFrom,
          effectiveTo: null,
          rewardRate: input.rewardRate,
          capType: input.capType,
          capValue: input.capValue,
          minimumReward: input.minimumReward,
          marketId,
          createdBy: adminActor.adminUserId,
          reason,
          archivedAt: null,
        })
        .returning();

      if (!version) {
        throw new Error('Failed to create reward rule version');
      }

      // 14. Atomic immutable audit — same transaction as the insert.
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: adminActor.adminUserId },
        action: 'reward.rule_version.create',
        entity: { type: 'reward_rule_version', id: version.id },
        marketId,
        after: this.sanitizeForAudit({
          name: version.name,
          rewardRate: version.rewardRate,
          capType: version.capType,
          capValue: version.capValue,
          effectiveFrom: version.effectiveFrom.toISOString(),
          payloadHash,
        }),
        reason,
        result: 'SUCCESS',
        requestId: adminActor.requestId ?? idempotencyKey,
        ipAddress: adminActor.ipAddress,
        summary: `Administrator created reward rule version "${version.name}" at ${effectiveFrom.toISOString()} (${localWallString(effectiveFrom, market.timezone)} market-local).`,
      });

      const response: AdminRewardRuleVersionCreateResponse = {
        id: version.id,
        name: version.name,
        rewardRate: normalizeRateString(version.rewardRate),
        effectiveFrom: version.effectiveFrom.toISOString(),
        effectiveFromLocal: localWallString(
          version.effectiveFrom,
          market.timezone,
        ),
        timezone: market.timezone,
        marketId: version.marketId ?? marketId,
        reason: version.reason,
        createdBy: version.createdBy,
        createdAt: version.createdAt.toISOString(),
      };

      // 15. Persist the original result for exact replay.
      await tx
        .update(merchantApiIdempotencyKeys)
        .set({ response, statusCode: 201, updatedAt: new Date() })
        .where(eq(merchantApiIdempotencyKeys.id, claimed[0]?.id ?? ''));

      return response;
    });
  }

  async getRuleVersionHistory(
    adminActor: AdminRewardActor,
    id: string,
  ): Promise<AdminRewardVersionHistoryResponse> {
    const [row] = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.id, id))
      .limit(1);

    if (!row) throw adminRewardRuleVersionNotFoundError();

    // Load all versions with the same name scope (same name + same marketId scope)
    const versions = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(
        and(
          eq(rewardRuleVersions.name, row.name),
          row.marketId
            ? eq(rewardRuleVersions.marketId, row.marketId)
            : isNull(rewardRuleVersions.marketId),
        ),
      )
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(100);

    const total = versions.length;

    return {
      versions: versions.map((v) => ({
        id: v.id,
        name: v.name,
        rewardRate: v.rewardRate,
        effectiveFrom: v.effectiveFrom.toISOString(),
        effectiveTo: v.effectiveTo?.toISOString() ?? null,
        marketId: v.marketId,
        isArchived: v.archivedAt !== null,
        createdAt: v.createdAt.toISOString(),
      })),
      total,
    };
  }

  // ─── Job Run Monitoring ────────────────────────────────────────────

  async listJobRuns(
    adminActor: AdminRewardActor,
    query: JobListQueryDto,
  ): Promise<AdminRewardJobRunListResponse> {
    // Job runs are stored in a job_runs table or similar.
    // For Phase 3, we use a placeholder implementation that returns
    // sample data from reward rule version audit trail as a proxy.
    const conditions = and(
      query.jobType ? eq(rewardRuleVersions.name, query.jobType) : undefined,
    );

    const totalResult = await this.database.db
      .select({ total: count() })
      .from(rewardRuleVersions)
      .where(conditions);

    const total = Number(totalResult[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(conditions)
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        jobType: 'REWARD_PLAN_PROCESSING',
        status: 'COMPLETED' as const,
        startedAt: r.createdAt.toISOString(),
        completedAt: r.createdAt.toISOString(),
        processedCount: 0,
        failedCount: 0,
        errorMessage: null,
        triggeredBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getJobRunDetail(
    adminActor: AdminRewardActor,
    id: string,
  ): Promise<AdminRewardJobRunDetailResponse> {
    // Placeholder implementation — actual job run data would come from
    // a dedicated job_runs table in a future phase.
    const [row] = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.id, id))
      .limit(1);

    if (!row) throw adminRewardJobNotFoundError();

    return {
      id: row.id,
      jobType: 'REWARD_PLAN_PROCESSING',
      status: 'COMPLETED',
      startedAt: row.createdAt.toISOString(),
      completedAt: row.createdAt.toISOString(),
      processedCount: 0,
      failedCount: 0,
      errorMessage: null,
      triggeredBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      results: [],
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private ruleVersionConditions(query: RuleListQueryDto) {
    return and(
      query.includeArchived ? undefined : isNull(rewardRuleVersions.archivedAt),
      query.marketId
        ? eq(rewardRuleVersions.marketId, query.marketId)
        : undefined,
    );
  }

  private async marketRow(
    marketId: string,
  ): Promise<{ id: string; timezone: string } | undefined> {
    const rows = await this.database.db
      .select({ id: markets.id, timezone: markets.timezone })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.status, 'ACTIVE')))
      .limit(1);
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
    if (!rows[0]) throw adminRewardMarketAccessDeniedError();
  }

  private mapRuleVersionListItem(
    row: typeof rewardRuleVersions.$inferSelect,
  ): AdminRewardRuleVersionListItem {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      reason: row.reason,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      rewardRate: row.rewardRate,
      capType: row.capType,
      capValue: row.capValue,
      minimumReward: row.minimumReward,
      marketId: row.marketId,
      createdBy: row.createdBy,
      isArchived: row.archivedAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private sanitizeForAudit(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
    );
  }
}

// ─── Exact-decimal helpers (string only — never float arithmetic) ───

/**
 * Trim a stored exact-decimal rate to its significant digits for display
 * (string-only formatting — no arithmetic). Storage keeps `numeric(38,10)`;
 * the §7.1 display convention is `%/day` with at most six decimals.
 */
export function normalizeRateString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) return trimmed;
  const [whole = '0', fraction] = trimmed.split('.');
  const significant = (fraction ?? '').replace(/0+$/u, '');
  return significant === '' ? whole : `${whole}.${significant}`;
}

/**
 * Scale a `%/day` decimal string to 10^6 integer units (BigInt).
 *
 * Rejects anything outside the §7.1 grammar: negative values, missing
 * digits, or more than six decimals.
 */
export function scaledDecimal(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/u.exec(value.trim());
  if (!match) throw adminRewardRatePrecisionError();
  const whole = BigInt(match[1] ?? '0');
  const fraction = (match[2] ?? '').padEnd(6, '0') || '0';
  return whole * REWARD_RATE_SCALE + BigInt(fraction);
}

// ─── Market-local midnight resolution (IANA timezone) ───────────────

/**
 * Resolve the UTC instant of the market-local midnight of a calendar date
 * in the given IANA timezone. Returns `null` when no unambiguous 00:00:00
 * wall time exists for that date (skipped DST midnights such as
 * America/Havana spring-forward, or when every candidate offset fails the
 * wall-clock round-trip).
 *
 * Multiple probes across the UTC day are used so a transition that lands
 * between 00:00 and 12:00 local (e.g. US DST start at 02:00) can never
 * hide the pre-transition midnight: the offset observed by at least one
 * probe matches the offset in force at the date's own 00:00.
 */
export function resolveLocalMidnight(
  dateStr: string,
  timeZone: string,
): Date | null {
  const dateParts = dateStr.split('-').map((value) => Number(value));
  const year = dateParts[0] ?? 0;
  const month = dateParts[1] ?? 0;
  const day = dateParts[2] ?? 0;
  const candidates: number[] = [];
  for (const hour of [0, 6, 12, 18]) {
    const probe = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));
    const probeParts = localParts(probe, timeZone);
    const localAsUtc = Date.UTC(
      probeParts.year,
      probeParts.month - 1,
      probeParts.day,
      probeParts.hour,
      probeParts.minute,
      probeParts.second,
    );
    const offsetMs = localAsUtc - probe.getTime();
    const midnight = new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs,
    );
    const wall = localParts(midnight, timeZone);
    if (
      wall.year === year &&
      wall.month === month &&
      wall.day === day &&
      wall.hour === 0 &&
      wall.minute === 0 &&
      wall.second === 0
    ) {
      candidates.push(midnight.getTime());
    }
  }
  if (candidates.length === 0) return null;
  const distinct = [...new Set(candidates)];
  if (distinct.length !== 1) return null;
  return new Date(distinct[0] ?? 0);
}

/**
 * True when the given instant is exactly the market-local 00:00:00 of its
 * own local date in the market timezone (round-trip against
 * `resolveLocalMidnight` so DST edges — skipped or ambiguous midnights —
 * are rejected).
 */
export function isMarketLocalMidnight(at: Date, timeZone: string): boolean {
  if (Number.isNaN(at.getTime())) return false;
  const wall = localParts(at, timeZone);
  if (wall.hour !== 0 || wall.minute !== 0 || wall.second !== 0) return false;
  const dateStr = `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  const resolved = resolveLocalMidnight(dateStr, timeZone);
  return resolved !== null && resolved.getTime() === at.getTime();
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(at: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = new Map(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.get('year') ?? '0'),
    month: Number(map.get('month') ?? '0'),
    day: Number(map.get('day') ?? '0'),
    hour: Number(map.get('hour') ?? '0'),
    minute: Number(map.get('minute') ?? '0'),
    second: Number(map.get('second') ?? '0'),
  };
}

/**
 * Market-local wall clock "YYYY-MM-DD HH:mm:ss" for display.
 */
export function localWallString(at: Date, timeZone: string): string {
  const parts = localParts(at, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
}

// ─── Canonical payload hash (sorted keys + sha256) ──────────────────

/**
 * Canonical payload hash for idempotency correlation (owner pattern):
 * keys sorted recursively, then sha256 hex.
 */
export function canonicalPayloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(sortJson(payload)))
    .digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

// ─── Owner advisory-lock key ────────────────────────────────────────

/** Market-scoped advisory lock key (FNV-1a over the owner namespace). */
export function rewardOwnerLockKey(marketId: string): bigint {
  const input = `p3d050:reward-rule-create:${marketId}`;
  let hash = REWARD_OWNER_LOCK_NAMESPACE;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * BigInt(1099511628211)) & BigInt('0xFFFFFFFFFFFFFFFF');
  }
  return hash & BigInt('0x7FFFFFFFFFFFFFFF');
}
