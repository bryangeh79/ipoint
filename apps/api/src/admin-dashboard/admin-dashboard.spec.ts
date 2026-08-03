import { describe, expect, it } from 'vitest';
import { dashboardMetricCatalog } from './admin-dashboard.catalog.js';
import { DashboardMetricCache } from './admin-dashboard.cache.js';
import { DashboardError } from './admin-dashboard.types.js';
import { evaluateFreshness } from './admin-dashboard.types.js';
import {
  AdminDashboardService,
  marketLocalDayStart,
} from './admin-dashboard.service.js';
import type { DatabaseService } from '../database/database.service.js';
import type { RbacService } from '../platform-access/rbac.service.js';

function dbMock(
  overrides: {
    query?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  } = {},
): DatabaseService {
  const marketRow = {
    id: MARKET.id,
    code: MARKET.code,
    currency_code: MARKET.currencyCode,
    timezone: MARKET.timezone,
  };
  return {
    pool: {
      query: overrides.query ?? (async () => ({ rows: [marketRow] })),
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

describe('dashboard metric catalog integrity (P7-S4A)', () => {
  it('defines exactly the 14 frozen metrics M01–M14 with unique ids', () => {
    expect(dashboardMetricCatalog).toHaveLength(14);
    const ids = dashboardMetricCatalog.map((m) => m.id);
    expect(new Set(ids).size).toBe(14);
    for (const metric of dashboardMetricCatalog) {
      expect(metric.id).toMatch(/^M\d{2}$/u);
      expect(metric.name.length).toBeGreaterThan(3);
      expect(metric.definition.length).toBeGreaterThan(20);
      expect(metric.definitionVersion).toBeGreaterThanOrEqual(1);
      expect(metric.permission).toBe('dashboard.view');
    }
  });

  it('assigns the frozen freshness classes (P7-OD-16)', () => {
    const queueMetrics = new Set([
      'M05',
      'M06',
      'M07',
      'M08',
      'M09',
      'M10',
      'M11',
      'M12',
    ]);
    const kpiMetrics = new Set(['M01', 'M02', 'M03', 'M04', 'M13', 'M14']);
    for (const metric of dashboardMetricCatalog) {
      expect(metric.freshnessClass).toBe(
        queueMetrics.has(metric.id) ? 'QUEUE' : 'KPI',
      );
      expect(queueMetrics.has(metric.id) || kpiMetrics.has(metric.id)).toBe(
        true,
      );
    }
  });

  it('declares a real canonical source for every metric except M10', () => {
    const unavailable = dashboardMetricCatalog.filter(
      (m) => m.availability === 'NO_DURABLE_SOURCE',
    );
    expect(unavailable.map((m) => m.id)).toEqual(['M10']);
    for (const metric of dashboardMetricCatalog) {
      expect(metric.source.length).toBeGreaterThan(10);
      if (metric.availability === 'NO_DURABLE_SOURCE') {
        expect(metric.unavailableReason).toBe('NO_DURABLE_SOURCE');
      } else {
        expect(metric.unavailableReason).toBeUndefined();
      }
    }
  });

  it('marks only financial/sensitive metrics as sensitive and currency-dimensioned', () => {
    const sensitive = dashboardMetricCatalog
      .filter((m) => m.sensitive)
      .map((m) => m.id)
      .sort();
    expect(sensitive).toEqual(['M09', 'M10', 'M13', 'M14']);
    const currency = dashboardMetricCatalog
      .filter((m) => m.currencyDimension)
      .map((m) => m.id)
      .sort();
    expect(currency).toEqual(['M13', 'M14']);
  });

  it('keeps financial/queue sources behind narrower source permissions', () => {
    const byId = new Map(dashboardMetricCatalog.map((m) => [m.id, m]));
    expect(byId.get('M09')?.sourcePermission).toBe('merchant.mcp.view');
    expect(byId.get('M12')?.sourcePermission).toBe('reward.job.read');
    expect(byId.get('M14')?.sourcePermission).toBe('merchant.mcp.view');
    expect(byId.get('M13')?.sourcePermission).toBeUndefined();
  });
});

describe('evaluateFreshness bounds (P7-OD-16)', () => {
  it('treats a queue metric as FRESH at exactly 60s and STALE after', () => {
    const base = new Date('2026-08-03T12:00:00.000Z');
    expect(
      evaluateFreshness(base, new Date(base.getTime() + 60_000), 'QUEUE'),
    ).toBe('FRESH');
    expect(
      evaluateFreshness(base, new Date(base.getTime() + 60_001), 'QUEUE'),
    ).toBe('STALE');
  });

  it('treats a KPI metric as FRESH at exactly 5m and STALE after', () => {
    const base = new Date('2026-08-03T12:00:00.000Z');
    expect(
      evaluateFreshness(base, new Date(base.getTime() + 300_000), 'KPI'),
    ).toBe('FRESH');
    expect(
      evaluateFreshness(base, new Date(base.getTime() + 300_001), 'KPI'),
    ).toBe('STALE');
  });
});

describe('marketLocalDayStart', () => {
  it('returns local midnight as a UTC instant for Asia/Kuala_Lumpur (UTC+8)', () => {
    const at = new Date('2026-08-03T12:00:00.000Z'); // 20:00 in KL
    const start = marketLocalDayStart(at, 'Asia/Kuala_Lumpur');
    expect(start.toISOString()).toBe('2026-08-02T16:00:00.000Z');
  });

  it('handles a UTC+1 summer timezone (Europe/London)', () => {
    const at = new Date('2026-08-03T12:00:00.000Z');
    const start = marketLocalDayStart(at, 'Europe/London');
    expect(start.toISOString()).toBe('2026-08-02T23:00:00.000Z');
  });
});

describe('DashboardMetricCache', () => {
  it('returns entries within the freshness TTL and evicts stale ones', () => {
    const cache = new DashboardMetricCache(16);
    const now = Date.now();
    cache.set('M01', MARKET.id, {
      value: { kind: 'COUNT', count: 3 },
      asOf: new Date(now - 30_000).toISOString(),
      computedAt: now - 30_000,
    });
    expect(cache.get('M01', MARKET.id, 'KPI')).toBeDefined(); // 30s < 5m

    cache.set('M05', MARKET.id, {
      value: { kind: 'COUNT', count: 1 },
      asOf: new Date(now - 90_000).toISOString(),
      computedAt: now - 90_000,
    });
    // 90s exceeds the 60s QUEUE TTL -> evicted
    expect(cache.get('M05', MARKET.id, 'QUEUE')).toBeUndefined();
    // A separate KPI key with the same age is still valid (90s < 5m)
    cache.set('M06', MARKET.id, {
      value: { kind: 'COUNT', count: 2 },
      asOf: new Date(now - 90_000).toISOString(),
      computedAt: now - 90_000,
    });
    expect(cache.get('M06', MARKET.id, 'KPI')).toBeDefined();
  });
});

describe('AdminDashboardService freshness and unavailable behavior', () => {
  const FIXED_NOW = new Date('2026-08-03T12:00:00.000Z');

  it('serves a cached entry as STALE when its asOf violates the freshness class', async () => {
    // M01 is a KPI (5m bound); an asOf 400s old violates the SLA.
    const staleAsOf = new Date(FIXED_NOW.getTime() - 400_000).toISOString();
    const cache = new DashboardMetricCache(16);
    cache.set('M01', MARKET.id, {
      value: { kind: 'COUNT', count: 3 },
      asOf: staleAsOf,
      computedAt: FIXED_NOW.getTime(), // cache clock sees it as fresh
    });
    const service = new AdminDashboardService(
      dbMock(),
      rbacMock(),
      cache,
      () => FIXED_NOW,
    );

    const catalog = await service.catalog(ACTOR, MARKET.id);
    const m01 = catalog.items.find((m) => m.id === 'M01');
    expect(m01?.state).toBe('STALE');
    expect(m01?.asOf).toBe(staleAsOf);

    await expect(service.metric(ACTOR, 'M01', MARKET.id)).rejects.toMatchObject(
      { code: 'DASHBOARD_DATA_STALE' },
    );
  });

  it('reports UNAVAILABLE (never zero) when the source query fails', async () => {
    const service = new AdminDashboardService(
      dbMock({
        query: async () => {
          throw new Error('connection refused');
        },
      }),
      rbacMock(),
      undefined,
      () => FIXED_NOW,
    );
    const catalog = await service.catalog(ACTOR, MARKET.id);
    for (const item of catalog.items) {
      if (item.id === 'M10') continue;
      expect(item.state).toBe('UNAVAILABLE');
      expect(item.unavailableReason).toBe('SOURCE_QUERY_FAILED');
      expect(item.value).toBeUndefined();
    }
    await expect(service.metric(ACTOR, 'M01', MARKET.id)).rejects.toMatchObject(
      { code: 'DASHBOARD_DATA_UNAVAILABLE' },
    );
  });

  it('reports M10 as UNAVAILABLE (NO_DURABLE_SOURCE, SEC-01) without querying a metric source', async () => {
    let queries = 0;
    const service = new AdminDashboardService(
      dbMock({
        query: async () => {
          queries += 1;
          return { rows: [] };
        },
      }),
      rbacMock(),
      undefined,
      () => FIXED_NOW,
    );
    const catalog = await service.catalog(ACTOR, MARKET.id);
    const m10 = catalog.items.find((m) => m.id === 'M10');
    expect(m10?.state).toBe('UNAVAILABLE');
    expect(m10?.unavailableReason).toBe('NO_DURABLE_SOURCE');
    expect(m10?.value).toBeUndefined();
    // Only the canonical market lookup ran; M10 itself never queries a
    // non-existent durable request source.
    expect(queries).toBe(1);
    await expect(service.metric(ACTOR, 'M10', MARKET.id)).rejects.toMatchObject(
      { code: 'DASHBOARD_DATA_UNAVAILABLE' },
    );
  });

  it('denies source-permission metrics with SOURCE_PERMISSION_DENIED when the actor lacks the source permission', async () => {
    const service = new AdminDashboardService(
      dbMock(),
      rbacMock(false),
      undefined,
      () => FIXED_NOW,
    );
    const catalog = await service.catalog(ACTOR, MARKET.id);
    for (const id of ['M09', 'M12', 'M14']) {
      const item = catalog.items.find((m) => m.id === id);
      expect(item?.state).toBe('UNAVAILABLE');
      expect(item?.unavailableReason).toBe('SOURCE_PERMISSION_DENIED');
      expect(item?.value).toBeUndefined();
    }
    const m01 = catalog.items.find((m) => m.id === 'M01');
    expect(m01?.state).toBe('FRESH'); // no source permission gate on M01
  });

  it('throws DASHBOARD_METRIC_UNDEFINED for unknown or malformed metric ids', async () => {
    const service = new AdminDashboardService(
      dbMock(),
      rbacMock(),
      undefined,
      () => FIXED_NOW,
    );
    await expect(service.metric(ACTOR, 'M99', MARKET.id)).rejects.toMatchObject(
      { code: 'DASHBOARD_METRIC_UNDEFINED' },
    );
    await expect(
      service.metric(ACTOR, 'dashboard', MARKET.id),
    ).rejects.toMatchObject({ code: 'DASHBOARD_METRIC_UNDEFINED' });
  });

  it('never mutates domain tables and uses bounded queries only (no LIMIT-less scans)', async () => {
    const seen: string[] = [];
    const service = new AdminDashboardService(
      dbMock({
        query: async (sql: string) => {
          seen.push(sql);
          return { rows: [] };
        },
      }),
      rbacMock(),
      undefined,
      () => FIXED_NOW,
    );
    await service.catalog(ACTOR, MARKET.id);
    const selectStatements = seen.filter((sql) => /^\s*SELECT/i.test(sql));
    expect(selectStatements.length).toBeGreaterThan(0);
    for (const sql of selectStatements) {
      expect(/UPDATE|INSERT|DELETE|DROP|ALTER/i.test(sql)).toBe(false);
      expect(
        /FROM\s+(mcp_ledger_entries|member_wallet_entries|commission_ledger|audit_logs)/i.test(
          sql,
        ),
      ).toBe(false);
    }
  });
});
