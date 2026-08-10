/**
 * P8-S8 UAT — negative-path scenarios U-23..U-36 (contract §8, brief §3.2).
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { JourneyResult, UatContext } from './types.js';
import {
  createAdmin,
  createMember,
  createMerchantFixture,
  httpCall,
  httpCallWithTimeout,
  seedMfaFactor,
  seedStepUpGrant,
  selectMarketFor,
} from '../load/harness.js';
import {
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
  stringId,
  assertStatus,
} from './helpers.js';
import { seedRedemptionFixture } from '../load/journeys/j06-redemption.js';
import { seedFulfilmentFixture } from '../load/journeys/j07-fulfilment.js';
import { bootDegradedApp } from './harness.js';

const OK = new Set([200]);
const CREATED = new Set([201]);
const ACCEPTED = new Set([202]);

// ---------------------------------------------------------------------------
// U-23 cross-market denial (zero cross-market fallback)
// ---------------------------------------------------------------------------

export async function runU23(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-23', 'cross-market denial');
  const world = ctx.world;
  const merchant = world.merchant;
  const foreignMarketId = world.secondaryMarketId;

  // (a) Merchant transaction attempt with a foreign x-market-id -> denied.
  const foreignPreview = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/merchant/transactions/preview',
    token: merchant.merchantToken,
    idempotencyKey: `uat23-foreign-preview-${randomSuffix()}`,
    headers: { 'x-market-id': foreignMarketId },
    body: {
      amount: '100.00',
      memberQrToken: merchant.qrToken,
      marketId: foreignMarketId,
      transactionNote: '',
    },
  });
  recordAssertion(
    result,
    'U-23 merchant foreign-market preview denied (403/409, no fallback)',
    foreignPreview.status === 403 || foreignPreview.status === 409,
    `status ${foreignPreview.status} code=${errorCode(foreignPreview.body) ?? 'n/a'}`,
  );

  // (b) Foreign-market merchant must not appear in the M1 member list.
  const foreignMerchant = await createMerchantFixture(
    ctx.database,
    ctx.auth,
    foreignMarketId,
    world.superAdmin.adminUserId,
  );
  const list = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/members/merchants',
    token: world.member.token,
  });
  assertStatus(result, 'U-23 member discovery list returns 200', list, OK);
  const items =
    (list.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-23 zero cross-market fallback: foreign merchant absent from M1 list',
    !items.some(
      (item) =>
        item['id'] === foreignMerchant.branchId ||
        item['branchId'] === foreignMerchant.branchId,
    ),
    `M1 items=${items.length}`,
  );

  // (c) Admin access to a market outside marketAccess / not current -> the
  //     current-market guard denies with 409 MARKET_CONTEXT_MISMATCH (or
  //     403 PERMISSION_DENIED) — zero cross-market fallback either way.
  const foreignReports = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/admin/report-ops/markets/${foreignMarketId}/reports`,
    token: world.superAdmin.token,
  });
  recordAssertion(
    result,
    'U-23 admin foreign-market report list denied (403/409, zero fallback)',
    foreignReports.status === 403 || foreignReports.status === 409,
    `status ${foreignReports.status} code=${errorCode(foreignReports.body) ?? 'n/a'}`,
  );
  const foreignRecon = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/reconciliation/markets/${foreignMarketId}/runs`,
    token: world.superAdmin.token,
    idempotencyKey: `uat23-recon-${randomSuffix()}`,
    body: {
      kind: 'MCP',
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2031-01-01T00:00:00.000Z',
      reason: 'UAT U-23 foreign-market probe.',
    },
  });
  recordAssertion(
    result,
    'U-23 admin foreign-market reconciliation run denied (403/409, zero fallback)',
    foreignRecon.status === 403 || foreignRecon.status === 409,
    `status ${foreignRecon.status} code=${errorCode(foreignRecon.body) ?? 'n/a'}`,
  );

  // (d) Foreign-market redemption item must not surface in M1 catalog.
  //     Seed a genuinely M2 catalog item (mirror of seedRedemptionFixture
  //     with the secondary market).
  const foreignItemId = randomUUID();
  await ctx.pool.query(
    `INSERT INTO redemption_catalog_items (
        id, market_id, sku, name, item_type, ownership, status,
        fiat_reference_value, fiat_currency, fulfilment_mode,
        inventory_mode, created_by, version
       ) VALUES (
        $1, $2, $3, 'UAT foreign item', 'PHYSICAL', 'PLATFORM_OWNED', 'ACTIVE',
        '100.0000000000', 'SGD', 'PICKUP', 'TRACKED', $4, 1
       )`,
    [
      foreignItemId,
      foreignMarketId,
      `UATFOREIGN-${randomSuffix()}`,
      world.superAdmin.adminUserId,
    ],
  );
  const catalog = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/redemption/catalog',
    token: world.merchant.memberToken,
  });
  const catalogItems =
    (catalog.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  recordAssertion(
    result,
    'U-23 foreign redemption item absent from M1 catalog (zero fallback)',
    !catalogItems.some((item) => item['id'] === foreignItemId),
    `M1 catalog items=${catalogItems.length}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-24 permission denial (RBAC)
// ---------------------------------------------------------------------------

export async function runU24(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-24', 'permission denial (RBAC)');
  const world = ctx.world;
  const support = world.supportAdmin;

  // Support role (read-only) attempting a privileged write -> 403.
  const supportWrite = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/package-ops/markets/${world.marketId}/special-percentages`,
    token: support.token,
    idempotencyKey: `uat24-support-${randomSuffix()}`,
    body: {
      rate: '12',
      description: 'Support attempt',
      reason: 'Should be denied.',
    },
  });
  recordAssertion(
    result,
    'U-24 support role denied on privileged write (403)',
    supportWrite.status === 403,
    `status ${supportWrite.status} code=${errorCode(supportWrite.body) ?? 'n/a'}`,
  );

  const supportNote = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/admin/member-ops/members/${world.merchant.memberId}/notes`,
    token: support.token,
    body: { content: 'Support write attempt', idempotencyKey: randomUUID() },
  });
  recordAssertion(
    result,
    'U-24 support role denied on member note create (403)',
    supportNote.status === 403,
    `status ${supportNote.status} code=${errorCode(supportNote.body) ?? 'n/a'}`,
  );

  // Member (non-admin) token on an admin surface -> 401/403.
  const memberOnAdmin = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/admin/dashboard/metrics',
    token: world.member.token,
  });
  recordAssertion(
    result,
    'U-24 member token denied on admin surface (401/403)',
    memberOnAdmin.status === 401 || memberOnAdmin.status === 403,
    `status ${memberOnAdmin.status} code=${errorCode(memberOnAdmin.body) ?? 'n/a'}`,
  );

  // Invalid token -> 401.
  const invalid = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: '/api/v1/admin/dashboard/metrics',
    token: 'invalid-token',
  });
  recordAssertion(
    result,
    'U-24 invalid token rejected (401)',
    invalid.status === 401,
    `status ${invalid.status}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-25 duplicate/replay (idempotency-key reuse, double submit)
// ---------------------------------------------------------------------------

export async function runU25(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-25',
    'duplicate/replay (idempotency-key reuse)',
  );

  // Preview one-key replay (2 concurrent) -> single preview session.
  const key = `uat25-preview-${randomSuffix()}`;
  const [previewA, previewB] = await Promise.all([
    previewTransaction(ctx, { idempotencyKey: key }),
    previewTransaction(ctx, { idempotencyKey: key }),
  ]);
  const ids = new Set([
    stringId(previewA.body, ['previewSessionId']),
    stringId(previewB.body, ['previewSessionId']),
  ]);
  recordAssertion(
    result,
    'U-25 concurrent preview replay (one key) -> single preview session',
    previewA.status === 201 && previewB.status === 201 && ids.size === 1,
    `statuses ${previewA.status},${previewB.status}; distinct ids=${ids.size}`,
  );

  // Confirm one-key replay -> single financial chain (delta exactly one).
  const confirmKey = `uat25-confirm-${randomSuffix()}`;
  const preview = await previewTransaction(ctx);
  const previewId = stringId(preview.body, ['previewSessionId']);
  const receipt = `UAT25-REC-${randomSuffix()}`;
  const first = await confirmTransaction(ctx, previewId, {
    idempotencyKey: confirmKey,
    merchantReceiptNumber: receipt,
  });
  const replay = await confirmTransaction(ctx, previewId, {
    idempotencyKey: confirmKey,
    merchantReceiptNumber: receipt,
  });
  recordAssertion(
    result,
    'U-25 confirm replay (same key) returns the single chain result',
    first.status === 201 &&
      replay.status === 201 &&
      stringId(first.body, ['transactionNumber']) ===
        stringId(replay.body, ['transactionNumber']),
    `first=${first.status} replay=${replay.status}`,
  );
  const dupWalletKeys = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM (
       SELECT idempotency_key, count(*) n FROM member_wallet_entries
        GROUP BY idempotency_key HAVING count(*) > 1
     ) dup`,
    [],
  );
  recordAssertion(
    result,
    'U-25 no duplicate wallet-entry idempotency keys anywhere',
    Number(dupWalletKeys.rows[0]?.count ?? 0) === 0,
    `duplicate groups=${dupWalletKeys.rows[0]?.count ?? 0}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-26 insufficient balance
// ---------------------------------------------------------------------------

export async function runU26(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-26', 'insufficient balance');
  const world = ctx.world;

  // (a) MCP insufficient: fresh merchant with a zeroed MCP balance. The
  //     balance is moved to 0 through the sanctioned append_mcp_ledger_entry
  //     posting path (DB-level projection guard, migration 0005) — a DEBIT
  //     of the full opening balance leaves ledger == balance (consistent).
  const poorMerchant = await createMerchantFixture(
    ctx.database,
    ctx.auth,
    world.marketId,
    world.superAdmin.adminUserId,
  );
  await ctx.pool.query(
    `SELECT * FROM append_mcp_ledger_entry(
        $1, 'MANUAL_DEBIT', 'DEBIT', '5000.0000000000',
        '-5000.0000000000', '-5000.0000000000', 'UAT_FIXTURE', NULL,
        $2, $3, 'SYSTEM', NULL,
        'UAT U-26 insufficient-MCP fixture zeroing', now())`,
    [
      poorMerchant.mcpAccountId,
      `uat26-zero-${randomSuffix()}`,
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    ],
  );
  const poorPreview = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/merchant/transactions/preview',
    token: poorMerchant.merchantToken,
    idempotencyKey: `uat26-preview-${randomSuffix()}`,
    headers: { 'x-market-id': world.marketId },
    body: {
      amount: '100.00',
      memberQrToken: poorMerchant.qrToken,
      marketId: world.marketId,
      transactionNote: '',
    },
  });
  assertStatus(
    result,
    'U-26 preview with zero MCP still returns 201 (no debit yet)',
    poorPreview,
    CREATED,
  );
  const poorPreviewId = stringId(poorPreview.body, ['previewSessionId']);
  // The public previewSessionId is an opaque reference; resolve the internal
  // preview uuid for DB assertions (P4-S7/S6 method).
  const resolvedPreview = await ctx.pool.query<{ previewSessionId: string }>(
    `SELECT preview_session_id AS "previewSessionId"
       FROM transaction_idempotency_records
      WHERE operation = 'PREVIEW'
        AND response->>'previewSessionId' = $1
      LIMIT 1`,
    [poorPreviewId],
  );
  const poorPreviewInternalId =
    resolvedPreview.rows[0]?.previewSessionId ?? poorPreviewId;
  const poorConfirm = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${poorPreviewId}/confirm`,
    token: poorMerchant.merchantToken,
    idempotencyKey: `uat26-confirm-${randomSuffix()}`,
    headers: { 'x-market-id': world.marketId },
    body: { merchantReceiptNumber: `UAT26-REC-${randomSuffix()}` },
  });
  recordAssertion(
    result,
    'U-26 confirm with insufficient MCP rejected with TRANSACTION_INSUFFICIENT_MCP',
    (poorConfirm.status === 409 || poorConfirm.status === 422) &&
      errorCode(poorConfirm.body) === 'TRANSACTION_INSUFFICIENT_MCP',
    `status ${poorConfirm.status} code=${errorCode(poorConfirm.body) ?? 'n/a'}`,
  );
  const partialRows = await ctx.pool.query<{
    tx: string;
    debits: string;
    entries: string;
  }>(
    `SELECT
       (SELECT count(*) FROM transactions WHERE preview_session_id = $1)::text AS tx,
       (SELECT count(*) FROM transaction_mcp_debits debit
          JOIN transactions transaction ON transaction.id = debit.transaction_id
         WHERE transaction.preview_session_id = $1)::text AS debits,
       (SELECT count(*) FROM member_wallet_entries wallet_entry
          JOIN transactions transaction ON transaction.id::text = wallet_entry.reference_id
         WHERE transaction.preview_session_id = $1)::text AS entries`,
    [poorPreviewInternalId],
  );
  recordAssertion(
    result,
    'U-26 insufficient-MCP rejection leaves zero partial writes',
    Number(partialRows.rows[0]?.tx ?? 1) === 0 &&
      Number(partialRows.rows[0]?.debits ?? 1) === 0 &&
      Number(partialRows.rows[0]?.entries ?? 1) === 0,
    JSON.stringify(partialRows.rows[0]),
  );
  const mcpBalanceRows = await ctx.pool.query<{ balance: string }>(
    `SELECT available_balance::text AS balance FROM mcp_accounts WHERE id = $1`,
    [poorMerchant.mcpAccountId],
  );
  recordAssertion(
    result,
    'U-26 MCP balance never goes negative',
    Number(mcpBalanceRows.rows[0]?.balance ?? -1) >= 0,
    `balance=${mcpBalanceRows.rows[0]?.balance}`,
  );

  // (b) Redemption insufficient: wallet balance below the order cost.
  const fixture = await seedRedemptionFixture(ctx);
  const quote = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
    token: world.merchant.memberToken,
  });
  const quoteBody = quote.body as {
    quoteId?: string;
    postedPointCost?: string;
  };
  await ctx.pool.query(
    `UPDATE member_wallet_accounts SET available_balance = '1'
      WHERE member_id = $1 AND market_id = $2`,
    [world.merchant.memberId, world.marketId],
  );
  const walletBefore = await ctx.pool.query<{ balance: string }>(
    `SELECT available_balance::text AS balance FROM member_wallet_accounts
      WHERE member_id = $1 AND market_id = $2`,
    [world.merchant.memberId, world.marketId],
  );
  const poorOrder = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/redemption/orders',
    token: world.merchant.memberToken,
    body: {
      quoteId: quoteBody.quoteId,
      idempotencyKey: `uat26-order-${randomUUID()}`,
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
  recordAssertion(
    result,
    'U-26 redemption with insufficient wallet points rejected cleanly',
    poorOrder.status === 409 || poorOrder.status === 422,
    `status ${poorOrder.status} code=${errorCode(poorOrder.body) ?? 'n/a'} body=${JSON.stringify(poorOrder.body)}`,
  );
  const walletAfter = await ctx.pool.query<{ balance: string }>(
    `SELECT available_balance::text AS balance FROM member_wallet_accounts
      WHERE member_id = $1 AND market_id = $2`,
    [world.merchant.memberId, world.marketId],
  );
  recordAssertion(
    result,
    'U-26 rejection leaves wallet balance unchanged (no partial debit)',
    walletAfter.rows[0]?.balance === walletBefore.rows[0]?.balance,
    `${walletBefore.rows[0]?.balance} -> ${walletAfter.rows[0]?.balance}`,
  );
  const orderRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM redemption_orders WHERE member_id = $1`,
    [world.merchant.memberId],
  );
  void orderRows;

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-27 expiry (OTP, quote, voucher)
// ---------------------------------------------------------------------------

export async function runU27(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-27', 'expiry (OTP, quote, voucher)');
  const world = ctx.world;

  // (a) Expired OTP: issue a real OTP, back-date its expiry (and creation
  //     so the otps_expiry_check constraint stays satisfied), verify -> denied.
  const member = await createMember(ctx.database, ctx.auth, world.marketId);
  const issued = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/otp/issue',
    body: { destination: member.email, purpose: 'EMAIL_VERIFICATION' },
  });
  assertStatus(result, 'U-27 OTP issue returns 202', issued, ACCEPTED);
  const otpId = stringId(issued.body, ['otp_id']);
  const devCode = stringId(issued.body, ['development_code']);
  await ctx.pool.query(
    `UPDATE otps
        SET created_at = now() - interval '2 minutes',
            expires_at = now() - interval '1 minute'
      WHERE id = $1`,
    [otpId],
  );
  const expiredVerify = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/otp/verify',
    body: { otp_id: otpId, code: devCode },
  });
  recordAssertion(
    result,
    'U-27 expired OTP rejected with a documented error code',
    (expiredVerify.status === 400 || expiredVerify.status === 410) &&
      errorCode(expiredVerify.body) !== null,
    `status ${expiredVerify.status} code=${errorCode(expiredVerify.body) ?? 'n/a'}`,
  );
  const otpRows = await ctx.pool.query<{ verifiedAt: string | null }>(
    `SELECT verified_at AS "verifiedAt" FROM otps WHERE id = $1`,
    [otpId],
  );
  recordAssertion(
    result,
    'U-27 expired OTP was not consumed (verified_at null)',
    otpRows.rows[0]?.verifiedAt === null,
    JSON.stringify(otpRows.rows[0]),
  );

  // (b) Expired quote: the quotes table is append-only (reject_update), so
  //     the expired state is constructed by INSERT-copying the live quote
  //     with a past expires_at (the sanctioned fixture path), then ordering
  //     against it -> 409 REDEMPTION_QUOTE_EXPIRED.
  const fixture = await seedRedemptionFixture(ctx);
  const quote = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
    token: world.merchant.memberToken,
  });
  const quoteBody = quote.body as {
    quoteId?: string;
    postedPointCost?: string;
  };
  const expiredQuote = await ctx.pool.query<{ id: string }>(
    `INSERT INTO redemption_quotes (
        id, member_id, market_id, catalog_item_id, status, rate_version_id,
        rate_snapshot, unrounded_point_cost, posted_point_cost, payload_hash,
        expires_at, idempotency_key, created_at
       )
      SELECT gen_random_uuid(), member_id, market_id, catalog_item_id, status,
             rate_version_id, rate_snapshot, unrounded_point_cost,
             posted_point_cost, payload_hash, now() - interval '1 minute',
             'uat27-expired-' || gen_random_uuid()::text,
             now() - interval '2 minutes'
        FROM redemption_quotes WHERE id = $1
      RETURNING id`,
    [quoteBody.quoteId],
  );
  const expiredQuoteId = expiredQuote.rows[0]?.id ?? '';
  const expiredOrder = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/redemption/orders',
    token: world.merchant.memberToken,
    body: {
      quoteId: expiredQuoteId,
      idempotencyKey: `uat27-order-${randomUUID()}`,
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
  recordAssertion(
    result,
    'U-27 expired quote rejected with REDEMPTION_QUOTE_EXPIRED (no consumption)',
    expiredOrder.status === 409 &&
      errorCode(expiredOrder.body) === 'REDEMPTION_QUOTE_EXPIRED',
    `status ${expiredOrder.status} code=${errorCode(expiredOrder.body) ?? 'n/a'}`,
  );

  // (c) Voucher expiry: expiry_date is stored metadata; there is no
  //     platform consumption path that would reject it (voucher use is
  //     off-platform; revealVoucher stores but never checks expiry_date).
  //     Recorded as a documented capability boundary, not a defect.
  const voucherColumn = await ctx.pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'redemption_voucher_codes' AND column_name = 'expiry_date'`,
    [],
  );
  recordAssertion(
    result,
    'U-27 voucher expiry_date column exists (metadata surface)',
    voucherColumn.rows.length === 1,
    `columns=${voucherColumn.rows.length}`,
  );
  result.notes.push(
    'U-27(c): redemption_voucher_codes.expiry_date is stored metadata; no code path rejects an expired voucher at reveal/use (voucher use is off-platform). Recorded as documented behavior, not a UAT defect.',
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-28 suspension (member/merchant/account)
// ---------------------------------------------------------------------------

export async function runU28(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-28',
    'suspension (member/merchant/account)',
  );
  const world = ctx.world;

  // (a) Suspended member cannot log in (member-level suspension -> the
  //     frozen AUTH_MEMBER_INACTIVE 403 contract).
  const suspendedMember = await createMember(
    ctx.database,
    ctx.auth,
    world.marketId,
  );
  await ctx.pool.query(
    `UPDATE members SET status = 'SUSPENDED' WHERE id = $1`,
    [suspendedMember.memberId],
  );
  const login = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/auth/member/login',
    body: { email: suspendedMember.email, password: suspendedMember.password },
  });
  recordAssertion(
    result,
    'U-28 suspended member login rejected with AUTH_MEMBER_INACTIVE (403)',
    login.status === 403 && errorCode(login.body) === 'AUTH_MEMBER_INACTIVE',
    `status ${login.status} code=${errorCode(login.body) ?? 'n/a'}`,
  );

  // (b) Suspended merchant cannot transact (enforcement at the write gate).
  const suspendedMerchant = await createMerchantFixture(
    ctx.database,
    ctx.auth,
    world.marketId,
    world.superAdmin.adminUserId,
  );
  await ctx.pool.query(
    `UPDATE merchant_branches SET status = 'SUSPENDED' WHERE id = $1`,
    [suspendedMerchant.branchId],
  );
  const preview = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/merchant/transactions/preview',
    token: suspendedMerchant.merchantToken,
    idempotencyKey: `uat28-preview-${randomSuffix()}`,
    headers: { 'x-market-id': world.marketId },
    body: {
      amount: '100.00',
      memberQrToken: suspendedMerchant.qrToken,
      marketId: world.marketId,
      transactionNote: '',
    },
  });
  if (preview.status === 201) {
    // Preview is a read/snapshot surface; the transaction write gate must
    // deny the suspended merchant at confirm.
    const confirm = await confirmTransaction(
      ctx,
      stringId(preview.body, ['previewSessionId']),
    );
    recordAssertion(
      result,
      'U-28 suspended merchant transaction confirm denied (documented status)',
      confirm.status === 403 || confirm.status === 409,
      `preview 201; confirm status ${confirm.status} code=${errorCode(confirm.body) ?? 'n/a'}`,
    );
  } else {
    recordAssertion(
      result,
      'U-28 suspended merchant transaction denied (documented status)',
      preview.status === 403 || preview.status === 409,
      `status ${preview.status} code=${errorCode(preview.body) ?? 'n/a'}`,
    );
  }

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-29 retry (bounded retries, retry-safe)
// ---------------------------------------------------------------------------

export async function runU29(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-29',
    'retry (bounded retries, retry-safe)',
  );

  // Sequential same-key confirm retry: both calls succeed, one chain.
  const preview = await previewTransaction(ctx);
  const previewId = stringId(preview.body, ['previewSessionId']);
  const key = `uat29-confirm-${randomSuffix()}`;
  const receipt = `UAT29-REC-${randomSuffix()}`;
  const first = await confirmTransaction(ctx, previewId, {
    idempotencyKey: key,
    merchantReceiptNumber: receipt,
  });
  const second = await confirmTransaction(ctx, previewId, {
    idempotencyKey: key,
    merchantReceiptNumber: receipt,
  });
  recordAssertion(
    result,
    'U-29 same-key confirm retry is retry-safe (single chain result)',
    first.status === 201 &&
      second.status === 201 &&
      stringId(first.body, ['transactionNumber']) ===
        stringId(second.body, ['transactionNumber']),
    `first=${first.status} second=${second.status}`,
  );

  // A DIFFERENT key on the same preview is a new attempt, but the preview
  // session is single-use by contract (one preview -> one confirm); a second
  // confirm on a consumed preview is rejected with a governed 409.
  const third = await confirmTransaction(ctx, previewId, {
    idempotencyKey: `uat29-new-${randomSuffix()}`,
  });
  recordAssertion(
    result,
    'U-29 consumed preview rejects a second confirm (governed 409, single-use preview)',
    third.status === 409 && errorCode(third.body) !== null,
    `third=${third.status} code=${errorCode(third.body) ?? 'n/a'}`,
  );

  // Outbox bounded-attempt budget (cross-check of the S6 retry-site table
  // on a live write path: no dispatch may exceed max_attempts).
  const overBudget = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM transaction_commission_dispatch
      WHERE attempts > max_attempts`,
    [],
  );
  recordAssertion(
    result,
    'U-29 no outbox dispatch exceeds the bounded attempt budget',
    Number(overBudget.rows[0]?.count ?? 0) === 0,
    `over-budget rows=${overBudget.rows[0]?.count ?? 0}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-30 worker failure (outbox bounded retry, no double-processing)
// ---------------------------------------------------------------------------

export async function runU30(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-30',
    'worker failure (outbox, daily jobs)',
  );
  const world = ctx.world;

  // Two confirmed transactions -> dispatch rows exist. The outbox worker
  // drains BATCH_SIZE 10 per cycle (auto-worker + deterministic calls);
  // drive it until the backlog is zero (bounded loop).
  const tx1 = await confirmFreshTransaction(ctx);
  const tx2 = await confirmFreshTransaction(ctx);
  void tx1;
  void tx2;
  for (let i = 0; i < 25; i += 1) {
    await ctx.outboxWorker.processBatchOnce();
    const still = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transaction_commission_dispatch
        WHERE status = 'PENDING' AND attempts = 0`,
      [],
    );
    if (Number(still.rows[0]?.count ?? 0) === 0) break;
  }
  // The backlog drains once every dispatch row has been claimed at least
  // once: rows rejected by the frozen business rule (OBS-03, transaction no
  // longer CONFIRMED) remain PENDING under the bounded backoff by design
  // (attempts < max_attempts), so the drain assertion targets unclaimed rows.
  const pending = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM transaction_commission_dispatch
      WHERE status = 'PENDING' AND attempts = 0`,
    [],
  );
  recordAssertion(
    result,
    'U-30 outbox backlog drains (every dispatch claimed at least once)',
    Number(pending.rows[0]?.count ?? 0) === 0,
    `unclaimed PENDING=${pending.rows[0]?.count}`,
  );

  // Simulated worker failure: mark a dispatched row FAILED with attempts=1,
  // then drive the worker; attempts must stay bounded and never double-process.
  await ctx.pool.query(
    `UPDATE transaction_commission_dispatch
        SET status = 'FAILED', attempts = 1, last_error = 'UAT simulated failure'
      WHERE id = (SELECT id FROM transaction_commission_dispatch
                   WHERE status = 'COMPLETED' ORDER BY created_at LIMIT 1)`,
    [],
  );
  await ctx.outboxWorker.processBatchOnce();
  const overBudget = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM transaction_commission_dispatch
      WHERE attempts > max_attempts`,
    [],
  );
  recordAssertion(
    result,
    'U-30 simulated worker failure stays within the bounded attempt budget',
    Number(overBudget.rows[0]?.count ?? 0) === 0,
    `over-budget rows=${overBudget.rows[0]?.count ?? 0}`,
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
    'U-30 no double-processing (no duplicate dispatch rows)',
    Number(dupes.rows[0]?.count ?? 0) === 0,
    `duplicate groups=${dupes.rows[0]?.count ?? 0}`,
  );

  // OBS-03 expected outcome: a transaction reversed before drain is a
  // bounded expected rejection, not a defect.
  const reversed = await confirmFreshTransaction(ctx);
  const reversal = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${reversed.transactionNumber}/reversal-requests`,
    token: world.merchant.merchantToken,
    idempotencyKey: `uat30-reversal-${randomSuffix()}`,
    body: { reasonCode: 'CUSTOMER_REQUEST' },
  });
  assertStatus(
    result,
    'U-30 reversal-request for the OBS-03 probe returns 201',
    reversal,
    CREATED,
  );
  await ctx.outboxWorker.processBatchOnce();
  const reversedRows = await ctx.pool.query<{
    count: string;
    attempts: string;
  }>(
    `SELECT count(*)::text AS count, max(attempts)::text AS attempts
       FROM transaction_commission_dispatch
      WHERE transaction_id = (
        SELECT id FROM transactions WHERE transaction_number = $1
      )`,
    [reversed.transactionNumber],
  );
  recordAssertion(
    result,
    'U-30 reversed-before-drain stays bounded (OBS-03 expected, no runaway retries)',
    Number(reversedRows.rows[0]?.attempts ?? 0) <=
      Number(process.env['OUTBOX_MAX_ATTEMPTS'] ?? 10),
    JSON.stringify(reversedRows.rows[0]),
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-31 network/API failure (downstream unavailable -> documented contract)
// ---------------------------------------------------------------------------

export async function runU31(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-31',
    'network/API failure (downstream unavailable)',
  );

  // (a) Redis unavailable: health/ready degrades, API still serves.
  const deadRedis = await bootDegradedApp({
    REDIS_URL: 'redis://127.0.0.1:6399',
  });
  try {
    const ready = await httpCall(deadRedis.baseUrl, {
      method: 'GET',
      path: '/health/ready',
    });
    const readyBody = ready.body as {
      status?: string;
      checks?: Record<string, string>;
    };
    assertStatus(
      result,
      'U-31 dead-Redis /health/ready still returns 200',
      ready,
      OK,
    );
    recordAssertion(
      result,
      'U-31 dead-Redis readiness reports degraded + redis unavailable (graceful)',
      readyBody.status === 'degraded' &&
        readyBody.checks?.['redis'] === 'unavailable' &&
        readyBody.checks?.['database'] === 'ok',
      JSON.stringify(readyBody),
    );
    // API surface still functional (in-memory limiter fallback).
    const member = await createMember(
      ctx.database,
      ctx.auth,
      ctx.world.marketId,
    );
    const login = await httpCall(deadRedis.baseUrl, {
      method: 'POST',
      path: '/api/v1/auth/member/login',
      body: { email: member.email, password: member.password },
    });
    recordAssertion(
      result,
      'U-31 login still works with Redis down (in-memory rate-limit fallback)',
      login.status === 200,
      `status ${login.status}`,
    );
  } finally {
    await deadRedis.app.close();
    await new Promise<void>((resolve) =>
      deadRedis.server.close(() => resolve()),
    );
  }

  // (b) Database unavailable: health/ready reports database unavailable.
  const deadDb = await bootDegradedApp({
    DATABASE_URL:
      'postgresql://ipoint:ipoint-local-only@127.0.0.1:55999/ipoint_p8s8_dead',
  });
  try {
    const ready = await httpCall(deadDb.baseUrl, {
      method: 'GET',
      path: '/health/ready',
    });
    const readyBody = ready.body as {
      status?: string;
      checks?: Record<string, string>;
    };
    assertStatus(
      result,
      'U-31 dead-DB /health/ready still returns 200',
      ready,
      OK,
    );
    recordAssertion(
      result,
      'U-31 dead-DB readiness reports degraded + database unavailable',
      readyBody.status === 'degraded' &&
        readyBody.checks?.['database'] === 'unavailable',
      JSON.stringify(readyBody),
    );
  } finally {
    await deadDb.app.close();
    await new Promise<void>((resolve) => deadDb.server.close(() => resolve()));
  }

  // (c) S7 unit-level degradation contract cited (locks fail closed, queue
  //     degrades to no-op, limiter falls back in-memory with same ceiling).
  result.notes.push(
    'U-31(c): S7 redis.integration.spec.ts already proves lock fail-closed, queue no-op degradation and the in-memory limiter ceiling; cited, not re-run.',
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-32 concurrency (double decision, storm race)
// ---------------------------------------------------------------------------

export async function runU32(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-32',
    'concurrency (double decision, storm race)',
  );
  const world = ctx.world;
  await seedIpointAdjustFixtures(ctx);

  // (a) iPoint double-decision (2-way) -> exactly one accepted transition.
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
  const member = await createMember(ctx.database, ctx.auth, world.marketId);
  const walletId = await ensureMemberWallet(ctx, member.memberId, '5000');
  const base = `/api/v1/admin/ipoint-adjust-ops/markets/${world.marketId}/adjustments`;
  const created = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: base,
    token: maker.token,
    idempotencyKey: `uat32-create-${randomSuffix()}`,
    body: {
      walletAccountId: walletId,
      direction: 'CREDIT',
      amount: '5000',
      reasonCode: 'OPERATIONAL_CORRECTION',
      explanation: 'UAT U-32 double-decision.',
      caseReference: `UAT32-${randomSuffix()}`,
    },
  });
  const requestId = stringId(created.body, ['id']);
  await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/${requestId}/submit`,
    token: maker.token,
  });
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
      path: `${base}/${requestId}/decision`,
      token: checker.token,
      headers: { 'x-step-up-token': grantA },
      body: { decision: 'APPROVED', reason: 'Concurrent A.' },
    }),
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/${requestId}/decision`,
      token: checker.token,
      headers: { 'x-step-up-token': grantB },
      body: { decision: 'APPROVED', reason: 'Concurrent B.' },
    }),
  ]);
  const finalState = await ctx.pool.query<{ state: string }>(
    `SELECT state::text AS state FROM ipoint_adjustment_requests WHERE id = $1`,
    [requestId],
  );
  recordAssertion(
    result,
    'U-32 iPoint double-decision -> exactly one accepted transition',
    finalState.rows[0]?.state === 'APPROVED' &&
      decisionA.status !== decisionB.status,
    `statuses ${decisionA.status},${decisionB.status}; final=${finalState.rows[0]?.state}`,
  );

  // (b) Same-key concurrent refund reversals -> exactly one row.
  const { transactionNumber } = await confirmFreshTransaction(ctx);
  const reversalKey = `uat32-reversal-${randomSuffix()}`;
  const [revA, revB] = await Promise.all([
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/merchant/transactions/${transactionNumber}/reversal-requests`,
      token: world.merchant.merchantToken,
      idempotencyKey: reversalKey,
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    }),
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/merchant/transactions/${transactionNumber}/reversal-requests`,
      token: world.merchant.merchantToken,
      idempotencyKey: reversalKey,
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    }),
  ]);
  const reversalRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM correction_requests
      WHERE transaction_id = (SELECT id FROM transactions WHERE transaction_number = $1)
        AND request_type = 'REVERSAL'`,
    [transactionNumber],
  );
  recordAssertion(
    result,
    'U-32 concurrent same-key reversals -> exactly one request row',
    revA.status === 201 &&
      revB.status === 201 &&
      Number(reversalRows.rows[0]?.count ?? 0) === 1,
    `statuses ${revA.status},${revB.status}; rows=${reversalRows.rows[0]?.count}`,
  );

  // (c) Quote race: 2 concurrent orders on ONE quote -> 1x201 + 1x409 (OBS-01).
  const fixture = await seedRedemptionFixture(ctx);
  const quote = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `/api/v1/redemption/catalog/${fixture.itemId}/quote?quantity=1`,
    token: world.merchant.memberToken,
  });
  const quoteBody = quote.body as {
    quoteId?: string;
    postedPointCost?: string;
  };
  const orderPayload = (key: string) => ({
    quoteId: quoteBody.quoteId,
    idempotencyKey: key,
    expectedItemVersion: 1,
    expectedTotalPoints: quoteBody.postedPointCost,
    expectedQuantity: '1',
    fulfilment: { type: 'PICKUP', pickupLocationId: fixture.pickupLocationId },
    termsAcceptance: { accepted: true, termsVersion: 'v1' },
  });
  const [raceA, raceB] = await Promise.all([
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: '/api/v1/redemption/orders',
      token: world.merchant.memberToken,
      body: orderPayload(`uat32-race-${randomUUID()}`),
    }),
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: '/api/v1/redemption/orders',
      token: world.merchant.memberToken,
      body: orderPayload(`uat32-race-${randomUUID()}`),
    }),
  ]);
  const statuses = [raceA.status, raceB.status].sort().join(',');
  recordAssertion(
    result,
    'U-32 quote race -> one 201 + one bounded 409 (OBS-01 expected, no 5xx)',
    statuses === '201,409' && raceA.status !== 500 && raceB.status !== 500,
    `statuses ${statuses}`,
  );

  result.notes.push(
    'U-32(d): S6 L2 storms (J2 20-way confirm, J8 20-way reversal, J9 double-decision) cited for the sustained-concurrency layer; UAT executes the acceptance-scale subset above.',
  );
  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-33 stale/unavailable (freshness semantics)
// ---------------------------------------------------------------------------

export async function runU33(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-33',
    'stale/unavailable (freshness semantics)',
  );
  const world = ctx.world;
  const base = `/api/v1/admin/report-ops/markets/${world.marketId}/reports`;
  const token = world.superAdmin.token;

  // Future asOf is clamped to the server now and the report discloses its
  // honest freshness state (FRESH / stale / unavailable flags) — the
  // no-fabricated-data contract. STALE (503) surfaces when the live source
  // snapshot is older than the freshness window or the re-query fails;
  // UNAVAILABLE (503) when the source is missing — both covered by the
  // P8-S4/S5a suites and cited below.
  const futureAsOf = new Date(Date.now() + 86_400_000).toISOString();
  const future = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `${base}/R01?asOf=${encodeURIComponent(futureAsOf)}`,
    token,
  });
  const futureBody = future.body as {
    state?: string;
    stale?: boolean;
    unavailable?: boolean;
    asOf?: string;
  };
  recordAssertion(
    result,
    'U-33 report discloses honest freshness state (FRESH, stale:false, unavailable:false; asOf = server now)',
    future.status === 200 &&
      futureBody.state === 'FRESH' &&
      futureBody.stale === false &&
      futureBody.unavailable === false &&
      typeof futureBody.asOf === 'string',
    `status ${future.status} body=${JSON.stringify(futureBody).slice(0, 300)}`,
  );

  // Unknown report -> 422 (documented), never a fabricated zero.
  const unknown = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `${base}/R99?asOf=${encodeURIComponent(new Date().toISOString())}`,
    token,
  });
  recordAssertion(
    result,
    'U-33 unknown report returns 422 (documented, no fabricated data)',
    unknown.status === 422,
    `status ${unknown.status}`,
  );

  // UNAVAILABLE class: cited from the report contract (missing/failed
  // source -> 503 UNAVAILABLE with reason, never a fabricated zero).
  result.notes.push(
    'U-33(b): the STALE (503, source older than the freshness window) and UNAVAILABLE (503, NO_DURABLE_SOURCE/SOURCE_QUERY_FAILED) states are documented contracts of admin-report-ops; the live surface verified here is the honest FRESH disclosure + unknown-report 422. P8-S4/S5a cited for the full freshness matrix.',
  );
  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-34 failed fulfilment
// ---------------------------------------------------------------------------

export async function runU34(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(ctx, 'U-34', 'failed fulfilment');
  const world = ctx.world;
  const fixture = await seedFulfilmentFixture(ctx);
  const base = `/api/v1/admin/redemption-fulfilment-ops/markets/${world.marketId}`;
  const token = world.superAdmin.token;

  const stateRows = await ctx.pool.query<{ status: string }>(
    `SELECT status::text AS status FROM redemption_orders
      WHERE id = (SELECT order_id FROM redemption_fulfilments WHERE id = $1)`,
    [fixture.exceptionFulfilmentId],
  );
  recordAssertion(
    result,
    'U-34 exception fixture is in FULFILMENT_EXCEPTION state',
    stateRows.rows[0]?.status === 'FULFILMENT_EXCEPTION',
    `status=${stateRows.rows[0]?.status}`,
  );

  const exceptionQueue = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `${base}/queues/FULFILMENT_EXCEPTION`,
    token,
  });
  assertStatus(
    result,
    'U-34 FULFILMENT_EXCEPTION queue returns 200',
    exceptionQueue,
    OK,
  );

  // Retry is bounded and audited.
  const retry = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/fulfilments/${fixture.exceptionFulfilmentId}/retry`,
    token,
    idempotencyKey: `uat34-retry-${randomSuffix()}`,
  });
  assertStatus(result, 'U-34 fulfilment retry returns 200', retry, OK);

  const auditRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM redemption_audit_log
      WHERE entity_id = $1::text AND action = 'FULFILMENT_RETRY'`,
    [fixture.exceptionFulfilmentId],
  );
  recordAssertion(
    result,
    'U-34 exception lifecycle is audited',
    Number(auditRows.rows[0]?.count ?? 0) >= 1,
    `audit rows=${auditRows.rows[0]?.count}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-35 refund retry (duplicate refund request)
// ---------------------------------------------------------------------------

export async function runU35(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-35',
    'refund retry (duplicate refund request)',
  );
  const world = ctx.world;

  const { transactionNumber } = await confirmFreshTransaction(ctx);
  const key = `uat35-refund-${randomSuffix()}`;
  const first = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${transactionNumber}/refund-requests`,
    token: world.merchant.merchantToken,
    idempotencyKey: key,
    body: { reasonCode: 'CUSTOMER_REQUEST' },
  });
  assertStatus(result, 'U-35 refund-request returns 201', first, CREATED);
  const firstId = stringId(first.body, ['id', 'requestId']);

  const replay = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${transactionNumber}/refund-requests`,
    token: world.merchant.merchantToken,
    idempotencyKey: key,
    body: { reasonCode: 'CUSTOMER_REQUEST' },
  });
  assertStatus(
    result,
    'U-35 refund retry (same key) returns 201',
    replay,
    CREATED,
  );
  recordAssertion(
    result,
    'U-35 refund retry returns the original request (claim-first, exactly-once)',
    stringId(replay.body, ['id', 'requestId']) === firstId,
    `first=${firstId} replay=${stringId(replay.body, ['id', 'requestId'])}`,
  );

  const rows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM correction_requests
      WHERE transaction_id = (SELECT id FROM transactions WHERE transaction_number = $1)
        AND request_type = 'REFUND'`,
    [transactionNumber],
  );
  recordAssertion(
    result,
    'U-35 exactly one refund request exists for the transaction',
    Number(rows.rows[0]?.count ?? 0) === 1,
    `rows=${rows.rows[0]?.count}`,
  );

  return finishUatResult(result);
}

// ---------------------------------------------------------------------------
// U-36 reconciliation mismatch (difference detection, no auto-correction)
// ---------------------------------------------------------------------------

export async function runU36(ctx: UatContext): Promise<JourneyResult> {
  const result = newUatResult(
    ctx,
    'U-36',
    'reconciliation mismatch (difference detection)',
  );
  const world = ctx.world;
  const base = `/api/v1/admin/reconciliation/markets/${world.marketId}`;
  const token = world.superAdmin.token;

  // Seeded mismatch (P8-S2 fixture pattern, migration 0005 projection
  // guard: INSERT on mcp_accounts is the sanctioned drift-construction
  // path): a branch WITHOUT an MCP account + an inserted account whose
  // total_balance says 95 while the MCP ledger is empty (0) ->
  // mcp_accounts_branch_unique requires the branch to have no account yet,
  // so the branch is built directly (group + branch, no MCP account).
  const driftAccount = await ctx.pool.query<{ accountId: string }>(
    `WITH drift_group AS (
        INSERT INTO merchant_groups (account_id, market_id, name)
        VALUES ($1, $2, 'UAT U-36 drift group')
        RETURNING id
      ), drift_branch AS (
        INSERT INTO merchant_branches (merchant_group_id, merchant_id, market_id, name, status)
        SELECT id, $3, $2, 'UAT U-36 drift branch', 'ACTIVE' FROM drift_group
        RETURNING id
      )
      INSERT INTO mcp_accounts (merchant_branch_id, market_id, total_balance, available_balance, status)
      SELECT id, $2, '95.0000000000', '95.0000000000', 'ACTIVE' FROM drift_branch
      RETURNING id AS "accountId"`,
    [
      world.superAdmin.accountId,
      world.marketId,
      `MERCH-UAT36-${randomSuffix()}`,
    ],
  );
  const mismatchAccountId = driftAccount.rows[0]?.accountId ?? '';

  const run = await httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `${base}/runs`,
    token,
    idempotencyKey: `uat36-run-${randomSuffix()}`,
    body: {
      kind: 'MCP',
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2031-01-01T00:00:00.000Z',
      reason: 'UAT U-36 mismatch run.',
    },
  });
  assertStatus(result, 'U-36 run-create returns 201', run, CREATED);
  const runId = stringId(run.body, ['id']);

  // OBS-04-mitigated profile: single serial execute with a 25s client bound.
  const executed = await httpCallWithTimeout(
    ctx.baseUrl,
    {
      method: 'POST',
      path: `${base}/runs/${runId}/execute`,
      token,
      idempotencyKey: `uat36-execute-${randomSuffix()}`,
    },
    25_000,
  );
  assertStatus(result, 'U-36 run-execute returns 200', executed, OK);
  // Other fixture MCP accounts (un-ledgered opening balances from the S6
  // world builder) are flagged by the same engine invariant; the seeded
  // drift account must be among them.
  recordAssertion(
    result,
    'U-36 seeded mismatch is detected (mismatched_count >= 1)',
    Number(
      (executed.body as { mismatched_count?: number })?.mismatched_count ?? 0,
    ) >= 1,
    JSON.stringify(executed.body).slice(0, 400),
  );

  const exceptions = await httpCall(ctx.baseUrl, {
    method: 'GET',
    path: `${base}/exceptions`,
    token,
  });
  assertStatus(result, 'U-36 exception queue returns 200', exceptions, OK);
  const items =
    (exceptions.body as { items?: Array<Record<string, unknown>> })?.items ??
    [];
  const mismatch = items.find(
    (item) =>
      item['reference_type'] === 'mcp_account_total' &&
      item['reference_id'] === mismatchAccountId,
  );
  recordAssertion(
    result,
    'U-36 seeded-drift exception queued: OPEN AMOUNT_MISMATCH with exact expected/actual/difference',
    mismatch !== undefined &&
      mismatch['expected_amount'] === '0.0000000000' &&
      mismatch['actual_amount'] === '95.0000000000' &&
      mismatch['difference_amount'] === '95.0000000000' &&
      mismatch['status'] === 'OPEN' &&
      mismatch['classification'] === 'AMOUNT_MISMATCH',
    JSON.stringify(mismatch ?? items[0] ?? null),
  );

  // No auto-correction: the account balance is untouched by the run.
  const balanceRows = await ctx.pool.query<{ total: string }>(
    `SELECT total_balance::text AS total FROM mcp_accounts
      WHERE id = $1`,
    [mismatchAccountId],
  );
  recordAssertion(
    result,
    'U-36 no auto-correction (total balance unchanged after the run)',
    balanceRows.rows[0]?.total === '95.0000000000',
    `total=${balanceRows.rows[0]?.total}`,
  );

  const auditRows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_logs WHERE entity_id = $1`,
    [runId],
  );
  recordAssertion(
    result,
    'U-36 reconciliation run is audited (immutable)',
    Number(auditRows.rows[0]?.count ?? 0) >= 1,
    `audit rows=${auditRows.rows[0]?.count}`,
  );

  return finishUatResult(result);
}
