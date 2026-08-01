import { Inject, Injectable } from '@nestjs/common';
import {
  memberEmailOtps,
  accounts,
  credentials,
  otps,
  members,
  securityEvents,
  sessions,
} from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import type {
  AuthStorePort,
  NewOtp,
  NewSession,
  RotateSessionResult,
} from './auth-store.port.js';
import type {
  AccountStatus,
  OtpRecord,
  PasswordIdentity,
  SessionRecord,
} from './auth.types.js';

@Injectable()
export class PostgresAuthStore implements AuthStorePort {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async findPasswordIdentity(email: string): Promise<PasswordIdentity | null> {
    const rows = await this.database.db
      .select({
        accountId: accounts.id,
        status: accounts.status,
        memberId: members.id,
        memberStatus: members.status,
        secretHash: credentials.secretHash,
      })
      .from(accounts)
      .innerJoin(
        credentials,
        and(
          eq(credentials.accountId, accounts.id),
          eq(credentials.type, 'PASSWORD'),
        ),
      )
      .leftJoin(members, eq(members.accountId, accounts.id))
      .where(eq(accounts.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  async setPasswordCredential(
    accountId: string,
    secretHash: string,
  ): Promise<void> {
    await this.database.db
      .insert(credentials)
      .values({
        accountId,
        type: 'PASSWORD',
        secretHash,
        hashAlgorithm: 'scrypt',
        hashVersion: 1,
      })
      .onConflictDoUpdate({
        target: [credentials.accountId, credentials.type],
        set: {
          secretHash,
          hashAlgorithm: 'scrypt',
          hashVersion: 1,
          updatedAt: new Date(),
          revokedAt: null,
        },
      });
  }

  async createSession(session: NewSession): Promise<string> {
    const result = await this.database.pool.query<{ id: string }>(
      `INSERT INTO sessions
        (account_id, family_id, access_token_hash, refresh_token_hash,
         access_expires_at, expires_at, ip_address, user_agent, actor_purpose,
         admin_user_id, idle_expires_at, absolute_expires_at,
         family_created_at, family_max_expires_at, mfa_recovery_used)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        session.accountId,
        session.familyId,
        session.accessTokenHash,
        session.refreshTokenHash,
        session.accessExpiresAt,
        session.refreshExpiresAt,
        session.metadata.ipAddress ?? null,
        session.metadata.userAgent ?? null,
        session.actorPurpose ?? 'ACCOUNT',
        session.adminUserId ?? null,
        session.idleExpiresAt ?? null,
        session.absoluteExpiresAt ?? null,
        session.familyCreatedAt ?? null,
        session.familyMaxExpiresAt ?? null,
        session.mfaRecoveryUsed ?? false,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Session insert did not return an id.');
    return id;
  }

  async findAccessSession(
    accessTokenHash: string,
  ): Promise<SessionRecord | null> {
    const result = await this.database.pool.query<SessionRecord>(
      `SELECT s.id, s.account_id AS "accountId", s.family_id AS "familyId",
              a.status, s.access_expires_at AS "expiresAt", s.revoked_at AS "revokedAt",
              s.admin_user_id AS "adminUserId", s.actor_purpose AS "actorPurpose",
              au.status AS "adminStatus", au.archived_at AS "adminArchivedAt",
              s.idle_expires_at AS "idleExpiresAt",
              s.absolute_expires_at AS "absoluteExpiresAt",
              s.family_max_expires_at AS "familyMaxExpiresAt",
              s.mfa_recovery_used AS "mfaRecoveryUsed",
              EXISTS (
                SELECT 1 FROM role_assignments ra
                JOIN roles r ON r.id = ra.role_id AND r.archived_at IS NULL
                WHERE ra.admin_user_id = s.admin_user_id
                  AND ra.revoked_at IS NULL
                  AND r.code = ANY($2::text[])
              ) AS "hasActiveRole"
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       LEFT JOIN admin_users au ON au.id = s.admin_user_id
       WHERE s.access_token_hash = $1
       LIMIT 1`,
      [
        accessTokenHash,
        [
          'SUPER_ADMIN',
          'OPERATIONS_ADMIN',
          'FINANCE_OPERATOR',
          'FINANCE_APPROVER',
          'KYC_REVIEWER',
          'SUPPORT_READONLY_AUDITOR',
        ],
      ],
    );
    return result.rows[0] ?? null;
  }

  async touchAdminSession(sessionId: string, now: Date): Promise<void> {
    await this.database.pool.query(
      `UPDATE sessions
       SET last_seen_at = $2,
           idle_expires_at = LEAST($2 + interval '30 minutes', absolute_expires_at)
       WHERE id = $1 AND actor_purpose = 'ADMIN' AND revoked_at IS NULL
         AND idle_expires_at > $2 AND absolute_expires_at > $2
         AND last_seen_at < $2 - interval '1 minute'`,
      [sessionId, now],
    );
  }

  async rotateSession(
    refreshTokenHash: string,
    replacement: NewSession,
    now: Date,
  ): Promise<RotateSessionResult> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        id: string;
        account_id: string;
        family_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        status: AccountStatus;
        actor_purpose: 'ACCOUNT' | 'ADMIN';
        admin_user_id: string | null;
        admin_status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | null;
        admin_archived_at: Date | null;
        has_active_role: boolean;
        idle_expires_at: Date | null;
        absolute_expires_at: Date | null;
        family_created_at: Date | null;
        family_max_expires_at: Date | null;
        mfa_recovery_used: boolean;
      }>(
        `SELECT s.id, s.account_id, s.family_id, s.expires_at, s.revoked_at, a.status,
                s.actor_purpose, s.admin_user_id, au.status AS admin_status,
                au.archived_at AS admin_archived_at, s.idle_expires_at,
                s.absolute_expires_at, s.family_created_at,
                s.family_max_expires_at, s.mfa_recovery_used,
                EXISTS (
                  SELECT 1 FROM role_assignments ra
                  JOIN roles r ON r.id = ra.role_id AND r.archived_at IS NULL
                  WHERE ra.admin_user_id = s.admin_user_id AND ra.revoked_at IS NULL
                    AND r.code = ANY($2::text[])
                ) AS has_active_role
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         LEFT JOIN admin_users au ON au.id = s.admin_user_id
         WHERE s.refresh_token_hash = $1 FOR UPDATE OF s`,
        [
          refreshTokenHash,
          [
            'SUPER_ADMIN',
            'OPERATIONS_ADMIN',
            'FINANCE_OPERATOR',
            'FINANCE_APPROVER',
            'KYC_REVIEWER',
            'SUPPORT_READONLY_AUDITOR',
          ],
        ],
      );
      const session = current.rows[0];
      if (!session) {
        await client.query('ROLLBACK');
        return { kind: 'NOT_FOUND' };
      }
      if (session.revoked_at) {
        await client.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2),
            revoke_reason = COALESCE(revoke_reason, 'REFRESH_TOKEN_REUSE')
           WHERE family_id = $1`,
          [session.family_id, now],
        );
        await client.query('COMMIT');
        return { kind: 'REUSED' };
      }
      if (session.status !== 'ACTIVE') {
        await client.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2),
             revoke_reason = COALESCE(revoke_reason, 'ACCOUNT_INACTIVE')
           WHERE account_id = $1`,
          [session.account_id, now],
        );
        await client.query('COMMIT');
        return { kind: 'INACTIVE' };
      }
      if (
        session.actor_purpose === 'ADMIN' &&
        (session.admin_status !== 'ACTIVE' ||
          session.admin_archived_at ||
          !session.has_active_role)
      ) {
        await client.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2),
             revoke_reason = COALESCE(revoke_reason, 'ADMIN_ACCESS_REMOVED')
           WHERE admin_user_id = $1 AND actor_purpose = 'ADMIN'`,
          [session.admin_user_id, now],
        );
        await client.query('COMMIT');
        return { kind: 'INACTIVE' };
      }
      if (
        session.actor_purpose === 'ADMIN' &&
        session.absolute_expires_at! <= now
      ) {
        await client.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2), revoke_reason = 'ABSOLUTE_EXPIRED'
           WHERE family_id = $1`,
          [session.family_id, now],
        );
        await client.query('COMMIT');
        return { kind: 'ABSOLUTE_EXPIRED' };
      }
      if (
        session.actor_purpose === 'ADMIN' &&
        session.family_max_expires_at! <= now
      ) {
        await client.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2), revoke_reason = 'FAMILY_EXPIRED'
           WHERE family_id = $1`,
          [session.family_id, now],
        );
        await client.query('COMMIT');
        return { kind: 'FAMILY_EXPIRED' };
      }
      if (
        session.actor_purpose === 'ADMIN' &&
        session.idle_expires_at! <= now
      ) {
        await client.query(
          `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2), revoke_reason = 'IDLE_EXPIRED'
           WHERE id = $1`,
          [session.id, now],
        );
        await client.query('COMMIT');
        return { kind: 'IDLE_EXPIRED' };
      }
      if (session.expires_at <= now) {
        await client.query('ROLLBACK');
        return { kind: 'EXPIRED' };
      }
      const accessExpiresAt = session.absolute_expires_at
        ? new Date(
            Math.min(
              replacement.accessExpiresAt.getTime(),
              session.absolute_expires_at.getTime(),
            ),
          )
        : replacement.accessExpiresAt;
      const refreshExpiresAt = session.absolute_expires_at
        ? new Date(
            Math.min(
              replacement.refreshExpiresAt.getTime(),
              session.absolute_expires_at.getTime(),
              session.family_max_expires_at!.getTime(),
            ),
          )
        : replacement.refreshExpiresAt;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sessions
          (account_id, family_id, access_token_hash, refresh_token_hash,
           access_expires_at, expires_at, ip_address, user_agent, actor_purpose,
           admin_user_id, idle_expires_at, absolute_expires_at,
           family_created_at, family_max_expires_at, mfa_recovery_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15) RETURNING id`,
        [
          session.account_id,
          session.family_id,
          replacement.accessTokenHash,
          replacement.refreshTokenHash,
          accessExpiresAt,
          refreshExpiresAt,
          replacement.metadata.ipAddress ?? null,
          replacement.metadata.userAgent ?? null,
          session.actor_purpose,
          session.admin_user_id,
          session.idle_expires_at,
          session.absolute_expires_at,
          session.family_created_at,
          session.family_max_expires_at,
          session.mfa_recovery_used,
        ],
      );
      const replacementId = inserted.rows[0]?.id;
      if (!replacementId) throw new Error('Rotated session insert failed.');
      await client.query(
        `UPDATE sessions SET revoked_at = $2, revoke_reason = 'REFRESH_ROTATED',
          replaced_by_session_id = $3 WHERE id = $1`,
        [session.id, now, replacementId],
      );
      await client.query('COMMIT');
      return {
        kind: 'ROTATED',
        sessionId: replacementId,
        accountId: session.account_id,
        accessExpiresAt,
        refreshExpiresAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSession(
    accessTokenHash: string,
    reason: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.database.db
      .update(sessions)
      .set({ revokedAt: now, revokeReason: reason })
      .where(
        and(
          eq(sessions.accessTokenHash, accessTokenHash),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });
    return rows.length === 1;
  }

  async revokeAdminSessions(
    adminUserId: string,
    reason: string,
    now: Date,
  ): Promise<number> {
    const result = await this.database.pool.query(
      `UPDATE sessions SET revoked_at = $3, revoke_reason = $2
       WHERE admin_user_id = $1 AND actor_purpose = 'ADMIN' AND revoked_at IS NULL`,
      [adminUserId, reason, now],
    );
    await this.database.pool.query(
      `UPDATE admin_step_up_grants SET revoked_at = $2
       WHERE admin_user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
      [adminUserId, now],
    );
    return result.rowCount ?? 0;
  }

  async createOtp(otp: NewOtp): Promise<void> {
    await this.database.db.insert(otps).values({
      id: otp.id,
      accountId: otp.accountId,
      destination: otp.destination,
      purpose: otp.purpose,
      codeHash: otp.codeHash,
      maxAttempts: otp.maxAttempts,
      expiresAt: otp.expiresAt,
    });
  }

  async findOtp(id: string): Promise<OtpRecord | null> {
    const rows = await this.database.db
      .select()
      .from(otps)
      .where(eq(otps.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async incrementOtpAttempts(id: string): Promise<number> {
    const result = await this.database.pool.query<{ attempts: number }>(
      `UPDATE otps SET attempts = attempts + 1
       WHERE id = $1 AND attempts < max_attempts RETURNING attempts`,
      [id],
    );
    return result.rows[0]?.attempts ?? 0;
  }

  async markOtpVerified(id: string, now: Date): Promise<boolean> {
    const result = await this.database.pool.query(
      `UPDATE otps SET verified_at = $2
       WHERE id = $1 AND verified_at IS NULL AND consumed_at IS NULL
         AND expires_at > $2 AND attempts < max_attempts`,
      [id, now],
    );
    return result.rowCount === 1;
  }

  async consumeOtp(id: string, now: Date): Promise<boolean> {
    const result = await this.database.pool.query(
      `UPDATE otps SET consumed_at = $2
       WHERE id = $1 AND verified_at IS NOT NULL AND consumed_at IS NULL
         AND expires_at > $2`,
      [id, now],
    );
    return result.rowCount === 1;
  }

  async resetPasswordWithOtp(
    otpId: string,
    accountId: string,
    secretHash: string,
    now: Date,
  ): Promise<boolean> {
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        `UPDATE otps SET consumed_at = $3
         WHERE id = $1 AND account_id = $2 AND purpose = 'PASSWORD_RESET'
           AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at > $3
         RETURNING id`,
        [otpId, accountId, now],
      );
      if (consumed.rowCount !== 1) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO credentials
          (account_id, type, secret_hash, hash_algorithm, hash_version)
         VALUES ($1, 'PASSWORD', $2, 'scrypt', 1)
         ON CONFLICT (account_id, type) DO UPDATE SET
           secret_hash = EXCLUDED.secret_hash, hash_algorithm = 'scrypt',
           hash_version = 1, updated_at = $3, revoked_at = NULL`,
        [accountId, secretHash, now],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2),
          revoke_reason = COALESCE(revoke_reason, 'PASSWORD_RESET')
         WHERE account_id = $1`,
        [accountId, now],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordSecurityEvent(
    input: Parameters<AuthStorePort['recordSecurityEvent']>[0],
  ): Promise<void> {
    await this.database.db.insert(securityEvents).values({
      accountId: input.accountId,
      eventType: input.eventType,
      result: input.result,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent,
      requestId: input.metadata.requestId,
      metadata: input.details ?? {},
    });
  }

  async getAccountStatus(accountId: string): Promise<AccountStatus | null> {
    const rows = await this.database.db
      .select({ status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    return rows[0]?.status ?? null;
  }

  async findMemberEmailOtp(id: string): Promise<{
    id: string;
    purpose: 'REGISTRATION' | 'PASSWORD_RESET';
    memberId: string | null;
    accountId: string | null;
    email: string;
    accountCountry: string | null;
    passwordHash: string | null;
    referralCode: string | null;
    referrerMemberId: string | null;
    termsVersion: string | null;
    disclaimerVersion: string | null;
    privacyVersion: string | null;
    locale: string | null;
    otpHash: string;
    otpVersion: number;
    attempts: number;
    maxAttempts: number;
    expiresAt: Date;
    resendAvailableAt: Date;
    verifiedAt: Date | null;
    usedAt: Date | null;
  } | null> {
    const rows = await this.database.db
      .select()
      .from(memberEmailOtps)
      .where(eq(memberEmailOtps.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}
