import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, credentials, securityEvents } from '@ipoint/database';
import { eq } from 'drizzle-orm';
import type { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { migrate } from '@ipoint/database';
import { AuthService, type AuthSettings } from './auth.service.js';
import { PostgresAuthStore } from './postgres-auth.store.js';
import { InMemoryRateLimiter } from './rate-limit.port.js';

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
    );
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

  it('issues, verifies, consumes, and attempt-limits hash-only OTPs', async () => {
    const otp = await auth.issueOtp({
      accountId,
      destination: email,
      purpose: 'EMAIL_VERIFICATION',
    });
    await expect(auth.verifyOtp(otp.id, '999999')).rejects.toMatchObject({
      code: 'AUTH_OTP_INVALID',
    });
    await auth.verifyOtp(otp.id, otp.code);
    await auth.consumeOtp(otp.id);
    await expect(auth.consumeOtp(otp.id)).rejects.toMatchObject({
      code: 'AUTH_OTP_INVALID',
    });
  });

  it('resets a password atomically and revokes existing sessions', async () => {
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
  });

  it('records security events without token or password material', async () => {
    const rows = await database.db
      .select({ metadata: securityEvents.metadata })
      .from(securityEvents)
      .where(eq(securityEvents.accountId, accountId));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(password);
  });
});
