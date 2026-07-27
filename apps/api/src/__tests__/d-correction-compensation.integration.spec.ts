/**
 * D Integration: Correction Execution to Commission Compensation
 *
 * Strict contract tests for Phase 4 correction execution triggering Phase 5
 * commission compensation in one atomic transaction.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  agentActivations,
  auditLogs,
  commissionLedger,
  commissionProcessing,
  commissionProcessingResults,
  commissionRateVersions,
  correctionExecutions,
  correctionRequests,
  markets,
  marketTransactionSettings,
  mcpAccounts,
  mcpLedgerEntries,
  memberProfiles,
  memberQrIdentities,
  members,
  memberWalletEntries,
  merchantAttributions,
  merchantBranches,
  merchantPackageAssignments,
  migrate,
  referralRelationships,
  rewardRuleVersions,
  serviceFeeProfiles,
  serviceFeeVersions,
  transactions,
  transactionCommissionDispatch,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AgentUpgradeCommissionService } from '../domain/commission/agent-upgrade.service.js';
import { CompensationService } from '../domain/commission/compensation.service.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { RbacGuard } from '../platform-access/rbac.guard.js';
import { TransactionCorrectionService } from '../transaction/transaction-correction.service.js';
import { TransactionCommissionOutboxWorker } from '../transaction/transaction-commission-outbox.worker.js';
import { TransactionService } from '../transaction/transaction.service.js';

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL is required for mandatory D integration tests');
}

interface TestMarket {
  id: string;
  code: string;
  adminUserId: string;
}

interface TestMember {
  memberId: string;
  accountId: string;
}

interface MerchantFixture {
  accountId: string;
  branchId: string;
  groupId: string;
  token: string;
}

interface TransactionFixture {
  market: TestMarket;
  merchant: MerchantFixture;
  recruiter: TestMember | null;
  g1: TestMember | null;
  g2: TestMember | null;
  consumer: TestMember;
  transactionId: string;
  transactionNumber: string;
}

type CorrectionKind = 'REVERSAL' | 'REFUND';

const ORIGINAL_ENTRY_TYPES = [
  'MEMBER_CONSUMPTION_G1_EARN',
  'MEMBER_CONSUMPTION_G2_EARN',
  'MERCHANT_RECRUITMENT_EARN',
];
const COMPENSATION_ENTRY_TYPES = [
  'REVERSAL_COMPENSATION',
  'REFUND_COMPENSATION',
];
const password = 'D-Correction-Compensation-123!';

describe('D: Correction Compensation Integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let db: any;
  let auth: AuthService;
  let merchants: MerchantService;
  let transactionsService: TransactionService;
  let corrections: TransactionCorrectionService;
  let outboxWorker: TransactionCommissionOutboxWorker;
  let agentUpgrade: AgentUpgradeCommissionService;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', process.env['DATABASE_URL'] ?? '');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6380');
    vi.stubEnv('AUTH_OTP_PEPPER', 'd-correction-compensation-pepper-32chars');
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
    db = database.db;
    auth = app.get(AuthService);
    merchants = app.get(MerchantService);
    transactionsService = app.get(TransactionService);
    corrections = app.get(TransactionCorrectionService);
    outboxWorker = app.get(TransactionCommissionOutboxWorker);
    agentUpgrade = app.get(AgentUpgradeCommissionService);
    outboxWorker.stop();

    await migrate(database.pool);
    await seedFoundation(database.db);
  });

  afterAll(async () => {
    CompensationService.testInjectRollbackAfterFirstCompensation = false;
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('D-01: reversal creates exact compensation for member G1, member G2, and merchant recruitment', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    const originalSnapshot = ledgerSnapshot(originals);
    expect(originals).toHaveLength(3);

    const requestId = await requestCorrection(fixture, 'REVERSAL');
    const execution = await executeCorrection(requestId, randomUUID());
    expect(execution.response.status).toBe('REVERSED');

    await expectTransactionAndRequestState(
      fixture.transactionId,
      requestId,
      'REVERSED',
    );
    const compensation = await compensationState(
      fixture.transactionId,
      execution.executionId,
    );
    expect(compensation.processing).toHaveLength(1);
    expect(compensation.processing[0]!.completionOutcome).toBe('CREATED');
    expect(compensation.results).toHaveLength(3);
    expect(compensation.ledgers).toHaveLength(3);
    assertExactCompensations(
      originals,
      compensation,
      'REVERSAL_COMPENSATION',
      fixture.transactionId,
      execution.executionId,
    );

    const afterOriginals = await ledgersByIds(
      originals.map((row: any) => row.id),
    );
    expect(ledgerSnapshot(afterOriginals)).toEqual(originalSnapshot);
  });

  it('D-02: refund creates exact compensation for member G1, member G2, and merchant recruitment', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    expect(originals).toHaveLength(3);

    const requestId = await requestCorrection(fixture, 'REFUND');
    const execution = await executeCorrection(requestId, randomUUID());
    expect(execution.response.status).toBe('REFUNDED');

    await expectTransactionAndRequestState(
      fixture.transactionId,
      requestId,
      'REFUNDED',
    );
    const compensation = await compensationState(
      fixture.transactionId,
      execution.executionId,
    );
    expect(compensation.processing).toHaveLength(1);
    expect(compensation.processing[0]!.completionOutcome).toBe('CREATED');
    expect(compensation.results).toHaveLength(3);
    expect(compensation.ledgers).toHaveLength(3);
    assertExactCompensations(
      originals,
      compensation,
      'REFUND_COMPENSATION',
      fixture.transactionId,
      execution.executionId,
    );
  });

  it('D-03: historical snapshot is preserved after future rate versions are added', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    const originalSnapshot = ledgerSnapshot(originals);
    expect(originals).toHaveLength(3);

    await seedFutureRateVersions(fixture.market);

    const requestId = await requestCorrection(fixture, 'REVERSAL');
    const execution = await executeCorrection(requestId, randomUUID());
    const compensation = await compensationState(
      fixture.transactionId,
      execution.executionId,
    );
    expect(compensation.ledgers).toHaveLength(3);
    assertExactCompensations(
      originals,
      compensation,
      'REVERSAL_COMPENSATION',
      fixture.transactionId,
      execution.executionId,
    );
    for (const original of originals) {
      const compensationLedger = compensation.ledgers.find(
        (row: any) => row.reversalLinkage === original.id,
      );
      expect(compensationLedger).not.toBeUndefined();
      expect(compensationLedger!.rateVersionId).toBe(original.rateVersionId);
      expect(compensationLedger!.rateSnapshot).toEqual(original.rateSnapshot);
      expect(compensationLedger!.calculationBasis).toBe(
        original.calculationBasis,
      );
    }
    const afterOriginals = await ledgersByIds(
      originals.map((row: any) => row.id),
    );
    expect(ledgerSnapshot(afterOriginals)).toEqual(originalSnapshot);
  });

  it('D-04: idempotent replay returns the same execution and does not duplicate economics', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    const requestId = await requestCorrection(fixture, 'REVERSAL');
    const executionKey = randomUUID();

    const first = await executeCorrection(requestId, executionKey);
    const replay = await corrections.executeCorrection(requestId, executionKey);
    expect(replay).toEqual(first.response);

    const executions = await correctionExecutionRows(requestId);
    expect(executions).toHaveLength(1);
    const compensation = await compensationState(
      fixture.transactionId,
      first.executionId,
    );
    expect(compensation.processing).toHaveLength(1);
    expect(compensation.results).toHaveLength(3);
    expect(compensation.ledgers).toHaveLength(3);
    expect(await mcpCompensationCount(requestId)).toBe(1);
    expect(await walletCompensationCount(requestId)).toBe(1);
    assertExactCompensations(
      originals,
      compensation,
      'REVERSAL_COMPENSATION',
      fixture.transactionId,
      first.executionId,
    );
  });

  it('D-05: execution key mismatch after completion does not add compensation', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    const requestId = await requestCorrection(fixture, 'REFUND');
    const first = await executeCorrection(requestId, randomUUID());

    await expect(
      corrections.executeCorrection(requestId, randomUUID()),
    ).rejects.toMatchObject({
      response: { code: 'TRANSACTION_CORRECTION_CONFLICT' },
    });

    const executions = await correctionExecutionRows(requestId);
    expect(executions).toHaveLength(1);
    const compensation = await compensationState(
      fixture.transactionId,
      first.executionId,
    );
    expect(compensation.processing).toHaveLength(1);
    expect(compensation.results).toHaveLength(3);
    expect(compensation.ledgers).toHaveLength(3);
    expect(await mcpCompensationCount(requestId)).toBe(1);
    expect(await walletCompensationCount(requestId)).toBe(1);
    assertExactCompensations(
      originals,
      compensation,
      'REFUND_COMPENSATION',
      fixture.transactionId,
      first.executionId,
    );
  });

  it('D-06: concurrent execution produces one economic result', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    const requestId = await requestCorrection(fixture, 'REVERSAL');
    const executionKey = randomUUID();

    const settled = await Promise.allSettled([
      corrections.executeCorrection(requestId, executionKey),
      corrections.executeCorrection(requestId, executionKey),
    ]);
    expect(settled).toHaveLength(2);
    expect(settled.map((item) => item.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    const responses = settled.map(
      (item) =>
        (
          item as PromiseFulfilledResult<{
            transactionNumber: string;
            requestType: CorrectionKind;
            status: string;
            executedAt: string;
          }>
        ).value,
    );
    expect(responses[1]).toEqual(responses[0]);

    const executions = await correctionExecutionRows(requestId);
    expect(executions).toHaveLength(1);
    const executionId = executions[0]!.id;
    const compensation = await compensationState(
      fixture.transactionId,
      executionId,
    );
    expect(compensation.processing).toHaveLength(1);
    expect(compensation.results).toHaveLength(3);
    expect(compensation.ledgers).toHaveLength(3);
    expect(await mcpCompensationCount(requestId)).toBe(1);
    expect(await walletCompensationCount(requestId)).toBe(1);
    assertExactCompensations(
      originals,
      compensation,
      'REVERSAL_COMPENSATION',
      fixture.transactionId,
      executionId,
    );
  });

  it('D-07: injected commission failure rolls back the entire correction transaction', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const requestId = await requestCorrection(fixture, 'REFUND');
    const beforeProcessingTotal = await correctionCompensationProcessingTotal();

    CompensationService.testInjectRollbackAfterFirstCompensation = true;
    try {
      await expect(
        corrections.executeCorrection(requestId, randomUUID()),
      ).rejects.toMatchObject({
        response: { code: 'TRANSACTION_CORRECTION_EXECUTION_FAILED' },
      });
    } finally {
      CompensationService.testInjectRollbackAfterFirstCompensation = false;
    }

    const requestRows = await db
      .select({ status: correctionRequests.status })
      .from(correctionRequests)
      .where(eq(correctionRequests.id, requestId));
    expect(requestRows).toHaveLength(1);
    expect(requestRows[0]!.status).toBe('REQUESTED');
    const transactionRows = await db
      .select({ status: transactions.status })
      .from(transactions)
      .where(eq(transactions.id, fixture.transactionId));
    expect(transactionRows).toHaveLength(1);
    expect(transactionRows[0]!.status).toBe('REFUND_REQUESTED');
    expect(await correctionExecutionRows(requestId)).toHaveLength(0);
    expect(await mcpCompensationCount(requestId)).toBe(0);
    expect(await walletCompensationCount(requestId)).toBe(0);
    expect(await compensationLedgerCount(fixture.transactionId)).toBe(0);
    expect(await correctionCompensationProcessingTotal()).toBe(
      beforeProcessingTotal,
    );
    expect(await correctionSuccessAuditCount(requestId)).toBe(0);
  });

  it('D-08: correction succeeds when the transaction has no original commission ledgers', async () => {
    const fixture = await createConfirmedTransactionWithoutCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    expect(originals).toHaveLength(0);

    const requestId = await requestCorrection(fixture, 'REVERSAL');
    const execution = await executeCorrection(requestId, randomUUID());
    expect(execution.response.status).toBe('REVERSED');

    const compensation = await compensationState(
      fixture.transactionId,
      execution.executionId,
    );
    expect(compensation.processing).toHaveLength(1);
    expect(compensation.processing[0]!.completionOutcome).toBe(
      'SKIPPED_NO_BENEFICIARY',
    );
    expect(compensation.results).toHaveLength(0);
    expect(compensation.ledgers).toHaveLength(0);
    expect(await compensationLedgerCount(fixture.transactionId)).toBe(0);
  });

  it('D-09: agent upgrade ledger is not clawed back by transaction correction', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    const upgradeLedgers = await createAgentUpgradeLedger(fixture);
    expect(upgradeLedgers).toHaveLength(2);
    const upgradeSnapshot = ledgerSnapshot(upgradeLedgers);

    const requestId = await requestCorrection(fixture, 'REFUND');
    const execution = await executeCorrection(requestId, randomUUID());
    const compensation = await compensationState(
      fixture.transactionId,
      execution.executionId,
    );
    expect(compensation.ledgers).toHaveLength(3);
    assertExactCompensations(
      originals,
      compensation,
      'REFUND_COMPENSATION',
      fixture.transactionId,
      execution.executionId,
    );
    expect(
      await compensationForOriginalIds(
        upgradeLedgers.map((row: any) => row.id),
      ),
    ).toHaveLength(0);
    const upgradeAfter = await ledgersByIds(
      upgradeLedgers.map((row: any) => row.id),
    );
    expect(ledgerSnapshot(upgradeAfter)).toEqual(upgradeSnapshot);
  });

  it('D-10: post-source agent revocation still compensates the historical original ledgers', async () => {
    const fixture = await createConfirmedTransactionWithCommissions();
    const originals = await originalCommissionEntries(fixture.transactionId);
    expect(originals).toHaveLength(3);

    await revokeAgentAfterSource(fixture.g1!.memberId, fixture.market.code);
    await revokeAgentAfterSource(fixture.g2!.memberId, fixture.market.code);
    await revokeAgentAfterSource(
      fixture.recruiter!.memberId,
      fixture.market.code,
    );

    const requestId = await requestCorrection(fixture, 'REVERSAL');
    const execution = await executeCorrection(requestId, randomUUID());
    const compensation = await compensationState(
      fixture.transactionId,
      execution.executionId,
    );
    expect(compensation.ledgers).toHaveLength(3);
    assertExactCompensations(
      originals,
      compensation,
      'REVERSAL_COMPENSATION',
      fixture.transactionId,
      execution.executionId,
    );
  });

  async function createConfirmedTransactionWithCommissions(): Promise<TransactionFixture> {
    return createConfirmedTransaction({
      withRecruiter: true,
      withReferrers: true,
    });
  }

  async function createConfirmedTransactionWithoutCommissions(): Promise<TransactionFixture> {
    return createConfirmedTransaction({
      withRecruiter: false,
      withReferrers: false,
    });
  }

  async function createConfirmedTransaction(input: {
    withRecruiter: boolean;
    withReferrers: boolean;
  }): Promise<TransactionFixture> {
    const market = await createTestMarket();
    const recruiter = input.withRecruiter ? await createMember('DR') : null;
    if (recruiter) {
      await seedAgentActivation(recruiter.memberId, market.code);
    }

    const merchant = await registerMerchant(market, recruiter?.accountId);
    await activateMerchant(merchant.branchId);
    await setMcpBalance(merchant.branchId);
    const packageId = await ensurePackage(merchant.branchId, market.id);

    const chain = input.withReferrers
      ? await createConsumerWithReferrers(market.code)
      : await createConsumerWithoutReferrers();
    const qrToken = await createQrToken(chain.consumer.memberId);

    const preview = await transactionsService.createPreview(
      merchant.accountId,
      {
        amount: '1000.00',
        memberQrToken: qrToken,
        packageId,
        marketId: market.id,
      },
      `d-preview-${randomUUID()}`,
      market.id,
      {},
    );
    const confirmation = await transactionsService.confirm(
      merchant.accountId,
      preview.previewSessionId,
      {},
      `d-confirm-${randomUUID()}`,
      {},
    );
    const transactionRows = await db
      .select({
        id: transactions.id,
        transactionNumber: transactions.transactionNumber,
      })
      .from(transactions)
      .where(
        eq(
          transactions.transactionNumber,
          sql`${confirmation.transactionNumber}::bigint`,
        ),
      );
    expect(transactionRows).toHaveLength(1);
    await processCommissionDispatchesForTransaction(
      transactionRows[0]!.id,
      input.withRecruiter && input.withReferrers ? 3 : 0,
    );

    return {
      market,
      merchant,
      recruiter,
      g1: chain.g1,
      g2: chain.g2,
      consumer: chain.consumer,
      transactionId: transactionRows[0]!.id,
      transactionNumber: String(transactionRows[0]!.transactionNumber),
    };
  }

  async function processCommissionDispatchesForTransaction(
    transactionId: string,
    expectedOriginalLedgerCount: number,
  ): Promise<void> {
    let lastDispatchRows: Array<{
      eventType: string;
      status: string;
      lastError: string | null;
    }> = [];
    let lastOriginals: Awaited<ReturnType<typeof originalCommissionEntries>> =
      [];

    for (let attempt = 0; attempt < 20; attempt++) {
      await outboxWorker.processBatchOnce();
      lastDispatchRows = await db
        .select({
          eventType: transactionCommissionDispatch.eventType,
          status: transactionCommissionDispatch.status,
          lastError: transactionCommissionDispatch.lastError,
        })
        .from(transactionCommissionDispatch)
        .where(eq(transactionCommissionDispatch.transactionId, transactionId))
        .orderBy(transactionCommissionDispatch.eventType);
      expect(lastDispatchRows).toHaveLength(2);

      lastOriginals = await originalCommissionEntries(transactionId);
      const currentDispatchComplete = lastDispatchRows.every(
        (row) => row.status === 'COMPLETED',
      );
      if (
        currentDispatchComplete &&
        lastOriginals.length === expectedOriginalLedgerCount
      ) {
        return;
      }
    }

    throw new Error(
      `D commission dispatch did not settle for transaction ${transactionId}: ` +
        `dispatch=${JSON.stringify(lastDispatchRows)}, ` +
        `originalLedgerCount=${lastOriginals.length}, ` +
        `expectedOriginalLedgerCount=${expectedOriginalLedgerCount}`,
    );
  }

  async function createTestMarket(): Promise<TestMarket> {
    const code = await nextMarketCode();
    const marketRows = await db
      .insert(markets)
      .values({
        code,
        name: `D Market ${code}`,
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      })
      .returning({ id: markets.id, code: markets.code });
    expect(marketRows).toHaveLength(1);
    const market = marketRows[0]!;

    const adminSuffix = randomSuffix();
    const adminEmailSuffix = adminSuffix.toLowerCase();
    const adminAccountRows = await db
      .insert(accounts)
      .values({
        publicId: `DA-${adminSuffix}`,
        email: `d-admin-${adminEmailSuffix}@test.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: accounts.id });
    expect(adminAccountRows).toHaveLength(1);
    const adminRows = await db
      .insert(adminUsers)
      .values({
        accountId: adminAccountRows[0]!.id,
        displayName: `D Admin ${code}`,
        status: 'ACTIVE',
      })
      .returning({ id: adminUsers.id });
    expect(adminRows).toHaveLength(1);

    await db.insert(marketTransactionSettings).values({
      marketId: market.id,
      currencyCode: 'MYR',
      currencyScale: 2,
      minimumTransactionAmount: '1.00',
      maximumTransactionAmount: '999999.99',
    });
    await db.insert(rewardRuleVersions).values({
      marketId: market.id,
      name: `D Reward ${code}`,
      rewardRate: '0.000500',
      capType: 'FLAT',
      capValue: '999999.99',
      minimumReward: '0',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      createdBy: adminRows[0]!.id,
    });
    await seedInitialRateVersions({
      marketCode: market.code,
      adminUserId: adminRows[0]!.id,
    });

    return { id: market.id, code: market.code, adminUserId: adminRows[0]!.id };
  }

  async function seedInitialRateVersions(input: {
    marketCode: string;
    adminUserId: string;
  }): Promise<void> {
    await db.insert(commissionRateVersions).values([
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 1,
        market: input.marketCode,
        rateValue: '0.0100000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: input.adminUserId,
      },
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 2,
        market: input.marketCode,
        rateValue: '0.0050000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: input.adminUserId,
      },
      {
        commissionType: 'MERCHANT_RECRUITMENT',
        generation: 0,
        market: input.marketCode,
        rateValue: '0.5000000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: input.adminUserId,
      },
      {
        commissionType: 'AGENT_UPGRADE',
        generation: 1,
        market: input.marketCode,
        rateValue: '88.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: input.adminUserId,
      },
      {
        commissionType: 'AGENT_UPGRADE',
        generation: 2,
        market: input.marketCode,
        rateValue: '38.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: input.adminUserId,
      },
    ]);
  }

  async function seedFutureRateVersions(market: TestMarket): Promise<void> {
    await db.insert(commissionRateVersions).values([
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 1,
        market: market.code,
        rateValue: '0.9900000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: market.adminUserId,
      },
      {
        commissionType: 'MEMBER_CONSUMPTION',
        generation: 2,
        market: market.code,
        rateValue: '0.8800000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: market.adminUserId,
      },
      {
        commissionType: 'MERCHANT_RECRUITMENT',
        generation: 0,
        market: market.code,
        rateValue: '99.0000000000',
        rateType: 'PERCENTAGE',
        effectiveFrom: new Date('2029-01-01T00:00:00.000Z'),
        createdBy: market.adminUserId,
      },
    ]);
  }

  async function nextMarketCode(): Promise<string> {
    const existing = await db.select({ code: markets.code }).from(markets);
    const used = new Set(existing.map((row: { code: string }) => row.code));
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const first of letters) {
      for (const second of letters) {
        const code = `${first}${second}`;
        if (!used.has(code)) return code;
      }
    }
    throw new Error('No available two-letter market code for D tests');
  }

  async function createMember(prefix: string): Promise<TestMember> {
    const suffix = randomSuffix();
    const emailSuffix = suffix.toLowerCase();
    const accountRows = await db
      .insert(accounts)
      .values({
        publicId: `${prefix}A-${suffix}`,
        email: `${prefix.toLowerCase()}-${emailSuffix}@test.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: accounts.id });
    expect(accountRows).toHaveLength(1);
    const memberRows = await db
      .insert(members)
      .values({
        accountId: accountRows[0]!.id,
        publicMemberId: `${prefix}M-${suffix}`,
        referralCode: `${prefix}${suffix}`.slice(0, 20),
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    expect(memberRows).toHaveLength(1);
    await db.insert(memberProfiles).values({
      memberId: memberRows[0]!.id,
      displayName: `${prefix} Member ${suffix}`,
    });
    return { accountId: accountRows[0]!.id, memberId: memberRows[0]!.id };
  }

  async function createConsumerWithReferrers(marketCode: string): Promise<{
    consumer: TestMember;
    g1: TestMember;
    g2: TestMember;
  }> {
    const g2 = await createMember('DG2');
    const g1 = await createMember('DG1');
    const consumer = await createMember('DMC');
    await db.insert(referralRelationships).values({
      referrerId: g2.memberId,
      refereeId: g1.memberId,
    });
    await db.insert(referralRelationships).values({
      referrerId: g1.memberId,
      refereeId: consumer.memberId,
    });
    await seedAgentActivation(g1.memberId, marketCode);
    await seedAgentActivation(g2.memberId, marketCode);
    return { consumer, g1, g2 };
  }

  async function createConsumerWithoutReferrers(): Promise<{
    consumer: TestMember;
    g1: null;
    g2: null;
  }> {
    return { consumer: await createMember('DNF'), g1: null, g2: null };
  }

  async function seedAgentActivation(
    memberId: string,
    marketCode: string,
  ): Promise<string> {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const rows = await db
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
      .onConflictDoNothing()
      .returning({ id: agentActivations.id });
    const existingRows = await db
      .select({ id: agentActivations.id })
      .from(agentActivations)
      .where(
        and(
          eq(agentActivations.memberId, memberId),
          eq(agentActivations.market, marketCode),
        ),
      );
    expect(existingRows).toHaveLength(1);
    return rows[0]?.id ?? existingRows[0]!.id;
  }

  async function registerMerchant(
    market: TestMarket,
    referralAccountId?: string,
  ): Promise<MerchantFixture> {
    const suffix = randomSuffix();
    const email = `d-merchant-${suffix.toLowerCase()}@test.com`;
    const otp = await auth.issueOtp({
      destination: email,
      purpose: 'EMAIL_VERIFICATION',
    });
    const body: Record<string, unknown> = {
      email,
      password,
      otp_id: otp.id,
      otp_code: otp.code,
      market_id: market.id,
      account_country: 'MY',
      channel: 'dt',
      display_name: `D Merchant ${suffix}`,
      terms_version: 'merchant-terms-v1',
      locale: 'en-MY',
    };
    if (referralAccountId) body.referral_account_id = referralAccountId;

    const response = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', randomUUID())
      .send(body)
      .expect(201);
    const accountRows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email));
    expect(accountRows).toHaveLength(1);
    const token = (await auth.login(email, password)).accessToken;
    const attributionRows = await db
      .select()
      .from(merchantAttributions)
      .where(eq(merchantAttributions.merchantAccountId, accountRows[0]!.id));
    expect(attributionRows).toHaveLength(referralAccountId ? 1 : 0);
    return {
      accountId: accountRows[0]!.id,
      branchId: response.body.branch_id as string,
      groupId: response.body.group_id as string,
      token,
    };
  }

  async function activateMerchant(branchId: string): Promise<void> {
    await db
      .update(merchantBranches)
      .set({ status: 'ACTIVE', isPubliclyVisible: true, isOffline: true })
      .where(eq(merchantBranches.id, branchId));
  }

  async function setMcpBalance(branchId: string): Promise<void> {
    await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`SELECT set_config('ipoint.mcp_posting', 'enabled', true)`,
      );
      await tx
        .update(mcpAccounts)
        .set({ availableBalance: '999999.99', totalBalance: '999999.99' })
        .where(eq(mcpAccounts.merchantBranchId, branchId));
    });
  }

  async function ensurePackage(
    branchId: string,
    marketId: string,
  ): Promise<string> {
    const profileRows = await db
      .insert(serviceFeeProfiles)
      .values({
        code: `DPKG-${randomSuffix()}`,
        name: `D Package ${randomSuffix()}`,
        marketId,
      })
      .returning({ id: serviceFeeProfiles.id });
    expect(profileRows).toHaveLength(1);
    const versionRows = await db
      .insert(serviceFeeVersions)
      .values({
        serviceFeeProfileId: profileRows[0]!.id,
        rate: '2.500000',
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
        marketId,
      })
      .returning({ id: serviceFeeVersions.id });
    expect(versionRows).toHaveLength(1);
    const packageRows = await db
      .insert(merchantPackageAssignments)
      .values({
        merchantBranchId: branchId,
        serviceFeeVersionId: versionRows[0]!.id,
        status: 'ACTIVE',
        isDefault: true,
        version: 1,
      })
      .returning({ id: merchantPackageAssignments.id });
    expect(packageRows).toHaveLength(1);
    return packageRows[0]!.id;
  }

  async function createQrToken(memberId: string): Promise<string> {
    const raw = createHash('sha256')
      .update(`d-qr-${memberId}-${randomUUID()}`)
      .digest('hex')
      .slice(0, 64);
    await db.insert(memberQrIdentities).values({
      memberId,
      publicQrId: `DQR-${randomSuffix()}`,
      tokenHash: createHash('sha256').update(raw, 'utf8').digest('hex'),
      status: 'ACTIVE',
      issuedAt: new Date(),
    });
    return raw;
  }

  async function requestCorrection(
    fixture: TransactionFixture,
    type: CorrectionKind,
  ): Promise<string> {
    const suffix =
      type === 'REVERSAL' ? 'reversal-requests' : 'refund-requests';
    await supertest(server)
      .post(
        `/api/v1/merchant/transactions/${fixture.transactionNumber}/${suffix}`,
      )
      .set('authorization', `Bearer ${fixture.merchant.token}`)
      .set('idempotency-key', randomUUID())
      .send({ reasonCode: 'CUSTOMER_REQUEST' })
      .expect(201);
    const requestRows = await db
      .select({ id: correctionRequests.id })
      .from(correctionRequests)
      .where(
        and(
          eq(correctionRequests.transactionId, fixture.transactionId),
          eq(correctionRequests.requestType, type),
        ),
      );
    expect(requestRows).toHaveLength(1);
    return requestRows[0]!.id;
  }

  async function executeCorrection(
    correctionRequestId: string,
    executionKey: string,
  ): Promise<{
    executionId: string;
    response: Awaited<
      ReturnType<TransactionCorrectionService['executeCorrection']>
    >;
  }> {
    const response = await corrections.executeCorrection(
      correctionRequestId,
      executionKey,
    );
    const executions = await correctionExecutionRows(correctionRequestId);
    expect(executions).toHaveLength(1);
    return { executionId: executions[0]!.id, response };
  }

  async function originalCommissionEntries(transactionId: string) {
    return db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceReference, transactionId),
          inArray(commissionLedger.entryType, ORIGINAL_ENTRY_TYPES),
        ),
      )
      .orderBy(commissionLedger.sourceType, commissionLedger.generation);
  }

  async function compensationState(
    transactionId: string,
    correctionExecutionId: string,
  ) {
    const processing = await db
      .select()
      .from(commissionProcessing)
      .where(
        and(
          eq(commissionProcessing.sourceType, 'CORRECTION_EXECUTION'),
          eq(commissionProcessing.sourceReference, correctionExecutionId),
        ),
      );
    const processingIds = processing.map((row: any) => row.id);
    const results = await db
      .select()
      .from(commissionProcessingResults)
      .where(inArray(commissionProcessingResults.processingId, processingIds))
      .orderBy(commissionProcessingResults.generation);
    const ledgers = await db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceReference, transactionId),
          eq(commissionLedger.auditLinkage, correctionExecutionId),
          inArray(commissionLedger.entryType, COMPENSATION_ENTRY_TYPES),
        ),
      )
      .orderBy(commissionLedger.sourceType, commissionLedger.generation);
    return { processing, results, ledgers };
  }

  async function ledgersByIds(ids: string[]) {
    return db
      .select()
      .from(commissionLedger)
      .where(inArray(commissionLedger.id, ids))
      .orderBy(commissionLedger.sourceType, commissionLedger.generation);
  }

  async function correctionExecutionRows(correctionRequestId: string) {
    return db
      .select()
      .from(correctionExecutions)
      .where(eq(correctionExecutions.correctionRequestId, correctionRequestId));
  }

  async function expectTransactionAndRequestState(
    transactionId: string,
    correctionRequestId: string,
    finalStatus: 'REVERSED' | 'REFUNDED',
  ): Promise<void> {
    const transactionRows = await db
      .select({ status: transactions.status })
      .from(transactions)
      .where(eq(transactions.id, transactionId));
    expect(transactionRows).toHaveLength(1);
    expect(transactionRows[0]!.status).toBe(finalStatus);
    const requestRows = await db
      .select({ status: correctionRequests.status })
      .from(correctionRequests)
      .where(eq(correctionRequests.id, correctionRequestId));
    expect(requestRows).toHaveLength(1);
    expect(requestRows[0]!.status).toBe('EXECUTED');
  }

  function assertExactCompensations(
    originals: any[],
    compensation: { processing: any[]; results: any[]; ledgers: any[] },
    entryType: 'REVERSAL_COMPENSATION' | 'REFUND_COMPENSATION',
    transactionId: string,
    correctionExecutionId: string,
  ): void {
    expect(compensation.processing).toHaveLength(1);
    const processingId = compensation.processing[0]!.id;
    for (const original of originals) {
      const compensationLedger = compensation.ledgers.find(
        (row: any) => row.reversalLinkage === original.id,
      );
      expect(compensationLedger).not.toBeUndefined();
      expect(compensationLedger!.entryType).toBe(entryType);
      expect(compensationLedger!.amount).toBe(
        new Decimal(original.amount).negated().toFixed(10),
      );
      expect(compensationLedger!.beneficiaryId).toBe(original.beneficiaryId);
      expect(compensationLedger!.generation).toBe(original.generation);
      expect(compensationLedger!.market).toBe(original.market);
      expect(compensationLedger!.currency).toBe(original.currency);
      expect(compensationLedger!.sourceType).toBe(original.sourceType);
      expect(compensationLedger!.sourceReference).toBe(transactionId);
      expect(compensationLedger!.rateVersionId).toBe(original.rateVersionId);
      expect(compensationLedger!.rateSnapshot).toEqual(original.rateSnapshot);
      expect(compensationLedger!.calculationBasis).toBe(
        original.calculationBasis,
      );
      expect(compensationLedger!.postingStatus).toBe('EARNED');
      expect(compensationLedger!.auditLinkage).toBe(correctionExecutionId);
      expect(compensationLedger!.processingId).toBe(processingId);

      const processingResult = compensation.results.find(
        (row: any) =>
          row.beneficiaryId === original.beneficiaryId &&
          row.generation === original.generation &&
          row.entryType === entryType,
      );
      expect(processingResult).not.toBeUndefined();
      expect(processingResult!.processingId).toBe(processingId);
      expect(processingResult!.outcome).toBe('CREATED');
      expect(processingResult!.postedAmount).toBe(compensationLedger!.amount);
    }
  }

  function ledgerSnapshot(rows: any[]) {
    return rows.map((row) => ({
      id: row.id,
      publicReference: row.publicReference,
      beneficiaryId: row.beneficiaryId,
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      market: row.market,
      currency: row.currency,
      amount: row.amount,
      rateVersionId: row.rateVersionId,
      rateSnapshot: row.rateSnapshot,
      calculationBasis: row.calculationBasis,
      generation: row.generation,
      entryType: row.entryType,
      postingStatus: row.postingStatus,
      canonicalEntryKey: row.canonicalEntryKey,
      processingId: row.processingId,
      effectiveTime: row.effectiveTime?.toISOString(),
      reversalLinkage: row.reversalLinkage,
      auditLinkage: row.auditLinkage,
      notes: row.notes,
    }));
  }

  async function mcpCompensationCount(
    correctionRequestId: string,
  ): Promise<number> {
    const rows = await db
      .select({ id: mcpLedgerEntries.id })
      .from(mcpLedgerEntries)
      .where(
        and(
          eq(mcpLedgerEntries.sourceType, 'TRANSACTION_CORRECTION'),
          eq(mcpLedgerEntries.sourceId, correctionRequestId),
        ),
      );
    return rows.length;
  }

  async function walletCompensationCount(
    correctionRequestId: string,
  ): Promise<number> {
    const rows = await db
      .select({ id: memberWalletEntries.id })
      .from(memberWalletEntries)
      .where(
        and(
          eq(memberWalletEntries.referenceType, 'TRANSACTION_CORRECTION'),
          eq(memberWalletEntries.referenceId, correctionRequestId),
        ),
      );
    return rows.length;
  }

  async function compensationLedgerCount(
    transactionId: string,
  ): Promise<number> {
    const rows = await db
      .select({ id: commissionLedger.id })
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceReference, transactionId),
          inArray(commissionLedger.entryType, COMPENSATION_ENTRY_TYPES),
        ),
      );
    return rows.length;
  }

  async function correctionCompensationProcessingTotal(): Promise<number> {
    const rows = await db
      .select({ id: commissionProcessing.id })
      .from(commissionProcessing)
      .where(eq(commissionProcessing.sourceType, 'CORRECTION_EXECUTION'));
    return rows.length;
  }

  async function correctionSuccessAuditCount(
    correctionRequestId: string,
  ): Promise<number> {
    const rows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'transaction_correction'),
          eq(auditLogs.entityId, correctionRequestId),
          eq(auditLogs.result, 'SUCCESS'),
          sql`${auditLogs.action} IN ('TRANSACTION_REVERSED', 'TRANSACTION_REFUNDED')`,
        ),
      );
    return rows.length;
  }

  async function createAgentUpgradeLedger(fixture: TransactionFixture) {
    const activationId = await seedAgentActivation(
      fixture.consumer.memberId,
      fixture.market.code,
    );
    await agentUpgrade.processAgentUpgrade(activationId);
    const rows = await db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceType, 'AGENT_ACTIVATION'),
          eq(commissionLedger.sourceReference, activationId),
          sql`${commissionLedger.entryType} IN ('AGENT_UPGRADE_G1_EARN', 'AGENT_UPGRADE_G2_EARN')`,
        ),
      )
      .orderBy(commissionLedger.generation);
    return rows;
  }

  async function compensationForOriginalIds(ids: string[]) {
    return db
      .select()
      .from(commissionLedger)
      .where(
        and(
          inArray(commissionLedger.reversalLinkage, ids),
          inArray(commissionLedger.entryType, COMPENSATION_ENTRY_TYPES),
        ),
      );
  }

  async function revokeAgentAfterSource(
    memberId: string,
    marketCode: string,
  ): Promise<void> {
    await db
      .update(agentActivations)
      .set({
        status: 'SUSPENDED',
        revokedAt: new Date(),
        revocationReason: 'D-10 post-source revocation test',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentActivations.memberId, memberId),
          eq(agentActivations.market, marketCode),
        ),
      );
  }

  function randomSuffix(): string {
    return randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  }
});
