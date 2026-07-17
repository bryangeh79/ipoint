import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuthStorePort } from './auth-store.port.js';
import { AuthService, type AuthSettings } from './auth.service.js';
import { InMemoryRateLimiter } from './rate-limit.port.js';
import { PasswordHasher } from './password-hasher.js';
import {
  createOpaqueToken,
  createOtpCode,
  hashOpaqueToken,
  hashOtpCode,
} from './secret-tokens.js';

describe('auth cryptographic primitives', () => {
  it('hashes passwords with a random salt and verifies in constant-time form', async () => {
    const hasher = new PasswordHasher();
    const password = 'correct horse battery staple';
    const first = await hasher.hash(password);
    const second = await hasher.hash(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    await expect(hasher.verify(password, first)).resolves.toBe(true);
    await expect(hasher.verify('wrong password', first)).resolves.toBe(false);
  });

  it('rejects weak passwords', async () => {
    const hasher = new PasswordHasher();
    await expect(hasher.hash('short')).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_WEAK',
    });
  });

  it('creates high-entropy opaque tokens and hash-only storage values', () => {
    const token = createOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(token).not.toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('creates six-digit OTPs and binds their hash to id and pepper', () => {
    const code = createOtpCode();
    expect(code).toMatch(/^\d{6}$/u);
    expect(hashOtpCode('one', code, 'pepper')).not.toBe(
      hashOtpCode('two', code, 'pepper'),
    );
  });
});

describe('rate-limit port baseline', () => {
  it('denies requests after the configured bucket limit', async () => {
    const limiter = new InMemoryRateLimiter();
    await expect(limiter.consume('key', 2, 60)).resolves.toBe(true);
    await expect(limiter.consume('key', 2, 60)).resolves.toBe(true);
    await expect(limiter.consume('key', 2, 60)).resolves.toBe(false);
  });
});

describe('mock-based AuthService login gating', () => {
  const password = 'correct horse battery staple';
  const settings: AuthSettings = {
    otpPepper: 'auth-service-spec-pepper-at-least-32-chars',
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

  async function createService(memberStatus: string | null) {
    const hasher = new PasswordHasher();
    const secretHash = await hasher.hash(password);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const findPasswordIdentity = vi.fn<any>().mockResolvedValue({
      accountId: randomUUID(),
      secretHash,
      status: 'ACTIVE',
      memberStatus,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const createSession = vi.fn<any>().mockResolvedValue('session-id');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const recordSecurityEvent = vi.fn<any>().mockResolvedValue(undefined);
    const store = {
      findPasswordIdentity,
      createSession,
      recordSecurityEvent,
    } as unknown as AuthStorePort;
    return {
      auth: new AuthService(
        store,
        new InMemoryRateLimiter(),
        settings,
        {} as DatabaseService,
      ),
      findPasswordIdentity,
      createSession,
      recordSecurityEvent,
    };
  }

  it('allows merchant-only login when memberStatus is null', async () => {
    const { auth, createSession, recordSecurityEvent } =
      await createService(null);
    await expect(
      auth.login('merchant@example.com', password),
    ).resolves.toMatchObject({
      accessToken: expect.any(String) as unknown,
      refreshToken: expect.any(String) as unknown,
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(recordSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'AUTH_LOGIN_SUCCEEDED' }),
    );
  });

  it.each(['PENDING_EMAIL_VERIFICATION', 'CLOSED', 'SUSPENDED'] as const)(
    'rejects login with AUTH_MEMBER_INACTIVE when memberStatus is %s',
    async (memberStatus) => {
      const { auth, createSession, recordSecurityEvent } =
        await createService(memberStatus);
      await expect(
        auth.login('member@example.com', password),
      ).rejects.toMatchObject({ code: 'AUTH_MEMBER_INACTIVE' });
      expect(createSession).not.toHaveBeenCalled();
      expect(recordSecurityEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'AUTH_LOGIN_SUCCEEDED' }),
      );
    },
  );
});
