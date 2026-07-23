import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  accounts,
  auditLogs,
  credentials,
  entityTimelines,
  markets,
  memberEmailOtps,
  memberProfiles,
  memberReferralHistory,
  memberReferrals,
  members,
  memberStatusHistory,
  memberTermsAcceptances,
  otps,
  securityEvents,
  sessions,
} from '@ipoint/database';
import { and, eq } from 'drizzle-orm';
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
    try {
      await migrate(database.pool);
    } catch (error) {
      // Ignore migration collision when another test file already ran migration
      if (
        !(
          error instanceof Error &&
          'message' in error &&
          String(error.message).includes('pg_type_typname_nsp_index')
        )
      ) {
        throw error;
      }
    }
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
    await auth.verifyOtp(concurrent.id, concurrent.code);
    const consumptions = await Promise.allSettled([
      auth.consumeOtp(concurrent.id),
      auth.consumeOtp(concurrent.id),
    ]);
    expect(
      consumptions.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      consumptions.filter((result) => result.status === 'rejected'),
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

describe.skipIf(!databaseUrl)(
  'member registration integrity and limits',
  () => {
    let database: DatabaseService;
    let auth: AuthService;
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
      try {
        await migrate(database.pool);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'message' in error &&
            String(error.message).includes('pg_type_typname_nsp_index')
          )
        ) {
          throw error;
        }
      }
      auth = createAuthService();
    });

    beforeEach(() => {
      vi.restoreAllMocks();
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

    async function expectFullRegistrationRollback(
      email: string,
      otpId: string,
    ) {
      const accountRows = await database.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, email));
      expect(accountRows).toHaveLength(0);

      const otpRows = await database.db
        .select({
          verifiedAt: memberEmailOtps.verifiedAt,
          usedAt: memberEmailOtps.usedAt,
        })
        .from(memberEmailOtps)
        .where(eq(memberEmailOtps.id, otpId))
        .limit(1);
      expect(otpRows[0]?.verifiedAt).not.toBeNull();
      expect(otpRows[0]?.usedAt).toBeNull();

      const credentialRows = await database.db
        .select()
        .from(credentials)
        .where(
          eq(credentials.accountId, '00000000-0000-0000-0000-000000000000'),
        );

      const memberRows = await database.db
        .select()
        .from(members)
        .where(eq(members.accountId, '00000000-0000-0000-0000-000000000000'));

      const memberProfileRows = await database.db
        .select()
        .from(memberProfiles)
        .where(
          eq(memberProfiles.memberId, '00000000-0000-0000-0000-000000000000'),
        );

      expect(
        credentialRows.length + memberRows.length + memberProfileRows.length,
      ).toBe(0);

      const matchingRecords = await database.db
        .select({ id: members.id })
        .from(members)
        .innerJoin(accounts, eq(members.accountId, accounts.id))
        .where(eq(accounts.email, email))
        .limit(1);
      const matchId = matchingRecords[0]?.id;

      const referralRows = matchId
        ? await database.db
            .select()
            .from(memberReferrals)
            .where(eq(memberReferrals.memberId, matchId))
        : [];
      const referralHistoryRows = matchId
        ? await database.db
            .select()
            .from(memberReferralHistory)
            .where(eq(memberReferralHistory.memberId, matchId))
        : [];
      const termsRows = matchId
        ? await database.db
            .select()
            .from(memberTermsAcceptances)
            .where(eq(memberTermsAcceptances.memberId, matchId))
        : [];
      const historyRows = matchId
        ? await database.db
            .select()
            .from(memberStatusHistory)
            .where(eq(memberStatusHistory.memberId, matchId))
        : [];
      const auditRows = matchId
        ? await database.db
            .select()
            .from(auditLogs)
            .where(
              and(
                eq(auditLogs.action, 'auth.member.registration.completed'),
                eq(auditLogs.entityId, matchId),
              ),
            )
        : [];
      const timelineRows = matchId
        ? await database.db
            .select()
            .from(entityTimelines)
            .where(
              and(
                eq(entityTimelines.eventType, 'member.registered'),
                eq(entityTimelines.entityId, matchId),
              ),
            )
        : [];

      expect(referralRows).toHaveLength(0);
      expect(referralHistoryRows).toHaveLength(0);
      expect(termsRows).toHaveLength(0);
      expect(historyRows).toHaveLength(0);
      expect(auditRows).toHaveLength(0);
      expect(timelineRows).toHaveLength(0);
    }

    describe('transactional rollback', () => {
      it('Early-write rollback: generateToken throws inside transaction, all prior inserts rollback', async () => {
        const email = `${randomUUID()}@example.com`;
        await createActiveMarket();
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);
        // Make generatePublicIdentifier throw after 2 calls (acct prefix + memberPublicId)
        let apiCalls = 0;
        void apiCalls;
        vi.spyOn(
          auth as unknown as {
            generatePublicIdentifier: (prefix: string, len: number) => string;
          },
          'generatePublicIdentifier',
        ).mockImplementation(() => {
          apiCalls += 1;
          // After acct prefix and memberPublicId calls, throw on the retry loop's call
          // Actually the retry loop calls generatePublicIdentifier up to 5 times
          // Just throw to simulate a failure
          throw new Error('Simulated insert failure');
        });
        await expect(
          auth.completeRegistration(initiation.id, randomUUID()),
        ).rejects.toThrow('Simulated insert failure');
        await expectFullRegistrationRollback(email, initiation.id);
        vi.restoreAllMocks();
      });

      it('Mid-transaction rollback: generatePublicIdentifier throws in referral code retry loop', async () => {
        const email = `${randomUUID()}@example.com`;
        await createActiveMarket();
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);
        // Generate a new ID successfully for acct prefix, then throw for memberPublicId
        let callNum = 0;
        vi.spyOn(
          auth as unknown as {
            generatePublicIdentifier: (prefix: string, len: number) => string;
          },
          'generatePublicIdentifier',
        ).mockImplementation((prefix: string, len: number) => {
          callNum += 1;
          if (callNum > 1) {
            throw new Error('Simulated insert failure');
          }
          return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, len).toUpperCase()}`;
        });
        await expect(
          auth.completeRegistration(initiation.id, randomUUID()),
        ).rejects.toThrow('Simulated insert failure');
        await expectFullRegistrationRollback(email, initiation.id);
        vi.restoreAllMocks();
      });

      it('Late-transaction rollback: generateToken throws for referral code generation', async () => {
        const email = `${randomUUID()}@example.com`;
        await createActiveMarket();
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);
        // generateToken is called for acct prefix (via generatePublicIdentifier) AND referral code
        // Throw on first call that's specifically for the referral code generation path
        vi.spyOn(
          auth as unknown as { generateToken: (len: number) => string },
          'generateToken',
        ).mockImplementation(() => {
          throw new Error('Simulated insert failure');
        });
        await expect(
          auth.completeRegistration(initiation.id, randomUUID()),
        ).rejects.toThrow('Simulated insert failure');
        await expectFullRegistrationRollback(email, initiation.id);
        vi.restoreAllMocks();
      });
    });
    describe('email uniqueness', () => {
      it('rejects duplicate emails at initiation with rollback', async () => {
        await createActiveMarket();

        // Register the original member
        const originalEmail = `${randomUUID()}@example.com`;
        const originalInit = await auth.initiateRegistration({
          email: originalEmail,
          password: 'Original-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(originalInit.id, originalInit.code);
        await auth.completeRegistration(originalInit.id, randomUUID());

        // Attempt a second registration with the same email
        // The email-uniqueness check happens in initiateRegistration
        await expect(
          auth.initiateRegistration({
            email: originalEmail,
            password: 'Duplicate-Password-123!',
            accountCountry: 'MY',
            referralCode: null,
            termsVersion: 'v1',
            disclaimerVersion: 'v1',
            privacyVersion: 'v1',
            locale: 'en-MY',
          }),
        ).rejects.toMatchObject({
          code: 'AUTH_MEMBER_ALREADY_EXISTS',
        });

        // Verify the original account still exists (should have 1 record)
        const existingAccountRows = await database.db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.email, originalEmail));
        expect(existingAccountRows).toHaveLength(1);
      });
    });

    it('retries registration with a unique email after a duplicate rejection', async () => {
      await createActiveMarket();

      // Register original member
      const email = `${randomUUID()}@example.com`;
      const originalInit = await auth.initiateRegistration({
        email,
        password: 'Original-Password-123!',
        accountCountry: 'MY',
        referralCode: null,
        termsVersion: 'v1',
        disclaimerVersion: 'v1',
        privacyVersion: 'v1',
        locale: 'en-MY',
      });
      await auth.verifyRegistrationOtp(originalInit.id, originalInit.code);
      await auth.completeRegistration(originalInit.id, randomUUID());

      // Try to initiate with the same email - should be rejected by initiateRegistration
      await expect(
        auth.initiateRegistration({
          email,
          password: 'Duplicate-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        }),
      ).rejects.toMatchObject({ code: 'AUTH_MEMBER_ALREADY_EXISTS' });

      // Register with a different email - should succeed
      const newEmail = `${randomUUID()}@example.com`;
      const newInit = await auth.initiateRegistration({
        email: newEmail,
        password: 'New-Password-123!',
        accountCountry: 'MY',
        referralCode: null,
        termsVersion: 'v1',
        disclaimerVersion: 'v1',
        privacyVersion: 'v1',
        locale: 'en-MY',
      });
      await auth.verifyRegistrationOtp(newInit.id, newInit.code);
      const result = await auth.completeRegistration(newInit.id, randomUUID());
      expect(result).toMatchObject({
        accountId: expect.any(String) as unknown,
        memberId: expect.any(String) as unknown,
      });
    });

    describe('referral code validation', () => {
      it('rejects invalid referral codes with full rollback', async () => {
        const email = `${randomUUID()}@example.com`;
        await createActiveMarket();

        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: 'NONEXISTENT',
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);
        await expect(
          auth.completeRegistration(initiation.id, randomUUID()),
        ).rejects.toMatchObject({
          code: 'AUTH_REFERRAL_INVALID',
        });

        await expectFullRegistrationRollback(email, initiation.id);
      });
    });

    describe('identifier format', () => {
      it('creates unique opaque identifiers', async () => {
        await createActiveMarket();
        const email = `${randomUUID()}@example.com`;
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);
        const result = await auth.completeRegistration(
          initiation.id,
          randomUUID(),
        );

        expect(result.publicMemberId).not.toBe(result.referralCode);
        expect(result.publicMemberId).not.toContain('@');
        expect(result.publicMemberId).not.toContain(email);
        expect(result.referralCode).not.toContain('@');
        expect(result.referralCode).not.toContain(email);

        // Verify publicMemberId doesn't look like a UUID
        expect(result.publicMemberId).not.toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
        );
      });

      it('validates publicMemberId format', async () => {
        await createActiveMarket();
        const email = `${randomUUID()}@example.com`;
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);
        const result = await auth.completeRegistration(
          initiation.id,
          randomUUID(),
        );

        // IPM_ prefix + uppercase + (prefix_len 4 + length 10 = 14 chars total?)
        // publicMemberId = `${prefix.toUpperCase()}_${token}` where token has settings.memberPublicIdLength chars
        // So format: IPM_XXXXXXXXXX
        expect(result.publicMemberId).toMatch(/^IPM_/u);
        expect(result.publicMemberId).toHaveLength(14); // 'IPM_' (4) + 10 chars
        expect(result.publicMemberId).toEqual(
          result.publicMemberId.toUpperCase(),
        );
      });

      it('validates referral code format', async () => {
        await createActiveMarket();
        const email = `${randomUUID()}@example.com`;
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);
        const result = await auth.completeRegistration(
          initiation.id,
          randomUUID(),
        );

        // referralCode has length settings.memberReferralCodeLength (8)
        expect(result.referralCode).toHaveLength(8);
        expect(result.referralCode).toMatch(/^[A-Z0-9]+$/u);
        expect(result.referralCode).toEqual(result.referralCode.toUpperCase());
      });
    });

    describe('OTP purpose separation', () => {
      it('separates registration and password-reset OTP counters by purpose', async () => {
        await createActiveMarket();
        const email = `${randomUUID()}@example.com`;

        // Initiate a registration OTP
        const regInit = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        expect(regInit).toMatchObject({
          id: expect.any(String) as unknown,
          code: expect.any(String) as unknown,
        });

        // Initiate a password-reset OTP for the same email
        const pwdResetInit = await auth.initiatePasswordReset(email);
        expect(pwdResetInit).toMatchObject({
          id: expect.any(String) as unknown,
          code: expect.any(String) as unknown,
        });

        // Both should be distinct OTPs with different purposes
        expect(regInit.id).not.toBe(pwdResetInit.id);

        // Resending registration OTP should not affect password-reset OTP
        await expect(
          auth.resendRegistrationOtp(regInit.id),
        ).rejects.toMatchObject({ code: 'AUTH_OTP_COOLDOWN' });

        // Password-reset OTP should still be valid
        await expect(
          auth.verifyPasswordResetOtp(pwdResetInit.id, pwdResetInit.code),
        ).resolves.toBeUndefined();
      });

      it('enforces registration and password-reset rate limits independently', async () => {
        await createActiveMarket();
        const email = `${randomUUID()}@example.com`;

        // Exhaust registration rate limit
        for (
          let index = 0;
          index < settings.registrationEmailRateLimitCount + 1;
          index += 1
        ) {
          try {
            await auth.initiateRegistration({
              email,
              password: 'Registration-Password-123!',
              accountCountry: 'MY',
              referralCode: null,
              termsVersion: 'v1',
              disclaimerVersion: 'v1',
              privacyVersion: 'v1',
              locale: 'en-MY',
            });
          } catch {
            // Expected rate limit error
          }
        }

        // Registration should be rate limited now
        await expect(
          auth.initiateRegistration({
            email,
            password: 'Registration-Password-123!',
            accountCountry: 'MY',
            referralCode: null,
            termsVersion: 'v1',
            disclaimerVersion: 'v1',
            privacyVersion: 'v1',
            locale: 'en-MY',
          }),
        ).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED' });

        // Password-reset should still work (different rate limit bucket)
        const pwdReset = await auth.initiatePasswordReset(email);
        expect(pwdReset).toMatchObject({
          id: expect.any(String) as unknown,
          code: expect.any(String) as unknown,
        });
      });

      it('enforces IP rate limits for registration and password reset', async () => {
        await createActiveMarket();

        // Exhaust registration IP rate limit with unique emails
        for (
          let index = 0;
          index < settings.registrationIpRateLimitCount + 1;
          index += 1
        ) {
          try {
            await auth.initiateRegistration(
              {
                email: `${randomUUID()}@example.com`,
                password: 'Registration-Password-123!',
                accountCountry: 'MY',
                referralCode: null,
                termsVersion: 'v1',
                disclaimerVersion: 'v1',
                privacyVersion: 'v1',
                locale: 'en-MY',
              },
              { ipAddress: '10.0.0.1' },
            );
          } catch {
            // Expected rate limit error
          }
        }

        // IP should be rate limited for registration
        await expect(
          auth.initiateRegistration(
            {
              email: `${randomUUID()}@example.com`,
              password: 'Registration-Password-123!',
              accountCountry: 'MY',
              referralCode: null,
              termsVersion: 'v1',
              disclaimerVersion: 'v1',
              privacyVersion: 'v1',
              locale: 'en-MY',
            },
            { ipAddress: '10.0.0.1' },
          ),
        ).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED' });

        // Password-reset from same IP should still work (different bucket)
        const pwdReset = await auth.initiatePasswordReset(
          `${randomUUID()}@example.com`,
          { ipAddress: '10.0.0.1' },
        );
        expect(pwdReset).toMatchObject({
          id: expect.any(String) as unknown,
          code: expect.any(String) as unknown,
        });
      });
    });

    describe('password reset neutral response', () => {
      it('returns neutral password-reset response for unknown emails', async () => {
        const unknownEmail = `${randomUUID()}@example.com`;
        const result = await auth.initiatePasswordReset(unknownEmail);
        expect(result).toMatchObject({
          id: expect.any(String) as unknown,
          code: expect.any(String) as unknown,
          expiresAt: expect.any(Date) as unknown,
        });
      });

      it('returns neutral password-reset response for known emails', async () => {
        await createActiveMarket();
        const email = `${randomUUID()}@example.com`;
        const init = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(init.id, init.code);
        await auth.completeRegistration(init.id, randomUUID());

        const result = await auth.initiatePasswordReset(email);
        expect(result).toMatchObject({
          id: expect.any(String) as unknown,
          code: expect.any(String) as unknown,
          expiresAt: expect.any(Date) as unknown,
        });
      });
    });

    describe('resend cooldown', () => {
      it('enforces registration OTP resend cooldown', async () => {
        await createActiveMarket();
        const email = `${randomUUID()}@example.com`;
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Registration-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });

        // Immediately try to resend - should hit cooldown
        await expect(
          auth.resendRegistrationOtp(initiation.id),
        ).rejects.toMatchObject({
          code: 'AUTH_OTP_COOLDOWN',
        });
      });

      describe('public member ID exhaustion', () => {
        it('exhausts all publicMemberId retries and returns AUTH_IDENTIFIER_GENERATION_FAILED with full rollback', async () => {
          await createActiveMarket();

          const occupantEmail = `${randomUUID()}@example.com`;
          const occupantInit = await auth.initiateRegistration({
            email: occupantEmail,
            password: 'Occupant-Password-123!',
            accountCountry: 'MY',
            referralCode: null,
            termsVersion: 'v1',
            disclaimerVersion: 'v1',
            privacyVersion: 'v1',
            locale: 'en-MY',
          });
          await auth.verifyRegistrationOtp(occupantInit.id, occupantInit.code);
          const occupantResult = await auth.completeRegistration(
            occupantInit.id,
            randomUUID(),
          );

          vi.spyOn(
            auth as unknown as {
              generatePublicIdentifier: (prefix: string, len: number) => string;
            },
            'generatePublicIdentifier',
          ).mockReturnValue(occupantResult.publicMemberId);

          const email = `${randomUUID()}@example.com`;
          const initiation = await auth.initiateRegistration({
            email,
            password: 'Exhaustion-Password-123!',
            accountCountry: 'MY',
            referralCode: null,
            termsVersion: 'v1',
            disclaimerVersion: 'v1',
            privacyVersion: 'v1',
            locale: 'en-MY',
          });
          await auth.verifyRegistrationOtp(initiation.id, initiation.code);

          await expect(
            auth.completeRegistration(initiation.id, randomUUID()),
          ).rejects.toMatchObject({
            code: 'AUTH_IDENTIFIER_GENERATION_FAILED',
          });

          const accountRows = await database.db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.email, email));
          expect(accountRows).toHaveLength(0);

          const otpRows = await database.db
            .select({ usedAt: memberEmailOtps.usedAt })
            .from(memberEmailOtps)
            .where(eq(memberEmailOtps.id, initiation.id))
            .limit(1);
          expect(otpRows[0]?.usedAt).toBeNull();

          vi.restoreAllMocks();
        });
      });
    });

    describe('referral code exhaustion', () => {
      it('exhausts all referralCode retries and returns AUTH_IDENTIFIER_GENERATION_FAILED with full rollback', async () => {
        await createActiveMarket();

        const occupantEmail = `${randomUUID()}@example.com`;
        const occupantInit = await auth.initiateRegistration({
          email: occupantEmail,
          password: 'Occupant-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(occupantInit.id, occupantInit.code);
        const occupantResult = await auth.completeRegistration(
          occupantInit.id,
          randomUUID(),
        );

        let callCount = 0;
        vi.spyOn(
          auth as unknown as { generateToken: (len: number) => string },
          'generateToken',
        ).mockImplementation((len: number) => {
          callCount += 1;
          if (callCount <= 2) {
            return `${randomUUID().replaceAll('-', '').slice(0, len).toUpperCase()}`;
          }
          return occupantResult.referralCode;
        });

        const email = `${randomUUID()}@example.com`;
        const initiation = await auth.initiateRegistration({
          email,
          password: 'Exhaustion-Password-123!',
          accountCountry: 'MY',
          referralCode: null,
          termsVersion: 'v1',
          disclaimerVersion: 'v1',
          privacyVersion: 'v1',
          locale: 'en-MY',
        });
        await auth.verifyRegistrationOtp(initiation.id, initiation.code);

        await expect(
          auth.completeRegistration(initiation.id, randomUUID()),
        ).rejects.toMatchObject({
          code: 'AUTH_IDENTIFIER_GENERATION_FAILED',
        });

        const accountRows = await database.db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.email, email));
        expect(accountRows).toHaveLength(0);

        const otpRows = await database.db
          .select({ usedAt: memberEmailOtps.usedAt })
          .from(memberEmailOtps)
          .where(eq(memberEmailOtps.id, initiation.id))
          .limit(1);
        expect(otpRows[0]?.usedAt).toBeNull();

        vi.restoreAllMocks();
      });
    });
  },
);
