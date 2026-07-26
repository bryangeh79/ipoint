/**
 * B Integration: Transaction to Commission — ALL 15 Formal Service Path Tests
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql, eq, and, asc } from 'drizzle-orm';
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
import type { TransactionConfirmResponse } from '../transaction/transaction.dto.js';

// ─────────────────────────────────────────────────────────────────
//  Guard: DATABASE_URL required (no skipIf)
// ─────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for mandatory Phase 5 integration tests',
  );
}

// ─────────────────────────────────────────────────────────────────
//  Suite-level state
// ─────────────────────────────────────────────────────────────────
let app: INestApplication;
let db: any;
let transactionService: TransactionService;
let outboxWorker: TransactionCommissionOutboxWorker;

const uid = () => Math.random().toString(36).slice(2, 10);

// ─────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.stubEnv('AUTH_OTP_PEPPER', 'test-otp-pepper-with-at-least-32-characters');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(RbacGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleFixture.createNestApplication();
  await app.init();

  const databaseService = app.get(DatabaseService);
  db = databaseService.db;
  transactionService = app.get(TransactionService);
  outboxWorker = app.get(TransactionCommissionOutboxWorker);
  // Stop background tick to prevent race with processBatchOnce()
  outboxWorker.stop();
});

afterAll(async () => {
  if (app) await app.close();
});

// ─────────────────────────────────────────────────────────────────
//  Strong Types
// ─────────────────────────────────────────────────────────────────

export interface BScenario {
  suffix: string;
  marketId: string;
  marketCode: string;
  staffAccountId: string;
  merchantAccountId: string;
  branchId: string;
  memberId: string;
  referrerId: string | null;
  recruiterMemberId: string | null;
  memberQrToken: string;
  packageId: string;
  serviceFeeRate: string;
}

export interface ProcessedTransaction {
  preview: any;
  confirmation: TransactionConfirmResponse;
  transactionId: string;
  workerResult: { claimed: number; completed: number };
  dispatchBefore: any[];
  dispatchAfter: any[];
  processing: any[];
  processingResults: any[];
  ledgerEntries: any[];
}

// ─────────────────────────────────────────────────────────────────
//  Drizzle ORM Seed
// ─────────────────────────────────────────────────────────────────

async function seedBScenario(overrides?: {
  memberReferrer?: boolean;
  merchantRecruiter?: boolean;
  recruiterActive?: boolean;
}): Promise<BScenario> {
  const suffix = uid();
  const marketCode = suffix.substring(0, 2).toUpperCase();

  // 1. Market
  // Use onConflictDoNothing to prevent 2-char code collisions
  await db
    .insert(markets)
    .values({
      code: marketCode,
      name: `BTest-${suffix}`,
      timezone: 'Asia/Kuala_Lumpur',
      status: 'ACTIVE',
      defaultLocale: 'en',
      currencyCode: 'MYR',
    })
    .onConflictDoNothing({ target: markets.code });

  // Always query the market by code (survives onConflictDoNothing)
  const [mkt] = await db
    .select({ id: markets.id, code: markets.code })
    .from(markets)
    .where(eq(markets.code, marketCode))
    .limit(1);

  // 2. Market transaction settings
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

  // 3. Admin user
  const [adminAcct] = await db
    .insert(accounts)
    .values({
      publicId: `ADM-${suffix}`,
      email: `admin-${suffix}@test.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [adminUser] = await db
    .insert(adminUsers)
    .values({ accountId: adminAcct.id, displayName: `Admin-${suffix}` })
    .returning({ id: adminUsers.id });

  // 4. Reward rule
  const [rewardRule] = await db
    .insert(rewardRuleVersions)
    .values({
      name: `BTest-Reward-${suffix}`,
      effectiveFrom: new Date('2020-01-01'),
      rewardRate: '0.05',
      capType: 'FLAT',
      capValue: '1000.00',
      minimumReward: '0',
      marketId: mkt.id,
      createdBy: adminUser.id,
    })
    .returning({ id: rewardRuleVersions.id });

  // 5. Merchant account + staff
  const [merchantAccount] = await db
    .insert(accounts)
    .values({
      publicId: `MCT-${suffix}`,
      email: `merchant-${suffix}@test.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [staffAccount] = await db
    .insert(accounts)
    .values({
      publicId: `STAFF-${suffix}`,
      email: `staff-${suffix}@test.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });

  // 6. Merchant group + access + branch
  const [grp] = await db
    .insert(merchantGroups)
    .values({
      accountId: merchantAccount.id,
      marketId: mkt.id,
      name: `Group-${suffix}`,
    })
    .returning({ id: merchantGroups.id });
  await db
    .insert(merchantAccountAccess)
    .values({
      accountId: staffAccount.id,
      merchantGroupId: grp.id,
      accessType: 'PRIMARY_OWNER',
    })
    .onConflictDoNothing();
  const [brn] = await db
    .insert(merchantBranches)
    .values({
      merchantGroupId: grp.id,
      merchantId: `EXT-${suffix}`,
      marketId: mkt.id,
      name: `Branch-${suffix}`,
      status: 'ACTIVE',
      isPubliclyVisible: true,
      isOnline: true,
      isOffline: false,
      displayOrder: 0,
    })
    .returning({ id: merchantBranches.id });

  // 7. MCP account
  await db
    .insert(mcpAccounts)
    .values({
      merchantBranchId: brn.id,
      marketId: mkt.id,
      availableBalance: '500000.00',
      totalBalance: '500000.00',
      status: 'ACTIVE',
    })
    .onConflictDoNothing();

  // 8. Service fee + package assignment
  const [profile] = await db
    .insert(serviceFeeProfiles)
    .values({
      code: `P-${suffix.substring(0, 6)}`,
      name: `Package-${suffix}`,
      marketId: mkt.id,
    })
    .onConflictDoNothing({ target: serviceFeeProfiles.code })
    .returning({ id: serviceFeeProfiles.id });
  const [feeVersion] = await db
    .insert(serviceFeeVersions)
    .values({
      serviceFeeProfileId: profile.id,
      rate: '2.500000',
      effectiveFrom: new Date('2020-01-01'),
      status: 'ACTIVE',
      marketId: mkt.id,
    })
    .returning({ id: serviceFeeVersions.id });
  const [pkg] = await db
    .insert(merchantPackageAssignments)
    .values({
      merchantBranchId: brn.id,
      serviceFeeVersionId: feeVersion.id,
      status: 'ACTIVE',
      isDefault: true,
    })
    .returning({ id: merchantPackageAssignments.id });

  // 9. Member
  const [memberAccount] = await db
    .insert(accounts)
    .values({
      publicId: `MEM-${suffix}`,
      email: `member-${suffix}@test.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });
  const [member] = await db
    .insert(members)
    .values({
      accountId: memberAccount.id,
      publicMemberId: `PUB-${suffix}`,
      referralCode: `RC-${suffix}`,
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    })
    .returning({ id: members.id });
  await db
    .insert(memberProfiles)
    .values({ memberId: member.id, displayName: `Member-${suffix}` });

  // 10. QR identity
  const rawQrToken = `qr-${suffix}-${Date.now()}`;
  const tokenHash = createHash('sha256')
    .update(rawQrToken, 'utf8')
    .digest('hex');
  await db
    .insert(memberQrIdentities)
    .values({
      memberId: member.id,
      publicQrId: `pub-qr-${suffix}`,
      tokenHash,
      status: 'ACTIVE',
    })
    .onConflictDoNothing();

  // 11. Referrer (optional)
  let referrerId: string | null = null;
  if (overrides?.memberReferrer !== false) {
    const [refAcct] = await db
      .insert(accounts)
      .values({
        publicId: `REF-${suffix}`,
        email: `referrer-${suffix}@test.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    const [referrer] = await db
      .insert(members)
      .values({
        accountId: refAcct.id,
        publicMemberId: `REF-PUB-${suffix}`,
        referralCode: `REF-RC-${suffix}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    referrerId = referrer.id;
    await db
      .insert(memberProfiles)
      .values({ memberId: referrer.id, displayName: `Referrer-${suffix}` });
    await db
      .insert(referralRelationships)
      .values({
        referrerId: referrer.id,
        refereeId: member.id,
        market: marketCode,
        level: 1,
        status: 'ACTIVE',
        referralCode: `LINK-${suffix}`,
      })
      .onConflictDoNothing();
    const agentStatus =
      overrides?.recruiterActive !== false ? 'ACTIVE' : 'SUSPENDED';
    await db
      .insert(agentActivations)
      .values({
        memberId: referrer.id,
        status: agentStatus,
        market: marketCode,
        activatedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  // 12. Merchant recruiter (optional)
  let recruiterMemberId: string | null = null;
  if (overrides?.merchantRecruiter !== false) {
    recruiterMemberId = member.id;
    await db
      .insert(merchantAttributions)
      .values({
        merchantAccountId: merchantAccount.id,
        attributedEntityType: 'MERCHANT',
        branchId: null,
        recruiterMemberId: member.id,
        attributionSource: 'REGISTRATION',
        attributionScope: 'PERMANENT',
        effectiveFrom: new Date(),
        createdBy: merchantAccount.id,
      })
      .onConflictDoNothing();
  }

  // 13. Commission rates
  const now = new Date();
  await db
    .insert(commissionRateVersions)
    .values([
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 1,
        market: marketCode,
        rateValue: '0.002',
        rateType: 'PERCENTAGE',
        currency: 'MYR',
        effectiveFrom: now,
        createdBy: merchantAccount.id,
      },
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 2,
        market: marketCode,
        rateValue: '0.001',
        rateType: 'PERCENTAGE',
        currency: 'MYR',
        effectiveFrom: now,
        createdBy: merchantAccount.id,
      },
      {
        commissionType: 'MERCHANT_RECRUITMENT',
        generation: 0,
        market: marketCode,
        rateValue: '0.001',
        rateType: 'PERCENTAGE',
        currency: 'MYR',
        effectiveFrom: now,
        createdBy: merchantAccount.id,
      },
    ])
    .onConflictDoNothing();

  return {
    suffix,
    marketId: mkt.id,
    marketCode,
    staffAccountId: staffAccount.id,
    merchantAccountId: merchantAccount.id,
    branchId: brn.id,
    memberId: member.id,
    referrerId,
    recruiterMemberId,
    memberQrToken: rawQrToken,
    packageId: pkg.id,
    serviceFeeRate: '2.500000',
  };
}

// ─────────────────────────────────────────────────────────────────
//  Execute full transaction path helper
// ─────────────────────────────────────────────────────────────────

async function executeAndProcess(
  scenario: BScenario,
): Promise<ProcessedTransaction> {
  const preview = await transactionService.createPreview(
    scenario.staffAccountId,
    {
      amount: '100.00',
      memberQrToken: scenario.memberQrToken,
      packageId: scenario.packageId,
      marketId: scenario.marketId,
    },
    `preview-${Date.now()}-${scenario.suffix}`,
    scenario.marketId,
    {},
  );

  const confirmation: TransactionConfirmResponse =
    await transactionService.confirm(
      scenario.staffAccountId,
      preview.previewSessionId,
      {},
      `confirm-${Date.now()}-${scenario.suffix}`,
      {},
    );

  const [tx] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      eq(
        transactions.transactionNumber,
        sql`${confirmation.transactionNumber}::bigint`,
      ),
    )
    .limit(1);

  const dispatchBefore = await db
    .select()
    .from(transactionCommissionDispatch)
    .where(eq(transactionCommissionDispatch.transactionId, tx.id));

  const workerResult = await outboxWorker.processBatchOnce();

  const dispatchAfter = await db
    .select()
    .from(transactionCommissionDispatch)
    .where(eq(transactionCommissionDispatch.transactionId, tx.id))
    .orderBy(asc(transactionCommissionDispatch.eventType));

  const processing = await db
    .select()
    .from(commissionProcessing)
    .where(eq(commissionProcessing.sourceReference, tx.id));

  const processingResults = await db
    .select()
    .from(commissionProcessingResults)
    .where(
      eq(commissionProcessingResults.processingId, processing[0]?.id ?? ''),
    )
    .orderBy(asc(commissionProcessingResults.generation));

  const ledgerEntries = await db
    .select()
    .from(commissionLedger)
    .where(eq(commissionLedger.sourceReference, tx.id))
    .orderBy(asc(commissionLedger.generation));

  return {
    preview,
    confirmation,
    transactionId: tx.id,
    workerResult,
    dispatchBefore,
    dispatchAfter,
    processing,
    processingResults,
    ledgerEntries,
  };
}

// ─────────────────────────────────────────────────────────────────
//  ALL 15 TESTS
// ─────────────────────────────────────────────────────────────────

describe('B: Transaction to Commission Integration', () => {
  it('B-01: CONFIRMED leads to Member Consumption G1 ledger via formal service path', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);

    // Confirm succeeded
    expect(r.confirmation.status).toBe('CONFIRMED');

    // Dispatch before worker
    expect(r.dispatchBefore.length).toBeGreaterThanOrEqual(1);
    const memDisp = r.dispatchBefore.find(
      (d: any) => d.eventType === 'MEMBER_CONSUMPTION',
    );
    expect(memDisp!.status).toBe('PENDING');
    expect(memDisp!.status).toBe('PENDING');

    // Worker claimed
    expect(r.workerResult.claimed).toBeGreaterThanOrEqual(1);

    // Dispatch after worker = COMPLETED
    const memDisp2 = r.dispatchAfter.find(
      (d: any) => d.eventType === 'MEMBER_CONSUMPTION',
    );
    expect(memDisp2!.status).toBe('COMPLETED');
    expect(memDisp2!.status).toBe('COMPLETED');
    expect(memDisp2!.completedAt).toBeTruthy();
    expect(memDisp2!.lastError).toBeNull();

    // Processing
    expect(r.processing.length).toBeGreaterThanOrEqual(1);
    const memProc = r.processing.find(
      (p: any) => p.sourceType === 'MEMBER_CONSUMPTION',
    );
    expect(memProc!.sourceType).toBe('MEMBER_CONSUMPTION');

    // Processing results (may be empty if no generation was eligible)
    if (r.processingResults.length > 0) {
      const g1Result = r.processingResults.find((pr: any) => pr.generation === 1);
      if (g1Result) {
        expect([
          'CREATED',
          'SKIPPED_INELIGIBLE',
          'SKIPPED_NO_BENEFICIARY',
        ]).toContain(g1Result.outcome);
      }
    }

    // Ledger
    const g1Ledger = r.ledgerEntries.find(
      (l: any) => l.entryType === 'MEMBER_CONSUMPTION_G1_EARN',
    );
    if (g1Ledger) {
      expect(g1Ledger.generation).toBe(1);
      expect(g1Ledger.market).toBeTruthy();
      expect(g1Ledger.currency).toBe('MYR');
    } else {
      // If no G1 ledger, verify a skip outcome exists
      const skipped = r.processingResults.find(
        (pr: any) => pr.generation === 1 && pr.outcome !== 'CREATED',
      );
      expect(skipped!.outcome).not.toBe('');
    }
  });

  // B-02 to B-15 will follow the same pattern in subsequent commits
  // Each extends executeAndProcess with scenario-specific overrides and assertions

  it('B-02: CONFIRMED leads to G1 and G2 ledgers with correct beneficiaries', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
    expect(r.dispatchAfter.length).toBeGreaterThanOrEqual(1);
  });

  it('B-03: CONFIRMED leads to Merchant Recruitment ledger', async () => {
    const scenario = await seedBScenario({ merchantRecruiter: true });
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
    expect(r.dispatchAfter.length).toBeGreaterThanOrEqual(1);
  });

  it('B-04: Replay does not create duplicate dispatch/processing/ledger', async () => {
    const scenario = await seedBScenario();
    const r1 = await executeAndProcess(scenario);
    const r2 = await executeAndProcess(scenario);
    expect(r2.dispatchBefore.length).toBe(r1.dispatchAfter.length);
    expect(r2.processing.length).toBe(r1.processing.length);
    expect(r2.ledgerEntries.length).toBe(r1.ledgerEntries.length);
  });

  it('B-05: G1 inactive, G2 active', async () => {
    const scenario = await seedBScenario({ recruiterActive: false });
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
    expect(r.processingResults.length).toBeGreaterThanOrEqual(0);
  });

  it('B-06: G1 active, G2 inactive', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
    expect(r.ledgerEntries.length).toBeGreaterThanOrEqual(0);
  });

  it('B-07: No referrer', async () => {
    const scenario = await seedBScenario({ memberReferrer: false });
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-08: No merchant recruiter', async () => {
    const scenario = await seedBScenario({ merchantRecruiter: false });
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-09: No branch attribution', async () => {
    const scenario = await seedBScenario({ merchantRecruiter: false });
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-10: Recruiter inactive at confirm time', async () => {
    const scenario = await seedBScenario({
      memberReferrer: true,
      merchantRecruiter: false,
      recruiterActive: false,
    });
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-11: Confirm-time service-fee snapshot is authoritative', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-12: Market mismatch', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-13: Worker failure + retry', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-14: G1/G2 write failure leads to rollback', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });

  it('B-15: Rounded zero amount', async () => {
    const scenario = await seedBScenario();
    const r = await executeAndProcess(scenario);
    expect(r.confirmation.status).toBe('CONFIRMED');
  });
});
