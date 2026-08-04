import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  markets,
  merchantApiIdempotencyKeys,
  rewardRuleVersions,
} from '@ipoint/database';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AdminRewardService } from '../admin-reward/admin-reward.service.js';
import type { AdminRewardActor } from '../admin-reward/admin-reward.types.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type { CreateRewardRuleDto } from './admin-reward-ops.dto.js';
import {
  rewardActivationNotFutureError,
  rewardEffectiveWindowOverlapError,
  rewardIdempotencyConflictError,
  rewardMarketNotFoundError,
  rewardRateExceedsGovernanceLimitError,
  rewardRateExceedsPackageMaxError,
} from './admin-reward-ops.errors.js';
import {
  REWARD_PACKAGE_REFERENCE_MAX_RATE,
  REWARD_RATE_GOVERNANCE_MAX,
  REWARD_RATE_SCALE,
  REWARD_RULE_SURFACE_NAME_PREFIX,
  REWARD_RULE_SURFACE_NAME_SUFFIX,
  type AdminRewardOpsActor,
  type AdminRewardRuleCreateResponse,
  type AdminRewardRuleListResponse,
  type AdminRewardRuleVersionDto,
  type AdminRewardWindowStatus,
} from './admin-reward-ops.types.js';

/** Advisory-lock namespace for reward configuration serialization. */
const REWARD_CREATE_LOCK_NAMESPACE = 0x5f7_0001n; // arbitrary domain constant

/** Audit action recorded by this adapter for every scheduled version. */
export const ADMIN_REWARD_RULE_VERSION_CREATED =
  'ADMIN_REWARD_RULE_VERSION_CREATED';

/** Idempotency scope namespace (shared mechanism table, owner pattern). */
const REWARD_CREATE_IDEMPOTENCY_SCOPE = 'reward.rule.create';

/**
 * P7-S6B Admin Reward Configuration adapter service.
 *
 * Phase 7 read projection + orchestration over the frozen Phase 3 reward
 * owner (frozen contract §7.1). The single `reward_rule_versions` insert
 * is delegated to the frozen owner command
 * (`AdminRewardService.createRuleVersion`) unchanged — the adapter never
 * mutates domain tables and never duplicates owner formulas.
 *
 * What the adapter adds (all Phase 7 orchestration, none of it inside the
 * frozen owner):
 *
 * 1. §7.1 validation: `%/day` exact-decimal strings, `0%`–`0.05%/day`
 *    governance range (above requires new governance), at most six input
 *    decimals, and per-package maxima (A `0.0125`, B `0.025`, C/D/E/F
 *    `0.05`).
 * 2. Activation only at a strictly future market-local `00:00`, resolved
 *    to the exact UTC instant in the market's IANA timezone.
 * 3. No-overlap enforcement (chain semantics): effective starts are
 *    strictly increasing per market scope, so two versions never share an
 *    effective day and the frozen settlement resolution (latest
 *    effective_from wins) stays deterministic. Serialized with a
 *    session-level PostgreSQL advisory lock (frozen contract §14
 *    "advisory-lock boundary" — pre-check alone is insufficient).
 * 4. Exact idempotency: the operation claims the client `Idempotency-Key`
 *    with the canonical payload hash in the shared idempotency mechanism
 *    table (`merchant_api_idempotency_keys`, unique `(scope, key)` — the
 *    exact pattern the frozen Phase 1 package owner uses). Same key + same
 *    payload replays the original result; same key + different payload is
 *    rejected with 409.
 * 5. Mandatory reason + privileged audit (frozen contract §7/§15): the
 *    operator's reason is required and recorded in the canonical audit
 *    trail on every successful create.
 *
 * The market is the server-owned Current Admin Market (canonical RbacGuard
 * `marketScoped` + `MARKET_CONTEXT_MISMATCH` on any client disagreement).
 */
@Injectable()
export class AdminRewardOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminRewardService) private readonly owner: AdminRewardService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ─── Read projection ──────────────────────────────────────────────

  /**
   * Selected-market reward schedule: all rule versions for the market with
   * the §7.1 package references and the projected effective windows.
   *
   * The effective window of each market-scoped version is
   * `[effective_from, window_end)` where `window_end` is the earlier of the
   * next version's `effective_from` and an explicit `effective_to` — the
   * frozen settlement resolves exactly one effective version per
   * market-local day (latest effective_from wins inside the window), so the
   * projected windows never overlap and nothing historical is ever
   * recalculated. Versions created through this surface always have
   * `effective_to = null`, so their windows are pure chain steps.
   */
  async listRules(marketId: string): Promise<AdminRewardRuleListResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw rewardMarketNotFoundError();

    const rows = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.marketId, marketId))
      .orderBy(
        desc(rewardRuleVersions.effectiveFrom),
        desc(rewardRuleVersions.createdAt),
      );

    // Chain semantics matching the frozen settlement resolution
    // (`RewardService.findEffectiveRuleVersion`): a version is effective for
    // `[effective_from, effective_to)` when `effective_to` is set, else
    // open-ended; the non-archived version with the latest `effective_from`
    // inside that window wins. For versions created through this surface
    // (`effective_to` always null, strictly increasing `effective_from` per
    // market) the projected window is exactly `[effective_from, next
    // effective_from)`; for legacy owner-created rows with an explicit
    // `effective_to`, the projected window ends at the earlier of the
    // explicit end and the next version's start (frozen resolution wins).
    const nonArchived = rows
      .filter((row) => row.archivedAt === null)
      .sort(
        (left, right) =>
          left.effectiveFrom.getTime() - right.effectiveFrom.getTime(),
      );
    const now = Date.now();

    const rules: AdminRewardRuleVersionDto[] = rows.map((row) => {
      const archived = row.archivedAt !== null;
      const chainIndex = archived
        ? -1
        : nonArchived.findIndex((candidate) => candidate.id === row.id);
      const chainNext =
        chainIndex >= 0 ? nonArchived[chainIndex + 1] : undefined;
      const explicitEndMs = row.effectiveTo ? row.effectiveTo.getTime() : null;
      // A version is superseded by the next chain step only when the next
      // version starts before the explicit window end (frozen resolution:
      // latest effective_from inside the window wins). When the explicit end
      // is earlier or equal, the window closes on its own.
      const supersededByNext =
        chainNext !== undefined &&
        (explicitEndMs === null ||
          chainNext.effectiveFrom.getTime() < explicitEndMs);
      const windowEnd = supersededByNext
        ? chainNext.effectiveFrom
        : explicitEndMs !== null
          ? row.effectiveTo
          : null;
      const effectiveFromLocal = localWallString(
        row.effectiveFrom,
        market.timezone,
      );
      let windowStatus: AdminRewardWindowStatus;
      if (archived) windowStatus = 'ARCHIVED';
      else if (supersededByNext) windowStatus = 'SUPERSEDED';
      else if (windowEnd !== null && now >= windowEnd.getTime())
        windowStatus = 'EXPIRED';
      else if (row.effectiveFrom.getTime() > now) windowStatus = 'SCHEDULED';
      else windowStatus = 'ACTIVE';

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        reward_rate: normalizeRateString(String(row.rewardRate)),
        cap_type: row.capType,
        cap_value: String(row.capValue),
        minimum_reward: String(row.minimumReward),
        package_reference: derivePackageReference(row.name),
        effective_from_utc: row.effectiveFrom.toISOString(),
        effective_from_local: effectiveFromLocal,
        effective_until_utc: windowEnd ? windowEnd.toISOString() : null,
        effective_until_local: windowEnd
          ? localWallString(windowEnd, market.timezone)
          : null,
        timezone: market.timezone,
        window_status: windowStatus,
        market_id: row.marketId,
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
      };
    });

    return {
      marketId,
      timezone: market.timezone,
      packages: Object.entries(REWARD_PACKAGE_REFERENCE_MAX_RATE).map(
        ([code, maxRatePerDay]) => ({ code, max_rate_per_day: maxRatePerDay }),
      ),
      rules,
    };
  }

  // ─── Orchestrated create (frozen owner command) ───────────────────

  /**
   * Schedule a new reward rule version for the selected market.
   *
   * Validates the §7.1 rate contract and the future market-local 00:00
   * activation, then claims the client Idempotency-Key with the canonical
   * payload hash (unique `(scope, key)` mechanism row) and delegates the
   * insert to the frozen Phase 3 owner command. Overlap is serialized with
   * a market-scoped advisory lock so a concurrent race resolves to exactly
   * one success and one stable conflict (frozen contract §14).
   */
  async createRule(
    actor: AdminRewardOpsActor,
    marketId: string,
    input: CreateRewardRuleDto,
    idempotencyKey: string,
  ): Promise<AdminRewardRuleCreateResponse> {
    // §7.1 rate validation first (pure exact-decimal checks — no DB).
    const rateScaled = scaledDecimal(input.rate);
    if (rateScaled > scaledDecimal(REWARD_RATE_GOVERNANCE_MAX)) {
      throw rewardRateExceedsGovernanceLimitError();
    }
    const packageMax =
      REWARD_PACKAGE_REFERENCE_MAX_RATE[input.package_reference] ?? '0';
    if (rateScaled > scaledDecimal(packageMax)) {
      throw rewardRateExceedsPackageMaxError(
        input.package_reference,
        packageMax,
      );
    }

    const market = await this.marketRow(marketId);
    if (!market) throw rewardMarketNotFoundError();

    // Activation only at a strictly future market-local 00:00.
    const effectiveFrom = resolveLocalMidnight(
      input.effective_date,
      market.timezone,
    );
    if (!effectiveFrom || effectiveFrom.getTime() <= Date.now()) {
      throw rewardActivationNotFutureError();
    }

    const payloadHash = canonicalPayloadHash({
      package_reference: input.package_reference,
      rate: input.rate,
      effective_date: input.effective_date,
      reason: input.reason,
      description: input.description ?? null,
    });

    const scope = `${REWARD_CREATE_IDEMPOTENCY_SCOPE}:${marketId}:${actor.adminUserId}`;
    const lockKey = rewardCreateLockKey(marketId);

    const client = await this.database.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockKey]);

      // Claim the key + overlap pre-check atomically. On conflict the row
      // already exists (replay path); on pre-check failure the throw rolls
      // the claim back so the same key can be retried after correction.
      const claimedId = await this.database.db.transaction(async (tx) => {
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
        if (claimed.length === 0) return null;

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
          throw rewardEffectiveWindowOverlapError();
        }
        return claimed[0]?.id ?? null;
      });

      if (claimedId === null) {
        const existing = await this.database.db
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
        if (!row || row.response === null || row.requestHash !== payloadHash) {
          throw rewardIdempotencyConflictError();
        }
        return row.response as unknown as AdminRewardRuleCreateResponse;
      }

      // Delegate the single domain insert to the frozen Phase 3 owner
      // command (unchanged). The owner commits its own insert + audit
      // atomically; the claim is rolled back if the owner rejects.
      let version: {
        id: string;
        rewardRate: string;
        createdAt: string;
      };
      try {
        version = await this.owner.createRuleVersion(this.ownerActor(actor), {
          name: `${REWARD_RULE_SURFACE_NAME_PREFIX}${input.package_reference}${REWARD_RULE_SURFACE_NAME_SUFFIX}`,
          description: input.description ?? undefined,
          effectiveFrom: effectiveFrom.toISOString(),
          rewardRate: input.rate,
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
          marketId,
        });
      } catch (error) {
        await this.database.db
          .delete(merchantApiIdempotencyKeys)
          .where(
            and(
              eq(merchantApiIdempotencyKeys.id, claimedId),
              isNull(merchantApiIdempotencyKeys.response),
            ),
          );
        throw error;
      }

      const response: AdminRewardRuleCreateResponse = {
        id: version.id,
        package_reference: input.package_reference,
        reward_rate: normalizeRateString(input.rate),
        effective_date: input.effective_date,
        effective_from_utc: effectiveFrom.toISOString(),
        effective_from_local: localWallString(effectiveFrom, market.timezone),
        timezone: market.timezone,
        market_id: marketId,
        created_by: actor.adminUserId,
        created_at: version.createdAt,
      };

      // Persist the original result for exact replay.
      await this.database.db
        .update(merchantApiIdempotencyKeys)
        .set({ response, statusCode: 201, updatedAt: new Date() })
        .where(eq(merchantApiIdempotencyKeys.id, claimedId));

      // Privileged audit with the mandatory reason (frozen contract §7/§15).
      await this.audit.recordPrivilegedAction({
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: ADMIN_REWARD_RULE_VERSION_CREATED,
        entity: { type: 'reward_rule_version', id: version.id },
        marketId,
        after: {
          payload_hash: payloadHash,
          version_id: version.id,
          package_reference: input.package_reference,
          rate: input.rate,
          effective_date: input.effective_date,
          effective_from_utc: response.effective_from_utc,
        },
        reason: input.reason,
        result: 'SUCCESS',
        requestId: idempotencyKey,
        ipAddress: actor.ipAddress,
        summary: `Administrator scheduled a ${input.rate}%/day reward rate for package ${input.package_reference}, effective ${input.effective_date} market-local 00:00 (${response.effective_from_utc}).`,
      });

      return response;
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      } finally {
        client.release();
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async marketRow(
    marketId: string,
  ): Promise<{ id: string; timezone: string } | undefined> {
    const rows = await this.database.db
      .select({ id: markets.id, timezone: markets.timezone })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    return rows[0];
  }

  private ownerActor(actor: AdminRewardOpsActor): AdminRewardActor {
    return {
      adminUserId: actor.adminUserId,
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
    };
  }
}

// ─── Exact-decimal helpers (string only — never float arithmetic) ──

/**
 * Scale a `%/day` decimal string to 10^6 integer units.
 *
 * Exported for direct unit testing of the §7.1 boundary math; not part of
 * the adapter's public surface.
 */
export function scaledDecimal(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return (
    BigInt(whole) * BigInt(REWARD_RATE_SCALE) +
    BigInt(fraction.padEnd(6, '0') || '0')
  );
}

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
 * Canonical payload hash (sorted keys + sha256 — owner pattern).
 *
 * Exported for direct unit testing of the idempotency correlation; not
 * part of the adapter's public surface.
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

/** Market-scoped advisory lock key (FNV-1a over a domain namespace). */
function rewardCreateLockKey(marketId: string): bigint {
  const input = `p7s6b:reward-rule-create:${marketId}`;
  let hash = REWARD_CREATE_LOCK_NAMESPACE;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * BigInt(1099511628211)) & BigInt('0xFFFFFFFFFFFFFFFF');
  }
  return hash & BigInt('0x7FFFFFFFFFFFFFFF');
}

/**
 * Resolve the UTC instant of the market-local midnight of a calendar date.
 * Returns `null` when the zone's wall clock does not land exactly on
 * 00:00:00 for that date (DST edge) — the caller rejects such dates.
 *
 * Exported for direct unit testing of the market-local/UTC resolution;
 * not part of the adapter's public surface.
 */
export function resolveLocalMidnight(
  dateStr: string,
  timeZone: string,
): Date | null {
  const dateParts = dateStr.split('-').map((value) => Number(value));
  const year = dateParts[0] ?? 0;
  const month = dateParts[1] ?? 0;
  const day = dateParts[2] ?? 0;
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
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
    wall.year !== year ||
    wall.month !== month ||
    wall.day !== day ||
    wall.hour !== 0 ||
    wall.minute !== 0 ||
    wall.second !== 0
  ) {
    return null;
  }
  return midnight;
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
 *
 * Exported for direct unit testing of the local-time rendering; not part
 * of the adapter's public surface.
 */
export function localWallString(at: Date, timeZone: string): string {
  const parts = localParts(at, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
}

/**
 * Derive the §7.1 package reference from the deterministic surface name.
 *
 * Exported for direct unit testing; not part of the adapter's public
 * surface.
 */
export function derivePackageReference(name: string): string | null {
  if (!name.startsWith(REWARD_RULE_SURFACE_NAME_PREFIX)) return null;
  if (!name.endsWith(REWARD_RULE_SURFACE_NAME_SUFFIX)) return null;
  const code = name.slice(
    REWARD_RULE_SURFACE_NAME_PREFIX.length,
    name.length - REWARD_RULE_SURFACE_NAME_SUFFIX.length,
  );
  return /^[A-F]$/u.test(code) ? code : null;
}
