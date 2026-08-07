import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  agentActivations,
  marketAccess,
  marketTransactionSettings,
  markets,
  mcpAccounts,
  mcpAdjustmentRequests,
  memberMarketPreferences,
  members,
  memberWalletAccounts,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  migrate,
  permissions,
  redemptionCatalogItems,
  redemptionFulfilments,
  redemptionOrders,
  redemptionRateVersions,
  rewardRuleVersions,
  roleAssignments,
  rolePermissions,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
  sessions,
  transactionPreviewSessions,
  transactions,
  ipointAdjustmentRequests,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'P7-S9-Reports-Password-123!';

/** Frozen SLA targets (P7-OD-16): QUEUE ≤ 60s, KPI ≤ 5m. */
const QUEUE_SLA_MS = 60_000;
const KPI_SLA_MS = 5 * 60_000;

interface ErrorBody {
  error: { code: string; message?: string };
}

interface ReportBody {
  id: string;
  key: string;
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
 * P7-S9 Admin Basic Reports HTTP integration (Command Center 2026-08-07
 * §7.2) on a fresh real PostgreSQL database.
 *
 * Asserts:
 * - market-scoped bounded reports with real counts over existing tables;
 * - the freshness contract on a real DB (asOf / freshness / stale /
 *   unavailable present on every report; FRESH live values; cached FRESH
 *   snapshot served within the TTL);
 * - no fabricated zeros (real counts from authoritative rows; an
 *   unavailable source is never presented as zero);
 * - market isolation (foreign-market rows excluded; URL/current-market
 *   mismatch 409);
 * - the permission matrix (401 / 403 member / 403 no permission);
 * - the frozen performance targets: every measured source-query duration
 *   stays under QUEUE ≤ 60s / KPI ≤ 5m.
 */
describe.skipIf(!databaseUrl)(
  'Admin Basic Reports HTTP integration (P7-S9, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let marketA: string; // MY
    let marketB: string; // SG
    let actorAdminUserId: string;
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
          name: `${code} P7-S9 Reports Test Market`,
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
            description: `${code} p7-s9 reports test permission`,
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
          displayName: `P7-S9 Reports Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleCode = options.roleCode ?? 'SUPER_ADMIN';
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: roleCode,
          name: `P7-S9 Reports HTTP Test Role (${roleCode})`,
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

    async function createMember(marketId: string): Promise<string> {
      const account = await createAccount();
      const memberId = randomUUID();
      await database.db.insert(members).values({
        id: memberId,
        accountId: account.accountId,
        publicMemberId: `M-${randomUUID()}`,
        referralCode: `R-${randomUUID()}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_2',
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

    async function createMerchantChain(marketId: string): Promise<{
      branchId: string;
      accountId: string;
    }> {
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
          merchantId: account.accountId,
          marketId,
          name: `Reports Branch ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: merchantBranches.id });
      return { branchId: branch[0]?.id ?? '', accountId: account.accountId };
    }

    async function createTransactionFixture(params: {
      marketId: string;
      currency: string;
      purchaseAmount: string;
      confirmedAt: Date;
    }): Promise<void> {
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

      const branchRows = await database.db
        .select({ id: merchantBranches.id })
        .from(merchantBranches)
        .where(eq(merchantBranches.marketId, params.marketId))
        .limit(1);
      const branchId = branchRows[0]?.id ?? '';
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
      void wallet;

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
          marketTimezone: 'Asia/Kuala_Lumpur',
          previewedAt: new Date(params.confirmedAt.getTime() - 60_000),
          confirmedAt: params.confirmedAt,
        })
        .returning({ id: transactionPreviewSessions.id });

      await database.db.insert(transactions).values({
        previewSessionId: preview[0]?.id ?? '',
        merchantReceiptNumber: `RCPT_${randomUUID()}`,
        status: 'CONFIRMED',
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
        transactionNote: 'reports fixture',
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
      });
    }

    async function createMcpAdjustment(
      marketId: string,
      branchId: string,
    ): Promise<void> {
      const mcp = await database.db
        .insert(mcpAccounts)
        .values({
          merchantBranchId: branchId,
          marketId,
          availableBalance: '1000.0000000000',
          totalBalance: '1000.0000000000',
        })
        .returning({ id: mcpAccounts.id });
      await database.db.insert(mcpAdjustmentRequests).values({
        mcpAccountId: mcp[0]?.id ?? '',
        marketId,
        makerAdminUserId: actorAdminUserId,
        entryType: 'MANUAL_CREDIT',
        amount: '50.00000000',
        reason: 'Reports fixture MCP adjustment',
        evidence: {},
        status: 'PENDING_APPROVAL',
        idempotencyKey: `adj_${randomUUID()}`,
        payloadHash: createHash('sha256').update(randomUUID()).digest('hex'),
      });
    }

    async function createIpointAdjustment(
      marketId: string,
      memberId: string,
    ): Promise<void> {
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
      await database.db.insert(ipointAdjustmentRequests).values({
        walletAccountId: walletRows[0]?.id ?? '',
        memberId,
        marketId,
        direction: 'CREDIT',
        amount: '10.0000000000',
        state: 'EXECUTED',
        reasonCode: 'CUSTOMER_GOODWILL',
        explanation:
          'Reports fixture iPoint adjustment with a long enough explanation',
        caseReference: `CASE_${randomUUID().slice(0, 12)}`,
        makerAdminUserId: actorAdminUserId,
        idempotencyScope: 'REPORTS_FIXTURE',
        idempotencyKey: `ip_${randomUUID()}`,
        payloadHash: createHash('sha256').update(randomUUID()).digest('hex'),
        requestHash: createHash('sha256').update(randomUUID()).digest('hex'),
      });
    }

    async function createRedemptionFixture(
      marketId: string,
      memberId: string,
      walletAccountId: string,
      status: string,
    ): Promise<void> {
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
          fiatCurrency: 'MYR',
          createdBy: actorAdminUserId,
          status: 'ACTIVE',
        })
        .returning({ id: redemptionCatalogItems.id });
      await database.db.insert(redemptionOrders).values({
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
      });
    }

    async function createFulfilmentForOrder(
      orderReference: string,
      status: string,
    ): Promise<void> {
      const order = await database.db
        .select({ id: redemptionOrders.id })
        .from(redemptionOrders)
        .where(eq(redemptionOrders.orderReference, orderReference))
        .limit(1);
      await database.db.insert(redemptionFulfilments).values({
        orderId: order[0]?.id ?? '',
        fulfilmentType: 'PHYSICAL',
        status: status as never,
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
        kycLevel: 'LEVEL_2',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: account.email, password })
        .expect(200);
      return String((response.body as { accessToken: string }).accessToken);
    }

    beforeAll(async () => {
      const dbName = new URL(databaseUrl ?? '').pathname.replace(/^\//u, '');
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
      vi.stubEnv('REDIS_URL', 'redis://172.23.0.2:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'p7-s9-reports-pepper-at-least-32-characters',
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
      actorAdminUserId = admin.adminUserId;
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

      // Market A fixtures: transactions (2 CONFIRMED), 1 MCP adjustment,
      // 1 iPoint adjustment, 2 redemption orders + 1 fulfilment, 2 member
      // registrations (today + yesterday), 1 agent activation (MY, today).
      const chainA = await createMerchantChain(marketA);
      const memberA1 = await createMember(marketA);
      await createMember(marketA);
      await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '88.0000000000',
        confirmedAt: new Date(),
      });
      await createTransactionFixture({
        marketId: marketA,
        currency: 'MYR',
        purchaseAmount: '99.0000000000',
        confirmedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      await createMcpAdjustment(marketA, chainA.branchId);
      await createIpointAdjustment(marketA, memberA1);
      await createRedemptionFixture(
        marketA,
        memberA1,
        (
          await database.db
            .select({ id: memberWalletAccounts.id })
            .from(memberWalletAccounts)
            .where(eq(memberWalletAccounts.memberId, memberA1))
            .limit(1)
        )[0]?.id ?? '',
        'CONFIRMED',
      );
      await createRedemptionFixture(
        marketA,
        memberA1,
        (
          await database.db
            .select({ id: memberWalletAccounts.id })
            .from(memberWalletAccounts)
            .where(eq(memberWalletAccounts.memberId, memberA1))
            .limit(1)
        )[0]?.id ?? '',
        'READY_FOR_PICKUP',
      );
      await createFulfilmentForOrder(
        (
          await database.db
            .select({ orderReference: redemptionOrders.orderReference })
            .from(redemptionOrders)
            .where(eq(redemptionOrders.status, 'READY_FOR_PICKUP'))
            .limit(1)
        )[0]?.orderReference ?? '',
        'COMPLETED',
      );
      await database.db.insert(agentActivations).values({
        memberId: memberA1,
        status: 'ACTIVE',
        market: 'MY',
        currency: 'MYR',
        activatedAt: new Date(),
      });

      // Market B fixtures: 1 CONFIRMED transaction, 1 registration, 1
      // agent activation (SG) — isolation targets.
      await createMerchantChain(marketB);
      await createMember(marketB);
      await createTransactionFixture({
        marketId: marketB,
        currency: 'SGD',
        purchaseAmount: '77.0000000000',
        confirmedAt: new Date(),
      });
      await database.db.insert(agentActivations).values({
        memberId:
          (
            await database.db.select({ id: members.id }).from(members).limit(1)
          )[0]?.id ?? '',
        status: 'PENDING_APPROVAL',
        market: 'SG',
        currency: 'SGD',
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
        .get(`${reportsUrl(marketA)}/R01`)
        .expect(401);
    });

    it('rejects a member session (403)', async () => {
      await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(memberToken))
        .expect(403);
      await supertest(server)
        .get(`${reportsUrl(marketA)}/R01`)
        .set(authorized(memberToken))
        .expect(403);
    });

    it('rejects an admin without report.read (403)', async () => {
      await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(noPermissionAdmin.token))
        .expect(403);
      await supertest(server)
        .get(`${reportsUrl(marketA)}/R01`)
        .set(authorized(noPermissionAdmin.token))
        .expect(403);
    });

    it('allows the Support template and measures the first live source queries (P7-OD-16 SLA)', async () => {
      const response = await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(supportAdmin.token))
        .expect(200);
      const body = response.body as CatalogBody;
      // This is the first successful read of the suite, so every report
      // carries its measured live source-query duration. Frozen targets:
      // QUEUE ≤ 60s, KPI ≤ 5m — recorded for the gate report.
      for (const item of body.items) {
        expect(typeof item.queryDurationMs).toBe('number');
        const target =
          item.freshnessClass === 'QUEUE' ? QUEUE_SLA_MS : KPI_SLA_MS;
        expect(item.queryDurationMs! < target).toBe(true);
        console.log(
          `[P7-S9 perf] ${item.id} (${String(item.freshnessClass)}) queryDurationMs=${item.queryDurationMs} (SLA ${target}ms)`,
        );
      }
    });

    // ─── Freshness contract + real values ────────────────────────────

    it('serves the catalog with every report carrying asOf/freshness/stale/unavailable', async () => {
      const response = await supertest(server)
        .get(reportsUrl(marketA))
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as CatalogBody;
      expect(body.marketId).toBe(marketA);
      expect(body.items).toHaveLength(4);
      const ids = body.items.map((item) => item.id);
      expect(ids).toEqual(['R01', 'R02', 'R03', 'R04']);
      for (const item of body.items) {
        expect(typeof item.asOf).toBe('string');
        expect(['FRESH', 'STALE', 'UNAVAILABLE']).toContain(item.state);
        expect(typeof item.stale).toBe('boolean');
        expect(typeof item.unavailable).toBe('boolean');
        expect(item.permission).toBe('report.read');
      }
      expect(body.items.find((item) => item.id === 'R03')?.freshnessClass).toBe(
        'QUEUE',
      );
      // Detail reads after the first live read may be cache hits; when a
      // live query ran, its measured duration must stay under the frozen
      // SLA (asserted in the first-read test above).
      for (const item of body.items) {
        if (item.queryDurationMs !== undefined) {
          const target =
            item.freshnessClass === 'QUEUE' ? QUEUE_SLA_MS : KPI_SLA_MS;
          expect(item.queryDurationMs < target).toBe(true);
        }
      }
    });

    it('R01 reports real transaction counts for the selected market (no fabricated values)', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R01`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as ReportBody;
      expect(body.state).toBe('FRESH');
      expect(body.stale).toBe(false);
      expect(body.unavailable).toBe(false);
      const value = body.value as {
        kind: string;
        total: number;
        counts: Record<string, number>;
      };
      expect(value.kind).toBe('STATUS_COUNTS');
      expect(value.total).toBe(2);
      expect(value.counts['CONFIRMED']).toBe(2);
    });

    it('R02 reports MCP + iPoint adjustment summaries', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R02`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as ReportBody;
      expect(body.state).toBe('FRESH');
      const value = body.value as {
        kind: string;
        mcp: { total: number; counts: Record<string, number> };
        ipoint: { total: number; counts: Record<string, number> };
      };
      expect(value.kind).toBe('ADJUSTMENT_SUMMARY');
      expect(value.mcp.total).toBe(1);
      expect(value.mcp.counts['PENDING_APPROVAL']).toBe(1);
      expect(value.ipoint.total).toBe(1);
      expect(value.ipoint.counts['EXECUTED']).toBe(1);
    });

    it('R03 reports the redemption/fulfilment queue overview (QUEUE class)', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R03`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as ReportBody;
      expect(body.state).toBe('FRESH');
      const value = body.value as {
        kind: string;
        orders: Record<string, number>;
        fulfilments: Record<string, number>;
      };
      expect(value.kind).toBe('QUEUE_OVERVIEW');
      expect(value.orders['CONFIRMED']).toBe(1);
      expect(value.orders['READY_FOR_PICKUP']).toBe(1);
      expect(value.fulfilments['COMPLETED']).toBe(1);
    });

    it('R04 reports the 14-day registration/activation trend with real totals', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R04`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as ReportBody;
      expect(body.state).toBe('FRESH');
      const value = body.value as {
        kind: string;
        windowDays: number;
        days: Array<{
          date: string;
          registrations: number;
          activations: number;
        }>;
        totals: { registrations: number; activations: number };
      };
      expect(value.kind).toBe('TREND');
      expect(value.windowDays).toBe(14);
      expect(value.days).toHaveLength(14);
      // Days without rows are real zeros derived from the authoritative
      // query result — the totals reflect only actual rows.
      expect(value.totals.registrations).toBe(2);
      expect(value.totals.activations).toBe(1);
    });

    it('serves a cached FRESH snapshot within the TTL (same asOf, no re-query)', async () => {
      const first = await supertest(server)
        .get(`${reportsUrl(marketA)}/R01`)
        .set(authorized(admin.token))
        .expect(200);
      const second = await supertest(server)
        .get(`${reportsUrl(marketA)}/R01`)
        .set(authorized(admin.token))
        .expect(200);
      const firstBody = first.body as ReportBody;
      const secondBody = second.body as ReportBody;
      expect(secondBody.state).toBe('FRESH');
      expect(secondBody.asOf).toBe(firstBody.asOf);
      expect(secondBody.queryDurationMs).toBeUndefined(); // cache hit
    });

    // ─── Market isolation ────────────────────────────────────────────

    it('excludes foreign-market rows from the selected-market aggregates', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketA)}/R01`)
        .set(authorized(admin.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        total: number;
      };
      // Market B has its own CONFIRMED transaction — it must not leak in.
      expect(value.total).toBe(2);
    });

    it('reports market B aggregates when the Current Admin Market is B', async () => {
      const response = await supertest(server)
        .get(`${reportsUrl(marketB)}/R01`)
        .set(authorized(adminB.token))
        .expect(200);
      const value = (response.body as ReportBody).value as {
        total: number;
        counts: Record<string, number>;
      };
      expect(value.total).toBe(1);
      expect(value.counts['CONFIRMED']).toBe(1);
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

    it('returns 422 for an unknown report id', async () => {
      const reportResponse = await supertest(server)
        .get(`${reportsUrl(marketA)}/R99`)
        .set(authorized(admin.token))
        .expect(422);
      expect((reportResponse.body as ErrorBody).error.code).toBe(
        'REPORT_UNDEFINED',
      );
    });
  },
);
