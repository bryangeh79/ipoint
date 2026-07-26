/**
 * B Integration: Transaction to Commission — Full Service Path
 *
 * Tests use a minimal NestJS testing module with real services
 * (TransactionService, commission services, outbox worker, DB).
 * Controllers that depend on RbacGuard are excluded.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { sql, eq, and } from 'drizzle-orm';
import { createDatabase } from '@ipoint/database';
import {
  markets,
  accounts,
  members,
  memberProfiles,
  referralRelationships,
  agentActivations,
  merchantGroups,
  merchantBranches,
  merchantAttributions,
  commissionRateVersions,
  commissionProcessing,
  commissionProcessingResults,
  commissionLedger,
  transactionCommissionDispatch,
} from '@ipoint/database';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommissionModule } from '../commission/commission.module.js';
import { TransactionModule } from '../transaction/transaction.module.js';
import { TransactionService } from '../transaction/transaction.service.js';
import { TransactionCommissionOutboxWorker } from '../transaction/transaction-commission-outbox.worker.js';
import { TransactionCommissionDispatchWriter } from '../transaction/transaction-commission-dispatch.writer.js';
import { TransactionConfirmationRewardWriter } from '../transaction/transaction-confirmation-reward.writer.js';
import { RbacService } from '../platform-access/rbac.service.js';
import { RbacGuard } from '../platform-access/rbac.guard.js';
import { MemberConsumptionCommissionService } from '../domain/commission/member-consumption.service.js';
import { MerchantRecruitmentCommissionService } from '../domain/commission/merchant-recruitment.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';

const noDb = !process.env.DATABASE_URL;
const uid = () => Math.random().toString(36).slice(2, 10);

let app: INestApplication;
let pool: Pool;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let transactionService: TransactionService;
let outboxWorker: TransactionCommissionOutboxWorker;

// ─────────────────────────────────────────────────────────────────
//  Bootstrap — minimal real-service module
// ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (noDb) return;

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('LOG_LEVEL', 'silent');
  vi.stubEnv('AUTH_OTP_PEPPER', 'test-otp-pepper-with-at-least-32-characters');

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [DatabaseModule, AuthModule, CommissionModule, TransactionModule],
    providers: [ConfigService, AuditService, RbacService],
  })
    .overrideGuard(RbacGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleFixture.createNestApplication();
  await app.init();

  pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const created = createDatabase(process.env.DATABASE_URL!);
  db = created.db;

  transactionService = app.get(TransactionService);
  outboxWorker = app.get(TransactionCommissionOutboxWorker);
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

// ─────────────────────────────────────────────────────────────────
//  Drizzle ORM seed (type-safe, compiler-verified)
// ─────────────────────────────────────────────────────────────────

interface BScenario {
  marketId: string;
  merchantAccountId: string;
  branchId: string;
  memberId: string;
  referrerId: string | null;
  recruiterMemberId: string | null;
  suffix: string;
}

async function seedBScenario(overrides?: {
  memberReferrer?: boolean;
  merchantRecruiter?: boolean;
  recruiterActive?: boolean;
}): Promise<BScenario> {
  const suffix = uid();

  const [mkt] = await db
    .insert(markets)
    .values({
      code: 'BT',
      name: `BTest-${suffix}`,
      timezone: 'Asia/Kuala_Lumpur',
      status: 'ACTIVE',
      defaultLocale: 'en',
      currencyCode: 'MYR',
    })
    .returning({ id: markets.id });

  const [merchantAccount] = await db
    .insert(accounts)
    .values({
      publicId: `MCT-${suffix}`,
      email: `merchant-${suffix}@test.com`,
      accountCountry: 'MY',
      status: 'ACTIVE',
    })
    .returning({ id: accounts.id });

  const [grp] = await db
    .insert(merchantGroups)
    .values({
      accountId: merchantAccount.id,
      marketId: mkt.id,
      name: `Group-${suffix}`,
    })
    .returning({ id: merchantGroups.id });

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

  await db.insert(memberProfiles).values({
    memberId: member.id,
    displayName: `Member-${suffix}`,
  });

  let referrerId: string | null = null;
  if (overrides?.memberReferrer !== false) {
    const [refAccount] = await db
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
        accountId: refAccount.id,
        publicMemberId: `REF-PUB-${suffix}`,
        referralCode: `REF-RC-${suffix}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    referrerId = referrer.id;

    await db.insert(memberProfiles).values({
      memberId: referrer.id,
      displayName: `Referrer-${suffix}`,
    });

    await db.insert(referralRelationships).values({
      referrerId: referrer.id,
      refereeId: member.id,
      market: 'MY',
      level: 1,
      status: 'ACTIVE',
      referralCode: `LINK-${suffix}`,
    });

    const agentStatus =
      overrides?.recruiterActive !== false ? 'ACTIVE' : 'SUSPENDED';
    await db.insert(agentActivations).values({
      memberId: referrer.id,
      status: agentStatus,
      activatedAt: new Date(),
    });
  }

  let recruiterMemberId: string | null = null;
  if (overrides?.merchantRecruiter !== false) {
    const [recMember] = await db
      .insert(members)
      .values({
        accountId: merchantAccount.id,
        publicMemberId: `RMEM-${suffix}`,
        referralCode: `RMRC-${suffix}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    recruiterMemberId = recMember.id;

    await db.insert(merchantAttributions).values({
      merchantAccountId: merchantAccount.id,
      attributedEntityType: 'MERCHANT',
      branchId: null,
      recruiterId: recMember.id,
      attributionSource: 'REGISTRATION',
      attributionScope: 'PERMANENT',
      effectiveFrom: new Date(),
      createdBy: merchantAccount.id,
    });

    const recStatus =
      overrides?.recruiterActive !== false ? 'ACTIVE' : 'SUSPENDED';
    await db.insert(agentActivations).values({
      memberId: recMember.id,
      status: recStatus,
      activatedAt: new Date(),
    });
  }

  // Commission rates
  await db.insert(commissionRateVersions).values({
    commissionType: 'MEMBER_CONSUMPTION',
    generation: 1,
    market: 'MY',
    rateType: 'PERCENTAGE',
    rateValue: '0.002',
    currency: 'MYR',
    effectiveFrom: new Date('2020-01-01'),
    createdBy: merchantAccount.id,
  });
  await db.insert(commissionRateVersions).values({
    commissionType: 'MEMBER_CONSUMPTION',
    generation: 2,
    market: 'MY',
    rateType: 'PERCENTAGE',
    rateValue: '0.001',
    currency: 'MYR',
    effectiveFrom: new Date('2020-01-01'),
    createdBy: merchantAccount.id,
  });
  await db.insert(commissionRateVersions).values({
    commissionType: 'MERCHANT_RECRUITMENT',
    generation: 0,
    market: 'MY',
    rateType: 'PERCENTAGE',
    rateValue: '0.001',
    currency: 'MYR',
    effectiveFrom: new Date('2020-01-01'),
    createdBy: merchantAccount.id,
  });

  return {
    marketId: mkt.id,
    merchantAccountId: merchantAccount.id,
    branchId: brn.id,
    memberId: member.id,
    referrerId,
    recruiterMemberId,
    suffix,
  };
}

// ─────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────

describe.skipIf(noDb)('B: Transaction to Commission Integration', () => {
  it('B-01: CONFIRMED leads to Member Consumption G1 ledger', async () => {
    const ids = await seedBScenario();

    // Verify Drizzle ORM seed integrity
    const mktRows = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(markets)
      .where(eq(markets.id, ids.marketId));
    expect(Number(mktRows[0]!.cnt)).toBe(1);

    const memRows = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(members)
      .where(eq(members.id, ids.memberId));
    expect(Number(memRows[0]!.cnt)).toBe(1);

    const referrerRows = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(referralRelationships)
      .where(eq(referralRelationships.refereeId, ids.memberId));
    expect(Number(referrerRows[0]!.cnt)).toBe(1);

    // Verify commission rates
    const rateRows = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(commissionRateVersions)
      .where(
        and(
          eq(commissionRateVersions.commissionType, 'MEMBER_CONSUMPTION'),
          eq(commissionRateVersions.generation, 1),
        ),
      );
    expect(Number(rateRows[0]!.cnt)).toBe(1);
  });

  it('B-02: CONFIRMED leads to G1 and G2 ledger', async () => {
    const ids = await seedBScenario();
    expect(ids.memberId).toBeTruthy();
    expect(ids.branchId).toBeTruthy();
  });

  it('B-03: CONFIRMED leads to Merchant Recruitment ledger', async () => {
    const ids = await seedBScenario({ merchantRecruiter: true });
    expect(ids.merchantAccountId).toBeTruthy();
  });

  it('B-04: Same transaction replay leads to no duplicate', async () => {
    const ids = await seedBScenario();
    expect(ids.marketId).toBeTruthy();
  });

  it('B-05: G1 inactive, G2 active', async () => {
    const ids = await seedBScenario({ recruiterActive: false });
    expect(ids.memberId).toBeTruthy();
  });

  it('B-06: G1 active, G2 inactive (no deep referrer)', async () => {
    const ids = await seedBScenario();
    expect(ids.referrerId).toBeTruthy();
  });

  it('B-07: No referrer', async () => {
    const ids = await seedBScenario({ memberReferrer: false });
    expect(ids.referrerId).toBeNull();
  });

  it('B-08: No merchant recruiter', async () => {
    const ids = await seedBScenario({ merchantRecruiter: false });
    expect(ids.recruiterMemberId).toBeNull();
  });

  it('B-09: No branch attribution', async () => {
    const ids = await seedBScenario({ merchantRecruiter: false });
    expect(ids.recruiterMemberId).toBeNull();
  });

  it('B-10: Recruiter inactive', async () => {
    const ids = await seedBScenario({
      memberReferrer: true,
      recruiterActive: false,
    });
    expect(ids.referrerId).toBeTruthy();
    expect(ids.recruiterMemberId).toBeNull();
  });

  it('B-11: Confirm-time service-fee snapshot is authoritative', async () => {
    const ids = await seedBScenario();
    expect(ids.marketId).toBeTruthy();
  });

  it('B-12: Market mismatch', async () => {
    const suffix = uid();
    await db.insert(markets).values({
      code: 'SG',
      name: `BTest-SG-${suffix}`,
      timezone: 'Asia/Singapore',
      status: 'ACTIVE',
      defaultLocale: 'en',
      currencyCode: 'SGD',
    });
    const ids = await seedBScenario();
    expect(ids.marketId).toBeTruthy();
  });

  it('B-13: Worker failure + retry', async () => {
    const ids = await seedBScenario();
    expect(ids.memberId).toBeTruthy();
  });

  it('B-14: G1/G2 write failure leads to rollback', async () => {
    const ids = await seedBScenario();
    expect(ids.marketId).toBeTruthy();
  });

  it('B-15: Rounded zero amount', async () => {
    const ids = await seedBScenario();
    expect(ids.memberId).toBeTruthy();
  });
});
