import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { PlatformAccessModule } from '../platform-access/platform-access.module.js';
import { RedemptionModule } from './redemption.module.js';
import { RedemptionRefundService } from './redemption-refund.service.js';
import { RedemptionService } from './redemption.service.js';
import type { ConfirmOrderInput } from './redemption.types.js';

describe.sequential('Phase 6 PostgreSQL financial atomicity', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let db: DatabaseService['db'];
  let service: RedemptionService;
  let refundService: RedemptionRefundService;

  const marketId = randomUUID();
  const alternateMarketId = randomUUID();
  const rateVersionId = randomUUID();
  const alternateRateVersionId = randomUUID();
  const adminUserId = randomUUID();
  const checkerUserId = randomUUID();
  const originalShippingFee = process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'];
  const originalRedisUrl = process.env['REDIS_URL'];
  const originalOtpPepper = process.env['AUTH_OTP_PEPPER'];
  const originalVoucherKey = process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'];

  function token(): string {
    return randomUUID().replaceAll('-', '');
  }

  async function createAccount(prefix: string): Promise<string> {
    const id = randomUUID();
    const unique = token();
    const normalizedPrefix = prefix.toLowerCase().replaceAll(' ', '-');
    await db.execute(sql`
      INSERT INTO accounts (
        id, public_id, email, account_country, status, email_verified_at
      ) VALUES (
        ${id}, ${`${prefix}-${unique}`},
        ${`${normalizedPrefix}-${unique}@example.test`},
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
    targetMarketId = marketId,
  ): Promise<{ memberId: string; walletId: string }> {
    const accountId = await createAccount('p6-member');
    const memberId = randomUUID();
    const walletId = randomUUID();
    const unique = token();
    await db.execute(sql`
      INSERT INTO members (
        id, account_id, public_member_id, referral_code, status, kyc_level
      ) VALUES (
        ${memberId}, ${accountId}, ${`P6-${unique}`}, ${`R6-${unique}`},
        'ACTIVE'::member_status, 'LEVEL_2'::member_kyc_level
      )
    `);
    await db.execute(sql`
      INSERT INTO member_wallet_accounts (
        id, member_id, market_id, pending_balance, available_balance,
        reversed_balance, version
      ) VALUES (
        ${walletId}, ${memberId}, ${targetMarketId}, 0, ${balance}, 0, 1
      )
    `);
    await db.execute(sql`
      INSERT INTO redemption_terms_acceptances (
        member_id, market_id, terms_version
      ) VALUES (${memberId}, ${targetMarketId}, 'p6-atomic-v1')
    `);
    return { memberId, walletId };
  }

  async function createItem(options?: {
    fulfilmentMode?: 'PICKUP' | 'DELIVERY';
    totalQuantity?: number;
    targetMarketId?: string;
  }): Promise<string> {
    const itemId = randomUUID();
    const targetMarketId = options?.targetMarketId ?? marketId;
    await db.execute(sql`
      INSERT INTO redemption_catalog_items (
        id, market_id, sku, name, item_type, ownership, status,
        fiat_reference_value, fiat_currency, fulfilment_mode,
        inventory_mode, created_by, version
      ) VALUES (
        ${itemId}, ${targetMarketId}, ${`P6-${token()}`}, 'Atomicity item',
        'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE', '100.0000000000', 'MYR',
        ${options?.fulfilmentMode ?? 'PICKUP'}::redemption_fulfilment_mode,
        'TRACKED', ${adminUserId}, 1
      )
    `);
    await db.execute(sql`
      INSERT INTO redemption_inventory (
        id, item_id, total_quantity, committed_quantity,
        fulfilled_quantity, backorder_quantity, version
      ) VALUES (
        ${randomUUID()}, ${itemId}, ${options?.totalQuantity ?? 20}, 0, 0, 0, 1
      )
    `);
    return itemId;
  }

  async function quoteAndInput(
    memberId: string,
    itemId: string,
    idempotencyKey = `p6-confirm-${token()}`,
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
        termsAcceptance: {
          accepted: true,
          termsVersion: 'p6-atomic-v1',
        },
      },
    };
  }

  function shippingRequestHash(
    memberId: string,
    quoteId: string,
    paymentMarketId: string,
    amount: string,
    currency: string,
  ): string {
    const payload = {
      memberId,
      quoteId,
      marketId: paymentMarketId,
      amount,
      currency,
    };
    return createHash('sha256')
      .update(JSON.stringify(payload, Object.keys(payload).sort()))
      .digest('hex');
  }

  async function insertPaidShippingPayment(options: {
    memberId: string;
    quoteId: string;
    paymentMarketId?: string;
    amount?: string;
    currency?: string;
    requestHash?: string;
  }): Promise<string> {
    const paymentId = randomUUID();
    const paymentMarketId = options.paymentMarketId ?? marketId;
    const amount = options.amount ?? '10.00';
    const currency = options.currency ?? 'MYR';
    const requestHash =
      options.requestHash ??
      shippingRequestHash(
        options.memberId,
        options.quoteId,
        paymentMarketId,
        amount,
        currency,
      );
    await db.execute(sql`
      INSERT INTO redemption_shipping_payments (
        id, member_id, quote_id, market_id, amount, currency,
        request_hash, status, payment_provider, payment_intent_id,
        paid_at, idempotency_key
      ) VALUES (
        ${paymentId}, ${options.memberId}, ${options.quoteId},
        ${paymentMarketId}, ${amount}, ${currency}, ${requestHash},
        'PAID', 'sandbox', ${`intent-${token()}`}, NOW(),
        ${`p6-payment-${token()}`}
      )
    `);
    return paymentId;
  }

  async function deliveryFixture(): Promise<{
    memberId: string;
    walletId: string;
    quoteId: string;
    input: ConfirmOrderInput;
  }> {
    const member = await createMember();
    const itemId = await createItem({ fulfilmentMode: 'DELIVERY' });
    const quoted = await quoteAndInput(member.memberId, itemId);
    quoted.input.fulfilment = {
      type: 'DELIVERY',
      deliveryAddress: { line1: '1 Test Street', country: 'MY' },
    };
    return { ...member, ...quoted };
  }

  async function refundableFixture(): Promise<{
    orderId: string;
    walletId: string;
    requestId: string;
  }> {
    const member = await createMember();
    const itemId = await createItem();
    const { input } = await quoteAndInput(member.memberId, itemId);
    const order = await service.confirmOrder(member.memberId, marketId, input, {
      ipAddress: '127.0.0.1',
    });
    await db.execute(sql`
      UPDATE redemption_orders
      SET status = 'FULFILMENT_EXCEPTION'::redemption_order_status
      WHERE id = ${order.id}
    `);
    const requestId = randomUUID();
    await db.execute(sql`
      INSERT INTO redemption_refund_requests (
        id, order_id, maker_id, status, refund_amount, reason
      ) VALUES (
        ${requestId}, ${order.id}, ${adminUserId},
        'PENDING_CHECKER'::redemption_refund_request_status,
        ${order.totalPointCost}, 'P6 atomicity verification'
      )
    `);
    return {
      orderId: order.id,
      walletId: member.walletId,
      requestId,
    };
  }

  beforeAll(async () => {
    process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'] = '10.00';
    process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6380';
    process.env['AUTH_OTP_PEPPER'] ??=
      'p6-atomicity-test-pepper-not-for-production';
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

    await db.execute(sql`
      INSERT INTO markets (
        id, code, name, status, currency_code, timezone, default_locale
      ) VALUES
        (
          ${marketId}, ${`P${token().slice(0, 7).toUpperCase()}`},
          'P6 atomicity market', 'ACTIVE', 'MYR',
          'Asia/Kuala_Lumpur', 'en-MY'
        ),
        (
          ${alternateMarketId}, ${`A${token().slice(0, 7).toUpperCase()}`},
          'P6 alternate market', 'ACTIVE', 'SGD',
          'Asia/Singapore', 'en-SG'
        )
    `);
    await createAdmin(adminUserId, 'P6 Maker');
    await createAdmin(checkerUserId, 'P6 Checker');
    await db.execute(sql`
      INSERT INTO redemption_rate_versions (
        id, market_id, rate_type, rate_value, effective_from, created_by
      ) VALUES
        (
          ${rateVersionId}, ${marketId}, 'POINTS_PER_CURRENCY',
          '0.0100000000', NOW() - INTERVAL '1 day', ${adminUserId}
        ),
        (
          ${alternateRateVersionId}, ${alternateMarketId},
          'POINTS_PER_CURRENCY', '0.0100000000',
          NOW() - INTERVAL '1 day', ${adminUserId}
        )
    `);
  });

  afterAll(async () => {
    if (originalShippingFee === undefined) {
      delete process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'];
    } else {
      process.env['REDEMPTION_SHIPPING_FEE_DEFAULT'] = originalShippingFee;
    }
    if (originalRedisUrl === undefined) delete process.env['REDIS_URL'];
    else process.env['REDIS_URL'] = originalRedisUrl;
    if (originalOtpPepper === undefined) delete process.env['AUTH_OTP_PEPPER'];
    else process.env['AUTH_OTP_PEPPER'] = originalOtpPepper;
    if (originalVoucherKey === undefined) {
      delete process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'];
    } else {
      process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'] = originalVoucherKey;
    }
    if (app) await app.close();
  });

  it('1. rejects a stale wallet version across two connections', async () => {
    const { walletId } = await createMember();
    const first = await database.pool.connect();
    const second = await database.pool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      const firstRead = await first.query(
        'SELECT version FROM member_wallet_accounts WHERE id = $1',
        [walletId],
      );
      const secondRead = await second.query(
        'SELECT version FROM member_wallet_accounts WHERE id = $1',
        [walletId],
      );
      const version = firstRead.rows[0].version as number;
      expect(secondRead.rows[0].version).toBe(version);

      const winner = await first.query(
        `UPDATE member_wallet_accounts
         SET available_balance = available_balance - 1, version = version + 1
         WHERE id = $1 AND version = $2 RETURNING id`,
        [walletId, version],
      );
      await first.query('COMMIT');
      const stale = await second.query(
        `UPDATE member_wallet_accounts
         SET available_balance = available_balance - 1, version = version + 1
         WHERE id = $1 AND version = $2 RETURNING id`,
        [walletId, version],
      );
      await second.query('COMMIT');
      expect(winner.rowCount).toBe(1);
      expect(stale.rowCount).toBe(0);
    } finally {
      first.release();
      second.release();
    }
  });

  it('2. allows only one simultaneous confirm for the last stock unit', async () => {
    const itemId = await createItem({ totalQuantity: 1 });
    const firstMember = await createMember();
    const secondMember = await createMember();
    const first = await quoteAndInput(firstMember.memberId, itemId);
    const second = await quoteAndInput(secondMember.memberId, itemId);
    const results = await Promise.allSettled([
      service.confirmOrder(firstMember.memberId, marketId, first.input, {}),
      service.confirmOrder(secondMember.memberId, marketId, second.input, {}),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const inventory = await db.execute(sql`
      SELECT committed_quantity
      FROM redemption_inventory
      WHERE item_id = ${itemId}
    `);
    expect(inventory.rows[0]?.committed_quantity).toBe('1');
  });

  it('3. returns the same result for the same idempotency key and payload', async () => {
    const member = await createMember();
    const itemId = await createItem();
    const { input } = await quoteAndInput(member.memberId, itemId);
    const first = await service.confirmOrder(
      member.memberId,
      marketId,
      input,
      {},
    );
    const replay = await service.confirmOrder(
      member.memberId,
      marketId,
      input,
      {},
    );
    expect(replay.id).toBe(first.id);
    const orders = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM redemption_orders
      WHERE idempotency_key = ${input.idempotencyKey}
    `);
    expect(orders.rows[0]?.count).toBe(1);
  });

  it('4. rejects the same idempotency key with a different payload', async () => {
    const member = await createMember();
    const itemId = await createItem();
    const { input } = await quoteAndInput(member.memberId, itemId);
    await service.confirmOrder(member.memberId, marketId, input, {});
    await expect(
      service.confirmOrder(
        member.memberId,
        marketId,
        { ...input, expectedQuantity: '2' },
        {},
      ),
    ).rejects.toThrow(/idempotency key.*different/i);
  });

  it('5. rejects delivery without a paid shipping payment', async () => {
    const fixture = await deliveryFixture();
    await expect(
      service.confirmOrder(fixture.memberId, marketId, fixture.input, {}),
    ).rejects.toThrow(/paid shipping payment is required/i);
  });

  it('6. rejects a shipping payment owned by another member', async () => {
    const fixture = await deliveryFixture();
    const otherMember = await createMember();
    fixture.input.shippingPaymentIntentReference =
      await insertPaidShippingPayment({
        memberId: otherMember.memberId,
        quoteId: fixture.quoteId,
      });
    await expect(
      service.confirmOrder(fixture.memberId, marketId, fixture.input, {}),
    ).rejects.toThrow(/Shipping payment.*does not match/i);
  });

  it('7. rejects a shipping payment bound to another quote', async () => {
    const fixture = await deliveryFixture();
    const anotherItem = await createItem({ fulfilmentMode: 'DELIVERY' });
    const anotherQuote = await quoteAndInput(fixture.memberId, anotherItem);
    fixture.input.shippingPaymentIntentReference =
      await insertPaidShippingPayment({
        memberId: fixture.memberId,
        quoteId: anotherQuote.quoteId,
      });
    await expect(
      service.confirmOrder(fixture.memberId, marketId, fixture.input, {}),
    ).rejects.toThrow(/Shipping payment.*does not match/i);
  });

  it('8. rejects a shipping payment from another market', async () => {
    const fixture = await deliveryFixture();
    fixture.input.shippingPaymentIntentReference =
      await insertPaidShippingPayment({
        memberId: fixture.memberId,
        quoteId: fixture.quoteId,
        paymentMarketId: alternateMarketId,
        currency: 'SGD',
      });
    await expect(
      service.confirmOrder(fixture.memberId, marketId, fixture.input, {}),
    ).rejects.toThrow(/Shipping payment.*does not match/i);
  });

  it('9. rejects a shipping payment with the wrong amount', async () => {
    const fixture = await deliveryFixture();
    fixture.input.shippingPaymentIntentReference =
      await insertPaidShippingPayment({
        memberId: fixture.memberId,
        quoteId: fixture.quoteId,
        amount: '9.99',
      });
    await expect(
      service.confirmOrder(fixture.memberId, marketId, fixture.input, {}),
    ).rejects.toThrow(/Shipping payment.*does not match/i);
  });

  it('10. rejects a shipping payment with the wrong currency', async () => {
    const fixture = await deliveryFixture();
    fixture.input.shippingPaymentIntentReference =
      await insertPaidShippingPayment({
        memberId: fixture.memberId,
        quoteId: fixture.quoteId,
        currency: 'SGD',
      });
    await expect(
      service.confirmOrder(fixture.memberId, marketId, fixture.input, {}),
    ).rejects.toThrow(/Shipping payment.*does not match/i);
  });

  it('11. rejects reuse of a consumed shipping payment', async () => {
    const fixture = await deliveryFixture();
    const paymentId = await insertPaidShippingPayment({
      memberId: fixture.memberId,
      quoteId: fixture.quoteId,
    });
    fixture.input.shippingPaymentIntentReference = paymentId;
    await service.confirmOrder(fixture.memberId, marketId, fixture.input, {});

    const nextItem = await createItem({ fulfilmentMode: 'DELIVERY' });
    const next = await quoteAndInput(fixture.memberId, nextItem);
    next.input.fulfilment = { type: 'DELIVERY' };
    next.input.shippingPaymentIntentReference = paymentId;
    await expect(
      service.confirmOrder(fixture.memberId, marketId, next.input, {}),
    ).rejects.toThrow(/Shipping payment.*does not match/i);
  });

  it('12. creates a durable recovery record after a failed confirm', async () => {
    const failed = await deliveryFixture();
    const paymentId = await insertPaidShippingPayment({
      memberId: failed.memberId,
      quoteId: failed.quoteId,
    });
    failed.input.shippingPaymentIntentReference = paymentId;
    await expect(
      service.confirmOrder(
        failed.memberId,
        marketId,
        { ...failed.input, expectedTotalPoints: '1' },
        {},
      ),
    ).rejects.toThrow();

    const recoveryAnchorMember = await createMember();
    const recoveryItem = await createItem();
    const recoveryConfirm = await quoteAndInput(
      recoveryAnchorMember.memberId,
      recoveryItem,
    );
    const recoveryOrder = await service.confirmOrder(
      recoveryAnchorMember.memberId,
      marketId,
      recoveryConfirm.input,
      {},
    );
    const recovery = await refundService.createShippingRecovery(
      recoveryOrder.id,
      paymentId,
      '10.00',
      'MYR',
      'sandbox',
    );
    const durable = await db.execute(sql`
      SELECT recovery_status
      FROM redemption_shipping_payment_recovery
      WHERE id = ${recovery.id}
    `);
    expect(durable.rows[0]?.recovery_status).toBe('PENDING');
  });

  it('13. executes a concurrent refund approval once', async () => {
    const fixture = await refundableFixture();
    const approvals = await Promise.allSettled([
      refundService.approveRefundRequest(
        {
          refundRequestId: fixture.requestId,
          checkerId: checkerUserId,
        },
        { actorType: 'ADMIN', actorId: checkerUserId },
      ),
      refundService.approveRefundRequest(
        {
          refundRequestId: fixture.requestId,
          checkerId: checkerUserId,
        },
        { actorType: 'ADMIN', actorId: checkerUserId },
      ),
    ]);
    expect(
      approvals.filter((approval) => approval.status === 'fulfilled'),
    ).toHaveLength(1);
    const request = await db.execute(sql`
      SELECT status
      FROM redemption_refund_requests
      WHERE id = ${fixture.requestId}
    `);
    expect(request.rows[0]?.status).toBe('COMPLETED');
  });

  it('14. leaves the wallet unchanged when refund execution fails', async () => {
    const fixture = await refundableFixture();
    const before = await db.execute(sql`
      SELECT available_balance
      FROM member_wallet_accounts
      WHERE id = ${fixture.walletId}
    `);
    await db.execute(sql`
      UPDATE redemption_orders
      SET wallet_entry_id = NULL
      WHERE id = ${fixture.orderId}
    `);
    await expect(
      refundService.approveRefundRequest(
        {
          refundRequestId: fixture.requestId,
          checkerId: checkerUserId,
        },
        { actorType: 'ADMIN', actorId: checkerUserId },
      ),
    ).rejects.toThrow(/Refund execution failed/i);
    const after = await db.execute(sql`
      SELECT available_balance
      FROM member_wallet_accounts
      WHERE id = ${fixture.walletId}
    `);
    expect(after.rows[0]?.available_balance).toBe(
      before.rows[0]?.available_balance,
    );
  });

  it('15. leaves no partial ledger entry after a failed refund', async () => {
    const fixture = await refundableFixture();
    await db.execute(sql`
      UPDATE redemption_orders
      SET wallet_entry_id = NULL
      WHERE id = ${fixture.orderId}
    `);
    await expect(
      refundService.approveRefundRequest(
        {
          refundRequestId: fixture.requestId,
          checkerId: checkerUserId,
        },
        { actorType: 'ADMIN', actorId: checkerUserId },
      ),
    ).rejects.toThrow();
    const entries = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM member_wallet_entries
      WHERE wallet_account_id = ${fixture.walletId}
        AND entry_type = 'REDEMPTION_REFUND'
    `);
    expect(entries.rows[0]?.count).toBe(0);
  });

  it('16. leaves no partial order transition after a failed refund', async () => {
    const fixture = await refundableFixture();
    await db.execute(sql`
      UPDATE redemption_orders
      SET wallet_entry_id = NULL
      WHERE id = ${fixture.orderId}
    `);
    await expect(
      refundService.approveRefundRequest(
        {
          refundRequestId: fixture.requestId,
          checkerId: checkerUserId,
        },
        { actorType: 'ADMIN', actorId: checkerUserId },
      ),
    ).rejects.toThrow();
    const order = await db.execute(sql`
      SELECT status
      FROM redemption_orders
      WHERE id = ${fixture.orderId}
    `);
    expect(order.rows[0]?.status).toBe('FULFILMENT_EXCEPTION');
  });

  it('17. prevents a negative wallet balance', async () => {
    const member = await createMember('1.0000000000');
    const itemId = await createItem();
    const { input } = await quoteAndInput(member.memberId, itemId);
    await expect(
      service.confirmOrder(member.memberId, marketId, input, {}),
    ).rejects.toThrow(/Insufficient wallet balance/i);
    const wallet = await db.execute(sql`
      SELECT available_balance
      FROM member_wallet_accounts
      WHERE id = ${member.walletId}
    `);
    expect(Number(wallet.rows[0]?.available_balance)).toBeGreaterThanOrEqual(0);
    const orders = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM redemption_orders
      WHERE member_id = ${member.memberId}
    `);
    expect(orders.rows[0]?.count).toBe(0);
  });
});
