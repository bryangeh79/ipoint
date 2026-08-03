import { describe, expect, it } from 'vitest';
import {
  allDashboardMetricIds,
  dashboardSections,
  drillDownHref,
  drillDownLabel,
  formatCount,
  formatTimestamp,
  freshnessLabel,
  metricCountRows,
  metricDrillDownRouteId,
  unavailableReasonLabel,
} from './dashboard-model.js';
import { dashboardDrillDownFixture } from './test/dashboard-fixtures.js';

describe('P7-S4B dashboard presentation model', () => {
  it('groups exactly M01–M14 once across the seven approved sections', () => {
    const ids = dashboardSections.flatMap((section) => section.metricIds);
    expect(ids).toEqual(allDashboardMetricIds);
    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
    expect(dashboardSections.map(({ id }) => id)).toEqual([
      'people',
      'commerce',
      'reviews',
      'network',
      'finance-ops',
      'today',
      'mcp',
    ]);
    expect(dashboardSections.find((s) => s.id === 'people')?.metricIds).toEqual(
      ['M01', 'M02', 'M03'],
    );
    expect(
      dashboardSections.find((s) => s.id === 'finance-ops')?.metricIds,
    ).toEqual(['M09', 'M10', 'M11', 'M12']);
  });

  it('labels every freshness state', () => {
    expect(freshnessLabel('FRESH')).toBe('Fresh');
    expect(freshnessLabel('STALE')).toBe('Stale');
    expect(freshnessLabel('UNAVAILABLE')).toBe('Unavailable');
  });

  it('discloses every unavailable reason without claiming a value', () => {
    expect(unavailableReasonLabel('NO_DURABLE_SOURCE')).toMatch(
      /no compliant durable source/iu,
    );
    expect(unavailableReasonLabel('SOURCE_QUERY_FAILED')).toMatch(
      /no value was fabricated/iu,
    );
    expect(unavailableReasonLabel('SOURCE_PERMISSION_DENIED')).toMatch(
      /permissions/iu,
    );
    expect(unavailableReasonLabel(undefined)).toMatch(/instead of zero/i);
  });

  it('maps every metric to a canonical drill-down route (or none for M12)', () => {
    expect(metricDrillDownRouteId.M01).toBe('members');
    expect(metricDrillDownRouteId.M06).toBe('merchant-kyc');
    expect(metricDrillDownRouteId.M07).toBe('member-kyc');
    expect(metricDrillDownRouteId.M09).toBe('mcp-adjustments');
    expect(metricDrillDownRouteId.M10).toBe('ipoint-adjustments');
    expect(metricDrillDownRouteId.M11).toBe('refunds');
    expect(metricDrillDownRouteId.M12).toBeNull();
    expect(metricDrillDownRouteId.M13).toBe('reports');
    expect(metricDrillDownRouteId.M14).toBe('mcp');
  });

  it('builds drill-down hrefs that preserve market and time boundary', () => {
    const href = drillDownHref(dashboardDrillDownFixture('M13', 'market-my'));
    expect(href).toBe(
      '/admin/market-my/reports?from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-01T12%3A00%3A00.000Z',
    );
    const plain = drillDownHref(dashboardDrillDownFixture('M09', 'market-my'));
    expect(plain).toBe('/admin/market-my/mcp-adjustments');
    expect(drillDownHref(dashboardDrillDownFixture('M12'))).toBeNull();
  });

  it('keeps a metric filter when the server provides one', () => {
    const reference = dashboardDrillDownFixture('M07', 'market-my');
    const withFilter = {
      ...reference,
      metricFilter: 'status=SUBMITTED',
      timeBoundary: null,
    };
    expect(drillDownHref(withFilter)).toBe(
      '/admin/market-my/kyc/members?metricFilter=status%3DSUBMITTED',
    );
  });

  it('provides human drill-down labels', () => {
    expect(drillDownLabel('M09')).toBe('Open MCP adjustment queue');
    expect(drillDownLabel('M13')).toBe('Open basic reports');
  });

  it('formats counts and timestamps without arithmetic', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(0)).toBe('0');
    expect(formatTimestamp('2026-08-01T12:00:00.000Z')).toContain('2026');
  });

  it('flattens every value kind into labeled rows', () => {
    expect(metricCountRows({ kind: 'COUNT', count: 7 })).toEqual([
      { label: 'Count', count: 7 },
    ]);
    expect(
      metricCountRows({
        kind: 'BREAKDOWN',
        breakdown: { total: 24, active: 18 },
      }),
    ).toEqual([
      { label: 'Total', count: 24 },
      { label: 'Active', count: 18 },
    ]);
    expect(
      metricCountRows({
        kind: 'QUEUE_SUMMARY',
        counts: { fulfilmentExceptions: 1, refundRequests: 2 },
      }),
    ).toEqual([
      { label: 'Fulfilment exceptions', count: 1 },
      { label: 'Refund requests pending checker', count: 2 },
    ]);
    expect(
      metricCountRows({
        kind: 'JOB_STATUS',
        latestRun: null,
        statusCounts: { COMPLETED: 12, FAILED: 1 },
      }),
    ).toEqual([
      { label: 'Completed', count: 12 },
      { label: 'Failed', count: 1 },
    ]);
    // Financial kinds never produce count rows (no client math).
    expect(
      metricCountRows({
        kind: 'CURRENCY_TOTALS',
        totals: [{ currency: 'MYR', count: 5, totalAmount: '1.00' }],
      }),
    ).toEqual([]);
    expect(
      metricCountRows({
        kind: 'BALANCE',
        currency: 'MYR',
        totalAvailableBalance: '1.00',
      }),
    ).toEqual([]);
  });
});
