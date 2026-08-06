/**
 * D-051 — Phase 1 Special Percentage Owner security remediation
 * (HTTP + in-process, real PostgreSQL) — owner evidence suite.
 *
 * Models the accepted D-054 (Phase 5 commission rate) / D-053 (Phase 6
 * redemption rate) / D-050 (Phase 3 reward rule) owner evidence suites.
 * Every matrix from the D-051 command §1–§8 runs against a freshly
 * created, migrated and seeded database through the canonical Phase 1
 * route (`POST /api/v1/admin/markets/:marketId/special-percentages`)
 * plus direct in-process owner calls for the bypass proofs.
 *
 * The frozen catalog declares `merchant.special_package.manage` as
 * SUPER_ADMIN-only, market-scoped and step-up-required, so every HTTP
 * create in this suite carries a fresh server-seeded step-up grant and a
 * server Current Admin Market (both provided by the canonical guard).
 *
 * @packageDocumentation
 */

import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
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
import { and, eq, isNull, sql } from 'drizzle-orm';
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
import { AuditService } from '../platform-access/audit.service.js';
import { PackageService } from '../merchant/package.service.js';
import type { CreateSpecialPercentageDto } from '../merchant/dto/package.dto.js';
import type { SpecialPercentageAdminActor } from '../merchant/package.types.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'Special-Percentage-Owner-Password-123!';

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
  'Phase 1 Special Percentage Owner D-051 security remediation (HTTP, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let owner: PackageService;
    let auditService: AuditService;
    let rateLimiter: InMemoryRateLimiter;
    let marketA: string; // code MA, MYR
    let marketB: string; // code MB, SGD
    let mfaSecret: Buffer;

    const specialsUrl = (marketId: string) =>
      `/api/v1/admin/markets/${marketId}/special-percentages`;

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
          name: `${code} D051 Owner Test Market`,
          status: 'ACTIVE',
          currencyCode,
          timezone,
          defaultLocale: 'en-MY',
        })
        .returning({ id: markets.id });
      return inserted[0]?.id ?? '';
    }

    async function freshMarket(
      timezone = 'Asia/Kuala_Lumpur',
    ): Promise<string> {
      const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code =
          LETTERS[Math.floor(Math.random() * 26)]! +
          LETTERS[Math.floor(Math.random() * 26)]!;
        const existing = await database.db
          .select({ id: markets.id })
          .from(markets)
          .where(eq(markets.code, code))
          .limit(1);
        if (existing[0]) continue;
        try {
          const inserted = await database.db
            .insert(markets)
            .values({
              code,
              name: `Fresh D051 Owner Market ${code}`,
              status: 'ACTIVE',
              currencyCode: 'MYR',
              timezone,
              defaultLocale: 'en-MY',
            })
            .returning({ id: markets.id });
          return inserted[0]?.id ?? '';
        } catch {
          // Random-code collision under parallel runs — retry with a new code.
        }
      }
      throw new Error('freshMarket exhausted retries');
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

    async function ensurePermissions(
      codes: readonly string[],
    ): Promise<string[]> {
      if (codes.length === 0) return [];
      await database.db
        .insert(permissions)
        .values(
          codes.map((code) => ({
            code,
            description: `${code} d051 owner integration test permission`,
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
          displayName: `D051 Owner Admin ${randomUUID()}`,
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
          name: `D051 Owner HTTP Test Role (${roleCode})`,
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

    async function revokeMarketGrant(
      adminUserId: string,
      marketId: string,
    ): Promise<void> {
      await database.db
        .update(marketAccess)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(marketAccess.adminUserId, adminUserId),
            eq(marketAccess.marketId, marketId),
            isNull(marketAccess.revokedAt),
          ),
        );
    }

    async function marketCodeOf(marketId: string): Promise<string> {
      const rows = await database.db
        .select({ code: markets.code })
        .from(markets)
        .where(eq(markets.id, marketId))
        .limit(1);
      return rows[0]?.code ?? '';
    }

    /** Direct row seed of a legacy special percentage (no reason). */
    async function seedLegacySpecialPercentage(params: {
      marketId: string;
      rate: string;
      description: string;
      adminUserId: string;
    }): Promise<string> {
      const inserted = await database.db
        .insert(specialPercentages)
        .values({
          marketId: params.marketId,
          rate: params.rate,
          description: params.description,
          createdByAdminUserId: params.adminUserId,
        })
        .returning({ id: specialPercentages.id });
      return inserted[0]?.id ?? '';
    }

    /** Seed a merchant branch + an ACTIVE default package assignment. */
    async function seedBranchAndAssignment(params: {
      marketId: string;
    }): Promise<{ branchId: string; assignmentId: string }> {
      const account = await createAccount();
      const groupRows = await database.db
        .insert(merchantGroups)
        .values({
          accountId: account.accountId,
          marketId: params.marketId,
          name: `D051 Group ${randomUUID()}`,
        })
        .returning({ id: merchantGroups.id });
      const groupId = groupRows[0]?.id ?? '';
      const branchRows = await database.db
        .insert(merchantBranches)
        .values({
          merchantGroupId: groupId,
          merchantId: `mb_${randomUUID()}`,
          marketId: params.marketId,
          name: `D051 Branch ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: merchantBranches.id });
      const branchId = branchRows[0]?.id ?? '';
      const profileRows = await database.db
        .insert(serviceFeeProfiles)
        .values({
          code: `D051-${randomUUID().slice(0, 8).toUpperCase()}`,
          name: `D051 Package ${randomUUID().slice(0, 8)}`,
          marketId: params.marketId,
        })
        .returning({ id: serviceFeeProfiles.id });
      const profileId = profileRows[0]?.id ?? '';
      const versionRows = await database.db
        .insert(serviceFeeVersions)
        .values({
          serviceFeeProfileId: profileId,
          marketId: params.marketId,
          rate: '2.500000',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2030-12-31T00:00:00.000Z'),
          status: 'ACTIVE',
        })
        .returning({ id: serviceFeeVersions.id });
      const versionId = versionRows[0]?.id ?? '';
      const assignmentRows = await database.db
        .insert(merchantPackageAssignments)
        .values({
          merchantBranchId: branchId,
          serviceFeeVersionId: versionId,
          status: 'ACTIVE',
          isDefault: true,
        })
        .returning({ id: merchantPackageAssignments.id });
      return { branchId, assignmentId: assignmentRows[0]?.id ?? '' };
    }

    /** Build the owner create payload (D-051 contract fields). */
    function ownerPayload(overrides: Record<string, unknown> = {}) {
      return {
        rate: '18.500000',
        description: 'Partner promotion',
        reason: 'D-051 owner remediation evidence',
        ...overrides,
      };
    }

    function createSpecial(
      token: string,
      marketId: string,
      payload: Record<string, unknown>,
      key?: string,
      stepUp?: string,
    ) {
      const request = supertest(server)
        .post(specialsUrl(marketId))
        .set(authorized(token))
        .set('Idempotency-Key', key ?? `key-${randomUUID()}`);
      if (stepUp) request.set('x-step-up-token', stepUp);
      return request.send(payload);
    }

    /** Server-created actor for direct in-process owner calls. */
    function ownerActor(
      adminUserId: string,
      currentMarketId: string,
    ): SpecialPercentageAdminActor {
      return {
        adminUserId,
        currentMarketId,
        marketContextVersion: 2,
        requestId: `d051-${randomUUID()}`,
        ipAddress: '127.0.0.1',
      };
    }

    /** Direct in-process owner create (bypass proof surface). */
    function createDirect(
      adminUserId: string,
      marketRouteId: string,
      currentMarketId: string,
      input: Record<string, unknown>,
      key: string,
    ) {
      return owner.createSpecialPercentage(
        marketRouteId,
        ownerActor(adminUserId, currentMarketId),
        input as CreateSpecialPercentageDto,
        key,
      );
    }

    /** Assert a thrown owner error by HTTP status + code. */
    async function expectOwnerError(
      promise: Promise<unknown>,
      status: number,
      code: string,
    ): Promise<void> {
      await expect(promise).rejects.toSatisfy((error: unknown) => {
        const candidate = error as {
          status?: number;
          getStatus?: () => number;
          response?: { code?: string };
        };
        const actualStatus =
          typeof candidate.getStatus === 'function'
            ? candidate.getStatus()
            : candidate.status;
        return (
          actualStatus === status &&
          (candidate.response as { code?: string } | undefined)?.code === code
        );
      });
    }

    beforeAll(async () => {
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
        'special-percentage-owner-pepper-at-least-32-characters',
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
      owner = app.get(PackageService);
      auditService = app.get(AuditService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await ensureActiveMarket('MA', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('MB', 'SGD', 'Asia/Singapore');
    });

    afterAll(async () => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
      await app?.close();
    });

    beforeEach(() => {
      (
        rateLimiter as unknown as { buckets?: Map<string, unknown> }
      ).buckets?.clear();
    });

    // ─── §1 Authorization matrix ────────────────────────────────────

    it('rejects unauthenticated creates with 401', async () => {
      await supertest(server)
        .post(specialsUrl(marketA))
        .send(ownerPayload())
        .expect(401);
    });

    it('rejects non-admin (member) actors with 403', async () => {
      const member = await createAccount();
      const token = (await auth.login(member.email, password)).accessToken;
      await createSpecial(token, marketA, ownerPayload()).expect(403);
    });

    it('rejects admins without merchant.special_package.manage with 403', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.package.view'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(
        admin,
        'merchant.special_package.manage',
        marketA,
      );
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        undefined,
        stepUp,
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('accepts an authorized SUPER_ADMIN-like actor with 201', async () => {
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
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `accept-${randomUUID()}`,
        stepUp,
      ).expect(201);
      expect((body.body as { id: string }).id).toBeTruthy();
    });

    it('rejects when no server Current Admin Market is selected (409)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      // No setCurrentMarket → the guard cannot resolve the Current Admin Market.
      const stepUp = await seedStepUpGrant(
        admin,
        'merchant.special_package.manage',
        marketA,
      );
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `nomarket-${randomUUID()}`,
        stepUp,
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'MARKET_SELECTION_REQUIRED',
      );
    });

    it('rejects an admin with no market grant (403)', async () => {
      const admin = await createAdmin({
        marketIds: [],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const stepUp = await seedStepUpGrant(
        admin,
        'merchant.special_package.manage',
        marketA,
      );
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `nogrant-${randomUUID()}`,
        stepUp,
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('MARKET_ACCESS_DENIED');
    });

    it('rejects immediately after the market grant is revoked (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const first = await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `revoke1-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);
      expect((first.body as { id: string }).id).toBeTruthy();

      await revokeMarketGrant(admin.adminUserId, marketA);
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `revoke2-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(403);
      expect((body.body as ErrorBody).error.code).toBe('MARKET_ACCESS_DENIED');
    });

    it('in-process: rejects a missing actor with 403 SPECIAL_PERCENTAGE_PERMISSION_DENIED', async () => {
      await expect(
        owner.createSpecialPercentage(
          marketA,
          {} as SpecialPercentageAdminActor,
          {
            rate: '10.000000',
            description: 'x',
            reason: 'valid reason',
          },
          `direct-${randomUUID()}`,
        ),
      ).rejects.toMatchObject({
        response: { code: 'SPECIAL_PERCENTAGE_PERMISSION_DENIED' },
      });
    });

    it('in-process: rejects an actor without a Current Admin Market with 409', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
      });
      await expect(
        createDirect(
          admin.adminUserId,
          marketA,
          // No current market in the actor.
          '' as string,
          ownerPayload(),
          `direct-${randomUUID()}`,
        ),
      ).rejects.toMatchObject({
        response: { code: 'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED' },
      });
    });

    it('in-process: rejects an actor with no permission grant (403)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.package.view'],
      });
      await expectOwnerError(
        createDirect(
          admin.adminUserId,
          marketA,
          marketA,
          ownerPayload(),
          `direct-${randomUUID()}`,
        ),
        403,
        'SPECIAL_PERCENTAGE_PERMISSION_DENIED',
      );
    });

    // ─── §2/§3 Mandatory reason + durable storage ───────────────────

    it('rejects a missing reason with 400 (VALIDATION_ERROR)', async () => {
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
      const payload = ownerPayload();
      const { reason: _reason, ...payloadWithoutReason } = payload;
      void _reason;
      const body = await createSpecial(
        admin.token,
        marketA,
        payloadWithoutReason,
        `noreason-${randomUUID()}`,
        stepUp,
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects blank/whitespace-only reasons with 400', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      for (const reason of ['', '   ', '\t\n ']) {
        const body = await createSpecial(
          admin.token,
          marketA,
          ownerPayload({ reason }),
          `blank-${randomUUID()}`,
          await seedStepUpGrant(
            admin,
            'merchant.special_package.manage',
            marketA,
          ),
        ).expect(400);
        expect((body.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      }
      // In-process: the owner re-checks the reason itself.
      await expectOwnerError(
        createDirect(
          admin.adminUserId,
          marketA,
          marketA,
          ownerPayload({ reason: '   ' }),
          `direct-${randomUUID()}`,
        ),
        400,
        'SPECIAL_PERCENTAGE_REASON_REQUIRED',
      );
    });

    it('rejects reasons longer than 500 characters with 400', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload({ reason: 'a'.repeat(501) }),
        `long-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts 1-char and 500-char reasons; trims surrounding whitespace without truncation', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      for (const [reason, expected] of [
        ['a', 'a'],
        ['x'.repeat(500), 'x'.repeat(500)],
        ['  trimmed reason  ', 'trimmed reason'],
      ] as const) {
        const body = await createSpecial(
          admin.token,
          marketA,
          ownerPayload({ reason }),
          `trim-${randomUUID()}`,
          await seedStepUpGrant(
            admin,
            'merchant.special_package.manage',
            marketA,
          ),
        ).expect(201);
        expect((body.body as { reason: string }).reason).toBe(expected);
        const rows = await database.db
          .select({ reason: specialPercentages.reason })
          .from(specialPercentages)
          .where(eq(specialPercentages.id, (body.body as { id: string }).id));
        // Durable on the row (migration 0033), normalized by the owner.
        expect(rows[0]?.reason).toBe(expected);
      }
    });

    it('persists the reason durably on the row and in the immutable audit', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const reason = 'Board-approved partner promotion Q3 2026';
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload({ reason }),
        `durable-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);
      const specialId = (body.body as { id: string }).id;

      const rows = await database.db
        .select({
          reason: specialPercentages.reason,
          createdBy: specialPercentages.createdByAdminUserId,
        })
        .from(specialPercentages)
        .where(eq(specialPercentages.id, specialId));
      expect(rows[0]?.reason).toBe(reason);
      expect(rows[0]?.createdBy).toBe(admin.adminUserId);

      const auditRows = await database.db
        .select({
          action: auditLogs.action,
          reason: auditLogs.reason,
          actorId: auditLogs.actorId,
          marketId: auditLogs.marketId,
          after: auditLogs.after,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'SPECIAL_PERCENTAGE_CREATED'),
            eq(auditLogs.entityId, specialId),
          ),
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.reason).toBe(reason);
      expect(auditRows[0]?.actorId).toBe(admin.adminUserId);
      expect(auditRows[0]?.marketId).toBe(marketA);
      const after = auditRows[0]?.after as Record<string, unknown> | null;
      expect(after?.['reason']).toBe(reason);
      expect(typeof after?.['idempotencyDigest']).toBe('string');
      expect(String(after?.['idempotencyDigest'])).toMatch(/^[0-9a-f]{64}$/u);
      expect(after?.['market']).toBe('MA');
    });

    // ─── §1 Market consistency + cross-market isolation ─────────────

    it('rejects a command market that differs from the Current Admin Market (409)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      // Route market = marketB while the Current Admin Market = marketA.
      const stepUp = await seedStepUpGrant(
        admin,
        'merchant.special_package.manage',
        marketA,
      );
      const body = await createSpecial(
        admin.token,
        marketB,
        ownerPayload(),
        `mismatch-${randomUUID()}`,
        stepUp,
      ).expect(409);
      expect((body.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
      // In-process: the owner re-checks command market == Current Admin Market.
      await expectOwnerError(
        createDirect(
          admin.adminUserId,
          marketB,
          marketA,
          ownerPayload(),
          `direct-${randomUUID()}`,
        ),
        409,
        'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH',
      );
    });

    it('isolates special percentages per market (no cross-market leakage)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `iso-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);

      const marketARows = await database.db
        .select({ id: specialPercentages.id })
        .from(specialPercentages)
        .where(eq(specialPercentages.marketId, marketA));
      const marketBRows = await database.db
        .select({ id: specialPercentages.id })
        .from(specialPercentages)
        .where(eq(specialPercentages.marketId, marketB));
      expect(marketARows.length).toBeGreaterThanOrEqual(1);
      expect(marketBRows).toHaveLength(0);
    });

    // ─── §4 Idempotency + canonical payload hash ────────────────────

    it('rejects a missing Idempotency-Key header with 400', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        '',
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe(
        'IDEMPOTENCY_KEY_REQUIRED',
      );
    });

    it('replays same key + same payload with the exact original result (one row)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const key = `replay-${randomUUID()}`;
      const payload = ownerPayload();
      const first = await createSpecial(
        admin.token,
        marketA,
        payload,
        key,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);
      const second = await createSpecial(
        admin.token,
        marketA,
        payload,
        key,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);
      expect(second.body).toEqual(first.body);
      const rows = await database.db
        .select({ id: specialPercentages.id })
        .from(specialPercentages)
        .where(eq(specialPercentages.id, (first.body as { id: string }).id));
      expect(rows).toHaveLength(1);
      const claims = await database.db
        .select({
          scope: merchantApiIdempotencyKeys.scope,
          requestHash: merchantApiIdempotencyKeys.requestHash,
        })
        .from(merchantApiIdempotencyKeys)
        .where(
          and(
            eq(
              merchantApiIdempotencyKeys.scope,
              `package.special.owner.create:${marketA}:${admin.adminUserId}`,
            ),
            eq(merchantApiIdempotencyKeys.key, key),
          ),
        );
      expect(claims).toHaveLength(1);
      expect(String(claims[0]?.requestHash)).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('rejects same key + different payload with 409', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const key = `conflict-${randomUUID()}`;
      await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        key,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);
      for (const different of [
        ownerPayload({ rate: '19.000000' }),
        ownerPayload({ description: 'Different description' }),
        ownerPayload({ reason: 'A completely different reason text' }),
      ]) {
        const body = await createSpecial(
          admin.token,
          marketA,
          different,
          key,
          await seedStepUpGrant(
            admin,
            'merchant.special_package.manage',
            marketA,
          ),
        ).expect(409);
        expect((body.body as ErrorBody).error.code).toBe(
          'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT',
        );
      }
    });

    it('commits exactly one row under concurrent same-key duplicates', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const key = `concurrent-${randomUUID()}`;
      const payload = ownerPayload();
      const [a, b] = await Promise.all([
        createSpecial(
          admin.token,
          marketA,
          payload,
          key,
          await seedStepUpGrant(
            admin,
            'merchant.special_package.manage',
            marketA,
          ),
        ),
        createSpecial(
          admin.token,
          marketA,
          payload,
          key,
          await seedStepUpGrant(
            admin,
            'merchant.special_package.manage',
            marketA,
          ),
        ),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect((a.body as { id: string }).id).toBe((b.body as { id: string }).id);
      const rows = await database.db
        .select({ id: specialPercentages.id })
        .from(specialPercentages)
        .where(eq(specialPercentages.id, (a.body as { id: string }).id));
      expect(rows).toHaveLength(1);
    });

    // ─── §5 Atomic immutable audit ──────────────────────────────────

    it('rolls back row + idempotency claim + audit on injected audit failure, then retry succeeds', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const key = `atomic-${randomUUID()}`;
      // Unique payload so the rollback proof counts only THIS command.
      const payload = ownerPayload({
        rate: '17.250000',
        description: `Atomic rollback probe ${randomUUID()}`,
        reason: 'D-051 atomicity evidence with unique reason',
      });
      const auditBefore = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.marketId, marketA));
      const spy = vi
        .spyOn(auditService, 'appendWithinTransaction')
        .mockRejectedValueOnce(new Error('injected audit failure'));
      const failed = await createSpecial(
        admin.token,
        marketA,
        payload,
        key,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      );
      expect(failed.status).toBe(500);
      spy.mockRestore();
      // Nothing committed: no NEW special row matching this exact payload
      // in the market, no idempotency claim, no NEW audit row for the
      // market.
      const matching = await database.db
        .select({ id: specialPercentages.id })
        .from(specialPercentages)
        .where(
          and(
            eq(specialPercentages.marketId, marketA),
            eq(specialPercentages.rate, payload['rate'] as string),
            eq(
              specialPercentages.description,
              payload['description'] as string,
            ),
            eq(specialPercentages.reason, payload['reason'] as string),
          ),
        );
      const claims = await database.db
        .select()
        .from(merchantApiIdempotencyKeys)
        .where(
          and(
            eq(
              merchantApiIdempotencyKeys.scope,
              `package.special.owner.create:${marketA}:${admin.adminUserId}`,
            ),
            eq(merchantApiIdempotencyKeys.key, key),
          ),
        );
      expect(matching).toHaveLength(0);
      expect(claims).toHaveLength(0);
      const auditAfter = await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.marketId, marketA));
      expect(auditAfter).toHaveLength(auditBefore.length);
      // Same key retry after correction succeeds (no false replay record).
      const retry = await createSpecial(
        admin.token,
        marketA,
        payload,
        key,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);
      expect((retry.body as { id: string }).id).toBeTruthy();
    });

    // ─── §6 Actor immutability ──────────────────────────────────────

    it('rejects actor-shaped fields in the DTO (client cannot forge the actor)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const body = await createSpecial(
        admin.token,
        marketA,
        {
          ...ownerPayload(),
          createdByAdminUserId: randomUUID(),
          adminUserId: randomUUID(),
        },
        `forgery-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(400);
      expect((body.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('records the server actor as created_by even when a direct caller passes extra fields', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
      });
      const response = await createDirect(
        admin.adminUserId,
        marketA,
        marketA,
        ownerPayload(),
        `direct-${randomUUID()}`,
      );
      const rows = await database.db
        .select({ createdBy: specialPercentages.createdByAdminUserId })
        .from(specialPercentages)
        .where(eq(specialPercentages.id, response.id));
      expect(rows[0]?.createdBy).toBe(admin.adminUserId);
    });

    // ─── §7/§8 Pinning + no historical recalculation ────────────────

    it('never touches merchant_package_assignments when a special percentage is created', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const seeded = await seedBranchAndAssignment({
        marketId: marketA,
      });
      const before = await database.db
        .select()
        .from(merchantPackageAssignments)
        .where(
          eq(merchantPackageAssignments.merchantBranchId, seeded.branchId),
        );

      await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `pin-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);

      const after = await database.db
        .select()
        .from(merchantPackageAssignments)
        .where(
          eq(merchantPackageAssignments.merchantBranchId, seeded.branchId),
        );
      expect(after).toEqual(before);
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(seeded.assignmentId);
      // The new special percentage is not referenced by any assignment:
      // every assignment row still points at the seeded service-fee
      // version only.
      const specialRefs = await database.db
        .select({ id: merchantPackageAssignments.id })
        .from(merchantPackageAssignments)
        .where(
          and(
            eq(merchantPackageAssignments.merchantBranchId, seeded.branchId),
            // non-null special_percentage_id would be a pinning violation
            sql`${merchantPackageAssignments.specialPercentageId} is not null`,
          ),
        );
      expect(specialRefs).toHaveLength(0);
    });

    it('leaves historical rows unchanged when a new special percentage is created', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const legacyId = await seedLegacySpecialPercentage({
        marketId: marketA,
        rate: '7.250000',
        description: 'Legacy historical special',
        adminUserId: admin.adminUserId,
      });
      const legacyBefore = await database.db
        .select()
        .from(specialPercentages)
        .where(eq(specialPercentages.id, legacyId));

      await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `history-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);

      const legacyAfter = await database.db
        .select()
        .from(specialPercentages)
        .where(eq(specialPercentages.id, legacyId));
      expect(legacyAfter).toEqual(legacyBefore);
      expect(legacyAfter[0]?.reason).toBeNull();
    });

    // ─── §3 Legacy rows keep NULL reason (never backfilled) ─────────

    it('keeps legacy special percentage rows with NULL reason (never backfilled)', async () => {
      const admin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['merchant.special_package.manage'],
        enrollMfa: true,
      });
      await setCurrentMarket(admin.accountId, marketA);
      const legacyId = await seedLegacySpecialPercentage({
        marketId: marketA,
        rate: '9.000000',
        description: 'Pre-D-051 legacy row',
        adminUserId: admin.adminUserId,
      });
      // A new owner-created row must NOT backfill the legacy row.
      await createSpecial(
        admin.token,
        marketA,
        ownerPayload(),
        `legacy-${randomUUID()}`,
        await seedStepUpGrant(
          admin,
          'merchant.special_package.manage',
          marketA,
        ),
      ).expect(201);
      const rows = await database.db
        .select({ reason: specialPercentages.reason })
        .from(specialPercentages)
        .where(eq(specialPercentages.id, legacyId));
      expect(rows[0]?.reason).toBeNull();
    });
  },
);
