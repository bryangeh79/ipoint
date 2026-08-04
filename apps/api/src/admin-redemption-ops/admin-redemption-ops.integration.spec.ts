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
  redemptionOrders,
  redemptionQuotes,
  redemptionRateVersions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull, sql } from 'drizzle-orm';
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
import { RedemptionService } from '../redemption/redemption.service.js';
import {
  REDEMPTION_RATE_RULES_PROVIDER,
  type RedemptionRateMarketRulesMap,
} from './admin-redemption-ops.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Redemption-Ops-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

/** Market-local calendar date N days ahead of now in the given IANA zone. */
function marketLocalDate(daysAhead: number, timeZone: string): string {
  const probe = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(probe);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
}

/**
 * Test-only extension of the approved rules catalog: every test market code
 * below carries the SAME Malaysia §7.2 values (initial 1.00 / min 0.50 /
 * max 2.00 MYR). The PRODUCTION catalog (`REDEMPTION_RATE_MARKET_RULES`)
 * approves only `MY`; the extra codes exist solely so the multi-market
 * evidence (at-bounds acceptance, isolation, races) can be produced without
 * altering production configuration.
 */
function testRules(): RedemptionRateMarketRulesMap {
  const codes = ['MY', 'MA', 'MB', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MI'];
  return Object.fromEntries(
    codes.map((code) => [
      code,
      {
        marketCode: code,
        initialRate: '1.0000000000',
        minimumRate: '0.5000000000',
        maximumRate: '2.0000000000',
        currency: 'MYR',
        displayUnit: 'RM per 1 iPoint',
      },
    ]),
  );
}

describe.skipIf(!databaseUrl)(
  'Admin Redemption Rate Operations HTTP integration (P7-S6C)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let redemption: RedemptionService;
    let rateLimiter: InMemoryRateLimiter;
    let marketMy: string; // code MY, MYR, Asia/Kuala_Lumpur (approved §7.2)
    let marketSg: string; // code SG, SGD, Asia/Singapore (blocked, no rule)
    let marketMa: string; // test-configured (Malaysia values) — at-bounds 0.50
    let marketMb: string; // test-configured — at-bounds 2.00
    let marketMc: string; // test-configured — ten-decimal precision
    let marketMd: string; // test-configured — future 00:00 resolution
    let marketMe: string; // test-configured — overlap prevention
    let marketMf: string; // test-configured — concurrent race
    let marketMg: string; // test-configured — idempotency
    let marketMh: string; // test-configured — audit trail
    let marketMi: string; // test-configured — market isolation

    const ratesUrl = (marketId: string) =>
      `/api/v1/admin/redemption-ops/markets/${marketId}/rates`;

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
          name: `${code} Redemption Ops Test Market`,
          status: 'ACTIVE',
          currencyCode,
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      return inserted[0]?.id ?? '';
    }

    /** A brand-new active market with a random (unapproved) code. */
    async function freshMarket(
      timezone = 'Asia/Kuala_Lumpur',
    ): Promise<string> {
      const code = `M${randomUUID().slice(0, 6).toUpperCase()}`;
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `Fresh Redemption Ops Market ${code}`,
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
            description: `${code} redemption ops integration test permission`,
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
          displayName: `Redemption Ops Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserIdValue = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? [
        'redemption.rate.read',
      ];
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
          name: `Redemption Ops HTTP Test Role (${roleCode})`,
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
        await database.db
          .insert(marketAccess)
          .values(
            options.marketIds.map((marketId) => ({
              adminUserId: adminUserIdValue,
              marketId,
            })),
          );
      }
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

    /** Direct row seed of a market-scoped rate version (owner-style rows). */
    async function seedRateVersion(params: {
      marketId: string;
      rateValue: string;
      effectiveFrom: Date;
      createdBy: string;
      effectiveUntil?: Date | null;
    }): Promise<string> {
      const inserted = await database.db
        .insert(redemptionRateVersions)
        .values({
          marketId: params.marketId,
          rateType: 'POINTS_PER_CURRENCY',
          rateValue: params.rateValue,
          effectiveFrom: params.effectiveFrom,
          effectiveUntil: params.effectiveUntil ?? null,
          createdBy: params.createdBy,
        })
        .returning({ id: redemptionRateVersions.id });
      return inserted[0]?.id ?? '';
    }

    /** Build the create payload for the adapter surface. */
    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        rate_value: '1.5',
        effective_date: marketLocalDate(2, 'Asia/Kuala_Lumpur'),
        reason: 'Integration test rate configuration',
        ...overrides,
      };
    }

    async function rateVersionCount(marketId: string): Promise<number> {
      const rows = await database.db
        .select({ id: redemptionRateVersions.id })
        .from(redemptionRateVersions)
        .where(eq(redemptionRateVersions.marketId, marketId));
      return rows.length;
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
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'admin-redemption-ops-pepper-at-least-32-characters',
      );
      vi.stubEnv(
        'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(REDEMPTION_RATE_RULES_PROVIDER)
        .useValue(testRules())
        .compile();
      app = moduleFixture.createNestApplication();
      configureApplication(app, {
        enableShutdownHooks: false,
        scanSwaggerRoutes: false,
      });
      await app.init();
      server = app.getHttpServer() as Server;
      auth = app.get(AuthService);
      database = app.get(DatabaseService);
      redemption = app.get(RedemptionService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketMy = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketSg = await ensureActiveMarket('SG', 'SGD', 'Asia/Singapore');
      marketMa = await ensureActiveMarket('MA', 'MYR', 'Asia/Kuala_Lumpur');
      marketMb = await ensureActiveMarket('MB', 'MYR', 'Asia/Kuala_Lumpur');
      marketMc = await ensureActiveMarket('MC', 'MYR', 'Asia/Kuala_Lumpur');
      marketMd = await ensureActiveMarket('MD', 'MYR', 'Asia/Kuala_Lumpur');
      marketMe = await ensureActiveMarket('ME', 'MYR', 'Asia/Kuala_Lumpur');
      marketMf = await ensureActiveMarket('MF', 'MYR', 'Asia/Kuala_Lumpur');
      marketMg = await ensureActiveMarket('MG', 'MYR', 'Asia/Kuala_Lumpur');
      marketMh = await ensureActiveMarket('MH', 'MYR', 'Asia/Kuala_Lumpur');
      marketMi = await ensureActiveMarket('MI', 'MYR', 'Asia/Kuala_Lumpur');
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

    // ─── Read surface ────────────────────────────────────────────────

    it('GET rates: Malaysia shows the approved §7.2 bounds and an empty chain', async () => {
      const admin = await createAdmin({ marketIds: [marketMy] });
      await setCurrentMarket(admin.accountId, marketMy);
      const response = await supertest(server)
        .get(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .expect(200);
      expect(response.body.market_id).toBe(marketMy);
      expect(response.body.market_code).toBe('MY');
      expect(response.body.timezone).toBe('Asia/Kuala_Lumpur');
      expect(response.body.configured).toBe(true);
      expect(response.body.config).toEqual({
        initial_rate: '1',
        minimum_rate: '0.5',
        maximum_rate: '2',
        currency: 'MYR',
        display_unit: 'RM per 1 iPoint',
        technical_decimals: 10,
        display_decimals: 6,
      });
      expect(response.body.rates).toEqual([]);
    });

    it('GET rates: an unapproved market is explicitly BLOCKED (no fallback)', async () => {
      const admin = await createAdmin({ marketIds: [marketSg] });
      await setCurrentMarket(admin.accountId, marketSg);
      const response = await supertest(server)
        .get(ratesUrl(marketSg))
        .set(authorized(admin.token))
        .expect(200);
      expect(response.body.market_code).toBe('SG');
      expect(response.body.configured).toBe(false);
      expect(response.body.config).toBeNull();
      // No Malaysia values leak into the blocked market — never a fallback.
      expect(JSON.stringify(response.body)).not.toContain('RM per 1 iPoint');
      expect(JSON.stringify(response.body)).not.toContain('"initial_rate"');
    });

    it('GET rates: exact decimal strings, local + UTC, window status', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({ marketIds: [market] });
      await setCurrentMarket(admin.accountId, market);
      const start = new Date('2026-01-01T00:00:00.000Z');
      const later = new Date('2026-06-01T00:00:00.000Z');
      const v1 = await seedRateVersion({
        marketId: market,
        rateValue: '1.0000000000',
        effectiveFrom: start,
        // Bounded window so v2 can start at 2026-06-01 (the frozen gist
        // exclusion forbids two open-ended versions in the same market).
        effectiveUntil: later,
        createdBy: admin.adminUserId,
      });
      const v2 = await seedRateVersion({
        marketId: market,
        rateValue: '1.1234567890',
        effectiveFrom: later,
        createdBy: admin.adminUserId,
      });
      const response = await supertest(server)
        .get(ratesUrl(market))
        .set(authorized(admin.token))
        .expect(200);

      const byId = new Map(
        (response.body.rates as Array<Record<string, unknown>>).map((rate) => [
          rate.id,
          rate,
        ]),
      );
      expect(byId.size).toBe(2);
      const rateV1 = byId.get(v1) as Record<string, unknown>;
      const rateV2 = byId.get(v2) as Record<string, unknown>;
      expect(rateV1.rate_type).toBe('POINTS_PER_CURRENCY');
      expect(rateV1.rate_value).toBe('1.0000000000');
      expect(rateV1.display_rate).toBe('1');
      expect(rateV1.effective_from_utc).toBe('2026-01-01T00:00:00.000Z');
      expect(rateV1.effective_from_local).toBe('2026-01-01 08:00:00');
      // v1's explicit window ended exactly when v2 started (adjacent
      // half-open windows, no overlap) — it EXPIRED at its own end.
      expect(rateV1.window_status).toBe('EXPIRED');
      expect(rateV1.effective_until_utc).toBe('2026-06-01T00:00:00.000Z');
      // Full technical precision survives; display is ≤6 decimals.
      expect(rateV2.rate_value).toBe('1.1234567890');
      expect(rateV2.display_rate).toBe('1.123457');
      expect(rateV2.window_status).toBe('ACTIVE');
      expect(rateV2.effective_until_utc).toBeNull();
    });

    // ─── Authorization and market enforcement ─────────────────────────

    it('rejects unauthenticated and unauthorized reads (401/403)', async () => {
      await supertest(server).get(ratesUrl(marketMy)).expect(401);
      const member = await createAccount();
      const token = (await auth.login(member.email, password)).accessToken;
      await supertest(server)
        .get(ratesUrl(marketMy))
        .set(authorized(token))
        .expect(403);
    });

    it('denies reads without the redemption.rate.read permission (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMy],
        permissionCodes: ['dashboard.view'],
      });
      await setCurrentMarket(admin.accountId, marketMy);
      await supertest(server)
        .get(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .expect(403);
    });

    it('denies creates without redemption.rate.manage (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMy],
        permissionCodes: ['redemption.rate.read'],
      });
      await setCurrentMarket(admin.accountId, marketMy);
      const body = await supertest(server)
        .post(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload())
        .expect(403);
      expect((body.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('enforces the selected-market contract (no grant / wrong market)', async () => {
      const admin = await createAdmin({ marketIds: [marketSg] });
      await setCurrentMarket(admin.accountId, marketSg);
      await supertest(server)
        .get(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .expect(409)
        .expect((res) => {
          expect((res.body as ErrorBody).error.code).toBe(
            'MARKET_CONTEXT_MISMATCH',
          );
        });

      const noMarket = await createAdmin({ marketIds: [] });
      await supertest(server)
        .get(ratesUrl(marketSg))
        .set(authorized(noMarket.token))
        .expect(409)
        .expect((res) => {
          expect((res.body as ErrorBody).error.code).toBe(
            'MARKET_SELECTION_REQUIRED',
          );
        });

      const dual = await createAdmin({ marketIds: [marketMy, marketSg] });
      await setCurrentMarket(dual.accountId, marketSg);
      await supertest(server)
        .get(ratesUrl(marketMy))
        .set(authorized(dual.token))
        .expect(409)
        .expect((res) => {
          expect((res.body as ErrorBody).error.code).toBe(
            'MARKET_CONTEXT_MISMATCH',
          );
        });
    });

    it('requires an Idempotency-Key on the write (400)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await supertest(server)
        .post(ratesUrl(market))
        .set(authorized(admin.token))
        .send(createPayload())
        .expect(400);
      expect((body.body as ErrorBody).error.code).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    });

    // ─── Create surface (Malaysia, strict future dates, increasing order)
    // Note: tests that create versions on the shared Malaysia market MUST
    // use strictly increasing market-local dates (the frozen owner allows
    // exactly one version per market + rate type; the surface rejects any
    // further version with the stable 409 overlap contract).

    it('accepts the Malaysia bounds at 0.50 / 1.00 / 2.00 (at-bounds)', async () => {
      // Each at-bounds value is accepted on its own configured market: the
      // frozen owner allows exactly one version per market + rate type, so
      // a fresh configured market is the correct fixture for each value.
      const admin = await createAdmin({
        marketIds: [marketMy, marketMa, marketMb],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });

      // 0.50 — the minimum bound, exactly accepted.
      await setCurrentMarket(admin.accountId, marketMa);
      const date1 = marketLocalDate(4, 'Asia/Kuala_Lumpur');
      const min = await supertest(server)
        .post(ratesUrl(marketMa))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({ rate_value: '0.5000000000', effective_date: date1 }),
        )
        .expect(201);
      expect((min.body as { rate_value: string }).rate_value).toBe(
        '0.5000000000',
      );

      // 1.00 — the Malaysia initial baseline on the real MY market.
      await setCurrentMarket(admin.accountId, marketMy);
      const date2 = marketLocalDate(5, 'Asia/Kuala_Lumpur');
      const initial = await supertest(server)
        .post(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({ rate_value: '1.0000000000', effective_date: date2 }),
        )
        .expect(201);
      expect((initial.body as { rate_value: string }).rate_value).toBe(
        '1.0000000000',
      );

      // 2.00 — the maximum bound, exactly accepted.
      await setCurrentMarket(admin.accountId, marketMb);
      const date3 = marketLocalDate(6, 'Asia/Kuala_Lumpur');
      const max = await supertest(server)
        .post(ratesUrl(marketMb))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({ rate_value: '2.0000000000', effective_date: date3 }),
        )
        .expect(201);
      expect((max.body as { rate_value: string }).rate_value).toBe(
        '2.0000000000',
      );

      // All three stored exactly (numeric(38,10)), one per market.
      for (const [marketId, expected] of [
        [marketMa, '0.5000000000'],
        [marketMy, '1.0000000000'],
        [marketMb, '2.0000000000'],
      ] as const) {
        const rows = await database.db
          .select()
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, marketId));
        expect(rows.length).toBe(1);
        expect(String(rows[0]?.rateValue)).toBe(expected);
      }
    });

    it('rejects below the minimum and above the maximum (Malaysia bounds)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMy],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMy);
      const date = marketLocalDate(7, 'Asia/Kuala_Lumpur');
      const before = await rateVersionCount(marketMy);

      const below = await supertest(server)
        .post(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '0.49', effective_date: date }))
        .expect(422);
      expect((below.body as ErrorBody).error.code).toBe(
        'REDEMPTION_RATE_BELOW_MINIMUM',
      );

      const above = await supertest(server)
        .post(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '2.01', effective_date: date }))
        .expect(422);
      expect((above.body as ErrorBody).error.code).toBe(
        'REDEMPTION_RATE_ABOVE_MAXIMUM',
      );

      // Eleven input decimals exceed the §7.2 technical ceiling → 400.
      await supertest(server)
        .post(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({ rate_value: '1.12345678901', effective_date: date }),
        )
        .expect(400);

      // No version was created by any of the rejected calls.
      expect(await rateVersionCount(marketMy)).toBe(before);
    });

    it('accepts the full ten-decimal technical precision; display is ≤6 and display-only', async () => {
      const admin = await createAdmin({
        marketIds: [marketMc],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMc);
      const date = marketLocalDate(8, 'Asia/Kuala_Lumpur');
      const body = await supertest(server)
        .post(ratesUrl(marketMc))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({ rate_value: '1.1234567890', effective_date: date }),
        )
        .expect(201);
      const result = body.body as {
        id: string;
        rate_value: string;
        display_rate: string;
      };
      // API carries the full technical precision.
      expect(result.rate_value).toBe('1.1234567890');
      // Display value rounds half-up to 6 decimals — display only.
      expect(result.display_rate).toBe('1.123457');

      // Stored row keeps the exact ten-decimal value (never rounded).
      const rows = await database.db
        .select()
        .from(redemptionRateVersions)
        .where(eq(redemptionRateVersions.id, result.id));
      expect(String(rows[0]?.rateValue)).toBe('1.1234567890');

      // The read projection repeats the same full precision + display value.
      const list = await supertest(server)
        .get(ratesUrl(marketMc))
        .set(authorized(admin.token))
        .expect(200);
      const listed = (list.body.rates as Array<Record<string, unknown>>).find(
        (rate) => rate.id === result.id,
      );
      expect(listed?.rate_value).toBe('1.1234567890');
      expect(listed?.display_rate).toBe('1.123457');
    });

    it('creates at the future market-local 00:00 and returns local + UTC', async () => {
      const admin = await createAdmin({
        marketIds: [marketMd],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMd);
      const effectiveDate = marketLocalDate(12, 'Asia/Kuala_Lumpur');
      const body = await supertest(server)
        .post(ratesUrl(marketMd))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            rate_value: '1.0000000000',
            effective_date: effectiveDate,
            reason: 'Malaysia initial rate baseline',
          }),
        )
        .expect(201);
      const result = body.body as {
        id: string;
        rate_type: string;
        rate_value: string;
        display_rate: string;
        effective_date: string;
        effective_from_utc: string;
        effective_from_local: string;
        timezone: string;
        market_id: string;
      };
      expect(result.rate_type).toBe('POINTS_PER_CURRENCY');
      expect(result.rate_value).toBe('1.0000000000');
      expect(result.display_rate).toBe('1');
      expect(result.effective_date).toBe(effectiveDate);
      expect(result.timezone).toBe('Asia/Kuala_Lumpur');
      expect(result.market_id).toBe(marketMd);
      // Asia/Kuala_Lumpur is UTC+8: local 00:00 == previous day 16:00 UTC.
      const expectedUtc = new Date(
        Date.parse(`${effectiveDate}T00:00:00.000Z`) - 8 * 60 * 60 * 1000,
      ).toISOString();
      expect(result.effective_from_utc).toBe(expectedUtc);
      expect(result.effective_from_local).toBe(`${effectiveDate} 00:00:00`);
      // The stored owner row is market-scoped, open-ended, exact decimal.
      const rows = await database.db
        .select()
        .from(redemptionRateVersions)
        .where(eq(redemptionRateVersions.id, result.id));
      expect(rows[0]?.marketId).toBe(marketMd);
      expect(rows[0]?.rateType).toBe('POINTS_PER_CURRENCY');
      expect(rows[0]?.effectiveUntil).toBeNull();
      expect(String(rows[0]?.rateValue)).toBe('1.0000000000');
      // The list projection marks it SCHEDULED (future-effective).
      const list = await supertest(server)
        .get(ratesUrl(marketMd))
        .set(authorized(admin.token))
        .expect(200);
      const listed = (list.body.rates as Array<Record<string, unknown>>).find(
        (rate) => rate.id === result.id,
      );
      expect(listed?.window_status).toBe('SCHEDULED');
    });

    it('rejects same-day and backdated activation (422)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMy],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMy);
      const today = marketLocalDate(0, 'Asia/Kuala_Lumpur');
      const sameDay = await supertest(server)
        .post(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ effective_date: today }))
        .expect(422);
      expect((sameDay.body as ErrorBody).error.code).toBe(
        'REDEMPTION_ACTIVATION_NOT_FUTURE',
      );
      const backdated = await supertest(server)
        .post(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ effective_date: '2020-01-01' }))
        .expect(422);
      expect((backdated.body as ErrorBody).error.code).toBe(
        'REDEMPTION_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects any further version once one exists (overlap prevention)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMe],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMe);
      const date1 = marketLocalDate(2, 'Asia/Kuala_Lumpur');
      const date2 = marketLocalDate(3, 'Asia/Kuala_Lumpur');

      const first = await supertest(server)
        .post(ratesUrl(marketMe))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '1.2', effective_date: date1 }))
        .expect(201);
      const firstId = (first.body as { id: string }).id;

      // Same start date → overlap.
      const sameDate = await supertest(server)
        .post(ratesUrl(marketMe))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '1.3', effective_date: date1 }))
        .expect(409);
      expect((sameDate.body as ErrorBody).error.code).toBe(
        'REDEMPTION_RATE_OVERLAP',
      );

      // A LATER start date is also rejected: the frozen owner model allows
      // exactly one version per market + rate type (append-only triggers,
      // gist exclusion over `[effective_from, effective_until)` and the
      // owner's overlap pre-check). Version changes after the initial
      // baseline require frozen-owner remediation (see delivery report).
      const later = await supertest(server)
        .post(ratesUrl(marketMe))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '1.3', effective_date: date2 }))
        .expect(409);
      expect((later.body as ErrorBody).error.code).toBe(
        'REDEMPTION_RATE_OVERLAP',
      );

      // Historical immutability: V1's stored rate never changed.
      const rows = await database.db
        .select()
        .from(redemptionRateVersions)
        .where(eq(redemptionRateVersions.id, firstId));
      expect(String(rows[0]?.rateValue)).toBe('1.2000000000');
    });

    it('concurrent overlapping creates resolve to exactly one 201 + one 409', async () => {
      const admin = await createAdmin({
        marketIds: [marketMf],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMf);
      const date = marketLocalDate(13, 'Asia/Kuala_Lumpur');
      const before = await rateVersionCount(marketMf);
      const [left, right] = await Promise.all([
        supertest(server)
          .post(ratesUrl(marketMf))
          .set(authorized(admin.token))
          .set('Idempotency-Key', `race-${randomUUID()}`)
          .send(createPayload({ rate_value: '1.4', effective_date: date })),
        supertest(server)
          .post(ratesUrl(marketMf))
          .set(authorized(admin.token))
          .set('Idempotency-Key', `race-${randomUUID()}`)
          .send(createPayload({ rate_value: '1.41', effective_date: date })),
      ]);
      const statuses = [left.status, right.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = left.status === 409 ? left : right;
      expect((conflict.body as ErrorBody).error.code).toBe(
        'REDEMPTION_RATE_OVERLAP',
      );
      // Exactly one new row was created.
      expect(await rateVersionCount(marketMf)).toBe(before + 1);
    });

    it('replays idempotent creates and rejects key reuse with a different payload', async () => {
      const admin = await createAdmin({
        marketIds: [marketMg],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMg);
      const date = marketLocalDate(10, 'Asia/Kuala_Lumpur');
      const key = `idem-${randomUUID()}`;
      const payload = createPayload({ rate_value: '1.6', effective_date: date });

      const first = await supertest(server)
        .post(ratesUrl(marketMg))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      const firstId = (first.body as { id: string }).id;

      const replay = await supertest(server)
        .post(ratesUrl(marketMg))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      expect((replay.body as { id: string }).id).toBe(firstId);

      const conflict = await supertest(server)
        .post(ratesUrl(marketMg))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(createPayload({ rate_value: '1.7', effective_date: date }))
        .expect(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'REDEMPTION_IDEMPOTENCY_CONFLICT',
      );
    });

    it('writes the privileged audit trail with reason + actor', async () => {
      const admin = await createAdmin({
        marketIds: [marketMh],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMh);
      const date = marketLocalDate(11, 'Asia/Kuala_Lumpur');
      const reason = 'Approved ops review — Q3 redemption rate change';
      const key = `audit-${randomUUID()}`;
      const body = await supertest(server)
        .post(ratesUrl(marketMh))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(createPayload({ rate_value: '1.8', effective_date: date, reason }))
        .expect(201);
      const versionId = (body.body as { id: string }).id;

      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'ADMIN_REDEMPTION_RATE_VERSION_CREATED'),
            eq(auditLogs.marketId, marketMh),
          ),
        );
      const record = auditRows.find(
        (row) => row.entityId === versionId && row.reason === reason,
      );
      expect(record).toBeTruthy();
      expect(record?.actorId).toBe(admin.adminUserId);
      expect(record?.requestId).toBe(key);
      expect(record?.result).toBe('SUCCESS');
      expect(record?.after).toMatchObject({ version_id: versionId });

      const idemRows = await database.db
        .select()
        .from(merchantApiIdempotencyKeys)
        .where(eq(merchantApiIdempotencyKeys.key, key));
      expect(idemRows[0]?.statusCode).toBe(201);
      expect((idemRows[0]?.response as { id?: string })?.id).toBe(versionId);
    });

    it('exposes no edit/delete routes (immutable append-only versions)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMy],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMy);
      const id = randomUUID();
      for (const method of ['patch', 'put', 'delete'] as const) {
        await supertest(server)
          [method](`${ratesUrl(marketMy)}/${id}`)
          .set(authorized(admin.token))
          .expect(404);
      }
      // The frozen owner surface has no edit/delete routes either.
      await supertest(server)
        .patch(`/api/v1/admin/redemption/market/${marketMy}/rates/${id}`)
        .set(authorized(admin.token))
        .expect(404);
    });

    it('isolates markets: a Malaysia version never leaks to another market', async () => {
      const admin = await createAdmin({
        marketIds: [marketMi, marketSg],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMi);
      const date = marketLocalDate(14, 'Asia/Kuala_Lumpur');
      const body = await supertest(server)
        .post(ratesUrl(marketMi))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '1.9', effective_date: date }))
        .expect(201);
      const versionId = (body.body as { id: string }).id;
      await setCurrentMarket(admin.accountId, marketSg);
      const list = await supertest(server)
        .get(ratesUrl(marketSg))
        .set(authorized(admin.token))
        .expect(200);
      expect(
        (list.body.rates as Array<{ id: string }>).some(
          (rate) => rate.id === versionId,
        ),
      ).toBe(false);
      const rows = await database.db
        .select()
        .from(redemptionRateVersions)
        .where(eq(redemptionRateVersions.id, versionId));
      expect(rows[0]?.marketId).toBe(marketMi);
    });

    it('blocks rate creation for a market without an approved configuration', async () => {
      const admin = await createAdmin({
        marketIds: [marketSg],
        permissionCodes: ['redemption.rate.read', 'redemption.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketSg);
      const body = await supertest(server)
        .post(ratesUrl(marketSg))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload())
        .expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'REDEMPTION_RATE_MARKET_BLOCKED',
      );
      // No row and no audit record were produced.
      expect(await rateVersionCount(marketSg)).toBe(0);
      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'ADMIN_REDEMPTION_RATE_VERSION_CREATED'),
            eq(auditLogs.marketId, marketSg),
          ),
        );
      expect(auditRows.length).toBe(0);
    });

    it('never reprices historical quotes/orders (rate locked at quote time)', async () => {
      // A rate-locking proof against the frozen owner: a quote/order locks
      // the effective rate version at generation time; a successor version
      // (seeded like the owner would create it) never changes the
      // historical rows.
      const market = await freshMarket('Asia/Kuala_Lumpur');
      const admin = await createAdmin({ marketIds: [market] });
      await setCurrentMarket(admin.accountId, market);

      // v0 is effective NOW (window covers today); v1 is its future
      // successor starting 2026-09-01 (adjacent half-open windows, exactly
      // like a bounded-window owner create).
      const v0 = await seedRateVersion({
        marketId: market,
        rateValue: '1.0000000000',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2026-09-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });
      const v1 = await seedRateVersion({
        marketId: market,
        rateValue: '2.0000000000',
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });

      // Member + wallet + active item + inventory (frozen owner needs them).
      const memberId = randomUUID();
      const accountId = randomUUID();
      await database.db.insert(accounts).values({
        id: accountId,
        publicId: `acct_${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
      });
      await database.db.execute(
        sql`INSERT INTO members(id, account_id, public_member_id, referral_code, status, kyc_level)
            VALUES (${memberId}, ${accountId}, ${`MB-${randomUUID().slice(0, 8)}`}, ${`RF-${randomUUID().slice(0, 8)}`}, 'ACTIVE'::member_status, 'LEVEL_2'::member_kyc_level)`,
      );
      await database.db.execute(
        sql`INSERT INTO redemption_terms_acceptances(member_id, market_id, terms_version)
            VALUES (${memberId}, ${market}, 'v1') ON CONFLICT DO NOTHING`,
      );
      await database.db.execute(
        sql`INSERT INTO member_wallet_accounts(id, member_id, market_id, pending_balance, available_balance, reversed_balance, version)
            VALUES (${randomUUID()}, ${memberId}, ${market}, 0, 100000, 0, 1)`,
      );
      const itemId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO redemption_catalog_items(id, market_id, sku, name, item_type, status, fiat_reference_value, fiat_currency, fulfilment_mode, inventory_mode, created_by, version)
            VALUES (${itemId}, ${market}, ${`SKU-${randomUUID().slice(0, 8)}`}, 'Rate Lock Item', 'PHYSICAL', 'ACTIVE', '50', 'MYR', 'PICKUP', 'TRACKED', ${admin.adminUserId}, 1)`,
      );
      await database.db.execute(
        sql`INSERT INTO redemption_inventory(id, item_id, total_quantity, committed_quantity, fulfilled_quantity, backorder_quantity, version)
            VALUES (${randomUUID()}, ${itemId}, 100, 0, 0, 0, 1)`,
      );

      // The frozen effective rate at NOW is v0 (v1 is future-effective).
      const effective = await redemption.getEffectiveRate(market);
      expect(effective.id).toBe(v0);
      expect(effective.rateValue).toBe('1.0000000000');

      // Frozen quote locks v0 (rate 1.00 → 50 points for a RM50 item).
      const quote = await redemption.generateQuote(memberId, market, itemId, 1);
      expect(quote.rateVersionId).toBe(v0);
      expect(quote.postedPointCost).toBe('50.0000000000');

      const order = await redemption.confirmOrder(
        memberId,
        market,
        {
          quoteId: quote.quoteId,
          idempotencyKey: `order-${randomUUID()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: quote.postedPointCost,
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      );
      expect(order.status).toBe('CONFIRMED');

      // The historical quote keeps its original rate version + snapshot.
      const quoteRows = await database.db
        .select()
        .from(redemptionQuotes)
        .where(eq(redemptionQuotes.id, quote.quoteId));
      expect(quoteRows[0]?.rateVersionId).toBe(v0);
      expect(
        (quoteRows[0]?.rateSnapshot as { rateValue?: string })?.rateValue,
      ).toBe('1.0000000000');
      expect(String(quoteRows[0]?.postedPointCost)).toBe('50.0000000000');

      // The historical order keeps its original rate version + snapshot —
      // the successor version v1 (2.00) never repriced it.
      const orderRows = await database.db
        .select()
        .from(redemptionOrders)
        .where(eq(redemptionOrders.id, order.id));
      expect(orderRows[0]?.rateVersionId).toBe(v0);
      expect(
        (orderRows[0]?.rateSnapshot as { rateValue?: string })?.rateValue,
      ).toBe('1.0000000000');
      expect(String(orderRows[0]?.postedPointCost)).toBe('50.0000000000');

      // The stored versions are exactly v0 (1.00) and v1 (2.00) — the
      // historical row was not recalculated against v1.
      const stored = await database.db
        .select()
        .from(redemptionRateVersions)
        .where(eq(redemptionRateVersions.marketId, market));
      expect(stored.map((row) => String(row.rateValue)).sort()).toEqual([
        '1.0000000000',
        '2.0000000000',
      ]);
    });

    it('protects versions at the database level (reject update/delete)', async () => {
      // Seed a version directly (owner-style row) on a fresh market and
      // prove the append-only triggers reject UPDATE and DELETE.
      const market = await freshMarket();
      const admin = await createAdmin({ marketIds: [market] });
      await setCurrentMarket(admin.accountId, market);
      const versionId = await seedRateVersion({
        marketId: market,
        rateValue: '1.2500000000',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });

      // Direct UPDATE / DELETE are rejected by the owner's append-only
      // triggers — even a well-intentioned caller cannot mutate history.
      await expect(
        database.db.execute(
          sql`UPDATE redemption_rate_versions SET rate_value = '9.0000000000' WHERE id = ${versionId}`,
        ),
      ).rejects.toThrow();
      await expect(
        database.db.execute(
          sql`DELETE FROM redemption_rate_versions WHERE id = ${versionId}`,
        ),
      ).rejects.toThrow();

      // The stored row is untouched.
      const rows = await database.db
        .select()
        .from(redemptionRateVersions)
        .where(eq(redemptionRateVersions.id, versionId));
      expect(String(rows[0]?.rateValue)).toBe('1.2500000000');
    });
  },
);
