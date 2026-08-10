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
   * reports `false` so readiness can report per-check status honestly. The
   * call waits briefly for the initial connection (bounded, ~400ms) so a
   * just-booted process does not false-negative on a healthy Redis.
   */
  async isAvailable(): Promise<boolean> {
    const client = this.getClient();
    if (client.status !== 'ready') {
      const ready = await this.waitUntilReady(client, 400);
      if (!ready) return false;
    }
    try {
      const reply = await client.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  private async waitUntilReady(
    client: Redis,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (client.status === 'ready') return true;
      if (client.status === 'end' || client.status === 'close') return false;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return client.status === 'ready';
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
