/**
 * J10 — reconciliation (run / execute / exception queue).
 *
 * Contract §6 journey 10. Ops over real HTTP: run create (MCP), run execute,
 * run list + detail. Storm: concurrent execute of the same run with distinct
 * keys → exactly one completed run; replay with the same key → same run.
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import {
  finishJourneyResult,
  httpCall,
  httpCallWithTimeout,
  measureOp,
  newJourneyResult,
} from '../harness.js';
import { randomSuffix, stringId } from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201]);

const WINDOW = {
  windowStart: '2026-01-01T00:00:00.000Z',
  windowEnd: '2031-01-01T00:00:00.000Z',
};

export async function runJourneyJ10(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J10', 'reconciliation');
  const world = ctx.world;
  // Reconciliation execute is a heavy admin batch op. OBS-04 (High, fixed -
  // fix record FIX-005): detect* queries now run on the transaction-scoped
  // client, so the J10 L2 profile no longer deadlocks the pool. Run create
  // stays serial at L2 (setup op, not the contention shape); run-execute
  // keeps the default L2 20-way x 20-iteration profile, which is the exact
  // recipe that previously reproduced the stall.
  const runScale =
    ctx.level === 'L2' ? { concurrency: 1, iterations: 3 } : undefined;
  const base = `/api/v1/admin/reconciliation/markets/${world.marketId}`;
  const token = world.superAdmin.token;

  let runId = '';
  await measureOp(
    ctx,
    result,
    'run-create',
    CREATED,
    async () => {
      const created = await httpCall(ctx.baseUrl, {
        method: 'POST',
        path: `${base}/runs`,
        token,
        idempotencyKey: `j10-create-${randomSuffix()}`,
        body: { kind: 'MCP', ...WINDOW, reason: 'P8-S6 load run.' },
      });
      if (created.status === 201) {
        runId = stringId(created.body, ['id']);
      }
      return created;
    },
    runScale,
  );

  // Each measured iteration executes a FRESH run (distinct run id) so the
  // latency sample measures a single uncontended execute; the same-run
  // contention behaviour is covered by the dedicated storm below.
  await measureOp(ctx, result, 'run-execute', OK, async () => {
    const created = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/runs`,
      token,
      idempotencyKey: `j10-execute-run-${randomSuffix()}`,
      body: { kind: 'MCP', ...WINDOW, reason: 'P8-S6 load run.' },
    });
    if (created.status !== 201) return created;
    const freshRunId = stringId(created.body, ['id']);
    return httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/runs/${freshRunId}/execute`,
      token,
      idempotencyKey: `j10-execute-${randomSuffix()}`,
    });
  });

  await measureOp(ctx, result, 'run-list', OK, async () =>
    httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/runs`, token }),
  );

  await measureOp(ctx, result, 'run-detail', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `${base}/runs/${runId}`,
      token,
    }),
  );

  await measureOp(ctx, result, 'exceptions-list', OK, async () =>
    httpCall(ctx.baseUrl, { method: 'GET', path: `${base}/exceptions`, token }),
  );

  // -- storm: concurrent execute, one run ----------------------------------
  // OBS-04 (High, fixed - fix record FIX-005): before the fix, the same-run
  // execute storm reproduced a pool-level deadlock at 20-way (L2): every
  // in-flight transaction held a pooled connection while its detect* queries
  // waited for a further pool connection, so all 10 pooled sessions sat
  // "idle in transaction" on `update reconciliation_runs` and the pool never
  // drained. With detect* scoped to the transaction client, each execute
  // runs its detection on its own connection and the storm completes bounded.
  // L1 keeps the historical 2-way evidence shape; L2 runs the acceptance
  // recipe: 20 concurrent executes, 3 waves (sustained), with an
  // idle-in-transaction pool sample mid-wave and after each wave.
  const stormWaves = ctx.level === 'L2' ? 3 : 1;
  const stormConcurrency = ctx.level === 'L2' ? 20 : 2;
  const samplePool =
    ctx.level === 'L2'
      ? new (await import('pg')).Pool({
          connectionString: process.env['DATABASE_URL'],
          connectionTimeoutMillis: 5000,
          max: 1,
        })
      : null;
  let replayRunId = '';
  try {
    for (let wave = 1; wave <= stormWaves; wave += 1) {
      const stormCreate = await httpCall(ctx.baseUrl, {
        method: 'POST',
        path: `${base}/runs`,
        token,
        idempotencyKey: `j10-storm-create-${randomSuffix()}`,
        body: { kind: 'IPOINT', ...WINDOW, reason: 'P8-S6 storm run.' },
      });
      const stormRunId = stringId(stormCreate.body, ['id']);
      const stormedPromise = Promise.all(
        Array.from({ length: stormConcurrency }, () =>
          httpCallWithTimeout(
            ctx.baseUrl,
            {
              method: 'POST',
              path: `${base}/runs/${stormRunId}/execute`,
              token,
              idempotencyKey: `j10-storm-execute-${randomSuffix()}`,
            },
            60_000,
          ),
        ),
      );
      // Mid-wave sample: 2s after firing, while the storm is still in
      // flight. Pre-fix this window showed idle-in-transaction climbing to
      // the pool maximum; post-fix it must stay at zero (or transient only).
      const midSamplePromise = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!samplePool) return null;
        return samplePool.query<{ idle_tx: number; active: number }>(
          `SELECT count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_tx,
                  count(*) FILTER (WHERE state = 'active')::int AS active
             FROM pg_stat_activity
            WHERE datname = current_database()`,
        );
      })();
      const stormed = await stormedPromise;
      const midSample = await midSamplePromise;
      const statuses = stormed.map((r) => r.status);
      const okCount = statuses.filter((s) => s === 200).length;
      const hung = stormed.filter((r) => r.status === 0);
      // Bounded lock-timeout waiters (OBS-02) surface as 500 with a safe
      // databaseCode of 55P03; they are a documented expected outcome. Any
      // other status, any non-55P03 500, or a client-side timeout is
      // unexpected for the storm.
      const unexpectedStorm = stormed.filter((r) => {
        if (r.status === 200) return false;
        if (r.status === 500) {
          const details = (
            r.body as { error?: { details?: { databaseCode?: string } } } | null
          )?.error?.details;
          return details?.databaseCode !== '55P03';
        }
        return true;
      });
      const stateRows = await ctx.pool.query<{ status: string }>(
        `SELECT status::text AS status FROM reconciliation_runs WHERE id = $1`,
        [stormRunId],
      );
      const finalState = stateRows.rows[0]?.status ?? 'n/a';
      result.assertions.push({
        name: `J10 wave ${wave} (level ${ctx.level}): concurrent execute -> exactly one completed run, all bounded`,
        pass:
          finalState === 'COMPLETED' &&
          hung.length === 0 &&
          okCount >= 1 &&
          unexpectedStorm.length === 0,
        detail: `concurrency=${stormConcurrency}; statuses ${statuses.join(',')}; final state = ${finalState}; client-timeouts = ${hung.length}; unexpected = ${unexpectedStorm.length}`,
      });
      if (samplePool && midSample) {
        const mid = midSample.rows[0];
        result.observations.push(
          `J10 wave ${wave} (level ${ctx.level}) mid-wave pool sample: idle_in_transaction=${String(mid?.idle_tx)}, active=${String(mid?.active)}`,
        );
        const post = (
          await samplePool.query<{ idle_tx: number; active: number }>(
            `SELECT count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_tx,
                    count(*) FILTER (WHERE state = 'active')::int AS active
               FROM pg_stat_activity
              WHERE datname = current_database()`,
          )
        ).rows[0];
        result.observations.push(
          `J10 wave ${wave} (level ${ctx.level}) post-wave pool sample: idle_in_transaction=${String(post?.idle_tx)}, active=${String(post?.active)}`,
        );
        if (wave === stormWaves) {
          result.assertions.push({
            name: 'J10 storm pool observation: no idle-in-transaction accumulation after the storm',
            pass: Number(post?.idle_tx ?? -1) === 0,
            detail: `idle-in-transaction = ${String(post?.idle_tx)} after ${stormWaves} wave(s) of ${stormConcurrency}-way concurrent executes`,
          });
        }
      }
      replayRunId = stormRunId;
    }

    // Replay with the same execute key returns the same run.
    if (replayRunId) {
      const replayKey = `j10-replay-${randomSuffix()}`;
      const first = await httpCallWithTimeout(
        ctx.baseUrl,
        {
          method: 'POST',
          path: `${base}/runs/${replayRunId}/execute`,
          token,
          idempotencyKey: replayKey,
        },
        60_000,
      );
      const replay = await httpCallWithTimeout(
        ctx.baseUrl,
        {
          method: 'POST',
          path: `${base}/runs/${replayRunId}/execute`,
          token,
          idempotencyKey: replayKey,
        },
        60_000,
      );
      const firstId = stringId(first.body, ['id']);
      const replayId = stringId(replay.body, ['id']);
      result.assertions.push({
        name: 'J10 execute replay (same key) -> same run, no second execution',
        pass:
          first.status === 200 && replay.status === 200 && firstId === replayId,
        detail: `first=${first.status} replay=${replay.status} sameRun=${firstId === replayId}`,
      });
    }
  } finally {
    await samplePool?.end();
  }

  return finishJourneyResult(result);
}
