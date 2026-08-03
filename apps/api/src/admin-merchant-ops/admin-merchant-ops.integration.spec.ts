import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  auditLogs,
  marketAccess,
  markets,
  mcpAccounts,
  merchantApplications,
  merchantApplicationSubmissions,
  merchantBranches,
  merchantGroups,
  merchantKycSubmissions,
  merchantPackageAssignments,
  merchantProfiles,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
  sessions,
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
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AdminMerchantOpsModule } from './admin-merchant-ops.module.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Merchant-Ops-Password-123!';

const FULL_KYC_DATA = {
  business_certification: {
    legal_name: 'ACME Trading Sdn Bhd',
    registration_number: '202001012345',
    tax_id: 'C-12345678',
    country: 'MY',
  },
  pic_identity: {
    full_name: 'Ahmad Bin Ali',
    identity_number: '900101-01-1234',
    country: 'MY',
  },
  pic_contact: {
    phone: '+60123456789',
    email: 'owner@example.com',
  },
  pic_address: {
    street: '1 Jalan Test',
  },
};

describe.skipIf(!databaseUrl)(
  'Admin Merchant Operations HTTP integration (P7-S5B)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let marketA: string;
    let marketB: string;

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
          name: `${code} Merchant Ops Test Market`,
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
            description: `${code} merchant-ops test permission`,
          })),
        )
        .onConflictDoNothing({ target: permissions.code });
      const rows = await database.db.select().from(permissions);
      return rows
        .filter((row) => codes.includes(row.code))
        .map((row) => row.id);
    }

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
          displayName: `Merchant Ops Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? ['merchant.view'];
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
          name: `Merchant Ops HTTP Test Role (${roleCode})`,
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

    async function createMerchantFixture(
      marketId: string,
      options: {
        branchStatus?: string;
        withMcp?: boolean;
        withPackage?: boolean;
      } = {},
    ): Promise<{
      branchId: string;
      accountId: string;
      applicationId: string;
      mcpAccountId: string | null;
    }> {
      const account = await createAccount();
      const groupRows = await database.db
        .insert(merchantGroups)
        .values({
          accountId: account.accountId,
          marketId,
          name: `Merchant Ops Group ${randomUUID()}`,
        })
        .returning({ id: merchantGroups.id });
      const groupId = groupRows[0]?.id ?? '';
      const branchRows = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: groupId,
          merchantId: `M-${randomUUID().slice(0, 8).toUpperCase()}`,
          marketId,
          name: `Branch ${randomUUID().slice(0, 8)}`,
          status: (options.branchStatus ?? 'ACTIVE') as never,
        })
        .returning({ id: merchantBranches.id });
      const branchId = branchRows[0]?.id ?? '';
      await database.db.insert(merchantProfiles).values({
        merchantBranchId: branchId,
        phone: '+60123456789',
        address: '1 Jalan Test',
        aboutUs: 'Test merchant',
      });
      const applicationRows = await database.db
        .insert(merchantApplications)
        .values({ merchantBranchId: branchId, status: 'SUBMITTED' })
        .returning({ id: merchantApplications.id });
      const applicationId = applicationRows[0]?.id ?? '';
      await database.db.insert(merchantApplicationSubmissions).values({
        merchantApplicationId: applicationId,
        submissionVersion: 1,
        submittedData: { application_data: { business_type: 'RETAIL' } },
        submittedAt: new Date(),
      });
      await database.db.insert(merchantKycSubmissions).values({
        merchantBranchId: branchId,
        status: 'SUBMITTED',
        submissionVersion: 1,
        submittedData: FULL_KYC_DATA,
        submittedAt: new Date(),
      });
      let mcpAccountId: string | null = null;
      if (options.withMcp !== false) {
        const mcpRows = await database.db
          .insert(mcpAccounts)
          .values({
            merchantBranchId: branchId,
            marketId,
            availableBalance: '0.00000000',
            totalBalance: '0.00000000',
          })
          .returning({ id: mcpAccounts.id });
        mcpAccountId = mcpRows[0]?.id ?? null;
        if (mcpAccountId) {
          // Ledger entries may only be created through the owner's
          // append_mcp_ledger_entry function (DB trigger enforces it).
          await database.pool.query(
            `SELECT append_mcp_ledger_entry($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              mcpAccountId,
              'MANUAL_CREDIT',
              'CREDIT',
              '1000.0000000000',
              '1000.0000000000',
              '1000.0000000000',
              'SYSTEM',
              null,
              `ledger_${randomUUID()}`,
              createHash('sha256').update(randomUUID()).digest('hex'),
              'SYSTEM',
              null,
              'Opening balance fixture',
              new Date(),
            ],
          );
        }
      }
      if (options.withPackage !== false) {
        const code = `A-${randomUUID().slice(0, 8).toUpperCase()}`;
        const profileRows = await database.db
          .insert(serviceFeeProfiles)
          .values({
            code,
            name: 'Package A',
            description: 'Standard package',
            marketId,
          })
          .returning({ id: serviceFeeProfiles.id });
        const profileId = profileRows[0]?.id ?? '';
        const versionRows = await database.db
          .insert(serviceFeeVersions)
          .values({
            serviceFeeProfileId: profileId,
            rate: '0.0125',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            effectiveTo: null,
            status: 'ACTIVE',
            marketId,
          })
          .returning({ id: serviceFeeVersions.id });
        const versionId = versionRows[0]?.id ?? '';
        await database.db.insert(merchantPackageAssignments).values({
          merchantBranchId: branchId,
          serviceFeeVersionId: versionId,
          specialPercentageId: null,
          status: 'ACTIVE',
          isDefault: true,
          version: 1,
        });
      }
      return {
        branchId,
        accountId: account.accountId,
        applicationId,
        mcpAccountId,
      };
    }

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'merchant-ops-http-pepper-at-least-32-characters',
      );
      vi.stubEnv(
        'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AdminMerchantOpsModule],
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

      marketA = await ensureActiveMarket('MA', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('MB', 'SGD', 'Asia/Singapore');
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await app?.close();
    });

    beforeEach(async () => {
      // Isolated, deterministic scenario per test: two branches in market A,
      // one branch in market B.
      const [branchA, branchB] = await Promise.all([
        createMerchantFixture(marketA),
        createMerchantFixture(marketA),
      ]);
      await createMerchantFixture(marketB);
      fixtureBranchA = branchA;
      fixtureBranchB = branchB;
    });

    let fixtureBranchA: Awaited<
      ReturnType<typeof createMerchantFixture>
    > | null = null;
    let fixtureBranchB: Awaited<
      ReturnType<typeof createMerchantFixture>
    > | null = null;

    const FULL_OPERATIONS_PERMISSIONS = [
      'merchant.view',
      'merchant.approve',
      'merchant.kyc.approve',
      'merchant.suspend',
      'merchant.close',
      'merchant.mcp.view',
    ] as const;

    it('returns a composed selected-market branch detail (masked KYC, package history, MCP summary)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchId = fixtureBranchA?.branchId ?? '';

      const response = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants/${branchId}/detail`)
        .set(authorized(admin.token));

      expect(response.status).toBe(200);
      const detail = response.body;
      expect(detail.market_id).toBe(marketA);
      expect(detail.profile.display_name).toBeTruthy();
      expect(detail.application.status).toBe('SUBMITTED');
      // Owner-masked KYC: identity number masked, full value never present.
      const identity = detail.kyc.current.data.pic_identity.identity_number;
      expect(identity).toBe('****1234');
      expect(JSON.stringify(detail.kyc)).not.toContain('900101-01-1234');
      // Read-only package history projection.
      expect(detail.packages.items).toHaveLength(1);
      expect(detail.packages.items[0].service_fee_profile_code).toMatch(/^A-/);
      expect(detail.packages.items[0].rate).toBe('0.012500');
      expect(detail.packages.items[0].is_default).toBe(true);
      expect(detail.packages.items[0].version).toBe(1);
      // MCP summary: account + reconciliation + bounded recent ledger.
      expect(detail.mcp.account.available_balance).toMatch(/^1000\./);
      expect(detail.mcp.reconciliation.matches).toBe(true);
      expect(detail.mcp.recent_ledger.items).toHaveLength(1);
      // Owner `adminLedger` passthrough uses drizzle camelCase keys.
      expect(detail.mcp.recent_ledger.items[0].entryType).toBe('MANUAL_CREDIT');
    });

    it('denies the detail read without merchant.view (permission isolation)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['dashboard.view'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchId = fixtureBranchA?.branchId ?? '';

      const response = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants/${branchId}/detail`)
        .set(authorized(admin.token));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('rejects a URL market that differs from the server-owned Current Admin Market', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchId = fixtureBranchA?.branchId ?? '';

      const response = await supertest(server)
        .get(`/api/v1/admin/markets/${marketB}/merchants/${branchId}/detail`)
        .set(authorized(admin.token));

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('MARKET_CONTEXT_MISMATCH');
    });

    it('hides out-of-market branches as not found', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchB = fixtureBranchB?.branchId ?? '';

      // branchB lives in market A; a market-B branch is invisible from A.
      const response = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants/${branchB}/detail`)
        .set(authorized(admin.token));
      expect(response.status).toBe(200);

      const otherMarketBranch = await database.db
        .select({ id: merchantBranches.id })
        .from(merchantBranches)
        .where(eq(merchantBranches.marketId, marketB))
        .limit(1);
      const hidden = await supertest(server)
        .get(
          `/api/v1/admin/markets/${marketA}/merchants/${otherMarketBranch[0]?.id}/detail`,
        )
        .set(authorized(admin.token));
      expect(hidden.status).toBe(404);
      expect(hidden.body.error.code).toBe('MERCHANT_BRANCH_NOT_FOUND');
    });

    it('returns null MCP for a branch without an MCP account (never fabricated)', async () => {
      const noMcp = await createMerchantFixture(marketA, { withMcp: false });
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);

      const response = await supertest(server)
        .get(
          `/api/v1/admin/markets/${marketA}/merchants/${noMcp.branchId}/detail`,
        )
        .set(authorized(admin.token));

      expect(response.status).toBe(200);
      expect(response.body.mcp).toBeNull();
    });

    it('lists the selected-market application queue and merchant list (owner endpoints)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);

      const queue = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants/applications`)
        .set(authorized(admin.token));
      expect(queue.status).toBe(200);
      const queueItems = queue.body as Array<{
        branch_id: string;
        application_status: string;
      }>;
      expect(
        queueItems.some(
          (item) =>
            item.branch_id === fixtureBranchA?.branchId &&
            item.application_status === 'SUBMITTED',
        ),
      ).toBe(true);

      const list = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants`)
        .set(authorized(admin.token));
      expect(list.status).toBe(200);
      const items = list.body.items as Array<{
        branch_id: string;
        mcp_account_id: string | null;
      }>;
      expect(
        items.some((item) => item.branch_id === fixtureBranchA?.branchId),
      ).toBe(true);
      expect(
        items.find((item) => item.branch_id === fixtureBranchA?.branchId)
          ?.mcp_account_id,
      ).toBeTruthy();
    });

    it('reviews an application via the owner command and reflects it in detail', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchId = fixtureBranchA?.branchId ?? '';

      const review = await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketA}/merchants/${branchId}/application/review`,
        )
        .set(authorized(admin.token))
        .set('idempotency-key', `app-review-${randomUUID()}`)
        .send({ decision: 'APPROVED', reason: 'Fixture approval' });

      expect(review.status).toBe(200);
      expect(review.body.application_status).toBe('APPROVED');

      const detail = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants/${branchId}/detail`)
        .set(authorized(admin.token));
      expect(detail.body.application.status).toBe('APPROVED');
      expect(detail.body.application.reviews[0].decision).toBe('APPROVED');
    });

    it('suspends via the owner command, preserves MCP, and reactivates', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchId = fixtureBranchA?.branchId ?? '';
      const mcpAccountId = fixtureBranchA?.mcpAccountId ?? '';

      const suspend = await supertest(server)
        .post(`/api/v1/admin/markets/${marketA}/merchants/${branchId}/suspend`)
        .set(authorized(admin.token))
        .set('idempotency-key', `suspend-${randomUUID()}`)
        .send({ reason: 'Fixture suspension' });
      expect(suspend.status).toBe(200);
      expect(suspend.body.operational_status).toBe('SUSPENDED');

      // Suspension preserves MCP (owner behavior): account still readable.
      const mcpRead = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/mcp/accounts/${mcpAccountId}`)
        .set(authorized(admin.token));
      expect(mcpRead.status).toBe(200);
      expect(mcpRead.body.available_balance).toMatch(/^1000\./);

      const detail = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants/${branchId}/detail`)
        .set(authorized(admin.token));
      expect(detail.body.mcp.account.id).toBe(mcpAccountId);

      const reactivate = await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketA}/merchants/${branchId}/reactivate`,
        )
        .set(authorized(admin.token))
        .set('idempotency-key', `reactivate-${randomUUID()}`)
        .send({ reason: 'Fixture reactivation' });
      expect(reactivate.status).toBe(200);
    });

    it('starts a KYC review via the owner surface and writes audit-of-view', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchId = fixtureBranchA?.branchId ?? '';

      const started = await supertest(server)
        .get(
          `/api/v1/admin/markets/${marketA}/merchants/${branchId}/kyc/review`,
        )
        .set(authorized(admin.token));
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('UNDER_REVIEW');

      const audit = await database.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'MERCHANT_KYC_REVIEW_STARTED'),
            eq(auditLogs.entityType, 'merchant_kyc_submission'),
          ),
        )
        .limit(1);
      expect(audit[0]?.action).toBe('MERCHANT_KYC_REVIEW_STARTED');

      const decided = await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketA}/merchants/${branchId}/kyc/review`,
        )
        .set(authorized(admin.token))
        .set('idempotency-key', `kyc-review-${randomUUID()}`)
        .send({ decision: 'APPROVED', reason: 'Fixture KYC approval' });
      expect(decided.status).toBe(200);
      expect(decided.body.kyc_status).toBe('APPROVED');

      const detail = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/merchants/${branchId}/detail`)
        .set(authorized(admin.token));
      expect(detail.body.kyc.current.status).toBe('APPROVED');
    });

    it('exposes bounded MCP account/ledger/reconciliation summaries only (owner surfaces)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: FULL_OPERATIONS_PERMISSIONS,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const mcpAccountId = fixtureBranchA?.mcpAccountId ?? '';

      const account = await supertest(server)
        .get(`/api/v1/admin/markets/${marketA}/mcp/accounts/${mcpAccountId}`)
        .set(authorized(admin.token));
      expect(account.status).toBe(200);
      expect(account.body.total_balance).toMatch(/^1000\./);

      const reconcile = await supertest(server)
        .get(
          `/api/v1/admin/markets/${marketA}/mcp/accounts/${mcpAccountId}/reconcile`,
        )
        .set(authorized(admin.token));
      expect(reconcile.status).toBe(200);
      expect(reconcile.body.matches).toBe(true);

      const ledger = await supertest(server)
        .get(
          `/api/v1/admin/markets/${marketA}/mcp/accounts/${mcpAccountId}/ledger?limit=10&offset=0`,
        )
        .set(authorized(admin.token));
      expect(ledger.status).toBe(200);
      expect(ledger.body.items).toHaveLength(1);
      expect(ledger.body.limit).toBe(10);
    });

    it('rejects a status action without the suspend permission', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.view'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const branchId = fixtureBranchA?.branchId ?? '';

      const suspend = await supertest(server)
        .post(`/api/v1/admin/markets/${marketA}/merchants/${branchId}/suspend`)
        .set(authorized(admin.token))
        .set('idempotency-key', `suspend-${randomUUID()}`)
        .send({ reason: 'Should be denied' });
      expect(suspend.status).toBe(403);
      expect(suspend.body.error.code).toBe('PERMISSION_DENIED');
    });
  },
);
