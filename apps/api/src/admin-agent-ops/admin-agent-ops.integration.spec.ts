import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  accounts,
  agentActivationStatusLogs,
  agentActivations,
  adminUsers,
  commissionRateVersions,
  markets,
  memberProfiles,
  members,
  migrate,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { seedFoundation } from '@ipoint/database/seeds/foundation';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';

const databaseUrl = process.env['DATABASE_URL'];
const password = 'P7-S8-Agent-Ops-Password-123!';

interface ErrorBody {
  error: { code: string; message?: string };
}

/**
 * P7-S8 Admin Agent Operations HTTP integration (Command Center 2026-08-07
 * §6.1) on a fresh real PostgreSQL database.
 *
 * Asserts through the Phase 7 adapter over the FROZEN Phase 5 owner:
 * - the market-scoped list/search/detail read projection with the explicit
 *   capability state (CONFIGURED / AGENT_FEE_NOT_CONFIGURED, no fallback);
 * - the orchestrated suspend/reactivate/deactivate (owner transitions +
 *   immutable status log);
 * - the permission matrix (401 unauthenticated, 403 member / read-only /
 *   ungranted market, read allowed for `agent.read`);
 * - market isolation: URL market must equal the Current Admin Market
 *   (409 MARKET_CONTEXT_MISMATCH) and a foreign-market agent is not
 *   reachable (404);
 * - owner error mapping (409 on invalid transitions).
 */
describe.skipIf(!databaseUrl)(
  'Admin Agent Operations HTTP integration (P7-S8, real PostgreSQL)',
  () => {
    let app: INestApplication;
    let server: Server;
    let auth: AuthService;
    let database: DatabaseService;
    let marketA: string; // MY — configured with an activation fee
    let marketB: string; // SG — no activation fee (blocked capability)
    let admin: { adminUserId: string; accountId: string; token: string };
    let readOnlyAdmin: {
      adminUserId: string;
      accountId: string;
      token: string;
    };
    let memberToken: string;
    let agentA: string; // ACTIVE in market A
    let agentB: string; // ACTIVE in market B (isolation target)
    let agentPending: string; // PENDING_APPROVAL in market A
    let memberAId: string;

    function authorized(token: string) {
      return { Authorization: `Bearer ${token}` };
    }

    const agentsUrl = (marketId: string) =>
      `/api/v1/admin/agent-ops/markets/${marketId}/agents`;

    async function ensureActiveMarket(
      code: string,
      currencyCode: string,
      timezone: string,
    ): Promise<string> {
      const inserted = await database.db
        .insert(markets)
        .values({
          code,
          name: `${code} P7-S8 Agent Test Market`,
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
            description: `${code} p7-s8 agent ops test permission`,
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
    }): Promise<{ adminUserId: string; accountId: string; token: string }> {
      const account = await createAccount();
      const inserted = await database.db
        .insert(adminUsers)
        .values({
          accountId: account.accountId,
          displayName: `P7-S8 Agent Admin ${randomUUID()}`,
          status: 'ACTIVE',
        })
        .returning({ id: adminUsers.id });
      const adminUserId = inserted[0]?.id ?? '';
      const roleCode = options.roleCode ?? 'SUPER_ADMIN';
      const roleRows = await database.db
        .insert(roles)
        .values({
          code: roleCode,
          name: `P7-S8 Agent HTTP Test Role (${roleCode})`,
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
        options.permissionCodes ?? ['agent.read'],
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
        await database.db.execute(
          sql`INSERT INTO market_access (admin_user_id, market_id) VALUES ${sql.join(
            options.marketIds.map(
              (marketId) => sql`(${adminUserId}, ${marketId})`,
            ),
            sql`, `,
          )}`,
        );
      }
      const token = (
        await auth.createAdminSession(account.accountId, adminUserId, {
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        })
      ).accessToken;
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

    async function memberLogin(): Promise<string> {
      const account = await createAccount();
      const memberId = randomUUID();
      await database.db.execute(
        sql`INSERT INTO members (
              id, account_id, public_member_id, referral_code, status, kyc_level
            ) VALUES (
              ${memberId}, ${account.accountId}, ${`M-${randomUUID()}`},
              ${`R-${randomUUID()}`}, 'ACTIVE'::member_status,
              'LEVEL_2'::member_kyc_level
            ) ON CONFLICT (account_id) DO NOTHING`,
      );
      const response = await supertest(server)
        .post('/api/v1/auth/member/login')
        .send({ email: account.email, password })
        .expect(200);
      return String((response.body as { accessToken: string }).accessToken);
    }

    /** Seed an agent activation + member + profile + status log. */
    async function seedAgent(options: {
      marketId: string;
      marketCode: string;
      status: string;
      displayName?: string;
    }): Promise<{ activationId: string; memberId: string }> {
      const account = await createAccount();
      const memberId = randomUUID();
      const publicMemberId = `AG-${randomUUID().slice(0, 10).toUpperCase()}`;
      await database.db.execute(
        sql`INSERT INTO members (
              id, account_id, public_member_id, referral_code, status, kyc_level
            ) VALUES (
              ${memberId}, ${account.accountId}, ${publicMemberId},
              ${`RF-${randomUUID().slice(0, 8).toUpperCase()}`},
              'ACTIVE'::member_status, 'LEVEL_2'::member_kyc_level
            )`,
      );
      await database.db.insert(memberProfiles).values({
        memberId,
        displayName: options.displayName ?? `Agent ${publicMemberId}`,
      });
      const activationId = randomUUID();
      await database.db.insert(agentActivations).values({
        id: activationId,
        memberId,
        status: options.status as typeof agentActivations.$inferSelect.status,
        market: options.marketCode,
        currency: options.marketCode === 'MY' ? 'MYR' : 'SGD',
        activationFeeCurrency: options.marketCode === 'MY' ? 'MYR' : 'SGD',
        reactivationCount: 0,
      });
      await database.db.insert(agentActivationStatusLogs).values({
        activationId,
        fromStatus: null,
        toStatus:
          options.status as typeof agentActivationStatusLogs.$inferSelect.toStatus,
        changedByType: 'SYSTEM',
        reason: null,
      });
      return { activationId, memberId };
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
        'p7-s8-agent-ops-pepper-at-least-32-characters',
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

      // Market A is configured: effective AGENT_ACTIVATION_FEE version.
      await database.db.insert(commissionRateVersions).values({
        commissionType: 'AGENT_ACTIVATION_FEE',
        generation: 0,
        market: 'MY',
        rateValue: '388.0000000000',
        rateType: 'FIXED',
        effectiveFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
        createdBy: randomUUID(),
        reason: 'P7-S8 test fixture',
      });

      admin = await createAdmin({
        marketIds: [marketA, marketB],
        permissionCodes: ['agent.read', 'agent.activation.manage'],
        roleCode: 'SUPER_ADMIN',
      });
      readOnlyAdmin = await createAdmin({
        marketIds: [marketA],
        permissionCodes: ['agent.read'],
        roleCode: 'SUPPORT_READONLY_AUDITOR',
      });

      const agentAFixture = await seedAgent({
        marketId: marketA,
        marketCode: 'MY',
        status: 'ACTIVE',
        displayName: 'Alice Agent',
      });
      agentA = agentAFixture.activationId;
      memberAId = agentAFixture.memberId;
      const agentBFixture = await seedAgent({
        marketId: marketB,
        marketCode: 'SG',
        status: 'ACTIVE',
        displayName: 'Bob Agent',
      });
      agentB = agentBFixture.activationId;
      const pendingFixture = await seedAgent({
        marketId: marketA,
        marketCode: 'MY',
        status: 'PENDING_APPROVAL',
        displayName: 'Carol Agent',
      });
      agentPending = pendingFixture.activationId;

      memberToken = await memberLogin();
      await setCurrentMarket(admin.accountId, marketA);
      await setCurrentMarket(readOnlyAdmin.accountId, marketA);
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    // ─── Auth + permission matrix ────────────────────────────────────

    it('rejects unauthenticated requests (401)', async () => {
      await supertest(server).get(agentsUrl(marketA)).expect(401);
      await supertest(server)
        .post(`${agentsUrl(marketA)}/${agentA}/suspend`)
        .send({ reason: 'x' })
        .expect(401);
    });

    it('rejects member (ACCOUNT) sessions (403)', async () => {
      await supertest(server)
        .get(agentsUrl(marketA))
        .set(authorized(memberToken))
        .expect(403);
    });

    it('allows read-only admins (agent.read) to list/detail but denies status writes (403)', async () => {
      const list = await supertest(server)
        .get(agentsUrl(marketA))
        .set(authorized(readOnlyAdmin.token))
        .expect(200);
      expect(
        (list.body as { items: unknown[] }).items.length,
      ).toBeGreaterThanOrEqual(2);

      await supertest(server)
        .post(`${agentsUrl(marketA)}/${agentA}/suspend`)
        .set(authorized(readOnlyAdmin.token))
        .send({ reason: 'Not allowed' })
        .expect(403);
    });

    // ─── Market isolation ────────────────────────────────────────────

    it('rejects a URL market that differs from the Current Admin Market (409)', async () => {
      // Current Admin Market = marketA; URL market = marketB.
      const response = await supertest(server)
        .get(agentsUrl(marketB))
        .set(authorized(admin.token))
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('does not expose a foreign-market agent (404 via the current market URL)', async () => {
      await supertest(server)
        .get(`${agentsUrl(marketA)}/${agentB}`)
        .set(authorized(admin.token))
        .expect(404);
    });

    // ─── Read projections ────────────────────────────────────────────

    it('lists agents of the current market with the CONFIGURED capability state', async () => {
      const response = await supertest(server)
        .get(agentsUrl(marketA))
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as {
        market_code: string;
        capability: { state: string; activation_fee: string | null };
        items: Array<{ agent_id: string; status: string }>;
        total: number;
      };
      expect(body.market_code).toBe('MY');
      expect(body.capability.state).toBe('CONFIGURED');
      expect(body.capability.activation_fee).toBe('388.0000000000');
      expect(body.total).toBe(2);
      const ids = body.items.map((item) => item.agent_id);
      expect(ids).toContain(agentA);
      expect(ids).toContain(agentPending);
      expect(ids).not.toContain(agentB);
    });

    it('filters the list by status', async () => {
      const response = await supertest(server)
        .get(`${agentsUrl(marketA)}?status=ACTIVE`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as {
        items: Array<{ status: string }>;
        total: number;
      };
      expect(body.total).toBe(1);
      expect(body.items[0]?.status).toBe('ACTIVE');
    });

    it('searches by public member id prefix', async () => {
      const publicId = await database.db
        .select({ publicMemberId: members.publicMemberId })
        .from(members)
        .where(eq(members.id, memberAId))
        .limit(1)
        .then((rows) => rows[0]?.publicMemberId ?? '');
      const response = await supertest(server)
        .get(`${agentsUrl(marketA)}?q=${publicId.slice(0, 6)}`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as {
        total: number;
        items: Array<{ agent_id: string }>;
      };
      expect(body.total).toBe(1);
      expect(body.items[0]?.agent_id).toBe(agentA);
    });

    it('returns the agent detail with the append-only status history', async () => {
      const response = await supertest(server)
        .get(`${agentsUrl(marketA)}/${agentA}`)
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as {
        status: string;
        status_history: Array<{ to_status: string }>;
        public_member_id: string;
      };
      expect(body.status).toBe('ACTIVE');
      expect(body.public_member_id).toBeTruthy();
      expect(body.status_history.length).toBeGreaterThanOrEqual(1);
      expect(
        body.status_history[body.status_history.length - 1]?.to_status,
      ).toBe('ACTIVE');
    });

    it('reports the explicit blocked capability state for an unconfigured market', async () => {
      // Switch the Current Admin Market to marketB (no fee version).
      await setCurrentMarket(admin.accountId, marketB);
      const response = await supertest(server)
        .get(agentsUrl(marketB))
        .set(authorized(admin.token))
        .expect(200);
      const body = response.body as {
        capability: { state: string; activation_fee: string | null };
        items: unknown[];
      };
      expect(body.capability.state).toBe('AGENT_FEE_NOT_CONFIGURED');
      expect(body.capability.activation_fee).toBeNull();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      await setCurrentMarket(admin.accountId, marketA);
    });

    // ─── Orchestrated status operations ──────────────────────────────

    it('suspends an ACTIVE agent through the owner and appends the status log', async () => {
      const response = await supertest(server)
        .post(`${agentsUrl(marketA)}/${agentA}/suspend`)
        .set(authorized(admin.token))
        .send({ reason: 'Compliance review.' })
        .expect(200);
      expect((response.body as { status: string }).status).toBe('SUSPENDED');

      const logRows = await database.db
        .select()
        .from(agentActivationStatusLogs)
        .where(
          and(
            eq(agentActivationStatusLogs.activationId, agentA),
            eq(agentActivationStatusLogs.toStatus, 'SUSPENDED'),
          ),
        );
      expect(logRows.length).toBeGreaterThanOrEqual(1);
      expect(logRows[0]?.changedByType).toBe('ADMIN');
      expect(logRows[0]?.reason).toBe('Compliance review.');
    });

    it('rejects a second suspend with 409 (owner transition validation)', async () => {
      await supertest(server)
        .post(`${agentsUrl(marketA)}/${agentA}/suspend`)
        .set(authorized(admin.token))
        .send({ reason: 'Again.' })
        .expect(409);
    });

    it('rejects a missing reason with 400 (REASON_REQUIRED surface rule)', async () => {
      await supertest(server)
        .post(`${agentsUrl(marketA)}/${agentPending}/suspend`)
        .set(authorized(admin.token))
        .send({})
        .expect(400);
    });

    it('reactivates a SUSPENDED agent (owner increments reactivation count)', async () => {
      const response = await supertest(server)
        .post(`${agentsUrl(marketA)}/${agentA}/reactivate`)
        .set(authorized(admin.token))
        .expect(200);
      expect((response.body as { status: string }).status).toBe('ACTIVE');
      const rows = await database.db
        .select({ reactivationCount: agentActivations.reactivationCount })
        .from(agentActivations)
        .where(eq(agentActivations.id, agentA));
      expect(rows[0]?.reactivationCount).toBe(1);
    });

    it('deactivates an ACTIVE agent (terminal state) and records revocation', async () => {
      const response = await supertest(server)
        .post(`${agentsUrl(marketA)}/${agentA}/deactivate`)
        .set(authorized(admin.token))
        .send({ reason: 'Program ended.' })
        .expect(200);
      expect((response.body as { status: string }).status).toBe('DEACTIVATED');
      const rows = await database.db
        .select({
          status: agentActivations.status,
          revocationReason: agentActivations.revocationReason,
        })
        .from(agentActivations)
        .where(eq(agentActivations.id, agentA));
      expect(rows[0]?.status).toBe('DEACTIVATED');
      expect(rows[0]?.revocationReason).toBe('Program ended.');
    });
  },
);
