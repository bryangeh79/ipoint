/**
 * Admin Dashboard read-model types (P7-S4A).
 *
 * These types describe the server-owned, selected-market dashboard read
 * models authorized under D-047/P7-S4. Values are bounded projections over
 * canonical owner tables; the dashboard never fabricates zeros, never
 * recomputes owner formulas, and never produces cross-currency totals.
 */

export const DASHBOARD_CATALOG_VERSION = 1;

export type DashboardFreshnessClass = 'QUEUE' | 'KPI';

export type DashboardMetricFreshnessState = 'FRESH' | 'STALE' | 'UNAVAILABLE';

export type DashboardUnavailableReason =
  | 'NO_DURABLE_SOURCE'
  | 'SOURCE_QUERY_FAILED'
  | 'SOURCE_PERMISSION_DENIED';

export type DashboardMetricId =
  | 'M01'
  | 'M02'
  | 'M03'
  | 'M04'
  | 'M05'
  | 'M06'
  | 'M07'
  | 'M08'
  | 'M09'
  | 'M10'
  | 'M11'
  | 'M12'
  | 'M13'
  | 'M14';

export type DashboardJobRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

/** Freshness SLA frozen by P7-OD-16 (60s queues, 5min KPIs). */
export const DASHBOARD_FRESHNESS_BOUND_MS: Record<
  DashboardFreshnessClass,
  number
> = {
  QUEUE: 60_000,
  KPI: 5 * 60_000,
} as const;

export interface DashboardMetricDefinition {
  id: DashboardMetricId;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: DashboardFreshnessClass;
  currencyDimension: boolean;
  /** Canonical permission required to view the dashboard (P7-OD-16). */
  permission: string;
  /**
   * Optional narrower source permission. When set, the actor must hold this
   * canonical permission in addition to `permission`; otherwise the metric
   * reports UNAVAILABLE with SOURCE_PERMISSION_DENIED (source permissions
   * are retained per C34).
   */
  sourcePermission?: string;
  /** Plain-text disclosure of the canonical source tables/services. */
  source: string;
  /**
   * `REAL` = bounded query over canonical owner tables.
   * `NO_DURABLE_SOURCE` = no compliant durable source exists yet; the
   * metric must report UNAVAILABLE and must never fabricate a value.
   */
  availability: 'REAL' | 'NO_DURABLE_SOURCE';
  unavailableReason?: DashboardUnavailableReason;
  /** Marks financial/sensitive metrics for masked drill-down behavior. */
  sensitive: boolean;
}

export interface DashboardJobRunSnapshot {
  jobType: string;
  localBusinessDate: string;
  status: DashboardJobRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  totalEntitlements: number;
  processedCount: number;
  failedCount: number;
}

export type DashboardMetricValue =
  | { kind: 'COUNT'; count: number }
  | { kind: 'BREAKDOWN'; breakdown: Record<string, number> }
  | { kind: 'QUEUE_SUMMARY'; counts: Record<string, number> }
  | {
      kind: 'JOB_STATUS';
      latestRun: DashboardJobRunSnapshot | null;
      statusCounts: Record<string, number>;
    }
  | {
      kind: 'CURRENCY_TOTALS';
      totals: Array<{
        currency: string;
        count: number;
        totalAmount: string;
      }>;
    }
  | { kind: 'BALANCE'; currency: string; totalAvailableBalance: string };

export interface DashboardMetricState {
  id: DashboardMetricId;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: DashboardFreshnessClass;
  currencyDimension: boolean;
  permission: string;
  source: string;
  state: DashboardMetricFreshnessState;
  unavailableReason?: DashboardUnavailableReason;
  /** Source-query time of this metric (not the cache-read time). */
  asOf: string;
  value?: DashboardMetricValue;
}

export interface DashboardDrillDownReference {
  metricId: DashboardMetricId;
  marketId: string;
  marketScope: 'SELECTED';
  permission: string;
  /** Masked drill-down is required for sensitive/financial metrics. */
  masking: boolean;
  metricFilter: string | null;
  timeBoundary: { from: string | null; to: string | null } | null;
}

export interface DashboardMetricDetail {
  id: DashboardMetricId;
  name: string;
  definition: string;
  definitionVersion: number;
  freshnessClass: DashboardFreshnessClass;
  currencyDimension: boolean;
  permission: string;
  source: string;
  state: DashboardMetricFreshnessState;
  unavailableReason?: DashboardUnavailableReason;
  asOf: string;
  marketId: string;
  value?: DashboardMetricValue;
  drillDown: DashboardDrillDownReference;
}

export interface DashboardCatalogResponse {
  asOf: string;
  marketId: string;
  items: DashboardMetricState[];
}

export type DashboardErrorCode =
  | 'DASHBOARD_DATA_UNAVAILABLE'
  | 'DASHBOARD_DATA_STALE'
  | 'DASHBOARD_METRIC_UNDEFINED'
  | 'DASHBOARD_FILTER_INVALID';

export class DashboardError extends Error {
  constructor(
    readonly code: DashboardErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DashboardError';
  }
}

export interface DashboardActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
}

/** Evaluate freshness of a read model against its freshness class. */
export function evaluateFreshness(
  asOf: Date,
  now: Date,
  freshnessClass: DashboardFreshnessClass,
): DashboardMetricFreshnessState {
  const bound = DASHBOARD_FRESHNESS_BOUND_MS[freshnessClass];
  return now.getTime() - asOf.getTime() <= bound ? 'FRESH' : 'STALE';
}

/** Server-owned validation of a metric id (no client-invented ids). */
export function isDashboardMetricId(value: string): value is DashboardMetricId {
  return /^M\d{2}$/u.test(value);
}
