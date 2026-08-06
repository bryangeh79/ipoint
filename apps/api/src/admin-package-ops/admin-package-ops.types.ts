/**
 * P7-S6A Admin Package Operations adapter types.
 *
 * Phase 7 selected-market package configuration surface (frozen contract
 * §7.3): read projections over the frozen Phase 1 owner-owned rows
 * (standard package profiles/versions and special percentages) and one
 * orchestrated create for special percentages. Every value is a
 * read-only projection of immutable Phase 1 owner-owned rows; rates are
 * carried as exact decimal strings (PostgreSQL `numeric(12,6)` values,
 * never floats).
 *
 * The special-percentage CREATE is exposed through the D-051-secured
 * Phase 1 owner command (`PackageService.createSpecialPercentage`): the
 * adapter performs only Phase 7 orchestration (server actor + market
 * context passthrough) and delegates the ENTIRE create to the owner —
 * RBAC re-check, selected-market enforcement, mandatory reason (durable
 * on the row + immutable audit), operation-scoped idempotency with the
 * canonical payload hash and the atomic owner audit. The adapter never
 * writes domain state, never persists idempotency claims, never creates
 * audit records and takes no advisory lock. All other configuration
 * writes stay on the frozen Phase 1 owner commands
 * (`merchant.package.manage`, `merchant.package.assign`).
 */

export type AdminPackageOpsErrorCode =
  | 'PACKAGE_OPS_MARKET_MISMATCH'
  | 'SPECIAL_PERCENTAGE_PERMISSION_DENIED'
  | 'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED'
  | 'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH'
  | 'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND'
  | 'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED'
  | 'SPECIAL_PERCENTAGE_REASON_REQUIRED'
  | 'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED'
  | 'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT'
  | 'SPECIAL_PERCENTAGE_CREATE_FAILED';

export class AdminPackageOpsError extends Error {
  constructor(
    readonly code: AdminPackageOpsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminPackageOpsError';
  }
}

export function packageOpsMarketMismatch(): never {
  throw new AdminPackageOpsError(
    'PACKAGE_OPS_MARKET_MISMATCH',
    'The package entity does not belong to the selected market.',
  );
}

/**
 * Adapter actor (mirrors the owner admin-actor contract, D-051 §1/§6).
 * Built by the controller exclusively from the authenticated session
 * (CurrentActor), the RbacGuard-resolved Current Admin Market
 * (`adminMarketContext`), the request correlation id and the IP address.
 * Client input never reaches the actor object.
 */
export interface AdminPackageOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  /**
   * Server-owned Current Admin Market resolved by the canonical RbacGuard
   * (marketScoped). Passed through into the secured owner command so it
   * applies the exact same selected-market enforcement as the canonical
   * Phase 1 route (D-051 §1).
   */
  currentMarketId?: string;
  marketContextVersion?: number;
}

/** Immutable standard-package version (owner-owned row projection). */
export interface AdminPackageVersionDto {
  id: string;
  profile_id: string;
  /** Exact decimal string (numeric(12,6)), e.g. "2.500000" — never a float. */
  rate: string;
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

/** Standard package profile (A–F) with its forward-only versions. */
export interface AdminPackageProfileDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  versions: AdminPackageVersionDto[];
}

/** Selected-market standard package catalog. */
export interface AdminPackageCatalogDto {
  marketId: string;
  items: AdminPackageProfileDto[];
}

/** Special percentage (owner-owned row projection; SUPER_ADMIN surface). */
export interface AdminSpecialPercentageDto {
  id: string;
  /** Exact decimal string (numeric(12,6)), e.g. "12.500000" — never a float. */
  rate: string;
  description: string | null;
  created_by_admin_user_id: string;
  created_at: string;
}

/** Selected-market special-percentage list (privileged read, audited). */
export interface AdminSpecialPercentageListDto {
  marketId: string;
  items: AdminSpecialPercentageDto[];
}

/**
 * Owner create result mapped onto the Phase 7 surface. The exact stored
 * rate and the reason come from the immutable owner row — never derived
 * or re-rounded by the adapter.
 */
export interface AdminSpecialPercentageCreateResponse {
  id: string;
  /** Exact decimal string (numeric(12,6)) — the owner-normalized value. */
  rate: string;
  description: string | null;
  /** Durable operator reason (D-051 §3), recorded on the row + audit. */
  reason: string;
  marketId: string;
  /** Market code (e.g. "MA") — resolved by the owner. */
  market: string;
  created_by: string;
  created_at: string;
}
