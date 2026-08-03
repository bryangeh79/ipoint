import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminMemberNotes,
  adminUsers,
  auditLogs,
  marketAccess,
  markets,
  memberKycCases,
  memberMarketPreferences,
  memberProfiles,
  members,
  memberStatusHistory,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
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
const password = 'Member-Ops-Password-123!';

interface MemberListBody {
  marketId: string;
  members: Array<{
    publicMemberId: string;
    email: string;
    status: string;
    currentMarketId: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

interface MemberDetailBody {
  publicMemberId: string;
  email: string;
  status: string;
  currentMarketId: string;
  profile: {
    fullName: string | null;
    phone: string | null;
    phoneVerificationStatus: string;
    birthDate: string | null;
    address: Record<string, unknown> | null;
  };
  kyc: {
    caseId: string;
    status: string;
    legalFullName: string | null;
    identificationNumber: string | null;
  } | null;
  notes: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface NotesBody {
  notes: Array<{
    id: string;
    adminUserId: string;
    marketId: string;
    content: string;
    isInternal: boolean;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

interface ErrorBody {
  error: { code: string; message?: string };
}

describe.skipIf(!databaseUrl)(
  'Admin Member Operations HTTP integration (P7-S5A)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR, Asia/Kuala_Lumpur
    let marketB: string; // code MB, SGD, Asia/Singapore

    const base = '/api/v1/admin/member-ops/members';

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
          name: `${code} Member Ops Test Market`,
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
            description: `${code} member ops integration test permission`,
          })),
        )
        .onConflictDoNothing({ target: permissions.code });
      const rows = await database.db.select().from(permissions);
      return rows
        .filter((row) => codes.includes(row.code))
        .map((row) => row.id);
    }

    /**
     * Session actor resolution (postgres-auth.store `hasActiveRole`) only
     * recognises the six template role codes, so each distinct permission set
     * used in this spec reuses one template-code role for the whole run.
     */
    const ADMIN_TEMPLATE_ROLE_CODES = [
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'FINANCE_OPERATOR',
      'FINANCE_APPROVER',
      'KYC_REVIEWER',
      'SUPPORT_READONLY_AUDITOR',
    ] as const;
    const roleCodeByPermissionSet = new Map<string, string>();

    async function createAdmin(options: {
      marketIds: string[];
      permissionCodes?: readonly string[];
    }): Promise<{ adminUserId: string; accountId: string; token: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `Member Ops Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? ['member.read'];
      const signature = [...permissionCodes].sort().join('|');
      let roleCode = roleCodeByPermissionSet.get(signature);
      if (!roleCode) {
        roleCode =
          ADMIN_TEMPLATE_ROLE_CODES[
            roleCodeByPermissionSet.size % ADMIN_TEMPLATE_ROLE_CODES.length
          ] ?? 'SUPER_ADMIN';
        roleCodeByPermissionSet.set(signature, roleCode);
      }
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: roleCode,
          name: `Member Ops HTTP Test Role (${roleCode})`,
          isSystem: false,
        })
        .onConflictDoNothing({ target: roles.code })
        .returning({ id: roles.id });
      let roleId = roleRows[0]?.id ?? '';
      if (!roleId) {
        const existing = await database.db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, roleCode))
          .limit(1);
        roleId = existing[0]?.id ?? '';
      }
      await database.db.insert(roleAssignments).values({ adminUserId, roleId });
      const permissionIds = await ensurePermissions(permissionCodes);
      await database.db
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      if (permissionIds.length > 0) {
        await database.db
          .insert(rolePermissions)
          .values(
            permissionIds.map((permissionId) => ({ roleId, permissionId })),
          )
          .onConflictDoNothing();
      }
      if (options.marketIds.length > 0) {
        await database.db
          .insert(marketAccess)
          .values(
            options.marketIds.map((marketId) => ({ adminUserId, marketId })),
          );
      }
      const token = (
        await auth.createAdminSession(account.accountId, adminUserId, {
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        })
      ).accessToken;
      return {
        adminUserId,
        accountId: account.accountId,
        token,
      };
    }

    /** Bind the Current Admin Market server-side on the admin's active session. */
    async function setCurrentMarket(
      accountId: string,
      marketId: string,
    ): Promise<void> {
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
    }

    async function createMember(
      marketId: string,
      status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE',
      options: { withPreference?: boolean } = {},
    ): Promise<{
      memberId: string;
      accountId: string;
      email: string;
      publicMemberId: string;
    }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(members)
        .values({
          accountId: account.accountId,
          publicMemberId: `mem_${randomUUID()}`,
          referralCode: randomUUID()
            .replaceAll('-', '')
            .slice(0, 8)
            .toUpperCase(),
          status,
          kycLevel: 'NONE',
          // members_closed_at_check requires closed_at for CLOSED rows.
          ...(status === 'CLOSED' ? { closedAt: new Date() } : {}),
        })
        .returning({
          id: members.id,
          publicMemberId: members.publicMemberId,
        });
      const memberId = inserted[0]?.id ?? '';
      const publicMemberId = inserted[0]?.publicMemberId ?? '';
      if (options.withPreference !== false) {
        await database.db.insert(memberMarketPreferences).values({
          memberId,
          marketId,
          isEnabled: true,
          isCurrent: true,
          sortOrder: 0,
        });
      }
      return {
        memberId,
        accountId: account.accountId,
        email: account.email,
        publicMemberId,
      };
    }

    async function createApprovedKyc(
      memberId: string,
      marketId: string,
    ): Promise<string> {
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
          legalFullName: 'Jane Mildred Doe',
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
      return rows[0]?.id ?? '';
    }

    async function memberActiveSessions(accountId: string) {
      return database.db
        .select({ id: sessions.id, revokedAt: sessions.revokedAt })
        .from(sessions)
        .where(
          and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)),
        );
    }

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'admin-member-ops-pepper-at-least-32-characters',
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
      auth = app.get(AuthService);
      database = app.get(DatabaseService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await ensureActiveMarket('MA', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('MB', 'SGD', 'Asia/Singapore');

      // Fixture members (shared across tests where counts are asserted).
      await createMember(marketA, 'ACTIVE');
      await createMember(marketA, 'ACTIVE');
      await createMember(marketA, 'SUSPENDED');
      await createMember(marketB, 'ACTIVE');
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

    describe('authentication, RBAC, and selected-market enforcement', () => {
      it('returns 401 without authentication and 403 for a non-admin actor', async () => {
        await supertest(server).get(base).expect(401);

        const member = await createMember(marketA, 'ACTIVE', {
          withPreference: false,
        });
        const memberToken = await getAccessToken(member.email);
        const denied = await supertest(server)
          .get(base)
          .set(authorized(memberToken))
          .expect(403);
        expect((denied.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
      });

      it('denies an admin without member.read', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(base)
          .set(authorized(admin.token))
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
      });

      it('requires a server-selected Current Admin Market (MARKET_SELECTION_REQUIRED)', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        const response = await supertest(server)
          .get(base)
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_SELECTION_REQUIRED',
        );
      });

      it('rejects a client-supplied market header that differs from the Current Admin Market', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(base)
          .set(authorized(admin.token))
          .set('x-market-id', marketB)
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });

      it('rejects a client-supplied market query parameter as invalid input', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        await supertest(server)
          .get(`${base}?currentMarket=${marketB}`)
          .set(authorized(admin.token))
          .expect(400);
        await supertest(server)
          .get(`${base}?marketId=${marketB}`)
          .set(authorized(admin.token))
          .expect(400);
      });

      it('lists only the selected market even when the admin holds two grants', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(base)
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as MemberListBody;
        expect(body.marketId).toBe(marketA);
        // Fixture members: 2 ACTIVE + 1 SUSPENDED in MA, 1 ACTIVE in MB.
        expect(body.total).toBe(3);
        expect(
          body.members.every((member) => member.currentMarketId === marketA),
        ).toBe(true);

        await setCurrentMarket(admin.accountId, marketB);
        const marketBList = await supertest(server)
          .get(base)
          .set(authorized(admin.token))
          .expect(200);
        const bodyB = marketBList.body as MemberListBody;
        expect(bodyB.total).toBe(1);
        expect(bodyB.members[0]?.currentMarketId).toBe(marketB);
      });

      it('returns 409 MARKET_CONTEXT_MISMATCH for a member of another market', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const memberB = await createMember(marketB, 'ACTIVE');
        const response = await supertest(server)
          .get(`${base}/${memberB.publicMemberId}`)
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });

      it('returns 404 for an unknown member id', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(`${base}/mem_does_not_exist`)
          .set(authorized(admin.token))
          .expect(404);
        expect((response.body as ErrorBody).error.code).toBe(
          'ADMIN_MEMBER_NOT_FOUND',
        );
      });

      it('denies writes without the status permission even when member.read is held', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${base}/${member.publicMemberId}/suspend`)
          .set(authorized(admin.token))
          .send({ reason: 'No permission', idempotencyKey: randomUUID() })
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
      });
    });

    describe('masking and privacy (Support-visible summaries)', () => {
      it('masks email, name, phone, and identification in list and detail', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const account = await createAccount();
        const inserted = await database.db
          .insert(members)
          .values({
            accountId: account.accountId,
            publicMemberId: `mem_${randomUUID()}`,
            referralCode: 'MASKCODE',
            status: 'ACTIVE',
            kycLevel: 'LEVEL_2',
          })
          .returning({
            id: members.id,
            publicMemberId: members.publicMemberId,
          });
        const memberId = inserted[0]?.id ?? '';
        const publicMemberId = inserted[0]?.publicMemberId ?? '';
        await database.db.insert(memberMarketPreferences).values({
          memberId,
          marketId: marketA,
          isEnabled: true,
          isCurrent: true,
          sortOrder: 0,
        });
        await database.db.insert(memberProfiles).values({
          memberId,
          displayName: 'Jane Doe',
          fullName: 'Jane Mildred Doe',
          phone: '+60123456789',
          phoneNormalized: '+60123456789',
          phoneVerifiedAt: new Date(),
          phoneVerificationStatus: 'VERIFIED',
          locale: 'en-MY',
          language: 'en',
        });
        await createApprovedKyc(memberId, marketA);

        const list = await supertest(server)
          .get(base)
          .set(authorized(admin.token))
          .expect(200);
        const listed = (list.body as MemberListBody).members.find(
          (member) => member.publicMemberId === publicMemberId,
        );
        expect(listed?.email).toMatch(/^\S{1,4}\*{3}@/);
        const listedLocal = (listed?.email ?? '').split('@')[0] ?? '';
        expect(listedLocal.length).toBeLessThanOrEqual(4);
        expect(listedLocal).toContain('*');

        const detail = await supertest(server)
          .get(`${base}/${publicMemberId}`)
          .set(authorized(admin.token))
          .expect(200);
        const body = detail.body as MemberDetailBody;
        expect(body.email).toMatch(/^\S{1,4}\*{3}@/);
        expect(body.profile.fullName).toBe('J*** M****** D**');
        expect(body.profile.phone).toBe('********6789');
        expect(body.kyc?.legalFullName).toBe('J*** M****** D**');
        expect(body.kyc?.identificationNumber).toMatch(/^\*{4}[A-Z0-9]{4}$/);
        expect(body.profile.birthDate).toBeNull();
        expect(body.profile.address).toBeNull();
      });

      it('never exposes wallet, ledger, or balance fields on the detail surface', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const member = await createMember(marketA, 'ACTIVE');
        const detail = await supertest(server)
          .get(`${base}/${member.publicMemberId}`)
          .set(authorized(admin.token))
          .expect(200);
        const serialized = JSON.stringify(detail.body);
        for (const forbidden of [
          'balance',
          'ledger',
          'wallet',
          'availableBalance',
          'totalBalance',
          'pointBalance',
        ]) {
          expect(serialized.toLowerCase()).not.toContain(forbidden);
        }
      });

      it('writes an audit-of-view record for every successful detail view', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const member = await createMember(marketA, 'ACTIVE');
        await supertest(server)
          .get(`${base}/${member.publicMemberId}`)
          .set(authorized(admin.token))
          .expect(200);

        const auditRows = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityType, 'member'),
              eq(auditLogs.entityId, member.memberId),
              eq(auditLogs.action, 'member.ops.view'),
              eq(auditLogs.marketId, marketA),
              eq(auditLogs.actorType, 'ADMIN_USER'),
            ),
          );
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]?.result).toBe('SUCCESS');
      });
    });

    describe('status transitions (owner commands)', () => {
      it('suspends an ACTIVE member, revokes sessions, and writes owner history/audit', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        await getAccessToken(member.email);
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.status.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const response = await supertest(server)
          .post(`${base}/${member.publicMemberId}/suspend`)
          .set(authorized(admin.token))
          .send({ reason: 'Suspension review', idempotencyKey: randomUUID() })
          .expect(200);
        expect((response.body as MemberDetailBody).status).toBe('SUSPENDED');

        const activeSessions = await memberActiveSessions(member.accountId);
        expect(activeSessions).toHaveLength(0);

        const history = await database.db
          .select()
          .from(memberStatusHistory)
          .where(
            and(
              eq(memberStatusHistory.memberId, member.memberId),
              eq(memberStatusHistory.toStatus, 'SUSPENDED'),
            ),
          );
        expect(history).toHaveLength(1);
        const audit = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, member.memberId),
              eq(auditLogs.action, 'member.suspend'),
            ),
          );
        expect(audit).toHaveLength(1);
      });

      it('reactivates a SUSPENDED member back to ACTIVE', async () => {
        const member = await createMember(marketA, 'SUSPENDED');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.status.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${base}/${member.publicMemberId}/reactivate`)
          .set(authorized(admin.token))
          .send({ reason: 'Review complete', idempotencyKey: randomUUID() })
          .expect(200);
        expect((response.body as MemberDetailBody).status).toBe('ACTIVE');
      });

      it('closes with confirmation and rejects close without the exact confirmation text', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.status.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        // The frozen closeMemberSchema requires the literal 'CONFIRM' at the
        // pipe, so a missing confirmation is a 400 on this route exactly as on
        // the frozen owner route (the service-level
        // ADMIN_MEMBER_CLOSE_CONFIRMATION_REQUIRED guard stays as
        // defense-in-depth behind the schema).
        await supertest(server)
          .post(`${base}/${member.publicMemberId}/close`)
          .set(authorized(admin.token))
          .send({ reason: 'Close', idempotencyKey: randomUUID() })
          .expect(400);
        await supertest(server)
          .post(`${base}/${member.publicMemberId}/close`)
          .set(authorized(admin.token))
          .send({
            reason: 'Close',
            confirmationText: 'WRONG',
            idempotencyKey: randomUUID(),
          })
          .expect(400);

        const closed = await supertest(server)
          .post(`${base}/${member.publicMemberId}/close`)
          .set(authorized(admin.token))
          .send({
            reason: 'Governed closure',
            confirmationText: 'CONFIRM',
            idempotencyKey: randomUUID(),
          })
          .expect(200);
        expect((closed.body as MemberDetailBody).status).toBe('CLOSED');
        expect((closed.body as MemberDetailBody).closedAt).toBeTruthy();
      });

      it('rejects an invalid transition (suspend a CLOSED member)', async () => {
        const member = await createMember(marketA, 'CLOSED');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.status.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${base}/${member.publicMemberId}/suspend`)
          .set(authorized(admin.token))
          .send({ reason: 'Invalid', idempotencyKey: randomUUID() })
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'ADMIN_MEMBER_INVALID_STATUS',
        );
      });

      it('surfaces suspended/closed status in the masked detail', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const suspended = await createMember(marketA, 'SUSPENDED');
        const closed = await createMember(marketA, 'CLOSED');
        const suspendedDetail = await supertest(server)
          .get(`${base}/${suspended.publicMemberId}`)
          .set(authorized(admin.token))
          .expect(200);
        expect((suspendedDetail.body as MemberDetailBody).status).toBe(
          'SUSPENDED',
        );
        const closedDetail = await supertest(server)
          .get(`${base}/${closed.publicMemberId}`)
          .set(authorized(admin.token))
          .expect(200);
        expect((closedDetail.body as MemberDetailBody).status).toBe('CLOSED');
      });
    });

    describe('session revocation and reverification (owner commands)', () => {
      it('revokes every active session without changing member status', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        await getAccessToken(member.email);
        await getAccessToken(member.email);
        expect(await memberActiveSessions(member.accountId)).toHaveLength(2);

        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.session.revoke'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${base}/${member.publicMemberId}/revoke-sessions`)
          .set(authorized(admin.token))
          .send({ reason: 'Compromised device', idempotencyKey: randomUUID() })
          .expect(200);
        expect((response.body as MemberDetailBody).status).toBe('ACTIVE');
        expect(await memberActiveSessions(member.accountId)).toHaveLength(0);
      });

      it('requires reverification only for an approved KYC case', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        await createApprovedKyc(member.memberId, marketA);
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.reverification.require'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${base}/${member.publicMemberId}/require-reverification`)
          .set(authorized(admin.token))
          .send({ reason: 'Identity re-check', idempotencyKey: randomUUID() })
          .expect(200);
        const kycRows = await database.db
          .select({ status: memberKycCases.status })
          .from(memberKycCases)
          .where(eq(memberKycCases.memberId, member.memberId));
        expect(kycRows[0]?.status).toBe('REVERIFICATION_REQUIRED');
        expect((response.body as MemberDetailBody).kyc?.status).toBe(
          'REVERIFICATION_REQUIRED',
        );
      });

      it('rejects reverification without an approved KYC case', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.reverification.require'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${base}/${member.publicMemberId}/require-reverification`)
          .set(authorized(admin.token))
          .send({ reason: 'Identity re-check', idempotencyKey: randomUUID() })
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'ADMIN_MEMBER_KYC_REVERIFICATION_NOT_ALLOWED',
        );
      });
    });

    describe('notes (owner commands)', () => {
      it('adds a note and returns it in detail and the notes list', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [
            'member.read',
            'member.note.create',
            'member.note.read',
          ],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const add = await supertest(server)
          .post(`${base}/${member.publicMemberId}/notes`)
          .set(authorized(admin.token))
          .send({
            content: 'Follow up on KYC documents.',
            isInternal: true,
            idempotencyKey: randomUUID(),
          })
          .expect(200);
        const detailNotes = (add.body as MemberDetailBody).notes as Array<{
          content: string;
          isInternal: boolean;
        }>;
        expect(detailNotes).toHaveLength(1);
        expect(detailNotes[0]?.content).toBe('Follow up on KYC documents.');
        expect(detailNotes[0]?.isInternal).toBe(true);

        const notes = await supertest(server)
          .get(`${base}/${member.publicMemberId}/notes`)
          .set(authorized(admin.token))
          .expect(200);
        const body = notes.body as NotesBody;
        expect(body.total).toBe(1);
        expect(body.notes[0]?.marketId).toBe(marketA);
        expect(body.notes[0]?.content).toBe('Follow up on KYC documents.');
      });

      it('rejects an empty note through the owner validation chain', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.note.create'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        // Whitespace-only content fails the strict owner schema at the pipe
        // (400), identically on the frozen owner route; the owner service
        // ADMIN_MEMBER_NOTE_EMPTY check stays as defense-in-depth behind it.
        await supertest(server)
          .post(`${base}/${member.publicMemberId}/notes`)
          .set(authorized(admin.token))
          .send({ content: '   ', idempotencyKey: randomUUID() })
          .expect(400);
      });

      it('keeps notes market-scoped to the selected market', async () => {
        const memberA = await createMember(marketA, 'ACTIVE');
        const memberB = await createMember(marketB, 'ACTIVE');
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.read', 'member.note.create'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        await supertest(server)
          .post(`${base}/${memberA.publicMemberId}/notes`)
          .set(authorized(admin.token))
          .send({ content: 'Market A note', idempotencyKey: randomUUID() })
          .expect(200);
        // Member B is outside the selected market: blocked before any write.
        const cross = await supertest(server)
          .post(`${base}/${memberB.publicMemberId}/notes`)
          .set(authorized(admin.token))
          .send({ content: 'Should not land', idempotencyKey: randomUUID() })
          .expect(409);
        expect((cross.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
        const noteRows = await database.db
          .select()
          .from(adminMemberNotes)
          .where(eq(adminMemberNotes.content, 'Should not land'));
        expect(noteRows).toHaveLength(0);
      });
    });

    describe('idempotency and conflict behavior (owner preserved)', () => {
      it('replays the same idempotency key with the same payload without a second effect', async () => {
        const member = await createMember(marketA, 'ACTIVE');
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.read', 'member.status.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const key = randomUUID();
        const payload = { reason: 'Suspension review', idempotencyKey: key };
        const first = await supertest(server)
          .post(`${base}/${member.publicMemberId}/suspend`)
          .set(authorized(admin.token))
          .send(payload)
          .expect(200);
        expect((first.body as MemberDetailBody).status).toBe('SUSPENDED');

        const second = await supertest(server)
          .post(`${base}/${member.publicMemberId}/suspend`)
          .set(authorized(admin.token))
          .send(payload)
          .expect(200);
        expect((second.body as MemberDetailBody).status).toBe('SUSPENDED');

        const history = await database.db
          .select()
          .from(memberStatusHistory)
          .where(eq(memberStatusHistory.memberId, member.memberId));
        expect(history).toHaveLength(1);
      });
    });
  },
);
