/**
 * P7-S5B Admin Merchant Operations — read surface types.
 *
 * The adapter composes owner-owned Phase 1 read surfaces into a single
 * selected-market branch-detail read. Every embedded shape is returned
 * EXACTLY as the owner service produced it (no recomputation, no unmasking,
 * no invented fields). Only the `packages` projection is assembled here: a
 * read-only projection over immutable owner-owned package assignment history
 * (the Phase 1 owner exposes no admin package-history read surface).
 */

/** Owner `MerchantService.getProfile` output (passthrough). */
export interface AdminMerchantProfileDto {
  branch_id: string;
  merchant_id: string;
  market_id: string;
  display_name: string;
  primary_email: string;
  phone: string | null;
  address: string | null;
  about: string | null;
  business_hours: string | null;
  website: string | null;
  whatsapp: string | null;
  socials: Record<string, unknown> | null;
  logo_object_key: string | null;
  banner_object_key: string | null;
  gallery: Array<{
    id: string;
    object_key: string;
    position: number;
  }>;
}

/** Owner `MerchantService.getApplication` output (passthrough). */
export interface AdminMerchantApplicationDetailDto {
  application_id: string;
  status: string;
  operational_status: string;
  submissions: Array<{
    id: string;
    version: number;
    submitted_at: Date | string;
  }>;
  reviews: Array<{
    id: string;
    decision: string;
    reason: string;
    decided_at: Date | string;
  }>;
}

/** Owner `MerchantService.getKyc` output (passthrough, owner-masked). */
export interface AdminMerchantKycDetailDto {
  current: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
}

/** Owner `McpService.summary` output (passthrough). */
export interface AdminMerchantMcpAccountDto {
  id: string;
  branch_id: string;
  market_id: string;
  available_balance: string;
  total_balance: string;
  status: string;
  version: number;
}

/** Owner `McpService.reconcile` output (passthrough). */
export interface AdminMerchantMcpReconciliationDto {
  account_id: string;
  stored: { total: string; available: string };
  computed: { total: string; available: string; entries: number };
  matches: boolean;
}

/** Owner `McpService.adminLedger` output (passthrough, bounded). */
export interface AdminMerchantMcpLedgerPageDto {
  items: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
}

/**
 * Phase 7 read-only package-history projection item. Assembled from the
 * immutable owner-owned assignment/version/special-percentage rows; this
 * projection never writes and never re-prices anything.
 */
export interface AdminMerchantPackageHistoryItemDto {
  assignment_id: string;
  service_fee_profile_id: string | null;
  service_fee_profile_code: string | null;
  service_fee_profile_name: string | null;
  service_fee_version_id: string | null;
  rate: string | null;
  effective_from: string | null;
  effective_to: string | null;
  special_percentage_id: string | null;
  special_percentage_rate: string | null;
  special_percentage_description: string | null;
  status: string;
  is_default: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AdminMerchantPackageHistoryDto {
  items: AdminMerchantPackageHistoryItemDto[];
  limit: number;
  offset: number;
}

export interface AdminMerchantMcpSummaryDto {
  account: AdminMerchantMcpAccountDto;
  reconciliation: AdminMerchantMcpReconciliationDto | null;
  recent_ledger: AdminMerchantMcpLedgerPageDto | null;
}

/**
 * Selected-market branch detail. `mcp` is null when the branch has no MCP
 * account yet (owner behavior: MCP_ACCOUNT_NOT_FOUND is surfaced as
 * unavailable, never fabricated).
 */
export interface AdminMerchantBranchDetailDto {
  branch_id: string;
  merchant_id: string;
  market_id: string;
  profile: AdminMerchantProfileDto;
  application: AdminMerchantApplicationDetailDto;
  kyc: AdminMerchantKycDetailDto;
  packages: AdminMerchantPackageHistoryDto;
  mcp: AdminMerchantMcpSummaryDto | null;
}
