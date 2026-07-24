import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  marketTransactionSettings,
  markets,
  mcpAccounts,
  memberProfiles,
  memberQrIdentities,
  members,
  merchantAccountAccess,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  migrate,
  rewardRuleVersions,
  serviceFeeProfiles,
  serviceFeeVersions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { eq } from 'drizzle-orm';
import type { Server } from 'node:http';
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
import { TransactionCorrectionService } from '../transaction-correction.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Transaction-Correction-Test-123!';

interface Fixture {
  marketId: string;
  branchId: string;
  groupId: string;
  ownerToken: string;
  adminToken: string;
  cashierToken: string;
  outsiderToken: string;
  memberToken: string;
  qrToken: string;
  transactionId: string;
  transactionNumber: string;
}

describe.skipIf(!databaseUrl)('P4-S6 transaction correction acceptance', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let auth: AuthService;
  let rateLimiter: InMemoryRateLimiter;
  let corrections: TransactionCorrectionService;
  let fixture: Fixture;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:56379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'transaction-correction-test-pepper-32-characters',
    );
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app, {
      enableShutdownHooks: false,
      scanSwaggerRoutes: false,
    });
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    auth = app.get(AuthService);
    rateLimiter = app.get(AUTH_RATE_LIMITER);
    corrections = app.get(TransactionCorrectionService);
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

  it('1. allows Merchant Owner to request reversal', async () => {
    const response = await request('REVERSAL', fixture.ownerToken).expect(201);
    expect(response.body).toMatchObject({
      transactionNumber: fixture.transactionNumber,
      requestType: 'REVERSAL',
      status: 'REQUESTED',
    });
  });

  it('2. allows Merchant Admin to request reversal', async () => {
    await request('REVERSAL', fixture.adminToken).expect(201);
  });

  it('3. denies Cashier correction requests', async () => {
    const response = await request('REVERSAL', fixture.cashierToken).expect(
      403,
    );
    expectCode(response.body, 'TRANSACTION_CORRECTION_ACCESS_DENIED');
  });

  it('4. allows Merchant Owner to request refund', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
  });

  it('5. allows Merchant Admin to request refund', async () => {
    await request('REFUND', fixture.adminToken).expect(201);
  });

  it('6. rejects cross-merchant correction requests', async () => {
    const response = await request('REFUND', fixture.outsiderToken).expect(403);
    expectCode(response.body, 'TRANSACTION_CORRECTION_ACCESS_DENIED');
  });

  it('7. rejects an invalid reason code', async () => {
    const response = await request('REVERSAL', fixture.ownerToken, {
      reasonCode: '',
    }).expect(400);
    expectCode(response.body, 'TRANSACTION_CORRECTION_REASON_INVALID');
  });

  it('8. rejects a reason note longer than 500 characters', async () => {
    const response = await request('REFUND', fixture.ownerToken, {
      reasonCode: 'CUSTOMER_REQUEST',
      reasonNote: 'x'.repeat(501),
    }).expect(400);
    expectCode(response.body, 'TRANSACTION_CORRECTION_REASON_INVALID');
  });

  it('9. rejects partial amount input', async () => {
    const response = await request('REFUND', fixture.ownerToken, {
      reasonCode: 'CUSTOMER_REQUEST',
      amount: '1.00',
    }).expect(400);
    expectCode(response.body, 'TRANSACTION_CORRECTION_REASON_INVALID');
  });

  it('10. replays duplicate reversal with the same key and payload', async () => {
    const key = randomUUID();
    const first = await request('REVERSAL', fixture.ownerToken, undefined, key);
    const replay = await request(
      'REVERSAL',
      fixture.ownerToken,
      undefined,
      key,
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
  });

  it('11. replays duplicate refund with the same key and payload', async () => {
    const key = randomUUID();
    const first = await request('REFUND', fixture.ownerToken, undefined, key);
    const replay = await request('REFUND', fixture.ownerToken, undefined, key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
  });

  it('12. rejects the same key with a different payload', async () => {
    const key = randomUUID();
    await request('REFUND', fixture.ownerToken, undefined, key).expect(201);
    const response = await request(
      'REFUND',
      fixture.ownerToken,
      { reasonCode: 'DUPLICATE_CHARGE' },
      key,
    ).expect(409);
    expectCode(response.body, 'TRANSACTION_CORRECTION_CONFLICT');
  });

  it('13. rejects reversal after a refund request', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
    const response = await request('REVERSAL', fixture.ownerToken).expect(409);
    expectCode(response.body, 'TRANSACTION_CORRECTION_CONFLICT');
  });

  it('14. rejects refund after a reversal request', async () => {
    await request('REVERSAL', fixture.ownerToken).expect(201);
    const response = await request('REFUND', fixture.ownerToken).expect(409);
    expectCode(response.body, 'TRANSACTION_CORRECTION_CONFLICT');
  });

  it('15. rejects a non-CONFIRMED transaction', async () => {
    await setTransactionStatus('REVERSAL_REQUESTED');
    const response = await request('REFUND', fixture.ownerToken).expect(409);
    expectCode(response.body, 'TRANSACTION_REFUND_NOT_ALLOWED');
  });

  it('16. rejects an already REVERSED transaction', async () => {
    await request('REVERSAL', fixture.ownerToken).expect(201);
    await corrections.executeCorrection(await correctionId(), randomUUID());
    const response = await request('REFUND', fixture.ownerToken).expect(409);
    expectCode(response.body, 'TRANSACTION_REFUND_NOT_ALLOWED');
  });

  it('17. rejects an already REFUNDED transaction', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
    await corrections.executeCorrection(await correctionId(), randomUUID());
    const response = await request('REVERSAL', fixture.ownerToken).expect(409);
    expectCode(response.body, 'TRANSACTION_REVERSAL_NOT_ALLOWED');
  });

  it('18. serializes simultaneous reversal requests', async () => {
    const responses = await Promise.all([
      request('REVERSAL', fixture.ownerToken),
      request('REVERSAL', fixture.ownerToken),
    ]);
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(await correctionCount()).toBe(1);
  });

  it('19. serializes simultaneous refund requests', async () => {
    const responses = await Promise.all([
      request('REFUND', fixture.ownerToken),
      request('REFUND', fixture.ownerToken),
    ]);
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(await correctionCount()).toBe(1);
  });

  it('20. prevents simultaneous reversal and refund conflict', async () => {
    const responses = await Promise.all([
      request('REVERSAL', fixture.ownerToken),
      request('REFUND', fixture.ownerToken),
    ]);
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(await correctionCount()).toBe(1);
  });

  it('21. reads the merchant own correction request', async () => {
    await request('REVERSAL', fixture.ownerToken).expect(201);
    const response = await read('REVERSAL', fixture.ownerToken).expect(200);
    expect((response.body as Record<string, unknown>)['requestType']).toBe(
      'REVERSAL',
    );
  });

  it('22. hides a correction request from another merchant', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
    const response = await read('REFUND', fixture.outsiderToken).expect(404);
    expectCode(response.body, 'TRANSACTION_CORRECTION_NOT_FOUND');
  });

  it('23. does not expose internal UUIDs in correction responses', async () => {
    await request('REVERSAL', fixture.ownerToken).expect(201);
    const response = await read('REVERSAL', fixture.ownerToken).expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
    );
  });

  it('24. gives members no correction workflow', async () => {
    const response = await request('REVERSAL', fixture.memberToken).expect(403);
    expectCode(response.body, 'TRANSACTION_CORRECTION_ACCESS_DENIED');
  });

  it('25. restores MCP exactly once with a compensating entry', async () => {
    await request('REVERSAL', fixture.ownerToken).expect(201);
    await corrections.executeCorrection(await correctionId(), randomUUID());
    const state = await financialState();
    expect(state.mcpBalance).toBe('500.0000000000');
    expect(state.mcpCompensations).toBe('1');
  });

  it('26. compensates Reward Source and Reward Plan exactly once', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
    await corrections.executeCorrection(await correctionId(), randomUUID());
    const state = await financialState();
    expect(state.rewardConsumed).toBe(false);
    expect(state.rewardPlanStatus).toBe('REVERSED');
  });

  it('27. appends one Wallet compensation and preserves original entry', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
    await corrections.executeCorrection(await correctionId(), randomUUID());
    const state = await financialState();
    expect(state.walletEntries).toBe('2');
    expect(state.walletCompensations).toBe('1');
  });

  it('28. leaves transaction, package, fee and reward snapshots unchanged', async () => {
    const before = await immutableSnapshot();
    await request('REVERSAL', fixture.ownerToken).expect(201);
    await corrections.executeCorrection(await correctionId(), randomUUID());
    const after = await immutableSnapshot();
    expect(after).toEqual(before);
  });

  it('29. records request and execution audit trail', async () => {
    await request('REVERSAL', fixture.ownerToken).expect(201);
    await corrections.executeCorrection(await correctionId(), randomUUID());
    const result = await database.pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE entity_type = 'transaction_correction'
         AND action IN ('TRANSACTION_REVERSAL_REQUESTED', 'TRANSACTION_REVERSED')
       ORDER BY occurred_at`,
    );
    expect(result.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'TRANSACTION_REVERSAL_REQUESTED',
        'TRANSACTION_REVERSED',
      ]),
    );
  });

  it('30. rolls back the whole execution chain on failure', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
    await database.pool.query(
      `UPDATE reward_sources SET consumed = false WHERE source_id = $1`,
      [fixture.transactionId],
    );
    await expect(
      corrections.executeCorrection(await correctionId(), randomUUID()),
    ).rejects.toBeInstanceOf(Error);
    const state = await financialState();
    expect(state.mcpCompensations).toBe('0');
    expect(state.walletCompensations).toBe('0');
    expect(state.transactionStatus).toBe('REFUND_REQUESTED');
  });

  it('31. replays repeated execution with the same key', async () => {
    await request('REVERSAL', fixture.ownerToken).expect(201);
    const id = await correctionId();
    const key = randomUUID();
    const first = await corrections.executeCorrection(id, key);
    const replay = await corrections.executeCorrection(id, key);
    expect(replay).toEqual(first);
    expect((await financialState()).mcpCompensations).toBe('1');
  });

  it('32. executes a concurrent correction exactly once', async () => {
    await request('REFUND', fixture.ownerToken).expect(201);
    const id = await correctionId();
    const key = randomUUID();
    const results = await Promise.all([
      corrections.executeCorrection(id, key),
      corrections.executeCorrection(id, key),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await financialState()).mcpCompensations).toBe('1');
  });

  it('33. preserves the P4-S1-S5 confirmation chain', async () => {
    const state = await financialState();
    expect(state.transactionStatus).toBe('CONFIRMED');
    expect(state.mcpDebits).toBe('1');
    expect(state.rewardLinks).toBe('1');
  });

  it('34. preserves Phase 3 reward and wallet ledger invariants', async () => {
    const state = await financialState();
    expect(state.rewardConsumed).toBe(true);
    expect(state.rewardPlanStatus).toBe('SCHEDULED');
    expect(state.walletEntries).toBe('1');
  });

  it('35. applies migration/checksum schema without drift-visible omissions', async () => {
    const result = await database.pool.query<{
      requestTable: string | null;
      executionTable: string | null;
      migration: string | null;
    }>(
      `SELECT
        to_regclass('correction_requests')::text AS "requestTable",
        to_regclass('correction_executions')::text AS "executionTable",
        (SELECT filename FROM database_migrations
          WHERE filename = '0017_phase_4_s6_correction_requests.sql') AS migration`,
    );
    expect(result.rows[0]).toEqual({
      requestTable: 'correction_requests',
      executionTable: 'correction_executions',
      migration: '0017_phase_4_s6_correction_requests.sql',
    });
  });

  async function createFixture(): Promise<Fixture> {
    const marketId = await insertMarket();
    const adminAccountId = await insertAccount();
    const adminRows = await database.db
      .insert(adminUsers)
      .values({
        accountId: adminAccountId,
        displayName: 'Correction Rule Admin',
        status: 'ACTIVE',
      })
      .returning({ id: adminUsers.id });
    const ownerAccountId = await insertAccount();
    const merchantAdminAccountId = await insertAccount();
    const cashierAccountId = await insertAccount();
    const outsiderAccountId = await insertAccount();
    const memberAccountId = await insertAccount();
    for (const accountId of [
      ownerAccountId,
      merchantAdminAccountId,
      cashierAccountId,
      outsiderAccountId,
      memberAccountId,
    ]) {
      await auth.setPassword(accountId, password);
    }

    const groupRows = await database.db
      .insert(merchantGroups)
      .values({
        accountId: ownerAccountId,
        marketId,
        name: 'Correction Merchant Group',
      })
      .returning({ id: merchantGroups.id });
    const groupId = groupRows[0]?.id ?? '';
    await database.db.insert(merchantAccountAccess).values([
      {
        accountId: ownerAccountId,
        merchantGroupId: groupId,
        accessType: 'PRIMARY_OWNER',
      },
      {
        accountId: merchantAdminAccountId,
        merchantGroupId: groupId,
        accessType: 'ADMIN',
      },
      {
        accountId: cashierAccountId,
        merchantGroupId: groupId,
        accessType: 'CASHIER',
      },
    ]);
    const branchRows = await database.db
      .insert(merchantBranches)
      .values({
        merchantGroupId: groupId,
        merchantId: `OF${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        marketId,
        name: 'Correction Merchant',
        status: 'ACTIVE',
      })
      .returning({ id: merchantBranches.id });
    const branchId = branchRows[0]?.id ?? '';
    await database.db.insert(mcpAccounts).values({
      merchantBranchId: branchId,
      marketId,
      availableBalance: '500',
      totalBalance: '500',
      status: 'ACTIVE',
    });
    await insertPackage(branchId, marketId);

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
      displayName: 'Correction Member',
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
      name: 'Correction Reward Rule',
      effectiveFrom: new Date(Date.now() - 60_000),
      rewardRate: '0.05',
      capType: 'FLAT',
      capValue: '1000',
      minimumReward: '0',
      marketId,
      createdBy: adminRows[0]?.id ?? '',
    });

    const tokens = await Promise.all(
      [
        ownerAccountId,
        merchantAdminAccountId,
        cashierAccountId,
        outsiderAccountId,
        memberAccountId,
      ].map(async (accountId) => {
        return (await auth.login(await accountEmail(accountId), password))
          .accessToken;
      }),
    );
    const preview = await supertest(server)
      .post('/api/v1/merchant/transactions/preview')
      .set('authorization', `Bearer ${tokens[0]}`)
      .set('idempotency-key', randomUUID())
      .set('x-market-id', marketId)
      .send({ amount: '100.00', memberQrToken: qrToken, marketId })
      .expect(201);
    const confirmation = await supertest(server)
      .post(
        `/api/v1/merchant/transactions/${String(
          (preview.body as Record<string, unknown>)['previewSessionId'],
        )}/confirm`,
      )
      .set('authorization', `Bearer ${tokens[0]}`)
      .set('idempotency-key', randomUUID())
      .send({})
      .expect(201);
    const transactionNumber = String(
      (confirmation.body as Record<string, unknown>)['transactionNumber'],
    );
    const transactionResult = await database.pool.query<{ id: string }>(
      'SELECT id FROM transactions WHERE transaction_number = $1::bigint',
      [transactionNumber],
    );
    return {
      marketId,
      branchId,
      groupId,
      ownerToken: tokens[0] ?? '',
      adminToken: tokens[1] ?? '',
      cashierToken: tokens[2] ?? '',
      outsiderToken: tokens[3] ?? '',
      memberToken: tokens[4] ?? '',
      qrToken,
      transactionId: transactionResult.rows[0]?.id ?? '',
      transactionNumber,
    };
  }

  async function insertMarket(): Promise<string> {
    const code =
      `C${randomUUID().replaceAll('-', '').slice(0, 7)}`.toUpperCase();
    const rows = await database.db
      .insert(markets)
      .values({
        code,
        name: `${code} Correction Market`,
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
    return marketId;
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
  ): Promise<void> {
    const profileRows = await database.db
      .insert(serviceFeeProfiles)
      .values({
        code: `PKG_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        name: 'Correction Package',
        marketId,
      })
      .returning({ id: serviceFeeProfiles.id });
    const versionRows = await database.db
      .insert(serviceFeeVersions)
      .values({
        serviceFeeProfileId: profileRows[0]?.id ?? '',
        rate: '10',
        effectiveFrom: new Date(Date.now() - 60_000),
        status: 'ACTIVE',
        marketId,
      })
      .returning({ id: serviceFeeVersions.id });
    await database.db.insert(merchantPackageAssignments).values({
      merchantBranchId: branchId,
      serviceFeeVersionId: versionRows[0]?.id ?? '',
      status: 'ACTIVE',
      isDefault: true,
    });
  }

  function request(
    type: 'REVERSAL' | 'REFUND',
    token: string,
    body: Record<string, unknown> = { reasonCode: 'CUSTOMER_REQUEST' },
    key: string = randomUUID(),
  ) {
    const suffix =
      type === 'REVERSAL' ? 'reversal-requests' : 'refund-requests';
    return supertest(server)
      .post(
        `/api/v1/merchant/transactions/${fixture.transactionNumber}/${suffix}`,
      )
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key)
      .send(body);
  }

  function read(type: 'REVERSAL' | 'REFUND', token: string) {
    const suffix = type === 'REVERSAL' ? 'reversal-request' : 'refund-request';
    return supertest(server)
      .get(
        `/api/v1/merchant/transactions/${fixture.transactionNumber}/${suffix}`,
      )
      .set('authorization', `Bearer ${token}`);
  }

  async function correctionId(): Promise<string> {
    const result = await database.pool.query<{ id: string }>(
      'SELECT id FROM correction_requests WHERE transaction_id = $1',
      [fixture.transactionId],
    );
    return result.rows[0]?.id ?? '';
  }

  async function correctionCount(): Promise<number> {
    const result = await database.pool.query<{ count: string }>(
      'SELECT count(*) FROM correction_requests WHERE transaction_id = $1',
      [fixture.transactionId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async function setTransactionStatus(
    status: 'REVERSAL_REQUESTED',
  ): Promise<void> {
    await database.pool.query(
      'UPDATE transactions SET status = $1 WHERE id = $2',
      [status, fixture.transactionId],
    );
  }

  async function financialState() {
    const result = await database.pool.query<{
      transactionStatus: string;
      mcpBalance: string;
      mcpDebits: string;
      mcpCompensations: string;
      rewardLinks: string;
      rewardConsumed: boolean;
      rewardPlanStatus: string;
      walletEntries: string;
      walletCompensations: string;
    }>(
      `SELECT
        transaction.status::text AS "transactionStatus",
        mcp_account.available_balance AS "mcpBalance",
        (SELECT count(*) FROM transaction_mcp_debits
          WHERE transaction_id = transaction.id) AS "mcpDebits",
        (SELECT count(*) FROM mcp_ledger_entries
          WHERE source_type = 'TRANSACTION_CORRECTION'
            AND source_id IN (
              SELECT id::text FROM correction_requests
              WHERE transaction_id = transaction.id
            )) AS "mcpCompensations",
        (SELECT count(*) FROM transaction_reward_links
          WHERE transaction_id = transaction.id) AS "rewardLinks",
        reward_source.consumed AS "rewardConsumed",
        reward_plan.status::text AS "rewardPlanStatus",
        (SELECT count(*) FROM member_wallet_entries
          WHERE (reference_type = 'TRANSACTION' AND reference_id = transaction.id::text)
             OR (reference_type = 'TRANSACTION_CORRECTION' AND reference_id IN (
               SELECT id::text FROM correction_requests
               WHERE transaction_id = transaction.id
             ))) AS "walletEntries",
        (SELECT count(*) FROM member_wallet_entries
          WHERE reference_type = 'TRANSACTION_CORRECTION'
            AND reference_id IN (
              SELECT id::text FROM correction_requests
              WHERE transaction_id = transaction.id
            )) AS "walletCompensations"
       FROM transactions transaction
       JOIN mcp_accounts mcp_account
         ON mcp_account.merchant_branch_id = transaction.merchant_branch_id
       JOIN transaction_reward_links reward_link
         ON reward_link.transaction_id = transaction.id
       JOIN reward_sources reward_source
         ON reward_source.id = reward_link.reward_source_id
       JOIN reward_plans reward_plan
         ON reward_plan.id = reward_link.reward_plan_id
       WHERE transaction.id = $1`,
      [fixture.transactionId],
    );
    return result.rows[0]!;
  }

  async function immutableSnapshot() {
    const result = await database.pool.query<{
      transaction: unknown;
      fee: unknown;
      rewardSource: unknown;
      rewardPlanSnapshot: unknown;
    }>(
      `SELECT
        to_jsonb(transaction) - 'status' AS transaction,
        to_jsonb(fee) AS fee,
        to_jsonb(reward_source) - 'consumed' AS "rewardSource",
        reward_plan.snapshot AS "rewardPlanSnapshot"
       FROM transactions transaction
       JOIN transaction_service_fees fee ON fee.transaction_id = transaction.id
       JOIN transaction_reward_links reward_link
         ON reward_link.transaction_id = transaction.id
       JOIN reward_sources reward_source
         ON reward_source.id = reward_link.reward_source_id
       JOIN reward_plans reward_plan
         ON reward_plan.id = reward_link.reward_plan_id
       WHERE transaction.id = $1`,
      [fixture.transactionId],
    );
    return result.rows[0]!;
  }

  function expectCode(body: unknown, code: string): void {
    expect(body).toMatchObject({ error: { code } });
  }
});
