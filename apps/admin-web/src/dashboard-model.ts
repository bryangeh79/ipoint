import type {
  AdminDashboardDrillDownReference,
  AdminDashboardFreshnessState,
  AdminDashboardMetricId,
  AdminDashboardMetricState,
  AdminDashboardMetricValue,
} from '@ipoint/api-client';
import { routePath, type AdminRouteId } from './route-manifest.js';

/**
 * P7-S4B dashboard presentation model.
 *
 * Pure, server-owned presentation rules only: section grouping, freshness
 * labels, drill-down route mapping, and value display formatting. This module
 * performs NO arithmetic on financial values (amounts are rendered exactly as
 * returned by the API) and never fabricates a metric value.
 */

export interface DashboardSectionDefinition {
  id: string;
  title: string;
  description: string;
  metricIds: readonly AdminDashboardMetricId[];
}

/**
 * M01–M14 grouped by operational section (P7-OD-16). Every metric appears in
 * exactly one section; the order is the canonical catalog order.
 */
export const dashboardSections: readonly DashboardSectionDefinition[] = [
  {
    id: 'people',
    title: 'People',
    description:
      'Selected-market member accounts and status presence (KPI, up to 5 minutes old).',
    metricIds: ['M01', 'M02', 'M03'],
  },
  {
    id: 'commerce',
    title: 'Commerce',
    description:
      'Merchant branches, applications, and KYC submissions in the selected market.',
    metricIds: ['M04', 'M05', 'M06'],
  },
  {
    id: 'reviews',
    title: 'Reviews',
    description: 'Member KYC cases awaiting an authorized review decision.',
    metricIds: ['M07'],
  },
  {
    id: 'network',
    title: 'Network',
    description: 'Agent activation records for the selected market.',
    metricIds: ['M08'],
  },
  {
    id: 'finance-ops',
    title: 'Finance and operations queues',
    description:
      'Adjustment, redemption, and reward-job operational queues (60 seconds old or less when fresh).',
    metricIds: ['M09', 'M10', 'M11', 'M12'],
  },
  {
    id: 'today',
    title: "Today's confirmed transactions",
    description:
      'Confirmed transaction totals since the market-local start of today, separated by currency.',
    metricIds: ['M13'],
  },
  {
    id: 'mcp',
    title: 'MCP balance',
    description: 'Total available MCP balance across the selected market.',
    metricIds: ['M14'],
  },
];

/** Stable lookup by section id. */
export function sectionById(id: string): DashboardSectionDefinition {
  const section = dashboardSections.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Unknown dashboard section: ${id}`);
  return section;
}

/** All 14 metric ids in catalog order. */
export const allDashboardMetricIds: readonly AdminDashboardMetricId[] =
  dashboardSections.flatMap((section) => section.metricIds);

export function freshnessLabel(state: AdminDashboardFreshnessState): string {
  switch (state) {
    case 'FRESH':
      return 'Fresh';
    case 'STALE':
      return 'Stale';
    case 'UNAVAILABLE':
      return 'Unavailable';
  }
}

export function unavailableReasonLabel(
  reason: AdminDashboardMetricState['unavailableReason'],
): string {
  switch (reason) {
    case 'NO_DURABLE_SOURCE':
      return 'No compliant durable source exists yet; this metric is never estimated.';
    case 'SOURCE_QUERY_FAILED':
      return 'The server source query failed; no value was fabricated.';
    case 'SOURCE_PERMISSION_DENIED':
      return 'Your server permissions do not include the source permission for this metric.';
    default:
      return 'The server did not provide a value; unavailable is shown instead of zero.';
  }
}

/**
 * Canonical Admin route for a metric's drill-down. The route keeps the
 * selected market; the metric filter and time boundary are preserved as query
 * parameters from the server-provided drill-down reference. Metrics whose
 * queue has no dedicated manifest route (M12 reward jobs) have no link — the
 * real job status is rendered inline instead.
 */
export const metricDrillDownRouteId: Readonly<
  Record<AdminDashboardMetricId, AdminRouteId | null>
> = {
  M01: 'members',
  M02: 'members',
  M03: 'members',
  M04: 'merchants',
  M05: 'merchants',
  M06: 'merchant-kyc',
  M07: 'member-kyc',
  M08: 'agents',
  M09: 'mcp-adjustments',
  M10: 'ipoint-adjustments',
  M11: 'refunds',
  M12: null,
  M13: 'reports',
  M14: 'mcp',
};

/** Serialize a drill-down reference into a manifest href (market + boundary). */
export function drillDownHref(
  reference: AdminDashboardDrillDownReference,
): string | null {
  const routeId = metricDrillDownRouteId[reference.metricId];
  if (!routeId) return null;
  const base = routePath(routeId, { marketId: reference.marketId });
  const parameters = new URLSearchParams();
  if (reference.metricFilter) {
    parameters.set('metricFilter', reference.metricFilter);
  }
  if (reference.timeBoundary?.from) {
    parameters.set('from', reference.timeBoundary.from);
  }
  if (reference.timeBoundary?.to) {
    parameters.set('to', reference.timeBoundary.to);
  }
  const query = parameters.toString();
  return query ? `${base}?${query}` : base;
}

/** Human display label for the drill-down target route. */
export function drillDownLabel(metricId: AdminDashboardMetricId): string {
  switch (metricId) {
    case 'M01':
    case 'M02':
    case 'M03':
      return 'Open members';
    case 'M04':
    case 'M05':
      return 'Open merchants';
    case 'M06':
      return 'Open merchant KYC queue';
    case 'M07':
      return 'Open member KYC queue';
    case 'M08':
      return 'Open agents';
    case 'M09':
      return 'Open MCP adjustment queue';
    case 'M10':
      return 'Open iPoint adjustment queue';
    case 'M11':
      return 'Open refund queue';
    case 'M13':
      return 'Open basic reports';
    case 'M14':
      return 'Open MCP accounts';
    default:
      return 'Open queue';
  }
}

/** Format a whole count for display (formatting only, no arithmetic). */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

/** ISO timestamp rendered in the admin locale. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export interface CountRow {
  label: string;
  count: number;
}

/**
 * Flatten a metric value into labeled count rows for display. Financial
 * amounts are never touched here; CURRENCY_TOTALS and BALANCE have their own
 * exact-string renderers.
 */
export function metricCountRows(value: AdminDashboardMetricValue): CountRow[] {
  switch (value.kind) {
    case 'COUNT':
      return [{ label: 'Count', count: value.count }];
    case 'BREAKDOWN':
      return Object.entries(value.breakdown).map(([key, count]) => ({
        label: breakdownLabel(key),
        count,
      }));
    case 'QUEUE_SUMMARY':
      return Object.entries(value.counts).map(([key, count]) => ({
        label: queueSummaryLabel(key),
        count,
      }));
    case 'JOB_STATUS':
      return Object.entries(value.statusCounts).map(([key, count]) => ({
        label: `${key[0]}${key.slice(1).toLowerCase()}`,
        count,
      }));
    default:
      return [];
  }
}

function breakdownLabel(key: string): string {
  switch (key) {
    case 'total':
      return 'Total';
    case 'active':
      return 'Active';
    case 'pendingActivation':
      return 'Pending activation';
    default:
      return key;
  }
}

function queueSummaryLabel(key: string): string {
  switch (key) {
    case 'fulfilmentExceptions':
      return 'Fulfilment exceptions';
    case 'refundRequests':
      return 'Refund requests pending checker';
    default:
      return key;
  }
}

export function metricSensitiveValueSummary(
  metricId: AdminDashboardMetricId,
): string | null {
  switch (metricId) {
    case 'M09':
      return 'Pending checker count; amounts stay in the MCP adjustment queue.';
    case 'M13':
      return 'Amounts are server-provided per currency and shown exactly as returned.';
    case 'M14':
      return 'Server-provided balance in the market currency, shown exactly as returned.';
    default:
      return null;
  }
}
