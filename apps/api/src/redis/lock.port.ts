import { randomUUID } from 'node:crypto';
import type { RedisClientProvider } from './redis.client.js';

/**
 * Distributed lock port.
 *
 * P8-S7 contract boundary (gap audit F-02 / O-2): the Redis lock is for
 * cross-instance coordination on NON-correctness surfaces only (job
 * scheduling de-dupe, cache invalidation). It must NEVER replace or weaken
 * PG advisory locks on any financial path (transaction confirm, MCP/iPoint
 * adjustments, reconciliation runs, redemption order).
 */
export interface LockPort {
  /**
   * Attempt to acquire the lock for `ttlSeconds`. Returns a unique token on
   * success, or null when the lock is held by someone else (or Redis is
   * unreachable — fail-closed: no coordination, no acquisition).
   */
  acquire(key: string, ttlSeconds: number): Promise<string | null>;
  /**
   * Release the lock only when the caller still owns it (token match).
   * Returns false when the token no longer owns the lock (e.g. expired) or
   * when Redis is unreachable.
   */
  release(key: string, token: string): Promise<boolean>;
}

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Redis-backed `LockPort` (SET NX EX + token-checked release).
 */
export class RedisLock implements LockPort {
  private readonly namespace: string;

  constructor(
    private readonly clientProvider: RedisClientProvider,
    options: { namespace?: string } = {},
  ) {
    this.namespace = options.namespace ?? 'ipoint:lock';
  }

  async acquire(key: string, ttlSeconds: number): Promise<string | null> {
    const token = randomUUID();
    try {
      const reply = await this.clientProvider
        .getClient()
        .set(`${this.namespace}:${key}`, token, 'EX', ttlSeconds, 'NX');
      return reply === 'OK' ? token : null;
    } catch {
      // Fail-closed: Redis unreachable -> lock cannot be acquired.
      return null;
    }
  }

  async release(key: string, token: string): Promise<boolean> {
    try {
      const result = await this.clientProvider
        .getClient()
        .eval(RELEASE_SCRIPT, 1, `${this.namespace}:${key}`, token);
      return result === 1;
    } catch {
      return false;
    }
  }
}
