/**
 * Admin Basic Reports read-model types (P7-S9, Command Center 2026-08-07
 * §7.2).
 *
 * On-screen, market-scoped, bounded operational reports aggregated from
 * existing canonical owner tables. No new business rules are introduced
 * and NO export exists: there is no CSV/download surface anywhere in this
 * module (Command Center §7: export is explicitly prohibited).
 *
 * Freshness semantics (every report carries all four fields):
 * - `asOf` — source-query time (never the cache-read time);
 * - `freshness` — FRESH | STALE | UNAVAILABLE;
 * - `stale` — true only when a previous snapshot is served because the
 *   live source query failed (the snapshot is explicitly marked stale);
 * - `unavailable` — true with `unavailableReason` when no compliant value
 *   exists; a missing/failed source NEVER produces a fabricated zero.
 *
 * Performance targets (P7-OD-16 frozen SLA): QUEUE ≤ 60s, KPI ≤ 5m. All
 * report queries are bounded (trailing windows, GROUP BY over the
 * selected market, no unbounded scans) and measured (`queryDurationMs`).
 */

export const REPORT_CATALOG_VERSION = 1;

export type ReportFreshnessClass = 'QUEUE' | 'KPI';

export type ReportFreshnessState = 'FRESH' | 'STALE' | 'UNAVAILABLE';

export type ReportUnavailableReason =
  | 'NO_DURABLE_SOURCE'
  | 'SOURCE_QUERY_FAILED';

export type ReportId = 'R01' | 'R02' | 'R03' | 'R04';

/** Frozen freshness SLA (P7-OD-16): 60s queues, 5m KPIs. */
export const REPORT_FRESHNESS_BOUND_MS: Record<ReportFreshnessClass, number> = {
  QUEUE: 60_000,
  KPI: 5 * 60_000,
} as const;

export interface ReportDefinition {
  id: ReportId;
  key: string;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: ReportFreshnessClass;
  /** Canonical permission required to view the report (P7-S9). */
  permission: 'report.read';
  /** Plain-text disclosure of the canonical source tables. */
  source: string;
  availability: 'REAL' | 'NO_DURABLE_SOURCE';
  /** Trailing window (days) the bounded query covers. */
  windowDays: number;
}

export type ReportValue =
  | {
      kind: 'STATUS_COUNTS';
      windowDays: number;
      total: number;
      counts: Record<string, number>;
    }
  | {
      kind: 'ADJUSTMENT_SUMMARY';
      windowDays: number;
      mcp: { total: number; counts: Record<string, number> };
      ipoint: { total: number; counts: Record<string, number> };
    }
  | {
      kind: 'QUEUE_OVERVIEW';
      orders: Record<string, number>;
      fulfilments: Record<string, number>;
    }
  | {
      kind: 'TREND';
      windowDays: number;
      days: Array<{ date: string; registrations: number; activations: number }>;
      totals: { registrations: number; activations: number };
    };

export interface ReportState {
  id: ReportId;
  key: string;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: ReportFreshnessClass;
  permission: 'report.read';
  source: string;
  state: ReportFreshnessState;
  unavailableReason?: ReportUnavailableReason;
  stale: boolean;
  unavailable: boolean;
  asOf: string;
  /** Actual source-query wall time (ms); absent on cache hits. */
  queryDurationMs?: number;
  value?: ReportValue;
}

export interface ReportCatalogResponse {
  asOf: string;
  marketId: string;
  items: ReportState[];
}

export interface ReportDetailResponse extends ReportState {
  marketId: string;
}

export type ReportErrorCode =
  | 'REPORT_MARKET_NOT_FOUND'
  | 'REPORT_DATA_UNAVAILABLE'
  | 'REPORT_DATA_STALE'
  | 'REPORT_UNDEFINED';

export class ReportError extends Error {
  constructor(
    readonly code: ReportErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ReportError';
  }
}

/** Evaluate freshness of a read model against its freshness class. */
export function evaluateReportFreshness(
  asOf: Date,
  now: Date,
  freshnessClass: ReportFreshnessClass,
): ReportFreshnessState {
  const bound = REPORT_FRESHNESS_BOUND_MS[freshnessClass];
  return now.getTime() - asOf.getTime() <= bound ? 'FRESH' : 'STALE';
}

/** Server-owned validation of a report id (no client-invented ids). */
export function isReportId(value: string): value is ReportId {
  return /^R\d{2}$/u.test(value);
}

/** Zero-fill a bounded day series from authoritative query rows. */
export function buildDaySeries(
  windowDays: number,
  endInclusive: Date,
  rows: Array<{ day: string; count: number }>,
): Array<{ date: string; count: number }> {
  const byDay = new Map(rows.map((row) => [row.day, row.count]));
  const days: Array<{ date: string; count: number }> = [];
  for (let index = windowDays - 1; index >= 0; index -= 1) {
    const date = new Date(endInclusive);
    date.setUTCDate(date.getUTCDate() - index);
    const key = date.toISOString().slice(0, 10);
    days.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return days;
}
