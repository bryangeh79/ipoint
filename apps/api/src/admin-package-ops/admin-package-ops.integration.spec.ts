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
  merchantBranches,
  merchantGroups,
  merchantPackageAssignments,
  merchantApiIdempotencyKeys,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
  serviceFeeProfiles,
  serviceFeeVersions,
  specialPercentages,
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
const password = 'Package-Ops-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
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
  'Admin Package Operations HTTP integration (P7-S6A)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR
    let marketB: string; // code MB, SGD
    let mfaSecret: Buffer;

    /** Seeded global standard package ids (A–F, market-agnostic). */
    let profileA: string;
    /** A market-scoped ACTIVE version of package A in marketA. */
    let marketVersionA: string;

    const catalogUrl = (marketId: string) =>
      `/api/v1/admin/package-ops/markets/${marketId}/packages`;
    const specialsUrl = (marketId: string) =>
      `/api/v1/admin/package-ops/markets/${marketId}/special-percentages`;

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
          name: `${code} Package Ops Test Market`,
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

    async function createMerchantBranch(
      marketId: string,
      name = 'Acme Package Co',
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
          status: 'ACTIVE',
        })
        .returning({ id: merchantBranches.id });
      return branch[0]?.id ?? '';
    }

    async function createMarketVersion(
      packageId: string,
      marketId: string,
      rate: string,
      effectiveFrom: Date,
      effectiveTo?: Date,
      status: 'DRAFT' | 'ACTIVE' = 'ACTIVE',
    ): Promise<string> {
      const inserted = await database.db
        .insert(serviceFeeVersions)
        .values({
          serviceFeeProfileId: packageId,
          marketId,
          rate,
          effectiveFrom,
          ...(effectiveTo ? { effectiveTo } : {}),
          status,
        })
        .returning({ id: serviceFeeVersions.id });
      return inserted[0]?.id ?? '';
    }

    /** Seed an ACTIVE default assignment for a branch (owner-style rows). */
    async function seedAssignment(
      branchId: string,
      versionId: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(merchantPackageAssignments)
        .values({
          merchantBranchId: branchId,
          serviceFeeVersionId: versionId,
          status: 'ACTIVE',
          isDefault: true,
        })
        .returning({ id: merchantPackageAssignments.id });
      return inserted[0]?.id ?? '';
    }

    async function createSpecialPercentage(
      marketId: string,
      rate: string,
      description: string,
      adminUserId: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(specialPercentages)
        .values({
          marketId,
          rate,
          description,
          createdByAdminUserId: adminUserId,
        })
        .returning({ id: specialPercentages.id });
      return inserted[0]?.id ?? '';
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
            description: `${code} package ops integration test permission`,
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
      enrollMfa?: boolean;
    }): Promise<{ adminUserId: string; accountId: string; token: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `Package Ops Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';

      const permissionCodes = options.permissionCodes ?? [
        'merchant.package.view',
      ];
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
          name: `Package Ops HTTP Test Role (${roleCode})`,
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

    async function assignmentCount(branchId: string): Promise<number> {
      const rows = await database.db
        .select({ id: merchantPackageAssignments.id })
        .from(merchantPackageAssignments)
        .where(eq(merchantPackageAssignments.merchantBranchId, branchId));
      return rows.length;
    }

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'admin-package-ops-pepper-at-least-32-characters',
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

      const seededA = await database.db
        .select({ id: serviceFeeProfiles.id })
        .from(serviceFeeProfiles)
        .where(eq(serviceFeeProfiles.code, 'A'))
        .limit(1);
      profileA = seededA[0]?.id ?? '';
      expect(profileA).toBeTruthy();

      // A market-scoped ACTIVE version of package A (assignable surface).
      // Finite historical window: every fixture window in this suite is
      // strictly disjoint so the no-overlap exclusion constraint never
      // trips across tests.
      marketVersionA = await createMarketVersion(
        profileA,
        marketA,
        '2.500000',
        new Date('2025-01-01T00:00:00.000Z'),
        new Date('2025-06-01T00:00:00.000Z'),
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

    describe('authentication, RBAC, and selected-market enforcement', () => {
      it('returns 401 without authentication and 403 for a non-admin actor', async () => {
        await supertest(server).get(catalogUrl(marketA)).expect(401);

        const member = await createAccount();
        const memberToken = (await auth.login(member.email, password))
          .accessToken;
        const denied = await supertest(server)
          .get(catalogUrl(marketA))
          .set(authorized(memberToken))
          .expect(403);
        expect((denied.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
      });

      it('denies an admin without merchant.package.view', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(catalogUrl(marketA))
          .set(authorized(admin.token))
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
      });

      it('requires a server-selected Current Admin Market (MARKET_SELECTION_REQUIRED)', async () => {
        const admin = await createAdmin({ marketIds: [marketA] });
        const response = await supertest(server)
          .get(catalogUrl(marketA))
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_SELECTION_REQUIRED',
        );
      });

      it('rejects a client-supplied market header that differs from the Current Admin Market', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['merchant.package.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(catalogUrl(marketA))
          .set(authorized(admin.token))
          .set('x-market-id', marketB)
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });

      it('rejects an admin with no grant for the selected market', async () => {
        const admin = await createAdmin({
          marketIds: [marketB],
          permissionCodes: ['merchant.package.view'],
        });
        await setCurrentMarket(admin.accountId, marketB);
        const response = await supertest(server)
          .get(catalogUrl(marketA))
          .set(authorized(admin.token))
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });
    });

    describe('standard package catalog read (merchant.package.view)', () => {
      it('returns the seeded A–F standard packages with exact decimal rates', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const response = await supertest(server)
          .get(catalogUrl(marketA))
          .set(authorized(admin.token))
          .expect(200);

        const body = response.body as {
          marketId: string;
          items: Array<{
            code: string;
            name: string;
            versions: Array<{ rate: string; status: string }>;
          }>;
        };
        expect(body.marketId).toBe(marketA);
        const codes = body.items.map((item) => item.code);
        expect(codes).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
        const a = body.items.find((item) => item.code === 'A');
        expect(a?.name).toBe('Standard Package A');
        // Seeded baseline ACTIVE version at 2.5% + the market-scoped one.
        expect(a?.versions.length).toBeGreaterThanOrEqual(2);
        const rates = a?.versions.map((v) => v.rate) ?? [];
        expect(rates).toContain('2.500000');
        for (const version of a?.versions ?? []) {
          // Exact decimal strings only — never floats.
          expect(typeof version.rate).toBe('string');
          expect(version.rate).toMatch(/^\d+\.\d{6}$/u);
        }
      });

      it('shows the market-scoped version and hides other-market versions', async () => {
        // A market-B version of package A.
        await createMarketVersion(
          profileA,
          marketB,
          '7.500000',
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2026-06-01T00:00:00.000Z'),
        );
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['merchant.package.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const response = await supertest(server)
          .get(catalogUrl(marketA))
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as {
          items: Array<{
            code: string;
            versions: Array<{ rate: string; effective_from: string }>;
          }>;
        };
        const a = body.items.find((item) => item.code === 'A');
        const marketRates = a?.versions.map((v) => v.rate) ?? [];
        // Market-B-only version never leaks into the market-A catalog.
        expect(marketRates).not.toContain('7.500000');
      });

      it('lists the market-agnostic seeded A–F packages in any market', async () => {
        const admin = await createAdmin({
          marketIds: [marketB],
          permissionCodes: ['merchant.package.view'],
        });
        await setCurrentMarket(admin.accountId, marketB);

        const response = await supertest(server)
          .get(catalogUrl(marketB))
          .set(authorized(admin.token))
          .expect(200);
        const body = response.body as { items: Array<{ code: string }> };
        // The seeded A–F profiles are market-agnostic (market_id IS NULL) and
        // therefore appear in every market catalog.
        expect(body.items.map((item) => item.code)).toEqual([
          'A',
          'B',
          'C',
          'D',
          'E',
          'F',
        ]);
      });
    });

    describe('special percentages privileged read (merchant.special_package.manage)', () => {
      it('returns 403 for an admin without the special-package permission', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.view', 'merchant.package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );
        const response = await supertest(server)
          .get(specialsUrl(marketA))
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'PERMISSION_DENIED',
        );
      });

      it('requires a fresh step-up grant (MFA_STEP_UP_REQUIRED)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const response = await supertest(server)
          .get(specialsUrl(marketA))
          .set(authorized(admin.token))
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe(
          'MFA_STEP_UP_REQUIRED',
        );
      });

      it('lists special percentages for the Super Admin permission and audits the view', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );
        const specialId = await createSpecialPercentage(
          marketA,
          '12.500000',
          'Special launch partner',
          admin.adminUserId,
        );

        const response = await supertest(server)
          .get(specialsUrl(marketA))
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .expect(200);

        const body = response.body as {
          marketId: string;
          items: Array<{
            id: string;
            rate: string;
            description: string | null;
            created_by_admin_user_id: string;
          }>;
        };
        expect(body.marketId).toBe(marketA);
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: specialId,
          rate: '12.500000',
          description: 'Special launch partner',
          created_by_admin_user_id: admin.adminUserId,
        });

        // Audit-of-view written by the adapter.
        const auditRows = await database.db
          .select({ action: auditLogs.action, reason: auditLogs.reason })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'ADMIN_SPECIAL_PERCENTAGE_LIST_VIEWED'),
              eq(auditLogs.marketId, marketA),
            ),
          );
        expect(auditRows.length).toBe(1);
        expect(auditRows[0]?.reason).toBeNull();
      });

      it('isolates special percentages by selected market', async () => {
        const admin = await createAdmin({
          marketIds: [marketA, marketB],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await createSpecialPercentage(
          marketB,
          '33.000000',
          'Market B only',
          admin.adminUserId,
        );
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );

        const response = await supertest(server)
          .get(specialsUrl(marketA))
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .expect(200);
        const body = response.body as { items: Array<{ rate: string }> };
        expect(body.items.map((item) => item.rate)).not.toContain('33.000000');
      });
    });

    describe('standard version owner commands (merchant.package.manage)', () => {
      async function opsAdmin(marketIds: string[]) {
        const admin = await createAdmin({
          marketIds,
          permissionCodes: ['merchant.package.view', 'merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketIds[0] ?? '');
        return admin;
      }

      it('creates a version with exact decimal normalization and audit', async () => {
        const admin = await opsAdmin([marketA]);
        const key = `version-create-${randomUUID()}`;

        const response = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .send({
            rate: '2.5',
            effective_from: '2027-01-01T00:00:00.000Z',
            effective_to: '2027-06-01T00:00:00.000Z',
          })
          .expect(201);

        const body = response.body as {
          id: string;
          rate: string;
          status: string;
          marketId: string;
        };
        // Owner row response uses camelCase drizzle keys.
        expect(body.marketId).toBe(marketA);
        // Owner normalizes to numeric(12,6) — exact decimal string, no float.
        expect(body.rate).toBe('2.500000');
        expect(body.status).toBe('DRAFT');

        const auditRows = await database.db
          .select({
            action: auditLogs.action,
            entityType: auditLogs.entityType,
          })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'SERVICE_FEE_VERSION_CREATED'),
              eq(auditLogs.actorId, admin.adminUserId),
            ),
          );
        expect(auditRows.length).toBe(1);
        expect(auditRows[0]?.entityType).toBe('SERVICE_FEE_VERSION');
      });

      it('rejects rates outside the locked D-010 range (0, 100]', async () => {
        const admin = await opsAdmin([marketA]);
        for (const rate of ['0', '100.000001', '-1', '1e2']) {
          const response = await supertest(server)
            .post(
              `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
            )
            .set(authorized(admin.token))
            .set('Idempotency-Key', `range-${randomUUID()}`)
            .send({
              rate,
              effective_from: '2027-01-01T00:00:00.000Z',
              effective_to: '2027-06-01T00:00:00.000Z',
            })
            .expect(400);
          expect((response.body as ErrorBody).error.code).toBeDefined();
        }
        // The 100% boundary is allowed (D-010: >0% AND <=100%).
        const accepted = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `range-max-${randomUUID()}`)
          .send({
            rate: '100.000000',
            effective_from: '2027-07-01T00:00:00.000Z',
            effective_to: '2027-12-31T00:00:00.000Z',
          })
          .expect(201);
        expect((accepted.body as { rate: string }).rate).toBe('100.000000');
      });

      it('activates a draft version with audit', async () => {
        const admin = await opsAdmin([marketA]);
        const created = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `activate-create-${randomUUID()}`)
          .send({
            rate: '4.000000',
            effective_from: '2026-01-01T00:00:00.000Z',
            effective_to: '2027-01-01T00:00:00.000Z',
          })
          .expect(201);
        const versionId = (created.body as { id: string }).id;

        const activated = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${versionId}/activate`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `activate-${randomUUID()}`)
          .expect(200);
        // The window covers the current time, so activation yields ACTIVE
        // (forward-only scheduling would yield SCHEDULED for future windows).
        expect((activated.body as { status: string }).status).toBe('ACTIVE');

        const auditRows = await database.db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'SERVICE_FEE_VERSION_ACTIVATED'),
              eq(auditLogs.entityId, versionId),
            ),
          );
        expect(auditRows.length).toBe(1);
      });

      it('rejects overlapping effective windows (23P01 → PACKAGE_EFFECTIVE_WINDOW_OVERLAP)', async () => {
        const admin = await opsAdmin([marketA]);
        await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `overlap-1-${randomUUID()}`)
          .send({
            rate: '8.000000',
            effective_from: '2030-01-01T00:00:00.000Z',
            effective_to: '2031-01-01T00:00:00.000Z',
          })
          .expect(201);
        const overlap = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `overlap-2-${randomUUID()}`)
          .send({
            rate: '9.000000',
            effective_from: '2030-06-01T00:00:00.000Z',
            effective_to: '2031-06-01T00:00:00.000Z',
          })
          .expect(409);
        expect((overlap.body as ErrorBody).error.code).toBe(
          'PACKAGE_EFFECTIVE_WINDOW_OVERLAP',
        );
      });

      it('enforces idempotency: same key+payload replays; same key+different payload conflicts', async () => {
        const admin = await opsAdmin([marketA]);
        const key = `idem-${randomUUID()}`;
        const payload = {
          rate: '3.500000',
          effective_from: '2029-01-01T00:00:00.000Z',
          effective_to: '2029-06-01T00:00:00.000Z',
        };
        const first = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .send(payload)
          .expect(201);
        const replay = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .send(payload)
          // The owner route returns its route-level 201 status on replay too;
          // the body is the original stored result (same version id).
          .expect(201);
        expect((replay.body as { id: string }).id).toBe(
          (first.body as { id: string }).id,
        );
        const conflict = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .send({ ...payload, rate: '3.750000' })
          .expect(409);
        expect((conflict.body as ErrorBody).error.code).toBe(
          'IDEMPOTENCY_KEY_CONFLICT',
        );
      });
    });

    describe('assignment pinning (frozen contract §7.3: new versions never move assignments)', () => {
      it('keeps existing merchant assignments byte-identical when a new version is created and activated', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.view', 'merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const branch = await createMerchantBranch(marketA);
        const existingAssignment = await seedAssignment(branch, marketVersionA);
        const before = await database.db
          .select()
          .from(merchantPackageAssignments)
          .where(eq(merchantPackageAssignments.merchantBranchId, branch));

        // Create + activate a new version of package A in the same market.
        const created = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `pin-create-${randomUUID()}`)
          .send({
            rate: '6.000000',
            effective_from: '2032-01-01T00:00:00.000Z',
            effective_to: '2032-06-01T00:00:00.000Z',
          })
          .expect(201);
        await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${(created.body as { id: string }).id}/activate`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `pin-activate-${randomUUID()}`)
          .expect(200);
        // Future-effective activation schedules the version (forward-only
        // configuration); the pin assertion is about assignments, not the
        // resulting lifecycle status.
        const activatedBody = (
          await database.db
            .select({ status: serviceFeeVersions.status })
            .from(serviceFeeVersions)
            .where(
              eq(serviceFeeVersions.id, (created.body as { id: string }).id),
            )
        )[0];
        expect(['SCHEDULED', 'ACTIVE']).toContain(activatedBody?.status);

        const after = await database.db
          .select()
          .from(merchantPackageAssignments)
          .where(eq(merchantPackageAssignments.merchantBranchId, branch));

        // The existing assignment is PINNED: same rows, same ids, same
        // version reference, same default flag — never moved.
        expect(after).toEqual(before);
        expect(after).toHaveLength(1);
        expect(after[0]?.id).toBe(existingAssignment);
        expect(after[0]?.serviceFeeVersionId).toBe(marketVersionA);
        expect(after[0]?.isDefault).toBe(true);
      });

      it('never recalculates history: old version rates stay unchanged after a new version lands', async () => {
        const before = await database.db
          .select({ rate: serviceFeeVersions.rate })
          .from(serviceFeeVersions)
          .where(eq(serviceFeeVersions.id, marketVersionA));
        expect(before[0]?.rate).toBe('2.500000');

        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `history-${randomUUID()}`)
          .send({
            rate: '25.000000',
            effective_from: '2033-01-01T00:00:00.000Z',
            effective_to: '2033-06-01T00:00:00.000Z',
          })
          .expect(201);

        const after = await database.db
          .select({ rate: serviceFeeVersions.rate })
          .from(serviceFeeVersions)
          .where(eq(serviceFeeVersions.id, marketVersionA));
        expect(after[0]?.rate).toBe('2.500000');
      });
    });

    describe('explicit audited reassignment (frozen contract §7.3: no automatic batch migration)', () => {
      it('reassigns per-merchant explicitly with audit and preserves the old assignment', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [
            'merchant.package.view',
            'merchant.package.manage',
            'merchant.package.assign',
          ],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const branch = await createMerchantBranch(marketA);
        const oldAssignment = await seedAssignment(branch, marketVersionA);

        // New market-scoped version of package A to reassign to.
        // New market-scoped ACTIVE version of package B (window covers the
        // current time so the owner assignability gate passes). Different
        // profile → no overlap with the package-A fixture versions.
        const profileB = (
          await database.db
            .select({ id: serviceFeeProfiles.id })
            .from(serviceFeeProfiles)
            .where(eq(serviceFeeProfiles.code, 'B'))
            .limit(1)
        )[0];
        const newVersionId = await createMarketVersion(
          profileB?.id ?? '',
          marketA,
          '10.000000',
          new Date('2026-02-01T00:00:00.000Z'),
          new Date('2027-02-01T00:00:00.000Z'),
        );

        // EXPLICIT per-merchant action: assign the new version.
        const assigned = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `reassign-${randomUUID()}`)
          .send({ service_fee_version_id: newVersionId, is_default: true })
          .expect(201);
        const newAssignmentId = (assigned.body as { id: string }).id;
        // Owner assignment row uses camelCase drizzle keys.
        expect((assigned.body as { isDefault: boolean }).isDefault).toBe(true);

        // Explicit default switch is a second audited action.
        await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments/${newAssignmentId}/set-default`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `set-default-${randomUUID()}`)
          .expect(200);

        // Old assignment preserved (pinned history), new one is the default.
        const rows = await database.db
          .select({
            id: merchantPackageAssignments.id,
            serviceFeeVersionId: merchantPackageAssignments.serviceFeeVersionId,
            isDefault: merchantPackageAssignments.isDefault,
            status: merchantPackageAssignments.status,
          })
          .from(merchantPackageAssignments)
          .where(eq(merchantPackageAssignments.merchantBranchId, branch));
        expect(rows).toHaveLength(2);
        const old = rows.find((row) => row.id === oldAssignment);
        const fresh = rows.find((row) => row.id === newAssignmentId);
        expect(old?.serviceFeeVersionId).toBe(marketVersionA);
        expect(old?.isDefault).toBe(false);
        expect(old?.status).toBe('ACTIVE');
        expect(fresh?.serviceFeeVersionId).toBe(newVersionId);
        expect(fresh?.isDefault).toBe(true);

        // Audited: assignment + default-switch audit rows with the actor.
        const actions = await database.db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.actorId, admin.adminUserId),
              eq(auditLogs.marketId, marketA),
            ),
          );
        const recorded = actions.map((row) => row.action);
        expect(recorded).toContain('MERCHANT_PACKAGE_ASSIGNED');
        expect(recorded).toContain('MERCHANT_PACKAGE_DEFAULT_SET');
      });

      it('does not auto-migrate other merchants when one merchant is reassigned', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.assign'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const branchA = await createMerchantBranch(marketA);
        const branchB = await createMerchantBranch(marketA, 'Second Merchant');
        await seedAssignment(branchA, marketVersionA);
        await seedAssignment(branchB, marketVersionA);
        // Market-scoped ACTIVE version of package C covering the current
        // time (assignable), no overlap with other fixture profiles.
        const profileC = (
          await database.db
            .select({ id: serviceFeeProfiles.id })
            .from(serviceFeeProfiles)
            .where(eq(serviceFeeProfiles.code, 'C'))
            .limit(1)
        )[0];
        const newVersionId = await createMarketVersion(
          profileC?.id ?? '',
          marketA,
          '15.000000',
          new Date('2026-02-01T00:00:00.000Z'),
          new Date('2027-02-01T00:00:00.000Z'),
        );

        await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/merchants/${branchA}/packages/assignments`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `no-auto-${randomUUID()}`)
          .send({ service_fee_version_id: newVersionId, is_default: true })
          .expect(201);

        // Branch B is untouched: still exactly one pinned assignment.
        expect(await assignmentCount(branchB)).toBe(1);
        const bRows = await database.db
          .select({
            serviceFeeVersionId: merchantPackageAssignments.serviceFeeVersionId,
          })
          .from(merchantPackageAssignments)
          .where(eq(merchantPackageAssignments.merchantBranchId, branchB));
        expect(bRows[0]?.serviceFeeVersionId).toBe(marketVersionA);
      });
    });

    describe('special percentage create — D-051 rewire (frozen contract §7.3 reason)', () => {
      it('canonical owner route: with a reason the owner creates and persists it durably (201)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );

        // D-051 §2/§3/§5: the owner command now REQUIRES the reason and
        // stores it on the row AND in the atomic immutable audit.
        const reason = 'Approved ops review — special launch partner';
        const created = await supertest(server)
          .post(`/api/v1/admin/markets/${marketA}/special-percentages`)
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .set('Idempotency-Key', `special-${randomUUID()}`)
          .send({
            rate: '18.500000',
            description: 'Partner promotion',
            reason,
          })
          .expect(201);

        const specialId = (created.body as { id: string }).id;
        // The stored row carries the durable reason.
        const row = await database.db
          .select({ reason: specialPercentages.reason })
          .from(specialPercentages)
          .where(eq(specialPercentages.id, specialId));
        expect(row[0]?.reason).toBe(reason);
        // The immutable audit record carries the reason (no longer null).
        const auditRows = await database.db
          .select({ reason: auditLogs.reason, action: auditLogs.action })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'SPECIAL_PERCENTAGE_CREATED'),
              eq(auditLogs.entityId, specialId),
            ),
          );
        expect(auditRows.length).toBe(1);
        expect(auditRows[0]?.reason).toBe(reason);
      });

      it('Phase 7 surface: POST .../special-percentages is exposed through the secured owner (201)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );

        const body = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .set('Idempotency-Key', `rewired-${randomUUID()}`)
          .send({
            rate: '18.500000',
            description: 'Partner promotion',
            reason: 'Approved ops review — special launch partner',
          })
          .expect(201);
        const result = body.body as {
          id: string;
          rate: string;
          description: string;
          reason: string;
          marketId: string;
          market: string;
          created_by: string;
          created_at: string;
        };
        expect(result.id).toBeTruthy();
        expect(result.rate).toBe('18.500000');
        expect(result.description).toBe('Partner promotion');
        expect(result.reason).toBe(
          'Approved ops review — special launch partner',
        );
        expect(result.marketId).toBe(marketA);
        expect(result.market).toBe('MA');
        expect(result.created_by).toBe(admin.adminUserId);
        expect(Number.isNaN(Date.parse(result.created_at))).toBe(false);
      });
    });

    describe('special-percentage create surface (D-051 rewire) — owner delegation, idempotency, pinning', () => {
      const createPayload = (overrides: Record<string, unknown> = {}) => ({
        rate: '21.750000',
        description: 'Rewire integration partner',
        reason: 'Approved ops review — rewire evidence',
        ...overrides,
      });

      it('creates through the secured owner: 201, exact rate, reason persisted in the atomic audit', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );

        const body = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .set('Idempotency-Key', `rewire-create-${randomUUID()}`)
          .send(createPayload())
          .expect(201);
        const result = body.body as {
          id: string;
          rate: string;
          reason: string;
          created_by: string;
        };
        expect(result.id).toBeTruthy();
        expect(result.rate).toBe('21.750000');
        expect(result.reason).toBe('Approved ops review — rewire evidence');
        expect(result.created_by).toBe(admin.adminUserId);

        // The stored owner row carries the durable reason (D-051 §3).
        const rows = await database.db
          .select({
            rate: specialPercentages.rate,
            reason: specialPercentages.reason,
            createdByAdminUserId: specialPercentages.createdByAdminUserId,
          })
          .from(specialPercentages)
          .where(eq(specialPercentages.id, result.id));
        expect(rows[0]?.rate).toBe('21.750000');
        expect(rows[0]?.reason).toBe('Approved ops review — rewire evidence');
        expect(rows[0]?.createdByAdminUserId).toBe(admin.adminUserId);

        // The immutable audit row is the owner's atomic audit, carrying
        // actor, market, reason and the entity reference (D-051 §5).
        const auditRows = await database.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'SPECIAL_PERCENTAGE_CREATED'),
              eq(auditLogs.entityId, result.id),
            ),
          );
        expect(auditRows.length).toBe(1);
        expect(auditRows[0]?.actorId).toBe(admin.adminUserId);
        expect(auditRows[0]?.marketId).toBe(marketA);
        expect(auditRows[0]?.reason).toBe(
          'Approved ops review — rewire evidence',
        );
        expect(auditRows[0]?.result).toBe('SUCCESS');
        expect(String(auditRows[0]?.requestId ?? '')).not.toBe('');
      });

      it('writes ONE owner-scoped mechanism row + owner audit (no adapter-side writes)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );
        const key = `rewire-mech-${randomUUID()}`;
        const body = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .set('Idempotency-Key', key)
          .send(createPayload({ rate: '22.250000' }))
          .expect(201);
        const specialId = (body.body as { id: string }).id;

        // The mechanism row is the OWNER's claim (scope
        // package.special.owner.create:<marketId>:<adminUserId>), written
        // by the owner inside its transaction — exactly ONE row.
        const idemRows = await database.db
          .select()
          .from(merchantApiIdempotencyKeys)
          .where(eq(merchantApiIdempotencyKeys.key, key));
        expect(idemRows.length).toBe(1);
        expect(idemRows[0]?.scope).toBe(
          `package.special.owner.create:${marketA}:${admin.adminUserId}`,
        );
        expect(idemRows[0]?.statusCode).toBe(201);
        expect((idemRows[0]?.response as { id?: string })?.id).toBe(specialId);
        expect(idemRows[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/u);

        // Exactly ONE special_percentages row and exactly ONE owner audit
        // for this key — the adapter performs no direct write of its own.
        const specialRows = await database.db
          .select({ id: specialPercentages.id })
          .from(specialPercentages)
          .where(eq(specialPercentages.id, specialId));
        expect(specialRows.length).toBe(1);
      });

      it('replays idempotent creates and rejects key reuse with a different payload', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        // Step-up grants are single-use (consumed by the guard), so every
        // request carries a freshly seeded grant.
        const grant = () =>
          seedStepUpGrant(admin, 'merchant.special_package.manage', marketA);
        const key = `rewire-idem-${randomUUID()}`;
        const payload = createPayload({ rate: '23.500000' });

        const first = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', key)
          .send(payload)
          .expect(201);

        // Same key + same payload → the owner replays the original result
        // (same id, no second row).
        const replay = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', key)
          .send(payload)
          .expect(201);
        expect((replay.body as { id: string }).id).toBe(
          (first.body as { id: string }).id,
        );

        // Same key + different payload → owner payload-hash conflict (409).
        const conflict = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', key)
          .send(createPayload({ rate: '24.000000' }))
          .expect(409);
        expect((conflict.body as ErrorBody).error.code).toBe(
          'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT',
        );

        // The conflicting request created no extra row.
        const rows = await database.db
          .select({ id: specialPercentages.id })
          .from(specialPercentages)
          .where(eq(specialPercentages.marketId, marketA));
        expect(
          rows.filter((row) => row.id === (first.body as { id: string }).id)
            .length,
        ).toBe(1);
      });

      it('denies creates without merchant.special_package.manage (403)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.view'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const denied = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('Idempotency-Key', `rewire-deny-${randomUUID()}`)
          .send(createPayload())
          .expect(403);
        expect((denied.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
      });

      it('enforces the selected-market contract: URL market differs from the Current Admin Market (409)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );

        const response = await supertest(server)
          .post(`${specialsUrl(marketB)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .set('Idempotency-Key', `rewire-market-${randomUUID()}`)
          .send(createPayload())
          .expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'MARKET_CONTEXT_MISMATCH',
        );
      });

      it('requires a reason and an Idempotency-Key on the write (400)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const grant = () =>
          seedStepUpGrant(admin, 'merchant.special_package.manage', marketA);

        // Missing reason field (no reason key at all).
        const missingReason: Record<string, unknown> = {
          rate: '21.750000',
          description: 'Rewire integration partner',
        };
        const missing = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', `rewire-reason-${randomUUID()}`)
          .send(missingReason)
          .expect(400);
        expect((missing.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');

        // Blank and whitespace-only reasons: DTO trim → min(1) fails.
        for (const reason of ['', '   ']) {
          const response = await supertest(server)
            .post(`${specialsUrl(marketA)}`)
            .set(authorized(admin.token))
            .set('x-step-up-token', await grant())
            .set('Idempotency-Key', `rewire-reason-${randomUUID()}`)
            .send({ ...createPayload(), reason })
            .expect(400);
          expect((response.body as ErrorBody).error.code).toBe(
            'VALIDATION_ERROR',
          );
        }

        const missingKey = await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .send(createPayload())
          .expect(400);
        expect((missingKey.body as ErrorBody).error.code).toBe(
          'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED',
        );
      });

      it('rejects rate precision and range violations at the transport boundary (400)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const grant = () =>
          seedStepUpGrant(admin, 'merchant.special_package.manage', marketA);

        for (const rate of ['12.3456789', '0', '0.000000', '100.000001']) {
          const response = await supertest(server)
            .post(`${specialsUrl(marketA)}`)
            .set(authorized(admin.token))
            .set('x-step-up-token', await grant())
            .set('Idempotency-Key', `rewire-rate-${randomUUID()}`)
            .send(createPayload({ rate }))
            .expect(400);
          expect((response.body as ErrorBody).error.code).toBe(
            'VALIDATION_ERROR',
          );
        }
      });

      it('keeps merchant assignments and historical rows byte-identical (pinning)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const stepUp = await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        );

        // A pre-existing assignment + a historical special percentage.
        const branch = await createMerchantBranch(marketA);
        await seedAssignment(branch, marketVersionA);
        const historicalId = await createSpecialPercentage(
          marketA,
          '9.500000',
          'Historical partner',
          admin.adminUserId,
        );
        const assignmentsBefore = await assignmentCount(branch);
        const historical = await database.db
          .select()
          .from(specialPercentages)
          .where(eq(specialPercentages.id, historicalId));

        await supertest(server)
          .post(`${specialsUrl(marketA)}`)
          .set(authorized(admin.token))
          .set('x-step-up-token', stepUp)
          .set('Idempotency-Key', `rewire-pin-${randomUUID()}`)
          .send(createPayload({ rate: '25.000000' }))
          .expect(201);

        // merchant_package_assignments: zero change.
        expect(await assignmentCount(branch)).toBe(assignmentsBefore);
        // Historical special-percentage row: byte-identical.
        const after = await database.db
          .select()
          .from(specialPercentages)
          .where(eq(specialPercentages.id, historicalId));
        expect(after).toEqual(historical);
      });
    });

    describe('supplementary (Command Center 2026-08-04): exact decimal boundaries — D-010 range and maximum six decimals', () => {
      it('accepts six decimals and rejects seven for standard package versions', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const created = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `six-dec-${randomUUID()}`)
          .send({
            rate: '2.123456',
            effective_from: '2036-01-01T00:00:00.000Z',
            effective_to: '2036-06-01T00:00:00.000Z',
          })
          .expect(201);
        expect((created.body as { rate: string }).rate).toBe('2.123456');
        // Stored numeric(12,6) is exactly six decimals.
        const stored = await database.db
          .select({ rate: serviceFeeVersions.rate })
          .from(serviceFeeVersions)
          .where(
            eq(serviceFeeVersions.id, (created.body as { id: string }).id),
          );
        expect(stored[0]?.rate).toBe('2.123456');

        for (const bad of ['2.1234567', '0.0000000']) {
          const rejected = await supertest(server)
            .post(
              `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
            )
            .set(authorized(admin.token))
            .set('Idempotency-Key', `seven-dec-${randomUUID()}`)
            .send({
              rate: bad,
              effective_from: '2036-07-01T00:00:00.000Z',
              effective_to: '2036-12-31T00:00:00.000Z',
            })
            .expect(400);
          expect((rejected.body as ErrorBody).error.code).toBeDefined();
        }
      });

      it('accepts six decimals and enforces (0, 100] for special percentages', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.special_package.manage'],
          enrollMfa: true,
        });
        await setCurrentMarket(admin.accountId, marketA);
        const grant = () =>
          seedStepUpGrant(admin, 'merchant.special_package.manage', marketA);
        const reason = 'Exact decimal boundary evidence';

        const ok = await supertest(server)
          .post(`/api/v1/admin/markets/${marketA}/special-percentages`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', `sp-six-${randomUUID()}`)
          .send({ rate: '12.345678', description: 'Six decimals', reason })
          .expect(201);
        expect((ok.body as { rate: string }).rate).toBe('12.345678');

        const seven = await supertest(server)
          .post(`/api/v1/admin/markets/${marketA}/special-percentages`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', `sp-seven-${randomUUID()}`)
          .send({ rate: '12.3456789', description: 'Seven decimals', reason })
          .expect(400);
        expect((seven.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');

        const zero = await supertest(server)
          .post(`/api/v1/admin/markets/${marketA}/special-percentages`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', `sp-zero-${randomUUID()}`)
          .send({ rate: '0', description: 'Zero', reason })
          .expect(400);
        expect((zero.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');

        const max = await supertest(server)
          .post(`/api/v1/admin/markets/${marketA}/special-percentages`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', `sp-max-${randomUUID()}`)
          .send({ rate: '100.000000', description: 'Max', reason })
          .expect(201);
        expect((max.body as { rate: string }).rate).toBe('100.000000');

        const over = await supertest(server)
          .post(`/api/v1/admin/markets/${marketA}/special-percentages`)
          .set(authorized(admin.token))
          .set('x-step-up-token', await grant())
          .set('Idempotency-Key', `sp-over-${randomUUID()}`)
          .send({ rate: '100.000001', description: 'Over', reason })
          .expect(400);
        expect((over.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('supplementary (Command Center 2026-08-04): package versions are append-only', () => {
      it('refuses to edit or delete a published version; drafts cancel; in-use versions cannot cancel', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        // Published (ACTIVE) version — direct fixture.
        const published = await createMarketVersion(
          profileA,
          marketA,
          '1.234560',
          new Date('2037-01-01T00:00:00.000Z'),
          new Date('2037-06-01T00:00:00.000Z'),
        );

        // Editing a published version is refused (append-only).
        const edit = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${published}`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `edit-${randomUUID()}`)
          .send({ rate: '9.000000' })
          .expect(409);
        expect((edit.body as ErrorBody).error.code).toBe(
          'PACKAGE_VERSION_IMMUTABLE',
        );

        // No delete route exists — versions are never deleted.
        await supertest(server)
          .delete(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${published}`,
          )
          .set(authorized(admin.token))
          .expect(404);

        // A DRAFT (not yet published) version can still be cancelled.
        const draft = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `draft-${randomUUID()}`)
          .send({
            rate: '1.240000',
            effective_from: '2038-01-01T00:00:00.000Z',
            effective_to: '2038-06-01T00:00:00.000Z',
          })
          .expect(201);
        await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${(draft.body as { id: string }).id}/cancel`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `draft-cancel-${randomUUID()}`)
          .expect(200);

        // An actively assigned version cannot be cancelled (history pinned).
        const branch = await createMerchantBranch(marketA);
        await seedAssignment(branch, published);
        const cancelActive = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${published}/cancel`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `active-cancel-${randomUUID()}`)
          .expect(409);
        expect((cancelActive.body as ErrorBody).error.code).toBe(
          'PACKAGE_VERSION_IN_ACTIVE_USE',
        );
      });
    });

    describe('supplementary (Command Center 2026-08-04): idempotency key + payload hash on every configuration write', () => {
      it('activates idempotently; a different target with the same key stays an independent scope', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const v1 = await createMarketVersion(
          profileA,
          marketA,
          '6.500000',
          new Date('2039-01-01T00:00:00.000Z'),
          new Date('2039-06-01T00:00:00.000Z'),
          'DRAFT',
        );
        const v2 = await createMarketVersion(
          profileA,
          marketA,
          '6.750000',
          new Date('2039-07-01T00:00:00.000Z'),
          new Date('2039-12-31T00:00:00.000Z'),
          'DRAFT',
        );
        const key = `activate-idem-${randomUUID()}`;
        const first = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${v1}/activate`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .expect(200);
        const replay = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${v1}/activate`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .expect(200);
        // Idempotent replay returns the ORIGINAL stored result (same id).
        expect((replay.body as { id: string }).id).toBe(
          (first.body as { id: string }).id,
        );
        // The owner scopes idempotency per operation+actor, so the same key
        // on a different version is a new scope, not a replay conflict.
        const other = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${v2}/activate`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .expect(200);
        expect((other.body as { id: string }).id).toBe(v2);
      });

      it('rejects the same idempotency key with a different assign payload (payload hash)', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.assign'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const branch = await createMerchantBranch(marketA);
        await seedAssignment(branch, marketVersionA);
        const profileE = (
          await database.db
            .select({ id: serviceFeeProfiles.id })
            .from(serviceFeeProfiles)
            .where(eq(serviceFeeProfiles.code, 'E'))
            .limit(1)
        )[0];
        const profileF = (
          await database.db
            .select({ id: serviceFeeProfiles.id })
            .from(serviceFeeProfiles)
            .where(eq(serviceFeeProfiles.code, 'F'))
            .limit(1)
        )[0];
        const versionE = await createMarketVersion(
          profileE?.id ?? '',
          marketA,
          '11.000000',
          new Date('2026-03-01T00:00:00.000Z'),
          new Date('2027-03-01T00:00:00.000Z'),
        );
        const versionF = await createMarketVersion(
          profileF?.id ?? '',
          marketA,
          '12.000000',
          new Date('2026-03-01T00:00:00.000Z'),
          new Date('2027-03-01T00:00:00.000Z'),
        );
        const key = `assign-idem-${randomUUID()}`;
        const payload = {
          service_fee_version_id: versionE,
          is_default: false,
        };
        const first = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .send(payload)
          .expect(201);
        const replay = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .send(payload)
          .expect(201);
        expect((replay.body as { id: string }).id).toBe(
          (first.body as { id: string }).id,
        );
        // Same key, different payload → payload-hash conflict (409).
        const conflict = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .send({ service_fee_version_id: versionF, is_default: false })
          .expect(409);
        expect((conflict.body as ErrorBody).error.code).toBe(
          'IDEMPOTENCY_KEY_CONFLICT',
        );
      });

      it('replays set-default idempotently', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.assign'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const branch = await createMerchantBranch(marketA);
        const oldAssignment = await seedAssignment(branch, marketVersionA);
        const profileD = (
          await database.db
            .select({ id: serviceFeeProfiles.id })
            .from(serviceFeeProfiles)
            .where(eq(serviceFeeProfiles.code, 'D'))
            .limit(1)
        )[0];
        const versionD = await createMarketVersion(
          profileD?.id ?? '',
          marketA,
          '13.000000',
          new Date('2026-04-01T00:00:00.000Z'),
          new Date('2027-04-01T00:00:00.000Z'),
        );
        const assigned = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `sd-assign-${randomUUID()}`)
          .send({ service_fee_version_id: versionD, is_default: false })
          .expect(201);
        const assignmentId = (assigned.body as { id: string }).id;
        expect(assignmentId).not.toBe(oldAssignment);
        const key = `sd-${randomUUID()}`;
        const first = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments/${assignmentId}/set-default`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .expect(200);
        const replay = await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/merchants/${branch}/packages/assignments/${assignmentId}/set-default`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', key)
          .expect(200);
        expect((replay.body as { id: string }).id).toBe(
          (first.body as { id: string }).id,
        );
      });
    });

    describe('supplementary (Command Center 2026-08-04): concurrent version creation', () => {
      it('accepts two concurrent creates with disjoint windows and rejects an overlapping race', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);

        const [r1, r2] = await Promise.all([
          supertest(server)
            .post(
              `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
            )
            .set(authorized(admin.token))
            .set('Idempotency-Key', `conc-1-${randomUUID()}`)
            .send({
              rate: '21.000000',
              effective_from: '2040-01-01T00:00:00.000Z',
              effective_to: '2040-06-01T00:00:00.000Z',
            }),
          supertest(server)
            .post(
              `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
            )
            .set(authorized(admin.token))
            .set('Idempotency-Key', `conc-2-${randomUUID()}`)
            .send({
              rate: '22.000000',
              effective_from: '2040-07-01T00:00:00.000Z',
              effective_to: '2040-12-31T00:00:00.000Z',
            }),
        ]);
        expect(r1.status).toBe(201);
        expect(r2.status).toBe(201);

        // Overlapping windows: the exclusion constraint lets exactly one
        // concurrent create win; the loser gets 409.
        const [o1, o2] = await Promise.all([
          supertest(server)
            .post(
              `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
            )
            .set(authorized(admin.token))
            .set('Idempotency-Key', `conc-ov-1-${randomUUID()}`)
            .send({
              rate: '23.000000',
              effective_from: '2041-01-01T00:00:00.000Z',
              effective_to: '2042-01-01T00:00:00.000Z',
            }),
          supertest(server)
            .post(
              `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
            )
            .set(authorized(admin.token))
            .set('Idempotency-Key', `conc-ov-2-${randomUUID()}`)
            .send({
              rate: '24.000000',
              effective_from: '2041-06-01T00:00:00.000Z',
              effective_to: '2042-06-01T00:00:00.000Z',
            }),
        ]);
        expect([o1.status, o2.status].sort()).toEqual([201, 409]);
        const loser = o1.status === 409 ? o1 : o2.status === 409 ? o2 : null;
        if (loser) {
          expect((loser.body as ErrorBody).error.code).toBe(
            'PACKAGE_EFFECTIVE_WINDOW_OVERLAP',
          );
        }
      });
    });

    describe('supplementary (Command Center 2026-08-04): no Phase 7 write duplication — delegation only', () => {
      it('exposes no write routes on the Phase 7 adapter surface', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: [
            'merchant.package.manage',
            'merchant.package.assign',
          ],
        });
        await setCurrentMarket(admin.accountId, marketA);

        // No profile/version create on the adapter.
        await supertest(server)
          .post(`/api/v1/admin/package-ops/markets/${marketA}/packages`)
          .set(authorized(admin.token))
          .set('Idempotency-Key', `dup-1-${randomUUID()}`)
          .send({ code: 'Z', name: 'Duplicate', description: 'x' })
          .expect(404);
        // No assignment write on the adapter.
        await supertest(server)
          .post(
            `/api/v1/admin/package-ops/markets/${marketA}/merchants/${randomUUID()}/packages/assignments`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `dup-2-${randomUUID()}`)
          .send({ service_fee_version_id: marketVersionA })
          .expect(404);
      });

      it('keeps every merchant assignment in the market unchanged when a new version is created and activated', async () => {
        const admin = await createAdmin({
          marketIds: [marketA],
          permissionCodes: ['merchant.package.manage'],
        });
        await setCurrentMarket(admin.accountId, marketA);
        const before = (
          await database.db
            .select({ id: merchantPackageAssignments.id })
            .from(merchantPackageAssignments)
        ).length;

        const created = await supertest(server)
          .post(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `pin-market-${randomUUID()}`)
          .send({
            rate: '25.250000',
            effective_from: '2043-01-01T00:00:00.000Z',
            effective_to: '2043-06-01T00:00:00.000Z',
          })
          .expect(201);
        await supertest(server)
          .patch(
            `/api/v1/admin/markets/${marketA}/packages/${profileA}/versions/${(created.body as { id: string }).id}/activate`,
          )
          .set(authorized(admin.token))
          .set('Idempotency-Key', `pin-market-act-${randomUUID()}`)
          .expect(200);

        const after = (
          await database.db
            .select({ id: merchantPackageAssignments.id })
            .from(merchantPackageAssignments)
        ).length;
        expect(after).toBe(before);
      });
    });
  },
);
