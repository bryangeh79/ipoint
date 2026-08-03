import type {
  AdminDashboardCatalogDto,
  AdminDashboardDrillDownReference,
  AdminDashboardMetricState,
} from '@ipoint/api-client';

/**
 * Shared P7-S4B dashboard fixtures (test-only). Values mirror the server
 * shapes documented by P7-S4A; M10 is always UNAVAILABLE/NO_DURABLE_SOURCE
 * and M13/M14 carry exact decimal strings that must never be recomputed.
 */

export const dashboardMarketA = '11111111-1111-4111-8111-111111111111';
export const dashboardMarketB = '22222222-2222-4222-8222-222222222222';

const base = {
  definitionVersion: 1,
  freshnessClass: 'KPI' as const,
  currencyDimension: false,
  permission: 'dashboard.view',
  source: 'canonical owner projection',
  asOf: '2026-08-01T12:00:00.000Z',
};

export function dashboardCatalogFixture(
  marketId = dashboardMarketA,
): AdminDashboardCatalogDto {
  const items: AdminDashboardMetricState[] = [
    {
      ...base,
      id: 'M01',
      name: 'Member accounts (selected-market presence)',
      definition: 'Members with an enabled presence in the selected market.',
      state: 'FRESH',
      value: { kind: 'COUNT', count: 128 },
    },
    {
      ...base,
      id: 'M02',
      name: 'Active members (selected-market presence)',
      definition: 'Enabled market presence with member status ACTIVE.',
      state: 'FRESH',
      value: { kind: 'COUNT', count: 96 },
    },
    {
      ...base,
      id: 'M03',
      name: 'Suspended or closed members (selected-market presence)',
      definition: 'Enabled market presence with status SUSPENDED or CLOSED.',
      state: 'FRESH',
      value: { kind: 'COUNT', count: 2 },
    },
    {
      ...base,
      id: 'M04',
      name: 'Merchants total and active (selected market)',
      definition: 'Total merchant branches and active branches.',
      state: 'FRESH',
      value: { kind: 'BREAKDOWN', breakdown: { total: 24, active: 18 } },
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M05',
      name: 'Merchant applications pending review',
      definition: 'Applications with status SUBMITTED or UNDER_REVIEW.',
      state: 'FRESH',
      value: { kind: 'COUNT', count: 3 },
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M06',
      name: 'Merchant KYC submissions pending review',
      definition: 'Distinct branches with latest KYC submission pending.',
      state: 'FRESH',
      value: { kind: 'COUNT', count: 1 },
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M07',
      name: 'Member KYC cases pending review',
      definition: 'Member KYC cases with status SUBMITTED or UNDER_REVIEW.',
      state: 'FRESH',
      // Valid zero is distinct from unavailable.
      value: { kind: 'COUNT', count: 0 },
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M08',
      name: 'Agents and pending activation queue',
      definition: 'Agent activation records excluding NOT_APPLIED.',
      state: 'FRESH',
      value: {
        kind: 'BREAKDOWN',
        breakdown: { total: 5, pendingActivation: 1 },
      },
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M09',
      name: 'Manual MCP adjustment requests pending checker',
      definition: 'MCP adjustment requests awaiting an independent Checker.',
      state: 'FRESH',
      value: { kind: 'COUNT', count: 2 },
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M10',
      name: 'Manual iPoint adjustment requests pending checker',
      definition: 'No durable source exists (SEC-01); never fabricated.',
      state: 'UNAVAILABLE',
      unavailableReason: 'NO_DURABLE_SOURCE',
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M11',
      name: 'Redemption exceptions and refund requests pending',
      definition: 'Unresolved fulfilment exceptions and pending refunds.',
      state: 'FRESH',
      value: {
        kind: 'QUEUE_SUMMARY',
        counts: { fulfilmentExceptions: 1, refundRequests: 2 },
      },
    },
    {
      ...base,
      freshnessClass: 'QUEUE',
      id: 'M12',
      name: 'Reward job status (real daily job runs)',
      definition: 'Latest real daily job run plus 30-day status counts.',
      state: 'FRESH',
      value: {
        kind: 'JOB_STATUS',
        latestRun: {
          jobType: 'DAILY_REWARD_ACCRUAL',
          localBusinessDate: '2026-08-01',
          status: 'COMPLETED',
          startedAt: '2026-08-01T11:00:00.000Z',
          completedAt: '2026-08-01T11:05:00.000Z',
          totalEntitlements: 42,
          processedCount: 42,
          failedCount: 0,
        },
        statusCounts: { COMPLETED: 12, RUNNING: 0, PENDING: 0, FAILED: 1 },
      },
    },
    {
      ...base,
      id: 'M13',
      name: "Today's confirmed transactions (selected market)",
      definition:
        'Count and total purchase amount of confirmed transactions today, by currency.',
      currencyDimension: true,
      state: 'FRESH',
      value: {
        kind: 'CURRENCY_TOTALS',
        totals: [
          { currency: 'MYR', count: 5, totalAmount: '160.5000000000' },
          { currency: 'SGD', count: 2, totalAmount: '20.0000000000' },
        ],
      },
    },
    {
      ...base,
      id: 'M14',
      name: 'MCP available balance (selected market)',
      definition: 'Total available MCP balance in the market currency.',
      currencyDimension: true,
      state: 'FRESH',
      value: {
        kind: 'BALANCE',
        currency: 'MYR',
        totalAvailableBalance: '4123.4500000000',
      },
    },
  ];
  return { asOf: '2026-08-01T12:00:00.000Z', marketId, items };
}

const sensitiveIds = new Set(['M09', 'M13', 'M14']);

export function dashboardDrillDownFixture(
  metricId: string,
  marketId = dashboardMarketA,
): AdminDashboardDrillDownReference {
  return {
    metricId: metricId as AdminDashboardMetricState['id'],
    marketId,
    marketScope: 'SELECTED',
    permission: 'dashboard.view',
    masking: sensitiveIds.has(metricId),
    metricFilter: null,
    timeBoundary:
      metricId === 'M13'
        ? {
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-01T12:00:00.000Z',
          }
        : metricId === 'M12'
          ? {
              from: '2026-07-02T00:00:00.000Z',
              to: '2026-08-01T12:00:00.000Z',
            }
          : null,
  };
}
