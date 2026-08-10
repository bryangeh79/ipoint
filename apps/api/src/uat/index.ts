/**
 * P8-S8 UAT — scenario registry (U-01..U-36, contract §8).
 *
 * @packageDocumentation
 */

import type { JourneyResult, UatContext } from './types.js';
import { clearRateLimiter } from '../load/harness.js';
import { runU01 } from './scenarios-positive.js';
import { runU02 } from './scenarios-positive.js';
import { runU03 } from './scenarios-positive.js';
import { runU04 } from './scenarios-positive.js';
import { runU05 } from './scenarios-positive.js';
import { runU06 } from './scenarios-positive.js';
import { runU07 } from './scenarios-positive.js';
import { runU08 } from './scenarios-positive.js';
import { runU09 } from './scenarios-positive.js';
import { runU10 } from './scenarios-positive.js';
import { runU11 } from './scenarios-positive.js';
import { runU12 } from './scenarios-positive.js';
import { runU13 } from './scenarios-positive.js';
import { runU14 } from './scenarios-positive.js';
import { runU15 } from './scenarios-positive.js';
import { runU16 } from './scenarios-positive.js';
import { runU17 } from './scenarios-positive.js';
import { runU18 } from './scenarios-positive.js';
import { runU19 } from './scenarios-positive.js';
import { runU20 } from './scenarios-positive.js';
import { runU21 } from './scenarios-positive.js';
import { runU22 } from './scenarios-positive.js';
import { runU23 } from './scenarios-negative.js';
import { runU24 } from './scenarios-negative.js';
import { runU25 } from './scenarios-negative.js';
import { runU26 } from './scenarios-negative.js';
import { runU27 } from './scenarios-negative.js';
import { runU28 } from './scenarios-negative.js';
import { runU29 } from './scenarios-negative.js';
import { runU30 } from './scenarios-negative.js';
import { runU31 } from './scenarios-negative.js';
import { runU32 } from './scenarios-negative.js';
import { runU33 } from './scenarios-negative.js';
import { runU34 } from './scenarios-negative.js';
import { runU35 } from './scenarios-negative.js';
import { runU36 } from './scenarios-negative.js';

export interface UatScenarioDefinition {
  id: string;
  name: string;
  run: (ctx: UatContext) => Promise<JourneyResult>;
}

export async function runUatScenario(
  scenario: UatScenarioDefinition,
  ctx: UatContext,
): Promise<JourneyResult> {
  clearRateLimiter(ctx);
  return scenario.run(ctx);
}

export const UAT_SCENARIOS: readonly UatScenarioDefinition[] = [
  { id: 'U-01', name: 'member registration/login (+ OTP, MFA, session reuse)', run: runU01 },
  { id: 'U-02', name: 'market switching', run: runU02 },
  { id: 'U-03', name: 'merchant discovery', run: runU03 },
  { id: 'U-04', name: 'merchant transaction (preview/confirm/receipt/history)', run: runU04 },
  { id: 'U-05', name: 'MCP (merchant cash pool)', run: runU05 },
  { id: 'U-06', name: 'iPoint earning', run: runU06 },
  { id: 'U-07', name: 'wallet', run: runU07 },
  { id: 'U-08', name: 'agent/referral commission', run: runU08 },
  { id: 'U-09', name: 'merchant package', run: runU09 },
  { id: 'U-10', name: 'special percentage', run: runU10 },
  { id: 'U-11', name: 'reward rules', run: runU11 },
  { id: 'U-12', name: 'redemption (catalog/quote/order/voucher)', run: runU12 },
  { id: 'U-13', name: 'fulfilment (pickup/suspend/exception/retry)', run: runU13 },
  { id: 'U-14', name: 'refund (reversal/refund)', run: runU14 },
  { id: 'U-15', name: 'manual MCP Maker/Checker', run: runU15 },
  { id: 'U-16', name: 'manual iPoint Maker/Checker', run: runU16 },
  { id: 'U-17', name: 'admin workflows', run: runU17 },
  { id: 'U-18', name: 'audit', run: runU18 },
  { id: 'U-19', name: 'reports (R01-R19)', run: runU19 },
  { id: 'U-20', name: 'ads/content', run: runU20 },
  { id: 'U-21', name: 'reconciliation (run/execute/exceptions)', run: runU21 },
  { id: 'U-22', name: 'risk queues', run: runU22 },
  { id: 'U-23', name: 'cross-market denial', run: runU23 },
  { id: 'U-24', name: 'permission denial (RBAC)', run: runU24 },
  { id: 'U-25', name: 'duplicate/replay (idempotency-key reuse)', run: runU25 },
  { id: 'U-26', name: 'insufficient balance', run: runU26 },
  { id: 'U-27', name: 'expiry (OTP, quote, voucher)', run: runU27 },
  { id: 'U-28', name: 'suspension (member/merchant/account)', run: runU28 },
  { id: 'U-29', name: 'retry (bounded retries, retry-safe)', run: runU29 },
  { id: 'U-30', name: 'worker failure (outbox, daily jobs)', run: runU30 },
  { id: 'U-31', name: 'network/API failure (downstream unavailable)', run: runU31 },
  { id: 'U-32', name: 'concurrency (double decision, storm race)', run: runU32 },
  { id: 'U-33', name: 'stale/unavailable (freshness semantics)', run: runU33 },
  { id: 'U-34', name: 'failed fulfilment', run: runU34 },
  { id: 'U-35', name: 'refund retry (duplicate refund request)', run: runU35 },
  { id: 'U-36', name: 'reconciliation mismatch (difference detection)', run: runU36 },
];
