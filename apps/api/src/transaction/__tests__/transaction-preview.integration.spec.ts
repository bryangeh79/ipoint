import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  auditLogs,
  marketTransactionSettings,
  markets,
  mcpAccounts,
  memberQrIdentities,
  memberProfiles,
  memberWalletAccounts,
  members,
  merchantAccountAccess,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  migrate,
  rewardRuleVersions,
  serviceFeeProfiles,
  serviceFeeVersions,
  transactionAuditReferences,
  transactionPreviewSessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { eq, sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import supertest from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../../app.module.js';
import { configureApplication } from '../../app.setup.js';
import { AUTH_RATE_LIMITER } from '../../auth/auth.constants.js';
import { AuthService } from '../../auth/auth.service.js';
import type { InMemoryRateLimiter } from '../../auth/rate-limit.port.js';
import { DatabaseService } from '../../database/database.service.js';
import type {
  TransactionConfirmResponse,
  TransactionPreviewResponse,
} from '../transaction.dto.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Transaction-Preview-Test-123!';

interface Fixture {
  marketId: string;
  marketCode: string;
  otherMarketId: string;
  branchId: string;
  merchantAccountId: string;
  merchantToken: string;
  outsiderToken: string;
  memberId: string;
  memberAccountId: string;
  qrToken: string;
  assignmentId: string;
  secondAssignmentId?: string;
}

describe.skipIf(!databaseUrl)('POST /merchant/transactions/preview', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let auth: AuthService;
  let rateLimiter: InMemoryRateLimiter;
  let fixture: Fixture;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:56379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'transaction-preview-test-pepper-32-characters',
    );
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app, {
      enableShutdownHooks: false,
      scanSwaggerRoutes: false,
    });
    await app.init();
    server = app.getHttpServer() as Server;
    // Prevent ECONNRESET under concurrent load: keep connections alive longer
    server.keepAliveTimeout = 120_000;
    server.headersTimeout = 125_000;
    server.maxConnections = 200;
    database = app.get(DatabaseService);
    auth = app.get(AuthService);
    rateLimiter = app.get(AUTH_RATE_LIMITER);
    await migrate(database.pool);
    await seedFoundation(database.db);
  });

  beforeEach(async () => {
    rateLimiter.clear();
    fixture = await createFixture();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('creates a valid Preview for a single-package merchant', async () => {
    const response = await preview().expect(201);
    const body = previewBody(response);

    expect(body).toMatchObject({
      amount: '100.00',
      currency: 'MYR',
      selectedPackage: {
        name: 'Preview Package',
        rate: '10.000000',
      },
      serviceFeeRate: '10.000000',
      estimatedMcpDebit: '10.00',
      currentMcpBalance: '500.00',
      estimatedMcpBalanceAfter: '490.00',
      mcpSufficient: true,
      confirmAllowed: true,
      mcpShortfall: '0.00',
      rewardRate: '0.0500000000',
      expectedDailyRewardAmount: '0.0500000000',
      rewardCap: '1000.0000000000',
      transactionMarket: {
        code: fixture.marketCode,
        timezone: 'Asia/Kuala_Lumpur',
      },
    });
    expect(body.previewSessionId).toEqual(expect.any(String));
    expect(body.previewSessionId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu);
    expect(JSON.stringify(body)).not.toContain(fixture.marketId);
    expect(JSON.stringify(body)).not.toContain(fixture.assignmentId);
    expect(body.protectedMemberReference).not.toContain(fixture.memberId);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');

    const previewId = await internalPreviewId(body.previewSessionId);
    const audit = await database.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, previewId));
    expect(audit).toEqual([{ action: 'TRANSACTION_PREVIEW_CREATED' }]);
  });

  it('replays the original Preview for the same key and canonical payload', async () => {
    const key = `preview-replay-${randomUUID()}`;
    const first = previewBody(await preview({}, key).expect(201));
    const replay = previewBody(
      await preview(
        {
          transactionNote: '',
          marketId: fixture.marketId,
          memberQrToken: fixture.qrToken,
          amount: '100.00',
        },
        key,
      ).expect(201),
    );

    expect(replay).toEqual(first);
    const state = await database.pool.query<{
      previews: string;
      idempotencyRecords: string;
      audits: string;
    }>(
      `SELECT
         (SELECT count(*) FROM transaction_preview_sessions WHERE id = $1) AS previews,
         (SELECT count(*) FROM transaction_idempotency_records
           WHERE operation = 'PREVIEW' AND preview_session_id = $1) AS "idempotencyRecords",
         (SELECT count(*) FROM transaction_audit_references
           WHERE event_type = 'PREVIEW_CREATED' AND preview_session_id = $1) AS audits`,
      [await internalPreviewId(first.previewSessionId)],
    );
    expect(state.rows[0]).toEqual({
      previews: '1',
      idempotencyRecords: '1',
      audits: '1',
    });
  });

  it('rejects Preview key reuse with a different payload', async () => {
    const key = `preview-mismatch-${randomUUID()}`;
    await preview({}, key).expect(201);

    const response = await preview({ amount: '101.00' }, key).expect(409);
    expectErrorCode(response.body, 'TRANSACTION_IDEMPOTENCY_MISMATCH');
  });

  it('keeps Preview and Confirm exactly-once under a 20-request replay storm', async () => {
    const previewKey = `preview-storm-${randomUUID()}`;
    const previews = await Promise.all(
      Array.from({ length: 20 }, () => preview({}, previewKey)),
    );
    expect(previews.every((response) => response.status === 201)).toBe(true);
    const previewReferences = new Set(
      previews.map((response) => previewBody(response).previewSessionId),
    );
    expect(previewReferences.size).toBe(1);
    const previewReference = [...previewReferences][0]!;

    const confirmKey = `confirm-storm-${randomUUID()}`;
    const confirmations = await Promise.all(
      Array.from({ length: 20 }, () =>
        confirm(previewReference, {}, confirmKey),
      ),
    );
    expect(confirmations.every((response) => response.status === 201)).toBe(
      true,
    );
    expect(
      new Set(
        confirmations.map(
          (response) => confirmBody(response).transactionNumber,
        ),
      ).size,
    ).toBe(1);
    expect(await confirmationState(previewReference)).toMatchObject({
      transactions: '1',
      fees: '1',
      debits: '1',
      rewardLinks: '1',
      rewardSources: '1',
      rewardPlans: '1',
      walletEntries: '1',
      idempotencyRecords: '2',
      auditReferences: '2',
    });
  });

  it('creates a valid Preview for a multi-package merchant with selection', async () => {
    const secondAssignmentId = await addSecondPackage();
    const response = await preview({ packageId: secondAssignmentId }).expect(
      201,
    );
    const body = previewBody(response);

    expect(body.selectedPackage).toMatchObject({
      name: 'Second Preview Package',
      rate: '20.000000',
    });
    expect(body.estimatedMcpDebit).toBe('20.00');
  });

  it('rejects a missing package selection for a multi-package merchant', async () => {
    await addSecondPackage();
    const response = await preview().expect(400);
    expectErrorCode(response.body, 'TRANSACTION_PACKAGE_SELECTION_REQUIRED');
  });

  it('rejects an invalid package ID', async () => {
    const response = await preview({ packageId: randomUUID() }).expect(400);
    expectErrorCode(response.body, 'TRANSACTION_PACKAGE_INVALID');
  });

  it('rejects a suspended merchant', async () => {
    await database.db
      .update(merchantBranches)
      .set({ status: 'SUSPENDED' })
      .where(eq(merchantBranches.id, fixture.branchId));
    const response = await preview().expect(403);
    expectErrorCode(response.body, 'TRANSACTION_MERCHANT_INACTIVE');
  });

  it('rejects a suspended member', async () => {
    await database.db
      .update(members)
      .set({ status: 'SUSPENDED' })
      .where(eq(members.id, fixture.memberId));
    const response = await preview().expect(403);
    expectErrorCode(response.body, 'TRANSACTION_MEMBER_INACTIVE');
  });

  it('rejects expired and invalid QR tokens', async () => {
    await database.db
      .update(memberQrIdentities)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(memberQrIdentities.memberId, fixture.memberId));
    const expired = await preview().expect(400);
    expectErrorCode(expired.body, 'TRANSACTION_MEMBER_QR_EXPIRED');

    const invalid = await preview({
      memberQrToken: `invalid-${randomUUID()}`,
    }).expect(404);
    expectErrorCode(invalid.body, 'TRANSACTION_MEMBER_QR_INVALID');
  });

  it('rejects a tampered QR token that resolves to no member', async () => {
    const response = await preview({
      memberQrToken: `tampered-${randomUUID()}`,
    }).expect(404);
    expectErrorCode(response.body, 'TRANSACTION_MEMBER_QR_INVALID');
  });

  it('rejects a zero amount', async () => {
    const response = await preview({ amount: '0' }).expect(400);
    expectErrorCode(response.body, 'TRANSACTION_AMOUNT_INVALID');
  });

  it('rejects a negative amount', async () => {
    const response = await preview({ amount: '-1.00' }).expect(400);
    expectErrorCode(response.body, 'TRANSACTION_AMOUNT_INVALID');
  });

  it('rejects an amount with excessive decimal scale', async () => {
    const response = await preview({ amount: '100.001' }).expect(400);
    expectErrorCode(response.body, 'TRANSACTION_AMOUNT_SCALE_INVALID');
  });

  it('rejects an amount below the market minimum', async () => {
    const response = await preview({ amount: '0.50' }).expect(400);
    expectErrorCode(response.body, 'TRANSACTION_AMOUNT_BELOW_MINIMUM');
  });

  it('rejects an amount above the market maximum', async () => {
    const response = await preview({ amount: '10000.01' }).expect(400);
    expectErrorCode(response.body, 'TRANSACTION_AMOUNT_ABOVE_MAXIMUM');
  });

  it('returns Preview MCP information even when MCP is insufficient', async () => {
    fixture = await createFixture({ mcpBalance: '1' });
    const response = await preview().expect(201);
    const body = previewBody(response);

    expect(body).toMatchObject({
      estimatedMcpDebit: '10.00',
      currentMcpBalance: '1.00',
      estimatedMcpBalanceAfter: '-9.00',
      mcpSufficient: false,
      confirmAllowed: false,
      mcpShortfall: '9.00',
    });
  });

  it('rejects cross-market client tampering', async () => {
    const response = await preview({ marketId: fixture.otherMarketId }).expect(
      403,
    );
    expectErrorCode(response.body, 'TRANSACTION_MARKET_MISMATCH');
  });

  it('enforces merchant staff authorization', async () => {
    await supertest(server)
      .post('/api/v1/merchant/transactions/preview')
      .set('authorization', `Bearer ${fixture.outsiderToken}`)
      .set('idempotency-key', randomUUID())
      .send(validPayload())
      .expect(403)
      .expect((response) => {
        expectErrorCode(response.body, 'TRANSACTION_MERCHANT_ACCESS_DENIED');
      });

    await supertest(server)
      .post('/api/v1/merchant/transactions/preview')
      .set('idempotency-key', randomUUID())
      .send(validPayload())
      .expect(401);
  });

  it('accepts empty and 200-character notes and rejects longer notes', async () => {
    await preview({ transactionNote: '' }).expect(201);
    await preview({ transactionNote: 'n'.repeat(200) }).expect(201);
    const invalid = await preview({
      transactionNote: 'n'.repeat(201),
    }).expect(400);
    expectErrorCode(invalid.body, 'VALIDATION_ERROR');
  });

  it('does not mutate the MCP balance', async () => {
    const before = await currentMcpBalance();
    await preview().expect(201);
    const after = await currentMcpBalance();
    expect(after).toBe(before);
  });

  it('does not create Reward sources, plans, or wallet entries', async () => {
    const before = await rewardCounts();
    await preview().expect(201);
    const after = await rewardCounts();
    expect(after).toEqual(before);
  });

  it('does not create a confirmed transaction or generate a Transaction Number', async () => {
    const before = await transactionState();
    await preview().expect(201);
    const after = await transactionState();
    expect(after).toEqual(before);
  });

  it('persists expires_at exactly 60 minutes after created_at', async () => {
    const response = await preview().expect(201);
    const body = previewBody(response);
    const rows = await database.db
      .select({
        createdAt: transactionPreviewSessions.createdAt,
        expiresAt: transactionPreviewSessions.expiresAt,
      })
      .from(transactionPreviewSessions)
      .where(
        eq(
          transactionPreviewSessions.id,
          await internalPreviewId(body.previewSessionId),
        ),
      );
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.expiresAt).not.toBeNull();
    expect(
      (row?.expiresAt?.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0),
    ).toBe(60 * 60 * 1000);
    expect(body.previewExpiresAt).toBe(row?.expiresAt?.toISOString());
  });

  it('confirms the full flow atomically with complete financial and receipt snapshots', async () => {
    const previewResponse = await preview({
      transactionNote: 'Printable note',
    }).expect(201);
    const previewResult = previewBody(previewResponse);
    const response = await confirm(previewResult.previewSessionId, {
      merchantReceiptNumber: 'POS-10001',
    }).expect(201);
    const body = confirmBody(response);

    expect(body).toMatchObject({
      status: 'CONFIRMED',
      currency: 'MYR',
      amount: '100.00',
      serviceFee: '10.00',
      mcpDeducted: '10.00',
      mcpBalanceAfter: '490.00',
      dailyRewardAmount: '0.0500000000',
      rewardCap: '1000.0000000000',
      rewardStartBusinessDate: previewResult.rewardStartDate,
      merchant: {
        merchantName: 'Preview Merchant Group',
        branchName: 'Preview Merchant',
      },
    });
    expect(body.merchant.merchantId).toEqual(expect.any(String));
    expect(body.market.marketCode).toEqual(expect.any(String));
    expect(body.transactionNumber).toMatch(/^\d+$/u);
    expect(body.transactionTime).toEqual(expect.any(String));
    expect(body.receiptData).toEqual({
      transactionNumber: body.transactionNumber,
      status: 'CONFIRMED',
      merchant: body.merchant,
      member: {
        maskedReference: previewResult.protectedMemberReference,
        displayName: 'Preview Member',
      },
      market: body.market,
      currency: 'MYR',
      purchaseAmount: '100.00',
      package: {
        packageName: 'Preview Package',
        serviceFeeRate: '10.0000000000',
      },
      serviceFeeAmount: '10.00',
      reward: {
        rewardRate: '0.0500000000',
        dailyRewardAmount: '0.0500000000',
        rewardCap: '1000.0000000000',
        rewardStartBusinessDate: previewResult.rewardStartDate,
      },
      merchantReceiptNumber: 'POS-10001',
      transactionNote: 'Printable note',
      transactionTime: body.transactionTime,
    });
    expect(body.receiptData).not.toHaveProperty('mcpBalance');
    expect(body.receiptData).not.toHaveProperty('mcpBalanceAfter');
    expect(JSON.stringify(body)).not.toContain(fixture.assignmentId);
    expect(JSON.stringify(body)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    );

    const persisted = await database.pool.query<{
      purchase_amount: string;
      service_fee_rate: string;
      service_fee_amount: string;
      mcp_amount: string;
      mcp_balance_after: string;
      reward_rate: string;
      daily_reward_amount: string;
      reward_cap: string;
      reward_start_business_date: string;
      reward_source_market_id: string;
      reward_plan_market_id: string;
      wallet_market_id: string;
      wallet_entry_market_id: string;
      wallet_entry_amount: string;
      mcp_direction: string;
      mcp_entry_type: string;
    }>(
      `SELECT
         transaction.purchase_amount,
         fee.rate AS service_fee_rate,
         fee.amount AS service_fee_amount,
         debit.amount AS mcp_amount,
         debit.balance_after AS mcp_balance_after,
         transaction.reward_rate,
         transaction.daily_reward_amount,
         transaction.reward_cap,
         transaction.reward_start_business_date::text,
         source.market_id AS reward_source_market_id,
         plan.market_id AS reward_plan_market_id,
         wallet.market_id AS wallet_market_id,
         wallet_entry.market_id AS wallet_entry_market_id,
         wallet_entry.amount AS wallet_entry_amount,
         mcp_entry.direction::text AS mcp_direction,
         mcp_entry.entry_type::text AS mcp_entry_type
       FROM transactions transaction
       JOIN transaction_service_fees fee ON fee.transaction_id = transaction.id
       JOIN transaction_mcp_debits debit ON debit.transaction_id = transaction.id
       JOIN mcp_ledger_entries mcp_entry ON mcp_entry.id = debit.mcp_ledger_entry_id
       JOIN transaction_reward_links reward_link ON reward_link.transaction_id = transaction.id
       JOIN reward_sources source ON source.id = reward_link.reward_source_id
       JOIN reward_plans plan ON plan.id = reward_link.reward_plan_id
       JOIN member_wallet_entries wallet_entry
         ON wallet_entry.reference_type = 'TRANSACTION'
        AND wallet_entry.reference_id = transaction.id::text
       JOIN member_wallet_accounts wallet ON wallet.id = wallet_entry.wallet_account_id
       WHERE transaction.transaction_number = $1`,
      [body.transactionNumber],
    );
    expect(persisted.rows[0]).toMatchObject({
      purchase_amount: '100.0000000000',
      service_fee_rate: '10.0000000000',
      service_fee_amount: '10.0000000000',
      mcp_amount: '10.0000000000',
      mcp_balance_after: '490.0000000000',
      reward_rate: '0.0500000000',
      daily_reward_amount: '0.0500000000',
      reward_cap: '1000.0000000000',
      reward_start_business_date: previewResult.rewardStartDate,
      reward_source_market_id: fixture.marketId,
      reward_plan_market_id: fixture.marketId,
      wallet_market_id: fixture.marketId,
      wallet_entry_market_id: fixture.marketId,
      wallet_entry_amount: '0.0500000000',
      mcp_direction: 'DEBIT',
      mcp_entry_type: 'TRANSACTION_DEDUCTION',
    });
  });

  it('requires a Confirm Idempotency-Key header', async () => {
    const previewResult = previewBody(await preview().expect(201));
    const response = await supertest(server)
      .post(
        `/api/v1/merchant/transactions/${previewResult.previewSessionId}/confirm`,
      )
      .set('authorization', `Bearer ${fixture.merchantToken}`)
      .send({})
      .expect(400);

    expectErrorCode(
      response.body,
      'TRANSACTION_CONFIRM_IDEMPOTENCY_KEY_REQUIRED',
    );
  });

  it('replays Confirm for the same key and payload without duplicate financial writes', async () => {
    const previewResult = previewBody(await preview().expect(201));
    const key = `confirm-replay-${randomUUID()}`;
    const payload = { merchantReceiptNumber: 'REPLAY-001' };
    const first = confirmBody(
      await confirm(previewResult.previewSessionId, payload, key).expect(201),
    );
    const replay = confirmBody(
      await confirm(previewResult.previewSessionId, payload, key).expect(201),
    );

    expect(replay).toEqual(first);
    const state = await confirmationState(previewResult.previewSessionId);
    expect(state).toMatchObject({
      transactions: '1',
      fees: '1',
      debits: '1',
      rewardLinks: '1',
      rewardSources: '1',
      rewardPlans: '1',
      walletEntries: '1',
      idempotencyRecords: '2',
      auditReferences: '2',
      mcpBalance: '490.0000000000',
    });
  });

  it('rejects Confirm key reuse with a different payload', async () => {
    const previewResult = previewBody(await preview().expect(201));
    const key = `confirm-mismatch-${randomUUID()}`;
    await confirm(
      previewResult.previewSessionId,
      { merchantReceiptNumber: 'ORIGINAL' },
      key,
    ).expect(201);

    const response = await confirm(
      previewResult.previewSessionId,
      { merchantReceiptNumber: 'CHANGED' },
      key,
    ).expect(409);
    expectErrorCode(response.body, 'TRANSACTION_IDEMPOTENCY_MISMATCH');
  });

  it('serializes simultaneous Confirm requests and returns one result to both callers', async () => {
    const previewResult = previewBody(await preview().expect(201));
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION p4_s4_test_hold_confirmation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(0.25);
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER p4_s4_test_hold_confirmation
      BEFORE INSERT ON transactions
      FOR EACH ROW EXECUTE FUNCTION p4_s4_test_hold_confirmation();
    `);
    try {
      const [firstResponse, secondResponse] = await Promise.all([
        confirm(
          previewResult.previewSessionId,
          { merchantReceiptNumber: 'CONCURRENT' },
          `confirm-concurrent-a-${randomUUID()}`,
        ).expect(201),
        confirm(
          previewResult.previewSessionId,
          { merchantReceiptNumber: 'CONCURRENT' },
          `confirm-concurrent-b-${randomUUID()}`,
        ).expect(201),
      ]);
      const first = confirmBody(firstResponse);
      const second = confirmBody(secondResponse);
      expect(second).toEqual(first);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS p4_s4_test_hold_confirmation ON transactions;
        DROP FUNCTION IF EXISTS p4_s4_test_hold_confirmation();
      `);
    }

    const state = await confirmationState(previewResult.previewSessionId);
    expect(state).toMatchObject({
      transactions: '1',
      fees: '1',
      debits: '1',
      rewardLinks: '1',
      rewardSources: '1',
      rewardPlans: '1',
      walletEntries: '1',
      idempotencyRecords: '3',
      auditReferences: '2',
      mcpBalance: '490.0000000000',
    });
  });

  it('creates globally unique transaction numbers', async () => {
    const firstPreview = previewBody(await preview().expect(201));
    const first = confirmBody(
      await confirm(firstPreview.previewSessionId).expect(201),
    );
    const secondPreview = previewBody(await preview().expect(201));
    const second = confirmBody(
      await confirm(secondPreview.previewSessionId).expect(201),
    );

    expect(first.transactionNumber).not.toBe(second.transactionNumber);
  });

  it('rolls back every critical write boundary without partial financial state', async () => {
    const boundaries = [
      'transactions',
      'transaction_service_fees',
      'transaction_mcp_debits',
      'reward_plans',
      'reward_sources',
      'member_wallet_entries',
      'transaction_reward_links',
      'transaction_audit_references',
    ] as const;
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION p4_s3_test_fail_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'P4_S3_TEST_WRITE_BOUNDARY';
      END;
      $$;
    `);
    try {
      for (const table of boundaries) {
        rateLimiter.clear();
        fixture = await createFixture();
        const previewResult = previewBody(await preview().expect(201));
        const before = await confirmationState(previewResult.previewSessionId);
        await database.pool.query(
          `CREATE TRIGGER p4_s3_test_boundary
           BEFORE INSERT ON ${table}
           FOR EACH ROW EXECUTE FUNCTION p4_s3_test_fail_insert()`,
        );
        try {
          await confirm(previewResult.previewSessionId).expect(500);
        } finally {
          await database.pool.query(
            `DROP TRIGGER p4_s3_test_boundary ON ${table}`,
          );
        }
        const after = await confirmationState(previewResult.previewSessionId);
        expect(after, table).toEqual(before);
        expect(after.previewStatus, table).toBe('PREVIEWED');
      }
    } finally {
      await database.pool.query(
        'DROP FUNCTION IF EXISTS p4_s3_test_fail_insert()',
      );
    }
  });

  it('rejects a merchant suspended between Preview and Confirm', async () => {
    const previewResult = previewBody(await preview().expect(201));
    await database.db
      .update(merchantBranches)
      .set({ status: 'SUSPENDED' })
      .where(eq(merchantBranches.id, fixture.branchId));

    const response = await confirm(previewResult.previewSessionId).expect(403);
    expectErrorCode(response.body, 'TRANSACTION_MERCHANT_INACTIVE');
    expect(
      (await confirmationState(previewResult.previewSessionId)).transactions,
    ).toBe('0');
  });

  it('rejects when MCP falls below the Preview requirement', async () => {
    const previewResult = previewBody(await preview().expect(201));
    const payloadHash = createHash('sha256')
      .update('p4-s3-test-mcp-reduction')
      .digest('hex');
    await database.db.execute(sql`
      SELECT * FROM append_mcp_ledger_entry(
        (SELECT id FROM mcp_accounts WHERE merchant_branch_id = ${fixture.branchId}),
        'ADVERTISING_DEDUCTION'::mcp_entry_type,
        'DEBIT'::mcp_direction,
        495::numeric,
        -495::numeric,
        -495::numeric,
        'TEST',
        ${randomUUID()},
        ${randomUUID()},
        ${payloadHash},
        'SYSTEM',
        'TEST',
        'P4_S3_MCP_RECHECK',
        ${new Date()},
        NULL,
        '{}'::jsonb
      )
    `);

    const response = await confirm(previewResult.previewSessionId).expect(409);
    expectErrorCode(response.body, 'TRANSACTION_INSUFFICIENT_MCP');
    expect(await currentMcpBalance()).toBe('5.0000000000');
    expect(
      (await confirmationState(previewResult.previewSessionId)).transactions,
    ).toBe('0');
  });

  it('does not create partial state when concurrent Confirm requests have insufficient MCP', async () => {
    fixture = await createFixture({ mcpBalance: '5' });
    const previewResult = previewBody(await preview().expect(201));
    const [first, second] = await Promise.all([
      confirm(
        previewResult.previewSessionId,
        {},
        `insufficient-a-${randomUUID()}`,
      ).expect(409),
      confirm(
        previewResult.previewSessionId,
        {},
        `insufficient-b-${randomUUID()}`,
      ).expect(409),
    ]);

    expectErrorCode(first.body, 'TRANSACTION_INSUFFICIENT_MCP');
    expectErrorCode(second.body, 'TRANSACTION_INSUFFICIENT_MCP');
    expect(
      await confirmationState(previewResult.previewSessionId),
    ).toMatchObject({
      previewStatus: 'PREVIEWED',
      transactions: '0',
      debits: '0',
      rewardSources: '0',
      rewardPlans: '0',
      walletEntries: '0',
      idempotencyRecords: '1',
      auditReferences: '1',
      mcpBalance: '5.0000000000',
    });
  });

  it('credits the consumption-market wallet for a cross-market Member', async () => {
    await database.db
      .update(accounts)
      .set({ accountCountry: 'VN' })
      .where(eq(accounts.id, fixture.memberAccountId));
    const previewResult = previewBody(await preview().expect(201));
    const confirmed = confirmBody(
      await confirm(previewResult.previewSessionId).expect(201),
    );
    const wallets = await database.db
      .select({ marketId: memberWalletAccounts.marketId })
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.memberId, fixture.memberId));

    expect(confirmed.market.marketCode).toEqual(expect.any(String));
    expect(wallets).toEqual([{ marketId: fixture.marketId }]);
  });

  it('uses exact decimal HALF_UP rounding from the frozen Preview snapshot', async () => {
    const previewResult = previewBody(
      await preview({ amount: '10.05' }).expect(201),
    );
    expect(previewResult.estimatedMcpDebit).toBe('1.01');
    expect(previewResult.expectedDailyRewardAmount).toBe('0.0050250000');

    const confirmed = confirmBody(
      await confirm(previewResult.previewSessionId).expect(201),
    );
    expect(confirmed).toMatchObject({
      amount: '10.05',
      serviceFee: '1.01',
      mcpDeducted: '1.01',
      mcpBalanceAfter: '498.99',
      dailyRewardAmount: '0.0050250000',
    });
  });

  it('writes complete redacted audit references without secrets or tokens', async () => {
    const previewKey = `plaintext-preview-${randomUUID()}`;
    const confirmKey = `plaintext-confirm-${randomUUID()}`;
    const previewResult = previewBody(
      await preview({}, previewKey).expect(201),
    );
    const confirmed = confirmBody(
      await confirm(previewResult.previewSessionId, {}, confirmKey).expect(201),
    );
    const previewId = await internalPreviewId(previewResult.previewSessionId);
    const audits = await database.pool.query<{
      action: string;
      before: unknown;
      after: unknown;
    }>(
      `SELECT action, before, after
       FROM audit_logs
       WHERE entity_id IN (
         $1,
         (SELECT id::text FROM transactions WHERE transaction_number = $2)
       )
       ORDER BY occurred_at`,
      [previewId, confirmed.transactionNumber],
    );
    const references = await database.db
      .select({
        eventType: transactionAuditReferences.eventType,
        idempotencyRecordId: transactionAuditReferences.idempotencyRecordId,
      })
      .from(transactionAuditReferences)
      .where(eq(transactionAuditReferences.previewSessionId, previewId));
    const serialized = JSON.stringify(audits.rows);

    expect(audits.rows.map((row) => row.action)).toEqual([
      'TRANSACTION_PREVIEW_CREATED',
      'TRANSACTION_CONFIRMED',
    ]);
    expect(references.map((reference) => reference.eventType)).toEqual([
      'PREVIEW_CREATED',
      'CONFIRMED',
    ]);
    expect(
      references.every(
        (reference) =>
          typeof reference.idempotencyRecordId === 'string' &&
          reference.idempotencyRecordId.length > 0,
      ),
    ).toBe(true);
    expect(serialized).not.toContain(fixture.qrToken);
    expect(serialized).not.toContain(previewKey);
    expect(serialized).not.toContain(confirmKey);
    expect(serialized).not.toContain(password);
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(serialized.toLowerCase()).not.toContain('bearer');

    const storedIdempotency = await database.pool.query<{
      keyHash: string;
      requestHash: string;
      serialized: string;
    }>(
      `SELECT
         key_hash AS "keyHash",
         request_hash AS "requestHash",
         row_to_json(transaction_idempotency_records)::text AS serialized
       FROM transaction_idempotency_records
       WHERE preview_session_id = $1
       ORDER BY operation`,
      [previewId],
    );
    expect(storedIdempotency.rows).toHaveLength(2);
    for (const record of storedIdempotency.rows) {
      expect(record.keyHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(record.requestHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(record.serialized).not.toContain(previewKey);
      expect(record.serialized).not.toContain(confirmKey);
      expect(record.serialized).not.toContain(fixture.qrToken);
    }
  });

  it('rejects an expired Preview', async () => {
    const previewResult = previewBody(await preview().expect(201));
    const previewId = await internalPreviewId(previewResult.previewSessionId);
    await database.db
      .update(transactionPreviewSessions)
      .set({ status: 'EXPIRED', failureCode: 'PREVIEW_EXPIRED' })
      .where(eq(transactionPreviewSessions.id, previewId));

    const response = await confirm(previewResult.previewSessionId).expect(409);
    expectErrorCode(response.body, 'TRANSACTION_PREVIEW_EXPIRED');
  });

  it('rejects concurrent Confirm requests for an expired Preview without partial state', async () => {
    const previewResult = previewBody(await preview().expect(201));
    const previewId = await internalPreviewId(previewResult.previewSessionId);
    await database.db
      .update(transactionPreviewSessions)
      .set({ status: 'EXPIRED', failureCode: 'PREVIEW_EXPIRED' })
      .where(eq(transactionPreviewSessions.id, previewId));

    const [first, second] = await Promise.all([
      confirm(
        previewResult.previewSessionId,
        {},
        `expired-a-${randomUUID()}`,
      ).expect(409),
      confirm(
        previewResult.previewSessionId,
        {},
        `expired-b-${randomUUID()}`,
      ).expect(409),
    ]);
    expectErrorCode(first.body, 'TRANSACTION_PREVIEW_EXPIRED');
    expectErrorCode(second.body, 'TRANSACTION_PREVIEW_EXPIRED');
    expect(
      await confirmationState(previewResult.previewSessionId),
    ).toMatchObject({
      previewStatus: 'EXPIRED',
      transactions: '0',
      debits: '0',
      rewardSources: '0',
      rewardPlans: '0',
      walletEntries: '0',
      idempotencyRecords: '1',
      auditReferences: '1',
    });
  });

  it('rejects an already-confirmed Preview', async () => {
    const previewResult = previewBody(await preview().expect(201));
    await confirm(previewResult.previewSessionId).expect(201);

    const response = await confirm(previewResult.previewSessionId).expect(409);
    expectErrorCode(response.body, 'TRANSACTION_PREVIEW_ALREADY_CONFIRMED');
  });

  it('reports concurrent local endpoint p50/p95/p99 with zero unexpected errors', async () => {
    const sampleCount = 20;
    const previewSamples = await Promise.all(
      Array.from({ length: sampleCount }, async () => {
        const startedAt = performance.now();
        const response = await preview({}, `latency-preview-${randomUUID()}`);
        return {
          durationMs: performance.now() - startedAt,
          response,
          body: previewBody(response),
        };
      }),
    );
    expect(
      previewSamples.every(({ response }) => response.status === 201),
    ).toBe(true);

    const confirmSamples = await Promise.all(
      previewSamples.map(async ({ body }) => {
        const startedAt = performance.now();
        const response = await confirm(
          body.previewSessionId,
          {},
          `latency-confirm-${randomUUID()}`,
        );
        return {
          durationMs: performance.now() - startedAt,
          response,
          body: confirmBody(response),
        };
      }),
    );
    expect(
      confirmSamples.every(({ response }) => response.status === 201),
    ).toBe(true);

    const listSamples = await Promise.all(
      Array.from({ length: sampleCount }, async () => {
        const startedAt = performance.now();
        const response = await supertest(server)
          .get('/api/v1/merchant/transactions?limit=20')
          .set('authorization', `Bearer ${fixture.merchantToken}`);
        return { durationMs: performance.now() - startedAt, response };
      }),
    );
    expect(listSamples.every(({ response }) => response.status === 200)).toBe(
      true,
    );

    const transactionNumber = confirmSamples[0]?.body.transactionNumber ?? '0';
    const detailSamples = await Promise.all(
      Array.from({ length: sampleCount }, async () => {
        const startedAt = performance.now();
        const response = await supertest(server)
          .get(`/api/v1/merchant/transactions/${transactionNumber}`)
          .set('authorization', `Bearer ${fixture.merchantToken}`);
        return { durationMs: performance.now() - startedAt, response };
      }),
    );
    expect(detailSamples.every(({ response }) => response.status === 200)).toBe(
      true,
    );

    const latency = {
      sampleCount,
      unexpectedErrors: 0,
      preview: percentiles(previewSamples.map(({ durationMs }) => durationMs)),
      confirm: percentiles(confirmSamples.map(({ durationMs }) => durationMs)),
      merchantList: percentiles(
        listSamples.map(({ durationMs }) => durationMs),
      ),
      merchantDetail: percentiles(
        detailSamples.map(({ durationMs }) => durationMs),
      ),
    };
    console.log(`[P4-S7-LATENCY] ${JSON.stringify(latency)}`);
  });

  function validPayload() {
    return {
      amount: '100.00',
      memberQrToken: fixture.qrToken,
      marketId: fixture.marketId,
      transactionNote: '',
    };
  }

  function preview(
    overrides: Record<string, unknown> = {},
    idempotencyKey: string = randomUUID(),
  ) {
    return supertest(server)
      .post('/api/v1/merchant/transactions/preview')
      .set('authorization', `Bearer ${fixture.merchantToken}`)
      .set('idempotency-key', idempotencyKey)
      .set('x-market-id', fixture.marketId)
      .send({ ...validPayload(), ...overrides });
  }

  async function createFixture(
    options: { mcpBalance?: string } = {},
  ): Promise<Fixture> {
    const market = await insertMarket();
    const otherMarket = await insertMarket();
    const marketId = market.id;
    const otherMarketId = otherMarket.id;
    const adminAccountId = await insertAccount();
    const adminRows = await database.db
      .insert(adminUsers)
      .values({
        accountId: adminAccountId,
        displayName: 'Preview Rule Admin',
        status: 'ACTIVE',
      })
      .returning({ id: adminUsers.id });
    const adminUserId = adminRows[0]?.id ?? '';
    const merchantAccountId = await insertAccount();
    const outsiderAccountId = await insertAccount();
    await auth.setPassword(merchantAccountId, password);
    await auth.setPassword(outsiderAccountId, password);
    const merchantToken = (
      await auth.login(await accountEmail(merchantAccountId), password)
    ).accessToken;
    const outsiderToken = (
      await auth.login(await accountEmail(outsiderAccountId), password)
    ).accessToken;

    const groupRows = await database.db
      .insert(merchantGroups)
      .values({
        accountId: merchantAccountId,
        marketId,
        name: 'Preview Merchant Group',
      })
      .returning({ id: merchantGroups.id });
    const groupId = groupRows[0]?.id ?? '';
    await database.db.insert(merchantAccountAccess).values({
      accountId: merchantAccountId,
      merchantGroupId: groupId,
      accessType: 'PRIMARY_OWNER',
    });
    const branchRows = await database.db
      .insert(merchantBranches)
      .values({
        merchantGroupId: groupId,
        merchantId: `OF${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        marketId,
        name: 'Preview Merchant',
        status: 'ACTIVE',
      })
      .returning({ id: merchantBranches.id });
    const branchId = branchRows[0]?.id ?? '';
    await database.db.insert(mcpAccounts).values({
      merchantBranchId: branchId,
      marketId,
      availableBalance: options.mcpBalance ?? '500',
      totalBalance: options.mcpBalance ?? '500',
      status: 'ACTIVE',
    });
    const assignmentId = await insertPackage(
      branchId,
      marketId,
      'Preview Package',
      '10',
      true,
    );

    const memberAccountId = await insertAccount();
    const memberRows = await database.db
      .insert(members)
      .values({
        accountId: memberAccountId,
        publicMemberId: `MEM${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        referralCode: randomUUID().replaceAll('-', '').slice(0, 10),
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    const memberId = memberRows[0]?.id ?? '';
    await database.db.insert(memberProfiles).values({
      memberId,
      displayName: 'Preview Member',
    });
    const qrToken = `qr-${randomUUID()}`;
    await database.db.insert(memberQrIdentities).values({
      memberId,
      publicQrId: `qr-public-${randomUUID()}`,
      tokenHash: createHash('sha256').update(qrToken).digest('hex'),
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    await database.db.insert(rewardRuleVersions).values({
      name: 'Preview Reward Rule',
      effectiveFrom: new Date(Date.now() - 60_000),
      rewardRate: '0.05',
      capType: 'FLAT',
      capValue: '1000',
      minimumReward: '0',
      marketId,
      createdBy: adminUserId,
    });

    return {
      marketId,
      marketCode: market.code,
      otherMarketId,
      branchId,
      merchantAccountId,
      merchantToken,
      outsiderToken,
      memberId,
      memberAccountId,
      qrToken,
      assignmentId,
    };
  }

  async function insertMarket(): Promise<{ id: string; code: string }> {
    const code =
      `T${randomUUID().replaceAll('-', '').slice(0, 7)}`.toUpperCase();
    const rows = await database.db
      .insert(markets)
      .values({
        code,
        name: `${code} Preview Market`,
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      })
      .returning({ id: markets.id });
    const marketId = rows[0]?.id ?? '';
    await database.db.insert(marketTransactionSettings).values({
      marketId,
      currencyCode: 'MYR',
      currencyScale: 2,
      minimumTransactionAmount: '1',
      maximumTransactionAmount: '10000',
    });
    return { id: marketId, code };
  }

  async function insertAccount(): Promise<string> {
    const rows = await database.db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    return rows[0]?.id ?? '';
  }

  async function accountEmail(accountId: string): Promise<string> {
    const rows = await database.db
      .select({ email: accounts.email })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    return rows[0]?.email ?? '';
  }

  async function insertPackage(
    branchId: string,
    marketId: string,
    name: string,
    rate: string,
    isDefault: boolean,
  ): Promise<string> {
    const profileRows = await database.db
      .insert(serviceFeeProfiles)
      .values({
        code: `PKG_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        name,
        marketId,
      })
      .returning({ id: serviceFeeProfiles.id });
    const versionRows = await database.db
      .insert(serviceFeeVersions)
      .values({
        serviceFeeProfileId: profileRows[0]?.id ?? '',
        rate,
        effectiveFrom: new Date(Date.now() - 60_000),
        status: 'ACTIVE',
        marketId,
      })
      .returning({ id: serviceFeeVersions.id });
    const assignmentRows = await database.db
      .insert(merchantPackageAssignments)
      .values({
        merchantBranchId: branchId,
        serviceFeeVersionId: versionRows[0]?.id ?? '',
        status: 'ACTIVE',
        isDefault,
      })
      .returning({ id: merchantPackageAssignments.id });
    return assignmentRows[0]?.id ?? '';
  }

  async function addSecondPackage(): Promise<string> {
    const id = await insertPackage(
      fixture.branchId,
      fixture.marketId,
      'Second Preview Package',
      '20',
      false,
    );
    fixture.secondAssignmentId = id;
    return id;
  }

  async function currentMcpBalance(): Promise<string | undefined> {
    const rows = await database.db
      .select({ balance: mcpAccounts.availableBalance })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.merchantBranchId, fixture.branchId));
    return rows[0]?.balance;
  }

  async function rewardCounts() {
    const result = await database.pool.query<{
      sources: string;
      plans: string;
      entries: string;
    }>(
      `SELECT
        (SELECT count(*) FROM reward_sources) AS sources,
        (SELECT count(*) FROM reward_plans) AS plans,
        (SELECT count(*) FROM member_wallet_entries) AS entries`,
    );
    return result.rows[0];
  }

  async function transactionState() {
    const result = await database.pool.query<{
      transactionCount: string;
      sequenceValue: string;
      sequenceCalled: boolean;
    }>(
      `SELECT
        (SELECT count(*) FROM transactions) AS "transactionCount",
        last_value::text AS "sequenceValue",
        is_called AS "sequenceCalled"
       FROM transaction_number_sequence`,
    );
    return result.rows[0];
  }

  function confirm(
    previewSessionId: string,
    body: Record<string, unknown> = {},
    idempotencyKey: string = randomUUID(),
  ) {
    return supertest(server)
      .post(`/api/v1/merchant/transactions/${previewSessionId}/confirm`)
      .set('authorization', `Bearer ${fixture.merchantToken}`)
      .set('idempotency-key', idempotencyKey)
      .send(body);
  }

  async function confirmationState(previewSessionId: string) {
    const resolvedPreviewId = await internalPreviewId(previewSessionId);
    const state = await database.pool.query<{
      previewStatus: string;
      transactions: string;
      fees: string;
      debits: string;
      rewardLinks: string;
      rewardSources: string;
      rewardPlans: string;
      walletEntries: string;
      idempotencyRecords: string;
      auditReferences: string;
      mcpBalance: string;
    }>(
      `SELECT
         (SELECT status::text FROM transaction_preview_sessions WHERE id = $1) AS "previewStatus",
         (SELECT count(*) FROM transactions WHERE preview_session_id = $1) AS transactions,
         (SELECT count(*) FROM transaction_service_fees fee
           JOIN transactions transaction ON transaction.id = fee.transaction_id
          WHERE transaction.preview_session_id = $1) AS fees,
         (SELECT count(*) FROM transaction_mcp_debits debit
           JOIN transactions transaction ON transaction.id = debit.transaction_id
          WHERE transaction.preview_session_id = $1) AS debits,
         (SELECT count(*) FROM transaction_reward_links reward_link
           JOIN transactions transaction ON transaction.id = reward_link.transaction_id
          WHERE transaction.preview_session_id = $1) AS "rewardLinks",
         (SELECT count(*) FROM reward_sources source
           JOIN transactions transaction ON transaction.id = source.source_id
          WHERE transaction.preview_session_id = $1) AS "rewardSources",
         (SELECT count(*) FROM reward_plans plan
           JOIN transactions transaction ON transaction.id = plan.source_id
          WHERE transaction.preview_session_id = $1) AS "rewardPlans",
         (SELECT count(*) FROM member_wallet_entries wallet_entry
            JOIN transactions transaction ON transaction.id::text = wallet_entry.reference_id
           WHERE transaction.preview_session_id = $1) AS "walletEntries",
         (SELECT count(*) FROM transaction_idempotency_records
           WHERE preview_session_id = $1) AS "idempotencyRecords",
         (SELECT count(*) FROM transaction_audit_references
           WHERE preview_session_id = $1) AS "auditReferences",
         (SELECT available_balance FROM mcp_accounts
          WHERE merchant_branch_id = (
            SELECT merchant_branch_id FROM transaction_preview_sessions WHERE id = $1
          )) AS "mcpBalance"`,
      [resolvedPreviewId],
    );
    return state.rows[0]!;
  }

  async function internalPreviewId(
    publicPreviewReference: string,
  ): Promise<string> {
    const result = await database.pool.query<{ previewSessionId: string }>(
      `SELECT preview_session_id AS "previewSessionId"
       FROM transaction_idempotency_records
       WHERE operation = 'PREVIEW'
         AND response->>'previewSessionId' = $1
       LIMIT 1`,
      [publicPreviewReference],
    );
    const previewSessionId = result.rows[0]?.previewSessionId;
    if (!previewSessionId) {
      throw new Error('The test preview reference could not be resolved.');
    }
    return previewSessionId;
  }

  function expectErrorCode(body: unknown, code: string): void {
    expect(body).toMatchObject({ error: { code } });
  }

  function previewBody(response: {
    body: unknown;
  }): TransactionPreviewResponse {
    return response.body as TransactionPreviewResponse;
  }

  function confirmBody(response: {
    body: unknown;
  }): TransactionConfirmResponse {
    return response.body as TransactionConfirmResponse;
  }
});

function percentiles(samples: number[]): {
  p50: number;
  p95: number;
  p99: number;
} {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (percentile: number) =>
    Number(
      sorted[
        Math.min(
          sorted.length - 1,
          Math.ceil((percentile / 100) * sorted.length) - 1,
        )
      ]?.toFixed(2),
    );
  return { p50: at(50), p95: at(95), p99: at(99) };
}
