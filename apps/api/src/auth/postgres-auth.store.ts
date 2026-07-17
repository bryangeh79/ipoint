import { Inject, Injectable } from '@nestjs/common';
import {
  memberEmailOtps,
  accounts,
  adminUsers,
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
    const rows = await this.database.db
      .insert(sessions)
      .values({
        accountId: session.accountId,
        familyId: session.familyId,
        accessTokenHash: session.accessTokenHash,
        refreshTokenHash: session.refreshTokenHash,
        accessExpiresAt: session.accessExpiresAt,
        expiresAt: session.refreshExpiresAt,
        ipAddress: session.metadata.ipAddress,
        userAgent: session.metadata.userAgent,
      })
      .returning({ id: sessions.id });
    const id = rows[0]?.id;
    if (!id) throw new Error('Session insert did not return an id.');
    return id;
  }

  async findAccessSession(
    accessTokenHash: string,
  ): Promise<SessionRecord | null> {
    const rows = await this.database.db
      .select({
        id: sessions.id,
        accountId: sessions.accountId,
        familyId: sessions.familyId,
        status: accounts.status,
        expiresAt: sessions.accessExpiresAt,
        revokedAt: sessions.revokedAt,
        adminUserId: adminUsers.id,
      })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .leftJoin(adminUsers, eq(adminUsers.accountId, sessions.accountId))
      .where(eq(sessions.accessTokenHash, accessTokenHash))
      .limit(1);
    return rows[0] ?? null;
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
      }>(
        `SELECT s.id, s.account_id, s.family_id, s.expires_at, s.revoked_at, a.status
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.refresh_token_hash = $1 FOR UPDATE`,
        [refreshTokenHash],
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
        await client.query('ROLLBACK');
        return { kind: 'INACTIVE' };
      }
      if (session.expires_at <= now) {
        await client.query('ROLLBACK');
        return { kind: 'EXPIRED' };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sessions
          (account_id, family_id, access_token_hash, refresh_token_hash,
           access_expires_at, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          session.account_id,
          session.family_id,
          replacement.accessTokenHash,
          replacement.refreshTokenHash,
          replacement.accessExpiresAt,
          replacement.refreshExpiresAt,
          replacement.metadata.ipAddress ?? null,
          replacement.metadata.userAgent ?? null,
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

  async findMemberEmailOtp(id: string): Promise<
    | {
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
      }
    | null
  > {
    const rows = await this.database.db
      .select()
      .from(memberEmailOtps)
      .where(eq(memberEmailOtps.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}
