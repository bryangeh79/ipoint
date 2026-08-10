/**
 * P8-S6 standalone load runner (host evidence, L0/L1/L2).
 *
 * Boots the real NestJS application against a dedicated fresh `ipoint_p8s6_*`
 * database and runs the 12 contract §6 journeys over real HTTP. Raw evidence
 * (per-journey JSON + summary) is written to the gitignored
 * `.local/p8-s6-load/**` directory; a human-readable table is printed.
 *
 * Usage (PowerShell host):
 *   $env:DATABASE_URL='postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/ipoint_p8s6_test'
 *   $env:P8S6_DESTRUCTIVE_TEST='1'
 *   $env:P8S6_LOAD_LEVEL='L2'        # L0 | L1 | L2
 *   cd apps/api
 *   pnpm exec tsx src/load/run-load.ts
 *
 * Exit code: 0 = all journeys passed, 1 = any journey failed, 2 = setup error.
 *
 * @packageDocumentation
 */

import 'reflect-metadata';
import type { LoadContext } from './harness.js';
import { bootLoadApp, recordRunEvidence } from './harness.js';
import { JOURNEYS, runJourney } from './journeys/index.js';
import { assertLoadTestAllowed } from './guards.js';

const databaseUrl = process.env['DATABASE_URL'];
const level = (process.env['P8S6_LOAD_LEVEL'] ?? 'L0') as 'L0' | 'L1' | 'L2';
const runId = `run-${new Date().toISOString().replaceAll(':', '-')}`;

interface TableJourney {
  journeyId: string;
  journeyName: string;
  ops: Array<{
    op: string;
    samples: Array<unknown>;
    throughputPerSecond: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    errorCount: number;
    unexpectedErrorCount: number;
  }>;
  assertions: Array<{ name: string; pass: boolean; detail: string }>;
}

function printTable(ctx: LoadContext, results: TableJourney[]): void {
  console.log(
    `\n=== P8-S6 ${level} results (db: ${process.env['DATABASE_URL'] ?? ''}) ===`,
  );
  for (const journey of results) {
    console.log(`\n[${journey.journeyId}] ${journey.journeyName} (${level})`);
    for (const op of journey.ops) {
      console.log(
        `  ${op.op.padEnd(24)} n=${String(op.samples.length).padStart(4)} ` +
          `tps=${op.throughputPerSecond.toFixed(1).padStart(8)} ` +
          `p50=${op.p50Ms.toFixed(1).padStart(8)}ms ` +
          `p95=${op.p95Ms.toFixed(1).padStart(8)}ms ` +
          `p99=${op.p99Ms.toFixed(1).padStart(8)}ms ` +
          `err=${op.errorCount} unexpected=${op.unexpectedErrorCount}`,
      );
    }
    for (const assertion of journey.assertions) {
      console.log(
        `  ${assertion.pass ? 'PASS' : 'FAIL'}  ${assertion.name} — ${assertion.detail}`,
      );
    }
  }
  void ctx;
}

async function main(): Promise<number> {
  try {
    assertLoadTestAllowed(databaseUrl);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  console.log(
    `[P8-S6] booting app at level ${level} (database ${databaseUrl})...`,
  );
  const ctx = await bootLoadApp({ level, silent: false });
  console.log(
    `[P8-S6] app listening at ${ctx.baseUrl}; running ${JOURNEYS.length} journeys...`,
  );

  const results: Awaited<ReturnType<(typeof JOURNEYS)[number]['run']>>[] = [];
  let failedJourneys = 0;
  for (const journey of JOURNEYS) {
    const startedAt = Date.now();
    console.log(`[P8-S6] ${journey.id} ${journey.name} ...`);
    try {
      const result = await runJourney(journey, ctx);
      results.push(result);
      const failed = result.assertions.filter((a) => !a.pass);
      const unexpected = result.ops.filter((op) => op.unexpectedErrorCount > 0);
      const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (failed.length > 0 || unexpected.length > 0) {
        failedJourneys += 1;
        console.error(
          `[P8-S6] ${journey.id} FAILED in ${durationSec}s: ${failed.length} assertions, ${unexpected.length} unexpected-error ops`,
        );
      } else {
        console.log(`[P8-S6] ${journey.id} passed in ${durationSec}s`);
      }
    } catch (error) {
      failedJourneys += 1;
      console.error(
        `[P8-S6] ${journey.id} threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  printTable(ctx, results);
  const dir = recordRunEvidence(ctx, results, runId);
  console.log(`\n[P8-S6] evidence written to ${dir}`);
  await ctx.app.close();

  console.log(
    `[P8-S6] ${results.length - failedJourneys}/${results.length} journeys passed`,
  );
  // The outbox worker keeps a timer alive; exit explicitly so the runner
  // terminates cleanly.
  process.exit(failedJourneys === 0 ? 0 : 1);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('[P8-S6] fatal:', error);
    process.exitCode = 2;
  });
