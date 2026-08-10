/**
 * J9 — Maker/Checker (manual iPoint adjustment workflow).
 *
 * Contract §6 journey 9. Ops over real HTTP: maker create → submit → checker
 * decision → execute (step-up grants seeded per the canonical P7-S8 pattern;
 * each measured iteration uses a fresh request — a second submit/decision on
 * the same request is a state conflict by design). Storm: concurrent
 * double-decision on one submitted request → exactly one accepted transition
 * (gate 14 invariant under load).
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import {
  createAdmin,
  createMember,
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

export async function runJourneyJ9(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J9', 'Maker/Checker');
  const world = ctx.world;
  await ensureRolePermissions(ctx, 'SUPER_ADMIN', [
    'wallet.ipoint.read',
    'wallet.ipoint.adjust.maker',
    'wallet.ipoint.adjust.checker',
    'wallet.ipoint.adjust.execute',
  ]);

  // Market rules + reason code for the adjustment owner (fixture per the
  // P7-S8 integration suite; no production code touched).
  await ctx.pool.query(
    `INSERT INTO ipoint_adjustment_market_rules (
        market_code, soft_cap, hard_cap, secure_evidence_available
       ) VALUES ($1, '10000', '100000', false)
     ON CONFLICT (market_code) DO NOTHING`,
    [world.marketCode],
  );
  await ctx.pool.query(
    `INSERT INTO ipoint_adjustment_reason_codes (
        market_code, code, label, is_high_risk
       ) VALUES ($1, 'OPERATIONAL_CORRECTION',
                 'Operational correction of a processing error', false)
     ON CONFLICT DO NOTHING`,
    [world.marketCode],
  );

  // Maker + checker admins with market access, MFA factor, active sessions.
  const maker = await createAdmin(
    ctx.database,
    ctx.auth,
    [world.marketId],
    'SUPER_ADMIN',
  );
  const checker = await createAdmin(
    ctx.database,
    ctx.auth,
    [world.marketId],
    'SUPER_ADMIN',
  );
  await seedMfaFactor(ctx, maker);
  await seedMfaFactor(ctx, checker);
  await selectMarketFor(ctx, maker.accountId, world.marketId);
  await selectMarketFor(ctx, checker.accountId, world.marketId);

  // Adjustment target wallet.
  const member = await createMember(ctx.database, ctx.auth, world.marketId);
  const walletRows = await ctx.pool.query<{ id: string }>(
    `INSERT INTO member_wallet_accounts (member_id, market_id, available_balance)
     VALUES ($1, $2, '5000') RETURNING id`,
    [member.memberId, world.marketId],
  );
  const walletId = walletRows.rows[0]?.id ?? '';

  const base = `/api/v1/admin/ipoint-adjust-ops/markets/${world.marketId}/adjustments`;
  const adjustmentPayload = (overrides: Record<string, unknown> = {}) => ({
    walletAccountId: walletId,
    direction: 'CREDIT',
    amount: '5000',
    reasonCode: 'OPERATIONAL_CORRECTION',
    explanation: 'P8-S6 load workflow.',
    caseReference: `P8S6-${randomSuffix()}`,
    ...overrides,
  });

  const createRequest = async (): Promise<string> => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: maker.token,
      idempotencyKey: `j9-create-${randomSuffix()}`,
      body: adjustmentPayload(),
    });
    if (created.status !== 201) return '';
    return stringId(created.body, ['id']);
  };

  const submitRequest = async (requestId: string) =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/${requestId}/submit`,
      token: maker.token,
    });

  // -- measured ops (fresh request per iteration) ---------------------------
  await measureOp(ctx, result, 'maker-create', CREATED, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: maker.token,
      idempotencyKey: `j9-create-${randomSuffix()}`,
      body: adjustmentPayload(),
    }),
  );

  await measureOp(ctx, result, 'maker-submit', OK, async () => {
    const requestId = await createRequest();
    if (!requestId) return { status: 500, latencyMs: 0 };
    return submitRequest(requestId);
  });

  await measureOp(ctx, result, 'checker-decision', OK, async () => {
    const requestId = await createRequest();
    if (!requestId) return { status: 500, latencyMs: 0 };
    await submitRequest(requestId);
    const stepUp = await seedStepUpGrant(
      ctx,
      checker,
      'wallet.ipoint.adjust.checker',
      world.marketId,
    );
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/${requestId}/decision`,
      token: checker.token,
      headers: { 'x-step-up-token': stepUp },
      body: { decision: 'APPROVED', reason: 'Evidence verified.' },
    });
  });

  await measureOp(ctx, result, 'checker-execute', OK, async () => {
    const requestId = await createRequest();
    if (!requestId) return { status: 500, latencyMs: 0 };
    await submitRequest(requestId);
    const approveStepUp = await seedStepUpGrant(
      ctx,
      checker,
      'wallet.ipoint.adjust.checker',
      world.marketId,
    );
    await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/${requestId}/decision`,
      token: checker.token,
      headers: { 'x-step-up-token': approveStepUp },
      body: { decision: 'APPROVED', reason: 'Evidence verified.' },
    });
    const executeStepUp = await seedStepUpGrant(
      ctx,
      checker,
      'wallet.ipoint.adjust.execute',
      world.marketId,
    );
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/${requestId}/execute`,
      token: checker.token,
      headers: { 'x-step-up-token': executeStepUp },
      body: { decision: 'APPROVED', reason: 'Execute.' },
    });
  });

  await measureOp(ctx, result, 'queue-read', OK, async () =>
    httpCall(ctx.baseUrl, { method: 'GET', path: base, token: checker.token }),
  );

  // -- storm: concurrent double-decision -----------------------------------
  if (ctx.level !== 'L0') {
    const stormRequestId = await createRequest();
    await submitRequest(stormRequestId);
    const [grantA, grantB] = await Promise.all([
      seedStepUpGrant(
        ctx,
        checker,
        'wallet.ipoint.adjust.checker',
        world.marketId,
      ),
      seedStepUpGrant(
        ctx,
        checker,
        'wallet.ipoint.adjust.checker',
        world.marketId,
      ),
    ]);
    const [decisionA, decisionB] = await Promise.all([
      httpCall(ctx.baseUrl, {
        method: 'POST',
        path: `${base}/${stormRequestId}/decision`,
        token: checker.token,
        headers: { 'x-step-up-token': grantA },
        body: { decision: 'APPROVED', reason: 'Concurrent A.' },
      }),
      httpCall(ctx.baseUrl, {
        method: 'POST',
        path: `${base}/${stormRequestId}/decision`,
        token: checker.token,
        headers: { 'x-step-up-token': grantB },
        body: { decision: 'APPROVED', reason: 'Concurrent B.' },
      }),
    ]);
    const states = [decisionA.status, decisionB.status].sort().join(',');
    const stateRows = await ctx.pool.query<{ state: string }>(
      `SELECT state::text AS state FROM ipoint_adjustment_requests WHERE id = $1`,
      [stormRequestId],
    );
    const finalState = stateRows.rows[0]?.state ?? 'n/a';
    result.assertions.push({
      name: 'J9 concurrent double-decision → exactly one accepted transition',
      pass: finalState === 'APPROVED' && decisionA.status !== decisionB.status,
      detail: `decision statuses = ${states}; final state = ${finalState}`,
    });
  }

  return finishJourneyResult(result);
}
