import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { LOCK_PORT, QUEUE_PORT } from './redis.constants.js';
import { RedisClientService } from './redis.client.js';
import { RedisLock } from './lock.port.js';
import { RedisQueue } from './queue.port.js';

/**
 * P8-S7 Redis module (gap audit F-02 / D-019-C).
 *
 * Introduces Redis behind the existing service boundaries: a lazy client
 * (`RedisClientService`), a distributed lock port, a FIFO queue port and
 * (via `RedisRateLimiter`) the distributed rate limiter on the frozen
 * `RateLimitPort`. PostgreSQL remains the source of truth for all business
 * state; Redis lock/queue are for cross-instance coordination on
 * non-correctness surfaces only.
 *
 * All primitives are lazy: constructing the module never opens a Redis
 * connection, and an unreachable Redis degrades gracefully per command
 * (documented in each primitive) instead of crashing callers.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    RedisClientService,
    {
      provide: LOCK_PORT,
      useFactory: (client: RedisClientService) => new RedisLock(client),
      inject: [RedisClientService],
    },
    {
      provide: QUEUE_PORT,
      useFactory: (client: RedisClientService) => new RedisQueue(client),
      inject: [RedisClientService],
    },
  ],
  exports: [RedisClientService, LOCK_PORT, QUEUE_PORT],
})
export class RedisModule {}
