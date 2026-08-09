import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
// Node 19+ enables keep-alive on the global agent; the in-process Nest test
// server may close a connection after an error response, which makes a reused
// socket fail with ECONNREFUSED. Fresh connections per request keep the suite
// deterministic (P8-S3 pattern).
http.globalAgent = new http.Agent({ keepAlive: false });
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  agentActivations,
  commissionAdjustmentRequests,
  commissionLedger,
  marketAccess,
  marketTransactionSettings,
  markets,
  mcpAccounts,
  mcpRefundRequests,
  memberKycCases,
  memberMarketPreferences,
  memberWalletAccounts,
  memberWalletEntries,
  members,
  merchantApplications,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  migrate,
  permissions,
  reconciliationExceptions,
  reconciliationRunItems,
  reconciliationRuns,
  redemptionCatalogItems,
  redemptionFulfilmentExceptions,
  redemptionFulfilments,
  redemptionOrders,
  redemptionRateVersions,
  redemptionRefundRequests,
  redemptionShippingPayments,
  rewardDailyAccruals,
  rewardPlans,
  rewardRuleVersions,
  riskEvents,
  riskIndicatorDefinitions,
  riskDetectionRuns,
  riskReviewQueue,
  roleAssignments,
  rolePermissions,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
  sessions,
  transactionServiceFees,
  transactionPreviewSessions,
  transactions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { containsRawIdentifier } from './admin-report-ops.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'P8-S4-Advanced-Reports-Password-123!';

/** Frozen SLA targets (P7-OD-16): QUEUE ≤ 60s, KPI ≤ 5m. */
const QUEUE_SLA_MS = 60_000;
const KPI_SLA_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Fail-closed destructive fresh-database guard (P8-S1 H-01 pattern, mirrored
// from P8-S2/P8-S3). The host gate runs this suite against a dedicated
// `ipoint_p8s4_*` database with `P8S4_DESTRUCTIVE_TEST` set.
// ---------------------------------------------------------------------------
const TEST_DATABASE_NAME_PATTERN = /^ipoint_p8s4_[a-z0-9_]{1,63}$/u;
const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
]);
export const DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8S4_DESTRUCTIVE_TEST';

export function testDatabaseName(
  databaseUrlValue: string | undefined,
): string | null {
  if (!databaseUrlValue) return null;
  let name: string;
  try {
    name = new URL(databaseUrlValue).pathname.replace(/^\//u, '').trim();
  } catch {
    return null;
  }
  if (!name) return null;
  if (PROTECTED_DATABASE_NAMES.has(name)) return null;
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) return null;
  return name;
}

export function destructiveTestOptIn(
  env: Record<string, string | undefined>,
): boolean {
  const value = env[DESTRUCTIVE_TEST_OPT_IN_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

describe('P8-S4 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8s4_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8s4_test',
      ),
    ).toBe('ipoint_p8s4_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8s4_migration_test'),
    ).toBe('ipoint_p8s4_migration_test');
  });

  it('rejects protected maintenance database names', () => {
    for (const name of ['postgres', 'template0', 'template1']) {
      expect(testDatabaseName(`postgresql://localhost/${name}`)).toBeNull();
    }
  });

  it('rejects arbitrary, production-looking or malformed names', () => {
    expect(testDatabaseName('postgresql://localhost/app')).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_dev')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_production'),
    ).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_p8s4')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_p8s4_test_x%2Fbad'),
    ).toBeNull();
    expect(testDatabaseName('not a url')).toBeNull();
    expect(testDatabaseName(undefined)).toBeNull();
    expect(testDatabaseName('')).toBeNull();
  });

  it('requires the explicit destructive-test opt-in', () => {
    expect(destructiveTestOptIn({})).toBe(false);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: '0' })).toBe(
      false,
    );
    expect(
      destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'false' }),
    ).toBe(false);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'off' })).toBe(
      false,
    );
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: '1' })).toBe(
      true,
    );
    expect(
      destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'TRUE' }),
    ).toBe(true);
    expect(destructiveTestOptIn({ [DESTRUCTIVE_TEST_OPT_IN_ENV]: 'yes' })).toBe(
      true,
    );
  });
});

interface ErrorBody {
  error: { code: string; message?: string };
}

interface ReportBody {
  id: string;
  state: string;
  stale: boolean;
  unavailable: boolean;
  asOf: string;
  queryDurationMs?: number;
  value?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CatalogBody {
  asOf: string;
  marketId: string;
  items: ReportBody[];
}

/**
 * P8-S4 Admin Advanced Reports HTTP integration (G-04, contract §4) on a
 * fresh real PostgreSQL database.
 *
 * Asserts:
 * - one real market-scoped scenario per advanced category (R05–R19);
 * - RBAC 401 / 403 (member + admin without report.read) / canonical 409
 *   market mismatch; GET-only surface (POST → 404, no export);
 * - market isolation (foreign-market rows never leak into the aggregates);
 * - privacy masking: no raw identifier ever appears in a report payload;
 * - no fabricated zero: every report has a REAL source and reports FRESH
 *   aggregate values; unknown report ids stay 422 REPORT_UNDEFINED; empty
 *   markets report real empty aggregates;
 * - zero DML: byte-identical snapshots of the frozen tables before/after
 *   running all 19 reports;
 * - freshness + SLA: first live reads carry measured queryDurationMs under
 *   the frozen targets; cached reads keep the same asOf.
 */
describe.skipIf(!databaseUrl)(
  'P8-S4 Admin Advanced Reports HTTP integration (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let marketA: string; // MY
    let marketB: string; // SG
    let admin: { adminUserId: string; accountId: string; token: string };
    let adminB: { adminUserId: string; accountId: string; token: string };
    let supportAdmin: {
      adminUserId: string;
      accountId: string;
      token: string;
    };
    let noPermissionAdmin: {
      adminUserId: string;
      accountId: string;
      token: string;
    };
    let memberToken: string;
    // Fixture handles used by the per-category scenario assertions.
    let memberA1 = '';
    let memberA2 = '';
    let memberA3 = '';
    let branchA = '';
    let branchA2 = '';
    let mcpActiveAccountId = '';
    let walletA1 = '';
    let walletA2 = '';
    let orderA1 = '';
    let orderA2 = '';
    let fulfilmentA1 = '';
    let fulfilmentA2 = '';
    let reconciliationRunA = '';
    let riskRunA = '';
    let riskIndicatorA = '';

    function authorized(token: string) {
      return { Authorization: `Bearer ${token}` };
    }

    const reportsUrl = (marketId: string) =>
      `/api/v1/admin/report-ops/markets/${marketId}/reports`;

    async function ensureActiveMarket(
      code: string,
      currencyCode: string,
      timezone: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `${code} P8-S4 Advanced Reports Test Market`,
          status: 'ACTIVE',
          currencyCode,
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      return inserted[0]?.id ?? '';
    }

    async function createAccount(): Promise<{
      accountId: string;
      email: string;
    }> {
      const email = `${randomUUID()}@example.com`;
      const inserted = await database.db
        .insert(accounts)
        .values({
          publicId: `acct_${randomUUID()}`,
          email,
          accountCountry: 'MY',
          status: 'ACTIVE',
        })
        .returning({ id: accounts.id });
      const accountId = inserted[0]?.id ?? '';
      await auth.setPassword(accountId, password);
      return { accountId, email };
    }

    async function ensurePermissions(
      codes: readonly string[],
    ): Promise<string[]> {
      if (codes.length === 0) return [];
      await database.db
        .insert(permissions)
        .values(
          codes.map((code) => ({
            code,
            description: `${code} p8-s4 advanced reports test permission`,
          })),
        )
        .onConflictDoNothing({ target: permissions.code });
      const rows = await database.db.select().from(permissions);
      return rows
        .filter((row) => codes.includes(row.code))
        .map((row) => row.id);
    }

    async function createAdmin(options: {
      marketIds: string[];
      permissionCodes?: readonly string[];
      roleCode?: string;
    }): Promise<{ adminUserId: string; accountId: string; token: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `P8-S4 Reports Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleCode = options.roleCode ?? 'SUPER_ADMIN';
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: roleCode,
          name: `P8-S4 Reports HTTP Test Role (${roleCode})`,
          isSystem: false,
        })
        .onConflictDoNothing({ target: roles.code })
        .returning({ id: roles.id });
      let roleId = roleRows[0]?.id ?? '';
      if (!roleId) {
        const existing = await database.db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, roleCode))
          .limit(1);
        roleId = existing[0]?.id ?? '';
      }
      await database.db.insert(roleAssignments).values({ adminUserId, roleId });
      const permissionIds = await ensurePermissions(
        options.permissionCodes ?? ['report.read'],
      );
      await database.db
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      if (permissionIds.length > 0) {
        await database.db
          .insert(rolePermissions)
          .values(
            permissionIds.map((permissionId) => ({ roleId, permissionId })),
          )
          .onConflictDoNothing();
      }
      if (options.marketIds.length > 0) {
        await database.db
          .insert(marketAccess)
          .values(
            options.marketIds.map((marketId) => ({ adminUserId, marketId })),
          );
      }
      const token = (
        await auth.createAdminSession(account.accountId, adminUserId, {
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        })
      ).accessToken;
      return { adminUserId, accountId: account.accountId, token };
    }

    async function setCurrentMarket(
      accountId: string,
      marketId: string,
    ): Promise<void> {
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for admin account.');
      await database.db
        .update(sessions)
        .set({
          currentAdminMarketId: marketId,
          currentAdminMarketSelectedAt: new Date(),
          marketContextVersion: 2,
        })
        .where(eq(sessions.id, sessionId));
    }

    async function createMember(
      marketId: string,
      status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
    ): Promise<string> {
      const account = await createAccount();
      const memberId = randomUUID();
      await database.db.insert(members).values({
        id: memberId,
        accountId: account.accountId,
        publicMemberId: `M-${randomUUID()}`,
        referralCode: `R-${randomUUID()}`,
        status,
        kycLevel: 'LEVEL_1',
      });
      await database.db.insert(memberMarketPreferences).values({
        memberId,
        marketId,
        isEnabled: true,
        isCurrent: true,
        sortOrder: 0,
      });
      return memberId;
    }

    async function createWallet(
      marketId: string,
      memberId: string,
    ): Promise<string> {
      const rows = await database.db
        .insert(memberWalletAccounts)
        .values({
          memberId,
          marketId,
          pendingBalance: '0',
          availableBalance: '0',
          reversedBalance: '0',
        })
        .onConflictDoNothing()
        .returning({ id: memberWalletAccounts.id });
      if (rows[0]) return String(rows[0]?.id ?? '');
      const existing = await database.db
        .select({ id: memberWalletAccounts.id })
        .from(memberWalletAccounts)
        .where(
          and(
            eq(memberWalletAccounts.memberId, memberId),
            eq(memberWalletAccounts.marketId, marketId),
          ),
        )
        .limit(1);
      return String(existing[0]?.id ?? '');
    }

    async function appendWalletEntry(input: {
      walletAccountId: string;
      memberId: string;
      marketId: string;
      entrySequence: number;
      entryType:
        | 'PENDING'
        | 'AVAILABLE'
        | 'REVERSED'
        | 'COMPENSATION'
        | 'ADJUSTMENT'
        | 'REDEMPTION_DEBIT'
        | 'REDEMPTION_REFUND';
      amount: string;
      balanceBefore: string;
      balanceAfter: string;
    }): Promise<void> {
      await database.db.insert(memberWalletEntries).values({
        walletAccountId: input.walletAccountId,
        memberId: input.memberId,
        marketId: input.marketId,
        entrySequence: BigInt(input.entrySequence),
        entryType: input.entryType,
        amount: input.amount,
        balanceBefore: input.balanceBefore,
        balanceAfter: input.balanceAfter,
        idempotencyKey: `wik-${randomUUID()}`,
        description: 'P8-S4 fixture entry.',
        reason: 'P8-S4 fixture entry.',
      });
    }

    async function createMerchantChain(marketId: string): Promise<string> {
      const account = await createAccount();
      const group = await database.db
        .insert(merchantGroups)
        .values({
          accountId: account.accountId,
          marketId,
          name: `Reports Merchant ${randomUUID()}`,
        })
        .returning({ id: merchantGroups.id });
      const branch = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: group[0]?.id ?? '',
          merchantId: `M-${randomUUID()}`,
          marketId,
          name: `Reports Branch ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: merchantBranches.id });
      return String(branch[0]?.id ?? '');
    }

    async function createSuspendedBranch(
      marketId: string,
      chainBranchId: string,
    ): Promise<string> {
      const branch = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId:
            (
              await database.db
                .select({ merchantGroupId: merchantBranches.merchantGroupId })
                .from(merchantBranches)
                .where(eq(merchantBranches.id, chainBranchId))
                .limit(1)
            )[0]?.merchantGroupId ?? '',
          merchantId: `M-${randomUUID()}`,
          marketId,
          name: `Reports Suspended Branch ${randomUUID()}`,
          status: 'SUSPENDED',
        })
        .returning({ id: merchantBranches.id });
      return String(branch[0]?.id ?? '');
    }

    async function createMcpAccount(
      branchId: string,
      marketId: string,
      status: 'ACTIVE' | 'FROZEN',
    ): Promise<string> {
      const rows = await database.db
        .insert(mcpAccounts)
        .values({
          merchantBranchId: branchId,
          marketId,
          availableBalance: '1000.0000000000',
          totalBalance: '1000.0000000000',
          status,
        })
        .returning({ id: mcpAccounts.id });
      return String(rows[0]?.id ?? '');
    }

    async function appendMcpEntry(input: {
      mcpAccountId: string;
      entryType: string;
      direction: 'CREDIT' | 'DEBIT';
      amount: string;
      balanceDelta: string;
      availableDelta: string;
      sourceType: string;
    }): Promise<void> {
      // MCP ledger entries may only be created through the frozen owner
      // function append_mcp_ledger_entry (migration 0005 guard).
      await database.pool.query(
        `SELECT * FROM append_mcp_ledger_entry(
           $1::uuid, $2::mcp_entry_type, $3::mcp_direction,
           $4::numeric(38,10), $5::numeric(38,10), $6::numeric(38,10),
           $7::text, $8::text, $9::text, $10::text,
           $11::text, $12::text, $13::text, $14::timestamptz
         )`,
        [
          input.mcpAccountId,
          input.entryType,
          input.direction,
          input.amount,
          input.balanceDelta,
          input.availableDelta,
          input.sourceType,
          null,
          `ik-${randomUUID()}`,
          '0'.repeat(64),
          'SYSTEM',
          'p8s4-fixture',
          'P8-S4 fixture MCP ledger entry.',
          new Date(),
        ],
      );
    }

    async function createKycCase(
      memberId: string,
      marketId: string,
      status:
        | 'NOT_STARTED'
        | 'DRAFT'
        | 'SUBMITTED'
        | 'UNDER_REVIEW'
        | 'APPROVED'
        | 'REJECTED'
        | 'MORE_INFO_REQUIRED'
        | 'REVERIFICATION_REQUIRED',
    ): Promise<void> {
      await database.db.insert(memberKycCases).values({
        memberId,
        marketId,
        status,
        levelRequested: 'LEVEL_1',
      });
    }

    async function createMerchantApplication(
      branchId: string,
      status:
        | 'DRAFT'
        | 'SUBMITTED'
        | 'UNDER_REVIEW'
        | 'RESUBMISSION_REQUIRED'
        | 'APPROVED'
        | 'REJECTED',
    ): Promise<void> {
      await database.db.insert(merchantApplications).values({
        merchantBranchId: branchId,
        status,
      });
    }

    async function createTransactionFixture(params: {
      marketId: string;
      currency: string;
      purchaseAmount: string;
      confirmedAt: Date;
      branchId: string;
      memberId: string;
    }): Promise<string> {
      await database.db
        .insert(marketTransactionSettings)
        .values({
          marketId: params.marketId,
          currencyCode: params.currency,
          currencyScale: 2,
          minimumTransactionAmount: '0.01',
          maximumTransactionAmount: '1000000.00',
        })
        .onConflictDoNothing();

      const profile = await database.db
        .insert(serviceFeeProfiles)
        .values({
          code: `PF_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
          name: `Profile ${randomUUID()}`,
          marketId: params.marketId,
        })
        .returning({ id: serviceFeeProfiles.id });
      const version = await database.db
        .insert(serviceFeeVersions)
        .values({
          serviceFeeProfileId: profile[0]?.id ?? '',
          rate: '5.000000',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          status: 'ACTIVE',
          marketId: params.marketId,
        })
        .returning({ id: serviceFeeVersions.id });

      const existingDefault = await database.db
        .select({ id: merchantPackageAssignments.id })
        .from(merchantPackageAssignments)
        .where(
          and(
            eq(merchantPackageAssignments.merchantBranchId, params.branchId),
            eq(merchantPackageAssignments.isDefault, true),
          ),
        )
        .limit(1);
      const assignment = await database.db
        .insert(merchantPackageAssignments)
        .values({
          merchantBranchId: params.branchId,
          serviceFeeVersionId: version[0]?.id ?? '',
          status: 'ACTIVE',
          isDefault: existingDefault.length === 0,
        })
        .returning({ id: merchantPackageAssignments.id });

      const rule = await database.db
        .insert(rewardRuleVersions)
        .values({
          name: `Reward ${randomUUID()}`,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          rewardRate: '0.0100000000',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
          marketId: params.marketId,
          createdBy: admin.adminUserId,
        })
        .returning({ id: rewardRuleVersions.id });

      const merchantAccountId =
        (
          await database.db.select({ id: accounts.id }).from(accounts).limit(1)
        )[0]?.id ?? '';
      const preview = await database.db
        .insert(transactionPreviewSessions)
        .values({
          status: 'CONFIRMED',
          merchantBranchId: params.branchId,
          merchantAccountId,
          createdByStaffAccountId: merchantAccountId,
          memberId: params.memberId,
          protectedMemberReference: `ref_${randomUUID()}`,
          marketId: params.marketId,
          currency: params.currency,
          purchaseAmount: params.purchaseAmount,
          merchantPackageAssignmentId: assignment[0]?.id ?? '',
          merchantPackageVersion: 1,
          merchantPackageSnapshot: { packageCode: 'B', rate: '5.000000' },
          serviceFeeRate: '5.0000000000',
          serviceFeeAmount: '5.0000000000',
          estimatedMcpDebit: '5.0000000000',
          rewardRuleVersionId: rule[0]?.id ?? '',
          rewardRate: '0.0100000000',
          rewardPrincipal: params.purchaseAmount,
          rewardCap: '0',
          dailyRewardAmount: '0',
          rewardStartBusinessDate: '2026-08-03',
          marketTimezone: 'Asia/Kuala_Lumpur',
          previewedAt: new Date(params.confirmedAt.getTime() - 60_000),
          confirmedAt: params.confirmedAt,
        })
        .returning({ id: transactionPreviewSessions.id });

      const tx = await database.db
        .insert(transactions)
        .values({
          previewSessionId: preview[0]?.id ?? '',
          merchantReceiptNumber: `RCPT_${randomUUID()}`,
          status: 'CONFIRMED',
          merchantBranchId: params.branchId,
          merchantAccountId,
          confirmedByStaffAccountId: merchantAccountId,
          memberId: params.memberId,
          protectedMemberReference: `ref_${randomUUID()}`,
          marketId: params.marketId,
          currency: params.currency,
          purchaseAmount: params.purchaseAmount,
          transactionNote: 'p8-s4 fixture',
          merchantPackageAssignmentId: assignment[0]?.id ?? '',
          merchantPackageVersion: 1,
          merchantPackageSnapshot: { packageCode: 'B', rate: '5.000000' },
          rewardRuleVersionId: rule[0]?.id ?? '',
          rewardRate: '0.0100000000',
          rewardPrincipal: params.purchaseAmount,
          rewardCap: '0',
          dailyRewardAmount: '0',
          rewardStartBusinessDate: '2026-08-03',
          marketTimezone: 'Asia/Kuala_Lumpur',
          confirmedAt: params.confirmedAt,
        })
        .returning({ id: transactions.id });
      return String(tx[0]?.id ?? '');
    }

    async function createServiceFee(
      transactionId: string,
      marketId: string,
      currency: string,
      amount: string,
    ): Promise<void> {
      await database.db.insert(transactionServiceFees).values({
        transactionId,
        marketId,
        currency,
        rate: '5.0000000000',
        principal: amount,
        amount,
      });
    }

    async function createRedemptionOrder(
      marketId: string,
      memberId: string,
      walletAccountId: string,
      status: string,
    ): Promise<string> {
      const rate = await database.db
        .insert(redemptionRateVersions)
        .values({
          marketId,
          rateType: 'CURRENCY_PER_POINT',
          rateValue: '1.0000000000',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          createdBy: admin.adminUserId,
        })
        .returning({ id: redemptionRateVersions.id });
      const item = await database.db
        .insert(redemptionCatalogItems)
        .values({
          marketId,
          name: `Item ${randomUUID()}`,
          itemType: 'PHYSICAL',
          fiatReferenceValue: '10.0000000000',
          fiatCurrency: 'MYR',
          createdBy: admin.adminUserId,
          status: 'ACTIVE',
        })
        .returning({ id: redemptionCatalogItems.id });
      const order = await database.db
        .insert(redemptionOrders)
        .values({
          orderReference: `ORD_${randomUUID()}`,
          marketId,
          memberId,
          itemId: item[0]?.id ?? '',
          walletAccountId,
          rateVersionId: rate[0]?.id ?? '',
          rateValue: '1.0000000000',
          status: status as never,
          unroundedPointCost: '10.0000000000',
          postedPointCost: '10.0000000000',
          totalPoints: '10.0000000000',
          quantity: '1',
          itemSnapshot: { name: 'item' },
          rateSnapshot: { rate: '1.0000000000' },
        })
        .returning({ id: redemptionOrders.id });
      return String(order[0]?.id ?? '');
    }

    async function createFulfilment(
      orderId: string,
      status: string,
    ): Promise<string> {
      const rows = await database.db
        .insert(redemptionFulfilments)
        .values({
          orderId,
          fulfilmentType: 'PHYSICAL',
          status: status as never,
        })
        .returning({ id: redemptionFulfilments.id });
      return String(rows[0]?.id ?? '');
    }

    async function createFulfilmentException(input: {
      fulfilmentId: string;
      orderId: string;
      resolved: boolean;
    }): Promise<void> {
      await database.db.insert(redemptionFulfilmentExceptions).values({
        fulfilmentId: input.fulfilmentId,
        orderId: input.orderId,
        severity: 'RETRYABLE',
        errorCode: 'SHIPPING_TIMEOUT',
        errorMessage: 'P8-S4 fixture fulfilment exception.',
        resolved: input.resolved,
      });
    }

    async function createShippingPayment(
      marketId: string,
      memberId: string,
      status: string,
    ): Promise<void> {
      await database.db.insert(redemptionShippingPayments).values({
        memberId,
        marketId,
        amount: '5.0000000000',
        currency: 'MYR',
        requestHash: '0'.repeat(64),
        status: status as never,
        idempotencyKey: `ship-${randomUUID()}`,
      });
    }

    async function createMcpRefund(
      mcpAccountId: string,
      marketId: string,
      status: string,
    ): Promise<void> {
      const account =
        (
          await database.db.select({ id: accounts.id }).from(accounts).limit(1)
        )[0]?.id ?? '';
      await database.db.insert(mcpRefundRequests).values({
        mcpAccountId,
        marketId,
        requestedByAccountId: account,
        amount: '50.0000000000',
        status: status as never,
        reason: 'P8-S4 fixture MCP refund.',
        idempotencyKey: `mref-${randomUUID()}`,
        payloadHash: '0'.repeat(64),
      });
    }

    async function createRedemptionRefund(
      orderId: string,
      makerAdminUserId: string,
      status: string,
    ): Promise<void> {
      await database.db.insert(redemptionRefundRequests).values({
        orderId,
        makerId: makerAdminUserId,
        status: status as never,
        refundAmount: '10.0000000000',
        reason: 'P8-S4 fixture redemption refund.',
      });
    }

    async function createRewardPlan(
      marketId: string,
      memberId: string,
      merchantId: string,
    ): Promise<string> {
      const rows = await database.db
        .insert(rewardPlans)
        .values({
          sourceType: 'TRANSACTION',
          sourceId: randomUUID(),
          memberId,
          marketId,
          merchantId,
          status: 'SCHEDULED',
        })
        .returning({ id: rewardPlans.id });
      return String(rows[0]?.id ?? '');
    }

    async function createDailyAccrual(input: {
      rewardPlanId: string;
      memberId: string;
      marketId: string;
      amount: string;
    }): Promise<void> {
      await database.db.insert(rewardDailyAccruals).values({
        rewardPlanId: input.rewardPlanId,
        memberId: input.memberId,
        marketId: input.marketId,
        marketTimezone: 'Asia/Kuala_Lumpur',
        marketLocalDate: '2026-08-06',
        executedAtUtc: new Date(),
        amount: input.amount,
        ledgerEntryType: 'AVAILABLE',
        idempotencyKey: `acc-${randomUUID()}`,
      });
    }

    async function createCommissionLedgerEntry(input: {
      beneficiaryId: string;
      market: string;
      currency: string;
      amount: string;
      entryType: string;
    }): Promise<void> {
      await database.db.insert(commissionLedger).values({
        publicReference: `CL-${randomUUID().slice(0, 8)}`,
        beneficiaryId: input.beneficiaryId,
        sourceType: 'MEMBER_CONSUMPTION',
        sourceReference: `TX-${randomUUID().slice(0, 12)}`,
        market: input.market,
        currency: input.currency,
        amount: input.amount,
        entryType: input.entryType,
        canonicalEntryKey: `CEK-${randomUUID().slice(0, 12)}`,
        effectiveTime: new Date(),
      });
    }

    async function createCommissionAdjustment(input: {
      beneficiaryId: string;
      market: string;
      currency: string;
      amount: string;
      makerId: string;
      status: string;
    }): Promise<void> {
      await database.db.insert(commissionAdjustmentRequests).values({
        publicReference: `ADJ-${randomUUID().slice(0, 8)}`,
        beneficiaryId: input.beneficiaryId,
        amount: input.amount,
        market: input.market,
        currency: input.currency,
        reason: 'P8-S4 fixture commission adjustment.',
        status: input.status as never,
        makerId: input.makerId,
      });
    }

    async function createReconciliationRun(
      marketId: string,
      runByAdminUserId: string,
    ): Promise<string> {
      const rows = await database.db
        .insert(reconciliationRuns)
        .values({
          marketId,
          kind: 'MCP',
          status: 'PENDING',
          windowStartAt: new Date('2026-01-01T00:00:00.000Z'),
          windowEndAt: new Date('2026-01-31T00:00:00.000Z'),
          runByAdminUserId,
        })
        .returning({ id: reconciliationRuns.id });
      return String(rows[0]?.id ?? '');
    }

    async function createReconciliationRunItem(input: {
      runId: string;
      marketId: string;
      referenceType: string;
      referenceId: string;
      status: string;
    }): Promise<void> {
      await database.db.insert(reconciliationRunItems).values({
        runId: input.runId,
        marketId: input.marketId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        status: input.status as never,
        expectedAmount: '100.0000000000',
        actualAmount: '100.0000000000',
        differenceAmount: '0.0000000000',
        evidence: { fixture: true },
      });
    }

    async function createReconciliationException(
      runId: string,
      marketId: string,
      status: string,
    ): Promise<void> {
      await database.db.insert(reconciliationExceptions).values({
        runId,
        marketId,
        kind: 'MCP',
        referenceType: 'MCP_LEDGER',
        referenceId: `ENT-${randomUUID().slice(0, 12)}`,
        expectedAmount: '100.0000000000',
        actualAmount: '99.0000000000',
        differenceAmount: '1.0000000000',
        classification: 'AMOUNT_MISMATCH',
        status: status as never,
      });
    }

    async function createRiskIndicator(
      marketId: string,
      createdByAdminUserId: string,
    ): Promise<string> {
      const rows = await database.db
        .insert(riskIndicatorDefinitions)
        .values({
          code: 'suspicious_amount_breach',
          marketId,
          category: 'SUSPICIOUS_TRANSACTION',
          name: 'Suspicious amount breach',
          severity: 'HIGH',
          config: { maxSingleAmount: '1000' },
          createdByAdminUserId,
        })
        .returning({ id: riskIndicatorDefinitions.id });
      return String(rows[0]?.id ?? '');
    }

    async function createRiskRun(
      marketId: string,
      runByAdminUserId: string,
    ): Promise<string> {
      const rows = await database.db
        .insert(riskDetectionRuns)
        .values({
          marketId,
          category: 'SUSPICIOUS_TRANSACTION',
          status: 'PENDING',
          windowStartAt: new Date('2026-01-01T00:00:00.000Z'),
          windowEndAt: new Date('2026-01-31T00:00:00.000Z'),
          runByAdminUserId,
        })
        .returning({ id: riskDetectionRuns.id });
      return String(rows[0]?.id ?? '');
    }

    async function createRiskEvent(input: {
      runId: string;
      marketId: string;
      indicatorId: string;
      severity: string;
      entityId: string;
    }): Promise<void> {
      await database.db.insert(riskEvents).values({
        runId: input.runId,
        marketId: input.marketId,
        indicatorId: input.indicatorId,
        indicatorCode: 'suspicious_amount_breach',
        indicatorVersion: 1,
        category: 'SUSPICIOUS_TRANSACTION',
        severity: input.severity as never,
        entityType: 'MEMBER',
        entityId: input.entityId,
        entityMarketId: input.marketId,
        payload: { amount: '1500' },
        detectionMetadata: { fixture: true },
      });
    }

    async function createRiskQueueTask(
      eventId: string,
      marketId: string,
    ): Promise<void> {
      await database.db.insert(riskReviewQueue).values({
        eventId,
        marketId,
      });
    }

    async function memberLogin(): Promise<string> {
      const account = await createAccount();
      await database.db.insert(members).values({
        id: randomUUID(),
        accountId: account.accountId,
        publicMemberId: `M-${randomUUID()}`,
        referralCode: `R-${randomUUID()}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: account.email, password })
        .expect(200);
      return String((response.body as { accessToken: string }).accessToken);
    }

    async function snapshotTables(
      tableNames: readonly string[],
    ): Promise<Record<string, string>> {
      const snapshots: Record<string, string> = {};
      for (const tableName of tableNames) {
        const result = await database.pool.query(
          `SELECT * FROM ${tableName} ORDER BY id`,
        );
        snapshots[tableName] = createHash('sha256')
          .update(JSON.stringify(result.rows))
          .digest('hex');
      }
      return snapshots;
    }

    beforeAll(async () => {
      const dbName = testDatabaseName(databaseUrl);
      if (!dbName) {
        throw new Error(
          `P8-S4 integration suite is fail-closed: DATABASE_URL must name a dedicated test database matching ^ipoint_p8s4_[a-z0-9_]+$ and must not be a protected database (received ${databaseUrl ?? 'unset'}).`,
        );
      }
      if (!destructiveTestOptIn(process.env)) {
        throw new Error(
          `P8-S4 integration suite is fail-closed: set ${DESTRUCTIVE_TEST_OPT_IN_ENV}=1 to allow recreating the dedicated test database "${dbName}".`,
        );
      }
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const { Pool } = await import('pg');
      const maintenance = new Pool({ connectionString: maintenanceUrl });
      await maintenance.query(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
      );
      await maintenance.query(`CREATE DATABASE "${dbName}"`);
      await maintenance.end();

      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:56379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'p8-s4-advanced-reports-pepper-at-least-32-characters',
      );
      vi.stubEnv(
        'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      configureApplication(app, {
        enableShutdownHooks: false,
        scanSwaggerRoutes: false,
      });
      await app.init();
      server = app.getHttpServer() as Server;
      auth = app.get(AuthService);
      database = app.get(DatabaseService);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('SG', 'SGD', 'Asia/Singapore');

      admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['report.read'],
        roleCode: 'SUPER_ADMIN',
      });
      adminB = await createAdmin({
        marketIds: [marketB],
        permissionCodes: ['report.read'],
        roleCode: 'SUPER_ADMIN',
      });
      supportAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['report.read'],
        roleCode: 'SUPPORT_READONLY_AUDITOR',
      });
      noPermissionAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['agent.read'],
        roleCode: 'OPERATIONS_ADMIN',
      });

      // ─── Market A (MY) fixtures — one real scenario per category ────
      memberA1 = await createMember(marketA, 'ACTIVE');
      memberA2 = await createMember(marketA, 'ACTIVE');
      memberA3 = await createMember(marketA, 'SUSPENDED');

      branchA = await createMerchantChain(marketA);
      branchA2 = await createSuspendedBranch(marketA, branchA);

      mcpActiveAccountId = await createMcpAccount(branchA, marketA, 'ACTIVE');
      await createMcpAccount(branchA2, marketA, 'FROZEN');

      walletA1 = await createWallet(marketA, memberA1);
      walletA2 = await createWallet(marketA, memberA2);

      await createKycCase(memberA1, marketA, 'APPROVED');
      await createKycCase(memberA2, marketA, 'SUBMITTED');
      await createMerchantApplication(branchA, 'APPROVED');
      await createMerchantApplication(branchA2, 'SUBMITTED');

      const tx1 = await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '88.0000000000',
        confirmedAt: new Date(),
        branchId: branchA,
        memberId: memberA1,
      });
      const tx2 = await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '99.0000000000',
        confirmedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        branchId: branchA,
        memberId: memberA2,
      });
      await createServiceFee(tx1, marketA, 'MYR', '5.0000000000');
      await createServiceFee(tx2, marketA, 'MYR', '5.0000000000');

      await appendMcpEntry({
        mcpAccountId: mcpActiveAccountId,
        entryType: 'RECHARGE',
        direction: 'CREDIT',
        amount: '1000.0000000000',
        balanceDelta: '1000.0000000000',
        availableDelta: '1000.0000000000',
        sourceType: 'RECHARGE',
      });
      await appendMcpEntry({
        mcpAccountId: mcpActiveAccountId,
        entryType: 'TRANSACTION_DEDUCTION',
        direction: 'DEBIT',
        amount: '100.0000000000',
        balanceDelta: '-100.0000000000',
        availableDelta: '-100.0000000000',
        sourceType: 'TRANSACTION',
      });

      await appendWalletEntry({
        walletAccountId: walletA1,
        memberId: memberA1,
        marketId: marketA,
        entrySequence: 1,
        entryType: 'AVAILABLE',
        amount: '30.7500000000',
        balanceBefore: '0',
        balanceAfter: '30.7500000000',
      });
      await appendWalletEntry({
        walletAccountId: walletA1,
        memberId: memberA1,
        marketId: marketA,
        entrySequence: 2,
        entryType: 'REDEMPTION_DEBIT',
        amount: '10.0000000000',
        balanceBefore: '30.7500000000',
        balanceAfter: '20.7500000000',
      });
      await appendWalletEntry({
        walletAccountId: walletA2,
        memberId: memberA2,
        marketId: marketA,
        entrySequence: 1,
        entryType: 'AVAILABLE',
        amount: '5.2500000000',
        balanceBefore: '0',
        balanceAfter: '5.2500000000',
      });

      await database.db.insert(agentActivations).values({
        memberId: memberA1,
        status: 'ACTIVE',
        market: 'MY',
        currency: 'MYR',
        activatedAt: new Date(),
      });
      await database.db.insert(agentActivations).values({
        memberId: memberA2,
        status: 'PENDING_APPROVAL',
        market: 'MY',
        currency: 'MYR',
      });
      await database.db.insert(agentActivations).values({
        memberId: memberA3,
        status: 'SUSPENDED',
        market: 'MY',
        currency: 'MYR',
      });

      const rewardPlanA = await createRewardPlan(marketA, memberA1, branchA);
      await createDailyAccrual({
        rewardPlanId: rewardPlanA,
        memberId: memberA1,
        marketId: marketA,
        amount: '5.5000000000',
      });

      await createCommissionLedgerEntry({
        beneficiaryId: memberA1,
        market: 'MY',
        currency: 'MYR',
        amount: '5.5000000000',
        entryType: 'MEMBER_CONSUMPTION_G1_EARN',
      });
      await createCommissionAdjustment({
        beneficiaryId: memberA1,
        market: 'MY',
        currency: 'MYR',
        amount: '10.0000000000',
        makerId: admin.adminUserId,
        status: 'PENDING_CHECKER',
      });

      orderA1 = await createRedemptionOrder(
        marketA,
        memberA1,
        walletA1,
        'CONFIRMED',
      );
      orderA2 = await createRedemptionOrder(
        marketA,
        memberA1,
        walletA1,
        'READY_FOR_PICKUP',
      );
      fulfilmentA1 = await createFulfilment(orderA1, 'COMPLETED');
      fulfilmentA2 = await createFulfilment(orderA2, 'PENDING');
      await createFulfilmentException({
        fulfilmentId: fulfilmentA1,
        orderId: orderA1,
        resolved: true,
      });
      await createFulfilmentException({
        fulfilmentId: fulfilmentA2,
        orderId: orderA2,
        resolved: false,
      });
      await createShippingPayment(marketA, memberA1, 'PAID');

      await createMcpRefund(mcpActiveAccountId, marketA, 'PENDING');
      await createRedemptionRefund(
        orderA2,
        admin.adminUserId,
        'PENDING_CHECKER',
      );

      reconciliationRunA = await createReconciliationRun(
        marketA,
        admin.adminUserId,
      );
      await createReconciliationRunItem({
        runId: reconciliationRunA,
        marketId: marketA,
        referenceType: 'MCP_LEDGER',
        referenceId: 'ENT-1',
        status: 'MATCHED',
      });
      await createReconciliationRunItem({
        runId: reconciliationRunA,
        marketId: marketA,
        referenceType: 'MCP_LEDGER',
        referenceId: 'ENT-2',
        status: 'MATCHED',
      });
      await createReconciliationRunItem({
        runId: reconciliationRunA,
        marketId: marketA,
        referenceType: 'MCP_LEDGER',
        referenceId: 'ENT-3',
        status: 'MISMATCHED',
      });
      await createReconciliationException(reconciliationRunA, marketA, 'OPEN');

      riskIndicatorA = await createRiskIndicator(marketA, admin.adminUserId);
      riskRunA = await createRiskRun(marketA, admin.adminUserId);
      await createRiskEvent({
        runId: riskRunA,
        marketId: marketA,
        indicatorId: riskIndicatorA,
        severity: 'HIGH',
        entityId: 'member-1',
      });
      await createRiskEvent({
        runId: riskRunA,
        marketId: marketA,
        indicatorId: riskIndicatorA,
        severity: 'MEDIUM',
        entityId: 'member-2',
      });
      const riskEventRows = await database.db
        .select({ id: riskEvents.id })
        .from(riskEvents)
        .orderBy(riskEvents.createdAt);
      for (const event of riskEventRows) {
        await createRiskQueueTask(String(event.id), marketA);
      }

      // ─── Market B (SG) fixtures — isolation targets ────────────────
      await createMember(marketB, 'ACTIVE');
      await createMerchantChain(marketB);
      await database.db.insert(agentActivations).values({
        memberId:
          (
            await database.db
              .select({ id: members.id })
              .from(members)
              .where(eq(members.status, 'ACTIVE'))
              .limit(1)
          )[0]?.id ?? '',
        status: 'ACTIVE',
        market: 'SG',
        currency: 'SGD',
        activatedAt: new Date(),
      });

      memberToken = await memberLogin();
      await setCurrentMarket(admin.accountId, marketA);
      await setCurrentMarket(adminB.accountId, marketB);
      await setCurrentMarket(supportAdmin.accountId, marketA);
      await setCurrentMarket(noPermissionAdmin.accountId, marketA);
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    // ─── Auth + permission matrix ────────────────────────────────────

    it('rejects unauthenticated requests (401)', async () => {
      await supertest(server).get(reportsUrl(marketA)).expect(401);
      await supertest(server)
        .get(`${reportsUrl(marketA)}/R05`)
        .expect(401);
    });

    it('rejects a member session (403)', async () => {
      await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(memberToken))
        .expect(403);
      await supertest(server)
        .get(`${reportsUrl(marketA)}/R05`)
        .set(authorized(memberToken))
        .expect(403);
    });

    it('rejects an admin without report.read (403)', async () => {
      await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(noPermissionAdmin.token))
        .expect(403);
      await supertest(server)
        .get(`${reportsUrl(marketA)}/R05`)
        .set(authorized(noPermissionAdmin.token))
        .expect(403);
    });

    it('serves the 19-report catalog to the Support template with live first reads under SLA', async () => {
      const response = await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(supportAdmin.token))
        .expect(200);
      const body = response.body as CatalogBody;
      expect(body.marketId).toBe(marketA);
      expect(body.items).toHaveLength(19);
      const ids = body.items.map((item) => item.id);
      expect(ids).toEqual(
        Array.from(
          { length: 19 },
          (_, index) => `R${String(index + 1).padStart(2, '0')}`,
        ),
      );
      // First successful read of the suite: every report carries its
      // measured live source-query duration under the frozen SLA
      // (QUEUE ≤ 60s, KPI ≤ 5m — P7-OD-16).
      for (const item of body.items) {
        expect(typeof item.queryDurationMs).toBe('number');
        const target =
          item.freshnessClass === 'QUEUE' ? QUEUE_SLA_MS : KPI_SLA_MS;
        expect(item.queryDurationMs! < target).toBe(true);
        expect(item.state).toBe('FRESH');
        expect(item.value).toBeDefined();
      }
    });

    // ─── Advanced category scenarios (one real scenario per category) ──

    it('R05 operations: KYC cases and merchant applications by status', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R05`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as ReportBody;
      expect(body.state).toBe('FRESH');
      const value = body.value as unknown as {
        kind: string;
        windowDays: number;
        kyc: { total: number; counts: Record<string, number> };
        merchantApplications: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('OPERATIONS_OVERVIEW');
      expect(value.windowDays).toBe(90);
      expect(value.kyc.total).toBe(2);
      expect(value.kyc.counts['APPROVED']).toBe(1);
      expect(value.kyc.counts['SUBMITTED']).toBe(1);
      expect(value.merchantApplications.total).toBe(2);
      expect(value.merchantApplications.counts['APPROVED']).toBe(1);
      expect(value.merchantApplications.counts['SUBMITTED']).toBe(1);
    });

    it('R06 finance: member wallet entry volume with exact-decimal totals', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R06`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        groups: Record<string, { count: number; totalAmount: string }>;
      };
      expect(value.kind).toBe('LEDGER_VOLUME');
      expect(value.groups['AVAILABLE']).toEqual({
        count: 2,
        totalAmount: '36.0000000000',
      });
      expect(value.groups['REDEMPTION_DEBIT']).toEqual({
        count: 1,
        totalAmount: '10.0000000000',
      });
    });

    it('R07 reconciliation: runs and run items by status', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R07`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        runs: { total: number; counts: Record<string, number> };
        runItems: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('RECONCILIATION_OVERVIEW');
      expect(value.runs.total).toBe(1);
      expect(value.runs.counts['PENDING']).toBe(1);
      expect(value.runItems.total).toBe(3);
      expect(value.runItems.counts['MATCHED']).toBe(2);
      expect(value.runItems.counts['MISMATCHED']).toBe(1);
    });

    it('R08 markets: selected-market profile with real entity counts', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R08`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        market: {
          code: string;
          status: string;
          currencyCode: string;
          timezone: string;
        };
        counts: Record<string, number>;
      };
      expect(value.kind).toBe('MARKET_PROFILE');
      expect(value.market).toEqual({
        code: 'MY',
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
      });
      expect(value.counts).toEqual({
        members: 3,
        merchantBranches: 2,
        mcpAccounts: 2,
        activeAgents: 1,
        activeCatalogItems: 2,
      });
    });

    it('R09 members: member status distribution', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R09`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        total: number;
        counts: Record<string, number>;
      };
      expect(value.kind).toBe('STATUS_COUNTS');
      expect(value.total).toBe(3);
      expect(value.counts['ACTIVE']).toBe(2);
      expect(value.counts['SUSPENDED']).toBe(1);
    });

    it('R10 merchants: merchant branch status distribution', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R10`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        total: number;
        counts: Record<string, number>;
      };
      expect(value.kind).toBe('STATUS_COUNTS');
      expect(value.total).toBe(2);
      expect(value.counts['ACTIVE']).toBe(1);
      expect(value.counts['SUSPENDED']).toBe(1);
    });

    it('R11 agents: agent activation status distribution by market code', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R11`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        total: number;
        counts: Record<string, number>;
      };
      expect(value.kind).toBe('STATUS_COUNTS');
      expect(value.total).toBe(3);
      expect(value.counts['ACTIVE']).toBe(1);
      expect(value.counts['PENDING_APPROVAL']).toBe(1);
      expect(value.counts['SUSPENDED']).toBe(1);
    });

    it('R12 transactions: confirmed transaction value by currency', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R12`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        byCurrency: Record<
          string,
          {
            count: number;
            totalPurchaseAmount: string;
            totalServiceFeeAmount: string;
          }
        >;
        totals: {
          count: number;
          totalPurchaseAmount: string;
          totalServiceFeeAmount: string;
        };
      };
      expect(value.kind).toBe('TRANSACTION_VALUE');
      expect(value.byCurrency['MYR']).toEqual({
        count: 2,
        totalPurchaseAmount: '187.0000000000',
        totalServiceFeeAmount: '10.0000000000',
      });
      expect(value.totals).toEqual({
        count: 2,
        totalPurchaseAmount: '187.0000000000',
        totalServiceFeeAmount: '10.0000000000',
      });
    });

    it('R13 MCP: account statuses and ledger volume', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R13`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        accounts: { total: number; counts: Record<string, number> };
        ledger: {
          windowDays: number;
          groups: Record<string, { count: number; totalAmount: string }>;
        };
      };
      expect(value.kind).toBe('MCP_OVERVIEW');
      expect(value.accounts.total).toBe(2);
      expect(value.accounts.counts['ACTIVE']).toBe(1);
      expect(value.accounts.counts['FROZEN']).toBe(1);
      expect(value.ledger.groups['RECHARGE']).toEqual({
        count: 1,
        totalAmount: '1000.0000000000',
      });
      expect(value.ledger.groups['TRANSACTION_DEDUCTION']).toEqual({
        count: 1,
        totalAmount: '100.0000000000',
      });
    });

    it('R14 iPoint/reward: reward accrual volume and plan statuses', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R14`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        accruals: {
          groups: Record<string, { count: number; totalAmount: string }>;
        };
        plans: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('REWARD_ACCRUAL');
      expect(value.accruals.groups['AVAILABLE']).toEqual({
        count: 1,
        totalAmount: '5.5000000000',
      });
      expect(value.plans.total).toBe(1);
      expect(value.plans.counts['SCHEDULED']).toBe(1);
    });

    it('R15 commission: ledger entries and adjustments (market code)', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R15`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        ledger: {
          groups: Record<string, { count: number; totalAmount: string }>;
        };
        adjustments: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('COMMISSION_OVERVIEW');
      expect(value.ledger.groups['MEMBER_CONSUMPTION_G1_EARN']).toEqual({
        count: 1,
        totalAmount: '5.5000000000',
      });
      expect(value.adjustments.total).toBe(1);
      expect(value.adjustments.counts['PENDING_CHECKER']).toBe(1);
    });

    it('R16 redemption: order volume with points and catalog depth', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R16`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        orders: Record<string, { count: number; totalPoints: string }>;
        items: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('REDEMPTION_VOLUME');
      expect(value.orders['CONFIRMED']).toEqual({
        count: 1,
        totalPoints: '10.0000000000',
      });
      expect(value.orders['READY_FOR_PICKUP']).toEqual({
        count: 1,
        totalPoints: '10.0000000000',
      });
      expect(value.items.total).toBe(2);
      expect(value.items.counts['ACTIVE']).toBe(2);
    });

    it('R17 fulfilment: exceptions and shipping payments', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R17`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        exceptions: { total: number; resolved: number; unresolved: number };
        shippingPayments: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('FULFILMENT_OVERVIEW');
      expect(value.exceptions).toEqual({
        total: 2,
        resolved: 1,
        unresolved: 1,
      });
      expect(value.shippingPayments.total).toBe(1);
      expect(value.shippingPayments.counts['PAID']).toBe(1);
    });

    it('R18 refund: MCP and redemption refund requests', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R18`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        mcp: { total: number; counts: Record<string, number> };
        redemption: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('REFUND_OVERVIEW');
      expect(value.mcp.total).toBe(1);
      expect(value.mcp.counts['PENDING']).toBe(1);
      expect(value.redemption.total).toBe(1);
      expect(value.redemption.counts['PENDING_CHECKER']).toBe(1);
    });

    it('R19 risk/exception: risk events, review queue and reconciliation exceptions', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R19`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        riskEvents: { total: number; counts: Record<string, number> };
        riskQueue: { total: number; counts: Record<string, number> };
        reconciliationExceptions: {
          total: number;
          counts: Record<string, number>;
        };
      };
      expect(value.kind).toBe('RISK_EXCEPTION_OVERVIEW');
      expect(value.riskEvents.total).toBe(2);
      expect(value.riskEvents.counts['HIGH']).toBe(1);
      expect(value.riskEvents.counts['MEDIUM']).toBe(1);
      expect(value.riskQueue.total).toBe(2);
      expect(value.riskQueue.counts['OPEN']).toBe(2);
      expect(value.reconciliationExceptions.total).toBe(1);
      expect(value.reconciliationExceptions.counts['OPEN']).toBe(1);
    });

    // ─── Market isolation ────────────────────────────────────────────

    it('reports market B aggregates when the Current Admin Market is B', async () => {
      const memberResponse = await supertest(server)
        .get(`${reportsUrl(marketB)}/R09`)
        .set(authorized(adminB.token))
        .expect(200);
      const memberValue = (memberResponse.body as ReportBody).value as {
        kind: string;
        total: number;
        counts: Record<string, number>;
      };
      // Only market B's single ACTIVE member — market A's members must not
      // leak into this market's aggregates.
      expect(memberValue.total).toBe(1);
      expect(memberValue.counts['ACTIVE']).toBe(1);

      const agentResponse = await supertest(server)
        .get(`${reportsUrl(marketB)}/R11`)
        .set(authorized(adminB.token))
        .expect(200);
      const agentValue = (agentResponse.body as ReportBody).value as {
        kind: string;
        total: number;
        counts: Record<string, number>;
      };
      expect(agentValue.total).toBe(1);
      expect(agentValue.counts['ACTIVE']).toBe(1);
    });

    it('keeps market A aggregates free of foreign-market rows', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R09`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        kind: string;
        total: number;
      };
      expect(value.total).toBe(3);
    });

    it('rejects a URL market that differs from the Current Admin Market (409)', async () => {
      const response = await supertest(server)
        .get(reportsUrl(marketB))
        .set(authorized(admin.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    // ─── No fabricated zero / undefined ids ──────────────────────────

    it('reports real empty aggregates for a market without rows (never invented values)', async () => {
      const walletResponse = await supertest(server)
        .get(`${reportsUrl(marketB)}/R06`)
        .set(authorized(adminB.token))
        .expect(200);
      const walletValue = (walletResponse.body as ReportBody).value as {
        kind: string;
        groups: Record<string, unknown>;
      };
      expect(walletValue.kind).toBe('LEDGER_VOLUME');
      expect(walletValue.groups).toEqual({});

      const riskResponse = await supertest(server)
        .get(`${reportsUrl(marketB)}/R19`)
        .set(authorized(adminB.token))
        .expect(200);
      const riskValue = (riskResponse.body as ReportBody).value as {
        kind: string;
        riskEvents: { total: number; counts: Record<string, number> };
      };
      expect(riskValue.riskEvents.total).toBe(0);
      expect(riskValue.riskEvents.counts).toEqual({});
    });

    it('returns 422 for an unknown report id (no zero stand-in)', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R99`)
        .set(authorized(admin.token))
        .expect(422);
      expect((response.body as ErrorBody).error.code).toBe('REPORT_UNDEFINED');
    });

    // ─── Masking ─────────────────────────────────────────────────────

    it('never leaks a raw identifier into any of the 19 report payloads', async () => {
      for (const reportId of Array.from(
        { length: 19 },
        (_, index) => `R${String(index + 1).padStart(2, '0')}`,
      )) {
        const response = await supertest(server)
          .get(`${reportsUrl(marketA)}/${reportId}`)
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as ReportBody;
        expect(body.value, `report ${reportId} missing value`).toBeDefined();
        expect(
          containsRawIdentifier(body.value),
          `report ${reportId} leaked a raw identifier`,
        ).toBe(false);
      }
    });

    // ─── No export / GET-only surface ────────────────────────────────

    it('rejects POST requests to the report surface (404 — no export endpoints)', async () => {
      await supertest(server)
        .post(reportsUrl(marketA))
        .set(authorized(admin.token))
        .expect(404);
      await supertest(server)
        .post(`${reportsUrl(marketA)}/R05`)
        .set(authorized(admin.token))
        .expect(404);
      await supertest(server)
        .post(`${reportsUrl(marketA)}/R05/export`)
        .set(authorized(admin.token))
        .expect(404);
    });

    // ─── Freshness + caching ─────────────────────────────────────────

    it('serves a cached FRESH snapshot within the TTL (same asOf, no re-query)', async () => {
      const first = await supertest(server)
        .get(`${reportsUrl(marketA)}/R05`)
        .set(authorized(admin.token))
        .expect(200);
      const second = await supertest(server)
        .get(`${reportsUrl(marketA)}/R05`)
        .set(authorized(admin.token))
        .expect(200);
      const firstBody = first.body as ReportBody;
      const secondBody = second.body as ReportBody;
      expect(secondBody.state).toBe('FRESH');
      expect(secondBody.asOf).toBe(firstBody.asOf);
      expect(secondBody.queryDurationMs).toBeUndefined(); // cache hit
    });

    // ─── Zero DML over frozen tables ─────────────────────────────────

    it('runs all 19 reports with zero writes to any frozen table', async () => {
      const frozenTables = [
        'accounts',
        'members',
        'member_market_preferences',
        'member_wallet_accounts',
        'member_wallet_entries',
        'mcp_accounts',
        'mcp_ledger_entries',
        'mcp_adjustment_requests',
        'mcp_refund_requests',
        'mcp_recharge_requests',
        'ipoint_adjustment_requests',
        'transactions',
        'transaction_service_fees',
        'transaction_mcp_debits',
        'transaction_reward_links',
        'reward_sources',
        'reward_plans',
        'reward_rule_versions',
        'reward_daily_accruals',
        'service_fee_profiles',
        'service_fee_versions',
        'security_events',
        'audit_logs',
        'merchant_groups',
        'merchant_branches',
        'merchant_applications',
        'admin_member_notes',
        'member_kyc_cases',
        'agent_activation',
        'commission_ledger',
        'commission_adjustment_request',
        'commission_rate_version',
        'redemption_orders',
        'redemption_fulfilments',
        'redemption_catalog_items',
        'redemption_refund_requests',
        'redemption_shipping_payments',
        'redemption_fulfilment_exceptions',
        'reconciliation_runs',
        'reconciliation_run_items',
        'reconciliation_exceptions',
        'risk_indicator_definitions',
        'risk_detection_runs',
        'risk_events',
        'risk_review_queue',
      ] as const;

      const before = await snapshotTables(frozenTables);
      // Run the full catalog plus every report detail (cache hits and live
      // reads alike) — the report module must never write to any table.
      await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(admin.token))
        .expect(200);
      for (const reportId of Array.from(
        { length: 19 },
        (_, index) => `R${String(index + 1).padStart(2, '0')}`,
      )) {
        await supertest(server)
          .get(`${reportsUrl(marketA)}/${reportId}`)
          .set(authorized(admin.token))
          .expect(200);
      }
      const after = await snapshotTables(frozenTables);
      for (const tableName of frozenTables) {
        expect(after[tableName], `table ${tableName} changed`).toBe(
          before[tableName],
        );
      }
    });
  },
);
