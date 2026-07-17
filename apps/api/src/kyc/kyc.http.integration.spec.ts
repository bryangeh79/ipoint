import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  markets,
  memberKycCases,
  memberMarketPreferences,
  members,
  migrate,
} from '@ipoint/database';
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
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { MEMBER_KYC_MAX_FILE_SIZE_BYTES } from './kyc.service.js';

const databaseUrl = process.env['DATABASE_URL'];

interface KycBody {
  id: string | null;
  status: string;
  identificationNumber: string | null;
  accountCountrySnapshot: string | null;
  submissionMarketId: string | null;
  consentVersion: string | null;
  documents: Array<{ checksum: string }>;
}

interface ErrorBody {
  error: { code: string };
}

describe.skipIf(!databaseUrl)('Member KYC HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let database: DatabaseService;
  let rateLimiter: InMemoryRateLimiter;
  let marketId: string;

  async function ensureMarket(): Promise<string> {
    const existing = await database.db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.code, 'MY'))
      .limit(1);
    if (existing[0]) {
      await database.db
        .update(markets)
        .set({ status: 'ACTIVE' })
        .where(eq(markets.id, existing[0].id));
      return existing[0].id;
    }
    const rows = await database.db
      .insert(markets)
      .values({
        code: 'MY',
        name: 'Malaysia',
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      })
      .returning({ id: markets.id });
    return rows[0]?.id ?? '';
  }

  async function createMember(): Promise<{
    token: string;
    memberId: string;
  }> {
    const email = `${randomUUID()}@example.com`;
    const accountRows = await database.db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    const accountId = accountRows[0]?.id ?? '';
    await auth.setPassword(accountId, 'Member-Password-123!');
    const memberRows = await database.db
      .insert(members)
      .values({
        accountId,
        publicMemberId: `mem_${randomUUID()}`,
        referralCode: randomUUID()
          .replaceAll('-', '')
          .slice(0, 8)
          .toUpperCase(),
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    const memberId = memberRows[0]?.id ?? '';
    await database.db.insert(memberMarketPreferences).values({
      memberId,
      marketId,
      isEnabled: true,
      isCurrent: true,
      sortOrder: 0,
    });
    const token = (await auth.login(email, 'Member-Password-123!')).accessToken;
    return { token, memberId };
  }

  function authorized(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function createCompleteDraft(token: string): Promise<void> {
    await supertest(server)
      .post('/api/v1/members/me/kyc')
      .set(authorized(token))
      .send({ idempotencyKey: randomUUID() })
      .expect(200);
    await supertest(server)
      .patch('/api/v1/members/me/kyc')
      .set(authorized(token))
      .send({
        legalFullName: 'Alice Integration',
        identificationType: 'NATIONAL_ID',
        identificationNumber: 'MY1234567890',
        dateOfBirth: '1990-01-02',
        nationality: 'MY',
        residentialAddress: {
          line1: '1 Integration Street',
          city: 'Kuala Lumpur',
          postalCode: '50000',
        },
      })
      .expect(200);
    await supertest(server)
      .post('/api/v1/members/me/kyc/documents')
      .set(authorized(token))
      .send({
        documentType: 'IDENTITY_FRONT',
        mimeType: 'application/pdf',
        size: 2048,
        checksum: randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      })
      .expect(200);
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('AUTH_OTP_PEPPER', 'kyc-http-pepper-at-least-32-characters');
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
    marketId = await ensureMarket();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    (
      rateLimiter as unknown as { buckets?: Map<string, unknown> }
    ).buckets?.clear();
  });

  it('returns NOT_STARTED and requires authentication', async () => {
    await supertest(server).get('/api/v1/members/me/kyc').expect(401);
    const { token } = await createMember();
    const response = await supertest(server)
      .get('/api/v1/members/me/kyc')
      .set(authorized(token))
      .expect(200);
    expect(response.body as KycBody).toMatchObject({
      id: null,
      status: 'NOT_STARTED',
      documents: [],
    });
  });

  it('creates, updates, adds document metadata, submits, and replays idempotently', async () => {
    const { token } = await createMember();
    await createCompleteDraft(token);
    const idempotencyKey = randomUUID();
    const first = await supertest(server)
      .post('/api/v1/members/me/kyc/submit')
      .set(authorized(token))
      .send({ idempotencyKey })
      .expect(200);
    const replay = await supertest(server)
      .post('/api/v1/members/me/kyc/submit')
      .set(authorized(token))
      .send({ idempotencyKey })
      .expect(200);
    const body = first.body as KycBody;
    expect(body).toMatchObject({
      status: 'SUBMITTED',
      identificationNumber: '****7890',
      accountCountrySnapshot: 'MY',
      submissionMarketId: marketId,
    });
    expect(body.consentVersion).toBeTruthy();
    expect(body.documents).toHaveLength(1);
    expect(replay.body).toEqual(first.body);
  });

  it('rejects submission with missing required fields/documents', async () => {
    const { token } = await createMember();
    await supertest(server)
      .post('/api/v1/members/me/kyc')
      .set(authorized(token))
      .send({})
      .expect(200);
    const response = await supertest(server)
      .post('/api/v1/members/me/kyc/submit')
      .set(authorized(token))
      .send({ idempotencyKey: randomUUID() })
      .expect(400);
    expect((response.body as ErrorBody).error.code).toBe(
      'KYC_MISSING_REQUIRED_FIELDS',
    );
  });

  it('rejects invalid MIME, oversized files, and duplicate checksums', async () => {
    const { token } = await createMember();
    await supertest(server)
      .post('/api/v1/members/me/kyc')
      .set(authorized(token))
      .send({})
      .expect(200);
    const base = {
      documentType: 'IDENTITY_FRONT',
      size: 1024,
      checksum: 'b'.repeat(64),
    };
    const invalidMime = await supertest(server)
      .post('/api/v1/members/me/kyc/documents')
      .set(authorized(token))
      .send({ ...base, mimeType: 'text/plain' })
      .expect(400);
    expect((invalidMime.body as ErrorBody).error.code).toBe(
      'KYC_INVALID_FILE_TYPE',
    );
    const oversized = await supertest(server)
      .post('/api/v1/members/me/kyc/documents')
      .set(authorized(token))
      .send({
        ...base,
        mimeType: 'application/pdf',
        size: MEMBER_KYC_MAX_FILE_SIZE_BYTES + 1,
      })
      .expect(413);
    expect((oversized.body as ErrorBody).error.code).toBe('KYC_FILE_TOO_LARGE');
    await supertest(server)
      .post('/api/v1/members/me/kyc/documents')
      .set(authorized(token))
      .send({ ...base, mimeType: 'application/pdf' })
      .expect(200);
    const duplicate = await supertest(server)
      .post('/api/v1/members/me/kyc/documents')
      .set(authorized(token))
      .send({ ...base, mimeType: 'application/pdf' })
      .expect(409);
    expect((duplicate.body as ErrorBody).error.code).toBe(
      'KYC_DUPLICATE_DOCUMENT',
    );
  });

  it('resubmits a MORE_INFO_REQUIRED case and rejects other states', async () => {
    const { token, memberId } = await createMember();
    await createCompleteDraft(token);
    await supertest(server)
      .post('/api/v1/members/me/kyc/submit')
      .set(authorized(token))
      .send({ idempotencyKey: randomUUID() })
      .expect(200);
    await database.db
      .update(memberKycCases)
      .set({ status: 'MORE_INFO_REQUIRED' })
      .where(eq(memberKycCases.memberId, memberId));
    const resubmitted = await supertest(server)
      .post('/api/v1/members/me/kyc/resubmit')
      .set(authorized(token))
      .send({ idempotencyKey: randomUUID() })
      .expect(200);
    expect((resubmitted.body as KycBody).status).toBe('SUBMITTED');
    const rejected = await supertest(server)
      .post('/api/v1/members/me/kyc/resubmit')
      .set(authorized(token))
      .send({ idempotencyKey: randomUUID() })
      .expect(409);
    expect((rejected.body as ErrorBody).error.code).toBe('KYC_INVALID_STATE');
  });
});
