/**
 * P7-S6B Admin Reward Configuration adapter types (frozen contract §7.1,
 * decisions P7-OD-04 / P7-OD-05, D-046).
 *
 * Phase 7 read projections + orchestration over the canonical Phase 3
 * reward owner (`apps/api/src/admin-reward`, D-052/D-050). The adapter
 * never duplicates owner formulas and never mutates domain tables: the
 * create command delegates the ENTIRE create — rate bounds/precision,
 * future market-local 00:00 activation, overlap, advisory lock, operation-
 * scoped idempotency claim + canonical payload hash, mandatory reason,
 * selected-market enforcement and the atomic owner audit — to the secured
 * owner command `AdminRewardService.createRuleVersion` (D-050). The
 * adapter keeps only Phase 7 orchestration/read/UI behavior: the §7.1
 * package-reference surface (A `0.0125%`, B `0.025%`, C/D/E/F `0.05%`),
 * the market-local date → UTC instant conversion, and the read projection.
 *
 * Rate semantics: the frozen contract §7.1 input/display unit is `%/day`
 * with a `0%`–`0.05%/day` governance range and a maximum of six input
 * decimals; package references A `0.0125%`, B `0.025%`, C/D/E/F `0.05%`
 * per day maximum. Rates are always exact decimal strings
 * (`numeric(38,10)` rows, string DTOs) — never JavaScript numbers.
 */

/** §7.1 package-reference maxima (LOCKED under D-046; `%/day`). */
export const REWARD_PACKAGE_REFERENCE_MAX_RATE = {
  A: '0.0125',
  B: '0.025',
  C: '0.05',
  D: '0.05',
  E: '0.05',
  F: '0.05',
} as const;

/** §7.1 absolute governance ceiling (`%/day`). Above this needs new governance. */
export const REWARD_RATE_GOVERNANCE_MAX = '0.05';

/** §7.1 maximum input precision (decimal places). */
export const REWARD_RATE_MAX_DECIMALS = 6;

/** Exact-decimal scale used for string comparisons (10^6). */
export const REWARD_RATE_SCALE = 1_000_000;

/** Deterministic surface name prefix for versions created through this surface. */
export const REWARD_RULE_SURFACE_NAME_PREFIX = 'Package ';

/** Deterministic surface name suffix for versions created through this surface. */
export const REWARD_RULE_SURFACE_NAME_SUFFIX = ' Reward Rate';

export type AdminRewardOpsErrorCode =
  | 'REWARD_MARKET_NOT_FOUND'
  | 'REWARD_RATE_OUT_OF_RANGE'
  | 'REWARD_RATE_PRECISION_EXCEEDED'
  | 'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT'
  | 'REWARD_RATE_EXCEEDS_PACKAGE_MAX'
  | 'REWARD_ACTIVATION_NOT_FUTURE'
  | 'REWARD_EFFECTIVE_WINDOW_OVERLAP'
  | 'REWARD_IDEMPOTENCY_CONFLICT'
  | 'REWARD_RULE_VERSION_NOT_FOUND'
  // ─── Canonical owner-sourced codes (D-050 rewiring, order §8) ─────
  // The adapter surfaces the pre-existing REWARD_* codes for the
  // violations the owner re-validates inside its command; these extra
  // codes carry the owner's identity/selected-market errors (the same
  // codes the canonical RbacGuard uses at the transport boundary).
  | 'PERMISSION_DENIED'
  | 'MARKET_ACCESS_DENIED'
  | 'MARKET_SELECTION_REQUIRED'
  | 'MARKET_CONTEXT_MISMATCH'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'REASON_REQUIRED';

export class AdminRewardOpsError extends Error {
  constructor(
    readonly code: AdminRewardOpsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminRewardOpsError';
  }
}

/**
 * Server-derived actor for the adapter surface.
 *
 * `currentMarketId`/`marketContextVersion` carry the server-owned Current
 * Admin Market resolved by the canonical RbacGuard on HTTP routes and are
 * passed through into the owner command so in-process callers get the
 * exact same selected-market enforcement as the canonical route.
 */
export interface AdminRewardOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  currentMarketId?: string;
  marketContextVersion?: number;
}

/**
 * Window status of a rule version inside the selected-market schedule.
 * The adapter projects the *effective* window of each market-scoped version
 * as `[effective_from, window_end)` where `window_end` is the earlier of an
 * explicit `effective_to` (frozen settlement semantics: effective while
 * `effective_to` is null or `effective_to > date`) and the next version's
 * `effective_from`. The frozen settlement resolves exactly one effective
 * version per market-local day (latest effective_from wins inside the
 * window), so the projected windows never overlap and nothing historical
 * is ever recalculated.
 */
export type AdminRewardWindowStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'EXPIRED'
  | 'ARCHIVED';

/** One reward rule version, projected for the selected market. */
export interface AdminRewardRuleVersionDto {
  id: string;
  name: string;
  description: string | null;
  /** Exact decimal string (`%/day`), e.g. "0.050000" — never a float. */
  reward_rate: string;
  cap_type: string;
  cap_value: string;
  minimum_reward: string;
  /**
   * `A`–`F` when the version was created through this surface (deterministic
   * `Package <X> Reward Rate` name); `null` for any other rule version.
   */
  package_reference: string | null;
  /** Resolved UTC instant of the market-local 00:00 activation. */
  effective_from_utc: string;
  /** Market-local wall time of the activation (IANA market timezone). */
  effective_from_local: string;
  /** Effective window end (earlier of the next version start and the
   * explicit `effective_to`), market-local / UTC. */
  effective_until_utc: string | null;
  effective_until_local: string | null;
  /** IANA market timezone used for the local resolutions. */
  timezone: string;
  window_status: AdminRewardWindowStatus;
  market_id: string | null;
  created_by: string;
  created_at: string;
}

/** §7.1 package reference shown in the configuration surface. */
export interface AdminRewardPackageReferenceDto {
  code: string;
  /** Exact decimal string (`%/day`), e.g. "0.0125" — never a float. */
  max_rate_per_day: string;
}

/** Selected-market reward configuration read model. */
export interface AdminRewardRuleListResponse {
  marketId: string;
  timezone: string;
  packages: AdminRewardPackageReferenceDto[];
  rules: AdminRewardRuleVersionDto[];
}

/** Create-command result (also the stored idempotency replay payload). */
export interface AdminRewardRuleCreateResponse {
  id: string;
  package_reference: string;
  /** Exact decimal string (`%/day`). */
  reward_rate: string;
  effective_date: string;
  effective_from_utc: string;
  effective_from_local: string;
  timezone: string;
  market_id: string;
  created_by: string;
  created_at: string;
}
