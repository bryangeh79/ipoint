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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { totpCode } from '../auth/admin-mfa.crypto.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import { members } from '@ipoint/database';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'P7-S9-Audit-Ops-Password-123!';

const SENSITIVE_AFTER = {
  status: 'APPROVED',
  id_number: '800101-14-5678',
  access_token:
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  note: 'approved by checker',
};

interface ErrorBody {
  error: { code: string; message?: string };
}

interface AuditListBody {
  asOf: string;
  marketId: string;
  items: Array<Record<string, unknown>>;
  total: number;
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
      accumulator &= (1 << bits) - 1;
    }
  }
  return Buffer.from(output);
}

/**
 * P7-S9 Admin Audit Viewer HTTP integration (Command Center 2026-08-07
 * §7.1) on a fresh real PostgreSQL database.
 *
 * Asserts:
 * - market-scoped immutable audit list with actor/action/entity/result/time
 *   filters and free-text search;
 * - sensitive masking in the limited view (identity-document fields masked,
 *   token fields redacted, source IP never returned) for EVERY role
 *   including the Support / read-only auditor template;
 * - the audited raw view: SUPER_ADMIN (audit.sensitive-diff.view + recorded
 *   reason + fresh step-up grant) sees the full stored evidence; the
 *   Support template and permission-less admins are denied — support never
 *   reads raw ledgers;
 * - market isolation (foreign-market entries invisible, URL/current-market
 *   mismatch 409, direct foreign-market entry 404);
 * - read-only by construction (no write routes exist on the surface).
 */
describe.skipIf(!databaseUrl)(
  'Admin Audit Viewer HTTP integration (P7-S9, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let marketA: string; // MY
    let marketB: string; // SG
    let superAdmin: { adminUserId: string; accountId: string; token: string };
    let supportAdmin: {
      adminUserId: string;
      accountId: string;
      token: string;
    };
    let noPermissionAdmin: {
      adminUserId: string;
      accountId: string;
      token: string;
    };
    let memberToken: string;
    let entryA: string; // market A success entry with sensitive fields
    let entryB: string; // market B entry (isolation target)
    let entryDenied: string; // market A DENIED entry
    let mfaSecret: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    function authorized(token: string) {
      return { Authorization: `Bearer ${token}` };
    }

    const entriesUrl = (marketId: string) =>
      `/api/v1/admin/audit-ops/markets/${marketId}/entries`;

    async function ensureActiveMarket(
      code: string,
      currencyCode: string,
      timezone: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `${code} P7-S9 Audit Test Market`,
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

    async function ensurePermissions(
      codes: readonly string[],
    ): Promise<string[]> {
      if (codes.length === 0) return [];
      await database.db
        .insert(permissions)
        .values(
          codes.map((code) => ({
            code,
            description: `${code} p7-s9 audit ops test permission`,
          })),
        )
        .onConflictDoNothing({ target: permissions.code });
      const rows = await database.db.select().from(permissions);
      return rows
        .filter((row) => codes.includes(row.code))
        .map((row) => row.id);
    }

    async function createAdmin(options: {
      marketIds: string[];
      permissionCodes?: readonly string[];
      roleCode?: string;
      enrollMfa?: boolean;
    }): Promise<{ adminUserId: string; accountId: string; token: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `P7-S9 Audit Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleCode = options.roleCode ?? 'SUPER_ADMIN';
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: roleCode,
          name: `P7-S9 Audit HTTP Test Role (${roleCode})`,
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
      const permissionIds = await ensurePermissions(
        options.permissionCodes ?? ['audit.read'],
      );
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

    /** Seed a fresh step-up grant bound to the admin's session + MFA factor. */
    async function seedStepUpGrant(
      admin: { adminUserId: string; accountId: string },
      actionClass: string,
      marketId: string,
    ): Promise<string> {
      const token = `stepup_${randomUUID()}${randomUUID()}`;
      const sessionRows = await database.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(eq(sessions.accountId, admin.accountId), isNull(sessions.revokedAt)),
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

    async function seedAuditEntry(options: {
      marketId: string;
      action: string;
      result: 'SUCCESS' | 'FAILURE' | 'DENIED';
      actorType?: string;
      entityType?: string;
      after?: unknown;
      occurredAt?: Date;
    }): Promise<string> {
      const inserted = await database.db
        .insert(auditLogs)
        .values({
          actorType: (options.actorType ?? 'ADMIN_USER') as never,
          actorId: randomUUID(),
          marketId: options.marketId,
          action: options.action,
          entityType: options.entityType ?? 'redemption_order',
          entityId: randomUUID(),
          before: { status: 'PENDING_CHECKER' },
          after: options.after ?? { status: 'APPROVED' },
          reason: 'documented reason',
          result: options.result as never,
          requestId: `req-${randomUUID()}`,
          ipAddress: '203.0.113.9',
          occurredAt: options.occurredAt ?? new Date(),
        })
        .returning({ id: auditLogs.id });
      return inserted[0]?.id ?? '';
    }

    async function memberLogin(): Promise<string> {
      const account = await createAccount();
      await database.db.insert(members).values({
        id: randomUUID(),
        accountId: account.accountId,
        publicMemberId: `M-${randomUUID()}`,
        referralCode: `R-${randomUUID()}`,
        status: 'ACTIVE',
        kycLevel: 'LEVEL_2',
      });
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: account.email, password })
        .expect(200);
      return String((response.body as { accessToken: string }).accessToken);
    }

    beforeAll(async () => {
      const dbName = new URL(databaseUrl ?? '').pathname.replace(/^\//u, '');
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const { Pool } = await import('pg');
      const maintenance = new Pool({ connectionString: maintenanceUrl });
      await maintenance.query(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
      );
      await maintenance.query(`CREATE DATABASE "${dbName}"`);
      await maintenance.end();

      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://172.23.0.2:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'p7-s9-audit-ops-pepper-at-least-32-characters',
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
      await migrate(database.pool);
      await seedFoundation(database.db);

      marketA = await ensureActiveMarket('MY', 'MYR', 'Asia/Kuala_Lumpur');
      marketB = await ensureActiveMarket('SG', 'SGD', 'Asia/Singapore');

      superAdmin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['audit.read', 'audit.sensitive-diff.view'],
        roleCode: 'SUPER_ADMIN',
        enrollMfa: true,
      });
      supportAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['audit.read'],
        roleCode: 'SUPPORT_READONLY_AUDITOR',
      });
      noPermissionAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['agent.read'],
        roleCode: 'OPERATIONS_ADMIN',
      });

      entryA = await seedAuditEntry({
        marketId: marketA,
        action: 'REDEMPTION_REFUND_APPROVE',
        result: 'SUCCESS',
        after: SENSITIVE_AFTER,
      });
      entryDenied = await seedAuditEntry({
        marketId: marketA,
        action: 'REDEMPTION_REFUND_REJECT',
        result: 'DENIED',
      });
      entryB = await seedAuditEntry({
        marketId: marketB,
        action: 'MARKET_CONFIG_UPDATE',
        result: 'SUCCESS',
      });

      memberToken = await memberLogin();
      await setCurrentMarket(superAdmin.accountId, marketA);
      await setCurrentMarket(supportAdmin.accountId, marketA);
      await setCurrentMarket(noPermissionAdmin.accountId, marketA);
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    // ─── Auth + permission matrix ────────────────────────────────────

    it('rejects unauthenticated requests (401)', async () => {
      await supertest(server).get(entriesUrl(marketA)).expect(401);
      await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryA}`)
        .expect(401);
      await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryA}/raw`)
        .expect(401);
    });

    it('rejects a member session (403)', async () => {
      await supertest(server)
        .get(entriesUrl(marketA))
        .set(authorized(memberToken))
        .expect(403);
    });

    it('rejects an admin without audit.read (403)', async () => {
      await supertest(server)
        .get(entriesUrl(marketA))
        .set(authorized(noPermissionAdmin.token))
        .expect(403);
      await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryA}`)
        .set(authorized(noPermissionAdmin.token))
        .expect(403);
      await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryA}/raw`)
        .set(authorized(noPermissionAdmin.token))
        .expect(403);
    });

    // ─── Masked limited view ─────────────────────────────────────────

    it('serves the masked limited view to the Support template (masked evidence, no raw IP, no raw fields)', async () => {
      const response = await supertest(server)
        .get(entriesUrl(marketA))
        .set(authorized(supportAdmin.token))
        .expect(200);
      const body = response.body as AuditListBody;
      expect(body.marketId).toBe(marketA);
      expect(body.total).toBe(2); // entryA + entryDenied (market A only)
      const item = body.items.find(
        (entry) => entry['id'] === entryA,
      ) as Record<string, unknown>;
      expect(item['masked']).toBe(true);
      expect(item['ipAddress']).toBeUndefined();
      expect(item['before']).toBeUndefined();
      expect(item['after']).toBeUndefined();
      const after = item['afterMasked'] as Record<string, unknown>;
      expect(after['id_number']).toBe('[MASKED]');
      expect(after['access_token']).toBe('[REDACTED]');
      expect(after['note']).toBe('approved by checker');
      expect(item['result']).toBe('SUCCESS');
    });

    it('filters by result, actor type and free-text search', async () => {
      const denied = await supertest(server)
        .get(`${entriesUrl(marketA)}?result=DENIED`)
        .set(authorized(supportAdmin.token))
        .expect(200);
      expect((denied.body as AuditListBody).total).toBe(1);
      expect((denied.body as AuditListBody).items[0]?.['id']).toBe(entryDenied);

      const searched = await supertest(server)
        .get(`${entriesUrl(marketA)}?q=refund`)
        .set(authorized(supportAdmin.token))
        .expect(200);
      expect((searched.body as AuditListBody).total).toBe(2);

      const actorFiltered = await supertest(server)
        .get(`${entriesUrl(marketA)}?actorType=SYSTEM`)
        .set(authorized(supportAdmin.token))
        .expect(200);
      expect((actorFiltered.body as AuditListBody).total).toBe(0);
    });

    it('filters by ISO-8601 time range', async () => {
      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date().toISOString();
      const ranged = await supertest(server)
        .get(`${entriesUrl(marketA)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        .set(authorized(supportAdmin.token))
        .expect(200);
      expect((ranged.body as AuditListBody).total).toBe(2);
      const inverted = await supertest(server)
        .get(`${entriesUrl(marketA)}?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`)
        .set(authorized(supportAdmin.token))
        .expect(400);
      expect((inverted.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    // ─── Market isolation ────────────────────────────────────────────

    it('never exposes foreign-market entries (list + direct access 404)', async () => {
      const list = await supertest(server)
        .get(entriesUrl(marketA))
        .set(authorized(superAdmin.token))
        .expect(200);
      const ids = (list.body as AuditListBody).items.map(
        (entry) => entry['id'],
      );
      expect(ids).not.toContain(entryB);
      await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryB}`)
        .set(authorized(superAdmin.token))
        .expect(404);
      // Raw view of a foreign-market entry: even with a valid step-up grant
      // + recorded reason for the Current Admin Market, the resource is not
      // reachable (404) — cross-market evidence never leaks.
      const grant = await seedStepUpGrant(
        superAdmin,
        'audit.sensitive-diff.view',
        marketA,
      );
      await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryB}/raw`)
        .set(authorized(superAdmin.token))
        .set('x-step-up-token', grant)
        .set('x-sensitive-access-reason', 'Cross-market leak probe')
        .expect(404);
    });

    it('rejects a URL market that differs from the Current Admin Market (409)', async () => {
      // superAdmin current market is A; the URL market B mismatches.
      const response = await supertest(server)
        .get(entriesUrl(marketB))
        .set(authorized(superAdmin.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    // ─── Raw evidence view (audited raw view) ────────────────────────

    it('denies the raw view to the Support template (support no raw ledgers)', async () => {
      const response = await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryA}/raw`)
        .set(authorized(supportAdmin.token))
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('PERMISSION_DENIED');
    });

    it('requires the recorded sensitive-access reason (422 without it)', async () => {
      const grant = await seedStepUpGrant(
        superAdmin,
        'audit.sensitive-diff.view',
        marketA,
      );
      const response = await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryA}/raw`)
        .set(authorized(superAdmin.token))
        .set('x-step-up-token', grant)
        .expect(422);
      expect((response.body as ErrorBody).error.code).toBe(
        'SENSITIVE_VIEW_REASON_REQUIRED',
      );
    });

    it('serves the full stored evidence to SUPER_ADMIN with reason + fresh step-up grant', async () => {
      const grant = await seedStepUpGrant(
        superAdmin,
        'audit.sensitive-diff.view',
        marketA,
      );
      const response = await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryA}/raw`)
        .set(authorized(superAdmin.token))
        .set('x-step-up-token', grant)
        .set('x-sensitive-access-reason', 'Refund approval evidence review')
        .expect(200);
      const body = response.body as Record<string, unknown>;
      expect(body['raw']).toBe(true);
      expect(body['id']).toBe(entryA);
      expect(body['ipAddress']).toBe('203.0.113.9');
      expect(body['after']).toEqual(SENSITIVE_AFTER);
      expect(
        (body['after'] as Record<string, unknown>)['id_number'],
      ).toBe('800101-14-5678');
    });

    it('consumes the step-up grant exactly once (second raw view needs a new grant)', async () => {
      const grant = await seedStepUpGrant(
        superAdmin,
        'audit.sensitive-diff.view',
        marketA,
      );
      await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryDenied}/raw`)
        .set(authorized(superAdmin.token))
        .set('x-step-up-token', grant)
        .set('x-sensitive-access-reason', 'Rejected refund evidence review')
        .expect(200);
      const second = await supertest(server)
        .get(`${entriesUrl(marketA)}/${entryDenied}/raw`)
        .set(authorized(superAdmin.token))
        .set('x-step-up-token', grant)
        .set('x-sensitive-access-reason', 'Rejected refund evidence review')
        .expect(403);
      expect((second.body as ErrorBody).error.code).toBe('MFA_STEP_UP_REQUIRED');
    });

    // ─── Read-only by construction ───────────────────────────────────

    it('defines no write routes on the audit surface (POST returns 404)', async () => {
      await supertest(server)
        .post(`${entriesUrl(marketA)}`)
        .set(authorized(superAdmin.token))
        .send({})
        .expect(404);
      await supertest(server)
        .post(`${entriesUrl(marketA)}/${entryA}/raw`)
        .set(authorized(superAdmin.token))
        .send({})
        .expect(404);
    });
  },
);
