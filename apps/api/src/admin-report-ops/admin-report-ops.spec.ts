import { describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service.js';
import { AdminReportOpsController } from './admin-report-ops.controller.js';
import { reportCatalog, reportDefinition } from './admin-report-ops.catalog.js';
import { ReportSnapshotCache } from './admin-report-ops.cache.js';
import {
  AdminReportOpsService,
  type ReportActor,
} from './admin-report-ops.service.js';
import {
  buildDaySeries,
  containsRawIdentifier,
  evaluateReportFreshness,
} from './admin-report-ops.types.js';

const MARKET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR: ReportActor = {
  adminUserId: '22222222-2222-4222-8222-222222222222',
};
const MARKET_ROW = {
  id: MARKET_ID,
  code: 'MA',
  status: 'ACTIVE',
  currencyCode: 'MAD',
  timezone: 'Africa/Casablanca',
};

const FIXED_NOW = new Date('2026-08-07T12:00:00.000Z');

function dbMock(
  overrides: {
    marketRow?: unknown;
    rowsByPattern?: Array<{ match: RegExp; rows: unknown[] }>;
    fail?: boolean;
    capture?: string[];
  } = {},
): DatabaseService {
  return {
    pool: {
      query: async (sqlText: string, _params: unknown[]) => {
        if (overrides.capture) overrides.capture.push(sqlText);
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
  cache = new ReportSnapshotCache(64),
  now: () => Date = () => FIXED_NOW,
): AdminReportOpsService {
  return new AdminReportOpsService(database, cache, now);
}

describe('report catalog integrity (P7-S9 + P8-S4)', () => {
  it('defines exactly the 19 bounded reports R01–R19 with unique ids', () => {
    expect(reportCatalog).toHaveLength(19);
    const ids = reportCatalog.map((report) => report.id);
    expect(new Set(ids).size).toBe(19);
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
    // R03 (P7-S9) plus the point-in-time advanced views R07–R11, R17, R19.
    expect(queueReports).toEqual(
      new Set(['R03', 'R07', 'R08', 'R09', 'R10', 'R11', 'R17', 'R19']),
    );
    for (const report of reportCatalog) {
      if (report.freshnessClass === 'QUEUE') {
        expect(report.windowDays).toBe(0); // point-in-time queue counts
      } else {
        expect(report.windowDays).toBeGreaterThan(0); // bounded trailing window
        expect(report.windowDays).toBeLessThanOrEqual(90); // bounded window cap
      }
    }
  });

  it('declares every P8-S4 advanced report read-only over frozen tables (no DML wording)', () => {
    const advanced = reportCatalog.filter(
      (report) => Number(report.id.slice(1)) >= 5,
    );
    expect(advanced).toHaveLength(15);
    for (const report of advanced) {
      const source = report.source.toLowerCase();
      for (const verb of ['insert', 'update', 'delete', 'truncate', 'drop']) {
        expect(
          source.includes(verb),
          `${report.id} source mentions ${verb}`,
        ).toBe(false);
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
    expect(catalog.items).toHaveLength(19);
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
    const cached = new ReportSnapshotCache(64);
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
    const cached = new ReportSnapshotCache(64);
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
    const cache = new ReportSnapshotCache(64);
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

describe('P8-S4 advanced report values (G-04)', () => {
  it('R05 builds the operations overview with real kyc + application counts', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM member_kyc_cases/u,
            rows: [
              { key: 'APPROVED', count: 3 },
              { key: 'SUBMITTED', count: 1 },
            ],
          },
          {
            match: /FROM merchant_applications/u,
            rows: [{ key: 'APPROVED', count: 2 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R05', MARKET_ID);
    expect(detail.state).toBe('FRESH');
    expect(detail.value).toEqual({
      kind: 'OPERATIONS_OVERVIEW',
      windowDays: 90,
      kyc: { total: 4, counts: { APPROVED: 3, SUBMITTED: 1 } },
      merchantApplications: { total: 2, counts: { APPROVED: 2 } },
    });
  });

  it('R06 transports exact-decimal wallet totals as strings (never floats)', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM member_wallet_entries/u,
            rows: [
              { key: 'AVAILABLE', count: 2, total_amount: '30.7500000000' },
              {
                key: 'REDEMPTION_DEBIT',
                count: 1,
                total_amount: '10.0000000000',
              },
            ],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R06', MARKET_ID);
    const value = detail.value as unknown as {
      kind: string;
      groups: Record<string, unknown>;
    };
    expect(value.kind).toBe('LEDGER_VOLUME');
    expect(value.groups['AVAILABLE']).toEqual({
      count: 2,
      totalAmount: '30.7500000000',
    });
    expect(
      typeof (value.groups['AVAILABLE'] as { totalAmount?: unknown })
        .totalAmount,
    ).toBe('string');
  });

  it('R07 builds the reconciliation overview', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM reconciliation_runs/u,
            rows: [
              { key: 'COMPLETED', count: 2 },
              { key: 'FAILED', count: 1 },
            ],
          },
          {
            match: /FROM reconciliation_run_items/u,
            rows: [{ key: 'MATCHED', count: 5 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R07', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'RECONCILIATION_OVERVIEW',
      runs: { total: 3, counts: { COMPLETED: 2, FAILED: 1 } },
      runItems: { total: 5, counts: { MATCHED: 5 } },
    });
  });

  it('R08 builds the market profile with real counts and no raw identifiers', async () => {
    const svc = service(dbMock({ marketRow: MARKET_ROW }));
    const detail = await svc.report(ACTOR, 'R08', MARKET_ID);
    const value = detail.value as unknown as {
      kind: string;
      market: unknown;
      counts: unknown;
    };
    expect(value.kind).toBe('MARKET_PROFILE');
    expect(value.market).toEqual({
      code: 'MA',
      status: 'ACTIVE',
      currencyCode: 'MAD',
      timezone: 'Africa/Casablanca',
    });
    expect(value.counts).toEqual({
      members: 0,
      merchantBranches: 0,
      mcpAccounts: 0,
      activeAgents: 0,
      activeCatalogItems: 0,
    });
    expect(containsRawIdentifier(detail.value)).toBe(false);
  });

  it('R09/R10/R11 are point-in-time status distributions', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /GROUP BY m.status/u,
            rows: [{ key: 'ACTIVE', count: 7 }],
          },
          {
            match: /FROM merchant_branches/u,
            rows: [{ key: 'ACTIVE', count: 4 }],
          },
          {
            match: /FROM agent_activation/u,
            rows: [{ key: 'ACTIVE', count: 2 }],
          },
        ],
      }),
    );
    const r09 = await svc.report(ACTOR, 'R09', MARKET_ID);
    const r10 = await svc.report(ACTOR, 'R10', MARKET_ID);
    const r11 = await svc.report(ACTOR, 'R11', MARKET_ID);
    expect(r09.value).toEqual({
      kind: 'STATUS_COUNTS',
      windowDays: 0,
      total: 7,
      counts: { ACTIVE: 7 },
    });
    expect(r10.value).toMatchObject({
      kind: 'STATUS_COUNTS',
      windowDays: 0,
      total: 4,
    });
    expect(r11.value).toMatchObject({
      kind: 'STATUS_COUNTS',
      windowDays: 0,
      total: 2,
    });
  });

  it('R12 builds the transaction value summary with exact-decimal totals', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /GROUP BY t.currency/u,
            rows: [
              {
                key: 'MYR',
                count: 2,
                total_purchase_amount: '187.0000000000',
                total_service_fee_amount: '10.0000000000',
              },
            ],
          },
          {
            match: /SELECT count\(\*\)::int AS count/u,
            rows: [
              {
                count: 2,
                total_purchase_amount: '187.0000000000',
                total_service_fee_amount: '10.0000000000',
              },
            ],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R12', MARKET_ID);
    const value = detail.value as unknown as {
      kind: string;
      byCurrency: Record<string, unknown>;
      totals: Record<string, unknown>;
    };
    expect(value.kind).toBe('TRANSACTION_VALUE');
    expect(value.byCurrency['MYR']).toEqual({
      count: 2,
      totalPurchaseAmount: '187.0000000000',
      totalServiceFeeAmount: '10.0000000000',
    });
    expect(value.totals).toEqual({
      count: 2,
      totalPurchaseAmount: '187.0000000000',
      totalServiceFeeAmount: '10.0000000000',
    });
  });

  it('R13 builds the MCP overview with account + ledger volume', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM mcp_accounts/u,
            rows: [{ key: 'ACTIVE', count: 3 }],
          },
          {
            match: /FROM mcp_ledger_entries/u,
            rows: [
              { key: 'RECHARGE', count: 1, total_amount: '1000.0000000000' },
            ],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R13', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'MCP_OVERVIEW',
      accounts: { total: 3, counts: { ACTIVE: 3 } },
      ledger: {
        windowDays: 90,
        groups: { RECHARGE: { count: 1, totalAmount: '1000.0000000000' } },
      },
    });
  });

  it('R14 builds the reward accrual overview', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM reward_daily_accruals/u,
            rows: [
              { key: 'AVAILABLE', count: 2, total_amount: '11.0000000000' },
            ],
          },
          {
            match: /FROM reward_plans/u,
            rows: [{ key: 'SCHEDULED', count: 1 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R14', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'REWARD_ACCRUAL',
      windowDays: 90,
      accruals: {
        groups: { AVAILABLE: { count: 2, totalAmount: '11.0000000000' } },
      },
      plans: { total: 1, counts: { SCHEDULED: 1 } },
    });
  });

  it('R15 builds the commission overview (market-code scoped)', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM commission_ledger/u,
            rows: [
              {
                key: 'MEMBER_CONSUMPTION_G1_EARN',
                count: 1,
                total_amount: '5.5000000000',
              },
            ],
          },
          {
            match: /FROM commission_adjustment_request/u,
            rows: [{ key: 'PENDING_CHECKER', count: 2 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R15', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'COMMISSION_OVERVIEW',
      windowDays: 90,
      ledger: {
        groups: {
          MEMBER_CONSUMPTION_G1_EARN: { count: 1, totalAmount: '5.5000000000' },
        },
      },
      adjustments: { total: 2, counts: { PENDING_CHECKER: 2 } },
    });
  });

  it('R16 builds the redemption volume with exact-decimal points totals', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM redemption_orders/u,
            rows: [
              { key: 'CONFIRMED', count: 2, total_points: '20.0000000000' },
            ],
          },
          {
            match: /FROM redemption_catalog_items/u,
            rows: [{ key: 'ACTIVE', count: 1 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R16', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'REDEMPTION_VOLUME',
      windowDays: 90,
      orders: { CONFIRMED: { count: 2, totalPoints: '20.0000000000' } },
      items: { total: 1, counts: { ACTIVE: 1 } },
    });
  });

  it('R17 builds the fulfilment exception overview', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM redemption_fulfilment_exceptions/u,
            rows: [{ total: 3, resolved: 1, unresolved: 2 }],
          },
          {
            match: /FROM redemption_shipping_payments/u,
            rows: [{ key: 'PAID', count: 1 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R17', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'FULFILMENT_OVERVIEW',
      exceptions: { total: 3, resolved: 1, unresolved: 2 },
      shippingPayments: { total: 1, counts: { PAID: 1 } },
    });
  });

  it('R18 builds the refund overview across MCP + redemption', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM mcp_refund_requests/u,
            rows: [{ key: 'PENDING', count: 1 }],
          },
          {
            match: /FROM redemption_refund_requests/u,
            rows: [{ key: 'PENDING_CHECKER', count: 2 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R18', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'REFUND_OVERVIEW',
      windowDays: 90,
      mcp: { total: 1, counts: { PENDING: 1 } },
      redemption: { total: 2, counts: { PENDING_CHECKER: 2 } },
    });
  });

  it('R19 builds the risk / exception overview (risk_* + reconciliation_* only)', async () => {
    const svc = service(
      dbMock({
        rowsByPattern: [
          {
            match: /FROM risk_events/u,
            rows: [{ key: 'HIGH', count: 1 }],
          },
          {
            match: /FROM risk_review_queue/u,
            rows: [{ key: 'OPEN', count: 1 }],
          },
          {
            match: /FROM reconciliation_exceptions/u,
            rows: [{ key: 'OPEN', count: 2 }],
          },
        ],
      }),
    );
    const detail = await svc.report(ACTOR, 'R19', MARKET_ID);
    expect(detail.value).toEqual({
      kind: 'RISK_EXCEPTION_OVERVIEW',
      riskEvents: { total: 1, counts: { HIGH: 1 } },
      riskQueue: { total: 1, counts: { OPEN: 1 } },
      reconciliationExceptions: { total: 2, counts: { OPEN: 2 } },
    });
  });
});

describe('P8-S4 masking + read-only guarantees', () => {
  it('containsRawIdentifier detects raw ids, references and prefixes', () => {
    expect(containsRawIdentifier('3b1d1f3a-8c2e-4b9a-9f0e-2a1c3d4e5f6a')).toBe(
      true,
    );
    expect(containsRawIdentifier('acct_9f8e7d6c')).toBe(true);
    expect(containsRawIdentifier('M-7f8e9d0c')).toBe(true);
    expect(containsRawIdentifier('RCPT_ABC123')).toBe(true);
    expect(containsRawIdentifier('ORD_9f8e7d6c')).toBe(true);
    expect(containsRawIdentifier('ref_member_42')).toBe(true);
    expect(containsRawIdentifier('ik-1d2c3b4a')).toBe(true);
  });

  it('containsRawIdentifier accepts safe aggregate values', () => {
    expect(containsRawIdentifier('CONFIRMED')).toBe(false);
    expect(containsRawIdentifier('MYR')).toBe(false);
    expect(containsRawIdentifier('187.0000000000')).toBe(false);
    expect(containsRawIdentifier('MEMBER_CONSUMPTION_G1_EARN')).toBe(false);
    expect(containsRawIdentifier({ counts: { ACTIVE: 3 }, total: 3 })).toBe(
      false,
    );
    expect(containsRawIdentifier(['ACTIVE', 'PENDING'])).toBe(false);
  });

  it('every advanced report value stays free of raw identifiers', async () => {
    const svc = service(dbMock());
    const catalog = await svc.catalog(ACTOR, MARKET_ID);
    for (const item of catalog.items) {
      if (item.value) {
        expect(
          containsRawIdentifier(item.value),
          `report ${item.id} leaked a raw identifier`,
        ).toBe(false);
      }
    }
  });

  it('runs only SELECT projections with bounded windows — zero DML anywhere', async () => {
    const captured: string[] = [];
    const svc = service(dbMock({ capture: captured }));
    await svc.catalog(ACTOR, MARKET_ID);
    expect(captured.length).toBeGreaterThan(10);
    const dml = /\b(insert|update|delete|truncate|create|drop|alter)\b/iu;
    for (const sqlText of captured) {
      expect(dml.test(sqlText), `DML detected in ${sqlText}`).toBe(false);
      expect(/\bselect\b/iu.test(sqlText)).toBe(true);
    }
  });

  it('bounded windows: KPI reports bound with make_interval, QUEUE reports are point-in-time', async () => {
    for (const definition of reportCatalog) {
      const captured: string[] = [];
      const svc = service(dbMock({ capture: captured }));
      await svc.report(ACTOR, definition.id, MARKET_ID);
      // The market lookup is a scalar lookup, not a report query.
      const dataQueries = captured.filter((sql) => !/FROM markets/u.test(sql));
      expect(dataQueries.length).toBeGreaterThan(0);
      if (definition.freshnessClass === 'KPI') {
        expect(
          dataQueries.some((sql) => sql.includes('make_interval')),
          `KPI report ${definition.id} has no bounded window`,
        ).toBe(true);
      } else {
        expect(
          dataQueries.some((sql) => sql.includes('make_interval')),
          `QUEUE report ${definition.id} must be point-in-time`,
        ).toBe(false);
      }
    }
  });
});

describe('P8-S4 permission + route gating', () => {
  it('both report endpoints require the canonical report.read permission, marketScoped', () => {
    const catalogRequirement = Reflect.getMetadata(
      'ipoint:permission-requirement',
      AdminReportOpsController.prototype.catalog,
    );
    const reportRequirement = Reflect.getMetadata(
      'ipoint:permission-requirement',
      AdminReportOpsController.prototype.report,
    );
    expect(catalogRequirement).toMatchObject({
      permission: 'report.read',
      marketScoped: true,
    });
    expect(reportRequirement).toMatchObject({
      permission: 'report.read',
      marketScoped: true,
    });
  });

  it('the report surface is GET-only (no export / write verbs registered)', () => {
    const methods = [
      Reflect.getMetadata('method', AdminReportOpsController.prototype.catalog),
      Reflect.getMetadata('method', AdminReportOpsController.prototype.report),
    ];
    expect(methods).toEqual([RequestMethod.GET, RequestMethod.GET]);
  });
});
