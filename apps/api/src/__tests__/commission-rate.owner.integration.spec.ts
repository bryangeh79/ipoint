/**
 * D-054 — Phase 5 Commission Rate Owner security and versioning
 * (HTTP, real PostgreSQL) — CG-04 gate evidence suite.
 *
 * Models the accepted D-050 (Phase 3 reward rule) and D-053 (Phase 6
 * redemption rate) owner evidence suites. Every matrix from the D-054
 * command §14 runs against a freshly created, migrated and seeded
 * database through the canonical HTTP routes
 * (`POST /api/v1/admin/commission-rates`,
 * `POST /api/v1/admin/commission-rates/schedule`) plus direct in-process
 * owner calls for the bypass proofs.
 *
 * @packageDocumentation
 */

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
  commissionRateVersions,
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
import { RateManagementService } from '../domain/commission/rate.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { CommissionRateAdminActor } from '../domain/commission/rate.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Commission-Rate-Owner-Password-123!';

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
  'Phase 5 Commission Rate Owner D-054 security and versioning (HTTP, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let owner: RateManagementService;
    let auditService: AuditService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR, Asia/Kuala_Lumpur
    let marketB: string; // code MB, SGD, Asia/Singapore

    const ratesUrl = '/api/v1/admin/commission-rates';

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
          name: `${code} D054 Owner Test Market`,
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
      const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code =
          LETTERS[Math.floor(Math.random() * 26)]! +
          LETTERS[Math.floor(Math.random() * 26)]!;
        const existing = await database.db
          .select({ id: markets.id })
          .from(markets)
          .where(eq(markets.code, code))
          .limit(1);
        if (existing[0]) continue;
        try {
          const inserted = await database.db
            .insert(markets)
            .values({
              code,
              name: `Fresh D054 Owner Market ${code}`,
              status: 'ACTIVE',
              currencyCode: 'MYR',
              timezone,
              defaultLocale: 'en-MY',
            })
            .returning({ id: markets.id });
          return inserted[0]?.id ?? '';
        } catch {
          // Random-code collision under parallel runs — retry with a new code.
        }
      }
      throw new Error('freshMarket exhausted retries');
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
            description: `${code} d054 owner integration test permission`,
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
          displayName: `D054 Owner Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

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
          name: `D054 Owner HTTP Test Role (${roleCode})`,
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

    async function revokeMarketGrant(
      adminUserId: string,
      marketId: string,
    ): Promise<void> {
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

    async function marketCodeOf(marketId: string): Promise<string> {
      const rows = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);
      return rows[0]?.code ?? '';
    }

    /** Direct row seed of a legacy-style rate version (no reason). */
    async function seedLegacyRateVersion(params: {
      marketId: string;
      commissionType: string;
      generation: number;
      rateValue: string;
      rateType: string;
      effectiveFrom: Date;
      effectiveUntil?: Date | null;
    }): Promise<string> {
      const marketCode = await marketCodeOf(params.marketId);
      const inserted = await database.db
        .insert(commissionRateVersions)
        .values({
          commissionType: params.commissionType,
          generation: params.generation,
          market: marketCode,
          rateValue: params.rateValue,
          rateType: params.rateType,
          effectiveFrom: params.effectiveFrom,
          effectiveUntil: params.effectiveUntil ?? null,
          createdBy: '00000000-0000-0000-0000-000000000000',
        })
        .returning({ id: commissionRateVersions.id });
      return inserted[0]?.id ?? '';
    }

    /** Build the owner create payload (market code + all contract fields). */
    function ownerPayload(overrides: Record<string, unknown> = {}) {
      return {
        market: 'MA',
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        rateValue: '88.00',
        rateType: 'FIXED',
        effectiveFrom: klMidnightIso(2),
        reason: 'D-054 owner remediation evidence',
        ...overrides,
      };
    }

    function scheduleRate(
      token: string,
      payload: Record<string, unknown>,
      key?: string,
    ) {
      return supertest(server)
        .post(ratesUrl)
        .set(authorized(token))
        .set('Idempotency-Key', key ?? `key-${randomUUID()}`)
        .send(payload);
    }

    /** Server-created actor for direct in-process owner calls. */
    function ownerActor(
      adminUserId: string,
      currentMarketId: string,
    ): CommissionRateAdminActor {
      return {
        adminUserId,
        currentMarketId,
        marketContextVersion: 2,
        requestId: `d054-${randomUUID()}`,
        ipAddress: '127.0.0.1',
      };
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
        'commission-rate-owner-pepper-at-least-32-characters',
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
      owner = app.get(RateManagementService);
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

    // ─── §5 Authorization matrix (11) ────────────────────────────────

    it('rejects unauthenticated creates with 401', async () => {
      await supertest(server).post(ratesUrl).send(ownerPayload()).expect(401);
    });

    it('rejects non-admin (member) actors with 403', async () => {
      const member = await createAccount();
      const token = (await auth.login(member.email, password)).accessToken;
      await scheduleRate(token, ownerPayload()).expect(403);
    });

    it('rejects admins without the commission.rate.manage permission with 403', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['commission.rate.read'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: await marketCodeOf(marketA) }),
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('accepts an authorized admin (SUPER_ADMIN-like actor) with 201', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '88.00' }),
      ).expect(201);
      expect((body.body as { id: string }).id).toBeTruthy();
    });

    it('rejects when no server Current Admin Market is selected (409)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: await marketCodeOf(marketA) }),
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'MARKET_SELECTION_REQUIRED',
      );
    });

    it('rejects when the admin has no grant for the market (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketB],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: await marketCodeOf(marketA) }),
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('MARKET_ACCESS_DENIED');
    });

    it('rejects when the body market differs from the Current Admin Market (409)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: await marketCodeOf(marketB) }),
      ).expect(409);
      // The owner re-checks body-vs-current-market inside the command (the
      // transport guard has no marketId field to compare, so the owner's
      // COMMISSION_RATE_MARKET_CONTEXT_MISMATCH is the enforcement point).
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH',
      );
    });

    it('rejects a revoked market grant on the very next request (403)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const first = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '88.00' }),
      ).expect(201);
      await revokeMarketGrant(admin.adminUserId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '88.00' }),
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('MARKET_ACCESS_DENIED');
      expect((first.body as { id: string }).id).toBeTruthy();
    });

    it('denies an in-process owner call without an authenticated actor', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      await expect(
        owner.createRateVersion({} as CommissionRateAdminActor, {
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          rateValue: '88.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(3),
          reason: 'bypass attempt',
          idempotencyKey: `bp-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_PERMISSION_DENIED' });
    });

    it('denies an in-process owner call without a Current Admin Market', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await expect(
        owner.createRateVersion(
          { adminUserId: admin.adminUserId, requestId: 'bp2' },
          {
            market: code,
            commissionType: 'AGENT_UPGRADE',
            generation: 1,
            rateValue: '88.00',
            rateType: 'FIXED',
            effectiveFrom: klMidnightIso(3),
            reason: 'bypass attempt',
            idempotencyKey: `bp2-${randomUUID()}`,
          },
        ),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_MARKET_SELECTION_REQUIRED',
      });
    });

    it('ignores a caller-supplied createdBy — the server actor is authoritative', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      const attacker = randomUUID();
      const body = await owner.createRateVersion(
        ownerActor(admin.adminUserId, market),
        {
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          rateValue: '88.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(3),
          reason: 'actor immutability evidence',
          idempotencyKey: `act-${randomUUID()}`,
          // Client-supplied actor attempt — the command type has no such
          // field; even if smuggled in, the owner derives createdBy from
          // the server actor only.
          createdBy: attacker,
        } as never,
      );
      expect(body.createdBy).toBe(admin.adminUserId);
      expect(body.createdBy).not.toBe(attacker);
    });

    // ─── §6 Taxonomy matrix (6) ──────────────────────────────────────

    it('accepts AGENT_UPGRADE FIXED G1 and G2 and rejects G0', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const g1 = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          rateValue: '88.00',
          rateType: 'FIXED',
        }),
      ).expect(201);
      expect((g1.body as { generation: number }).generation).toBe(1);
      const g2 = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 2,
          rateValue: '38.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(4),
        }),
      ).expect(201);
      expect((g2.body as { generation: number }).generation).toBe(2);
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 0,
          rateValue: '88.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(5),
        }),
      ).expect(400);
    });

    it('accepts MEMBER_CONSUMPTION PERCENTAGE G1/G2 and rejects G0', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const g1 = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          generation: 1,
          rateValue: '1.00',
          rateType: 'PERCENTAGE',
        }),
      ).expect(201);
      expect((g1.body as { rateType: string }).rateType).toBe('PERCENTAGE');
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          generation: 2,
          rateValue: '0.50',
          rateType: 'PERCENTAGE',
          effectiveFrom: klMidnightIso(4),
        }),
      ).expect(201);
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          generation: 0,
          rateValue: '1.00',
          rateType: 'PERCENTAGE',
          effectiveFrom: klMidnightIso(5),
        }),
      ).expect(400);
    });

    it('accepts MERCHANT_RECRUITMENT PERCENTAGE G0 and rejects G1', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const g0 = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MERCHANT_RECRUITMENT',
          generation: 0,
          rateValue: '0.50',
          rateType: 'PERCENTAGE',
        }),
      ).expect(201);
      expect((g0.body as { generation: number }).generation).toBe(0);
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MERCHANT_RECRUITMENT',
          generation: 1,
          rateValue: '0.50',
          rateType: 'PERCENTAGE',
          effectiveFrom: klMidnightIso(4),
        }),
      ).expect(400);
    });

    it('accepts AGENT_ACTIVATION_FEE FIXED G0 and rejects G1', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const fee = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_ACTIVATION_FEE',
          generation: 0,
          rateValue: '388.00',
          rateType: 'FIXED',
        }),
      ).expect(201);
      expect((fee.body as { commissionType: string }).commissionType).toBe(
        'AGENT_ACTIVATION_FEE',
      );
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_ACTIVATION_FEE',
          generation: 1,
          rateValue: '388.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(4),
        }),
      ).expect(400);
    });

    it('rejects a rate_type that mismatches the commission type (AGENT_UPGRADE + PERCENTAGE)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_UPGRADE',
          rateType: 'PERCENTAGE',
        }),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('RATE_TYPE_MISMATCH');
    });

    it('rejects an invalid commission type (400 transport / 400 in-process)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, commissionType: 'BOGUS_TYPE' }),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      await expect(
        owner.createRateVersion(ownerActor(admin.adminUserId, market), {
          market: code,
          commissionType: 'BOGUS_TYPE',
          generation: 1,
          rateValue: '88.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(4),
          reason: 'invalid type evidence',
          idempotencyKey: `badtype-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_COMMISSION_TYPE' });
    });

    // ─── §7 Decimal / business matrix (8) ────────────────────────────

    it('stores up to ten decimals verbatim with zero float drift', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          rateValue: '0.1000000001',
          rateType: 'PERCENTAGE',
        }),
      ).expect(201);
      expect((body.body as { rateValue: string }).rateValue).toBe(
        '0.1000000001',
      );
    });

    it('rejects more than ten decimals (400 transport / 422 in-process)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          rateValue: '0.00000000001',
          rateType: 'PERCENTAGE',
        }),
      ).expect(400);
      await expect(
        owner.createRateVersion(ownerActor(admin.adminUserId, market), {
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          generation: 1,
          rateValue: '0.00000000001',
          rateType: 'PERCENTAGE',
          effectiveFrom: klMidnightIso(4),
          reason: 'precision evidence',
          idempotencyKey: `prec-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_PRECISION_EXCEEDED' });
    });

    it('rejects negative rates (400 transport / 422 in-process)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          rateValue: '-1.00',
          rateType: 'PERCENTAGE',
        }),
      ).expect(400);
      await expect(
        owner.createRateVersion(ownerActor(admin.adminUserId, market), {
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          generation: 1,
          rateValue: '-1.00',
          rateType: 'PERCENTAGE',
          effectiveFrom: klMidnightIso(4),
          reason: 'negative evidence',
          idempotencyKey: `neg-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_PRECISION_EXCEEDED' });
    });

    it('rejects percentages above 100% (422) and accepts exactly 100%', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          rateValue: '100.0000000001',
          rateType: 'PERCENTAGE',
        }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_PERCENTAGE_LIMIT',
      );
      const ok = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          rateValue: '100',
          rateType: 'PERCENTAGE',
          effectiveFrom: klMidnightIso(4),
        }),
      ).expect(201);
      expect((ok.body as { rateValue: string }).rateValue).toBe(
        '100.0000000000',
      );
    });

    it('accepts the frozen zero boundary (rate_value >= 0 preserved)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'MEMBER_CONSUMPTION',
          rateValue: '0',
          rateType: 'PERCENTAGE',
        }),
      ).expect(201);
      expect((body.body as { rateValue: string }).rateValue).toBe(
        '0.0000000000',
      );
    });

    it('rejects values exceeding the NUMERIC(38,10) digit budget (400)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_UPGRADE',
          rateValue: '1234567890123456789012345678901.1234567890',
        }),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('INVALID_RATE_VALUE');
    });

    it('rejects a payload timezone that does not match the market (422)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, timezone: 'Asia/Singapore' }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_TIMEZONE_MISMATCH',
      );
    });

    it('rejects a cross-market payload (409) and an unresolvable current market (422)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      // Body market code that is not the current market code → 409 at the
      // market-context boundary (client market values are never authority).
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: 'ZZ' }),
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH',
      );
      // In-process: a Current Admin Market UUID with no active market row
      // → the owner blocks with MARKET_NOT_FOUND (422 class).
      await expect(
        owner.createRateVersion(ownerActor(admin.adminUserId, randomUUID()), {
          market: 'ZZ',
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          rateValue: '88.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(4),
          reason: 'missing market evidence',
          idempotencyKey: `nomkt-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_MARKET_NOT_FOUND' });
    });

    // ─── §8 Effective-time / versioning matrix (8) ───────────────────

    it('rejects a same-day / backdated activation (422)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects a non-midnight activation instant (422)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const noonKl = new Date(
        new Date(klMidnightIso(2)).getTime() + 12 * 60 * 60 * 1000,
      ).toISOString();
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, effectiveFrom: noonKl }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects a DST-skipped midnight (America/Havana 2027-03-14, 422)', async () => {
      const market = await freshMarket('America/Havana');
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const skipped = '2027-03-14T05:00:00.000Z'; // no 00:00 wall time that day
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, effectiveFrom: skipped }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      );
    });

    it('rejects an ambiguous repeated midnight (America/Havana 2027-11-07, 422)', async () => {
      const market = await freshMarket('America/Havana');
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      // Havana falls back at midnight on 2027-11-07: 00:00 occurs TWICE
      // (04:00Z and 05:00Z) → no unambiguous midnight → 422.
      const ambiguous = '2027-11-07T04:00:00.000Z';
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, effectiveFrom: ambiguous }),
      ).expect(422);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      );
    });

    it('accepts a future market-local 00:00 with exact UTC + local + timezone', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '88.00' }),
      ).expect(201);
      const result = body.body as {
        effectiveFrom: string;
        effectiveFromLocal: string;
        timezone: string;
      };
      expect(result.effectiveFrom).toBe(klMidnightIso(2));
      expect(result.effectiveFromLocal).toBe(`${klDateString(2)} 00:00:00`);
      expect(result.timezone).toBe('Asia/Kuala_Lumpur');
    });

    it('allows a legal later-start successor after an open-ended version (201)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const v1 = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '88.00' }),
      ).expect(201);
      const v2 = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          rateValue: '95.00',
          effectiveFrom: klMidnightIso(6),
        }),
      ).expect(201);
      expect((v2.body as { id: string }).id).not.toBe(
        (v1.body as { id: string }).id,
      );
    });

    it('rejects an overlapping start for the same definition (409)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '88.00' }),
      ).expect(201);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '95.00' }),
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'OVERLAPPING_RATE_PERIOD',
      );
    });

    it('allows a successor exactly at a legacy stored end and keeps legacy rows byte-identical', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const legacyEnd = klMidnightIso(5);
      const legacyId = await seedLegacyRateVersion({
        marketId: market,
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        rateValue: '88.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
        effectiveUntil: new Date(legacyEnd),
      });
      const created = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          rateValue: '95.00',
          effectiveFrom: legacyEnd,
        }),
      ).expect(201);
      expect((created.body as { id: string }).id).toBeTruthy();
      // Legacy row untouched: same id, same values, reason stays NULL.
      const [legacy] = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, legacyId))
        .limit(1);
      expect(legacy?.rateValue).toBe('88.0000000000');
      expect(legacy?.effectiveUntil?.toISOString()).toBe(legacyEnd);
      expect(legacy?.createdBy).toBe('00000000-0000-0000-0000-000000000000');
      expect(legacy?.reason).toBeNull();
    });

    // ─── §10 Idempotency matrix (9) ──────────────────────────────────

    it('rejects a missing Idempotency-Key header (400)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const res = await supertest(server)
        .post(ratesUrl)
        .set(authorized(admin.token))
        .send(ownerPayload({ market: code }));
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
      );
    });

    it('replays the exact original result for same key + same payload (one row)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `replay-${randomUUID()}`;
      const payload = ownerPayload({ market: code, rateValue: '88.00' });
      const first = await scheduleRate(admin.token, payload, key).expect(201);
      const second = await scheduleRate(admin.token, payload, key).expect(201);
      expect((second.body as { id: string }).id).toBe(
        (first.body as { id: string }).id,
      );
      const rows = await database.db
        .select()
        .from(merchantApiIdempotencyKeys)
        .where(
          and(
            eq(
              merchantApiIdempotencyKeys.scope,
              `commission.rate.owner.create:${market}:${admin.adminUserId}`,
            ),
            eq(merchantApiIdempotencyKeys.key, key),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(rows[0]?.statusCode).toBe(201);
    });

    it('rejects same key + different rate with 409 IDEMPOTENCY_CONFLICT', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `conflict-rate-${randomUUID()}`;
      await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '88.00' }),
        key,
      ).expect(201);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, rateValue: '95.00' }),
        key,
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
      );
    });

    it('rejects same key + different commission type / generation with 409', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `conflict-type-${randomUUID()}`;
      await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
        }),
        key,
      ).expect(201);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 2,
          rateValue: '38.00',
          effectiveFrom: klMidnightIso(4),
        }),
        key,
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
      );
    });

    it('rejects same key + different effective time with 409', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `conflict-time-${randomUUID()}`;
      await scheduleRate(
        admin.token,
        ownerPayload({ market: code, effectiveFrom: klMidnightIso(2) }),
        key,
      ).expect(201);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, effectiveFrom: klMidnightIso(6) }),
        key,
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
      );
    });

    it('rejects same key + different reason with 409', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `conflict-reason-${randomUUID()}`;
      await scheduleRate(
        admin.token,
        ownerPayload({ market: code, reason: 'first reason' }),
        key,
      ).expect(201);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, reason: 'second reason' }),
        key,
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
      );
    });

    it('treats the same key in a different market scope as independent (recorded D-053 §5.3 semantics)', async () => {
      // The mechanism table keys on (scope, key); the scope embeds the
      // market UUID + admin, so a key reused in ANOTHER market scope is a
      // different scope — it commits independently (documented cross-scope
      // behavior, same as the D-053 create/cancel scope separation). The
      // same-key/different-payload 409 is enforced WITHIN each scope.
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, marketA);
      const key = `cross-scope-${randomUUID()}`;
      const a = await scheduleRate(
        admin.token,
        ownerPayload({ market: await marketCodeOf(marketA) }),
        key,
      ).expect(201);
      await setCurrentMarket(admin.accountId, marketB);
      const b = await scheduleRate(
        admin.token,
        ownerPayload({ market: await marketCodeOf(marketB) }),
        key,
      ).expect(201);
      expect((a.body as { id: string }).id).not.toBe(
        (b.body as { id: string }).id,
      );
    });

    it('commits a single row for concurrent same-key duplicates (both 201, same id)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `concurrent-${randomUUID()}`;
      const payload = ownerPayload({ market: code, rateValue: '88.00' });
      const [a, b] = await Promise.all([
        scheduleRate(admin.token, payload, key),
        scheduleRate(admin.token, payload, key),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect((a.body as { id: string }).id).toBe((b.body as { id: string }).id);
      const versionCount = await database.db
        .select({ id: commissionRateVersions.id })
        .from(commissionRateVersions)
        .where(
          and(
            eq(commissionRateVersions.market, code),
            eq(commissionRateVersions.commissionType, 'AGENT_UPGRADE'),
          ),
        );
      expect(versionCount).toHaveLength(1);
    });

    it('rolls back version + claim + audit atomically on injected audit failure, then retry succeeds', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `atomic-${randomUUID()}`;
      const payload = ownerPayload({ market: code, rateValue: '88.00' });
      const auditBefore = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.marketId, market));
      const spy = vi
        .spyOn(auditService, 'appendWithinTransaction')
        .mockRejectedValueOnce(new Error('injected audit failure'));
      const failed = await scheduleRate(admin.token, payload, key);
      expect(failed.status).toBe(500);
      spy.mockRestore();
      // Nothing committed: no version row, no idempotency claim, no NEW
      // audit row for this market.
      const versions = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.market, code));
      expect(versions).toHaveLength(0);
      const claims = await database.db
        .select()
        .from(merchantApiIdempotencyKeys)
        .where(
          and(
            eq(
              merchantApiIdempotencyKeys.scope,
              `commission.rate.owner.create:${market}:${admin.adminUserId}`,
            ),
            eq(merchantApiIdempotencyKeys.key, key),
          ),
        );
      expect(claims).toHaveLength(0);
      const auditAfter = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.marketId, market));
      expect(auditAfter).toHaveLength(auditBefore.length);
      // Same key retry after correction succeeds (no false replay record).
      const retry = await scheduleRate(admin.token, payload, key).expect(201);
      expect((retry.body as { id: string }).id).toBeTruthy();
    });

    // ─── §11 Reason / audit matrix (9) ───────────────────────────────

    it('rejects a missing reason (400)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const res = await supertest(server)
        .post(ratesUrl)
        .set(authorized(admin.token))
        .set('Idempotency-Key', `reason-${randomUUID()}`)
        .send(ownerPayload({ market: code, reason: undefined }));
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      // In-process: the owner re-checks the reason itself.
      await expect(
        owner.createRateVersion(ownerActor(admin.adminUserId, market), {
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          rateValue: '88.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(4),
          reason: '',
          idempotencyKey: `reason2-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_REASON_REQUIRED' });
    });

    it('rejects a blank / whitespace-only reason (400)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, reason: '   ' }),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an overlength reason (>500) (400)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, reason: 'x'.repeat(501) }),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts 1-char and 500-char reasons and persists them on the version row', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const one = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, reason: 'x' }),
      ).expect(201);
      const fiveHundred = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          reason: 'y'.repeat(500),
          effectiveFrom: klMidnightIso(4),
        }),
      ).expect(201);
      for (const created of [one.body, fiveHundred.body] as Array<{
        id: string;
        reason: string;
      }>) {
        const [row] = await database.db
          .select()
          .from(commissionRateVersions)
          .where(eq(commissionRateVersions.id, created.id))
          .limit(1);
        expect(row?.reason).toBe(created.reason);
        expect(row?.createdBy).toBe(admin.adminUserId);
      }
    });

    it('writes an atomic immutable audit with the full contract evidence', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const key = `audit-${randomUUID()}`;
      const body = await scheduleRate(
        admin.token,
        ownerPayload({
          market: code,
          rateValue: '88.00',
          reason: 'audit evidence',
        }),
        key,
      ).expect(201);
      const created = body.body as {
        id: string;
        marketId: string;
        createdBy: string;
      };
      const auditRows = await database.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'commission.rate_version.create'),
            eq(auditLogs.entityId, created.id),
          ),
        );
      expect(auditRows).toHaveLength(1);
      const audit = auditRows[0]!;
      expect(audit.actorType).toBe('ADMIN_USER');
      expect(audit.actorId).toBe(admin.adminUserId);
      expect(audit.marketId).toBe(created.marketId);
      expect(audit.entityType).toBe('commission_rate_version');
      expect(audit.result).toBe('SUCCESS');
      expect(audit.reason).toBe('audit evidence');
      expect(audit.requestId).toBeTruthy();
      const after = audit.after as Record<string, unknown>;
      expect(after?.commissionType).toBe('AGENT_UPGRADE');
      expect(after?.generation).toBe(1);
      expect(after?.rateType).toBe('FIXED');
      expect(after?.rateValue).toBe('88.0000000000');
      expect(after?.effectiveFrom).toBe(klMidnightIso(2));
      expect(after?.timezone).toBe('Asia/Kuala_Lumpur');
      // The canonical payload digest is persisted under idempotencyDigest
      // (the platform audit-redaction layer scrubs *hash keys by design;
      // the mechanism table still stores request_hash verbatim).
      expect(after?.idempotencyDigest).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('normalizes the reason (trimmed) and persists it without silent truncation', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const body = await scheduleRate(
        admin.token,
        ownerPayload({ market: code, reason: '  padded reason  ' }),
      ).expect(201);
      const created = body.body as { id: string; reason: string };
      expect(created.reason).toBe('padded reason');
      const [row] = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, created.id))
        .limit(1);
      expect(row?.reason).toBe('padded reason');
    });

    it('keeps legacy rate-version rows NULL-reason (no fabricated backfill)', async () => {
      const market = await freshMarket();
      const legacyId = await seedLegacyRateVersion({
        marketId: market,
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        rateValue: '88.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
      });
      const [row] = await database.db
        .select()
        .from(commissionRateVersions)
        .where(eq(commissionRateVersions.id, legacyId))
        .limit(1);
      expect(row?.reason).toBeNull();
      // The read surface still returns the legacy row.
      const list = await owner.getRateHistory(
        await marketCodeOf(market),
        'AGENT_UPGRADE',
        1,
      );
      expect(list.some((entry) => entry.id === legacyId)).toBe(true);
    });

    it('resolves the latest effective version for future events (logical half-open)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      // Two open-ended legacy rows with strictly increasing starts in the
      // past simulate a superseded baseline (the D-054 §9 derived-window
      // resolution): getActiveRates must return only the LATEST start.
      const olderId = await seedLegacyRateVersion({
        marketId: market,
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        rateValue: '88.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2026-07-25T00:00:00.000Z'),
      });
      const newerId = await seedLegacyRateVersion({
        marketId: market,
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        rateValue: '95.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      });
      const active = await owner.getActiveRates(code);
      const matching = active.filter(
        (rate) =>
          rate.commissionType === 'AGENT_UPGRADE' && rate.generation === 1,
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]?.id).toBe(newerId);
      expect(matching[0]?.id).not.toBe(olderId);
    });

    it('enforces the owner in-process for the /schedule route as well (same command)', async () => {
      const market = await freshMarket();
      const code = await marketCodeOf(market);
      const admin = await createAdmin({
        marketIds: [market],
        permissionCodes: ['commission.rate.read', 'commission.rate.manage'],
      });
      await setCurrentMarket(admin.accountId, market);
      const res = await supertest(server)
        .post(`${ratesUrl}/schedule`)
        .set(authorized(admin.token))
        .set('Idempotency-Key', `schedule-${randomUUID()}`)
        .send(
          ownerPayload({
            market: code,
            rateValue: '88.00',
            effectiveFrom: klMidnightIso(2),
          }),
        );
      expect(res.status).toBe(201);
      // In-process owner call with a revoked grant is denied instantly.
      await revokeMarketGrant(admin.adminUserId, market);
      await expect(
        owner.createRateVersion(ownerActor(admin.adminUserId, market), {
          market: code,
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          rateValue: '88.00',
          rateType: 'FIXED',
          effectiveFrom: klMidnightIso(4),
          reason: 'revoked grant evidence',
          idempotencyKey: `revoked-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_MARKET_ACCESS_DENIED',
      });
    });
  },
);
