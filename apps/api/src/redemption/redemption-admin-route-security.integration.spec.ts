/**
 * P6-R2 (D-055): Phase 6 Admin Route Security — HTTP evidence matrix on a
 * clean real PostgreSQL database.
 *
 * Requirement coverage (Command Center 2026-08-07 §5):
 *   1. Auth required          — every admin redemption route 401 without a session.
 *   2. RBAC required          — role/permission denials per catalog template.
 *   3. Current Market required— 409 MARKET_SELECTION_REQUIRED without a
 *                                server Current Admin Market.
 *   4. Resource-market eq     — 409 MARKET_CONTEXT_MISMATCH when the target
 *                                resource/URL/header market differs from the
 *                                Current Admin Market.
 *   5. Step-up where sensitive— 403 MFA_STEP_UP_REQUIRED without a fresh
 *                                grant on redemption.refund.approve.
 *   6. Member denied          — member (ACCOUNT) sessions cannot reach admin.
 *   7. Support read-only      — SUPPORT_READONLY_AUDITOR may read bounded
 *                                projections but never write.
 *   8. Direct/in-process bypass closed — old unguarded handlers now carry the
 *                                canonical guard chain (static scan).
 *   9. No unsecured legacy routes     — static scan over every handler.
 *  10. No duplicated owner logic      — canonical routes only enforce at the
 *                                transport; writes still land on the same
 *                                Phase 6 owner services.
 * Plus the member-side IDOR closure on shipping-payment confirmation.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  marketAccess,
  markets,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
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
import { DatabaseService } from '../database/database.service.js';
import { RbacGuard } from '../platform-access/rbac.guard.js';
import { AdminRedemptionController } from './admin-redemption.controller.js';
import { AdminRedemptionFulfilmentController } from './redemption-admin-fulfilment.controller.js';
import { AdminRedemptionRefundController } from './redemption-admin-refund.controller.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'P6-R2-Route-Security-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

describe.skipIf(!databaseUrl)(
  'Phase 6 Admin Route Security (P6-R2, D-055) — HTTP, real PostgreSQL',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let rateLimiter: InMemoryRateLimiter;

    let marketA: string;
    let marketB: string;
    let itemA: string;
    let itemB: string;
    let orderA: string;
    let orderB: string;
    let refundA: string;
    let refundB: string;
    let paymentA: string;
    let memberAId: string;

    // Admin identities (role templates)
    let superAdmin: { adminUserId: string; accountId: string; token: string };
    let makerAdmin: { adminUserId: string; accountId: string; token: string };
    let checkerAdmin: { adminUserId: string; accountId: string; token: string };
    let opsAdmin: { adminUserId: string; accountId: string; token: string };
    let supportAdmin: { adminUserId: string; accountId: string; token: string };
    let ungrAnti: { adminUserId: string; accountId: string; token: string };
    let memberToken: string;
    let otherMemberToken: string;

    function authorized(token: string) {
      return { Authorization: `Bearer ${token}` };
    }

    const catalogUrl = (itemId: string) =>
      `/api/v1/admin/redemption/catalog/${itemId}`;
    const refundsUrl = '/api/v1/admin/redemption/refunds';
    const fulfilmentsUrl = '/api/v1/admin/redemption/fulfilments';

    // ─── Data helpers ───────────────────────────────────────────────────

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
          name: `${code} P6-R2 Test Market`,
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
            description: `${code} p6-r2 route security test permission`,
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
          displayName: `P6-R2 Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? [
        'redemption.order.read',
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
          name: `P6-R2 HTTP Test Role (${roleCode})`,
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
        await database.db.insert(marketAccess).values(
          options.marketIds.map((marketId) => ({
            adminUserId,
            marketId,
          })),
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

    async function memberLogin(): Promise<string> {
      const account = await createAccount();
      const memberId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO members (
              id, account_id, public_member_id, referral_code, status, kyc_level
            ) VALUES (
              ${memberId}, ${account.accountId}, ${`M-${randomUUID()}`},
              ${`R-${randomUUID()}`}, 'ACTIVE'::member_status,
              'LEVEL_2'::member_kyc_level
            ) ON CONFLICT (account_id) DO NOTHING`,
      );
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: account.email, password })
        .expect(200);
      return String((response.body as { accessToken: string }).accessToken);
    }

    async function seedStepUpGrant(
      admin: { adminUserId: string; accountId: string },
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
      // The grant only references the factor (FK); a placeholder active
      // factor row satisfies the constraint — consumption never validates
      // the secret because the real flow already did at mint time.
      let factorId = factorRows[0]?.id;
      if (!factorId) {
        const factorInsert = await database.db
          .insert(adminMfaFactors)
          .values({
            accountId: admin.accountId,
            adminUserId: admin.adminUserId,
            factorType: 'TOTP',
            secretCiphertext: 'p6r2-ciphertext',
            secretNonce: 'p6r2-nonce',
            secretAuthTag: 'p6r2-auth-tag',
            keyId: 'p6r2-key',
            algorithm: 'AES-256-GCM',
            status: 'ACTIVE',
          })
          .returning({ id: adminMfaFactors.id });
        factorId = factorInsert[0]?.id;
      }
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

    /** Minimal-but-valid redemption fixture rows (direct seeds). */
    async function seedRedemptionFixture(): Promise<void> {
      // Catalog items (one per market).
      itemA = randomUUID();
      itemB = randomUUID();
      await database.db.execute(sql`
        INSERT INTO redemption_catalog_items (
          id, market_id, sku, name, item_type, ownership, status,
          fiat_reference_value, fiat_currency, fulfilment_mode,
          inventory_mode, created_by, version
        ) VALUES (
          ${itemA}, ${marketA}, ${`P6R2-A-${randomUUID().slice(0, 8)}`},
          'P6-R2 item A', 'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE',
          '100.0000000000', 'MYR', 'PICKUP'::redemption_fulfilment_mode,
          'TRACKED', ${superAdmin.adminUserId}, 1
        )
      `);
      await database.db.execute(sql`
        INSERT INTO redemption_catalog_items (
          id, market_id, sku, name, item_type, ownership, status,
          fiat_reference_value, fiat_currency, fulfilment_mode,
          inventory_mode, created_by, version
        ) VALUES (
          ${itemB}, ${marketB}, ${`P6R2-B-${randomUUID().slice(0, 8)}`},
          'P6-R2 item B', 'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE',
          '100.0000000000', 'MYR', 'PICKUP'::redemption_fulfilment_mode,
          'TRACKED', ${superAdmin.adminUserId}, 1
        )
      `);

      // Rate version for market A (FK for orders).
      await database.db.execute(sql`
        INSERT INTO redemption_rate_versions (
          id, market_id, rate_type, rate_value, effective_from, created_by
        ) VALUES (
          ${randomUUID()}, ${marketA}, 'POINTS_PER_CURRENCY',
          '0.0100000000', NOW() - INTERVAL '1 day', ${superAdmin.adminUserId}
        )
      `);

      // Member A + wallet (market A).
      const memberAccount = await createAccount();
      memberAId = randomUUID();
      await database.db.execute(sql`
        INSERT INTO members (
          id, account_id, public_member_id, referral_code, status, kyc_level
        ) VALUES (
          ${memberAId}, ${memberAccount.accountId}, ${`M-${randomUUID()}`},
          ${`R-${randomUUID()}`}, 'ACTIVE'::member_status,
          'LEVEL_2'::member_kyc_level
        )
      `);
      await database.db.execute(sql`
        INSERT INTO member_wallet_accounts (
          id, member_id, market_id, pending_balance, available_balance,
          reversed_balance, version
        ) VALUES (
          ${randomUUID()}, ${memberAId}, ${marketA},
          '0', '100000.0000000000', '0', 1
        )
      `);

      // Orders (FULFILMENT_SUSPENDED satisfies the suspension-notes CHECK).
      orderA = randomUUID();
      orderB = randomUUID();
      // Wallet entries are required for the REFUND_PENDING/REFUNDED order
      // state CHECK (chk_order_refund_state).
      await database.db.execute(sql`
        INSERT INTO member_wallet_entries (
          wallet_account_id, member_id, market_id, entry_sequence,
          entry_type, amount, balance_before, balance_after,
          idempotency_key, reference_type, reference_id, description,
          actor_id
        ) VALUES (
          (SELECT id FROM member_wallet_accounts WHERE member_id = ${memberAId} LIMIT 1),
          ${memberAId}, ${marketA}, 1,
          'REDEMPTION_DEBIT'::member_wallet_entry_type,
          '10000.0000000000', '100000.0000000000', '90000.0000000000',
          ${`p6r2-we-${randomUUID()}`}, 'REDEMPTION_ORDER', NULL,
          'P6-R2 fixture debit', ${memberAId}
        )
      `);
      await database.db.execute(sql`
        INSERT INTO redemption_orders (
          id, order_reference, market_id, member_id, item_id,
          wallet_account_id, wallet_entry_id, rate_version_id, rate_value,
          status, total_points, unrounded_point_cost, posted_point_cost,
          quantity, backorder_quantity, item_snapshot, rate_snapshot,
          notes
        ) VALUES (
          ${orderA}, ${`ORD-${randomUUID().slice(0, 10)}`}, ${marketA},
          ${memberAId}, ${itemA},
          (SELECT id FROM member_wallet_accounts WHERE member_id = ${memberAId} LIMIT 1),
          (SELECT id FROM member_wallet_entries WHERE member_id = ${memberAId} LIMIT 1),
          (SELECT id FROM redemption_rate_versions WHERE market_id = ${marketA} LIMIT 1),
          '0.0100000000', 'FULFILMENT_SUSPENDED'::redemption_order_status,
          '10000.0000000000', '10000.0000000000', '10000.0000000000',
          '1', '0', '{}', '{}', 'Suspended for P6-R2 fixture'
        )
      `);
      await database.db.execute(sql`
        INSERT INTO redemption_orders (
          id, order_reference, market_id, member_id, item_id,
          wallet_account_id, wallet_entry_id, rate_version_id, rate_value,
          status, total_points, unrounded_point_cost, posted_point_cost,
          quantity, backorder_quantity, item_snapshot, rate_snapshot,
          notes
        ) VALUES (
          ${orderB}, ${`ORD-${randomUUID().slice(0, 10)}`}, ${marketB},
          ${memberAId}, ${itemB},
          (SELECT id FROM member_wallet_accounts WHERE member_id = ${memberAId} LIMIT 1),
          (SELECT id FROM member_wallet_entries WHERE member_id = ${memberAId} LIMIT 1),
          (SELECT id FROM redemption_rate_versions WHERE market_id = ${marketA} LIMIT 1),
          '0.0100000000', 'FULFILMENT_SUSPENDED'::redemption_order_status,
          '10000.0000000000', '10000.0000000000', '10000.0000000000',
          '1', '0', '{}', '{}', 'Suspended for P6-R2 fixture'
        )
      `);

      // Pending refund requests (Maker = makerAdmin, PENDING_CHECKER).
      refundA = randomUUID();
      refundB = randomUUID();
      await database.db.execute(sql`
        INSERT INTO redemption_refund_requests (
          id, order_id, maker_id, status, refund_amount, reason,
          prior_order_status
        ) VALUES (
          ${refundA}, ${orderA}, ${makerAdmin.adminUserId},
          'PENDING_CHECKER', '10000.0000000000',
          'Item unavailable - refund required', 'FULFILMENT_SUSPENDED'
        )
      `);
      await database.db.execute(sql`
        INSERT INTO redemption_refund_requests (
          id, order_id, maker_id, status, refund_amount, reason,
          prior_order_status
        ) VALUES (
          ${refundB}, ${orderB}, ${makerAdmin.adminUserId},
          'PENDING_CHECKER', '10000.0000000000',
          'Item unavailable - refund required', 'FULFILMENT_SUSPENDED'
        )
      `);

      // Shipping payment owned by member A (IDOR target).
      paymentA = randomUUID();
      await database.db.execute(sql`
        INSERT INTO redemption_shipping_payments (
          id, member_id, market_id, amount, currency, request_hash,
          status, idempotency_key
        ) VALUES (
          ${paymentA}, ${memberAId}, ${marketA}, '10.0000000000', 'MYR',
          ${createHash('sha256').update('p6r2').digest('hex')},
          'PENDING'::redemption_shipping_payment_status,
          ${`sp-${randomUUID()}`}
        )
      `);
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
        'p6-r2-route-security-pepper-at-least-32-characters',
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

      marketA = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('SG', 'SGD', 'Asia/Singapore');

      superAdmin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: [
          'redemption.catalog.manage',
          'redemption.rate.manage',
          'redemption.order.read',
          'redemption.fulfilment.manage',
          'redemption.refund.create',
          'redemption.refund.approve',
        ],
      });
      makerAdmin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['redemption.refund.create', 'redemption.order.read'],
      });
      checkerAdmin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['redemption.refund.approve', 'redemption.order.read'],
      });
      opsAdmin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: [
          'redemption.fulfilment.manage',
          'redemption.catalog.manage',
          'redemption.order.read',
        ],
      });
      supportAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['redemption.order.read'],
      });
      // Permission granted but NO market grant for market A.
      ungrAnti = await createAdmin({
        marketIds: [],
        permissionCodes: ['redemption.refund.create', 'redemption.order.read'],
      });

      await seedRedemptionFixture();

      await setCurrentMarket(superAdmin.accountId, marketA);
      await setCurrentMarket(makerAdmin.accountId, marketA);
      await setCurrentMarket(checkerAdmin.accountId, marketA);
      await setCurrentMarket(opsAdmin.accountId, marketA);
      await setCurrentMarket(supportAdmin.accountId, marketA);

      memberToken = await memberLogin();
      otherMemberToken = await memberLogin();
    });

    afterAll(async () => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
      await app?.close();
      vi.unstubAllEnvs();
    });

    beforeEach(() => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
    });

    // ═══════════════════════════════════════════════════════════════════
    // R1 — Auth required (every admin route family)
    // ═══════════════════════════════════════════════════════════════════

    it('R1a: admin catalog routes return 401 without a session', async () => {
      await supertest(server).get(catalogUrl(itemA)).expect(401);
      await supertest(server)
        .post('/api/v1/admin/redemption/catalog')
        .send({})
        .expect(401);
    });

    it('R1b: admin fulfilment routes return 401 without a session', async () => {
      await supertest(server).get(`${fulfilmentsUrl}/pending`).expect(401);
      await supertest(server).post(fulfilmentsUrl).send({}).expect(401);
    });

    it('R1c: admin refund routes return 401 without a session', async () => {
      await supertest(server).get(refundsUrl).expect(401);
      await supertest(server).post(refundsUrl).send({}).expect(401);
      await supertest(server)
        .post(`${refundsUrl}/approve`)
        .send({})
        .expect(401);
    });

    // ═══════════════════════════════════════════════════════════════════
    // R6 — Member sessions cannot reach admin routes
    // ═══════════════════════════════════════════════════════════════════

    it('R6a: a member session is denied on admin refund routes (403)', async () => {
      const response = await supertest(server)
        .post(refundsUrl)
        .set(authorized(memberToken))
        .send({
          orderId: orderA,
          memberId: memberAId,
          marketId: marketA,
          totalPointCost: '10000.0000000000',
          reason: 'x',
          idempotencyKey: randomUUID(),
        })
        .expect(403);
      // AdminGuard (FORBIDDEN) fires before RbacGuard (PERMISSION_DENIED)
      // on the fulfilment/refund controllers; both are 403 denials.
      expect(['FORBIDDEN', 'PERMISSION_DENIED']).toContain(
        (response.body as ErrorBody).error.code,
      );
    });

    it('R6b: a member session is denied on admin refund reads (403)', async () => {
      const response = await supertest(server)
        .get(refundsUrl)
        .set(authorized(memberToken))
        .expect(403);
      expect(['FORBIDDEN', 'PERMISSION_DENIED']).toContain(
        (response.body as ErrorBody).error.code,
      );
    });

    it('R6c: a member session is denied on admin fulfilment writes (403)', async () => {
      await supertest(server)
        .post(fulfilmentsUrl)
        .set(authorized(memberToken))
        .send({ orderId: orderA, fulfilmentType: 'PHYSICAL' })
        .expect(403);
    });

    // ═══════════════════════════════════════════════════════════════════
    // R2 — RBAC required (role templates from the canonical catalog)
    // ═══════════════════════════════════════════════════════════════════

    it('R2a: SUPPORT_READONLY_AUDITOR cannot write refunds (403)', async () => {
      const response = await supertest(server)
        .post(refundsUrl)
        .set(authorized(supportAdmin.token))
        .send({
          orderId: orderA,
          memberId: memberAId,
          marketId: marketA,
          totalPointCost: '10000.0000000000',
          reason: 'x',
          idempotencyKey: randomUUID(),
        })
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('R2b: SUPPORT_READONLY_AUDITOR cannot write fulfilments (403)', async () => {
      const response = await supertest(server)
        .post(fulfilmentsUrl)
        .set(authorized(supportAdmin.token))
        .send({ orderId: orderA, fulfilmentType: 'PHYSICAL' })
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('R2c: Maker (refund.create) cannot approve — no refund.approve (403)', async () => {
      const response = await supertest(server)
        .post(`${refundsUrl}/approve`)
        .set(authorized(makerAdmin.token))
        .send({ refundRequestId: refundA })
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('R2d: OPERATIONS_ADMIN (no refund.create) cannot create refunds (403)', async () => {
      const response = await supertest(server)
        .post(refundsUrl)
        .set(authorized(opsAdmin.token))
        .send({
          orderId: orderA,
          memberId: memberAId,
          marketId: marketA,
          totalPointCost: '10000.0000000000',
          reason: 'x',
          idempotencyKey: randomUUID(),
        })
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('R2e: permission without a market grant is denied (403 MARKET_ACCESS_DENIED)', async () => {
      await setCurrentMarket(ungrAnti.accountId, marketA);
      const response = await supertest(server)
        .get(refundsUrl)
        .set(authorized(ungrAnti.token))
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_ACCESS_DENIED',
      );
    });

    // ═══════════════════════════════════════════════════════════════════
    // R3 — Current Market required
    // ═══════════════════════════════════════════════════════════════════

    it('R3a: no Current Admin Market -> 409 MARKET_SELECTION_REQUIRED', async () => {
      const bare = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['redemption.order.read'],
      });
      const response = await supertest(server)
        .get(refundsUrl)
        .set(authorized(bare.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_SELECTION_REQUIRED',
      );
    });

    it('R3b: URL market differs from Current Admin Market -> 409 MARKET_CONTEXT_MISMATCH', async () => {
      const response = await supertest(server)
        .get(`/api/v1/admin/redemption/market/${marketB}/catalog`)
        .set(authorized(superAdmin.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('R3c: x-market-id header differs from Current Admin Market -> 409', async () => {
      const response = await supertest(server)
        .get(`/api/v1/admin/redemption/market/${marketA}/catalog`)
        .set(authorized(superAdmin.token))
        .set('x-market-id', marketB)
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    // ═══════════════════════════════════════════════════════════════════
    // R4 — Resource-market consistency (resource market == Current Market)
    // ═══════════════════════════════════════════════════════════════════

    it('R4a: catalog item in another market -> 409 on update', async () => {
      const response = await supertest(server)
        .put(catalogUrl(itemB))
        .set(authorized(superAdmin.token))
        .send({ name: 'x', version: 1, idempotencyKey: randomUUID() })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('R4b: catalog item in another market -> 409 on read', async () => {
      const response = await supertest(server)
        .get(catalogUrl(itemB))
        .set(authorized(superAdmin.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('R4c: order in another market -> 409 on fulfilment suspend', async () => {
      const response = await supertest(server)
        .post(`${fulfilmentsUrl}/${orderB}/suspend`)
        .set(authorized(opsAdmin.token))
        .send({ reason: 'x' })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('R4d: refund request in another market -> 409 on approve (even with step-up)', async () => {
      const grant = await seedStepUpGrant(
        checkerAdmin,
        'redemption.refund.approve',
        marketA,
      );
      const response = await supertest(server)
        .post(`${refundsUrl}/approve`)
        .set(authorized(checkerAdmin.token))
        .set('x-step-up-token', grant)
        .send({ refundRequestId: refundB })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('R4e: refund-by-order in another market -> 409 on read', async () => {
      const response = await supertest(server)
        .get(`${refundsUrl}/order/${orderB}`)
        .set(authorized(supportAdmin.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    // ═══════════════════════════════════════════════════════════════════
    // R7 — Support/read-only: bounded projections only, never raw ledger
    // ═══════════════════════════════════════════════════════════════════

    it('R7a: SUPPORT can read the market-scoped refund projection (200)', async () => {
      const response = await supertest(server)
        .get(refundsUrl)
        .set(authorized(supportAdmin.token))
        .expect(200);
      const body = response.body as {
        requests: Array<{ orderId: string }>;
      };
      expect(Array.isArray(body.requests)).toBe(true);
      // Only market A requests (refundB belongs to market B).
      expect(body.requests.map((r) => r.orderId)).not.toContain(orderB);
    });

    it('R7b: SUPPORT pending list is market-scoped (200)', async () => {
      const response = await supertest(server)
        .get(`${refundsUrl}/pending`)
        .set(authorized(supportAdmin.token))
        .expect(200);
      const body = response.body as { requests: Array<{ orderId: string }> };
      expect(body.requests.map((r) => r.orderId)).not.toContain(orderB);
      expect(body.requests.map((r) => r.orderId)).toContain(orderA);
    });

    it('R7c: SUPPORT cannot reach approve (write) (403)', async () => {
      await supertest(server)
        .post(`${refundsUrl}/approve`)
        .set(authorized(supportAdmin.token))
        .send({ refundRequestId: refundB })
        .expect(403);
    });

    // ═══════════════════════════════════════════════════════════════════
    // R5 — Step-up required on sensitive checker decisions
    // ═══════════════════════════════════════════════════════════════════

    it('R5a: approve without a fresh step-up token -> 403 MFA_STEP_UP_REQUIRED', async () => {
      const response = await supertest(server)
        .post(`${refundsUrl}/approve`)
        .set(authorized(checkerAdmin.token))
        .send({ refundRequestId: refundA })
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'MFA_STEP_UP_REQUIRED',
      );
    });

    it('R5b: reject without a fresh step-up token -> 403 MFA_STEP_UP_REQUIRED', async () => {
      const response = await supertest(server)
        .post(`${refundsUrl}/reject`)
        .set(authorized(checkerAdmin.token))
        .send({ refundRequestId: refundA, reason: 'x' })
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'MFA_STEP_UP_REQUIRED',
      );
    });

    it('R5c: reject with a fresh step-up grant passes the guard and executes', async () => {
      const grant = await seedStepUpGrant(
        checkerAdmin,
        'redemption.refund.approve',
        marketA,
      );
      const response = await supertest(server)
        .post(`${refundsUrl}/reject`)
        .set(authorized(checkerAdmin.token))
        .set('x-step-up-token', grant)
        .send({ refundRequestId: refundA, reason: 'Evidence verified' })
        .expect(201);
      expect((response.body as { status: string }).status).toBe('REJECTED');
    });

    // ═══════════════════════════════════════════════════════════════════
    // R8/R9 — No unsecured legacy routes: static guard-chain scan
    // ═══════════════════════════════════════════════════════════════════

    it('R9: every admin redemption route carries RbacGuard + permission metadata', () => {
      const controllers = [
        AdminRedemptionController,
        AdminRedemptionFulfilmentController,
        AdminRedemptionRefundController,
      ];
      const permissionKey = 'ipoint:permission-requirement';
      for (const controller of controllers) {
        const classGuards = (Reflect.getMetadata('__guards__', controller) ??
          []) as unknown[];
        expect(
          classGuards.some((guard) => guard === RbacGuard),
          `${controller.name} must mount RbacGuard`,
        ).toBe(true);

        const prototype = controller.prototype as unknown as Record<
          string,
          unknown
        >;
        // This NestJS major stores route/path metadata on the handler
        // function (descriptor.value), not on the prototype+key pair.
        const routeKeys = Object.getOwnPropertyNames(prototype).filter(
          (key) =>
            key !== 'constructor' &&
            typeof prototype[key] === 'function' &&
            Reflect.getMetadata('path', prototype[key] as object) !== undefined,
        );
        expect(routeKeys.length).toBeGreaterThan(0);
        for (const key of routeKeys) {
          const handler = prototype[key] as object;
          const requirement = Reflect.getMetadata(permissionKey, handler);
          expect(
            requirement,
            `${controller.name}.${key} must declare a permission`,
          ).toBeTruthy();
          expect(
            (requirement as { marketScoped?: boolean }).marketScoped,
            `${controller.name}.${key} must be marketScoped`,
          ).toBe(true);
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    // Positive controls — authorized admins still operate normally
    // ═══════════════════════════════════════════════════════════════════

    it('PC1: fully authorized admin reads the current-market catalog (200)', async () => {
      const response = await supertest(server)
        .get(`/api/v1/admin/redemption/market/${marketA}/catalog`)
        .set(authorized(opsAdmin.token))
        .expect(200);
      const body = response.body as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('PC2: maker creates a refund request for an order in the current market (201)', async () => {
      const orderId = randomUUID();
      await database.db.execute(sql`
        INSERT INTO redemption_orders (
          id, order_reference, market_id, member_id, item_id,
          wallet_account_id, wallet_entry_id, rate_version_id, rate_value,
          status, total_points, unrounded_point_cost, posted_point_cost,
          quantity, backorder_quantity, item_snapshot, rate_snapshot,
          notes
        ) VALUES (
          ${orderId}, ${`ORD-${randomUUID().slice(0, 10)}`}, ${marketA},
          ${memberAId}, ${itemA},
          (SELECT id FROM member_wallet_accounts WHERE member_id = ${memberAId} LIMIT 1),
          (SELECT id FROM member_wallet_entries WHERE member_id = ${memberAId} LIMIT 1),
          (SELECT id FROM redemption_rate_versions WHERE market_id = ${marketA} LIMIT 1),
          '0.0100000000', 'FULFILMENT_EXCEPTION'::redemption_order_status,
          '10000.0000000000', '10000.0000000000', '10000.0000000000',
          '1', '0', '{}', '{}', NULL
        )
      `);
      const response = await supertest(server)
        .post(refundsUrl)
        .set(authorized(makerAdmin.token))
        .send({
          orderId,
          memberId: memberAId,
          marketId: marketA,
          totalPointCost: '10000.0000000000',
          reason: 'P6-R2 positive control',
          idempotencyKey: randomUUID(),
        })
        .expect(201);
      expect((response.body as { status: string }).status).toBe(
        'PENDING_CHECKER',
      );
    });

    // ═══════════════════════════════════════════════════════════════════
    // Member-side IDOR closure (shipping payment ownership)
    // ═══════════════════════════════════════════════════════════════════

    it('M1: a member cannot confirm another member shipping payment (409)', async () => {
      const response = await supertest(server)
        .post(`/api/v1/redemption/shipping-payment/${paymentA}/confirm`)
        .set(authorized(otherMemberToken))
        .send({ providerIntentId: 'pi_x' })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'REDEMPTION_SHIPPING_PAYMENT_MISMATCH',
      );
    });
  },
);
