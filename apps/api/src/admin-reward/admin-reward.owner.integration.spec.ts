import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import {
  accounts,
  adminUsers,
  auditLogs,
  marketAccess,
  markets,
  merchantApiIdempotencyKeys,
  migrate,
  permissions,
  rewardPlans,
  rewardRuleVersions,
  rewardSources,
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
import { AdminRewardService } from './admin-reward.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Reward-Owner-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

/** Asia/Kuala_Lumpur is fixed UTC+8 (no DST). */
const KL_OFFSET_MS = 8 * 60 * 60 * 1000;

function klDateString(daysAhead: number): string {
  const probe = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(probe);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
}

/** UTC ISO instant of the market-local 00:00 of a calendar date (UTC+8). */
function klMidnightIso(daysAhead: number): string {
  const [year, month, day] = klDateString(daysAhead)
    .split('-')
    .map((value) => Number(value));
  return new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0) - KL_OFFSET_MS,
  ).toISOString();
}

describe.skipIf(!databaseUrl)(
  'Phase 3 Reward Owner D-050 security and versioning (HTTP, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let owner: AdminRewardService;
    let auditService: AuditService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR, Asia/Kuala_Lumpur
    let marketB: string; // code MB, SGD, Asia/Singapore

    const rulesUrl = '/api/v1/admin/rewards/rules';

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
          name: `${code} D050 Owner Test Market`,
          status: 'ACTIVE',
          currencyCode,
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      return inserted[0]?.id ?? '';
    }

    async function freshMarket(
      timezone = 'Asia/Kuala_Lumpur',
    ): Promise<string> {
      const code = `D${randomUUID().slice(0, 6).toUpperCase()}`;
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `Fresh D050 Owner Market ${code}`,
          status: 'ACTIVE',
          currencyCode: 'MYR',
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
            description: `${code} d050 owner integration test permission`,
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
          displayName: `D050 Owner Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? ['reward.rule.read'];
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
          name: `D050 Owner HTTP Test Role (${roleCode})`,
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

    /** Direct row seed of a market-scoped rule version (legacy-style row). */
    async function seedRuleVersion(params: {
      marketId: string;
      name: string;
      rewardRate: string;
      effectiveFrom: Date;
      createdBy: string;
      effectiveTo?: Date | null;
      archivedAt?: Date | null;
      reason?: string | null;
    }): Promise<string> {
      const inserted = await database.db
        .insert(rewardRuleVersions)
        .values({
          name: params.name,
          description: null,
          reason: params.reason ?? null,
          effectiveFrom: params.effectiveFrom,
          effectiveTo: params.effectiveTo ?? null,
          rewardRate: params.rewardRate,
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
          marketId: params.marketId,
          createdBy: params.createdBy,
          archivedAt: params.archivedAt ?? null,
        })
        .returning({ id: rewardRuleVersions.id });
      return inserted[0]?.id ?? '';
    }

    /** Build the create payload for the secured owner route. */
    function ownerPayload(overrides: Record<string, unknown> = {}) {
      return {
        name: 'Package A Reward Rate',
        description: 'D-050 owner integration create',
        effectiveFrom: klMidnightIso(2),
        rewardRate: '0.05',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId: marketA,
        reason: 'D-050 owner remediation evidence',
        ...overrides,
      };
    }

    function scheduleRule(
      token: string,
      payload: Record<string, unknown>,
      key?: string,
    ) {
      return supertest(server)
        .post(rulesUrl)
        .set(authorized(token))
        .set('Idempotency-Key', key ?? `key-${randomUUID()}`)
        .send(payload);
    }

    beforeAll(async () => {
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
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'reward-owner-pepper-at-least-32-characters',
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
      owner = app.get(AdminRewardService);
      auditService = app.get(AuditService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await ensureActiveMarket('MA', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('MB', 'SGD', 'Asia/Singapore');
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
    });

    // ─── 1. RBAC cannot be bypassed ──────────────────────────────────

    it('rejects unauthenticated creates with 401', async () => {
      await supertest(server)
        .post(rulesUrl)
        .send(ownerPayload({ marketId: marketA }))
        .expect(401);
    });

    it('rejects non-admin (member) actors with 403', async () => {
      const member = await createAccount();
      const token = (await auth.login(member.email, password)).accessToken;
      await scheduleRule(token, ownerPayload({ marketId: marketA })).expect(
        403,
      );
    });

    it('rejects admins without the reward.rule.schedule permission with 403', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['reward.rule.read'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: marketA }),
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('accepts a SUPER_ADMIN-like actor holding reward.rule.schedule', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          name: 'Schedule OK',
          rewardRate: '0.01',
        }),
      ).expect(201);
      expect((body.body as { id: string }).id).toBeTruthy();
    });

    // ─── 2. Selected-market enforcement cannot be bypassed ───────────

    it('rejects when no server Current Admin Market is selected (409)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: marketA }),
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'MARKET_SELECTION_REQUIRED',
      );
    });

    it('rejects when the admin has no grant for the market (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketB],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      // Current market is marketA, but the admin only holds a grant for
      // marketB → the guard denies the market before any business logic.
      await setCurrentMarket(admin.accountId, marketA);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: marketA }),
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('MARKET_ACCESS_DENIED');
    });

    it('rejects when the body market differs from the Current Admin Market (409)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: marketB }),
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('rejects a create without a body market (400)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      await scheduleRule(admin.token, {
        name: 'No Market Rule',
        effectiveFrom: klMidnightIso(2),
        rewardRate: '0.01',
        reason: 'Market-less create must fail',
      }).expect(400);
    });

    // ─── 3-7. Rate contract: 0%–0.05%, six decimals, exact math ──────

    it('accepts the 0% boundary', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, rewardRate: '0' }),
      ).expect(201);
      expect((body.body as { rewardRate: string }).rewardRate).toBe('0');
    });

    it('accepts the 0.05% governance ceiling', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, rewardRate: '0.05' }),
      ).expect(201);
      expect((body.body as { rewardRate: string }).rewardRate).toBe('0.05');
    });

    it('rejects negative rates (400)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, rewardRate: '-0.01' }),
      ).expect(400);
    });

    it('rejects rates above 0.05%/day (422)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, rewardRate: '0.050001' }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
      );
    });

    it('rejects more than six decimals (400)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, rewardRate: '0.0000001' }),
      ).expect(400);
    });

    it('accepts six decimals exactly (0.000001)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, rewardRate: '0.000001' }),
      ).expect(201);
      expect((body.body as { rewardRate: string }).rewardRate).toBe('0.000001');
    });

    // ─── 8-10. Activation: future market-local 00:00 + UTC resolution ─

    it('rejects same-day activation (422)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, effectiveFrom: klMidnightIso(0) }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects backdated activation (422)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          effectiveFrom: '2019-12-31T16:00:00.000Z', // 2020-01-01 00:00 KL
        }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects a future instant that is not a market-local 00:00 (422)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          effectiveFrom: '2030-06-14T17:00:00.000Z', // KL 01:00
        }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_ACTIVATION_NOT_FUTURE',
      );
    });

    it('accepts a future market-local midnight and returns the exact UTC instant', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date = klDateString(3);
      const expectedUtc = new Date(
        Date.parse(`${date}T00:00:00.000Z`) - KL_OFFSET_MS,
      ).toISOString();
      const body = await scheduleRule(
        admin.token,
        ownerPayload({ marketId: market, effectiveFrom: expectedUtc }),
      ).expect(201);
      const result = body.body as {
        effectiveFrom: string;
        effectiveFromLocal: string;
        timezone: string;
        marketId: string;
      };
      expect(result.effectiveFrom).toBe(expectedUtc);
      expect(result.effectiveFromLocal).toBe(`${date} 00:00:00`);
      expect(result.timezone).toBe('Asia/Kuala_Lumpur');
      expect(result.marketId).toBe(market);
      // The stored row holds the exact resolved instant.
      const rows = await database.db
        .select()
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.marketId, market));
      expect(rows[0]?.effectiveFrom.toISOString()).toBe(expectedUtc);
    });

    it('resolves the exact UTC instant in a DST market (America/New_York)', async () => {
      const market = await freshMarket('America/New_York');
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      // 2027-07-04 00:00 EDT == 04:00Z (UTC-4).
      const body = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          effectiveFrom: '2027-07-04T04:00:00.000Z',
        }),
      ).expect(201);
      const result = body.body as {
        effectiveFrom: string;
        effectiveFromLocal: string;
        timezone: string;
      };
      expect(result.effectiveFrom).toBe('2027-07-04T04:00:00.000Z');
      expect(result.effectiveFromLocal).toBe('2027-07-04 00:00:00');
      expect(result.timezone).toBe('America/New_York');
    });

    it('rejects a DST-skipped midnight (America/Havana spring-forward)', async () => {
      const market = await freshMarket('America/Havana');
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      // Cuba springs forward at 00:00 local on 2026-03-08: 00:00 never
      // exists that day.
      const body = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          effectiveFrom: '2026-03-08T04:00:00.000Z',
        }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_ACTIVATION_NOT_FUTURE',
      );
    });

    // ─── 11-12. Overlap + concurrency ────────────────────────────────

    it('rejects overlapping effective windows and allows later starts', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date1 = klMidnightIso(4);
      const date2 = klMidnightIso(5);
      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.02',
          effectiveFrom: date1,
        }),
      ).expect(201);
      const overlap = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.03',
          effectiveFrom: date1,
        }),
      ).expect(409);
      expect((overlap.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP',
      );
      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.03',
          effectiveFrom: date2,
        }),
      ).expect(201);
      const count = await database.db
        .select({ id: rewardRuleVersions.id })
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.marketId, market));
      expect(count).toHaveLength(2);
    });

    it('resolves a concurrent race to exactly one 201 and one 409', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date = klMidnightIso(2);
      const [left, right] = await Promise.all([
        scheduleRule(
          admin.token,
          ownerPayload({
            marketId: market,
            rewardRate: '0.04',
            effectiveFrom: date,
          }),
          `race-${randomUUID()}`,
        ),
        scheduleRule(
          admin.token,
          ownerPayload({
            marketId: market,
            rewardRate: '0.041',
            effectiveFrom: date,
          }),
          `race-${randomUUID()}`,
        ),
      ]);
      const statuses = [left.status, right.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = left.status === 409 ? left : right;
      expect((conflict.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP',
      );
      const count = await database.db
        .select({ id: rewardRuleVersions.id })
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.marketId, market));
      expect(count).toHaveLength(1);
    });

    // ─── 13-16. Idempotency: replay + payload mismatch ───────────────

    it('replays the original result for the same key and payload', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `idem-${randomUUID()}`;
      const payload = ownerPayload({
        marketId: market,
        rewardRate: '0.025',
        effectiveFrom: klMidnightIso(3),
      });
      const first = await scheduleRule(admin.token, payload, key).expect(201);
      const firstId = (first.body as { id: string }).id;
      const replay = await scheduleRule(admin.token, payload, key).expect(201);
      expect((replay.body as { id: string }).id).toBe(firstId);
      // Exactly one version row exists.
      const count = await database.db
        .select({ id: rewardRuleVersions.id })
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.marketId, market));
      expect(count).toHaveLength(1);
    });

    it('rejects the same key with a different rate (409)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `idem-${randomUUID()}`;
      const date = klMidnightIso(3);
      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.025',
          effectiveFrom: date,
        }),
        key,
      ).expect(201);
      const conflict = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.03',
          effectiveFrom: date,
        }),
        key,
      ).expect(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_IDEMPOTENCY_CONFLICT',
      );
    });

    it('rejects the same key with a different effective time (409)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `idem-${randomUUID()}`;
      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.025',
          effectiveFrom: klMidnightIso(3),
        }),
        key,
      ).expect(201);
      const conflict = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.025',
          effectiveFrom: klMidnightIso(4),
        }),
        key,
      ).expect(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_IDEMPOTENCY_CONFLICT',
      );
    });

    it('rejects the same key with a different reason (409)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `idem-${randomUUID()}`;
      const date = klMidnightIso(3);
      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.025',
          effectiveFrom: date,
          reason: 'Original reason',
        }),
        key,
      ).expect(201);
      const conflict = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.025',
          effectiveFrom: date,
          reason: 'Different reason',
        }),
        key,
      ).expect(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'ADMIN_REWARD_IDEMPOTENCY_CONFLICT',
      );
    });

    // ─── 17. Mandatory reason ────────────────────────────────────────

    it('rejects missing, blank and overlength reasons (400)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const base = {
        marketId: market,
        rewardRate: '0.01',
        effectiveFrom: klMidnightIso(2),
      };
      const missing: Record<string, unknown> = { ...ownerPayload(base) };
      delete missing['reason'];
      await scheduleRule(admin.token, missing).expect(400);
      await scheduleRule(
        admin.token,
        ownerPayload({ ...base, reason: '   ' }),
      ).expect(400);
      await scheduleRule(
        admin.token,
        ownerPayload({ ...base, reason: 'x'.repeat(501) }),
      ).expect(400);
    });

    it('accepts the 1-char and 500-char reason boundaries', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.01',
          effectiveFrom: klMidnightIso(2),
          reason: 'x',
        }),
      ).expect(201);
      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.02',
          effectiveFrom: klMidnightIso(3),
          reason: 'x'.repeat(500),
        }),
      ).expect(201);
    });

    // ─── 18. Atomic immutable audit ──────────────────────────────────

    it('writes the owner audit with actor, market, reason and request id', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const reason = 'Audited schedule — Q3 governance review';
      const key = `audit-${randomUUID()}`;
      const body = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.01',
          effectiveFrom: klMidnightIso(4),
          reason,
        }),
        key,
      ).expect(201);
      const versionId = (body.body as { id: string }).id;

      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'reward.rule_version.create'),
            eq(auditLogs.marketId, market),
          ),
        );
      const record = auditRows.find((row) => row.entityId === versionId);
      expect(record).toBeTruthy();
      expect(record?.actorId).toBe(admin.adminUserId);
      expect(record?.reason).toBe(reason);
      // The audit records a request/correlation id (the app request id on
      // HTTP, falling back to the Idempotency-Key for in-process calls).
      expect(record?.requestId).toBeTypeOf('string');
      expect((record?.requestId ?? '').length).toBeGreaterThan(0);
      expect(record?.result).toBe('SUCCESS');

      // The version row durably stores the reason (migration 0030).
      const rows = await database.db
        .select()
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.id, versionId));
      expect(rows[0]?.reason).toBe(reason);

      // The idempotency mechanism row stores the canonical payload hash.
      const idemRows = await database.db
        .select()
        .from(merchantApiIdempotencyKeys)
        .where(eq(merchantApiIdempotencyKeys.key, key));
      expect(idemRows[0]?.statusCode).toBe(201);
      expect(idemRows[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/u);
      expect((idemRows[0]?.response as { id?: string })?.id).toBe(versionId);
    });

    // ─── 19. Atomic rollback (owner write + audit) ───────────────────

    it('rolls back the owner write and audit atomically on failure', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `atomic-${randomUUID()}`;
      const input = {
        name: 'Atomic Rollback Rule',
        effectiveFrom: klMidnightIso(3),
        rewardRate: '0.02',
        capType: 'NONE' as const,
        capValue: '0',
        minimumReward: '0',
        marketId: market,
        reason: 'Atomic rollback evidence',
        idempotencyKey: key,
      };
      const actor = {
        adminUserId: admin.adminUserId,
        currentMarketId: market,
        marketContextVersion: 2,
        ipAddress: '127.0.0.1',
      };
      const auditBefore = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'reward.rule_version.create'));
      // Inject a failure into the atomic audit step of the SAME transaction.
      const spy = vi
        .spyOn(auditService, 'appendWithinTransaction')
        .mockImplementationOnce(async () => {
          throw new Error('injected audit failure');
        });
      await expect(owner.createRuleVersion(actor, input)).rejects.toThrow(
        'injected audit failure',
      );
      spy.mockRestore();

      // No orphan version row, no NEW audit row, no mechanism claim.
      const versionCount = await database.db
        .select({ id: rewardRuleVersions.id })
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.marketId, market));
      expect(versionCount).toHaveLength(0);
      const auditAfter = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'reward.rule_version.create'));
      expect(auditAfter).toHaveLength(auditBefore.length);
      const claimCount = await database.db
        .select({ id: merchantApiIdempotencyKeys.id })
        .from(merchantApiIdempotencyKeys)
        .where(eq(merchantApiIdempotencyKeys.key, key));
      expect(claimCount).toHaveLength(0);

      // The same key can be retried after the correction → success.
      const retry = await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          name: 'Atomic Rollback Rule',
          rewardRate: '0.02',
          effectiveFrom: klMidnightIso(3),
          reason: 'Atomic rollback evidence',
        }),
        key,
      ).expect(201);
      expect((retry.body as { id: string }).id).toBeTruthy();
    });

    // ─── 20. No historical recalculation ─────────────────────────────

    it('never touches historical rule versions or issued reward rows', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const legacy = await seedRuleVersion({
        marketId: market,
        name: 'Legacy Closed Rule',
        rewardRate: '0.0125',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
        effectiveTo: new Date('2026-03-01T00:00:00.000Z'),
      });
      const plansBefore = await database.db
        .select({ id: rewardPlans.id })
        .from(rewardPlans);
      const sourcesBefore = await database.db
        .select({ id: rewardSources.id })
        .from(rewardSources);

      await scheduleRule(
        admin.token,
        ownerPayload({
          marketId: market,
          rewardRate: '0.05',
          effectiveFrom: klMidnightIso(2),
        }),
      ).expect(201);

      const rows = await database.db
        .select()
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.id, legacy));
      expect(rows[0]?.rewardRate).toBe('0.0125000000');
      expect(rows[0]?.effectiveFrom.toISOString()).toBe(
        '2026-01-01T00:00:00.000Z',
      );
      expect(rows[0]?.effectiveTo?.toISOString()).toBe(
        '2026-03-01T00:00:00.000Z',
      );
      expect(rows[0]?.reason).toBeNull(); // legacy rows keep NULL
      const plansAfter = await database.db
        .select({ id: rewardPlans.id })
        .from(rewardPlans);
      const sourcesAfter = await database.db
        .select({ id: rewardSources.id })
        .from(rewardSources);
      expect(plansAfter).toHaveLength(plansBefore.length);
      expect(sourcesAfter).toHaveLength(sourcesBefore.length);
    });

    // ─── 9. Append-only (no update/delete routes) ────────────────────

    it('exposes no update or delete routes for published versions', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const id = randomUUID();
      for (const method of ['patch', 'put', 'delete'] as const) {
        await supertest(server)
          [method](`${rulesUrl}/${id}`)
          .set(authorized(admin.token))
          .expect(404);
      }
    });

    // ─── In-process enforcement (Phase 7 adapter surface) ────────────

    it('enforces every control on direct in-process service calls (bypass proof)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const fullActor = {
        adminUserId: admin.adminUserId,
        currentMarketId: market,
        marketContextVersion: 2,
        ipAddress: '127.0.0.1',
      };
      const validInput = {
        name: 'In-process Rule',
        effectiveFrom: klMidnightIso(3),
        rewardRate: '0.03',
        capType: 'NONE' as const,
        capValue: '0',
        minimumReward: '0',
        marketId: market,
        reason: 'In-process evidence',
        idempotencyKey: `proc-${randomUUID()}`,
      };

      // No permission → denied (a read-only admin cannot schedule).
      const readOnly = await createAdmin({ marketIds: [market] });
      await expect(
        owner.createRuleVersion(
          { ...fullActor, adminUserId: readOnly.adminUserId },
          validInput,
        ),
      ).rejects.toMatchObject({ code: 'ADMIN_REWARD_PERMISSION_DENIED' });

      // No server Current Admin Market → selection required.
      await expect(
        owner.createRuleVersion(
          { adminUserId: admin.adminUserId, ipAddress: '127.0.0.1' },
          validInput,
        ),
      ).rejects.toMatchObject({
        code: 'ADMIN_REWARD_MARKET_SELECTION_REQUIRED',
      });

      // Body market != server current market → context mismatch.
      await expect(
        owner.createRuleVersion(
          { ...fullActor, currentMarketId: marketB },
          validInput,
        ),
      ).rejects.toMatchObject({ code: 'ADMIN_REWARD_MARKET_CONTEXT_MISMATCH' });

      // No reason → required.
      await expect(
        owner.createRuleVersion(fullActor, {
          ...validInput,
          reason: undefined,
        }),
      ).rejects.toMatchObject({ code: 'ADMIN_REWARD_REASON_REQUIRED' });

      // No idempotency key → required.
      await expect(
        owner.createRuleVersion(fullActor, {
          ...validInput,
          idempotencyKey: undefined,
        }),
      ).rejects.toMatchObject({
        code: 'ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED',
      });

      // A fully valid in-process call succeeds with the same enforcement.
      const result = await owner.createRuleVersion(fullActor, validInput);
      expect(result.id).toBeTruthy();
      expect(result.marketId).toBe(market);
      expect(result.reason).toBe('In-process evidence');
    });
  },
);
