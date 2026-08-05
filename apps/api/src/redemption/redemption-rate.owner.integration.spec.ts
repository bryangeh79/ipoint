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
  redemptionRateCancellations,
  redemptionRateVersions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { permissionDefinition } from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
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
import { RedemptionService } from './redemption.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Redemption-Rate-Owner-Password-123!';

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
  'Phase 6 Redemption Rate Owner D-053 security and versioning (HTTP, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let owner: RedemptionService;
    let auditService: AuditService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR, Asia/Kuala_Lumpur (Malaysia bounds)
    let marketB: string; // code MB, SGD, Asia/Singapore (no rate rule)

    /** Malaysia-approved bounds reused for every configured test market. */
    const MALAYSIA_MIN = '0.5000000000';
    const MALAYSIA_MAX = '2.0000000000';
    const MALAYSIA_INITIAL = '1.0000000000';
    const MALAYSIA_CURRENCY = 'MYR';

    const ratesUrl = (marketId: string) =>
      `/api/v1/admin/redemption/market/${marketId}/rates`;
    const cancelUrl = (rateId: string) =>
      `/api/v1/admin/redemption/rates/${rateId}/cancel`;

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
          name: `${code} D053 Rate Owner Test Market`,
          status: 'ACTIVE',
          currencyCode,
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      return inserted[0]?.id ?? '';
    }

    /** Fresh ACTIVE market with an approved Malaysia-bounds rate rule. */
    async function freshConfiguredMarket(
      timezone = 'Asia/Kuala_Lumpur',
    ): Promise<string> {
      const code = `D${randomUUID().slice(0, 6).toUpperCase()}`;
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `Fresh D053 Rate Market ${code}`,
          status: 'ACTIVE',
          currencyCode: 'MYR',
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      const marketId = inserted[0]?.id ?? '';
      await database.db.execute(
        sql`INSERT INTO redemption_rate_market_rules (
              market_code, rate_type, initial_rate, minimum_rate,
              maximum_rate, currency, display_unit
            ) VALUES (
              ${code}, 'POINTS_PER_CURRENCY'::redemption_rate_type,
              ${MALAYSIA_INITIAL}, ${MALAYSIA_MIN}, ${MALAYSIA_MAX},
              ${MALAYSIA_CURRENCY}, 'RM per 1 iPoint'
            )
            ON CONFLICT (market_code, rate_type) DO NOTHING`,
      );
      return marketId;
    }

    /** Fresh ACTIVE market WITHOUT a rate rule (unconfigured → blocked). */
    async function freshUnconfiguredMarket(): Promise<string> {
      const code = `U${randomUUID().slice(0, 6).toUpperCase()}`;
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `Unconfigured D053 Market ${code}`,
          status: 'ACTIVE',
          currencyCode: 'MYR',
          timezone: 'Asia/Kuala_Lumpur',
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
            description: `${code} d053 rate owner integration test permission`,
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
          displayName: `D053 Rate Owner Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? [
        'redemption.rate.manage',
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
          name: `D053 Rate Owner HTTP Test Role (${roleCode})`,
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

    /** Direct row seed of a legacy-style rate version (historical rows). */
    async function seedRateVersion(params: {
      marketId: string;
      rateValue: string;
      effectiveFrom: string;
      createdBy: string;
      effectiveUntil?: string | null;
      reason?: string | null;
    }): Promise<string> {
      const inserted = await database.db
        .insert(redemptionRateVersions)
        .values({
          marketId: params.marketId,
          rateType: 'POINTS_PER_CURRENCY',
          rateValue: params.rateValue,
          effectiveFrom: new Date(params.effectiveFrom),
          effectiveUntil: params.effectiveUntil
            ? new Date(params.effectiveUntil)
            : null,
          createdBy: params.createdBy,
          reason: params.reason ?? null,
        })
        .returning({ id: redemptionRateVersions.id });
      return inserted[0]?.id ?? '';
    }

    /** Direct seed of an append-only cancellation record (legacy event). */
    async function seedCancellation(
      rateVersionId: string,
      marketId: string,
      cancelledBy: string,
    ): Promise<void> {
      await database.db.execute(
        sql`INSERT INTO redemption_rate_cancellations (
              rate_version_id, market_id, cancelled_by, reason
            ) VALUES (
              ${rateVersionId}, ${marketId}, ${cancelledBy},
              'legacy cancellation event'
            )
            ON CONFLICT (rate_version_id) DO NOTHING`,
      );
    }

    async function seedMember(): Promise<string> {
      const memberId = randomUUID();
      const accountId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO accounts (id, public_id, email, account_country, status, email_verified_at)
            VALUES (${accountId}, ${`m-${randomUUID()}`}, ${`m${randomUUID()}@x`}, 'MY', 'ACTIVE', NOW())
            ON CONFLICT (id) DO NOTHING`,
      );
      await database.db.execute(
        sql`INSERT INTO members (id, account_id, public_member_id, referral_code, status, kyc_level)
            VALUES (${memberId}, ${accountId}, ${`MB-${randomUUID()}`}, ${`RF-${randomUUID()}`}, 'ACTIVE'::member_status, 'LEVEL_2'::member_kyc_level)
            ON CONFLICT (id) DO NOTHING`,
      );
      return memberId;
    }

    async function seedCatalogItem(
      marketId: string,
      createdBy: string,
    ): Promise<string> {
      const itemId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO redemption_catalog_items (
              id, market_id, sku, name, item_type, status,
              fiat_reference_value, fiat_currency, fulfilment_mode,
              inventory_mode, created_by, version
            ) VALUES (
              ${itemId}, ${marketId}, ${`SKU-${randomUUID()}`}, 'Legacy Item',
              'PHYSICAL', 'ACTIVE', '50', 'MYR', 'PICKUP', 'TRACKED',
              ${createdBy}, 1
            )
            ON CONFLICT (id) DO NOTHING`,
      );
      return itemId;
    }

    async function seedWallet(
      memberId: string,
      marketId: string,
    ): Promise<string> {
      const walletId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO member_wallet_accounts (
              id, member_id, market_id, pending_balance, available_balance,
              reversed_balance, version
            ) VALUES (
              ${walletId}, ${memberId}, ${marketId}, 0, 100000, 0, 1
            )
            ON CONFLICT (id) DO NOTHING`,
      );
      return walletId;
    }

    async function seedQuote(
      marketId: string,
      memberId: string,
      itemId: string,
      rateVersionId: string,
      rateValue: string,
    ): Promise<string> {
      const quoteId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO redemption_quotes (
              id, member_id, market_id, catalog_item_id, status,
              rate_version_id, rate_snapshot, unrounded_point_cost,
              posted_point_cost, payload_hash, expires_at, idempotency_key
            ) VALUES (
              ${quoteId}, ${memberId}, ${marketId}, ${itemId}, 'VALID',
              ${rateVersionId},
              ${JSON.stringify({ rateVersionId, rateType: 'POINTS_PER_CURRENCY', rateValue })}::jsonb,
              '5000', '5000',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              NOW() + interval '1 hour', ${`legacy-quote-${randomUUID()}`}
            )
            ON CONFLICT (id) DO NOTHING`,
      );
      return quoteId;
    }

    async function seedOrder(
      marketId: string,
      memberId: string,
      itemId: string,
      walletId: string,
      quoteId: string,
      rateVersionId: string,
      rateValue: string,
    ): Promise<string> {
      const orderId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO redemption_orders (
              id, order_reference, market_id, member_id, item_id,
              wallet_account_id, quote_id, rate_version_id, rate_value,
              status, unrounded_point_cost, posted_point_cost,
              total_points, quantity, rounding_mode, calculation_scale,
              posting_scale, item_snapshot, rate_snapshot,
              idempotency_key, confirmed_at
            ) VALUES (
              ${orderId}, ${`RDM-${randomUUID().slice(0, 8).toUpperCase()}`},
              ${marketId}, ${memberId}, ${itemId},
              ${walletId}, ${quoteId}, ${rateVersionId}, ${rateValue},
              'CONFIRMED', '5000', '5000', '5000', '1', 'HALF_UP', 10, 10,
              ${JSON.stringify({ id: itemId, name: 'Legacy Item' })}::jsonb,
              ${JSON.stringify({ rateVersionId, rateType: 'POINTS_PER_CURRENCY', rateValue })}::jsonb,
              ${`legacy-order-${randomUUID()}`}, NOW()
            )
            ON CONFLICT (id) DO NOTHING`,
      );
      return orderId;
    }

    /** Build the create payload for the secured owner route. */
    function ownerPayload(overrides: Record<string, unknown> = {}) {
      return {
        marketId: marketA,
        rateType: 'POINTS_PER_CURRENCY',
        rateValue: '1.00',
        fiatCurrency: 'MYR',
        effectiveFrom: klMidnightIso(2),
        reason: 'D-053 owner remediation evidence',
        ...overrides,
      };
    }

    function scheduleRate(
      token: string,
      marketId: string,
      payload: Record<string, unknown>,
      key?: string,
    ) {
      return supertest(server)
        .post(ratesUrl(marketId))
        .set(authorized(token))
        .set('Idempotency-Key', key ?? `key-${randomUUID()}`)
        .send(payload);
    }

    function cancelRate(
      token: string,
      rateId: string,
      reason: string,
      key?: string,
    ) {
      return supertest(server)
        .post(cancelUrl(rateId))
        .set(authorized(token))
        .set('Idempotency-Key', key ?? `key-${randomUUID()}`)
        .send({ reason });
    }

    /** Full in-process actor with the server Current Admin Market. */
    function fullActor(
      adminUserId: string,
      currentMarketId: string,
    ): Parameters<RedemptionService['createRateVersion']>[0] {
      return {
        adminUserId,
        currentMarketId,
        marketContextVersion: 2,
        ipAddress: '127.0.0.1',
      };
    }

    function inProcessCreate(
      actor: Parameters<RedemptionService['createRateVersion']>[0],
      input: Parameters<RedemptionService['createRateVersion']>[1],
    ) {
      return owner.createRateVersion(actor, input);
    }

    function inProcessCancel(
      actor: Parameters<RedemptionService['cancelRateVersion']>[0],
      rateId: string,
      input: Parameters<RedemptionService['cancelRateVersion']>[2],
    ) {
      return owner.cancelRateVersion(actor, rateId, input);
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
      vi.stubEnv('AUTH_OTP_PEPPER', 'rate-owner-pepper-at-least-32-characters');
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
      owner = app.get(RedemptionService);
      auditService = app.get(AuditService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      // MA: Malaysia-bounds configured market. MB: unconfigured market.
      marketA = await ensureActiveMarket('MA', 'MYR', 'Asia/Kuala_Lumpur');
      await database.db.execute(
        sql`INSERT INTO redemption_rate_market_rules (
              market_code, rate_type, initial_rate, minimum_rate,
              maximum_rate, currency, display_unit
            ) VALUES (
              'MA', 'POINTS_PER_CURRENCY'::redemption_rate_type,
              ${MALAYSIA_INITIAL}, ${MALAYSIA_MIN}, ${MALAYSIA_MAX},
              ${MALAYSIA_CURRENCY}, 'RM per 1 iPoint'
            )
            ON CONFLICT (market_code, rate_type) DO NOTHING`,
      );
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

    // ─── §5. Authorization (9 items) ───────────────────────────────────

    describe('§5 authorization cannot be bypassed', () => {
      it('rejects unauthenticated creates with 401', async () => {
        await supertest(server)
          .post(ratesUrl(marketA))
          .send(ownerPayload({ marketId: marketA }))
          .expect(401);
      });

      it('rejects non-admin (member) actors with 403', async () => {
        const member = await createAccount();
        const token = (await auth.login(member.email, password)).accessToken;
        await scheduleRate(
          token,
          marketA,
          ownerPayload({ marketId: marketA }),
        ).expect(403);
      });

      it('rejects admins without redemption.rate.manage with 403', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['redemption.catalog.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const body = await scheduleRate(
          admin.token,
          marketA,
          ownerPayload({ marketId: marketA }),
        ).expect(403);
        expect((body.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
      });

      it('does not demand MFA step-up because the catalog declares none (recorded)', async () => {
        const definition = permissionDefinition('redemption.rate.manage');
        expect(definition?.stepUpRequired).toBe(false);
        // An authorized admin WITHOUT any step-up token is accepted — the
        // catalog is authoritative (D-053 §5: "fresh MFA step-up where
        // required by the permission catalog").
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({
          marketIds: [market],
          permissionCodes: ['redemption.rate.manage'],
        });
        await setCurrentMarket(admin.accountId, market);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
      });

      it('rejects when no server Current Admin Market is selected (409)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['redemption.rate.manage'],
        });
        const body = await scheduleRate(
          admin.token,
          marketA,
          ownerPayload({ marketId: marketA }),
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'MARKET_SELECTION_REQUIRED',
        );
      });

      it('rejects when the admin has no grant for the market (403)', async () => {
        const admin = await createAdmin({
          marketIds: [marketB],
          permissionCodes: ['redemption.rate.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const body = await scheduleRate(
          admin.token,
          marketA,
          ownerPayload({ marketId: marketA }),
        ).expect(403);
        expect((body.body as ErrorBody).error.code).toBe(
          'MARKET_ACCESS_DENIED',
        );
      });

      it('rejects when the body market differs from the Current Admin Market (409)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['redemption.rate.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const body = await scheduleRate(
          admin.token,
          marketA,
          ownerPayload({ marketId: marketB }),
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });

      it('rejects a revoked market grant on the next request (403)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({
          marketIds: [market],
          permissionCodes: ['redemption.rate.manage'],
        });
        await setCurrentMarket(admin.accountId, market);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market }),
        ).expect(201);
        await database.db
          .update(marketAccess)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(marketAccess.adminUserId, admin.adminUserId),
              eq(marketAccess.marketId, market),
            ),
          );
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.50',
            effectiveFrom: klMidnightIso(3),
          }),
        ).expect(403);
        expect((body.body as ErrorBody).error.code).toBe(
          'MARKET_ACCESS_DENIED',
        );
      });

      it('enforces every control on direct in-process owner calls (bypass proof)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({
          marketIds: [market],
          permissionCodes: ['redemption.rate.manage'],
        });
        await setCurrentMarket(admin.accountId, market);
        const actor = fullActor(admin.adminUserId, market);
        const validInput = {
          marketId: market,
          rateType: 'POINTS_PER_CURRENCY' as const,
          rateValue: '1.00',
          fiatCurrency: 'MYR',
          effectiveFrom: klMidnightIso(3),
          reason: 'In-process evidence',
          idempotencyKey: `proc-${randomUUID()}`,
        };

        // No actor identity → denied.
        await expect(
          inProcessCreate({} as never, validInput),
        ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_PERMISSION_DENIED' });
        // A read-only admin (no manage permission) → denied.
        const readOnly = await createAdmin({
          marketIds: [market],
          permissionCodes: ['redemption.catalog.manage'],
        });
        await expect(
          inProcessCreate(
            { ...actor, adminUserId: readOnly.adminUserId },
            validInput,
          ),
        ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_PERMISSION_DENIED' });
        // No server Current Admin Market → selection required.
        await expect(
          inProcessCreate(
            { adminUserId: admin.adminUserId, ipAddress: '127.0.0.1' },
            validInput,
          ),
        ).rejects.toMatchObject({
          code: 'REDEMPTION_RATE_MARKET_SELECTION_REQUIRED',
        });
        // Body market != server current market → context mismatch.
        await expect(
          inProcessCreate({ ...actor, currentMarketId: marketB }, validInput),
        ).rejects.toMatchObject({
          code: 'REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH',
        });
        // No reason → required.
        await expect(
          inProcessCreate(actor, { ...validInput, reason: undefined }),
        ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_REASON_REQUIRED' });
        // No idempotency key → required.
        await expect(
          inProcessCreate(actor, { ...validInput, idempotencyKey: undefined }),
        ).rejects.toMatchObject({
          code: 'REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED',
        });
        // A fully valid in-process call succeeds with the same enforcement.
        const result = await inProcessCreate(actor, validInput);
        expect(result.id).toBeTruthy();
        expect(result.marketId).toBe(market);
        expect(result.reason).toBe('In-process evidence');
      });
    });

    // ─── §6. Rate contract: bounds, precision, market config (10 items) ─

    describe('§6 rate contract (Malaysia bounds, exact decimals, no fallback)', () => {
      it('accepts the RM0.50 minimum', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '0.50' }),
        ).expect(201);
        expect((body.body as { rateValue: string }).rateValue).toBe('0.5');
      });

      it('accepts the RM1.00 initial value', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        expect((body.body as { rateValue: string }).rateValue).toBe('1');
      });

      it('accepts the RM2.00 maximum', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '2.00' }),
        ).expect(201);
        expect((body.body as { rateValue: string }).rateValue).toBe('2');
      });

      it('rejects a rate below the approved minimum (422)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '0.49' }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_BELOW_MINIMUM',
        );
      });

      it('rejects a rate above the approved maximum (422)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '2.01' }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_ABOVE_MAXIMUM',
        );
      });

      it('rejects more than 10 decimals (400 at the transport, 422 in-process)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.12345678901' }),
        ).expect(400);
        // The owner re-checks with exact BigInt math for in-process callers.
        await expect(
          inProcessCreate(fullActor(admin.adminUserId, market), {
            marketId: market,
            rateType: 'POINTS_PER_CURRENCY',
            rateValue: '1.12345678901',
            fiatCurrency: 'MYR',
            effectiveFrom: klMidnightIso(3),
            reason: 'precision',
            idempotencyKey: `prec-${randomUUID()}`,
          }),
        ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_PRECISION_EXCEEDED' });
      });

      it('accepts exactly 10 decimals and derives the ≤6-decimal display', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.1234567890' }),
        ).expect(201);
        const id = (body.body as { id: string }).id;
        const rows = await database.db
          .select({ rateValue: redemptionRateVersions.rateValue })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.id, id));
        // numeric(38,10) round-trips the exact input string.
        expect(rows[0]?.rateValue).toBe('1.1234567890');
        // The derived display value keeps ≤6 decimals without touching storage.
        expect((body.body as { rateValue: string }).rateValue).toBe(
          '1.123456789',
        );
      });

      it('proves zero float drift on an exact 10-decimal value', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // 1.1000000001 is NOT exactly representable in binary floats; the
        // stored numeric(38,10) value must equal the input string exactly.
        // (Must be within the approved Malaysia bounds [0.50, 2.00] — a
        // below-minimum value is rejected by §6 with BELOW_MINIMUM, which
        // is a separate control proven by its own test above.)
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.1000000001' }),
        ).expect(201);
        const id = (body.body as { id: string }).id;
        const rows = await database.db
          .select({ rateValue: redemptionRateVersions.rateValue })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.id, id));
        expect(rows[0]?.rateValue).toBe('1.1000000001');
      });

      it('explicitly blocks an unconfigured market (422)', async () => {
        const market = await freshUnconfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_MARKET_BLOCKED',
        );
        const rows = await database.db
          .select({ id: redemptionRateVersions.id })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, market));
        expect(rows).toHaveLength(0);
      });

      it('never falls back across markets (configured:false, isolation)', async () => {
        // MB has no rule even though MA/MY carry Malaysia bounds.
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['redemption.rate.manage'],
        });
        await setCurrentMarket(admin.accountId, marketB);
        const body = await scheduleRate(
          admin.token,
          marketB,
          ownerPayload({ marketId: marketB, rateValue: '1.00' }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_MARKET_BLOCKED',
        );

        // Read side reports configured:false with no cross-market config.
        const listBody = await supertest(server)
          .get(ratesUrl(marketB))
          .set(authorized(admin.token))
          .expect(200);
        expect(
          (listBody.body as { marketConfig: { configured: boolean } })
            .marketConfig.configured,
        ).toBe(false);
        expect(
          (listBody.body as { versions: unknown[] }).versions,
        ).toHaveLength(0);

        // Versions stay isolated per market.
        await setCurrentMarket(admin.accountId, marketA);
        await scheduleRate(
          admin.token,
          marketA,
          ownerPayload({ marketId: marketA, rateValue: '1.00' }),
        ).expect(201);
        const listA = await supertest(server)
          .get(ratesUrl(marketA))
          .set(authorized(admin.token))
          .expect(200);
        expect(
          (listA.body as { marketConfig: { configured: boolean } }).marketConfig
            .configured,
        ).toBe(true);
        expect((listA.body as { versions: unknown[] }).versions).toHaveLength(
          1,
        );
      });
    });

    // ─── §7. Activation: future market-local 00:00 only (7 items) ─────

    describe('§7 activation time contract', () => {
      it('rejects same-day activation (422)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, effectiveFrom: klMidnightIso(0) }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
        );
      });

      it('rejects backdated activation (422)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            effectiveFrom: '2019-12-31T16:00:00.000Z', // 2020-01-01 00:00 KL
          }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
        );
      });

      it('rejects a future instant that is not a market-local 00:00 (422)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            effectiveFrom: '2030-06-14T17:00:00.000Z', // KL 01:00
          }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
        );
      });

      it('rejects a DST-skipped midnight (America/Havana spring-forward)', async () => {
        const market = await freshConfiguredMarket('America/Havana');
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // Cuba springs forward at 00:00 local on 2026-03-08: 00:00 never
        // exists that day.
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            effectiveFrom: '2026-03-08T04:00:00.000Z',
          }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
        );
      });

      it('rejects an ambiguous repeated midnight (America/Santiago fall-back)', async () => {
        const market = await freshConfiguredMarket('America/Santiago');
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // 2026-04-05 Santiago falls back at 00:00 local → two distinct
        // midnight candidates exist (03:00Z and 04:00Z) → ambiguous.
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            effectiveFrom: '2026-04-05T03:00:00.000Z',
          }),
        ).expect(422);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
        );
      });

      it('accepts a future market-local midnight and returns the exact UTC instant', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const date = klDateString(3);
        const expectedUtc = new Date(
          Date.parse(`${date}T00:00:00.000Z`) - KL_OFFSET_MS,
        ).toISOString();
        const body = await scheduleRate(
          admin.token,
          market,
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
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, market));
        expect(rows[0]?.effectiveFrom.toISOString()).toBe(expectedUtc);
      });

      it('resolves the exact UTC instant in a DST market (America/New_York)', async () => {
        const market = await freshConfiguredMarket('America/New_York');
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // 2027-07-04 00:00 EDT == 04:00Z (UTC-4).
        const body = await scheduleRate(
          admin.token,
          market,
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
    });

    // ─── §8. Versioning: successors, overlap, concurrency (8 items) ────

    describe('§8 versioning and overlap contract', () => {
      it('accepts the first version', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        expect((body.body as { id: string }).id).toBeTruthy();
      });

      it('accepts a legal future successor (later start)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const date1 = klMidnightIso(4);
        const date2 = klMidnightIso(5);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: date1,
          }),
        ).expect(201);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.50',
            effectiveFrom: date2,
          }),
        ).expect(201);
        expect((body.body as { rateValue: string }).rateValue).toBe('1.5');
        const rows = await database.db
          .select({ id: redemptionRateVersions.id })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, market));
        expect(rows).toHaveLength(2);
      });

      it('accepts a successor that starts exactly at a legacy predecessor end', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // The legacy stored end must be a legal activation instant
        // (market-local 00:00 — D-053 §7), so the successor can begin
        // exactly at it without violating the activation contract.
        const boundary = klMidnightIso(45);
        const legacy = await seedRateVersion({
          marketId: market,
          rateValue: '0.0100000000',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveUntil: boundary,
          createdBy: admin.adminUserId,
        });
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '2.00',
            effectiveFrom: boundary, // exactly the stored end
          }),
        ).expect(201);
        expect((body.body as { id: string }).id).toBeTruthy();
        // The legacy row is untouched (append-only; no UPDATE ever).
        const legacyRows = await database.db
          .select()
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.id, legacy));
        expect(legacyRows[0]?.effectiveUntil?.toISOString()).toBe(boundary);
      });

      it('rejects a duplicate interval (same start, 409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const start = klMidnightIso(4);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: start,
          }),
        ).expect(201);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '2.00',
            effectiveFrom: start,
          }),
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_OVERLAP',
        );
      });

      it('rejects a start inside a legacy bounded window (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // Legacy window and the in-window start must all be legal
        // activation instants (market-local 00:00 — D-053 §7) so the
        // overlap control (not the activation control) is what rejects.
        const windowStart = klMidnightIso(30);
        const windowEnd = klMidnightIso(60);
        await seedRateVersion({
          marketId: market,
          rateValue: '0.0100000000',
          effectiveFrom: windowStart,
          effectiveUntil: windowEnd,
          createdBy: admin.adminUserId,
        });
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '2.00',
            effectiveFrom: klMidnightIso(45), // inside [windowStart, windowEnd)
          }),
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_OVERLAP',
        );
      });

      it('resolves a concurrent race to exactly one 201 and one 409', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const start = klMidnightIso(4);
        const [left, right] = await Promise.all([
          scheduleRate(
            admin.token,
            market,
            ownerPayload({
              marketId: market,
              rateValue: '1.00',
              effectiveFrom: start,
            }),
            `race-${randomUUID()}`,
          ),
          scheduleRate(
            admin.token,
            market,
            ownerPayload({
              marketId: market,
              rateValue: '1.50',
              effectiveFrom: start,
            }),
            `race-${randomUUID()}`,
          ),
        ]);
        const statuses = [left.status, right.status].sort();
        expect(statuses).toEqual([201, 409]);
        const conflict = left.status === 409 ? left : right;
        expect((conflict.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_OVERLAP',
        );
        const rows = await database.db
          .select({ id: redemptionRateVersions.id })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, market));
        expect(rows).toHaveLength(1);
      });

      it('keeps historical version rows byte-identical after creates', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const legacy = await seedRateVersion({
          marketId: market,
          rateValue: '0.0125000000',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveUntil: '2026-03-01T00:00:00.000Z',
          createdBy: admin.adminUserId,
        });
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        const rows = await database.db
          .select()
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.id, legacy));
        expect(rows[0]?.rateValue).toBe('0.0125000000');
        expect(rows[0]?.effectiveFrom.toISOString()).toBe(
          '2026-01-01T00:00:00.000Z',
        );
        expect(rows[0]?.effectiveUntil?.toISOString()).toBe(
          '2026-03-01T00:00:00.000Z',
        );
        expect(rows[0]?.reason).toBeNull(); // legacy rows keep NULL
      });

      it('never reprices historical quotes or orders after successor creates', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // Legacy active rate locked into a quote + an order.
        const legacy = await seedRateVersion({
          marketId: market,
          rateValue: '1.0000000000',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          createdBy: admin.adminUserId,
        });
        const memberId = await seedMember();
        const itemId = await seedCatalogItem(market, admin.adminUserId);
        const quoteId = await seedQuote(
          market,
          memberId,
          itemId,
          legacy,
          '1.0000000000',
        );
        const walletId = await seedWallet(memberId, market);
        const orderId = await seedOrder(
          market,
          memberId,
          itemId,
          walletId,
          quoteId,
          legacy,
          '1.0000000000',
        );

        // Create a successor — the frozen quote/order must not be repriced.
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '2.00',
            effectiveFrom: klMidnightIso(4),
          }),
        ).expect(201);

        const quoteRows = await database.db.execute(
          sql`SELECT rate_version_id, rate_snapshot, posted_point_cost
              FROM redemption_quotes WHERE id = ${quoteId}`,
        );
        expect(quoteRows.rows[0]?.rate_version_id).toBe(legacy);
        expect(
          (quoteRows.rows[0]?.rate_snapshot as { rateValue?: string })
            ?.rateValue,
        ).toBe('1.0000000000');
        expect(quoteRows.rows[0]?.posted_point_cost).toBe('5000.0000000000');

        const orderRows = await database.db.execute(
          sql`SELECT rate_version_id, rate_value, rate_snapshot, total_points
              FROM redemption_orders WHERE id = ${orderId}`,
        );
        expect(orderRows.rows[0]?.rate_version_id).toBe(legacy);
        expect(orderRows.rows[0]?.rate_value).toBe('1.0000000000');
        expect(orderRows.rows[0]?.total_points).toBe('5000.0000000000');

        // The resolver still serves the legacy rate (its window covers NOW).
        const effective = await owner.getEffectiveRate(market);
        expect(effective.id).toBe(legacy);
      });
    });

    // ─── §10. Idempotency (7 items) ───────────────────────────────────

    describe('§10 idempotency contract', () => {
      it('replays the original result for the same key and payload', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `idem-${randomUUID()}`;
        const payload = ownerPayload({ marketId: market, rateValue: '1.00' });
        const first = await scheduleRate(
          admin.token,
          market,
          payload,
          key,
        ).expect(201);
        const firstId = (first.body as { id: string }).id;
        const replay = await scheduleRate(
          admin.token,
          market,
          payload,
          key,
        ).expect(201);
        expect((replay.body as { id: string }).id).toBe(firstId);
        const rows = await database.db
          .select({ id: redemptionRateVersions.id })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, market));
        expect(rows).toHaveLength(1);
      });

      it('rejects the same key with a different rate (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `idem-${randomUUID()}`;
        const start = klMidnightIso(4);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: start,
          }),
          key,
        ).expect(201);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.50',
            effectiveFrom: start,
          }),
          key,
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
        );
      });

      it('rejects the same key with a different effective date (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `idem-${randomUUID()}`;
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: klMidnightIso(4),
          }),
          key,
        ).expect(201);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: klMidnightIso(5),
          }),
          key,
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
        );
      });

      it('rejects the same key with a different reason (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `idem-${randomUUID()}`;
        const start = klMidnightIso(4);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: start,
            reason: 'Original reason',
          }),
          key,
        ).expect(201);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: start,
            reason: 'Different reason',
          }),
          key,
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
        );
      });

      it('commits a single result for concurrent duplicate requests (same key)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `race-key-${randomUUID()}`;
        const payload = ownerPayload({ marketId: market, rateValue: '1.00' });
        const [left, right] = await Promise.all([
          scheduleRate(admin.token, market, payload, key),
          scheduleRate(admin.token, market, payload, key),
        ]);
        expect(left.status).toBe(201);
        expect(right.status).toBe(201);
        expect((left.body as { id: string }).id).toBe(
          (right.body as { id: string }).id,
        );
        const rows = await database.db
          .select({ id: redemptionRateVersions.id })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, market));
        expect(rows).toHaveLength(1);
      });

      it('rolls back atomically on failure and leaves no fake success record', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `atomic-${randomUUID()}`;
        const actor = fullActor(admin.adminUserId, market);
        const input = {
          marketId: market,
          rateType: 'POINTS_PER_CURRENCY' as const,
          rateValue: '1.00',
          fiatCurrency: 'MYR',
          effectiveFrom: klMidnightIso(4),
          reason: 'Atomic rollback evidence',
          idempotencyKey: key,
        };
        const auditBefore = await database.db
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(eq(auditLogs.action, 'redemption.rate_version.create'));
        const spy = vi
          .spyOn(auditService, 'appendWithinTransaction')
          .mockImplementationOnce(async () => {
            throw new Error('injected audit failure');
          });
        await expect(inProcessCreate(actor, input)).rejects.toThrow(
          'injected audit failure',
        );
        spy.mockRestore();

        // No version row, no NEW audit row, no mechanism claim.
        const versionCount = await database.db
          .select({ id: redemptionRateVersions.id })
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.marketId, market));
        expect(versionCount).toHaveLength(0);
        const auditAfter = await database.db
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(eq(auditLogs.action, 'redemption.rate_version.create'));
        expect(auditAfter).toHaveLength(auditBefore.length);
        const claimCount = await database.db
          .select({ id: merchantApiIdempotencyKeys.id })
          .from(merchantApiIdempotencyKeys)
          .where(eq(merchantApiIdempotencyKeys.key, key));
        expect(claimCount).toHaveLength(0);

        // The same key can be retried after the correction → success.
        const retry = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: klMidnightIso(4),
            reason: 'Atomic rollback evidence',
          }),
          key,
        ).expect(201);
        expect((retry.body as { id: string }).id).toBeTruthy();
      });

      it('keeps create and cancel idempotency scopes independent (recorded)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `cross-op-${randomUUID()}`;
        const start = klMidnightIso(4);
        // Same key used for a CREATE first…
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: start,
          }),
          key,
        ).expect(201);
        // …then for a CANCEL of a different scheduled version: the scopes
        // are per-operation (create:<market>:<admin> vs cancel:<market>:<admin>,
        // D-053 §10 scope examples), so the same key legitimately names an
        // operation within EACH scope. Same-key/different-payload conflicts
        // are enforced WITHIN a scope (covered by the cancel suite).
        const second = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '2.00',
            effectiveFrom: klMidnightIso(5),
          }),
          `key-${randomUUID()}`,
        ).expect(201);
        const secondId = (second.body as { id: string }).id;
        const cancelled = await cancelRate(
          admin.token,
          secondId,
          'Cross-operation key evidence',
          key,
        ).expect(200);
        expect((cancelled.body as { id: string }).id).toBeTruthy();
      });
    });

    // ─── §11. Reason + immutable audit (8 items) ──────────────────────

    describe('§11 reason and audit contract', () => {
      it('rejects a missing reason (400)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const missing: Record<string, unknown> = {
          ...ownerPayload({ marketId: market }),
        };
        delete missing['reason'];
        await scheduleRate(admin.token, market, missing).expect(400);
      });

      it('rejects a blank reason (400)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, reason: '   ' }),
        ).expect(400);
      });

      it('rejects an overlength reason (400)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, reason: 'x'.repeat(501) }),
        ).expect(400);
      });

      it('accepts the 1-char and 500-char reason boundaries', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: klMidnightIso(4),
            reason: 'x',
          }),
        ).expect(201);
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.50',
            effectiveFrom: klMidnightIso(5),
            reason: 'x'.repeat(500),
          }),
        ).expect(201);
      });

      it('writes the owner audit with actor, market, rate and request id', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const reason = 'Audited schedule — Q3 governance review';
        const key = `audit-${randomUUID()}`;
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
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
              eq(auditLogs.action, 'redemption.rate_version.create'),
              eq(auditLogs.marketId, market),
            ),
          );
        const record = auditRows.find((row) => row.entityId === versionId);
        expect(record).toBeTruthy();
        expect(record?.actorId).toBe(admin.adminUserId);
        expect(record?.reason).toBe(reason);
        expect((record?.after as { rateValue?: string })?.rateValue).toBe(
          '1.0000000000',
        );
        expect((record?.after as { rateType?: string })?.rateType).toBe(
          'POINTS_PER_CURRENCY',
        );
        expect(record?.requestId).toBeTypeOf('string');
        expect((record?.requestId ?? '').length).toBeGreaterThan(0);
        expect(record?.result).toBe('SUCCESS');
      });

      it('stores the reason durably on the version row', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const reason = 'Durable reason on the version row';
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, reason }),
        ).expect(201);
        const versionId = (body.body as { id: string }).id;
        const rows = await database.db
          .select()
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.id, versionId));
        expect(rows[0]?.reason).toBe(reason);
      });

      it('records the mechanism row with hash, status code and response id', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const key = `audit-${randomUUID()}`;
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
          key,
        ).expect(201);
        const versionId = (body.body as { id: string }).id;
        const idemRows = await database.db
          .select()
          .from(merchantApiIdempotencyKeys)
          .where(eq(merchantApiIdempotencyKeys.key, key));
        expect(idemRows[0]?.statusCode).toBe(201);
        expect(idemRows[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/u);
        expect((idemRows[0]?.response as { id?: string })?.id).toBe(versionId);
      });

      it('keeps the legacy NULL reason untouched (explicit legacy representation)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const legacy = await seedRateVersion({
          marketId: market,
          rateValue: '0.0100000000',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          createdBy: admin.adminUserId,
          reason: null,
        });
        await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        const rows = await database.db
          .select()
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.id, legacy));
        expect(rows[0]?.reason).toBeNull();
      });
    });

    // ─── §9. Cancellation (10 items) ──────────────────────────────────

    describe('§9 cancellation contract', () => {
      it('cancels a scheduled future version via an immutable event (200)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        const versionId = (body.body as { id: string }).id;

        const cancelled = await cancelRate(
          admin.token,
          versionId,
          'Rate review: schedule withdrawn',
        ).expect(200);
        const result = cancelled.body as {
          id: string;
          rateVersionId: string;
          marketId: string;
          reason: string;
        };
        expect(result.rateVersionId).toBe(versionId);
        expect(result.marketId).toBe(market);
        expect(result.reason).toBe('Rate review: schedule withdrawn');

        // The immutable version row is untouched (no UPDATE, no end set).
        const rows = await database.db
          .select()
          .from(redemptionRateVersions)
          .where(eq(redemptionRateVersions.id, versionId));
        expect(rows[0]?.effectiveUntil).toBeNull();
        expect(rows[0]?.effectiveFrom.toISOString()).toBe(
          (body.body as { effectiveFrom: string }).effectiveFrom,
        );
        // The list surface marks it CANCELLED.
        const list = await supertest(server)
          .get(ratesUrl(market))
          .set(authorized(admin.token))
          .expect(200);
        const listed = (
          list.body as { versions: Array<{ id: string; status: string }> }
        ).versions.find((v) => v.id === versionId);
        expect(listed?.status).toBe('CANCELLED');
      });

      it('ignores cancelled versions in the resolver (never effective)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        // Legacy row whose window covers NOW, plus a cancellation event.
        const legacy = await seedRateVersion({
          marketId: market,
          rateValue: '1.0000000000',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          createdBy: admin.adminUserId,
        });
        await seedCancellation(legacy, market, admin.adminUserId);
        // The resolver must not serve a cancelled version even though its
        // window covers NOW.
        await expect(owner.getEffectiveRate(market)).rejects.toMatchObject({
          code: 'REDEMPTION_RATE_NOT_FOUND',
        });
        // And a member quote cannot lock a cancelled version either.
        const memberId = await seedMember();
        const itemId = await seedCatalogItem(market, admin.adminUserId);
        await expect(
          owner.generateQuote(memberId, market, itemId, 1),
        ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_NOT_FOUND' });
      });

      it('rejects cancelling an active (effective) version (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const active = await seedRateVersion({
          marketId: market,
          rateValue: '1.0000000000',
          effectiveFrom: '2026-01-01T00:00:00.000Z', // covers NOW
          createdBy: admin.adminUserId,
        });
        const body = await cancelRate(
          admin.token,
          active,
          'Should not cancel an active rate',
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
        );
      });

      it('rejects cancelling an expired version (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const expired = await seedRateVersion({
          marketId: market,
          rateValue: '0.0100000000',
          effectiveFrom: '2020-01-01T00:00:00.000Z',
          effectiveUntil: '2020-02-01T00:00:00.000Z',
          createdBy: admin.adminUserId,
        });
        const body = await cancelRate(
          admin.token,
          expired,
          'Should not cancel an expired rate',
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
        );
      });

      it('rejects cancelling a historically used version (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const used = await seedRateVersion({
          marketId: market,
          rateValue: '1.0000000000',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          createdBy: admin.adminUserId,
        });
        const memberId = await seedMember();
        const itemId = await seedCatalogItem(market, admin.adminUserId);
        await seedQuote(market, memberId, itemId, used, '1.0000000000');
        const body = await cancelRate(
          admin.token,
          used,
          'Should not cancel a used rate',
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
        );
      });

      it('keeps cancellation records append-only (UPDATE/DELETE rejected)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        const versionId = (body.body as { id: string }).id;
        const cancelled = await cancelRate(
          admin.token,
          versionId,
          'Append-only evidence',
        ).expect(200);
        const cancellationId = (cancelled.body as { id: string }).id;

        await expect(
          database.db.execute(
            sql`UPDATE redemption_rate_cancellations
                SET reason = 'tampered'
                WHERE id = ${cancellationId}`,
          ),
        ).rejects.toThrow();
        await expect(
          database.db.execute(
            sql`DELETE FROM redemption_rate_cancellations
                WHERE id = ${cancellationId}`,
          ),
        ).rejects.toThrow();
        const rows = await database.db
          .select()
          .from(redemptionRateCancellations)
          .where(eq(redemptionRateCancellations.id, cancellationId));
        expect(rows[0]?.reason).toBe('Append-only evidence');
      });

      it('replays the original cancellation for the same key and payload', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        const versionId = (body.body as { id: string }).id;
        const key = `cancel-idem-${randomUUID()}`;
        const first = await cancelRate(
          admin.token,
          versionId,
          'Cancellation replay evidence',
          key,
        ).expect(200);
        const firstId = (first.body as { id: string }).id;
        const replay = await cancelRate(
          admin.token,
          versionId,
          'Cancellation replay evidence',
          key,
        ).expect(200);
        expect((replay.body as { id: string }).id).toBe(firstId);
        const rows = await database.db
          .select({ id: redemptionRateCancellations.id })
          .from(redemptionRateCancellations)
          .where(eq(redemptionRateCancellations.rateVersionId, versionId));
        expect(rows).toHaveLength(1);
      });

      it('rejects the same cancel key with a different reason (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        const versionId = (body.body as { id: string }).id;
        const key = `cancel-reason-${randomUUID()}`;
        await cancelRate(
          admin.token,
          versionId,
          'Original cancellation reason',
          key,
        ).expect(200);
        const conflict = await cancelRate(
          admin.token,
          versionId,
          'A different cancellation reason',
          key,
        ).expect(409);
        expect((conflict.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
        );
      });

      it('rejects the same cancel key for a different target version (409)', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const first = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.00',
            effectiveFrom: klMidnightIso(4),
          }),
        ).expect(201);
        const second = await scheduleRate(
          admin.token,
          market,
          ownerPayload({
            marketId: market,
            rateValue: '1.50',
            effectiveFrom: klMidnightIso(5),
          }),
        ).expect(201);
        const firstId = (first.body as { id: string }).id;
        const secondId = (second.body as { id: string }).id;
        const key = `cancel-version-${randomUUID()}`;
        await cancelRate(
          admin.token,
          firstId,
          'Cancel first version',
          key,
        ).expect(200);
        const conflict = await cancelRate(
          admin.token,
          secondId,
          'Cancel first version', // same reason — different target
          key,
        ).expect(409);
        expect((conflict.body as ErrorBody).error.code).toBe(
          'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
        );
      });

      it('enforces the same authorization and market on in-process cancels', async () => {
        const market = await freshConfiguredMarket();
        const admin = await createAdmin({ marketIds: [market] });
        await setCurrentMarket(admin.accountId, market);
        const body = await scheduleRate(
          admin.token,
          market,
          ownerPayload({ marketId: market, rateValue: '1.00' }),
        ).expect(201);
        const versionId = (body.body as { id: string }).id;

        // No permission → denied.
        const readOnly = await createAdmin({
          marketIds: [market],
          // Same read-only profile as the in-process create test: an
          // admin WITHOUT redemption.rate.manage must be denied here.
          permissionCodes: ['redemption.catalog.manage'],
        });
        await expect(
          inProcessCancel(fullActor(readOnly.adminUserId, market), versionId, {
            reason: 'x',
            idempotencyKey: `ic-${randomUUID()}`,
          }),
        ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_PERMISSION_DENIED' });
        // Wrong current market → context mismatch.
        await expect(
          inProcessCancel(fullActor(admin.adminUserId, marketB), versionId, {
            reason: 'x',
            idempotencyKey: `ic-${randomUUID()}`,
          }),
        ).rejects.toMatchObject({
          code: 'REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH',
        });
        // Missing reason → required.
        await expect(
          inProcessCancel(fullActor(admin.adminUserId, market), versionId, {
            idempotencyKey: `ic-${randomUUID()}`,
          }),
        ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_REASON_REQUIRED' });
        // A valid in-process cancel succeeds with identical enforcement.
        const result = await inProcessCancel(
          fullActor(admin.adminUserId, market),
          versionId,
          {
            reason: 'In-process cancellation',
            idempotencyKey: `ic-${randomUUID()}`,
          },
        );
        expect(result.rateVersionId).toBe(versionId);
      });
    });
  },
);
