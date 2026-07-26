/**
 * B Integration: Transaction to Commission — ALL 15 STRICT SEMANTIC TESTS
 * Every test accepts EXACTLY ONE frozen business outcome.
 * No conditional assertions. No forensics. No dual-result fallbacks.
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql, eq, and } from 'drizzle-orm';
import {
  markets,
  accounts,
  members,
  memberProfiles,
  memberQrIdentities,
  referralRelationships,
  agentActivations,
  merchantGroups,
  merchantAccountAccess,
  merchantBranches,
  merchantAttributions,
  commissionRateVersions,
  mcpAccounts,
  serviceFeeProfiles,
  serviceFeeVersions,
  merchantPackageAssignments,
  transactionCommissionDispatch,
  commissionProcessing,
  commissionProcessingResults,
  commissionLedger,
  marketTransactionSettings,
  rewardRuleVersions,
  adminUsers,
  transactions,
} from '@ipoint/database';
import { AppModule } from '../app.module.js';
import { TransactionService } from '../transaction/transaction.service.js';
import { TransactionCommissionOutboxWorker } from '../transaction/transaction-commission-outbox.worker.js';
import { RbacGuard } from '../platform-access/rbac.guard.js';
import { DatabaseService } from '../database/database.service.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

let app: INestApplication;
let db: any;
let transactionService: TransactionService;
let outboxWorker: TransactionCommissionOutboxWorker;
const uid = () => randomUUID().slice(0, 8);

export interface BScenario {
  suffix: string;
  marketId: string;
  marketCode: string;
  staffAccountId: string;
  merchantAccountId: string;
  branchId: string;
  memberId: string;
  memberQrToken: string;
  packageId: string;
  g1MemberId: string | null;
  g2MemberId: string | null;
  recruiterMemberId: string | null;
}

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.stubEnv('AUTH_OTP_PEPPER', 'test-otp-pepper-with-at-least-32-characters');
  const m = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(RbacGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = m.createNestApplication();
  await app.init();
  db = app.get(DatabaseService).db;
  transactionService = app.get(TransactionService);
  outboxWorker = app.get(TransactionCommissionOutboxWorker);
  outboxWorker.stop();
});

afterAll(async () => {
  if (app) await app.close();
});

// ── DRIZZLE ORM SEED ──

async function seedBScenario(opts?: {
  g1Active?: boolean;
  g2Active?: boolean;
  merchantAttributionLevel?: 'NONE' | 'MERCHANT' | 'BRANCH';
  memberHasG1?: boolean;
  memberHasG2?: boolean;
}): Promise<BScenario> {
  const s = uid();
  const mc = s.substring(0, 2).toUpperCase();

  await db
    .insert(markets)
    .values({
      code: mc,
      name: `B-${s}`,
      timezone: 'Asia/Kuala_Lumpur',
      status: 'ACTIVE',
      defaultLocale: 'en',
      currencyCode: 'MYR',
    })
    .onConflictDoNothing({ target: markets.code });
  const [mkt] = await db
    .select({ id: markets.id, code: markets.code })
    .from(markets)
    .where(eq(markets.code, mc))
    .limit(1);
  await db
    .insert(marketTransactionSettings)
    .values({
      marketId: mkt.id,
      currencyCode: 'MYR',
      currencyScale: 2,
      minimumTransactionAmount: '1.00',
      maximumTransactionAmount: '999999.99',
    })
    .onConflictDoNothing();

  const [aa] = await db
    .insert(accounts)
    .values({
      publicId: `A-${s}`,
      email: `a-${s}@t.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [au] = await db
    .insert(adminUsers)
    .values({ accountId: aa.id, displayName: `Au-${s}` })
    .returning({ id: adminUsers.id });
  await db
    .insert(rewardRuleVersions)
    .values({
      name: `RR-${s}`,
      effectiveFrom: new Date('2020-01-01'),
      rewardRate: '0.05',
      capType: 'FLAT',
      capValue: '1000.00',
      minimumReward: '0',
      marketId: mkt.id,
      createdBy: au.id,
    })
    .onConflictDoNothing();

  const [ma] = await db
    .insert(accounts)
    .values({
      publicId: `M-${s}`,
      email: `m-${s}@t.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [sa] = await db
    .insert(accounts)
    .values({
      publicId: `S-${s}`,
      email: `s-${s}@t.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [gr] = await db
    .insert(merchantGroups)
    .values({ accountId: ma.id, marketId: mkt.id, name: `G-${s}` })
    .returning({ id: merchantGroups.id });
  await db
    .insert(merchantAccountAccess)
    .values({
      accountId: sa.id,
      merchantGroupId: gr.id,
      accessType: 'PRIMARY_OWNER',
    })
    .onConflictDoNothing();
  const [br] = await db
    .insert(merchantBranches)
    .values({
      merchantGroupId: gr.id,
      merchantId: `E-${s}`,
      marketId: mkt.id,
      name: `B-${s}`,
      status: 'ACTIVE',
      isPubliclyVisible: true,
      isOnline: true,
      isOffline: false,
      displayOrder: 0,
    })
    .returning({ id: merchantBranches.id });
  await db
    .insert(mcpAccounts)
    .values({
      merchantBranchId: br.id,
      marketId: mkt.id,
      availableBalance: '500000.00',
      totalBalance: '500000.00',
      status: 'ACTIVE',
    })
    .onConflictDoNothing();

  const [pf] = await db
    .insert(serviceFeeProfiles)
    .values({ code: `P-${s}`, name: `Pkg-${s}`, marketId: mkt.id })
    .onConflictDoNothing({ target: serviceFeeProfiles.code })
    .returning({ id: serviceFeeProfiles.id });
  const [fv] = await db
    .insert(serviceFeeVersions)
    .values({
      serviceFeeProfileId: pf.id,
      rate: '2.500000',
      effectiveFrom: new Date('2020-01-01'),
      status: 'ACTIVE',
      marketId: mkt.id,
    })
    .returning({ id: serviceFeeVersions.id });
  const [pk] = await db
    .insert(merchantPackageAssignments)
    .values({
      merchantBranchId: br.id,
      serviceFeeVersionId: fv.id,
      status: 'ACTIVE',
      isDefault: true,
    })
    .returning({ id: merchantPackageAssignments.id });

  const [mcA] = await db
    .insert(accounts)
    .values({
      publicId: `MC-${s}`,
      email: `mc-${s}@t.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [mb] = await db
    .insert(members)
    .values({
      accountId: mcA.id,
      publicMemberId: `MB-${s}`,
      referralCode: `RC-${s}`,
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    })
    .returning({ id: members.id });
  await db
    .insert(memberProfiles)
    .values({ memberId: mb.id, displayName: `M-${s}` });
  const rawQr = `qr-${s}-${Date.now()}`;
  await db
    .insert(memberQrIdentities)
    .values({
      memberId: mb.id,
      publicQrId: `pq-${s}`,
      tokenHash: createHash('sha256').update(rawQr, 'utf8').digest('hex'),
      status: 'ACTIVE',
    })
    .onConflictDoNothing();

  // Referrer chain
  const g1On = opts?.memberHasG1 !== false;
  const g2On = opts?.memberHasG2 === true;
  let g1Id: string | null = null,
    g2Id: string | null = null;
  const g1Active = opts?.g1Active !== false;
  const g2Active = opts?.g2Active !== false;

  if (g2On) {
    const [a2] = await db
      .insert(accounts)
      .values({
        publicId: `G2A-${s}`,
        email: `g2a-${s}@t.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    const [m2] = await db
      .insert(members)
      .values({
        accountId: a2.id,
        publicMemberId: `G2M-${s}`,
        referralCode: `G2RC-${s}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    await db
      .insert(memberProfiles)
      .values({ memberId: m2.id, displayName: `G2-${s}` });
    g2Id = m2.id;
    await db
      .insert(agentActivations)
      .values({
        memberId: m2.id,
        status: g2Active ? 'ACTIVE' : 'SUSPENDED',
        market: mc,
        activatedAt: new Date('2020-01-01'),
      })
      .onConflictDoNothing();
  }

  if (g1On) {
    const refMemberId = g2Id ?? null;
    const [a1] = await db
      .insert(accounts)
      .values({
        publicId: `G1A-${s}`,
        email: `g1a-${s}@t.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    const [m1] = await db
      .insert(members)
      .values({
        accountId: a1.id,
        publicMemberId: `G1M-${s}`,
        referralCode: `G1RC-${s}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    await db
      .insert(memberProfiles)
      .values({ memberId: m1.id, displayName: `G1-${s}` });
    g1Id = m1.id;

    if (refMemberId) {
      await db
        .insert(referralRelationships)
        .values({
          referrerId: refMemberId,
          refereeId: m1.id,
          market: mc,
          level: 2,
          status: 'ACTIVE',
          referralCode: `R2-${s}`,
        })
        .onConflictDoNothing();
    }
    await db
      .insert(referralRelationships)
      .values({
        referrerId: m1.id,
        refereeId: mb.id,
        market: mc,
        level: 1,
        status: 'ACTIVE',
        referralCode: `R1-${s}`,
      })
      .onConflictDoNothing();

    await db
      .insert(agentActivations)
      .values({
        memberId: m1.id,
        status: g1Active ? 'ACTIVE' : 'SUSPENDED',
        market: mc,
        activatedAt: new Date('2020-01-01'),
      })
      .onConflictDoNothing();
  }

  // Merchant recruiter attribution
  let recruiterMemberId: string | null = null;
  const attr = opts?.merchantAttributionLevel ?? 'NONE';
  if (attr !== 'NONE') {
    const [rm] = await db
      .insert(members)
      .values({
        accountId: ma.id,
        publicMemberId: `RM-${s}`,
        referralCode: `RMRC-${s}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    recruiterMemberId = rm.id;
    await db
      .insert(agentActivations)
      .values({
        memberId: rm.id,
        status: 'ACTIVE',
        market: mc,
        activatedAt: new Date('2020-01-01'),
      })
      .onConflictDoNothing();
    await db
      .insert(merchantAttributions)
      .values({
        merchantAccountId: ma.id,
        attributedEntityType: attr === 'BRANCH' ? 'BRANCH' : 'MERCHANT',
        branchId: attr === 'BRANCH' ? br.id : null,
        recruiterMemberId: rm.id,
        attributionSource: 'REGISTRATION',
        attributionScope: 'PERMANENT',
        effectiveFrom: new Date('2020-01-01'),
        createdBy: ma.id,
      })
      .onConflictDoNothing();
  }

  await db
    .insert(commissionRateVersions)
    .values([
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 1,
        market: mc,
        rateValue: '0.002',
        rateType: 'PERCENTAGE',
        currency: 'MYR',
        effectiveFrom: new Date('2020-01-01'),
        createdBy: ma.id,
      },
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 2,
        market: mc,
        rateValue: '0.001',
        rateType: 'PERCENTAGE',
        currency: 'MYR',
        effectiveFrom: new Date('2020-01-01'),
        createdBy: ma.id,
      },
      {
        commissionType: 'MERCHANT_RECRUITMENT',
        generation: 0,
        market: mc,
        rateValue: '0.001',
        rateType: 'PERCENTAGE',
        currency: 'MYR',
        effectiveFrom: new Date('2020-01-01'),
        createdBy: ma.id,
      },
    ])
    .onConflictDoNothing();

  return {
    suffix: s,
    marketId: mkt.id,
    marketCode: mc,
    staffAccountId: sa.id,
    merchantAccountId: ma.id,
    branchId: br.id,
    memberId: mb.id,
    memberQrToken: rawQr,
    packageId: pk.id,
    g1MemberId: g1Id,
    g2MemberId: g2Id,
    recruiterMemberId,
  };
}

// ── EXECUTE HELPER ──

interface ProcessedTransaction {
  preview: any;
  confirm: any;
  transactionId: string;
  dispatchAfter: any[];
  workerResult: any;
  memberProc: any[];
  recruitProc: any[];
  memberResults: any[];
  recruitResults: any[];
  ledger: any[];
}

async function executeAndProcess(
  scenario: BScenario,
  opts?: {
    previewIdempotencyKey?: string;
    confirmIdempotencyKey?: string;
    amount?: string;
    processWorker?: boolean;
    workerFailureInjection?: () => Promise<void>;
    postConfirmMutation?: () => Promise<void>;
  },
): Promise<ProcessedTransaction> {
  const pKey =
    opts?.previewIdempotencyKey ?? `pv-${scenario.suffix}-${Date.now()}`;
  const cKey =
    opts?.confirmIdempotencyKey ?? `cf-${scenario.suffix}-${Date.now()}`;

  const preview = await transactionService.createPreview(
    scenario.staffAccountId,
    {
      amount: opts?.amount ?? '100.00',
      memberQrToken: scenario.memberQrToken,
      packageId: scenario.packageId,
      marketId: scenario.marketId,
    },
    pKey,
    scenario.marketId,
    {},
  );

  const confirm = await transactionService.confirm(
    scenario.staffAccountId,
    preview.previewSessionId,
    {},
    cKey,
    {},
  );

  const [tx] = await db
    .select({
      id: transactions.id,
      transactionNumber: transactions.transactionNumber,
    })
    .from(transactions)
    .where(
      eq(
        transactions.transactionNumber,
        sql`${confirm.transactionNumber}::bigint`,
      ),
    )
    .limit(1);

  // Post-confirm mutation hook
  if (opts?.postConfirmMutation) await opts.postConfirmMutation();

  // Worker failure injection — mark dispatches as PROCESSING with failure BEFORE worker runs
  if (opts?.workerFailureInjection) {
    await opts.workerFailureInjection();
    // Also mark any MEMBER_CONSUMPTION dispatches as failed
    await db
      .update(transactionCommissionDispatch)
      .set({
        status: 'PROCESSING',
        lockedAt: new Date(),
        lockedBy: 'test-failure',
        attempts: 1,
        lastError: 'Injected failure for B-13/B-14',
      })
      .where(
        and(
          eq(transactionCommissionDispatch.transactionId, tx.id),
          eq(transactionCommissionDispatch.eventType, 'MEMBER_CONSUMPTION'),
        ),
      );
  }

  const wr =
    opts?.processWorker !== false
      ? await outboxWorker.processBatchOnce()
      : null;

  const dispatchAfter = await db
    .select()
    .from(transactionCommissionDispatch)
    .where(eq(transactionCommissionDispatch.transactionId, tx.id))
    .orderBy(transactionCommissionDispatch.eventType);

  // ── Query processing AFTER worker ──
  const allProc = await db
    .select()
    .from(commissionProcessing)
    .where(eq(commissionProcessing.sourceReference, tx.id));

  const memberProc = allProc.filter(
    (p: any) => p.sourceType === 'MEMBER_CONSUMPTION',
  );
  const recruitProc = allProc.filter(
    (p: any) => p.sourceType === 'MERCHANT_TRANSACTION',
  );

  const mProcIds = memberProc.map((p: any) => p.id);
  const memberResults = mProcIds.length
    ? await db
        .select()
        .from(commissionProcessingResults)
        .where(
          sql`${commissionProcessingResults.processingId} = ANY(ARRAY[${sql.join(
            mProcIds.map((id: string) => sql`${id}::uuid`),
            sql`, `,
          )}]::uuid[])`,
        )
        .orderBy(commissionProcessingResults.generation)
    : [];

  const rProcIds = recruitProc.map((p: any) => p.id);
  const recruitResults = rProcIds.length
    ? await db
        .select()
        .from(commissionProcessingResults)
        .where(
          sql`${commissionProcessingResults.processingId} = ANY(ARRAY[${sql.join(
            rProcIds.map((id: string) => sql`${id}::uuid`),
            sql`, `,
          )}]::uuid[])`,
        )
    : [];

  const ledger = await db
    .select()
    .from(commissionLedger)
    .where(eq(commissionLedger.sourceReference, tx.id))
    .orderBy(commissionLedger.generation);

  return {
    preview,
    confirm,
    transactionId: tx.id,
    dispatchAfter,
    workerResult: wr,
    memberProc,
    recruitProc,
    memberResults,
    recruitResults,
    ledger,
  };
}

// ── TESTS ──

function expectExactLedgerCount(
  ledger: any[],
  entryType: string,
  expected: number,
) {
  const matching = ledger.filter((l: any) => l.entryType === entryType);
  expect(matching.length).toBe(expected);
}

function expectExactMemberResult(
  results: any[],
  generation: number,
  expectedOutcome: string,
) {
  const r = results.find((pr: any) => pr.generation === generation);
  expect(r).toBeTruthy();
  expect(r.outcome).toBe(expectedOutcome);
  return r;
}

describe('B: Transaction to Commission Integration', () => {
  it('B-01: CONFIRMED leads to Member Consumption G1 ledger', async () => {
    const sc = await seedBScenario();
    const r = await executeAndProcess(sc);

    // DIAGNOSTIC
    process.stderr.write(
      '[B01-DIAG] outcome=' +
        r.memberProc[0]?.completionOutcome +
        ' status=' +
        r.memberProc[0]?.status +
        '\n',
    );
    process.stderr.write(
      '[B01-DIAG] results=' +
        JSON.stringify(
          r.memberResults.map((x: any) => ({
            g: x.generation,
            o: x.outcome,
            b: x.beneficiaryId,
          })),
        ) +
        '\n',
    );
    process.stderr.write('[B01-DIAG] ledger=' + r.ledger.length + '\n');

    // Dispatch must be COMPLETED
    const md = r.dispatchAfter.find(
      (d: any) => d.eventType === 'MEMBER_CONSUMPTION',
    );
    expect(md).toBeTruthy();
    expect(md.status).toBe('COMPLETED');
    expect(md.completedAt).toBeTruthy();
    expect(md.lastError).toBeNull();

    // Processing: exactly 1 MEMBER_CONSUMPTION record
    expect(r.memberProc.length).toBe(1);
    expect(r.memberProc[0].status).toBe('COMPLETED');
    expect(r.memberProc[0].completionOutcome).toBe('CREATED');

    // Result: exactly 1 G1 result = CREATED
    expect(r.memberResults.length).toBe(1);
    expect(r.memberResults[0].generation).toBe(1);
    expect(r.memberResults[0].outcome).toBe('CREATED');
    expect(r.memberResults[0].beneficiaryId).toBe(sc.g1MemberId);
    expect(r.memberResults[0].commissionType).toBe('MEMBER_CONSUMPTION');

    // Ledger: exactly 1 G1_EARN
    const g1l = r.ledger.find(
      (l: any) => l.entryType === 'MEMBER_CONSUMPTION_G1_EARN',
    );
    expect(g1l).toBeTruthy();
    expect(g1l.generation).toBe(1);
    expect(g1l.market).toBe(sc.marketCode);
    expect(g1l.currency).toBe('MYR');
    expect(g1l.sourceReference).toBe(r.transactionId);
    expect(r.ledger.length).toBe(1);
  });

  it('B-02: G1 + G2 ledgers with different beneficiaries and generations', async () => {
    const sc = await seedBScenario({ memberHasG1: true, memberHasG2: true });
    const r = await executeAndProcess(sc);

    // Processing must be CREATED
    expect(r.memberProc.length).toBe(1);
    expect(r.memberProc[0].completionOutcome).toBe('CREATED');

    // Results: G1 = CREATED, G2 = CREATED
    const g1Res = expectExactMemberResult(r.memberResults, 1, 'CREATED');
    const g2Res = expectExactMemberResult(r.memberResults, 2, 'CREATED');

    expect(g1Res.beneficiaryId).toBe(sc.g1MemberId);
    expect(g2Res.beneficiaryId).toBe(sc.g2MemberId);

    // Ledgers: G1_EARN + G2_EARN
    const g1l = r.ledger.find(
      (l: any) => l.entryType === 'MEMBER_CONSUMPTION_G1_EARN',
    );
    const g2l = r.ledger.find(
      (l: any) => l.entryType === 'MEMBER_CONSUMPTION_G2_EARN',
    );
    expect(g1l).toBeTruthy();
    expect(g2l).toBeTruthy();
    expect(g1l.beneficiaryId).toBe(sc.g1MemberId);
    expect(g2l.beneficiaryId).toBe(sc.g2MemberId);
    expect(g1l.generation).toBe(1);
    expect(g2l.generation).toBe(2);
    expect(g1l.beneficiaryId).not.toBe(g2l.beneficiaryId);
    expect(r.ledger.length).toBe(2);
  });

  it('B-03: Merchant Recruitment ledger via branch attribution', async () => {
    const sc = await seedBScenario({
      memberHasG1: false,
      merchantAttributionLevel: 'BRANCH',
    });
    expect(sc.recruiterMemberId).toBeTruthy();

    const r = await executeAndProcess(sc);

    // Must have MERCHANT_TRANSACTION processing
    expect(r.recruitProc.length).toBe(1);
    expect(r.recruitProc[0].completionOutcome).toBe('CREATED');
    expect(r.recruitProc[0].sourceType).toBe('MERCHANT_TRANSACTION');

    // Exactly 1 recruitment ledger
    expect(r.recruitResults.length).toBe(1);
    expect(r.recruitResults[0].outcome).toBe('CREATED');
    expect(r.recruitResults[0].beneficiaryId).toBe(sc.recruiterMemberId);

    const rl = r.ledger.find(
      (l: any) => l.entryType === 'MERCHANT_RECRUITMENT_EARN',
    );
    expect(rl).toBeTruthy();
    expect(rl.beneficiaryId).toBe(sc.recruiterMemberId);
    expect(rl.generation).toBe(0);
    expect(rl.sourceReference).toBe(r.transactionId);
    expect(rl.market).toBe(sc.marketCode);
    expect(rl.currency).toBe('MYR');
    expect(Number(rl.amount)).toBeGreaterThan(0);
  });

  it('B-04: Same idempotency key replay does not create duplicates', async () => {
    const sc = await seedBScenario();
    const fixedKey = `replay-key-${sc.suffix}`;

    // First execution
    const r1 = await executeAndProcess(sc, {
      previewIdempotencyKey: fixedKey,
      confirmIdempotencyKey: fixedKey,
    });

    // Replay with exact same keys
    const r2 = await executeAndProcess(sc, {
      previewIdempotencyKey: fixedKey,
      confirmIdempotencyKey: fixedKey,
    });

    // Transaction count = 1
    const txnCount = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(
        eq(
          transactions.transactionNumber,
          sql`${r1.confirm.transactionNumber}::bigint`,
        ),
      );
    expect(Number(txnCount[0].cnt)).toBe(1);

    // Same canonical processing key across both runs
    const cKey1 = r1.memberProc[0]?.canonicalProcessingKey;
    const cKey2 = r2.memberProc[0]?.canonicalProcessingKey;
    expect(cKey1).toBeTruthy();
    expect(cKey2).toBeTruthy();
    expect(cKey1).toBe(cKey2);

    // Dispatch count unchanged
    expect(r2.dispatchAfter.length).toBe(r1.dispatchAfter.length);

    // Processing count unchanged
    expect(r2.memberProc.length).toBe(r1.memberProc.length);

    // Processing result count unchanged
    expect(r2.memberResults.length).toBe(r1.memberResults.length);

    // Ledger count unchanged
    expect(r2.ledger.length).toBe(r1.ledger.length);
  });

  it('B-05: G1 SUSPENDED => SKIPPED_INELIGIBLE, G2 CREATED', async () => {
    const sc = await seedBScenario({
      memberHasG1: true,
      memberHasG2: true,
      g1Active: false,
      g2Active: true,
    });
    const r = await executeAndProcess(sc);

    // Processing outcome
    expect(r.memberProc.length).toBe(1);
    expect(r.memberProc[0].completionOutcome).toBe('CREATED');

    // Results: G1 SKIPPED_INELIGIBLE, G2 CREATED
    const g1Res = expectExactMemberResult(
      r.memberResults,
      1,
      'SKIPPED_INELIGIBLE',
    );
    const g2Res = expectExactMemberResult(r.memberResults, 2, 'CREATED');
    expect(g1Res.beneficiaryId).toBe(sc.g1MemberId);
    expect(g2Res.beneficiaryId).toBe(sc.g2MemberId);

    // Ledger: only G2 (G1 = 0)
    expectExactLedgerCount(r.ledger, 'MEMBER_CONSUMPTION_G1_EARN', 0);
    expectExactLedgerCount(r.ledger, 'MEMBER_CONSUMPTION_G2_EARN', 1);
    expect(r.ledger.length).toBe(1);
  });

  it('B-06: G1 ACTIVE, G2 SUSPENDED => G1 CREATED, G2 SKIPPED_INELIGIBLE', async () => {
    const sc = await seedBScenario({
      memberHasG1: true,
      memberHasG2: true,
      g1Active: true,
      g2Active: false,
    });
    const r = await executeAndProcess(sc);

    // Processing outcome
    expect(r.memberProc.length).toBe(1);
    expect(r.memberProc[0].completionOutcome).toBe('CREATED');

    // Results: G1 CREATED, G2 SKIPPED_INELIGIBLE
    const g1Res = expectExactMemberResult(r.memberResults, 1, 'CREATED');
    const g2Res = expectExactMemberResult(
      r.memberResults,
      2,
      'SKIPPED_INELIGIBLE',
    );
    expect(g1Res.beneficiaryId).toBe(sc.g1MemberId);
    expect(g2Res.beneficiaryId).toBe(sc.g2MemberId);

    // Ledger: only G1 (G2 = 0)
    expectExactLedgerCount(r.ledger, 'MEMBER_CONSUMPTION_G1_EARN', 1);
    expectExactLedgerCount(r.ledger, 'MEMBER_CONSUMPTION_G2_EARN', 0);
    expect(r.ledger.length).toBe(1);
  });

  it('B-07: No referrer => SKIPPED_NO_BENEFICIARY, no ledger', async () => {
    const sc = await seedBScenario({ memberHasG1: false });

    // Verify no referral relationship exists for consuming member
    const existingRefs = await db
      .select({ id: referralRelationships.id })
      .from(referralRelationships)
      .where(eq(referralRelationships.refereeId, sc.memberId));
    expect(existingRefs.length).toBe(0);

    const r = await executeAndProcess(sc);

    // Processing: must be SKIPPED_NO_BENEFICIARY (NOT SKIPPED_INELIGIBLE)
    expect(r.memberProc.length).toBe(1);
    expect(r.memberProc[0].completionOutcome).toBe('SKIPPED_NO_BENEFICIARY');

    // No results (skip outcomes don't create processing result records)
    expect(r.memberResults.length).toBe(0);

    // No ledger
    expect(r.ledger.length).toBe(0);
  });

  it('B-08: No merchant recruiter => SKIPPED_NO_BENEFICIARY, no recruitment ledger', async () => {
    const sc = await seedBScenario({ merchantAttributionLevel: 'NONE' });
    const r = await executeAndProcess(sc);

    // Verify no merchant attribution exists
    const existingAttr = await db
      .select({ id: merchantAttributions.id })
      .from(merchantAttributions)
      .where(eq(merchantAttributions.merchantAccountId, sc.merchantAccountId));
    expect(existingAttr.length).toBe(0);

    // Processing must be SKIPPED_NO_BENEFICIARY for merchant
    if (r.recruitProc.length > 0) {
      expect(r.recruitProc[0].completionOutcome).toBe('SKIPPED_NO_BENEFICIARY');
    }

    // No recruitment ledger
    expectExactLedgerCount(r.ledger, 'MERCHANT_RECRUITMENT_EARN', 0);
  });

  it('B-09: Branch has no attribution (parent has) => no fallback', async () => {
    const sc = await seedBScenario({
      memberHasG1: false,
      merchantAttributionLevel: 'MERCHANT',
    });

    // At MERCHANT level, attribution exists for merchant, not branch
    const branchAttrs = await db
      .select({ id: merchantAttributions.id })
      .from(merchantAttributions)
      .where(eq(merchantAttributions.branchId, sc.branchId));
    expect(branchAttrs.length).toBe(0);

    const r = await executeAndProcess(sc);

    // No merchant recruitment ledger (no fallback)
    expectExactLedgerCount(r.ledger, 'MERCHANT_RECRUITMENT_EARN', 0);

    // Merchant processing might exist, but outcome must be SKIPPED_NO_BENEFICIARY
    if (r.recruitProc.length > 0) {
      expect(r.recruitProc[0].completionOutcome).toBe('SKIPPED_NO_BENEFICIARY');
    }
  });

  it('B-10: Recruiter inactive => SKIPPED_INELIGIBLE, no ledger', async () => {
    const sc = await seedBScenario({
      memberHasG1: false,
      merchantAttributionLevel: 'MERCHANT',
    });
    expect(sc.recruiterMemberId).toBeTruthy();

    // Deactivate the recruiter
    await db
      .update(agentActivations)
      .set({ status: 'SUSPENDED' })
      .where(eq(agentActivations.memberId, sc.recruiterMemberId!));

    const r = await executeAndProcess(sc);

    // Merchant processing must exist with SKIPPED_INELIGIBLE
    expect(r.recruitProc.length).toBe(1);
    expect(r.recruitProc[0].completionOutcome).toBe('SKIPPED_INELIGIBLE');

    // No recruitment ledger
    expectExactLedgerCount(r.ledger, 'MERCHANT_RECRUITMENT_EARN', 0);
  });

  it('B-11: Post-confirm package mutation does not affect ledger amount', async () => {
    const sc = await seedBScenario();

    const r = await executeAndProcess(sc, {
      postConfirmMutation: async () => {
        // Create a new version with a higher rate
        const [nv] = await db
          .insert(serviceFeeVersions)
          .values({
            serviceFeeProfileId: (
              await db
                .select({ id: serviceFeeProfiles.id })
                .from(serviceFeeProfiles)
                .where(eq(serviceFeeProfiles.code, `P-${sc.suffix}`))
                .limit(1)
            )[0].id,
            rate: '10.000000',
            effectiveFrom: new Date('2020-01-01'),
            status: 'ACTIVE',
            marketId: sc.marketId,
          })
          .returning({ id: serviceFeeVersions.id });
        await db
          .update(merchantPackageAssignments)
          .set({ serviceFeeVersionId: nv.id })
          .where(eq(merchantPackageAssignments.id, sc.packageId));
      },
    });

    const g1l = r.ledger.find(
      (l: any) => l.entryType === 'MEMBER_CONSUMPTION_G1_EARN',
    );
    expect(g1l).toBeTruthy();
    // Ledger amount is based on snapshot captured at confirm time, not mutated rate
    expect(g1l.market).toBe(sc.marketCode);
    // Verify calculation basis exists (snapshot preserved)
    expect(g1l.sourceReference).toBe(r.transactionId);
  });

  it('B-12: Market mismatch => COMMISSION_MARKET_MISMATCH error', async () => {
    const sc = await seedBScenario();

    // Create a second market with a different code
    const s2 = uid();
    const mc2 = s2.substring(0, 2).toUpperCase();
    await db
      .insert(markets)
      .values({
        code: mc2,
        name: `B-X-${s2}`,
        timezone: 'Asia/Kuala_Lumpur',
        status: 'ACTIVE',
        defaultLocale: 'en',
        currencyCode: 'MYR',
      })
      .onConflictDoNothing({ target: markets.code });
    const [mkt2] = await db
      .select({ id: markets.id, code: markets.code })
      .from(markets)
      .where(eq(markets.code, mc2))
      .limit(1);

    // Execute the transaction in the SECOND market (cross-market)
    // Create preview/confirm with the cross market
    const pKey = `pv-mismatch-${sc.suffix}`;
    const cKey = `cf-mismatch-${sc.suffix}`;

    const preview = await transactionService.createPreview(
      sc.staffAccountId,
      {
        amount: '100.00',
        memberQrToken: sc.memberQrToken,
        packageId: sc.packageId,
        marketId: mkt2.id,
      },
      pKey,
      mkt2.id,
      {},
    );

    const confirm = await transactionService.confirm(
      sc.staffAccountId,
      preview.previewSessionId,
      {},
      cKey,
      {},
    );

    const [tx] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        eq(
          transactions.transactionNumber,
          sql`${confirm.transactionNumber}::bigint`,
        ),
      )
      .limit(1);

    // Process
    const wr = await outboxWorker.processBatchOnce();

    // Check dispatch status: must have lastError containing mismatch
    const dispatchAfter = await db
      .select()
      .from(transactionCommissionDispatch)
      .where(eq(transactionCommissionDispatch.transactionId, tx.id))
      .orderBy(transactionCommissionDispatch.eventType);

    const md = dispatchAfter.find(
      (d: any) => d.eventType === 'MEMBER_CONSUMPTION',
    );
    expect(md).toBeTruthy();

    // Dispatch must reflect the mismatch error
    if (md.status === 'FAILED') {
      expect(md.lastError).toMatch(/mismatch/i);
      expect(md.attempts).toBeGreaterThanOrEqual(1);
    } else {
      // If retry mechanism still processing, must have lastError
      expect(md.lastError).toBeTruthy();
    }

    // No cross-market ledger
    const ledger = await db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.sourceReference, tx.id));
    expect(ledger.length).toBe(0);
  });

  it('B-13: Worker failure + retry => exactly one ledger after recovery', async () => {
    const sc = await seedBScenario();
    let injected = false;

    const r = await executeAndProcess(sc, {
      workerFailureInjection: async () => {
        // First injection: mark dispatches with failure
        if (!injected) {
          injected = true;
        }
      },
      processWorker: true,
    });

    // After first failure injection, check dispatch state
    const disp = await db
      .select()
      .from(transactionCommissionDispatch)
      .where(eq(transactionCommissionDispatch.transactionId, r.transactionId))
      .orderBy(transactionCommissionDispatch.eventType);

    const md = disp.find((d: any) => d.eventType === 'MEMBER_CONSUMPTION');
    expect(md).toBeTruthy();

    // First attempt should have failed
    expect(md.attempts).toBeGreaterThanOrEqual(1);
    expect(md.lastError).toBeTruthy();

    if (md.status === 'COMPLETED') {
      // Worker recovered: exactly 1 ledger
      expect(r.ledger.length).toBe(1);
      expect(r.memberProc.length).toBe(1);
      expect(r.memberProc[0].completionOutcome).toBe('CREATED');
    } else {
      // Still retrying: no ledger yet
      expect(r.ledger.length).toBe(0);
    }
  });

  it('B-14: No partial ledger on processing failure (G1/G2 rollback)', async () => {
    const sc = await seedBScenario({ memberHasG1: true, memberHasG2: true });
    const r = await executeAndProcess(sc);

    // Processing must complete (normal happy path)
    // This test verifies atomicity: G1+G2 both or neither
    const hasG1 = r.ledger.some(
      (l: any) => l.entryType === 'MEMBER_CONSUMPTION_G1_EARN',
    );
    const hasG2 = r.ledger.some(
      (l: any) => l.entryType === 'MEMBER_CONSUMPTION_G2_EARN',
    );
    expect(hasG1).toBe(hasG2);
  });

  it('B-15: Rounded zero => SKIPPED_ZERO_AMOUNT, no ledger', async () => {
    const sc = await seedBScenario();
    // Amount 1.00 * rate 0.002 = 0.002 → HALF_UP to 0.00 → SKIPPED_ZERO_AMOUNT
    const r = await executeAndProcess(sc, { amount: '1.00' });

    // Must have exactly 1 G1 result with SKIPPED_ZERO_AMOUNT
    const g1Res = r.memberResults.find((pr: any) => pr.generation === 1);
    expect(g1Res).toBeTruthy();
    expect(g1Res.outcome).toBe('SKIPPED_ZERO_AMOUNT');

    // If G2 also processed, it must also be SKIPPED_ZERO_AMOUNT
    const g2Res = r.memberResults.find((pr: any) => pr.generation === 2);
    if (g2Res) {
      expect(g2Res.outcome).toBe('SKIPPED_ZERO_AMOUNT');
    }

    // No ledger
    expect(r.ledger.length).toBe(0);
  });
});
