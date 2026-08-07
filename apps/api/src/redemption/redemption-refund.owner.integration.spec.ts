/**
 * SEC-02 Refund owner integration suite (GATE-SEC-02) — real PostgreSQL.
 *
 * Every scenario runs on the full redemption stack (quote -> confirm ->
 * wallet debit -> FULFILMENT_EXCEPTION -> refund request -> approve) and
 * asserts the Command Center SEC-02 §4 controls at the database level:
 *   1. Full refund only (exact-opposite of the original debit)
 *   2. Maker/Checker with Maker <> Checker (no threshold exemption)
 *   3. REFUND_PENDING -> REFUNDED legal state machine (frozen P6 machine)
 *   4. Atomic ledger + wallet + order + request + audit in one transaction
 *   5. Double execution prevention (sequential + concurrent approve)
 *   6. CREATE idempotency (same key + payload replay; different payload 409)
 *   7. Immutable audit (actor/action/before/after/reason/result present)
 *   8. Historical order snapshot untouched after refund
 *   9. No Agent Commission produced (OD-29 NO_REDEMPTION_COMMISSION)
 *  10. Reject restores the exact pre-refund order status
 *  11. Failure atomicity (no partial ledger, wallet unchanged, durable FAILED)
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { migrate } from '@ipoint/database';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { RedemptionModule } from './redemption.module.js';
import { RedemptionRefundService } from './redemption-refund.service.js';
import { RedemptionService } from './redemption.service.js';
import type {
  ConfirmOrderInput,
  RefundRequestRecord,
} from './redemption.types.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)(
  'P6 SEC-02 Refund owner integration (real PostgreSQL)',
  () => {
    let app: INestApplication;
    let database: DatabaseService;
    let db: DatabaseService['db'];
    let service: RedemptionService;
    let refundService: RedemptionRefundService;

    const marketId = randomUUID();
    const rateVersionId = randomUUID();
    const makerAdminId = randomUUID();
    const checkerAdminId = randomUUID();
    const otherAdminId = randomUUID();
    const originalShippingFee = process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'];

    function token(): string {
      return randomUUID().replaceAll('-', '');
    }

    async function createAccount(prefix: string): Promise<string> {
      const id = randomUUID();
      const unique = token();
      await db.execute(sql`
        INSERT INTO accounts (
          id, public_id, email, account_country, status, email_verified_at
        ) VALUES (
          ${id}, ${`${prefix}-${unique}`},
          ${`${prefix.toLowerCase()}-${unique}@example.test`},
          'MY', 'ACTIVE', NOW()
        )
      `);
      return id;
    }

    async function createAdmin(id: string, prefix: string): Promise<void> {
      const accountId = await createAccount(prefix);
      await db.execute(sql`
        INSERT INTO admin_users (id, account_id, display_name, status)
        VALUES (${id}, ${accountId}, ${prefix}, 'ACTIVE')
      `);
    }

    async function createMember(
      balance = '100000.0000000000',
    ): Promise<{ memberId: string; walletId: string }> {
      const accountId = await createAccount('sec02-member');
      const memberId = randomUUID();
      const walletId = randomUUID();
      const unique = token();
      await db.execute(sql`
        INSERT INTO members (
          id, account_id, public_member_id, referral_code, status, kyc_level
        ) VALUES (
          ${memberId}, ${accountId}, ${`S2-${unique}`}, ${`RS2-${unique}`},
          'ACTIVE'::member_status, 'LEVEL_2'::member_kyc_level
        )
      `);
      await db.execute(sql`
        INSERT INTO member_wallet_accounts (
          id, member_id, market_id, pending_balance, available_balance,
          reversed_balance, version
        ) VALUES (
          ${walletId}, ${memberId}, ${marketId}, 0, ${balance}, 0, 1
        )
      `);
      await db.execute(sql`
        INSERT INTO redemption_terms_acceptances (
          member_id, market_id, terms_version
        ) VALUES (${memberId}, ${marketId}, 'sec02-v1')
      `);
      return { memberId, walletId };
    }

    async function createItem(): Promise<string> {
      const itemId = randomUUID();
      await db.execute(sql`
        INSERT INTO redemption_catalog_items (
          id, market_id, sku, name, item_type, ownership, status,
          fiat_reference_value, fiat_currency, fulfilment_mode,
          inventory_mode, created_by, version
        ) VALUES (
          ${itemId}, ${marketId}, ${`S2-${token()}`}, 'SEC-02 item',
          'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE', '100.0000000000', 'MYR',
          'PICKUP'::redemption_fulfilment_mode,
          'TRACKED', ${makerAdminId}, 1
        )
      `);
      await db.execute(sql`
        INSERT INTO redemption_inventory (
          id, item_id, total_quantity, committed_quantity,
          fulfilled_quantity, backorder_quantity, version
        ) VALUES (
          ${randomUUID()}, ${itemId}, 20, 0, 0, 0, 1
        )
      `);
      return itemId;
    }

    async function quoteAndInput(
      memberId: string,
      itemId: string,
      idempotencyKey = `sec02-confirm-${token()}`,
    ): Promise<{ quoteId: string; input: ConfirmOrderInput }> {
      const quote = await service.generateQuote(memberId, marketId, itemId, 1);
      return {
        quoteId: quote.quoteId,
        input: {
          quoteId: quote.quoteId,
          idempotencyKey,
          expectedItemVersion: 1,
          expectedTotalPoints: quote.postedPointCost,
          expectedQuantity: '1',
          fulfilment: { type: 'PICKUP' },
          termsAcceptance: { accepted: true, termsVersion: 'sec02-v1' },
        },
      };
    }

    /**
     * Full stack fixture: member -> quote -> confirm (wallet debited) ->
     * order forced to FULFILMENT_EXCEPTION -> Maker creates a refund
     * request. Returns everything the assertions need.
     */
    async function refundableFixture(options?: {
      status?: 'FULFILMENT_EXCEPTION' | 'FULFILMENT_SUSPENDED';
      makerId?: string;
      idempotencyKey?: string;
    }): Promise<{
      orderId: string;
      memberId: string;
      walletId: string;
      requestId: string;
      totalPoints: string;
      request: RefundRequestRecord;
      balanceBefore: string;
      order: Record<string, unknown>;
      idempotencyKey: string;
    }> {
      const member = await createMember();
      const itemId = await createItem();
      const { input } = await quoteAndInput(member.memberId, itemId);
      const order = await service.confirmOrder(
        member.memberId,
        marketId,
        input,
        {
          ipAddress: '127.0.0.1',
        },
      );
      const status = options?.status ?? 'FULFILMENT_EXCEPTION';
      await db.execute(sql`
        UPDATE redemption_orders
        SET status = ${status}::redemption_order_status,
            notes = ${status === 'FULFILMENT_SUSPENDED' ? 'Suspended for SEC-02 test' : null}
        WHERE id = ${order.id}
      `);
      const walletRow = await db.execute(sql`
        SELECT available_balance
        FROM member_wallet_accounts
        WHERE id = ${member.walletId}
      `);
      const balanceBefore = walletRow.rows[0]?.available_balance as string;
      const idempotencyKey =
        options?.idempotencyKey ?? `sec02-create-${token()}`;
      const request = await refundService.createRefundRequest(
        {
          orderId: order.id,
          memberId: member.memberId,
          marketId,
          totalPointCost: order.totalPointCost,
          reason: 'Item out of stock - verified',
          makerId: options?.makerId ?? makerAdminId,
          idempotencyKey,
        },
        { actorType: 'ADMIN', actorId: options?.makerId ?? makerAdminId },
      );
      const orderRow = await db.execute(sql`
        SELECT status, item_snapshot, rate_snapshot, posted_point_cost,
               unrounded_point_cost, total_points, quantity, wallet_entry_id
        FROM redemption_orders
        WHERE id = ${order.id}
      `);
      return {
        orderId: order.id,
        memberId: member.memberId,
        walletId: member.walletId,
        requestId: request.id,
        totalPoints: order.totalPointCost,
        request,
        balanceBefore,
        order: orderRow.rows[0] as Record<string, unknown>,
        idempotencyKey,
      };
    }

    beforeAll(async () => {
      process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'] = '10.00';
      process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6380';
      process.env['AUTH_OTP_PEPPER'] ??=
        'sec02-integration-pepper-not-for-production';
      process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'] ??=
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule,
          DatabaseModule,
          PlatformAccessModule,
          RedemptionModule,
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      database = app.get(DatabaseService);
      db = database.db;
      service = app.get(RedemptionService);
      refundService = app.get(RedemptionRefundService);

      await migrate(database.pool);

      await db.execute(sql`
        INSERT INTO markets (
          id, code, name, status, currency_code, timezone, default_locale
        ) VALUES (
          ${marketId}, ${`S2${token().slice(0, 6).toUpperCase()}`},
          'SEC-02 market', 'ACTIVE', 'MYR', 'Asia/Kuala_Lumpur', 'en-MY'
        )
      `);
      await createAdmin(makerAdminId, 'SEC02 Maker');
      await createAdmin(checkerAdminId, 'SEC02 Checker');
      await createAdmin(otherAdminId, 'SEC02 Other');
      await db.execute(sql`
        INSERT INTO redemption_rate_versions (
          id, market_id, rate_type, rate_value, effective_from, created_by
        ) VALUES (
          ${rateVersionId}, ${marketId}, 'POINTS_PER_CURRENCY',
          '0.0100000000', NOW() - INTERVAL '1 day', ${makerAdminId}
        )
      `);
    });

    afterAll(async () => {
      if (originalShippingFee === undefined) {
        delete process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'];
      } else {
        process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'] = originalShippingFee;
      }
      if (app) await app.close();
    });

    // ═══════════════════════════════════════════════════════════════════
    // Happy path: REFUND_PENDING -> REFUNDED with atomic ledger + wallet
    // ═══════════════════════════════════════════════════════════════════

    it('executes the full refund atomically: ledger, wallet, order, request, audit', async () => {
      const fixture = await refundableFixture();

      // REFUND_PENDING is the frozen intermediate state after Maker create.
      const pending = await db.execute(sql`
        SELECT status FROM redemption_orders WHERE id = ${fixture.orderId}
      `);
      expect(pending.rows[0]?.status).toBe('REFUND_PENDING');

      const before = Number(fixture.balanceBefore);
      const amount = Number(fixture.totalPoints);

      const approved = await refundService.approveRefundRequest(
        { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
        { actorType: 'ADMIN', actorId: checkerAdminId },
      );
      expect(approved.status).toBe('COMPLETED');
      expect(approved.checkerId).toBe(checkerAdminId);

      // Wallet balance credited by exactly the original debit amount.
      const wallet = await db.execute(sql`
        SELECT available_balance
        FROM member_wallet_accounts
        WHERE id = ${fixture.walletId}
      `);
      expect(Number(wallet.rows[0]?.available_balance)).toBe(before + amount);

      // Compensating ledger entry with exact before/after and unique key.
      const entries = await db.execute(sql`
        SELECT id, entry_type, amount, balance_before, balance_after,
               idempotency_key, reference_type, reference_id, actor_id, reason
        FROM member_wallet_entries
        WHERE wallet_account_id = ${fixture.walletId}
          AND entry_type = 'REDEMPTION_REFUND'
      `);
      expect(entries.rows).toHaveLength(1);
      const entry = entries.rows[0] as Record<string, unknown>;
      expect(Number(entry['amount'])).toBe(amount);
      expect(Number(entry['balance_before'])).toBe(before);
      expect(Number(entry['balance_after'])).toBe(before + amount);
      expect(String(entry['idempotency_key'])).toBe(
        `redemption-refund:${fixture.requestId}`,
      );
      expect(entry['reference_type']).toBe('REDEMPTION_ORDER');
      expect(entry['reference_id']).toBe(fixture.orderId);
      expect(entry['actor_id']).toBe(checkerAdminId);

      // Order reached the terminal REFUNDED state; request carries BOTH the
      // original debit reference and the new credit entry.
      const order = await db.execute(sql`
        SELECT status, wallet_entry_id FROM redemption_orders
        WHERE id = ${fixture.orderId}
      `);
      expect(order.rows[0]?.status).toBe('REFUNDED');
      const request = await db.execute(sql`
        SELECT status, wallet_entry_id, refund_wallet_entry_id, executed_at
        FROM redemption_refund_requests
        WHERE id = ${fixture.requestId}
      `);
      expect(request.rows[0]?.status).toBe('COMPLETED');
      expect(request.rows[0]?.wallet_entry_id).toBe(
        fixture.order['wallet_entry_id'],
      );
      expect(request.rows[0]?.refund_wallet_entry_id).toBe(entry['id']);
      expect(request.rows[0]?.executed_at).not.toBeNull();

      // Immutable audit: REFUND_REQUESTED + REFUND_EXECUTED with the full
      // actor/action/before/after/reason/result payload.
      const audits = await db.execute(sql`
        SELECT action, actor_type, actor_id, before, after, reason, result,
               request_id, ip_address
        FROM redemption_audit_log
        WHERE entity_id = ${fixture.orderId}
        ORDER BY occurred_at
      `);
      const actions = audits.rows.map(
        (row) => (row as Record<string, unknown>)['action'],
      );
      expect(actions).toContain('REFUND_REQUESTED');
      expect(actions).toContain('REFUND_EXECUTED');
      const executed = audits.rows.find(
        (row) =>
          (row as Record<string, unknown>)['action'] === 'REFUND_EXECUTED',
      ) as Record<string, unknown>;
      expect(executed['actor_type']).toBe('ADMIN');
      expect(executed['actor_id']).toBe(checkerAdminId);
      expect(executed['result']).toBe('SUCCESS');
      expect(executed['reason']).toBe('Item out of stock - verified');
      expect(executed['before']).toEqual({ status: 'PENDING_CHECKER' });
      expect((executed['after'] as Record<string, unknown>)['status']).toBe(
        'COMPLETED',
      );
    });

    // ═══════════════════════════════════════════════════════════════════
    // Full refund only
    // ═══════════════════════════════════════════════════════════════════

    it('rejects a partial refund amount (OD-12 PENDING — full refund only)', async () => {
      const member = await createMember();
      const itemId = await createItem();
      const { input } = await quoteAndInput(member.memberId, itemId);
      const order = await service.confirmOrder(
        member.memberId,
        marketId,
        input,
        {
          ipAddress: '127.0.0.1',
        },
      );
      await db.execute(sql`
        UPDATE redemption_orders
        SET status = 'FULFILMENT_EXCEPTION'::redemption_order_status
        WHERE id = ${order.id}
      `);
      await expect(
        refundService.createRefundRequest(
          {
            orderId: order.id,
            memberId: member.memberId,
            marketId,
            totalPointCost: '1.0000000000', // partial
            reason: 'Partial attempt',
            makerId: makerAdminId,
            idempotencyKey: `sec02-partial-${token()}`,
          },
          { actorType: 'ADMIN', actorId: makerAdminId },
        ),
      ).rejects.toThrow(/full refund only/i);

      // No side effects: order still refundable, no request created.
      const orderRow = await db.execute(sql`
        SELECT status FROM redemption_orders WHERE id = ${order.id}
      `);
      expect(orderRow.rows[0]?.status).toBe('FULFILMENT_EXCEPTION');
      const requests = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM redemption_refund_requests
        WHERE order_id = ${order.id}
      `);
      expect(requests.rows[0]?.count).toBe(0);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Idempotency
    // ═══════════════════════════════════════════════════════════════════

    it('replays the same CREATE key + payload; conflicts on different payload', async () => {
      const key = `sec02-replay-${token()}`;
      const fixture = await refundableFixture({ idempotencyKey: key });
      const payload = {
        orderId: fixture.orderId,
        memberId: fixture.memberId,
        marketId,
        totalPointCost: fixture.totalPoints,
        reason: 'Item out of stock - verified',
        makerId: makerAdminId,
        idempotencyKey: key,
      };
      const first = await refundService.createRefundRequest(payload, {
        actorType: 'ADMIN',
        actorId: makerAdminId,
      });
      const replay = await refundService.createRefundRequest(payload, {
        actorType: 'ADMIN',
        actorId: makerAdminId,
      });
      expect(replay.id).toBe(first.id);
      expect(replay.status).toBe(first.status);

      // Different payload under the same key -> conflict.
      await expect(
        refundService.createRefundRequest(
          { ...payload, reason: 'Different reason entirely' },
          { actorType: 'ADMIN', actorId: makerAdminId },
        ),
      ).rejects.toThrow(/different payload/i);

      // Only one request row exists for the order.
      const requests = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM redemption_refund_requests
        WHERE order_id = ${fixture.orderId}
      `);
      expect(requests.rows[0]?.count).toBe(1);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Double execution prevention
    // ═══════════════════════════════════════════════════════════════════

    it('executes a concurrent approve exactly once', async () => {
      const fixture = await refundableFixture();
      const approvals = await Promise.allSettled([
        refundService.approveRefundRequest(
          { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
          { actorType: 'ADMIN', actorId: checkerAdminId },
        ),
        refundService.approveRefundRequest(
          { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
          { actorType: 'ADMIN', actorId: checkerAdminId },
        ),
      ]);
      const fulfilled = approvals.filter((a) => a.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      const request = await db.execute(sql`
        SELECT status, executed_at FROM redemption_refund_requests
        WHERE id = ${fixture.requestId}
      `);
      expect(request.rows[0]?.status).toBe('COMPLETED');
      // One and only one compensating entry.
      const entries = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM member_wallet_entries
        WHERE idempotency_key = ${`redemption-refund:${fixture.requestId}`}
      `);
      expect(entries.rows[0]?.count).toBe(1);
    });

    it('rejects a sequential double approve', async () => {
      const fixture = await refundableFixture();
      await refundService.approveRefundRequest(
        { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
        { actorType: 'ADMIN', actorId: checkerAdminId },
      );
      await expect(
        refundService.approveRefundRequest(
          { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
          { actorType: 'ADMIN', actorId: checkerAdminId },
        ),
      ).rejects.toThrow(/already approved/i);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Maker/Checker
    // ═══════════════════════════════════════════════════════════════════

    it('rejects Maker = Checker with no threshold exemption', async () => {
      const fixture = await refundableFixture({ makerId: makerAdminId });
      await expect(
        refundService.approveRefundRequest(
          { refundRequestId: fixture.requestId, checkerId: makerAdminId },
          { actorType: 'ADMIN', actorId: makerAdminId },
        ),
      ).rejects.toThrow(/Checker must differ/i);
      // Request remains pending; the database CHECK also guarantees it.
      const request = await db.execute(sql`
        SELECT status FROM redemption_refund_requests
        WHERE id = ${fixture.requestId}
      `);
      expect(request.rows[0]?.status).toBe('PENDING_CHECKER');
    });

    // ═══════════════════════════════════════════════════════════════════
    // Historical snapshot immutability + no commission
    // ═══════════════════════════════════════════════════════════════════

    it('never rewrites the historical order snapshot; refund produces no commission', async () => {
      const fixture = await refundableFixture();
      const snapshotBefore = fixture.order;
      await refundService.approveRefundRequest(
        { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
        { actorType: 'ADMIN', actorId: checkerAdminId },
      );
      const after = await db.execute(sql`
        SELECT item_snapshot, rate_snapshot, posted_point_cost,
               unrounded_point_cost, total_points, quantity
        FROM redemption_orders
        WHERE id = ${fixture.orderId}
      `);
      const snapshotAfter = after.rows[0] as Record<string, unknown>;
      expect(snapshotAfter['item_snapshot']).toEqual(
        snapshotBefore['item_snapshot'],
      );
      expect(snapshotAfter['rate_snapshot']).toEqual(
        snapshotBefore['rate_snapshot'],
      );
      expect(Number(snapshotAfter['posted_point_cost'])).toBe(
        Number(snapshotBefore['posted_point_cost']),
      );
      expect(Number(snapshotAfter['unrounded_point_cost'])).toBe(
        Number(snapshotBefore['unrounded_point_cost']),
      );
      expect(Number(snapshotAfter['total_points'])).toBe(
        Number(snapshotBefore['total_points']),
      );
      expect(Number(snapshotAfter['quantity'])).toBe(
        Number(snapshotBefore['quantity']),
      );

      // OD-29 NO_REDEMPTION_COMMISSION: no Phase 5 dispatch/ledger rows.
      const dispatches = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM transaction_commission_dispatch
      `);
      expect(dispatches.rows[0]?.count).toBe(0);
      const commissionLedger = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM commission_ledger
      `);
      expect(commissionLedger.rows[0]?.count).toBe(0);
      const walletEntries = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM member_wallet_entries
        WHERE member_id = ${fixture.memberId}
          AND entry_type NOT IN ('REDEMPTION_DEBIT', 'REDEMPTION_REFUND')
      `);
      expect(walletEntries.rows[0]?.count).toBe(0);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Failure atomicity + durable FAILED
    // ═══════════════════════════════════════════════════════════════════

    it('leaves no partial state on execution failure and marks the request FAILED', async () => {
      const fixture = await refundableFixture();
      const before = Number(fixture.balanceBefore);
      // Force the execution to fail BEFORE any ledger write: move the order
      // out of the executable states (wallet debit is untouched).
      await db.execute(sql`
        UPDATE redemption_orders
        SET status = 'CONFIRMED'::redemption_order_status
        WHERE id = ${fixture.orderId}
      `);
      await expect(
        refundService.approveRefundRequest(
          { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
          { actorType: 'ADMIN', actorId: checkerAdminId },
        ),
      ).rejects.toThrow(/Refund execution failed/i);

      // Wallet untouched, no partial ledger, order not REFUNDED.
      const wallet = await db.execute(sql`
        SELECT available_balance FROM member_wallet_accounts
        WHERE id = ${fixture.walletId}
      `);
      expect(Number(wallet.rows[0]?.available_balance)).toBe(before);
      const entries = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM member_wallet_entries
        WHERE wallet_account_id = ${fixture.walletId}
          AND entry_type = 'REDEMPTION_REFUND'
      `);
      expect(entries.rows[0]?.count).toBe(0);
      const order = await db.execute(sql`
        SELECT status FROM redemption_orders WHERE id = ${fixture.orderId}
      `);
      expect(order.rows[0]?.status).not.toBe('REFUNDED');

      // Request durably FAILED with identity + failure reason; a retry does
      // NOT re-execute (same request can only execute once).
      const request = await db.execute(sql`
        SELECT status, checker_id, decided_at, failed_at, failure_reason
        FROM redemption_refund_requests
        WHERE id = ${fixture.requestId}
      `);
      expect(request.rows[0]?.status).toBe('FAILED');
      expect(request.rows[0]?.checker_id).toBe(checkerAdminId);
      expect(request.rows[0]?.decided_at).not.toBeNull();
      expect(request.rows[0]?.failed_at).not.toBeNull();
      expect(String(request.rows[0]?.failure_reason)).toContain('rolled back');
      await expect(
        refundService.approveRefundRequest(
          { refundRequestId: fixture.requestId, checkerId: checkerAdminId },
          { actorType: 'ADMIN', actorId: checkerAdminId },
        ),
      ).rejects.toThrow(/FAILED/i);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Reject + one active request per order
    // ═══════════════════════════════════════════════════════════════════

    it('reject restores the exact pre-refund order status (FULFILMENT_SUSPENDED)', async () => {
      const fixture = await refundableFixture({
        status: 'FULFILMENT_SUSPENDED',
      });
      const rejected = await refundService.rejectRefundRequest(
        fixture.requestId,
        checkerAdminId,
        'Member restored - no refund needed',
      );
      expect(rejected.status).toBe('REJECTED');
      const order = await db.execute(sql`
        SELECT status FROM redemption_orders WHERE id = ${fixture.orderId}
      `);
      expect(order.rows[0]?.status).toBe('FULFILMENT_SUSPENDED');
      const audit = await db.execute(sql`
        SELECT action, result FROM redemption_audit_log
        WHERE entity_id = ${fixture.orderId} AND action = 'REFUND_REJECTED'
      `);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.result).toBe('SUCCESS');

      // A REJECTED request frees the order for a new refund attempt.
      const second = await refundService.createRefundRequest(
        {
          orderId: fixture.orderId,
          memberId: fixture.memberId,
          marketId,
          totalPointCost: fixture.totalPoints,
          reason: 'Second attempt after reject',
          makerId: makerAdminId,
          idempotencyKey: `sec02-after-reject-${token()}`,
        },
        { actorType: 'ADMIN', actorId: makerAdminId },
      );
      expect(second.status).toBe('PENDING_CHECKER');
    });

    it('allows only one ACTIVE refund request per order', async () => {
      const fixture = await refundableFixture();
      await expect(
        refundService.createRefundRequest(
          {
            orderId: fixture.orderId,
            memberId: fixture.memberId,
            marketId,
            totalPointCost: fixture.totalPoints,
            reason: 'Duplicate active attempt',
            makerId: otherAdminId,
            idempotencyKey: `sec02-active-${token()}`,
          },
          { actorType: 'ADMIN', actorId: otherAdminId },
        ),
      ).rejects.toThrow(/pending checker/i);
    });

    // ═══════════════════════════════════════════════════════════════════
    // No refund outside the frozen rules
    // ═══════════════════════════════════════════════════════════════════

    it('rejects refund create for a CONFIRMED order (no auto/off-rule refund)', async () => {
      const member = await createMember();
      const itemId = await createItem();
      const { input } = await quoteAndInput(member.memberId, itemId);
      const order = await service.confirmOrder(
        member.memberId,
        marketId,
        input,
        {
          ipAddress: '127.0.0.1',
        },
      );
      await expect(
        refundService.createRefundRequest(
          {
            orderId: order.id,
            memberId: member.memberId,
            marketId,
            totalPointCost: order.totalPointCost,
            reason: 'Off-rule attempt',
            makerId: makerAdminId,
            idempotencyKey: `sec02-offrule-${token()}`,
          },
          { actorType: 'ADMIN', actorId: makerAdminId },
        ),
      ).rejects.toThrow(/refundable/i);
    });
  },
);
