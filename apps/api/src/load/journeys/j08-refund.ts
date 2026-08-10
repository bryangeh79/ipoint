/**
 * J8 — refund (reversal / refund, retry-safe).
 *
 * Contract §6 journey 8. Ops over real HTTP: reversal-request and
 * refund-request creation + reads (each on its own confirmed transaction —
 * one reversal + one refund per transaction is the frozen rule). Storm: 20
 * concurrent reversal requests on one confirmed transaction with one
 * idempotency key → exactly one correction_request row; execution via the
 * canonical correction service restores the MCP fee exactly once (delta
 * assertion, no absolute balances); re-execution has no second impact.
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import {
  finishJourneyResult,
  httpCall,
  measureOp,
  newJourneyResult,
} from '../harness.js';
import {
  confirmTransaction,
  previewTransaction,
  randomSuffix,
  stringId,
} from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201]);

async function confirmFreshTransaction(ctx: LoadContext): Promise<string> {
  const preview = await previewTransaction(ctx);
  const previewSessionId =
    (preview.body as { previewSessionId?: string })?.previewSessionId ?? '';
  const confirm = await confirmTransaction(ctx, previewSessionId, {
    idempotencyKey: `j8-confirm-${randomSuffix()}`,
  });
  return stringId(confirm.body, ['transactionNumber']);
}

export async function runJourneyJ8(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J8', 'refund');
  const world = ctx.world.merchant;

  // -- reversal path (fresh confirmed transaction per iteration) ------------
  await measureOp(ctx, result, 'reversal-request', CREATED, async () => {
    const tx = await confirmFreshTransaction(ctx);
    if (!tx) return { status: 500, latencyMs: 0 };
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/merchant/transactions/${tx}/reversal-requests`,
      token: world.merchantToken,
      idempotencyKey: `j8-reversal-${randomSuffix()}`,
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    });
  });

  await measureOp(ctx, result, 'reversal-request-read', OK, async () => {
    const tx = await confirmFreshTransaction(ctx);
    if (!tx) return { status: 500, latencyMs: 0 };
    await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/merchant/transactions/${tx}/reversal-requests`,
      token: world.merchantToken,
      idempotencyKey: `j8-reversal-${randomSuffix()}`,
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    });
    return httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/merchant/transactions/${tx}/reversal-request`,
      token: world.merchantToken,
    });
  });

  // -- refund path (fresh confirmed transaction per iteration) --------------
  await measureOp(ctx, result, 'refund-request', CREATED, async () => {
    const tx = await confirmFreshTransaction(ctx);
    if (!tx) return { status: 500, latencyMs: 0 };
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/merchant/transactions/${tx}/refund-requests`,
      token: world.merchantToken,
      idempotencyKey: `j8-refund-${randomSuffix()}`,
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    });
  });

  await measureOp(ctx, result, 'refund-request-read', OK, async () => {
    const tx = await confirmFreshTransaction(ctx);
    if (!tx) return { status: 500, latencyMs: 0 };
    await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/merchant/transactions/${tx}/refund-requests`,
      token: world.merchantToken,
      idempotencyKey: `j8-refund-${randomSuffix()}`,
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    });
    return httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/merchant/transactions/${tx}/refund-request`,
      token: world.merchantToken,
    });
  });

  // -- storm: concurrent reversal, one key (tx C) --------------------------
  if (ctx.level !== 'L0') {
    const txC = await confirmFreshTransaction(ctx);
    const stormKey = `j8-storm-reversal-${randomSuffix()}`;
    const stormed = await Promise.all(
      Array.from({ length: 20 }, () =>
        httpCall(ctx.baseUrl, {
          method: 'POST',
          path: `/api/v1/merchant/transactions/${txC}/reversal-requests`,
          token: world.merchantToken,
          idempotencyKey: stormKey,
          body: { reasonCode: 'CUSTOMER_REQUEST' },
        }),
      ),
    );
    const allOk = stormed.every((r) => r.status === 201);
    const correctionRows = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM correction_requests
        WHERE transaction_id = (
          SELECT id FROM transactions WHERE transaction_number = $1
        )`,
      [txC],
    );
    const correctionCount = Number(correctionRows.rows[0]?.count ?? 0);
    result.assertions.push({
      name: 'J8 20 concurrent reversals (one key) → exactly one correction request',
      pass: allOk && correctionCount === 1,
      detail: `statuses ${stormed.map((r) => r.status).join(',')}; correction_requests = ${correctionCount}`,
    });

    const correctionId = await ctx.pool.query<{ id: string }>(
      `SELECT id FROM correction_requests
        WHERE transaction_id = (
          SELECT id FROM transactions WHERE transaction_number = $1
        ) LIMIT 1`,
      [txC],
    );
    const mcpBeforeExec = await mcpBalance(ctx, world.branchId);
    if (correctionId.rows[0]?.id) {
      await ctx.corrections.executeCorrection(
        correctionId.rows[0].id,
        randomSuffix(),
      );
      const mcpAfterExec = await mcpBalance(ctx, world.branchId);
      // Reversal restores the MCP service fee (10% of 100.00 = 10.00).
      const delta = Number(mcpAfterExec) - Number(mcpBeforeExec);
      result.assertions.push({
        name: 'J8 correction execution restores MCP fee exactly once (+10.00)',
        pass: Math.abs(delta - 10) < 0.000001,
        detail: `mcp delta = ${delta.toFixed(4)} (expected 10.0000)`,
      });
      // Re-execution must be a no-op / rejected (no double impact).
      await ctx.corrections.executeCorrection(
        correctionId.rows[0].id,
        randomSuffix(),
      );
      const mcpAfterReplay = await mcpBalance(ctx, world.branchId);
      result.assertions.push({
        name: 'J8 correction re-execution has no second financial impact',
        pass: Number(mcpAfterReplay) === Number(mcpAfterExec),
        detail: `mcp after replay = ${mcpAfterReplay} (unchanged = ${mcpAfterReplay === mcpAfterExec})`,
      });
    } else {
      result.assertions.push({
        name: 'J8 correction request resolvable',
        pass: false,
        detail: 'no correction_request row found',
      });
    }
  }

  return finishJourneyResult(result);
}

async function mcpBalance(ctx: LoadContext, branchId: string): Promise<string> {
  const rows = await ctx.pool.query<{ balance: string }>(
    `SELECT available_balance::text AS balance FROM mcp_accounts WHERE merchant_branch_id = $1`,
    [branchId],
  );
  return rows.rows[0]?.balance ?? '0';
}
