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
  members,
  merchantAccountAccess,
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  migrate,
  rewardRuleVersions,
  serviceFeeProfiles,
  serviceFeeVersions,
  transactionPreviewSessions,
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
import type { TransactionPreviewResponse } from '../transaction.dto.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Transaction-Preview-Test-123!';

interface Fixture {
  marketId: string;
  otherMarketId: string;
  branchId: string;
  merchantAccountId: string;
  merchantToken: string;
  outsiderToken: string;
  memberId: string;
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
        id: fixture.assignmentId,
        name: 'Preview Package',
        rate: '10.000000',
      },
      serviceFeeRate: '10.000000',
      estimatedMcpDebit: '10.00',
      currentMcpBalance: '500.00',
      estimatedMcpBalanceAfter: '490.00',
      rewardRate: '0.0500000000',
      expectedDailyRewardAmount: '0.0500000000',
      rewardCap: '1000.0000000000',
      transactionMarket: {
        id: fixture.marketId,
        timezone: 'Asia/Kuala_Lumpur',
      },
    });
    expect(body.previewSessionId).toEqual(expect.any(String));
    expect(body.protectedMemberReference).not.toContain(fixture.memberId);

    const audit = await database.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, body.previewSessionId));
    expect(audit).toEqual([{ action: 'TRANSACTION_PREVIEW_CREATED' }]);
  });

  it('creates a valid Preview for a multi-package merchant with selection', async () => {
    const secondAssignmentId = await addSecondPackage();
    const response = await preview({ packageId: secondAssignmentId }).expect(
      201,
    );
    const body = previewBody(response);

    expect(body.selectedPackage).toMatchObject({
      id: secondAssignmentId,
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
      .where(eq(transactionPreviewSessions.id, body.previewSessionId));
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.expiresAt).not.toBeNull();
    expect(
      (row?.expiresAt?.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0),
    ).toBe(60 * 60 * 1000);
    expect(body.previewExpiresAt).toBe(row?.expiresAt?.toISOString());
  });

  function validPayload() {
    return {
      amount: '100.00',
      memberQrToken: fixture.qrToken,
      marketId: fixture.marketId,
      transactionNote: '',
    };
  }

  function preview(overrides: Record<string, unknown> = {}) {
    return supertest(server)
      .post('/api/v1/merchant/transactions/preview')
      .set('authorization', `Bearer ${fixture.merchantToken}`)
      .set('idempotency-key', randomUUID())
      .set('x-market-id', fixture.marketId)
      .send({ ...validPayload(), ...overrides });
  }

  async function createFixture(
    options: { mcpBalance?: string } = {},
  ): Promise<Fixture> {
    const marketId = await insertMarket();
    const otherMarketId = await insertMarket();
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
      otherMarketId,
      branchId,
      merchantAccountId,
      merchantToken,
      outsiderToken,
      memberId,
      qrToken,
      assignmentId,
    };
  }

  async function insertMarket(): Promise<string> {
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

  function expectErrorCode(body: unknown, code: string): void {
    expect(body).toMatchObject({ error: { code } });
  }

  function previewBody(response: {
    body: unknown;
  }): TransactionPreviewResponse {
    return response.body as TransactionPreviewResponse;
  }
});
