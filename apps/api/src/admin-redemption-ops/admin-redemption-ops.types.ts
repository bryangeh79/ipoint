/**
 * P7-S6C Admin Redemption Rate Configuration adapter types (frozen contract
 * §7.2, D-046).
 *
 * Phase 7 read projection + orchestrated create over the frozen Phase 6
 * redemption owner (`apps/api/src/redemption`). The adapter never mutates
 * domain tables and never duplicates owner formulas: the single
 * `redemption_rate_versions` insert delegates to the frozen owner command
 * (`RedemptionService.createRateVersion`) unchanged.
 *
 * Rate semantics (frozen contract §7.2):
 * - Independent per market; no universal rate and NO other-market
 *   fallback. A market without an approved configuration shows the
 *   explicit blocked state.
 * - Immutable forward-only versions; quotes and orders retain their
 *   original Rate Version (frozen OD-22 rate locking — this surface never
 *   reprices history).
 * - Technical ceiling ten decimals; UI displays up to six. Storage
 *   (`numeric(38,10)`) and the API carry the full precision; the display
 *   string is derived server-side and is display-only.
 * - Malaysia (market code `MY`): local currency value per 1 iPoint —
 *   initial RM1.00, minimum RM0.50, maximum RM2.00. Other markets stay
 *   blocked until Initial, Minimum, Maximum, Currency, and Display Unit
 *   are approved.
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

/** Exact-decimal scale used for string comparisons (10^10). */
export const REDEMPTION_RATE_SCALE = 10_000_000_000n;

/**
 * One approved per-market redemption rate configuration (CONFIGURABLE —
 * versioned Phase 7 rules). Values are read from this versioned rule
 * structure, never hard-coded in logic. A market is BLOCKED until a rule
 * exists for its market code; there is no cross-market fallback.
 */
export interface RedemptionRateMarketRule {
  /** Canonical market code this rule applies to (e.g. `MY` = Malaysia). */
  marketCode: string;
  /** §7.2 initial rate (local currency per 1 iPoint), exact string. */
  initialRate: string;
  /** §7.2 minimum rate, exact string. */
  minimumRate: string;
  /** §7.2 maximum rate, exact string. */
  maximumRate: string;
  /** ISO-4217 currency code of the rate (e.g. `MYR`). */
  currency: string;
  /** Display unit shown with the rate (e.g. `RM per 1 iPoint`). */
  displayUnit: string;
}

/**
 * Approved per-market rules (versioned rules, D-046 §7.2 Malaysia values).
 * Malaysia initial RM1.00 / minimum RM0.50 / maximum RM2.00 per 1 iPoint.
 * Every other market stays blocked until its values are approved — no
 * fallback to Malaysia or any other market.
 */
export const REDEMPTION_RATE_MARKET_RULES: Readonly<
  Record<string, RedemptionRateMarketRule>
> = {
  MY: {
    marketCode: 'MY',
    initialRate: '1.0000000000',
    minimumRate: '0.5000000000',
    maximumRate: '2.0000000000',
    currency: 'MYR',
    displayUnit: 'RM per 1 iPoint',
  },
};

/**
 * The versioned-rules map type (keyed by market code, uppercase).
 * Injectable so the approval catalog can evolve without touching logic.
 */
export type RedemptionRateMarketRulesMap = Readonly<
  Record<string, RedemptionRateMarketRule>
>;

/**
 * DI token for the approved per-market redemption rate rules. The default
 * value is `REDEMPTION_RATE_MARKET_RULES` (D-046 §7.2); the integration
 * suite overrides the provider with additional test codes carrying the
 * same Malaysia values so multi-market evidence can be produced without
 * altering the production approval catalog.
 */
export const REDEMPTION_RATE_RULES_PROVIDER = Symbol(
  'REDEMPTION_RATE_RULES_PROVIDER',
);

export type AdminRedemptionOpsErrorCode =
  | 'REDEMPTION_MARKET_NOT_FOUND'
  | 'REDEMPTION_RATE_MARKET_BLOCKED'
  | 'REDEMPTION_RATE_BELOW_MINIMUM'
  | 'REDEMPTION_RATE_ABOVE_MAXIMUM'
  | 'REDEMPTION_RATE_PRECISION_EXCEEDED'
  | 'REDEMPTION_ACTIVATION_NOT_FUTURE'
  | 'REDEMPTION_RATE_OVERLAP'
  | 'REDEMPTION_IDEMPOTENCY_CONFLICT'
  | 'REDEMPTION_RATE_VERSION_NOT_FOUND';

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

/** Server-derived actor for adapter audit records. */
export interface AdminRedemptionOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
}

/**
 * Window status of a rate version inside the selected-market chain.
 * The frozen owner resolution
 * (`RedemptionService.getEffectiveRate`: latest `effective_from` whose
 * window covers the instant wins) closes each version's window at the
 * earlier of an explicit `effective_until` and the next version's
 * `effective_from`. Versions created through this surface are always
 * open-ended, so their windows are pure chain steps
 * `[effective_from, next effective_from)`.
 */
export type AdminRedemptionRateWindowStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'EXPIRED';

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

/** Create-command result (also the stored idempotency replay payload). */
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
