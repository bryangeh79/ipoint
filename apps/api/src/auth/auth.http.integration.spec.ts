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
  const email = `${randomUUID()}@example.com`;
  const originalPassword = 'Original-Password-123!';
  const replacementPassword = 'Replacement-Password-456!';

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
    const database = app.get(DatabaseService);
    await migrate(database.pool);
    const inserted = await database.db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    auth = app.get(AuthService);
    await auth.setPassword(inserted[0]?.id ?? '', originalPassword);
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('issues and verifies an email OTP without claiming a real send', async () => {
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

  it('logs in, rotates once, logs out, and denies invalid credentials', async () => {
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

  it('resets a password with a verified account-bound OTP and revokes sessions', async () => {
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
});
