/**
 * P7-S6A Admin Package Operations adapter types.
 *
 * Phase 7 selected-market read projections for the merchant package
 * configuration surface (frozen contract §7.3). Every value is a read-only
 * projection of immutable Phase 1 owner-owned rows: standard package
 * profiles/versions (`service_fee_profiles` / `service_fee_versions`) and
 * special percentages (`special_percentages`). Rates are carried as exact
 * decimal strings (PostgreSQL `numeric(12,6)` values, never floats).
 *
 * This surface never writes domain state: all configuration writes stay on
 * the frozen Phase 1 owner commands (`merchant.package.manage`,
 * `merchant.package.assign`, `merchant.special_package.manage`). The
 * special-percentage *creation* command is intentionally NOT exposed here —
 * see the module docs for the owner-gap record (mandatory reason).
 */

export type AdminPackageOpsErrorCode = 'PACKAGE_OPS_MARKET_MISMATCH';

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

/** Adapter actor (mirrors the owner admin-actor contract). */
export interface AdminPackageOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
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
