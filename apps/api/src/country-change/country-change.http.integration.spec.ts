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
import { DatabaseService } from '../database/database.service.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import { AuthService } from '../auth/auth.service.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('Country Change HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let database: DatabaseService;
  let rateLimiter: InMemoryRateLimiter;

  interface CountryChangeBody {
    id: string;
    currentCountry: string;
    requestedCountry: string;
    status: string;
    reason: string;
  }

  interface ErrorBody {
    error: { code: string };
  }

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
    await auth.setPassword(inserted[0]?.id ?? '', 'Member-Password-123!');
    return { email, accountId: inserted[0]?.id ?? '' };
  }

  async function createActiveMarket(code = 'MY') {
    const existing = await database.db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.code, code))
      .limit(1);
    if (existing[0]) {
      await database.db
        .update(markets)
        .set({ status: 'ACTIVE' })
        .where(eq(markets.id, existing[0].id));
      return existing[0].id;
    }
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

  async function createMemberAccount(): Promise<{
    email: string;
    accountId: string;
  }> {
    const { email, accountId } = await createAccount();
    await database.db.insert(members).values({
      accountId,
      publicMemberId: `mem_${randomUUID()}`,
      referralCode: randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(),
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    });
    return { email, accountId };
  }

  async function getAccessToken(email: string): Promise<string> {
    const result = await auth.login(email, 'Member-Password-123!');
    return result.accessToken;
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'country-change-http-pepper-at-least-32-characters',
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
    auth = app.get(AuthService);
    database = app.get(DatabaseService);
    rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);

    await migrate(database.pool);
    await createActiveMarket('MY');
    await createActiveMarket('SG');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    (
      rateLimiter as unknown as { buckets?: Map<string, unknown> }
    ).buckets?.clear();
  });

  describe('POST /api/v1/members/me/account-country-change', () => {
    it('submits a country change request successfully', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      const res = await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'SG',
          reason: 'Relocating for work',
        })
        .expect(200);

      const body = res.body as CountryChangeBody;
      expect(body.id).toBeDefined();
      expect(body.currentCountry).toBe('MY');
      expect(body.requestedCountry).toBe('SG');
      expect(body.status).toBe('PENDING');
      expect(body.reason).toBe('Relocating for work');
    });

    it('rejects when requested country is same as current', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      const res = await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'MY',
          reason: 'No change',
        })
        .expect(400);

      expect((res.body as ErrorBody).error.code).toBe(
        'COUNTRY_CHANGE_COUNTRY_SAME',
      );
    });

    it('rejects when a pending request already exists', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      // First request should succeed
      await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'SG',
          reason: 'Relocating for work',
        })
        .expect(200);

      // Second request should be rejected
      const res = await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'SG',
          reason: 'Changed my mind',
        })
        .expect(409);

      expect((res.body as ErrorBody).error.code).toBe(
        'COUNTRY_CHANGE_ALREADY_PENDING',
      );
    });

    it('rejects unauthenticated requests', async () => {
      await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .send({
          requested_country: 'SG',
          reason: 'Relocating',
        })
        .expect(401);
    });

    it('rejects invalid country codes', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'MYS',
          reason: 'Invalid code',
        })
        .expect(400);
    });

    it('rejects empty reason', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'SG',
          reason: '',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/members/me/account-country-change', () => {
    it('returns pending request for the member', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      // Submit request first
      await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'SG',
          reason: 'Relocating for work',
        })
        .expect(200);

      // List requests
      const res = await supertest(server)
        .get('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const body = res.body as CountryChangeBody[];
      expect(body).toHaveLength(1);
      const first = body[0]!;
      expect(first.status).toBe('PENDING');
      expect(first.currentCountry).toBe('MY');
      expect(first.requestedCountry).toBe('SG');
    });

    it('returns empty array when no requests exist', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      const res = await supertest(server)
        .get('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('DELETE /api/v1/members/me/account-country-change', () => {
    it('cancels a pending request successfully', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      // Submit request
      await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          requested_country: 'SG',
          reason: 'Relocating for work',
        })
        .expect(200);

      // Cancel it
      const res = await supertest(server)
        .delete('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect((res.body as CountryChangeBody).status).toBe('CANCELLED');
    });

    it('returns not found when no pending request exists', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      const res = await supertest(server)
        .delete('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      expect((res.body as ErrorBody).error.code).toBe(
        'COUNTRY_CHANGE_NOT_FOUND',
      );
    });

    it('returns an already cancelled request idempotently', async () => {
      const { email } = await createMemberAccount();
      const accessToken = await getAccessToken(email);

      // Submit and cancel
      await supertest(server)
        .post('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ requested_country: 'SG', reason: 'Moving' })
        .expect(200);

      await supertest(server)
        .delete('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Repeating the cancellation is idempotent.
      const res = await supertest(server)
        .delete('/api/v1/members/me/account-country-change')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect((res.body as CountryChangeBody).status).toBe('CANCELLED');
    });
  });
});
