/**
 * P8-S7 Redis integration suite (contract AC: "Redis integration tests
 * (limiter/lock)").
 *
 * Fail-closed (S1-S4/S6 pattern): the destructive part of the suite refuses
 * to run unless DATABASE_URL names a dedicated `ipoint_p8s7_*` database and
 * `P8S7_DESTRUCTIVE_TEST` is set. The guard unit tests run unconditionally.
 *
 * The live-Redis primitive tests skip cleanly when Redis is unreachable
 * (honest skip — never a crash); CI provisions redis:7-alpine in the
 * api-integration job, so they run there and on the host. Graceful-
 * degradation tests need no Redis at all and always run inside the guarded
 * suite.
 *
 * Run (host):
 *   cd apps/api
 *   $env:DATABASE_URL='postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/ipoint_p8s7_test'
 *   $env:P8S7_DESTRUCTIVE_TEST='1'
 *   $env:REDIS_URL='redis://127.0.0.1:6379'
 *   pnpm vitest run src/redis/redis.integration.spec.ts --reporter verbose
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '../auth/rate-limit.port.js';
import { RedisLock } from './lock.port.js';
import { RedisQueue } from './queue.port.js';
import { RedisRateLimiter } from './redis-rate-limiter.js';
import type { RedisClientProvider } from './redis.client.js';

const databaseUrl = process.env['DATABASE_URL'];
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';

export const DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8S7_DESTRUCTIVE_TEST';

const TEST_DATABASE_NAME_PATTERN = /^ipoint_p8s7_[a-z0-9_]{1,63}$/u;

const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
]);

export function testDatabaseName(
  databaseUrlValue: string | undefined,
): string | null {
  if (!databaseUrlValue) return null;
  let name: string;
  try {
    name = new URL(databaseUrlValue).pathname.replace(/^\//u, '').trim();
  } catch {
    return null;
  }
  if (!name) return null;
  if (PROTECTED_DATABASE_NAMES.has(name)) return null;
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) return null;
  return name;
}

export function destructiveTestOptIn(
  env: Record<string, string | undefined>,
): boolean {
  const value = env[DESTRUCTIVE_TEST_OPT_IN_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

describe('P8-S7 destructive fresh-database guard', () => {
  it('accepts only the dedicated ipoint_p8s7_* test pattern', () => {
    expect(
      testDatabaseName(
        'postgresql://user:pass@127.0.0.1:55432/ipoint_p8s7_test',
      ),
    ).toBe('ipoint_p8s7_test');
    expect(
      testDatabaseName('postgres://localhost/ipoint_p8s7_migration_test'),
    ).toBe('ipoint_p8s7_migration_test');
  });

  it('rejects protected maintenance database names', () => {
    for (const name of ['postgres', 'template0', 'template1']) {
      expect(testDatabaseName(`postgresql://localhost/${name}`)).toBeNull();
    }
  });

  it('rejects arbitrary, production-looking or malformed names', () => {
    expect(testDatabaseName('postgresql://localhost/app')).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_dev')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_production'),
    ).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_p8s7')).toBeNull();
    expect(
      testDatabaseName('postgresql://localhost/ipoint_p8s7_bad%2Fname'),
    ).toBeNull();
    expect(testDatabaseName('not a url')).toBeNull();
    expect(testDatabaseName(undefined)).toBeNull();
    expect(testDatabaseName('')).toBeNull();
  });

  it('requires the explicit destructive opt-in', () => {
    expect(destructiveTestOptIn({ P8S7_DESTRUCTIVE_TEST: '1' })).toBe(true);
    expect(destructiveTestOptIn({ P8S7_DESTRUCTIVE_TEST: 'true' })).toBe(true);
    expect(destructiveTestOptIn({ P8S7_DESTRUCTIVE_TEST: 'yes' })).toBe(true);
    expect(destructiveTestOptIn({ P8S7_DESTRUCTIVE_TEST: '0' })).toBe(false);
    expect(destructiveTestOptIn({})).toBe(false);
  });

  it('fail-closes when DATABASE_URL is missing or wrong', () => {
    expect(testDatabaseName(undefined)).toBeNull();
    expect(testDatabaseName('postgresql://localhost/ipoint_ci')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Redis availability probe (top-level, so the skip decision is honest).
// ---------------------------------------------------------------------------

async function probeRedisAvailability(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1_500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });
  try {
    await probe.connect();
    const reply = await probe.ping();
    return reply === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const redisAvailable = await probeRedisAvailability(redisUrl);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!databaseUrl || !destructiveTestOptIn(process.env))(
  'P8-S7 Redis integration (guarded destructive suite)',
  () => {
    let client: Redis | null = null;

    beforeAll(async () => {
      const dbName = testDatabaseName(databaseUrl);
      if (!dbName) {
        throw new Error(
          `P8-S7 integration suite is fail-closed: DATABASE_URL must name a dedicated test database matching ^ipoint_p8s7_[a-z0-9_]+$ and must not be a protected database (received ${databaseUrl ?? 'unset'}).`,
        );
      }
      if (!destructiveTestOptIn(process.env)) {
        throw new Error(
          `P8-S7 integration suite is fail-closed: set ${DESTRUCTIVE_TEST_OPT_IN_ENV}=1 to allow recreating the dedicated test database "${dbName}".`,
        );
      }
      const maintenanceUrl = (databaseUrl ?? '').replace(
        /\/[^/]+$/u,
        '/postgres',
      );
      const maintenance = new Pool({ connectionString: maintenanceUrl });
      await maintenance.query(
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
      );
      await maintenance.query(`CREATE DATABASE "${dbName}"`);
      await maintenance.end();
    });

    afterAll(async () => {
      if (client) {
        await client.quit().catch(() => client?.disconnect());
        client = null;
      }
    });

    describe.skipIf(!redisAvailable)(
      'distributed primitives over live Redis',
      () => {
        beforeAll(async () => {
          client = new Redis(redisUrl, {
            connectTimeout: 3_000,
            maxRetriesPerRequest: 2,
            retryStrategy: (times) => Math.min(times * 200, 2_000),
          });
          await client.ping();
        });

        it('rate limiter enforces the frozen ceilings per key and window (parity with InMemoryRateLimiter)', async () => {
          expect(client).not.toBeNull();
          const provider: RedisClientProvider = {
            getClient: () => client as Redis,
          };
          const limiter = new RedisRateLimiter(provider, {
            namespace: `p8s7:test:${randomUUID()}`,
          });
          const memory = new InMemoryRateLimiter();

          // Frozen login ceilings: 10/IP/300s and 5/email/300s.
          const ipKey = `login:ip:${randomUUID()}`;
          for (let i = 1; i <= 10; i += 1) {
            await expect(limiter.consume(ipKey, 10, 300)).resolves.toBe(true);
            await expect(memory.consume(ipKey, 10, 300)).resolves.toBe(true);
          }
          await expect(limiter.consume(ipKey, 10, 300)).resolves.toBe(false);
          await expect(memory.consume(ipKey, 10, 300)).resolves.toBe(false);

          const emailKey = `login:email:${randomUUID()}@example.com`;
          for (let i = 1; i <= 5; i += 1) {
            await expect(limiter.consume(emailKey, 5, 300)).resolves.toBe(true);
            await expect(memory.consume(emailKey, 5, 300)).resolves.toBe(true);
          }
          await expect(limiter.consume(emailKey, 5, 300)).resolves.toBe(false);
          await expect(memory.consume(emailKey, 5, 300)).resolves.toBe(false);
        });

        it('rate limiter keeps distinct keys independent', async () => {
          expect(client).not.toBeNull();
          const provider: RedisClientProvider = {
            getClient: () => client as Redis,
          };
          const limiter = new RedisRateLimiter(provider, {
            namespace: `p8s7:test:${randomUUID()}`,
          });
          const keyA = `login:ip:${randomUUID()}`;
          const keyB = `login:ip:${randomUUID()}`;
          await expect(limiter.consume(keyA, 2, 300)).resolves.toBe(true);
          await expect(limiter.consume(keyA, 2, 300)).resolves.toBe(true);
          await expect(limiter.consume(keyA, 2, 300)).resolves.toBe(false);
          await expect(limiter.consume(keyB, 2, 300)).resolves.toBe(true);
        });

        it('rate limiter window expires and re-allows', async () => {
          expect(client).not.toBeNull();
          const provider: RedisClientProvider = {
            getClient: () => client as Redis,
          };
          const limiter = new RedisRateLimiter(provider, {
            namespace: `p8s7:test:${randomUUID()}`,
          });
          const key = `login:ip:${randomUUID()}`;
          await expect(limiter.consume(key, 1, 1)).resolves.toBe(true);
          await expect(limiter.consume(key, 1, 1)).resolves.toBe(false);
          await sleep(1_100);
          await expect(limiter.consume(key, 1, 1)).resolves.toBe(true);
        });

        it('lock provides mutual exclusion, token release and expiry', async () => {
          expect(client).not.toBeNull();
          const provider: RedisClientProvider = {
            getClient: () => client as Redis,
          };
          const lock = new RedisLock(provider, {
            namespace: `p8s7:test:${randomUUID()}`,
          });
          const key = `job:dedupe:${randomUUID()}`;

          const token = await lock.acquire(key, 30);
          expect(token).not.toBeNull();
          // Second acquire on the same key must fail (mutual exclusion).
          await expect(lock.acquire(key, 30)).resolves.toBeNull();
          // Wrong token cannot release.
          await expect(lock.release(key, 'wrong-token')).resolves.toBe(false);
          // Owning token releases.
          await expect(lock.release(key, token as string)).resolves.toBe(true);
          // Re-acquirable after release.
          await expect(lock.acquire(key, 30)).resolves.not.toBeNull();

          // TTL expiry: a 1s lock is acquirable again after expiry.
          const expiryKey = `job:expiry:${randomUUID()}`;
          await expect(lock.acquire(expiryKey, 1)).resolves.not.toBeNull();
          await sleep(1_100);
          await expect(lock.acquire(expiryKey, 30)).resolves.not.toBeNull();
        });

        it('queue preserves FIFO order with blocking dequeue', async () => {
          expect(client).not.toBeNull();
          const provider: RedisClientProvider = {
            getClient: () => client as Redis,
          };
          const queue = new RedisQueue(provider, {
            namespace: `p8s7:test:${randomUUID()}`,
          });
          const name = `events:${randomUUID()}`;
          await queue.enqueue(name, 'first');
          await queue.enqueue(name, 'second');
          await queue.enqueue(name, 'third');
          await expect(queue.length(name)).resolves.toBe(3);
          await expect(queue.dequeue(name, 0.1)).resolves.toBe('first');
          await expect(queue.dequeue(name, 0.1)).resolves.toBe('second');
          await expect(queue.dequeue(name, 0.1)).resolves.toBe('third');
          await expect(queue.length(name)).resolves.toBe(0);
          // Empty queue: bounded block returns null (never hangs).
          await expect(queue.dequeue(name, 0.1)).resolves.toBeNull();
        });

        it('rate limiter clear() resets Redis and in-memory state', async () => {
          expect(client).not.toBeNull();
          const provider: RedisClientProvider = {
            getClient: () => client as Redis,
          };
          const namespace = `p8s7:test:${randomUUID()}`;
          const limiter = new RedisRateLimiter(provider, { namespace });
          const key = `login:ip:${randomUUID()}`;
          await expect(limiter.consume(key, 1, 300)).resolves.toBe(true);
          await expect(limiter.consume(key, 1, 300)).resolves.toBe(false);
          await limiter.clear();
          await expect(limiter.consume(key, 1, 300)).resolves.toBe(true);
        });
      },
    );

    describe('graceful degradation when Redis is unreachable', () => {
      // A client that never connects: every command fails fast and cleanly
      // (lazyConnect + enableOfflineQueue:false), with no background retries.
      const deadProvider: RedisClientProvider = {
        getClient: () =>
          new Redis(redisUrl, {
            lazyConnect: true,
            connectTimeout: 500,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
            enableOfflineQueue: false,
          }),
      };

      it('rate limiter falls back to in-memory limiting with the same ceiling (no crash, no correctness impact)', async () => {
        const limiter = new RedisRateLimiter(deadProvider, {
          namespace: `p8s7:dead:${randomUUID()}`,
        });
        const key = `login:ip:${randomUUID()}`;
        for (let i = 1; i <= 10; i += 1) {
          await expect(limiter.consume(key, 10, 300)).resolves.toBe(true);
        }
        await expect(limiter.consume(key, 10, 300)).resolves.toBe(false);
      });

      it('lock fails closed (no acquisition, no release) when Redis is unreachable', async () => {
        const lock = new RedisLock(deadProvider, {
          namespace: `p8s7:dead:${randomUUID()}`,
        });
        await expect(lock.acquire('job:dedupe', 30)).resolves.toBeNull();
        await expect(lock.release('job:dedupe', 'token')).resolves.toBe(false);
      });

      it('queue degrades to a no-op when Redis is unreachable', async () => {
        const queue = new RedisQueue(deadProvider, {
          namespace: `p8s7:dead:${randomUUID()}`,
        });
        await expect(queue.enqueue('events', 'msg')).resolves.toBe(0);
        await expect(queue.dequeue('events', 0.1)).resolves.toBeNull();
        await expect(queue.length('events')).resolves.toBe(0);
      });
    });
  },
);
