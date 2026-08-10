import {
  InMemoryRateLimiter,
  type RateLimitPort,
} from '../auth/rate-limit.port.js';
import type { RedisClientProvider } from './redis.client.js';

/**
 * Atomic fixed-window increment with first-write TTL. Semantics match the
 * InMemoryRateLimiter exactly: the counter increments per consume and the
 * bucket resets when the window expires (`EXPIRE` is set only when the key
 * is first created, i.e. count === 1).
 */
const INCREMENT_AND_EXPIRE_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export interface RedisRateLimiterOptions {
  /** Key namespace; isolate test runs to avoid cross-suite interference. */
  namespace?: string;
}

/**
 * Distributed rate limiter on the frozen `RateLimitPort` (closes AHS-003 /
 * D-019-C / gap audit F-02).
 *
 * Frozen CONFIGURABLE ceilings (10/IP/300s login, 5/email/300s login, and
 * the other versioned auth limits) are supplied by the caller from
 * ConfigService — this class never hard-codes a limit.
 *
 * Graceful degradation (documented policy): when Redis is unreachable every
 * consume falls back to a per-instance InMemoryRateLimiter — the request
 * still succeeds with the same ceiling applied per instance (limits are
 * never bypassed, only their distributed scope). This is a security control:
 * degrading to per-instance limiting is strictly safer than no limiting, and
 * it never touches any PG correctness path.
 */
export class RedisRateLimiter implements RateLimitPort {
  private readonly namespace: string;
  private readonly fallback = new InMemoryRateLimiter();

  constructor(
    private readonly clientProvider: RedisClientProvider,
    options: RedisRateLimiterOptions = {},
  ) {
    this.namespace = options.namespace ?? 'ipoint:ratelimit';
  }

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    try {
      const result: unknown = await this.clientProvider
        .getClient()
        .eval(
          INCREMENT_AND_EXPIRE_SCRIPT,
          1,
          `${this.namespace}:${key}`,
          windowSeconds,
        );
      if (typeof result !== 'number') return false;
      return result <= limit;
    } catch {
      // Graceful degradation: per-instance in-memory limiting, same ceiling.
      return this.fallback.consume(key, limit, windowSeconds);
    }
  }

  /**
   * Reset limiter state (test/dev utility — production code never calls it).
   * Clears the in-memory fallback and every Redis key under the namespace.
   */
  async clear(): Promise<void> {
    this.fallback.clear();
    try {
      const keys = await this.clientProvider
        .getClient()
        .keys(`${this.namespace}:*`);
      if (keys.length > 0) {
        await this.clientProvider.getClient().del(...keys);
      }
    } catch {
      // Redis unreachable: the in-memory fallback is already cleared.
    }
  }
}
