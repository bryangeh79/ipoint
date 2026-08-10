import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { RedisClientService } from '../redis/redis.client.js';
import { RedisRateLimiter } from '../redis/redis-rate-limiter.js';
import {
  AUTH_RATE_LIMITER,
  AUTH_SETTINGS,
  AUTH_STORE,
} from './auth.constants.js';
import type { RateLimitPort } from './rate-limit.port.js';
import { AuthGuard } from './auth.guard.js';
import { AdminGuard } from './admin.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import {
  AdminMfaController,
  AdminSessionController,
} from './admin-auth.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthService, type AuthSettings } from './auth.service.js';
import { PostgresAuthStore } from './postgres-auth.store.js';
import { InMemoryRateLimiter } from './rate-limit.port.js';

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [AuthController, AdminMfaController, AdminSessionController],
  providers: [
    PostgresAuthStore,
    { provide: AUTH_STORE, useExisting: PostgresAuthStore },
    {
      // P8-S7 (F-02 / D-019-C): distributed rate limiter behind the frozen
      // RateLimitPort — closes AHS-003. Provider selection policy:
      //  - NODE_ENV=test keeps the in-memory limiter (frozen test behavior,
      //    deterministic, no Redis dependency in the guarded suites);
      //  - otherwise the Redis limiter is used; when Redis is unreachable it
      //    degrades gracefully to per-instance in-memory limiting with the
      //    same frozen ceilings (no crash, no correctness impact).
      provide: AUTH_RATE_LIMITER,
      inject: [ConfigService, RedisClientService],
      useFactory: (
        config: ConfigService,
        redis: RedisClientService,
      ): RateLimitPort =>
        config.isTest
          ? new InMemoryRateLimiter()
          : new RedisRateLimiter(redis, {
              // Shared namespace across instances: the distributed limiter
              // must bucket on the same keys regardless of process/instance.
              namespace: 'ipoint:ratelimit',
            }),
    },
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
    AdminAuthService,
    AuthGuard,
    AdminGuard,
  ],
  exports: [AuthService, AdminAuthService, AuthGuard, AdminGuard],
})
export class AuthModule {}
