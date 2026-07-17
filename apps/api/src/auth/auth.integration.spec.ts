import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accounts,
  credentials,
  markets,
  otps,
  members,
  securityEvents,
  sessions,
} from '@ipoint/database';
import { eq } from 'drizzle-orm';
import type { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { migrate } from '@ipoint/database';
import { AuthService, type AuthSettings } from './auth.service.js';
import { PostgresAuthStore } from './postgres-auth.store.js';
import { InMemoryRateLimiter } from './rate-limit.port.js';
import { hashOpaqueToken } from './secret-tokens.js';

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('auth foundation integration', () => {
  let database: DatabaseService;
  let auth: AuthService;
  let accountId: string;
  const email = `${randomUUID()}@example.com`;
  const password = 'initial secure password';
  const settings: AuthSettings = {
    otpPepper: 'integration-test-pepper-at-least-32-characters',
    accessTtlSeconds: 900,
    refreshTtlSeconds: 3600,
    otpTtlSeconds: 600,
    otpMaxAttempts: 5,
    otpResendCooldownSeconds: 30,
    idempotencyTtlSeconds: 86_400,
    registrationEmailRateLimitCount: 3,
    registrationEmailRateLimitWindowSeconds: 60,
    registrationIpRateLimitCount: 5,
    registrationIpRateLimitWindowSeconds: 60,
    loginEmailRateLimitCount: 5,
    loginEmailRateLimitWindowSeconds: 300,
    loginIpRateLimitCount: 10,
    loginIpRateLimitWindowSeconds: 300,
    passwordResetEmailRateLimitCount: 3,
    passwordResetEmailRateLimitWindowSeconds: 300,
    passwordResetIpRateLimitCount: 5,
    passwordResetIpRateLimitWindowSeconds: 300,
    memberPublicIdPrefix: 'IPM',
    memberPublicIdLength: 10,
    memberReferralCodeLength: 8,
  };

  beforeAll(async () => {
    database = new DatabaseService({ databaseUrl } as ConfigService);
    await migrate(database.pool);
    const inserted = await database.db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    accountId = inserted[0]?.id ?? '';
    auth = createAuthService();
    await auth.setPassword(accountId, password);
  });

  beforeEach(() => {
    auth = createAuthService();
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  function createAuthService(): AuthService {
    return new AuthService(
      new PostgresAuthStore(database),
      new InMemoryRateLimiter(),
      settings,
      database,
    );
  }

  async function createActiveMarket(code = 'MY') {
    const existing = await database.db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.code, code))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await database.db
      .insert(markets)
      .values({
        code,
        name: `${code} Market`,
        status: 'ACTIVE',
        currencyCode: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        defaultLocale: 'en-MY',
      })
      .returning({ id: markets.id });
    return inserted[0]?.id ?? '';
  }

  it('stores password hashes only and enforces account status', async () => {
    const rows = await database.db
      .select({ secretHash: credentials.secretHash })
      .from(credentials)
      .where(eq(credentials.accountId, accountId));
    expect(rows[0]?.secretHash).not.toContain(password);
    await database.db
      .update(accounts)
      .set({ status: 'SUSPENDED' })
      .where(eq(accounts.id, accountId));
    await expect(auth.login(email, password)).rejects.toMatchObject({
      code: 'AUTH_ACCOUNT_INACTIVE',
    });
    await database.db
      .update(accounts)
      .set({ status: 'ACTIVE' })
      .where(eq(accounts.id, accountId));

    await expect(auth.login(email, 'invalid password')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'The supplied credentials are invalid.',
    });
    await expect(
      auth.login(`${randomUUID()}@example.com`, 'invalid password'),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'The supplied credentials are invalid.',
    });
    await database.db
      .update(accounts)
      .set({ status: 'LOCKED' })
      .where(eq(accounts.id, accountId));
    await expect(auth.login(email, password)).rejects.toMatchObject({
      code: 'AUTH_ACCOUNT_INACTIVE',
    });
    await database.db
      .update(accounts)
      .set({ status: 'ACTIVE' })
      .where(eq(accounts.id, accountId));
    await expect(auth.login(email, password)).resolves.toHaveProperty(
      'accessToken',
    );
  });

  it('blocks login for inactive members while preserving merchant-only access', async () => {
    const memberEmail = `${randomUUID()}@example.com`;
    const memberAccount = await database.db
      .insert(accounts)
      .values({
        publicId: `acct_${randomUUID()}`,
        email: memberEmail,
        accountCountry: 'MY',
        status: 'ACTIVE',
      })
      .returning({ id: accounts.id });
    await auth.setPassword(memberAccount[0]?.id ?? '', password);
    await database.db.insert(members).values({
      accountId: memberAccount[0]!.id,
      publicMemberId: `mem_${randomUUID()}`,
      referralCode: `REF${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      status: 'PENDING_EMAIL_VERIFICATION',
      kycLevel: 'NONE',
    });
    await expect(auth.login(memberEmail, password)).rejects.toMatchObject({
      code: 'AUTH_MEMBER_INACTIVE',
    });
    await database.db
      .update(members)
      .set({ status: 'ACTIVE', kycLevel: 'LEVEL_1' })
      .where(eq(members.accountId, memberAccount[0]!.id));
    await expect(auth.login(memberEmail, password)).resolves.toHaveProperty(
      'accessToken',
    );
    await database.db
      .update(members)
      .set({ status: 'SUSPENDED' })
      .where(eq(members.accountId, memberAccount[0]!.id));
    await expect(auth.login(memberEmail, password)).rejects.toMatchObject({
      code: 'AUTH_MEMBER_INACTIVE',
    });
    await database.db
      .update(members)
      .set({ status: 'CLOSED', closedAt: new Date() })
      .where(eq(members.accountId, memberAccount[0]!.id));
    await expect(auth.login(memberEmail, password)).rejects.toMatchObject({
      code: 'AUTH_MEMBER_INACTIVE',
    });
  });

  it('registers a member atomically and supports idempotent completion', async () => {
    await createActiveMarket();
    const idempotencyKey = randomUUID();
    const initiation = await auth.initiateRegistration({
      email: `${randomUUID()}@example.com`,
      password: 'Registration-Password-123!',
      accountCountry: 'MY',
      referralCode: null,
      termsVersion: 'v1',
      disclaimerVersion: 'v1',
      privacyVersion: 'v1',
      locale: 'en-MY',
    });
    await auth.verifyRegistrationOtp(initiation.id, initiation.code);
    const completed = await auth.completeRegistration(
      initiation.id,
      idempotencyKey,
    );
    expect(completed).toMatchObject({
      accountId: expect.any(String) as unknown,
      memberId: expect.any(String) as unknown,
    });
    const repeated = await auth.completeRegistration(
      initiation.id,
      idempotencyKey,
    );
    expect(repeated).toEqual(completed);
  });

  it('creates, resolves, rotates, detects reuse, and revokes sessions', async () => {
    const first = await auth.login(email, password, {
      requestId: randomUUID(),
    });
    await expect(auth.resolveActor(first.accessToken)).resolves.toMatchObject({
      accountId,
    });
    const second = await auth.rotateRefreshToken(first.refreshToken);
    await expect(auth.resolveActor(first.accessToken)).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });
    await expect(auth.resolveActor(second.accessToken)).resolves.toMatchObject({
      accountId,
    });
    await expect(
      auth.rotateRefreshToken(first.refreshToken),
    ).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSED',
    });
    await expect(auth.resolveActor(second.accessToken)).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });

    const logoutSession = await auth.login(email, password);
    await auth.logout(logoutSession.accessToken);
    await expect(
      auth.resolveActor(logoutSession.accessToken),
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });
  });

  it('stores session hashes only and rejects expired or concurrent reuse', async () => {
    const expiredAccess = await auth.login(email, password);
    const stored = await database.db
      .select({
        accessTokenHash: sessions.accessTokenHash,
        refreshTokenHash: sessions.refreshTokenHash,
      })
      .from(sessions)
      .where(
        eq(
          sessions.accessTokenHash,
          hashOpaqueToken(expiredAccess.accessToken),
        ),
      );
    expect(stored[0]?.accessTokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored[0]?.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(expiredAccess.accessToken);
    expect(JSON.stringify(stored)).not.toContain(expiredAccess.refreshToken);
    await database.pool.query(
      `UPDATE sessions SET access_expires_at = created_at + interval '1 millisecond'
       WHERE access_token_hash = $1`,
      [hashOpaqueToken(expiredAccess.accessToken)],
    );
    await expect(
      auth.resolveActor(expiredAccess.accessToken),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID' });

    const expiredRefresh = await auth.login(email, password);
    await database.pool.query(
      `UPDATE sessions
       SET access_expires_at = created_at + interval '1 millisecond',
           expires_at = created_at + interval '1 millisecond'
       WHERE refresh_token_hash = $1`,
      [hashOpaqueToken(expiredRefresh.refreshToken)],
    );
    await expect(
      auth.rotateRefreshToken(expiredRefresh.refreshToken),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID' });

    const concurrent = await auth.login(email, password);
    const rotations = await Promise.allSettled([
      auth.rotateRefreshToken(concurrent.refreshToken),
      auth.rotateRefreshToken(concurrent.refreshToken),
    ]);
    expect(
      rotations.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      rotations.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const fulfilled = rotations.find((result) => result.status === 'fulfilled');
    if (!fulfilled || fulfilled.status !== 'fulfilled') {
      throw new Error('Expected exactly one successful refresh rotation.');
    }
    await expect(
      auth.resolveActor(fulfilled.value.accessToken),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID' });
  });

  it('issues, verifies, consumes, and attempt-limits hash-only OTPs', async () => {
    const otp = await auth.issueOtp({
      accountId,
      destination: email,
      purpose: 'EMAIL_VERIFICATION',
    });
    const invalidCode = otp.code === '999999' ? '000000' : '999999';
    await expect(auth.verifyOtp(otp.id, invalidCode)).rejects.toMatchObject({
      code: 'AUTH_OTP_INVALID',
    });
    await auth.verifyOtp(otp.id, otp.code);
    await auth.consumeOtp(otp.id);
    await expect(auth.consumeOtp(otp.id)).rejects.toMatchObject({
      code: 'AUTH_OTP_INVALID',
    });

    const stored = await database.db
      .select({ codeHash: otps.codeHash })
      .from(otps)
      .where(eq(otps.id, otp.id));
    expect(stored[0]?.codeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain(otp.code);

    const limited = await auth.issueOtp({
      accountId,
      destination: `${randomUUID()}@example.com`,
      purpose: 'EMAIL_VERIFICATION',
    });
    const limitedInvalidCode = limited.code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < settings.otpMaxAttempts; attempt += 1) {
      await expect(
        auth.verifyOtp(limited.id, limitedInvalidCode),
      ).rejects.toMatchObject({ code: 'AUTH_OTP_INVALID' });
    }
    await expect(
      auth.verifyOtp(limited.id, limited.code),
    ).rejects.toMatchObject({
      code: 'AUTH_OTP_ATTEMPTS_EXHAUSTED',
    });

    const expired = await auth.issueOtp({
      accountId,
      destination: `${randomUUID()}@example.com`,
      purpose: 'EMAIL_VERIFICATION',
    });
    await database.pool.query(
      `UPDATE otps SET expires_at = created_at + interval '1 millisecond'
       WHERE id = $1`,
      [expired.id],
    );
    await expect(
      auth.verifyOtp(expired.id, expired.code),
    ).rejects.toMatchObject({
      code: 'AUTH_OTP_EXPIRED',
    });

    const concurrent = await auth.issueOtp({
      accountId,
      destination: `${randomUUID()}@example.com`,
      purpose: 'EMAIL_VERIFICATION',
    });
    const verifications = await Promise.allSettled([
      auth.verifyOtp(concurrent.id, concurrent.code),
      auth.verifyOtp(concurrent.id, concurrent.code),
    ]);
    expect(
      verifications.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      verifications.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('resets a password atomically and revokes existing sessions', async () => {
    await expect(
      auth.resetPassword(randomUUID(), accountId, 'unused secure password'),
    ).rejects.toMatchObject({ code: 'AUTH_OTP_INVALID' });

    const expiredReset = await auth.issueOtp({
      accountId,
      destination: email,
      purpose: 'PASSWORD_RESET',
    });
    await auth.verifyOtp(expiredReset.id, expiredReset.code);
    await database.pool.query(
      `UPDATE otps SET expires_at = created_at + interval '1 millisecond'
       WHERE id = $1`,
      [expiredReset.id],
    );
    await expect(
      auth.resetPassword(expiredReset.id, accountId, 'unused secure password'),
    ).rejects.toMatchObject({ code: 'AUTH_OTP_INVALID' });

    const activeSession = await auth.login(email, password);
    const otp = await auth.issueOtp({
      accountId,
      destination: email,
      purpose: 'PASSWORD_RESET',
    });
    await auth.verifyOtp(otp.id, otp.code);
    const replacement = 'replacement secure password';
    await auth.resetPassword(otp.id, accountId, replacement);
    await expect(
      auth.resolveActor(activeSession.accessToken),
    ).rejects.toMatchObject({
      code: 'AUTH_SESSION_INVALID',
    });
    await expect(auth.login(email, password)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    await expect(auth.login(email, replacement)).resolves.toHaveProperty(
      'accessToken',
    );
    await expect(
      auth.resetPassword(otp.id, accountId, 'another secure password'),
    ).rejects.toMatchObject({ code: 'AUTH_OTP_INVALID' });
  });

  it('records security events without token or password material', async () => {
    const requestId = randomUUID();
    const metadata = {
      requestId,
      ipAddress: '203.0.113.10',
      userAgent: 'Batch-A-Acceptance/1.0',
    };
    const session = await auth.login(
      email,
      'replacement secure password',
      metadata,
    );
    const rows = await database.db
      .select({
        metadata: securityEvents.metadata,
        requestId: securityEvents.requestId,
        ipAddress: securityEvents.ipAddress,
        userAgent: securityEvents.userAgent,
      })
      .from(securityEvents)
      .where(eq(securityEvents.accountId, accountId));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(password);
    expect(JSON.stringify(rows)).not.toContain(session.accessToken);
    expect(JSON.stringify(rows)).not.toContain(session.refreshToken);
    expect(rows).toEqual(
      expect.arrayContaining([expect.objectContaining(metadata)]),
    );
  });
});
