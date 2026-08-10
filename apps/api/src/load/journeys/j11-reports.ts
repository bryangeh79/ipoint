/**
 * J11 — reports (R01–R19 read surfaces).
 *
 * Contract §6 journey 11. Ops over real HTTP: report list + all nineteen
 * report reads (R01–R19) with the asOf/freshness read surface. Measured at a
 * reduced scale (heavy read queries; scale 0.25 at L2 keeps the run bounded
 * while still collecting 100+ samples per report at 20-way concurrency).
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

const OK = new Set([200]);

export const REPORT_CODES = [
  'R01',
  'R02',
  'R03',
  'R04',
  'R05',
  'R06',
  'R07',
  'R08',
  'R09',
  'R10',
  'R11',
  'R12',
  'R13',
  'R14',
  'R15',
  'R16',
  'R17',
  'R18',
  'R19',
] as const;

export async function runJourneyJ11(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J11', 'reports');
  const world = ctx.world;
  const base = `/api/v1/admin/report-ops/markets/${world.marketId}/reports`;
  const token = world.superAdmin.token;
  const scale = ctx.level === 'L2' ? 0.25 : 1;

  await measureOp(
    ctx,
    result,
    'report-list',
    OK,
    async () => httpCall(ctx.baseUrl, { method: 'GET', path: base, token }),
    { scale },
  );

  for (const code of REPORT_CODES) {
    await measureOp(
      ctx,
      result,
      `report-${code}`,
      OK,
      async () =>
        httpCall(ctx.baseUrl, {
          method: 'GET',
          path: `${base}/${code}?asOf=${encodeURIComponent(new Date().toISOString())}`,
          token,
        }),
      { scale },
    );
  }

  // -- assertions ----------------------------------------------------------
  const unexpected = result.ops.filter((op) => op.unexpectedErrorCount > 0);
  result.assertions.push({
    name: 'J11 all 19 report reads have zero unexpected errors',
    pass: unexpected.length === 0,
    detail:
      unexpected.length === 0
        ? 'all report ops clean'
        : `unexpected errors on: ${unexpected.map((op) => op.op).join(', ')}`,
  });
  const opCount = result.ops.length;
  result.assertions.push({
    name: 'J11 all 20 report surfaces measured (list + R01–R19)',
    pass: opCount === 20,
    detail: `measured ${opCount} report ops`,
  });

  return finishJourneyResult(result);
}
