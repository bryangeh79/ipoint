import { Inject, Injectable } from '@nestjs/common';
import { commissionRateVersions, markets } from '@ipoint/database';
import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  RateManagementError,
  RateManagementService,
} from '../domain/commission/rate.service.js';
import {
  COMMISSION_GENERATIONS,
  COMMISSION_TYPE_RATE_TYPE,
  VALID_COMMISSION_TYPES,
  VALID_RATE_TYPES,
} from '../domain/commission/rate.errors.js';
import type { CreateRateVersionResponse } from '../domain/commission/rate.types.js';
import {
  COMMISSION_RATE_DISPLAY_DECIMALS,
  COMMISSION_RATE_TECHNICAL_DECIMALS,
} from './admin-commission-ops.constants.js';
import type { CreateCommissionRateDto } from './admin-commission-ops.dto.js';
import {
  commissionMarketNotFoundError,
  commissionRateActivationNotFutureError,
  commissionRateIdempotencyConflictError,
  commissionRateIdempotencyKeyRequiredError,
  commissionRateMarketAccessDeniedError,
  commissionRateMarketContextMismatchError,
  commissionRateMarketNotFoundError,
  commissionRateMarketSelectionRequiredError,
  commissionRatePercentageLimitError,
  commissionRatePermissionDeniedError,
  commissionRatePrecisionExceededError,
  commissionRateReasonRequiredError,
  commissionRateTimezoneMismatchError,
  invalidCommissionTypeError,
  invalidEffectiveRangeError,
  invalidGenerationError,
  invalidMarketError,
  invalidRateTypeError,
  invalidRateValueError,
  invalidTimestampError,
  overlappingRatePeriodError,
  rateTypeMismatchError,
} from './admin-commission-ops.errors.js';
import type {
  AdminCommissionOpsActor,
  AdminCommissionOpsError,
  AdminCommissionRateCreateResponse,
  AdminCommissionRateDefinitionDto,
  AdminCommissionRateListResponse,
  AdminCommissionRateVersionDto,
  AdminCommissionRateWindowStatus,
  AdminCommissionTaxonomyEntryDto,
} from './admin-commission-ops.types.js';

// ─── Canonical owner helpers (D-054) ─────────────────────────────────
// The market-local midnight resolution, the local-time rendering, the
// exact rate scaling, the display normalization and the canonical payload
// hash are all owned by the frozen Phase 5 secured owner command
// (D-054). The adapter imports (for its own use) and re-exports them so
// the Phase 7 surface exercises ONE implementation (the owner's
// multi-probe DST-safe helper) and the unit spec keeps testing the
// canonical behavior.
import {
  localWallString,
  resolveLocalMidnight,
} from '../domain/commission/rate.service.js';

export {
  canonicalPayloadHash,
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
  scaledRate,
} from '../domain/commission/rate.service.js';

/**
 * P7-S6D Admin Commission Rate Configuration adapter service (D-054 §16 /
 * D-055 §8).
 *
 * Phase 7 read projection + orchestration over the SECURED Phase 5
 * commission-rate owner. The adapter NEVER enforces owner-level business
 * controls: after the D-054 remediation every one of them lives inside
 * the secured owner command `RateManagementService.createRateVersion` —
 * RBAC re-check (`commission.rate.manage`, SUPER_ADMIN catalog entry),
 * identity validation, selected-market enforcement (`currentMarketId`),
 * resource-market consistency, the frozen taxonomy (rate_type +
 * generation ↔ commission type), the exact rate grammar (BigInt, ≤10
 * decimals, ≤38 digits, percentage ≤100%), strictly-future market-local
 * 00:00 activation (IANA multi-probe), the append-only half-open windows
 * under a transaction-scoped advisory lock (exactly one winner under
 * race), the operation-scoped idempotency with the canonical payload
 * hash, the mandatory reason (durable on the version row) and the atomic
 * immutable owner audit.
 *
 * What the adapter adds (legitimate Phase 7 orchestration/read/UI
 * behavior only):
 *
 * 1. The read projection (`listRates`): every (commission_type,
 *    generation) definition of the selected market with the current
 *    effective version (owner logical half-open resolution — latest start
 *    ≤ now wins, an open-ended predecessor is closed by its successor),
 *    the scheduled future versions, the full immutable history, exact
 *    decimal strings with full technical precision, the ≤6-decimal
 *    display value and the projected effective windows in market-local
 *    time AND resolved UTC (window states ACTIVE / SCHEDULED /
 *    SUPERSEDED / EXPIRED). The frozen taxonomy is exposed for the
 *    configuration UI only. A market that is not present or not ACTIVE is
 *    reported with the explicit blocked state (`configured: false`, no
 *    cross-market fallback).
 * 2. The market-local calendar DATE → exact UTC instant conversion using
 *    the canonical owner helper (`resolveLocalMidnight`); the owner
 *    re-verifies the instant is a strictly future market-local 00:00.
 * 3. The create response mapping (owner-resolved UTC + market-local
 *    activation times, exact stored rate, display value).
 * 4. The owner error → S6D external contract mapping (every
 *    `RateManagementError` code, no error swallowed into a 2xx; unknown
 *    codes propagate as 500).
 *
 * The adapter performs NO advisory lock, NO idempotency claim/mechanism
 * writes, NO privileged audit of its own, NO taxonomy/rate-bound
 * enforcement and NO direct write to `commission_rate_version` — those
 * are all owned by the canonical owner command (D-054 §10/§11; the
 * owner's atomic audit carries the operator reason, actor, market and
 * request correlation).
 */
@Injectable()
export class AdminCommissionOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RateManagementService)
    private readonly owner: RateManagementService,
  ) {}

  // ─── Read projection ──────────────────────────────────────────────

  /**
   * Selected-market commission rate configuration: the frozen taxonomy
   * (UI display only), every (commission_type, generation) definition
   * with the current effective version (owner logical half-open
   * resolution), the scheduled future versions and the full immutable
   * history — exact decimal strings with full technical precision, the
   * ≤6-decimal display value and the projected effective windows in
   * market-local time AND resolved UTC.
   *
   * The projected window of each version is `[effective_from, window_end)`
   * where `window_end` is the earlier of the next version's
   * `effective_from` and an explicit `effective_until` — matching the
   * frozen owner resolution (latest effective_from whose window covers
   * the instant wins; an open-ended predecessor's window is derived
   * `[start, next_start)`, D-054 §9). Versions created through this
   * surface always have `effective_until = null`, so their windows are
   * pure chain steps and nothing historical is ever recalculated.
   */
  async listRates(marketId: string): Promise<AdminCommissionRateListResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw commissionMarketNotFoundError();

    const rows = await this.database.db
      .select()
      .from(commissionRateVersions)
      .where(eq(commissionRateVersions.market, market.code))
      .orderBy(
        desc(commissionRateVersions.effectiveFrom),
        desc(commissionRateVersions.createdAt),
      );

    const byKey = new Map<string, AdminCommissionRateVersionDto[]>();
    for (const row of rows) {
      const key = `${row.commissionType}:${row.generation}`;
      const list = byKey.get(key) ?? [];
      list.push(this.toVersionDto(row, market.timezone));
      byKey.set(key, list);
    }

    // Definition keys = the frozen taxonomy pairs (so the configuration
    // table shows the explicit not-configured state per definition) UNION
    // every (commission_type, generation) pair present in the data (so
    // legacy rows — e.g. the pre-P5-R1 MY MERCHANT_RECRUITMENT G1 seed —
    // are projected, never silently dropped). The taxonomy remains the
    // enforcement authority inside the owner; this surface only reads.
    const keys = new Map<
      string,
      { commission_type: string; generation: number; rate_type: string }
    >();
    for (const entry of this.taxonomy()) {
      for (const generation of entry.generations) {
        keys.set(`${entry.commission_type}:${generation}`, {
          commission_type: entry.commission_type,
          generation,
          rate_type: entry.rate_type,
        });
      }
    }
    for (const row of rows) {
      const key = `${row.commissionType}:${row.generation}`;
      if (!keys.has(key)) {
        keys.set(key, {
          commission_type: row.commissionType,
          generation: row.generation,
          rate_type: row.rateType,
        });
      }
    }

    const definitions = [...keys.values()].map((key) =>
      this.buildDefinition(key, byKey, market.timezone),
    );

    return {
      market_id: marketId,
      market_code: market.code,
      timezone: market.timezone,
      currency: market.currencyCode,
      // A market that is not ACTIVE is explicitly blocked — the owner only
      // manages ACTIVE markets (no fallback to any other market).
      configured: market.status === 'ACTIVE',
      taxonomy: this.taxonomy(),
      definitions,
    };
  }

  // ─── Orchestrated create (secured owner command, D-054) ────────────

  /**
   * Create a new commission rate version for the selected market.
   *
   * The adapter performs ONLY Phase 7 orchestration: the market row
   * lookup and the market-local date → UTC instant conversion (canonical
   * owner helper). EVERYTHING else is delegated to the secured owner
   * command `RateManagementService.createRateVersion`, which re-checks
   * permission + identity, enforces the selected market
   * (`currentMarketId` from the RbacGuard market context), the frozen
   * taxonomy, the exact rate grammar/precision, the strictly-future
   * market-local 00:00 activation, the append-only half-open windows
   * under its transaction-scoped advisory lock (exactly one winner under
   * race), the operation-scoped idempotency claim (with the canonical
   * payload hash), the mandatory reason and the atomic owner audit — all
   * in ONE transaction. The adapter performs no writes of its own for the
   * create path.
   */
  async createRate(
    actor: AdminCommissionOpsActor,
    marketId: string,
    input: CreateCommissionRateDto,
    idempotencyKey: string,
  ): Promise<AdminCommissionRateCreateResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw commissionMarketNotFoundError();

    // ── Convert the market-local DATE into the exact UTC activation
    //    instant using the canonical owner helper (multi-probe, DST-safe).
    //    The owner re-verifies the instant is a strictly-future
    //    market-local 00:00 and rejects same-day/backdated/DST-skipped
    //    activations with COMMISSION_RATE_ACTIVATION_NOT_FUTURE. ─────────
    const effectiveFrom = resolveLocalMidnight(
      input.effective_date,
      market.timezone,
    );
    if (!effectiveFrom) throw commissionRateActivationNotFutureError();

    // ── Delegate the ENTIRE create to the secured owner command (D-054):
    //    RBAC re-check, identity, selected market, resource-market
    //    consistency, frozen taxonomy, exact rate grammar/precision,
    //    future market-local 00:00, overlap + advisory lock, idempotency
    //    claim + payload hash, mandatory reason and the atomic owner
    //    audit all live inside `RateManagementService.createRateVersion`. ──
    let version: CreateRateVersionResponse;
    try {
      version = await this.owner.createRateVersion(this.ownerActor(actor), {
        market: market.code,
        commissionType: input.commission_type,
        generation: input.generation,
        rateValue: input.rate_value,
        rateType: input.rate_type,
        effectiveFrom: effectiveFrom.toISOString(),
        reason: input.reason,
        idempotencyKey,
      });
    } catch (error) {
      // Surface the owner's rejections with the pre-existing S6D external
      // codes and HTTP semantics (canonical commission-rate surface).
      if (error instanceof RateManagementError) {
        throw this.mapOwnerError(error);
      }
      throw error;
    }

    // ── Adapter response: owner-resolved activation + surface fields.
    //    The exact stored rate comes from the immutable owner row (full
    //    technical precision — same value the read projection surfaces),
    //    never derived or rounded by the adapter. ─────────────────────────
    return {
      id: version.id,
      commission_type: version.commissionType,
      generation: version.generation,
      rate_type: version.rateType,
      rate_value: version.rateValue,
      display_rate: displayRateString(version.rateValue),
      effective_date: input.effective_date,
      effective_from_utc: version.effectiveFrom,
      effective_from_local: version.effectiveFromLocal,
      timezone: version.timezone,
      market_id: marketId,
      created_by: version.createdBy,
      created_at: version.createdAt,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async marketRow(marketId: string): Promise<
    | {
        id: string;
        code: string;
        currencyCode: string;
        timezone: string;
        status: string;
      }
    | undefined
  > {
    const rows = await this.database.db
      .select({
        id: markets.id,
        code: markets.code,
        currencyCode: markets.currencyCode,
        timezone: markets.timezone,
        status: markets.status,
      })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    return rows[0];
  }

  /**
   * Frozen commission taxonomy for the configuration UI (D-054 §6),
   * derived from the canonical owner constants — never hard-coded twice.
   */
  private taxonomy(): AdminCommissionTaxonomyEntryDto[] {
    return VALID_COMMISSION_TYPES.map((commissionType) => ({
      commission_type: commissionType,
      rate_type: COMMISSION_TYPE_RATE_TYPE[commissionType] ?? 'FIXED',
      generations: [...(COMMISSION_GENERATIONS[commissionType] ?? [])],
    }));
  }

  /**
   * Build one (commission_type, generation) definition. The window of
   * every version is `[effective_from, window_end)` where `window_end` is
   * the earlier of the next chain version's start and an explicit
   * `effective_until` (D-054 §9 half-open semantics).
   */
  private buildDefinition(
    key: { commission_type: string; generation: number; rate_type: string },
    byKey: ReadonlyMap<string, AdminCommissionRateVersionDto[]>,
    timezone: string,
  ): AdminCommissionRateDefinitionDto {
    const dtoList = [
      ...(byKey.get(`${key.commission_type}:${key.generation}`) ?? []),
    ];
    // Chain: ascending effective_from (stable by created_at).
    const chain = [...dtoList].sort(
      (left, right) =>
        Date.parse(left.effective_from_utc) -
          Date.parse(right.effective_from_utc) ||
        Date.parse(left.created_at) - Date.parse(right.created_at),
    );
    const now = Date.now();

    // Recompute window ends + statuses over the chain.
    const indexById = new Map(chain.map((row, index) => [row.id, index]));
    const projected = dtoList.map((row) => {
      const chainIndex = indexById.get(row.id) ?? -1;
      const chainNext = chainIndex >= 0 ? chain[chainIndex + 1] : undefined;
      const rowStartMs = Date.parse(row.effective_from_utc);
      const explicitEndMs = row.effective_until_utc
        ? Date.parse(row.effective_until_utc)
        : null;
      // The next chain step supersedes this version only when it starts
      // before the explicit window end (frozen resolution: latest
      // effective_from inside the window wins; a successor may start
      // exactly at a stored end — that end is then this version's own
      // EXPIRED boundary, not a supersession).
      const supersededByNext =
        chainNext !== undefined &&
        (explicitEndMs === null ||
          Date.parse(chainNext.effective_from_utc) < explicitEndMs);
      const windowEndMs = supersededByNext
        ? Date.parse(chainNext.effective_from_utc)
        : explicitEndMs;
      const windowEndDate = windowEndMs === null ? null : new Date(windowEndMs);
      let windowStatus: AdminCommissionRateWindowStatus;
      if (supersededByNext) windowStatus = 'SUPERSEDED';
      else if (windowEndMs !== null && now >= windowEndMs)
        windowStatus = 'EXPIRED';
      else if (rowStartMs > now) windowStatus = 'SCHEDULED';
      else windowStatus = 'ACTIVE';
      return {
        ...row,
        effective_until_utc: windowEndDate ? windowEndDate.toISOString() : null,
        effective_until_local: windowEndDate
          ? localWallString(windowEndDate, timezone)
          : null,
        window_status: windowStatus,
      };
    });

    // Current effective version = the owner resolution (D-054 §9): the
    // LATEST effective_from whose projected window covers the instant
    // wins. The window is `[effective_from, window_end)` where window_end
    // is the earlier of the next chain step's start and an explicit
    // effective_until — so a version whose successor has already started,
    // or whose explicit end has passed, is not current even though its
    // status label may read SUPERSEDED/EXPIRED (S6B/S6C status semantics).
    let current: AdminCommissionRateVersionDto | null = null;
    for (const row of projected) {
      const rowStartMs = Date.parse(row.effective_from_utc);
      if (rowStartMs > now) continue;
      const windowEndMs = row.effective_until_utc
        ? Date.parse(row.effective_until_utc)
        : null;
      if (windowEndMs !== null && now >= windowEndMs) continue;
      if (
        current === null ||
        rowStartMs > Date.parse(current.effective_from_utc)
      ) {
        current = row;
      }
    }
    const scheduled = projected
      .filter((row) => row.window_status === 'SCHEDULED')
      .sort(
        (left, right) =>
          Date.parse(left.effective_from_utc) -
          Date.parse(right.effective_from_utc),
      );
    const history = [...projected].sort(
      (left, right) =>
        Date.parse(right.effective_from_utc) -
          Date.parse(left.effective_from_utc) ||
        Date.parse(right.created_at) - Date.parse(left.created_at),
    );

    return {
      commission_type: key.commission_type,
      generation: key.generation,
      rate_type: key.rate_type,
      current,
      scheduled,
      history,
    };
  }

  private toVersionDto(
    row: typeof commissionRateVersions.$inferSelect,
    timezone: string,
  ): AdminCommissionRateVersionDto {
    return {
      id: row.id,
      commission_type: row.commissionType,
      generation: row.generation,
      rate_type: row.rateType,
      rate_value: String(row.rateValue),
      display_rate: displayRateString(String(row.rateValue)),
      effective_from_utc: row.effectiveFrom.toISOString(),
      effective_from_local: localWallString(row.effectiveFrom, timezone),
      effective_until_utc: row.effectiveUntil
        ? row.effectiveUntil.toISOString()
        : null,
      effective_until_local: row.effectiveUntil
        ? localWallString(row.effectiveUntil, timezone)
        : null,
      window_status: 'ACTIVE',
      reason: row.reason ?? null,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
    };
  }

  /**
   * Adapt the surface actor into the owner actor, passing the server-owned
   * Current Admin Market (RbacGuard `adminMarketContext`) through so the
   * owner command applies the exact same selected-market enforcement as
   * the canonical route (D-054 §5 contract). `ipAddress` is required by
   * the owner actor; the surface actor carries it when the controller
   * resolved a client address (falls back to an empty string otherwise —
   * the owner only records it on the audit row).
   */
  private ownerActor(
    actor: AdminCommissionOpsActor,
  ): Parameters<RateManagementService['createRateVersion']>[0] {
    return {
      adminUserId: actor.adminUserId,
      ipAddress: actor.ipAddress ?? '',
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
      ...(actor.currentMarketId
        ? { currentMarketId: actor.currentMarketId }
        : {}),
      ...(actor.marketContextVersion !== undefined
        ? { marketContextVersion: actor.marketContextVersion }
        : {}),
    };
  }

  /**
   * Translate the secured owner's `RateManagementError` rejections into
   * the pre-existing S6D external codes. The HTTP status for each code is
   * assigned in the controller's error mapping; every code maps to the
   * status the canonical commission-rate surface used for the same
   * violation. Unknown owner codes propagate as-is and surface as a 500
   * through the controller — no error is swallowed into a 2xx.
   */
  private mapOwnerError(error: RateManagementError): AdminCommissionOpsError {
    switch (error.code) {
      case 'COMMISSION_RATE_PERMISSION_DENIED':
        return commissionRatePermissionDeniedError();
      case 'COMMISSION_RATE_MARKET_ACCESS_DENIED':
        return commissionRateMarketAccessDeniedError();
      case 'COMMISSION_RATE_MARKET_NOT_FOUND':
        return commissionRateMarketNotFoundError();
      case 'COMMISSION_RATE_MARKET_SELECTION_REQUIRED':
        return commissionRateMarketSelectionRequiredError();
      case 'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH':
        return commissionRateMarketContextMismatchError();
      case 'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED':
        return commissionRateIdempotencyKeyRequiredError();
      case 'COMMISSION_RATE_REASON_REQUIRED':
        return commissionRateReasonRequiredError();
      case 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT':
        return commissionRateIdempotencyConflictError();
      case 'COMMISSION_RATE_PRECISION_EXCEEDED':
        return commissionRatePrecisionExceededError();
      case 'COMMISSION_RATE_PERCENTAGE_LIMIT':
        return commissionRatePercentageLimitError();
      case 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE':
        return commissionRateActivationNotFutureError();
      case 'COMMISSION_RATE_TIMEZONE_MISMATCH':
        return commissionRateTimezoneMismatchError();
      case 'INVALID_COMMISSION_TYPE': {
        const details = error.details as
          | { commissionType?: string; validTypes?: string[] }
          | undefined;
        return invalidCommissionTypeError(
          details?.commissionType ?? 'UNKNOWN',
          details?.validTypes ?? VALID_COMMISSION_TYPES,
        );
      }
      case 'INVALID_GENERATION': {
        const details = error.details as
          | {
              commissionType?: string;
              generation?: number;
              allowedGenerations?: number[];
            }
          | undefined;
        return invalidGenerationError(
          details?.commissionType ?? 'UNKNOWN',
          details?.generation ?? -1,
          details?.allowedGenerations ?? [],
        );
      }
      case 'INVALID_RATE_TYPE': {
        const details = error.details as
          | { rateType?: string; validTypes?: string[] }
          | undefined;
        return invalidRateTypeError(
          details?.rateType ?? 'UNKNOWN',
          details?.validTypes ?? VALID_RATE_TYPES,
        );
      }
      case 'RATE_TYPE_MISMATCH': {
        const details = error.details as
          | {
              commissionType?: string;
              providedRateType?: string;
              expectedRateType?: string;
            }
          | undefined;
        return rateTypeMismatchError(
          details?.commissionType ?? 'UNKNOWN',
          details?.providedRateType ?? 'UNKNOWN',
          details?.expectedRateType ?? 'UNKNOWN',
        );
      }
      case 'INVALID_MARKET': {
        const details = error.details as { market?: string } | undefined;
        return invalidMarketError(details?.market ?? 'UNKNOWN');
      }
      case 'INVALID_RATE_VALUE': {
        const details = error.details as
          | { rateValue?: string; message?: string }
          | undefined;
        return invalidRateValueError(
          details?.rateValue ?? 'UNKNOWN',
          typeof details?.message === 'string' ? details.message : undefined,
        );
      }
      case 'INVALID_EFFECTIVE_RANGE': {
        const details = error.details as
          | { effectiveFrom?: string; effectiveUntil?: string }
          | undefined;
        return invalidEffectiveRangeError(
          details?.effectiveFrom ?? 'UNKNOWN',
          details?.effectiveUntil ?? 'UNKNOWN',
        );
      }
      case 'INVALID_TIMESTAMP': {
        const details = error.details as { value?: string } | undefined;
        return invalidTimestampError(details?.value ?? 'UNKNOWN');
      }
      case 'OVERLAPPING_RATE_PERIOD': {
        const details = error.details as
          | {
              commissionType?: string;
              generation?: number;
              market?: string;
              effectiveFrom?: string;
              effectiveUntil?: string | null;
            }
          | undefined;
        return overlappingRatePeriodError(
          details?.commissionType ?? 'UNKNOWN',
          details?.generation ?? -1,
          details?.market ?? 'UNKNOWN',
          details?.effectiveFrom ?? 'UNKNOWN',
          details?.effectiveUntil ?? null,
        );
      }
      default:
        // Never thrown by the secured create command; propagate so the
        // controller surfaces a 500 — never a swallowed 2xx.
        throw error;
    }
  }
}

// ─── Display helpers (string only — never float arithmetic) ─────────

/**
 * Display-only value with at most `maxDecimals` decimals (D-054 §7
 * display precision). Round-half-up on the first dropped digit using exact
 * string math; the stored technical value is never rounded — this is
 * strictly a rendering string.
 *
 * Exported for direct unit testing; not part of the adapter's public
 * surface.
 */
export function displayRateString(
  value: string,
  maxDecimals = COMMISSION_RATE_DISPLAY_DECIMALS,
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

// Re-export the technical/display ceilings for the DTO + unit tests.
export { COMMISSION_RATE_DISPLAY_DECIMALS, COMMISSION_RATE_TECHNICAL_DECIMALS };
