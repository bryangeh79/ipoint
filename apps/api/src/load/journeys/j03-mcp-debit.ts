/**
 * J3 — MCP debit surface (merchant MCP read / ledger, admin MCP read,
 * governed MCP adjustment workflow).
 *
 * Contract §6 journey 3. The MCP debit itself is exercised inside the
 * transaction confirm (J2 storm asserts the exactly-once MCP debit); this
 * journey measures the MCP account management + read surfaces and the live
 * governed MCP adjustment workflow (maker create/submit → checker
 * decision/execute with step-up). The legacy immediate recharge route
 * (`merchant.mcp.recharge.review`) is deliberately retired (P7-S2C: the
 * permission is deprecated and authorizes nothing) — its 403 behaviour is
 * recorded as an observation, not a failure.
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import {
  createAdmin,
  ensureRolePermissions,
  finishJourneyResult,
  httpCall,
  measureOp,
  newJourneyResult,
  seedMfaFactor,
  selectMarketFor,
  seedStepUpGrant,
} from '../harness.js';
import { randomSuffix, stringId } from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201]);

export async function runJourneyJ3(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J3', 'MCP debit');
  const world = ctx.world;
  const merchant = world.merchant;

  // Market rule + reason code for the governed MCP adjustment owner (fixture
  // per the P7-S2A integration suite; no production code touched).
  await ctx.pool.query(
    `INSERT INTO mcp_adjustment_market_rules (
        market_code, soft_cap, hard_cap, secure_evidence_available, is_active
       ) VALUES ($1, '10000', '100000', false, true)
     ON CONFLICT (market_code) DO NOTHING`,
    [world.marketCode],
  );
  await ctx.pool.query(
    `INSERT INTO mcp_adjustment_reason_codes (
        market_code, code, label, is_high_risk, is_active
       ) VALUES ($1, 'OPERATIONAL_CORRECTION',
                 'Operational correction of a processing error', false, true)
     ON CONFLICT DO NOTHING`,
    [world.marketCode],
  );
  await ensureRolePermissions(ctx, 'FINANCE_OPERATOR', ['merchant.mcp.adjust']);
  await ensureRolePermissions(ctx, 'FINANCE_APPROVER', [
    'merchant.mcp.adjust.approve',
    'merchant.mcp.adjust.execute',
  ]);

  // -- read surfaces -------------------------------------------------------
  await measureOp(ctx, result, 'merchant-mcp-read', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/merchant/branches/${merchant.branchId}/mcp`,
      token: merchant.merchantToken,
      headers: { 'x-market-id': world.marketId },
    }),
  );

  await measureOp(ctx, result, 'merchant-mcp-ledger', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/merchant/branches/${merchant.branchId}/mcp/ledger`,
      token: merchant.merchantToken,
      headers: { 'x-market-id': world.marketId },
    }),
  );

  await measureOp(ctx, result, 'admin-mcp-read', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/accounts/${merchant.mcpAccountId}`,
      token: world.superAdmin.token,
    }),
  );

  // -- deprecated recharge route: observe the deliberate 403 ---------------
  if (ctx.level === 'L2') {
    const retired = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/merchants/${merchant.branchId}/recharge`,
      token: world.superAdmin.token,
      idempotencyKey: `j3-retired-${randomSuffix()}`,
      body: { amount: '100', reason: 'Retired route probe.' },
    });
    result.assertions.push({
      name: 'J3 retired recharge route denies (P7-S2C deprecation)',
      pass: retired.status === 403,
      detail: `status ${retired.status} (expected 403 — deprecated permission authorizes nothing)`,
    });
  }

  // -- governed MCP adjustment workflow ------------------------------------
  const maker = await createAdmin(
    ctx.database,
    ctx.auth,
    [world.marketId],
    'FINANCE_OPERATOR',
  );
  const checker = await createAdmin(
    ctx.database,
    ctx.auth,
    [world.marketId],
    'FINANCE_APPROVER',
  );
  await seedMfaFactor(ctx, maker);
  await seedMfaFactor(ctx, checker);
  await selectMarketFor(ctx, maker.accountId, world.marketId);
  await selectMarketFor(ctx, checker.accountId, world.marketId);

  const base = `/api/v1/admin/markets/${world.marketId}/mcp/accounts/${merchant.mcpAccountId}/adjustments`;
  const adjustPayload = (overrides: Record<string, unknown> = {}) => ({
    type: 'MANUAL_CREDIT',
    amount: '5',
    reasonCode: 'OPERATIONAL_CORRECTION',
    explanation: 'P8-S6 load MCP adjustment.',
    caseReference: `P8S6-${randomSuffix()}`,
    ...overrides,
  });

  let requestId = '';
  await measureOp(ctx, result, 'adjust-create', CREATED, async () => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: maker.token,
      idempotencyKey: `j3-adjust-${randomSuffix()}`,
      body: adjustPayload(),
    });
    if (created.status === 201) {
      requestId = stringId(created.body, ['id']);
    }
    return created;
  });

  await measureOp(ctx, result, 'adjust-submit', OK, async () => {
    // Fresh request per iteration (a second submit on the same request is a
    // state conflict by design).
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: maker.token,
      idempotencyKey: `j3-adjust-${randomSuffix()}`,
      body: adjustPayload(),
    });
    if (created.status !== 201) return created;
    const freshId = stringId(created.body, ['id']);
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${freshId}/submit`,
      token: maker.token,
    });
  });

  await measureOp(ctx, result, 'adjust-decision', OK, async () => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: maker.token,
      idempotencyKey: `j3-adjust-${randomSuffix()}`,
      body: adjustPayload(),
    });
    if (created.status !== 201) return created;
    const freshId = stringId(created.body, ['id']);
    await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${freshId}/submit`,
      token: maker.token,
    });
    const stepUp = await seedStepUpGrant(
      ctx,
      checker,
      'merchant.mcp.adjust.approve',
      world.marketId,
    );
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${freshId}/decision`,
      token: checker.token,
      headers: { 'x-step-up-token': stepUp },
      body: { decision: 'APPROVED', reason: 'P8-S6 load approve.' },
    });
  });

  await measureOp(ctx, result, 'adjust-execute', OK, async () => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: maker.token,
      idempotencyKey: `j3-adjust-${randomSuffix()}`,
      body: adjustPayload(),
    });
    if (created.status !== 201) return created;
    const freshId = stringId(created.body, ['id']);
    await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${freshId}/submit`,
      token: maker.token,
    });
    const approveStepUp = await seedStepUpGrant(
      ctx,
      checker,
      'merchant.mcp.adjust.approve',
      world.marketId,
    );
    await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${freshId}/decision`,
      token: checker.token,
      headers: { 'x-step-up-token': approveStepUp },
      body: { decision: 'APPROVED', reason: 'P8-S6 load approve.' },
    });
    const executeStepUp = await seedStepUpGrant(
      ctx,
      checker,
      'merchant.mcp.adjust.execute',
      world.marketId,
    );
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/adjustments/${freshId}/execute`,
      token: checker.token,
      headers: { 'x-step-up-token': executeStepUp },
    });
  });

  // -- storm: concurrent double-decision -----------------------------------
  if (ctx.level !== 'L0') {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: maker.token,
      idempotencyKey: `j3-storm-${randomSuffix()}`,
      body: adjustPayload(),
    });
    const stormRequestId = stringId(created.body, ['id']);
    await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${stormRequestId}/submit`,
      token: maker.token,
    });
    const [grantA, grantB] = await Promise.all([
      seedStepUpGrant(
        ctx,
        checker,
        'merchant.mcp.adjust.approve',
        world.marketId,
      ),
      seedStepUpGrant(
        ctx,
        checker,
        'merchant.mcp.adjust.approve',
        world.marketId,
      ),
    ]);
    const [decisionA, decisionB] = await Promise.all([
      httpCall(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${stormRequestId}/decision`,
        token: checker.token,
        headers: { 'x-step-up-token': grantA },
        body: { decision: 'APPROVED', reason: 'Concurrent A.' },
      }),
      httpCall(ctx.baseUrl, {
        method: 'POST',
        path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${stormRequestId}/decision`,
        token: checker.token,
        headers: { 'x-step-up-token': grantB },
        body: { decision: 'APPROVED', reason: 'Concurrent B.' },
      }),
    ]);
    const states = [decisionA.status, decisionB.status].sort().join(',');
    const stateRows = await ctx.pool.query<{ state: string }>(
      `SELECT status::text AS state FROM mcp_adjustment_requests WHERE id = $1`,
      [stormRequestId],
    );
    const finalState = stateRows.rows[0]?.state ?? 'n/a';
    result.assertions.push({
      name: 'J3 concurrent double-decision → exactly one accepted transition',
      pass: finalState === 'APPROVED' && decisionA.status !== decisionB.status,
      detail: `decision statuses = ${states}; final state = ${finalState}`,
    });
  }
  void requestId;

  return finishJourneyResult(result);
}
