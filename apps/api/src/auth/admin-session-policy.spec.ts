import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuthStorePort, NewSession } from './auth-store.port.js';
import { AuthService, type AuthSettings } from './auth.service.js';
import type { SessionRecord } from './auth.types.js';
import { InMemoryRateLimiter } from './rate-limit.port.js';

const settings: AuthSettings = {
  otpPepper: 'unit-test-pepper-at-least-thirty-two-characters',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 2_592_000,
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

function activeAdminSession(
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  const now = Date.now();
  return {
    id: '00000000-0000-4000-a000-000000000010',
    accountId: '00000000-0000-4000-a000-000000000011',
    familyId: '00000000-0000-4000-a000-000000000012',
    status: 'ACTIVE',
    expiresAt: new Date(now + 10 * 60 * 1000),
    revokedAt: null,
    adminUserId: '00000000-0000-4000-a000-000000000013',
    actorPurpose: 'ADMIN',
    adminStatus: 'ACTIVE',
    adminArchivedAt: null,
    hasActiveRole: true,
    idleExpiresAt: new Date(now + 30 * 60 * 1000),
    absoluteExpiresAt: new Date(now + 8 * 60 * 60 * 1000),
    familyMaxExpiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
    mfaRecoveryUsed: false,
    ...overrides,
  };
}

describe('Admin session policy', () => {
  let session = activeAdminSession();
  let created: NewSession | null;
  let store: AuthStorePort;
  let auth: AuthService;

  beforeEach(() => {
    session = activeAdminSession();
    created = null;
    store = {
      findPasswordIdentity: vi.fn(),
      setPasswordCredential: vi.fn(),
      createSession: vi.fn(async (value) => {
        created = value;
        return session.id;
      }),
      findAccessSession: vi.fn(async () => session),
      touchAdminSession: vi.fn(),
      rotateSession: vi.fn(),
      revokeSession: vi.fn(async () => true),
      revokeAdminSessions: vi.fn(async () => 2),
      createOtp: vi.fn(),
      findOtp: vi.fn(),
      incrementOtpAttempts: vi.fn(),
      markOtpVerified: vi.fn(),
      consumeOtp: vi.fn(),
      resetPasswordWithOtp: vi.fn(),
      recordSecurityEvent: vi.fn(),
      getAccountStatus: vi.fn(),
      findMemberEmailOtp: vi.fn(),
    };
    auth = new AuthService(
      store,
      new InMemoryRateLimiter(),
      settings,
      {} as DatabaseService,
    );
  });

  it('creates an ADMIN-purpose family clamped to 30m idle and 8h absolute', async () => {
    const before = Date.now();
    const tokens = await auth.createAdminSession(
      session.accountId,
      session.adminUserId!,
      {},
    );
    expect(created).toMatchObject({
      actorPurpose: 'ADMIN',
      adminUserId: session.adminUserId,
      mfaRecoveryUsed: false,
    });
    expect(created!.idleExpiresAt!.getTime() - before).toBeLessThanOrEqual(
      30 * 60 * 1000 + 100,
    );
    expect(created!.absoluteExpiresAt!.getTime() - before).toBeLessThanOrEqual(
      8 * 60 * 60 * 1000 + 100,
    );
    expect(tokens.refreshExpiresAt.getTime()).toBeLessThanOrEqual(
      created!.absoluteExpiresAt!.getTime(),
    );
  });

  it('does not let an idle-expired request extend activity', async () => {
    session = activeAdminSession({ idleExpiresAt: new Date(Date.now() - 1) });
    await expect(auth.resolveActor('access-token', true)).rejects.toMatchObject(
      {
        code: 'SESSION_IDLE_EXPIRED',
      },
    );
    expect(store.touchAdminSession).not.toHaveBeenCalled();
    expect(store.revokeSession).toHaveBeenCalledWith(
      expect.any(String),
      'IDLE_EXPIRED',
      expect.any(Date),
    );
  });

  it('enforces the absolute boundary on the next request', async () => {
    session = activeAdminSession({
      absoluteExpiresAt: new Date(Date.now() - 1),
    });
    await expect(auth.resolveActor('access-token')).rejects.toMatchObject({
      code: 'SESSION_ABSOLUTE_EXPIRED',
    });
  });

  it('enforces the outer refresh-family boundary', async () => {
    session = activeAdminSession({
      familyMaxExpiresAt: new Date(Date.now() - 1),
    });
    await expect(auth.resolveActor('access-token')).rejects.toMatchObject({
      code: 'SESSION_FAMILY_EXPIRED',
    });
  });

  it('revokes every Admin session when eligibility is removed', async () => {
    session = activeAdminSession({ adminStatus: 'SUSPENDED' });
    await expect(auth.resolveActor('access-token')).rejects.toMatchObject({
      code: 'ADMIN_ACCESS_REMOVED',
    });
    expect(store.revokeAdminSessions).toHaveBeenCalledWith(
      session.adminUserId,
      'ADMIN_ACCESS_REMOVED',
      expect.any(Date),
    );
  });

  it('coalesces server activity only for an explicit foreground signal', async () => {
    await auth.resolveActor('access-token', false);
    expect(store.touchAdminSession).not.toHaveBeenCalled();
    await auth.resolveActor('access-token', true);
    expect(store.touchAdminSession).toHaveBeenCalledWith(
      session.id,
      expect.any(Date),
    );
  });

  it('maps rotated refresh reuse to the frozen family-reuse error', async () => {
    vi.mocked(store.rotateSession).mockResolvedValue({ kind: 'REUSED' });
    await expect(auth.rotateRefreshToken('reused-token')).rejects.toMatchObject(
      {
        code: 'SESSION_REUSE_DETECTED',
      },
    );
  });
});
