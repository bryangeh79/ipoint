/**
 * J6 — redemption (order / approve / voucher path).
 *
 * Contract §6 journey 6. Ops: member catalog browse, quote, order creation
 * over real HTTP (the approve/voucher state machine is exercised via the
 * admin queues + fulfilment ops in J7). Storm: concurrent orders with
 * distinct idempotency keys → exactly the expected number of orders and one
 * wallet debit per order; replay of one key → one order.
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import { randomUUID } from 'node:crypto';
import {
  finishJourneyResult,
  httpCall,
  measureOp,
  newJourneyResult,
} from '../harness.js';
import { randomSuffix, stringId } from './common.js';

const OK = new Set([200]);
// 409 = REDEMPTION_QUOTE_EXPIRED when a concurrent order consumed the same
// quote first — the correct exactly-once outcome (FIX-003), not an error.
const ORDER_OK = new Set([201, 409]);

export interface RedemptionFixture {
  itemId: string;
  pickupLocationId: string;
}

export async function seedRedemptionFixture(
  ctx: LoadContext,
): Promise<RedemptionFixture> {
  const world = ctx.world;
  const superAdminUserId = world.superAdmin.adminUserId;

  // Rate rule + version for the world market (foundation only seeds MY).
  await ctx.pool.query(
    `INSERT INTO redemption_rate_market_rules (
        market_code, rate_type, initial_rate, minimum_rate, maximum_rate,
        currency, display_unit, is_active
       ) VALUES ($1, 'POINTS_PER_CURRENCY', '1.0000000000', '0.5000000000',
                 '2.0000000000', 'MYR', 'RM', true)
     ON CONFLICT DO NOTHING`,
    [world.marketCode],
  );
  const rateVersionId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO redemption_rate_versions (
        id, market_id, rate_type, rate_value, effective_from, created_by
       ) VALUES ($1, $2, 'POINTS_PER_CURRENCY', '0.0100000000',
                 now() - interval '1 day', $3)`,
    [rateVersionId, world.marketId, superAdminUserId],
  );

  // Catalog item + inventory.
  const itemId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO redemption_catalog_items (
        id, market_id, sku, name, item_type, ownership, status,
        fiat_reference_value, fiat_currency, fulfilment_mode,
        inventory_mode, created_by, version
       ) VALUES (
        $1, $2, $3, 'P8-S6 item', 'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE',
        '100.0000000000', 'MYR', 'PICKUP', 'TRACKED', $4, 1
       )`,
    [itemId, world.marketId, `P8S6-${randomSuffix()}`, superAdminUserId],
  );
  await ctx.pool.query(
    `INSERT INTO redemption_inventory (
        item_id, total_quantity, committed_quantity, fulfilled_quantity,
        backorder_quantity, version
       ) VALUES ($1, '1000', '0', '0', '0', 1)`,
    [itemId],
  );

  // Pickup location (PICKUP fulfilment requires one).
  const pickupLocationId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO redemption_pickup_locations (
        id, market_id, name, address, contact_name, contact_phone,
        is_active, created_by
       ) VALUES ($1, $2, 'P8-S6 Counter', $3::jsonb, 'Counter', '000',
                 true, $4)`,
    [
      pickupLocationId,
      world.marketId,
      JSON.stringify({
        line1: '1 Test St',
        city: 'Test City',
        postcode: '50000',
      }),
      superAdminUserId,
    ],
  );

  // Member wallet with points + KYC Level 2 (redemption requires L2).
  await ctx.pool.query(
    `UPDATE members SET kyc_level = 'LEVEL_2' WHERE id = $1`,
    [world.merchant.memberId],
  );
  const wallet = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM member_wallet_accounts WHERE member_id = $1 AND market_id = $2 LIMIT 1`,
    [world.merchant.memberId, world.marketId],
  );
  if (wallet.rows[0]?.id) {
    await ctx.pool.query(
      `UPDATE member_wallet_accounts SET available_balance = '100000' WHERE id = $1`,
      [wallet.rows[0].id],
    );
  } else {
    await ctx.pool.query(
      `INSERT INTO member_wallet_accounts (member_id, market_id, available_balance)
       VALUES ($1, $2, '100000')`,
      [world.merchant.memberId, world.marketId],
    );
  }

  return { itemId, pickupLocationId };
}

export async function runJourneyJ6(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J6', 'redemption');
  const world = ctx.world;
  const fixture = await seedRedemptionFixture(ctx);
  const memberToken = world.merchant.memberToken;
  const memberId = world.merchant.memberId;

  await measureOp(ctx, result, 'catalog', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: '/api/v1/redemption/catalog',
      token: memberToken,
    }),
  );

  await measureOp(ctx, result, 'quote', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
      token: memberToken,
    }),
  );

  // Order create: quote → confirm order. Under concurrency two orders can
  // race on the same quote; exactly one wins (201) and the other is rejected
  // with 409 (REDEMPTION_QUOTE_EXPIRED, FIX-003) — never a 500.
  await measureOp(ctx, result, 'order-create', ORDER_OK, async () => {
    const quote = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
      token: memberToken,
    });
    const quoteBody = quote.body as {
      quoteId?: string;
      postedPointCost?: string;
    };
    if (!quoteBody.quoteId || !quoteBody.postedPointCost) {
      return { status: 500, latencyMs: quote.latencyMs };
    }
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: '/api/v1/redemption/orders',
      token: memberToken,
      body: {
        quoteId: quoteBody.quoteId,
        idempotencyKey: `j6-order-${randomUUID()}`,
        expectedItemVersion: 1,
        expectedTotalPoints: quoteBody.postedPointCost,
        expectedQuantity: '1',
        fulfilment: {
          type: 'PICKUP',
          pickupLocationId: fixture.pickupLocationId,
        },
        termsAcceptance: { accepted: true, termsVersion: 'v1' },
      },
    });
  });

  // -- order storm ---------------------------------------------------------
  // Quotes are pre-generated serially (each with a distinct idempotency key)
  // so the storm exercises ORDER concurrency, not quote-ms-dedupe; then 20
  // concurrent order confirms on distinct quotes must create exactly 20
  // orders with exactly 20 wallet debits and zero 5xx.
  if (ctx.level !== 'L0') {
    const beforeOrders = await orderCount(ctx, memberId);
    const stormCount = 20;
    const quotes: Array<{ quoteId: string; postedPointCost: string }> = [];
    for (let i = 0; i < stormCount; i += 1) {
      const quote = await httpCall(ctx.baseUrl, {
        method: 'GET',
        path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
        token: memberToken,
      });
      const quoteBody = quote.body as {
        quoteId?: string;
        postedPointCost?: string;
      };
      if (!quoteBody.quoteId || !quoteBody.postedPointCost) {
        throw new Error('J6 storm quote generation failed');
      }
      quotes.push({
        quoteId: quoteBody.quoteId,
        postedPointCost: quoteBody.postedPointCost,
      });
    }
    const stormed = await Promise.all(
      quotes.map((quoteBody) =>
        httpCall(ctx.baseUrl, {
          method: 'POST',
          path: '/api/v1/redemption/orders',
          token: memberToken,
          body: {
            quoteId: quoteBody.quoteId,
            idempotencyKey: `j6-storm-${randomUUID()}`,
            expectedItemVersion: 1,
            expectedTotalPoints: quoteBody.postedPointCost,
            expectedQuantity: '1',
            fulfilment: {
              type: 'PICKUP',
              pickupLocationId: fixture.pickupLocationId,
            },
            termsAcceptance: { accepted: true, termsVersion: 'v1' },
          },
        }),
      ),
    );
    const created = stormed.filter((r) => r.status === 201).length;
    const fiveHundreds = stormed.filter((r) => r.status >= 500).length;
    const afterOrders = await orderCount(ctx, memberId);
    result.assertions.push({
      name: 'J6 order storm → exactly one order per confirm (no duplicates)',
      pass: afterOrders - beforeOrders === created && created === stormCount,
      detail: `before=${beforeOrders} after=${afterOrders} created=${created}/${stormCount} statuses=${stormed.map((r) => r.status).join(',')}`,
    });
    result.assertions.push({
      name: 'J6 order storm has zero 5xx',
      pass: fiveHundreds === 0,
      detail: `5xx = ${fiveHundreds}`,
    });

    // One wallet debit per order.
    const debitCount = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM member_wallet_entries
        WHERE member_id = $1 AND entry_type = 'REDEMPTION_DEBIT'`,
      [memberId],
    );
    const debits = Number(debitCount.rows[0]?.count ?? 0);
    result.assertions.push({
      name: 'J6 exactly one wallet debit per order',
      pass: debits === afterOrders - beforeOrders,
      detail: `REDEMPTION_DEBIT entries = ${debits} (orders created = ${afterOrders - beforeOrders})`,
    });

    // Replay one key → same order, no second write.
    const quote = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
      token: memberToken,
    });
    const quoteBody = quote.body as {
      quoteId?: string;
      postedPointCost?: string;
    };
    const replayKey = `j6-replay-${randomUUID()}`;
    const orderBody = {
      quoteId: quoteBody.quoteId,
      idempotencyKey: replayKey,
      expectedItemVersion: 1,
      expectedTotalPoints: quoteBody.postedPointCost,
      expectedQuantity: '1',
      fulfilment: {
        type: 'PICKUP',
        pickupLocationId: fixture.pickupLocationId,
      },
      termsAcceptance: { accepted: true, termsVersion: 'v1' },
    };
    const first = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: '/api/v1/redemption/orders',
      token: memberToken,
      body: orderBody,
    });
    const replay = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: '/api/v1/redemption/orders',
      token: memberToken,
      body: orderBody,
    });
    const firstId = stringId(first.body, ['id', 'orderId']);
    const replayId = stringId(replay.body, ['id', 'orderId']);
    result.assertions.push({
      name: 'J6 order replay (same key) → single order, same result',
      pass:
        first.status === 201 &&
        replay.status === 201 &&
        firstId !== '' &&
        firstId === replayId,
      detail: `first=${first.status} replay=${replay.status} sameOrderId=${firstId === replayId}`,
    });
    // No unexpected 5xx on the concurrent order path.
    const order500s =
      result.ops
        .find((op) => op.op === 'order-create')
        ?.samples.filter((s) => s.status >= 500).length ?? 0;
    result.assertions.push({
      name: 'J6 concurrent order path has zero 5xx (quote race bounded)',
      pass: order500s === 0,
      detail: `5xx samples = ${order500s}`,
    });
  }

  return finishJourneyResult(result);
}

async function orderCount(ctx: LoadContext, memberId: string): Promise<number> {
  const rows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM redemption_orders WHERE member_id = $1`,
    [memberId],
  );
  return Number(rows.rows[0]?.count ?? 0);
}
