import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  commissionLedger,
  commissionProcessing,
  markets,
  memberProfiles,
  memberWalletAccounts,
  memberWalletEntries,
  members,
  migrate,
  permissions,
  redemptionAuditLog,
  redemptionCatalogItems,
  redemptionFulfilmentAudit,
  redemptionFulfilments,
  redemptionInventory,
  redemptionOrders,
  redemptionPickupLocations,
  redemptionRateMarketRules,
  redemptionRateVersions,
  redemptionRefundRequests,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RedemptionService } from '../redemption/redemption.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'P7-S8-Redemption-Ops-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

/**
 * P7-S8 Admin Redemption Operations HTTP integration (Command Center
 * 2026-08-07 §6.2-§6.6) on a fresh real PostgreSQL database.
 *
 * Asserts through the Phase 7 adapter over the FROZEN Phase 6 owner:
 * - the six fulfilment status queues + the overview counts with the
 *   explicit rate-configuration capability state;
 * - order detail + owner-owned audit history;
 * - the orchestrated suspend/resume/retry (owner transitions + immutable
 *   audit rows);
 * - the SEC-02 refund queue/detail/status-history read face;
 * - the permission matrix (401 unauthenticated, 403 member / read-only
 *   write denial, read allowed for `redemption.order.read`);
 * - market isolation: URL market must equal the Current Admin Market
 *   (409 MARKET_CONTEXT_MISMATCH) and foreign-market orders are not
 *   reachable (404);
 * - the zero-commission invariant (OD-29): a full redemption flow creates
 *   NO commission ledger/processing rows.
 */
describe.skipIf(!databaseUrl)(
  'Admin Redemption Operations HTTP integration (P7-S8, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let redemption: RedemptionService;
    let marketA: string; // MY — rate-configured
    let marketB: string; // SG — no rate rule (rate_configured=false)
    let superAdmin: { adminUserId: string; accountId: string; token: string };
    let opsAdmin: { adminUserId: string; accountId: string; token: string };
    let supportAdmin: { adminUserId: string; accountId: string; token: string };
    let memberToken: string;
    let memberAId: string;
    let walletAId: string;

    const orders: Record<string, string> = {};
    const fulfilmentFailedId: string = randomUUID();
    let refundAId: string;

    function authorized(token: string) {
      return { Authorization: `Bearer ${token}` };
    }

    const queuesUrl = (marketId: string) =>
      `/api/v1/admin/redemption-fulfilment-ops/markets/${marketId}/queues`;
    const orderUrl = (marketId: string, orderId: string) =>
      `/api/v1/admin/redemption-fulfilment-ops/markets/${marketId}/orders/${orderId}`;
    const refundsUrl = (marketId: string) =>
      `/api/v1/admin/redemption-fulfilment-ops/markets/${marketId}/refunds`;

    async function ensureActiveMarket(
      code: string,
      currencyCode: string,
      timezone: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `${code} P7-S8 Redemption Test Market`,
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
            description: `${code} p7-s8 redemption ops test permission`,
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
          displayName: `P7-S8 Redemption Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleCode = options.roleCode ?? 'SUPER_ADMIN';
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: roleCode,
          name: `P7-S8 Redemption HTTP Test Role (${roleCode})`,
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
        options.permissionCodes ?? ['redemption.order.read'],
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
      await database.db.execute(
        sql`INSERT INTO market_access (admin_user_id, market_id) VALUES ${sql.join(
          options.marketIds.map(
            (marketId) => sql`(${adminUserId}, ${marketId})`,
          ),
          sql`, `,
        )}`,
      );
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

    async function createMemberWithWallet(marketId: string): Promise<{
      memberId: string;
      walletId: string;
    }> {
      const account = await createAccount();
      const memberId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO members (
              id, account_id, public_member_id, referral_code, status, kyc_level
            ) VALUES (
              ${memberId}, ${account.accountId}, ${`M-${randomUUID()}`},
              ${`R-${randomUUID()}`}, 'ACTIVE'::member_status,
              'LEVEL_2'::member_kyc_level
            )`,
      );
      await database.db.insert(memberProfiles).values({
        memberId,
        displayName: `Member ${memberId.slice(0, 8)}`,
      });
      const walletRows = await database.db
        .insert(memberWalletAccounts)
        .values({ memberId, marketId })
        .returning({ id: memberWalletAccounts.id });
      const walletId = walletRows[0]?.id ?? '';
      await database.db
        .update(memberWalletAccounts)
        .set({ availableBalance: '100000.0000000000' })
        .where(eq(memberWalletAccounts.id, walletId));
      return { memberId, walletId };
    }

    async function seedCatalogItem(marketId: string): Promise<string> {
      const itemId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO redemption_catalog_items (
              id, market_id, sku, name, item_type, ownership, status,
              fiat_reference_value, fiat_currency, fulfilment_mode,
              inventory_mode, created_by, version
            ) VALUES (
              ${itemId}, ${marketId}, ${`P7S8-${randomUUID().slice(0, 8)}`},
              'P7-S8 item', 'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE',
              '100.0000000000', 'MYR', 'PICKUP'::redemption_fulfilment_mode,
              'TRACKED', ${superAdmin.adminUserId}, 1
            )`,
      );
      await database.db.insert(redemptionInventory).values({
        itemId,
        totalQuantity: '100',
        committedQuantity: '0',
        fulfilledQuantity: '0',
        backorderQuantity: '0',
        version: 1,
      });
      return itemId;
    }

    /** Insert an order in the given status (with the required CHECK rows). */
    async function seedOrder(options: {
      marketId: string;
      status: string;
      notes?: string | null;
    }): Promise<string> {
      const orderId = randomUUID();
      const itemId = await seedCatalogItem(options.marketId);
      const walletEntryId = await seedWalletEntry(options.marketId);
      await database.db.insert(redemptionOrders).values({
        id: orderId,
        orderReference: `ORD-${randomUUID().slice(0, 10)}`,
        marketId: options.marketId,
        memberId: memberAId,
        itemId,
        walletAccountId: walletAId,
        walletEntryId,
        rateVersionId:
          (
            await database.db
              .select({ id: redemptionRateVersions.id })
              .from(redemptionRateVersions)
              .where(eq(redemptionRateVersions.marketId, options.marketId))
              .limit(1)
          )[0]?.id ?? randomUUID(),
        rateValue: '0.0100000000',
        status: options.status as typeof redemptionOrders.$inferSelect.status,
        totalPoints: '10000.0000000000',
        unroundedPointCost: '10000.0000000000',
        postedPointCost: '10000.0000000000',
        quantity: '1',
        backorderQuantity: '0',
        itemSnapshot: { name: 'P7-S8 item', sku: 'P7S8-SKU' },
        rateSnapshot: {},
        idempotencyKey: `p7s8-${randomUUID()}`,
        notes: options.notes ?? null,
      });
      return orderId;
    }

    async function seedWalletEntry(marketId: string): Promise<string> {
      const entryId = randomUUID();
      const sequence = Math.floor(Date.now() % 1_000_000);
      await database.db.insert(memberWalletEntries).values({
        id: entryId,
        walletAccountId: walletAId,
        memberId: memberAId,
        marketId,
        entrySequence: BigInt(sequence),
        entryType: 'REDEMPTION_DEBIT',
        amount: '10000.0000000000',
        balanceBefore: '100000.0000000000',
        balanceAfter: '90000.0000000000',
        idempotencyKey: `we-${randomUUID()}`,
        referenceType: 'REDEMPTION_ORDER',
        description: 'P7-S8 fixture debit',
        actorId: memberAId,
      });
      return entryId;
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
        'p7-s8-redemption-ops-pepper-at-least-32-characters',
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
      redemption = app.get(RedemptionService);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('SG', 'SGD', 'Asia/Singapore');

      superAdmin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: [
          'redemption.order.read',
          'redemption.fulfilment.manage',
        ],
        roleCode: 'SUPER_ADMIN',
      });
      opsAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: [
          'redemption.order.read',
          'redemption.fulfilment.manage',
        ],
        roleCode: 'OPERATIONS_ADMIN',
      });
      supportAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['redemption.order.read'],
        roleCode: 'SUPPORT_READONLY_AUDITOR',
      });

      // Market A is rate-configured (canonical D-053 §6 source). The
      // foundation seed already inserts the MY/POINTS_PER_CURRENCY rule;
      // keep it (active) and never duplicate.
      await database.db
        .insert(redemptionRateMarketRules)
        .values({
          marketCode: 'MY',
          rateType: 'POINTS_PER_CURRENCY',
          initialRate: '1.0000000000',
          minimumRate: '0.5000000000',
          maximumRate: '2.0000000000',
          currency: 'MYR',
          displayUnit: 'RM',
          isActive: true,
        })
        .onConflictDoNothing();
      await database.db.execute(
        sql`INSERT INTO redemption_rate_versions (
              id, market_id, rate_type, rate_value, effective_from, created_by
            ) VALUES (
              ${randomUUID()}, ${marketA}, 'POINTS_PER_CURRENCY',
              '0.0100000000', NOW() - INTERVAL '1 day',
              ${superAdmin.adminUserId}
            )`,
      );
      await database.db.execute(
        sql`INSERT INTO redemption_rate_versions (
              id, market_id, rate_type, rate_value, effective_from, created_by
            ) VALUES (
              ${randomUUID()}, ${marketB}, 'POINTS_PER_CURRENCY',
              '0.0100000000', NOW() - INTERVAL '1 day',
              ${superAdmin.adminUserId}
            )`,
      );
      await database.db.execute(
        sql`INSERT INTO redemption_pickup_locations (
              id, market_id, name, address, contact_name, contact_phone,
              is_active, created_by
            ) VALUES (
              ${randomUUID()}, ${marketA}, 'Test Pickup', '{}', 'John',
              '+60123456789', true, ${superAdmin.adminUserId}
            )`,
      );

      ({ memberId: memberAId, walletId: walletAId } =
        await createMemberWithWallet(marketA));
      memberToken = await memberLogin();

      // ── Six status queues in market A ──────────────────────────────
      orders['READY_FOR_PICKUP'] = await seedOrder({
        marketId: marketA,
        status: 'READY_FOR_PICKUP',
      });
      orders['BACKORDERED'] = await seedOrder({
        marketId: marketA,
        status: 'BACKORDERED',
        notes: 'Est. restock: soon',
      });
      orders['FULFILMENT_SUSPENDED'] = await seedOrder({
        marketId: marketA,
        status: 'FULFILMENT_SUSPENDED',
        notes: 'Suspended for review',
      });
      orders['FULFILMENT_EXCEPTION'] = await seedOrder({
        marketId: marketA,
        status: 'FULFILMENT_EXCEPTION',
      });
      orders['REFUND_PENDING'] = await seedOrder({
        marketId: marketA,
        status: 'REFUND_PENDING',
      });
      orders['REFUNDED'] = await seedOrder({
        marketId: marketA,
        status: 'REFUNDED',
      });
      // A CONFIRMED order for the suspend/resume action tests. The
      // canonical schema CHECK `chk_order_suspension_notes` requires the
      // order to carry notes to become FULFILMENT_SUSPENDED (P6-R2
      // fixtures use the same shape).
      orders['CONFIRMED'] = await seedOrder({
        marketId: marketA,
        status: 'CONFIRMED',
        notes: 'Newly confirmed order',
      });
      // A FAILED fulfilment attached to the FULFILMENT_EXCEPTION order.
      await database.db.insert(redemptionFulfilments).values({
        id: fulfilmentFailedId,
        orderId: orders['FULFILMENT_EXCEPTION'],
        fulfilmentType: 'PHYSICAL',
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: 'Courier rejected',
        retryCount: 1,
      });
      // A foreign-market exception order (isolation target).
      orders['FOREIGN'] = await seedOrder({
        marketId: marketB,
        status: 'FULFILMENT_EXCEPTION',
      });

      // Refund request + REFUND_REQUESTED audit for the REFUND_PENDING order.
      refundAId = randomUUID();
      await database.db.insert(redemptionRefundRequests).values({
        id: refundAId,
        orderId: orders['REFUND_PENDING'],
        makerId: superAdmin.adminUserId,
        status: 'PENDING_CHECKER',
        refundAmount: '10000.0000000000',
        reason: 'Item unavailable - refund required',
        priorOrderStatus: 'FULFILMENT_EXCEPTION',
        idempotencyScope: 'p7s8-refund',
        idempotencyKey: `p7s8-refund-${randomUUID()}`,
        payloadHash: createHash('sha256').update('p7s8').digest('hex'),
      });
      await database.db.insert(redemptionAuditLog).values({
        actorType: 'ADMIN',
        actorId: superAdmin.adminUserId,
        marketId: marketA,
        action: 'REFUND_REQUESTED',
        entityType: 'REDEMPTION_ORDER',
        entityId: orders['REFUND_PENDING'],
        before: null,
        after: {},
        reason: 'Item unavailable - refund required',
        result: 'SUCCESS',
        occurredAt: new Date(),
      });

      await setCurrentMarket(superAdmin.accountId, marketA);
      await setCurrentMarket(opsAdmin.accountId, marketA);
      await setCurrentMarket(supportAdmin.accountId, marketA);
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    // ─── Auth + permission matrix ────────────────────────────────────

    it('rejects unauthenticated requests (401)', async () => {
      await supertest(server).get(queuesUrl(marketA)).expect(401);
      await supertest(server)
        .post(`${orderUrl(marketA, orders['CONFIRMED']!)}/suspend`)
        .send({ reason: 'x' })
        .expect(401);
    });

    it('rejects member (ACCOUNT) sessions (403)', async () => {
      await supertest(server)
        .get(queuesUrl(marketA))
        .set(authorized(memberToken))
        .expect(403);
    });

    it('allows read-only admins to read queues but denies writes (403)', async () => {
      await supertest(server)
        .get(queuesUrl(marketA))
        .set(authorized(supportAdmin.token))
        .expect(200);
      await supertest(server)
        .post(`${orderUrl(marketA, orders['CONFIRMED']!)}/suspend`)
        .set(authorized(supportAdmin.token))
        .send({ reason: 'Not allowed' })
        .expect(403);
    });

    // ─── Market isolation ────────────────────────────────────────────

    it('rejects a URL market that differs from the Current Admin Market (409)', async () => {
      const response = await supertest(server)
        .get(queuesUrl(marketB))
        .set(authorized(superAdmin.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('does not expose a foreign-market order (404 via the current market URL)', async () => {
      await supertest(server)
        .get(orderUrl(marketA, orders['FOREIGN']!))
        .set(authorized(superAdmin.token))
        .expect(404);
    });

    // ─── Fulfilment queues ───────────────────────────────────────────

    it('returns the six-status queue overview with the rate capability state', async () => {
      const response = await supertest(server)
        .get(queuesUrl(marketA))
        .set(authorized(superAdmin.token))
        .expect(200);
      const body = response.body as {
        market_code: string;
        rate_configured: boolean;
        counts: Record<string, number>;
      };
      expect(body.market_code).toBe('MY');
      expect(body.rate_configured).toBe(true);
      expect(body.counts.READY_FOR_PICKUP).toBe(1);
      expect(body.counts.BACKORDERED).toBe(1);
      expect(body.counts.FULFILMENT_SUSPENDED).toBe(1);
      expect(body.counts.FULFILMENT_EXCEPTION).toBe(1);
      expect(body.counts.REFUND_PENDING).toBe(1);
      expect(body.counts.REFUNDED).toBe(1);
    });

    it('reports rate_configured=false for the unconfigured market', async () => {
      await setCurrentMarket(superAdmin.accountId, marketB);
      const response = await supertest(server)
        .get(queuesUrl(marketB))
        .set(authorized(superAdmin.token))
        .expect(200);
      const body = response.body as { rate_configured: boolean };
      expect(body.rate_configured).toBe(false);
      await setCurrentMarket(superAdmin.accountId, marketA);
    });

    it('returns one operational queue with the linked fulfilment/refund rows', async () => {
      const response = await supertest(server)
        .get(`${queuesUrl(marketA)}/REFUND_PENDING`)
        .set(authorized(superAdmin.token))
        .expect(200);
      const body = response.body as {
        status: string;
        items: Array<{
          order_id: string;
          refund: { refund_status: string } | null;
          fulfilment: unknown;
        }>;
        total: number;
      };
      expect(body.status).toBe('REFUND_PENDING');
      expect(body.total).toBe(1);
      expect(body.items[0]?.order_id).toBe(orders['REFUND_PENDING']);
      expect(body.items[0]?.refund?.refund_status).toBe('PENDING_CHECKER');
    });

    it('rejects an invalid queue status (400 validation)', async () => {
      const response = await supertest(server)
        .get(`${queuesUrl(marketA)}/BOGUS`)
        .set(authorized(superAdmin.token))
        .expect(400);
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('returns the order detail with the owner audit history', async () => {
      const response = await supertest(server)
        .get(orderUrl(marketA, orders['REFUND_PENDING']!))
        .set(authorized(superAdmin.token))
        .expect(200);
      const body = response.body as {
        order: { order_reference: string; status: string };
        refund: { refund_request_id: string } | null;
        audit: Array<{ action: string }>;
      };
      expect(body.order.status).toBe('REFUND_PENDING');
      expect(body.refund?.refund_request_id).toBe(refundAId);
      expect(
        body.audit.some((entry) => entry.action === 'REFUND_REQUESTED'),
      ).toBe(true);
    });

    // ─── Orchestrated status operations ──────────────────────────────

    it('suspends a CONFIRMED order through the owner and appends the audit row', async () => {
      const response = await supertest(server)
        .post(`${orderUrl(marketA, orders['CONFIRMED']!)}/suspend`)
        .set(authorized(superAdmin.token))
        .send({ reason: 'Fraud hold.' })
        .expect(200);
      expect((response.body as { status: string }).status).toBe(
        'FULFILMENT_SUSPENDED',
      );
      // The frozen owner writes the immutable ORDER_* audit row.
      const auditRows = await database.db
        .select()
        .from(redemptionAuditLog)
        .where(
          and(
            eq(redemptionAuditLog.entityType, 'REDEMPTION_ORDER'),
            eq(redemptionAuditLog.entityId, orders['CONFIRMED']!),
            eq(redemptionAuditLog.action, 'ORDER_FULFILMENT_SUSPENDED'),
          ),
        );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[0]?.actorType).toBe('ADMIN');
    });

    it('rejects a second suspend with 400 (frozen owner transition rejection)', async () => {
      // The frozen Phase 6 owner rejects invalid transitions with a 400
      // BadRequestException carrying REDEMPTION_FULFILMENT_INVALID_TRANSITION
      // (the same contract the canonical Phase 6 route exposes). The
      // adapter propagates it unchanged — never a swallowed 2xx/500.
      const response = await supertest(server)
        .post(`${orderUrl(marketA, orders['CONFIRMED']!)}/suspend`)
        .set(authorized(superAdmin.token))
        .send({ reason: 'Again.' })
        .expect(400);
      expect((response.body as ErrorBody).error.code).toBe(
        'REDEMPTION_FULFILMENT_INVALID_TRANSITION',
      );
    });

    it('resumes a FULFILMENT_SUSPENDED order (owner resolves the target)', async () => {
      const response = await supertest(server)
        .post(`${orderUrl(marketA, orders['FULFILMENT_SUSPENDED']!)}/resume`)
        .set(authorized(superAdmin.token))
        .expect(200);
      expect(
        ['PROCESSING', 'CONFIRMED'].includes(
          (response.body as { status: string }).status,
        ),
      ).toBe(true);
    });

    it('retries a FAILED fulfilment (admin failure recovery)', async () => {
      const response = await supertest(server)
        .post(
          `/api/v1/admin/redemption-fulfilment-ops/markets/${marketA}/fulfilments/${fulfilmentFailedId}/retry`,
        )
        .set(authorized(superAdmin.token))
        .expect(200);
      expect((response.body as { status: string }).status).toBe('PENDING');
      const rows = await database.db
        .select({ status: redemptionFulfilments.status })
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.id, fulfilmentFailedId));
      expect(rows[0]?.status).toBe('PENDING');
    });

    // ─── Refund operations views ─────────────────────────────────────

    it('returns the refund queue (status-filterable)', async () => {
      const response = await supertest(server)
        .get(`${refundsUrl(marketA)}?status=PENDING_CHECKER`)
        .set(authorized(superAdmin.token))
        .expect(200);
      const body = response.body as {
        items: Array<{ refund_request_id: string; status: string }>;
        total: number;
      };
      expect(body.total).toBe(1);
      expect(body.items[0]?.refund_request_id).toBe(refundAId);
    });

    it('returns the refund detail with the REFUND_* status history', async () => {
      const response = await supertest(server)
        .get(`${refundsUrl(marketA)}/${refundAId}`)
        .set(authorized(superAdmin.token))
        .expect(200);
      const body = response.body as {
        status: string;
        order_reference: string;
        status_history: Array<{ action: string }>;
      };
      expect(body.status).toBe('PENDING_CHECKER');
      expect(body.order_reference).toBeTruthy();
      expect(
        body.status_history.some((e) => e.action === 'REFUND_REQUESTED'),
      ).toBe(true);
    });

    // ─── Zero commission from redemption (OD-29) ─────────────────────

    it('produces NO commission ledger/processing rows from a full redemption flow', async () => {
      const { memberId, walletId } = await createMemberWithWallet(marketA);
      const itemId = await seedCatalogItem(marketA);
      const walletRows = await database.db
        .select({ id: memberWalletAccounts.id })
        .from(memberWalletAccounts)
        .where(eq(memberWalletAccounts.id, walletId));
      const walletAccountId = walletRows[0]?.id ?? walletId;
      await database.db
        .update(memberWalletAccounts)
        .set({ availableBalance: '100000.0000000000' })
        .where(eq(memberWalletAccounts.id, walletAccountId));

      const quote = await redemption.generateQuote(
        memberId,
        marketA,
        itemId,
        1,
      );
      const confirmed = await redemption.confirmOrder(
        memberId,
        marketA,
        {
          quoteId: quote.quoteId,
          idempotencyKey: `zc-${randomUUID()}`,
          expectedItemVersion: 1,
          expectedTotalPoints: quote.postedPointCost,
          expectedQuantity: '1',
          fulfilment: {
            type: 'PICKUP',
            pickupLocationId: (
              await database.db
                .select({ id: redemptionPickupLocations.id })
                .from(redemptionPickupLocations)
                .limit(1)
            )[0]?.id,
          },
          termsAcceptance: { accepted: true, termsVersion: 'v1' },
        },
        { ipAddress: '127.0.0.1' },
      );
      expect(confirmed.id).toBeTruthy();

      const ledgerRows = await database.db
        .select()
        .from(commissionLedger)
        .where(
          or(
            eq(commissionLedger.beneficiaryId, memberId),
            eq(commissionLedger.sourceReference, confirmed.id),
          ),
        );
      expect(ledgerRows).toHaveLength(0);

      const processingRows = await database.db
        .select()
        .from(commissionProcessing);
      // No processing job may reference the redemption flow.
      expect(
        processingRows.some(
          (row) =>
            row.sourceType === 'REDEMPTION' ||
            (row.sourceReference ?? '') === confirmed.id,
        ),
      ).toBe(false);
    });
  },
);
