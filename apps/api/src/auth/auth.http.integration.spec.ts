import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { accounts, migrate } from '@ipoint/database';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { DatabaseService } from '../database/database.service.js';
import { AuthService } from './auth.service.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('Auth HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let database: DatabaseService;
  const originalPassword = 'Original-Password-123!';
  const replacementPassword = 'Replacement-Password-456!';

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
    await migrate(database.pool);
    auth = app.get(AuthService);
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

<<<<<<< Updated upstream
=======
  it('completes registration end-to-end with idempotent replay and login', async () => {
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

  it('completes member registration end-to-end with idempotent replay and login', async () => {
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

>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======

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
>>>>>>> Stashed changes
});
