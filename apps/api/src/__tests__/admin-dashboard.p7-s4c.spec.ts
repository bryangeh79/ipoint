import { describe, expect, it } from 'vitest';
import { DashboardMetricCache } from '../admin-dashboard/admin-dashboard.cache.js';
import { AdminDashboardService } from '../admin-dashboard/admin-dashboard.service.js';
import type { DatabaseService } from '../database/database.service.js';
import type { RbacService } from '../platform-access/rbac.service.js';

/**
 * P7-S4C targeted verification coverage (D-048 §11 P7-S4C; items 4.4/4.7).
 *
 * Replaces the wall-clock-dependent STALE coverage in
 * `admin-dashboard.spec.ts` (which fails whenever the test-run wall clock
 * drifts more than the KPI TTL past its hard-coded FIXED_NOW constant) with
 * deterministic tests: the cache entry's `computedAt` is always relative to
 * the real wall clock (Date.now()), so the tests pass at any run time.
 * Tests only; no production code is touched.
 */

function dbMock(): DatabaseService {
  const marketRow = {
    id: MARKET.id,
    code: MARKET.code,
    currency_code: MARKET.currencyCode,
    timezone: MARKET.timezone,
  };
  return {
    pool: {
      query: async () => ({ rows: [marketRow] }),
    },
  } as unknown as DatabaseService;
}

function rbacMock(allowed = true): RbacService {
  return {
    isAllowed: async () => allowed,
  } as unknown as RbacService;
}

const ACTOR = { adminUserId: '11111111-1111-1111-1111-111111111111' };
const MARKET = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  code: 'MA',
  currencyCode: 'MYR',
  timezone: 'Asia/Kuala_Lumpur',
};

describe('P7-S4C dashboard freshness verification (deterministic)', () => {
  it('serves a cached entry as STALE when its asOf violates the freshness class', async () => {
    // Deterministic at any wall clock: computedAt is 1s old (inside the KPI
    // TTL so the cache serves the entry), while asOf is 400s old (beyond the
    // 5-minute KPI freshness bound). The injected now provider fixes `now`.
    const fixedNow = new Date('2026-08-03T12:00:00.000Z');
    const staleAsOf = new Date(fixedNow.getTime() - 400_000).toISOString();
    const cache = new DashboardMetricCache(16);
    cache.set('M01', MARKET.id, {
      value: { kind: 'COUNT', count: 3 },
      asOf: staleAsOf,
      computedAt: Date.now() - 1_000, // fresh under the real TTL clock
    });

    const service = new AdminDashboardService(
      dbMock(),
      rbacMock(),
      cache,
      () => fixedNow,
    );

    const catalog = await service.catalog(ACTOR, MARKET.id);
    const m01 = catalog.items.find((m) => m.id === 'M01');
    expect(m01?.state).toBe('STALE');
    expect(m01?.asOf).toBe(staleAsOf);

    await expect(service.metric(ACTOR, 'M01', MARKET.id)).rejects.toMatchObject(
      { code: 'DASHBOARD_DATA_STALE' },
    );
  });

  it('preserves the source-query time as asOf on cache hits (never the cache-read time)', async () => {
    // Anchor the injected clock to the real wall clock so the cache TTL
    // (which uses Date.now()) sees the entry as freshly computed.
    const now = new Date(Date.now());
    let currentNow = now;
    const cache = new DashboardMetricCache(16);
    const service = new AdminDashboardService(
      dbMock(),
      rbacMock(),
      cache,
      () => currentNow,
    );

    // First compute: asOf must be the source-query time (T0).
    const first = await service.catalog(ACTOR, MARKET.id);
    const firstM01 = first.items.find((m) => m.id === 'M01');
    expect(firstM01?.state).toBe('FRESH');
    expect(firstM01?.asOf).toBe(now.toISOString());

    // Advance the injected clock by 60s (still within the 5m KPI bound) and
    // read again: the entry is served from cache, and asOf must still be the
    // original source-query time, NOT the cache-read time.
    currentNow = new Date(now.getTime() + 60_000);
    const second = await service.catalog(ACTOR, MARKET.id);
    const secondM01 = second.items.find((m) => m.id === 'M01');
    expect(secondM01?.state).toBe('FRESH');
    expect(secondM01?.asOf).toBe(now.toISOString());
    expect(secondM01?.asOf).not.toBe(currentNow.toISOString());
  });

  it('evicts a cache entry once the wall-clock age exceeds the freshness TTL', async () => {
    // An entry computed 10 minutes ago must never be served for a KPI metric
    // (5-minute bound) even if its asOf claims to be fresh.
    const fixedNow = new Date('2026-08-03T12:00:00.000Z');
    const cache = new DashboardMetricCache(16);
    cache.set('M01', MARKET.id, {
      value: { kind: 'COUNT', count: 3 },
      asOf: fixedNow.toISOString(),
      computedAt: Date.now() - 600_000, // 10 minutes old wall-clock age
    });
    const service = new AdminDashboardService(
      dbMock(),
      rbacMock(),
      cache,
      () => fixedNow,
    );
    const catalog = await service.catalog(ACTOR, MARKET.id);
    const m01 = catalog.items.find((m) => m.id === 'M01');
    // Evicted -> re-queried from the (mock) source -> FRESH with a new asOf.
    expect(m01?.state).toBe('FRESH');
    expect(m01?.asOf).toBe(fixedNow.toISOString());
  });
});
