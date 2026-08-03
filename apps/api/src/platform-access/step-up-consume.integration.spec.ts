import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { migrate } from '@ipoint/database';
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
import { DatabaseService } from '../database/database.service.js';
import { AuthService } from '../auth/auth.service.js';
import { totpCode } from '../auth/admin-mfa.crypto.js';
import { AUTH_RATE_LIMITER } from '../auth/auth.constants.js';
import type { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { RbacService } from './rbac.service.js';

const databaseUrl = process.env['DATABASE_URL'];

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
      output.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

describe.skipIf(!databaseUrl)(
  'step-up grant end-to-end consumption (P7-S2C-STEPUP-FIX)',
  () => {
    let app: INestApplication;
    let server: Server;
    let database: DatabaseService;
    let auth: AuthService;
    let rbac: RbacService;
    const actorEmail = `${randomUUID()}@example.com`;
    const password = 'Stepup-Integration-Password-123!';
    let actorSecret: Buffer;
    let actorToken: string;
    let actorAdminUserId: string;
    let marketId: string;
    let rateLimiter: InMemoryRateLimiter;

    beforeAll(async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      vi.stubEnv(
        'AUTH_OTP_PEPPER',
        'stepup-consume-integration-pepper-at-least-32-chars',
      );
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('LOG_LEVEL', 'silent');
      vi.stubEnv('REDEMPTION_VOUCHER_ENCRYPTION_KEY', '11'.repeat(32));
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
      rbac = app.get(RbacService);
      rateLimiter = app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER);

      const registry = await database.pool.query<{ exists: boolean }>(
        `SELECT to_regclass('public.database_migrations') IS NOT NULL AS exists`,
      );
      const applied = registry.rows[0]?.exists
        ? await database.pool.query(
            `SELECT 1 FROM database_migrations
             WHERE filename = '0027_admin_mfa_session_policy.sql'`,
          )
        : null;
      if (applied?.rowCount !== 1) await migrate(database.pool);

      // Actor: active account + admin record + SUPER_ADMIN role with the
      // `admin.user.manage` permission granted through role_permissions
      // (the exact path RbacService.isAllowed resolves).
      const actorAccount = await database.pool.query<{ id: string }>(
        `INSERT INTO accounts (public_id, email, account_country, status)
         VALUES ($1,$2,'MY','ACTIVE') RETURNING id`,
        [`acct_${randomUUID()}`, actorEmail],
      );
      const actorAccountId = actorAccount.rows[0]!.id;
      await auth.setPassword(actorAccountId, password);
      const actorAdmin = await database.pool.query<{ id: string }>(
        `INSERT INTO admin_users (account_id, display_name, status)
         VALUES ($1,'Step-up Actor','ACTIVE') RETURNING id`,
        [actorAccountId],
      );
      actorAdminUserId = actorAdmin.rows[0]!.id;
      const role = await database.pool.query<{ id: string }>(
        `INSERT INTO roles (code, name, is_system)
         VALUES ('SUPER_ADMIN','Super Admin',true)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
      );
      await database.pool.query(
        `INSERT INTO role_assignments (admin_user_id, role_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [actorAdminUserId, role.rows[0]!.id],
      );
      const permission = await database.pool.query<{ id: string }>(
        `INSERT INTO permissions (code, description)
         VALUES ('admin.user.manage','Create and manage Admin user lifecycle.')
         ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
      );
      await database.pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [role.rows[0]!.id, permission.rows[0]!.id],
      );

      // Market row for market-binding assertions.
      const market = await database.pool.query<{ id: string }>(
        `INSERT INTO markets (code, name, currency_code, timezone, default_locale, status)
         VALUES ($1,$2,'MYR','Asia/Kuala_Lumpur','en-MY','ACTIVE') RETURNING id`,
        [
          `SU${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
          'Step-up Market',
        ],
      );
      marketId = market.rows[0]!.id;

      // Enroll MFA and log in through the real HTTP flow.
      const enrollment = await supertest(server)
        .post('/api/v1/auth/admin/mfa/enrollment/start')
        .send({ email: actorEmail, password })
        .expect(202);
      const uri = new URL(enrollment.body.otpauth_uri as string);
      actorSecret = decodeBase32(uri.searchParams.get('secret') ?? '');
      expect(actorSecret.length).toBeGreaterThan(0);
      await supertest(server)
        .post('/api/v1/auth/admin/mfa/enrollment/confirm')
        .send({
          challenge_id: enrollment.body.enrollment_challenge_id,
          code: totpCode(actorSecret, Math.floor(Date.now() / 30_000)),
        })
        .expect(200);
      // Enrollment confirm consumed the current TOTP step; clear the last
      // accepted counter so the login challenge below accepts a same-window
      // code (same approach as the P7-S2A HTTP integration spec).
      await database.pool.query(
        `UPDATE admin_mfa_factors SET last_accepted_counter = NULL
         WHERE admin_user_id = $1`,
        [actorAdminUserId],
      );
      const login = await supertest(server)
        .post('/api/v1/auth/admin/login')
        .send({ email: actorEmail, password })
        .expect(202);
      const authenticated = await supertest(server)
        .post('/api/v1/auth/admin/mfa/challenge')
        .send({
          challenge_id: login.body.mfa_challenge_id,
          code: totpCode(actorSecret, Math.floor(Date.now() / 30_000)),
        })
        .expect(200);
      actorToken = authenticated.body.accessToken as string;
      expect(actorToken).toBeTruthy();
      // The login challenge consumed the current TOTP step; clear the last
      // accepted counter so each step-up verification below is independent
      // of the 30-second window (same approach as the P7-S2A HTTP spec).
      await database.pool.query(
        `UPDATE admin_mfa_factors SET last_accepted_counter = NULL
         WHERE admin_user_id = $1`,
        [actorAdminUserId],
      );
    });

    afterAll(async () => {
      await app?.close();
      vi.unstubAllEnvs();
    });

    beforeEach(() => {
      // Each test mints one or two step-up grants; the MFA step-up rate
      // limit is 5 per 15 minutes per Admin/IP, so reset the in-memory
      // limiter between tests (single-instance test fixture only).
      rateLimiter.clear();
    });

    async function mintStepUpGrant(
      actionClass: string,
      options: { marketId?: string; target?: string } = {},
    ): Promise<string> {
      const challenge = await supertest(server)
        .post('/api/v1/auth/admin/mfa/step-up/challenge')
        .set('Authorization', `Bearer ${actorToken}`)
        .send({
          action_class: actionClass,
          ...(options.marketId ? { market_id: options.marketId } : {}),
          ...(options.target ? { target: options.target } : {}),
        })
        .expect(202);
      await database.pool.query(
        `UPDATE admin_mfa_factors SET last_accepted_counter = NULL
         WHERE admin_user_id = $1`,
        [actorAdminUserId],
      );
      const verified = await supertest(server)
        .post('/api/v1/auth/admin/mfa/step-up/verify')
        .set('Authorization', `Bearer ${actorToken}`)
        .send({
          challenge_id: challenge.body.step_up_challenge_id,
          code: totpCode(actorSecret, Math.floor(Date.now() / 30_000)),
        })
        .expect(200);
      return verified.body.step_up_token as string;
    }

    function grantHash(token: string): string {
      return createHash('sha256').update(token).digest('hex');
    }

    async function createTargetAccount(): Promise<string> {
      const target = await database.pool.query<{ id: string }>(
        `INSERT INTO accounts (public_id, email, account_country, status)
         VALUES ($1,$2,'MY','ACTIVE') RETURNING id`,
        [`acct_${randomUUID()}`, `${randomUUID()}-target@example.com`],
      );
      return target.rows[0]!.id;
    }

    async function currentSessionId(): Promise<string> {
      const rows = await database.pool.query<{ id: string }>(
        `SELECT id FROM sessions
         WHERE admin_user_id = $1 AND actor_purpose = 'ADMIN'
           AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [actorAdminUserId],
      );
      const sessionId = rows.rows[0]?.id;
      if (!sessionId) throw new Error('No active admin session found.');
      return sessionId;
    }

    it('consumes a real-flow grant for the same permission through the RbacGuard (no direct seeding)', async () => {
      const targetAccountId = await createTargetAccount();
      const grant = await mintStepUpGrant('admin.user.manage', {
        target: targetAccountId,
      });
      await supertest(server)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${actorToken}`)
        .set('idempotency-key', randomUUID())
        .set('x-step-up-token', grant)
        .send({
          account_id: targetAccountId,
          display_name: 'Created via step-up',
          reason: 'End-to-end step-up consumption test',
        })
        .expect(201);
      // The grant was consumed exactly once.
      const consumed = await database.pool.query<{ used_at: Date | null }>(
        `SELECT used_at FROM admin_step_up_grants WHERE grant_hash = $1`,
        [grantHash(grant)],
      );
      expect(consumed.rows[0]?.used_at).toBeInstanceOf(Date);
    });

    it('denies without a step-up token and after the grant is consumed (one-use)', async () => {
      const targetAccountId = await createTargetAccount();
      const grant = await mintStepUpGrant('admin.user.manage', {
        target: targetAccountId,
      });
      const body = {
        account_id: targetAccountId,
        display_name: 'One-use denial',
        reason: 'One-use and fail-closed step-up test',
      };
      await supertest(server)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${actorToken}`)
        .set('idempotency-key', randomUUID())
        .send(body)
        .expect(403);
      await supertest(server)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${actorToken}`)
        .set('idempotency-key', randomUUID())
        .set('x-step-up-token', grant)
        .send(body)
        .expect(201);
      // Second use of the same token is denied: the grant was consumed once.
      await supertest(server)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${actorToken}`)
        .set('idempotency-key', randomUUID())
        .set('x-step-up-token', grant)
        .send(body)
        .expect(403);
    });

    it('denies when the grant action class does not match the guarded permission', async () => {
      const targetAccountId = await createTargetAccount();
      const grant = await mintStepUpGrant('rbac.role.assign', {
        target: targetAccountId,
      });
      await supertest(server)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${actorToken}`)
        .set('idempotency-key', randomUUID())
        .set('x-step-up-token', grant)
        .send({
          account_id: targetAccountId,
          display_name: 'Wrong action class',
          reason: 'Fail-closed action-class mismatch test',
        })
        .expect(403);
    });

    it('accepts legacy UPPER_CASE and mixed-case action classes and still consumes the grant', async () => {
      for (const variant of ['ADMIN.USER.MANAGE', 'Admin.User.Manage']) {
        const targetAccountId = await createTargetAccount();
        const grant = await mintStepUpGrant(variant, {
          target: targetAccountId,
        });
        await supertest(server)
          .post('/api/v1/admin/users')
          .set('Authorization', `Bearer ${actorToken}`)
          .set('idempotency-key', randomUUID())
          .set('x-step-up-token', grant)
          .send({
            account_id: targetAccountId,
            display_name: 'Case variant',
            reason: 'Case normalization step-up test',
          })
          .expect(201);
      }
    });

    it('enforces expiry: an expired real-flow grant is never consumed', async () => {
      const targetAccountId = await createTargetAccount();
      const grant = await mintStepUpGrant('admin.user.manage', {
        target: targetAccountId,
      });
      await database.pool.query(
        `UPDATE admin_step_up_grants
         SET issued_at = now() - interval '20 minutes',
             expires_at = now() - interval '10 minutes'
         WHERE grant_hash = $1`,
        [grantHash(grant)],
      );
      await supertest(server)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${actorToken}`)
        .set('idempotency-key', randomUUID())
        .set('x-step-up-token', grant)
        .send({
          account_id: targetAccountId,
          display_name: 'Expired grant',
          reason: 'Expiry fail-closed step-up test',
        })
        .expect(403);
    });

    it('enforces session binding at the consumption boundary', async () => {
      const targetAccountId = await createTargetAccount();
      const grant = await mintStepUpGrant('admin.user.manage', {
        target: targetAccountId,
      });
      const consumedByOtherSession = await rbac.consumeStepUpGrant({
        token: grant,
        sessionId: randomUUID(),
        adminUserId: actorAdminUserId,
        permission: 'admin.user.manage',
        target: targetAccountId,
      });
      expect(consumedByOtherSession).toBe(false);
      // The grant is still intact for the owning session.
      const consumedByOwner = await rbac.consumeStepUpGrant({
        token: grant,
        sessionId: await currentSessionId(),
        adminUserId: actorAdminUserId,
        permission: 'admin.user.manage',
        target: targetAccountId,
      });
      expect(consumedByOwner).toBe(true);
    });

    it('enforces market binding at the consumption boundary', async () => {
      const targetAccountId = await createTargetAccount();
      const grant = await mintStepUpGrant('admin.user.manage', {
        marketId,
        target: targetAccountId,
      });
      const sessionId = await currentSessionId();
      const wrongMarket = await rbac.consumeStepUpGrant({
        token: grant,
        sessionId,
        adminUserId: actorAdminUserId,
        permission: 'admin.user.manage',
        marketId: '22222222-2222-4222-8222-222222222222',
        target: targetAccountId,
      });
      expect(wrongMarket).toBe(false);
      const rightMarket = await rbac.consumeStepUpGrant({
        token: grant,
        sessionId,
        adminUserId: actorAdminUserId,
        permission: 'admin.user.manage',
        marketId,
        target: targetAccountId,
      });
      expect(rightMarket).toBe(true);
    });
  },
);
