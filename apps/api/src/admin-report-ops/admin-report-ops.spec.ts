import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { reportCatalog, reportDefinition } from './admin-report-ops.catalog.js';
import { ReportSnapshotCache } from './admin-report-ops.cache.js';
import {
  AdminReportOpsService,
  type ReportActor,
} from './admin-report-ops.service.js';
import {
  buildDaySeries,
  evaluateReportFreshness,
} from './admin-report-ops.types.js';

const MARKET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR: ReportActor = {
  adminUserId: '22222222-2222-4222-8222-222222222222',
};
const MARKET_ROW = { id: MARKET_ID, code: 'MA' };

const FIXED_NOW = new Date('2026-08-07T12:00:00.000Z');

function dbMock(
  overrides: {
    marketRow?: unknown;
    rowsByPattern?: Array<{ match: RegExp; rows: unknown[] }>;
    fail?: boolean;
  } = {},
): DatabaseService {
  return {
    pool: {
      query: async (sqlText: string, _params: unknown[]) => {
        if (/FROM markets/u.test(sqlText)) {
          return {
            rows:
              overrides.marketRow === false
                ? []
                : ([overrides.marketRow ?? MARKET_ROW] as unknown[]),
          };
        }
        if (overrides.fail) throw new Error('connection refused');
        for (const pattern of overrides.rowsByPattern ?? []) {
          if (pattern.match.test(sqlText)) return { rows: pattern.rows };
        }
        return { rows: [] };
      },
    },
  } as unknown as DatabaseService;
}

function service(
  database: DatabaseService,
  cache = new ReportSnapshotCache(16),
  now: () => Date = () => FIXED_NOW,
): AdminReportOpsService {
  return new AdminReportOpsService(database, cache, now);
}

describe('report catalog integrity (P7-S9)', () => {
  it('defines exactly the 4 bounded reports R01–R04 with unique ids', () => {
    expect(reportCatalog).toHaveLength(4);
    const ids = reportCatalog.map((report) => report.id);
    expect(new Set(ids).size).toBe(4);
    for (const report of reportCatalog) {
      expect(report.id).toMatch(/^R\d{2}$/u);
      expect(report.permission).toBe('report.read');
      expect(report.availability).toBe('REAL');
      expect(report.definitionVersion).toBeGreaterThanOrEqual(1);
      expect(report.source.length).toBeGreaterThan(10);
      expect(reportDefinition(report.id)).toBe(report);
    }
  });

  it('assigns the frozen freshness classes (P7-OD-16: queues 60s, KPIs 5m)', () => {
    const queueReports = new Set(
      reportCatalog
        .filter((report) => report.freshnessClass === 'QUEUE')
        .map((report) => report.id),
    );
    expect(queueReports).toEqual(new Set(['R03']));
    for (const report of reportCatalog) {
      if (report.freshnessClass === 'QUEUE') {
        expect(report.windowDays).toBe(0); // point-in-time queue counts
      } else {
        expect(report.windowDays).toBeGreaterThan(0); // bounded trailing window
      }
    }
  });
});

describe('evaluateReportFreshness (P7-S9 freshness semantics)', () => {
  it('treats a QUEUE report as FRESH at exactly 60s and STALE after', () => {
    expect(
      evaluateReportFreshness(
        new Date(FIXED_NOW.getTime() - 60_000),
        FIXED_NOW,
        'QUEUE',
      ),
    ).toBe('FRESH');
    expect(
      evaluateReportFreshness(
        new Date(FIXED_NOW.getTime() - 60_001),
        FIXED_NOW,
        'QUEUE',
      ),
    ).toBe('STALE');
  });

  it('treats a KPI report as FRESH at exactly 5m and STALE after', () => {
    expect(
      evaluateReportFreshness(
        new Date(FIXED_NOW.getTime() - 5 * 60_000),
        FIXED_NOW,
        'KPI',
      ),
    ).toBe('FRESH');
    expect(
      evaluateReportFreshness(
        new Date(FIXED_NOW.getTime() - 5 * 60_000 - 1),
        FIXED_NOW,
        'KPI',
      ),
    ).toBe('STALE');
  });
});

describe('buildDaySeries (P7-S9 trend, no fabricated zeros)', () => {
  it('zero-fills days without rows from the authoritative query result', () => {
    const end = new Date('2026-08-07T00:00:00.000Z');
    const days = buildDaySeries(3, end, [
      { day: '2026-08-06', count: 4 },
      { day: '2026-08-07', count: 1 },
    ]);
    expect(days).toEqual([
      { date: '2026-08-05', count: 0 },
      { date: '2026-08-06', count: 4 },
      { date: '2026-08-07', count: 1 },
    ]);
  });
});

describe('AdminReportOpsService (P7-S9)', () => {
  it('serves FRESH real counts with asOf, no stale/unavailable flags', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM transactions/u,
            rows: [
              { key: 'CONFIRMED', count: 12 },
              { key: 'DRAFT', count: 3 },
            ],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R01', MARKET_ID);
    expect(detail.state).toBe('FRESH');
    expect(detail.stale).toBe(false);
    expect(detail.unavailable).toBe(false);
    expect(detail.asOf).toBe(FIXED_NOW.toISOString());
    expect(typeof detail.queryDurationMs).toBe('number');
    expect(detail.value).toEqual({
      kind: 'STATUS_COUNTS',
      windowDays: 30,
      total: 15,
      counts: { CONFIRMED: 12, DRAFT: 3 },
    });
  });

  it('serves the catalog with every report state without failing the request', async () => {
    const svc = service(dbMock());
    const catalog = await svc.catalog(ACTOR, MARKET_ID);
    expect(catalog.marketId).toBe(MARKET_ID);
    expect(catalog.items).toHaveLength(4);
    for (const item of catalog.items) {
      expect(['FRESH', 'STALE', 'UNAVAILABLE']).toContain(item.state);
      expect(typeof item.asOf).toBe('string');
      expect(typeof item.stale).toBe('boolean');
      expect(typeof item.unavailable).toBe('boolean');
    }
  });

  it('serves a cached snapshot as FRESH without re-querying (bounded TTL)', async () => {
    const database = dbMock({
      rowsByPattern: [
        {
          match: /FROM transactions/u,
          rows: [{ key: 'CONFIRMED', count: 7 }],
        },
      ],
    });
    const pool = database.pool;
    const original = pool.query.bind(pool);
    let queryCount = 0;
    pool.query = (async (sqlText: string, params: unknown[]) => {
      if (/FROM transactions/u.test(sqlText)) queryCount += 1;
      return original(sqlText, params);
    }) as typeof pool.query;
    const cached = new ReportSnapshotCache(16);
    const svc = new AdminReportOpsService(database, cached, () => FIXED_NOW);
    const first = await svc.report(ACTOR, 'R01', MARKET_ID);
    const second = await svc.report(ACTOR, 'R01', MARKET_ID);
    expect(second.state).toBe('FRESH');
    expect(second.asOf).toBe(first.asOf); // snapshot asOf, not cache-read time
    expect(second.queryDurationMs).toBeUndefined(); // cache hit — no query
    expect(queryCount).toBe(1);
  });

  it('reports UNAVAILABLE (never a fabricated zero) when the source query fails with no snapshot', async () => {
    const svc = service(dbMock({ fail: true }));
    const catalog = await svc.catalog(ACTOR, MARKET_ID);
    for (const item of catalog.items) {
      expect(item.state).toBe('UNAVAILABLE');
      expect(item.unavailableReason).toBe('SOURCE_QUERY_FAILED');
      expect(item.unavailable).toBe(true);
      expect(item.stale).toBe(false);
      expect(item.value).toBeUndefined(); // never a zero stand-in
    }
    await expect(svc.report(ACTOR, 'R01', MARKET_ID)).rejects.toMatchObject({
      code: 'REPORT_DATA_UNAVAILABLE',
    });
  });

  it('serves the previous snapshot explicitly marked STALE when a live re-query fails', async () => {
    let failNext = false;
    const database = dbMock({
      rowsByPattern: [
        {
          match: /FROM transactions/u,
          rows: [{ key: 'CONFIRMED', count: 5 }],
        },
      ],
    });
    const pool = database.pool;
    const original = pool.query.bind(pool);
    pool.query = (async (sqlText: string, params: unknown[]) => {
      if (/FROM transactions/u.test(sqlText) && failNext) {
        throw new Error('source down');
      }
      return original(sqlText, params);
    }) as typeof pool.query;
    const cached = new ReportSnapshotCache(16);
    const svc = new AdminReportOpsService(database, cached, () => FIXED_NOW);
    const first = await svc.report(ACTOR, 'R01', MARKET_ID);
    expect(first.state).toBe('FRESH');

    // Expire the previous snapshot under the real TTL clock (computedAt
    // older than the 5m KPI bound), then fail the live re-query: the
    // service must serve the snapshot explicitly marked STALE (asOf = the
    // snapshot's source-query time), never as fresh data and never as a
    // fabricated zero.
    const staleAsOf = new Date(FIXED_NOW.getTime() - 400_000).toISOString();
    cached.clear();
    cached.set('R01', MARKET_ID, {
      value: first.value!,
      asOf: staleAsOf,
      computedAt: Date.now() - 400_000,
    });
    failNext = true;

    const staleCatalog = await svc.catalog(ACTOR, MARKET_ID);
    const r01 = staleCatalog.items.find((item) => item.id === 'R01');
    expect(r01?.state).toBe('STALE');
    expect(r01?.stale).toBe(true);
    expect(r01?.unavailable).toBe(false);
    expect(r01?.asOf).toBe(staleAsOf);
    expect(r01?.value).toEqual(first.value);
    await expect(svc.report(ACTOR, 'R01', MARKET_ID)).rejects.toMatchObject({
      code: 'REPORT_DATA_STALE',
    });
  });

  it('throws REPORT_MARKET_NOT_FOUND for a missing market', async () => {
    const svc = service(dbMock({ marketRow: false }));
    await expect(svc.catalog(ACTOR, MARKET_ID)).rejects.toMatchObject({
      code: 'REPORT_MARKET_NOT_FOUND',
    });
    await expect(svc.report(ACTOR, 'R01', MARKET_ID)).rejects.toMatchObject({
      code: 'REPORT_MARKET_NOT_FOUND',
    });
  });

  it('throws REPORT_UNDEFINED for ids outside the catalog', async () => {
    const svc = service(dbMock());
    await expect(svc.report(ACTOR, 'R99', MARKET_ID)).rejects.toMatchObject({
      code: 'REPORT_UNDEFINED',
    });
    await expect(svc.report(ACTOR, 'bogus', MARKET_ID)).rejects.toMatchObject({
      code: 'REPORT_UNDEFINED',
    });
  });
});

describe('ReportSnapshotCache (P7-S9)', () => {
  it('returns entries within the freshness TTL and evicts stale ones', () => {
    const cache = new ReportSnapshotCache(16);
    const now = Date.now();
    cache.set('R01', MARKET_ID, {
      value: { kind: 'STATUS_COUNTS', windowDays: 30, total: 1, counts: {} },
      asOf: new Date(now - 30_000).toISOString(),
      computedAt: now - 30_000,
    });
    expect(cache.get('R01', MARKET_ID, 'KPI')).toBeDefined(); // 30s < 5m

    // peek ignores the TTL: the expired snapshot remains available ONLY for
    // the explicit STALE-serving path.
    cache.set('R03', MARKET_ID, {
      value: { kind: 'QUEUE_OVERVIEW', orders: {}, fulfilments: {} },
      asOf: new Date(now - 90_000).toISOString(),
      computedAt: now - 90_000,
    });
    expect(cache.peek('R03', MARKET_ID)).toBeDefined();
    // 90s exceeds the 60s QUEUE TTL -> treated as expired on read (NOT
    // deleted: the entry stays available via peek for the explicit STALE
    // serving path after a failed live re-query).
    expect(cache.get('R03', MARKET_ID, 'QUEUE')).toBeUndefined();
    expect(cache.peek('R03', MARKET_ID)).toBeDefined();
  });
});
