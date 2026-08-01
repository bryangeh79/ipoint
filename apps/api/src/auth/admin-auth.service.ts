import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import {
  AUTH_RATE_LIMITER,
  AUTH_SETTINGS,
  AUTH_STORE,
} from './auth.constants.js';
import {
  decryptTotpSecret,
  encodeBase32,
  encryptTotpSecret,
  generateRecoveryCode,
  generateTotpSecret,
  normalizeRecoveryCode,
  verifyTotp,
} from './admin-mfa.crypto.js';
import { AuthError } from './auth.errors.js';
import { AuthService, type AuthSettings } from './auth.service.js';
import type { AuthStorePort } from './auth-store.port.js';
import type {
  AdminSessionSummary,
  AuthTokens,
  RequestActor,
  RequestMetadata,
} from './auth.types.js';
import { PasswordHasher } from './password-hasher.js';
import type { RateLimitPort } from './rate-limit.port.js';
import { createOpaqueToken, hashOpaqueToken } from './secret-tokens.js';

const controlledRoles = [
  'SUPER_ADMIN',
  'OPERATIONS_ADMIN',
  'FINANCE_OPERATOR',
  'FINANCE_APPROVER',
  'KYC_REVIEWER',
  'SUPPORT_READONLY_AUDITOR',
] as const;

interface EligibleAdmin {
  accountId: string;
  adminUserId: string;
  email: string;
  adminStatus?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  adminArchivedAt?: Date | null;
  hasActiveRole?: boolean;
}

interface ChallengeFactorRow {
  challengeId: string;
  accountId: string;
  adminUserId: string;
  factorId: string;
  purpose: 'ENROLLMENT' | 'LOGIN' | 'RECOVERY' | 'STEP_UP';
  status: 'PENDING' | 'CONSUMED' | 'EXHAUSTED' | 'EXPIRED';
  attempts: number;
  maxAttempts: number;
  expiresAt: Date;
  sessionId: string | null;
  requestContext: Record<string, unknown>;
  ciphertext: string;
  nonce: string;
  authTag: string;
  factorStatus: 'UNVERIFIED' | 'ACTIVE' | 'DISABLED' | 'REVOKED';
  lastAcceptedCounter: string | null;
  failedAttempts: number;
  failedWindowStartedAt: Date | null;
  lockedUntil: Date | null;
}

@Injectable()
export class AdminAuthService {
  private readonly passwordHasher = new PasswordHasher();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AUTH_STORE) private readonly store: AuthStorePort,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimitPort,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  async startEnrollment(
    email: string,
    password: string,
    metadata: RequestMetadata = {},
  ): Promise<{
    enrollmentChallenge: string;
    otpauthUri: string;
    expiresAt: Date;
  }> {
    const admin = await this.authenticateEligibleAdmin(
      email,
      password,
      metadata,
    );
    await this.enforceMfaRateLimit('enroll', admin.adminUserId, metadata);
    const existingActive = await this.database.pool.query(
      `SELECT 1 FROM admin_mfa_factors
       WHERE admin_user_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [admin.adminUserId],
    );
    if (existingActive.rowCount === 1) {
      throw new AuthError(
        'MFA_REQUIRED',
        'An active factor already exists; use authenticated factor rotation.',
      );
    }
    const factorId = randomUUID();
    const secret = generateTotpSecret();
    const encodedSecret = encodeBase32(secret);
    const encrypted = encryptTotpSecret(
      secret,
      this.settings.otpPepper,
      admin.accountId,
      admin.adminUserId,
      factorId,
    );
    const challenge = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE admin_mfa_factors
         SET status = 'REVOKED', revoked_at = now(), version = version + 1
         WHERE admin_user_id = $1 AND status = 'UNVERIFIED'`,
        [admin.adminUserId],
      );
      await client.query(
        `INSERT INTO admin_mfa_factors
          (id, account_id, admin_user_id, secret_ciphertext, secret_nonce,
           secret_auth_tag, key_id, algorithm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          factorId,
          admin.accountId,
          admin.adminUserId,
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.authTag,
          encrypted.keyId,
          encrypted.algorithm,
        ],
      );
      await this.insertChallenge(client, {
        token: challenge,
        accountId: admin.accountId,
        adminUserId: admin.adminUserId,
        factorId,
        purpose: 'ENROLLMENT',
        expiresAt,
        metadata,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      secret.fill(0);
    }
    await this.securityEvent(
      admin.accountId,
      'ADMIN_MFA_ENROLLMENT_CREATED',
      'SUCCESS',
      metadata,
    );
    const label = encodeURIComponent(`iPoint Admin:${admin.email}`);
    return {
      enrollmentChallenge: challenge,
      otpauthUri: `otpauth://totp/${label}?secret=${encodedSecret}&issuer=${encodeURIComponent('iPoint Admin')}&algorithm=SHA1&digits=6&period=30`,
      expiresAt,
    };
  }

  async confirmEnrollment(
    challenge: string,
    code: string,
    metadata: RequestMetadata = {},
  ): Promise<{ recoveryCodes: string[] }> {
    const verified = await this.verifyChallenge(
      challenge,
      code,
      'ENROLLMENT',
      metadata,
    );
    const recoveryCodes = Array.from({ length: 10 }, () =>
      generateRecoveryCode(),
    );
    const hashes = await Promise.all(
      recoveryCodes.map((value) =>
        this.passwordHasher.hash(normalizeRecoveryCode(value)),
      ),
    );
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const activated = await client.query(
        `UPDATE admin_mfa_factors
         SET status = 'ACTIVE', confirmed_at = now(), version = version + 1
         WHERE id = $1 AND status = 'UNVERIFIED'`,
        [verified.factorId],
      );
      if (activated.rowCount !== 1) {
        throw new AuthError(
          'MFA_CHALLENGE_FAILED',
          'The enrollment confirmation was not accepted.',
        );
      }
      for (const hash of hashes) {
        await client.query(
          `INSERT INTO admin_mfa_recovery_codes (factor_id, code_hash)
           VALUES ($1, $2)`,
          [verified.factorId, hash],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await this.securityEvent(
      verified.accountId,
      'ADMIN_MFA_ENROLLMENT_CONFIRMED',
      'SUCCESS',
      metadata,
    );
    return { recoveryCodes };
  }

  async beginLogin(
    email: string,
    password: string,
    metadata: RequestMetadata = {},
  ): Promise<{ mfaChallenge: string; expiresAt: Date }> {
    const admin = await this.authenticateEligibleAdmin(
      email,
      password,
      metadata,
    );
    await this.enforceMfaRateLimit('login', admin.adminUserId, metadata);
    const factor = await this.database.pool.query<{
      id: string;
      status: string;
      locked_until: Date | null;
    }>(
      `SELECT id, status, locked_until FROM admin_mfa_factors
       WHERE admin_user_id = $1 AND status = 'ACTIVE'
       ORDER BY confirmed_at DESC LIMIT 1`,
      [admin.adminUserId],
    );
    const active = factor.rows[0];
    if (!active) {
      throw new AuthError(
        'MFA_ENROLLMENT_REQUIRED',
        'Set up multi-factor authentication to continue.',
      );
    }
    if (active.locked_until && active.locked_until > new Date()) {
      throw new AuthError(
        'AUTH_RATE_LIMITED',
        'MFA verification is temporarily locked.',
      );
    }
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.database.pool.query(
      `INSERT INTO admin_mfa_challenges
        (challenge_hash, account_id, admin_user_id, factor_id, purpose,
         expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,'LOGIN',$5,$6,$7)`,
      [
        hashOpaqueToken(token),
        admin.accountId,
        admin.adminUserId,
        active.id,
        expiresAt,
        metadata.ipAddress ?? null,
        metadata.userAgent ?? null,
      ],
    );
    await this.securityEvent(
      admin.accountId,
      'ADMIN_MFA_LOGIN_CHALLENGE_ISSUED',
      'SUCCESS',
      metadata,
    );
    return { mfaChallenge: token, expiresAt };
  }

  async completeLogin(
    challenge: string,
    code: string,
    metadata: RequestMetadata = {},
  ): Promise<AuthTokens> {
    const verified = await this.verifyChallenge(
      challenge,
      code,
      'LOGIN',
      metadata,
    );
    const tokens = await this.auth.createAdminSession(
      verified.accountId,
      verified.adminUserId,
      metadata,
    );
    await this.securityEvent(
      verified.accountId,
      'ADMIN_MFA_LOGIN_SUCCEEDED',
      'SUCCESS',
      metadata,
    );
    return tokens;
  }

  async recoverLogin(
    challenge: string,
    recoveryCode: string,
    metadata: RequestMetadata = {},
  ): Promise<AuthTokens> {
    const row = await this.getChallenge(challenge, 'LOGIN');
    await this.enforceMfaRateLimit('recovery', row.adminUserId, metadata);
    this.assertChallengeUsable(row, new Date());
    const codes = await this.database.pool.query<{
      id: string;
      code_hash: string;
    }>(
      `SELECT id, code_hash FROM admin_mfa_recovery_codes
       WHERE factor_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [row.factorId],
    );
    const normalized = normalizeRecoveryCode(recoveryCode);
    let matched: string | null = null;
    for (const candidate of codes.rows) {
      if (await this.passwordHasher.verify(normalized, candidate.code_hash)) {
        matched = candidate.id;
        break;
      }
    }
    if (!matched) {
      await this.recordChallengeFailure(row, metadata, 'RECOVERY');
      throw new AuthError(
        'MFA_RECOVERY_INVALID',
        'The recovery code was not accepted.',
      );
    }
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const consumedCode = await client.query(
        `UPDATE admin_mfa_recovery_codes SET consumed_at = $2
         WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [matched, new Date()],
      );
      const consumedChallenge = await client.query(
        `UPDATE admin_mfa_challenges SET status = 'CONSUMED', consumed_at = $2, version = version + 1
         WHERE id = $1 AND status = 'PENDING'`,
        [row.challengeId, new Date()],
      );
      if (consumedCode.rowCount !== 1 || consumedChallenge.rowCount !== 1) {
        throw new AuthError(
          'MFA_RECOVERY_INVALID',
          'The recovery code was not accepted.',
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const tokens = await this.auth.createAdminSession(
      row.accountId,
      row.adminUserId,
      metadata,
      true,
    );
    await this.securityEvent(
      row.accountId,
      'ADMIN_MFA_RECOVERY_CONSUMED',
      'SUCCESS',
      metadata,
    );
    return tokens;
  }

  async beginStepUp(
    actor: RequestActor,
    input: { actionClass: string; marketId?: string; target?: string },
    metadata: RequestMetadata = {},
  ): Promise<{ stepUpChallenge: string; expiresAt: Date }> {
    const adminUserId = this.requireAdminActor(actor);
    if (actor.mfaRecoveryUsed) {
      throw new AuthError(
        'MFA_ENROLLMENT_REQUIRED',
        'Re-enroll multi-factor authentication before sensitive actions.',
      );
    }
    await this.enforceMfaRateLimit('step-up', adminUserId, metadata);
    const factor = await this.activeFactor(adminUserId);
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const requestContext = {
      actionClass: input.actionClass,
      marketId: input.marketId ?? null,
      targetHash: input.target ? hashOpaqueToken(input.target) : null,
    };
    await this.database.pool.query(
      `INSERT INTO admin_mfa_challenges
        (challenge_hash, account_id, admin_user_id, factor_id, session_id,
         purpose, request_hash, request_context, expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,'STEP_UP',$6,$7,$8,$9,$10)`,
      [
        hashOpaqueToken(token),
        actor.accountId,
        adminUserId,
        factor.id,
        actor.sessionId,
        hashOpaqueToken(JSON.stringify(requestContext)),
        JSON.stringify(requestContext),
        expiresAt,
        metadata.ipAddress ?? null,
        metadata.userAgent ?? null,
      ],
    );
    await this.securityEvent(
      actor.accountId,
      'ADMIN_MFA_STEP_UP_ISSUED',
      'SUCCESS',
      metadata,
      { actionClass: input.actionClass },
    );
    return { stepUpChallenge: token, expiresAt };
  }

  async verifyStepUp(
    actor: RequestActor,
    challenge: string,
    code: string,
    metadata: RequestMetadata = {},
  ): Promise<{ stepUpToken: string; expiresAt: Date }> {
    const adminUserId = this.requireAdminActor(actor);
    const verified = await this.verifyChallenge(
      challenge,
      code,
      'STEP_UP',
      metadata,
    );
    if (
      verified.adminUserId !== adminUserId ||
      verified.sessionId !== actor.sessionId
    ) {
      throw new AuthError(
        'MFA_CHALLENGE_FAILED',
        'The step-up challenge was not accepted.',
      );
    }
    const context = verified.requestContext;
    const token = createOpaqueToken();
    const session = await this.database.pool.query<{
      absolute_expires_at: Date;
    }>(
      `SELECT absolute_expires_at FROM sessions WHERE id = $1 AND revoked_at IS NULL`,
      [actor.sessionId],
    );
    const absolute = session.rows[0]?.absolute_expires_at;
    if (!absolute)
      throw new AuthError('SESSION_REVOKED', 'The session has been revoked.');
    const expiresAt = new Date(
      Math.min(Date.now() + 10 * 60 * 1000, absolute.getTime()),
    );
    await this.database.pool.query(
      `INSERT INTO admin_step_up_grants
        (grant_hash, session_id, admin_user_id, factor_id, action_class,
         market_id, target_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        hashOpaqueToken(token),
        actor.sessionId,
        adminUserId,
        verified.factorId,
        String(context['actionClass']),
        context['marketId'] ?? null,
        context['targetHash'] ?? null,
        expiresAt,
      ],
    );
    await this.securityEvent(
      actor.accountId,
      'ADMIN_MFA_STEP_UP_VERIFIED',
      'SUCCESS',
      metadata,
      { actionClass: context['actionClass'] },
    );
    return { stepUpToken: token, expiresAt };
  }

  async listSessions(actor: RequestActor): Promise<AdminSessionSummary[]> {
    const adminUserId = this.requireAdminActor(actor);
    const result = await this.database.pool.query<{
      id: string;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
      last_seen_at: Date;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      family_max_expires_at: Date;
      revoked_at: Date | null;
      revoke_reason: string | null;
    }>(
      `SELECT id, ip_address, user_agent, created_at, last_seen_at,
              idle_expires_at, absolute_expires_at, family_max_expires_at,
              revoked_at, revoke_reason
       FROM sessions WHERE admin_user_id = $1 AND actor_purpose = 'ADMIN'
       ORDER BY created_at DESC LIMIT 100`,
      [adminUserId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      deviceLabel: this.deviceLabel(row.user_agent),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastActivityAt: row.last_seen_at,
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      familyMaxExpiresAt: row.family_max_expires_at,
      current: row.id === actor.sessionId,
      revokedAt: row.revoked_at,
      revokeReason: row.revoke_reason,
    }));
  }

  async revokeSession(actor: RequestActor, sessionId: string): Promise<void> {
    const adminUserId = this.requireAdminActor(actor);
    const result = await this.database.pool.query(
      `UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()),
         revoke_reason = COALESCE(revoke_reason, 'ADMIN_SELF_REVOKE')
       WHERE id = $1 AND admin_user_id = $2 AND actor_purpose = 'ADMIN'`,
      [sessionId, adminUserId],
    );
    if (result.rowCount !== 1)
      throw new AuthError('SESSION_NOT_FOUND', 'Session not found.');
  }

  async revokeAllSessions(
    actor: RequestActor,
  ): Promise<{ revokedCount: number }> {
    const adminUserId = this.requireAdminActor(actor);
    return this.revokeAdminSessions(adminUserId, 'ADMIN_SELF_REVOKE_ALL');
  }

  async revokeAdminSessions(
    adminUserId: string,
    reason: string,
  ): Promise<{ revokedCount: number }> {
    const revokedCount = await this.store.revokeAdminSessions(
      adminUserId,
      reason,
      new Date(),
    );
    return { revokedCount };
  }

  async assistedReset(
    actor: RequestActor,
    input: {
      targetAdminUserId: string;
      confirmingAdminUserId: string;
      reason: string;
      caseReference: string;
      stepUpToken: string;
    },
    metadata: RequestMetadata = {},
  ): Promise<{ revokedSessions: number }> {
    const helperId = this.requireAdminActor(actor);
    if (
      helperId === input.targetAdminUserId ||
      helperId === input.confirmingAdminUserId ||
      input.targetAdminUserId === input.confirmingAdminUserId
    ) {
      throw new AuthError(
        'MFA_FACTOR_DISABLED',
        'Assisted recovery requires distinct identities.',
      );
    }
    if (
      !(await this.hasSuperAdminRecoveryPermission(helperId)) ||
      !(await this.hasSuperAdminRecoveryPermission(input.confirmingAdminUserId))
    ) {
      throw new AuthError(
        'MFA_FACTOR_DISABLED',
        'Admin-assisted recovery is not permitted.',
      );
    }
    await this.consumeStepUpGrant(
      actor,
      input.stepUpToken,
      'ADMIN_MFA_RESET',
      input.targetAdminUserId,
    );
    const client = await this.database.pool.connect();
    let revokedSessions = 0;
    try {
      await client.query('BEGIN');
      const factors = await client.query<{ id: string }>(
        `UPDATE admin_mfa_factors SET status = 'REVOKED', revoked_at = now(), version = version + 1
         WHERE admin_user_id = $1 AND status IN ('ACTIVE','DISABLED') RETURNING id`,
        [input.targetAdminUserId],
      );
      if (factors.rows.length > 0) {
        await client.query(
          `UPDATE admin_mfa_recovery_codes SET revoked_at = now()
           WHERE factor_id = ANY($1::uuid[]) AND consumed_at IS NULL AND revoked_at IS NULL`,
          [factors.rows.map((row) => row.id)],
        );
      }
      const sessions = await client.query(
        `UPDATE sessions SET revoked_at = now(), revoke_reason = 'MFA_RESET'
         WHERE admin_user_id = $1 AND actor_purpose = 'ADMIN' AND revoked_at IS NULL`,
        [input.targetAdminUserId],
      );
      revokedSessions = sessions.rowCount ?? 0;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await this.securityEvent(
      actor.accountId,
      'ADMIN_MFA_ASSISTED_RESET',
      'SUCCESS',
      metadata,
      {
        helperAdminUserId: helperId,
        confirmingAdminUserId: input.confirmingAdminUserId,
        targetAdminUserId: input.targetAdminUserId,
        reason: input.reason,
        caseReference: input.caseReference,
      },
    );
    return { revokedSessions };
  }

  private async authenticateEligibleAdmin(
    email: string,
    password: string,
    metadata: RequestMetadata,
  ): Promise<EligibleAdmin> {
    const normalizedEmail = email.trim().toLowerCase();
    const identity = await this.store.findPasswordIdentity(normalizedEmail);
    const valid = identity
      ? await this.passwordHasher.verify(password, identity.secretHash)
      : false;
    if (!identity || !valid) {
      await this.securityEvent(
        undefined,
        'ADMIN_AUTH_PASSWORD_FAILED',
        'FAILURE',
        metadata,
        { identifierHash: hashOpaqueToken(normalizedEmail) },
      );
      throw new AuthError(
        'AUTH_INVALID_CREDENTIALS',
        'The supplied credentials are invalid.',
      );
    }
    if (identity.status !== 'ACTIVE') {
      throw new AuthError(
        'AUTH_ACCOUNT_INACTIVE',
        'The account is not active.',
      );
    }
    const eligible = await this.database.pool.query<EligibleAdmin>(
      `SELECT a.id AS "accountId", au.id AS "adminUserId", a.email,
              au.status AS "adminStatus", au.archived_at AS "adminArchivedAt",
              EXISTS (
                SELECT 1 FROM role_assignments ra
                JOIN roles r ON r.id = ra.role_id AND r.archived_at IS NULL
                WHERE ra.admin_user_id = au.id AND ra.revoked_at IS NULL
                  AND r.code = ANY($2::text[])
              ) AS "hasActiveRole"
       FROM accounts a JOIN admin_users au ON au.account_id = a.id
       WHERE a.id = $1`,
      [identity.accountId, controlledRoles],
    );
    const admin = eligible.rows[0];
    if (
      !admin ||
      admin.adminStatus !== 'ACTIVE' ||
      admin.adminArchivedAt ||
      !admin.hasActiveRole
    ) {
      if (admin) {
        await this.store.revokeAdminSessions(
          admin.adminUserId,
          'ADMIN_ACCESS_REMOVED',
          new Date(),
        );
      }
      throw new AuthError(
        'ADMIN_ACCESS_REMOVED',
        'Admin access is unavailable.',
      );
    }
    return admin;
  }

  private async activeFactor(adminUserId: string): Promise<{ id: string }> {
    const result = await this.database.pool.query<{
      id: string;
      locked_until: Date | null;
    }>(
      `SELECT id, locked_until FROM admin_mfa_factors
       WHERE admin_user_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [adminUserId],
    );
    const factor = result.rows[0];
    if (!factor)
      throw new AuthError(
        'MFA_ENROLLMENT_REQUIRED',
        'Set up multi-factor authentication to continue.',
      );
    if (factor.locked_until && factor.locked_until > new Date())
      throw new AuthError(
        'AUTH_RATE_LIMITED',
        'MFA verification is temporarily locked.',
      );
    return factor;
  }

  private async getChallenge(
    token: string,
    purpose: ChallengeFactorRow['purpose'],
    client?: PoolClient,
  ): Promise<ChallengeFactorRow> {
    const executor = client ?? this.database.pool;
    const result = await executor.query<ChallengeFactorRow>(
      `SELECT c.id AS "challengeId", c.account_id AS "accountId",
              c.admin_user_id AS "adminUserId", c.factor_id AS "factorId",
              c.purpose, c.status, c.attempts, c.max_attempts AS "maxAttempts",
              c.expires_at AS "expiresAt", c.session_id AS "sessionId",
              c.request_context AS "requestContext",
              f.secret_ciphertext AS ciphertext, f.secret_nonce AS nonce,
              f.secret_auth_tag AS "authTag", f.status AS "factorStatus",
              f.last_accepted_counter AS "lastAcceptedCounter",
              f.failed_attempts AS "failedAttempts",
              f.failed_window_started_at AS "failedWindowStartedAt",
              f.locked_until AS "lockedUntil"
       FROM admin_mfa_challenges c
       JOIN admin_mfa_factors f ON f.id = c.factor_id
       WHERE c.challenge_hash = $1 AND c.purpose = $2
       ${client ? 'FOR UPDATE OF c, f' : ''}`,
      [hashOpaqueToken(token), purpose],
    );
    const row = result.rows[0];
    if (!row)
      throw new AuthError(
        'MFA_CHALLENGE_FAILED',
        'The verification code was not accepted.',
      );
    return row;
  }

  private assertChallengeUsable(row: ChallengeFactorRow, now: Date): void {
    if (
      row.status !== 'PENDING' ||
      row.expiresAt <= now ||
      row.attempts >= row.maxAttempts
    ) {
      throw new AuthError(
        'MFA_CHALLENGE_FAILED',
        'The verification code was not accepted.',
      );
    }
    if (row.lockedUntil && row.lockedUntil > now) {
      throw new AuthError(
        'AUTH_RATE_LIMITED',
        'MFA verification is temporarily locked.',
      );
    }
    const requiredStatus =
      row.purpose === 'ENROLLMENT' ? 'UNVERIFIED' : 'ACTIVE';
    if (row.factorStatus !== requiredStatus) {
      throw new AuthError(
        'MFA_FACTOR_DISABLED',
        'The multi-factor method is unavailable.',
      );
    }
  }

  private async verifyChallenge(
    token: string,
    code: string,
    purpose: ChallengeFactorRow['purpose'],
    metadata: RequestMetadata,
  ): Promise<ChallengeFactorRow> {
    const client = await this.database.pool.connect();
    let row: ChallengeFactorRow;
    let committed = false;
    try {
      await client.query('BEGIN');
      row = await this.getChallenge(token, purpose, client);
      const now = new Date();
      this.assertChallengeUsable(row, now);
      const secret = decryptTotpSecret(
        { ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.authTag },
        this.settings.otpPepper,
        row.accountId,
        row.adminUserId,
        row.factorId,
      );
      const counter = verifyTotp(
        secret,
        code,
        now,
        row.lastAcceptedCounter === null
          ? null
          : Number(row.lastAcceptedCounter),
      );
      secret.fill(0);
      if (counter === null) {
        await this.recordChallengeFailure(row, metadata, 'TOTP', client);
        await client.query('COMMIT');
        committed = true;
        throw new AuthError(
          'MFA_CHALLENGE_FAILED',
          'The verification code was not accepted.',
        );
      }
      const factor = await client.query(
        `UPDATE admin_mfa_factors
         SET last_accepted_counter = $2, failed_attempts = 0,
             failed_window_started_at = NULL, locked_until = NULL,
             version = version + 1
         WHERE id = $1 AND (last_accepted_counter IS NULL OR last_accepted_counter < $2)`,
        [row.factorId, counter],
      );
      const challenge = await client.query(
        `UPDATE admin_mfa_challenges
         SET status = 'CONSUMED', consumed_at = $2, version = version + 1
         WHERE id = $1 AND status = 'PENDING'`,
        [row.challengeId, now],
      );
      if (factor.rowCount !== 1 || challenge.rowCount !== 1) {
        throw new AuthError(
          'MFA_CHALLENGE_FAILED',
          'The verification code was not accepted.',
        );
      }
      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
    await this.securityEvent(
      row.accountId,
      `ADMIN_MFA_${purpose}_SUCCEEDED`,
      'SUCCESS',
      metadata,
    );
    return row;
  }

  private async recordChallengeFailure(
    row: ChallengeFactorRow,
    metadata: RequestMetadata,
    method: 'TOTP' | 'RECOVERY',
    existingClient?: PoolClient,
  ): Promise<void> {
    const client = existingClient ?? (await this.database.pool.connect());
    const ownsClient = !existingClient;
    const now = new Date();
    const withinWindow =
      row.failedWindowStartedAt &&
      now.getTime() - row.failedWindowStartedAt.getTime() < 15 * 60 * 1000;
    const failedAttempts = withinWindow ? row.failedAttempts + 1 : 1;
    try {
      if (ownsClient) await client.query('BEGIN');
      await client.query(
        `UPDATE admin_mfa_challenges
         SET attempts = LEAST(attempts + 1, max_attempts),
             status = CASE WHEN attempts + 1 >= max_attempts THEN 'EXHAUSTED' ELSE status END,
             version = version + 1 WHERE id = $1 AND status = 'PENDING'`,
        [row.challengeId],
      );
      await client.query(
        `UPDATE admin_mfa_factors
         SET failed_attempts = $2,
             failed_window_started_at = $3,
             locked_until = CASE WHEN $2 >= 5 THEN $3 + interval '15 minutes' ELSE NULL END,
             version = version + 1 WHERE id = $1`,
        [
          row.factorId,
          failedAttempts,
          withinWindow ? row.failedWindowStartedAt : now,
        ],
      );
      if (ownsClient) await client.query('COMMIT');
    } catch (error) {
      if (ownsClient) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (ownsClient) client.release();
    }
    await this.securityEvent(
      row.accountId,
      'ADMIN_MFA_CHALLENGE_FAILED',
      'FAILURE',
      metadata,
      { method, attempts: row.attempts + 1 },
    );
  }

  private async insertChallenge(
    client: PoolClient,
    input: {
      token: string;
      accountId: string;
      adminUserId: string;
      factorId: string;
      purpose: ChallengeFactorRow['purpose'];
      expiresAt: Date;
      metadata: RequestMetadata;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO admin_mfa_challenges
        (challenge_hash, account_id, admin_user_id, factor_id, purpose,
         expires_at, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        hashOpaqueToken(input.token),
        input.accountId,
        input.adminUserId,
        input.factorId,
        input.purpose,
        input.expiresAt,
        input.metadata.ipAddress ?? null,
        input.metadata.userAgent ?? null,
      ],
    );
  }

  private async consumeStepUpGrant(
    actor: RequestActor,
    token: string,
    actionClass: string,
    target: string,
  ): Promise<void> {
    const result = await this.database.pool.query(
      `UPDATE admin_step_up_grants SET used_at = now(), version = version + 1
       WHERE grant_hash = $1 AND session_id = $2 AND admin_user_id = $3
         AND action_class = $4 AND target_hash = $5
         AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
      [
        hashOpaqueToken(token),
        actor.sessionId,
        actor.adminUserId,
        actionClass,
        hashOpaqueToken(target),
      ],
    );
    if (result.rowCount !== 1)
      throw new AuthError(
        'MFA_STEP_UP_REQUIRED',
        'Verify your identity again to continue.',
      );
  }

  private async hasSuperAdminRecoveryPermission(
    adminUserId: string,
  ): Promise<boolean> {
    const result = await this.database.pool.query(
      `SELECT 1 FROM admin_users au
       JOIN accounts a ON a.id = au.account_id
       JOIN role_assignments ra ON ra.admin_user_id = au.id AND ra.revoked_at IS NULL
       JOIN roles r ON r.id = ra.role_id AND r.archived_at IS NULL
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE au.id = $1 AND au.status = 'ACTIVE' AND au.archived_at IS NULL
         AND a.status = 'ACTIVE' AND r.code = 'SUPER_ADMIN'
         AND p.code = 'admin.mfa.reset' LIMIT 1`,
      [adminUserId],
    );
    return result.rowCount === 1;
  }

  private requireAdminActor(actor: RequestActor): string {
    if (actor.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new AuthError('ADMIN_ACCESS_REMOVED', 'Admin access is required.');
    }
    return actor.adminUserId;
  }

  private async enforceMfaRateLimit(
    purpose: string,
    adminUserId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const keys = [
      `admin-mfa:${purpose}:admin:${adminUserId}`,
      `admin-mfa:${purpose}:ip:${metadata.ipAddress ?? 'unknown'}`,
    ];
    for (const key of keys) {
      if (!(await this.rateLimiter.consume(key, 5, 15 * 60))) {
        await this.securityEvent(
          undefined,
          'ADMIN_MFA_RATE_LIMITED',
          'DENIED',
          metadata,
          { purpose },
        );
        throw new AuthError('AUTH_RATE_LIMITED', 'Too many requests.');
      }
    }
  }

  private async securityEvent(
    accountId: string | undefined,
    eventType: string,
    result: 'SUCCESS' | 'FAILURE' | 'DENIED',
    metadata: RequestMetadata,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.store.recordSecurityEvent({
      accountId,
      eventType,
      result,
      metadata,
      details,
    });
  }

  private deviceLabel(userAgent: string | null): string {
    if (!userAgent) return 'Unknown device';
    const browser = /Edg\//u.test(userAgent)
      ? 'Edge'
      : /Chrome\//u.test(userAgent)
        ? 'Chrome'
        : /Firefox\//u.test(userAgent)
          ? 'Firefox'
          : /Safari\//u.test(userAgent)
            ? 'Safari'
            : 'Browser';
    const platform = /Windows/u.test(userAgent)
      ? 'Windows'
      : /Mac OS/u.test(userAgent)
        ? 'macOS'
        : /Android/u.test(userAgent)
          ? 'Android'
          : /iPhone|iPad/u.test(userAgent)
            ? 'iOS'
            : 'Unknown OS';
    return `${browser} on ${platform}`;
  }
}
