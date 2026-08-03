import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  adminMfaFactors,
  adminStepUpGrants,
  adminUsers,
  auditLogs,
  marketAccess,
  markets,
  memberKycCases,
  memberKycHistory,
  memberKycIdempotencyKeys,
  members,
  merchantBranches,
  merchantGroups,
  merchantKycReviews,
  merchantKycSubmissions,
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
import { totpCode } from '../auth/admin-mfa.crypto.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Kyc-Ops-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

interface MemberKycCaseBody {
  id: string;
  marketId: string;
  status: string;
  levelRequested: string;
  legalFullName: string | null;
  identificationNumber: string | null;
  dateOfBirth: string | null;
  residentialAddress: Record<string, unknown> | null;
  member: {
    publicMemberId: string;
    email: string;
    accountCountry: string;
    status: string;
    kycLevel: string;
  };
  documents: Array<Record<string, unknown>>;
  evidenceAccess?: {
    masked: boolean;
    rawDocumentContent: boolean;
    audited: boolean;
  };
  [key: string]: unknown;
}

interface MerchantQueueBody {
  items: Array<{
    submission_id: string;
    branch_id: string;
    merchant_id: string;
    display_name: string;
    status: string;
    submission_version: number;
    submitted_at: string | null;
    reviewed_at: string | null;
  }>;
  marketId: string;
  limit: number;
  offset: number;
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 fixture value.');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

describe.skipIf(!databaseUrl)(
  'Admin KYC Operations HTTP integration (P7-S5C)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR
    let marketB: string; // code MB, SGD
    let mfaSecret: Buffer;
    /** KYC fixture case ids (marketA: 2 SUBMITTED + 1 APPROVED; marketB: 1 SUBMITTED). */
    let caseA1: string;
    let caseA2: string;
    let caseAApproved: string;
    let caseB1: string;

    const memberBase = '/api/v1/admin/kyc-ops/members';
    const merchantBase = '/api/v1/admin/kyc-ops/merchants';

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
          name: `${code} KYC Ops Test Market`,
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

    async function createMember(
      marketId: string,
    ): Promise<{ memberId: string; accountId: string; email: string }> {
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
          status: 'ACTIVE',
          kycLevel: 'NONE',
        })
        .returning({
          id: members.id,
          publicMemberId: members.publicMemberId,
        });
      const memberId = inserted[0]?.id ?? '';
      void marketId;
      return { memberId, accountId: account.accountId, email: account.email };
    }

    async function createKycCase(
      marketId: string,
      status:
        | 'SUBMITTED'
        | 'UNDER_REVIEW'
        | 'APPROVED'
        | 'REJECTED'
        | 'MORE_INFO_REQUIRED',
    ): Promise<{ caseId: string; memberId: string }> {
      const member = await createMember(marketId);
      const now = new Date();
      const rows = await database.db
        .insert(memberKycCases)
        .values({
          memberId: member.memberId,
          marketId,
          status,
          levelRequested: 'LEVEL_2',
          legalFullName: 'Jane Mildred Doe',
          identificationType: 'NATIONAL_ID',
          identificationNumber: 'MY900102141234',
          dateOfBirth: '1990-01-02',
          nationality: 'MY',
          residentialAddress: { line1: '1 Integration Street' },
          accountCountrySnapshot: 'MY',
          submissionMarketId: marketId,
          consentVersion: 'test-v1',
          submittedAt: now,
          reviewedAt:
            status === 'APPROVED' || status === 'REJECTED' ? now : null,
        })
        .returning({ id: memberKycCases.id });
      return { caseId: rows[0]?.id ?? '', memberId: member.memberId };
    }

    async function createMerchantBranch(
      marketId: string,
      name = 'Acme Sdn Bhd',
    ): Promise<string> {
      const account = await createAccount();
      const group = await database.db
        .insert(merchantGroups)
        .values({
          accountId: account.accountId,
          marketId,
          name: `${name} Group`,
        })
        .returning({ id: merchantGroups.id });
      const branch = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: group[0]?.id ?? '',
          merchantId: `MERCH-${randomUUID()}`,
          marketId,
          name,
          status: 'PENDING_KYC',
        })
        .returning({ id: merchantBranches.id });
      return branch[0]?.id ?? '';
    }

    async function createMerchantKycSubmission(
      branchId: string,
      status: 'SUBMITTED' | 'UNDER_REVIEW' | 'RESUBMISSION_REQUIRED',
      version = 1,
    ): Promise<string> {
      const rows = await database.db
        .insert(merchantKycSubmissions)
        .values({
          merchantBranchId: branchId,
          status,
          submissionVersion: version,
          submittedData: {
            business_certification: {
              registration_number: '202001012345',
              business_name_registered: 'Acme Sdn Bhd',
              business_type: 'private_limited',
              tax_id: 'C-1234567890',
              registered_address: '1 Integration Street',
            },
            pic_identity: {
              full_name: 'Jane Mildred Doe',
              identity_type: 'nric',
              identity_number: '900102-14-1234',
              date_of_birth: '1990-01-02',
              nationality: 'MY',
            },
            pic_contact: {
              email: 'jane@example.com',
              phone: '+60123456789',
            },
          },
          submittedAt: new Date(),
        })
        .returning({ id: merchantKycSubmissions.id });
      return rows[0]?.id ?? '';
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
            description: `${code} kyc ops integration test permission`,
          })),
        )
        .onConflictDoNothing({ target: permissions.code });
      const rows = await database.db.select().from(permissions);
      return rows
        .filter((row) => codes.includes(row.code))
        .map((row) => row.id);
    }

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
      /** Enroll MFA for the admin (needed for evidence step-up tests). */
      enrollMfa?: boolean;
    }): Promise<{ adminUserId: string; accountId: string; token: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `KYC Ops Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? ['member.kyc.read'];
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
          name: `KYC Ops HTTP Test Role (${roleCode})`,
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

      if (options.enrollMfa) {
        const enrollment = await supertest(server)
          .post('/api/v1/auth/admin/mfa/enrollment/start')
          .send({ email: account.email, password })
          .expect(202);
        const uri = new URL(enrollment.body.otpauth_uri as string);
        const secretText = uri.searchParams.get('secret');
        expect(secretText).toBeTruthy();
        mfaSecret = decodeBase32(secretText ?? '');
        await supertest(server)
          .post('/api/v1/auth/admin/mfa/enrollment/confirm')
          .send({
            challenge_id: enrollment.body.enrollment_challenge_id,
            code: totpCode(mfaSecret, Math.floor(Date.now() / 30_000)),
          })
          .expect(200);
      }
      return { adminUserId, accountId: account.accountId, token };
    }

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

    /**
     * Seed a valid step-up grant bound to the admin's active session and MFA
     * factor, with `action_class` equal to the canonical permission code the
     * RbacGuard consumes.
     *
     * Upstream note (P7-S2C, outside this task's allowed paths): the real
     * challenge flow (`/auth/admin/mfa/step-up/challenge`) constrains
     * `action_class` to `^[A-Z0-9_:.]+$`, so it can mint grants for
     * uppercase action classes only, while the RbacGuard consumes grants
     * whose `action_class` equals the lowercase catalog permission code. The
     * guard therefore fails closed (403 MFA_STEP_UP_REQUIRED) for every
     * real-flow grant on catalog permissions. Seeding the grant row directly
     * exercises the canonical guard + adapter evidence path end-to-end;
     * remediating the upstream action-class mismatch belongs to the P7-S2
     * owner (frozen).
     */
    async function seedStepUpGrant(
      admin: { adminUserId: string; accountId: string; token: string },
      actionClass: string,
      marketId: string,
    ): Promise<string> {
      const token = `stepup_${randomUUID()}${randomUUID()}`;
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.accountId, admin.accountId),
            isNull(sessions.revokedAt),
          ),
        )
        .orderBy(sessions.createdAt)
        .limit(1);
      const sessionId = sessionRows[0]?.id;
      if (!sessionId) throw new Error('No active session for step-up.');
      const factorRows = await database.db
        .select({ id: adminMfaFactors.id })
        .from(adminMfaFactors)
        .where(
          and(
            eq(adminMfaFactors.adminUserId, admin.adminUserId),
            eq(adminMfaFactors.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      const factorId = factorRows[0]?.id;
      if (!factorId) throw new Error('No active MFA factor for step-up.');
      const issuedAt = new Date();
      await database.db.insert(adminStepUpGrants).values({
        grantHash: createHash('sha256').update(token).digest('hex'),
        sessionId,
        adminUserId: admin.adminUserId,
        factorId,
        actionClass,
        marketId,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 9 * 60 * 1000),
      });
      return token;
    }

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'admin-kyc-ops-pepper-at-least-32-characters',
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

      // Fixture KYC cases (counts asserted against these in the isolation test).
      const a1 = await createKycCase(marketA, 'SUBMITTED');
      const a2 = await createKycCase(marketA, 'SUBMITTED');
      const aApproved = await createKycCase(marketA, 'APPROVED');
      const b1 = await createKycCase(marketB, 'SUBMITTED');
      caseA1 = a1.caseId;
      caseA2 = a2.caseId;
      caseAApproved = aApproved.caseId;
      caseB1 = b1.caseId;
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
        await supertest(server).get(memberBase).expect(401);

        const member = await createMember(marketA);
        const memberToken = (await auth.login(member.email, password))
          .accessToken;
        const denied = await supertest(server)
          .get(memberBase)
          .set(authorized(memberToken))
          .expect(403);
        expect((denied.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
      });

      it('denies an admin without member.kyc.read', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(memberBase)
          .set(authorized(admin.token))
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
      });

      it('requires a server-selected Current Admin Market (MARKET_SELECTION_REQUIRED)', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        const response = await supertest(server)
          .get(memberBase)
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_SELECTION_REQUIRED',
        );
      });

      it('rejects a client-supplied market header that differs from the Current Admin Market', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(memberBase)
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
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        await supertest(server)
          .get(`${memberBase}?marketId=${marketB}`)
          .set(authorized(admin.token))
          .expect(400);
      });

      it('lists only the selected market even when the admin holds two grants', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(memberBase)
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as {
          marketId: string;
          items: Array<{ marketId: string }>;
          total: number;
        };
        expect(body.marketId).toBe(marketA);
        expect(body.total).toBe(3); // 2 SUBMITTED + 1 APPROVED in MA
        expect(body.items.every((item) => item.marketId === marketA)).toBe(
          true,
        );

        await setCurrentMarket(admin.accountId, marketB);
        const marketBList = await supertest(server)
          .get(memberBase)
          .set(authorized(admin.token))
          .expect(200);
        const bodyB = marketBList.body as {
          marketId: string;
          items: Array<{ marketId: string }>;
          total: number;
        };
        expect(bodyB.total).toBe(1);
        expect(bodyB.items[0]?.marketId).toBe(marketB);

        // Every queue view is audited (P7-S5C audit-of-view incl. queues).
        const queueAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'member.kyc.ops.queue.view'),
              eq(auditLogs.marketId, marketA),
              eq(auditLogs.actorType, 'ADMIN_USER'),
              eq(auditLogs.result, 'SUCCESS'),
            ),
          );
        expect(queueAudits.length).toBeGreaterThanOrEqual(1);
      });

      it('returns 409 MARKET_CONTEXT_MISMATCH for a case of another market', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(`${memberBase}/${caseB1}`)
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
        // Denied cross-market sensitive access is audited (who/what/when/why).
        const deniedAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'member.kyc.ops.view'),
              eq(auditLogs.entityType, 'member_kyc_case'),
              eq(auditLogs.entityId, caseB1),
              eq(auditLogs.result, 'DENIED'),
            ),
          );
        expect(deniedAudits).toHaveLength(1);
        expect(deniedAudits[0]?.reason).toContain('MARKET_CONTEXT_MISMATCH');
      });

      it('returns 404 for an unknown case id', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(`${memberBase}/${randomUUID()}`)
          .set(authorized(admin.token))
          .expect(404);
        expect((response.body as ErrorBody).error.code).toBe(
          'ADMIN_KYC_CASE_NOT_FOUND',
        );
      });

      it('denies review actions without member.kyc.decide even when read is held', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${memberBase}/${caseA1}/approve`)
          .set(authorized(admin.token))
          .send({ reason: 'No permission' })
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
      });
    });

    describe('masking and privacy (Support-role summaries)', () => {
      it('masks emails in the queue and masks identity fields in the case detail', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');

        const list = await supertest(server)
          .get(memberBase)
          .set(authorized(admin.token))
          .expect(200);
        const listed = (
          list.body as { items: Array<{ member: { email: string } }> }
        ).items.find((item) => item.member.email !== '');
        expect(listed?.member.email).toMatch(/^\S{1,4}\*{3}@/);

        const detail = await supertest(server)
          .get(`${memberBase}/${created.caseId}`)
          .set(authorized(admin.token))
          .expect(200);
        const body = detail.body as MemberKycCaseBody;
        expect(body.legalFullName).toBe('J*** M*** D***');
        expect(body.dateOfBirth).toBeNull();
        expect(body.residentialAddress).toBeNull();
        expect(body.identificationNumber).toMatch(/^\*{4}[A-Z0-9]{4}$/);
        expect(body.evidenceAccess?.masked).toBe(true);
        // Document rows are metadata only — never raw content references.
        const serialized = JSON.stringify(detail.body);
        expect(serialized).not.toContain('object_key');
        expect(serialized).not.toContain('originalFilename');
        expect(serialized).not.toContain('objectKey');
      });

      it('writes an audit-of-view record for every masked detail view', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');
        await supertest(server)
          .get(`${memberBase}/${created.caseId}`)
          .set(authorized(admin.token))
          .expect(200);
        const auditRows = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityType, 'member_kyc_case'),
              eq(auditLogs.entityId, created.caseId),
              eq(auditLogs.action, 'member.kyc.ops.view'),
              eq(auditLogs.marketId, marketA),
              eq(auditLogs.actorType, 'ADMIN_USER'),
              eq(auditLogs.result, 'SUCCESS'),
            ),
          );
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]?.result).toBe('SUCCESS');
      });
    });

    describe('evidence gating (§6.4: permission + reason + step-up + audit-of-view)', () => {
      it('denies raw evidence without the dedicated permission', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(admin.token))
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
        // Denied raw-evidence access is audited with the denial reason.
        const deniedAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'member.kyc.ops.evidence.view'),
              eq(auditLogs.entityType, 'member_kyc_case'),
              eq(auditLogs.entityId, caseA1),
              eq(auditLogs.result, 'DENIED'),
            ),
          );
        expect(deniedAudits).toHaveLength(1);
        expect(deniedAudits[0]?.reason).toContain('PERMISSION_DENIED');
      });

      it('denies raw evidence for a Support-role admin (masked reads only) and audits it', async () => {
        // Support / Read-only Auditor holds the masked read permission but
        // NEVER the dedicated evidence permission (catalog-frozen): the
        // server denies with 403 + DENIED audit for every attempt.
        const support = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read'],
        });
        await setCurrentMarket(support.accountId, marketA);
        const response = await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(support.token))
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
        const deniedAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'member.kyc.ops.evidence.view'),
              eq(auditLogs.entityId, caseA1),
              eq(auditLogs.result, 'DENIED'),
              eq(auditLogs.actorType, 'ADMIN_USER'),
            ),
          );
        expect(deniedAudits.length).toBeGreaterThanOrEqual(1);
      });

      it('denies every KYC surface for a Finance-role admin (no KYC permission) and audits it', async () => {
        // Finance Operator/Approver has no KYC permission in the canonical
        // catalog (frozen): the server denies the queue and the evidence
        // endpoint; no financial-identifier-only KYC read exists to expose.
        const finance = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['wallet.ipoint.read'],
        });
        await setCurrentMarket(finance.accountId, marketA);
        const queueResponse = await supertest(server)
          .get(memberBase)
          .set(authorized(finance.token))
          .expect(403);
        expect((queueResponse.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
        const evidenceResponse = await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(finance.token))
          .expect(403);
        expect((evidenceResponse.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
        const deniedAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorType, 'ADMIN_USER'),
              eq(auditLogs.result, 'DENIED'),
            ),
          );
        expect(
          deniedAudits.some((row) =>
            row.action.includes('member.kyc.ops.evidence'),
          ),
        ).toBe(true);
      });

      it('requires a recorded sensitive-access reason (422)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.evidence.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(admin.token))
          .expect(422);
        expect((response.body as ErrorBody).error.code).toBe(
          'SENSITIVE_VIEW_REASON_REQUIRED',
        );
        // Missing recorded reason is a denied sensitive view: audited.
        const deniedAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'member.kyc.ops.evidence.view'),
              eq(auditLogs.entityId, caseA1),
              eq(auditLogs.result, 'DENIED'),
            ),
          );
        expect(deniedAudits.length).toBeGreaterThanOrEqual(1);
        expect(
          deniedAudits.some((row) =>
            row.reason?.includes('SENSITIVE_VIEW_REASON_REQUIRED'),
          ),
        ).toBe(true);
      });

      it('requires a fresh step-up grant (403 MFA_STEP_UP_REQUIRED)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.evidence.view'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(admin.token))
          .set('x-sensitive-access-reason', 'Identity verification review')
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'MFA_STEP_UP_REQUIRED',
        );
        // Missing step-up grant is a denied sensitive view: audited.
        const deniedAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'member.kyc.ops.evidence.view'),
              eq(auditLogs.entityId, caseA1),
              eq(auditLogs.result, 'DENIED'),
            ),
          );
        expect(deniedAudits.length).toBeGreaterThanOrEqual(1);
        expect(
          deniedAudits.some((row) =>
            row.reason?.includes('MFA_STEP_UP_REQUIRED'),
          ),
        ).toBe(true);
      });

      it('documents the upstream step-up action-class constraint (P7-S2C, frozen)', async () => {
        // The frozen challenge schema only accepts UPPERCASE action classes,
        // while the RbacGuard consumes grants whose action_class equals the
        // lowercase catalog permission code. This assertion pins the frozen
        // behaviour so the upstream remediation (P7-S2 owner) is visible.
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.evidence.view'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        await supertest(server)
          .post('/api/v1/auth/admin/mfa/step-up/challenge')
          .set(authorized(admin.token))
          .send({
            action_class: 'member.kyc.evidence.view',
            market_id: marketA,
          })
          .expect(400);
      });

      it('serves minimum evidence only with permission + reason + step-up, and audits the view', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.evidence.view'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const grant = await seedStepUpGrant(
          admin,
          'member.kyc.evidence.view',
          marketA,
        );
        const response = await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(admin.token))
          .set('x-step-up-token', grant)
          .set('x-sensitive-access-reason', 'Identity verification review')
          .expect(200);
        const body = response.body as MemberKycCaseBody;
        expect(body.legalFullName).toBe('Jane Mildred Doe');
        expect(body.dateOfBirth).toBe('1990-01-02');
        expect(body.residentialAddress).toEqual({
          line1: '1 Integration Street',
        });
        expect(body.evidenceAccess?.masked).toBe(false);

        const auditRows = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityType, 'member_kyc_case'),
              eq(auditLogs.entityId, caseA1),
              eq(auditLogs.action, 'member.kyc.ops.evidence.view'),
              eq(auditLogs.marketId, marketA),
              eq(auditLogs.actorType, 'ADMIN_USER'),
              eq(auditLogs.result, 'SUCCESS'),
            ),
          );
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]?.result).toBe('SUCCESS');
      });

      it('consumes the step-up grant exactly once (second view requires a new grant)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.evidence.view'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const grant = await seedStepUpGrant(
          admin,
          'member.kyc.evidence.view',
          marketA,
        );
        await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(admin.token))
          .set('x-step-up-token', grant)
          .set('x-sensitive-access-reason', 'Identity verification review')
          .expect(200);
        // The same grant must not be reusable.
        await supertest(server)
          .get(`${memberBase}/${caseA1}/evidence`)
          .set(authorized(admin.token))
          .set('x-step-up-token', grant)
          .set('x-sensitive-access-reason', 'Identity verification review')
          .expect(403);
      });
    });

    describe('member KYC review actions (frozen Phase 2 owner commands)', () => {
      it('starts a review on a SUBMITTED case with owner history and audit', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');
        const response = await supertest(server)
          .post(`${memberBase}/${created.caseId}/start-review`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Starting document review' })
          .expect(200);
        expect((response.body as MemberKycCaseBody).status).toBe(
          'UNDER_REVIEW',
        );
        const history = await database.db
          .select()
          .from(memberKycHistory)
          .where(
            and(
              eq(memberKycHistory.memberKycCaseId, created.caseId),
              eq(memberKycHistory.eventType, 'REVIEW_STARTED'),
            ),
          );
        expect(history).toHaveLength(1);
        const audit = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, created.caseId),
              eq(auditLogs.action, 'member.kyc.start-review'),
            ),
          );
        expect(audit).toHaveLength(1);
      });

      it('requests more information from UNDER_REVIEW', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');
        const base = `${memberBase}/${created.caseId}`;
        await supertest(server)
          .post(`${base}/start-review`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Start' })
          .expect(200);
        const more = await supertest(server)
          .post(`${base}/request-more-info`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Need a clearer identity document' })
          .expect(200);
        expect((more.body as MemberKycCaseBody).status).toBe(
          'MORE_INFO_REQUIRED',
        );
      });

      it('approves an UNDER_REVIEW case and raises the member KYC level', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');
        const base = `${memberBase}/${created.caseId}`;
        await supertest(server)
          .post(`${base}/start-review`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Start' })
          .expect(200);
        const approved = await supertest(server)
          .post(`${base}/approve`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Documents verified' })
          .expect(200);
        expect((approved.body as MemberKycCaseBody).status).toBe('APPROVED');
        const memberRows = await database.db
          .select({ kycLevel: members.kycLevel })
          .from(members)
          .where(eq(members.id, created.memberId));
        expect(memberRows[0]?.kycLevel).toBe('LEVEL_2');
      });

      it('rejects an UNDER_REVIEW case', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');
        const base = `${memberBase}/${created.caseId}`;
        await supertest(server)
          .post(`${base}/start-review`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Start' })
          .expect(200);
        const rejected = await supertest(server)
          .post(`${base}/reject`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Document does not match the member' })
          .expect(200);
        expect((rejected.body as MemberKycCaseBody).status).toBe('REJECTED');
      });

      it('requires reverification only from APPROVED', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'APPROVED');
        const response = await supertest(server)
          .post(`${memberBase}/${created.caseId}/require-reverification`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Periodic identity re-check' })
          .expect(200);
        expect((response.body as MemberKycCaseBody).status).toBe(
          'REVERIFICATION_REQUIRED',
        );
      });

      it('rejects an invalid transition with the owner conflict code', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');
        const response = await supertest(server)
          .post(`${memberBase}/${created.caseId}/approve`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Premature approval' })
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'ADMIN_KYC_INVALID_STATE',
        );
      });

      it('blocks an out-of-market action without changing state', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .post(`${memberBase}/${caseB1}/start-review`)
          .set(authorized(admin.token))
          .set('idempotency-key', randomUUID())
          .send({ reason: 'Cross-market attempt' })
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
        const caseRows = await database.db
          .select({ status: memberKycCases.status })
          .from(memberKycCases)
          .where(eq(memberKycCases.id, caseB1));
        expect(caseRows[0]?.status).toBe('SUBMITTED');
      });

      it('replays the same idempotency key without a second effect', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['member.kyc.read', 'member.kyc.decide'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const created = await createKycCase(marketA, 'SUBMITTED');
        const key = randomUUID();
        const payload = { reason: 'Starting document review' };
        const first = await supertest(server)
          .post(`${memberBase}/${created.caseId}/start-review`)
          .set(authorized(admin.token))
          .set('idempotency-key', key)
          .send(payload)
          .expect(200);
        expect((first.body as MemberKycCaseBody).status).toBe('UNDER_REVIEW');
        const second = await supertest(server)
          .post(`${memberBase}/${created.caseId}/start-review`)
          .set(authorized(admin.token))
          .set('idempotency-key', key)
          .send(payload)
          .expect(200);
        expect((second.body as MemberKycCaseBody).status).toBe('UNDER_REVIEW');
        const history = await database.db
          .select()
          .from(memberKycHistory)
          .where(eq(memberKycHistory.memberKycCaseId, created.caseId));
        expect(history).toHaveLength(1);
        const idempotencyRows = await database.db
          .select()
          .from(memberKycIdempotencyKeys)
          .where(eq(memberKycIdempotencyKeys.key, key));
        expect(idempotencyRows).toHaveLength(1);
      });
    });

    describe('merchant KYC (Phase 1 owner commands)', () => {
      it('lists only the selected market with masked queue rows', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['merchant.kyc.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const branchA = await createMerchantBranch(marketA, 'Alpha Sdn Bhd');
        await createMerchantKycSubmission(branchA, 'SUBMITTED');
        const branchB = await createMerchantBranch(marketB, 'Beta Pte Ltd');
        await createMerchantKycSubmission(branchB, 'SUBMITTED');

        const response = await supertest(server)
          .get(merchantBase)
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as MerchantQueueBody;
        expect(body.marketId).toBe(marketA);
        expect(body.items.every((item) => item.branch_id !== branchB)).toBe(
          true,
        );
        expect(
          body.items.some(
            (item) =>
              item.branch_id === branchA &&
              item.display_name === 'Alpha Sdn Bhd',
          ),
        ).toBe(true);
        // Queue rows are masked summaries: no submission payload.
        expect(JSON.stringify(body)).not.toContain('registration_number');
        expect(JSON.stringify(body)).not.toContain('pic_identity');
        // Every queue view is audited (P7-S5C audit-of-view incl. queues).
        const queueAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'merchant.kyc.ops.queue.view'),
              eq(auditLogs.marketId, marketA),
              eq(auditLogs.result, 'SUCCESS'),
            ),
          );
        expect(queueAudits.length).toBeGreaterThanOrEqual(1);
      });

      it('returns the masked merchant submission detail with owner masking', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.kyc.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const branchA = await createMerchantBranch(marketA, 'Gamma Sdn Bhd');
        await createMerchantKycSubmission(branchA, 'SUBMITTED');

        const response = await supertest(server)
          .get(`${merchantBase}/${branchA}`)
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as {
          display_name: string;
          current: {
            data: {
              business_certification: { registration_number: string };
              pic_identity: { identity_number: string };
            };
          };
          evidenceAccess: { masked: boolean };
        };
        expect(body.display_name).toBe('Gamma Sdn Bhd');
        expect(body.evidenceAccess.masked).toBe(true);
        expect(
          body.current.data.business_certification.registration_number,
        ).toBe('***2345');
        expect(body.current.data.pic_identity.identity_number).toBe('****1234');

        const auditRows = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'merchant.kyc.ops.view'),
              eq(auditLogs.marketId, marketA),
              eq(auditLogs.actorType, 'ADMIN_USER'),
            ),
          );
        expect(auditRows.length).toBeGreaterThanOrEqual(1);
      });

      it('blocks merchant evidence without permission/reason/step-up and audits the granted view', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.kyc.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const branchA = await createMerchantBranch(marketA, 'Delta Sdn Bhd');
        await createMerchantKycSubmission(branchA, 'SUBMITTED');

        await supertest(server)
          .get(`${merchantBase}/${branchA}/evidence`)
          .set(authorized(admin.token))
          .expect(403);
        // Denied merchant raw-evidence access is audited.
        const deniedAudits = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'merchant.kyc.ops.evidence.view'),
              eq(auditLogs.entityType, 'merchant_branch'),
              eq(auditLogs.entityId, branchA),
              eq(auditLogs.result, 'DENIED'),
            ),
          );
        expect(deniedAudits.length).toBeGreaterThanOrEqual(1);
        expect(deniedAudits[0]?.reason).toContain('PERMISSION_DENIED');

        const reviewer = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.kyc.evidence.view'],
          enrollMfa: true,
        });
        await setCurrentMarket(reviewer.accountId, marketA);
        await supertest(server)
          .get(`${merchantBase}/${branchA}/evidence`)
          .set(authorized(reviewer.token))
          .expect(422); // reason required
        await supertest(server)
          .get(`${merchantBase}/${branchA}/evidence`)
          .set(authorized(reviewer.token))
          .set('x-sensitive-access-reason', 'Business verification review')
          .expect(403); // step-up required

        const grant = await seedStepUpGrant(
          reviewer,
          'merchant.kyc.evidence.view',
          marketA,
        );
        const response = await supertest(server)
          .get(`${merchantBase}/${branchA}/evidence`)
          .set(authorized(reviewer.token))
          .set('x-step-up-token', grant)
          .set('x-sensitive-access-reason', 'Business verification review')
          .expect(200);
        const body = response.body as {
          evidenceAccess: { masked: boolean };
          current: {
            data: {
              business_certification: { registration_number: string };
            };
          };
        };
        expect(body.evidenceAccess.masked).toBe(false);
        expect(
          body.current.data.business_certification.registration_number,
        ).toBe('202001012345');

        const auditRows = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'merchant.kyc.ops.evidence.view'),
              eq(auditLogs.marketId, marketA),
              eq(auditLogs.actorType, 'ADMIN_USER'),
            ),
          );
        expect(auditRows.length).toBeGreaterThanOrEqual(1);
      });

      it('decides a merchant KYC submission through the owner command with idempotency', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.kyc.view', 'merchant.kyc.approve'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const branchA = await createMerchantBranch(marketA, 'Epsilon Sdn Bhd');
        await createMerchantKycSubmission(branchA, 'SUBMITTED');

        const key = randomUUID();
        const payload = {
          decision: 'APPROVED',
          reason: 'Business and identity documents verified',
          rejected_fields: [],
        };
        const first = await supertest(server)
          .post(`${merchantBase}/${branchA}/review`)
          .set(authorized(admin.token))
          .set('idempotency-key', key)
          .send(payload)
          .expect(200);
        expect((first.body as { kyc_status: string }).kyc_status).toBe(
          'APPROVED',
        );
        expect(
          (first.body as { operational_status: string }).operational_status,
        ).toBeTruthy();

        const second = await supertest(server)
          .post(`${merchantBase}/${branchA}/review`)
          .set(authorized(admin.token))
          .set('idempotency-key', key)
          .send(payload)
          .expect(200);
        expect((second.body as { kyc_status: string }).kyc_status).toBe(
          'APPROVED',
        );
        const reviewRows = await database.db
          .select()
          .from(merchantKycReviews)
          .where(
            eq(
              merchantKycReviews.merchantKycSubmissionId,
              (
                await database.db
                  .select({ id: merchantKycSubmissions.id })
                  .from(merchantKycSubmissions)
                  .where(eq(merchantKycSubmissions.merchantBranchId, branchA))
                  .limit(1)
              )[0]?.id ?? '',
            ),
          );
        expect(reviewRows).toHaveLength(1);
      });

      it('blocks an out-of-market merchant detail with MARKET_CONTEXT_MISMATCH', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['merchant.kyc.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const branchB = await createMerchantBranch(marketB, 'Zeta Pte Ltd');
        await createMerchantKycSubmission(branchB, 'SUBMITTED');
        const response = await supertest(server)
          .get(`${merchantBase}/${branchB}`)
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });
    });
  },
);
