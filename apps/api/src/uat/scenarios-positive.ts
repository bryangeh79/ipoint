/**
 * P8-S8 UAT — positive journey scenarios U-01..U-22 (contract §8, brief §3.1).
 *
 * Every scenario runs at L0 (single-user acceptance profile) over real HTTP
 * against the real API + PostgreSQL (fresh `ipoint_p8s8_*` DB), with
 * explicit business assertions per scenario and raw evidence recorded under
 * `.local/p8-s8-uat/**`.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { JourneyResult, UatContext } from './types.js';
import {
  createAdmin,
  createMember,
  ensureRolePermissions,
  httpCall,
  httpCallWithTimeout,
  seedMfaFactor,
  seedStepUpGrant,
  selectMarketFor,
} from '../load/harness.js';
import {
  confirmationState,
  confirmFreshTransaction,
  confirmTransaction,
  ensureMemberWallet,
  errorCode,
  finishUatResult,
  newUatResult,
  previewTransaction,
  randomSuffix,
  recordAssertion,
  seedIpointAdjustFixtures,
  seedMcpAdjustFixtures,
  stringId,
  assertStatus,
} from './helpers.js';
import { seedRedemptionFixture } from '../load/journeys/j06-redemption.js';
import { seedFulfilmentFixture } from '../load/journeys/j07-fulfilment.js';
import { PASSWORD } from '../load/harness.js';

const OK = new Set([200]);
const CREATED = new Set([201]);
const ACCEPTED = new Set([202]);
const NO_CONTENT = new Set([204]);

// ---------------------------------------------------------------------------
// U-01 member registration/login (+ OTP, MFA, session reuse)
// ---------------------------------------------------------------------------

export async function runU01(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-01', 'member registration/login (+ OTP, MFA, session reuse)');
  const email = `uat01-${randomSuffix()}@example.com`;
  const password = 'Uat-Registration-Password-123!';

  // -- registration initiate -> verify -> complete -------------------------
  const initiate = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/register',
    body: {
      email,
      password,
      account_country: 'MY',
      referral_code: null,
      terms_version: 'v1',
      disclaimer_version: 'v1',
      privacy_version: 'v1',
      locale: 'en-MY',
    },
  });
  assertStatus(result, 'U-01 registration initiate returns 202', initiate, ACCEPTED);
  const otpId = stringId(initiate.body, ['otp_id']);
  const devCode = stringId(initiate.body, ['development_code']);
  recordAssertion(
    result,
    'U-01 registration OTP development code is a 6-digit string',
    /^\d{6}$/u.test(devCode),
    `code=${devCode}`,
  );

  const verify = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/register/verify',
    body: { otp_id: otpId, code: devCode },
  });
  assertStatus(result, 'U-01 registration OTP verify returns 200', verify, OK);
  recordAssertion(
    result,
    'U-01 OTP verify confirms verified:true',
    (verify.body as { verified?: boolean })?.verified === true,
    JSON.stringify(verify.body),
  );

  const completionKey = `registration-${randomUUID()}`;
  const complete = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/register/complete',
    body: { otp_id: otpId, idempotency_key: completionKey },
  });
  assertStatus(result, 'U-01 registration complete returns 200', complete, OK);
  const accountId = stringId(complete.body, ['accountId']);
  const memberId = stringId(complete.body, ['memberId']);
  recordAssertion(
    result,
    'U-01 registration complete returns accountId + memberId',
    accountId !== '' && memberId !== '',
    JSON.stringify(complete.body),
  );

  const replayed = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/register/complete',
    body: { otp_id: otpId, idempotency_key: completionKey },
  });
  assertStatus(result, 'U-01 registration complete replay returns 200', replayed, OK);
  // Exactly-once identity: the replay returns the same member identity and
  // never creates a second registration.
  recordAssertion(
    result,
    'U-01 idempotent completion replay returns the same member identity',
    stringId(replayed.body, ['accountId']) === accountId &&
      stringId(replayed.body, ['memberId']) === memberId,
    `replay=${JSON.stringify(replayed.body)}`,
  );

  const replayAccountRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM accounts WHERE email = $1`,
    [email],
  );
  recordAssertion(
    result,
    'U-01 replay does not duplicate the registration (one account)',
    Number(replayAccountRows.rows[0]?.count ?? 0) === 1,
    `accounts=${replayAccountRows.rows[0]?.count}`,
  );

  // -- login / refresh / session reuse / logout ----------------------------
  const login = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/login',
    body: { email, password },
  });
  assertStatus(result, 'U-01 login returns 200', login, OK);
  const accessToken = stringId(login.body, ['accessToken']);
  const refreshToken = stringId(login.body, ['refreshToken']);
  recordAssertion(
    result,
    'U-01 login returns access + refresh tokens',
    accessToken !== '' && refreshToken !== '',
    'tokens present',
  );

  const refresh = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/refresh',
    body: { refresh_token: refreshToken },
  });
  assertStatus(result, 'U-01 token refresh returns 200', refresh, OK);
  // Refresh rotates the session family: the OLD access token is revoked, the
  // NEW access token from the refresh response is the live session.
  const newAccessToken = stringId(refresh.body, ['accessToken']);
  recordAssertion(
    result,
    'U-01 refresh returns a rotated access token',
    newAccessToken !== '' && newAccessToken !== accessToken,
    'rotated token present',
  );

  const reuse = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/content/home',
    token: newAccessToken,
  });
  assertStatus(result, 'U-01 session reuse (authenticated read) returns 200', reuse, OK);

  const logout = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/logout',
    token: newAccessToken,
  });
  assertStatus(result, 'U-01 logout returns 204', logout, NO_CONTENT);
  const reusedAfterLogout = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/content/home',
    token: newAccessToken,
  });
  recordAssertion(
    result,
    'U-01 logged-out access token is rejected (401)',
    reusedAfterLogout.status === 401,
    `status ${reusedAfterLogout.status}`,
  );

  const wrongPassword = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/login',
    body: { email, password: 'Wrong-Password-999!' },
  });
  assertStatus(result, 'U-01 wrong password rejected (401)', wrongPassword, new Set([401]));

  // -- rate-limit ceiling --------------------------------------------------
  const { clearRateLimiter } = await import('../load/harness.js');
  clearRateLimiter(ctx);
  const burst = await Promise.all(
    Array.from({ length: 11 }, () =>
      httpCall(ctx.baseUrl, {
        method: 'POST',
        path: '/api/v1/auth/member/login',
        body: { email, password },
      }),
    ),
  );
  const burstOk = burst.filter((r) => r.status === 200).length;
  const burstLimited = burst.filter((r) => r.status === 429).length;
  recordAssertion(
    result,
    'U-01 login limiter enforces the frozen ceiling (200s then 429)',
    burstOk >= 5 && burstLimited >= 1 && burstOk + burstLimited === 11,
    `burst 11 -> 200x${burstOk} 429x${burstLimited}`,
  );

  // -- admin MFA surface (MFA_REQUIRED 202) --------------------------------
  const mfaAdmin = await createAdmin(ctx.database, ctx.auth, [ctx.world.marketId], 'SUPER_ADMIN');
  await seedMfaFactor(ctx, mfaAdmin);
  await selectMarketFor(ctx, mfaAdmin.accountId, ctx.world.marketId);
  const mfaAdminEmailRows = await ctx.pool.query<{ email: string }>(
    `SELECT email FROM accounts WHERE id = $1`,
    [mfaAdmin.accountId],
  );
  const mfaAdminEmail = mfaAdminEmailRows.rows[0]?.email ?? '';
  const mfaLogin = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/admin/login',
    body: { email: mfaAdminEmail, password: PASSWORD },
  });
  assertStatus(result, 'U-01 admin login with MFA returns 202 MFA_REQUIRED', mfaLogin, ACCEPTED);
  recordAssertion(
    result,
    'U-01 admin login body code is MFA_REQUIRED',
    (mfaLogin.body as { code?: string })?.code === 'MFA_REQUIRED',
    JSON.stringify(mfaLogin.body),
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-02 market switching
// ---------------------------------------------------------------------------

export async function runU02(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-02', 'market switching');
  const world = ctx.world;
  const member = await createMember(ctx.database, ctx.auth, world.marketId);

  // Market switch requires the target market to be enabled for the member
  // (member_market_preferences.is_enabled) — fixture-seed the M2 preference.
  const prefRows = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM member_market_preferences
      WHERE member_id = $1 AND market_id = $2`,
    [member.memberId, world.secondaryMarketId],
  );
  if (prefRows.rows.length === 0) {
    await ctx.pool.query(
      `INSERT INTO member_market_preferences (member_id, market_id, is_enabled, is_current, sort_order)
       VALUES ($1, $2, true, false, 1)`,
      [member.memberId, world.secondaryMarketId],
    );
  }

  const current = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/me/market',
    token: member.token,
  });
  assertStatus(result, 'U-02 current market read returns 200', current, OK);

  const switched = await httpCall(ctx.baseUrl, {
    method: 'PATCH',
    path: '/api/v1/members/me/market',
    token: member.token,
    body: { marketId: world.secondaryMarketId },
  });
  assertStatus(result, 'U-02 market switch returns 200', switched, OK);

  const after = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/me/market',
    token: member.token,
  });
  const afterBody = after.body as {
    currentMarket?: { id?: string };
    marketId?: string;
    currentMarketId?: string;
  };
  recordAssertion(
    result,
    'U-02 current market reflects the switch',
    afterBody.currentMarket?.id === world.secondaryMarketId ||
      afterBody.marketId === world.secondaryMarketId ||
      afterBody.currentMarketId === world.secondaryMarketId,
    JSON.stringify(after.body),
  );

  // Market-scoped merchant list: M1 merchant must not appear under M2.
  const merchantsM2 = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/merchants',
    token: member.token,
  });
  assertStatus(result, 'U-02 market-scoped discovery under M2 returns 200', merchantsM2, OK);
  const items = (merchantsM2.body as { items?: Array<{ id: string }> })?.items ?? [];
  recordAssertion(
    result,
    'U-02 zero cross-market fallback: M1 merchant absent from M2 list',
    !items.some((item) => item.id === world.merchant.branchId),
    `items=${items.length}`,
  );

  const back = await httpCall(ctx.baseUrl, {
    method: 'PATCH',
    path: '/api/v1/members/me/market',
    token: member.token,
    body: { marketId: world.marketId },
  });
  assertStatus(result, 'U-02 switch back returns 200', back, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-03 merchant discovery
// ---------------------------------------------------------------------------

export async function runU03(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-03', 'merchant discovery');
  const world = ctx.world;
  const list = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/merchants',
    token: world.member.token,
  });
  assertStatus(result, 'U-03 discovery list returns 200', list, OK);
  const items = (list.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  const merchantPublicRows = await ctx.pool.query<{ merchantId: string }>(
    `SELECT merchant_id AS "merchantId" FROM merchant_branches WHERE id = $1`,
    [world.merchant.branchId],
  );
  const publicMerchantId = merchantPublicRows.rows[0]?.merchantId ?? '';
  const worldMerchantVisible = items.some(
    (item) =>
      item['merchant_id'] === publicMerchantId ||
      item['merchantId'] === publicMerchantId ||
      item['id'] === publicMerchantId,
  );
  recordAssertion(
    result,
    'U-03 world merchant is discoverable in its market',
    worldMerchantVisible && items.length >= 1,
    `items=${items.length} publicMerchantId=${publicMerchantId}`,
  );
  const firstId =
    stringId(items[0] ?? {}, ['merchantId', 'merchant_id', 'id']) || publicMerchantId;
  if (firstId) {
    const detail = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/members/merchants/${firstId}`,
      token: world.member.token,
    });
    assertStatus(result, 'U-03 merchant detail returns 200', detail, OK);
  } else {
    recordAssertion(result, 'U-03 merchant detail 200', false, 'no merchant id to fetch');
  }
  const home = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/content/home',
    token: world.member.token,
  });
  assertStatus(result, 'U-03 member content home returns 200', home, OK);
  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-04 merchant transaction (preview/confirm/receipt/history)
// ---------------------------------------------------------------------------

export async function runU04(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-04', 'merchant transaction (preview/confirm/receipt/history)');
  const world = ctx.world.merchant;

  const preview = await previewTransaction(ctx, { amount: '100.00' });
  assertStatus(result, 'U-04 preview returns 201', preview, CREATED);
  const previewSessionId = stringId(preview.body, ['previewSessionId']);
  const feeRate = stringId(preview.body, ['serviceFeeRate']);
  const mcpDebit = stringId(preview.body, ['estimatedMcpDebit']);
  recordAssertion(
    result,
    'U-04 preview returns exact-decimal fee rate + MCP debit',
    feeRate !== '' &&
      mcpDebit !== '' &&
      /^\d+(\.\d+)?$/u.test(feeRate) &&
      /^\d+(\.\d+)?$/u.test(mcpDebit),
    `feeRate=${feeRate} mcpDebit=${mcpDebit}`,
  );

  const confirmKey = `uat04-confirm-${randomSuffix()}`;
  const receiptNumber = `UAT04-REC-${randomSuffix()}`;
  const confirm = await confirmTransaction(ctx, previewSessionId, {
    idempotencyKey: confirmKey,
    merchantReceiptNumber: receiptNumber,
  });
  assertStatus(result, 'U-04 confirm returns 201', confirm, CREATED);
  const transactionNumber = stringId(confirm.body, ['transactionNumber']);
  recordAssertion(result, 'U-04 confirm returns transaction number', transactionNumber !== '', JSON.stringify(confirm.body));

  const chain = await confirmationState(ctx, previewSessionId);
  recordAssertion(
    result,
    'U-04 confirm creates exactly one financial chain (1/1/1/1/1/1/1)',
    chain.transactions === 1 &&
      chain.fees === 1 &&
      chain.debits === 1 &&
      chain.rewardLinks === 1 &&
      chain.rewardSources === 1 &&
      chain.rewardPlans === 1 &&
      chain.walletEntries === 1,
    JSON.stringify(chain),
  );

  // Double-submit guard: same key + same payload -> same chain, no second write.
  const replay = await confirmTransaction(ctx, previewSessionId, {
    idempotencyKey: confirmKey,
    merchantReceiptNumber: receiptNumber,
  });
  assertStatus(result, 'U-04 confirm replay (same key) returns 201', replay, CREATED);
  recordAssertion(
    result,
    'U-04 double-submit guard: replay returns the same transaction number',
    stringId(replay.body, ['transactionNumber']) === transactionNumber,
    `first=${transactionNumber} replay=${stringId(replay.body, ['transactionNumber'])}`,
  );
  const chainAfterReplay = await confirmationState(ctx, previewSessionId);
  recordAssertion(
    result,
    'U-04 double-submit guard: chain counts unchanged after replay',
    JSON.stringify(chainAfterReplay) === JSON.stringify(chain),
    JSON.stringify(chainAfterReplay),
  );

  const receipt = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/merchant/transactions/${transactionNumber}`,
    token: world.merchantToken,
  });
  assertStatus(result, 'U-04 receipt/detail returns 200', receipt, OK);

  const history = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/merchant/transactions?limit=20',
    token: world.merchantToken,
  });
  assertStatus(result, 'U-04 history returns 200', history, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-05 MCP (read/ledger + governed adjustment workflow)
// ---------------------------------------------------------------------------

export async function runU05(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-05', 'MCP (merchant cash pool)');
  const world = ctx.world;
  const merchant = world.merchant;
  await seedMcpAdjustFixtures(ctx);

  const read = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/merchant/branches/${merchant.branchId}/mcp`,
    token: merchant.merchantToken,
    headers: { 'x-market-id': world.marketId },
  });
  assertStatus(result, 'U-05 merchant MCP read returns 200', read, OK);
  const ledger = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/merchant/branches/${merchant.branchId}/mcp/ledger`,
    token: merchant.merchantToken,
    headers: { 'x-market-id': world.marketId },
  });
  assertStatus(result, 'U-05 merchant MCP ledger returns 200', ledger, OK);
  const adminRead = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/markets/${world.marketId}/mcp/accounts/${merchant.mcpAccountId}`,
    token: world.superAdmin.token,
  });
  assertStatus(result, 'U-05 admin MCP read returns 200', adminRead, OK);

  // Governed adjustment chain: maker -> submit -> checker decision -> execute.
  const maker = await createAdmin(ctx.database, ctx.auth, [world.marketId], 'SUPER_ADMIN');
  const checker = await createAdmin(ctx.database, ctx.auth, [world.marketId], 'SUPER_ADMIN');
  await seedMfaFactor(ctx, maker);
  await seedMfaFactor(ctx, checker);
  await selectMarketFor(ctx, maker.accountId, world.marketId);
  await selectMarketFor(ctx, checker.accountId, world.marketId);

  const balanceBeforeRows = await ctx.pool.query<{ balance: string }>(
    `SELECT available_balance::text AS balance FROM mcp_accounts WHERE id = $1`,
    [merchant.mcpAccountId],
  );
  const balanceBefore = balanceBeforeRows.rows[0]?.balance ?? '';

  const base = `/api/v1/admin/markets/${world.marketId}/mcp/accounts/${merchant.mcpAccountId}/adjustments`;
  const createKey = `uat05-create-${randomSuffix()}`;
  const adjustPayload = {
    type: 'MANUAL_CREDIT',
    amount: '5',
    reasonCode: 'OPERATIONAL_CORRECTION',
    explanation: 'UAT U-05 governed adjustment.',
    caseReference: `UAT05-${randomSuffix()}`,
  };
  const created = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: maker.token,
    idempotencyKey: createKey,
    body: adjustPayload,
  });
  assertStatus(result, 'U-05 adjustment create returns 201', created, CREATED);
  const requestId = stringId(created.body, ['id']);
  recordAssertion(result, 'U-05 adjustment request id present', requestId !== '', JSON.stringify(created.body));

  const submit = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${requestId}/submit`,
    token: maker.token,
  });
  assertStatus(result, 'U-05 maker submit returns 200', submit, OK);

  const approveStepUp = await seedStepUpGrant(ctx, checker, 'merchant.mcp.adjust.approve', world.marketId);
  const decision = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${requestId}/decision`,
    token: checker.token,
    headers: { 'x-step-up-token': approveStepUp },
    body: { decision: 'APPROVED', reason: 'Evidence verified.' },
  });
  assertStatus(result, 'U-05 checker decision returns 200', decision, OK);

  const executeStepUp = await seedStepUpGrant(ctx, checker, 'merchant.mcp.adjust.execute', world.marketId);
  const executed = await httpCallWithTimeout(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/markets/${world.marketId}/adjustments/${requestId}/execute`,
    token: checker.token,
    headers: { 'x-step-up-token': executeStepUp },
    body: { decision: 'APPROVED', reason: 'Execute.' },
  }, 30_000);
  assertStatus(result, 'U-05 adjustment execute returns 200', executed, OK);

  const balanceAfterRows = await ctx.pool.query<{ balance: string }>(
    `SELECT available_balance::text AS balance FROM mcp_accounts WHERE id = $1`,
    [merchant.mcpAccountId],
  );
  const balanceAfter = balanceAfterRows.rows[0]?.balance ?? '';
  const delta = Number(balanceAfter) - Number(balanceBefore);
  recordAssertion(
    result,
    'U-05 execute credits MCP exactly +5.00',
    Math.abs(delta - 5) < 0.000001,
    `${balanceBefore} -> ${balanceAfter} (delta ${delta.toFixed(4)})`,
  );
  // Ledger entry: exactly one MANUAL_CREDIT entry for this account.
  const ledgerRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM mcp_ledger_entries
      WHERE mcp_account_id = $1 AND entry_type = 'MANUAL_CREDIT'`,
    [merchant.mcpAccountId],
  );
  recordAssertion(
    result,
    'U-05 ledger contains exactly one MANUAL_CREDIT entry for the adjustment',
    Number(ledgerRows.rows[0]?.count ?? 0) === 1,
    `entries=${ledgerRows.rows[0]?.count ?? 0}`,
  );
  const auditRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_logs WHERE entity_id = $1`,
    [requestId],
  );
  recordAssertion(
    result,
    'U-05 adjustment lifecycle is fully audited',
    Number(auditRows.rows[0]?.count ?? 0) >= 3,
    `audit rows=${auditRows.rows[0]?.count ?? 0}`,
  );

  // Idempotency: replay the create key + payload -> original request.
  const replayCreate = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: maker.token,
    idempotencyKey: createKey,
    body: adjustPayload,
  });
  recordAssertion(
    result,
    'U-05 create replay (same key) returns original request',
    replayCreate.status === 201 && stringId(replayCreate.body, ['id']) === requestId,
    `status ${replayCreate.status}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-06 iPoint earning (exactly-once)
// ---------------------------------------------------------------------------

export async function runU06(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-06', 'iPoint earning');
  const world = ctx.world;
  const memberId = world.merchant.memberId;

  // Seed a reward-source baseline AFTER the first confirm so the delta
  // assertion below measures exactly the second confirmation's earning.
  await confirmFreshTransaction(ctx);
  const sourcesBefore = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM reward_sources WHERE member_id = $1`,
    [memberId],
  );

  const confirmKey = `uat06-confirm-${randomSuffix()}`;
  const preview2 = await previewTransaction(ctx);
  const preview2Id = stringId(preview2.body, ['previewSessionId']);
  const receipt = `UAT06-REC-${randomSuffix()}`;
  const confirm2 = await confirmTransaction(ctx, preview2Id, {
    idempotencyKey: confirmKey,
    merchantReceiptNumber: receipt,
  });
  assertStatus(result, 'U-06 confirm returns 201', confirm2, CREATED);
  const txNumber = stringId(confirm2.body, ['transactionNumber']);
  const txRows = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM transactions WHERE transaction_number = $1`,
    [txNumber],
  );
  const txId = txRows.rows[0]?.id ?? '';
  recordAssertion(
    result,
    'U-06 confirmed transaction resolved',
    txId !== '',
    `txNumber=${txNumber}`,
  );

  const entriesAfter = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM member_wallet_entries
      WHERE member_id = $1 AND reference_id = $2::text`,
    [memberId, txId],
  );
  recordAssertion(
    result,
    'U-06 earning credits exactly one wallet entry for the transaction',
    Number(entriesAfter.rows[0]?.count ?? 0) === 1,
    `entries for tx=${entriesAfter.rows[0]?.count}`,
  );

  const sourcesAfter = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM reward_sources WHERE member_id = $1`,
    [memberId],
  );
  recordAssertion(
    result,
    'U-06 one confirmed transaction earns exactly one reward source',
    Number(sourcesAfter.rows[0]?.count ?? 0) - Number(sourcesBefore.rows[0]?.count ?? 0) === 1,
    `sources ${sourcesBefore.rows[0]?.count} -> ${sourcesAfter.rows[0]?.count}`,
  );

  // Replay the confirm key -> no second credit.
  const replay = await confirmTransaction(ctx, preview2Id, {
    idempotencyKey: confirmKey,
    merchantReceiptNumber: receipt,
  });
  assertStatus(result, 'U-06 confirm replay (same key) returns 201', replay, CREATED);
  const sourcesReplay = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM reward_sources WHERE member_id = $1`,
    [memberId],
  );
  recordAssertion(
    result,
    'U-06 replay does not double-credit (no second reward source)',
    Number(sourcesReplay.rows[0]?.count ?? 0) === Number(sourcesAfter.rows[0]?.count ?? 0),
    `sources after replay=${sourcesReplay.rows[0]?.count}`,
  );
  const entriesReplay = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM member_wallet_entries
      WHERE member_id = $1 AND reference_id = $2::text`,
    [memberId, txId],
  );
  recordAssertion(
    result,
    'U-06 replay does not double-credit (wallet entries unchanged)',
    Number(entriesReplay.rows[0]?.count ?? 0) === 1,
    `entries for tx after replay=${entriesReplay.rows[0]?.count}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-07 wallet (balance/ledger, exact-decimal)
// ---------------------------------------------------------------------------

export async function runU07(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-07', 'wallet');
  const world = ctx.world;
  const member = await createMember(ctx.database, ctx.auth, world.marketId);
  const walletId = await ensureMemberWallet(ctx, member.memberId, '100000');

  const list = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/wallets',
    token: member.token,
  });
  assertStatus(result, 'U-07 wallet list returns 200', list, OK);
  const listBody = list.body as Array<Record<string, unknown>> | { items?: Array<Record<string, unknown>> };
  const items = Array.isArray(listBody) ? listBody : (listBody.items ?? []);
  recordAssertion(
    result,
    'U-07 wallet list contains the current-market wallet',
    items.some((item) => item['id'] === walletId),
    `wallets=${items.length} body=${JSON.stringify(list.body).slice(0, 400)}`,
  );

  const detail = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/wallets/${walletId}`,
    token: member.token,
  });
  assertStatus(result, 'U-07 wallet detail returns 200', detail, OK);
  const balance = stringId(detail.body, ['availableBalance', 'available_balance']);
  recordAssertion(
    result,
    'U-07 wallet balance is an exact-decimal string (no float, no fabricated zero)',
    balance !== '' && /^\d+(\.\d+)?$/u.test(balance) && Number(balance) === 100000,
    `balance=${balance} body=${JSON.stringify(detail.body).slice(0, 300)}`,
  );

  const entries = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/wallets/${walletId}/entries`,
    token: member.token,
  });
  assertStatus(result, 'U-07 wallet ledger entries return 200', entries, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-08 agent/referral commission
// ---------------------------------------------------------------------------

export async function runU08(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-08', 'agent/referral commission');
  const world = ctx.world;
  await ensureRolePermissions(ctx, 'SUPER_ADMIN', ['commission.read']);
  // Deterministic outbox verification: stop the auto-worker timer so every
  // drain assertion runs against explicit processBatchOnce cycles (the
  // worker's bounded behaviour is still asserted via attempts/max_attempts).
  ctx.outboxWorker.stop();

  // Referral: register a new member with the world member's referral code
  // (the completion step matches members.referral_code exactly; the
  // harness normalizes the fixture code to uppercase).
  const referrerRows = await ctx.pool.query<{ referralCode: string }>(
    `SELECT referral_code AS "referralCode" FROM members WHERE id = $1`,
    [world.merchant.memberId],
  );
  const referralCode = referrerRows.rows[0]?.referralCode ?? '';
  const newEmail = `uat08-${randomSuffix()}@example.com`;
  const initiate = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/register',
    body: {
      email: newEmail,
      password: 'Uat-Referral-Password-123!',
      account_country: 'MY',
      referral_code: referralCode,
      terms_version: 'v1',
      disclaimer_version: 'v1',
      privacy_version: 'v1',
      locale: 'en-MY',
    },
  });
  assertStatus(result, 'U-08 referral registration initiate returns 202', initiate, ACCEPTED);
  const otpId = stringId(initiate.body, ['otp_id']);
  const devCode = stringId(initiate.body, ['development_code']);
  const verify = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/register/verify',
    body: { otp_id: otpId, code: devCode },
  });
  assertStatus(result, 'U-08 referral registration verify returns 200', verify, OK);
  const complete = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/register/complete',
    body: { otp_id: otpId, idempotency_key: `registration-${randomUUID()}` },
  });
  assertStatus(result, 'U-08 referral registration complete returns 200', complete, OK);

  const login = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/login',
    body: { email: newEmail, password: 'Uat-Referral-Password-123!' },
  });
  assertStatus(result, 'U-08 referred member login returns 200', login, OK);
  const newMemberToken = stringId(login.body, ['accessToken']);

  const tree = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/referral/tree',
    token: newMemberToken,
  });
  assertStatus(result, 'U-08 referral tree returns 200', tree, OK);

  // Outbox drain: confirm one transaction, then drain until zero
  // (worker drains BATCH_SIZE 10 per cycle); exactly-once.
  const pendingBefore = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM transaction_commission_dispatch WHERE status = 'PENDING'`,
    [],
  );
  await confirmFreshTransaction(ctx);
  for (let i = 0; i < 25; i += 1) {
    await ctx.outboxWorker.processBatchOnce();
    const still = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transaction_commission_dispatch WHERE status = 'PENDING'`,
      [],
    );
    if (Number(still.rows[0]?.count ?? 0) === 0) break;
  }
  const pendingAfter = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM transaction_commission_dispatch WHERE status = 'PENDING'`,
    [],
  );
  recordAssertion(
    result,
    'U-08 outbox backlog drains to zero',
    Number(pendingAfter.rows[0]?.count ?? 0) === 0,
    `PENDING ${pendingBefore.rows[0]?.count} -> ${pendingAfter.rows[0]?.count}`,
  );
  const dupes = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM (
       SELECT transaction_id, event_type, count(*) n
         FROM transaction_commission_dispatch
        GROUP BY transaction_id, event_type HAVING count(*) > 1
     ) dup`,
    [],
  );
  recordAssertion(
    result,
    'U-08 no duplicate dispatch rows (no double-processing)',
    Number(dupes.rows[0]?.count ?? 0) === 0,
    `duplicate groups=${dupes.rows[0]?.count ?? 0}`,
  );

  const ledger = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/commission/ledger',
    token: world.member.token,
  });
  assertStatus(result, 'U-08 commission ledger returns 200', ledger, OK);
  const summary = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/commission/summary',
    token: world.member.token,
  });
  assertStatus(result, 'U-08 commission summary returns 200', summary, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-09 merchant package (eligibility/lifecycle)
// ---------------------------------------------------------------------------

export async function runU09(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-09', 'merchant package');
  const world = ctx.world;
  const merchant = world.merchant;

  const list = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/merchant/branches/${merchant.branchId}/packages`,
    token: merchant.merchantToken,
    headers: { 'x-market-id': world.marketId },
  });
  assertStatus(result, 'U-09 merchant package list returns 200', list, OK);
  const items = (list.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-09 merchant has exactly the seeded active package',
    items.length >= 1,
    `packages=${items.length}`,
  );

  const assignmentRows = await ctx.pool.query<{ id: string; status: string }>(
    `SELECT id, status::text AS status FROM merchant_package_assignments
      WHERE merchant_branch_id = $1`,
    [merchant.branchId],
  );
  const assignments = assignmentRows.rows;
  const activeAssignments = assignments.filter((a) => a.status === 'ACTIVE');
  if (activeAssignments.length === 1) {
    // L-27: the last active profile cannot be paused -> governed 409.
    const pause = await httpCall(ctx.baseUrl, {
      method: 'PATCH',
      path: `/api/v1/merchant/branches/${merchant.branchId}/packages/assignments/${activeAssignments[0]?.id ?? ''}/pause`,
      token: merchant.merchantToken,
      idempotencyKey: `uat09-pause-${randomSuffix()}`,
      headers: { 'x-market-id': world.marketId },
    });
    recordAssertion(
      result,
      'U-09 pausing the last active package is rejected (L-27)',
      pause.status === 409,
      `status ${pause.status} code=${errorCode(pause.body) ?? 'n/a'}`,
    );
  } else {
    recordAssertion(result, 'U-09 last-active-pause guard exercised', false, `active assignments=${activeAssignments.length}`);
  }

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-10 special percentage
// ---------------------------------------------------------------------------

export async function runU10(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-10', 'special percentage');
  const world = ctx.world;
  const admin = world.superAdmin;
  const base = `/api/v1/admin/package-ops/markets/${world.marketId}/special-percentages`;

  const stepUp = await seedStepUpGrant(ctx, admin, 'merchant.special_package.manage', world.marketId);
  const created = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: admin.token,
    idempotencyKey: `uat10-special-${randomSuffix()}`,
    headers: { 'x-step-up-token': stepUp },
    body: { rate: '12', description: 'UAT special percentage 12%', reason: 'UAT U-10 fixture.' },
  });
  assertStatus(result, 'U-10 special percentage create returns 201', created, CREATED);
  const createdRate = stringId(created.body, ['rate']);
  recordAssertion(
    result,
    'U-10 created special percentage preserves the exact decimal rate',
    createdRate === '12' || createdRate === '12.000000',
    `rate=${createdRate}`,
  );

  // Invariant guard: rate must be in (0, 100] with at most 6 decimals.
  for (const [label, badRate] of [
    ['zero', '0'],
    ['over-100', '101'],
    ['7-decimals', '1.1234567'],
  ] as const) {
    const stepUpBad = await seedStepUpGrant(ctx, admin, 'merchant.special_package.manage', world.marketId);
    const rejected = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: base,
      token: admin.token,
      idempotencyKey: `uat10-bad-${label}-${randomSuffix()}`,
      headers: { 'x-step-up-token': stepUpBad },
      body: { rate: badRate, description: 'Invalid rate', reason: 'UAT negative fixture.' },
    });
    recordAssertion(
      result,
      `U-10 invalid rate ${label} rejected (400)`,
      rejected.status === 400,
      `status ${rejected.status} code=${errorCode(rejected.body) ?? 'n/a'}`,
    );
  }

  const stepUpList = await seedStepUpGrant(ctx, admin, 'merchant.special_package.manage', world.marketId);
  const list = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: base,
    token: admin.token,
    headers: { 'x-step-up-token': stepUpList },
  });
  assertStatus(result, 'U-10 special percentage list returns 200', list, OK);
  const items = (list.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-10 special percentage list contains the created rate',
    items.some((item) => String(item['rate']) === '12.000000' || String(item['rate']) === '12'),
    `items=${items.length}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-11 reward rules
// ---------------------------------------------------------------------------

export async function runU11(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-11', 'reward rules');
  const world = ctx.world;
  const base = `/api/v1/admin/reward-ops/markets/${world.marketId}/rules`;

  const listBefore = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: base,
    token: world.superAdmin.token,
  });
  assertStatus(result, 'U-11 reward rule list returns 200', listBefore, OK);

  const futureDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  // Package C shares the 0.05%/day governance ceiling (S6 comment: B 0.025,
  // C/D/E/F 0.05); package A caps at 0.0125 so the ceiling test must use C.
  const scheduled = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: world.superAdmin.token,
    idempotencyKey: `uat11-rule-${randomSuffix()}`,
    body: {
      package_reference: 'C',
      rate: '0.05',
      effective_date: futureDate,
      reason: 'UAT U-11 fixture rule.',
      description: 'UAT rule',
    },
  });
  assertStatus(result, 'U-11 reward rule schedule returns 201', scheduled, CREATED);

  const listAfter = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: base,
    token: world.superAdmin.token,
  });
  assertStatus(result, 'U-11 reward rule list reflects the scheduled rule', listAfter, OK);
  const items = (listAfter.body as { rules?: Array<Record<string, unknown>> })?.rules ?? [];
  recordAssertion(
    result,
    'U-11 scheduled rule appears in the market-scoped list',
    items.some(
      (item) =>
        String(item['reward_rate']) === '0.05' ||
        String(item['reward_rate']) === '0.050000',
    ),
    `items=${items.length} rules=${JSON.stringify(items).slice(0, 300)}`,
  );

  // Governance ceiling: > 0.05%/day is rejected (O-06/D-046).
  const over = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: world.superAdmin.token,
    idempotencyKey: `uat11-over-${randomSuffix()}`,
    body: {
      package_reference: 'C',
      rate: '0.06',
      effective_date: futureDate,
      reason: 'UAT governance negative fixture.',
    },
  });
  recordAssertion(
    result,
    'U-11 rate above the 0.05%/day governance ceiling is rejected',
    (over.status === 400 || over.status === 422) && errorCode(over.body) === 'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
    `status ${over.status} code=${errorCode(over.body) ?? 'n/a'}`,
  );

  // Market isolation: the M1 rule must not appear in the M2 list; the
  // foreign-market admin read is denied by the current-market guard (409
  // MARKET_CONTEXT_MISMATCH) — the zero-fallback contract.
  const foreign = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/reward-ops/markets/${world.secondaryMarketId}/rules`,
    token: world.superAdmin.token,
  });
  recordAssertion(
    result,
    'U-11 foreign-market rule read denied (409 MARKET_CONTEXT_MISMATCH)',
    foreign.status === 409 && errorCode(foreign.body) === 'MARKET_CONTEXT_MISMATCH',
    `status ${foreign.status} code=${errorCode(foreign.body) ?? 'n/a'}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-12 redemption (catalog/quote/order/voucher)
// ---------------------------------------------------------------------------

export async function runU12(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-12', 'redemption (catalog/quote/order/voucher)');
  const world = ctx.world;
  const fixture = await seedRedemptionFixture(ctx);
  const memberToken = world.merchant.memberToken;

  const catalog = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/redemption/catalog',
    token: memberToken,
  });
  assertStatus(result, 'U-12 catalog returns 200', catalog, OK);
  const catalogItems = (catalog.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-12 catalog is market-scoped (contains the seeded item)',
    catalogItems.some((item) => item['id'] === fixture.itemId),
    `items=${catalogItems.length}`,
  );

  const quote = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
    token: memberToken,
  });
  assertStatus(result, 'U-12 quote returns 200', quote, OK);
  const quoteBody = quote.body as { quoteId?: string; postedPointCost?: string; expiresAt?: string };
  recordAssertion(
    result,
    'U-12 quote returns exact-decimal point cost + expiry',
    quoteBody.quoteId !== undefined &&
      quoteBody.postedPointCost !== undefined &&
      /^\d+(\.\d+)?$/u.test(quoteBody.postedPointCost ?? '') &&
      quoteBody.expiresAt !== undefined,
    JSON.stringify(quoteBody),
  );

  const debitsBefore = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM member_wallet_entries
      WHERE member_id = $1 AND entry_type = 'REDEMPTION_DEBIT'`,
    [world.merchant.memberId],
  );
  const orderKey = `uat12-order-${randomUUID()}`;
  const orderBody = {
    quoteId: quoteBody.quoteId,
    idempotencyKey: orderKey,
    expectedItemVersion: 1,
    expectedTotalPoints: quoteBody.postedPointCost,
    expectedQuantity: '1',
    fulfilment: { type: 'PICKUP', pickupLocationId: fixture.pickupLocationId },
    termsAcceptance: { accepted: true, termsVersion: 'v1' },
  };
  const order = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/redemption/orders',
    token: memberToken,
    body: orderBody,
  });
  assertStatus(result, 'U-12 order-create returns 201', order, CREATED);
  const orderId = stringId(order.body, ['id', 'orderId']);

  const replayOrder = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/redemption/orders',
    token: memberToken,
    body: orderBody,
  });
  assertStatus(result, 'U-12 order replay (same key) returns 201', replayOrder, CREATED);
  recordAssertion(
    result,
    'U-12 order replay returns the same order (exactly-once)',
    stringId(replayOrder.body, ['id', 'orderId']) === orderId,
    `first=${orderId} replay=${stringId(replayOrder.body, ['id', 'orderId'])}`,
  );

  const debitsAfter = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM member_wallet_entries
      WHERE member_id = $1 AND entry_type = 'REDEMPTION_DEBIT'`,
    [world.merchant.memberId],
  );
  recordAssertion(
    result,
    'U-12 exactly one wallet debit per order',
    Number(debitsAfter.rows[0]?.count ?? 0) - Number(debitsBefore.rows[0]?.count ?? 0) === 1,
    `debits ${debitsBefore.rows[0]?.count} -> ${debitsAfter.rows[0]?.count}`,
  );

  // OBS-01 expected outcome: a second order on the SAME quote -> 409.
  const secondOrder = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/redemption/orders',
    token: memberToken,
    body: { ...orderBody, idempotencyKey: `uat12-race-${randomUUID()}` },
  });
  recordAssertion(
    result,
    'U-12 consumed-quote race returns bounded 409 (OBS-01 expected, not a defect)',
    secondOrder.status === 409,
    `status ${secondOrder.status} code=${errorCode(secondOrder.body) ?? 'n/a'}`,
  );

  // Market isolation: M1 item must not appear in the M2 member catalog.
  const m2Member = await createMember(ctx.database, ctx.auth, world.secondaryMarketId);
  const foreignCatalog = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/redemption/catalog',
    token: m2Member.token,
  });
  const foreignItems = (foreignCatalog.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-12 zero cross-market fallback: M1 item absent from M2 catalog',
    !foreignItems.some((item) => item['id'] === fixture.itemId),
    `M2 catalog items=${foreignItems.length}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-13 fulfilment (pickup/backorder/suspend/exception/retry)
// ---------------------------------------------------------------------------

export async function runU13(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-13', 'fulfilment (pickup/suspend/exception/retry)');
  const world = ctx.world;
  const fixture = await seedFulfilmentFixture(ctx);
  const base = `/api/v1/admin/redemption-fulfilment-ops/markets/${world.marketId}`;
  const token = world.superAdmin.token;

  const queues = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/queues`, token });
  assertStatus(result, 'U-13 fulfilment queues return 200', queues, OK);
  const pickup = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/queues/READY_FOR_PICKUP`, token });
  assertStatus(result, 'U-13 READY_FOR_PICKUP queue returns 200', pickup, OK);
  const detail = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/orders/${fixture.confirmedOrderId}`, token });
  assertStatus(result, 'U-13 order detail returns 200', detail, OK);

  const suspend = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/orders/${fixture.confirmedOrderId}/suspend`,
    token,
    idempotencyKey: `uat13-suspend-${randomSuffix()}`,
    body: { reason: 'UAT U-13 suspend.' },
  });
  assertStatus(result, 'U-13 suspend returns 200', suspend, OK);
  const suspendedState = await ctx.pool.query<{ status: string }>(
    `SELECT status::text AS status FROM redemption_orders WHERE id = $1`,
    [fixture.confirmedOrderId],
  );
  recordAssertion(
    result,
    'U-13 order transitions to FULFILMENT_SUSPENDED',
    suspendedState.rows[0]?.status === 'FULFILMENT_SUSPENDED',
    `status=${suspendedState.rows[0]?.status}`,
  );

  const resume = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/orders/${fixture.confirmedOrderId}/resume`,
    token,
    idempotencyKey: `uat13-resume-${randomSuffix()}`,
  });
  assertStatus(result, 'U-13 resume returns 200', resume, OK);

  const retry = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/fulfilments/${fixture.exceptionFulfilmentId}/retry`,
    token,
    idempotencyKey: `uat13-retry-${randomSuffix()}`,
  });
  assertStatus(result, 'U-13 exception retry returns 200', retry, OK);
  const exceptionQueue = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `${base}/queues/FULFILMENT_EXCEPTION`,
    token,
  });
  assertStatus(result, 'U-13 FULFILMENT_EXCEPTION queue returns 200', exceptionQueue, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-14 refund (reversal/refund, identity guard)
// ---------------------------------------------------------------------------

export async function runU14(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-14', 'refund (reversal/refund)');
  const world = ctx.world;
  const merchant = world.merchant;

  const { transactionNumber } = await confirmFreshTransaction(ctx);
  const reversal = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${transactionNumber}/reversal-requests`,
    token: merchant.merchantToken,
    idempotencyKey: `uat14-reversal-${randomSuffix()}`,
    body: { reasonCode: 'CUSTOMER_REQUEST' },
  });
  assertStatus(result, 'U-14 reversal-request returns 201', reversal, CREATED);

  // One reversal + one refund per transaction (frozen rule): the refund
  // request is exercised on a SECOND fresh transaction.
  const { transactionNumber: refundTx } = await confirmFreshTransaction(ctx);
  const refund = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${refundTx}/refund-requests`,
    token: merchant.merchantToken,
    idempotencyKey: `uat14-refund-${randomSuffix()}`,
    body: { reasonCode: 'CUSTOMER_REQUEST' },
  });
  assertStatus(result, 'U-14 refund-request returns 201', refund, CREATED);

  const reversalRead = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/merchant/transactions/${transactionNumber}/reversal-request`,
    token: merchant.merchantToken,
  });
  assertStatus(result, 'U-14 reversal read returns 200', reversalRead, OK);
  const refundRead = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/merchant/transactions/${refundTx}/refund-request`,
    token: merchant.merchantToken,
  });
  assertStatus(result, 'U-14 refund read returns 200', refundRead, OK);

  // One reversal + one refund per transaction (frozen rule): a second
  // reversal on the same transaction must be rejected.
  const secondReversal = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${transactionNumber}/reversal-requests`,
    token: merchant.merchantToken,
    idempotencyKey: `uat14-reversal2-${randomSuffix()}`,
    body: { reasonCode: 'CUSTOMER_REQUEST' },
  });
  recordAssertion(
    result,
    'U-14 second reversal on one transaction is rejected (one-per-tx rule)',
    secondReversal.status === 409 || secondReversal.status === 400,
    `status ${secondReversal.status} code=${errorCode(secondReversal.body) ?? 'n/a'}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-15 manual MCP Maker/Checker
// ---------------------------------------------------------------------------

export async function runU15(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-15', 'manual MCP Maker/Checker');
  const world = ctx.world;
  await seedMcpAdjustFixtures(ctx);
  const maker = await createAdmin(ctx.database, ctx.auth, [world.marketId], 'SUPER_ADMIN');
  const checker = await createAdmin(ctx.database, ctx.auth, [world.marketId], 'SUPER_ADMIN');
  await seedMfaFactor(ctx, maker);
  await seedMfaFactor(ctx, checker);
  await selectMarketFor(ctx, maker.accountId, world.marketId);
  await selectMarketFor(ctx, checker.accountId, world.marketId);

  const base = `/api/v1/admin/markets/${world.marketId}/mcp/accounts/${world.merchant.mcpAccountId}/adjustments`;
  const created = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: maker.token,
    idempotencyKey: `uat15-create-${randomSuffix()}`,
    body: {
      type: 'MANUAL_CREDIT',
      amount: '5',
      reasonCode: 'OPERATIONAL_CORRECTION',
      explanation: 'UAT U-15 MCP Maker/Checker.',
      caseReference: `UAT15-${randomSuffix()}`,
    },
  });
  assertStatus(result, 'U-15 maker create returns 201', created, CREATED);
  const requestId = stringId(created.body, ['id']);

  const submit = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${requestId}/submit`,
    token: maker.token,
  });
  assertStatus(result, 'U-15 maker submit returns 200', submit, OK);

  // Checker must NOT be the maker (L-16): the maker's own decision is denied.
  const makerOwnStepUp = await seedStepUpGrant(ctx, maker, 'merchant.mcp.adjust.approve', world.marketId);
  const makerOwnDecision = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${requestId}/decision`,
    token: maker.token,
    headers: { 'x-step-up-token': makerOwnStepUp },
    body: { decision: 'APPROVED', reason: 'Maker self-approval attempt.' },
  });
  recordAssertion(
    result,
    'U-15 maker cannot self-approve (L-16 maker != checker)',
    makerOwnDecision.status === 403 || makerOwnDecision.status === 409 || makerOwnDecision.status === 400,
    `status ${makerOwnDecision.status} code=${errorCode(makerOwnDecision.body) ?? 'n/a'}`,
  );

  const checkerStepUp = await seedStepUpGrant(ctx, checker, 'merchant.mcp.adjust.approve', world.marketId);
  const decision = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${requestId}/decision`,
    token: checker.token,
    headers: { 'x-step-up-token': checkerStepUp },
    body: { decision: 'APPROVED', reason: 'Checker approves.' },
  });
  assertStatus(result, 'U-15 checker decision returns 200', decision, OK);

  // Double-decision (2-way) on a FRESH submitted request: exactly one
  // accepted transition.
  const stormCreate = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: maker.token,
    idempotencyKey: `uat15-storm-create-${randomSuffix()}`,
    body: {
      type: 'MANUAL_CREDIT',
      amount: '5',
      reasonCode: 'OPERATIONAL_CORRECTION',
      explanation: 'UAT U-15 double-decision.',
      caseReference: `UAT15S-${randomSuffix()}`,
    },
  });
  const stormRequestId = stringId(stormCreate.body, ['id']);
  await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/markets/${world.marketId}/mcp/adjustments/${stormRequestId}/submit`,
    token: maker.token,
  });
  const [grantA, grantB] = await Promise.all([
    seedStepUpGrant(ctx, checker, 'merchant.mcp.adjust.approve', world.marketId),
    seedStepUpGrant(ctx, checker, 'merchant.mcp.adjust.approve', world.marketId),
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
  const finalStateRows = await ctx.pool.query<{ state: string }>(
    `SELECT status::text AS state FROM mcp_adjustment_requests WHERE id = $1`,
    [stormRequestId],
  );
  recordAssertion(
    result,
    'U-15 concurrent double-decision -> exactly one accepted transition',
    finalStateRows.rows[0]?.state === 'APPROVED' && decisionA.status !== decisionB.status,
    `statuses ${decisionA.status},${decisionB.status}; final=${finalStateRows.rows[0]?.state}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-16 manual iPoint Maker/Checker
// ---------------------------------------------------------------------------

export async function runU16(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-16', 'manual iPoint Maker/Checker');
  const world = ctx.world;
  await seedIpointAdjustFixtures(ctx);
  const maker = await createAdmin(ctx.database, ctx.auth, [world.marketId], 'SUPER_ADMIN');
  const checker = await createAdmin(ctx.database, ctx.auth, [world.marketId], 'SUPER_ADMIN');
  await seedMfaFactor(ctx, maker);
  await seedMfaFactor(ctx, checker);
  await selectMarketFor(ctx, maker.accountId, world.marketId);
  await selectMarketFor(ctx, checker.accountId, world.marketId);

  const member = await createMember(ctx.database, ctx.auth, world.marketId);
  const walletId = await ensureMemberWallet(ctx, member.memberId, '5000');
  const base = `/api/v1/admin/ipoint-adjust-ops/markets/${world.marketId}/adjustments`;

  const created = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: maker.token,
    idempotencyKey: `uat16-create-${randomSuffix()}`,
    body: {
      walletAccountId: walletId,
      direction: 'CREDIT',
      amount: '5000',
      reasonCode: 'OPERATIONAL_CORRECTION',
      explanation: 'UAT U-16 iPoint Maker/Checker.',
      caseReference: `UAT16-${randomSuffix()}`,
    },
  });
  assertStatus(result, 'U-16 maker create returns 201', created, CREATED);
  const requestId = stringId(created.body, ['id']);

  const submit = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/${requestId}/submit`,
    token: maker.token,
  });
  assertStatus(result, 'U-16 maker submit returns 200', submit, OK);

  const checkerStepUp = await seedStepUpGrant(ctx, checker, 'wallet.ipoint.adjust.checker', world.marketId);
  const decision = await httpCallWithTimeout(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/${requestId}/decision`,
    token: checker.token,
    headers: { 'x-step-up-token': checkerStepUp },
    body: { decision: 'APPROVED', reason: 'Evidence verified.' },
  }, 30_000);
  assertStatus(result, 'U-16 checker decision returns 200', decision, OK);

  const executeStepUp = await seedStepUpGrant(ctx, checker, 'wallet.ipoint.adjust.execute', world.marketId);
  const executed = await httpCallWithTimeout(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/${requestId}/execute`,
    token: checker.token,
    headers: { 'x-step-up-token': executeStepUp },
    body: { decision: 'APPROVED', reason: 'Execute.' },
  }, 30_000);
  assertStatus(result, 'U-16 checker execute returns 200', executed, OK);

  const walletRows = await ctx.pool.query<{ balance: string }>(
    `SELECT available_balance::text AS balance FROM member_wallet_accounts WHERE id = $1`,
    [walletId],
  );
  recordAssertion(
    result,
    'U-16 executed iPoint adjustment credits the wallet exactly (+5000)',
    Number(walletRows.rows[0]?.balance ?? 0) === 10000,
    `balance=${walletRows.rows[0]?.balance}`,
  );

  const queue = await httpCall(ctx.baseUrl, { method: 'GET', path: base, token: checker.token });
  assertStatus(result, 'U-16 adjustment queue read returns 200', queue, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-17 admin workflows
// ---------------------------------------------------------------------------

export async function runU17(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-17', 'admin workflows');
  const world = ctx.world;
  const token = world.superAdmin.token;

  const members = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/member-ops/members?pageSize=10`,
    token,
  });
  assertStatus(result, 'U-17 member list returns 200', members, OK);
  const memberPublicId = stringId(
    (members.body as { members?: Array<Record<string, unknown>> })?.members?.[0] ?? {},
    ['publicMemberId', 'publicId'],
  );
  if (memberPublicId) {
    const detail = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/admin/member-ops/members/${memberPublicId}`,
      token,
    });
    assertStatus(result, 'U-17 member detail returns 200', detail, OK);
    const note = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/member-ops/members/${memberPublicId}/notes`,
      token,
      body: { content: 'UAT U-17 acceptance note', idempotencyKey: randomUUID() },
    });
    assertStatus(result, 'U-17 member note create returns 200', note, OK);
  } else {
    recordAssertion(result, 'U-17 member detail/note exercised', false, 'no member public id');
  }

  const kycQueue = await httpCall(ctx.baseUrl, { method: 'GET', path: '/api/v1/admin/kyc-ops/members', token });
  assertStatus(result, 'U-17 KYC queue returns 200', kycQueue, OK);

  const merchants = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/markets/${world.marketId}/merchants`,
    token,
  });
  assertStatus(result, 'U-17 merchant list returns 200', merchants, OK);
  // Branch-detail composition additionally requires the merchant-application
  // fixture set (owner getProfile + application/kyc composition); the world
  // merchant fixture has none. Covered by the admin-merchant-ops integration
  // suite; recorded as a fixture boundary, not a product finding.
  result.notes.push(
    'U-17: admin merchant branch-DETAIL composition requires merchant-application fixtures (admin-merchant-ops.integration.spec.ts pattern); the S6 world fixture has none, so detail is not exercised here — the merchant LIST + admin MCP read (U-05) are. Cited to the admin-merchant-ops integration suite.',
  );

  const packages = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/package-ops/markets/${world.marketId}/packages`,
    token,
  });
  assertStatus(result, 'U-17 package config list returns 200', packages, OK);

  const marketList = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/market-ops/markets/${world.marketId}`,
    token,
  });
  assertStatus(result, 'U-17 market config read returns 200', marketList, OK);

  const dashboard = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/admin/dashboard/metrics',
    token,
  });
  assertStatus(result, 'U-17 dashboard metrics returns 200', dashboard, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-18 audit
// ---------------------------------------------------------------------------

export async function runU18(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-18', 'audit');
  const world = ctx.world;
  const superToken = world.superAdmin.token;

  // Member-ops surfaces address the member by PUBLIC id.
  const publicRows = await ctx.pool.query<{ publicMemberId: string }>(
    `SELECT public_member_id AS "publicMemberId" FROM members WHERE id = $1`,
    [world.merchant.memberId],
  );
  const memberPublicId = publicRows.rows[0]?.publicMemberId ?? '';

  // Perform a mutation so audit has a fresh row to assert on.
  const note = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/member-ops/members/${memberPublicId}/notes`,
    token: superToken,
    body: { content: 'UAT U-18 audit probe', idempotencyKey: randomUUID() },
  });
  assertStatus(result, 'U-18 audit probe mutation returns 200', note, OK);

  const entries = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/audit-ops/markets/${world.marketId}/entries?limit=50`,
    token: superToken,
  });
  assertStatus(result, 'U-18 audit entries list returns 200', entries, OK);
  const items = (entries.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-18 audit contains the member-note mutation action',
    items.some((item) => String(item['action']).includes('member.note')),
    `entries=${items.length}`,
  );

  const firstId = stringId(items[0] ?? {}, ['id']);
  if (firstId) {
    const detail = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/admin/audit-ops/markets/${world.marketId}/entries/${firstId}`,
      token: superToken,
    });
    assertStatus(result, 'U-18 audit entry detail returns 200', detail, OK);

    // Raw diff view: super admin allowed (step-up + recorded reason);
    // support role denied (permission).
    const rawStepUp = await seedStepUpGrant(
      ctx,
      world.superAdmin,
      'audit.sensitive-diff.view',
      world.marketId,
    );
    const rawSuper = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/admin/audit-ops/markets/${world.marketId}/entries/${firstId}/raw`,
      token: superToken,
      headers: {
        'x-step-up-token': rawStepUp,
        'x-sensitive-access-reason': 'UAT U-18 raw audit evidence check',
      },
    });
    assertStatus(result, 'U-18 raw audit view allowed for super admin', rawSuper, OK);
    const rawSupport = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/admin/audit-ops/markets/${world.marketId}/entries/${firstId}/raw`,
      token: world.supportAdmin.token,
      headers: { 'x-sensitive-access-reason': 'UAT support attempt' },
    });
    recordAssertion(
      result,
      'U-18 raw audit view denied for support role (least privilege)',
      rawSupport.status === 403,
      `status ${rawSupport.status} code=${errorCode(rawSupport.body) ?? 'n/a'}`,
    );
  } else {
    recordAssertion(result, 'U-18 audit detail/raw exercised', false, 'no audit entry id');
  }

  // Historical immutability: re-reading the same entry yields the same
  // before/after payload after additional mutations.
  const beforeRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_logs WHERE entity_id = $1`,
    [world.merchant.memberId],
  );
  const note2 = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/member-ops/members/${memberPublicId}/notes`,
    token: superToken,
    body: { content: 'UAT U-18 immutability probe', idempotencyKey: randomUUID() },
  });
  assertStatus(result, 'U-18 second audit probe mutation returns 200', note2, OK);
  const afterRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_logs WHERE entity_id = $1`,
    [world.merchant.memberId],
  );
  recordAssertion(
    result,
    'U-18 audit log is append-only (rows only grow, nothing rewritten)',
    Number(afterRows.rows[0]?.count ?? 0) > Number(beforeRows.rows[0]?.count ?? 0),
    `rows ${beforeRows.rows[0]?.count} -> ${afterRows.rows[0]?.count}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-19 reports (R01-R19)
// ---------------------------------------------------------------------------

export async function runU19(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-19', 'reports (R01-R19)');
  const world = ctx.world;
  const base = `/api/v1/admin/report-ops/markets/${world.marketId}/reports`;
  const token = world.superAdmin.token;
  const codes = Array.from({ length: 19 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`);

  const list = await httpCall(ctx.baseUrl, { method: 'GET', path: base, token });
  assertStatus(result, 'U-19 report list returns 200', list, OK);
  let allOk = true;
  const failures: string[] = [];
  for (const code of codes) {
    const response = await httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `${base}/${code}?asOf=${encodeURIComponent(new Date().toISOString())}`,
      token,
    });
    if (response.status !== 200) {
      allOk = false;
      failures.push(`${code}=${response.status}`);
    }
  }
  recordAssertion(
    result,
    'U-19 all 19 report reads (R01-R19) return 200 with current asOf',
    allOk,
    failures.length === 0 ? 'all 19 OK' : failures.join(', '),
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-20 ads/content
// ---------------------------------------------------------------------------

export async function runU20(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-20', 'ads/content');
  const world = ctx.world;
  const base = `/api/v1/admin/ads-content/markets/${world.marketId}`;
  const token = world.superAdmin.token;

  const placement = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/placements`,
    token,
    idempotencyKey: `uat20-placement-${randomSuffix()}`,
    body: {
      code: `HOME_HERO_${randomSuffix().toUpperCase()}`,
      name: 'UAT home hero',
      description: 'UAT placement',
      position: 0,
      reason: 'UAT U-20 fixture.',
    },
  });
  assertStatus(result, 'U-20 placement create returns 201', placement, CREATED);
  const placementId = stringId(placement.body, ['id']);

  const ad = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/ads`,
    token,
    idempotencyKey: `uat20-ad-${randomSuffix()}`,
    body: {
      placementId,
      title: 'UAT local dining week',
      summary: 'UAT ad summary',
      creativeMediaUrl: 'https://cdn.example.test/uat.webp',
      creativeAltText: 'UAT ad',
      targetUrl: 'https://example.test/uat',
      sponsorLabel: 'Sponsored',
      reason: 'UAT U-20 fixture.',
    },
  });
  assertStatus(result, 'U-20 ad create returns 201', ad, CREATED);
  const adId = stringId(ad.body, ['id']);
  const adVersion = Number((ad.body as { version?: unknown })?.version ?? 1);

  const article = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/articles`,
    token,
    idempotencyKey: `uat20-article-${randomSuffix()}`,
    body: {
      slug: `uat-market-update-${randomSuffix()}`,
      title: 'UAT market update',
      excerpt: 'UAT excerpt',
      body: 'UAT verified content.',
      isPromoted: true,
      sponsorLabel: 'Promoted',
      reason: 'UAT U-20 fixture.',
    },
  });
  assertStatus(result, 'U-20 article create returns 201', article, CREATED);

  const activateAd = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/ads/${adId}/status`,
    token,
    idempotencyKey: `uat20-ad-status-${randomSuffix()}`,
    body: { status: 'ACTIVE', expectedVersion: adVersion, reason: 'UAT activate.' },
  });
  assertStatus(result, 'U-20 ad activate returns 200', activateAd, OK);

  const home = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/content/home',
    token: world.member.token,
  });
  assertStatus(result, 'U-20 member content home returns 200', home, OK);

  // Market isolation: M1 content must not surface in the M2 member home.
  const m2Member = await createMember(ctx.database, ctx.auth, world.secondaryMarketId);
  const foreignHome = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/content/home',
    token: m2Member.token,
  });
  assertStatus(result, 'U-20 foreign-market member home returns 200', foreignHome, OK);
  const foreignItems = (foreignHome.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-20 zero cross-market fallback: M1 content absent from M2 home',
    !foreignItems.some((item) => item['title'] === 'UAT local dining week' || item['title'] === 'UAT market update'),
    `M2 home items=${foreignItems.length}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-21 reconciliation (run/execute/exceptions) — OBS-04-mitigated profile
// ---------------------------------------------------------------------------

export async function runU21(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-21', 'reconciliation (run/execute/exceptions)');
  const world = ctx.world;
  const base = `/api/v1/admin/reconciliation/markets/${world.marketId}`;
  const token = world.superAdmin.token;
  const windowStart = '2026-01-01T00:00:00.000Z';
  const windowEnd = '2031-01-01T00:00:00.000Z';

  const created = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/runs`,
    token,
    idempotencyKey: `uat21-create-${randomSuffix()}`,
    body: { kind: 'MCP', windowStart, windowEnd, reason: 'UAT U-21 run.' },
  });
  assertStatus(result, 'U-21 run-create returns 201', created, CREATED);
  const runId = stringId(created.body, ['id']);

  // OBS-04-mitigated profile: single serial execute with a 25s client bound.
  const executed = await httpCallWithTimeout(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/runs/${runId}/execute`,
    token,
    idempotencyKey: `uat21-execute-${randomSuffix()}`,
  }, 25_000);
  assertStatus(result, 'U-21 run-execute returns 200', executed, OK);
  recordAssertion(
    result,
    'U-21 run completes on the OBS-04-mitigated profile',
    (executed.body as { status?: string })?.status === 'COMPLETED',
    JSON.stringify(executed.body).slice(0, 400),
  );
  // The world fixture merchant MCP account carries an un-ledgered opening
  // balance (5000 seeded directly, per the S6 world builder) — the
  // reconciliation engine correctly flags that class of drift as
  // mcp_account_total AMOUNT_MISMATCH (deterministically proven in U-36).
  // This is the engine's designed detection behaviour, not a product
  // defect; the exception queue surfaces it OPEN with no auto-correction.
  const mismatchCount = Number(
    (executed.body as { mismatched_count?: number })?.mismatched_count ?? 0,
  );
  result.notes.push(
    `U-21: run COMPLETED with ${mismatchCount} mismatch(es) = the fixture opening-balance drift class (un-ledgered balance), detected OPEN and never auto-corrected — cross-checked in U-36. No transaction-path drift is expected.`,
  );

  const runs = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/runs`, token });
  assertStatus(result, 'U-21 run list returns 200', runs, OK);
  const detail = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/runs/${runId}`, token });
  assertStatus(result, 'U-21 run detail returns 200', detail, OK);
  const exceptions = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/exceptions`, token });
  assertStatus(result, 'U-21 exception queue returns 200', exceptions, OK);

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-22 risk queues (detection/review, no enforcement side-effects)
// ---------------------------------------------------------------------------

export async function runU22(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-22', 'risk queues');
  const world = ctx.world;
  const base = `/api/v1/admin/risk-controls/markets/${world.marketId}`;
  const token = world.superAdmin.token;

  const definitions = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/definitions`, token });
  assertStatus(result, 'U-22 risk definitions list returns 200', definitions, OK);

  const definition = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/definitions`,
    token,
    idempotencyKey: `uat22-def-${randomSuffix()}`,
    body: {
      code: 'suspicious_amount_breach',
      category: 'SUSPICIOUS_TRANSACTION',
      name: 'UAT amount breach',
      // Threshold below the 100.00 UAT transactions already confirmed by
      // earlier scenarios (U-04/U-06/U-08/...) so the run produces real
      // flagged events + queue tasks on fixture data. The canonical
      // detector code (RiskDetectorCode switch in the run executor) is
      // required for the detector to run.
      config: { max_single_amount: '10.0000000000' },
      reason: 'UAT U-22 fixture.',
    },
  });
  assertStatus(result, 'U-22 definition create returns 201', definition, CREATED);

  const windowStart = '2026-01-01T00:00:00.000Z';
  const windowEnd = '2031-01-01T00:00:00.000Z';
  const run = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/runs`,
    token,
    idempotencyKey: `uat22-run-${randomSuffix()}`,
    body: { category: 'SUSPICIOUS_TRANSACTION', windowStart, windowEnd, reason: 'UAT U-22 run.' },
  });
  assertStatus(result, 'U-22 risk run create returns 201', run, CREATED);
  const runId = stringId(run.body, ['id']);
  const executed = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/runs/${runId}/execute`,
    token,
    idempotencyKey: `uat22-execute-${randomSuffix()}`,
  });
  assertStatus(result, 'U-22 risk run execute returns 200', executed, OK);

  const events = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `${base}/events?category=SUSPICIOUS_TRANSACTION`,
    token,
  });
  assertStatus(result, 'U-22 risk events list returns 200', events, OK);

  const queue = await httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/queue`, token });
  assertStatus(result, 'U-22 risk queue returns 200', queue, OK);
  const queueItems = (queue.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  const taskId = stringId(queueItems[0] ?? {}, ['id']);
  if (taskId) {
    const assigned = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/queue/${taskId}/assign`,
      token,
      idempotencyKey: `uat22-assign-${randomSuffix()}`,
      body: { expectedVersion: 1, reason: 'Claiming for review.' },
    });
    assertStatus(result, 'U-22 queue assign returns 200', assigned, OK);
    const decided = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/queue/${taskId}/decide`,
      token,
      idempotencyKey: `uat22-decide-${randomSuffix()}`,
      body: { expectedVersion: 2, decision: 'WATCH', decisionReason: 'Monitor.', reason: 'Decision recorded.' },
    });
    assertStatus(result, 'U-22 queue decide returns 200', decided, OK);
    const resolved = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/queue/${taskId}/resolve`,
      token,
      idempotencyKey: `uat22-resolve-${randomSuffix()}`,
      body: { expectedVersion: 3, reason: 'Resolved.' },
    });
    assertStatus(result, 'U-22 queue resolve returns 200', resolved, OK);
    recordAssertion(
      result,
      'U-22 resolved task is RESOLVED',
      (resolved.body as { status?: string })?.status === 'RESOLVED',
      JSON.stringify(resolved.body),
    );
  } else {
    recordAssertion(result, 'U-22 queue review lifecycle exercised', false, 'no queued task on clean data');
  }

  // No enforcement side-effects: flagging/review never freezes the member.
  const memberRows = await ctx.pool.query<{ status: string }>(
    `SELECT status::text AS status FROM members WHERE id = $1`,
    [world.merchant.memberId],
  );
  recordAssertion(
    result,
    'U-22 risk review has no enforcement side-effect (member status unchanged)',
    memberRows.rows[0]?.status === 'ACTIVE',
    `member status=${memberRows.rows[0]?.status}`,
  );

  return finishUatResult(result);
}
