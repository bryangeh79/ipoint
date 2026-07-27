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
  markets,
  members,
  memberProfiles,
  memberReferrals,
  merchantAttributions,
  merchantBranches,
  merchantPackageAssignments,
  mcpAccounts,
  migrate,
  serviceFeeProfiles,
  serviceFeeVersions,
  transactions,
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
    await migrate(database.pool);
    await seedFoundation(database.db);

    const marketService = app.get(MarketService);
    const code = `CT${randomUUID().replaceAll('-', '').slice(0, 5)}`;
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
  });

  afterAll(async () => {
    await app?.close();
  });

  // ═══════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════

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

  async function seedAgentActivation(
    db: any,
    memberId: string,
    mktCode: string,
  ) {
    await db
      .insert(agentActivations)
      .values({
        memberId,
        market: mktCode.slice(0, 2),
        status: 'ACTIVE',
        activatedAt: new Date(),
        paymentConfirmedAt: new Date(),
        courseCompletedAt: new Date(),
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
    const procIds = processing.map((p) => p.id);
    const results =
      procIds.length > 0
        ? await database.db
            .select()
            .from(commissionProcessingResults)
            .where(
              sql`${commissionProcessingResults.processingId} = ANY(ARRAY[${sql.join(
                procIds.map((id: string) => sql`${id}::uuid`),
                sql`, `,
              )}]::uuid[])`,
            )
        : [];
    const ledger = await database.db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.sourceReference, transactionId));

    return { confirm, transactionId, processing, results, ledger };
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
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, merch.accountId),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(attributions.length).toBe(1);
    const attr = attributions[0]!;
    expect(attr.attributedEntityType).toBe('MERCHANT');
    expect(attr.branchId).toBeNull();
    expect(attr.recruiterMemberId).toBe(recruiter.memberId);
    expect(attr.attributionSource).toBe('REGISTRATION');
    expect(attr.attributionScope).toBe('PERMANENT');

    const ledger = await database.db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.sourceReference, merch.accountId));
    expect(ledger.length).toBe(0);
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

    const attributions = await database.db
      .select()
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.recruiterMemberId, recruiter.memberId),
          eq(merchantAttributions.attributedEntityType, 'MERCHANT'),
        ),
      );
    expect(attributions.length).toBe(1);
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

    const aAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.recruiterMemberId, recruiterA.memberId));
    expect(aAttrs.length).toBe(1);
    const bAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.recruiterMemberId, recruiterB.memberId));
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
  });

  // ═══════════════════════════════════════════════════════════
  // C-09: Parent registration → confirm → recruitment commission
  // ═══════════════════════════════════════════════════════════
  it('C-09: Parent registration attribution drives recruitment commission at confirm', async () => {
    const recruiter = await createMember();
    await seedAgentActivation(database.db, recruiter.memberId, marketCode);

    const merch = await registerMerchant({
      referralAccountId: recruiter.accountId,
    });
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

    // Exactly 1 processing
    expect(result.processing.length).toBe(1);
    expect(result.processing[0]!.completionOutcome).toBe('CREATED');

    // Exactly 1 result
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.outcome).toBe('CREATED');
    expect(result.results[0]!.beneficiaryId).toBe(recruiter.memberId);
    expect(result.results[0]!.generation).toBe(0);

    // Exactly 1 recruitment ledger
    expect(result.ledger.length).toBe(1);
    const l = result.ledger[0]!;
    expect(l.entryType).toBe('MERCHANT_RECRUITMENT_EARN');
    expect(l.beneficiaryId).toBe(recruiter.memberId);
    expect(l.generation).toBe(0);
    expect(l.sourceReference).toBe(result.transactionId);
    expect(l.market).toBe(marketCode);
    expect(l.currency).toBe('MYR');
  });

  // ═══════════════════════════════════════════════════════════
  // C-10: Branch attribution — no fallback to parent
  // ═══════════════════════════════════════════════════════════
  it('C-10: Branch attribution no-fallback, independent recruiter', async () => {
    // Part 1: Branch with attribution → branch recruiter earns commission
    const branchRecruiter = await createMember();
    await seedAgentActivation(
      database.db,
      branchRecruiter.memberId,
      marketCode,
    );
    const merch1 = await registerMerchant();
    const branch = await merchants.addBranch(merch1.accountId, {
      merchantGroupId: merch1.groupId,
      marketId,
      name: `C Branch ${randomUUID().slice(0, 6)}`,
      referralAccountId: branchRecruiter.accountId,
      channel: 'ct',
    });

    await activateMerchant(branch.branchId);
    await setMcpBalance(branch.branchId);
    const pkgId = await ensurePackage(branch.branchId, marketId);
    expect(pkgId).not.toBe('');

    const consumer = await createMember();
    const qrToken = await createQrToken(consumer.memberId);

    const r1 = await executeRecruitmentTransaction(
      merch1.accountId,
      branch.branchId,
      qrToken,
      pkgId,
    );

    // Branch recruiter earns
    expect(r1.processing.length).toBe(1);
    expect(r1.processing[0]!.completionOutcome).toBe('CREATED');
    expect(r1.results.length).toBe(1);
    expect(r1.results[0]!.outcome).toBe('CREATED');
    expect(r1.results[0]!.beneficiaryId).toBe(branchRecruiter.memberId);
    expect(r1.results[0]!.generation).toBe(0);
    expect(r1.ledger.length).toBe(1);
    expect(r1.ledger[0]!.beneficiaryId).toBe(branchRecruiter.memberId);

    // Part 2: Separate merchant WITHOUT any referral → SKIPPED_NO_BENEFICIARY
    const merch2 = await registerMerchant();

    const noAttrAttrs = await database.db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.merchantAccountId, merch2.accountId));
    expect(noAttrAttrs.length).toBe(0);

    await activateMerchant(merch2.branchId);
    await setMcpBalance(merch2.branchId);
    const pkgId2 = await ensurePackage(merch2.branchId, marketId);
    expect(pkgId2).not.toBe('');

    const consumer2 = await createMember();
    const qrToken2 = await createQrToken(consumer2.memberId);

    const r2 = await executeRecruitmentTransaction(
      merch2.accountId,
      merch2.branchId,
      qrToken2,
      pkgId2,
    );

    // No beneficiary → SKIPPED
    expect(r2.processing.length).toBe(1);
    expect(r2.processing[0]!.completionOutcome).toBe('SKIPPED_NO_BENEFICIARY');
    expect(r2.results.length).toBe(1);
    expect(r2.results[0]!.outcome).toBe('SKIPPED_NO_BENEFICIARY');
    expect(r2.results[0]!.beneficiaryId).toBeNull();
    expect(r2.ledger.length).toBe(0);
  });
});
