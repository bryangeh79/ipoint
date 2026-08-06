import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  auditLogs,
  commissionRateVersions,
  marketAccess,
  markets,
  memberMarketPreferences,
  members,
  merchantApiIdempotencyKeys,
  merchantBranches,
  merchantGroups,
  migrate,
  permissions,
  rewardRuleVersions,
  roleAssignments,
  rolePermissions,
  roles,
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
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { MarketOwnerService } from './market-owner.service.js';
import type {
  MarketOwnerActor,
  UpdateMarketCommand,
} from './market-owner.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Market-Owner-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

describe.skipIf(!databaseUrl)(
  'Admin Market Configuration HTTP integration (P7-S6E)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let owner: MarketOwnerService;
    let auditService: AuditService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // manage target
    let marketB: string; // isolation target
    let marketC: string; // blocked (INACTIVE)
    let marketD: string; // deactivation dependency
    let marketE: string; // deactivation success
    let marketF: string; // concurrent race
    let marketG: string; // atomic-audit rollback
    let marketH: string; // field validation

    // Exactly-two-letter fresh market codes (unique across the suite).
    let marketCodeCursor = 0;
    const freshMarketCode = (): string => {
      const letters = 'QWERTYUIOPASDFGHJKLZXCVBNM';
      const length = letters.length;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const code =
          (letters[marketCodeCursor % length] ?? 'A') +
          (letters[Math.floor(marketCodeCursor / length) % length] ?? 'A');
        marketCodeCursor += 1;
        if (code !== 'MY' && code !== 'SG') return code;
      }
      throw new Error('No free two-letter market code.');
    };

    const marketUrl = (marketId: string) =>
      `/api/v1/admin/market-ops/markets/${marketId}`;

    function authorized(token: string) {
      return { Authorization: `Bearer ${token}` };
    }

    async function freshMarket(
      timezone = 'Asia/Kuala_Lumpur',
      currencyCode = 'MYR',
      status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
    ): Promise<string> {
      const code = freshMarketCode();
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `S6E Market ${code}`,
          status,
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
            description: `${code} S6E integration test permission`,
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
          displayName: `S6E Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserIdValue = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? ['market.read'];
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
          name: `S6E HTTP Test Role (${roleCode})`,
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
      await database.db
        .insert(roleAssignments)
        .values({ adminUserId: adminUserIdValue, roleId });
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
        await database.db.insert(marketAccess).values(
          options.marketIds.map((marketId) => ({
            adminUserId: adminUserIdValue,
            marketId,
          })),
        );
      }
      // ACTIVE MFA factor (step-up grant requirement).
      await database.db.insert(adminMfaFactors).values({
        accountId: account.accountId,
        adminUserId: adminUserIdValue,
        factorType: 'TOTP',
        secretCiphertext: 'ciphertext-placeholder-nonempty',
        secretNonce: 'nonce-placeholder-nonempty',
        secretAuthTag: 'authtag-placeholder-nonempty',
        keyId: 'k1',
        algorithm: 'AES-256-GCM',
        status: 'ACTIVE',
      });
      const token = (
        await auth.createAdminSession(account.accountId, adminUserIdValue, {
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        })
      ).accessToken;
      return {
        adminUserId: adminUserIdValue,
        accountId: account.accountId,
        token,
      };
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

    async function seedStepUpGrant(
      admin: { adminUserId: string; accountId: string; token: string },
      actionClass: string,
      marketId: string,
    ): Promise<string> {
      const token = `stepup_${randomUUID()}${randomUUID()}`;
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.accountId, admin.accountId),
            isNull(sessions.revokedAt),
          ),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for step-up.');
      const factorRows = await database.db
        .select({ id: adminMfaFactors.id })
        .from(adminMfaFactors)
        .where(
          and(
            eq(adminMfaFactors.adminUserId, admin.adminUserId),
            eq(adminMfaFactors.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      const factorId = factorRows[0]?.id;
      if (!factorId) throw new Error('No active MFA factor for step-up.');
      const issuedAt = new Date();
      await database.db.insert(adminStepUpGrants).values({
        grantHash: createHash('sha256').update(token).digest('hex'),
        sessionId,
        adminUserId: admin.adminUserId,
        factorId,
        actionClass,
        marketId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 9 * 60 * 1000),
      });
      return token;
    }

    /** Build a controlled PATCH body (one field + reason). */
    function patchBody(overrides: Record<string, unknown> = {}) {
      return {
        name: 'S6E Renamed Market',
        reason: 'Integration test market configuration',
        ...overrides,
      };
    }

    async function revokeGrant(adminUserId: string, marketId: string) {
      await database.db
        .update(marketAccess)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(marketAccess.adminUserId, adminUserId),
            eq(marketAccess.marketId, marketId),
            isNull(marketAccess.revokedAt),
          ),
        );
    }

    async function idempotencyRowCount(
      marketId: string,
      adminUserId: string,
    ): Promise<number> {
      const rows = await database.db
        .select({ id: merchantApiIdempotencyKeys.id })
        .from(merchantApiIdempotencyKeys)
        .where(
          and(
            eq(
              merchantApiIdempotencyKeys.scope,
              `market.owner.update:${marketId}:${adminUserId}`,
            ),
          ),
        );
      return rows.length;
    }

    async function auditCount(action: string): Promise<number> {
      const rows = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.action, action));
      return rows.length;
    }

    async function auditRowsFor(entityId: string): Promise<number> {
      const rows = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'market.owner.update'),
            eq(auditLogs.entityId, entityId),
          ),
        );
      return rows.length;
    }

    async function marketRow(marketId: string) {
      const rows = await database.db
        .select()
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);
      return rows[0];
    }

    async function addMemberPreference(
      marketId: string,
      isEnabled = true,
    ): Promise<void> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(members)
        .values({
          accountId: account.accountId,
          publicMemberId: `pub_${randomUUID()}`,
          referralCode: `ref_${randomUUID().slice(0, 8)}`,
          status: 'ACTIVE',
        })
        .returning({ id: members.id });
      const memberId = inserted[0]?.id ?? '';
      await database.db.insert(memberMarketPreferences).values({
        memberId,
        marketId,
        isEnabled,
        isCurrent: false,
        sortOrder: 0,
      });
    }

    async function addMerchantBranch(marketId: string): Promise<void> {
      const account = await createAccount();
      const group = await database.db
        .insert(merchantGroups)
        .values({
          accountId: account.accountId,
          marketId,
          name: `S6E Group ${randomUUID().slice(0, 8)}`,
        })
        .returning({ id: merchantGroups.id });
      await database.db.insert(merchantBranches).values({
        merchantGroupId: group[0]?.id ?? '',
        merchantId: `m_${randomUUID()}`,
        marketId,
        name: 'S6E Active Branch',
        status: 'ACTIVE',
      });
    }

    async function addRewardRuleDependency(
      marketId: string,
      createdBy: string,
    ): Promise<void> {
      await database.db.insert(rewardRuleVersions).values({
        name: `S6E Rule ${randomUUID().slice(0, 8)}`,
        rewardRate: '0.0100000000',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        effectiveFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        marketId,
        createdBy,
      });
    }

    async function addCommissionRateDependency(
      marketId: string,
      createdBy: string,
    ): Promise<void> {
      const market = await marketRow(marketId);
      await database.db.insert(commissionRateVersions).values({
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        market: market?.code ?? 'MY',
        rateType: 'FIXED',
        rateValue: '88.0000000000',
        effectiveFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        createdBy,
      });
    }

    beforeAll(async () => {
      // Fresh isolated database (task-mandated name).
      const dbName = new URL(databaseUrl ?? '').pathname.replace(/^\//u, '');
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const admin = new Pool({ connectionString: maintenanceUrl });
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
      await admin.end();

      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://172.23.0.2:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'admin-market-owner-pepper-at-least-32-characters',
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
      owner = app.get(MarketOwnerService);
      auditService = app.get(AuditService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await freshMarket();
      marketB = await freshMarket();
      marketC = await freshMarket('Asia/Kuala_Lumpur', 'MYR', 'INACTIVE');
      marketD = await freshMarket();
      marketE = await freshMarket();
      marketF = await freshMarket();
      marketG = await freshMarket();
      marketH = await freshMarket();
    });

    afterAll(async () => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
      await app?.close();
    });

    beforeEach(() => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
      vi.restoreAllMocks();
    });

    // ─── Read projection (market.read) ───────────────────────────────

    it('GET market detail: reads the selected market (market.read)', async () => {
      const admin = await createAdmin({ marketIds: [marketA] });
      await setCurrentMarket(admin.accountId, marketA);
      const response = await supertest(server)
        .get(marketUrl(marketA))
        .set(authorized(admin.token))
        .expect(200);
      expect(response.body.market_id).toBe(marketA);
      expect(response.body.market_code).toMatch(/^[A-Z]{2}$/u);
      expect(response.body.name).toBe(
        'S6E Market ' + response.body.market_code,
      );
      expect(response.body.status).toBe('ACTIVE');
      expect(response.body.currency_code).toBe('MYR');
      expect(response.body.timezone).toBe('Asia/Kuala_Lumpur');
      expect(response.body.default_locale).toBe('en-MY');
      expect(response.body.configured).toBe(true);
      expect(response.body.created_at).toBeTruthy();
      expect(response.body.updated_at).toBeTruthy();
    });

    it('GET market detail: denied without market.read (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['member.read'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const response = await supertest(server)
        .get(marketUrl(marketA))
        .set(authorized(admin.token))
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('GET market detail: non-ACTIVE market blocked at the guard (403, no fallback)', async () => {
      const admin = await createAdmin({ marketIds: [marketC] });
      await setCurrentMarket(admin.accountId, marketC);
      const response = await supertest(server)
        .get(marketUrl(marketC))
        .set(authorized(admin.token))
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_ACCESS_DENIED',
      );
      // In-process blocked signal: configured = false (defensive path).
      const detail = await owner.getMarketDetail(marketC);
      expect(detail.configured).toBe(false);
      expect(detail.status).toBe('INACTIVE');
    });

    it('GET market detail: unknown market → in-process MARKET_NOT_FOUND (404-class)', async () => {
      await expect(
        owner.getMarketDetail('99999999-9999-4999-8999-999999999999'),
      ).rejects.toMatchObject({ code: 'MARKET_NOT_FOUND' });
    });

    // ─── Authorization (market.manage) ──────────────────────────────

    it('PATCH denied without market.manage (403 PERMISSION_DENIED)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.read'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
      const response = await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody())
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
      // No side effects.
      const row = await marketRow(marketA);
      expect(row?.name).toBe('S6E Market ' + row?.code);
    });

    it('PATCH requires a fresh step-up grant (403 MFA_STEP_UP_REQUIRED)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const response = await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .send(patchBody())
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'MFA_STEP_UP_REQUIRED',
      );
      const row = await marketRow(marketA);
      expect(row?.name).toBe('S6E Market ' + row?.code);
    });

    it('PATCH denied when the market grant is revoked (403 MARKET_ACCESS_DENIED, zero side effects)', async () => {
      const admin = await createAdmin({
        marketIds: [marketB],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketB);
      await revokeGrant(admin.adminUserId, marketB);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketB);
      const response = await supertest(server)
        .patch(marketUrl(marketB))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody())
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_ACCESS_DENIED',
      );
      const row = await marketRow(marketB);
      expect(row?.name).toBe('S6E Market ' + row?.code);
      expect(await idempotencyRowCount(marketB, admin.adminUserId)).toBe(0);
    });

    // ─── Market consistency ──────────────────────────────────────────

    it('PATCH without a Current Admin Market selection → 409 MARKET_SELECTION_REQUIRED', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      // No session.currentAdminMarketId → the guard denies with the
      // selection-required conflict before any handler runs.
      const response = await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .send(patchBody())
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_SELECTION_REQUIRED',
      );
      const row = await marketRow(marketA);
      expect(row?.name).toBe('S6E Market ' + row?.code);
    });

    it('PATCH a market different from the Current Admin Market → 409 MARKET_CONTEXT_MISMATCH (guard + owner)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
      // URL market B ≠ current market A → guard 409.
      const response = await supertest(server)
        .patch(marketUrl(marketB))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody())
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
      // In-process owner re-check (same contract, no guard): command
      // market ≠ actor current market → MARKET_CONTEXT_MISMATCH.
      const actor: MarketOwnerActor = {
        adminUserId: admin.adminUserId,
        currentMarketId: marketA,
        ipAddress: '127.0.0.1',
      };
      await expect(
        owner.updateMarket(actor, marketB, {
          name: 'Should Not Apply',
          reason: 'context mismatch probe',
          idempotencyKey: `key-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ code: 'MARKET_CONTEXT_MISMATCH' });
      const rowB = await marketRow(marketB);
      expect(rowB?.name).toBe('S6E Market ' + rowB?.code);
    });

    it('cross-market isolation: updating market A never leaks into market B', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
      const renamed = `Isolated Name ${randomUUID().slice(0, 8)}`;
      const response = await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ name: renamed }))
        .expect(200);
      expect(response.body.name).toBe(renamed);
      const detailB = await owner.getMarketDetail(marketB);
      expect(detailB.name).toBe('S6E Market ' + detailB.market_code);
      expect(detailB.name).not.toBe(renamed);
    });

    // ─── Reason / Idempotency-Key ───────────────────────────────────

    it('rejects a missing/blank/overlong reason (400)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const nameBefore = (await marketRow(marketA))?.name;
      for (const reason of [undefined, '   ', 'x'.repeat(501)]) {
        const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
        const body: Record<string, unknown> = { name: `Try ${randomUUID()}` };
        if (reason !== undefined) body.reason = reason;
        await supertest(server)
          .patch(marketUrl(marketA))
          .set(authorized(admin.token))
          .set('idempotency-key', `key-${randomUUID()}`)
          .set('x-step-up-token', stepUp)
          .send(body)
          .expect(400);
      }
      const row = await marketRow(marketA);
      expect(row?.name).toBe(nameBefore);
    });

    it('rejects a missing Idempotency-Key (400 MARKET_IDEMPOTENCY_KEY_REQUIRED)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
      const response = await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('x-step-up-token', stepUp)
        .send(patchBody())
        .expect(400);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_IDEMPOTENCY_KEY_REQUIRED',
      );
    });

    // ─── Field validation ───────────────────────────────────────────

    it('rejects an invalid IANA timezone (400 MARKET_INVALID_FIELD, owner-level)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
      const response = await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ timezone: 'Mars/Olympus' }))
        .expect(400);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_INVALID_FIELD',
      );
    });

    it('rejects invalid currency/locale/name formats at the transport (400)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const cases: Array<Record<string, unknown>> = [
        { currencyCode: 'myr' },
        { currencyCode: 'MY' },
        { defaultLocale: 'English!' },
        { name: '   ' },
        { name: 'x'.repeat(201) },
      ];
      for (const field of cases) {
        const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
        await supertest(server)
          .patch(marketUrl(marketA))
          .set(authorized(admin.token))
          .set('idempotency-key', `key-${randomUUID()}`)
          .set('x-step-up-token', stepUp)
          .send(patchBody(field))
          .expect(400);
      }
      const row = await marketRow(marketA);
      expect(row?.currencyCode).toBe('MYR');
      expect(row?.defaultLocale).toBe('en-MY');
    });

    it('rejects a body with NO controlled fields (400)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
      await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send({ reason: 'Only a reason is not a change' })
        .expect(400);
    });

    // ─── Successful controlled update ───────────────────────────────

    it('PATCH applies a controlled update and persists the change (200)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const auditsBefore = await auditRowsFor(marketA);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketA);
      const newName = `Renamed ${randomUUID().slice(0, 8)}`;
      const response = await supertest(server)
        .patch(marketUrl(marketA))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ name: newName, currencyCode: 'SGD' }))
        .expect(200);
      expect(response.body.id).toBe(marketA);
      expect(response.body.name).toBe(newName);
      expect(response.body.currencyCode).toBe('SGD');
      expect(response.body.status).toBe('ACTIVE');
      expect(response.body.idempotencyDigest).toMatch(/^[0-9a-f]{64}$/u);
      const changed = response.body.changed as Array<{
        field: string;
        before: unknown;
        after: unknown;
      }>;
      const nameChange = changed.find((change) => change.field === 'name');
      const currencyChange = changed.find(
        (change) => change.field === 'currencyCode',
      );
      expect(nameChange?.after).toBe(newName);
      expect(nameChange?.before).not.toBe(newName);
      expect(currencyChange).toEqual({
        field: 'currencyCode',
        before: 'MYR',
        after: 'SGD',
      });
      // The read projection reflects the change.
      const detail = await owner.getMarketDetail(marketA);
      expect(detail.name).toBe(newName);
      expect(detail.currency_code).toBe('SGD');
      // Exactly one privileged audit row with the owner action (relative
      // to the rows this market already had).
      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'market.owner.update'),
            eq(auditLogs.entityId, marketA),
          ),
        );
      expect(auditRows).toHaveLength(auditsBefore + 1);
      expect(auditRows[auditsBefore]?.actorId).toBe(admin.adminUserId);
      expect(auditRows[auditsBefore]?.reason).toBe(
        'Integration test market configuration',
      );
      expect(auditRows[auditsBefore]?.marketId).toBe(marketA);
    });

    // ─── Idempotency ────────────────────────────────────────────────

    it('idempotency replay: same key + same payload returns the identical result, one row', async () => {
      const admin = await createAdmin({
        marketIds: [marketB],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketB);
      const key = `replay-${randomUUID()}`;
      const renamed = `Replay Name ${randomUUID().slice(0, 8)}`;
      const stepUp1 = await seedStepUpGrant(admin, 'market.manage', marketB);
      const first = await supertest(server)
        .patch(marketUrl(marketB))
        .set(authorized(admin.token))
        .set('idempotency-key', key)
        .set('x-step-up-token', stepUp1)
        .send(patchBody({ name: renamed }))
        .expect(200);
      const stepUp2 = await seedStepUpGrant(admin, 'market.manage', marketB);
      const second = await supertest(server)
        .patch(marketUrl(marketB))
        .set(authorized(admin.token))
        .set('idempotency-key', key)
        .set('x-step-up-token', stepUp2)
        .send(patchBody({ name: renamed }))
        .expect(200);
      expect(second.body).toEqual(first.body);
      expect(second.body.name).toBe(renamed);
      expect(await idempotencyRowCount(marketB, admin.adminUserId)).toBe(1);
      // Exactly one market update + one audit row.
      expect(await auditCount('market.owner.update')).toBeGreaterThan(0);
      const marketAudits = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'market.owner.update'),
            eq(auditLogs.entityId, marketB),
          ),
        );
      expect(marketAudits).toHaveLength(1);
    });

    it('idempotency conflict: same key + different payload → 409, market untouched', async () => {
      const admin = await createAdmin({
        marketIds: [marketB],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketB);
      const key = `conflict-${randomUUID()}`;
      const auditsBefore = await auditRowsFor(marketB);
      const stepUp1 = await seedStepUpGrant(admin, 'market.manage', marketB);
      await supertest(server)
        .patch(marketUrl(marketB))
        .set(authorized(admin.token))
        .set('idempotency-key', key)
        .set('x-step-up-token', stepUp1)
        .send(patchBody({ name: `First ${randomUUID().slice(0, 8)}` }))
        .expect(200);
      const stepUp2 = await seedStepUpGrant(admin, 'market.manage', marketB);
      const response = await supertest(server)
        .patch(marketUrl(marketB))
        .set(authorized(admin.token))
        .set('idempotency-key', key)
        .set('x-step-up-token', stepUp2)
        .send(patchBody({ name: `Different ${randomUUID().slice(0, 8)}` }))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_IDEMPOTENCY_CONFLICT',
      );
      // Exactly ONE audit row was added by the first PATCH; the conflict
      // added none (the per-market audit count is unchanged by the 409).
      expect(await auditRowsFor(marketB)).toBe(auditsBefore + 1);
      expect(await auditCount('market.owner.update')).toBeGreaterThanOrEqual(
        auditsBefore + 1,
      );
    });

    it('concurrent same-key race: exactly one winner, both responses identical, one row + one audit', async () => {
      const admin = await createAdmin({
        marketIds: [marketF],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketF);
      const key = `race-${randomUUID()}`;
      const renamed = `Race Name ${randomUUID().slice(0, 8)}`;
      const stepUp1 = await seedStepUpGrant(admin, 'market.manage', marketF);
      const stepUp2 = await seedStepUpGrant(admin, 'market.manage', marketF);
      const [first, second] = await Promise.all([
        supertest(server)
          .patch(marketUrl(marketF))
          .set(authorized(admin.token))
          .set('idempotency-key', key)
          .set('x-step-up-token', stepUp1)
          .send(patchBody({ name: renamed })),
        supertest(server)
          .patch(marketUrl(marketF))
          .set(authorized(admin.token))
          .set('idempotency-key', key)
          .set('x-step-up-token', stepUp2)
          .send(patchBody({ name: renamed })),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(await idempotencyRowCount(marketF, admin.adminUserId)).toBe(1);
      const marketAudits = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'market.owner.update'),
            eq(auditLogs.entityId, marketF),
          ),
        );
      expect(marketAudits).toHaveLength(1);
      const row = await marketRow(marketF);
      expect(row?.name).toBe(renamed);
    });

    // ─── Atomic audit (injection rollback) ──────────────────────────

    it('atomic audit: an injected audit failure rolls back the update, claim and audit', async () => {
      const admin = await createAdmin({
        marketIds: [marketG],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketG);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketG);
      const before = await marketRow(marketG);
      const auditsBefore = await auditCount('market.owner.update');
      const key = `atomic-${randomUUID()}`;
      const spy = vi
        .spyOn(auditService, 'appendWithinTransaction')
        .mockRejectedValueOnce(new Error('injected audit failure'));
      const response = await supertest(server)
        .patch(marketUrl(marketG))
        .set(authorized(admin.token))
        .set('idempotency-key', key)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ name: 'Must Roll Back' }))
        .expect(500);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_UPDATE_FAILED',
      );
      spy.mockRestore();
      // Nothing committed: market unchanged, no claim row, no audit row.
      const after = await marketRow(marketG);
      expect(after?.name).toBe(before?.name);
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      expect(await idempotencyRowCount(marketG, admin.adminUserId)).toBe(0);
      expect(await auditCount('market.owner.update')).toBe(auditsBefore);
    });

    // ─── Deactivation ───────────────────────────────────────────────

    it('deactivation requires explicit confirmation (400 MARKET_DEACTIVATION_CONFIRMATION_REQUIRED)', async () => {
      const admin = await createAdmin({
        marketIds: [marketE],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketE);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketE);
      const response = await supertest(server)
        .patch(marketUrl(marketE))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ status: 'INACTIVE' }))
        .expect(400);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED',
      );
      const row = await marketRow(marketE);
      expect(row?.status).toBe('ACTIVE');
    });

    it('deactivation rejected while an active merchant branch depends on the market (409 MARKET_DEACTIVATION_DEPENDENCY)', async () => {
      await addMerchantBranch(marketD);
      const admin = await createAdmin({
        marketIds: [marketD],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketD);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketD);
      const response = await supertest(server)
        .patch(marketUrl(marketD))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ status: 'INACTIVE', deactivationConfirmed: true }))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_DEACTIVATION_DEPENDENCY',
      );
      const row = await marketRow(marketD);
      expect(row?.status).toBe('ACTIVE');
    });

    it('deactivation rejected while members hold an enabled preference (409 MARKET_DEACTIVATION_DEPENDENCY)', async () => {
      await addMemberPreference(marketD);
      const admin = await createAdmin({
        marketIds: [marketD],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketD);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketD);
      const response = await supertest(server)
        .patch(marketUrl(marketD))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ status: 'INACTIVE', deactivationConfirmed: true }))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_DEACTIVATION_DEPENDENCY',
      );
    });

    it('deactivation rejected while active configuration references the market (409 MARKET_DEACTIVATION_DEPENDENCY)', async () => {
      const admin = await createAdmin({
        marketIds: [marketD],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketD);
      await addRewardRuleDependency(marketD, admin.adminUserId);
      await addCommissionRateDependency(marketD, admin.adminUserId);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketD);
      const response = await supertest(server)
        .patch(marketUrl(marketD))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ status: 'INACTIVE', deactivationConfirmed: true }))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_DEACTIVATION_DEPENDENCY',
      );
      const row = await marketRow(marketD);
      expect(row?.status).toBe('ACTIVE');
    });

    it('deactivation succeeds without dependencies; the market then reads blocked (no re-activation)', async () => {
      const admin = await createAdmin({
        marketIds: [marketE],
        permissionCodes: ['market.manage', 'market.read'],
      });
      await setCurrentMarket(admin.accountId, marketE);
      const stepUp = await seedStepUpGrant(admin, 'market.manage', marketE);
      const response = await supertest(server)
        .patch(marketUrl(marketE))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp)
        .send(patchBody({ status: 'INACTIVE', deactivationConfirmed: true }))
        .expect(200);
      expect(response.body.status).toBe('INACTIVE');
      expect(
        response.body.changed.find(
          (change: { field: string }) => change.field === 'status',
        ),
      ).toEqual({ field: 'status', before: 'ACTIVE', after: 'INACTIVE' });
      // The guard now denies every request for the non-ACTIVE market
      // (no re-activation through this surface).
      const denied = await supertest(server)
        .get(marketUrl(marketE))
        .set(authorized(admin.token))
        .expect(403);
      expect((denied.body as ErrorBody).error.code).toBe(
        'MARKET_ACCESS_DENIED',
      );
      // In-process: the market is blocked (configured false), and the
      // owner denies any further manage attempt on it.
      const detail = await owner.getMarketDetail(marketE);
      expect(detail.configured).toBe(false);
      await expect(
        owner.updateMarket(
          {
            adminUserId: admin.adminUserId,
            currentMarketId: marketE,
            ipAddress: '127.0.0.1',
          },
          marketE,
          {
            name: 'Reactivation Attempt',
            reason: 'must be denied',
            idempotencyKey: `key-${randomUUID()}`,
          },
        ),
      ).rejects.toMatchObject({ code: 'MARKET_ACCESS_DENIED' });
    });

    // ─── Behavior / immutability ────────────────────────────────────

    it('history immutable: created_at is never rewritten and audit rows are append-only', async () => {
      const admin = await createAdmin({
        marketIds: [marketH],
        permissionCodes: ['market.manage'],
      });
      await setCurrentMarket(admin.accountId, marketH);
      const createdAtBefore = (await marketRow(marketH))?.createdAt;
      const auditsBefore = await auditCount('market.owner.update');
      const stepUp1 = await seedStepUpGrant(admin, 'market.manage', marketH);
      await supertest(server)
        .patch(marketUrl(marketH))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp1)
        .send(patchBody({ name: `Immutable ${randomUUID().slice(0, 8)}` }))
        .expect(200);
      const stepUp2 = await seedStepUpGrant(admin, 'market.manage', marketH);
      await supertest(server)
        .patch(marketUrl(marketH))
        .set(authorized(admin.token))
        .set('idempotency-key', `key-${randomUUID()}`)
        .set('x-step-up-token', stepUp2)
        .send(patchBody({ defaultLocale: 'en-SG' }))
        .expect(200);
      const after = await marketRow(marketH);
      expect(after?.createdAt.getTime()).toBe(createdAtBefore?.getTime());
      expect(after?.defaultLocale).toBe('en-SG');
      // Append-only: exactly two new audit rows, none rewritten.
      expect(await auditCount('market.owner.update')).toBe(auditsBefore + 2);
      // No delete routes exist for market configuration (404 on DELETE).
      await supertest(server)
        .delete(marketUrl(marketH))
        .set(authorized(admin.token))
        .expect(404);
    });
  },
);
