import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  agentActivations,
  dailyJobRuns,
  marketAccess,
  marketTransactionSettings,
  markets,
  mcpAccounts,
  mcpAdjustmentRequests,
  memberKycCases,
  memberMarketPreferences,
  members,
  memberWalletAccounts,
  merchantApplications,
  merchantBranches,
  merchantGroups,
  merchantKycSubmissions,
  merchantPackageAssignments,
  migrate,
  permissions,
  redemptionCatalogItems,
  redemptionFulfilmentExceptions,
  redemptionFulfilments,
  redemptionOrders,
  redemptionRateVersions,
  redemptionRefundRequests,
  rewardRuleVersions,
  roleAssignments,
  rolePermissions,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
  sessions,
  transactionPreviewSessions,
  transactions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Admin-Dashboard-Password-123!';

interface CatalogBody {
  asOf: string;
  marketId: string;
  items: Array<{
    id: string;
    name: string;
    definition: string;
    definitionVersion: number;
    freshnessClass: 'QUEUE' | 'KPI';
    currencyDimension: boolean;
    permission: string;
    source: string;
    state: 'FRESH' | 'STALE' | 'UNAVAILABLE';
    unavailableReason?: string;
    asOf: string;
    value?: Record<string, unknown>;
  }>;
}

interface ErrorBody {
  error: { code: string; message?: string };
}

describe.skipIf(!databaseUrl)(
  'Admin Dashboard HTTP integration (P7-S4A)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR, Asia/Kuala_Lumpur
    let marketB: string; // code MB, SGD, Asia/Singapore
    let actorAdminUserId: string;

    function authorized(token: string) {
      return { Authorization: `Bearer ${token}` };
    }

    async function ensureActiveMarket(
      code: string,
      currencyCode: string,
      timezone: string,
    ): Promise<string> {
      const existing = await database.db
        .select({ id: markets.id })
        .from(markets)
        .where(eq(markets.code, code))
        .limit(1);
      if (existing[0]) {
        await database.db
          .update(markets)
          .set({ status: 'ACTIVE' })
          .where(eq(markets.id, existing[0].id));
        return existing[0].id;
      }
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `${code} Dashboard Test Market`,
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

    async function getAccessToken(email: string): Promise<string> {
      return (await auth.login(email, password)).accessToken;
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
            description: `${code} integration test permission`,
          })),
        )
        .onConflictDoNothing({ target: permissions.code });
      const rows = await database.db.select().from(permissions);
      return rows
        .filter((row) => codes.includes(row.code))
        .map((row) => row.id);
    }

    /**
     * Session actor resolution (postgres-auth.store `hasActiveRole`) only
     * recognises the six template role codes, so each distinct permission set
     * used in this spec reuses one template-code role for the whole run.
     */
    const ADMIN_TEMPLATE_ROLE_CODES = [
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'FINANCE_OPERATOR',
      'FINANCE_APPROVER',
      'KYC_REVIEWER',
      'SUPPORT_READONLY_AUDITOR',
    ] as const;
    const roleCodeByPermissionSet = new Map<string, string>();

    async function createAdmin(options: {
      marketIds: string[];
      permissionCodes?: readonly string[];
    }): Promise<{ adminUserId: string; accountId: string; token: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `Dashboard Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? ['dashboard.view'];
      const signature = [...permissionCodes].sort().join('|');
      let roleCode = roleCodeByPermissionSet.get(signature);
      if (!roleCode) {
        roleCode =
          ADMIN_TEMPLATE_ROLE_CODES[
            roleCodeByPermissionSet.size % ADMIN_TEMPLATE_ROLE_CODES.length
          ] ?? 'SUPER_ADMIN';
        roleCodeByPermissionSet.set(signature, roleCode);
      }
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: roleCode,
          name: `Dashboard HTTP Test Role (${roleCode})`,
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
      const permissionIds = await ensurePermissions(permissionCodes);
      // SeedFoundation pre-loads the template roles with their canonical
      // permission sets; reshape the shared role so it carries exactly this
      // spec's permission set (idempotent for admins sharing the same set).
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
      // Real ADMIN-purpose session (auth.login creates an ACCOUNT session which
      // never satisfies the dashboard RbacGuard).
      const token = (
        await auth.createAdminSession(account.accountId, adminUserId, {
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        })
      ).accessToken;
      return {
        adminUserId,
        accountId: account.accountId,
        token,
      };
    }

    /** Bind the Current Admin Market server-side on the admin's active session. */
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
      status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE',
      options: { withPreference?: boolean } = {},
    ): Promise<{ memberId: string; accountId: string; email: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(members)
        .values({
          accountId: account.accountId,
          publicMemberId: `mem_${randomUUID()}`,
          referralCode: randomUUID()
            .replaceAll('-', '')
            .slice(0, 8)
            .toUpperCase(),
          status,
          kycLevel: 'NONE',
        })
        .returning({ id: members.id });
      const memberId = inserted[0]?.id ?? '';
      if (options.withPreference !== false) {
        await database.db.insert(memberMarketPreferences).values({
          memberId,
          marketId,
          isEnabled: true,
          isCurrent: true,
          sortOrder: 0,
        });
      }
      return { memberId, accountId: account.accountId, email: account.email };
    }

    async function createMerchantGroup(
      accountId: string,
      marketId: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(merchantGroups)
        .values({
          accountId,
          marketId,
          name: `Dashboard Merchant ${randomUUID()}`,
        })
        .returning({ id: merchantGroups.id });
      return inserted[0]?.id ?? '';
    }

    async function createMerchantBranch(
      groupId: string,
      marketId: string,
      merchantId: string,
      status: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: groupId,
          merchantId,
          marketId,
          name: `Branch ${merchantId}`,
          status: status as never,
        })
        .returning({ id: merchantBranches.id });
      return inserted[0]?.id ?? '';
    }

    async function createMcpAccount(
      branchId: string,
      marketId: string,
      availableBalance: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(mcpAccounts)
        .values({
          merchantBranchId: branchId,
          marketId,
          availableBalance,
          totalBalance: availableBalance,
        })
        .returning({ id: mcpAccounts.id });
      return inserted[0]?.id ?? '';
    }

    async function createDailyJobRun(params: {
      marketId: string;
      status: string;
      localBusinessDate: string;
    }): Promise<void> {
      await database.db.insert(dailyJobRuns).values({
        jobType: 'REWARD_PLAN_PROCESSING',
        marketId: params.marketId,
        localBusinessDate: params.localBusinessDate,
        status: params.status as never,
        totalEntitlements: 10,
        processedCount: params.status === 'COMPLETED' ? 10 : 0,
        failedCount: params.status === 'FAILED' ? 10 : 0,
        ...(params.status === 'RUNNING' ? { startedAt: new Date() } : {}),
        ...(params.status === 'COMPLETED'
          ? {
              startedAt: new Date(Date.now() - 60_000),
              completedAt: new Date(),
            }
          : {}),
      });
    }

    async function createTransactionFixture(params: {
      marketId: string;
      currency: string;
      purchaseAmount: string;
      confirmedAt: Date;
      status?: string;
    }): Promise<void> {
      const settings = await database.db
        .insert(marketTransactionSettings)
        .values({
          marketId: params.marketId,
          currencyCode: params.currency,
          currencyScale: 2,
          minimumTransactionAmount: '0.01',
          maximumTransactionAmount: '1000000.00',
        })
        .onConflictDoNothing()
        .returning({ marketId: marketTransactionSettings.marketId });

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

      const branchRows = await database.db
        .select({ id: merchantBranches.id })
        .from(merchantBranches)
        .where(eq(merchantBranches.marketId, params.marketId))
        .limit(1);
      const branchId = branchRows[0]?.id ?? '';
      // enforce_active_default_assignment (deferred, fires at commit) requires
      // exactly ONE ACTIVE default package assignment per merchant branch, so
      // only the first assignment created for a branch may be the default.
      const existingDefault = await database.db
        .select({ id: merchantPackageAssignments.id })
        .from(merchantPackageAssignments)
        .where(
          and(
            eq(merchantPackageAssignments.merchantBranchId, branchId),
            eq(merchantPackageAssignments.isDefault, true),
          ),
        )
        .limit(1);
      const assignment = await database.db
        .insert(merchantPackageAssignments)
        .values({
          merchantBranchId: branchId,
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
          createdBy: actorAdminUserId,
        })
        .returning({ id: rewardRuleVersions.id });

      const memberRows = await database.db
        .select({ id: members.id })
        .from(members)
        .innerJoin(
          memberMarketPreferences,
          eq(memberMarketPreferences.memberId, members.id),
        )
        .where(
          and(
            eq(memberMarketPreferences.marketId, params.marketId),
            eq(memberMarketPreferences.isEnabled, true),
          ),
        )
        .limit(1);
      const memberId = memberRows[0]?.id ?? '';
      const wallet = await database.db
        .insert(memberWalletAccounts)
        .values({ memberId, marketId: params.marketId })
        .onConflictDoNothing()
        .returning({ id: memberWalletAccounts.id });

      const preview = await database.db
        .insert(transactionPreviewSessions)
        .values({
          status: 'CONFIRMED',
          merchantBranchId: branchId,
          merchantAccountId:
            (
              await database.db
                .select({ id: accounts.id })
                .from(accounts)
                .limit(1)
            )[0]?.id ?? '',
          createdByStaffAccountId:
            (
              await database.db
                .select({ id: accounts.id })
                .from(accounts)
                .limit(1)
            )[0]?.id ?? '',
          memberId,
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
          marketTimezone:
            params.marketId === marketA
              ? 'Asia/Kuala_Lumpur'
              : 'Asia/Singapore',
          previewedAt: new Date(params.confirmedAt.getTime() - 60_000),
          confirmedAt: params.confirmedAt,
        })
        .returning({ id: transactionPreviewSessions.id });

      await database.db.insert(transactions).values({
        previewSessionId: preview[0]?.id ?? '',
        merchantReceiptNumber: `RCPT_${randomUUID()}`,
        status: (params.status ?? 'CONFIRMED') as never,
        merchantBranchId: branchId,
        merchantAccountId:
          (
            await database.db
              .select({ id: accounts.id })
              .from(accounts)
              .limit(1)
          )[0]?.id ?? '',
        confirmedByStaffAccountId:
          (
            await database.db
              .select({ id: accounts.id })
              .from(accounts)
              .limit(1)
          )[0]?.id ?? '',
        memberId,
        protectedMemberReference: `ref_${randomUUID()}`,
        marketId: params.marketId,
        currency: params.currency,
        purchaseAmount: params.purchaseAmount,
        transactionNote: 'dashboard fixture',
        merchantPackageAssignmentId: assignment[0]?.id ?? '',
        merchantPackageVersion: 1,
        merchantPackageSnapshot: { packageCode: 'B', rate: '5.000000' },
        rewardRuleVersionId: rule[0]?.id ?? '',
        rewardRate: '0.0100000000',
        rewardPrincipal: params.purchaseAmount,
        rewardCap: '0',
        dailyRewardAmount: '0',
        rewardStartBusinessDate: '2026-08-03',
        marketTimezone:
          params.marketId === marketA ? 'Asia/Kuala_Lumpur' : 'Asia/Singapore',
        confirmedAt: params.confirmedAt,
      });
      void settings;
      void wallet;
    }

    async function createRedemptionFixture(marketId: string): Promise<void> {
      const memberRows = await database.db
        .select({ id: members.id })
        .from(members)
        .innerJoin(
          memberMarketPreferences,
          eq(memberMarketPreferences.memberId, members.id),
        )
        .where(
          and(
            eq(memberMarketPreferences.marketId, marketId),
            eq(memberMarketPreferences.isEnabled, true),
          ),
        )
        .limit(1);
      const memberId = memberRows[0]?.id ?? '';
      let walletRows = await database.db
        .select({ id: memberWalletAccounts.id })
        .from(memberWalletAccounts)
        .where(
          and(
            eq(memberWalletAccounts.memberId, memberId),
            eq(memberWalletAccounts.marketId, marketId),
          ),
        )
        .limit(1);
      if (walletRows.length === 0) {
        walletRows = await database.db
          .insert(memberWalletAccounts)
          .values({ memberId, marketId })
          .onConflictDoNothing()
          .returning({ id: memberWalletAccounts.id });
      }
      const walletAccountId = walletRows[0]?.id ?? '';

      const rate = await database.db
        .insert(redemptionRateVersions)
        .values({
          marketId,
          rateType: 'CURRENCY_PER_POINT',
          rateValue: '1.0000000000',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          createdBy: actorAdminUserId,
        })
        .returning({ id: redemptionRateVersions.id });

      const item = await database.db
        .insert(redemptionCatalogItems)
        .values({
          marketId,
          name: `Item ${randomUUID()}`,
          itemType: 'PHYSICAL',
          fiatReferenceValue: '10.0000000000',
          fiatCurrency: marketId === marketA ? 'MYR' : 'SGD',
          createdBy: actorAdminUserId,
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
          walletAccountId: walletAccountId,
          rateVersionId: rate[0]?.id ?? '',
          rateValue: '1.0000000000',
          status: 'FULFILMENT_EXCEPTION',
          unroundedPointCost: '10.0000000000',
          postedPointCost: '10.0000000000',
          totalPoints: '10.0000000000',
          quantity: '1',
          itemSnapshot: { name: 'item' },
          rateSnapshot: { rate: '1.0000000000' },
        })
        .returning({ id: redemptionOrders.id });

      const fulfilment = await database.db
        .insert(redemptionFulfilments)
        .values({
          orderId: order[0]?.id ?? '',
          fulfilmentType: 'PHYSICAL',
          status: 'FAILED',
        })
        .returning({ id: redemptionFulfilments.id });

      await database.db.insert(redemptionFulfilmentExceptions).values({
        fulfilmentId: fulfilment[0]?.id ?? '',
        orderId: order[0]?.id ?? '',
        severity: 'NON_RETRYABLE',
        errorCode: 'CARRIER_REJECTED',
        errorMessage: 'Carrier rejected the shipment.',
        resolved: false,
      });
      await database.db.insert(redemptionRefundRequests).values({
        orderId: order[0]?.id ?? '',
        makerId: actorAdminUserId,
        status: 'PENDING_CHECKER',
        refundAmount: '10.0000000000',
        reason: 'Fixture refund request',
      });
    }

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'admin-dashboard-http-pepper-at-least-32-characters',
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
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await ensureActiveMarket('MA', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('MB', 'SGD', 'Asia/Singapore');

      // The dashboard fixture admin (creator for audit-referenced rows).
      const fixtureAdmin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['dashboard.view'],
      });
      actorAdminUserId = fixtureAdmin.adminUserId;

      // ── Members (M01/M02/M03) ────────────────────────────────────────
      const memberA1 = await createMember(marketA, 'ACTIVE');
      await createMember(marketA, 'ACTIVE');
      const memberA3 = await createMember(marketA, 'SUSPENDED');
      await createMember(marketB, 'ACTIVE');

      // Member KYC (M07): market A -> 1 SUBMITTED, 1 APPROVED.
      await database.db.insert(memberKycCases).values({
        memberId: memberA1.memberId,
        marketId: marketA,
        status: 'SUBMITTED',
        levelRequested: 'LEVEL_1',
      });
      await database.db.insert(memberKycCases).values({
        memberId: memberA3.memberId,
        marketId: marketA,
        status: 'APPROVED',
        levelRequested: 'LEVEL_1',
      });

      // ── Merchants (M04/M05/M06) ──────────────────────────────────────
      const groupA = await createMerchantGroup(memberA1.accountId, marketA);
      const branchA1 = await createMerchantBranch(
        groupA,
        marketA,
        'MA-001',
        'ACTIVE',
      );
      const branchA2 = await createMerchantBranch(
        groupA,
        marketA,
        'MA-002',
        'SUSPENDED',
      );
      const groupB = await createMerchantGroup(memberA1.accountId, marketB);
      const branchB1 = await createMerchantBranch(
        groupB,
        marketB,
        'MB-001',
        'ACTIVE',
      );

      await database.db.insert(merchantApplications).values([
        { merchantBranchId: branchA1, status: 'SUBMITTED' },
        { merchantBranchId: branchA2, status: 'APPROVED' },
        { merchantBranchId: branchB1, status: 'SUBMITTED' },
      ]);
      await database.db.insert(merchantKycSubmissions).values([
        {
          merchantBranchId: branchA1,
          status: 'UNDER_REVIEW',
          submissionVersion: 1,
          submittedData: { kyc: true },
          submittedAt: new Date(),
        },
        {
          merchantBranchId: branchA2,
          status: 'SUBMITTED',
          submissionVersion: 1,
          submittedData: { kyc: true },
          submittedAt: new Date(),
        },
        {
          merchantBranchId: branchB1,
          status: 'SUBMITTED',
          submissionVersion: 1,
          submittedData: { kyc: true },
          submittedAt: new Date(),
        },
      ]);

      // ── MCP (M09/M14) ────────────────────────────────────────────────
      const mcpA1 = await createMcpAccount(
        branchA1,
        marketA,
        '1000.5000000000',
      );
      await createMcpAccount(branchA2, marketA, '250.0000000000');
      await createMcpAccount(branchB1, marketB, '500.0000000000');
      await database.db.insert(mcpAdjustmentRequests).values({
        mcpAccountId: mcpA1,
        marketId: marketA,
        makerAdminUserId: actorAdminUserId,
        entryType: 'MANUAL_CREDIT',
        amount: '50.0000000000',
        reason: 'Fixture MCP adjustment',
        evidence: {},
        status: 'PENDING_APPROVAL',
        idempotencyKey: `adj_${randomUUID()}`,
        // CHECK mcp_adjustment_payload_hash_check: length(payload_hash) = 64.
        payloadHash: createHash('sha256').update(randomUUID()).digest('hex'),
      });

      // ── Agents (M08) ─────────────────────────────────────────────────
      await database.db.insert(agentActivations).values({
        memberId: memberA1.memberId,
        status: 'PENDING_APPROVAL',
        market: 'MA',
        currency: 'MYR',
      });
      await database.db.insert(agentActivations).values({
        memberId: memberA3.memberId,
        status: 'ACTIVE',
        market: 'MB',
        currency: 'SGD',
      });

      // ── Reward jobs (M12) ────────────────────────────────────────────
      const localDate = (offsetDays: number): string => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - offsetDays);
        return d.toISOString().slice(0, 10);
      };
      await createDailyJobRun({
        marketId: marketA,
        status: 'RUNNING',
        localBusinessDate: localDate(0),
      });
      await createDailyJobRun({
        marketId: marketA,
        status: 'COMPLETED',
        localBusinessDate: localDate(1),
      });
      await createDailyJobRun({
        marketId: marketA,
        status: 'FAILED',
        localBusinessDate: localDate(40),
      });

      // ── Transactions (M13) ───────────────────────────────────────────
      const now = new Date();
      const yesterday = new Date(now.getTime() - 86_400_000);
      await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '100.50',
        confirmedAt: now,
      });
      await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '50.00',
        confirmedAt: now,
      });
      // market_transaction_settings is keyed on market_id (one settings row per
      // market), so all market-A fixtures must share the market's currency.
      await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '10.00',
        confirmedAt: now,
      });
      await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '999.00',
        confirmedAt: yesterday,
      });
      await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '5.00',
        confirmedAt: now,
        status: 'REJECTED',
      });
      await createTransactionFixture({
        marketId: marketB,
        currency: 'SGD',
        purchaseAmount: '20.00',
        confirmedAt: now,
      });

      // ── Redemption (M11) ─────────────────────────────────────────────
      await createRedemptionFixture(marketA);
    });

    afterAll(async () => {
      await app.close();
      vi.unstubAllEnvs();
    });

    beforeEach(() => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
    });

    describe('authentication, RBAC, and market enforcement', () => {
      it('returns 401 without authentication and 403 for a non-admin actor', async () => {
        await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .expect(401);

        const member = await createMember(marketA, 'ACTIVE', {
          // No market preference: this throwaway member must not shift the
          // dashboard count fixtures (M01/M02/M03 count preference rows).
          withPreference: false,
        });
        const memberToken = await getAccessToken(member.email);
        const denied = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(memberToken))
          .expect(403);
        expect((denied.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
      });

      it('denies an admin without the dashboard.view permission', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
      });

      it('requires a server-selected Current Admin Market (MARKET_SELECTION_REQUIRED)', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_SELECTION_REQUIRED',
        );
      });

      it('rejects a client-supplied market that differs from the Current Admin Market', async () => {
        const admin = await createAdmin({ marketIds: [marketA, marketB] });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .set('x-market-id', marketB)
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });

      it('supports the full canonical flow: login -> bootstrap -> select current market -> catalog', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['dashboard.view', 'admin.market.select'],
        });
        const bootstrap = await supertest(server)
          .get('/api/v1/admin/bootstrap')
          .set(authorized(admin.token))
          .expect(200);
        const contextVersion = (bootstrap.body as { contextVersion: number })
          .contextVersion;
        await supertest(server)
          .put('/api/v1/admin/me/current-market')
          .set(authorized(admin.token))
          .send({
            market_id: marketA,
            expected_context_version: contextVersion,
          })
          .expect(200);
        const catalog = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(200);
        const body = catalog.body as CatalogBody;
        expect(body.marketId).toBe(marketA);
        expect(body.items).toHaveLength(14);
      });
    });

    describe('catalog correctness against real fixtures (CG-05)', () => {
      it('returns bounded server aggregates that equal the real source rows', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [
            'dashboard.view',
            'merchant.mcp.view',
            'reward.job.read',
          ],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as CatalogBody;
        expect(body.marketId).toBe(marketA);
        expect(body.items).toHaveLength(14);
        const metric = (id: string) => body.items.find((m) => m.id === id);

        const m01 = metric('M01');
        expect(m01?.state).toBe('FRESH');
        expect(m01?.value).toMatchObject({ kind: 'COUNT', count: 3 });
        expect(metric('M02')?.value).toMatchObject({ kind: 'COUNT', count: 2 });
        expect(metric('M03')?.value).toMatchObject({ kind: 'COUNT', count: 1 });
        expect(metric('M04')?.value).toMatchObject({
          kind: 'BREAKDOWN',
          breakdown: { total: 2, active: 1 },
        });
        expect(metric('M05')?.value).toMatchObject({ kind: 'COUNT', count: 1 });
        expect(metric('M06')?.value).toMatchObject({ kind: 'COUNT', count: 2 });
        expect(metric('M07')?.value).toMatchObject({ kind: 'COUNT', count: 1 });
        expect(metric('M08')?.value).toMatchObject({
          kind: 'BREAKDOWN',
          breakdown: { total: 1, pendingActivation: 1 },
        });
        expect(metric('M09')?.value).toMatchObject({ kind: 'COUNT', count: 1 });
        expect(metric('M11')?.value).toMatchObject({
          kind: 'QUEUE_SUMMARY',
          counts: { fulfilmentExceptions: 1, refundRequests: 1 },
        });
        expect(metric('M12')?.value).toMatchObject({
          kind: 'JOB_STATUS',
          latestRun: { jobType: 'REWARD_PLAN_PROCESSING', status: 'RUNNING' },
          statusCounts: { RUNNING: 1, COMPLETED: 1 },
        });
        const m13 = metric('M13');
        expect(m13?.value).toEqual({
          kind: 'CURRENCY_TOTALS',
          totals: [
            { currency: 'MYR', count: 3, totalAmount: '160.5000000000' },
          ],
        });
        expect(metric('M14')?.value).toEqual({
          kind: 'BALANCE',
          currency: 'MYR',
          totalAvailableBalance: '1250.5000000000',
        });
      });

      it('exposes M10 as UNAVAILABLE (NO_DURABLE_SOURCE) and never fabricates a value', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['dashboard.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(200);
        const m10 = (response.body as CatalogBody).items.find(
          (m) => m.id === 'M10',
        );
        expect(m10?.state).toBe('UNAVAILABLE');
        expect(m10?.unavailableReason).toBe('NO_DURABLE_SOURCE');
        expect(m10?.value).toBeUndefined();
      });

      it('isolates metrics to the selected market and never leaks another market', async () => {
        const admin = await createAdmin({
          marketIds: [marketB],
          // merchant.mcp.view is the source permission for M09/M14; without it
          // those metrics report SOURCE_PERMISSION_DENIED and this isolation
          // test could not verify their market-bound values.
          permissionCodes: ['dashboard.view', 'merchant.mcp.view'],
        });
        await setCurrentMarket(admin.accountId, marketB);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as CatalogBody;
        expect(body.marketId).toBe(marketB);
        const metric = (id: string) => body.items.find((m) => m.id === id);
        expect(metric('M01')?.value).toMatchObject({ kind: 'COUNT', count: 1 });
        expect(metric('M04')?.value).toMatchObject({
          kind: 'BREAKDOWN',
          breakdown: { total: 1, active: 1 },
        });
        expect(metric('M05')?.value).toMatchObject({ kind: 'COUNT', count: 1 });
        expect(metric('M06')?.value).toMatchObject({ kind: 'COUNT', count: 1 });
        expect(metric('M09')?.value).toMatchObject({ kind: 'COUNT', count: 0 });
        expect(metric('M13')?.value).toEqual({
          kind: 'CURRENCY_TOTALS',
          totals: [{ currency: 'SGD', count: 1, totalAmount: '20.0000000000' }],
        });
        expect(metric('M14')?.value).toEqual({
          kind: 'BALANCE',
          currency: 'SGD',
          totalAvailableBalance: '500.0000000000',
        });
        expect(metric('M07')?.value).toMatchObject({ kind: 'COUNT', count: 0 });
      });

      it('keeps financial source permissions: M09/M12/M14 unavailable without their source permission', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['dashboard.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(200);
        const items = (response.body as CatalogBody).items;
        for (const id of ['M09', 'M12', 'M14']) {
          const item = items.find((m) => m.id === id);
          expect(item?.state).toBe('UNAVAILABLE');
          expect(item?.unavailableReason).toBe('SOURCE_PERMISSION_DENIED');
          expect(item?.value).toBeUndefined();
        }
        const m13 = items.find((m) => m.id === 'M13');
        expect(m13?.state).toBe('FRESH');
      });

      it('does not write to any domain table while composing the dashboard', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [
            'dashboard.view',
            'merchant.mcp.view',
            'reward.job.read',
          ],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const before = await database.pool.query(
          'SELECT (SELECT count(*) FROM transactions) t, (SELECT count(*) FROM merchant_branches) m, (SELECT count(*) FROM daily_job_runs) j',
        );
        await supertest(server)
          .get('/api/v1/admin/dashboard/metrics')
          .set(authorized(admin.token))
          .expect(200);
        const after = await database.pool.query(
          'SELECT (SELECT count(*) FROM transactions) t, (SELECT count(*) FROM merchant_branches) m, (SELECT count(*) FROM daily_job_runs) j',
        );
        expect(after.rows[0]).toEqual(before.rows[0]);
      });
    });

    describe('single metric detail and drill-down', () => {
      it('returns a FRESH metric with definition version, asOf, and drill-down reference', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['dashboard.view', 'merchant.mcp.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics/M14')
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as {
          id: string;
          state: string;
          definitionVersion: number;
          asOf: string;
          marketId: string;
          value: {
            kind: string;
            currency: string;
            totalAvailableBalance: string;
          };
          drillDown: {
            metricId: string;
            marketId: string;
            marketScope: string;
            permission: string;
            masking: boolean;
            metricFilter: string | null;
            timeBoundary: { from: string; to: string } | null;
          };
        };
        expect(body.id).toBe('M14');
        expect(body.state).toBe('FRESH');
        expect(body.definitionVersion).toBe(1);
        expect(body.asOf).toBeTruthy();
        expect(body.marketId).toBe(marketA);
        expect(body.value).toEqual({
          kind: 'BALANCE',
          currency: 'MYR',
          totalAvailableBalance: '1250.5000000000',
        });
        expect(body.drillDown).toMatchObject({
          metricId: 'M14',
          marketId: marketA,
          marketScope: 'SELECTED',
          permission: 'dashboard.view',
          masking: true,
          metricFilter: null,
        });
      });

      it('preserves the time boundary for M13 (market-local today start) and M12', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['dashboard.view', 'reward.job.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const m13 = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics/M13')
          .set(authorized(admin.token))
          .expect(200);
        const m13Body = m13.body as {
          drillDown: { timeBoundary: { from: string; to: string } };
        };
        expect(m13Body.drillDown.timeBoundary.from).toBeTruthy();
        expect(m13Body.drillDown.timeBoundary.to).toBeTruthy();

        const m12 = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics/M12')
          .set(authorized(admin.token))
          .expect(200);
        const m12Body = m12.body as {
          drillDown: { timeBoundary: { from: string; to: string } };
        };
        expect(m12Body.drillDown.timeBoundary.from).toBeTruthy();
        expect(m12Body.drillDown.timeBoundary.to).toBeTruthy();
      });

      it('returns 422 DASHBOARD_METRIC_UNDEFINED for unknown metrics', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics/M99')
          .set(authorized(admin.token))
          .expect(422);
        expect((response.body as ErrorBody).error.code).toBe(
          'DASHBOARD_METRIC_UNDEFINED',
        );
      });

      it('returns 503 DASHBOARD_DATA_UNAVAILABLE for M10 (SEC-01 blocked source)', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get('/api/v1/admin/dashboard/metrics/M10')
          .set(authorized(admin.token))
          .expect(503);
        expect((response.body as ErrorBody).error.code).toBe(
          'DASHBOARD_DATA_UNAVAILABLE',
        );
      });
    });
  },
);
