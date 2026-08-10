/**
 * J2 — transactions (preview / confirm / receipt / history).
 *
 * Contract §6 journey 2. Latency ops over real HTTP plus the P4-S7-style
 * no-duplicate storm: 20 concurrent previews with one idempotency key → one
 * preview session; 20 concurrent confirms with one key → one financial chain
 * (1 transaction, 1 service fee, 1 MCP debit, 1 reward link, 1 reward source,
 * 1 wallet entry, MCP debited exactly once — the exact P4-S7 count method).
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
import { confirmTransaction, previewTransaction, stringId } from './common.js';
const OK = new Set([200]);
const CREATED = new Set([201]);

export interface ConfirmationState {
  previewStatus: string;
  transactions: number;
  fees: number;
  debits: number;
  rewardLinks: number;
  rewardSources: number;
  rewardPlans: number;
  walletEntries: number;
  idempotencyRecords: number;
  auditReferences: number;
  mcpBalance: string;
}

/** Resolve the internal preview id from the public reference (P4-S7 method). */
export async function resolvePreviewId(
  ctx: LoadContext,
  publicPreviewReference: string,
): Promise<string> {
  const result = await ctx.pool.query<{ previewSessionId: string }>(
    `SELECT preview_session_id AS "previewSessionId"
       FROM transaction_idempotency_records
      WHERE operation = 'PREVIEW'
        AND response->>'previewSessionId' = $1
      LIMIT 1`,
    [publicPreviewReference],
  );
  const previewSessionId = result.rows[0]?.previewSessionId;
  if (!previewSessionId) {
    throw new Error(
      `preview reference not resolvable: ${publicPreviewReference}`,
    );
  }
  return previewSessionId;
}

/** P4-S7 confirmationState — exactly-once counts for a preview session. */
export async function confirmationState(
  ctx: LoadContext,
  publicPreviewReference: string,
): Promise<ConfirmationState> {
  const resolvedPreviewId = await resolvePreviewId(ctx, publicPreviewReference);
  const rows = await ctx.pool.query<{
    previewStatus: string;
    transactions: string;
    fees: string;
    debits: string;
    rewardLinks: string;
    rewardSources: string;
    rewardPlans: string;
    walletEntries: string;
    idempotencyRecords: string;
    auditReferences: string;
    mcpBalance: string;
  }>(
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
         WHERE preview_session_id = $1) AS "auditReferences",
       (SELECT available_balance FROM mcp_accounts
        WHERE merchant_branch_id = (
          SELECT merchant_branch_id FROM transaction_preview_sessions WHERE id = $1
        )) AS "mcpBalance"`,
    [resolvedPreviewId],
  );
  const row = rows.rows[0];
  return {
    previewStatus: row?.previewStatus ?? '',
    transactions: Number(row?.transactions ?? 0),
    fees: Number(row?.fees ?? 0),
    debits: Number(row?.debits ?? 0),
    rewardLinks: Number(row?.rewardLinks ?? 0),
    rewardSources: Number(row?.rewardSources ?? 0),
    rewardPlans: Number(row?.rewardPlans ?? 0),
    walletEntries: Number(row?.walletEntries ?? 0),
    idempotencyRecords: Number(row?.idempotencyRecords ?? 0),
    auditReferences: Number(row?.auditReferences ?? 0),
    mcpBalance: row?.mcpBalance ?? '',
  };
}

export async function runJourneyJ2(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J2', 'transactions');
  const world = ctx.world.merchant;

  // -- latency ops ---------------------------------------------------------
  await measureOp(ctx, result, 'preview', CREATED, async () =>
    previewTransaction(ctx),
  );

  await measureOp(ctx, result, 'confirm', CREATED, async () => {
    const preview = await previewTransaction(ctx);
    const previewSessionId = (preview.body as { previewSessionId?: string })
      ?.previewSessionId;
    if (!previewSessionId) return { status: 500, latencyMs: preview.latencyMs };
    return confirmTransaction(ctx, previewSessionId);
  });

  // A confirmed transaction number for the read ops.
  const seededPreview = await previewTransaction(ctx);
  const seededPreviewId =
    (seededPreview.body as { previewSessionId?: string })?.previewSessionId ??
    '';
  const seededConfirm = await confirmTransaction(ctx, seededPreviewId);
  const transactionNumber = stringId(seededConfirm.body, ['transactionNumber']);
  result.observations.push(
    `read-op fixture transaction number: ${transactionNumber}`,
  );

  await measureOp(ctx, result, 'receipt/detail', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/merchant/transactions/${transactionNumber}`,
      token: world.merchantToken,
    }),
  );

  await measureOp(ctx, result, 'history/list', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: '/api/v1/merchant/transactions?limit=20',
      token: world.merchantToken,
    }),
  );

  // -- storm: concurrent preview, one key ----------------------------------
  if (ctx.level !== 'L0') {
    const stormKey = `j2-preview-storm-${randomSuffixLocal()}`;
    const stormed = await Promise.all(
      Array.from({ length: 20 }, () =>
        previewTransaction(ctx, { idempotencyKey: stormKey }),
      ),
    );
    const allCreated = stormed.every((r) => r.status === 201);
    const previewIds = new Set(
      stormed.map(
        (r) => (r.body as { previewSessionId?: string })?.previewSessionId,
      ),
    );
    result.assertions.push({
      name: 'J2 20 concurrent previews (one key) → single preview session',
      pass: allCreated && previewIds.size === 1,
      detail: allCreated
        ? `statuses all 201, distinct previewSessionId = ${previewIds.size}`
        : `statuses: ${stormed.map((r) => r.status).join(',')}`,
    });
    const publicPreviewId = [...previewIds][0];
    if (publicPreviewId) {
      // -- storm: concurrent confirm, one key ------------------------------
      const confirmKey = `j2-confirm-storm-${randomSuffixLocal()}`;
      const confirmations = await Promise.all(
        Array.from({ length: 20 }, () =>
          confirmTransaction(ctx, publicPreviewId, {
            idempotencyKey: confirmKey,
            merchantReceiptNumber: 'STORM-RECEIPT',
          }),
        ),
      );
      const allConfirmed = confirmations.every((r) => r.status === 201);
      result.assertions.push({
        name: 'J2 20 concurrent confirms (one key) → all return the single chain',
        pass: allConfirmed,
        detail: `statuses: ${confirmations.map((r) => r.status).join(',')}`,
      });
      const chain = await confirmationState(ctx, publicPreviewId);
      result.assertions.push({
        name: 'J2 confirm storm → exactly-one financial chain',
        pass:
          chain.transactions === 1 &&
          chain.fees === 1 &&
          chain.debits === 1 &&
          chain.rewardLinks === 1 &&
          chain.rewardSources === 1 &&
          chain.rewardPlans === 1 &&
          chain.walletEntries === 1,
        detail: JSON.stringify(chain),
      });
      result.assertions.push({
        name: 'J2 confirm storm debits MCP exactly once (5000 → 4900)',
        pass: chain.mcpBalance === '4900.0000000000',
        detail: `mcp available_balance = ${chain.mcpBalance} (expected 4900.0000000000)`,
      });
    }

    // No duplicate wallet-entry idempotency keys anywhere in the chain
    // (member_wallet_entries carries unique idempotency_key + unique
    // (wallet_account_id, entry_sequence); a duplicate key means a double write).
    const duplicateLedger = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM (
           SELECT idempotency_key, count(*) AS n
             FROM member_wallet_entries
            GROUP BY idempotency_key
           HAVING count(*) > 1
         ) dup`,
      [],
    );
    result.assertions.push({
      name: 'J2 no duplicate wallet-entry idempotency keys',
      pass: Number(duplicateLedger.rows[0]?.count ?? 0) === 0,
      detail: `duplicate groups = ${duplicateLedger.rows[0]?.count ?? 0}`,
    });
  }

  return finishJourneyResult(result);
}

function randomSuffixLocal(): string {
  return Math.random().toString(36).slice(2, 10);
}
