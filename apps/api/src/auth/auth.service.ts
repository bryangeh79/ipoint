import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
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
    await this.enforceRateLimit(
      `login:${metadata.ipAddress ?? 'unknown'}:${normalizedEmail}`,
      5,
      300,
    );
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
    this.assertActive(identity.status);
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

  async resolveActor(accessToken: string): Promise<RequestActor> {
    const session = await this.store.findAccessSession(
      hashOpaqueToken(accessToken),
    );
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.status !== 'ACTIVE'
    ) {
      throw new AuthError('AUTH_SESSION_INVALID', 'The session is invalid.');
    }
    return {
      type: 'ACCOUNT',
      accountId: session.accountId,
      sessionId: session.id,
    };
  }

  async rotateRefreshToken(
    refreshToken: string,
    metadata: RequestMetadata = {},
  ): Promise<AuthTokens> {
    await this.enforceRateLimit(
      `refresh:${metadata.ipAddress ?? 'unknown'}`,
      30,
      60,
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
        reuse ? 'AUTH_REFRESH_REUSED' : 'AUTH_SESSION_INVALID',
        'The refresh session is invalid.',
      );
    }
    await this.store.recordSecurityEvent({
      accountId: result.accountId,
      eventType: 'AUTH_REFRESH_ROTATED',
      result: 'SUCCESS',
      metadata,
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

  private assertActive(status: string): void {
    if (status !== 'ACTIVE') {
      throw new AuthError(
        'AUTH_ACCOUNT_INACTIVE',
        'The account is not active.',
      );
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
