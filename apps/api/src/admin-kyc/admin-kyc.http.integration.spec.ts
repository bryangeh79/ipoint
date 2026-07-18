import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminUsers,
  auditLogs,
  entityTimelines,
  marketAccess,
  markets,
  memberKycHistory,
  memberMarketPreferences,
  members,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
} from '@ipoint/database';
import { and, eq } from 'drizzle-orm';
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

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Admin-Kyc-Password-123!';

interface AdminKycCaseBody {
  id: string;
  marketId: string;
  status: string;
  identificationNumber?: string | null;
  decisionReason?: string | null;
  member: { kycLevel: string };
}

interface AdminKycListBody {
  items: AdminKycCaseBody[];
  total: number;
}

interface ErrorBody {
  error: { code: string };
}

describe.skipIf(!databaseUrl)('Admin KYC HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let auth: AuthService;
  let database: DatabaseService;
  let rateLimiter: InMemoryRateLimiter;
  let primaryMarketId: string;
  let secondaryMarketId: string;

  function authorized(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function ensureActiveMarket(
    code: string,
    currencyCode: string,
    timezone: string,
  ): Promise<string> {
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
        name: `${code} Admin KYC Test Market`,
        status: 'ACTIVE',
        currencyCode,
        timezone,
        defaultLocale: 'en-MY',
      })
      .returning({ id: markets.id });
    return inserted[0]?.id ?? '';
  }

  async function createAccount(): Promise<{
    accountId: string;
    email: string;
  }> {
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
    return { accountId, email };
  }

  async function createMemberAccount(marketId: string): Promise<{
    accountId: string;
    email: string;
    memberId: string;
  }> {
    const { accountId, email } = await createAccount();
    const inserted = await database.db
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
    const memberId = inserted[0]?.id ?? '';
    await database.db.insert(memberMarketPreferences).values({
      memberId,
      marketId,
      isEnabled: true,
      isCurrent: true,
      sortOrder: 0,
    });
    return { accountId, email, memberId };
  }

  async function getAccessToken(email: string): Promise<string> {
    return (await auth.login(email, password)).accessToken;
  }

  async function ensureKycReviewPermission(): Promise<string> {
    await database.db
      .insert(permissions)
      .values({
        code: 'member.kyc.review',
        description: 'Review member KYC cases',
      })
      .onConflictDoNothing({ target: permissions.code });
    const rows = await database.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.code, 'member.kyc.review'))
      .limit(1);
    return rows[0]?.id ?? '';
  }

  async function createAdmin(options: {
    marketIds: string[];
    withKycPermission?: boolean;
    existingAccount?: { accountId: string; email: string };
  }): Promise<{ adminUserId: string; token: string }> {
    const account = options.existingAccount ?? (await createAccount());
    const adminRows = await database.db
      .insert(adminUsers)
      .values({
        accountId: account.accountId,
        displayName: `KYC Admin ${randomUUID()}`,
        status: 'ACTIVE',
      })
      .returning({ id: adminUsers.id });
    const adminUserId = adminRows[0]?.id ?? '';
    const roleRows = await database.db
      .insert(roles)
      .values({
        code: `KYC_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        name: 'Admin KYC HTTP Test Role',
        isSystem: false,
      })
      .returning({ id: roles.id });
    const roleId = roleRows[0]?.id ?? '';
    await database.db.insert(roleAssignments).values({ adminUserId, roleId });
    if (options.withKycPermission ?? true) {
      const permissionId = await ensureKycReviewPermission();
      await database.db
        .insert(rolePermissions)
        .values({ roleId, permissionId });
    }
    if (options.marketIds.length > 0) {
      await database.db
        .insert(marketAccess)
        .values(
          options.marketIds.map((marketId) => ({ adminUserId, marketId })),
        );
    }
    return { adminUserId, token: await getAccessToken(account.email) };
  }

  async function createSubmittedCase(marketId: string): Promise<{
    accountId: string;
    memberId: string;
    caseId: string;
    token: string;
    identificationNumber: string;
  }> {
    const member = await createMemberAccount(marketId);
    const token = await getAccessToken(member.email);
    const identificationNumber = `MY${randomUUID()
      .replaceAll('-', '')
      .slice(0, 14)
      .toUpperCase()}`;
    await supertest(server)
      .post('/api/v1/members/me/kyc')
      .set(authorized(token))
      .send({ idempotencyKey: randomUUID() })
      .expect(200);
    await supertest(server)
      .patch('/api/v1/members/me/kyc')
      .set(authorized(token))
      .send({
        legalFullName: 'Admin KYC Integration Member',
        identificationType: 'NATIONAL_ID',
        identificationNumber,
        dateOfBirth: '1990-01-02',
        nationality: 'MY',
        residentialAddress: {
          line1: '1 Admin KYC Integration Street',
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
    const submitted = await supertest(server)
      .post('/api/v1/members/me/kyc/submit')
      .set(authorized(token))
      .send({ idempotencyKey: randomUUID() })
      .expect(200);
    return {
      accountId: member.accountId,
      memberId: member.memberId,
      caseId: (submitted.body as AdminKycCaseBody).id,
      token,
      identificationNumber,
    };
  }

  function performAction(
    token: string,
    caseId: string,
    action: string,
    reason: string,
    idempotencyKey = randomUUID(),
  ) {
    return supertest(server)
      .post(`/api/v1/admin/kyc/cases/${caseId}/${action}`)
      .set(authorized(token))
      .set('Idempotency-Key', idempotencyKey)
      .send({ reason });
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'admin-kyc-http-pepper-at-least-32-characters',
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
    primaryMarketId = await ensureActiveMarket(
      'KYT1',
      'MYR',
      'Asia/Kuala_Lumpur',
    );
    secondaryMarketId = await ensureActiveMarket(
      'KYT2',
      'SGD',
      'Asia/Singapore',
    );
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    (
      rateLimiter as unknown as { buckets?: Map<string, unknown> }
    ).buckets?.clear();
  });

  describe('authentication, RBAC, and market access', () => {
    it('rejects unauthenticated, non-admin, and missing-permission requests', async () => {
      await supertest(server).get('/api/v1/admin/kyc/cases').expect(401);

      const member = await createMemberAccount(primaryMarketId);
      const memberToken = await getAccessToken(member.email);
      const nonAdmin = await supertest(server)
        .get('/api/v1/admin/kyc/cases')
        .set(authorized(memberToken))
        .expect(403);
      expect((nonAdmin.body as ErrorBody).error.code).toBe(
        'AUTH_PERMISSION_DENIED',
      );

      const admin = await createAdmin({
        marketIds: [primaryMarketId],
        withKycPermission: false,
      });
      const missingPermission = await supertest(server)
        .get('/api/v1/admin/kyc/cases')
        .set(authorized(admin.token))
        .expect(403);
      expect((missingPermission.body as ErrorBody).error.code).toBe(
        'AUTH_PERMISSION_DENIED',
      );
    });

    it('lets GLOBAL access see all market cases and scopes MARKET_SCOPED access', async () => {
      const primaryCase = await createSubmittedCase(primaryMarketId);
      const secondaryCase = await createSubmittedCase(secondaryMarketId);
      const globalAdmin = await createAdmin({
        marketIds: [primaryMarketId, secondaryMarketId],
      });
      const marketAdmin = await createAdmin({ marketIds: [primaryMarketId] });

      const globalResponse = await supertest(server)
        .get('/api/v1/admin/kyc/cases')
        .set(authorized(globalAdmin.token))
        .expect(200);
      expect(
        (globalResponse.body as AdminKycListBody).items.map((item) => item.id),
      ).toEqual(
        expect.arrayContaining([primaryCase.caseId, secondaryCase.caseId]),
      );

      const scopedResponse = await supertest(server)
        .get('/api/v1/admin/kyc/cases')
        .set(authorized(marketAdmin.token))
        .expect(200);
      const scopedIds = (scopedResponse.body as AdminKycListBody).items.map(
        (item) => item.id,
      );
      expect(scopedIds).toContain(primaryCase.caseId);
      expect(scopedIds).not.toContain(secondaryCase.caseId);
    });

    it('denies case detail from an unauthorized market', async () => {
      const kycCase = await createSubmittedCase(secondaryMarketId);
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      const response = await supertest(server)
        .get(`/api/v1/admin/kyc/cases/${kycCase.caseId}`)
        .set(authorized(admin.token))
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'ADMIN_KYC_MARKET_ACCESS_DENIED',
      );
    });
  });

  describe('case list, detail, and masking', () => {
    it('filters cases by status and masks sensitive data in every response', async () => {
      const submittedCase = await createSubmittedCase(primaryMarketId);
      const reviewedCase = await createSubmittedCase(primaryMarketId);
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      const started = await performAction(
        admin.token,
        reviewedCase.caseId,
        'start-review',
        'Claim for review',
      ).expect(200);

      const list = await supertest(server)
        .get('/api/v1/admin/kyc/cases?status=SUBMITTED')
        .set(authorized(admin.token))
        .expect(200);
      const ids = (list.body as AdminKycListBody).items.map((item) => item.id);
      expect(ids).toContain(submittedCase.caseId);
      expect(ids).not.toContain(reviewedCase.caseId);
      expect(JSON.stringify(list.body)).not.toContain(
        submittedCase.identificationNumber,
      );
      expect(JSON.stringify(started.body)).not.toContain(
        reviewedCase.identificationNumber,
      );

      const detail = await supertest(server)
        .get(`/api/v1/admin/kyc/cases/${submittedCase.caseId}`)
        .set(authorized(admin.token))
        .expect(200);
      expect((detail.body as AdminKycCaseBody).identificationNumber).toBe(
        `****${submittedCase.identificationNumber.slice(-4)}`,
      );
      expect(JSON.stringify(detail.body)).not.toContain(
        submittedCase.identificationNumber,
      );
    });

    it('returns 404 when the case does not exist', async () => {
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      const response = await supertest(server)
        .get(`/api/v1/admin/kyc/cases/${randomUUID()}`)
        .set(authorized(admin.token))
        .expect(404);
      expect((response.body as ErrorBody).error.code).toBe(
        'ADMIN_KYC_CASE_NOT_FOUND',
      );
    });
  });

  describe('review state machine', () => {
    it('moves SUBMITTED to UNDER_REVIEW and rejects an invalid transition', async () => {
      const kycCase = await createSubmittedCase(primaryMarketId);
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      const started = await performAction(
        admin.token,
        kycCase.caseId,
        'start-review',
        'Begin review',
      ).expect(200);
      expect((started.body as AdminKycCaseBody).status).toBe('UNDER_REVIEW');

      const invalid = await performAction(
        admin.token,
        kycCase.caseId,
        'start-review',
        'Attempt duplicate transition',
      ).expect(409);
      expect((invalid.body as ErrorBody).error.code).toBe(
        'ADMIN_KYC_INVALID_STATE',
      );
    });

    it('moves UNDER_REVIEW to MORE_INFO_REQUIRED and requires a reason', async () => {
      const kycCase = await createSubmittedCase(primaryMarketId);
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      await performAction(
        admin.token,
        kycCase.caseId,
        'start-review',
        'Begin review',
      ).expect(200);

      await supertest(server)
        .post(`/api/v1/admin/kyc/cases/${kycCase.caseId}/request-more-info`)
        .set(authorized(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(400);
      const response = await performAction(
        admin.token,
        kycCase.caseId,
        'request-more-info',
        'Please provide a clearer identity document',
      ).expect(200);
      expect((response.body as AdminKycCaseBody).status).toBe(
        'MORE_INFO_REQUIRED',
      );
    });

    it('approves idempotently, upgrades the member, and rejects payload mismatch', async () => {
      const kycCase = await createSubmittedCase(primaryMarketId);
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      await performAction(
        admin.token,
        kycCase.caseId,
        'start-review',
        'Begin review',
      ).expect(200);
      const key = randomUUID();
      const approved = await performAction(
        admin.token,
        kycCase.caseId,
        'approve',
        'Identity evidence verified',
        key,
      ).expect(200);
      const replay = await performAction(
        admin.token,
        kycCase.caseId,
        'approve',
        'Identity evidence verified',
        key,
      ).expect(200);
      expect(replay.body).toEqual(approved.body);
      expect((approved.body as AdminKycCaseBody).status).toBe('APPROVED');
      expect((approved.body as AdminKycCaseBody).member.kycLevel).toBe(
        'LEVEL_2',
      );
      const memberRows = await database.db
        .select({ kycLevel: members.kycLevel })
        .from(members)
        .where(eq(members.id, kycCase.memberId));
      expect(memberRows[0]?.kycLevel).toBe('LEVEL_2');

      const conflict = await performAction(
        admin.token,
        kycCase.caseId,
        'approve',
        'A different decision payload',
        key,
      ).expect(409);
      expect((conflict.body as ErrorBody).error.code).toBe(
        'ADMIN_KYC_IDEMPOTENCY_CONFLICT',
      );
    });

    it('moves UNDER_REVIEW to REJECTED and requires a reason', async () => {
      const kycCase = await createSubmittedCase(primaryMarketId);
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      await performAction(
        admin.token,
        kycCase.caseId,
        'start-review',
        'Begin review',
      ).expect(200);

      await supertest(server)
        .post(`/api/v1/admin/kyc/cases/${kycCase.caseId}/reject`)
        .set(authorized(admin.token))
        .set('Idempotency-Key', randomUUID())
        .send({ reason: '' })
        .expect(400);
      const rejected = await performAction(
        admin.token,
        kycCase.caseId,
        'reject',
        'Identity evidence could not be verified',
      ).expect(200);
      expect((rejected.body as AdminKycCaseBody).status).toBe('REJECTED');
    });

    it('moves APPROVED to REVERIFICATION_REQUIRED', async () => {
      const kycCase = await createSubmittedCase(primaryMarketId);
      const admin = await createAdmin({ marketIds: [primaryMarketId] });
      await performAction(
        admin.token,
        kycCase.caseId,
        'start-review',
        'Begin review',
      ).expect(200);
      await performAction(
        admin.token,
        kycCase.caseId,
        'approve',
        'Identity evidence verified',
      ).expect(200);
      const response = await performAction(
        admin.token,
        kycCase.caseId,
        'require-reverification',
        'Policy re-check required',
      ).expect(200);
      expect((response.body as AdminKycCaseBody).status).toBe(
        'REVERIFICATION_REQUIRED',
      );
    });

    it('prevents an admin from reviewing their own member case', async () => {
      const kycCase = await createSubmittedCase(primaryMarketId);
      const admin = await createAdmin({
        marketIds: [primaryMarketId],
        existingAccount: {
          accountId: kycCase.accountId,
          email:
            (
              await database.db
                .select({ email: accounts.email })
                .from(accounts)
                .where(eq(accounts.id, kycCase.accountId))
                .limit(1)
            )[0]?.email ?? '',
        },
      });
      const response = await performAction(
        admin.token,
        kycCase.caseId,
        'start-review',
        'Attempt self-review',
      ).expect(403);
      expect((response.body as ErrorBody).error.code).toBe(
        'ADMIN_KYC_SELF_REVIEW',
      );
    });
  });

  it('writes audit, entity timeline, and member KYC history on approval', async () => {
    const kycCase = await createSubmittedCase(primaryMarketId);
    const admin = await createAdmin({ marketIds: [primaryMarketId] });
    await performAction(
      admin.token,
      kycCase.caseId,
      'start-review',
      'Begin review',
    ).expect(200);
    await performAction(
      admin.token,
      kycCase.caseId,
      'approve',
      'Identity evidence verified',
    ).expect(200);

    const [auditRows, timelineRows, historyRows] = await Promise.all([
      database.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, kycCase.caseId),
            eq(auditLogs.action, 'member.kyc.approve'),
          ),
        ),
      database.db
        .select({ eventType: entityTimelines.eventType })
        .from(entityTimelines)
        .where(
          and(
            eq(entityTimelines.entityId, kycCase.caseId),
            eq(entityTimelines.eventType, 'member.kyc.approve'),
          ),
        ),
      database.db
        .select({ eventType: memberKycHistory.eventType })
        .from(memberKycHistory)
        .where(
          and(
            eq(memberKycHistory.memberKycCaseId, kycCase.caseId),
            eq(memberKycHistory.eventType, 'APPROVED'),
          ),
        ),
    ]);
    expect(auditRows).toHaveLength(1);
    expect(timelineRows).toHaveLength(1);
    expect(historyRows).toHaveLength(1);
  });
});
