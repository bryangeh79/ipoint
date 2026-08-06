/**
 * P7-S6D Admin Commission Rate Configuration adapter types (D-054 §16 /
 * D-055 §8).
 *
 * Phase 7 read projection + orchestrated create over the SECURED Phase 5
 * commission-rate owner (`apps/api/src/domain/commission/rate.service.ts`).
 * The adapter never mutates domain tables and never duplicates owner
 * formulas: the single `commission_rate_version` insert, the idempotency
 * claim and the privileged audit all live inside
 * `RateManagementService.createRateVersion` (D-054 §5–§12).
 *
 * Rate semantics (frozen Phase 5 / P5-S0 §10, D-054):
 * - Independent per market; versions are immutable and forward-only
 *   (prospective activation only; history is never recalculated).
 * - Frozen taxonomy: AGENT_UPGRADE = FIXED (G1/G2), MEMBER_CONSUMPTION =
 *   PERCENTAGE (G1/G2), MERCHANT_RECRUITMENT = PERCENTAGE (G0),
 *   AGENT_ACTIVATION_FEE = FIXED (G0). FIXED rates are denominated in the
 *   selected market's currency.
 * - Technical ceiling ten decimals; the UI displays at most six. Storage
 *   (`numeric(38,10)`) and the API carry the full precision; the display
 *   string is derived server-side and is display-only.
 * - Effective windows are half-open `[effective_from, window_end)` with
 *   the owner's logical half-open resolution: a successor version's start
 *   closes the open-ended predecessor's window (`[start, next_start)`).
 *
 * The surface exposes the frozen taxonomy for the configuration UI only;
 * every enforcement (RBAC, selected market, taxonomy, exact rate bounds,
 * overlap/concurrency, idempotency, reason, audit) stays inside the
 * secured owner command.
 */

/**
 * Window status of a rate version inside the selected-market chain of one
 * (commission_type, generation) definition. Mirrors the accepted S6B/S6C
 * projection semantics:
 * - `SUPERSEDED` — a later-start successor exists (its start closes this
 *   version's window);
 * - `EXPIRED` — this version's explicit window end has passed and no
 *   successor supersedes it;
 * - `SCHEDULED` — strictly future start;
 * - `ACTIVE` — the version whose window covers the current instant (the
 *   owner resolution: latest start ≤ now wins).
 */
export type AdminCommissionRateWindowStatus =
  | 'ACTIVE'
  | 'SCHEDULED'
  | 'SUPERSEDED'
  | 'EXPIRED';

/** One commission rate version, projected for the selected market. */
export interface AdminCommissionRateVersionDto {
  id: string;
  commission_type: string;
  generation: number;
  /** PERCENTAGE or FIXED (frozen commission-type contract). */
  rate_type: string;
  /** Full technical precision (up to 10 decimals) — exact string. */
  rate_value: string;
  /** Display-only value with at most 6 decimals (never stored/rounded). */
  display_rate: string;
  /** Resolved UTC instant of the market-local 00:00 activation. */
  effective_from_utc: string;
  /** Market-local wall time of the activation (IANA market timezone). */
  effective_from_local: string;
  /**
   * Projected window end: the earlier of the next version's start and an
   * explicit `effective_until` (null = open window / no successor).
   */
  effective_until_utc: string | null;
  effective_until_local: string | null;
  window_status: AdminCommissionRateWindowStatus;
  /** Durable operator reason (D-054 §11); null on legacy pre-0032 rows. */
  reason: string | null;
  created_by: string;
  created_at: string;
}

/** Frozen taxonomy entry for the configuration UI (D-054 §6 contract). */
export interface AdminCommissionTaxonomyEntryDto {
  commission_type: string;
  /** FIXED or PERCENTAGE — the frozen rate type for this commission type. */
  rate_type: string;
  /** Allowed generations for this commission type (0, 1 and/or 2). */
  generations: number[];
}

/**
 * One (commission_type, generation) definition of the selected market:
 * the current effective version, the scheduled future versions and the
 * full immutable history. Definitions are always emitted for every frozen
 * taxonomy pair so the configuration table shows the explicit
 * "not configured yet" state per definition.
 */
export interface AdminCommissionRateDefinitionDto {
  commission_type: string;
  generation: number;
  /** Frozen rate type for this commission type. */
  rate_type: string;
  /** The version whose window covers now (owner resolution), or null. */
  current: AdminCommissionRateVersionDto | null;
  /** Strictly-future versions, soonest first. */
  scheduled: AdminCommissionRateVersionDto[];
  /** Every version of this definition, newest first. */
  history: AdminCommissionRateVersionDto[];
}

/** Selected-market commission rate configuration read model. */
export interface AdminCommissionRateListResponse {
  market_id: string;
  market_code: string;
  timezone: string;
  /** Market currency — FIXED rates are denominated in it. */
  currency: string;
  /**
   * `true` when the market is present and ACTIVE (the owner only manages
   * ACTIVE markets); `false` means the market is blocked for rate
   * management (explicit state, never a fallback to another market).
   */
  configured: boolean;
  /** Frozen commission taxonomy (display/UI only — the owner enforces). */
  taxonomy: AdminCommissionTaxonomyEntryDto[];
  /** Per (commission_type, generation) configuration of the market. */
  definitions: AdminCommissionRateDefinitionDto[];
}

/** Create-command result (owner-resolved activation + surface fields). */
export interface AdminCommissionRateCreateResponse {
  id: string;
  commission_type: string;
  generation: number;
  rate_type: string;
  /** Full technical precision (up to 10 decimals) — exact string. */
  rate_value: string;
  /** Display-only value with at most 6 decimals. */
  display_rate: string;
  effective_date: string;
  effective_from_utc: string;
  effective_from_local: string;
  timezone: string;
  market_id: string;
  created_by: string;
  created_at: string;
}

/**
 * Server-derived actor for the adapter's owner delegation. Built by the
 * controller from the authenticated session (CurrentActor), the
 * RbacGuard-resolved Current Admin Market, the request correlation id and
 * the IP address. Client input never reaches the actor object.
 */
export interface AdminCommissionOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  /**
   * Server-owned Current Admin Market resolved by the canonical RbacGuard
   * (D-054 §5). Passed through into the secured owner command so it
   * applies the exact same selected-market enforcement as the canonical
   * route.
   */
  currentMarketId?: string;
  marketContextVersion?: number;
}

/** S6D external error codes (canonical commission-rate surface). */
export type AdminCommissionOpsErrorCode =
  | 'COMMISSION_MARKET_NOT_FOUND'
  | 'COMMISSION_RATE_MARKET_NOT_FOUND'
  | 'COMMISSION_RATE_PERMISSION_DENIED'
  | 'COMMISSION_RATE_MARKET_ACCESS_DENIED'
  | 'COMMISSION_RATE_MARKET_SELECTION_REQUIRED'
  | 'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH'
  | 'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED'
  | 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT'
  | 'COMMISSION_RATE_REASON_REQUIRED'
  | 'COMMISSION_RATE_PRECISION_EXCEEDED'
  | 'COMMISSION_RATE_PERCENTAGE_LIMIT'
  | 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE'
  | 'COMMISSION_RATE_TIMEZONE_MISMATCH'
  | 'INVALID_COMMISSION_TYPE'
  | 'INVALID_GENERATION'
  | 'INVALID_RATE_TYPE'
  | 'RATE_TYPE_MISMATCH'
  | 'INVALID_MARKET'
  | 'INVALID_RATE_VALUE'
  | 'INVALID_EFFECTIVE_RANGE'
  | 'INVALID_TIMESTAMP'
  | 'OVERLAPPING_RATE_PERIOD';

export class AdminCommissionOpsError extends Error {
  constructor(
    readonly code: AdminCommissionOpsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminCommissionOpsError';
  }
}
