import type { ReportDefinition, ReportId } from './admin-report-ops.types.js';

/**
 * R01–R04 server-owned basic-report catalog (P7-S9, Command Center
 * 2026-08-07 §7.2).
 *
 * Every report is market-scoped, aggregated from EXISTING canonical owner
 * tables with bounded trailing windows (no new business rules, no
 * unbounded scans) and carries the frozen freshness class (P7-OD-16:
 * QUEUE ≤ 60s, KPI ≤ 5m). All four reports have a REAL durable source in
 * this phase; a report whose source is missing/failed reports UNAVAILABLE
 * with the explicit reason — never a fabricated zero. No report here
 * produces an export: the surface is on-screen bounded only.
 */
export const reportCatalog: readonly ReportDefinition[] = [
  {
    id: 'R01',
    key: 'transaction-counts',
    name: 'Transaction counts',
    definition:
      'Confirmed-session transaction counts for the selected market over the trailing 30 days, grouped by transaction status (DRAFT / PREVIEWED / CONFIRMED / FAILED / EXPIRED) with a total. Bounded aggregate over the canonical transactions table.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'transactions where market_id = selected market and created_at within the trailing 30-day window, grouped by status.',
    availability: 'REAL',
    windowDays: 30,
  },
  {
    id: 'R02',
    key: 'adjustment-summary',
    name: 'MCP / iPoint adjustment summary',
    definition:
      'Manual adjustment volume for the selected market over the trailing 90 days: MCP adjustment requests grouped by status and iPoint adjustment requests grouped by state, each with a total. Bounded aggregates over the canonical mcp_adjustment_requests and ipoint_adjustment_requests tables.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'mcp_adjustment_requests (market_id = selected market) and ipoint_adjustment_requests (market_id = selected market), trailing 90-day window, grouped by status/state.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R03',
    key: 'redemption-queue-overview',
    name: 'Redemption / fulfilment queue overview',
    definition:
      'Current redemption queue overview for the selected market: redemption orders grouped by order status (PENDING … CANCELLED) and fulfilment rows grouped by fulfilment status (PENDING / IN_PROGRESS / COMPLETED / FAILED). Point-in-time counts over the canonical redemption_orders and redemption_fulfilments tables.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'redemption_orders (market_id = selected market) grouped by status; redemption_fulfilments joined to redemption_orders (market_id = selected market) grouped by fulfilment status.',
    availability: 'REAL',
    windowDays: 0,
  },
  {
    id: 'R04',
    key: 'registration-activation-trend',
    name: 'Registration / activation trend',
    definition:
      'Daily member registration (market-presence creation) and agent activation counts for the selected market over the trailing 14 days. Days without rows within the bounded window are real zeros derived from the authoritative query result (absence of rows = no registrations/activations that day). Bounded aggregate over member_market_preferences and agent_activation (matched by the market code).',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'member_market_preferences (market_id = selected market, created_at in window) and agent_activation (market = selected market code, activated_at in window), grouped by UTC day.',
    availability: 'REAL',
    windowDays: 14,
  },
] as const satisfies readonly ReportDefinition[];

export function reportDefinition(reportId: string): ReportDefinition | null {
  return reportCatalog.find((entry) => entry.id === reportId) ?? null;
}

export type { ReportId };
