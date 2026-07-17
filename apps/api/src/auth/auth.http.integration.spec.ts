import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { accounts, markets, members, migrate } from '@ipoint/database';
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
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { AUTH_RATE_LIMITER } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { InMemoryRateLimiter } from './rate-limit.port.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('Auth HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let config: ConfigService;
  let database: DatabaseService;
  let rateLimiter: InMemoryRateLimiter;
  const originalPassword = 'Original-Password-123!';
  const replacementPassword = 'Replacement-Password-456!';
  const registrationPassword = 'Registration-Password-123!';

  async function createAccount() {
    const email = `${randomUUID()}@example.com`;
    const inserted = await database.db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    await auth.setPassword(inserted[0]?.id ?? '', originalPassword);
    return email;
  }

  async function createActiveMarket(code = 'MY') {
    const existing = await database.db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.code, code))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await database.db
      .insert(markets)
      .values({
        code,
        name: `${code} Market`,
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      })
      .returning({ id: markets.id });
    return inserted[0]?.id ?? '';
  }

  async function createMemberAccount(
    options: {
      status?: 'ACTIVE' | 'PENDING_EMAIL_VERIFICATION' | 'SUSPENDED' | 'CLOSED';
      kycLevel?: 'NONE' | 'LEVEL_1';
      closedAt?: Date | null;
    } = {},
  ) {
    const email = await createAccount();
    const accountRows = await database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);
    const accountId = accountRows[0]?.id ?? '';
    await database.db.insert(members).values({
      accountId,
      publicMemberId: `mem_${randomUUID()}`,
      referralCode: randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(),
      status: options.status ?? 'ACTIVE',
      kycLevel: options.kycLevel ?? 'LEVEL_1',
      ...(options.status === 'CLOSED'
        ? { closedAt: options.closedAt ?? new Date() }
        : {}),
    });
    return { email, accountId };
  }

  function buildMemberRegistrationPayload(
    email: string,
    overrides: Partial<{
      password: string;
      account_country: string;
      referral_code: string | null;
      terms_version: string;
      disclaimer_version: string;
      privacy_version: string;
      locale: string;
    }> = {},
  ) {
    return {
      email,
      password: registrationPassword,
      account_country: 'MY',
      referral_code: null,
      terms_version: 'v1',
      disclaimer_version: 'v1',
      privacy_version: 'v1',
      locale: 'en-MY',
      ...overrides,
    };
  }

  function expectErrorCode(body: unknown, code: string): void {
    expect(body).toMatchObject({
      error: {
        code,
      },
    });
  }

  async function initiateMemberRegistration(
    email: string,
    overrides: Parameters<typeof buildMemberRegistrationPayload>[1] = {},
  ) {
    const response = await supertest(server)
      .post('/api/v1/auth/member/register')
      .send(buildMemberRegistrationPayload(email, overrides))
      .expect(202);
    return response.body as {
      otp_id: string;
      development_code: string;
    };
  }

  async function verifyMemberRegistration(otpId: string, code: string) {
    return supertest(server)
      .post('/api/v1/auth/member/register/verify')
      .send({ otp_id: otpId, code })
      .expect(200)
      .expect({ verified: true });
  }

  async function completeMemberRegistration(
    otpId: string,
    idempotencyKey: string,
  ) {
    const response = await supertest(server)
      .post('/api/v1/auth/member/register/complete')
      .send({
        otp_id: otpId,
        idempotency_key: idempotencyKey,
      })
      .expect(200);
    return response.body as {
      accountId: string;
      memberId: string;
      publicMemberId: string;
      referralCode: string;
    };
  }

  async function registerActiveMember(
    overrides: {
      email?: string;
      account_country?: string;
      referral_code?: string | null;
      terms_version?: string;
      disclaimer_version?: string;
      privacy_version?: string;
      locale?: string;
    } = {},
  ) {
    await createActiveMarket(overrides.account_country ?? 'MY');
    const email = overrides.email ?? `${randomUUID()}@example.com`;
    const initiation = await initiateMemberRegistration(email, overrides);
    await verifyMemberRegistration(
      initiation.otp_id,
      initiation.development_code,
    );
    const idempotencyKey = `registration-${randomUUID()}`;
    const completion = await completeMemberRegistration(
      initiation.otp_id,
      idempotencyKey,
    );
    return { email, initiation, completion };
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'auth-http-integration-pepper-at-least-32-characters',
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
    config = app.get(ConfigService);
    rateLimiter = app.get(AUTH_RATE_LIMITER);
    await migrate(database.pool);
    auth = app.get(AuthService);
  });

  beforeEach(() => {
    (
      rateLimiter as unknown as { buckets?: Map<string, unknown> }
    ).buckets?.clear();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('issues and verifies an email OTP without claiming a real send', async () => {
    const email = `${randomUUID()}@example.com`;
    const issued = await supertest(server)
      .post('/api/v1/auth/otp/issue')
      .send({ destination: email, purpose: 'EMAIL_VERIFICATION' })
      .expect(202);
    expect(issued.body).toMatchObject({
      otp_id: expect.any(String) as unknown,
      development_code: expect.stringMatching(/^\d{6}$/u) as unknown,
      delivery_status: 'NOT_SENT',
    });
    await supertest(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        otp_id: String((issued.body as { otp_id: string }).otp_id),
        code: String(
          (issued.body as { development_code: string }).development_code,
        ),
      })
      .expect(200)
      .expect({ verified: true });
  });

  it('registers through HTTP with idempotent replay and login', async () => {
    await createActiveMarket();
    const email = `${randomUUID()}@example.com`;
    const password = 'Registration-Password-123!';
    const initiation = await supertest(server)
      .post('/api/v1/auth/registration/initiate')
      .send({
        email,
        password,
        account_country: 'MY',
        referral_code: null,
        terms_version: 'v1',
        disclaimer_version: 'v1',
        privacy_version: 'v1',
        locale: 'en-MY',
      })
      .expect(202);
    const initiationBody = initiation.body as {
      otp_id: string;
      development_code: string;
    };
    await supertest(server)
      .post('/api/v1/auth/registration/verify')
      .send({
        otp_id: initiationBody.otp_id,
        code: initiationBody.development_code,
      })
      .expect(200)
      .expect({ verified: true });
    const idempotencyKey = randomUUID();
    const completed = await supertest(server)
      .post('/api/v1/auth/registration/complete')
      .send({
        otp_id: initiationBody.otp_id,
        idempotency_key: idempotencyKey,
      })
      .expect(200);
    const replayed = await supertest(server)
      .post('/api/v1/auth/registration/complete')
      .send({
        otp_id: initiationBody.otp_id,
        idempotency_key: idempotencyKey,
      })
      .expect(200);
    expect(replayed.body).toEqual(completed.body);
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
  });

  it('registers through the member route with idempotent replay and login', async () => {
    await createActiveMarket();
    const email = `${randomUUID()}@example.com`;
    const password = 'Member-Registration-Password-123!';
    const initiation = await supertest(server)
      .post('/api/v1/auth/member/register')
      .send({
        email,
        password,
        account_country: 'MY',
        referral_code: null,
        terms_version: 'v1',
        disclaimer_version: 'v1',
        privacy_version: 'v1',
        locale: 'en-MY',
      })
      .expect(202);
    const initiationBody = initiation.body as {
      otp_id: string;
      development_code: string;
    };
    await supertest(server)
      .post('/api/v1/auth/member/register/verify')
      .send({
        otp_id: initiationBody.otp_id,
        code: initiationBody.development_code,
      })
      .expect(200)
      .expect({ verified: true });
    const idempotencyKey = randomUUID();
    const completed = await supertest(server)
      .post('/api/v1/auth/member/register/complete')
      .send({
        otp_id: initiationBody.otp_id,
        idempotency_key: idempotencyKey,
      })
      .expect(200);
    const replayed = await supertest(server)
      .post('/api/v1/auth/member/register/complete')
      .send({
        otp_id: initiationBody.otp_id,
        idempotency_key: idempotencyKey,
      })
      .expect(200);
    expect(replayed.body).toEqual(completed.body);
    await supertest(server)
      .post('/api/v1/auth/member/login')
      .send({ email, password })
      .expect(200);
  });

  it('resets a password through HTTP and rotates credentials', async () => {
    const email = await createAccount();
    const initiation = await supertest(server)
      .post('/api/v1/auth/password-reset/initiate')
      .send({ email })
      .expect(202);
    const initiationBody = initiation.body as {
      otp_id: string;
      development_code: string;
    };
    await supertest(server)
      .post('/api/v1/auth/password-reset/verify')
      .send({
        otp_id: initiationBody.otp_id,
        code: initiationBody.development_code,
      })
      .expect(200)
      .expect({ verified: true });
    const idempotencyKey = randomUUID();
    await supertest(server)
      .post('/api/v1/auth/password-reset/complete')
      .send({
        otp_id: initiationBody.otp_id,
        new_password: replacementPassword,
        idempotency_key: idempotencyKey,
      })
      .expect(204);
    await supertest(server)
      .post('/api/v1/auth/password-reset/complete')
      .send({
        otp_id: initiationBody.otp_id,
        new_password: replacementPassword,
        idempotency_key: idempotencyKey,
      })
      .expect(204);
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(401);
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: replacementPassword })
      .expect(200);
  });

  it('logs in, rotates once, logs out, and denies invalid credentials', async () => {
    const email = await createAccount();
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Wrong-Password-123!' })
      .expect(401);
    const login = await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(200);
    const refreshToken = String(
      (login.body as { refreshToken: string }).refreshToken,
    );
    const rotated = await supertest(server)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);
    await supertest(server)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(401);
    await supertest(server)
      .post('/api/v1/auth/logout')
      .set(
        'authorization',
        `Bearer ${String((rotated.body as { accessToken: string }).accessToken)}`,
      )
      .expect(401);
    const logoutSession = await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(200);
    const logoutToken = String(
      (logoutSession.body as { accessToken: string }).accessToken,
    );
    await supertest(server)
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${logoutToken}`)
      .expect(204);
    await supertest(server)
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${logoutToken}`)
      .expect(401);
  });

  it('logs in through the member login route alias', async () => {
    const email = await createAccount();
    await supertest(server)
      .post('/api/v1/auth/member/login')
      .send({ email, password: originalPassword })
      .expect(200);
    await supertest(server)
      .post('/api/v1/auth/member/login')
      .send({ email, password: 'Wrong-Password-123!' })
      .expect(401);
  });

  it('resets a password with a verified account-bound OTP and revokes sessions', async () => {
    const email = await createAccount();
    const active = await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(200);
    const issued = await supertest(server)
      .post('/api/v1/auth/otp/issue')
      .send({ destination: email, purpose: 'PASSWORD_RESET' })
      .expect(202);
    const body = issued.body as {
      otp_id: string;
      development_code: string;
    };
    await supertest(server)
      .post('/api/v1/auth/otp/verify')
      .send({ otp_id: body.otp_id, code: body.development_code })
      .expect(200);
    await supertest(server)
      .post('/api/v1/auth/password/reset')
      .send({ otp_id: body.otp_id, new_password: replacementPassword })
      .expect(204);
    await supertest(server)
      .post('/api/v1/auth/logout')
      .set(
        'authorization',
        `Bearer ${String((active.body as { accessToken: string }).accessToken)}`,
      )
      .expect(401);
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(401);
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: replacementPassword })
      .expect(200);
  });

  it('completes password reset end-to-end via HTTP', async () => {
    const email = await createAccount();
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(200);
    const initiation = await supertest(server)
      .post('/api/v1/auth/password-reset/initiate')
      .send({ email })
      .expect(202);
    const initiationBody = initiation.body as {
      otp_id: string;
      development_code: string;
    };
    await supertest(server)
      .post('/api/v1/auth/password-reset/verify')
      .send({
        otp_id: initiationBody.otp_id,
        code: initiationBody.development_code,
      })
      .expect(200)
      .expect({ verified: true });
    await supertest(server)
      .post('/api/v1/auth/password-reset/complete')
      .send({
        otp_id: initiationBody.otp_id,
        new_password: replacementPassword,
        idempotency_key: randomUUID(),
      })
      .expect(204);
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: originalPassword })
      .expect(401);
    await supertest(server)
      .post('/api/v1/auth/login')
      .send({ email, password: replacementPassword })
      .expect(200);
  });

  it('completes member password reset end-to-end via HTTP', async () => {
    const email = await createAccount();
    await supertest(server)
      .post('/api/v1/auth/member/login')
      .send({ email, password: originalPassword })
      .expect(200);
    const initiation = await supertest(server)
      .post('/api/v1/auth/member/password-reset/request')
      .send({ email })
      .expect(202);
    const initiationBody = initiation.body as {
      otp_id: string;
      development_code: string;
    };
    await supertest(server)
      .post('/api/v1/auth/member/password-reset/verify')
      .send({
        otp_id: initiationBody.otp_id,
        code: initiationBody.development_code,
      })
      .expect(200)
      .expect({ verified: true });
    await supertest(server)
      .post('/api/v1/auth/member/password-reset/complete')
      .send({
        otp_id: initiationBody.otp_id,
        new_password: replacementPassword,
        idempotency_key: randomUUID(),
      })
      .expect(204);
    await supertest(server)
      .post('/api/v1/auth/member/login')
      .send({ email, password: originalPassword })
      .expect(401);
    await supertest(server)
      .post('/api/v1/auth/member/login')
      .send({ email, password: replacementPassword })
      .expect(200);
  });

  describe('member registration edge cases', () => {
    beforeEach(async () => {
      await createActiveMarket();
    });

    it('runs the full member registration flow and logs in successfully', async () => {
      const email = `${randomUUID()}@example.com`;
      const initiation = await initiateMemberRegistration(email);
      await verifyMemberRegistration(
        initiation.otp_id,
        initiation.development_code,
      );
      const idempotencyKey = `registration-${randomUUID()}`;
      const completed = await completeMemberRegistration(
        initiation.otp_id,
        idempotencyKey,
      );
      expect(completed).toMatchObject({
        accountId: expect.any(String) as unknown,
        memberId: expect.any(String) as unknown,
      });
      const login = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: registrationPassword })
        .expect(200);
      expect(login.body).toMatchObject({
        accessToken: expect.any(String) as unknown,
        refreshToken: expect.any(String) as unknown,
      });
    });

    it('normalizes registration email addresses to lowercase', async () => {
      const mixedCaseEmail = `Test.User+${randomUUID().slice(0, 8)}@Example.Com`;
      const normalizedEmail = mixedCaseEmail.toLowerCase();
      const initiation = await initiateMemberRegistration(mixedCaseEmail);
      await verifyMemberRegistration(
        initiation.otp_id,
        initiation.development_code,
      );
      await completeMemberRegistration(
        initiation.otp_id,
        `email-normalization-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      );
      const accountRows = await database.db
        .select({ email: accounts.email })
        .from(accounts)
        .where(eq(accounts.email, normalizedEmail))
        .limit(1);
      expect(accountRows[0]?.email).toBe(normalizedEmail);
      await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: normalizedEmail, password: registrationPassword })
        .expect(200);
    });

    it('rejects invalid account country codes during registration', async () => {
      const email = `${randomUUID()}@example.com`;
      const response = await supertest(server)
        .post('/api/v1/auth/member/register')
        .send(
          buildMemberRegistrationPayload(email, {
            account_country: 'XYZ',
          }),
        )
        .expect(400);
      expectErrorCode(response.body, 'VALIDATION_ERROR');
    });

    it('rejects registration when the target market is disabled', async () => {
      const email = `${randomUUID()}@example.com`;
      await database.db
        .update(markets)
        .set({ status: 'INACTIVE' })
        .where(eq(markets.code, 'SG'));
      const initiation = await initiateMemberRegistration(email, {
        account_country: 'SG',
      });
      await verifyMemberRegistration(
        initiation.otp_id,
        initiation.development_code,
      );
      const response = await supertest(server)
        .post('/api/v1/auth/member/register/complete')
        .send({
          otp_id: initiation.otp_id,
          idempotency_key: `sg-disabled-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
        })
        .expect(400);
      expectErrorCode(response.body, 'AUTH_MARKET_INVALID');
    });

    it('accepts a valid referral code format during registration', async () => {
      const email = `${randomUUID()}@example.com`;
      const response = await supertest(server)
        .post('/api/v1/auth/member/register')
        .send(
          buildMemberRegistrationPayload(email, {
            referral_code: 'ABCD1234',
          }),
        )
        .expect(202);
      expect(response.body).toMatchObject({
        otp_id: expect.any(String) as unknown,
        development_code: expect.any(String) as unknown,
      });
    });

    it('rejects referral codes with invalid characters', async () => {
      const email = `${randomUUID()}@example.com`;
      const response = await supertest(server)
        .post('/api/v1/auth/member/register')
        .send(
          buildMemberRegistrationPayload(email, {
            referral_code: 'BAD!CODE',
          }),
        )
        .expect(400);
      expectErrorCode(response.body, 'VALIDATION_ERROR');
    });

    it('rejects an incorrect registration OTP code', async () => {
      const email = `${randomUUID()}@example.com`;
      const initiation = await initiateMemberRegistration(email);
      const wrongCode =
        initiation.development_code === '999999' ? '000000' : '999999';
      const response = await supertest(server)
        .post('/api/v1/auth/member/register/verify')
        .send({
          otp_id: initiation.otp_id,
          code: wrongCode,
        })
        .expect(400);
      expectErrorCode(response.body, 'AUTH_OTP_INVALID');
    });

    it('rejects OTP reuse after registration completion', async () => {
      const { initiation } = await registerActiveMember();
      const response = await supertest(server)
        .post('/api/v1/auth/member/register/verify')
        .send({
          otp_id: initiation.otp_id,
          code: initiation.development_code,
        })
        .expect(400);
      expectErrorCode(response.body, 'AUTH_OTP_INVALID');
    });

    it('enforces the registration OTP resend cooldown', async () => {
      const email = `${randomUUID()}@example.com`;
      for (
        let attempt = 0;
        attempt < config.authRegistrationEmailRateLimitCount;
        attempt += 1
      ) {
        await initiateMemberRegistration(email);
      }
      const response = await supertest(server)
        .post('/api/v1/auth/member/register')
        .send(buildMemberRegistrationPayload(email))
        .expect(429);
      expectErrorCode(response.body, 'AUTH_RATE_LIMITED');
    });

    it('supports registration completion idempotency and conflicts across keys', async () => {
      const email = `${randomUUID()}@example.com`;
      const initiation = await initiateMemberRegistration(email);
      await verifyMemberRegistration(
        initiation.otp_id,
        initiation.development_code,
      );
      const firstIdempotencyKey = `registration-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const completed = await completeMemberRegistration(
        initiation.otp_id,
        firstIdempotencyKey,
      );
      const replayed = await completeMemberRegistration(
        initiation.otp_id,
        firstIdempotencyKey,
      );
      expect(replayed).toEqual(completed);
      const response = await supertest(server)
        .post('/api/v1/auth/member/register/complete')
        .send({
          otp_id: initiation.otp_id,
          idempotency_key: `different-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
        })
        .expect(409);
      expectErrorCode(response.body, 'AUTH_IDEMPOTENCY_CONFLICT');
    });

    it('rejects registration when required consent versions are missing', async () => {
      const email = `${randomUUID()}@example.com`;
      for (const field of [
        'terms_version',
        'disclaimer_version',
        'privacy_version',
      ] as const) {
        const payload = buildMemberRegistrationPayload(email, {
          [field]: undefined,
        } as Partial<ReturnType<typeof buildMemberRegistrationPayload>>);
        const response = await supertest(server)
          .post('/api/v1/auth/member/register')
          .send(payload)
          .expect(400);
        expectErrorCode(response.body, 'VALIDATION_ERROR');
      }
    });

    it('does not leak sensitive fields from registration completion', async () => {
      const { completion } = await registerActiveMember();
      expect(completion).not.toHaveProperty('password');
      expect(completion).not.toHaveProperty('secret_hash');
      expect(completion).not.toHaveProperty('credential');
      expect(completion).not.toHaveProperty('otp_code');
      expect(JSON.stringify(completion)).not.toMatch(
        /password|secret_hash|credential|otp_code/iu,
      );
    });
  });

  describe('member login edge cases', () => {
    it('allows active members to log in through the member route', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(200);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String) as unknown,
        refreshToken: expect.any(String) as unknown,
      });
    });

    it('rejects login for PENDING_EMAIL_VERIFICATION members', async () => {
      const { email } = await createMemberAccount({
        status: 'PENDING_EMAIL_VERIFICATION',
        kycLevel: 'NONE',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(403);
      expectErrorCode(response.body, 'AUTH_MEMBER_INACTIVE');
    });

    it('rejects login for SUSPENDED members', async () => {
      const { email } = await createMemberAccount({
        status: 'SUSPENDED',
        kycLevel: 'LEVEL_1',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(403);
      expectErrorCode(response.body, 'AUTH_MEMBER_INACTIVE');
    });

    it('rejects login for CLOSED members', async () => {
      const { email } = await createMemberAccount({
        status: 'CLOSED',
        kycLevel: 'LEVEL_1',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(403);
      expectErrorCode(response.body, 'AUTH_MEMBER_INACTIVE');
    });

    it('rejects wrong passwords for member login', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: 'Wrong-Password-123!' })
        .expect(401);
      expectErrorCode(response.body, 'AUTH_INVALID_CREDENTIALS');
    });

    it('returns the same invalid-credentials error for unknown email and wrong password', async () => {
      const known = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const wrongPasswordResponse = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: known.email, password: 'Wrong-Password-123!' })
        .expect(401);
      const unknownEmailResponse = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({
          email: `${randomUUID()}@example.com`,
          password: 'Wrong-Password-123!',
        })
        .expect(401);
      expect(wrongPasswordResponse.body).toMatchObject({
        error: { code: 'AUTH_INVALID_CREDENTIALS' },
      });
      expectErrorCode(unknownEmailResponse.body, 'AUTH_INVALID_CREDENTIALS');
      const unknownEmailBody = unknownEmailResponse.body as {
        error: { code: string };
      };
      const wrongPasswordBody = wrongPasswordResponse.body as {
        error: { code: string };
      };
      expect(unknownEmailBody.error.code).toBe(wrongPasswordBody.error.code);
    });

    it('does not expose sensitive fields in the member login response body', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(200);
      expect(response.body).not.toHaveProperty('email');
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('otp');
      expect(response.body).not.toHaveProperty('kyc');
      expect(JSON.stringify(response.body)).not.toMatch(
        /email|password|otp|kyc/iu,
      );
    });
  });

  describe('member refresh and logout flows', () => {
    it('rotates member refresh tokens normally', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const login = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(200);
      const rotated = await supertest(server)
        .post('/api/v1/auth/member/refresh')
        .send({
          refresh_token: String(
            (login.body as { refreshToken: string }).refreshToken,
          ),
        })
        .expect(200);
      expect(rotated.body).toMatchObject({
        accessToken: expect.any(String) as unknown,
        refreshToken: expect.any(String) as unknown,
      });
      const rotatedBody = rotated.body as { refreshToken: string };
      expect(rotatedBody.refreshToken).not.toBe(
        (login.body as { refreshToken: string }).refreshToken,
      );
    });

    it('rejects replay of an old member refresh token after rotation', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const login = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(200);
      const originalRefreshToken = String(
        (login.body as { refreshToken: string }).refreshToken,
      );
      await supertest(server)
        .post('/api/v1/auth/member/refresh')
        .send({ refresh_token: originalRefreshToken })
        .expect(200);
      const response = await supertest(server)
        .post('/api/v1/auth/member/refresh')
        .send({ refresh_token: originalRefreshToken })
        .expect(401);
      expectErrorCode(response.body, 'AUTH_REFRESH_REUSED');
    });

    it('rejects refresh after the current member session is logged out', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const login = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(200);
      const accessToken = String(
        (login.body as { accessToken: string }).accessToken,
      );
      const refreshToken = String(
        (login.body as { refreshToken: string }).refreshToken,
      );
      await supertest(server)
        .post('/api/v1/auth/member/logout')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(204);
      const response = await supertest(server)
        .post('/api/v1/auth/member/refresh')
        .send({ refresh_token: refreshToken })
        .expect(401);
      expectErrorCode(response.body, 'AUTH_REFRESH_REUSED');
    });

    it('rejects repeat member logout after the session has been revoked', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const login = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(200);
      const accessToken = String(
        (login.body as { accessToken: string }).accessToken,
      );
      await supertest(server)
        .post('/api/v1/auth/member/logout')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(204);
      const response = await supertest(server)
        .post('/api/v1/auth/member/logout')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(401);
      expectErrorCode(response.body, 'AUTH_SESSION_INVALID');
    });
  });

  describe('member password reset edge cases', () => {
    it('returns a neutral response for unknown password-reset emails', async () => {
      const response = await supertest(server)
        .post('/api/v1/auth/member/password-reset/request')
        .send({ email: `${randomUUID()}@example.com` })
        .expect(202);
      expect(response.body).toMatchObject({
        otp_id: expect.any(String) as unknown,
        development_code: expect.any(String) as unknown,
      });
    });

    it('verifies a member password-reset OTP, completes the reset, and rotates credentials', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const login = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(200);
      const refreshToken = String(
        (login.body as { refreshToken: string }).refreshToken,
      );
      const initiation = await supertest(server)
        .post('/api/v1/auth/member/password-reset/request')
        .send({ email })
        .expect(202);
      const body = initiation.body as {
        otp_id: string;
        development_code: string;
      };
      await supertest(server)
        .post('/api/v1/auth/member/password-reset/verify')
        .send({ otp_id: body.otp_id, code: body.development_code })
        .expect(200)
        .expect({ verified: true });
      await supertest(server)
        .post('/api/v1/auth/member/password-reset/complete')
        .send({
          otp_id: body.otp_id,
          new_password: replacementPassword,
          idempotency_key: `pw-reset-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
        })
        .expect(204);
      await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: originalPassword })
        .expect(401);
      await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email, password: replacementPassword })
        .expect(200);
      const refreshResponse = await supertest(server)
        .post('/api/v1/auth/member/refresh')
        .send({ refresh_token: refreshToken })
        .expect(401);
      expectErrorCode(refreshResponse.body, 'AUTH_REFRESH_REUSED');
    });

    it('rejects using a registration OTP for password reset verification', async () => {
      const email = `${randomUUID()}@example.com`;
      await createActiveMarket();
      const initiation = await initiateMemberRegistration(email);
      const response = await supertest(server)
        .post('/api/v1/auth/member/password-reset/verify')
        .send({
          otp_id: initiation.otp_id,
          code: initiation.development_code,
        })
        .expect(400);
      expectErrorCode(response.body, 'AUTH_OTP_INVALID');
    });

    it('rejects reusing a password-reset OTP after completion', async () => {
      const { email } = await createMemberAccount({
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      });
      const initiation = await supertest(server)
        .post('/api/v1/auth/member/password-reset/request')
        .send({ email })
        .expect(202);
      const body = initiation.body as {
        otp_id: string;
        development_code: string;
      };
      await supertest(server)
        .post('/api/v1/auth/member/password-reset/verify')
        .send({ otp_id: body.otp_id, code: body.development_code })
        .expect(200)
        .expect({ verified: true });
      await supertest(server)
        .post('/api/v1/auth/member/password-reset/complete')
        .send({
          otp_id: body.otp_id,
          new_password: replacementPassword,
          idempotency_key: `pw-reuse-${randomUUID().replaceAll('-', '').slice(0, 8)}`,
        })
        .expect(204);
      const response = await supertest(server)
        .post('/api/v1/auth/member/password-reset/verify')
        .send({ otp_id: body.otp_id, code: body.development_code })
        .expect(400);
      expectErrorCode(response.body, 'AUTH_OTP_INVALID');
    });
  });
});
