import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';

/**
 * Lazy source of an ioredis client. RedisLock / RedisQueue / RedisRateLimiter
 * depend on this interface (not on a concrete client) so that creating the
 * primitives never opens a connection by itself: the client is created on
 * first use via `getClient()`.
 */
export interface RedisClientProvider {
  getClient(): Redis;
}

/**
 * P8-S7 Redis client service (lazy, self-healing, non-fatal).
 *
 * The ioredis client is created lazily on first use and never crashes the
 * process: every `error` event is consumed (ioredis emits `error` for
 * connection failures; an unhandled `error` would crash the process).
 * Reconnection uses bounded exponential backoff (max 2s between attempts),
 * so a Redis that comes back later is picked up without a restart, while a
 * permanently unreachable Redis degrades to the documented per-command
 * behavior of each primitive (limiter falls back to in-memory; lock fails
 * closed; queue degrades to a no-op) instead of hanging callers.
 */
@Injectable()
export class RedisClientService
  implements RedisClientProvider, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisClientService.name);
  private readonly url: string;
  private client: Redis | null = null;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.url = config.redisUrl;
  }

  getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.url, {
        connectTimeout: 3_000,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 200, 2_000),
      });
      this.client.on('error', (error) => {
        this.logger.warn(
          { errorName: error.name, errorMessage: error.message },
          'Redis client error (degraded mode: rate limiter falls back, lock fails closed, queue no-ops)',
        );
      });
      this.client.on('connect', () => {
        this.logger.log('Redis client connected');
      });
    }
    return this.client;
  }

  /**
   * True when Redis responds to PING. Never throws: an unreachable Redis
   * reports `false` so readiness can report per-check status honestly.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const reply = await this.getClient().ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
    this.client = null;
  }
}
