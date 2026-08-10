/**
 * J5 — commission (rate ops + outbox worker drain).
 *
 * Contract §6 journey 5. Ops: admin commission-rate scheduling + list over
 * HTTP. Worker observation: every confirmed transaction writes two dispatch
 * rows (MEMBER_CONSUMPTION, MERCHANT_RECRUITMENT) inside the confirm
 * transaction; the outbox worker must drain the backlog, never process a
 * single dispatch twice, and stay within the bounded attempt budget.
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
  selectMarketFor,
} from '../harness.js';
import {
  confirmTransaction,
  futureEffectiveDate,
  previewTransaction,
  randomSuffix,
} from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201]);

export async function runJourneyJ5(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J5', 'commission');
  await ensureRolePermissions(ctx, 'SUPER_ADMIN', [
    'commission.rate.read',
    'commission.rate.manage',
  ]);

  // Commission-rate routes are keyed by a 2-letter market CODE. Create a
  // dedicated two-letter market for this journey (the world market code is a
  // synthetic T-code) with a dedicated admin so the world baseline is
  // untouched.
  const code = `Q${'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 24)] ?? 'A'}`;
  const marketRows = await ctx.pool.query<{ id: string; code: string }>(
    `INSERT INTO markets (code, name, status, currency_code, timezone, default_locale)
     VALUES ($1, $2, 'ACTIVE', 'MYR', 'Asia/Kuala_Lumpur', 'en-MY')
     ON CONFLICT (code) DO NOTHING
     RETURNING id, code`,
    [code, `P8-S6 commission market ${code}`],
  );
  const marketId =
    marketRows.rows[0]?.id ??
    (
      await ctx.pool.query<{ id: string }>(
        `SELECT id FROM markets WHERE code = $1`,
        [code],
      )
    ).rows[0]?.id ??
    '';
  const admin = await createAdmin(
    ctx.database,
    ctx.auth,
    [marketId],
    'SUPER_ADMIN',
  );
  await selectMarketFor(ctx, admin.accountId, marketId);
  const token = admin.token;
  // The route param is the market UUID; the service then validates the
  // market's code is the canonical 2-letter shape.
  const rateBase = `/api/v1/admin/commission-ops/markets/${marketId}/rates`;

  let rateIndex = 0;
  // Rate scheduling is a serialized config op by business rule (overlapping
  // windows are a documented 409), so it is measured with concurrency 1.
  await measureOp(
    ctx,
    result,
    'rate-schedule',
    CREATED,
    async () => {
      rateIndex += 1;
      return httpCall(ctx.baseUrl, {
        method: 'POST',
        path: rateBase,
        token,
        idempotencyKey: `j5-rate-${randomSuffix()}`,
        body: {
          commission_type: 'AGENT_UPGRADE',
          generation: 1,
          rate_type: 'FIXED',
          rate_value: '88.0000000000',
          // Distinct future effective date per iteration.
          effective_date: futureEffectiveDate(3 + (rateIndex % 40)),
          reason: 'P8-S6 load rate configuration',
        },
      });
    },
    { concurrency: 1 },
  );

  await measureOp(ctx, result, 'rate-list', OK, async () =>
    httpCall(ctx.baseUrl, { method: 'GET', path: rateBase, token }),
  );

  // -- outbox drain observation -------------------------------------------
  if (ctx.level !== 'L0') {
    const pendingBefore = await dispatchCount(ctx, 'PENDING');
    result.observations.push(
      `outbox PENDING before seed = ${pendingBefore} (auto-worker may have drained earlier journeys)`,
    );

    // Seed confirmed transactions (unmeasured setup; each confirm enqueues
    // two dispatch events inside the same transaction).
    const seedCount = 12;
    for (let i = 0; i < seedCount; i += 1) {
      const preview = await previewTransaction(ctx);
      const previewSessionId = (preview.body as { previewSessionId?: string })
        ?.previewSessionId;
      if (previewSessionId) {
        await confirmTransaction(ctx, previewSessionId, {
          idempotencyKey: `j5-confirm-${randomSuffix()}`,
        });
      }
    }

    // Deterministic final drain: give the auto-worker time, then force one
    // batch cycle (the worker's documented deterministic entry point).
    const startedAt = Date.now();
    let pending = await dispatchCount(ctx, 'PENDING');
    const deadline = startedAt + 60_000;
    while (pending > 0 && Date.now() < deadline) {
      await ctx.outboxWorker.processBatchOnce();
      await new Promise((resolve) => setTimeout(resolve, 500));
      pending = await dispatchCount(ctx, 'PENDING');
    }
    const drainMs = Date.now() - startedAt;

    const statuses = await ctx.pool.query<{ status: string; count: string }>(
      `SELECT status, count(*)::text AS count
         FROM transaction_commission_dispatch
        GROUP BY status ORDER BY status`,
      [],
    );
    const statusMap: Record<string, number> = {};
    for (const row of statuses.rows) {
      statusMap[row.status] = Number(row.count);
    }
    result.observations.push(
      `outbox drain: ${drainMs}ms, final statuses ${JSON.stringify(statusMap)}`,
    );

    result.assertions.push({
      name: 'J5 outbox backlog drains to zero within the bounded window',
      pass: pending === 0,
      detail: `pending after drain = ${pending} (drain window ${drainMs}ms)`,
    });

    const duplicates = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM (
           SELECT transaction_id, event_type, count(*) AS n
             FROM transaction_commission_dispatch
            GROUP BY transaction_id, event_type
           HAVING count(*) > 1
         ) dup`,
      [],
    );
    result.assertions.push({
      name: 'J5 no duplicate (transaction_id, event_type) dispatch rows',
      pass: Number(duplicates.rows[0]?.count ?? 0) === 0,
      detail: `duplicate groups = ${duplicates.rows[0]?.count ?? 0}`,
    });

    const overBudget = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM transaction_commission_dispatch
        WHERE attempts > max_attempts`,
      [],
    );
    result.assertions.push({
      name: 'J5 no dispatch exceeds the bounded attempt budget',
      pass: Number(overBudget.rows[0]?.count ?? 0) === 0,
      detail: `rows with attempts > max_attempts = ${overBudget.rows[0]?.count ?? 0}`,
    });

    const totalDispatches = await dispatchCount(ctx, null);
    result.observations.push(
      `outbox total dispatch rows after drain = ${totalDispatches} (seed = ${seedCount} × 2)`,
    );
  }

  return finishJourneyResult(result);
}

async function dispatchCount(
  ctx: LoadContext,
  status: string | null,
): Promise<number> {
  const rows = await ctx.pool.query<{ count: string }>(
    status === null
      ? 'SELECT count(*)::text AS count FROM transaction_commission_dispatch'
      : 'SELECT count(*)::text AS count FROM transaction_commission_dispatch WHERE status = $1',
    status === null ? [] : [status],
  );
  return Number(rows.rows[0]?.count ?? 0);
}
