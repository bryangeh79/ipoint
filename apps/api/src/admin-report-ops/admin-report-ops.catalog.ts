import type { ReportDefinition, ReportId } from './admin-report-ops.types.js';

/**
 * R01–R04 server-owned basic-report catalog (P7-S9, Command Center
 * 2026-08-07 §7.2) extended with R05–R19 advanced on-screen views
 * (P8-S4, G-04, contract §4).
 *
 * Every report is market-scoped, aggregated from EXISTING canonical owner
 * tables with bounded trailing windows (no new business rules, no
 * unbounded scans) and carries the frozen freshness class (P7-OD-16:
 * QUEUE ≤ 60s, KPI ≤ 5m). All 19 reports have a REAL durable source in
 * this phase; a report whose source is missing/failed reports UNAVAILABLE
 * with the explicit reason — never a fabricated zero. No report here
 * produces an export: the surface is on-screen bounded only.
 *
 * Permissions: all reports reuse the single canonical `report.read`
 * permission (ALL controlled roles, marketScoped) exactly as P7-S9 did —
 * zero new permission codes and zero migration (P7-S9 precedent; recorded
 * rationale in P8_S4_DELIVERY_REPORT.md §5). Every advanced value is an
 * aggregate-only masked projection: no raw identifiers, no protected
 * references, no voucher/token values, no raw ledger rows.
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
  // ─── P8-S4 advanced views (G-04, contract §4) ────────────────────
  {
    id: 'R05',
    key: 'operations-kyc-applications',
    name: 'Member KYC / merchant application operations',
    definition:
      'Onboarding operations for the selected market over the trailing 90 days: member KYC cases grouped by case status and merchant applications (joined to their branch market) grouped by application status, each with a real total. Bounded aggregates over member_kyc_cases and merchant_applications.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'member_kyc_cases (market_id = selected market, created_at in window) grouped by status; merchant_applications joined to merchant_branches (market_id = selected market, created_at in window) grouped by status.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R06',
    key: 'finance-wallet-volume',
    name: 'Member wallet entry volume',
    definition:
      'Finance volume for the selected market over the trailing 90 days: member wallet ledger entries grouped by entry type with exact-decimal total amounts (sum of numeric(38,10) amounts transported as strings — never floats). Bounded aggregate over member_wallet_entries.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'member_wallet_entries (market_id = selected market, created_at in window) grouped by entry_type with count(*) and sum(amount)::text.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R07',
    key: 'reconciliation-overview',
    name: 'Reconciliation runs & run items',
    definition:
      'Point-in-time reconciliation state for the selected market: detection runs grouped by run status and run items grouped by item status (MATCHED / MISMATCHED / MISSING / UNEXPECTED), each with a real total. Bounded aggregates over reconciliation_runs and reconciliation_run_items.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'reconciliation_runs (market_id = selected market) grouped by status; reconciliation_run_items (market_id = selected market) grouped by status.',
    availability: 'REAL',
    windowDays: 0,
  },
  {
    id: 'R08',
    key: 'market-profile',
    name: 'Selected market profile',
    definition:
      'Point-in-time profile of the selected market: market identity (code, status, currency, timezone) and real entity counts — members with an enabled presence, merchant branches, MCP accounts, active agents and active redemption catalog items. Bounded count queries over markets and its canonical child tables; counts are real COUNT results (zero means zero rows exist).',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'markets (selected market) plus counts from members joined to member_market_preferences, merchant_branches, mcp_accounts, agent_activation (market = selected market code, status ACTIVE) and redemption_catalog_items (status ACTIVE).',
    availability: 'REAL',
    windowDays: 0,
  },
  {
    id: 'R09',
    key: 'member-status-distribution',
    name: 'Member status distribution',
    definition:
      'Point-in-time member status distribution for the selected market: members with an enabled market presence grouped by member status (PENDING_EMAIL_VERIFICATION / ACTIVE / SUSPENDED / CLOSED) with a real total. Bounded aggregate over members joined to member_market_preferences.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'members joined to member_market_preferences (market_id = selected market, is_enabled = true) grouped by member status.',
    availability: 'REAL',
    windowDays: 0,
  },
  {
    id: 'R10',
    key: 'merchant-status-distribution',
    name: 'Merchant branch status distribution',
    definition:
      'Point-in-time merchant branch status distribution for the selected market (PENDING_APPLICATION … CLOSED) with a real total. Bounded aggregate over merchant_branches.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'merchant_branches (market_id = selected market) grouped by status.',
    availability: 'REAL',
    windowDays: 0,
  },
  {
    id: 'R11',
    key: 'agent-status-distribution',
    name: 'Agent activation status distribution',
    definition:
      'Point-in-time agent activation status distribution for the selected market code (NOT_APPLIED … ACTIVE / SUSPENDED / REJECTED) with a real total. Bounded aggregate over agent_activation.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'agent_activation (market = selected market code) grouped by status.',
    availability: 'REAL',
    windowDays: 0,
  },
  {
    id: 'R12',
    key: 'transaction-value-summary',
    name: 'Confirmed transaction value by currency',
    definition:
      'Confirmed transaction value for the selected market over the trailing 90 days: grouped by currency with real counts, exact-decimal total purchase amounts and total service-fee amounts, plus market totals. Bounded aggregates over transactions (status CONFIRMED) left-joined to transaction_service_fees.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'transactions (market_id = selected market, status = CONFIRMED, confirmed_at in window) left-joined to transaction_service_fees, grouped by currency with sum(purchase_amount)::text and sum(service fee amount)::text.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R13',
    key: 'mcp-overview',
    name: 'MCP accounts & ledger volume',
    definition:
      'MCP state for the selected market: account status distribution (ACTIVE / FROZEN / CLOSED) plus ledger entry volume over the trailing 90 days grouped by entry type with exact-decimal total amounts. Bounded aggregates over mcp_accounts and mcp_ledger_entries joined to mcp_accounts.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'mcp_accounts (market_id = selected market) grouped by status; mcp_ledger_entries joined to mcp_accounts (market_id = selected market, created_at in window) grouped by entry_type with sum(amount)::text.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R14',
    key: 'ipoint-reward-accrual',
    name: 'iPoint / reward accrual volume',
    definition:
      'Reward accrual activity for the selected market over the trailing 90 days: daily accrual ledger entries grouped by entry type with exact-decimal total amounts, plus the reward-plan status distribution. Bounded aggregates over reward_daily_accruals and reward_plans.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'reward_daily_accruals (market_id = selected market, executed_at_utc in window) grouped by ledger_entry_type with sum(amount)::text; reward_plans (market_id = selected market) grouped by status.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R15',
    key: 'commission-overview',
    name: 'Commission ledger & adjustments',
    definition:
      'Commission state for the selected market code over the trailing 90 days: commission ledger entries grouped by entry type with exact-decimal total amounts, plus adjustment requests grouped by status. Bounded aggregates over commission_ledger and commission_adjustment_request.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'commission_ledger (market = selected market code, created_at in window) grouped by entry_type with sum(amount)::text; commission_adjustment_request (market = selected market code, created_at in window) grouped by status.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R16',
    key: 'redemption-volume',
    name: 'Redemption order volume & catalog depth',
    definition:
      'Redemption volume for the selected market over the trailing 90 days: orders grouped by status with real counts and exact-decimal total points, plus the catalog-item status distribution. Bounded aggregates over redemption_orders and redemption_catalog_items.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'redemption_orders (market_id = selected market, created_at in window) grouped by status with sum(total_points)::text; redemption_catalog_items (market_id = selected market) grouped by status.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R17',
    key: 'fulfilment-exception-overview',
    name: 'Fulfilment exceptions & shipping payments',
    definition:
      'Point-in-time fulfilment exception state for the selected market: fulfilment exceptions (total, resolved, unresolved) plus shipping payments grouped by status (PENDING / PAID / FAILED / REFUNDED). Bounded aggregates over redemption_fulfilment_exceptions joined to fulfilments and orders, and redemption_shipping_payments.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'redemption_fulfilment_exceptions joined to redemption_fulfilments and redemption_orders (market_id = selected market) with count(*) FILTER (WHERE resolved); redemption_shipping_payments (market_id = selected market) grouped by status.',
    availability: 'REAL',
    windowDays: 0,
  },
  {
    id: 'R18',
    key: 'refund-overview',
    name: 'Refund request overview',
    definition:
      'Refund activity for the selected market over the trailing 90 days: MCP refund requests grouped by status and redemption refund requests (joined to their order market) grouped by status, each with a real total. Bounded aggregates over mcp_refund_requests and redemption_refund_requests.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    permission: 'report.read',
    source:
      'mcp_refund_requests (market_id = selected market, created_at in window) grouped by status; redemption_refund_requests joined to redemption_orders (market_id = selected market, created_at in window) grouped by status.',
    availability: 'REAL',
    windowDays: 90,
  },
  {
    id: 'R19',
    key: 'risk-exception-overview',
    name: 'Risk events & exception queues',
    definition:
      'Point-in-time risk / exception state for the selected market: risk events grouped by severity, review-queue tasks grouped by status, and reconciliation exceptions grouped by status, each with a real total. Reads ONLY the risk_* and reconciliation_* domain tables (read-only).',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    permission: 'report.read',
    source:
      'risk_events (market_id = selected market) grouped by severity; risk_review_queue (market_id = selected market) grouped by status; reconciliation_exceptions (market_id = selected market) grouped by status.',
    availability: 'REAL',
    windowDays: 0,
  },
] as const satisfies readonly ReportDefinition[];

export function reportDefinition(reportId: string): ReportDefinition | null {
  return reportCatalog.find((entry) => entry.id === reportId) ?? null;
}

export type { ReportId };
