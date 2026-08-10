/**
 * P8-S6 journey registry — the 12 contract §6 journeys in execution order.
 *
 * Every journey runs through `runJourney` which clears the in-memory auth
 * rate limiter first (fixture setup for later journeys performs logins; the
 * cleared-buckets methodology matches the P2-S4D / P4-S7 perf baselines).
 *
 * @packageDocumentation
 */

import type { LoadContext, JourneyResult } from '../harness.js';
import { clearRateLimiter } from '../harness.js';
import { runJourneyJ1 } from './j01-auth.js';
import { runJourneyJ2 } from './j02-transactions.js';
import { runJourneyJ3 } from './j03-mcp-debit.js';
import { runJourneyJ4 } from './j04-reward.js';
import { runJourneyJ5 } from './j05-commission.js';
import { runJourneyJ6 } from './j06-redemption.js';
import { runJourneyJ7 } from './j07-fulfilment.js';
import { runJourneyJ8 } from './j08-refund.js';
import { runJourneyJ9 } from './j09-maker-checker.js';
import { runJourneyJ10 } from './j10-reconciliation.js';
import { runJourneyJ11 } from './j11-reports.js';
import { runJourneyJ12 } from './j12-content.js';

export interface JourneyDefinition {
  id: string;
  name: string;
  run: (ctx: LoadContext) => Promise<JourneyResult>;
}

export async function runJourney(
  journey: JourneyDefinition,
  ctx: LoadContext,
): Promise<JourneyResult> {
  clearRateLimiter(ctx);
  return journey.run(ctx);
}

export const JOURNEYS: readonly JourneyDefinition[] = [
  { id: 'J1', name: 'auth/login', run: runJourneyJ1 },
  { id: 'J2', name: 'transactions', run: runJourneyJ2 },
  { id: 'J3', name: 'MCP debit', run: runJourneyJ3 },
  { id: 'J4', name: 'reward', run: runJourneyJ4 },
  { id: 'J5', name: 'commission', run: runJourneyJ5 },
  { id: 'J6', name: 'redemption', run: runJourneyJ6 },
  { id: 'J7', name: 'fulfilment', run: runJourneyJ7 },
  { id: 'J8', name: 'refund', run: runJourneyJ8 },
  { id: 'J9', name: 'Maker/Checker', run: runJourneyJ9 },
  { id: 'J10', name: 'reconciliation', run: runJourneyJ10 },
  { id: 'J11', name: 'reports', run: runJourneyJ11 },
  { id: 'J12', name: 'content delivery', run: runJourneyJ12 },
];
