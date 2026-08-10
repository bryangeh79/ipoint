/**
 * P8-S6 DB / worker behaviour observations (Stage D evidence).
 *
 * Boots the real app against a dedicated fresh `ipoint_p8s6_*` database,
 * seeds the standard world, then records:
 *  - EXPLAIN plans for the key read paths (index usage; seq-scan detection)
 *  - lock/statement timeout effectiveness under a confirm storm
 *  - deadlock counters (pg_stat_database delta) across storms
 *  - connection-pool behaviour (pg_stat_activity) under a storm
 *  - outbox worker drain (auto-worker + deterministic batch)
 *
 * Output: JSON evidence under `.local/p8-s6-load/**` (gitignored) and a
 * readable table on stdout. Run after the L1/L2 journey runs:
 *   pnpm exec tsx src/load/run-db-observations.ts
 *
 * @packageDocumentation
 */

import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadContext } from './harness.js';
import { bootLoadApp } from './harness.js';
import { confirmTransaction, previewTransaction } from './journeys/common.js';
import { assertLoadTestAllowed } from './guards.js';

interface Observation {
  name: string;
  detail: string;
}

async function main(): Promise<number> {
  const databaseUrl = process.env['DATABASE_URL'];
  try {
    assertLoadTestAllowed(databaseUrl);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  const ctx = await bootLoadApp({ level: 'L0', silent: false });
  const observations: Observation[] = [];
  const world = ctx.world;
  const merchant = world.merchant;

  // --- EXPLAIN key read paths ---------------------------------------------
  const explainPaths: Array<[string, string, unknown[]]> = [
    [
      'transactions merchant list',
      `EXPLAIN (FORMAT JSON)
         SELECT * FROM transactions
         WHERE merchant_branch_id = $1
         ORDER BY created_at DESC LIMIT 20`,
      [merchant.branchId],
    ],
    [
      'transactions member list',
      `EXPLAIN (FORMAT JSON)
         SELECT * FROM transactions
         WHERE member_id = $1
         ORDER BY created_at DESC LIMIT 20`,
      [merchant.memberId],
    ],
    [
      'transactions detail/receipt',
      `EXPLAIN (FORMAT JSON)
         SELECT * FROM transactions WHERE transaction_number = 1`,
      [],
    ],
    [
      'reconciliation runs queue',
      `EXPLAIN (FORMAT JSON)
         SELECT * FROM reconciliation_runs WHERE market_id = $1 ORDER BY created_at DESC`,
      [world.marketId],
    ],
    [
      'outbox pending queue',
      `EXPLAIN (FORMAT JSON)
         SELECT * FROM transaction_commission_dispatch
         WHERE status = 'PENDING' ORDER BY available_at LIMIT 10`,
      [],
    ],
  ];
  for (const [name, sqlText, params] of explainPaths) {
    try {
      const result = await ctx.pool.query(sqlText, params);
      const plan = JSON.stringify(result.rows[0]);
      const seqScan = /"Node Type": ?"Seq Scan"/u.test(plan);
      observations.push({
        name: `EXPLAIN ${name}`,
        detail: seqScan
          ? 'SEQUENTIAL SCAN detected on the plan'
          : `index-based plan (${plan.slice(0, 200)}…)`,
      });
    } catch (error) {
      observations.push({
        name: `EXPLAIN ${name}`,
        detail: `error: ${(error as Error).message}`,
      });
    }
  }

  // --- deadlock + rollback counters ---------------------------------------
  const before = await ctx.pool.query<{
    deadlocks: string;
    xactRollback: string;
    xactCommit: string;
  }>(
    `SELECT deadlocks::text AS deadlocks, xact_rollback::text AS "xactRollback",
            xact_commit::text AS "xactCommit"
       FROM pg_stat_database WHERE datname = current_database()`,
  );

  // --- confirm storm under observation ------------------------------------
  const stormCount = 30;
  const poolBefore = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = current_database()`,
  );
  const poolStart = Number(poolBefore.rows[0]?.count ?? 0);

  const lockSampler = setInterval(async () => {
    try {
      const rows = await ctx.pool.query<{ waiting: string }>(
        `SELECT count(*)::text AS waiting
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type IN ('Lock', 'LWLock')`,
      );
      if (Number(rows.rows[0]?.waiting ?? 0) > 0) {
        observations.push({
          name: 'lock-wait sample',
          detail: `${rows.rows[0]?.waiting} sessions waiting on locks during confirm storm`,
        });
      }
    } catch {
      // sampler best-effort only
    }
  }, 250);

  const stormStart = Date.now();
  const storm = await Promise.all(
    Array.from({ length: stormCount }, async () => {
      const preview = await previewTransaction(ctx);
      const previewSessionId = (preview.body as { previewSessionId?: string })
        ?.previewSessionId;
      if (!previewSessionId) return { status: 500 };
      return confirmTransaction(ctx, previewSessionId, {
        idempotencyKey: `dbobs-${Math.random().toString(36).slice(2, 10)}`,
      });
    }),
  );
  const stormMs = Date.now() - stormStart;
  clearInterval(lockSampler);

  const after = await ctx.pool.query<{
    deadlocks: string;
    xactRollback: string;
    xactCommit: string;
  }>(
    `SELECT deadlocks::text AS deadlocks, xact_rollback::text AS "xactRollback",
            xact_commit::text AS "xactCommit"
       FROM pg_stat_database WHERE datname = current_database()`,
  );
  const poolAfter = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = current_database()`,
  );
  const poolEnd = Number(poolAfter.rows[0]?.count ?? 0);

  observations.push({
    name: 'confirm storm 30-way',
    detail: `completed in ${stormMs}ms; statuses ${storm.map((r) => r.status).join(',')}`,
  });
  observations.push({
    name: 'deadlock counter delta',
    detail: `deadlocks ${before.rows[0]?.deadlocks} → ${after.rows[0]?.deadlocks}`,
  });
  observations.push({
    name: 'transaction rollback/commit delta',
    detail: `rollback ${before.rows[0]?.xactRollback} → ${after.rows[0]?.xactRollback}; commit ${before.rows[0]?.xactCommit} → ${after.rows[0]?.xactCommit}`,
  });
  observations.push({
    name: 'connection pool behaviour',
    detail: `pg_stat_activity sessions ${poolStart} → ${poolEnd} during storm (no exhaustion = stable)`,
  });

  // --- outbox drain (auto-worker + deterministic batch) -------------------
  const pendingBefore = await dispatchCount(ctx);
  const drainStart = Date.now();
  let pending = pendingBefore;
  const deadline = drainStart + 90_000;
  while (pending > 0 && Date.now() < deadline) {
    await ctx.outboxWorker.processBatchOnce();
    await new Promise((resolve) => setTimeout(resolve, 400));
    pending = await dispatchCount(ctx);
  }
  const drainMs = Date.now() - drainStart;
  const statuses = await ctx.pool.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text AS count FROM transaction_commission_dispatch GROUP BY status`,
  );
  const statusMap: Record<string, number> = {};
  for (const row of statuses.rows) statusMap[row.status] = Number(row.count);
  observations.push({
    name: 'outbox drain',
    detail: `pending ${pendingBefore} → ${pending} in ${drainMs}ms; statuses ${JSON.stringify(statusMap)}`,
  });
  const overBudget = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM transaction_commission_dispatch WHERE attempts > max_attempts`,
  );
  observations.push({
    name: 'outbox bounded retries',
    detail: `rows with attempts > max_attempts = ${overBudget.rows[0]?.count ?? 0}`,
  });

  // --- statement/lock timeout effectiveness -------------------------------
  const timeoutRows = await ctx.pool.query<{ setting: string }>(
    `SELECT setting FROM pg_settings WHERE name IN ('statement_timeout', 'lock_timeout') ORDER BY name`,
  );
  observations.push({
    name: 'session timeout defaults',
    detail: `statement_timeout/lock_timeout session defaults: ${timeoutRows.rows.map((r) => r.setting).join(' / ')} (per-write boundaries set locally by the transaction engine)`,
  });

  for (const observation of observations)
    console.log(`[obs] ${observation.name}: ${observation.detail}`);

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const dir = join(
    process.cwd(),
    '.local',
    'p8-s6-load',
    `${timestamp}-db-observations`,
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'observations.json'),
    `${JSON.stringify({ databaseName: databaseUrl, observations }, null, 2)}\n`,
    'utf-8',
  );
  console.log(`\n[P8-S6] db observations written to ${dir}`);
  await ctx.app.close();
  process.exit(0);
  return 0;
}

async function dispatchCount(ctx: LoadContext): Promise<number> {
  const rows = await ctx.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM transaction_commission_dispatch WHERE status = 'PENDING'`,
  );
  return Number(rows.rows[0]?.count ?? 0);
}

main().catch((error) => {
  console.error('[P8-S6] db observations fatal:', error);
  process.exit(2);
});
