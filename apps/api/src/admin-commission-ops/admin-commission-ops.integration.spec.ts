import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import {
  accounts,
  adminUsers,
  auditLogs,
  commissionRateVersions,
  marketAccess,
  markets,
  merchantApiIdempotencyKeys,
  migrate,
  permissions,
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
import { AdminCommissionOpsService } from './admin-commission-ops.service.js';
import type { AdminCommissionOpsActor } from './admin-commission-ops.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Commission-Ops-Password-123!';

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

describe.skipIf(!databaseUrl)(
  'Admin Commission Rate Operations HTTP integration (P7-S6D, D-054 rewiring)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let ops: AdminCommissionOpsService;
    let rateLimiter: InMemoryRateLimiter;
    let marketMy: string; // code MY — legacy seed rows (0018/0029)
    let marketMa: string; // fresh — create + projection (AGENT_UPGRADE)
    let marketMb: string; // fresh — idempotency
    let marketMc: string; // fresh — taxonomy errors
    let marketMd: string; // fresh — activation-time errors
    let marketMe: string; // fresh — overlap + successor
    let marketMf: string; // fresh — concurrent race
    let marketMg: string; // fresh — owner audit / no-direct-write
    let marketMh: string; // fresh — market isolation
    let marketMi: string; // fresh — precision + display
    let marketMj: string; // fresh — blocked (INACTIVE)

    // Exactly-two-letter fresh market codes (the secured owner validates
    // the canonical 2-letter market code; unlike the redemption owner it
    // does not accept long random codes).
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

    const ratesUrl = (marketId: string) =>
      `/api/v1/admin/commission-ops/markets/${marketId}/rates`;

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
          name: `${code} Commission Ops Test Market`,
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
      currencyCode = 'MYR',
      status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
    ): Promise<string> {
      const code = freshMarketCode();
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `Fresh Commission Ops Market ${code}`,
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
            description: `${code} commission ops integration test permission`,
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
          displayName: `Commission Ops Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserIdValue = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? [
        'commission.rate.read',
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
          name: `Commission Ops HTTP Test Role (${roleCode})`,
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
      market: string;
      commissionType: string;
      generation: number;
      rateType: string;
      rateValue: string;
      effectiveFrom: Date;
      createdBy: string;
      effectiveUntil?: Date | null;
      reason?: string | null;
    }): Promise<string> {
      const inserted = await database.db
        .insert(commissionRateVersions)
        .values({
          commissionType: params.commissionType,
          generation: params.generation,
          market: params.market,
          rateType: params.rateType,
          rateValue: params.rateValue,
          effectiveFrom: params.effectiveFrom,
          effectiveUntil: params.effectiveUntil ?? null,
          createdBy: params.createdBy,
          reason: params.reason ?? null,
        })
        .returning({ id: commissionRateVersions.id });
      return inserted[0]?.id ?? '';
    }

    /** Build the create payload for the adapter surface. */
    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        commission_type: 'AGENT_UPGRADE',
        generation: 1,
        rate_type: 'FIXED',
        rate_value: '88.0000000000',
        effective_date: marketLocalDate(2, 'Asia/Kuala_Lumpur'),
        reason: 'Integration test rate configuration',
        ...overrides,
      };
    }

    async function rateVersionCount(market: string): Promise<number> {
      const rows = await database.db
        .select({ id: commissionRateVersions.id })
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.market, market));
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
      vi.stubEnv('REDIS_URL', 'redis://172.23.0.2:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'admin-commission-ops-pepper-at-least-32-characters',
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
      ops = app.get(AdminCommissionOpsService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketMy = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketMa = await freshMarket();
      marketMb = await freshMarket();
      marketMc = await freshMarket();
      marketMd = await freshMarket();
      marketMe = await freshMarket();
      marketMf = await freshMarket();
      marketMg = await freshMarket();
      marketMh = await freshMarket();
      marketMi = await freshMarket();
      marketMj = await freshMarket('Asia/Kuala_Lumpur', 'MYR', 'INACTIVE');
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

    it('GET rates: Malaysia projects the frozen taxonomy + legacy seed history', async () => {
      const admin = await createAdmin({ marketIds: [marketMy] });
      await setCurrentMarket(admin.accountId, marketMy);
      const response = await supertest(server)
        .get(ratesUrl(marketMy))
        .set(authorized(admin.token))
        .expect(200);
      expect(response.body.market_id).toBe(marketMy);
      expect(response.body.market_code).toBe('MY');
      expect(response.body.timezone).toBe('Asia/Kuala_Lumpur');
      expect(response.body.currency).toBe('MYR');
      expect(response.body.configured).toBe(true);
      // Frozen taxonomy (UI display only — the owner enforces).
      expect(response.body.taxonomy).toHaveLength(4);
      expect(
        response.body.taxonomy.find(
          (entry: { commission_type: string }) =>
            entry.commission_type === 'AGENT_UPGRADE',
        ),
      ).toMatchObject({ rate_type: 'FIXED', generations: [1, 2] });
      // Legacy seed rows are projected with exact rates and the owner's
      // half-open windows: AGENT_UPGRADE G1 = 88.00 FIXED is current.
      const upgradeG1 = response.body.definitions.find(
        (entry: { commission_type: string; generation: number }) =>
          entry.commission_type === 'AGENT_UPGRADE' && entry.generation === 1,
      );
      expect(upgradeG1.current.rate_value).toBe('88.0000000000');
      expect(upgradeG1.current.rate_type).toBe('FIXED');
      expect(upgradeG1.current.display_rate).toBe('88');
      expect(upgradeG1.current.window_status).toBe('ACTIVE');
      // Legacy rows keep NULL reason (never backfilled with invented text).
      expect(upgradeG1.current.reason).toBeNull();
      // The pre-P5-R1 legacy MERCHANT_RECRUITMENT G1 seed is projected too
      // (definition-union, never silently dropped).
      const legacyMrG1 = response.body.definitions.find(
        (entry: { commission_type: string; generation: number }) =>
          entry.commission_type === 'MERCHANT_RECRUITMENT' &&
          entry.generation === 1,
      );
      expect(legacyMrG1).toBeTruthy();
      expect(legacyMrG1.history[0].rate_value).toBe('0.0050000000');
      // Malaysia values are exact and untouched (88 / 38 / 0.01 / 0.005 / 388).
      const activationFeeG0 = response.body.definitions.find(
        (entry: { commission_type: string; generation: number }) =>
          entry.commission_type === 'AGENT_ACTIVATION_FEE' &&
          entry.generation === 0,
      );
      expect(activationFeeG0.current.rate_value).toBe('388.0000000000');
    });

    it('GET rates: a fresh market shows the taxonomy with empty definitions', async () => {
      const admin = await createAdmin({ marketIds: [marketMa] });
      await setCurrentMarket(admin.accountId, marketMa);
      const response = await supertest(server)
        .get(ratesUrl(marketMa))
        .set(authorized(admin.token))
        .expect(200);
      expect(response.body.configured).toBe(true);
      // 6 frozen definitions (AGENT_UPGRADE G1/G2, MEMBER_CONSUMPTION G1/G2,
      // MERCHANT_RECRUITMENT G0, AGENT_ACTIVATION_FEE G0).
      expect(response.body.definitions).toHaveLength(6);
      expect(
        response.body.definitions.every(
          (entry: { history: unknown[] }) => entry.history.length === 0,
        ),
      ).toBe(true);
      // No Malaysia values leak into the fresh market (market isolation).
      expect(JSON.stringify(response.body)).not.toContain('88.0000000000');
    });

    it('blocks reads/writes for a non-ACTIVE market at the guard (403, no fallback)', async () => {
      // A market that is not ACTIVE cannot be a Current Admin Market with an
      // active grant: the canonical RbacGuard denies every request with 403
      // MARKET_ACCESS_DENIED (read AND write). The projection-level blocked
      // signal (`configured: false`) is covered by the unit spec for the
      // in-process path — over HTTP the guard is the first boundary, exactly
      // like the D-054 owner contract (revoked grants deny the next request).
      const admin = await createAdmin({ marketIds: [marketMj] });
      await setCurrentMarket(admin.accountId, marketMj);
      const body = await supertest(server)
        .get(ratesUrl(marketMj))
        .set(authorized(admin.token))
        .expect(403);
      expect((body.body as ErrorBody).error.code).toBe('MARKET_ACCESS_DENIED');
      // No Malaysia values leak into the blocked market — never a fallback.
      expect(JSON.stringify(body.body)).not.toContain('88.0000000000');
    });

    it('GET rates: exact decimal strings, local + UTC, window status', async () => {
      const admin = await createAdmin({ marketIds: [marketMi] });
      await setCurrentMarket(admin.accountId, marketMi);
      const dayMs = 24 * 60 * 60 * 1000;
      const v1End = new Date(Date.now() - 15 * dayMs);
      const v1Start = new Date(Date.now() - 45 * dayMs);
      const v2Start = new Date(Date.now() - 15 * dayMs);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMi))
        .limit(1);
      const code = market[0]?.code ?? '';
      const v1 = await seedRateVersion({
        market: code,
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 1,
        rateType: 'PERCENTAGE',
        rateValue: '1.1234567890',
        effectiveFrom: v1Start,
        effectiveUntil: v1End,
        createdBy: admin.adminUserId,
      });
      const v2 = await seedRateVersion({
        market: code,
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 1,
        rateType: 'PERCENTAGE',
        rateValue: '2.0000000000',
        effectiveFrom: v2Start,
        createdBy: admin.adminUserId,
      });
      const response = await supertest(server)
        .get(ratesUrl(marketMi))
        .set(authorized(admin.token))
        .expect(200);

      const definition = response.body.definitions.find(
        (entry: { commission_type: string; generation: number }) =>
          entry.commission_type === 'MEMBER_CONSUMPTION' &&
          entry.generation === 1,
      );
      const byId = new Map(
        (definition.history as Array<Record<string, unknown>>).map((rate) => [
          rate.id,
          rate,
        ]),
      );
      const rateV1 = byId.get(v1) as Record<string, unknown>;
      const rateV2 = byId.get(v2) as Record<string, unknown>;
      // v1's explicit window ended in the past → EXPIRED, full precision kept.
      expect(rateV1.rate_value).toBe('1.1234567890');
      expect(rateV1.display_rate).toBe('1.123457');
      expect(rateV1.window_status).toBe('EXPIRED');
      expect(rateV1.effective_until_utc).toBe(v1End.toISOString());
      // v2 is current (owner resolution: latest start ≤ now wins).
      expect(rateV2.window_status).toBe('ACTIVE');
      expect(definition.current.id).toBe(v2);
      expect(definition.current.rate_value).toBe('2.0000000000');
      expect(definition.current.effective_from_local).toBe(
        localWallFor(v2Start, 'Asia/Kuala_Lumpur'),
      );
      expect(definition.current.effective_from_utc).toBe(v2Start.toISOString());
    });

    function localWallFor(at: Date, timeZone: string): string {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(at);
      const map = new Map(parts.map((part) => [part.type, part.value]));
      return `${map.get('year')}-${map.get('month')}-${map.get('day')} ${map.get('hour')}:${map.get('minute')}:${map.get('second')}`;
    }

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

    it('denies reads without the commission.rate.read permission (403)', async () => {
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

    it('denies creates without commission.rate.manage (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMa],
        permissionCodes: ['commission.rate.read'],
      });
      await setCurrentMarket(admin.accountId, marketMa);
      const body = await supertest(server)
        .post(ratesUrl(marketMa))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload())
        .expect(403);
      expect((body.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('enforces the selected-market contract (no grant / wrong market)', async () => {
      const admin = await createAdmin({ marketIds: [marketMa] });
      await setCurrentMarket(admin.accountId, marketMa);
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
        .get(ratesUrl(marketMy))
        .set(authorized(noMarket.token))
        .expect(409)
        .expect((res) => {
          expect((res.body as ErrorBody).error.code).toBe(
            'MARKET_SELECTION_REQUIRED',
          );
        });
    });

    it('requires an Idempotency-Key and a reason on the write (400)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMa],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMa);

      const noKey = await supertest(server)
        .post(ratesUrl(marketMa))
        .set(authorized(admin.token))
        .send(createPayload())
        .expect(400);
      expect((noKey.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
      );

      const noReason = await supertest(server)
        .post(ratesUrl(marketMa))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send({
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          rate_value: '88',
          effective_date: marketLocalDate(2, 'Asia/Kuala_Lumpur'),
        })
        .expect(400);
      expect((noReason.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    // ─── Create surface (secured owner command, D-054) ───────────────

    it('creates through the secured owner: 201, exact rate, taxonomy', async () => {
      const admin = await createAdmin({
        marketIds: [marketMa],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMa);
      const effectiveDate = marketLocalDate(4, 'Asia/Kuala_Lumpur');
      const body = await supertest(server)
        .post(ratesUrl(marketMa))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            rate_value: '388.0000000000',
            effective_date: effectiveDate,
            reason: 'Malaysia upgrade fee baseline',
          }),
        )
        .expect(201);
      const result = body.body as {
        id: string;
        commission_type: string;
        generation: number;
        rate_type: string;
        rate_value: string;
        display_rate: string;
        effective_date: string;
        effective_from_utc: string;
        effective_from_local: string;
        timezone: string;
        market_id: string;
        created_by: string;
      };
      expect(result.commission_type).toBe('AGENT_UPGRADE');
      expect(result.generation).toBe(1);
      expect(result.rate_type).toBe('FIXED');
      expect(result.rate_value).toBe('388.0000000000');
      expect(result.display_rate).toBe('388');
      expect(result.effective_date).toBe(effectiveDate);
      expect(result.timezone).toBe('Asia/Kuala_Lumpur');
      expect(result.market_id).toBe(marketMa);
      expect(result.created_by).toBe(admin.adminUserId);
      // Asia/Kuala_Lumpur is UTC+8: local 00:00 == previous day 16:00 UTC.
      const expectedUtc = new Date(
        Date.parse(`${effectiveDate}T00:00:00.000Z`) - 8 * 60 * 60 * 1000,
      ).toISOString();
      expect(result.effective_from_utc).toBe(expectedUtc);
      expect(result.effective_from_local).toBe(`${effectiveDate} 00:00:00`);

      // The stored owner row is market-scoped, open-ended, exact decimal.
      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, result.id));
      expect(rows[0]?.market).toBe(
        (
          await database.db
            .select({ code: markets.code })
            .from(markets)
            .where(eq(markets.id, marketMa))
            .limit(1)
        )[0]?.code,
      );
      expect(rows[0]?.effectiveUntil).toBeNull();
      expect(String(rows[0]?.rateValue)).toBe('388.0000000000');
      expect(rows[0]?.reason).toBe('Malaysia upgrade fee baseline');

      // The read projection marks it SCHEDULED (future-effective).
      const list = await supertest(server)
        .get(ratesUrl(marketMa))
        .set(authorized(admin.token))
        .expect(200);
      const definition = list.body.definitions.find(
        (entry: { commission_type: string; generation: number }) =>
          entry.commission_type === 'AGENT_UPGRADE' && entry.generation === 1,
      );
      expect(definition.scheduled[0].id).toBe(result.id);
      expect(definition.scheduled[0].window_status).toBe('SCHEDULED');
      expect(definition.current).toBeNull();
    });

    it('writes ONE owner-scoped mechanism row + owner audit (no adapter-side writes)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMg],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMg);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMg))
        .limit(1);
      const code = market[0]?.code ?? '';
      const effectiveDate = marketLocalDate(5, 'Asia/Kuala_Lumpur');
      const reason = 'Approved ops review — Q3 commission rate change';
      const key = `audit-${randomUUID()}`;
      const body = await supertest(server)
        .post(ratesUrl(marketMg))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(
          createPayload({
            commission_type: 'MEMBER_CONSUMPTION',
            generation: 2,
            rate_type: 'PERCENTAGE',
            rate_value: '1.5000000000',
            effective_date: effectiveDate,
            reason,
          }),
        )
        .expect(201);
      const versionId = (body.body as { id: string }).id;

      // The mechanism row is the OWNER's claim (scope
      // commission.rate.owner.create:<marketId>:<adminUserId>), written by
      // the owner inside its transaction — exactly ONE row for the key.
      const idemRows = await database.db
        .select()
        .from(merchantApiIdempotencyKeys)
        .where(eq(merchantApiIdempotencyKeys.key, key));
      expect(idemRows.length).toBe(1);
      expect(idemRows[0]?.scope).toBe(
        `commission.rate.owner.create:${marketMg}:${admin.adminUserId}`,
      );
      expect(idemRows[0]?.statusCode).toBe(201);
      expect((idemRows[0]?.response as { id?: string })?.id).toBe(versionId);
      expect(idemRows[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/u);

      // The immutable audit row is the OWNER's atomic audit
      // (`commission.rate_version.create`) carrying actor, market, reason,
      // correlation and the entity reference. The adapter performs no
      // privileged audit of its own.
      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'commission.rate_version.create'),
            eq(auditLogs.marketId, marketMg),
          ),
        );
      const record = auditRows.find(
        (row) => row.entityId === versionId && row.reason === reason,
      );
      expect(record).toBeTruthy();
      expect(record?.actorId).toBe(admin.adminUserId);
      expect(record?.result).toBe('SUCCESS');
      expect(String(record?.requestId ?? '')).not.toBe('');
      expect(record?.after).toMatchObject({
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 2,
        rateType: 'PERCENTAGE',
        rateValue: '1.5000000000',
      });

      // Exactly ONE version row was created (the owner's insert) and the
      // market has no other rows — no adapter-side direct write exists.
      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(
          and(
            eq(commissionRateVersions.market, code),
            eq(commissionRateVersions.commissionType, 'MEMBER_CONSUMPTION'),
            eq(commissionRateVersions.generation, 2),
          ),
        );
      expect(rows.length).toBe(1);
      expect(rows[0]?.id).toBe(versionId);
    });

    it('replays idempotent creates and rejects key reuse with a different payload', async () => {
      const admin = await createAdmin({
        marketIds: [marketMb],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMb);
      const date = marketLocalDate(6, 'Asia/Kuala_Lumpur');
      const key = `idem-${randomUUID()}`;
      const payload = createPayload({
        rate_value: '88.0000000000',
        effective_date: date,
      });

      const first = await supertest(server)
        .post(ratesUrl(marketMb))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      const firstId = (first.body as { id: string }).id;

      const replay = await supertest(server)
        .post(ratesUrl(marketMb))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      expect((replay.body as { id: string }).id).toBe(firstId);

      const conflict = await supertest(server)
        .post(ratesUrl(marketMb))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(
          createPayload({ rate_value: '38.0000000000', effective_date: date }),
        )
        .expect(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
      );
      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(
          eq(
            commissionRateVersions.market,
            (
              await database.db
                .select({ code: markets.code })
                .from(markets)
                .where(eq(markets.id, marketMb))
                .limit(1)
            )[0]?.code ?? '',
          ),
        );
      expect(rows.length).toBe(1);
    });

    it('rejects frozen-taxonomy violations with 422 (rate type / generation)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMc],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMc);
      const before = await rateVersionCount(
        (
          await database.db
            .select({ code: markets.code })
            .from(markets)
            .where(eq(markets.id, marketMc))
            .limit(1)
        )[0]?.code ?? '',
      );
      const date = marketLocalDate(7, 'Asia/Kuala_Lumpur');

      // AGENT_UPGRADE requires FIXED — PERCENTAGE is a taxonomy mismatch.
      const mismatch = await supertest(server)
        .post(ratesUrl(marketMc))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            rate_type: 'PERCENTAGE',
            rate_value: '1.5',
            effective_date: date,
          }),
        )
        .expect(422);
      expect((mismatch.body as ErrorBody).error.code).toBe(
        'RATE_TYPE_MISMATCH',
      );

      // AGENT_UPGRADE allows only G1/G2 — G0 is an invalid generation.
      const generation = await supertest(server)
        .post(ratesUrl(marketMc))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            generation: 0,
            rate_value: '88',
            effective_date: date,
          }),
        )
        .expect(422);
      expect((generation.body as ErrorBody).error.code).toBe(
        'INVALID_GENERATION',
      );

      // No version was created by any of the rejected calls.
      expect(
        await rateVersionCount(
          (
            await database.db
              .select({ code: markets.code })
              .from(markets)
              .where(eq(markets.id, marketMc))
              .limit(1)
          )[0]?.code ?? '',
        ),
      ).toBe(before);
    });

    it('rejects percentage above 100 and negative / over-precision rates (422/400)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMc],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMc);
      const date = marketLocalDate(8, 'Asia/Kuala_Lumpur');

      const aboveCap = await supertest(server)
        .post(ratesUrl(marketMc))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            commission_type: 'MEMBER_CONSUMPTION',
            generation: 1,
            rate_type: 'PERCENTAGE',
            rate_value: '150',
            effective_date: date,
          }),
        )
        .expect(422);
      expect((aboveCap.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_PERCENTAGE_LIMIT',
      );

      // Negative rates violate the frozen grammar (transport 400).
      const negative = await supertest(server)
        .post(ratesUrl(marketMc))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            rate_value: '-88',
            effective_date: date,
          }),
        )
        .expect(400);
      expect((negative.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');

      // Eleven input decimals exceed the technical ceiling (transport 400).
      await supertest(server)
        .post(ratesUrl(marketMc))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            commission_type: 'MEMBER_CONSUMPTION',
            generation: 1,
            rate_type: 'PERCENTAGE',
            rate_value: '1.12345678901',
            effective_date: date,
          }),
        )
        .expect(400);
    });

    it('accepts the full ten-decimal technical precision; display is ≤6 and display-only', async () => {
      const admin = await createAdmin({
        marketIds: [marketMi],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMi);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMi))
        .limit(1);
      const code = market[0]?.code ?? '';
      const date = marketLocalDate(9, 'Asia/Kuala_Lumpur');
      const body = await supertest(server)
        .post(ratesUrl(marketMi))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            commission_type: 'MEMBER_CONSUMPTION',
            generation: 1,
            rate_type: 'PERCENTAGE',
            rate_value: '1.1234567890',
            effective_date: date,
          }),
        )
        .expect(201);
      const result = body.body as {
        id: string;
        rate_value: string;
        display_rate: string;
      };
      expect(result.rate_value).toBe('1.1234567890');
      expect(result.display_rate).toBe('1.123457');

      // Stored row keeps the exact ten-decimal value (never rounded).
      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, result.id));
      expect(String(rows[0]?.rateValue)).toBe('1.1234567890');
      expect(rows[0]?.reason).toBe('Integration test rate configuration');

      // The read projection repeats the same full precision + display value.
      const list = await supertest(server)
        .get(ratesUrl(marketMi))
        .set(authorized(admin.token))
        .expect(200);
      const definition = list.body.definitions.find(
        (entry: { commission_type: string; generation: number }) =>
          entry.commission_type === 'MEMBER_CONSUMPTION' &&
          entry.generation === 1,
      );
      const listed = definition.scheduled.find(
        (rate: { id: string }) => rate.id === result.id,
      );
      expect(listed.rate_value).toBe('1.1234567890');
      expect(listed.display_rate).toBe('1.123457');
    });

    it('rejects same-day and backdated activation (422)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMd],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMd);
      const today = marketLocalDate(0, 'Asia/Kuala_Lumpur');
      const sameDay = await supertest(server)
        .post(ratesUrl(marketMd))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ effective_date: today }))
        .expect(422);
      expect((sameDay.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      );
      const backdated = await supertest(server)
        .post(ratesUrl(marketMd))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ effective_date: '2020-01-01' }))
        .expect(422);
      expect((backdated.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects overlapping starts but allows a legal future successor (D-054 §9)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMe],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMe);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMe))
        .limit(1);
      const code = market[0]?.code ?? '';
      const date1 = marketLocalDate(2, 'Asia/Kuala_Lumpur');
      const date2 = marketLocalDate(3, 'Asia/Kuala_Lumpur');

      const first = await supertest(server)
        .post(ratesUrl(marketMe))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '88', effective_date: date1 }))
        .expect(201);
      const firstId = (first.body as { id: string }).id;

      // Same start date → overlap (409).
      const sameDate = await supertest(server)
        .post(ratesUrl(marketMe))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '89', effective_date: date1 }))
        .expect(409);
      expect((sameDate.body as ErrorBody).error.code).toBe(
        'OVERLAPPING_RATE_PERIOD',
      );

      // A strictly LATER start date is a legal future successor under the
      // D-054 owner (append-only half-open windows).
      const successor = await supertest(server)
        .post(ratesUrl(marketMe))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '388', effective_date: date2 }))
        .expect(201);
      const successorId = (successor.body as { id: string }).id;
      expect(successorId).not.toBe(firstId);

      // Historical immutability: V1's stored rate never changed and the
      // read projection marks it SUPERSEDED by the successor.
      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, firstId));
      expect(String(rows[0]?.rateValue)).toBe('88.0000000000');
      const list = await supertest(server)
        .get(ratesUrl(marketMe))
        .set(authorized(admin.token))
        .expect(200);
      const definition = list.body.definitions.find(
        (entry: { commission_type: string; generation: number }) =>
          entry.commission_type === 'AGENT_UPGRADE' && entry.generation === 1,
      );
      const byId = new Map(
        (definition.history as Array<Record<string, unknown>>).map((rate) => [
          rate.id,
          rate.window_status,
        ]),
      );
      expect(byId.get(firstId)).toBe('SUPERSEDED');
      expect(byId.get(successorId)).toBe('SCHEDULED');
      expect(definition.current).toBeNull();
      expect(await rateVersionCount(code)).toBe(2);
    });

    it('concurrent overlapping creates resolve to exactly one 201 + one 409', async () => {
      const admin = await createAdmin({
        marketIds: [marketMf],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMf);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMf))
        .limit(1);
      const code = market[0]?.code ?? '';
      const date = marketLocalDate(10, 'Asia/Kuala_Lumpur');
      const before = await rateVersionCount(code);
      const [left, right] = await Promise.all([
        supertest(server)
          .post(ratesUrl(marketMf))
          .set(authorized(admin.token))
          .set('Idempotency-Key', `race-${randomUUID()}`)
          .send(createPayload({ rate_value: '88', effective_date: date })),
        supertest(server)
          .post(ratesUrl(marketMf))
          .set(authorized(admin.token))
          .set('Idempotency-Key', `race-${randomUUID()}`)
          .send(createPayload({ rate_value: '89', effective_date: date })),
      ]);
      const statuses = [left.status, right.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = left.status === 409 ? left : right;
      expect((conflict.body as ErrorBody).error.code).toBe(
        'OVERLAPPING_RATE_PERIOD',
      );
      // Exactly one new row was created.
      expect(await rateVersionCount(code)).toBe(before + 1);
    });

    it('isolates markets: a version never leaks to another market', async () => {
      const admin = await createAdmin({
        marketIds: [marketMh, marketMa],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMh);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMh))
        .limit(1);
      const code = market[0]?.code ?? '';
      const date = marketLocalDate(11, 'Asia/Kuala_Lumpur');
      const body = await supertest(server)
        .post(ratesUrl(marketMh))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '388', effective_date: date }))
        .expect(201);
      const versionId = (body.body as { id: string }).id;

      // The server Current Admin Market is marketMa — the URL market Mh no
      // longer matches → 409 at the guard (and the owner re-checks).
      await setCurrentMarket(admin.accountId, marketMa);
      const cross = await supertest(server)
        .post(ratesUrl(marketMh))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate_value: '388', effective_date: date }))
        .expect(409);
      expect((cross.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, versionId));
      expect(rows[0]?.market).toBe(code);
    });

    it('blocks rate creation for a non-ACTIVE market (guard 403; no side effects)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMj],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMj);
      const body = await supertest(server)
        .post(ratesUrl(marketMj))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload())
        .expect(403);
      expect((body.body as ErrorBody).error.code).toBe('MARKET_ACCESS_DENIED');
      // No version row, no owner mechanism claim and no audit record.
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMj))
        .limit(1);
      expect(await rateVersionCount(market[0]?.code ?? '')).toBe(0);
      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'commission.rate_version.create'),
            eq(auditLogs.marketId, marketMj),
          ),
        );
      expect(auditRows.length).toBe(0);
    });

    it('surfaces the owner 422-class MARKET_NOT_FOUND in-process for a blocked market', async () => {
      // The HTTP guard denies non-ACTIVE markets with 403 first (the owner
      // contract: selected market + active market grant). In-process — the
      // same path a future adapter call site would take — the owner's
      // COMMISSION_RATE_MARKET_NOT_FOUND maps to the external 422-class
      // code on this surface (D-054 §5: owner enforces ACTIVE markets).
      const admin = await createAdmin({
        marketIds: [marketMj],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketMj);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMj))
        .limit(1);
      const code = market[0]?.code ?? '';
      const actor: AdminCommissionOpsActor = {
        adminUserId: admin.adminUserId,
        currentMarketId: marketMj,
        requestId: 'req-inproc',
        ipAddress: '127.0.0.1',
      };
      await expect(
        ops.createRate(
          actor,
          marketMj,
          {
            commission_type: 'AGENT_UPGRADE',
            generation: 1,
            rate_type: 'FIXED',
            rate_value: '88',
            effective_date: marketLocalDate(3, 'Asia/Kuala_Lumpur'),
            reason: 'in-process blocked evidence',
          },
          `inproc-${randomUUID()}`,
        ),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_MARKET_NOT_FOUND' });
      expect(await rateVersionCount(code)).toBe(0);
    });

    it('exposes no edit/delete routes (immutable append-only versions)', async () => {
      const admin = await createAdmin({
        marketIds: [marketMy],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
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
        .patch(`/api/v1/admin/commission-rates/${id}`)
        .set(authorized(admin.token))
        .expect(404);
    });

    it('protects versions at the database level (reject update/delete)', async () => {
      const admin = await createAdmin({ marketIds: [marketMa] });
      await setCurrentMarket(admin.accountId, marketMa);
      const market = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketMa))
        .limit(1);
      const code = market[0]?.code ?? '';
      const versionId = await seedRateVersion({
        market: code,
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        rateType: 'FIXED',
        rateValue: '88.0000000000',
        effectiveFrom: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdBy: admin.adminUserId,
      });

      // Direct UPDATE / DELETE are rejected by the owner's append-only
      // triggers (migration 0032) — even a well-intentioned caller cannot
      // mutate history.
      await expect(
        database.db.execute(
          sql`UPDATE commission_rate_version SET rate_value = '9.0000000000' WHERE id = ${versionId}`,
        ),
      ).rejects.toThrow();
      await expect(
        database.db.execute(
          sql`DELETE FROM commission_rate_version WHERE id = ${versionId}`,
        ),
      ).rejects.toThrow();

      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, versionId));
      expect(String(rows[0]?.rateValue)).toBe('88.0000000000');
    });

    it('keeps the Malaysia legacy rows byte-identical after creates elsewhere', async () => {
      // Historical immutability: the migration-seeded MY rows (0018/0029)
      // are never touched by any S6D surface activity.
      const rows = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.market, 'MY'))
        .orderBy(commissionRateVersions.commissionType);
      const values = rows.map((row) => String(row.rateValue)).sort();
      expect(values).toEqual([
        '0.0050000000',
        '0.0050000000',
        '0.0050000000',
        '0.0100000000',
        '38.0000000000',
        '388.0000000000',
        '88.0000000000',
      ]);
      expect(rows.every((row) => row.reason === null)).toBe(true);
    });
  },
);
