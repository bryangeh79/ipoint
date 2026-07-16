import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  mcpAccounts,
  merchantBranches,
  merchantKycSubmissions,
  merchantStatusHistory,
  migrate,
  roles,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module.js';
import { configureApplication } from '../../app.setup.js';
import { AuthService } from '../../auth/auth.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccessAdministrationService } from '../../platform-access/access-administration.service.js';
import { MarketService } from '../../platform-access/market.service.js';
import { MerchantService } from '../merchant.service.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('Merchant API integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let auth: AuthService;
  let merchants: MerchantService;
  let marketId: string;
  let branchId: string;
  let accountId: string;
  let merchantToken: string;
  let otherAccountToken: string;
  let adminToken: string;
  let unprivilegedAdminToken: string;
  const merchantEmail = `${randomUUID()}@example.com`;
  const merchantPassword = 'Merchant-Test-Password-123!';

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'merchant-integration-otp-pepper-32-characters',
    );
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'silent');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app, { enableShutdownHooks: false });
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    auth = app.get(AuthService);
    merchants = app.get(MerchantService);
    await migrate(database.pool);
    await seedFoundation(database.db);

    const marketService = app.get(MarketService);
    const market = await marketService.create(
      {
        code: `T${randomUUID().replaceAll('-', '').slice(0, 5)}`,
        name: 'Merchant API Test Market',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      },
      { adminUserId: randomUUID(), reason: 'Merchant integration test' },
    );
    marketId = market.id;
    await marketService.setStatus(marketId, 'ACTIVE', {
      adminUserId: randomUUID(),
      reason: 'Merchant integration test',
    });

    const administration = app.get(AccessAdministrationService);
    const authorizedAdmin = await createAdmin('Authorized Admin');
    const roleRows = await database.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'SUPER_ADMIN'));
    await administration.assignRole(
      authorizedAdmin.adminUserId,
      roleRows[0]?.id ?? '',
      { adminUserId: authorizedAdmin.adminUserId, reason: 'Test setup' },
    );
    await administration.grantMarketAccess(
      authorizedAdmin.adminUserId,
      marketId,
      { adminUserId: authorizedAdmin.adminUserId, reason: 'Test setup' },
    );
    adminToken = (
      await auth.login(authorizedAdmin.email, authorizedAdmin.password)
    ).accessToken;

    const unprivilegedAdmin = await createAdmin('Unprivileged Admin');
    unprivilegedAdminToken = (
      await auth.login(unprivilegedAdmin.email, unprivilegedAdmin.password)
    ).accessToken;

    const otherAccount = await createAccount('Other Merchant Account');
    otherAccountToken = (
      await auth.login(otherAccount.email, otherAccount.password)
    ).accessToken;
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('registers atomically with verified email and returns the same idempotent result', async () => {
    const otp = await auth.issueOtp({
      destination: merchantEmail,
      purpose: 'EMAIL_VERIFICATION',
    });
    const input = {
      email: merchantEmail,
      password: merchantPassword,
      otp_id: otp.id,
      otp_code: otp.code,
      market_id: marketId,
      account_country: 'MY',
      channel: 'of',
      display_name: 'Integration Merchant',
      phone: '+60123456789',
      address: {
        line_1: '1 Test Street',
        city: 'Kuala Lumpur',
        state: 'Kuala Lumpur',
        postcode: '50000',
        country_code: 'MY',
      },
      terms_version: 'merchant-terms-v1',
      locale: 'en-MY',
    };
    const first = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', randomUUID())
      .send(input)
      .expect(201);
    const firstBody = first.body as unknown as { branch_id: string };
    branchId = firstBody.branch_id;
    const idempotencyKey = randomUUID();
    const secondOtp = await auth.issueOtp({
      destination: `${randomUUID()}@example.com`,
      purpose: 'EMAIL_VERIFICATION',
    });
    const secondInput = {
      ...input,
      email: `${randomUUID()}@example.com`,
      otp_id: secondOtp.id,
      otp_code: secondOtp.code,
    };
    const original = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', idempotencyKey)
      .send(secondInput)
      .expect(201);
    const replay = await supertest(server)
      .post('/api/v1/merchant/register')
      .set('idempotency-key', idempotencyKey)
      .send(secondInput)
      .expect(201);
    expect(replay.body).toEqual(original.body);
    expect(first.body).toMatchObject({
      merchant_id: expect.stringMatching(/^[a-z0-9]+_of_\d{6}$/u),
      group_id: expect.any(String) as unknown,
    });

    const accountRows = await database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, merchantEmail));
    accountId = accountRows[0]?.id ?? '';
    merchantToken = (await auth.login(merchantEmail, merchantPassword))
      .accessToken;
  });

  it('enforces ownership, market matching, and immutable email at the API boundary', async () => {
    await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/profile`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .expect(200);
    await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/profile`)
      .set('authorization', `Bearer ${otherAccountToken}`)
      .set('x-market-id', marketId)
      .expect(403);
    await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/profile`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', randomUUID())
      .expect(403);
    await supertest(server)
      .patch(`/api/v1/merchant/branches/${branchId}/profile`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({ email: 'changed@example.com' })
      .expect(400);
    const accountRows = await database.db
      .select({ email: accounts.email })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(accountRows[0]?.email).toBe(merchantEmail);
  });

  it('denies an admin without the required permission', async () => {
    await supertest(server)
      .get(`/api/v1/admin/markets/${marketId}/merchants/applications`)
      .set('authorization', `Bearer ${unprivilegedAdminToken}`)
      .expect(403);
  });

  it('submits and reviews an immutable application independently from KYC and operational status', async () => {
    await supertest(server)
      .post(`/api/v1/merchant/branches/${branchId}/application/submit`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({ application_data: { registration_number: 'TEST-001' } })
      .expect(201);
    const review = await supertest(server)
      .post(
        `/api/v1/admin/markets/${marketId}/merchants/${branchId}/application/review`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ decision: 'APPROVED', reason: 'Application evidence accepted.' })
      .expect(200);
    expect(review.body).toMatchObject({
      application_status: 'APPROVED',
      operational_status: 'PENDING_KYC',
    });
  });

  it('computes activation status and records every operational transition', async () => {
    await database.db.insert(merchantKycSubmissions).values({
      merchantBranchId: branchId,
      status: 'APPROVED',
      submissionVersion: 1,
      submittedData: { test: true },
    });
    await database.db
      .update(mcpAccounts)
      .set({ availableBalance: '99.99999999', totalBalance: '99.99999999' })
      .where(eq(mcpAccounts.merchantBranchId, branchId));
    await expect(
      merchants.reevaluateOperationalStatus(
        branchId,
        { type: 'SYSTEM', id: randomUUID() },
        'KYC integration test.',
      ),
    ).resolves.toBe('PENDING_MCP');
    await database.db
      .update(mcpAccounts)
      .set({ availableBalance: '100.00000000', totalBalance: '100.00000000' })
      .where(eq(mcpAccounts.merchantBranchId, branchId));
    await expect(
      merchants.reevaluateOperationalStatus(
        branchId,
        { type: 'SYSTEM', id: randomUUID() },
        'MCP activation threshold reached.',
      ),
    ).resolves.toBe('ACTIVE');
    const history = await database.db
      .select({ status: merchantStatusHistory.newStatus })
      .from(merchantStatusHistory)
      .where(eq(merchantStatusHistory.merchantBranchId, branchId));
    expect(history.map((row) => row.status)).toEqual(
      expect.arrayContaining(['PENDING_KYC', 'PENDING_MCP', 'ACTIVE']),
    );
  });

  it('suspends without changing MCP, reactivates by policy, and closes terminally', async () => {
    const before = await database.db
      .select({ balance: mcpAccounts.availableBalance })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.merchantBranchId, branchId));
    await adminStatusAction('suspend', 'Operations hold.');
    await adminStatusAction('reactivate', 'Operations cleared.');
    const after = await database.db
      .select({ balance: mcpAccounts.availableBalance })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.merchantBranchId, branchId));
    expect(after[0]?.balance).toBe(before[0]?.balance);
    await adminStatusAction('close', 'Merchant closure approved.');
    const branches = await database.db
      .select({ status: merchantBranches.status })
      .from(merchantBranches)
      .where(eq(merchantBranches.id, branchId));
    expect(branches[0]?.status).toBe('CLOSED');
  });

  async function createAccount(label: string) {
    const email = `${randomUUID()}@example.com`;
    const password = `${label.replaceAll(' ', '-')}-Password-123!`;
    const rows = await database.db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email,
        accountCountry: 'MY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      })
      .returning({ id: accounts.id });
    const id = rows[0]?.id ?? '';
    await auth.setPassword(id, password);
    return { id, email, password };
  }

  async function createAdmin(label: string) {
    const account = await createAccount(label);
    const rows = await database.db
      .insert(adminUsers)
      .values({ accountId: account.id, displayName: label })
      .returning({ id: adminUsers.id });
    return { ...account, adminUserId: rows[0]?.id ?? '' };
  }

  async function adminStatusAction(action: string, reason: string) {
    await supertest(server)
      .post(`/api/v1/admin/markets/${marketId}/merchants/${branchId}/${action}`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ reason })
      .expect(200);
  }
});
