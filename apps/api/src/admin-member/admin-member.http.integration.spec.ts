import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminMemberNotes,
  adminUsers,
  auditLogs,
  entityTimelines,
  marketAccess,
  markets,
  memberKycCases,
  memberMarketPreferences,
  memberProfiles,
  memberStatusHistory,
  members,
  merchantGroups,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
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
const password = 'Admin-Member-Password-123!';
const allMemberPermissions = [
  'member.read',
  'member.status.manage',
  'member.session.revoke',
  'member.reverification.require',
  'member.note.read',
  'member.note.create',
] as const;

interface MemberBody {
  publicMemberId: string;
  email: string;
  status: string;
  profile: { phone: string | null };
  kyc: { identificationNumber: string | null; status: string } | null;
  statusHistory: Array<{ toStatus: string }>;
}

interface MemberListBody {
  members: Array<{
    publicMemberId: string;
    currentMarketId: string;
    status: string;
    kycLevel: string;
    accountCountry: string;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

interface NotesListBody {
  notes: Array<{ id: string; content: string; createdAt: string }>;
  total: number;
  page: number;
  pageSize: number;
}

interface ErrorBody {
  error: { code: string };
}

describe.skipIf(!databaseUrl)('Admin Member HTTP integration', () => {
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
        name: `${code} Admin Member Test Market`,
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

  async function createMember(marketId: string): Promise<{
    accountId: string;
    email: string;
    memberId: string;
    publicMemberId: string;
    referralCode: string;
    rawPhone: string;
  }> {
    const account = await createAccount();
    const publicMemberId = `mem_${randomUUID()}`;
    const referralCode = randomUUID()
      .replaceAll('-', '')
      .slice(0, 8)
      .toUpperCase();
    const inserted = await database.db
      .insert(members)
      .values({
        accountId: account.accountId,
        publicMemberId,
        referralCode,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_1',
      })
      .returning({ id: members.id });
    const memberId = inserted[0]?.id ?? '';
    const rawPhone = `+60${randomUUID().replaceAll('-', '').slice(0, 9)}`;
    await database.db.insert(memberProfiles).values({
      memberId,
      displayName: 'Admin Member Test',
      fullName: 'Admin Member Integration Test',
      phone: rawPhone,
      phoneNormalized: rawPhone,
      phoneVerificationStatus: 'PENDING',
      address: { line1: 'Sensitive address', city: 'Kuala Lumpur' },
    });
    await database.db.insert(memberMarketPreferences).values({
      memberId,
      marketId,
      isEnabled: true,
      isCurrent: true,
      sortOrder: 0,
    });
    return { ...account, memberId, publicMemberId, referralCode, rawPhone };
  }

  async function createMerchantToken(marketId: string): Promise<string> {
    const account = await createAccount();
    await database.db.insert(merchantGroups).values({
      accountId: account.accountId,
      marketId,
      name: `HTTP Test Merchant ${randomUUID()}`,
    });
    return getAccessToken(account.email);
  }

  async function getAccessToken(email: string): Promise<string> {
    return (await auth.login(email, password)).accessToken;
  }

  async function ensurePermissions(
    codes: readonly string[],
  ): Promise<string[]> {
    if (codes.length === 0) return [];
    await database.db
      .insert(permissions)
      .values(
        codes.map((code) => ({
          code,
          description: `${code} integration test permission`,
        })),
      )
      .onConflictDoNothing({ target: permissions.code });
    const rows = await database.db.select().from(permissions);
    return rows.filter((row) => codes.includes(row.code)).map((row) => row.id);
  }

  async function createAdmin(options: {
    marketIds: string[];
    permissionCodes?: readonly string[];
  }): Promise<{ adminUserId: string; token: string }> {
    const account = await createAccount();
    const adminRows = await database.db
      .insert(adminUsers)
      .values({
        accountId: account.accountId,
        displayName: `Member Admin ${randomUUID()}`,
        status: 'ACTIVE',
      })
      .returning({ id: adminUsers.id });
    const adminUserId = adminRows[0]?.id ?? '';
    const roleRows = await database.db
      .insert(roles)
      .values({
        code: `MEMBER_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        name: 'Admin Member HTTP Test Role',
        isSystem: false,
      })
      .returning({ id: roles.id });
    const roleId = roleRows[0]?.id ?? '';
    await database.db.insert(roleAssignments).values({ adminUserId, roleId });
    const permissionIds = await ensurePermissions(
      options.permissionCodes ?? allMemberPermissions,
    );
    if (permissionIds.length > 0) {
      await database.db
        .insert(rolePermissions)
        .values(
          permissionIds.map((permissionId) => ({ roleId, permissionId })),
        );
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

  function action(
    token: string,
    publicMemberId: string,
    operation: string,
    body: Record<string, unknown>,
  ) {
    return supertest(server)
      .post(`/api/v1/admin/members/${publicMemberId}/${operation}`)
      .set(authorized(token))
      .send(body);
  }

  async function createApprovedKyc(
    memberId: string,
    marketId: string,
  ): Promise<{ caseId: string; identificationNumber: string }> {
    const identificationNumber = `MY${randomUUID()
      .replaceAll('-', '')
      .slice(0, 14)
      .toUpperCase()}`;
    const now = new Date();
    const rows = await database.db
      .insert(memberKycCases)
      .values({
        memberId,
        marketId,
        status: 'APPROVED',
        levelRequested: 'LEVEL_2',
        legalFullName: 'Admin Member Integration Test',
        identificationType: 'NATIONAL_ID',
        identificationNumber,
        dateOfBirth: '1990-01-02',
        nationality: 'MY',
        residentialAddress: { line1: '1 Integration Street' },
        accountCountrySnapshot: 'MY',
        submissionMarketId: marketId,
        consentVersion: 'test-v1',
        submittedAt: now,
        reviewedAt: now,
      })
      .returning({ id: memberKycCases.id });
    await database.db
      .update(members)
      .set({ kycLevel: 'LEVEL_2' })
      .where(eq(members.id, memberId));
    return { caseId: rows[0]?.id ?? '', identificationNumber };
  }

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'admin-member-http-pepper-at-least-32-characters',
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
      'AMT1',
      'MYR',
      'Asia/Kuala_Lumpur',
    );
    secondaryMarketId = await ensureActiveMarket(
      'AMT2',
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
    it('returns 401 without authentication and 403 for non-admin or missing permission', async () => {
      await supertest(server).get('/api/v1/admin/members').expect(401);

      const member = await createMember(primaryMarketId);
      const memberToken = await getAccessToken(member.email);
      const nonAdmin = await supertest(server)
        .get('/api/v1/admin/members')
        .set(authorized(memberToken))
        .expect(403);
      expect((nonAdmin.body as ErrorBody).error.code).toBe(
        'AUTH_PERMISSION_DENIED',
      );

      const merchantToken = await createMerchantToken(primaryMarketId);
      const merchant = await supertest(server)
        .get('/api/v1/admin/members')
        .set(authorized(merchantToken))
        .expect(403);
      expect((merchant.body as ErrorBody).error.code).toBe(
        'AUTH_PERMISSION_DENIED',
      );

      const admin = await createAdmin({
        marketIds: [primaryMarketId],
        permissionCodes: [],
      });
      const missingPermission = await supertest(server)
        .get('/api/v1/admin/members')
        .set(authorized(admin.token))
        .expect(403);
      expect((missingPermission.body as ErrorBody).error.code).toBe(
        'AUTH_PERMISSION_DENIED',
      );
    });

    it('lets GLOBAL admin list all granted markets and scopes MARKET_SCOPED admin', async () => {
      const primary = await createMember(primaryMarketId);
      const secondary = await createMember(secondaryMarketId);
      const globalAdmin = await createAdmin({
        marketIds: [primaryMarketId, secondaryMarketId],
        permissionCodes: ['member.read'],
      });
      const scopedAdmin = await createAdmin({
        marketIds: [primaryMarketId],
        permissionCodes: ['member.read'],
      });

      const globalResponse = await supertest(server)
        .get('/api/v1/admin/members?pageSize=100')
        .set(authorized(globalAdmin.token))
        .expect(200);
      const globalIds = (globalResponse.body as MemberListBody).members.map(
        (member) => member.publicMemberId,
      );
      expect(globalIds).toEqual(
        expect.arrayContaining([
          primary.publicMemberId,
          secondary.publicMemberId,
        ]),
      );

      const scopedResponse = await supertest(server)
        .get('/api/v1/admin/members?pageSize=100')
        .set(authorized(scopedAdmin.token))
        .expect(200);
      const scopedIds = (scopedResponse.body as MemberListBody).members.map(
        (member) => member.publicMemberId,
      );
      expect(scopedIds).toContain(primary.publicMemberId);
      expect(scopedIds).not.toContain(secondary.publicMemberId);
    });

    it('enforces route-specific permissions', async () => {
      const member = await createMember(primaryMarketId);
      const readOnlyAdmin = await createAdmin({
        marketIds: [primaryMarketId],
        permissionCodes: ['member.read'],
      });
      await supertest(server)
        .get(`/api/v1/admin/members/${member.publicMemberId}`)
        .set(authorized(readOnlyAdmin.token))
        .expect(200);
      await action(readOnlyAdmin.token, member.publicMemberId, 'suspend', {
        reason: 'Not authorized',
        idempotencyKey: randomUUID(),
      }).expect(403);
      await supertest(server)
        .get(`/api/v1/admin/members/${member.publicMemberId}/notes`)
        .set(authorized(readOnlyAdmin.token))
        .expect(403);
    });
  });

  describe('search, filters, pagination, and sorting', () => {
    it('searches independently by publicMemberId, email, phone, and referralCode', async () => {
      const member = await createMember(primaryMarketId);
      const admin = await createAdmin({
        marketIds: [primaryMarketId],
        permissionCodes: ['member.read'],
      });

      for (const query of [
        member.publicMemberId,
        member.email,
        member.rawPhone,
        member.referralCode,
      ]) {
        const response = await supertest(server)
          .get(`/api/v1/admin/members?query=${encodeURIComponent(query)}`)
          .set(authorized(admin.token))
          .expect(200);
        expect(
          (response.body as MemberListBody).members.map(
            (item) => item.publicMemberId,
          ),
        ).toContain(member.publicMemberId);
      }
    });

    it('filters by status, accountCountry, currentMarket, kycLevel, kycStatus, and date range', async () => {
      const member = await createMember(primaryMarketId);
      await createApprovedKyc(member.memberId, primaryMarketId);
      const createdAt = new Date('2026-06-15T12:00:00.000Z');
      await Promise.all([
        database.db
          .update(accounts)
          .set({ accountCountry: 'SG' })
          .where(eq(accounts.id, member.accountId)),
        database.db
          .update(members)
          .set({ status: 'SUSPENDED', createdAt })
          .where(eq(members.id, member.memberId)),
      ]);
      const admin = await createAdmin({
        marketIds: [primaryMarketId],
        permissionCodes: ['member.read'],
      });
      const params = new URLSearchParams({
        query: member.email,
        status: 'SUSPENDED',
        accountCountry: 'sg',
        currentMarket: primaryMarketId,
        kycLevel: 'LEVEL_2',
        kycStatus: 'APPROVED',
        createdAfter: '2026-06-01T00:00:00.000Z',
        createdBefore: '2026-06-30T23:59:59.999Z',
      });
      const response = await supertest(server)
        .get(`/api/v1/admin/members?${params.toString()}`)
        .set(authorized(admin.token))
        .expect(200);
      expect((response.body as MemberListBody).members).toHaveLength(1);
      expect((response.body as MemberListBody).members[0]).toMatchObject({
        publicMemberId: member.publicMemberId,
        currentMarketId: primaryMarketId,
        status: 'SUSPENDED',
        kycLevel: 'LEVEL_2',
        accountCountry: 'SG',
      });
    });

    it('paginates, sorts deterministically, and rejects pageSize above 100', async () => {
      const fixtureToken = randomUUID().replaceAll('-', '').slice(0, 6);
      const referralPrefix = randomUUID()
        .replaceAll('-', '')
        .slice(0, 5)
        .toUpperCase();
      const fixtures = await Promise.all([
        createMember(primaryMarketId),
        createMember(primaryMarketId),
        createMember(primaryMarketId),
      ]);
      for (const [index, member] of fixtures.entries()) {
        await database.db
          .update(members)
          .set({
            publicMemberId: `mem_${fixtureToken}_${String.fromCharCode(97 + index)}`,
            referralCode: `${referralPrefix}${String.fromCharCode(65 + index)}1X`,
          })
          .where(eq(members.id, member.memberId));
      }
      const admin = await createAdmin({
        marketIds: [primaryMarketId],
        permissionCodes: ['member.read'],
      });
      const first = await supertest(server)
        .get(
          `/api/v1/admin/members?query=${referralPrefix}&sort=publicMemberId:asc&page=1&pageSize=2`,
        )
        .set(authorized(admin.token))
        .expect(200);
      const firstBody = first.body as MemberListBody;
      expect(firstBody).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(firstBody.members.map((item) => item.publicMemberId)).toEqual([
        `mem_${fixtureToken}_a`,
        `mem_${fixtureToken}_b`,
      ]);

      const second = await supertest(server)
        .get(
          `/api/v1/admin/members?query=${referralPrefix}&sort=publicMemberId:asc&page=2&pageSize=2`,
        )
        .set(authorized(admin.token))
        .expect(200);
      expect(
        (second.body as MemberListBody).members.map(
          (item) => item.publicMemberId,
        ),
      ).toEqual([`mem_${fixtureToken}_c`]);

      await supertest(server)
        .get('/api/v1/admin/members?pageSize=101')
        .set(authorized(admin.token))
        .expect(400);
    });
  });

  it('suspends and reactivates with history, audit, timeline, and session revocation', async () => {
    const member = await createMember(primaryMarketId);
    await getAccessToken(member.email);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.status.manage'],
    });

    const suspended = await action(
      admin.token,
      member.publicMemberId,
      'suspend',
      {
        reason: 'Risk review',
        idempotencyKey: randomUUID(),
      },
    ).expect(200);
    expect((suspended.body as MemberBody).status).toBe('SUSPENDED');
    expect(
      (suspended.body as MemberBody).statusHistory.some(
        (entry) => entry.toStatus === 'SUSPENDED',
      ),
    ).toBe(true);

    const [historyRows, auditRows, timelineRows, activeSessions] =
      await Promise.all([
        database.db
          .select()
          .from(memberStatusHistory)
          .where(
            and(
              eq(memberStatusHistory.memberId, member.memberId),
              eq(memberStatusHistory.toStatus, 'SUSPENDED'),
            ),
          ),
        database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, member.memberId),
              eq(auditLogs.action, 'member.suspend'),
            ),
          ),
        database.db
          .select()
          .from(entityTimelines)
          .where(
            and(
              eq(entityTimelines.entityId, member.memberId),
              eq(entityTimelines.eventType, 'member.suspend'),
            ),
          ),
        database.db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.accountId, member.accountId),
              isNull(sessions.revokedAt),
            ),
          ),
      ]);
    expect(historyRows).toHaveLength(1);
    expect(auditRows).toHaveLength(1);
    expect(timelineRows).toHaveLength(1);
    expect(activeSessions).toHaveLength(0);

    const reactivated = await action(
      admin.token,
      member.publicMemberId,
      'reactivate',
      { reason: 'Review complete', idempotencyKey: randomUUID() },
    ).expect(200);
    expect((reactivated.body as MemberBody).status).toBe('ACTIVE');
  });

  it('closes a member terminally and revokes all sessions', async () => {
    const member = await createMember(primaryMarketId);
    await getAccessToken(member.email);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.status.manage'],
    });
    const response = await action(admin.token, member.publicMemberId, 'close', {
      reason: 'Governed closure',
      confirmationText: 'CONFIRM',
      idempotencyKey: randomUUID(),
    }).expect(200);
    expect((response.body as MemberBody).status).toBe('CLOSED');
    const active = await database.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.accountId, member.accountId),
          isNull(sessions.revokedAt),
        ),
      );
    expect(active).toHaveLength(0);

    const recovery = await action(
      admin.token,
      member.publicMemberId,
      'reactivate',
      { reason: 'Attempted recovery', idempotencyKey: randomUUID() },
    ).expect(409);
    expect((recovery.body as ErrorBody).error.code).toBe(
      'ADMIN_MEMBER_INVALID_STATUS',
    );
  });

  it('serializes concurrent Suspend and Close requests and preserves CLOSED as terminal', async () => {
    const member = await createMember(primaryMarketId);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.read', 'member.status.manage'],
    });
    const [suspend, close] = await Promise.all([
      action(admin.token, member.publicMemberId, 'suspend', {
        reason: 'Concurrent risk hold',
        idempotencyKey: randomUUID(),
      }),
      action(admin.token, member.publicMemberId, 'close', {
        reason: 'Concurrent governed closure',
        confirmationText: 'CONFIRM',
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect([200, 409]).toContain(suspend.status);
    expect(close.status).toBe(200);

    const detail = await supertest(server)
      .get(`/api/v1/admin/members/${member.publicMemberId}`)
      .set(authorized(admin.token))
      .expect(200);
    expect((detail.body as MemberBody).status).toBe('CLOSED');
  });

  it('rejects the same action idempotency key with a different payload', async () => {
    const member = await createMember(primaryMarketId);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.status.manage'],
    });
    const idempotencyKey = randomUUID();
    await action(admin.token, member.publicMemberId, 'suspend', {
      reason: 'First payload',
      idempotencyKey,
    }).expect(200);
    const conflict = await action(
      admin.token,
      member.publicMemberId,
      'suspend',
      { reason: 'Different payload', idempotencyKey },
    ).expect(409);
    expect((conflict.body as ErrorBody).error.code).toBe(
      'ADMIN_MEMBER_IDEMPOTENCY_CONFLICT',
    );
  });

  it('revokes sessions without changing member status', async () => {
    const member = await createMember(primaryMarketId);
    await getAccessToken(member.email);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.session.revoke'],
    });
    const response = await action(
      admin.token,
      member.publicMemberId,
      'revoke-sessions',
      { reason: 'Security logout', idempotencyKey: randomUUID() },
    ).expect(200);
    expect((response.body as MemberBody).status).toBe('ACTIVE');
    const active = await database.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.accountId, member.accountId),
          isNull(sessions.revokedAt),
        ),
      );
    expect(active).toHaveLength(0);
  });

  it('requires KYC reverification through the reused KYC workflow', async () => {
    const member = await createMember(primaryMarketId);
    const kyc = await createApprovedKyc(member.memberId, primaryMarketId);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.reverification.require'],
    });
    const response = await action(
      admin.token,
      member.publicMemberId,
      'require-reverification',
      { reason: 'Document expired', idempotencyKey: randomUUID() },
    ).expect(200);
    expect((response.body as MemberBody).kyc?.status).toBe(
      'REVERIFICATION_REQUIRED',
    );
    const rows = await database.db
      .select({ status: memberKycCases.status })
      .from(memberKycCases)
      .where(eq(memberKycCases.id, kyc.caseId));
    expect(rows[0]?.status).toBe('REVERIFICATION_REQUIRED');
  });

  it('creates and lists notes newest-first with pagination and idempotency', async () => {
    const member = await createMember(primaryMarketId);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.note.create', 'member.note.read'],
    });
    const firstKey = randomUUID();
    const firstBody = {
      content: 'First support note',
      isInternal: true,
      idempotencyKey: firstKey,
    };
    const first = await action(
      admin.token,
      member.publicMemberId,
      'notes',
      firstBody,
    ).expect(200);
    const replay = await action(
      admin.token,
      member.publicMemberId,
      'notes',
      firstBody,
    ).expect(200);
    expect(replay.body).toEqual(first.body);
    await action(admin.token, member.publicMemberId, 'notes', {
      content: 'Second support note',
      isInternal: false,
      idempotencyKey: randomUUID(),
    }).expect(200);

    const list = await supertest(server)
      .get(
        `/api/v1/admin/members/${member.publicMemberId}/notes?page=1&pageSize=1`,
      )
      .set(authorized(admin.token))
      .expect(200);
    const body = list.body as NotesListBody;
    expect(body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0]?.content).toBe('Second support note');

    const stored = await database.db
      .select()
      .from(adminMemberNotes)
      .where(eq(adminMemberNotes.memberId, member.memberId));
    expect(stored).toHaveLength(2);

    const conflict = await action(admin.token, member.publicMemberId, 'notes', {
      ...firstBody,
      content: 'Different payload',
    }).expect(409);
    expect((conflict.body as ErrorBody).error.code).toBe(
      'ADMIN_MEMBER_IDEMPOTENCY_CONFLICT',
    );
  });

  it('masks sensitive fields in list and detail responses', async () => {
    const member = await createMember(primaryMarketId);
    const kyc = await createApprovedKyc(member.memberId, primaryMarketId);
    const admin = await createAdmin({
      marketIds: [primaryMarketId],
      permissionCodes: ['member.read'],
    });
    const list = await supertest(server)
      .get(`/api/v1/admin/members?query=${encodeURIComponent(member.email)}`)
      .set(authorized(admin.token))
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain(member.email);

    const detail = await supertest(server)
      .get(`/api/v1/admin/members/${member.publicMemberId}`)
      .set(authorized(admin.token))
      .expect(200);
    const body = detail.body as MemberBody;
    expect(body.email).not.toBe(member.email);
    expect(body.profile.phone).not.toBe(member.rawPhone);
    expect(body.profile.phone).toBe(
      `${'*'.repeat(member.rawPhone.length - 4)}${member.rawPhone.slice(-4)}`,
    );
    expect(body.kyc?.identificationNumber).toBe(
      `****${kyc.identificationNumber.slice(-4)}`,
    );
    expect(JSON.stringify(body)).not.toContain(kyc.identificationNumber);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Sensitive address');
    expect(serialized).not.toContain('1990-01-02');
    expect(serialized).not.toContain(password);
    expect(serialized).not.toMatch(/password|credential|wallet|documentKey/i);
  });
});
