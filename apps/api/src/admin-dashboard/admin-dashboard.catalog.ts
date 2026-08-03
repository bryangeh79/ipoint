import type {
  DashboardMetricDefinition,
  DashboardMetricId,
} from './admin-dashboard.types.js';

/**
 * M01–M14 server-owned metric catalog (P7-S4A, CG-05).
 *
 * Definitions are versioned and immutable in this phase. Every definition
 * discloses its canonical source; no value is ever fabricated. Metrics whose
 * compliant durable source does not exist yet (M10 per SEC-01) report
 * UNAVAILABLE with `NO_DURABLE_SOURCE`.
 */
export const dashboardMetricCatalog: readonly DashboardMetricDefinition[] = [
  {
    id: 'M01',
    name: 'Member accounts (selected-market presence)',
    definition:
      'Count of members with an enabled market presence in the selected market, derived from the canonical member_market_preferences link joined to members. Members are global accounts; this bounded projection counts members that selected the market.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'members joined to member_market_preferences (is_enabled = true) for the selected market.',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M02',
    name: 'Active members (selected-market presence)',
    definition:
      'Count of members with an enabled presence in the selected market whose member status is ACTIVE.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'members joined to member_market_preferences (is_enabled = true) where members.status = ACTIVE.',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M03',
    name: 'Suspended or closed members (selected-market presence)',
    definition:
      'Count of members with an enabled presence in the selected market whose member status is SUSPENDED or CLOSED.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'members joined to member_market_preferences (is_enabled = true) where members.status in (SUSPENDED, CLOSED).',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M04',
    name: 'Merchants total and active (selected market)',
    definition:
      'Total merchant branches in the selected market and the number whose operational status is ACTIVE.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    currencyDimension: false,
    permission: 'dashboard.view',
    source: 'merchant_branches grouped by market_id = selected market.',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M05',
    name: 'Merchant applications pending review',
    definition:
      'Count of merchant applications in the selected market whose status is SUBMITTED or UNDER_REVIEW (awaiting admin review).',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'merchant_applications joined to merchant_branches (market_id = selected market), status in (SUBMITTED, UNDER_REVIEW).',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M06',
    name: 'Merchant KYC submissions pending review',
    definition:
      'Count of distinct merchant branches in the selected market with a merchant KYC submission in SUBMITTED or UNDER_REVIEW status.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'merchant_kyc_submissions joined to merchant_branches (market_id = selected market), status in (SUBMITTED, UNDER_REVIEW); distinct merchant branches.',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M07',
    name: 'Member KYC cases pending review',
    definition:
      'Count of member KYC cases in the selected market whose status is SUBMITTED or UNDER_REVIEW.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'member_kyc_cases where market_id = selected market and status in (SUBMITTED, UNDER_REVIEW).',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M08',
    name: 'Agents and pending activation queue',
    definition:
      'Agent activation records for the selected market (matched by the market country code) excluding the NOT_APPLIED placeholder, plus the number whose activation status is pending (PENDING_PAYMENT, PAYMENT_CONFIRMED, COURSE_PENDING, COURSE_COMPLETED, PENDING_APPROVAL).',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'agent_activation rows where market = markets.code of the selected market; pending = status in (PENDING_PAYMENT, PAYMENT_CONFIRMED, COURSE_PENDING, COURSE_COMPLETED, PENDING_APPROVAL).',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M09',
    name: 'Manual MCP adjustment requests pending checker',
    definition:
      'Count of manual MCP adjustment requests in the selected market whose status is PENDING_APPROVAL (awaiting an independent Checker decision).',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    sourcePermission: 'merchant.mcp.view',
    source:
      'mcp_adjustment_requests where market_id = selected market and status = PENDING_APPROVAL.',
    availability: 'REAL',
    sensitive: true,
  },
  {
    id: 'M10',
    name: 'Manual iPoint adjustment requests pending checker',
    definition:
      'Count of durable manual iPoint adjustment requests awaiting an independent Checker. No compliant durable request source exists yet (SEC-01/GATE-SEC-01); this metric is UNAVAILABLE and must never display a value.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'No durable owner request table exists (SEC-01). The prohibited immediate iPoint adjustment endpoint is never used as a source.',
    availability: 'NO_DURABLE_SOURCE',
    unavailableReason: 'NO_DURABLE_SOURCE',
    sensitive: true,
  },
  {
    id: 'M11',
    name: 'Redemption exceptions and refund requests pending',
    definition:
      'Unresolved redemption fulfilment exceptions and redemption refund requests awaiting Checker decision for orders in the selected market.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    source:
      'redemption_fulfilment_exceptions (resolved = false) joined to redemption_orders (market_id = selected market); redemption_refund_requests (status = PENDING_CHECKER) joined to redemption_orders.',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M12',
    name: 'Reward job status (real daily job runs)',
    definition:
      'Latest real daily job run for the selected market plus daily job run status counts (PENDING, RUNNING, COMPLETED, FAILED) for the trailing 30 local business days. Real daily_job_runs rows only; never fabricated from rule versions.',
    definitionVersion: 1,
    freshnessClass: 'QUEUE',
    currencyDimension: false,
    permission: 'dashboard.view',
    sourcePermission: 'reward.job.read',
    source:
      'daily_job_runs where market_id = selected market; latest run by local_business_date desc, created_at desc; status counts bounded to the trailing 30-day window.',
    availability: 'REAL',
    sensitive: false,
  },
  {
    id: 'M13',
    name: "Today's confirmed transactions (selected market)",
    definition:
      'Count and total purchase amount of confirmed transactions in the selected market since the market-local start of today, separated by transaction currency. Never combined across currencies.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    currencyDimension: true,
    permission: 'dashboard.view',
    source:
      'transactions where market_id = selected market, status = CONFIRMED, confirmed_at >= market-local today start; grouped by currency using exact decimal sums.',
    availability: 'REAL',
    sensitive: true,
  },
  {
    id: 'M14',
    name: 'MCP available balance (selected market)',
    definition:
      'Total available MCP balance across merchant MCP accounts in the selected market, in the market currency. Read-only sum over the canonical mcp_accounts owner projection; no ledger recomputation.',
    definitionVersion: 1,
    freshnessClass: 'KPI',
    currencyDimension: true,
    permission: 'dashboard.view',
    sourcePermission: 'merchant.mcp.view',
    source:
      'mcp_accounts where market_id = selected market; sum(available_balance) with currency = markets.currency_code.',
    availability: 'REAL',
    sensitive: true,
  },
];

export const dashboardMetricDefinitionsById = new Map<
  DashboardMetricId,
  DashboardMetricDefinition
>(dashboardMetricCatalog.map((definition) => [definition.id, definition]));
