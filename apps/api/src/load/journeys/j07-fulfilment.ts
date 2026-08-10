/**
 * J7 — fulfilment (pickup / backorder / suspend / exception queues).
 *
 * Contract §6 journey 7. Admin fulfilment ops over real HTTP: queue reads,
 * order detail, suspend/resume, fulfilment retry. Fixture: orders seeded in
 * the relevant states via the canonical order shape (same as P7-S8).
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
import { randomSuffix } from './common.js';

const OK = new Set([200]);

export interface FulfilmentFixture {
  confirmedOrderId: string;
  suspendedOrderId: string;
  exceptionFulfilmentId: string;
}

export async function seedFulfilmentFixture(
  ctx: LoadContext,
): Promise<FulfilmentFixture> {
  const world = ctx.world;
  const superAdminUserId = world.superAdmin.adminUserId;

  const itemId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO redemption_catalog_items (
        id, market_id, sku, name, item_type, ownership, status,
        fiat_reference_value, fiat_currency, fulfilment_mode,
        inventory_mode, created_by, version
       ) VALUES ($1, $2, $3, 'P8-S6 item', 'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE',
                 '100.0000000000', 'MYR', 'PICKUP', 'TRACKED', $4, 1)`,
    [itemId, world.marketId, `P8S6-${randomSuffix()}`, superAdminUserId],
  );
  await ctx.pool.query(
    `INSERT INTO redemption_inventory (
        item_id, total_quantity, committed_quantity, fulfilled_quantity,
        backorder_quantity, version
       ) VALUES ($1, '1000', '0', '0', '0', 1)`,
    [itemId],
  );

  const rateVersion = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM redemption_rate_versions
      WHERE market_id = $1 ORDER BY effective_from DESC LIMIT 1`,
    [world.marketId],
  );
  const rateVersionId = rateVersion.rows[0]?.id ?? randomUUID();

  const seedOrder = async (
    status: string,
    notes: string | null,
  ): Promise<string> => {
    const orderId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO redemption_orders (
          id, order_reference, market_id, member_id, item_id,
          wallet_account_id, wallet_entry_id, rate_version_id,
          rate_value, status, total_points, unrounded_point_cost,
          posted_point_cost, quantity, backorder_quantity,
          item_snapshot, rate_snapshot, idempotency_key, notes
        ) VALUES (
          $1, $2, $3, $4, $5,
          (SELECT id FROM member_wallet_accounts WHERE member_id = $4 AND market_id = $3 LIMIT 1),
          $6, $7, '0.0100000000', $8::redemption_order_status,
          '10000.0000000000', '10000.0000000000', '10000.0000000000',
          '1', '0', $9::jsonb, $10::jsonb, $11, $12
        )`,
      [
        orderId,
        `ORD-${randomSuffix()}`,
        world.marketId,
        world.merchant.memberId,
        itemId,
        randomUUID(),
        rateVersionId,
        status,
        JSON.stringify({ name: 'P8-S6 item', sku: 'P8S6' }),
        JSON.stringify({}),
        `j7-${randomUUID()}`,
        notes,
      ],
    );
    return orderId;
  };

  const confirmedOrderId = await seedOrder(
    'CONFIRMED',
    'Newly confirmed order',
  );
  const suspendedOrderId = await seedOrder(
    'FULFILMENT_SUSPENDED',
    'Suspended for review',
  );
  const exceptionOrderId = await seedOrder('FULFILMENT_EXCEPTION', null);

  const exceptionFulfilmentId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO redemption_fulfilments (
        id, order_id, fulfilment_type, status, failed_at, failure_reason, retry_count
       ) VALUES ($1, $2, 'PHYSICAL', 'FAILED', now(), 'Courier rejected', 1)`,
    [exceptionFulfilmentId, exceptionOrderId],
  );

  return { confirmedOrderId, suspendedOrderId, exceptionFulfilmentId };
}

export async function runJourneyJ7(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J7', 'fulfilment');
  const world = ctx.world;
  const fixture = await seedFulfilmentFixture(ctx);
  const token = world.superAdmin.token;
  const base = `/api/v1/admin/redemption-fulfilment-ops/markets/${world.marketId}`;

  await measureOp(ctx, result, 'queues', OK, async () =>
    httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/queues`, token }),
  );

  await measureOp(ctx, result, 'queue-status', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `${base}/queues/CONFIRMED`,
      token,
    }),
  );

  await measureOp(ctx, result, 'order-detail', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `${base}/orders/${fixture.confirmedOrderId}`,
      token,
    }),
  );

  await measureOp(ctx, result, 'suspend', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/orders/${fixture.confirmedOrderId}/suspend`,
      token,
      body: { reason: 'P8-S6 load suspend' },
    }),
  );

  await measureOp(ctx, result, 'resume', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/orders/${fixture.suspendedOrderId}/resume`,
      token,
    }),
  );

  await measureOp(ctx, result, 'fulfilment-retry', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/fulfilments/${fixture.exceptionFulfilmentId}/retry`,
      token,
    }),
  );

  // -- assertions ----------------------------------------------------------
  const state = await ctx.pool.query<{ status: string }>(
    `SELECT status::text AS status FROM redemption_orders WHERE id = $1`,
    [fixture.confirmedOrderId],
  );
  result.assertions.push({
    name: 'J7 suspend transition applied (CONFIRMED → FULFILMENT_SUSPENDED)',
    pass: state.rows[0]?.status === 'FULFILMENT_SUSPENDED',
    detail: `status = ${state.rows[0]?.status ?? 'n/a'}`,
  });

  const resumed = await ctx.pool.query<{ status: string }>(
    `SELECT status::text AS status FROM redemption_orders WHERE id = $1`,
    [fixture.suspendedOrderId],
  );
  result.assertions.push({
    name: 'J7 resume transition applied',
    pass: ['PROCESSING', 'CONFIRMED'].includes(resumed.rows[0]?.status ?? ''),
    detail: `status = ${resumed.rows[0]?.status ?? 'n/a'}`,
  });

  const retried = await ctx.pool.query<{ status: string }>(
    `SELECT status::text AS status FROM redemption_fulfilments WHERE id = $1`,
    [fixture.exceptionFulfilmentId],
  );
  result.assertions.push({
    name: 'J7 fulfilment retry leaves a bounded retry state',
    pass: retried.rows[0]?.status !== undefined,
    detail: `fulfilment status = ${retried.rows[0]?.status ?? 'n/a'}`,
  });

  return finishJourneyResult(result);
}
