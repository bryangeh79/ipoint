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
 *
 * P8-S4 (G-04, D-058): the same owner is extended with 15 advanced
 * on-screen report views (R05–R19) covering operations, finance,
 * reconciliation, markets, members, merchants, agents, transactions, MCP,
 * iPoint/reward, commission, redemption, fulfilment, refund and
 * risk/exception. Every advanced view keeps the identical envelope
 * semantics below, is market-scoped, bounded and read-only over frozen
 * tables, and NEVER fabricates a zero for a missing/failed source.
 */

export const REPORT_CATALOG_VERSION = 2;

export type ReportFreshnessClass = 'QUEUE' | 'KPI';

export type ReportFreshnessState = 'FRESH' | 'STALE' | 'UNAVAILABLE';

export type ReportUnavailableReason =
  | 'NO_DURABLE_SOURCE'
  | 'SOURCE_QUERY_FAILED';

export type ReportId =
  | 'R01'
  | 'R02'
  | 'R03'
  | 'R04'
  | 'R05'
  | 'R06'
  | 'R07'
  | 'R08'
  | 'R09'
  | 'R10'
  | 'R11'
  | 'R12'
  | 'R13'
  | 'R14'
  | 'R15'
  | 'R16'
  | 'R17'
  | 'R18'
  | 'R19';

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

/** Simple status/state counts with a real total (P7-S9 shape). */
export interface StatusCounts {
  total: number;
  counts: Record<string, number>;
}

/**
 * Exact-decimal volume group. `totalAmount` is a numeric(38,10) string
 * produced by `sum(...)::text` in PostgreSQL — never a float. Exact-decimal
 * arithmetic lives in the database; the report only transports strings.
 */
export interface VolumeGroup {
  count: number;
  totalAmount: string;
}

/** Exact-decimal transaction value group (purchase + service fee). */
export interface TransactionValueGroup {
  count: number;
  totalPurchaseAmount: string;
  totalServiceFeeAmount: string;
}

export interface TransactionValueTotals {
  count: number;
  totalPurchaseAmount: string;
  totalServiceFeeAmount: string;
}

/** Exact-decimal redemption points group (sum of total_points). */
export interface PointsGroup {
  count: number;
  totalPoints: string;
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
    }
  // ─── P8-S4 advanced views (G-04) ───────────────────────────────────
  | {
      kind: 'OPERATIONS_OVERVIEW';
      windowDays: number;
      kyc: StatusCounts;
      merchantApplications: StatusCounts;
    }
  | {
      kind: 'RECONCILIATION_OVERVIEW';
      runs: StatusCounts;
      runItems: StatusCounts;
    }
  | {
      kind: 'MARKET_PROFILE';
      market: {
        code: string;
        status: string;
        currencyCode: string;
        timezone: string;
      };
      counts: {
        members: number;
        merchantBranches: number;
        mcpAccounts: number;
        activeAgents: number;
        activeCatalogItems: number;
      };
    }
  | {
      kind: 'LEDGER_VOLUME';
      windowDays: number;
      groups: Record<string, VolumeGroup>;
    }
  | {
      kind: 'TRANSACTION_VALUE';
      windowDays: number;
      byCurrency: Record<string, TransactionValueGroup>;
      totals: TransactionValueTotals;
    }
  | {
      kind: 'MCP_OVERVIEW';
      accounts: StatusCounts;
      ledger: { windowDays: number; groups: Record<string, VolumeGroup> };
    }
  | {
      kind: 'COMMISSION_OVERVIEW';
      windowDays: number;
      ledger: { groups: Record<string, VolumeGroup> };
      adjustments: StatusCounts;
    }
  | {
      kind: 'REWARD_ACCRUAL';
      windowDays: number;
      accruals: { groups: Record<string, VolumeGroup> };
      plans: StatusCounts;
    }
  | {
      kind: 'REDEMPTION_VOLUME';
      windowDays: number;
      orders: Record<string, PointsGroup>;
      items: StatusCounts;
    }
  | {
      kind: 'FULFILMENT_OVERVIEW';
      exceptions: { total: number; resolved: number; unresolved: number };
      shippingPayments: StatusCounts;
    }
  | {
      kind: 'REFUND_OVERVIEW';
      windowDays: number;
      mcp: StatusCounts;
      redemption: StatusCounts;
    }
  | {
      kind: 'RISK_EXCEPTION_OVERVIEW';
      riskEvents: StatusCounts;
      riskQueue: StatusCounts;
      reconciliationExceptions: StatusCounts;
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

/**
 * P7-S9 privacy-masking rule for report payloads: report values are
 * aggregate-only projections — raw entity identifiers, protected member
 * references, merchant receipt numbers, order references, case references
 * and idempotency keys must NEVER appear in a masked report value. The
 * patterns below are the exact identifier shapes the frozen owners emit;
 * anything matching is a masking violation, asserted in unit + integration
 * tests (`containsRawIdentifier`).
 */
const RAW_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  // UUID entity ids.
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
  // Account / member / referral / receipt / order / case / protected
  // reference prefixes used by the frozen owners.
  /^(acct_|M-|R-|RCPT_|ORD_|CASE_|ref_|ik-)/u,
];

/**
 * True when a report payload contains a raw identifier that the masking
 * rule forbids (P7-S9: IDs masked, sensitive values redacted, raw ledgers
 * never exposed). Deep-searches strings/arrays/objects; used by unit and
 * integration suites to prove no identifier leaks into any report value.
 */
export function containsRawIdentifier(value: unknown): boolean {
  if (typeof value === 'string') {
    return RAW_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsRawIdentifier(entry));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      containsRawIdentifier(entry),
    );
  }
  return false;
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
