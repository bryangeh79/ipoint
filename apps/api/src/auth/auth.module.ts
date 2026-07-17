import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { DatabaseModule } from '../database/database.module.js';
import {
  AUTH_RATE_LIMITER,
  AUTH_SETTINGS,
  AUTH_STORE,
} from './auth.constants.js';
import { AuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService, type AuthSettings } from './auth.service.js';
import { PostgresAuthStore } from './postgres-auth.store.js';
import { InMemoryRateLimiter } from './rate-limit.port.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    PostgresAuthStore,
    { provide: AUTH_STORE, useExisting: PostgresAuthStore },
    { provide: AUTH_RATE_LIMITER, useClass: InMemoryRateLimiter },
    {
      provide: AUTH_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AuthSettings => ({
        otpPepper: config.authOtpPepper,
        accessTtlSeconds: config.authAccessTtlSeconds,
        refreshTtlSeconds: config.authRefreshTtlSeconds,
        otpTtlSeconds: config.authOtpTtlSeconds,
        otpMaxAttempts: config.authOtpMaxAttempts,
        otpResendCooldownSeconds: config.authOtpResendCooldownSeconds,
        idempotencyTtlSeconds: config.authIdempotencyTtlSeconds,
        registrationEmailRateLimitCount:
          config.authRegistrationEmailRateLimitCount,
        registrationEmailRateLimitWindowSeconds:
          config.authRegistrationEmailRateLimitWindowSeconds,
        registrationIpRateLimitCount: config.authRegistrationIpRateLimitCount,
        registrationIpRateLimitWindowSeconds:
          config.authRegistrationIpRateLimitWindowSeconds,
        loginEmailRateLimitCount: config.authLoginEmailRateLimitCount,
        loginEmailRateLimitWindowSeconds:
          config.authLoginEmailRateLimitWindowSeconds,
        loginIpRateLimitCount: config.authLoginIpRateLimitCount,
        loginIpRateLimitWindowSeconds: config.authLoginIpRateLimitWindowSeconds,
        passwordResetEmailRateLimitCount:
          config.authPasswordResetEmailRateLimitCount,
        passwordResetEmailRateLimitWindowSeconds:
          config.authPasswordResetEmailRateLimitWindowSeconds,
        passwordResetIpRateLimitCount: config.authPasswordResetIpRateLimitCount,
        passwordResetIpRateLimitWindowSeconds:
          config.authPasswordResetIpRateLimitWindowSeconds,
        memberPublicIdPrefix: config.authMemberPublicIdPrefix,
        memberPublicIdLength: config.authMemberPublicIdLength,
        memberReferralCodeLength: config.authMemberReferralCodeLength,
      }),
    },
    AuthService,
    AuthGuard,
  ],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
