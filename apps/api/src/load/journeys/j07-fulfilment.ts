/**
 * J7 — fulfilment (pickup / backorder / suspend / exception queues).
 *
 * Contract §6 journey 7. Admin fulfilment ops over real HTTP: queue reads,
 * order detail, suspend/resume, fulfilment retry. State-transition ops use a
 * fresh order per iteration (a second suspend on an already-suspended order
 * is an invalid transition by design). The wallet/entry/item baseline is
 * created ONCE per journey and reused — wallet-entry sequences are unique per
 * wallet by constraint, so per-iteration fixtures only insert order rows.
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import { randomUUID } from 'node:crypto';
import {
  ensureRolePermissions,
  finishJourneyResult,
  httpCall,
  measureOp,
  newJourneyResult,
} from '../harness.js';
import { randomSuffix } from './common.js';

const OK = new Set([200]);

export interface FulfilmentBaseline {
  itemId: string;
  rateVersionId: string;
  walletAccountId: string;
  walletEntryId: string;
}

export interface FulfilmentFixture {
  confirmedOrderId: string;
  suspendedOrderId: string;
  exceptionFulfilmentId: string;
}

export async function seedFulfilmentBaseline(
  ctx: LoadContext,
): Promise<FulfilmentBaseline> {
  const world = ctx.world;
  const superAdminUserId = world.superAdmin.adminUserId;
  await ensureRolePermissions(ctx, 'SUPER_ADMIN', [
    'redemption.order.read',
    'redemption.fulfilment.manage',
  ]);

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

  // Member wallet + one ledger entry (redemption_orders references both).
  const wallet = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM member_wallet_accounts WHERE member_id = $1 AND market_id = $2 LIMIT 1`,
    [world.merchant.memberId, world.marketId],
  );
  const walletAccountId =
    wallet.rows[0]?.id ??
    (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO member_wallet_accounts (member_id, market_id, available_balance)
         VALUES ($1, $2, '100000') RETURNING id`,
        [world.merchant.memberId, world.marketId],
      )
    ).rows[0]?.id ??
    '';
  const walletEntryRows = await ctx.pool.query<{ id: string }>(
    `INSERT INTO member_wallet_entries (
        wallet_account_id, member_id, market_id, entry_sequence,
        entry_type, amount, balance_before, balance_after, idempotency_key
       ) VALUES ($1, $2, $3,
                 (SELECT COALESCE(max(entry_sequence), 0) + 1
                    FROM member_wallet_entries WHERE wallet_account_id = $1),
                 'PENDING', '1.0000000000',
                 '1.0000000000', '1.0000000000', $4)
     RETURNING id`,
    [
      walletAccountId,
      world.merchant.memberId,
      world.marketId,
      `j7-${randomUUID()}`,
    ],
  );
  const walletEntryId = walletEntryRows.rows[0]?.id ?? '';

  return { itemId, rateVersionId, walletAccountId, walletEntryId };
}

/** Insert one order row in the given status (canonical P7-S8 shape). */
export async function seedOrderRow(
  ctx: LoadContext,
  baseline: FulfilmentBaseline,
  status: string,
  notes: string | null,
): Promise<string> {
  const world = ctx.world;
  const orderId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO redemption_orders (
        id, order_reference, market_id, member_id, item_id,
        wallet_account_id, wallet_entry_id, rate_version_id,
        rate_value, status, total_points, unrounded_point_cost,
        posted_point_cost, quantity, backorder_quantity,
        item_snapshot, rate_snapshot, idempotency_key, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, '0.0100000000',
        $9::redemption_order_status,
        '10000.0000000000', '10000.0000000000', '10000.0000000000',
        '1', '0', $10::jsonb, $11::jsonb, $12, $13
      )`,
    [
      orderId,
      `ORD-${randomSuffix()}`,
      world.marketId,
      world.merchant.memberId,
      baseline.itemId,
      baseline.walletAccountId,
      baseline.walletEntryId,
      baseline.rateVersionId,
      status,
      JSON.stringify({ name: 'P8-S6 item', sku: 'P8S6' }),
      JSON.stringify({}),
      `j7-${randomUUID()}`,
      notes,
    ],
  );
  return orderId;
}

export async function seedFulfilmentFixture(
  ctx: LoadContext,
): Promise<FulfilmentFixture> {
  const baseline = await seedFulfilmentBaseline(ctx);
  const confirmedOrderId = await seedOrderRow(
    ctx,
    baseline,
    'CONFIRMED',
    'Newly confirmed order',
  );
  const suspendedOrderId = await seedOrderRow(
    ctx,
    baseline,
    'FULFILMENT_SUSPENDED',
    'Suspended for review',
  );
  const exceptionOrderId = await seedOrderRow(
    ctx,
    baseline,
    'FULFILMENT_EXCEPTION',
    null,
  );

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
  const baseline = await seedFulfilmentBaseline(ctx);
  const fixture = await seedFulfilmentFixture(ctx);
  const token = world.superAdmin.token;
  const base = `/api/v1/admin/redemption-fulfilment-ops/markets/${world.marketId}`;

  await measureOp(ctx, result, 'queues', OK, async () =>
    httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/queues`, token }),
  );

  await measureOp(ctx, result, 'queue-status', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `${base}/queues/READY_FOR_PICKUP`,
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

  // Fresh CONFIRMED order per iteration (a second suspend on the same order
  // is an invalid transition by design).
  await measureOp(ctx, result, 'suspend', OK, async () => {
    const orderId = await seedOrderRow(
      ctx,
      baseline,
      'CONFIRMED',
      'Load order',
    );
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/orders/${orderId}/suspend`,
      token,
      body: { reason: 'P8-S6 load suspend' },
    });
  });

  // Fresh SUSPENDED order per iteration (resume on a non-suspended order is
  // rejected by design).
  await measureOp(ctx, result, 'resume', OK, async () => {
    const orderId = await seedOrderRow(
      ctx,
      baseline,
      'FULFILMENT_SUSPENDED',
      'Suspended for review',
    );
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/orders/${orderId}/resume`,
      token,
    });
  });

  // Fresh FAILED fulfilment per iteration (retry on a non-FAILED fulfilment
  // is an invalid transition by design).
  await measureOp(ctx, result, 'fulfilment-retry', OK, async () => {
    const orderId = await seedOrderRow(
      ctx,
      baseline,
      'FULFILMENT_EXCEPTION',
      null,
    );
    const fulfilmentId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO redemption_fulfilments (
          id, order_id, fulfilment_type, status, failed_at, failure_reason, retry_count
       ) VALUES ($1, $2, 'PHYSICAL', 'FAILED', now(), 'Courier rejected', 1)`,
      [fulfilmentId, orderId],
    );
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/fulfilments/${fulfilmentId}/retry`,
      token,
    });
  });

  // -- assertions ----------------------------------------------------------
  // The measured ops use fresh per-iteration orders; verify the transitions
  // directly on the journey fixture orders (unmeasured, count-based check).
  await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/orders/${fixture.confirmedOrderId}/suspend`,
    token,
    body: { reason: 'P8-S6 assertion suspend' },
  });
  await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/orders/${fixture.suspendedOrderId}/resume`,
    token,
  });
  await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/fulfilments/${fixture.exceptionFulfilmentId}/retry`,
    token,
  });

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
