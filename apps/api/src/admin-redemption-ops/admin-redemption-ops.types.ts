/**
 * P7-S6C Admin Redemption Rate Configuration adapter types (frozen contract
 * §7.2, D-046; rewired to the D-053 secured owner, order §15).
 *
 * Phase 7 read projection + orchestrated create/cancel over the secured
 * Phase 6 redemption owner (`apps/api/src/redemption`). The adapter never
 * mutates domain tables and never duplicates owner formulas: the single
 * `redemption_rate_versions` insert and the append-only cancellation
 * events delegate to the secured owner commands
 * (`RedemptionService.createRateVersion` / `cancelRateVersion`) with the
 * mandatory reason, the client Idempotency-Key and the server Current
 * Admin Market (D-053 contract).
 *
 * Rate semantics (frozen contract §7.2):
 * - Independent per market; no universal rate and NO other-market
 *   fallback. A market without an approved configuration shows the
 *   explicit blocked state (`configured: false` — resolved from the
 *   canonical `redemption_rate_market_rules` table, the same source the
 *   secured owner enforces).
 * - Immutable forward-only versions; quotes and orders retain their
 *   original Rate Version (frozen OD-22 rate locking — this surface never
 *   reprices history). A scheduled version can be voided by an
 *   append-only cancellation event (D-053 §9); the resolver ignores
 *   cancelled versions forever.
 * - Technical ceiling ten decimals; UI displays up to six. Storage
 *   (`numeric(38,10)`) and the API carry the full precision; the display
 *   string is derived server-side and is display-only.
 * - Malaysia (market code `MY`): local currency value per 1 iPoint —
 *   initial RM1.00, minimum RM0.50, maximum RM2.00 (seeded in the
 *   canonical rules table, D-053 §6). Other markets stay blocked until
 *   Initial, Minimum, Maximum, Currency, and Display Unit are approved.
 *
 * The surface configures the canonical conversion rate type the frozen
 * redemption flow actually consumes at quote time:
 * `POINTS_PER_CURRENCY` (required_iPoint = fiat_reference_value / rate —
 * a value of 1.00 means 1.00 fiat per 1 iPoint, i.e. the §7.2 Malaysia
 * "RM1.00 per 1 iPoint" baseline).
 */

/** The canonical redemption rate type this surface configures. */
export const REDEMPTION_RATE_TYPE = 'POINTS_PER_CURRENCY';

/** §7.2 technical precision ceiling (stored `numeric(38,10)`). */
export const REDEMPTION_RATE_TECHNICAL_DECIMALS = 10;

/** §7.2 display precision ceiling (UI shows at most 6 decimals). */
export const REDEMPTION_RATE_DISPLAY_DECIMALS = 6;

export type AdminRedemptionOpsErrorCode =
  | 'REDEMPTION_MARKET_NOT_FOUND'
  | 'REDEMPTION_RATE_MARKET_BLOCKED'
  | 'REDEMPTION_RATE_BELOW_MINIMUM'
  | 'REDEMPTION_RATE_ABOVE_MAXIMUM'
  | 'REDEMPTION_RATE_CURRENCY_MISMATCH'
  | 'REDEMPTION_RATE_PRECISION_EXCEEDED'
  | 'REDEMPTION_ACTIVATION_NOT_FUTURE'
  | 'REDEMPTION_RATE_OVERLAP'
  | 'REDEMPTION_IDEMPOTENCY_CONFLICT'
  | 'REDEMPTION_RATE_VERSION_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'MARKET_ACCESS_DENIED'
  | 'MARKET_SELECTION_REQUIRED'
  | 'MARKET_CONTEXT_MISMATCH'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'REASON_REQUIRED'
  | 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE'
  | 'REDEMPTION_RATE_ALREADY_CANCELLED';

export class AdminRedemptionOpsError extends Error {
  constructor(
    readonly code: AdminRedemptionOpsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminRedemptionOpsError';
  }
}

/** Server-derived actor for the adapter's owner delegation. */
export interface AdminRedemptionOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  /**
   * Server-owned Current Admin Market resolved by the canonical RbacGuard
   * (D-053 §5). Passed through into the secured owner commands so they
   * apply the exact same selected-market enforcement as the canonical
   * route.
   */
  currentMarketId?: string;
  marketContextVersion?: number;
}

/**
 * Window status of a rate version inside the selected-market chain.
 * The frozen owner resolution
 * (`RedemptionService.getEffectiveRate`: latest `effective_from` whose
 * window covers the instant wins, cancelled versions ignored — D-053 §9)
 * closes each version's window at the earlier of an explicit
 * `effective_until` and the next NON-cancelled version's `effective_from`.
 * A cancelled scheduled version is void: it never becomes effective, never
 * closes or supersedes a predecessor window, and is projected with the
 * explicit `CANCELLED` status.
 */
export type AdminRedemptionRateWindowStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'CANCELLED';

/** One redemption rate version, projected for the selected market. */
export interface AdminRedemptionRateVersionDto {
  id: string;
  /** Canonical conversion rate type (`POINTS_PER_CURRENCY`). */
  rate_type: string;
  /** Full technical precision (up to 10 decimals) — exact string. */
  rate_value: string;
  /** Display-only value with at most 6 decimals (never stored/rounded). */
  display_rate: string;
  /** Resolved UTC instant of the market-local 00:00 activation. */
  effective_from_utc: string;
  /** Market-local wall time of the activation (IANA market timezone). */
  effective_from_local: string;
  /** Effective window end (earlier of the next version start and the
   * explicit `effective_until`), market-local / UTC. */
  effective_until_utc: string | null;
  effective_until_local: string | null;
  window_status: AdminRedemptionRateWindowStatus;
  created_by: string;
  created_at: string;
}

/** The approved configuration bounds of the selected market (or null). */
export interface AdminRedemptionRateConfigDto {
  /** Exact initial rate (local currency per 1 iPoint). */
  initial_rate: string;
  /** Exact minimum rate — validation bound (below → rejected). */
  minimum_rate: string;
  /** Exact maximum rate — validation bound (above → rejected). */
  maximum_rate: string;
  currency: string;
  display_unit: string;
  /** §7.2 technical precision ceiling (10). */
  technical_decimals: number;
  /** §7.2 display precision ceiling (6). */
  display_decimals: number;
}

/** Selected-market redemption rate configuration read model. */
export interface AdminRedemptionRateListResponse {
  market_id: string;
  market_code: string;
  timezone: string;
  /**
   * `true` when the market has an approved rate configuration; `false`
   * means the market is blocked (no fallback to any other market).
   */
  configured: boolean;
  /** The approved bounds when `configured`; `null` when blocked. */
  config: AdminRedemptionRateConfigDto | null;
  /** All `POINTS_PER_CURRENCY` versions of the market (newest first). */
  rates: AdminRedemptionRateVersionDto[];
}

/** Create-command result (owner-resolved activation + surface fields). */
export interface AdminRedemptionRateCreateResponse {
  id: string;
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

/** Cancel-command result (append-only cancellation event, D-053 §9). */
export interface AdminRedemptionRateCancelResponse {
  /** Cancellation event id (immutable row in the cancellations table). */
  id: string;
  /** The cancelled rate-version id (its immutable row is untouched). */
  rate_version_id: string;
  market_id: string;
  /** Normalized exact rate of the cancelled version. */
  rate_value: string;
  /** Resolved UTC instant of the cancelled version's activation. */
  effective_from_utc: string;
  /** Mandatory operator reason stored on the cancellation event. */
  reason: string;
  cancelled_by: string;
  cancelled_at: string;
}
