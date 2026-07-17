import { Injectable, Logger } from '@nestjs/common';
import { parseServerEnvironment, type ServerEnvironment } from '@ipoint/config';

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly config: ServerEnvironment;

  constructor() {
    this.logger.log('Validating environment configuration...');
    try {
      this.config = parseServerEnvironment(process.env);
      this.logger.log('Environment configuration validated successfully');
    } catch (error) {
      this.logger.fatal(
        { error },
        'Failed to validate environment configuration',
      );
      throw error;
    }
  }

  get port(): number {
    return this.config.PORT;
  }

  get host(): string {
    return this.config.HOST;
  }

  get nodeEnv(): string {
    return this.config.NODE_ENV;
  }

  get logLevel(): string {
    return this.config.LOG_LEVEL;
  }

  get databaseUrl(): string {
    return this.config.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.config.REDIS_URL;
  }

  get authOtpPepper(): string {
    return this.config.AUTH_OTP_PEPPER;
  }

  get authAccessTtlSeconds(): number {
    return this.config.AUTH_ACCESS_TTL_SECONDS;
  }

  get authRefreshTtlSeconds(): number {
    return this.config.AUTH_REFRESH_TTL_SECONDS;
  }

  get authOtpTtlSeconds(): number {
    return this.config.AUTH_OTP_TTL_SECONDS;
  }

  get authOtpMaxAttempts(): number {
    return this.config.AUTH_OTP_MAX_ATTEMPTS;
  }

  get authOtpResendCooldownSeconds(): number {
    return this.config.AUTH_OTP_RESEND_COOLDOWN_SECONDS;
  }

  get authIdempotencyTtlSeconds(): number {
    return this.config.AUTH_IDEMPOTENCY_TTL_SECONDS;
  }

  get authRegistrationEmailRateLimitCount(): number {
    return this.config.AUTH_REGISTRATION_EMAIL_RATE_LIMIT_COUNT;
  }

  get authRegistrationEmailRateLimitWindowSeconds(): number {
    return this.config.AUTH_REGISTRATION_EMAIL_RATE_LIMIT_WINDOW_SECONDS;
  }

  get authRegistrationIpRateLimitCount(): number {
    return this.config.AUTH_REGISTRATION_IP_RATE_LIMIT_COUNT;
  }

  get authRegistrationIpRateLimitWindowSeconds(): number {
    return this.config.AUTH_REGISTRATION_IP_RATE_LIMIT_WINDOW_SECONDS;
  }

  get authLoginEmailRateLimitCount(): number {
    return this.config.AUTH_LOGIN_EMAIL_RATE_LIMIT_COUNT;
  }

  get authLoginEmailRateLimitWindowSeconds(): number {
    return this.config.AUTH_LOGIN_EMAIL_RATE_LIMIT_WINDOW_SECONDS;
  }

  get authLoginIpRateLimitCount(): number {
    return this.config.AUTH_LOGIN_IP_RATE_LIMIT_COUNT;
  }

  get authLoginIpRateLimitWindowSeconds(): number {
    return this.config.AUTH_LOGIN_IP_RATE_LIMIT_WINDOW_SECONDS;
  }

  get authPasswordResetEmailRateLimitCount(): number {
    return this.config.AUTH_PASSWORD_RESET_EMAIL_RATE_LIMIT_COUNT;
  }

  get authPasswordResetEmailRateLimitWindowSeconds(): number {
    return this.config.AUTH_PASSWORD_RESET_EMAIL_RATE_LIMIT_WINDOW_SECONDS;
  }

  get authPasswordResetIpRateLimitCount(): number {
    return this.config.AUTH_PASSWORD_RESET_IP_RATE_LIMIT_COUNT;
  }

  get authPasswordResetIpRateLimitWindowSeconds(): number {
    return this.config.AUTH_PASSWORD_RESET_IP_RATE_LIMIT_WINDOW_SECONDS;
  }

  get authMemberPublicIdPrefix(): string {
    return this.config.AUTH_MEMBER_PUBLIC_ID_PREFIX;
  }

  get authMemberPublicIdLength(): number {
    return this.config.AUTH_MEMBER_PUBLIC_ID_LENGTH;
  }

  get authMemberReferralCodeLength(): number {
    return this.config.AUTH_MEMBER_REFERRAL_CODE_LENGTH;
  }

  get defaultFallbackMarketCode(): string {
    return this.config.DEFAULT_FALLBACK_MARKET_CODE;
  }

  get appVersion(): string {
    return this.config.APP_VERSION;
  }

  get isDevelopment(): boolean {
    return this.config.NODE_ENV === 'development';
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.config.NODE_ENV === 'test';
  }

  /**
   * Returns the raw parsed environment object.
   */
  get raw(): ServerEnvironment {
    return this.config;
  }
}
