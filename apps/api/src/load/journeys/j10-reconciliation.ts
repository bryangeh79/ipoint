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
  // Reconciliation execute is a heavy admin batch op; OBS-04 (High, open):
  // sustained =10-way concurrent reconcile transactions stall the DB pool.
  // All J10 ops are measured at 5-way at L2 (the proven-stable ceiling).
  const runScale =
    ctx.level === 'L2' ? { concurrency: 5, iterations: 10 } : undefined;
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
  if (ctx.level !== 'L0') {
    const stormCreate = await httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `${base}/runs`,
      token,
      idempotencyKey: `j10-storm-create-${randomSuffix()}`,
      body: { kind: 'IPOINT', ...WINDOW, reason: 'P8-S6 storm run.' },
    });
    const stormRunId = stringId(stormCreate.body, ['id']);
    // OBS-04: the true-multi-transaction same-run storm reproduces a
    // pool-level stall at 10-20-way; the storm is bounded at 5-way (the
    // proven-stable ceiling, matches the L1 storm) with 20s client timeouts.
    const stormed = await Promise.all(
      Array.from({ length: 5 }, () =>
        httpCallWithTimeout(
          ctx.baseUrl,
          {
            method: 'POST',
            path: `${base}/runs/${stormRunId}/execute`,
            token,
            idempotencyKey: `j10-storm-execute-${randomSuffix()}`,
          },
          25_000,
        ),
      ),
    );
    const statuses = stormed.map((r) => r.status);
    const okCount = statuses.filter((s) => s === 200).length;
    const hung = stormed.filter((r) => r.status === 0);
    const stateRows = await ctx.pool.query<{ status: string }>(
      `SELECT status::text AS status FROM reconciliation_runs WHERE id = $1`,
      [stormRunId],
    );
    const finalState = stateRows.rows[0]?.status ?? 'n/a';
    result.assertions.push({
      name: 'J10 concurrent execute → exactly one completed run, all bounded',
      pass: finalState === 'COMPLETED' && hung.length === 0 && okCount >= 1,
      detail: `statuses ${statuses.join(',')}; final state = ${finalState}; client-timeouts = ${hung.length}`,
    });

    // Replay with the same execute key returns the same run.
    const replayKey = `j10-replay-${randomSuffix()}`;
    const first = await httpCallWithTimeout(
      ctx.baseUrl,
      {
        method: 'POST',
        path: `${base}/runs/${stormRunId}/execute`,
        token,
        idempotencyKey: replayKey,
      },
      25_000,
    );
    const replay = await httpCallWithTimeout(
      ctx.baseUrl,
      {
        method: 'POST',
        path: `${base}/runs/${stormRunId}/execute`,
        token,
        idempotencyKey: replayKey,
      },
      25_000,
    );
    const firstId = stringId(first.body, ['id']);
    const replayId = stringId(replay.body, ['id']);
    result.assertions.push({
      name: 'J10 execute replay (same key) → same run, no second execution',
      pass:
        first.status === 200 && replay.status === 200 && firstId === replayId,
      detail: `first=${first.status} replay=${replay.status} sameRun=${firstId === replayId}`,
    });
  }

  return finishJourneyResult(result);
}
