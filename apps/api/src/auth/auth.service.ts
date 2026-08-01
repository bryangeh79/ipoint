import { Inject, Injectable } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  accounts,
  auditLogs,
  authIdempotencyKeys,
  credentials,
  entityTimelines,
  markets,
  memberEmailOtps,
  memberProfiles,
  memberReferralHistory,
  memberReferrals,
  memberStatusHistory,
  memberTermsAcceptances,
  members,
  sessions,
} from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  AUTH_RATE_LIMITER,
  AUTH_SETTINGS,
  AUTH_STORE,
} from './auth.constants.js';
import { AuthError } from './auth.errors.js';
import type { AuthStorePort, NewSession } from './auth-store.port.js';
import type {
  AuthTokens,
  OtpPurpose,
  RequestActor,
  RequestMetadata,
} from './auth.types.js';
import { PasswordHasher } from './password-hasher.js';
import type { RateLimitPort } from './rate-limit.port.js';
import {
  createOpaqueToken,
  createOtpCode,
  hashOpaqueToken,
  hashOtpCode,
} from './secret-tokens.js';

export interface AuthSettings {
  otpPepper: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  idempotencyTtlSeconds: number;
  registrationEmailRateLimitCount: number;
  registrationEmailRateLimitWindowSeconds: number;
  registrationIpRateLimitCount: number;
  registrationIpRateLimitWindowSeconds: number;
  loginEmailRateLimitCount: number;
  loginEmailRateLimitWindowSeconds: number;
  loginIpRateLimitCount: number;
  loginIpRateLimitWindowSeconds: number;
  passwordResetEmailRateLimitCount: number;
  passwordResetEmailRateLimitWindowSeconds: number;
  passwordResetIpRateLimitCount: number;
  passwordResetIpRateLimitWindowSeconds: number;
  memberPublicIdPrefix: string;
  memberPublicIdLength: number;
  memberReferralCodeLength: number;
}

export interface RegistrationInitiationInput {
  email: string;
  password: string;
  accountCountry: string;
  referralCode?: string | null;
  termsVersion: string;
  disclaimerVersion: string;
  privacyVersion: string;
  locale: string;
}

export interface RegistrationCompletionResult {
  accountId: string;
  memberId: string;
  publicMemberId: string;
  referralCode: string;
}

interface IdempotencyRecord<T = unknown> {
  requestHash: string;
  response: T | null;
  statusCode: number | null;
}

export interface IssuedOtp {
  id: string;
  code: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly passwordHasher = new PasswordHasher();

  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStorePort,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimitPort,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async setPassword(accountId: string, password: string): Promise<void> {
    const secretHash = await this.passwordHasher.hash(password);
    await this.store.setPasswordCredential(accountId, secretHash);
  }

  async login(
    email: string,
    password: string,
    metadata: RequestMetadata = {},
  ): Promise<AuthTokens> {
    const normalizedEmail = email.trim().toLowerCase();
    await this.enforceCompositeRateLimit([
      [
        `login:email:${normalizedEmail}`,
        this.settings.loginEmailRateLimitCount,
        this.settings.loginEmailRateLimitWindowSeconds,
      ],
      [
        `login:ip:${metadata.ipAddress ?? 'unknown'}`,
        this.settings.loginIpRateLimitCount,
        this.settings.loginIpRateLimitWindowSeconds,
      ],
    ]);
    const identity = await this.store.findPasswordIdentity(normalizedEmail);
    const valid = identity
      ? await this.passwordHasher.verify(password, identity.secretHash)
      : false;
    if (!identity || !valid) {
      await this.store.recordSecurityEvent({
        eventType: 'AUTH_LOGIN_FAILED',
        result: 'FAILURE',
        metadata,
        details: { identifierHash: hashOpaqueToken(normalizedEmail) },
      });
      throw new AuthError(
        'AUTH_INVALID_CREDENTIALS',
        'The supplied credentials are invalid.',
      );
    }
    this.assertLoginAllowed(identity.status, identity.memberStatus);
    const tokens = await this.createSession(
      identity.accountId,
      randomUUID(),
      metadata,
    );
    await this.store.recordSecurityEvent({
      accountId: identity.accountId,
      eventType: 'AUTH_LOGIN_SUCCEEDED',
      result: 'SUCCESS',
      metadata,
    });
    return tokens;
  }

  async resolveActor(
    accessToken: string,
    foregroundActivity = false,
  ): Promise<RequestActor> {
    const accessTokenHash = hashOpaqueToken(accessToken);
    const session = await this.store.findAccessSession(accessTokenHash);
    const now = new Date();
    if (!session) {
      throw new AuthError('AUTH_SESSION_INVALID', 'The session is invalid.');
    }
    if (session.revokedAt) {
      throw new AuthError(
        session.actorPurpose === 'ADMIN'
          ? 'SESSION_REVOKED'
          : 'AUTH_SESSION_INVALID',
        'The session has been revoked.',
      );
    }
    if (session.expiresAt <= now || session.status !== 'ACTIVE') {
      throw new AuthError('AUTH_SESSION_INVALID', 'The session is invalid.');
    }
    if (session.actorPurpose === 'ADMIN') {
      if (
        !session.adminUserId ||
        session.adminStatus !== 'ACTIVE' ||
        session.adminArchivedAt ||
        !session.hasActiveRole
      ) {
        await this.store.revokeAdminSessions(
          session.adminUserId ?? '',
          'ADMIN_ACCESS_REMOVED',
          now,
        );
        throw new AuthError(
          'ADMIN_ACCESS_REMOVED',
          'Admin access is no longer available.',
        );
      }
      if (session.idleExpiresAt && session.idleExpiresAt <= now) {
        await this.store.revokeSession(accessTokenHash, 'IDLE_EXPIRED', now);
        throw new AuthError(
          'SESSION_IDLE_EXPIRED',
          'The session expired due to inactivity.',
        );
      }
      if (session.absoluteExpiresAt && session.absoluteExpiresAt <= now) {
        await this.store.revokeSession(
          accessTokenHash,
          'ABSOLUTE_EXPIRED',
          now,
        );
        throw new AuthError(
          'SESSION_ABSOLUTE_EXPIRED',
          'The session has expired.',
        );
      }
      if (session.familyMaxExpiresAt && session.familyMaxExpiresAt <= now) {
        await this.store.revokeSession(accessTokenHash, 'FAMILY_EXPIRED', now);
        throw new AuthError(
          'SESSION_FAMILY_EXPIRED',
          'The session family has expired.',
        );
      }
      if (foregroundActivity) {
        await this.store.touchAdminSession(session.id, now);
      }
    }
    return {
      type: session.actorPurpose === 'ADMIN' ? 'ADMIN_USER' : 'ACCOUNT',
      accountId: session.accountId,
      sessionId: session.id,
      ...(session.actorPurpose === 'ADMIN' && session.adminUserId
        ? {
            adminUserId: session.adminUserId,
            mfaRecoveryUsed: session.mfaRecoveryUsed,
          }
        : {}),
    };
  }

  async rotateRefreshToken(
    refreshToken: string,
    metadata: RequestMetadata = {},
  ): Promise<AuthTokens> {
    // Refresh rate limit: IP-based, configurable via env (default 30/60s)
    await this.enforceRateLimit(
      `refresh:${metadata.ipAddress ?? 'unknown'}`,
      parseInt(process.env['AUTH_REFRESH_RATE_LIMIT_COUNT'] ?? '30', 10),
      parseInt(
        process.env['AUTH_REFRESH_RATE_LIMIT_WINDOW_SECONDS'] ?? '60',
        10,
      ),
    );
    const tokens = this.generateTokens();
    const now = new Date();
    const replacement = this.newSession('', randomUUID(), tokens, metadata);
    const result = await this.store.rotateSession(
      hashOpaqueToken(refreshToken),
      replacement,
      now,
    );
    if (result.kind !== 'ROTATED') {
      const reuse = result.kind === 'REUSED';
      await this.store.recordSecurityEvent({
        eventType: reuse
          ? 'AUTH_REFRESH_REUSE_DETECTED'
          : 'AUTH_REFRESH_FAILED',
        result: 'DENIED',
        metadata,
        details: { reason: result.kind },
      });
      throw new AuthError(
        reuse
          ? 'SESSION_REUSE_DETECTED'
          : result.kind === 'IDLE_EXPIRED'
            ? 'SESSION_IDLE_EXPIRED'
            : result.kind === 'ABSOLUTE_EXPIRED'
              ? 'SESSION_ABSOLUTE_EXPIRED'
              : result.kind === 'FAMILY_EXPIRED'
                ? 'SESSION_FAMILY_EXPIRED'
                : 'AUTH_SESSION_INVALID',
        'The refresh session is invalid.',
      );
    }
    await this.store.recordSecurityEvent({
      accountId: result.accountId,
      eventType: 'AUTH_REFRESH_ROTATED',
      result: 'SUCCESS',
      metadata,
    });
    return {
      ...tokens,
      accessExpiresAt: result.accessExpiresAt,
      refreshExpiresAt: result.refreshExpiresAt,
    };
  }

  async createAdminSession(
    accountId: string,
    adminUserId: string,
    metadata: RequestMetadata,
    mfaRecoveryUsed = false,
  ): Promise<AuthTokens> {
    const now = new Date();
    const absoluteExpiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const familyMaxExpiresAt = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    const tokens = this.generateTokens();
    tokens.accessExpiresAt = new Date(
      Math.min(tokens.accessExpiresAt.getTime(), absoluteExpiresAt.getTime()),
    );
    tokens.refreshExpiresAt = new Date(
      Math.min(
        tokens.refreshExpiresAt.getTime(),
        absoluteExpiresAt.getTime(),
        familyMaxExpiresAt.getTime(),
      ),
    );
    await this.store.createSession({
      ...this.newSession(accountId, randomUUID(), tokens, metadata),
      actorPurpose: 'ADMIN',
      adminUserId,
      idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      absoluteExpiresAt,
      familyCreatedAt: now,
      familyMaxExpiresAt,
      mfaRecoveryUsed,
    });
    return tokens;
  }

  async logout(
    accessToken: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    await this.store.revokeSession(
      hashOpaqueToken(accessToken),
      'LOGOUT',
      new Date(),
    );
    await this.store.recordSecurityEvent({
      eventType: 'AUTH_LOGOUT',
      result: 'SUCCESS',
      metadata,
    });
  }

  async initiateRegistration(
    input: RegistrationInitiationInput,
    metadata: RequestMetadata = {},
    idempotencyKey: string | null = null,
  ): Promise<IssuedOtp> {
    const email = input.email.trim().toLowerCase();
    const accountCountry = input.accountCountry.trim().toUpperCase();
    const referralCode = input.referralCode?.trim().toUpperCase() ?? null;
    const scope = 'member.registration.initiate';
    const requestPayload = {
      email,
      password: input.password,
      accountCountry,
      referralCode,
      termsVersion: input.termsVersion.trim(),
      disclaimerVersion: input.disclaimerVersion.trim(),
      privacyVersion: input.privacyVersion.trim(),
      locale: input.locale.trim(),
    };
    if (idempotencyKey) {
      const cached = await this.checkIdempotency<IssuedOtp>(
        scope,
        idempotencyKey,
        requestPayload,
      );
      if (cached?.response) {
        return cached.response;
      }
    }
    const now = new Date();
    await this.enforceCompositeRateLimit([
      [
        `registration:email:${email}`,
        this.settings.registrationEmailRateLimitCount,
        this.settings.registrationEmailRateLimitWindowSeconds,
      ],
      [
        `registration:ip:${metadata.ipAddress ?? 'unknown'}`,
        this.settings.registrationIpRateLimitCount,
        this.settings.registrationIpRateLimitWindowSeconds,
      ],
    ]);
    await this.assertEmailAvailable(email);
    const passwordHash = await this.passwordHasher.hash(input.password);
    const existing = await this.database.db
      .select({
        id: memberEmailOtps.id,
        otpVersion: memberEmailOtps.otpVersion,
      })
      .from(memberEmailOtps)
      .where(
        and(
          eq(memberEmailOtps.email, email),
          eq(memberEmailOtps.purpose, 'REGISTRATION'),
          isNull(memberEmailOtps.usedAt),
        ),
      )
      .limit(1);
    const id = existing[0]?.id ?? randomUUID();
    const code = createOtpCode();
    const expiresAt = new Date(
      now.getTime() + this.settings.otpTtlSeconds * 1000,
    );
    const resendAvailableAt = new Date(
      now.getTime() + this.settings.otpResendCooldownSeconds * 1000,
    );
    const values = {
      purpose: 'REGISTRATION' as const,
      email,
      accountCountry,
      passwordHash,
      referralCode,
      referrerMemberId: null,
      termsVersion: input.termsVersion.trim(),
      disclaimerVersion: input.disclaimerVersion.trim(),
      privacyVersion: input.privacyVersion.trim(),
      locale: input.locale.trim(),
      otpHash: hashOtpCode(id, code, this.settings.otpPepper),
      otpVersion: existing[0] ? existing[0].otpVersion + 1 : 1,
      attempts: 0,
      maxAttempts: this.settings.otpMaxAttempts,
      expiresAt,
      resendAvailableAt,
      verifiedAt: null,
      usedAt: null,
      updatedAt: now,
    };
    if (existing[0]) {
      await this.database.db
        .update(memberEmailOtps)
        .set(values)
        .where(eq(memberEmailOtps.id, id));
    } else {
      await this.database.db.insert(memberEmailOtps).values({
        id,
        ...values,
      });
    }
    await this.store.recordSecurityEvent({
      eventType: 'AUTH_REGISTRATION_OTP_ISSUED',
      result: 'SUCCESS',
      metadata,
      details: { purpose: 'REGISTRATION' },
    });
    const issued = { id, code, expiresAt };
    if (idempotencyKey) {
      await this.recordIdempotency(
        scope,
        idempotencyKey,
        requestPayload,
        issued,
        202,
      );
    }
    return issued;
  }

  async resendRegistrationOtp(
    otpId: string,
    metadata: RequestMetadata = {},
  ): Promise<IssuedOtp> {
    const now = new Date();
    const otp = await this.requireRegistrationOtp(otpId);
    if (otp.usedAt) {
      throw new AuthError(
        'AUTH_FLOW_INVALID',
        'The registration flow is invalid.',
      );
    }
    if (otp.resendAvailableAt > now) {
      throw new AuthError(
        'AUTH_OTP_COOLDOWN',
        'Please wait before resending.',
        {
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((otp.resendAvailableAt.getTime() - now.getTime()) / 1000),
          ),
        },
      );
    }
    const code = createOtpCode();
    const expiresAt = new Date(
      now.getTime() + this.settings.otpTtlSeconds * 1000,
    );
    const resendAvailableAt = new Date(
      now.getTime() + this.settings.otpResendCooldownSeconds * 1000,
    );
    await this.database.db
      .update(memberEmailOtps)
      .set({
        otpHash: hashOtpCode(otp.id, code, this.settings.otpPepper),
        otpVersion: otp.otpVersion + 1,
        attempts: 0,
        expiresAt,
        resendAvailableAt,
        verifiedAt: null,
        updatedAt: now,
      })
      .where(eq(memberEmailOtps.id, otp.id));
    await this.store.recordSecurityEvent({
      eventType: 'AUTH_REGISTRATION_OTP_RESENT',
      result: 'SUCCESS',
      metadata,
      details: { purpose: 'REGISTRATION' },
    });
    return { id: otp.id, code, expiresAt };
  }

  async verifyRegistrationOtp(
    otpId: string,
    code: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    await this.verifyMemberOtp(otpId, code, 'REGISTRATION', metadata);
  }

  async completeRegistration(
    otpId: string,
    idempotencyKey: string,
    metadata: RequestMetadata = {},
  ): Promise<RegistrationCompletionResult> {
    const scope = 'member.registration.complete';
    const requestPayload = { otpId };
    const cached = await this.checkIdempotency(
      scope,
      idempotencyKey,
      requestPayload,
    );
    if (cached?.response) {
      return cached.response as RegistrationCompletionResult;
    }
    const requestHash = this.hashJson(requestPayload);
    const existingRecords = await this.database.db
      .select({ key: authIdempotencyKeys.key })
      .from(authIdempotencyKeys)
      .where(
        and(
          eq(authIdempotencyKeys.scope, scope),
          eq(authIdempotencyKeys.requestHash, requestHash),
        ),
      )
      .limit(1);
    if (existingRecords[0] && existingRecords[0].key !== idempotencyKey) {
      throw new AuthError(
        'AUTH_IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used for a different request.',
      );
    }
    const now = new Date();
    const result = await this.database.runTransaction(async (tx) => {
      const otpRows = await tx
        .select()
        .from(memberEmailOtps)
        .where(eq(memberEmailOtps.id, otpId))
        .limit(1);
      const otp = otpRows[0];
      if (
        !otp ||
        otp.purpose !== 'REGISTRATION' ||
        otp.usedAt ||
        !otp.verifiedAt
      ) {
        throw new AuthError(
          'AUTH_FLOW_INVALID',
          'The registration flow is invalid.',
        );
      }
      const marketRows = await tx
        .select({ id: markets.id })
        .from(markets)
        .where(
          and(
            eq(markets.code, otp.accountCountry ?? ''),
            eq(markets.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      const marketId = marketRows[0]?.id;
      if (!marketId) {
        throw new AuthError(
          'AUTH_MARKET_INVALID',
          'The account country is invalid.',
        );
      }
      const accountExists = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.email, otp.email))
        .limit(1);
      if (accountExists[0]) {
        throw new AuthError(
          'AUTH_MEMBER_ALREADY_EXISTS',
          'An account with this email already exists.',
        );
      }
      const accountPublicId = this.generatePublicIdentifier('acct', 16);
      const identifierAttemptLimit = 5;
      let memberPublicId: string | null = null;
      let memberReferralCode: string | null = null;

      for (let attempt = 0; attempt < identifierAttemptLimit; attempt += 1) {
        const candidate = this.generatePublicIdentifier(
          this.settings.memberPublicIdPrefix,
          this.settings.memberPublicIdLength,
        );
        const conflict = await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.publicMemberId, candidate))
          .limit(1);
        if (!conflict[0]) {
          memberPublicId = candidate;
          break;
        }
      }
      if (!memberPublicId) {
        throw new AuthError(
          'AUTH_IDENTIFIER_GENERATION_FAILED',
          'A unique member identifier could not be generated.',
        );
      }

      for (let attempt = 0; attempt < identifierAttemptLimit; attempt += 1) {
        const candidate = this.generateToken(
          this.settings.memberReferralCodeLength,
        );
        const conflict = await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.referralCode, candidate))
          .limit(1);
        if (!conflict[0]) {
          memberReferralCode = candidate;
          break;
        }
      }
      if (!memberReferralCode) {
        throw new AuthError(
          'AUTH_IDENTIFIER_GENERATION_FAILED',
          'A unique referral code could not be generated.',
        );
      }

      const accountInsert = await tx
        .insert(accounts)
        .values({
          publicId: accountPublicId,
          email: otp.email,
          accountCountry: otp.accountCountry ?? '',
          status: 'ACTIVE',
          emailVerifiedAt: now,
        })
        .returning({ id: accounts.id });
      const accountId = accountInsert[0]?.id;
      if (!accountId) {
        throw new Error('Account insert did not return an id.');
      }

      let referrerMemberId: string | null = null;
      let referralCodeSnapshot: string | null = null;
      if (otp.referralCode) {
        const referrerRows = await tx
          .select({
            id: members.id,
            accountId: members.accountId,
            referralCode: members.referralCode,
          })
          .from(members)
          .where(eq(members.referralCode, otp.referralCode))
          .limit(1);
        const referrer = referrerRows[0];
        if (!referrer) {
          throw new AuthError(
            'AUTH_REFERRAL_INVALID',
            'The referral code is invalid.',
          );
        }
        if (referrer.accountId === accountId) {
          throw new AuthError(
            'AUTH_REFERRAL_INVALID',
            'Self-referral is not allowed.',
          );
        }
        referrerMemberId = referrer.id;
        referralCodeSnapshot = referrer.referralCode;
      }

      await tx.insert(credentials).values({
        accountId,
        type: 'PASSWORD',
        secretHash: otp.passwordHash ?? '',
        hashAlgorithm: 'scrypt',
        hashVersion: 1,
      });

      const memberInsert = await tx
        .insert(members)
        .values({
          accountId,
          publicMemberId: memberPublicId,
          referralCode: memberReferralCode,
          status: 'ACTIVE',
          kycLevel: 'LEVEL_1',
        })
        .returning({ id: members.id });
      const memberId = memberInsert[0]?.id;
      if (!memberId) {
        throw new Error('Member insert did not return an id.');
      }

      await tx.insert(memberProfiles).values({
        memberId,
        displayName: otp.email.split('@')[0] ?? otp.email,
        locale: otp.locale,
      });

      if (referrerMemberId) {
        await tx.insert(memberReferrals).values({
          memberId,
          referrerMemberId,
          referralCodeSnapshot: referralCodeSnapshot ?? otp.referralCode ?? '',
          source: 'REGISTRATION',
          status: 'ACTIVE',
        });
        await tx.insert(memberReferralHistory).values({
          memberId,
          oldReferrerMemberId: null,
          newReferrerMemberId: referrerMemberId,
          eventType: 'ASSIGNED',
          correctionReason: 'Registration referral assignment',
          authorizedActorType: 'SYSTEM',
          authorizedActorId: null,
          requestId: idempotencyKey,
        });
      }

      for (const document of [
        { type: 'TERMS', version: otp.termsVersion ?? '' },
        { type: 'DISCLAIMER', version: otp.disclaimerVersion ?? '' },
        { type: 'PRIVACY', version: otp.privacyVersion ?? '' },
      ]) {
        await tx.insert(memberTermsAcceptances).values({
          memberId,
          documentType: document.type,
          documentVersion: document.version,
          locale: otp.locale,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        });
      }

      await tx.insert(memberStatusHistory).values({
        memberId,
        fromStatus: 'PENDING_EMAIL_VERIFICATION',
        toStatus: 'ACTIVE',
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'Registration completed',
      });

      await tx
        .update(memberEmailOtps)
        .set({ usedAt: now, updatedAt: now })
        .where(eq(memberEmailOtps.id, otpId));

      const response: RegistrationCompletionResult = {
        accountId,
        memberId,
        publicMemberId: memberPublicId,
        referralCode: memberReferralCode,
      };

      await tx.insert(auditLogs).values({
        actorType: 'SYSTEM',
        action: 'auth.member.registration.completed',
        entityType: 'member',
        entityId: memberId,
        after: response,
        result: 'SUCCESS',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
      });

      await tx.insert(entityTimelines).values({
        entityType: 'member',
        entityId: memberId,
        eventType: 'member.registered',
        actorType: 'SYSTEM',
        actorId: null,
        marketId,
        summary: 'Member registration completed.',
        metadata: {
          accountId,
          otpId,
          referralCode: otp.referralCode,
        },
      });

      return response;
    });

    await this.recordIdempotency(
      scope,
      idempotencyKey,
      requestPayload,
      result,
      200,
    );
    return result;
  }

  async initiatePasswordReset(
    email: string,
    metadata: RequestMetadata = {},
  ): Promise<IssuedOtp> {
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date();
    await this.enforceCompositeRateLimit([
      [
        `password-reset:email:${normalizedEmail}`,
        this.settings.passwordResetEmailRateLimitCount,
        this.settings.passwordResetEmailRateLimitWindowSeconds,
      ],
      [
        `password-reset:ip:${metadata.ipAddress ?? 'unknown'}`,
        this.settings.passwordResetIpRateLimitCount,
        this.settings.passwordResetIpRateLimitWindowSeconds,
      ],
    ]);
    const identity = await this.store.findPasswordIdentity(normalizedEmail);
    const existing = await this.database.db
      .select({
        id: memberEmailOtps.id,
        otpVersion: memberEmailOtps.otpVersion,
      })
      .from(memberEmailOtps)
      .where(
        and(
          eq(memberEmailOtps.email, normalizedEmail),
          eq(memberEmailOtps.purpose, 'PASSWORD_RESET'),
          isNull(memberEmailOtps.usedAt),
        ),
      )
      .limit(1);
    const id = existing[0]?.id ?? randomUUID();
    const code = createOtpCode();
    const expiresAt = new Date(
      now.getTime() + this.settings.otpTtlSeconds * 1000,
    );
    const values = {
      purpose: 'PASSWORD_RESET' as const,
      memberId: identity?.memberId ?? null,
      accountId: identity?.accountId ?? null,
      email: normalizedEmail,
      accountCountry: null,
      passwordHash: null,
      referralCode: null,
      referrerMemberId: null,
      termsVersion: null,
      disclaimerVersion: null,
      privacyVersion: null,
      locale: null,
      otpHash: hashOtpCode(id, code, this.settings.otpPepper),
      otpVersion: existing[0] ? existing[0].otpVersion + 1 : 1,
      attempts: 0,
      maxAttempts: this.settings.otpMaxAttempts,
      expiresAt,
      resendAvailableAt: new Date(
        now.getTime() + this.settings.otpResendCooldownSeconds * 1000,
      ),
      verifiedAt: null,
      usedAt: null,
      updatedAt: now,
    };
    if (existing[0]) {
      await this.database.db
        .update(memberEmailOtps)
        .set(values)
        .where(eq(memberEmailOtps.id, id));
    } else {
      await this.database.db.insert(memberEmailOtps).values({
        id,
        ...values,
      });
    }
    await this.store.recordSecurityEvent({
      accountId: identity?.accountId ?? undefined,
      eventType: 'AUTH_PASSWORD_RESET_OTP_ISSUED',
      result: 'SUCCESS',
      metadata,
      details: { purpose: 'PASSWORD_RESET' },
    });
    return { id, code, expiresAt };
  }

  async verifyPasswordResetOtp(
    otpId: string,
    code: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    await this.verifyMemberOtp(otpId, code, 'PASSWORD_RESET', metadata);
  }

  async completePasswordReset(
    otpId: string,
    newPassword: string,
    idempotencyKey: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    const scope = 'member.password-reset.complete';
    const requestPayload = { otpId };
    const cached = await this.checkIdempotency(
      scope,
      idempotencyKey,
      requestPayload,
    );
    if (cached) return;
    const now = new Date();
    const secretHash = await this.passwordHasher.hash(newPassword);
    await this.database.runTransaction(async (tx) => {
      const otpRows = await tx
        .select()
        .from(memberEmailOtps)
        .where(eq(memberEmailOtps.id, otpId))
        .limit(1);
      const otp = otpRows[0];
      if (
        !otp ||
        otp.purpose !== 'PASSWORD_RESET' ||
        !otp.accountId ||
        otp.usedAt ||
        !otp.verifiedAt
      ) {
        throw new AuthError(
          'AUTH_FLOW_INVALID',
          'The password reset flow is invalid.',
        );
      }
      await tx
        .insert(credentials)
        .values({
          accountId: otp.accountId,
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
            updatedAt: now,
            revokedAt: null,
          },
        });
      await tx
        .update(sessions)
        .set({ revokedAt: now, revokeReason: 'PASSWORD_RESET' })
        .where(
          and(
            eq(sessions.accountId, otp.accountId),
            isNull(sessions.revokedAt),
          ),
        );
      await tx
        .update(memberEmailOtps)
        .set({ usedAt: now, updatedAt: now })
        .where(eq(memberEmailOtps.id, otpId));
      await tx.insert(auditLogs).values({
        actorType: 'SYSTEM',
        action: 'auth.member.password_reset.completed',
        entityType: 'account',
        entityId: otp.accountId,
        result: 'SUCCESS',
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        after: { accountId: otp.accountId },
      });
    });
    await this.recordIdempotency(
      scope,
      idempotencyKey,
      requestPayload,
      { ok: true },
      200,
    );
    await this.store.recordSecurityEvent({
      accountId: undefined,
      eventType: 'AUTH_PASSWORD_RESET_COMPLETED',
      result: 'SUCCESS',
      metadata,
      details: { otpId },
    });
  }

  async issueOtp(input: {
    accountId?: string;
    destination: string;
    purpose: OtpPurpose;
    metadata?: RequestMetadata;
  }): Promise<IssuedOtp> {
    const destination = input.destination.trim().toLowerCase();
    const metadata = input.metadata ?? {};
    await this.enforceRateLimit(
      `otp:${input.purpose}:${metadata.ipAddress ?? 'unknown'}:${destination}`,
      5,
      3600,
    );
    const id = randomUUID();
    const code = createOtpCode();
    const expiresAt = new Date(Date.now() + this.settings.otpTtlSeconds * 1000);
    await this.store.createOtp({
      id,
      accountId: input.accountId ?? null,
      destination,
      purpose: input.purpose,
      codeHash: hashOtpCode(id, code, this.settings.otpPepper),
      maxAttempts: this.settings.otpMaxAttempts,
      expiresAt,
    });
    await this.store.recordSecurityEvent({
      accountId: input.accountId,
      eventType: 'AUTH_OTP_ISSUED',
      result: 'SUCCESS',
      metadata,
      details: { purpose: input.purpose },
    });
    return { id, code, expiresAt };
  }

  async verifyOtp(
    id: string,
    code: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    const otp = await this.store.findOtp(id);
    const now = new Date();
    if (!otp || otp.consumedAt) {
      throw new AuthError('AUTH_OTP_INVALID', 'The OTP is invalid.');
    }
    if (otp.expiresAt <= now) {
      throw new AuthError('AUTH_OTP_EXPIRED', 'The OTP has expired.');
    }
    if (otp.attempts >= otp.maxAttempts) {
      throw new AuthError(
        'AUTH_OTP_ATTEMPTS_EXHAUSTED',
        'The OTP attempt limit has been reached.',
      );
    }
    const actual = Buffer.from(
      hashOtpCode(id, code, this.settings.otpPepper),
      'hex',
    );
    const expected = Buffer.from(otp.codeHash, 'hex');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      const attempts = await this.store.incrementOtpAttempts(id);
      await this.store.recordSecurityEvent({
        accountId: otp.accountId ?? undefined,
        eventType: 'AUTH_OTP_VERIFY_FAILED',
        result: 'FAILURE',
        metadata,
        details: { purpose: otp.purpose, attempts },
      });
      throw new AuthError('AUTH_OTP_INVALID', 'The OTP is invalid.');
    }
    // A verified, unconsumed OTP remains safe to verify idempotently. This lets
    // clients complete an explicit verify step before the registration/reset
    // transaction consumes the same proof.
    if (otp.verifiedAt) return;
    if (!(await this.store.markOtpVerified(id, now))) {
      throw new AuthError('AUTH_OTP_INVALID', 'The OTP is invalid.');
    }
    await this.store.recordSecurityEvent({
      accountId: otp.accountId ?? undefined,
      eventType: 'AUTH_OTP_VERIFIED',
      result: 'SUCCESS',
      metadata,
      details: { purpose: otp.purpose },
    });
  }

  async issuePasswordResetOtp(
    email: string,
    metadata: RequestMetadata = {},
  ): Promise<IssuedOtp> {
    const normalizedEmail = email.trim().toLowerCase();
    const identity = await this.store.findPasswordIdentity(normalizedEmail);
    return this.issueOtp({
      accountId: identity?.accountId,
      destination: normalizedEmail,
      purpose: 'PASSWORD_RESET',
      metadata,
    });
  }

  async resetPasswordFromOtp(
    otpId: string,
    newPassword: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    const otp = await this.store.findOtp(otpId);
    if (!otp?.accountId || otp.purpose !== 'PASSWORD_RESET') {
      throw new AuthError('AUTH_OTP_INVALID', 'The reset OTP is invalid.');
    }
    await this.resetPassword(otpId, otp.accountId, newPassword, metadata);
  }

  async consumeOtp(id: string): Promise<void> {
    if (!(await this.store.consumeOtp(id, new Date()))) {
      throw new AuthError('AUTH_OTP_INVALID', 'The OTP cannot be consumed.');
    }
  }

  async resetPassword(
    otpId: string,
    accountId: string,
    newPassword: string,
    metadata: RequestMetadata = {},
  ): Promise<void> {
    const secretHash = await this.passwordHasher.hash(newPassword);
    if (
      !(await this.store.resetPasswordWithOtp(
        otpId,
        accountId,
        secretHash,
        new Date(),
      ))
    ) {
      throw new AuthError('AUTH_OTP_INVALID', 'The reset OTP is invalid.');
    }
    await this.store.recordSecurityEvent({
      accountId,
      eventType: 'AUTH_PASSWORD_RESET',
      result: 'SUCCESS',
      metadata,
    });
  }

  private assertLoginAllowed(
    accountStatus: string,
    memberStatus: string | null,
  ): void {
    if (accountStatus !== 'ACTIVE') {
      throw new AuthError(
        'AUTH_ACCOUNT_INACTIVE',
        'The account is not active.',
      );
    }
    if (memberStatus && memberStatus !== 'ACTIVE') {
      throw new AuthError('AUTH_MEMBER_INACTIVE', 'The member is not active.');
    }
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const account = await this.database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.email, email))
      .limit(1);
    if (account[0]) {
      throw new AuthError(
        'AUTH_MEMBER_ALREADY_EXISTS',
        'An account with this email already exists.',
      );
    }
  }

  private async requireRegistrationOtp(otpId: string) {
    const otpRows = await this.database.db
      .select()
      .from(memberEmailOtps)
      .where(eq(memberEmailOtps.id, otpId))
      .limit(1);
    const otp = otpRows[0];
    if (!otp || otp.purpose !== 'REGISTRATION') {
      throw new AuthError(
        'AUTH_FLOW_INVALID',
        'The registration flow is invalid.',
      );
    }
    return otp;
  }

  private async verifyMemberOtp(
    otpId: string,
    code: string,
    purpose: 'REGISTRATION' | 'PASSWORD_RESET',
    metadata: RequestMetadata,
  ): Promise<void> {
    const otpRows = await this.database.db
      .select()
      .from(memberEmailOtps)
      .where(eq(memberEmailOtps.id, otpId))
      .limit(1);
    const otp = otpRows[0];
    const now = new Date();
    if (!otp || otp.purpose !== purpose || otp.usedAt) {
      throw new AuthError('AUTH_OTP_INVALID', 'The OTP is invalid.');
    }
    if (otp.expiresAt <= now) {
      throw new AuthError('AUTH_OTP_EXPIRED', 'The OTP has expired.');
    }
    if (otp.attempts >= otp.maxAttempts) {
      throw new AuthError(
        'AUTH_OTP_ATTEMPTS_EXHAUSTED',
        'The OTP attempt limit has been reached.',
      );
    }
    const actual = Buffer.from(
      hashOtpCode(otpId, code, this.settings.otpPepper),
      'hex',
    );
    const expected = Buffer.from(otp.otpHash, 'hex');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      // Atomic increment to prevent concurrent brute-force bypass.
      // The WHERE clause ensures we never count beyond max_attempts.
      const result = await this.database.pool.query<{ attempts: number }>(
        `UPDATE member_email_otps SET attempts = attempts + 1, updated_at = $2
         WHERE id = $1 AND attempts < max_attempts RETURNING attempts`,
        [otpId, now],
      );
      const attempts = result.rows[0]?.attempts ?? otp.attempts + 1;
      await this.store.recordSecurityEvent({
        accountId: otp.accountId ?? undefined,
        eventType: 'AUTH_MEMBER_OTP_VERIFY_FAILED',
        result: 'FAILURE',
        metadata,
        details: { purpose, attempts },
      });
      throw new AuthError('AUTH_OTP_INVALID', 'The OTP is invalid.');
    }
    if (otp.verifiedAt) {
      return;
    }
    await this.database.db
      .update(memberEmailOtps)
      .set({ verifiedAt: now, updatedAt: now })
      .where(eq(memberEmailOtps.id, otpId));
    await this.store.recordSecurityEvent({
      accountId: otp.accountId ?? undefined,
      eventType:
        purpose === 'REGISTRATION'
          ? 'AUTH_REGISTRATION_OTP_VERIFIED'
          : 'AUTH_PASSWORD_RESET_OTP_VERIFIED',
      result: 'SUCCESS',
      metadata,
      details: { purpose },
    });
  }

  private async enforceCompositeRateLimit(
    buckets: Array<[string, number, number]>,
  ): Promise<void> {
    for (const [key, limit, windowSeconds] of buckets) {
      await this.enforceRateLimit(key, limit, windowSeconds);
    }
  }

  private async enforceRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    if (!(await this.rateLimiter.consume(key, limit, windowSeconds))) {
      throw new AuthError('AUTH_RATE_LIMITED', 'Too many requests.');
    }
  }

  private async checkIdempotency<T = unknown>(
    scope: string,
    key: string,
    payload: unknown,
  ): Promise<IdempotencyRecord<T> | null> {
    const requestHash = this.hashJson(payload);
    const rows = await this.database.db
      .select()
      .from(authIdempotencyKeys)
      .where(
        and(
          eq(authIdempotencyKeys.scope, scope),
          eq(authIdempotencyKeys.key, key),
        ),
      )
      .limit(1);
    const record = rows[0];
    if (!record) return null;
    if (record.requestHash !== requestHash) {
      throw new AuthError(
        'AUTH_IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used for a different request.',
      );
    }
    if (!record.response || record.statusCode === null) {
      throw new AuthError(
        'AUTH_IDEMPOTENCY_CONFLICT',
        'The idempotency key is still in progress.',
      );
    }
    return {
      requestHash,
      response: record.response as T,
      statusCode: record.statusCode,
    };
  }

  private async recordIdempotency<T = unknown>(
    scope: string,
    key: string,
    payload: unknown,
    response: T,
    statusCode: number,
  ): Promise<void> {
    const requestHash = this.hashJson(payload);
    const responseHash = this.hashJson(response);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.settings.idempotencyTtlSeconds * 1000,
    );
    try {
      await this.database.db.insert(authIdempotencyKeys).values({
        scope,
        key,
        requestHash,
        responseHash,
        response,
        statusCode,
        expiresAt,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        (error as { code?: string }).code !== '23505'
      ) {
        throw error;
      }
      const existing = await this.database.db
        .select()
        .from(authIdempotencyKeys)
        .where(
          and(
            eq(authIdempotencyKeys.scope, scope),
            eq(authIdempotencyKeys.key, key),
          ),
        )
        .limit(1);
      const record = existing[0];
      if (!record || record.requestHash !== requestHash) {
        throw new AuthError(
          'AUTH_IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used for a different request.',
        );
      }
    }
  }

  private hashJson(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private generateToken(length: number): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(length);
    let token = '';
    for (let index = 0; index < length; index += 1) {
      const n = bytes[index];
      token += alphabet[n! % alphabet.length];
    }
    return token;
  }

  private generatePublicIdentifier(prefix: string, length: number): string {
    return `${prefix.toUpperCase()}_${this.generateToken(length)}`;
  }

  private generateTokens(): AuthTokens {
    const now = Date.now();
    return {
      accessToken: createOpaqueToken(),
      refreshToken: createOpaqueToken(),
      accessExpiresAt: new Date(now + this.settings.accessTtlSeconds * 1000),
      refreshExpiresAt: new Date(now + this.settings.refreshTtlSeconds * 1000),
    };
  }

  private newSession(
    accountId: string,
    familyId: string,
    tokens: AuthTokens,
    metadata: RequestMetadata,
  ): NewSession {
    return {
      accountId,
      familyId,
      accessTokenHash: hashOpaqueToken(tokens.accessToken),
      refreshTokenHash: hashOpaqueToken(tokens.refreshToken),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      metadata,
    };
  }

  private async createSession(
    accountId: string,
    familyId: string,
    metadata: RequestMetadata,
  ): Promise<AuthTokens> {
    const tokens = this.generateTokens();
    await this.store.createSession(
      this.newSession(accountId, familyId, tokens, metadata),
    );
    return tokens;
  }
}
