import { Inject, Injectable } from '@nestjs/common';
import {
  markets,
  redemptionRateCancellations,
  redemptionRateMarketRules,
  redemptionRateVersions,
} from '@ipoint/database';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { RedemptionService } from '../redemption/redemption.service.js';
import { RedemptionError } from '../redemption/redemption.errors.js';
import type {
  RedemptionAdminActor,
  RedemptionRateVersionCreateResponse,
} from '../redemption/redemption.types.js';
import type {
  CancelRedemptionRateDto,
  CreateRedemptionRateDto,
} from './admin-redemption-ops.dto.js';
import {
  redemptionActivationNotFutureError,
  redemptionIdempotencyConflictError,
  redemptionIdempotencyKeyRequiredError,
  redemptionMarketAccessDeniedError,
  redemptionMarketContextMismatchError,
  redemptionMarketNotFoundError,
  redemptionMarketSelectionRequiredError,
  redemptionPermissionDeniedError,
  redemptionRateAboveMaximumError,
  redemptionRateAlreadyCancelledError,
  redemptionRateBelowMinimumError,
  redemptionRateCannotCancelEffectiveError,
  redemptionRateCurrencyMismatchError,
  redemptionRateMarketBlockedError,
  redemptionRateOverlapError,
  redemptionRatePrecisionExceededError,
  redemptionRateVersionNotFoundError,
  redemptionReasonRequiredError,
} from './admin-redemption-ops.errors.js';
import {
  REDEMPTION_RATE_DISPLAY_DECIMALS,
  REDEMPTION_RATE_TECHNICAL_DECIMALS,
  REDEMPTION_RATE_TYPE,
  type AdminRedemptionOpsActor,
  type AdminRedemptionOpsError,
  type AdminRedemptionRateCancelResponse,
  type AdminRedemptionRateConfigDto,
  type AdminRedemptionRateCreateResponse,
  type AdminRedemptionRateListResponse,
  type AdminRedemptionRateVersionDto,
  type AdminRedemptionRateWindowStatus,
} from './admin-redemption-ops.types.js';

// ─── Canonical owner helpers (D-053) ─────────────────────────────────
// The market-local midnight resolution, the local-time rendering, the
// rate display normalization, the exact rate scaling and the canonical
// payload hash are all owned by the frozen Phase 6 secured owner command
// (D-053). The adapter imports (for its own use) and re-exports them so
// the Phase 7 surface exercises ONE implementation (the owner's
// multi-probe DST-safe helper) and the unit spec keeps testing the
// canonical behavior.
import {
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
} from '../redemption/redemption.service.js';

export {
  canonicalPayloadHash,
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
  scaledRate,
} from '../redemption/redemption.service.js';

/**
 * P7-S6C Admin Redemption Rate Configuration adapter service (D-053
 * rewiring, order §15).
 *
 * Phase 7 read projection + orchestration over the SECURED Phase 6
 * redemption owner. The adapter NEVER enforces owner-level business
 * controls: after the D-053 remediation every one of them lives inside
 * the secured owner commands `RedemptionService.createRateVersion` and
 * `RedemptionService.cancelRateVersion` — RBAC re-check
 * (`redemption.rate.manage`, SUPER_ADMIN), identity validation, selected-
 * market enforcement (`currentMarketId`), resource-market consistency,
 * exact per-market rate bounds (BigInt, no floats), ≤10-decimal
 * precision, strictly-future market-local 00:00 activation, append-only
 * half-open windows under a transaction-scoped advisory lock (exactly
 * one winner under race), operation-scoped idempotency with the canonical
 * payload hash, mandatory reason (durable on the version row), the atomic
 * immutable owner audit, and the append-only cancellation contract
 * (only future scheduled versions are cancellable; the resolver ignores
 * cancelled versions forever).
 *
 * What the adapter adds (legitimate Phase 7 orchestration/read/UI
 * behavior only):
 *
 * 1. The read projection (`listRates`): the approved per-market
 *    configuration (from the canonical `redemption_rate_market_rules`
 *    table — the SAME source the owner enforces, D-053 §6) or the
 *    explicit blocked state (`configured: false`, no cross-market
 *    fallback), every `POINTS_PER_CURRENCY` version with full technical
 *    precision, the ≤6-decimal display value and the projected effective
 *    windows in market-local time AND resolved UTC, including the
 *    `CANCELLED` window state for voided versions (cancelled versions
 *    never close or supersede a predecessor window).
 * 2. The market-local calendar DATE → exact UTC instant conversion using
 *    the canonical owner helper (`resolveLocalMidnight`); the owner
 *    re-verifies the instant is a strictly future market-local 00:00.
 * 3. The create + cancel response mapping (owner-resolved UTC +
 *    market-local activation times, durable reason, cancellation event).
 * 4. The owner error → S6C external contract mapping (every owner
 *    `REDEMPTION_RATE_*` code, no error swallowed into a 2xx).
 *
 * The adapter performs NO advisory lock, NO idempotency claim/mechanism
 * writes, NO privileged audit of its own, NO rate-bound enforcement and
 * NO direct write to `redemption_rate_versions` — those are all owned by
 * the canonical owner commands (D-053 §10/§11; the owner's atomic audit
 * carries the operator reason, actor, market and request correlation).
 */
@Injectable()
export class AdminRedemptionOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedemptionService) private readonly owner: RedemptionService,
  ) {}

  // ─── Read projection ──────────────────────────────────────────────

  /**
   * Selected-market redemption rate configuration: the approved per-market
   * bounds (resolved from the canonical `redemption_rate_market_rules`
   * table — the same source the secured owner enforces, D-053 §6; no
   * cross-market fallback, unconfigured markets show `configured: false`)
   * and every `POINTS_PER_CURRENCY` rate version with full technical
   * precision, the display value (≤6 decimals, display-only) and the
   * projected effective windows in market-local time AND resolved UTC.
   *
   * The effective window of each version is `[effective_from, window_end)`
   * where `window_end` is the earlier of the next NON-CANCELLED version's
   * `effective_from` and an explicit `effective_until` — matching the
   * frozen owner resolution (`getEffectiveRate`: latest effective_from
   * whose window covers the instant wins; cancelled versions are ignored
   * forever, D-053 §9). Versions created through this surface always have
   * `effective_until = null`, so their windows are pure chain steps and
   * nothing historical is ever recalculated.
   */
  async listRates(marketId: string): Promise<AdminRedemptionRateListResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();

    const rule = await this.marketRuleRow(market.code);

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

    // D-053 §9: cancelled versions are void — the resolver ignores them,
    // so a cancelled version never closes or supersedes a predecessor
    // window. The chain is built over non-cancelled versions only.
    const cancellations = await this.database.db
      .select({ rateVersionId: redemptionRateCancellations.rateVersionId })
      .from(redemptionRateCancellations)
      .where(eq(redemptionRateCancellations.marketId, marketId));
    const cancelledIds = new Set(cancellations.map((row) => row.rateVersionId));

    const chain = rows
      .filter((row) => !cancelledIds.has(row.id))
      .sort(
        (left, right) =>
          left.effectiveFrom.getTime() - right.effectiveFrom.getTime(),
      );
    const now = Date.now();

    const rates: AdminRedemptionRateVersionDto[] = rows.map((row) => {
      const cancelled = cancelledIds.has(row.id);
      const chainIndex = cancelled
        ? -1
        : chain.findIndex((candidate) => candidate.id === row.id);
      const chainNext = chainIndex >= 0 ? chain[chainIndex + 1] : undefined;
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
      if (cancelled) windowStatus = 'CANCELLED';
      else if (supersededByNext) windowStatus = 'SUPERSEDED';
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
      // `marketRuleRow` resolves to `undefined` (not `null`) when the
      // market has no active rule — both must read as the explicit
      // blocked state (`configured: false`).
      configured: rule !== undefined && rule !== null,
      config: rule ? toConfigDto(rule) : null,
      rates,
    };
  }

  // ─── Orchestrated create (secured owner command, D-053) ────────────

  /**
   * Create a new redemption rate version for the selected market.
   *
   * The adapter performs ONLY Phase 7 orchestration: the market row
   * lookup and the market-local date → UTC instant conversion (canonical
   * owner helper). EVERYTHING else is delegated to the secured owner
   * command `RedemptionService.createRateVersion`, which re-checks
   * permission + identity, enforces the selected market
   * (`currentMarketId` from the RbacGuard market context), the exact
   * per-market rate bounds/precision, the strictly-future market-local
   * 00:00 activation, the append-only half-open windows under its
   * transaction-scoped advisory lock (exactly one winner under race),
   * the operation-scoped idempotency claim (with the canonical payload
   * hash), the mandatory reason and the atomic owner audit — all in ONE
   * transaction. The adapter performs no writes of its own for the create
   * path.
   */
  async createRate(
    actor: AdminRedemptionOpsActor,
    marketId: string,
    input: CreateRedemptionRateDto,
    idempotencyKey: string,
  ): Promise<AdminRedemptionRateCreateResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();

    // ── Convert the market-local DATE into the exact UTC activation
    //    instant using the canonical owner helper (multi-probe, DST-safe).
    //    The owner re-verifies the instant is a strictly-future
    //    market-local 00:00 and rejects same-day/backdated/DST-skipped
    //    activations with REDEMPTION_RATE_ACTIVATION_NOT_FUTURE. ─────────
    const effectiveFrom = resolveLocalMidnight(
      input.effective_date,
      market.timezone,
    );
    if (!effectiveFrom) throw redemptionActivationNotFutureError();

    // ── Delegate the ENTIRE create to the secured owner command (D-053):
    //    RBAC re-check, identity, selected market, resource-market
    //    consistency, exact per-market bounds/precision, future
    //    market-local 00:00, overlap + advisory lock, idempotency claim +
    //    payload hash, mandatory reason and the atomic owner audit all
    //    live inside `RedemptionService.createRateVersion`. The rate is
    //    expressed in the market's currency (the owner validates it
    //    against the approved rule's currency). ───────────────────────────
    let version: RedemptionRateVersionCreateResponse;
    try {
      version = await this.owner.createRateVersion(this.ownerActor(actor), {
        marketId,
        rateType: REDEMPTION_RATE_TYPE,
        rateValue: input.rate_value,
        fiatCurrency: market.currencyCode,
        effectiveFrom: effectiveFrom.toISOString(),
        reason: input.reason,
        idempotencyKey,
      });
    } catch (error) {
      // Surface the owner's REDEMPTION_RATE_* rejections with the
      // pre-existing S6C external codes and HTTP semantics (order §15).
      if (error instanceof RedemptionError) {
        throw this.mapOwnerError(error, market.code);
      }
      throw error;
    }

    // ── Adapter response: owner-resolved activation + surface fields.
    //    The exact stored rate is read back from the immutable owner row
    //    (full technical precision — same value the read projection
    //    surfaces), never derived or rounded by the adapter. ─────────────
    const stored = await this.database.db
      .select({ rateValue: redemptionRateVersions.rateValue })
      .from(redemptionRateVersions)
      .where(eq(redemptionRateVersions.id, version.id))
      .limit(1);
    const storedRateValue = stored[0]
      ? String(stored[0].rateValue)
      : version.rateValue;

    return {
      id: version.id,
      rate_type: REDEMPTION_RATE_TYPE,
      rate_value: storedRateValue,
      display_rate: displayRateString(storedRateValue),
      effective_date: input.effective_date,
      effective_from_utc: version.effectiveFrom,
      effective_from_local: version.effectiveFromLocal,
      timezone: version.timezone,
      market_id: marketId,
      created_by: version.createdBy,
      created_at: version.createdAt,
    };
  }

  // ─── Orchestrated cancel (secured owner command, D-053 §9) ─────────

  /**
   * Cancel a scheduled, not-yet-effective redemption rate version.
   *
   * The adapter performs NO control of its own: the entire cancellation
   * (identity/permission re-check, selected-market + resource-market
   * consistency, idempotency claim + payload hash, cancellability
   * pre-checks inside the transaction-scoped advisory lock, append-only
   * immutable cancellation event, atomic owner audit) is delegated to the
   * secured owner command `RedemptionService.cancelRateVersion` with the
   * mandatory reason, the client Idempotency-Key and the server Current
   * Admin Market. The immutable rate-version row is never updated or
   * deleted.
   */
  async cancelRate(
    actor: AdminRedemptionOpsActor,
    versionId: string,
    input: CancelRedemptionRateDto,
    idempotencyKey: string,
  ): Promise<AdminRedemptionRateCancelResponse> {
    try {
      const cancelled = await this.owner.cancelRateVersion(
        this.ownerActor(actor),
        versionId,
        { reason: input.reason, idempotencyKey },
      );
      return {
        id: cancelled.id,
        rate_version_id: cancelled.rateVersionId,
        market_id: cancelled.marketId,
        rate_value: cancelled.rateValue,
        effective_from_utc: cancelled.effectiveFrom,
        reason: cancelled.reason,
        cancelled_by: cancelled.cancelledBy,
        cancelled_at: cancelled.cancelledAt,
      };
    } catch (error) {
      if (error instanceof RedemptionError) throw this.mapOwnerError(error);
      throw error;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async marketRow(
    marketId: string,
  ): Promise<
    | { id: string; code: string; currencyCode: string; timezone: string }
    | undefined
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

  /**
   * The approved per-market rate rule for the market code (D-053 §6),
   * resolved from the canonical `redemption_rate_market_rules` table —
   * the SAME source the secured owner enforces. No cross-market fallback:
   * a market without an active rule resolves to `undefined` and the
   * surface reports the explicit blocked state (`configured: false`).
   */
  private async marketRuleRow(marketCode: string): Promise<
    | {
        initialRate: string;
        minimumRate: string;
        maximumRate: string;
        currency: string;
        displayUnit: string;
      }
    | undefined
  > {
    const rows = await this.database.db
      .select({
        initialRate: redemptionRateMarketRules.initialRate,
        minimumRate: redemptionRateMarketRules.minimumRate,
        maximumRate: redemptionRateMarketRules.maximumRate,
        currency: redemptionRateMarketRules.currency,
        displayUnit: redemptionRateMarketRules.displayUnit,
      })
      .from(redemptionRateMarketRules)
      .where(
        and(
          eq(redemptionRateMarketRules.marketCode, marketCode),
          eq(redemptionRateMarketRules.rateType, REDEMPTION_RATE_TYPE),
          eq(redemptionRateMarketRules.isActive, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    return {
      initialRate: String(row.initialRate),
      minimumRate: String(row.minimumRate),
      maximumRate: String(row.maximumRate),
      currency: row.currency,
      displayUnit: row.displayUnit,
    };
  }

  /**
   * Adapt the surface actor into the owner actor, passing the server-owned
   * Current Admin Market (RbacGuard `adminMarketContext`) through so the
   * owner command applies the exact same selected-market enforcement as
   * the canonical route (D-053 §5 contract). `ipAddress` is required by
   * the owner actor; the surface actor carries it when the controller
   * resolved a client address (falls back to an empty string otherwise —
   * the owner only records it on the audit row).
   */
  private ownerActor(actor: AdminRedemptionOpsActor): RedemptionAdminActor {
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
   * Translate the secured owner's REDEMPTION_RATE_* rejections into the
   * pre-existing S6C external codes. The HTTP status for each code is
   * assigned in the controller's error mapping; every code here maps to
   * the status the pre-rewiring surface used for the same violation
   * (order §15). Unknown owner codes propagate as-is and surface as a 500
   * through the controller — no error is swallowed into a 2xx.
   */
  private mapOwnerError(
    error: RedemptionError,
    marketCode?: string,
  ): AdminRedemptionOpsError {
    switch (error.code) {
      case 'REDEMPTION_RATE_PERMISSION_DENIED':
        return redemptionPermissionDeniedError();
      case 'REDEMPTION_RATE_MARKET_ACCESS_DENIED':
        return redemptionMarketAccessDeniedError();
      case 'REDEMPTION_RATE_MARKET_NOT_FOUND':
        return redemptionMarketNotFoundError();
      case 'REDEMPTION_RATE_MARKET_SELECTION_REQUIRED':
        return redemptionMarketSelectionRequiredError();
      case 'REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH':
        return redemptionMarketContextMismatchError();
      case 'REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED':
        return redemptionIdempotencyKeyRequiredError();
      case 'REDEMPTION_RATE_REASON_REQUIRED':
        return redemptionReasonRequiredError();
      case 'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT':
        return redemptionIdempotencyConflictError();
      case 'REDEMPTION_RATE_PRECISION_EXCEEDED':
        return redemptionRatePrecisionExceededError();
      case 'REDEMPTION_RATE_MARKET_BLOCKED':
        return redemptionRateMarketBlockedError(marketCode ?? '');
      case 'REDEMPTION_RATE_BELOW_MINIMUM':
        return redemptionRateBelowMinimumError();
      case 'REDEMPTION_RATE_ABOVE_MAXIMUM':
        return redemptionRateAboveMaximumError();
      case 'REDEMPTION_RATE_CURRENCY_MISMATCH':
        return redemptionRateCurrencyMismatchError();
      case 'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE':
        return redemptionActivationNotFutureError();
      case 'REDEMPTION_RATE_OVERLAP':
        return redemptionRateOverlapError();
      case 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE':
        return redemptionRateCannotCancelEffectiveError();
      case 'REDEMPTION_RATE_ALREADY_CANCELLED':
        return redemptionRateAlreadyCancelledError();
      case 'REDEMPTION_RATE_NOT_FOUND':
        return redemptionRateVersionNotFoundError();
      default:
        // Never thrown by the secured create/cancel commands; propagate.
        throw error;
    }
  }
}

// ─── Display helpers (string only — never float arithmetic) ─────────

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

/** Build the §7.2 config DTO from the approved rule. */
function toConfigDto(rule: {
  initialRate: string;
  minimumRate: string;
  maximumRate: string;
  currency: string;
  displayUnit: string;
}): AdminRedemptionRateConfigDto {
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
