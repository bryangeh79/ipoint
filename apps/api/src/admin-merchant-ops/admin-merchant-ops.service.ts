import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  merchantPackageAssignments,
  serviceFeeProfiles,
  serviceFeeVersions,
  specialPercentages,
} from '@ipoint/database';
import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { McpService } from '../merchant/mcp.service.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { adminMerchantBranchNotFound } from './admin-merchant-ops.errors.js';
import type {
  AdminMerchantBranchDetailDto,
  AdminMerchantMcpSummaryDto,
  AdminMerchantPackageHistoryDto,
  AdminMerchantPackageHistoryItemDto,
  AdminMerchantProfileDto,
} from './admin-merchant-ops.types.js';

const PACKAGE_HISTORY_LIMIT = 20;
const RECENT_LEDGER_LIMIT = 10;

/**
 * P7-S5B selected-market branch-detail adapter.
 *
 * Composition-only read surface. Every domain value is delegated to the
 * frozen Phase 1 owner services (MerchantService / McpService); this service
 * never writes domain state, never unmasks owner-masked KYC data, and never
 * exposes a raw ledger export. The only projection assembled here is the
 * package-history read (the owner exposes no admin package-history read
 * surface); it is a read-only projection over immutable owner-owned rows.
 *
 * Market isolation: the controller uses the canonical RbacGuard
 * (marketScoped) so the URL market must equal the server-owned Current Admin
 * Market and the actor must hold the market grant + `merchant.view`. As
 * defense-in-depth, a branch whose market does not match the URL market is
 * reported as not found (no cross-market existence leak).
 */
@Injectable()
export class AdminMerchantOpsService {
  constructor(
    @Inject(MerchantService) private readonly merchants: MerchantService,
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async branchDetail(
    marketId: string,
    branchId: string,
  ): Promise<AdminMerchantBranchDetailDto> {
    // Owner read; throws owner MERCHANT_BRANCH_NOT_FOUND (404) when missing.
    // Cast at the adapter boundary: the owner's profile shape is structurally
    // identical, but drizzle types a few text columns as `unknown`.
    const profile = (await this.merchants.getProfile(
      branchId,
    )) as unknown as AdminMerchantProfileDto;
    if (profile.market_id !== marketId) {
      adminMerchantBranchNotFound();
    }
    const [application, kyc, packages, mcp] = await Promise.all([
      this.merchants.getApplication(branchId),
      this.merchants.getKyc(branchId),
      this.packageHistory(branchId),
      this.mcpSummary(marketId, branchId),
    ]);
    return {
      branch_id: branchId,
      merchant_id: profile.merchant_id,
      market_id: profile.market_id,
      profile,
      application,
      kyc,
      packages,
      mcp,
    };
  }

  /**
   * MCP summary via owner read surfaces only. A branch with no MCP account
   * (owner MCP_ACCOUNT_NOT_FOUND) yields `null` — never a fabricated zero
   * balance. Reconciliation and the bounded recent-ledger summary delegate to
   * the owner `reconcile` / `adminLedger` surfaces.
   */
  private async mcpSummary(
    marketId: string,
    branchId: string,
  ): Promise<AdminMerchantMcpSummaryDto | null> {
    let account;
    try {
      account = await this.mcp.summary(branchId);
    } catch (error) {
      if (isMcpAccountNotFound(error)) return null;
      throw error;
    }
    const accountId = account.id;
    const [reconciliation, recentLedger] = await Promise.all([
      this.mcp.reconcile(marketId, accountId).catch((error: unknown) => {
        if (isMcpAccountNotFound(error)) return null;
        throw error;
      }),
      this.mcp
        .adminLedger(marketId, accountId, {
          limit: RECENT_LEDGER_LIMIT,
          offset: 0,
        })
        .catch((error: unknown) => {
          if (isMcpAccountNotFound(error)) return null;
          throw error;
        }),
    ]);
    return {
      account,
      reconciliation,
      recent_ledger: recentLedger,
    };
  }

  /**
   * Read-only package-history projection over the immutable owner-owned
   * assignment rows (latest first, bounded). Assignment changes remain the
   * owner commands' responsibility (merchant.package.assign); this surface
   * never writes.
   */
  private async packageHistory(
    branchId: string,
  ): Promise<AdminMerchantPackageHistoryDto> {
    const rows = await this.database.db
      .select({
        assignment_id: merchantPackageAssignments.id,
        service_fee_version_id: merchantPackageAssignments.serviceFeeVersionId,
        special_percentage_id: merchantPackageAssignments.specialPercentageId,
        status: merchantPackageAssignments.status,
        is_default: merchantPackageAssignments.isDefault,
        version: merchantPackageAssignments.version,
        created_at: merchantPackageAssignments.createdAt,
        updated_at: merchantPackageAssignments.updatedAt,
        service_fee_profile_id: serviceFeeProfiles.id,
        service_fee_profile_code: serviceFeeProfiles.code,
        service_fee_profile_name: serviceFeeProfiles.name,
        rate: serviceFeeVersions.rate,
        effective_from: serviceFeeVersions.effectiveFrom,
        effective_to: serviceFeeVersions.effectiveTo,
        special_percentage_rate: specialPercentages.rate,
        special_percentage_description: specialPercentages.description,
      })
      .from(merchantPackageAssignments)
      .innerJoin(
        serviceFeeVersions,
        eq(
          serviceFeeVersions.id,
          merchantPackageAssignments.serviceFeeVersionId,
        ),
      )
      .leftJoin(
        serviceFeeProfiles,
        eq(serviceFeeProfiles.id, serviceFeeVersions.serviceFeeProfileId),
      )
      .leftJoin(
        specialPercentages,
        eq(
          specialPercentages.id,
          merchantPackageAssignments.specialPercentageId,
        ),
      )
      .where(eq(merchantPackageAssignments.merchantBranchId, branchId))
      .orderBy(
        desc(merchantPackageAssignments.createdAt),
        desc(merchantPackageAssignments.version),
      )
      .limit(PACKAGE_HISTORY_LIMIT);

    const items: AdminMerchantPackageHistoryItemDto[] = rows.map((row) => ({
      assignment_id: row.assignment_id,
      service_fee_profile_id: row.service_fee_profile_id ?? null,
      service_fee_profile_code: row.service_fee_profile_code ?? null,
      service_fee_profile_name: row.service_fee_profile_name ?? null,
      service_fee_version_id: row.service_fee_version_id ?? null,
      rate: row.rate !== null ? String(row.rate) : null,
      effective_from:
        row.effective_from instanceof Date
          ? row.effective_from.toISOString()
          : (row.effective_from ?? null),
      effective_to:
        row.effective_to instanceof Date
          ? row.effective_to.toISOString()
          : (row.effective_to ?? null),
      special_percentage_id: row.special_percentage_id ?? null,
      special_percentage_rate:
        row.special_percentage_rate !== null
          ? String(row.special_percentage_rate)
          : null,
      special_percentage_description:
        row.special_percentage_description ?? null,
      status: row.status,
      is_default: row.is_default,
      version: row.version,
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      updated_at:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
    }));

    return { items, limit: PACKAGE_HISTORY_LIMIT, offset: 0 };
  }
}

function isMcpAccountNotFound(error: unknown): boolean {
  return (
    error instanceof NotFoundException &&
    (error as unknown as { response?: { code?: string } }).response?.code ===
      'MCP_ACCOUNT_NOT_FOUND'
  );
}
