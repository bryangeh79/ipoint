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
  marketAccess,
  markets,
  merchantApiIdempotencyKeys,
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
import { totpCode } from '../auth/admin-mfa.crypto.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Reward-Ops-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 fixture value.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
    }
  }
  return Buffer.from(output);
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
  'Admin Reward Operations HTTP integration (P7-S6B)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR, Asia/Kuala_Lumpur
    let marketB: string; // code MB, SGD, Asia/Singapore
    let mfaSecret: Buffer;

    const rulesUrl = (marketId: string) =>
      `/api/v1/admin/reward-ops/markets/${marketId}/rules`;

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
          name: `${code} Reward Ops Test Market`,
          status: 'ACTIVE',
          currencyCode,
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      return inserted[0]?.id ?? '';
    }

    /** A brand-new active market (no reward schedule rows yet). */
    async function freshMarket(
      timezone = 'Asia/Kuala_Lumpur',
    ): Promise<string> {
      const code = `M${randomUUID().slice(0, 6).toUpperCase()}`;
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `Fresh Reward Ops Market ${code}`,
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
            description: `${code} reward ops integration test permission`,
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
          displayName: `Reward Ops Admin ${randomUUID()}`,
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
          name: `Reward Ops HTTP Test Role (${roleCode})`,
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

    /** Direct row seed of a market-scoped rule version (owner-style rows). */
    async function seedRuleVersion(params: {
      marketId: string;
      name: string;
      rewardRate: string;
      effectiveFrom: Date;
      createdBy: string;
      effectiveTo?: Date | null;
      archivedAt?: Date | null;
    }): Promise<string> {
      const inserted = await database.db
        .insert(rewardRuleVersions)
        .values({
          name: params.name,
          description: null,
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

    /** Build the create payload for the adapter surface. */
    function createPayload(overrides: Record<string, unknown> = {}) {
      return {
        package_reference: 'C',
        rate: '0.05',
        effective_date: marketLocalDate(2, 'Asia/Kuala_Lumpur'),
        reason: 'Integration test rate schedule',
        ...overrides,
      };
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
        'admin-reward-ops-pepper-at-least-32-characters',
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

    it('GET rules: empty schedule with the §7.1 package references', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({ marketIds: [market] });
      await setCurrentMarket(admin.accountId, market);
      const response = await supertest(server)
        .get(rulesUrl(market))
        .set(authorized(admin.token))
        .expect(200);
      expect(response.body.marketId).toBe(market);
      expect(response.body.timezone).toBe('Asia/Kuala_Lumpur');
      expect(response.body.packages).toEqual([
        { code: 'A', max_rate_per_day: '0.0125' },
        { code: 'B', max_rate_per_day: '0.025' },
        { code: 'C', max_rate_per_day: '0.05' },
        { code: 'D', max_rate_per_day: '0.05' },
        { code: 'E', max_rate_per_day: '0.05' },
        { code: 'F', max_rate_per_day: '0.05' },
      ]);
      expect(response.body.rules).toEqual([]);
    });

    it('GET rules: exact decimal strings, local + UTC, window status', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({ marketIds: [market] });
      await setCurrentMarket(admin.accountId, market);
      const start = new Date('2026-01-01T00:00:00.000Z');
      const later = new Date('2026-06-01T00:00:00.000Z');
      const v1 = await seedRuleVersion({
        marketId: market,
        name: 'Package A Reward Rate',
        rewardRate: '0.0125',
        effectiveFrom: start,
        createdBy: admin.adminUserId,
      });
      const v2 = await seedRuleVersion({
        marketId: market,
        name: 'Package B Reward Rate',
        rewardRate: '0.025',
        effectiveFrom: later,
        createdBy: admin.adminUserId,
      });
      const response = await supertest(server)
        .get(rulesUrl(market))
        .set(authorized(admin.token))
        .expect(200);

      const byId = new Map(
        (response.body.rules as Array<Record<string, unknown>>).map((rule) => [
          rule.id,
          rule,
        ]),
      );
      expect(byId.size).toBe(2);
      const ruleV1 = byId.get(v1) as Record<string, unknown>;
      const ruleV2 = byId.get(v2) as Record<string, unknown>;
      expect(ruleV1.reward_rate).toBe('0.0125');
      expect(ruleV1.package_reference).toBe('A');
      expect(ruleV1.effective_from_utc).toBe('2026-01-01T00:00:00.000Z');
      expect(ruleV1.effective_from_local).toBe('2026-01-01 08:00:00');
      // Chain: V1's window ends when V2 starts.
      expect(ruleV1.effective_until_utc).toBe('2026-06-01T00:00:00.000Z');
      expect(ruleV1.window_status).toBe('SUPERSEDED');
      expect(ruleV2.reward_rate).toBe('0.025');
      expect(ruleV2.package_reference).toBe('B');
      expect(ruleV2.window_status).toBe('ACTIVE');
      expect(ruleV2.effective_until_utc).toBeNull();
    });

    it('rejects unauthenticated and unauthorized reads (403)', async () => {
      await supertest(server).get(rulesUrl(marketA)).expect(401);
      const member = await createAccount();
      const token = (await auth.login(member.email, password)).accessToken;
      await supertest(server)
        .get(rulesUrl(marketA))
        .set(authorized(token))
        .expect(403);
    });

    it('denies reads without the reward.rule.read permission (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['dashboard.view'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      await supertest(server)
        .get(rulesUrl(marketA))
        .set(authorized(admin.token))
        .expect(403);
    });

    it('denies scheduling without reward.rule.schedule (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['reward.rule.read'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await supertest(server)
        .post(rulesUrl(marketA))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload())
        .expect(403);
      expect((body.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('enforces the selected-market contract (no grant / wrong market)', async () => {
      // Admin with a grant only to marketB: marketA must be unreachable.
      const admin = await createAdmin({ marketIds: [marketB] });
      await setCurrentMarket(admin.accountId, marketB);
      await supertest(server)
        .get(rulesUrl(marketA))
        .set(authorized(admin.token))
        .expect(409)
        .expect((res) => {
          expect((res.body as ErrorBody).error.code).toBe(
            'MARKET_CONTEXT_MISMATCH',
          );
        });

      // Admin with NO market selection at all: 409 MARKET_SELECTION_REQUIRED.
      const noMarket = await createAdmin({ marketIds: [] });
      await supertest(server)
        .get(rulesUrl(marketB))
        .set(authorized(noMarket.token))
        .expect(409)
        .expect((res) => {
          expect((res.body as ErrorBody).error.code).toBe(
            'MARKET_SELECTION_REQUIRED',
          );
        });

      // Admin with a grant to marketA but current market = marketB and a
      // marketA URL: the guard's resource-market consistency rejects.
      const dual = await createAdmin({ marketIds: [marketA, marketB] });
      await setCurrentMarket(dual.accountId, marketB);
      await supertest(server)
        .get(rulesUrl(marketA))
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
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .send(createPayload())
        .expect(400);
      expect((body.body as ErrorBody).error.code).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    });

    it('schedules at the future market-local 00:00 and returns local + UTC', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const effectiveDate = marketLocalDate(3, 'Asia/Kuala_Lumpur');
      const body = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            package_reference: 'A',
            rate: '0.0125',
            effective_date: effectiveDate,
            reason: 'A-package ceiling schedule',
          }),
        )
        .expect(201);
      const result = body.body as {
        id: string;
        package_reference: string;
        reward_rate: string;
        effective_date: string;
        effective_from_utc: string;
        effective_from_local: string;
        timezone: string;
        market_id: string;
      };
      expect(result.package_reference).toBe('A');
      expect(result.reward_rate).toBe('0.0125');
      expect(result.effective_date).toBe(effectiveDate);
      expect(result.timezone).toBe('Asia/Kuala_Lumpur');
      expect(result.market_id).toBe(market);
      // Asia/Kuala_Lumpur is UTC+8: local 00:00 == previous day 16:00 UTC.
      const expectedUtc = new Date(
        Date.parse(`${effectiveDate}T00:00:00.000Z`) - 8 * 60 * 60 * 1000,
      ).toISOString();
      expect(result.effective_from_utc).toBe(expectedUtc);
      expect(result.effective_from_local).toBe(`${effectiveDate} 00:00:00`);
      // The stored owner row is market-scoped and open-ended.
      const rows = await database.db
        .select()
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.id, result.id));
      expect(rows[0]?.marketId).toBe(market);
      expect(rows[0]?.effectiveTo).toBeNull();
      expect(rows[0]?.rewardRate).toBe('0.0125000000');
    });

    it('accepts the §7.1 range boundaries: 0, 0.05, 0.000001', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date1 = marketLocalDate(4, 'Asia/Kuala_Lumpur');
      const date2 = marketLocalDate(5, 'Asia/Kuala_Lumpur');
      const date3 = marketLocalDate(6, 'Asia/Kuala_Lumpur');
      const zero = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0', effective_date: date1 }))
        .expect(201);
      expect((zero.body as { reward_rate: string }).reward_rate).toBe('0');
      const ceiling = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.05', effective_date: date2 }))
        .expect(201);
      expect((ceiling.body as { reward_rate: string }).reward_rate).toBe(
        '0.05',
      );
      const six = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.000001', effective_date: date3 }))
        .expect(201);
      expect((six.body as { reward_rate: string }).reward_rate).toBe(
        '0.000001',
      );
    });

    it('rejects the §7.1 violations: >0.05, seven decimals, package maxima', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date = marketLocalDate(7, 'Asia/Kuala_Lumpur');

      // Above the 0.05%/day governance ceiling → clear governance error.
      const above = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.050001', effective_date: date }))
        .expect(422);
      expect((above.body as ErrorBody).error.code).toBe(
        'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
      );

      // Seven input decimals → transport rejection (400).
      await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.0000001', effective_date: date }))
        .expect(400);

      // Package A maximum is 0.0125: 0.0126 is rejected, 0.0125 accepted.
      const aOver = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            package_reference: 'A',
            rate: '0.0126',
            effective_date: date,
          }),
        )
        .expect(422);
      expect((aOver.body as ErrorBody).error.code).toBe(
        'REWARD_RATE_EXCEEDS_PACKAGE_MAX',
      );

      // Package B maximum is 0.025: 0.0251 is rejected.
      const bOver = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(
          createPayload({
            package_reference: 'B',
            rate: '0.0251',
            effective_date: date,
          }),
        )
        .expect(422);
      expect((bOver.body as ErrorBody).error.code).toBe(
        'REWARD_RATE_EXCEEDS_PACKAGE_MAX',
      );
    });

    it('rejects same-day and backdated activation (422)', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const today = marketLocalDate(0, 'Asia/Kuala_Lumpur');
      const sameDay = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ effective_date: today }))
        .expect(422);
      expect((sameDay.body as ErrorBody).error.code).toBe(
        'REWARD_ACTIVATION_NOT_FUTURE',
      );
      const backdated = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ effective_date: '2020-01-01' }))
        .expect(422);
      expect((backdated.body as ErrorBody).error.code).toBe(
        'REWARD_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects effective-window overlap and allows later chain starts', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date1 = marketLocalDate(2, 'Asia/Kuala_Lumpur');
      const date2 = marketLocalDate(3, 'Asia/Kuala_Lumpur');

      const first = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.02', effective_date: date1 }))
        .expect(201);
      const firstId = (first.body as { id: string }).id;

      // Same start date → overlap.
      const overlap = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.03', effective_date: date1 }))
        .expect(409);
      expect((overlap.body as ErrorBody).error.code).toBe(
        'REWARD_EFFECTIVE_WINDOW_OVERLAP',
      );

      // A later start is a valid chain step.
      const second = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.03', effective_date: date2 }))
        .expect(201);
      const secondId = (second.body as { id: string }).id;

      // The list projection shows the chain: V1 superseded, V2 scheduled.
      const list = await supertest(server)
        .get(rulesUrl(market))
        .set(authorized(admin.token))
        .expect(200);
      const byId = new Map(
        (list.body.rules as Array<Record<string, unknown>>).map((rule) => [
          rule.id,
          rule,
        ]),
      );
      expect((byId.get(firstId) as Record<string, unknown>).window_status).toBe(
        'SUPERSEDED',
      );
      expect(
        (byId.get(secondId) as Record<string, unknown>).window_status,
      ).toBe('SCHEDULED');
      // Historical immutability: V1's stored rate never changed.
      const rows = await database.db
        .select()
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.id, firstId));
      expect(rows[0]?.rewardRate).toBe('0.0200000000');
    });

    it('concurrent overlapping creates resolve to exactly one 201 + one 409', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date = marketLocalDate(2, 'Asia/Kuala_Lumpur');
      const [left, right] = await Promise.all([
        supertest(server)
          .post(rulesUrl(market))
          .set(authorized(admin.token))
          .set('Idempotency-Key', `race-${randomUUID()}`)
          .send(createPayload({ rate: '0.04', effective_date: date })),
        supertest(server)
          .post(rulesUrl(market))
          .set(authorized(admin.token))
          .set('Idempotency-Key', `race-${randomUUID()}`)
          .send(createPayload({ rate: '0.041', effective_date: date })),
      ]);
      const statuses = [left.status, right.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = left.status === 409 ? left : right;
      expect((conflict.body as ErrorBody).error.code).toBe(
        'REWARD_EFFECTIVE_WINDOW_OVERLAP',
      );
      // Exactly one row was created.
      const count = await database.db
        .select({ id: rewardRuleVersions.id })
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.marketId, market));
      const totalAfterRace = count.length;
      expect(totalAfterRace).toBeGreaterThan(0);
    });

    it('replays idempotent creates and rejects key reuse with a different payload', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date = marketLocalDate(3, 'Asia/Kuala_Lumpur');
      const key = `idem-${randomUUID()}`;
      const payload = createPayload({ rate: '0.025', effective_date: date });

      const first = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      const firstId = (first.body as { id: string }).id;

      // Same key + same payload → original result replay (same version id).
      const replay = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      expect((replay.body as { id: string }).id).toBe(firstId);

      // Same key + different payload → 409 conflict.
      const conflict = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(createPayload({ rate: '0.03', effective_date: date }))
        .expect(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'REWARD_IDEMPOTENCY_CONFLICT',
      );
    });

    it('writes the privileged audit trail with reason + actor', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date = marketLocalDate(4, 'Asia/Kuala_Lumpur');
      const reason = 'Approved ops review — Q3 rate change';
      const key = `audit-${randomUUID()}`;
      const body = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', key)
        .send(createPayload({ rate: '0.01', effective_date: date, reason }))
        .expect(201);
      const versionId = (body.body as { id: string }).id;

      // Adapter audit record: action + mandatory reason + actor + market.
      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'ADMIN_REWARD_RULE_VERSION_CREATED'),
            eq(auditLogs.marketId, market),
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

      // The frozen owner also records its own atomic audit row.
      const ownerRows = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'reward.rule_version.create'));
      expect(ownerRows.some((row) => row.entityId === versionId)).toBe(true);

      // The idempotency mechanism row stores the exact replay payload.
      const idemRows = await database.db
        .select()
        .from(merchantApiIdempotencyKeys)
        .where(eq(merchantApiIdempotencyKeys.key, key));
      expect(idemRows[0]?.statusCode).toBe(201);
      expect((idemRows[0]?.response as { id?: string })?.id).toBe(versionId);
    });

    it('exposes no edit/delete routes (immutable append-only versions)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const id = randomUUID();
      for (const method of ['patch', 'put', 'delete'] as const) {
        await supertest(server)
          [method](`${rulesUrl(marketA)}/${id}`)
          .set(authorized(admin.token))
          .expect(404);
      }
      // The frozen owner surface has no edit/delete routes either.
      await supertest(server)
        .patch(`/api/v1/admin/rewards/rules/${id}`)
        .set(authorized(admin.token))
        .expect(404);
      await supertest(server)
        .delete(`/api/v1/admin/rewards/rules/${id}`)
        .set(authorized(admin.token))
        .expect(404);
    });

    it('does not recalculate historical versions when a later one starts', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, market);
      const date1 = marketLocalDate(5, 'Asia/Kuala_Lumpur');
      const date2 = marketLocalDate(6, 'Asia/Kuala_Lumpur');
      const first = await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.015', effective_date: date1 }))
        .expect(201);
      const firstId = (first.body as { id: string }).id;
      await supertest(server)
        .post(rulesUrl(market))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ rate: '0.05', effective_date: date2 }))
        .expect(201);
      const rows = await database.db
        .select()
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.id, firstId));
      expect(rows[0]?.rewardRate).toBe('0.0150000000');
      // The stored effective_from is the market-local 00:00 resolved to UTC.
      expect(rows[0]?.effectiveFrom.toISOString()).toBe(
        new Date(
          Date.parse(`${date1}T00:00:00.000Z`) - 8 * 60 * 60 * 1000,
        ).toISOString(),
      );
      // Owner row count stays exactly 2 for this market (append-only).
      const count = await database.db
        .select({ id: rewardRuleVersions.id })
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.marketId, market));
      expect(count.length).toBeGreaterThanOrEqual(2);
    });

    it('projects legacy closed windows (explicit effective_to) like the settlement', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({ marketIds: [market] });
      await setCurrentMarket(admin.accountId, market);
      // Chain with explicit windows: v1 [01-01, 03-01), v2 [02-01, 04-01),
      // v3 [03-01, open). The frozen resolution (latest effective_from
      // inside the window wins) closes v1 at 02-01 (v2 starts earlier than
      // its explicit end) and v2 at 03-01 (v3 starts earlier than its end).
      const v1 = await seedRuleVersion({
        marketId: market,
        name: 'Package C Reward Rate',
        rewardRate: '0.05',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-03-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });
      const v2 = await seedRuleVersion({
        marketId: market,
        name: 'Package D Reward Rate',
        rewardRate: '0.05',
        effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-04-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });
      const v3 = await seedRuleVersion({
        marketId: market,
        name: 'Package E Reward Rate',
        rewardRate: '0.05',
        effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });
      // A closed legacy window with no later version in ITS market: the
      // settlement no longer resolves it, so the projection must not show
      // it as ACTIVE. Isolated in a fresh market (no chain ambiguity).
      const closedMarket = await freshMarket();
      const closed = await seedRuleVersion({
        marketId: closedMarket,
        name: 'Package F Reward Rate',
        rewardRate: '0.05',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: new Date('2026-02-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });
      const response = await supertest(server)
        .get(rulesUrl(market))
        .set(authorized(admin.token))
        .expect(200);
      const byId = new Map(
        (response.body.rules as Array<Record<string, unknown>>).map((rule) => [
          rule.id,
          rule,
        ]),
      );
      const ruleV1 = byId.get(v1) as Record<string, unknown>;
      const ruleV2 = byId.get(v2) as Record<string, unknown>;
      const ruleV3 = byId.get(v3) as Record<string, unknown>;
      expect(ruleV1.window_status).toBe('SUPERSEDED');
      expect(ruleV1.effective_until_utc).toBe('2026-02-01T00:00:00.000Z');
      expect(ruleV2.window_status).toBe('SUPERSEDED');
      expect(ruleV2.effective_until_utc).toBe('2026-03-01T00:00:00.000Z');
      expect(ruleV3.window_status).toBe('ACTIVE');
      expect(ruleV3.effective_until_utc).toBeNull();
      await database.db
        .insert(marketAccess)
        .values({ adminUserId: admin.adminUserId, marketId: closedMarket });
      await setCurrentMarket(admin.accountId, closedMarket);
      const closedList = await supertest(server)
        .get(rulesUrl(closedMarket))
        .set(authorized(admin.token))
        .expect(200);
      const closedById = new Map(
        (closedList.body.rules as Array<Record<string, unknown>>).map(
          (rule) => [rule.id, rule],
        ),
      );
      const ruleClosed = closedById.get(closed) as Record<string, unknown>;
      expect(ruleClosed.window_status).toBe('EXPIRED');
      expect(ruleClosed.effective_until_utc).toBe('2026-02-01T00:00:00.000Z');
      expect(ruleClosed.effective_from_local).toBe('2026-01-01 08:00:00');
    });

    it('marks archived versions ARCHIVED and excludes them from the chain', async () => {
      const market = await freshMarket();
      const admin = await createAdmin({ marketIds: [market] });
      await setCurrentMarket(admin.accountId, market);
      const archived = await seedRuleVersion({
        marketId: market,
        name: 'Package A Reward Rate',
        rewardRate: '0.0125',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
        archivedAt: new Date('2026-03-01T00:00:00.000Z'),
      });
      const latest = await seedRuleVersion({
        marketId: market,
        name: 'Package B Reward Rate',
        rewardRate: '0.025',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        createdBy: admin.adminUserId,
      });
      const response = await supertest(server)
        .get(rulesUrl(market))
        .set(authorized(admin.token))
        .expect(200);
      const byId = new Map(
        (response.body.rules as Array<Record<string, unknown>>).map((rule) => [
          rule.id,
          rule,
        ]),
      );
      const ruleArchived = byId.get(archived) as Record<string, unknown>;
      const ruleLatest = byId.get(latest) as Record<string, unknown>;
      expect(ruleArchived.window_status).toBe('ARCHIVED');
      expect(ruleArchived.effective_until_utc).toBeNull();
      // The archived row is not part of the chain, so the latest non-archived
      // version has an open window and stays ACTIVE.
      expect(ruleLatest.window_status).toBe('ACTIVE');
      expect(ruleLatest.effective_until_utc).toBeNull();
    });

    it('isolates markets: schedules in marketB never appear in marketA', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['reward.rule.read', 'reward.rule.schedule'],
      });
      await setCurrentMarket(admin.accountId, marketB);
      const date = marketLocalDate(3, 'Asia/Singapore');
      const body = await supertest(server)
        .post(rulesUrl(marketB))
        .set(authorized(admin.token))
        .set('Idempotency-Key', `key-${randomUUID()}`)
        .send(createPayload({ effective_date: date }))
        .expect(201);
      const versionId = (body.body as { id: string }).id;
      await setCurrentMarket(admin.accountId, marketA);
      const list = await supertest(server)
        .get(rulesUrl(marketA))
        .set(authorized(admin.token))
        .expect(200);
      expect(
        (list.body.rules as Array<{ id: string }>).some(
          (rule) => rule.id === versionId,
        ),
      ).toBe(false);
      const rows = await database.db
        .select()
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.id, versionId));
      expect(rows[0]?.marketId).toBe(marketB);
    });
  },
);
