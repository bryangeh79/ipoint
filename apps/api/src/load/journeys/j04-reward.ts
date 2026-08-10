/**
 * J4 — reward (earn / credit).
 *
 * Contract §6 journey 4. Ops: admin reward-rule scheduling + list over HTTP,
 * plus the earn path: a confirmed transaction credits the member wallet at
 * the frozen rule rate (5% of 100.00 = 0.05) with exactly one reward source
 * and one wallet entry — asserted by count after a confirm storm.
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
import {
  confirmTransaction,
  futureEffectiveDate,
  previewTransaction,
  randomSuffix,
} from './common.js';

const OK = new Set([200]);
const CREATED = new Set([201]);

export async function runJourneyJ4(ctx: LoadContext): Promise<JourneyResult> {
  const result = newJourneyResult(ctx, 'J4', 'reward');
  const world = ctx.world;

  await measureOp(ctx, result, 'rule-schedule', CREATED, async () =>
    httpCall(ctx.baseUrl, {
      method: 'POST',
      path: `/api/v1/admin/reward-ops/markets/${world.marketId}/rules`,
      token: world.opsAdmin.token,
      idempotencyKey: `j4-rule-${randomSuffix()}`,
      body: {
        package_reference: 'C',
        rate: '0.04',
        effective_date: futureEffectiveDate(3),
        reason: 'P8-S6 load rule schedule',
      },
    }),
  );

  await measureOp(ctx, result, 'rule-list', OK, async () =>
    httpCall(ctx.baseUrl, {
      method: 'GET',
      path: `/api/v1/admin/reward-ops/markets/${world.marketId}/rules`,
      token: world.opsAdmin.token,
    }),
  );

  // -- earn path: confirm credits exactly once -----------------------------
  if (ctx.level !== 'L0') {
    const memberId = world.merchant.memberId;
    const before = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM reward_sources WHERE member_id = $1`,
      [memberId],
    );
    const beforeCount = Number(before.rows[0]?.count ?? 0);

    // One confirm per storm iteration (distinct keys) — the reward credit
    // must equal the number of confirms exactly.
    const stormCount = 10;
    const results = await Promise.all(
      Array.from({ length: stormCount }, async () => {
        const preview = await previewTransaction(ctx);
        const previewSessionId = (preview.body as { previewSessionId?: string })
          ?.previewSessionId;
        if (!previewSessionId) return { status: 500 };
        return confirmTransaction(ctx, previewSessionId, {
          idempotencyKey: `j4-confirm-${randomSuffix()}`,
        });
      }),
    );
    const confirmed = results.filter((r) => r.status === 201).length;

    const after = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM reward_sources WHERE member_id = $1`,
      [memberId],
    );
    const afterCount = Number(after.rows[0]?.count ?? 0);
    result.assertions.push({
      name: 'J4 reward earn exactly-once (reward_sources delta = confirms)',
      pass: afterCount - beforeCount === confirmed && confirmed === stormCount,
      detail: `before=${beforeCount} after=${afterCount} confirmed=${confirmed}/${stormCount}`,
    });

    const walletEntry = await ctx.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM member_wallet_entries entry
         JOIN reward_sources source ON entry.reference_id = source.id::text
        WHERE source.member_id = $1 AND source.transaction_amount = '100.0000000000'`,
      [memberId],
    );
    const entryCount = Number(walletEntry.rows[0]?.count ?? 0);
    result.assertions.push({
      name: 'J4 every reward source has exactly one wallet entry',
      pass: entryCount === confirmed,
      detail: `reward-linked wallet entries = ${entryCount} (expected ${confirmed})`,
    });
  }

  return finishJourneyResult(result);
}
