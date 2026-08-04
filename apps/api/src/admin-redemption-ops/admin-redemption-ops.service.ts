import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  markets,
  merchantApiIdempotencyKeys,
  redemptionRateVersions,
} from '@ipoint/database';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { RedemptionService } from '../redemption/redemption.service.js';
import { RedemptionError } from '../redemption/redemption.errors.js';
import type { RedemptionAdminActor } from '../redemption/redemption.types.js';
import type { CreateRedemptionRateDto } from './admin-redemption-ops.dto.js';
import {
  redemptionActivationNotFutureError,
  redemptionIdempotencyConflictError,
  redemptionMarketNotFoundError,
  redemptionRateAboveMaximumError,
  redemptionRateBelowMinimumError,
  redemptionRateMarketBlockedError,
  redemptionRateOverlapError,
} from './admin-redemption-ops.errors.js';
import {
  REDEMPTION_RATE_DISPLAY_DECIMALS,
  REDEMPTION_RATE_MARKET_RULES,
  REDEMPTION_RATE_RULES_PROVIDER,
  REDEMPTION_RATE_SCALE,
  REDEMPTION_RATE_TECHNICAL_DECIMALS,
  REDEMPTION_RATE_TYPE,
  type AdminRedemptionOpsActor,
  type AdminRedemptionRateConfigDto,
  type AdminRedemptionRateCreateResponse,
  type AdminRedemptionRateListResponse,
  type AdminRedemptionRateVersionDto,
  type AdminRedemptionRateWindowStatus,
  type RedemptionRateMarketRulesMap,
} from './admin-redemption-ops.types.js';

/** Advisory-lock namespace for redemption configuration serialization. */
const REDEMPTION_CREATE_LOCK_NAMESPACE = 0x5f7_0002n; // arbitrary domain constant

/** Audit action recorded by this adapter for every scheduled version. */
export const ADMIN_REDEMPTION_RATE_VERSION_CREATED =
  'ADMIN_REDEMPTION_RATE_VERSION_CREATED';

/** Idempotency scope namespace (shared mechanism table, owner pattern). */
const REDEMPTION_CREATE_IDEMPOTENCY_SCOPE = 'redemption.rate.create';

/**
 * P7-S6C Admin Redemption Rate Configuration adapter service.
 *
 * Phase 7 read projection + orchestration over the frozen Phase 6
 * redemption owner (frozen contract §7.2). The single
 * `redemption_rate_versions` insert is delegated to the frozen owner
 * command (`RedemptionService.createRateVersion`) unchanged — the adapter
 * never mutates domain tables and never duplicates owner formulas.
 *
 * What the adapter adds (all Phase 7 orchestration, none of it inside the
 * frozen owner):
 *
 * 1. Per-market configuration (versioned rules keyed by market code;
 *    Malaysia initial RM1.00 / min RM0.50 / max RM2.00 per 1 iPoint).
 *    A market without an approved rule is BLOCKED — the surface never
 *    falls back to Malaysia or any other market.
 * 2. §7.2 validation: exact-decimal strings, at most ten technical
 *    decimals, bounds enforcement against the approved per-market
 *    minimum/maximum (at-bounds accepted).
 * 3. Activation only at a strictly future market-local `00:00`, resolved
 *    to the exact UTC instant in the market's IANA timezone. Versions are
 *    forward-only; history is immutable (the owner table is protected by
 *    reject-update/reject-delete triggers).
 * 4. No-overlap enforcement (frozen owner model): the Phase 6 schema is
 *    append-only (`reject_update`/`reject_delete` triggers) and enforces a
 *    gist exclusion over `[effective_from, effective_until)` per market +
 *    rate type, and the owner command rejects any second version for the
 *    same market + type. The surface therefore supports exactly one
 *    immutable, future-effective version per market — any further version
 *    is a stable 409 `REDEMPTION_RATE_OVERLAP`. Creates are serialized
 *    with a session-level PostgreSQL advisory lock (frozen contract §14
 *    "advisory-lock boundary" — pre-check alone is insufficient).
 * 5. Exact idempotency: the operation claims the client `Idempotency-Key`
 *    with the canonical payload hash in the shared idempotency mechanism
 *    table (`merchant_api_idempotency_keys`, unique `(scope, key)` — the
 *    exact pattern the frozen Phase 1 package owner uses). Same key + same
 *    payload replays the original result; same key + different payload is
 *    rejected with 409.
 * 6. Mandatory reason + privileged audit (frozen contract §7/§15): the
 *    operator's reason is required and recorded in the canonical audit
 *    trail on every successful create.
 *
 * The market is the server-owned Current Admin Market (canonical RbacGuard
 * `marketScoped` + `MARKET_CONTEXT_MISMATCH` on any client disagreement).
 */
@Injectable()
export class AdminRedemptionOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedemptionService) private readonly owner: RedemptionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(REDEMPTION_RATE_RULES_PROVIDER)
    private readonly rules: RedemptionRateMarketRulesMap = REDEMPTION_RATE_MARKET_RULES,
  ) {}

  // ─── Read projection ──────────────────────────────────────────────

  /**
   * Selected-market redemption rate configuration: the approved §7.2
   * bounds (or the explicit blocked state) and every
   * `POINTS_PER_CURRENCY` rate version with full technical precision,
   * the display value (≤6 decimals, display-only) and the projected
   * effective windows in market-local time AND resolved UTC.
   *
   * The effective window of each version is `[effective_from, window_end)`
   * where `window_end` is the earlier of the next version's
   * `effective_from` and an explicit `effective_until` — matching the
   * frozen owner resolution (`getEffectiveRate`: latest effective_from
   * whose window covers the instant wins). Versions created through this
   * surface always have `effective_until = null`, so their windows are
   * pure chain steps and nothing historical is ever recalculated.
   */
  async listRates(marketId: string): Promise<AdminRedemptionRateListResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();

    const rule =
      this.rules[market.code] ?? this.rules[market.code.toUpperCase()] ?? null;

    const rows = await this.database.db
      .select()
      .from(redemptionRateVersions)
      .where(
        and(
          eq(redemptionRateVersions.marketId, marketId),
          eq(redemptionRateVersions.rateType, REDEMPTION_RATE_TYPE),
        ),
      )
      .orderBy(
        desc(redemptionRateVersions.effectiveFrom),
        desc(redemptionRateVersions.createdAt),
      );

    const chain = [...rows].sort(
      (left, right) =>
        left.effectiveFrom.getTime() - right.effectiveFrom.getTime(),
    );
    const now = Date.now();

    const rates: AdminRedemptionRateVersionDto[] = rows.map((row) => {
      const chainIndex = chain.findIndex((candidate) => candidate.id === row.id);
      const chainNext = chain[chainIndex + 1];
      const explicitEndMs = row.effectiveUntil
        ? row.effectiveUntil.getTime()
        : null;
      // The next chain step supersedes this version only when it starts
      // before the explicit window end (frozen resolution: latest
      // effective_from inside the window wins).
      const supersededByNext =
        chainNext !== undefined &&
        (explicitEndMs === null ||
          chainNext.effectiveFrom.getTime() < explicitEndMs);
      const windowEnd = supersededByNext
        ? chainNext.effectiveFrom
        : explicitEndMs !== null
          ? row.effectiveUntil
          : null;
      const effectiveFromLocal = localWallString(
        row.effectiveFrom,
        market.timezone,
      );
      let windowStatus: AdminRedemptionRateWindowStatus;
      if (supersededByNext) windowStatus = 'SUPERSEDED';
      else if (windowEnd !== null && now >= windowEnd.getTime())
        windowStatus = 'EXPIRED';
      else if (row.effectiveFrom.getTime() > now) windowStatus = 'SCHEDULED';
      else windowStatus = 'ACTIVE';

      return {
        id: row.id,
        rate_type: row.rateType,
        rate_value: String(row.rateValue),
        display_rate: displayRateString(String(row.rateValue)),
        effective_from_utc: row.effectiveFrom.toISOString(),
        effective_from_local: effectiveFromLocal,
        effective_until_utc: windowEnd ? windowEnd.toISOString() : null,
        effective_until_local: windowEnd
          ? localWallString(windowEnd, market.timezone)
          : null,
        window_status: windowStatus,
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
      };
    });

    return {
      market_id: marketId,
      market_code: market.code,
      timezone: market.timezone,
      configured: rule !== null,
      config: rule ? toConfigDto(rule) : null,
      rates,
    };
  }

  // ─── Orchestrated create (frozen owner command) ───────────────────

  /**
   * Create a new redemption rate version for the selected market.
   *
   * Validates the §7.2 per-market bounds and the future market-local
   * 00:00 activation, then claims the client Idempotency-Key with the
   * canonical payload hash (unique `(scope, key)` mechanism row) and
   * delegates the insert to the frozen Phase 6 owner command. Overlap is
   * serialized with a market-scoped advisory lock so a concurrent race
   * resolves to exactly one success and one stable conflict (frozen
   * contract §14); under the frozen owner model the first version for a
   * market + rate type succeeds and any further version is rejected with
   * the stable 409 overlap contract (the owner's degenerate pre-check and
   * the gist exclusion constraint both reject a second version).
   */
  async createRate(
    actor: AdminRedemptionOpsActor,
    marketId: string,
    input: CreateRedemptionRateDto,
    idempotencyKey: string,
  ): Promise<AdminRedemptionRateCreateResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();

    // §7.2 per-market configuration (no cross-market fallback).
    const rule =
      this.rules[market.code] ?? this.rules[market.code.toUpperCase()] ?? null;
    if (!rule) throw redemptionRateMarketBlockedError(market.code);

    // §7.2 bounds enforcement — pure exact-decimal checks (no floats).
    const rateScaled = scaledDecimal(input.rate_value);
    if (rateScaled < scaledDecimal(rule.minimumRate)) {
      throw redemptionRateBelowMinimumError(normalizeRateString(rule.minimumRate));
    }
    if (rateScaled > scaledDecimal(rule.maximumRate)) {
      throw redemptionRateAboveMaximumError(normalizeRateString(rule.maximumRate));
    }

    // Activation only at a strictly future market-local 00:00.
    const effectiveFrom = resolveLocalMidnight(
      input.effective_date,
      market.timezone,
    );
    if (!effectiveFrom || effectiveFrom.getTime() <= Date.now()) {
      throw redemptionActivationNotFutureError();
    }

    const payloadHash = canonicalPayloadHash({
      rate_value: input.rate_value,
      effective_date: input.effective_date,
      reason: input.reason,
    });

    const scope = `${REDEMPTION_CREATE_IDEMPOTENCY_SCOPE}:${marketId}:${actor.adminUserId}`;
    const lockKey = redemptionCreateLockKey(marketId);

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
          .select({ effectiveFrom: redemptionRateVersions.effectiveFrom })
          .from(redemptionRateVersions)
          .where(
            and(
              eq(redemptionRateVersions.marketId, marketId),
              eq(redemptionRateVersions.rateType, REDEMPTION_RATE_TYPE),
            ),
          )
          .orderBy(desc(redemptionRateVersions.effectiveFrom))
          .limit(1);
        if (
          latest[0] &&
          latest[0].effectiveFrom.getTime() >= effectiveFrom.getTime()
        ) {
          throw redemptionRateOverlapError();
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
          throw redemptionIdempotencyConflictError();
        }
        return row.response as unknown as AdminRedemptionRateCreateResponse;
      }

      // Delegate the single domain insert to the frozen Phase 6 owner
      // command (unchanged). The owner commits its insert atomically; the
      // claim is rolled back if the owner rejects.
      let version: {
        id: string;
        rateValue: string;
        createdAt: string;
      };
      try {
        const created = await this.owner.createRateVersion(
          this.ownerActor(actor),
          {
            marketId,
            rateType: REDEMPTION_RATE_TYPE,
            rateValue: input.rate_value,
            fiatCurrency: rule.currency,
            effectiveFrom: effectiveFrom.toISOString(),
            idempotencyKey,
          },
        );
        version = {
          id: created.id,
          rateValue: created.rateValue,
          createdAt: created.createdAt,
        };
      } catch (error) {
        await this.database.db
          .delete(merchantApiIdempotencyKeys)
          .where(
            and(
              eq(merchantApiIdempotencyKeys.id, claimedId),
              isNull(merchantApiIdempotencyKeys.response),
            ),
          );
        // The frozen owner enforces its own overlap contract with the
        // degenerate pre-check + gist exclusion constraint (any second
        // version for a market + rate type is rejected). Map that stable
        // owner error onto the adapter's overlap code so the surface
        // always returns the documented 409 contract.
        if (
          error instanceof RedemptionError &&
          error.code === 'REDEMPTION_RATE_OVERLAP'
        ) {
          throw redemptionRateOverlapError();
        }
        throw error;
      }

      const response: AdminRedemptionRateCreateResponse = {
        id: version.id,
        rate_type: REDEMPTION_RATE_TYPE,
        rate_value: version.rateValue,
        display_rate: displayRateString(version.rateValue),
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
        action: ADMIN_REDEMPTION_RATE_VERSION_CREATED,
        entity: { type: 'redemption_rate_version', id: version.id },
        marketId,
        after: {
          payload_hash: payloadHash,
          version_id: version.id,
          rate_value: input.rate_value,
          effective_date: input.effective_date,
          effective_from_utc: response.effective_from_utc,
        },
        reason: input.reason,
        result: 'SUCCESS',
        requestId: idempotencyKey,
        ipAddress: actor.ipAddress,
        summary: `Administrator configured a ${normalizeRateString(version.rateValue)} ${rule.displayUnit} redemption rate, effective ${input.effective_date} market-local 00:00 (${response.effective_from_utc}).`,
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
  ): Promise<
    { id: string; code: string; currencyCode: string; timezone: string } | undefined
  > {
    const rows = await this.database.db
      .select({
        id: markets.id,
        code: markets.code,
        currencyCode: markets.currencyCode,
        timezone: markets.timezone,
      })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    return rows[0];
  }

  private ownerActor(actor: AdminRedemptionOpsActor): RedemptionAdminActor {
    return {
      adminUserId: actor.adminUserId,
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
      ipAddress: actor.ipAddress ?? '127.0.0.1',
    };
  }
}

// ─── Exact-decimal helpers (string only — never float arithmetic) ──

/**
 * Scale an exact decimal string to 10^10 integer units.
 *
 * Exported for direct unit testing of the §7.2 boundary math; not part of
 * the adapter's public surface.
 */
export function scaledDecimal(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return (
    BigInt(whole) * REDEMPTION_RATE_SCALE +
    BigInt(fraction.padEnd(10, '0') || '0')
  );
}

/**
 * Trim a stored exact-decimal rate to its significant digits (string-only
 * formatting — no arithmetic). Storage keeps `numeric(38,10)`; the API
 * carries the full technical precision.
 */
export function normalizeRateString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('.')) return trimmed;
  const [whole = '0', fraction] = trimmed.split('.');
  const significant = (fraction ?? '').replace(/0+$/u, '');
  return significant === '' ? whole : `${whole}.${significant}`;
}

/**
 * Display-only value with at most `maxDecimals` decimals (§7.2 display
 * precision). Round-half-up on the first dropped digit using exact string
 * math; the stored technical value is never rounded — this is strictly a
 * rendering string.
 *
 * Exported for direct unit testing; not part of the adapter's public
 * surface.
 */
export function displayRateString(
  value: string,
  maxDecimals = REDEMPTION_RATE_DISPLAY_DECIMALS,
): string {
  const trimmed = value.trim();
  const [wholePart = '0', fractionPart = ''] = trimmed.split('.');
  if (fractionPart.length <= maxDecimals) return trimmed;
  const keep = fractionPart.slice(0, maxDecimals);
  const rest = fractionPart.slice(maxDecimals);
  const roundUp = Number(rest[0] ?? '0') >= 5;
  let whole = BigInt(wholePart || '0');
  let fraction = BigInt(keep.padEnd(maxDecimals, '0') || '0');
  if (roundUp) {
    fraction += 1n;
    if (fraction >= 10n ** BigInt(maxDecimals)) {
      fraction = 0n;
      whole += 1n;
    }
  }
  let fractionStr = fraction.toString().padStart(maxDecimals, '0');
  fractionStr = fractionStr.replace(/0+$/u, '');
  return fractionStr === '' ? whole.toString() : `${whole}.${fractionStr}`;
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

/** Market-scoped advisory lock key (FNV-1a over a domain namespace). */
function redemptionCreateLockKey(marketId: string): bigint {
  const input = `p7s6c:redemption-rate-create:${marketId}`;
  let hash = REDEMPTION_CREATE_LOCK_NAMESPACE;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * BigInt(1099511628211)) & BigInt('0xFFFFFFFFFFFFFFFF');
  }
  return hash & BigInt('0x7FFFFFFFFFFFFFFF');
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

/** Build the §7.2 config DTO from the approved rule. */
function toConfigDto(
  rule: (typeof REDEMPTION_RATE_MARKET_RULES)[string],
): AdminRedemptionRateConfigDto {
  return {
    initial_rate: normalizeRateString(rule.initialRate),
    minimum_rate: normalizeRateString(rule.minimumRate),
    maximum_rate: normalizeRateString(rule.maximumRate),
    currency: rule.currency,
    display_unit: rule.displayUnit,
    technical_decimals: REDEMPTION_RATE_TECHNICAL_DECIMALS,
    display_decimals: REDEMPTION_RATE_DISPLAY_DECIMALS,
  };
}
