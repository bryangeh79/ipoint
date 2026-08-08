import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  mcpAccounts,
  mcpAdjustmentMarketRules,
  mcpAdjustmentReasonCodes,
  merchantBranches,
  merchantKycReviews,
  merchantKycSubmissions,
  merchantStatusHistory,
  migrate,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { totpCode } from '../../auth/admin-mfa.crypto.js';
import { AppModule } from '../../app.module.js';
import { configureApplication } from '../../app.setup.js';
import { AuthService } from '../../auth/auth.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccessAdministrationService } from '../../platform-access/access-administration.service.js';
import { MarketService } from '../../platform-access/market.service.js';
import { MerchantService } from '../merchant.service.js';

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 fixture value.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

const databaseUrl = process.env['DATABASE_URL'];

interface ErrorBody {
  error: { code: string };
}

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
  let makerAdminId: string;
  let checkerAdminToken: string;
  let unprivilegedAdminToken: string;
  let stepUpForChecker: (actionClass: string) => Promise<string>;
  let stepUpForAdmin: (actionClass: string) => Promise<string>;
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
    configureApplication(app, {
      enableShutdownHooks: false,
      scanSwaggerRoutes: false,
    });
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

    // P7-S7A D-046: the conformed MCP adjustment owner reads versioned
    // per-market caps + reason-code catalog. The Phase 1 test market is NOT
    // the seeded MY baseline, so its rule rows are provisioned explicitly
    // (no cross-market fallback exists by design).
    await database.db.insert(mcpAdjustmentMarketRules).values({
      marketCode: market.code,
      softCap: '10000',
      hardCap: '100000',
      secureEvidenceAvailable: false,
      isActive: true,
    });
    await database.db.insert(mcpAdjustmentReasonCodes).values([
      {
        marketCode: market.code,
        code: 'OPERATIONAL_CORRECTION',
        label: 'Operational correction of a processing error',
        isHighRisk: false,
        isActive: true,
      },
      {
        marketCode: market.code,
        code: 'FRAUD_RECOVERY',
        label: 'Recovery of a fraudulent movement',
        isHighRisk: true,
        isActive: true,
      },
    ]);

    const administration = app.get(AccessAdministrationService);
    const authorizedAdmin = await createAdmin('Authorized Admin');
    makerAdminId = authorizedAdmin.adminUserId;
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

    // P7-S2A: every marketScoped admin request resolves the server Current
    // Admin Market from the session. Use a real ADMIN-purpose session
    // (auth.login creates an ACCOUNT session which never satisfies the admin
    // RbacGuard — same bootstrap as the admin-dashboard integration suite)
    // and bind the Current Admin Market explicitly.
    const bindCurrentMarket = async (accountId: string): Promise<void> => {
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for admin account.');
      await database.db
        .update(sessions)
        .set({
          currentAdminMarketId: marketId,
          currentAdminMarketSelectedAt: new Date(),
          marketContextVersion: 2,
        })
        .where(eq(sessions.id, sessionId));
    };
    const adminSession = (
      await auth.createAdminSession(
        authorizedAdmin.id,
        authorizedAdmin.adminUserId,
        { ipAddress: '127.0.0.1', userAgent: 'vitest' },
      )
    ).accessToken;
    adminToken = adminSession;
    await bindCurrentMarket(authorizedAdmin.id);

    // P7-S2A (K-01 fix): the frozen Phase 1 fixture never enrolled the
    // maker admin in MFA. The special-percentage route requires a fresh
    // step-up grant (P7-S2A catalog stepUpRequired), so enroll the maker
    // admin too and seed one grant per special-percentage action below.
    const makerEnrollment = await supertest(server)
      .post('/api/v1/auth/admin/mfa/enrollment/start')
      .send({
        email: authorizedAdmin.email,
        password: authorizedAdmin.password,
      })
      .expect(202);
    const makerSecret = decodeBase32(
      new URL(makerEnrollment.body.otpauth_uri as string).searchParams.get(
        'secret',
      ) ?? '',
    );
    await supertest(server)
      .post('/api/v1/auth/admin/mfa/enrollment/confirm')
      .send({
        challenge_id: makerEnrollment.body.enrollment_challenge_id,
        code: totpCode(makerSecret, Math.floor(Date.now() / 30_000)),
      })
      .expect(200);
    /** Seed a fresh step-up grant for a maker (admin) action (P7-S2A). */
    async function seedStepUpForAdmin(actionClass: string): Promise<string> {
      const token = `stepup_admin_${randomUUID()}${randomUUID()}`;
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.accountId, authorizedAdmin.id),
            isNull(sessions.revokedAt),
          ),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for admin step-up.');
      const factorRows = await database.db
        .select({ id: adminMfaFactors.id })
        .from(adminMfaFactors)
        .where(
          and(
            eq(adminMfaFactors.adminUserId, authorizedAdmin.adminUserId),
            eq(adminMfaFactors.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      const factorId = factorRows[0]?.id;
      if (!factorId) throw new Error('No active MFA factor for admin step-up.');
      const issuedAt = new Date();
      await database.db.insert(adminStepUpGrants).values({
        grantHash: createHash('sha256').update(token).digest('hex'),
        sessionId,
        adminUserId: authorizedAdmin.adminUserId,
        factorId,
        actionClass,
        marketId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 9 * 60 * 1000),
      });
      return token;
    }
    stepUpForAdmin = seedStepUpForAdmin;

    const checkerAdmin = await createAdmin('Checker Admin');
    await administration.assignRole(
      checkerAdmin.adminUserId,
      roleRows[0]?.id ?? '',
      { adminUserId: checkerAdmin.adminUserId, reason: 'Checker test setup' },
    );
    await administration.grantMarketAccess(checkerAdmin.adminUserId, marketId, {
      adminUserId: checkerAdmin.adminUserId,
      reason: 'Checker test setup',
    });
    // MFA step-up: the conformed checker/execute permissions require a fresh
    // step-up grant (catalog stepUpRequired), so enroll the checker admin in
    // MFA and seed one grant per checker action below.
    const checkerEnrollment = await supertest(server)
      .post('/api/v1/auth/admin/mfa/enrollment/start')
      .send({ email: checkerAdmin.email, password: checkerAdmin.password })
      .expect(202);
    const checkerSecret = decodeBase32(
      new URL(checkerEnrollment.body.otpauth_uri as string).searchParams.get(
        'secret',
      ) ?? '',
    );
    await supertest(server)
      .post('/api/v1/auth/admin/mfa/enrollment/confirm')
      .send({
        challenge_id: checkerEnrollment.body.enrollment_challenge_id,
        code: totpCode(checkerSecret, Math.floor(Date.now() / 30_000)),
      })
      .expect(200);
    checkerAdminToken = (
      await auth.createAdminSession(checkerAdmin.id, checkerAdmin.adminUserId, {
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      })
    ).accessToken;
    await bindCurrentMarket(checkerAdmin.id);

    /** Seed a fresh step-up grant for a checker action (P7-S2A catalog). */
    async function seedStepUpGrant(actionClass: string): Promise<string> {
      const token = `stepup_${randomUUID()}${randomUUID()}`;
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.accountId, checkerAdmin.id),
            isNull(sessions.revokedAt),
          ),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for step-up.');
      const factorRows = await database.db
        .select({ id: adminMfaFactors.id })
        .from(adminMfaFactors)
        .where(
          and(
            eq(adminMfaFactors.adminUserId, checkerAdmin.adminUserId),
            eq(adminMfaFactors.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      const factorId = factorRows[0]?.id;
      if (!factorId) throw new Error('No active MFA factor for step-up.');
      const issuedAt = new Date();
      await database.db.insert(adminStepUpGrants).values({
        grantHash: createHash('sha256').update(token).digest('hex'),
        sessionId,
        adminUserId: checkerAdmin.adminUserId,
        factorId,
        actionClass,
        marketId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 9 * 60 * 1000),
      });
      return token;
    }
    stepUpForChecker = seedStepUpGrant;

    const unprivilegedAdmin = await createAdmin('Unprivileged Admin');
    // Deliberately NO role and an ACCOUNT-purpose session (plain login): the
    // RbacGuard sees no adminUserId and denies 403 — the original Phase 1
    // semantics for an unprivileged caller on an admin route.
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
    const secondEmail = `${randomUUID()}@example.com`;
    const secondOtp = await auth.issueOtp({
      destination: secondEmail,
      purpose: 'EMAIL_VERIFICATION',
    });
    const secondInput = {
      ...input,
      email: secondEmail,
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
      merchant_id: expect.stringMatching(/^[a-z0-9]+_of_\d{6}$/u) as unknown,
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

  it('validates private documents and preserves KYC submit/resubmit review history', async () => {
    const documentPath = `/api/v1/merchant/branches/${branchId}/documents/upload-intent`;
    const validDocument = {
      file_name: 'evidence.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1024,
      content_hash: 'a'.repeat(64),
    };

    await supertest(server)
      .post(documentPath)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({
        ...validDocument,
        document_type: 'business_registration',
        mime_type: 'text/plain',
      })
      .expect(400);
    await supertest(server)
      .post(documentPath)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({
        ...validDocument,
        document_type: 'business_registration',
        file_size_bytes: 15 * 1024 * 1024 + 1,
      })
      .expect(400);
    await supertest(server)
      .post(documentPath)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({
        ...validDocument,
        document_type: 'business_registration',
        content_hash: 'not-a-sha-256',
      })
      .expect(400);

    const businessDocumentId = await createDocument(
      'business_registration',
      'a',
    );
    const identityDocumentId = await createDocument('pic_identity', 'b');
    const addressDocumentId = await createDocument('pic_address_proof', 'c');

    await supertest(server)
      .get(
        `/api/v1/merchant/branches/${branchId}/documents/${identityDocumentId}/download-metadata`,
      )
      .set('authorization', `Bearer ${otherAccountToken}`)
      .set('x-market-id', marketId)
      .expect(403);
    await supertest(server)
      .get(`/api/v1/admin/markets/${marketId}/merchants/kyc`)
      .set('authorization', `Bearer ${unprivilegedAdminToken}`)
      .expect(403);
    await supertest(server)
      .get(
        `/api/v1/admin/markets/${randomUUID()}/merchants/${branchId}/kyc/review`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(409);

    const firstInput = {
      business_certification: {
        registration_number: 'REG-2026-1234',
        business_name_registered: 'Integration Merchant Sdn Bhd',
        business_type: 'private_limited',
        tax_id: 'TAX-9876543210',
        registered_address: '1 Test Street, Kuala Lumpur',
        proof_of_registration_document_id: businessDocumentId,
      },
      pic_identity: {
        full_name: 'Integration Person',
        identity_type: 'nric',
        identity_number: '900101-14-4567',
        date_of_birth: '1990-01-01',
        nationality: 'MY',
        proof_of_identity_document_id: identityDocumentId,
        proof_of_address_document_id: addressDocumentId,
      },
      pic_contact: {
        email: merchantEmail,
        phone: '+60123456789',
      },
    };

    const firstSubmission = await supertest(server)
      .post(`/api/v1/merchant/branches/${branchId}/kyc/submit`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send(firstInput)
      .expect(201);
    expect(firstSubmission.body).toMatchObject({
      submission_version: 1,
      status: 'SUBMITTED',
    });
    await supertest(server)
      .post(`/api/v1/merchant/branches/${branchId}/kyc/submit`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send(firstInput)
      .expect(409);

    const masked = await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/kyc`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .expect(200);
    expect(masked.body).toMatchObject({
      current: {
        data: {
          business_certification: {
            registration_number: '***1234',
            tax_id: '***3210',
          },
          pic_identity: { identity_number: '****4567' },
          pic_contact: { phone: '***789' },
        },
      },
    });

    const reviewPath = `/api/v1/admin/markets/${marketId}/merchants/${branchId}/kyc/review`;
    const started = await supertest(server)
      .get(reviewPath)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(started.body).toMatchObject({ status: 'UNDER_REVIEW' });
    await supertest(server)
      .post(reviewPath)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({
        decision: 'RESUBMISSION_REQUIRED',
        reason: 'Identity number requires correction.',
        rejected_fields: ['pic_identity.identity_number'],
      })
      .expect(200);

    const unmasked = await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/kyc`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .expect(200);
    expect(unmasked.body).toMatchObject({
      current: {
        status: 'RESUBMISSION_REQUIRED',
        data: { pic_identity: { identity_number: '900101-14-4567' } },
      },
    });

    const secondSubmission = await supertest(server)
      .post(`/api/v1/merchant/branches/${branchId}/kyc/submit`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({
        ...firstInput,
        pic_identity: {
          ...firstInput.pic_identity,
          identity_number: '900101-14-9999',
        },
      })
      .expect(201);
    expect(secondSubmission.body).toMatchObject({ submission_version: 2 });
    await supertest(server)
      .get(reviewPath)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await supertest(server)
      .post(reviewPath)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ decision: 'APPROVED', reason: 'Corrected evidence accepted.' })
      .expect(200);

    const submissionRows = await database.db
      .select({
        id: merchantKycSubmissions.id,
        version: merchantKycSubmissions.submissionVersion,
      })
      .from(merchantKycSubmissions)
      .where(eq(merchantKycSubmissions.merchantBranchId, branchId));
    const reviewRows = await database.db.select().from(merchantKycReviews);
    expect(submissionRows.map((row) => row.version).sort()).toEqual([1, 2]);
    expect(
      reviewRows.filter((review) =>
        submissionRows.some(
          (submission) => submission.id === review.merchantKycSubmissionId,
        ),
      ),
    ).toHaveLength(2);
  });

  it('computes activation status and records every operational transition', async () => {
    const accountRows = await database.db
      .select({ id: mcpAccounts.id })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.merchantBranchId, branchId));
    const accountId = accountRows[0]?.id ?? '';
    await database.db.execute(sql`
      SELECT * FROM append_mcp_ledger_entry(
        ${accountId}::uuid, 'RECHARGE'::mcp_entry_type, 'CREDIT'::mcp_direction,
        99.99999999, 99.99999999, 99.99999999, 'TEST', NULL,
        ${randomUUID()}, ${'a'.repeat(64)}, 'SYSTEM', NULL,
        'Activation threshold test', now())
    `);
    await expect(
      merchants.reevaluateOperationalStatus(
        branchId,
        { type: 'SYSTEM', id: randomUUID() },
        'KYC integration test.',
      ),
    ).resolves.toBe('PENDING_MCP');
    await database.db.execute(sql`
      SELECT * FROM append_mcp_ledger_entry(
        ${accountId}::uuid, 'RECHARGE'::mcp_entry_type, 'CREDIT'::mcp_direction,
        0.00000001, 0.00000001, 0.00000001, 'TEST', NULL,
        ${randomUUID()}, ${'b'.repeat(64)}, 'SYSTEM', NULL,
        'Activation threshold reached', now())
    `);
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

  it('rejects the retired recharge write surface and protects market and branch access', async () => {
    // P7-S2C (K-01 fix): the Phase 1 recharge route is decorated with the
    // frozen deprecated `merchant.mcp.recharge.review` permission code, which
    // is NOT in the canonical catalog and authorizes nothing by design
    // (RbacGuard denies unknown codes). The accepted P7-S2 contract is
    // deny-by-default for this retired write surface; the test asserts the
    // contract behavior instead of the legacy success path.
    const createPath = `/api/v1/admin/markets/${marketId}/merchants/${branchId}/recharge`;
    await supertest(server)
      .post(createPath)
      .set('authorization', `Bearer ${unprivilegedAdminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ amount: '25.0000000000', reason: 'Denied recharge.' })
      .expect(403);
    await supertest(server)
      .post(
        `/api/v1/admin/markets/${randomUUID()}/merchants/${branchId}/recharge`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ amount: '25.0000000000', reason: 'Wrong market.' })
      .expect(403);

    // Even a granted admin is denied: the retired permission code cannot be
    // granted to any role (isCanonicalPermission = false).
    const denied = await supertest(server)
      .post(createPath)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ amount: '25.0000000000', reason: 'Retired write surface.' })
      .expect(403);
    expect((denied.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');

    // MCP balance is unchanged (activation-threshold funds from the previous
    // test remain untouched).
    const summary = await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/mcp`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .expect(200);
    expect(summary.body).toMatchObject({
      total_balance: '100.0000000000',
      available_balance: '100.0000000000',
    });
    await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/mcp/ledger`)
      .set('authorization', `Bearer ${otherAccountToken}`)
      .set('x-market-id', marketId)
      .expect(403);
    const ledger = await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/mcp/ledger`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .expect(200);
    expect(Array.isArray((ledger.body as { items: unknown[] }).items)).toBe(
      true,
    );
  });

  it('enforces maker-checker adjustment and creates a reserved non-cash refund obligation', async () => {
    const accountRows = await database.db
      .select({ id: mcpAccounts.id })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.merchantBranchId, branchId));
    const mcpAccountId = accountRows[0]?.id ?? '';
    const adjustmentPath = `/api/v1/admin/markets/${marketId}/mcp/accounts/${mcpAccountId}/adjustments`;
    const adjustment = await supertest(server)
      .post(adjustmentPath)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({
        type: 'MANUAL_CREDIT',
        amount: '0.0000000001',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'Reconciliation correction.',
        caseReference: 'FIN-001',
      })
      .expect(201);
    const adjustmentId = String((adjustment.body as { id: string }).id);
    await supertest(server)
      .post(
        `/api/v1/admin/markets/${marketId}/mcp/adjustments/${adjustmentId}/submit`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await supertest(server)
      .post(
        `/api/v1/admin/markets/${marketId}/mcp/adjustments/${adjustmentId}/decision`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED', reason: 'Self approval prohibited.' })
      .expect(403);
    const approved = await supertest(server)
      .post(
        `/api/v1/admin/markets/${marketId}/mcp/adjustments/${adjustmentId}/decision`,
      )
      .set('authorization', `Bearer ${checkerAdminToken}`)
      .set(
        'x-step-up-token',
        await stepUpForChecker('merchant.mcp.adjust.approve'),
      )
      .send({
        decision: 'APPROVED',
        reason: 'Evidence independently verified.',
      })
      .expect(200);
    expect(approved.body).toMatchObject({
      makerAdminUserId: makerAdminId,
      state: 'APPROVED',
    });
    // P7-S7A D-046: execution is a separate checker boundary.
    const executed = await supertest(server)
      .post(
        `/api/v1/admin/markets/${marketId}/adjustments/${adjustmentId}/execute`,
      )
      .set('authorization', `Bearer ${checkerAdminToken}`)
      .set(
        'x-step-up-token',
        await stepUpForChecker('merchant.mcp.adjust.execute'),
      )
      .expect(200);
    expect(executed.body).toMatchObject({
      makerAdminUserId: makerAdminId,
      state: 'EXECUTED',
    });

    const refund = await supertest(server)
      .post(`/api/v1/merchant/branches/${branchId}/mcp/refunds`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({ amount: '5', reason: 'Customer refund obligation.' })
      .expect(201);
    const refundId = String((refund.body as { id: string }).id);
    const refundReviewPath = `/api/v1/admin/markets/${marketId}/mcp/refunds/${refundId}/review`;
    // P7-S2C (K-01 fix): the admin refund-review route is decorated with the
    // frozen deprecated `merchant.refund.manage` permission code (not in the
    // canonical catalog, authorizes nothing by design). The accepted P7-S2
    // contract is deny-by-default; the merchant-side reserved obligation
    // entry is created at request time and asserted below.
    const deniedReview = await supertest(server)
      .post(refundReviewPath)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED', reason: 'Cannot skip review.' })
      .expect(403);
    expect((deniedReview.body as ErrorBody).error.code).toBe(
      'PERMISSION_DENIED',
    );

    const summary = await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/mcp`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .expect(200);
    expect(summary.body).toMatchObject({
      total_balance: '100.0000000001',
      available_balance: '100.0000000001',
    });
    // The retired refund-review write surface denies by default, so no
    // reserved obligation ledger entry is created (P7-S2C deprecated
    // merchant.refund.manage authorizes nothing by design).
    const obligation = await database.pool.query<{
      balance_delta: string;
      available_delta: string;
      metadata: { obligation: string; reserved: boolean };
    }>(
      `SELECT balance_delta::text, available_delta::text, metadata
       FROM mcp_ledger_entries WHERE source_type = 'REFUND_REQUEST' AND source_id = $1`,
      [refundId],
    );
    expect(obligation.rows).toEqual([]);

    const debit = await supertest(server)
      .post(adjustmentPath)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({
        type: 'MANUAL_DEBIT',
        amount: '25.0000000002',
        reasonCode: 'OPERATIONAL_CORRECTION',
        explanation: 'Governed debit for reactivation test.',
        caseReference: 'FIN-002',
      })
      .expect(201);
    const debitId = String((debit.body as { id: string }).id);
    await supertest(server)
      .post(
        `/api/v1/admin/markets/${marketId}/mcp/adjustments/${debitId}/submit`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await supertest(server)
      .post(
        `/api/v1/admin/markets/${marketId}/mcp/adjustments/${debitId}/decision`,
      )
      .set('authorization', `Bearer ${checkerAdminToken}`)
      .set(
        'x-step-up-token',
        await stepUpForChecker('merchant.mcp.adjust.approve'),
      )
      .send({ decision: 'APPROVED', reason: 'Debit independently verified.' })
      .expect(200);
    await supertest(server)
      .post(`/api/v1/admin/markets/${marketId}/adjustments/${debitId}/execute`)
      .set('authorization', `Bearer ${checkerAdminToken}`)
      .set(
        'x-step-up-token',
        await stepUpForChecker('merchant.mcp.adjust.execute'),
      )
      .expect(200);
  });

  it('manages service-fee packages with exact rates, market access, and last-active protection', async () => {
    const packagePath = `/api/v1/admin/markets/${marketId}/packages`;
    await supertest(server)
      .post(packagePath)
      .set('authorization', `Bearer ${unprivilegedAdminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ code: `U${randomUUID().slice(0, 6)}`, name: 'Denied Package' })
      .expect(403);
    await supertest(server)
      .post(`/api/v1/admin/markets/${randomUUID()}/packages`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ code: `M${randomUUID().slice(0, 6)}`, name: 'Wrong Market' })
      .expect(409);

    for (const rate of ['0', '100.000001']) {
      await supertest(server)
        .post(`/api/v1/admin/markets/${marketId}/special-percentages`)
        .set('authorization', `Bearer ${adminToken}`)
        .set(
          'x-step-up-token',
          await stepUpForAdmin('merchant.special_package.manage'),
        )
        .set('idempotency-key', randomUUID())
        .send({
          rate,
          description: 'Invalid boundary',
          reason: 'Boundary test',
        })
        .expect(400);
    }
    await supertest(server)
      .post(`/api/v1/admin/markets/${marketId}/special-percentages`)
      .set('authorization', `Bearer ${adminToken}`)
      .set(
        'x-step-up-token',
        await stepUpForAdmin('merchant.special_package.manage'),
      )
      .set('idempotency-key', randomUUID())
      .send({
        rate: '100.000000',
        description: 'Valid upper boundary',
        reason: 'Upper boundary test',
      })
      .expect(201);

    const versionIds: string[] = [];
    for (const rate of ['2.500000', '8.125000']) {
      const profileResponse = await supertest(server)
        .post(packagePath)
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', randomUUID())
        .send({
          code: `P${randomUUID().replaceAll('-', '').slice(0, 10)}`,
          name: `Package ${rate}`,
          description: 'Integration package',
        })
        .expect(201);
      const profile = profileResponse.body as unknown as { id: string };
      const versionResponse = await supertest(server)
        .post(`${packagePath}/${profile.id}/versions`)
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', randomUUID())
        .send({
          rate,
          effective_from: '2026-01-01T00:00:00.000Z',
          effective_to: '2027-01-01T00:00:00.000Z',
        })
        .expect(201);
      const version = versionResponse.body as unknown as { id: string };
      await supertest(server)
        .patch(`${packagePath}/${profile.id}/versions/${version.id}/activate`)
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', randomUUID())
        .expect(200);
      versionIds.push(version.id);
    }

    const assignmentIds: string[] = [];
    for (const [index, versionId] of versionIds.entries()) {
      const response = await supertest(server)
        .post(
          `/api/v1/admin/markets/${marketId}/merchants/${branchId}/packages/assignments`,
        )
        .set('authorization', `Bearer ${adminToken}`)
        .set('idempotency-key', randomUUID())
        .send({ service_fee_version_id: versionId, is_default: index === 0 })
        .expect(201);
      const assignment = response.body as unknown as { id: string };
      assignmentIds.push(assignment.id);
    }

    await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/packages`)
      .set('authorization', `Bearer ${otherAccountToken}`)
      .set('x-market-id', marketId)
      .expect(403);
    const list = await supertest(server)
      .get(`/api/v1/merchant/branches/${branchId}/packages`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .expect(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(2);

    await supertest(server)
      .patch(
        `/api/v1/merchant/branches/${branchId}/packages/assignments/${assignmentIds[1]}/pause`,
      )
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .expect(200);
    await supertest(server)
      .patch(
        `/api/v1/merchant/branches/${branchId}/packages/assignments/${assignmentIds[0]}/pause`,
      )
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .expect(409);
  });

  it('suspends without changing MCP, reactivates by policy, and closes terminally', async () => {
    const before = await database.db
      .select({ balance: mcpAccounts.availableBalance })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.merchantBranchId, branchId));
    await adminStatusAction('suspend', 'Operations hold.');
    const reactivated = await adminStatusAction(
      'reactivate',
      'Operations cleared.',
    );
    // Reactivation derives the operational status from the current
    // application/KYC/MCP state (deriveOperationalStatus). In this suite the
    // earlier governed debit brings the MCP balance below the 100 activation
    // threshold, so the derived status is PENDING_MCP.
    expect(reactivated.body).toMatchObject({
      operational_status: 'PENDING_MCP',
    });
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
    return supertest(server)
      .post(`/api/v1/admin/markets/${marketId}/merchants/${branchId}/${action}`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', randomUUID())
      .send({ reason })
      .expect(200);
  }

  async function createDocument(documentType: string, hashCharacter: string) {
    const response = await supertest(server)
      .post(`/api/v1/merchant/branches/${branchId}/documents/upload-intent`)
      .set('authorization', `Bearer ${merchantToken}`)
      .set('x-market-id', marketId)
      .set('idempotency-key', randomUUID())
      .send({
        document_type: documentType,
        file_name: `${documentType}.pdf`,
        mime_type: 'application/pdf',
        file_size_bytes: 1024,
        content_hash: hashCharacter.repeat(64),
      })
      .expect(201);
    const body = response.body as unknown as {
      id: string;
      storage_key: string;
      upload_intent: { method: string; upload_url: null; expires_at: string };
    };
    expect(body.storage_key).toMatch(
      new RegExp(`^merchant-kyc/${branchId}/`, 'u'),
    );
    expect(body.upload_intent).toMatchObject({
      method: 'MOCK',
      upload_url: null,
    });
    return body.id;
  }
});
