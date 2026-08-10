/**
 * J3 — MCP debit surface (merchant MCP read / ledger, admin MCP read,
 * recharge create storm).
 *
 * Contract §6 journey 3. The MCP debit itself is exercised inside the
 * transaction confirm (J2 storm asserts the exactly-once MCP debit); this
 * journey measures the MCP account management + read surfaces and storms the
 * recharge-create path (pending requests, balances untouched until review).
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
import { randomSuffix } from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201]);

export async function runJourneyJ3(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J3', 'MCP debit');
  const world = ctx.world;
  const merchant = world.merchant;

  await measureOp(ctx, result, 'merchant-mcp-read', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/merchant/branches/${merchant.branchId}/mcp`,
      token: merchant.merchantToken,
    }),
  );

  await measureOp(ctx, result, 'merchant-mcp-ledger', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/merchant/branches/${merchant.branchId}/mcp/ledger?limit=50&offset=0`,
      token: merchant.merchantToken,
    }),
  );

  await measureOp(ctx, result, 'admin-mcp-read', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/accounts/${merchant.mcpAccountId}`,
      token: world.superAdmin.token,
    }),
  );

  await measureOp(ctx, result, 'recharge-create', CREATED, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/merchants/${merchant.branchId}/recharge`,
      token: world.superAdmin.token,
      idempotencyKey: `j3-recharge-${randomSuffix()}`,
      body: { amount: '100', reason: 'P8-S6 load recharge' },
    }),
  );

  // -- recharge storm (distinct keys): N pending requests, no balance change --
  if (ctx.level !== 'L0') {
    const stormCount = 20;
    const stormed = await Promise.all(
      Array.from({ length: stormCount }, () =>
        httpCall(ctx.baseUrl, {
          method: 'POST',
          path: `/api/v1/admin/markets/${world.marketId}/merchants/${merchant.branchId}/recharge`,
          token: world.superAdmin.token,
          idempotencyKey: `j3-recharge-storm-${randomSuffix()}`,
          body: { amount: '100', reason: 'P8-S6 recharge storm' },
        }),
      ),
    );
    const created = stormed.filter((r) => r.status === 201).length;
    result.assertions.push({
      name: 'J3 20 concurrent recharge creates → 20 pending requests',
      pass: created === stormCount,
      detail: `created = ${created}/${stormCount} (statuses: ${stormed.map((r) => r.status).join(',')})`,
    });
    const balance = await ctx.pool.query<{ balance: string }>(
      `SELECT available_balance::text AS balance
         FROM mcp_accounts WHERE id = $1`,
      [merchant.mcpAccountId],
    );
    const balanceValue = balance.rows[0]?.balance ?? '';
    result.assertions.push({
      name: 'J3 recharge storm leaves MCP balance untouched (pending only)',
      pass: balanceValue === '5000.0000000000',
      detail: `available_balance = ${balanceValue} (expected 5000.0000000000)`,
    });
  }

  return finishJourneyResult(result);
}
