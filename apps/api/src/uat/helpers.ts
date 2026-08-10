/**
 * P8-S8 UAT — shared scenario helpers (assertion records, HTTP, fixtures).
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { HttpCallResult, JourneyResult, UatContext } from './types.js';
import { httpCall } from '../load/harness.js';

export function newUatResult(
  ctx: UatContext,
  scenarioId: string,
  scenarioName: string,
): JourneyResult {
  return {
    journeyId: scenarioId,
    journeyName: scenarioName,
    level: 'L0',
    startedAt: new Date().toISOString(),
    endedAt: '',
    durationMs: 0,
    ops: [],
    assertions: [],
    observations: [],
    notes: [],
  };
}

export function finishUatResult(result: JourneyResult): JourneyResult {
  result.endedAt = new Date().toISOString();
  result.durationMs = Date.parse(result.endedAt) - Date.parse(result.startedAt);
  return result;
}

export function recordAssertion(
  result: JourneyResult,
  name: string,
  pass: boolean,
  detail: string,
): void {
  result.assertions.push({ name, pass, detail });
}

/** Assert an HTTP status is within the documented expected set. */
export function assertStatus(
  result: JourneyResult,
  name: string,
  response: HttpCallResult,
  expectedStatuses: ReadonlySet<number>,
): void {
  const pass = expectedStatuses.has(response.status);
  recordAssertion(
    result,
    name,
    pass,
    pass
      ? `status ${response.status}`
      : `status ${response.status} (expected ${[...expectedStatuses].join('|')}) body=${truncate(JSON.stringify(response.body), 300)}`,
  );
}

/** Extract the error code from the standard `{error:{code}}` envelope. */
export function errorCode(body: unknown): string | null {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error: { code?: unknown } }).error === 'object' &&
    (body as { error: { code?: unknown } }).error !== null
  ) {
    const code = (body as { error: { code?: unknown } }).error.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Extract the first string-valued field from a JSON body. */
export function stringId(body: unknown, keys: readonly string[]): string {
  if (typeof body !== 'object' || body === null) return '';
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

/** Preview a transaction with the world merchant (201 expected). */
export function previewTransaction(
  ctx: UatContext,
  options: { amount?: string; idempotencyKey?: string } = {},
): Promise<HttpCallResult> {
  const world = ctx.world.merchant;
  return httpCall(ctx.baseUrl, {
    method: 'POST',
    path: '/api/v1/merchant/transactions/preview',
    token: world.merchantToken,
    idempotencyKey: options.idempotencyKey ?? `preview-${randomSuffix()}`,
    headers: { 'x-market-id': world.marketId },
    body: {
      amount: options.amount ?? '100.00',
      memberQrToken: world.qrToken,
      marketId: world.marketId,
      transactionNote: '',
    },
  });
}

/** Confirm a previewed transaction (201 expected). */
export function confirmTransaction(
  ctx: UatContext,
  previewSessionId: string,
  options: { merchantReceiptNumber?: string; idempotencyKey?: string } = {},
): Promise<HttpCallResult> {
  return httpCall(ctx.baseUrl, {
    method: 'POST',
    path: `/api/v1/merchant/transactions/${previewSessionId}/confirm`,
    token: ctx.world.merchant.merchantToken,
    idempotencyKey: options.idempotencyKey ?? `confirm-${randomSuffix()}`,
    headers: { 'x-market-id': ctx.world.merchant.marketId },
    body: {
      merchantReceiptNumber:
        options.merchantReceiptNumber ?? `REC-${randomSuffix()}`,
    },
  });
}

/** Confirm a fresh transaction end-to-end; returns the transaction number. */
export async function confirmFreshTransaction(
  ctx: UatContext,
): Promise<{ transactionNumber: string; previewSessionId: string }> {
  const preview = await previewTransaction(ctx);
  const previewSessionId = stringId(preview.body, ['previewSessionId']);
  const confirm = await confirmTransaction(ctx, previewSessionId);
  return {
    transactionNumber: stringId(confirm.body, ['transactionNumber']),
    previewSessionId,
  };
}

/** P4-S7 exactly-once counts for one preview session. */
export async function confirmationState(
  ctx: UatContext,
  publicPreviewReference: string,
): Promise<Record<string, number | string>> {
  const resolved = await ctx.pool.query<{ previewSessionId: string }>(
    `SELECT preview_session_id AS "previewSessionId"
       FROM transaction_idempotency_records
      WHERE operation = 'PREVIEW'
        AND response->>'previewSessionId' = $1
      LIMIT 1`,
    [publicPreviewReference],
  );
  const previewSessionId = resolved.rows[0]?.previewSessionId;
  if (!previewSessionId) throw new Error('preview reference not resolvable');
  const rows = await ctx.pool.query<Record<string, string>>(
    `SELECT
       (SELECT status::text FROM transaction_preview_sessions WHERE id = $1) AS "previewStatus",
       (SELECT count(*) FROM transactions WHERE preview_session_id = $1) AS transactions,
       (SELECT count(*) FROM transaction_service_fees fee
         JOIN transactions transaction ON transaction.id = fee.transaction_id
        WHERE transaction.preview_session_id = $1) AS fees,
       (SELECT count(*) FROM transaction_mcp_debits debit
         JOIN transactions transaction ON transaction.id = debit.transaction_id
        WHERE transaction.preview_session_id = $1) AS debits,
       (SELECT count(*) FROM transaction_reward_links reward_link
         JOIN transactions transaction ON transaction.id = reward_link.transaction_id
        WHERE transaction.preview_session_id = $1) AS "rewardLinks",
       (SELECT count(*) FROM reward_sources source
         JOIN transactions transaction ON transaction.id = source.source_id
        WHERE transaction.preview_session_id = $1) AS "rewardSources",
       (SELECT count(*) FROM reward_plans plan
         JOIN transactions transaction ON transaction.id = plan.source_id
        WHERE transaction.preview_session_id = $1) AS "rewardPlans",
       (SELECT count(*) FROM member_wallet_entries wallet_entry
          JOIN transactions transaction ON transaction.id::text = wallet_entry.reference_id
         WHERE transaction.preview_session_id = $1) AS "walletEntries",
       (SELECT count(*) FROM transaction_idempotency_records
         WHERE preview_session_id = $1) AS "idempotencyRecords",
       (SELECT count(*) FROM transaction_audit_references
         WHERE preview_session_id = $1) AS "auditReferences"`,
    [previewSessionId],
  );
  const row = rows.rows[0] ?? {};
  const out: Record<string, number | string> = {
    previewStatus: row['previewStatus'] ?? '',
  };
  for (const key of [
    'transactions',
    'fees',
    'debits',
    'rewardLinks',
    'rewardSources',
    'rewardPlans',
    'walletEntries',
    'idempotencyRecords',
    'auditReferences',
  ]) {
    out[key] = Number(row[key] ?? 0);
  }
  return out;
}

/** MCP adjustment market rules + reason code fixture (J3 pattern). */
export async function seedMcpAdjustFixtures(ctx: UatContext): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO mcp_adjustment_market_rules (
        market_code, soft_cap, hard_cap, secure_evidence_available, is_active
       ) VALUES ($1, '10000', '100000', false, true)
     ON CONFLICT (market_code) DO NOTHING`,
    [ctx.world.marketCode],
  );
  await ctx.pool.query(
    `INSERT INTO mcp_adjustment_reason_codes (
        market_code, code, label, is_high_risk, is_active
       ) VALUES ($1, 'OPERATIONAL_CORRECTION',
                 'Operational correction of a processing error', false, true)
     ON CONFLICT DO NOTHING`,
    [ctx.world.marketCode],
  );
}

/** iPoint adjustment market rules + reason code fixture (J9 pattern). */
export async function seedIpointAdjustFixtures(ctx: UatContext): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO ipoint_adjustment_market_rules (
        market_code, soft_cap, hard_cap, secure_evidence_available
       ) VALUES ($1, '10000', '100000', false)
     ON CONFLICT (market_code) DO NOTHING`,
    [ctx.world.marketCode],
  );
  await ctx.pool.query(
    `INSERT INTO ipoint_adjustment_reason_codes (
        market_code, code, label, is_high_risk
       ) VALUES ($1, 'OPERATIONAL_CORRECTION',
                 'Operational correction of a processing error', false)
     ON CONFLICT DO NOTHING`,
    [ctx.world.marketCode],
  );
}

/** A fresh member wallet id for a given member (createMember helper). */
export async function ensureMemberWallet(
  ctx: UatContext,
  memberId: string,
  initialBalance = '100000',
): Promise<string> {
  const wallet = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM member_wallet_accounts
      WHERE member_id = $1 AND market_id = $2 LIMIT 1`,
    [memberId, ctx.world.marketId],
  );
  if (wallet.rows[0]?.id) {
    await ctx.pool.query(
      `UPDATE member_wallet_accounts SET available_balance = $1 WHERE id = $2`,
      [initialBalance, wallet.rows[0].id],
    );
    return wallet.rows[0].id;
  }
  const created = await ctx.pool.query<{ id: string }>(
    `INSERT INTO member_wallet_accounts (member_id, market_id, available_balance)
     VALUES ($1, $2, $3) RETURNING id`,
    [memberId, ctx.world.marketId, initialBalance],
  );
  return created.rows[0]?.id ?? '';
}

export { randomUUID };
