/**
 * C: Merchant Attribution Integration Tests
 *
 * Strict contract tests verifying merchant/branch registration creates
 * permanent merchant_attribution records through the production onboarding
 * path, and that frozen B transaction pipeline correctly consumes them.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  agentActivations,
  commissionLedger,
  commissionProcessing,
  commissionProcessingResults,
  commissionRateVersions,
  markets,
  members,
  memberProfiles,
  merchantAttributions,
  merchantBranches,
  merchantPackageAssignments,
  mcpAccounts,
  migrate,
  serviceFeeProfiles,
  serviceFeeVersions,
  transactions,
  transactionServiceFees,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { MarketService } from '../platform-access/market.service.js';
import { AccessAdministrationService } from '../platform-access/access-administration.service.js';
import { RbacGuard } from '../platform-access/rbac.guard.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { TransactionService } from '../transaction/transaction.service.js';
import { TransactionCommissionOutboxWorker } from '../transaction/transaction-commission-outbox.worker.js';

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL is required for mandatory C integration tests');
}

describe('C: Merchant Attribution Integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let auth: AuthService;
  let merchants: MerchantService;
  let txService: TransactionService;
  let outboxWorker: TransactionCommissionOutboxWorker;
  let marketId: string;
  let marketCode: string;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', process.env['DATABASE_URL'] ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('AUTH_OTP_PEPPER', 'c-attribution-strict-otp-pepper-32ch');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app, {
      enableShutdownHooks: false,
      scanSwaggerRoutes: false,
    });
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    auth = app.get(AuthService);
    merchants = app.get(MerchantService);
    txService = app.get(TransactionService);
    outboxWorker = app.get(TransactionCommissionOutboxWorker);
    outboxWorker.stop();
    await migrate(database.pool);
    await seedFoundation(database.db);

    const marketService = app.get(MarketService);
    const code = await nextTestMarketCode();
    const market = await marketService.create(
      {
        code,
        name: 'C Attribution Test Market',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      },
      { adminUserId: randomUUID(), reason: 'C integration test' },
    );
    marketId = market.id;
    marketCode = code;
    await marketService.setStatus(marketId, 'ACTIVE', {
      adminUserId: randomUUID(),
      reason: 'C integration test',
    });

    // Minimal admin for market ops
    const adminSuffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const [adminAcct] = await database.db
      .insert(accounts)
      .values({
        publicId: `CA-${adminSuffix}`,
        email: `c-admin-${adminSuffix}@test.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: accounts.id });
    const [auRow] = await database.db
      .insert(adminUsers)
      .values({
        accountId: adminAcct!.id,
        displayName: 'C Test Admin',
        status: 'ACTIVE',
      })
      .returning({ id: adminUsers.id });
    const administration = app.get(AccessAdministrationService);
    const { id: roleId } = await database.db
      .select({ id: sql<string>`id` })
      .from(sql`roles`)
      .where(sql`code = 'SUPER_ADMIN'`)
      .limit(1)
      .then((r) => r[0]!);
    await administration.assignRole(auRow!.id, roleId, {
      adminUserId: auRow!.id,
      reason: 'C test setup',
    });
    await administration.grantMarketAccess(auRow!.id, marketId, {
      adminUserId: auRow!.id,
      reason: 'C test setup',
    });

    // Seed market transaction settings for the test market
    await database.db.execute(
      sql`INSERT INTO market_transaction_settings (market_id, currency_code, currency_scale, minimum_transaction_amount, maximum_transaction_amount)
          VALUES (${marketId}::uuid, 'MYR', 2, '1.00', '999999.99')
          ON CONFLICT DO NOTHING`,
    );

    // Seed reward rule version for the test market (needed for transaction preview)
    await database.db.execute(
      sql`INSERT INTO reward_rule_versions (market_id, name, reward_rate, cap_type, cap_value, minimum_reward, effective_from, created_by)
          VALUES (${marketId}::uuid, 'C test reward', '0.000500', 'FLAT', '999999.99', '0', now() - interval '1 day', ${auRow!.id}::uuid)
          ON CONFLICT DO NOTHING`,
    );

    // Seed commission rate version for MERCHANT_RECRUITMENT
    await database.db.execute(
      sql`INSERT INTO commission_rate_version (commission_type, generation, market, rate_type, rate_value, effective_from, created_by)
          VALUES ('MERCHANT_RECRUITMENT', 0, ${marketCode}, 'PERCENTAGE', '0.500000', now() - interval '1 day', ${auRow!.id}::uuid)
          ON CONFLICT DO NOTHING`,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

  async function nextTestMarketCode(): Promise<string> {
    const existing = await database.db
      .select({ code: markets.code })
      .from(markets);
    const used = new Set(existing.map((row) => row.code));
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (const second of letters) {
      const code = `C${second}`;
      if (!used.has(code)) return code;
    }
    for (const first of letters) {
      for (const second of letters) {
        const code = `${first}${second}`;
        if (!used.has(code)) return code;
      }
    }
    throw new Error('No available two-letter market code for C tests');
  }

  async function expectedRecruitmentAmount(transactionId: string): Promise<{
    recognizedServiceFee: string;
    postedAmount: string;
  }> {
    const [fee] = await database.db
      .select({ amount: transactionServiceFees.amount })
      .from(transactionServiceFees)
      .where(eq(transactionServiceFees.transactionId, transactionId))
      .limit(1);
    const recognizedServiceFee = fee?.amount ?? null;
    expect(recognizedServiceFee).not.toBeNull();

    const calculated = await database.db.execute<{
      posted_amount: string;
    }>(
      sql`SELECT ROUND(CAST(${recognizedServiceFee} AS NUMERIC(38,10)) * CAST('0.005' AS NUMERIC(38,10)), 2)::numeric(38,10)::text AS posted_amount`,
    );
    return {
      recognizedServiceFee: recognizedServiceFee!,
      postedAmount: calculated.rows[0]!.posted_amount,
    };
  }

  async function expectNoLedgerForSourceReferences(sourceReferences: string[]) {
    const ledgers = await database.db
      .select({ id: commissionLedger.id })
      .from(commissionLedger)
      .where(
        sql`${commissionLedger.sourceReference} IN (${sql.join(
          sourceReferences.map((sourceReference) => sql`${sourceReference}`),
          sql`, `,
        )})`,
      );
    expect(ledgers.length).toBe(0);
  }

  async function expectNoRegistrationLeakForEmail(email: string) {
    const leaks = await database.db.execute<{
      accounts: number;
      groups: number;
      branches: number;
      referrals: number;
      attributions: number;
      ledger: number;
    }>(sql`
      WITH leaked_account AS (
        SELECT id FROM accounts WHERE email = ${email}
      ),
      leaked_groups AS (
        SELECT id FROM merchant_groups
        WHERE account_id IN (SELECT id FROM leaked_account)
      ),
      leaked_branches AS (
        SELECT id FROM merchant_branches
        WHERE merchant_group_id IN (SELECT id FROM leaked_groups)
      ),
      leaked_sources AS (
        SELECT id::text AS source_reference FROM leaked_account
        UNION
        SELECT id::text AS source_reference FROM leaked_branches
      )
      SELECT
        (SELECT count(*)::int FROM leaked_account) AS accounts,
        (SELECT count(*)::int FROM leaked_groups) AS groups,
        (SELECT count(*)::int FROM leaked_branches) AS branches,
        (
          SELECT count(*)::int FROM merchant_referrals
          WHERE merchant_branch_id IN (SELECT id FROM leaked_branches)
        ) AS referrals,
        (
          SELECT count(*)::int FROM merchant_attribution
          WHERE merchant_account_id IN (SELECT id FROM leaked_account)
             OR branch_id IN (SELECT id FROM leaked_branches)
        ) AS attributions,
        (
          SELECT count(*)::int FROM commission_ledger
          WHERE source_reference IN (SELECT source_reference FROM leaked_sources)
        ) AS ledger
    `);
    const row = leaks.rows[0]!;
    expect(row.accounts).toBe(0);
    expect(row.groups).toBe(0);
    expect(row.branches).toBe(0);
    expect(row.referrals).toBe(0);
    expect(row.attributions).toBe(0);
    expect(row.ledger).toBe(0);
  }

  async function expectNoBranchLeakForName(input: {
    merchantAccountId: string;
    merchantGroupId: string;
    branchName: string;
  }) {
    const leaks = await database.db.execute<{
      branches: number;
      referrals: number;
      attributions: number;
      ledger: number;
    }>(sql`
      WITH leaked_branch AS (
        SELECT id FROM merchant_branches
        WHERE merchant_group_id = ${input.merchantGroupId}
          AND name = ${input.branchName}
      ),
      leaked_sources AS (
        SELECT ${input.merchantAccountId}::text AS source_reference
        UNION
        SELECT id::text AS source_reference FROM leaked_branch
      )
      SELECT
        (SELECT count(*)::int FROM leaked_branch) AS branches,
        (
          SELECT count(*)::int FROM merchant_referrals
          WHERE merchant_branch_id IN (SELECT id FROM leaked_branch)
        ) AS referrals,
        (
          SELECT count(*)::int FROM merchant_attribution
          WHERE merchant_account_id = ${input.merchantAccountId}
             OR branch_id IN (SELECT id FROM leaked_branch)
        ) AS attributions,
        (
          SELECT count(*)::int FROM commission_ledger
          WHERE source_reference IN (SELECT source_reference FROM leaked_sources)
        ) AS ledger
    `);
    const row = leaks.rows[0]!;
    expect(row.branches).toBe(0);
    expect(row.referrals).toBe(0);
    expect(row.attributions).toBe(0);
    expect(row.ledger).toBe(0);
  }

  async function createMember(): Promise<{
    memberId: string;
    accountId: string;
    referralCode: string;
  }> {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const [acct] = await database.db
      .insert(accounts)
      .values({
        publicId: `CM-${suffix}`,
        email: `c-m-${suffix}@test.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: accounts.id });
    const referralCode = `CR${suffix.toUpperCase()}`;
    const [mbr] = await database.db
      .insert(members)
      .values({
        accountId: acct!.id,
        publicMemberId: `CM${suffix.toUpperCase()}`,
        referralCode,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    await database.db.insert(memberProfiles).values({
      memberId: mbr!.id,
      displayName: `C Member ${suffix}`,
    });
    return { memberId: mbr!.id, accountId: acct!.id, referralCode };
  }

  async function seedAgentActivation(db: any, memberId: string) {
    const past = new Date(Date.now() - 86400000);
    await db
      .insert(agentActivations)
      .values({
        memberId,
        market: marketCode,
        currency: 'MYR',
        status: 'ACTIVE',
        activatedAt: past,
        paymentConfirmedAt: past,
        courseCompletedAt: past,
      })
      .onConflictDoNothing();
  }

  async function registerMerchant(opts?: {
    referralAccountId?: string;
  }): Promise<{ accountId: string; branchId: string; groupId: string }> {
    const email = `c-merch-${randomUUID().slice(0, 8)}@test.com`;
    const password = 'C-Merchant-Password-123!';
    const otp = await auth.issueOtp({
      destination: email,
      purpose: 'EMAIL_VERIFICATION',
    });
    const body: Record<string, unknown> = {
      email,
      password,
      otp_id: otp.id,
      otp_code: otp.code,
      market_id: marketId,
      account_country: 'MY',
      channel: 'ct',
      display_name: `C Merchant ${randomUUID().slice(0, 6)}`,
      terms_version: 'merchant-terms-v1',
      locale: 'en-MY',
    };
    if (opts?.referralAccountId) {
      body.referral_account_id = opts.referralAccountId;
    }
    const res = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', randomUUID())
      .send(body)
      .expect(201);
    const [mbr] = await database.db
      .select({ accountId: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);
    return {
      accountId: mbr!.accountId,
      branchId: res.body.branch_id as string,
      groupId: res.body.group_id as string,
    };
  }

  async function ensurePackage(
    branchId: string,
    mktId: string,
  ): Promise<string> {
    const existing = await database.db
      .select({ id: merchantPackageAssignments.id })
      .from(merchantPackageAssignments)
      .where(
        and(
          eq(merchantPackageAssignments.merchantBranchId, branchId),
          eq(merchantPackageAssignments.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (existing[0]?.id) return existing[0].id;

    const code = `CTPKG-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const [feeProfile] = await database.db
      .insert(serviceFeeProfiles)
      .values({ code, name: `C Pkg ${code}`, marketId: mktId })
      .returning({ id: serviceFeeProfiles.id });
    const [feeVersion] = await database.db
      .insert(serviceFeeVersions)
      .values({
        serviceFeeProfileId: feeProfile!.id,
        rate: '2.500000',
        effectiveFrom: new Date('2020-01-01'),
        status: 'ACTIVE',
        marketId: mktId,
      })
      .returning({ id: serviceFeeVersions.id });
    const [pkg] = await database.db
      .insert(merchantPackageAssignments)
      .values({
        merchantBranchId: branchId,
        serviceFeeVersionId: feeVersion!.id,
        status: 'ACTIVE',
        isDefault: true,
        version: 1,
      })
      .returning({ id: merchantPackageAssignments.id });
    return pkg!.id;
  }

  async function activateMerchant(branchId: string) {
    await database.db
      .update(merchantBranches)
      .set({ status: 'ACTIVE', isPubliclyVisible: true, isOffline: true })
      .where(eq(merchantBranches.id, branchId));
  }

  async function setMcpBalance(branchId: string) {
    await database.db.transaction(async (tx: any) => {
      await tx.execute(
        sql`SELECT set_config('ipoint.mcp_posting', 'enabled', true)`,
      );
      await tx
        .update(mcpAccounts)
        .set({ availableBalance: '999999.99', totalBalance: '999999.99' })
        .where(eq(mcpAccounts.merchantBranchId, branchId));
    });
  }

  async function createQrToken(memberId: string): Promise<string> {
    const qrRaw = createHash('sha256')
      .update(`c-qr-${memberId}-${Date.now()}`)
      .digest('hex')
      .slice(0, 64);
    const tokenHash = createHash('sha256').update(qrRaw, 'utf8').digest('hex');
    await database.db.execute(
      sql`INSERT INTO member_qr_identities (member_id, public_qr_id, token_hash, status, issued_at)
          VALUES (${memberId}::uuid, ${`QR-${memberId.slice(0, 12)}`}, ${tokenHash}, 'ACTIVE', now())
          ON CONFLICT DO NOTHING`,
    );
    return qrRaw;
  }

  async function executeRecruitmentTransaction(
    merchantAccountId: string,
    branchId: string,
    consumerQrToken: string,
    pkgId: string,
  ) {
    const pKey = `cr-pv-${randomUUID().slice(0, 8)}`;
    const cKey = `cr-cf-${randomUUID().slice(0, 8)}`;
    const preview = await txService.createPreview(
      merchantAccountId,
      {
        amount: '100.00',
        memberQrToken: consumerQrToken,
        packageId: pkgId,
        marketId,
      },
      pKey,
      marketId,
      {},
    );
    const confirm = await txService.confirm(
      merchantAccountId,
      preview.previewSessionId,
      {},
      cKey,
      {},
    );
    const [tx] = await database.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        eq(
          transactions.transactionNumber,
          sql`${confirm.transactionNumber}::bigint`,
        ),
      )
      .limit(1);
    const transactionId = tx!.id;
    await outboxWorker.processBatchOnce();

    const processing = await database.db
      .select()
      .from(commissionProcessing)
      .where(
        and(
          eq(commissionProcessing.sourceType, 'MERCHANT_TRANSACTION'),
          eq(commissionProcessing.sourceReference, transactionId),
        ),
      );
    const results = await database.db
      .select({
        id: commissionProcessingResults.id,
        processingId: commissionProcessingResults.processingId,
        beneficiaryId: commissionProcessingResults.beneficiaryId,
        generation: commissionProcessingResults.generation,
        entryType: commissionProcessingResults.entryType,
        unroundedAmount: commissionProcessingResults.unroundedAmount,
        postedAmount: commissionProcessingResults.postedAmount,
        residualAmount: commissionProcessingResults.residualAmount,
        outcome: commissionProcessingResults.outcome,
        reason: commissionProcessingResults.reason,
      })
      .from(commissionProcessingResults)
      .innerJoin(
        commissionProcessing,
        eq(commissionProcessing.id, commissionProcessingResults.processingId),
      )
      .where(
        and(
          eq(commissionProcessing.sourceType, 'MERCHANT_TRANSACTION'),
          eq(commissionProcessing.sourceReference, transactionId),
        ),
      );
    const ledger = await database.db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceReference, transactionId),
          eq(commissionLedger.entryType, 'MERCHANT_RECRUITMENT_EARN'),
        ),
      );

    return { confirm, transactionId, processing, results, ledger };
  }

  async function expectMarketConsistency(input: {
    transactionId: string;
    branchId: string;
    recruiterMemberId: string;
    ledger: { market: string; currency: string; sourceReference: string };
  }) {
    const [txMarket] = await database.db
      .select({
        marketId: transactions.marketId,
        marketCode: markets.code,
        currency: transactions.currency,
      })
      .from(transactions)
      .innerJoin(markets, eq(markets.id, transactions.marketId))
      .where(eq(transactions.id, input.transactionId))
      .limit(1);
    expect(txMarket?.marketId).toBe(marketId);
    expect(txMarket?.marketCode).toBe(marketCode);
    expect(txMarket?.currency).toBe('MYR');

    const [branchMarket] = await database.db
      .select({ marketId: merchantBranches.marketId })
      .from(merchantBranches)
      .where(eq(merchantBranches.id, input.branchId))
      .limit(1);
    expect(branchMarket?.marketId).toBe(marketId);

    const activeRecruiters = await database.db
      .select({ id: agentActivations.id, currency: agentActivations.currency })
      .from(agentActivations)
      .where(
        and(
          eq(agentActivations.memberId, input.recruiterMemberId),
          eq(agentActivations.market, marketCode),
          eq(agentActivations.status, 'ACTIVE'),
        ),
      );
    expect(activeRecruiters.length).toBe(1);
    expect(activeRecruiters[0]!.currency).toBe('MYR');

    const rateRows = await database.db
      .select({
        market: commissionRateVersions.market,
        rateType: commissionRateVersions.rateType,
        rateValue: sql<string>`${commissionRateVersions.rateValue}::numeric(38,6)::text`,
      })
      .from(commissionRateVersions)
      .where(
        and(
          eq(commissionRateVersions.commissionType, 'MERCHANT_RECRUITMENT'),
          eq(commissionRateVersions.generation, 0),
          eq(commissionRateVersions.market, marketCode),
        ),
      );
    expect(rateRows.length).toBe(1);
    expect(rateRows[0]!.market).toBe(marketCode);
    expect(rateRows[0]!.rateType).toBe('PERCENTAGE');
    expect(rateRows[0]!.rateValue).toBe('0.500000');

    expect(input.ledger.market).toBe(marketCode);
    expect(input.ledger.currency).toBe('MYR');
    expect(input.ledger.sourceReference).toBe(input.transactionId);
  }

  // ═══════════════════════════════════════════════════════════
  // C-01: Parent Merchant registration with referral
  // ═══════════════════════════════════════════════════════════
  it('C-01: Parent Merchant registration with referral creates MERCHANT attribution', async () => {
    const recruiter = await createMember();
    const merch = await registerMerchant({
      referralAccountId: recruiter.accountId,
    });

    const attributions = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.merchantAccountId, merch.accountId));
    expect(attributions.length).toBe(1);
    const merchantAttr = attributions[0]!;
    expect(merchantAttr.attributedEntityType).toBe('MERCHANT');
    expect(merchantAttr.recruiterMemberId).toBe(recruiter.memberId);
    expect(merchantAttr.branchId).toBeNull();
    expect(merchantAttr.attributionSource).toBe('REGISTRATION');
    expect(merchantAttr.attributionScope).toBe('PERMANENT');

    const branchAttributions = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.branchId, merch.branchId));
    expect(branchAttributions.length).toBe(0);
    await expectNoLedgerForSourceReferences([merch.accountId, merch.branchId]);
  });

  // ═══════════════════════════════════════════════════════════
  // C-02: Branch registration with own referral
  // ═══════════════════════════════════════════════════════════
  it('C-02: Branch registration with own referral creates BRANCH attribution', async () => {
    const branchRecruiter = await createMember();
    const merch = await registerMerchant();
    const branch = await merchants.addBranch(merch.accountId, {
      merchantGroupId: merch.groupId,
      marketId,
      name: `C Branch ${randomUUID().slice(0, 6)}`,
      referralAccountId: branchRecruiter.accountId,
      channel: 'ct',
    });

    const attributions = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.branchId, branch.branchId),
          eq(merchantAttributions.attributedEntityType, 'BRANCH'),
        ),
      );
    expect(attributions.length).toBe(1);
    expect(attributions[0]!.recruiterMemberId).toBe(branchRecruiter.memberId);
    expect(attributions[0]!.attributionSource).toBe('REGISTRATION');
    expect(attributions[0]!.attributionScope).toBe('PERMANENT');

    const ledger = await database.db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.sourceReference, branch.branchId));
    expect(ledger.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════
  // C-03: Parent and Branch recruiters are independent
  // ═══════════════════════════════════════════════════════════
  it('C-03: Parent and Branch recruiters are independent, no inheritance', async () => {
    const recruiterA = await createMember();
    const recruiterB = await createMember();
    const merch = await registerMerchant({
      referralAccountId: recruiterA.accountId,
    });
    const branch = await merchants.addBranch(merch.accountId, {
      merchantGroupId: merch.groupId,
      marketId,
      name: `C Indep ${randomUUID().slice(0, 6)}`,
      referralAccountId: recruiterB.accountId,
      channel: 'ct',
    });

    const parentAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, merch.accountId),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(parentAttrs.length).toBe(1);
    expect(parentAttrs[0]!.recruiterMemberId).toBe(recruiterA.memberId);

    const branchAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.branchId, branch.branchId));
    expect(branchAttrs.length).toBe(1);
    expect(branchAttrs[0]!.recruiterMemberId).toBe(recruiterB.memberId);
    expect(branchAttrs[0]!.recruiterMemberId).not.toBe(recruiterA.memberId);
  });

  // ═══════════════════════════════════════════════════════════
  // C-04: Branch without referral → no attribution, no fallback
  // ═══════════════════════════════════════════════════════════
  it('C-04: Branch without referral creates no attribution, no fallback', async () => {
    const parentRecruiter = await createMember();
    const merch = await registerMerchant({
      referralAccountId: parentRecruiter.accountId,
    });
    const branch = await merchants.addBranch(merch.accountId, {
      merchantGroupId: merch.groupId,
      marketId,
      name: `C NoRef ${randomUUID().slice(0, 6)}`,
      channel: 'ct',
    });

    const branchAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.branchId, branch.branchId));
    expect(branchAttrs.length).toBe(0);

    const parentAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, merch.accountId),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(parentAttrs.length).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════
  // C-05: Non-ACTIVE recruiter attribution is permanently recorded
  // ═══════════════════════════════════════════════════════════
  it('C-05: Non-ACTIVE recruiter attribution is permanently recorded', async () => {
    const inactiveMember = await createMember();
    const merch = await registerMerchant({
      referralAccountId: inactiveMember.accountId,
    });

    const attributions = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, merch.accountId),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(attributions.length).toBe(1);
    expect(attributions[0]!.recruiterMemberId).toBe(inactiveMember.memberId);
    expect(attributions[0]!.attributionScope).toBe('PERMANENT');

    const ledger = await database.db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.sourceReference, merch.accountId));
    expect(ledger.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════
  // C-06: Registration replay is idempotent
  // ═══════════════════════════════════════════════════════════
  it('C-06: Idempotent registration replay does not create duplicate attribution', async () => {
    const recruiter = await createMember();
    const email = `c-replay-${randomUUID().slice(0, 8)}@test.com`;
    const otp = await auth.issueOtp({
      destination: email,
      purpose: 'EMAIL_VERIFICATION',
    });
    const idemKey = randomUUID();
    const body = {
      email,
      password: 'C-Replay-Password-123!',
      otp_id: otp.id,
      otp_code: otp.code,
      market_id: marketId,
      account_country: 'MY',
      channel: 'ct',
      display_name: `C Replay ${randomUUID().slice(0, 6)}`,
      referral_account_id: recruiter.accountId,
      terms_version: 'merchant-terms-v1',
      locale: 'en-MY',
    };
    const first = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', idemKey)
      .send(body)
      .expect(201);
    const replay = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', idemKey)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    const [createdAccount] = await database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);
    expect(createdAccount?.id).not.toBeUndefined();

    const attributions = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, createdAccount!.id),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(attributions.length).toBe(1);
    expect(attributions[0]!.recruiterMemberId).toBe(recruiter.memberId);
  });

  // ═══════════════════════════════════════════════════════════
  // C-07: Idempotency mismatch cannot replace recruiter
  // ═══════════════════════════════════════════════════════════
  it('C-07: Idempotency mismatch with different referral preserves original', async () => {
    const recruiterA = await createMember();
    const recruiterB = await createMember();
    const email = `c-mismatch-${randomUUID().slice(0, 8)}@test.com`;
    const otp = await auth.issueOtp({
      destination: email,
      purpose: 'EMAIL_VERIFICATION',
    });
    const idemKey = randomUUID();
    const bodyA = {
      email,
      password: 'C-Mismatch-Password-123!',
      otp_id: otp.id,
      otp_code: otp.code,
      market_id: marketId,
      account_country: 'MY',
      channel: 'ct',
      display_name: `C Mismatch ${randomUUID().slice(0, 6)}`,
      referral_account_id: recruiterA.accountId,
      terms_version: 'merchant-terms-v1',
      locale: 'en-MY',
    };
    await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', idemKey)
      .send(bodyA)
      .expect(201);
    const bodyB = { ...bodyA, referral_account_id: recruiterB.accountId };
    await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', idemKey)
      .send(bodyB)
      .expect(409);
    const [createdAccount] = await database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);
    expect(createdAccount?.id).not.toBeUndefined();

    const aAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, createdAccount!.id),
          eq(merchantAttributions.recruiterMemberId, recruiterA.memberId),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(aAttrs.length).toBe(1);
    const bAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, createdAccount!.id),
          eq(merchantAttributions.recruiterMemberId, recruiterB.memberId),
        ),
      );
    expect(bAttrs.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════
  // C-08: Invalid referral — atomic rejection
  // ═══════════════════════════════════════════════════════════
  it('C-08: Invalid referral code is rejected atomically with 400', async () => {
    const email = `c-invalidref-${randomUUID().slice(0, 8)}@test.com`;
    const otp = await auth.issueOtp({
      destination: email,
      purpose: 'EMAIL_VERIFICATION',
    });
    const res = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', randomUUID())
      .send({
        email,
        password: 'C-InvalidRef-Password-123!',
        otp_id: otp.id,
        otp_code: otp.code,
        market_id: marketId,
        account_country: 'MY',
        channel: 'ct',
        display_name: `C InvalidRef ${randomUUID().slice(0, 6)}`,
        referral_account_id: randomUUID(),
        terms_version: 'merchant-terms-v1',
        locale: 'en-MY',
      })
      .expect(400);
    expect(res.body.error.code).toBe('MERCHANT_REFERRAL_INVALID');

    const [acct] = await database.db
      .select()
      .from(accounts)
      .where(eq(accounts.email, email));
    expect(acct).toBeUndefined();
    await expectNoRegistrationLeakForEmail(email);

    const validMerchant = await registerMerchant();
    const invalidBranchName = `C Invalid Branch ${randomUUID().slice(0, 6)}`;
    await expect(
      merchants.addBranch(validMerchant.accountId, {
        merchantGroupId: validMerchant.groupId,
        marketId,
        name: invalidBranchName,
        referralAccountId: randomUUID(),
        channel: 'ct',
      }),
    ).rejects.toMatchObject({
      response: { code: 'MERCHANT_REFERRAL_INVALID' },
    });
    await expectNoBranchLeakForName({
      merchantAccountId: validMerchant.accountId,
      merchantGroupId: validMerchant.groupId,
      branchName: invalidBranchName,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // C-09: Parent registration → confirm → recruitment commission
  // ═══════════════════════════════════════════════════════════
  it('C-09: Parent registration attribution drives recruitment commission at confirm', async () => {
    const recruiter = await createMember();
    await seedAgentActivation(database.db, recruiter.memberId);

    const merch = await registerMerchant({
      referralAccountId: recruiter.accountId,
    });
    const parentAttributions = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.merchantAccountId, merch.accountId));
    expect(parentAttributions.length).toBe(1);
    expect(parentAttributions[0]!.attributedEntityType).toBe('MERCHANT');
    expect(parentAttributions[0]!.recruiterMemberId).toBe(recruiter.memberId);
    expect(parentAttributions[0]!.branchId).toBeNull();
    expect(parentAttributions[0]!.attributionSource).toBe('REGISTRATION');
    expect(parentAttributions[0]!.attributionScope).toBe('PERMANENT');
    await expectNoLedgerForSourceReferences([merch.accountId, merch.branchId]);

    await activateMerchant(merch.branchId);
    await setMcpBalance(merch.branchId);
    const pkgId = await ensurePackage(merch.branchId, marketId);
    expect(pkgId).not.toBe('');

    const consumer = await createMember();
    const qrToken = await createQrToken(consumer.memberId);

    const result = await executeRecruitmentTransaction(
      merch.accountId,
      merch.branchId,
      qrToken,
      pkgId,
    );
    const expectedAmount = await expectedRecruitmentAmount(
      result.transactionId,
    );

    // Exactly 1 processing
    expect(result.processing.length).toBe(1);
    expect(result.processing[0]!.completionOutcome).toBe('CREATED');
    expect(result.processing[0]!.sourceReference).toBe(result.transactionId);

    // Exactly 1 result
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.outcome).toBe('CREATED');
    expect(result.results[0]!.beneficiaryId).toBe(recruiter.memberId);
    expect(result.results[0]!.generation).toBe(0);
    expect(result.results[0]!.entryType).toBe('MERCHANT_RECRUITMENT_EARN');
    expect(result.results[0]!.postedAmount).toBe(expectedAmount.postedAmount);

    // Exactly 1 recruitment ledger
    expect(result.ledger.length).toBe(1);
    const l = result.ledger[0]!;
    expect(l.entryType).toBe('MERCHANT_RECRUITMENT_EARN');
    expect(l.beneficiaryId).toBe(recruiter.memberId);
    expect(l.generation).toBe(0);
    expect(l.sourceReference).toBe(result.transactionId);
    expect(l.market).toBe(marketCode);
    expect(l.currency).toBe('MYR');
    expect(l.amount).toBe(expectedAmount.postedAmount);
    await expectMarketConsistency({
      transactionId: result.transactionId,
      branchId: merch.branchId,
      recruiterMemberId: recruiter.memberId,
      ledger: l,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // C-10: Branch attribution — no fallback to parent
  // ═══════════════════════════════════════════════════════════
  it('C-10: Branch attribution no-fallback, independent recruiter', async () => {
    // Part 1: branch referral earns through its own attribution.
    const parentRecruiter = await createMember();
    const branchRecruiter = await createMember();
    await seedAgentActivation(database.db, parentRecruiter.memberId);
    await seedAgentActivation(database.db, branchRecruiter.memberId);

    const merch = await registerMerchant({
      referralAccountId: parentRecruiter.accountId,
    });
    const branchWithReferral = await merchants.addBranch(merch.accountId, {
      merchantGroupId: merch.groupId,
      marketId,
      name: `C Branch Earn ${randomUUID().slice(0, 6)}`,
      referralAccountId: branchRecruiter.accountId,
      channel: 'ct',
    });
    const branchWithoutReferral = await merchants.addBranch(merch.accountId, {
      merchantGroupId: merch.groupId,
      marketId,
      name: `C Branch NoRef ${randomUUID().slice(0, 6)}`,
      channel: 'ct',
    });

    const parentAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, merch.accountId),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(parentAttrs.length).toBe(1);
    expect(parentAttrs[0]!.recruiterMemberId).toBe(parentRecruiter.memberId);
    expect(parentAttrs[0]!.branchId).toBeNull();

    const branchAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.branchId, branchWithReferral.branchId));
    expect(branchAttrs.length).toBe(1);
    expect(branchAttrs[0]!.attributedEntityType).toBe('BRANCH');
    expect(branchAttrs[0]!.recruiterMemberId).toBe(branchRecruiter.memberId);
    expect(branchAttrs[0]!.attributionSource).toBe('REGISTRATION');
    expect(branchAttrs[0]!.attributionScope).toBe('PERMANENT');

    const noBranchAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.branchId, branchWithoutReferral.branchId));
    expect(noBranchAttrs.length).toBe(0);

    await activateMerchant(branchWithReferral.branchId);
    await setMcpBalance(branchWithReferral.branchId);
    const pkgId = await ensurePackage(branchWithReferral.branchId, marketId);
    expect(pkgId).not.toBe('');

    const consumer = await createMember();
    const qrToken = await createQrToken(consumer.memberId);

    const r1 = await executeRecruitmentTransaction(
      merch.accountId,
      branchWithReferral.branchId,
      qrToken,
      pkgId,
    );
    const expectedBranchAmount = await expectedRecruitmentAmount(
      r1.transactionId,
    );

    expect(r1.processing.length).toBe(1);
    expect(r1.processing[0]!.completionOutcome).toBe('CREATED');
    expect(r1.results.length).toBe(1);
    expect(r1.results[0]!.outcome).toBe('CREATED');
    expect(r1.results[0]!.beneficiaryId).toBe(branchRecruiter.memberId);
    expect(r1.results[0]!.generation).toBe(0);
    expect(r1.results[0]!.entryType).toBe('MERCHANT_RECRUITMENT_EARN');
    expect(r1.results[0]!.postedAmount).toBe(expectedBranchAmount.postedAmount);
    expect(r1.ledger.length).toBe(1);
    expect(r1.ledger[0]!.beneficiaryId).toBe(branchRecruiter.memberId);
    expect(r1.ledger[0]!.generation).toBe(0);
    expect(r1.ledger[0]!.amount).toBe(expectedBranchAmount.postedAmount);
    await expectMarketConsistency({
      transactionId: r1.transactionId,
      branchId: branchWithReferral.branchId,
      recruiterMemberId: branchRecruiter.memberId,
      ledger: r1.ledger[0]!,
    });

    const parentFallbackLedgers = await database.db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceReference, r1.transactionId),
          eq(commissionLedger.beneficiaryId, parentRecruiter.memberId),
          eq(commissionLedger.entryType, 'MERCHANT_RECRUITMENT_EARN'),
        ),
      );
    expect(parentFallbackLedgers.length).toBe(0);

    // Part 2: sibling branch without attribution does not fallback.
    await activateMerchant(branchWithoutReferral.branchId);
    await setMcpBalance(branchWithoutReferral.branchId);
    const pkgId2 = await ensurePackage(
      branchWithoutReferral.branchId,
      marketId,
    );
    expect(pkgId2).not.toBe('');

    const consumer2 = await createMember();
    const qrToken2 = await createQrToken(consumer2.memberId);

    const r2 = await executeRecruitmentTransaction(
      merch.accountId,
      branchWithoutReferral.branchId,
      qrToken2,
      pkgId2,
    );

    expect(r2.processing.length).toBe(1);
    expect(r2.processing[0]!.completionOutcome).toBe('SKIPPED_NO_BENEFICIARY');
    expect(r2.results.length).toBe(1);
    expect(r2.results[0]!.outcome).toBe('SKIPPED_NO_BENEFICIARY');
    expect(r2.results[0]!.beneficiaryId).toBeNull();
    expect(r2.ledger.length).toBe(0);

    const noFallbackLedgers = await database.db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceReference, r2.transactionId),
          eq(commissionLedger.beneficiaryId, parentRecruiter.memberId),
          eq(commissionLedger.entryType, 'MERCHANT_RECRUITMENT_EARN'),
        ),
      );
    expect(noFallbackLedgers.length).toBe(0);
  });
});
