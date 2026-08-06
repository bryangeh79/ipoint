// ---------------------------------------------------------------------------
// O-13 security remediation — member-facing reward rule creation route removed
//
// `POST /api/v1/rewards/rules` must be gone (404) for every actor:
//   - unauthenticated callers
//   - authenticated member accounts (the previously exposed attack surface)
//
// The secured creation surface (`AdminRewardService.createRuleVersion` via
// `/api/v1/admin/reward-ops/...`) is covered by its own suites (P7-S6B,
// admin-reward owner) and is intentionally NOT re-tested here.
//
// Read routes under `/api/v1/rewards/*` are retained and must still work.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  members,
  migrate,
  rewardRuleVersions,
} from '@ipoint/database';
import { eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import { Pool } from 'pg';
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
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'O13-Member-Password-123!';

describe.skipIf(!databaseUrl)('Reward O-13 member rule route removal', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let database: DatabaseService;
  let rateLimiter: InMemoryRateLimiter;

  async function createMemberAccount(): Promise<string> {
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
    const accountId = inserted[0]?.id ?? '';
    await auth.setPassword(accountId, password);
    await database.db.insert(members).values({
      accountId,
      publicMemberId: `mem_${randomUUID()}`,
      referralCode: randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(),
      status: 'ACTIVE',
      kycLevel: 'LEVEL_1',
    });
    return email;
  }

  async function memberToken(): Promise<string> {
    const email = await createMemberAccount();
    const login = await supertest(server)
      .post('/api/v1/auth/member/login')
      .send({ email, password })
      .expect(200);
    return String((login.body as { accessToken: string }).accessToken);
  }

  function createPayload() {
    return {
      name: 'O-13 Probe Rule',
      rewardRate: '0.05',
      capType: 'NONE',
      capValue: '0',
      minimumReward: '0',
      effectiveFrom: '2026-08-01T00:00:00.000Z',
    };
  }

  async function ruleVersionCount(): Promise<number> {
    const rows = await database.db
      .select({ id: rewardRuleVersions.id })
      .from(rewardRuleVersions);
    return rows.length;
  }

  beforeAll(async () => {
    // Fresh isolated database (task-mandated: DROP/CREATE + migrate).
    const dbName = new URL(databaseUrl ?? '').pathname.replace(/^\//u, '');
    const maintenanceUrl = (databaseUrl ?? '').replace(
      /\/[^/]+$/u,
      '/postgres',
    );
    const admin = new Pool({ connectionString: maintenanceUrl });
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();

    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'reward-o13-route-pepper-at-least-32-characters',
    );
    vi.stubEnv(
      'REDEMPTION_VOUCHER_ENCRYPTION_KEY',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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
    rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
    await migrate(database.pool);
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

  describe('POST /api/v1/rewards/rules (removed)', () => {
    it('returns 404 for unauthenticated callers', async () => {
      await supertest(server)
        .post('/api/v1/rewards/rules')
        .send(createPayload())
        .expect(404);
    });

    it('returns 404 for authenticated member accounts (no insert)', async () => {
      const token = await memberToken();
      const before = await ruleVersionCount();

      await supertest(server)
        .post('/api/v1/rewards/rules')
        .set('authorization', `Bearer ${token}`)
        .send(createPayload())
        .expect(404);

      const after = await ruleVersionCount();
      expect(after).toBe(before);
      expect(after).toBe(0);
    });
  });

  describe('read routes retained', () => {
    it('GET /api/v1/rewards/rules still returns 200 for a member', async () => {
      const token = await memberToken();
      const response = await supertest(server)
        .get('/api/v1/rewards/rules')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body).toMatchObject({ items: [], total: 0 });
    });

    it('GET /api/v1/rewards/rules returns 401 without auth (unchanged)', async () => {
      await supertest(server).get('/api/v1/rewards/rules').expect(401);
    });
  });
});
