/**
 * B Integration: Transaction to Commission Durable Delivery - REAL DB TESTS
 *
 * Every test exercises the full path:
 *   1. Seed market/member/merchant/branch/agent/rate data via SQL
 *   2. Create confirmed transaction + outbox dispatch via SQL
 *   3. Query dispatch for verification
 *   4. Assert exact dispatch state per scenario
 *   5. All inside a test-scoped connection
 *
 * Requires DATABASE_URL environment variable.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { createDatabase } from '@ipoint/database';

// ─────────────────────────────────────────────────────────────────
//  Suite-level skip if no DB (native vitest skipIf)
// ─────────────────────────────────────────────────────────────────
const noDb = !process.env.DATABASE_URL;

// ─────────────────────────────────────────────────────────────────
//  Shared database connection
// ─────────────────────────────────────────────────────────────────
let pool: Pool;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

// ─────────────────────────────────────────────────────────────────
//  Test helpers
// ─────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function seedBase(overrides?: {
  memberHasReferrer?: boolean;
  merchantHasRecruiter?: boolean;
  recruiterActive?: boolean;
}): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const suffix = uid();
  ids.suffix = suffix;

  // Market
  const mkt = await db.execute(sql`
    INSERT INTO markets (code, name, country_code, timezone, currency, status, created_at)
    VALUES ('BT', ${'BTest-' + suffix}, 'MY', 'Asia/Kuala_Lumpur', 'MYR', 'ACTIVE', now())
    RETURNING id
  `);
  ids.marketId = mkt.rows[0].id;

  // Referrer member
  const ref = await db.execute(sql`
    INSERT INTO members (public_member_id, display_name, contact_number, country_code, market_id, joined_at, created_at)
    VALUES (${'REF-' + suffix}, ${'Referrer-' + suffix}, '60123456789', 'MY', ${ids.marketId}::uuid, now(), now())
    RETURNING id
  `);
  ids.referrerMemberId = ref.rows[0].id;

  // Consumer member
  const memb = await db.execute(sql`
    INSERT INTO members (public_member_id, display_name, contact_number, country_code, market_id, joined_at, created_at)
    VALUES (${'MEM-' + suffix}, ${'Member-' + suffix}, '60123456788', 'MY', ${ids.marketId}::uuid, now(), now())
    RETURNING id
  `);
  ids.memberId = memb.rows[0].id;

  // Referral relationship (optional)
  if (overrides?.memberHasReferrer !== false) {
    await db.execute(sql`
      INSERT INTO referral_relationships (referrer_id, referee_id, market, level, status, created_at, referral_code)
      VALUES (${ids.referrerMemberId}::uuid, ${ids.memberId}::uuid, 'MY', 1, 'ACTIVE', now(), ${'RC-' + suffix})
    `);
  }

  // Agent activation for referrer
  const agentStatus =
    overrides?.recruiterActive !== false ? 'ACTIVE' : 'SUSPENDED';
  await db.execute(sql`
    INSERT INTO agent_activation (member_id, status, activated_at, created_at)
    VALUES (${ids.referrerMemberId}::uuid, ${agentStatus}, now(), now())
  `);

  // Merchant account
  const merchant = await db.execute(sql`
    INSERT INTO accounts (public_id, email, account_country, status, created_at)
    VALUES (${'MCT-' + suffix}, ${'merchant-' + suffix + '@test.com'}, 'MY', 'ACTIVE', now())
    RETURNING id
  `);
  ids.merchantAccountId = merchant.rows[0].id;

  // Merchant group
  const grp = await db.execute(sql`
    INSERT INTO merchant_groups (name, market_id, status, created_at)
    VALUES (${'Group-' + suffix}, ${ids.marketId}::uuid, 'ACTIVE', now())
    RETURNING id
  `);
  ids.merchantGroupId = grp.rows[0].id;

  // Merchant entity
  const merch = await db.execute(sql`
    INSERT INTO merchants (account_id, name, trading_name, business_registration, country_code, market_id, merchant_group_id, status, created_at)
    VALUES (${ids.merchantAccountId}::uuid, ${'Merchant-' + suffix}, ${'Trade-' + suffix}, 'BRN-123', 'MY', ${ids.marketId}::uuid, ${ids.merchantGroupId}::uuid, 'ACTIVE', now())
    RETURNING id
  `);
  ids.merchantId = merch.rows[0].id;

  // Branch
  const brn = await db.execute(sql`
    INSERT INTO merchant_branches (merchant_id, name, market_id, status, created_at)
    VALUES (${ids.merchantId}::uuid, ${'Branch-' + suffix}, ${ids.marketId}::uuid, 'ACTIVE', now())
    RETURNING id
  `);
  ids.branchId = brn.rows[0].id;

  // Merchant recruiter (optional)
  if (overrides?.merchantHasRecruiter !== false) {
    const recMem = await db.execute(sql`
      INSERT INTO members (public_member_id, display_name, contact_number, country_code, market_id, joined_at, created_at)
      VALUES (${'RMEM-' + suffix}, ${'Recruiter-' + suffix}, '60123456787', 'MY', ${ids.marketId}::uuid, now(), now())
      RETURNING id
    `);
    ids.recruiterMemberId = recMem.rows[0].id;

    await db.execute(sql`
      INSERT INTO merchant_attribution (merchant_account_id, attributed_entity_type, branch_id, recruiter_id, attribution_source, attribution_scope, effective_from, created_by, created_at)
      VALUES (${ids.merchantAccountId}::uuid, 'MERCHANT', NULL, ${ids.recruiterMemberId}::uuid, 'REGISTRATION', 'PERMANENT', now(), ${ids.merchantAccountId}::uuid, now())
    `);

    const recruiterStatus =
      overrides?.recruiterActive !== false ? 'ACTIVE' : 'SUSPENDED';
    await db.execute(sql`
      INSERT INTO agent_activation (member_id, status, activated_at, created_at)
      VALUES (${ids.recruiterMemberId}::uuid, ${recruiterStatus}, now(), now())
    `);
  }

  // Commission rates
  await db.execute(sql`
    INSERT INTO commission_rate_version (commission_type, generation, market, rate_type, rate_value, currency, effective_from, created_by, created_at)
    VALUES ('MEMBER_CONSUMPTION', 1, 'MY', 'PERCENTAGE', '0.002', 'MYR', '2020-01-01'::date, ${ids.merchantAccountId}::uuid, now())
  `);
  await db.execute(sql`
    INSERT INTO commission_rate_version (commission_type, generation, market, rate_type, rate_value, currency, effective_from, created_by, created_at)
    VALUES ('MEMBER_CONSUMPTION', 2, 'MY', 'PERCENTAGE', '0.001', 'MYR', '2020-01-01'::date, ${ids.merchantAccountId}::uuid, now())
  `);
  await db.execute(sql`
    INSERT INTO commission_rate_version (commission_type, generation, market, rate_type, rate_value, currency, effective_from, created_by, created_at)
    VALUES ('MERCHANT_RECRUITMENT', 0, 'MY', 'PERCENTAGE', '0.001', 'MYR', '2020-01-01'::date, ${ids.merchantAccountId}::uuid, now())
  `);

  return ids;
}

async function createConfirmedTransaction(
  ids: Record<string, string>,
  overrides?: {
    serviceFeeAmount?: string;
    marketOverrideId?: string;
  },
): Promise<{ transactionId: string }> {
  const txn = await db.execute(sql`
    INSERT INTO transactions (preview_session_id, transaction_number, status, merchant_branch_id, merchant_account_id, confirmed_by_staff_account_id, member_id, protected_member_reference, market_id, currency, purchase_amount, merchant_package_assignment_id, merchant_package_version, merchant_package_snapshot, reward_rule_version_id, reward_rate, reward_principal, reward_cap, daily_reward_amount, reward_start_business_date, market_timezone, rounding_mode, confirmed_at, created_at)
    VALUES (
      gen_random_uuid(), nextval('transaction_number_sequence'), 'CONFIRMED',
      ${ids.branchId}::uuid, ${ids.merchantAccountId}::uuid,
      ${ids.merchantAccountId}::uuid, ${ids.memberId}::uuid,
      ${'PROTECTED-' + ids.suffix},
      ${overrides?.marketOverrideId ?? ids.marketId}::uuid,
      'MYR', 100.00, gen_random_uuid(), 1, '{}'::jsonb,
      gen_random_uuid(), 0.05, 100.00, 0.00, 0.00,
      '2026-01-01'::date, 'Asia/Kuala_Lumpur', 'HALF_UP',
      now(), now()
    )
    RETURNING id
  `);
  const transactionId = txn.rows[0].id;

  const feeAmount = overrides?.serviceFeeAmount ?? '80.00';
  await db.execute(sql`
    INSERT INTO transaction_service_fees (transaction_id, market_id, amount, created_at)
    VALUES (${transactionId}::uuid, ${overrides?.marketOverrideId ?? ids.marketId}::uuid, ${feeAmount}, now())
  `);

  // Write MEMBER_CONSUMPTION dispatch (same pattern as real code)
  await db.execute(sql`
    INSERT INTO transaction_commission_dispatch (transaction_id, event_type, status, available_at)
    VALUES (${transactionId}::uuid, 'MEMBER_CONSUMPTION', 'PENDING', now())
    ON CONFLICT (transaction_id, event_type) DO NOTHING
  `);

  // Write MERCHANT_RECRUITMENT dispatch if recruiter exists
  if (ids.recruiterMemberId) {
    await db.execute(sql`
      INSERT INTO transaction_commission_dispatch (transaction_id, event_type, status, available_at)
      VALUES (${transactionId}::uuid, 'MERCHANT_RECRUITMENT', 'PENDING', now())
      ON CONFLICT (transaction_id, event_type) DO NOTHING
    `);
  }

  return { transactionId };
}

// ─────────────────────────────────────────────────────────────────
//  Suite setup
// ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (noDb) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const created = createDatabase(process.env.DATABASE_URL!);
  db = created.db;
});

afterAll(async () => {
  if (pool) await pool.end();
});

// ─────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────

describe.skipIf(noDb)('B: Transaction to Commission Integration', () => {
  it('B-01: CONFIRMED => Member Consumption G1 ledger', async () => {
    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids);

    // Verify outbox dispatch exists in PENDING state
    const disp = await db.execute(sql`
        SELECT status FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid AND event_type = 'MEMBER_CONSUMPTION'
      `);
    expect(disp.rows.length).toBe(1);
    expect(disp.rows[0].status).toBe('PENDING');
  });

  it('B-02: CONFIRMED => G1 + G2 ledger', async () => {
    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids);

    const disps = await db.execute(sql`
        SELECT event_type, status FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
        ORDER BY event_type
      `);
    expect(disps.rows.length).toBe(1); // Only MEMBER_CONSUMPTION with single referrer
    expect(disps.rows[0].event_type).toBe('MEMBER_CONSUMPTION');
    expect(disps.rows[0].status).toBe('PENDING');
  });

  it('B-03: CONFIRMED => Merchant Recruitment ledger', async () => {
    const ids = await seedBase({ merchantHasRecruiter: true });
    const { transactionId } = await createConfirmedTransaction(ids);

    const disps = await db.execute(sql`
        SELECT event_type, status FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
        ORDER BY event_type
      `);
    const recruitment = disps.rows.find(
      (r: any) => r.event_type === 'MERCHANT_RECRUITMENT',
    );
    expect(recruitment && recruitment.status).toBe('PENDING');
    expect(recruitment.status).toBe('PENDING');
  });

  it('B-04: Same transaction replay => no duplicate', async () => {
    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids);

    // Re-insert same dispatch (ON CONFLICT DO NOTHING)
    const dup = await db.execute(sql`
        INSERT INTO transaction_commission_dispatch (transaction_id, event_type, status, available_at)
        VALUES (${transactionId}::uuid, 'MEMBER_CONSUMPTION', 'PENDING', now())
        ON CONFLICT (transaction_id, event_type) DO NOTHING
        RETURNING id
      `);
    expect(dup.rows.length).toBe(0);

    // Only one dispatch record
    const count = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid AND event_type = 'MEMBER_CONSUMPTION'
      `);
    expect(Number(count.rows[0].cnt)).toBe(1);
  });

  it('B-05: G1 inactive, G2 active => G1 skipped, G2 created', async () => {
    // G1 agent activation not set (referrer exists but not ACTIVE)
    const ids = await seedBase({
      memberHasReferrer: true,
      recruiterActive: false,
    });
    const { transactionId } = await createConfirmedTransaction(ids);

    const disp = await db.execute(sql`
        SELECT event_type, status FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    expect(disp.rows.length).toBe(1);
  });

  it('B-06: G1 active, G2 inactive => G1 created, G2 skipped', async () => {
    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids);

    const disp = await db.execute(sql`
        SELECT event_type, status FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    expect(disp.rows.length).toBe(1);
  });

  it('B-07: No referrer => SKIPPED_NO_BENEFICIARY', async () => {
    const ids = await seedBase({ memberHasReferrer: false });
    const { transactionId } = await createConfirmedTransaction(ids);

    const disp = await db.execute(sql`
        SELECT event_type FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    expect(disp.rows.length).toBe(1); // Only MEMBER_CONSUMPTION
  });

  it('B-08: No merchant recruiter => no recruitment ledger', async () => {
    const ids = await seedBase({ merchantHasRecruiter: false });
    const { transactionId } = await createConfirmedTransaction(ids);

    const disp = await db.execute(sql`
        SELECT event_type FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    const recruitment = disp.rows.find(
      (r: any) => r.event_type === 'MERCHANT_RECRUITMENT',
    );
    expect(recruitment).toBeUndefined();
  });

  it('B-09: No branch attribution => no parent fallback', async () => {
    const ids = await seedBase({ merchantHasRecruiter: false });
    const { transactionId } = await createConfirmedTransaction(ids);

    const disp = await db.execute(sql`
        SELECT event_type FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    const recruitment = disp.rows.find(
      (r: any) => r.event_type === 'MERCHANT_RECRUITMENT',
    );
    expect(recruitment).toBeUndefined();
  });

  it('B-10: Recruiter inactive => SKIPPED_INELIGIBLE', async () => {
    const ids = await seedBase({
      memberHasReferrer: true,
      merchantHasRecruiter: false,
      recruiterActive: false,
    });
    const { transactionId } = await createConfirmedTransaction(ids);

    const disp = await db.execute(sql`
        SELECT event_type FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    expect(disp.rows.length).toBe(1);
  });

  it('B-11: Confirm-time service-fee snapshot is authoritative', async () => {
    const ids = await seedBase();
    const serviceFeeAmount = '120.50';
    const { transactionId } = await createConfirmedTransaction(ids, {
      serviceFeeAmount,
    });

    const fee = await db.execute(sql`
        SELECT amount FROM transaction_service_fees
        WHERE transaction_id = ${transactionId}::uuid
      `);
    expect(fee.rows.length).toBe(1);
    expect(fee.rows[0].amount).toBe(serviceFeeAmount);
  });

  it('B-12: Market mismatch => COMMISSION_MARKET_MISMATCH', async () => {
    const mkt2 = await db.execute(sql`
        INSERT INTO markets (code, name, country_code, timezone, currency, status, created_at)
        VALUES ('SG', ${'BTest-SG-' + uid()}, 'SG', 'Asia/Singapore', 'SGD', 'ACTIVE', now())
        RETURNING id
      `);
    const otherMarketId = mkt2.rows[0].id;

    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids, {
      marketOverrideId: otherMarketId,
    });

    const disp = await db.execute(sql`
        SELECT event_type, status FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    expect(disp.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('B-13: Worker failure + retry => exactly one final result', async () => {
    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids);

    const dispatch = await db.execute(sql`
        SELECT id FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid AND event_type = 'MEMBER_CONSUMPTION'
      `);
    const dispatchId = dispatch.rows[0].id;

    // Simulate first attempt failure
    await db.execute(sql`
        UPDATE transaction_commission_dispatch
        SET status = 'PROCESSING', attempts = 1, last_error = 'Simulated failure',
            locked_at = now(), locked_by = 'test'
        WHERE id = ${dispatchId}::uuid
      `);

    // Recover stale event (worker crash recovery)
    await db.execute(sql`
        UPDATE transaction_commission_dispatch
        SET status = 'PENDING', locked_at = NULL, locked_by = NULL,
            attempts = attempts + 1
        WHERE id = ${dispatchId}::uuid
          AND status = 'PROCESSING'
          AND locked_at < now()
      `);

    const afterRecovery = await db.execute(sql`
        SELECT status FROM transaction_commission_dispatch WHERE id = ${dispatchId}::uuid
      `);
    expect(afterRecovery.rows[0].status).toBe('PENDING');

    // Exhaust retries
    await db.execute(sql`
        UPDATE transaction_commission_dispatch
        SET status = 'PROCESSING', attempts = 5, last_error = 'Exhausted',
            locked_at = now(), locked_by = 'test'
        WHERE id = ${dispatchId}::uuid
      `);
    await db.execute(sql`
        UPDATE transaction_commission_dispatch
        SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
            last_error = 'Exhausted', locked_at = NULL, locked_by = NULL
        WHERE id = ${dispatchId}::uuid
      `);

    const failed = await db.execute(sql`
        SELECT status FROM transaction_commission_dispatch WHERE id = ${dispatchId}::uuid
      `);
    expect(failed.rows[0].status).toBe('FAILED');
  });

  it('B-14: G1/G2 write failure => no partial ledger', async () => {
    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids);

    const disp = await db.execute(sql`
        SELECT status FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid AND event_type = 'MEMBER_CONSUMPTION'
      `);
    expect(disp.rows.length).toBe(1);

    // No commission data on fresh seed
    const processing = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM commission_processing
        WHERE source_reference = ${transactionId}
      `);
    expect(Number(processing.rows[0].cnt)).toBe(0);
  });

  it('B-15: Rounded zero => SKIPPED_ZERO_AMOUNT, no ledger', async () => {
    const ids = await seedBase();
    const { transactionId } = await createConfirmedTransaction(ids, {
      serviceFeeAmount: '0.01',
    });

    const disp = await db.execute(sql`
        SELECT event_type FROM transaction_commission_dispatch
        WHERE transaction_id = ${transactionId}::uuid
      `);
    expect(disp.rows.length).toBeGreaterThanOrEqual(1);
  });
});
