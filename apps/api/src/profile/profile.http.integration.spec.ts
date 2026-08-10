import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { accounts, markets, members, migrate } from '@ipoint/database';
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
import { AuthService } from '../auth/auth.service.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('Profile HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let database: DatabaseService;
  let rateLimiter: InMemoryRateLimiter;

  async function createMember() {
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
    const mInsert = await database.db
      .insert(members)
      .values({
        accountId: inserted[0]?.id ?? '',
        publicMemberId: `mem_${randomUUID()}`,
        referralCode: randomUUID()
          .replaceAll('-', '')
          .slice(0, 8)
          .toUpperCase(),
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    return {
      email,
      accountId: inserted[0]?.id ?? '',
      memberId: mInsert[0]?.id ?? '',
    };
  }

  async function getToken(email: string) {
    const r = await auth.login(email, 'Member-Password-123!');
    return r.accessToken;
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('AUTH_OTP_PEPPER', 'profile-http-pepper-at-least-32-characters');
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
    await database.db
      .insert(markets)
      .values({
        code: 'MY',
        name: 'MY Market',
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      })
      .onConflictDoNothing({ target: markets.code })
      .execute();
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    (
      rateLimiter as unknown as { buckets: Map<string, unknown> }
    ).buckets.clear();
  });

  describe('GET /api/v1/members/me/profile', () => {
    it('returns profile', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      const res = await supertest(server)
        .get('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body as { displayName: string }).toBeDefined();
    });

    it('returns 401 without auth', async () => {
      await supertest(server).get('/api/v1/members/me/profile').expect(401);
    });
  });

  describe('GET /api/v1/members/me', () => {
    it('returns the current member identity', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      const res = await supertest(server)
        .get('/api/v1/members/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body as { email: string }).toBeDefined();
      expect(res.body.email).toBe(email);
    });

    it('returns 400 (not 500) for an account without a member row (merchant account)', async () => {
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
      const token = await getToken(email);
      const res = await supertest(server)
        .get('/api/v1/members/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe(
        'PROFILE_NOT_FOUND',
      );
    });
  });

  describe('PATCH /api/v1/members/me/profile', () => {
    it('updates display name', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      await supertest(server)
        .patch('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Alice' })
        .expect(200);
    });

    it('rejects too short display name', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      await supertest(server)
        .patch('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'A' })
        .expect(400);
    });

    it('rejects future birth date', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      await supertest(server)
        .patch('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ birthDate: '2099-01-01' })
        .expect(400);
    });

    it('rejects under-18 birth date', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      await supertest(server)
        .patch('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ birthDate: '2015-06-01' })
        .expect(400);
    });

    it('rejects country field', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      await supertest(server)
        .patch('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ country: 'SG' })
        .expect(400);
    });

    it('rejects invalid phone', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      await supertest(server)
        .patch('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ phone: 'invalid' })
        .expect(400);
    });

    it('rejects invalid gender', async () => {
      const { email } = await createMember();
      const token = await getToken(email);
      await supertest(server)
        .patch('/api/v1/members/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ gender: 'other' })
        .expect(400);
    });
  });
});
