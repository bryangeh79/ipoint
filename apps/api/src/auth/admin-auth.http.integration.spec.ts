import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { migrate } from '@ipoint/database';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApplication } from '../app.setup.js';
import { DatabaseService } from '../database/database.service.js';
import { AuthService } from './auth.service.js';
import { encryptTotpSecret, totpCode } from './admin-mfa.crypto.js';
import { hashOpaqueToken } from './secret-tokens.js';
import { AUTH_RATE_LIMITER } from './auth.constants.js';
import type { InMemoryRateLimiter } from './rate-limit.port.js';

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

describe.skipIf(!databaseUrl)('Admin MFA and session HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let auth: AuthService;
  const email = `${randomUUID()}@example.com`;
  const password = 'Admin-Integration-Password-123!';
  let accountId: string;
  let adminUserId: string;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl ?? '');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv(
      'AUTH_OTP_PEPPER',
      'admin-auth-http-integration-pepper-at-least-32-characters',
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

    const account = await database.pool.query<{ id: string }>(
      `INSERT INTO accounts (public_id, email, account_country, status)
       VALUES ($1,$2,'MY','ACTIVE') RETURNING id`,
      [`acct_${randomUUID()}`, email],
    );
    accountId = account.rows[0]!.id;
    await auth.setPassword(accountId, password);
    const admin = await database.pool.query<{ id: string }>(
      `INSERT INTO admin_users (account_id, display_name, status)
       VALUES ($1,'P7-S2A Integration Admin','ACTIVE') RETURNING id`,
      [accountId],
    );
    adminUserId = admin.rows[0]!.id;
    const role = await database.pool.query<{ id: string }>(
      `INSERT INTO roles (code, name, is_system)
       VALUES ('SUPER_ADMIN','Super Admin',true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    await database.pool.query(
      `INSERT INTO role_assignments (admin_user_id, role_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [adminUserId, role.rows[0]!.id],
    );
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('covers enrollment, challenge, replay, recovery, sessions, revocation and lockout', async () => {
    const enrollment = await supertest(server)
      .post('/api/v1/auth/admin/mfa/enrollment/start')
      .send({ email, password })
      .expect(202)
      .expect('Cache-Control', 'no-store');
    expect(JSON.stringify(enrollment.body)).not.toContain(password);
    const uri = new URL(enrollment.body.otpauth_uri as string);
    const secretText = uri.searchParams.get('secret');
    expect(secretText).toBeTruthy();
    const secret = decodeBase32(secretText!);
    const currentCounter = Math.floor(Date.now() / 30_000);
    const enrollmentCode = totpCode(secret, currentCounter);

    const confirmation = await supertest(server)
      .post('/api/v1/auth/admin/mfa/enrollment/confirm')
      .send({
        challenge_id: enrollment.body.enrollment_challenge_id,
        code: enrollmentCode,
      })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const recoveryCodes = confirmation.body.recovery_codes as string[];
    expect(recoveryCodes).toHaveLength(10);

    const stored = await database.pool.query<{
      secret_ciphertext: string;
      code_hash: string;
    }>(
      `SELECT f.secret_ciphertext, rc.code_hash
       FROM admin_mfa_factors f
       JOIN admin_mfa_recovery_codes rc ON rc.factor_id = f.id
       WHERE f.admin_user_id = $1 LIMIT 1`,
      [adminUserId],
    );
    expect(stored.rows[0]!.secret_ciphertext).not.toContain(secretText!);
    expect(stored.rows[0]!.code_hash).not.toContain(recoveryCodes[0]!);

    await database.pool.query(
      `UPDATE admin_mfa_factors SET last_accepted_counter = NULL WHERE admin_user_id = $1`,
      [adminUserId],
    );
    const login = await supertest(server)
      .post('/api/v1/auth/admin/login')
      .send({ email, password })
      .expect(202);
    expect(login.body.code).toBe('MFA_REQUIRED');
    const authenticated = await supertest(server)
      .post('/api/v1/auth/admin/mfa/challenge')
      .send({
        challenge_id: login.body.mfa_challenge_id,
        code: totpCode(secret, Math.floor(Date.now() / 30_000)),
      })
      .expect(200);
    const accessToken = authenticated.body.accessToken as string;
    expect(accessToken).toBeTruthy();

    await supertest(server)
      .post('/api/v1/auth/admin/mfa/challenge')
      .send({
        challenge_id: login.body.mfa_challenge_id,
        code: totpCode(secret, Math.floor(Date.now() / 30_000)),
      })
      .expect(401);

    const sessions = await supertest(server)
      .get('/api/v1/admin/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-ipoint-user-activity', 'foreground')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(sessions.body.sessions).toHaveLength(1);
    expect(sessions.body.sessions[0]).toMatchObject({ current: true });
    expect(JSON.stringify(sessions.body)).not.toMatch(
      /tokenHash|access_token|refresh_token/iu,
    );

    const role = await database.pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'SUPER_ADMIN'`,
    );
    const permission = await database.pool.query<{ id: string }>(
      `INSERT INTO permissions (code, description)
       VALUES ('admin.mfa.reset','Reset an Admin MFA factor')
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
       RETURNING id`,
    );
    await database.pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [role.rows[0]!.id, permission.rows[0]!.id],
    );
    const recoveryAdmins: Array<{ accountId: string; adminUserId: string }> =
      [];
    for (const suffix of ['target', 'confirmer']) {
      const account = await database.pool.query<{ id: string }>(
        `INSERT INTO accounts (public_id, email, account_country, status)
         VALUES ($1,$2,'MY','ACTIVE') RETURNING id`,
        [`acct_${randomUUID()}`, `${randomUUID()}-${suffix}@example.com`],
      );
      const admin = await database.pool.query<{ id: string }>(
        `INSERT INTO admin_users (account_id, display_name, status)
         VALUES ($1,$2,'ACTIVE') RETURNING id`,
        [account.rows[0]!.id, `Recovery ${suffix}`],
      );
      await database.pool.query(
        `INSERT INTO role_assignments (admin_user_id, role_id) VALUES ($1,$2)`,
        [admin.rows[0]!.id, role.rows[0]!.id],
      );
      recoveryAdmins.push({
        accountId: account.rows[0]!.id,
        adminUserId: admin.rows[0]!.id,
      });
    }
    const target = recoveryAdmins[0]!;
    const confirmer = recoveryAdmins[1]!;
    const targetFactorId = randomUUID();
    const targetSecret = Buffer.from('target-factor-secret!', 'utf8');
    const targetEncrypted = encryptTotpSecret(
      targetSecret,
      'admin-auth-http-integration-pepper-at-least-32-characters',
      target.accountId,
      target.adminUserId,
      targetFactorId,
    );
    await database.pool.query(
      `INSERT INTO admin_mfa_factors
        (id, account_id, admin_user_id, secret_ciphertext, secret_nonce,
         secret_auth_tag, key_id, algorithm, status, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',now())`,
      [
        targetFactorId,
        target.accountId,
        target.adminUserId,
        targetEncrypted.ciphertext,
        targetEncrypted.nonce,
        targetEncrypted.authTag,
        targetEncrypted.keyId,
        targetEncrypted.algorithm,
      ],
    );
    const targetSession = await auth.createAdminSession(
      target.accountId,
      target.adminUserId,
      {},
    );
    await database.pool.query(
      `UPDATE admin_mfa_factors SET last_accepted_counter = NULL
       WHERE admin_user_id = $1`,
      [adminUserId],
    );
    app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER).clear();
    const stepUp = await supertest(server)
      .post('/api/v1/auth/admin/mfa/step-up/challenge')
      .set('Authorization', `Bearer ${accessToken}`)
      // P7-S2C-STEPUP-FIX: the step-up action class for the MFA-reset
      // purpose is now the canonical catalog permission code
      // `admin.mfa.reset` (legacy `ADMIN_MFA_RESET` is no longer a
      // consumable action class).
      .send({ action_class: 'admin.mfa.reset', target: target.adminUserId })
      .expect(202);
    const stepUpVerified = await supertest(server)
      .post('/api/v1/auth/admin/mfa/step-up/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        challenge_id: stepUp.body.step_up_challenge_id,
        code: totpCode(secret, Math.floor(Date.now() / 30_000)),
      })
      .expect(200);
    const assistedReset = await supertest(server)
      .post('/api/v1/auth/admin/mfa/reset')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        target_admin_user_id: target.adminUserId,
        confirming_admin_user_id: confirmer.adminUserId,
        reason: 'Verified lost authenticator recovery',
        case_reference: 'CASE-P7-S2A-001',
        step_up_token: stepUpVerified.body.step_up_token,
      })
      .expect(200);
    expect(assistedReset.body.revokedSessions).toBe(1);
    const resetEvidence = await database.pool.query<{
      status: string;
      revoked_at: Date | null;
    }>(
      `SELECT f.status, s.revoked_at FROM admin_mfa_factors f
       JOIN sessions s ON s.admin_user_id = f.admin_user_id
       WHERE f.id = $1 AND s.access_token_hash = $2`,
      [targetFactorId, hashOpaqueToken(targetSession.accessToken)],
    );
    expect(resetEvidence.rows[0]).toMatchObject({ status: 'REVOKED' });
    expect(resetEvidence.rows[0]?.revoked_at).toBeInstanceOf(Date);

    const recoveryChallenge = await supertest(server)
      .post('/api/v1/auth/admin/login')
      .send({ email, password })
      .expect(202);
    const recovered = await supertest(server)
      .post('/api/v1/auth/admin/mfa/recovery')
      .send({
        challenge_id: recoveryChallenge.body.mfa_challenge_id,
        recovery_code: recoveryCodes[0],
      })
      .expect(200);
    expect(recovered.body.accessToken).toBeTruthy();
    await supertest(server)
      .post('/api/v1/auth/admin/mfa/step-up/challenge')
      .set('Authorization', `Bearer ${recovered.body.accessToken as string}`)
      .send({ action_class: 'ADMIN.MFA.RESET', target: adminUserId })
      .expect(403);
    const usedRecoveryChallenge = await supertest(server)
      .post('/api/v1/auth/admin/login')
      .send({ email, password })
      .expect(202);
    await supertest(server)
      .post('/api/v1/auth/admin/mfa/recovery')
      .send({
        challenge_id: usedRecoveryChallenge.body.mfa_challenge_id,
        recovery_code: recoveryCodes[0],
      })
      .expect(401);

    const recoverySessionList = await supertest(server)
      .get('/api/v1/admin/sessions')
      .set('Authorization', `Bearer ${recovered.body.accessToken as string}`)
      .expect(200);
    const otherSession = (
      recoverySessionList.body.sessions as Array<{
        id: string;
        current: boolean;
        revokedAt: string | null;
      }>
    ).find((item) => !item.current && !item.revokedAt);
    expect(otherSession).toBeTruthy();
    await supertest(server)
      .delete(`/api/v1/admin/sessions/${otherSession!.id}`)
      .set('Authorization', `Bearer ${recovered.body.accessToken as string}`)
      .expect(204);
    await supertest(server)
      .get('/api/v1/admin/sessions/current')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    await supertest(server)
      .delete('/api/v1/admin/sessions')
      .set('Authorization', `Bearer ${recovered.body.accessToken as string}`)
      .expect(200);
    const revoked = await supertest(server)
      .get('/api/v1/admin/sessions/current')
      .set('Authorization', `Bearer ${recovered.body.accessToken as string}`)
      .expect(401);
    expect(JSON.stringify(revoked.body)).toContain('SESSION_REVOKED');

    await database.pool.query(
      `UPDATE admin_mfa_factors
       SET failed_attempts = 0, failed_window_started_at = NULL,
           locked_until = NULL, last_accepted_counter = NULL
       WHERE admin_user_id = $1`,
      [adminUserId],
    );
    app.get<InMemoryRateLimiter>(AUTH_RATE_LIMITER).clear();
    const lockedChallenge = await supertest(server)
      .post('/api/v1/auth/admin/login')
      .send({ email, password })
      .expect(202);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await supertest(server)
        .post('/api/v1/auth/admin/mfa/challenge')
        .send({
          challenge_id: lockedChallenge.body.mfa_challenge_id,
          code: '000000',
        })
        .expect(401);
    }
    await supertest(server)
      .post('/api/v1/auth/admin/login')
      .send({ email, password })
      .expect(429);
    const lock = await database.pool.query<{ locked_until: Date | null }>(
      `SELECT locked_until FROM admin_mfa_factors
       WHERE admin_user_id = $1 AND status = 'ACTIVE'`,
      [adminUserId],
    );
    expect(lock.rows[0]?.locked_until).toBeInstanceOf(Date);
  });

  it('enforces real PostgreSQL session boundaries, reuse, password reset and suspension revocation', async () => {
    await database.pool.query(
      `UPDATE admin_users SET status = 'ACTIVE', archived_at = NULL WHERE id = $1`,
      [adminUserId],
    );

    const idle = await auth.createAdminSession(accountId, adminUserId, {});
    await database.pool.query(
      `UPDATE sessions SET idle_expires_at = now() - interval '1 second'
       WHERE access_token_hash = $1`,
      [hashOpaqueToken(idle.accessToken)],
    );
    const idleExpired = await supertest(server)
      .get('/api/v1/admin/sessions/current')
      .set('Authorization', `Bearer ${idle.accessToken}`)
      .expect(401);
    expect(JSON.stringify(idleExpired.body)).toContain('SESSION_IDLE_EXPIRED');

    const absolute = await auth.createAdminSession(accountId, adminUserId, {});
    await database.pool.query(
      `UPDATE sessions
       SET idle_expires_at = now() - interval '1 second',
           absolute_expires_at = now() - interval '1 second'
       WHERE access_token_hash = $1`,
      [hashOpaqueToken(absolute.accessToken)],
    );
    const absoluteExpired = await supertest(server)
      .get('/api/v1/admin/sessions/current')
      .set('Authorization', `Bearer ${absolute.accessToken}`)
      .expect(401);
    expect(JSON.stringify(absoluteExpired.body)).toContain(
      'SESSION_ABSOLUTE_EXPIRED',
    );

    const family = await auth.createAdminSession(accountId, adminUserId, {});
    const rotated = await supertest(server)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: family.refreshToken })
      .expect(200);
    const reuse = await supertest(server)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: family.refreshToken })
      .expect(401);
    expect(JSON.stringify(reuse.body)).toContain('SESSION_REUSE_DETECTED');
    const familyRevoked = await supertest(server)
      .get('/api/v1/admin/sessions/current')
      .set('Authorization', `Bearer ${rotated.body.accessToken as string}`)
      .expect(401);
    expect(JSON.stringify(familyRevoked.body)).toContain('SESSION_REVOKED');

    const passwordResetSession = await auth.createAdminSession(
      accountId,
      adminUserId,
      {},
    );
    const resetOtp = await auth.issuePasswordResetOtp(email);
    await auth.verifyOtp(resetOtp.id, resetOtp.code);
    await auth.resetPasswordFromOtp(
      resetOtp.id,
      'Admin-Integration-Replacement-456!',
    );
    const resetRevoked = await supertest(server)
      .get('/api/v1/admin/sessions/current')
      .set('Authorization', `Bearer ${passwordResetSession.accessToken}`)
      .expect(401);
    expect(JSON.stringify(resetRevoked.body)).toContain('SESSION_REVOKED');

    const suspensionSession = await auth.createAdminSession(
      accountId,
      adminUserId,
      {},
    );
    const siblingSession = await auth.createAdminSession(
      accountId,
      adminUserId,
      {},
    );
    await database.pool.query(
      `UPDATE admin_users SET status = 'SUSPENDED' WHERE id = $1`,
      [adminUserId],
    );
    const suspended = await supertest(server)
      .get('/api/v1/admin/sessions/current')
      .set('Authorization', `Bearer ${suspensionSession.accessToken}`)
      .expect(401);
    expect(JSON.stringify(suspended.body)).toContain('ADMIN_ACCESS_REMOVED');
    const sibling = await database.pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM sessions WHERE access_token_hash = $1`,
      [hashOpaqueToken(siblingSession.accessToken)],
    );
    expect(sibling.rows[0]?.revoked_at).toBeInstanceOf(Date);
  });
});
