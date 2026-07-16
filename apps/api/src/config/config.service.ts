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
