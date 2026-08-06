/**
 * P7-S6E Secured Market Owner — types (D-048 implementer scope).
 *
 * The secured owner command for the `markets` registry lives in the
 * Phase 7 market domain (`apps/api/src/market/`) as a NEW module — the
 * existing member-facing behavior (`MarketService.getMarket` /
 * `MarketService.updateMarket`, `MarketController`) is untouched.
 *
 * Market semantics (canonical RbacGuard, marketScoped):
 * - `market.manage` is SUPER_ADMIN-only, marketScoped, step-up required.
 *   The RbacGuard resolves the server-owned Current Admin Market and
 *   asserts the URL `:marketId` equals it (409 MARKET_CONTEXT_MISMATCH
 *   otherwise). The managed market is therefore ALWAYS the Current Admin
 *   Market — there is no "manage any market" surface. The owner re-checks
 *   the same contract in-process.
 * - `market.read` is ALL roles, marketScoped.
 * - Only ACTIVE markets can be a Current Admin Market (the guard's
 *   `hasMarketAccess` requires `markets.status = 'ACTIVE'` and a
 *   non-revoked `market_access` row). Consequently this surface can
 *   DEACTIVATE the current market but cannot re-activate an INACTIVE one
 *   (the guard denies every request for a non-ACTIVE market). This is the
 *   documented guard semantics (P7-S6E delivery report §market contract).
 *
 * Controlled change surface (no general row editor):
 * - status: ACTIVE ↔ INACTIVE (deactivation requires dependency
 *   validation + explicit deactivation confirmation)
 * - name / currencyCode / timezone / defaultLocale: controlled field
 *   updates with format validation. No batch, no cross-market automatic
 *   replication, no silent defaults.
 */

/**
 * Server-derived actor for the secured market owner. Built exclusively by
 * the Phase 7 adapter controller from the authenticated session
 * (CurrentActor), the RbacGuard `adminMarketContext`, the request
 * correlation id and the IP address. Client input never reaches this
 * object — actor identity cannot be forged.
 */
export interface MarketOwnerActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  /**
   * Server-owned Current Admin Market resolved by the canonical RbacGuard
   * (marketScoped). The managed market MUST equal this market; the owner
   * rejects any command whose market disagrees (MARKET_CONTEXT_MISMATCH).
   */
  currentMarketId?: string;
  marketContextVersion?: number;
}

/**
 * Controlled patch of a market row. At least one controlled field is
 * required; unknown fields are rejected by the strict transport DTO
 * before the owner is reached and by the owner's own field allowlist.
 */
export interface MarketUpdateFields {
  /** ACTIVE ↔ INACTIVE status transition. */
  status?: 'ACTIVE' | 'INACTIVE';
  /** Market display name (trimmed, 1..200 chars). */
  name?: string;
  /** ISO 4217 currency code (3 uppercase letters). */
  currencyCode?: string;
  /** IANA timezone identifier (validated). */
  timezone?: string;
  /** BCP-47-style locale (validated). */
  defaultLocale?: string;
}

/**
 * Secured market update command (owner boundary).
 *
 * `deactivationConfirmed` is the server-side "explicit confirmation"
 * (P7-S1 §agent fee and market configuration) for the ACTIVE → INACTIVE
 * transition — a plain boolean in the body, re-validated by the owner;
 * it is NOT a client-supplied authorization.
 */
export interface UpdateMarketCommand extends MarketUpdateFields {
  /** Mandatory Idempotency-Key (operation-scoped replay protection). */
  idempotencyKey: string;
  /** Mandatory operator reason (1..500 chars after trim). */
  reason: string;
  /** Explicit confirmation required for the ACTIVE → INACTIVE transition. */
  deactivationConfirmed?: boolean;
}

/** One field difference applied by the update (audit + response). */
export interface MarketFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Owner update result (replayed verbatim on same-key/same-payload). */
export interface UpdateMarketResponse {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  currencyCode: string;
  timezone: string;
  defaultLocale: string;
  updatedAt: string;
  changed: MarketFieldChange[];
  /** Canonical payload digest (sha256 hex) of the committed command. */
  idempotencyDigest: string;
}

/**
 * Phase 7 read projection of the selected market (market registry, no
 * member-facing defaults). `configured: false` is the explicit blocked
 * signal for a market that is not ACTIVE — the surface never falls back
 * to another market (S6D blocked-state convention). Over HTTP the
 * canonical RbacGuard denies non-ACTIVE markets with 403 first.
 */
export interface MarketDetailResponse {
  market_id: string;
  market_code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  currency_code: string;
  timezone: string;
  default_locale: string;
  created_at: string;
  updated_at: string;
  /** `true` when the market is ACTIVE (managed); `false` = blocked. */
  configured: boolean;
}

/** S6E external error codes (owner contract). */
export type MarketOwnerErrorCode =
  | 'MARKET_PERMISSION_DENIED'
  | 'MARKET_ACCESS_DENIED'
  | 'MARKET_SELECTION_REQUIRED'
  | 'MARKET_CONTEXT_MISMATCH'
  | 'MARKET_NOT_FOUND'
  | 'MARKET_REASON_REQUIRED'
  | 'MARKET_IDEMPOTENCY_KEY_REQUIRED'
  | 'MARKET_IDEMPOTENCY_CONFLICT'
  | 'MARKET_NO_CHANGES'
  | 'MARKET_INVALID_FIELD'
  | 'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED'
  | 'MARKET_DEACTIVATION_DEPENDENCY'
  | 'MARKET_UPDATE_FAILED';

/**
 * HTTP surface mapping of the S6E external codes (controller contract):
 * - 403: MARKET_PERMISSION_DENIED / MARKET_ACCESS_DENIED
 * - 404: MARKET_NOT_FOUND
 * - 409: MARKET_SELECTION_REQUIRED / MARKET_CONTEXT_MISMATCH /
 *        MARKET_IDEMPOTENCY_CONFLICT / MARKET_DEACTIVATION_DEPENDENCY
 * - 400: MARKET_REASON_REQUIRED / MARKET_IDEMPOTENCY_KEY_REQUIRED /
 *        MARKET_NO_CHANGES / MARKET_INVALID_FIELD /
 *        MARKET_DEACTIVATION_CONFIRMATION_REQUIRED
 * - 500: MARKET_UPDATE_FAILED and any unexpected error (never swallowed
 *        into a 2xx).
 */

export class MarketOwnerError extends Error {
  constructor(
    readonly code: MarketOwnerErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MarketOwnerError';
  }
}
