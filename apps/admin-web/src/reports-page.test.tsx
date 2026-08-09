import axe from 'axe-core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminReportCatalogDto } from '@ipoint/api-client';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import {
  P7S9_MARKET_ID,
  mockP7S9OpsApi,
  reportCatalogFixture,
} from './test/p7-s9-ops-mock.js';

const REPORTS_URL = `/admin/${P7S9_MARKET_ID}/reports`;

/**
 * P8-S5a fixture: the R01–R04 basic catalog plus the 15 advanced reports
 * (R05–R19). Names/definitions mirror the server-owned catalog
 * (`admin-report-ops.catalog.ts`); values mirror the P8-S4 `ReportValue`
 * shapes (`admin-report-ops.types.ts`) — amounts are exact-decimal
 * numeric(38,10) strings, never floats.
 */
function advancedReportBase(id: string, freshnessClass: 'KPI' | 'QUEUE') {
  return {
    id,
    key: `advanced-${id}`,
    definitionVersion: 1,
    permission: 'report.read' as const,
    source: 'canonical owner tables (bounded aggregate).',
    state: 'FRESH' as const,
    stale: false,
    unavailable: false,
    asOf: '2026-08-07T12:00:00.000Z',
    queryDurationMs: 1.2,
    freshnessClass,
  };
}

function advancedReportCatalogFixture(): AdminReportCatalogDto {
  const basic = reportCatalogFixture();
  return {
    ...basic,
    items: [
      ...basic.items,
      {
        ...advancedReportBase('R05', 'KPI'),
        name: 'Member KYC / merchant application operations',
        definition:
          'Onboarding operations for the selected market over the trailing 90 days: member KYC cases grouped by case status and merchant applications (joined to their branch market) grouped by application status, each with a real total. Bounded aggregates over member_kyc_cases and merchant_applications.',
        value: {
          kind: 'OPERATIONS_OVERVIEW',
          windowDays: 90,
          kyc: { total: 3, counts: { SUBMITTED: 2, VERIFIED: 1 } },
          merchantApplications: { total: 1, counts: { APPROVED: 1 } },
        },
      },
      {
        ...advancedReportBase('R06', 'KPI'),
        name: 'Member wallet entry volume',
        definition:
          'Finance volume for the selected market over the trailing 90 days: member wallet ledger entries grouped by entry type with exact-decimal total amounts (sum of numeric(38,10) amounts transported as strings — never floats). Bounded aggregate over member_wallet_entries.',
        value: {
          kind: 'LEDGER_VOLUME',
          windowDays: 90,
          groups: {
            DEPOSIT: { count: 2, totalAmount: '187.0000000000' },
            WITHDRAWAL: { count: 1, totalAmount: '36.0000000000' },
          },
        },
      },
      {
        ...advancedReportBase('R07', 'QUEUE'),
        name: 'Reconciliation runs & run items',
        definition:
          'Point-in-time reconciliation state for the selected market: detection runs grouped by run status and run items grouped by item status (MATCHED / MISMATCHED / MISSING / UNEXPECTED), each with a real total. Bounded aggregates over reconciliation_runs and reconciliation_run_items.',
        value: {
          kind: 'RECONCILIATION_OVERVIEW',
          runs: { total: 1, counts: { COMPLETED: 1 } },
          runItems: { total: 2, counts: { MATCHED: 2 } },
        },
      },
      {
        ...advancedReportBase('R08', 'QUEUE'),
        name: 'Selected market profile',
        definition:
          'Point-in-time profile of the selected market: market identity (code, status, currency, timezone) and real entity counts — members with an enabled presence, merchant branches, MCP accounts, active agents and active redemption catalog items. Bounded count queries over markets and its canonical child tables; counts are real COUNT results (zero means zero rows exist).',
        value: {
          kind: 'MARKET_PROFILE',
          market: {
            code: 'MY',
            status: 'ACTIVE',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
          },
          counts: {
            members: 5,
            merchantBranches: 2,
            mcpAccounts: 0,
            activeAgents: 1,
            activeCatalogItems: 3,
          },
        },
      },
      {
        ...advancedReportBase('R09', 'QUEUE'),
        name: 'Member status distribution',
        definition:
          'Point-in-time member status distribution for the selected market: members with an enabled market presence grouped by member status (PENDING_EMAIL_VERIFICATION / ACTIVE / SUSPENDED / CLOSED) with a real total. Bounded aggregate over members joined to member_market_preferences.',
        value: {
          kind: 'STATUS_COUNTS',
          windowDays: 0,
          total: 4,
          counts: { ACTIVE: 4 },
        },
      },
      {
        ...advancedReportBase('R10', 'QUEUE'),
        name: 'Merchant branch status distribution',
        definition:
          'Point-in-time merchant branch status distribution for the selected market (PENDING_APPLICATION … CLOSED) with a real total. Bounded aggregate over merchant_branches.',
        value: {
          kind: 'STATUS_COUNTS',
          windowDays: 0,
          total: 2,
          counts: { ACTIVE: 2 },
        },
      },
      {
        ...advancedReportBase('R11', 'QUEUE'),
        name: 'Agent activation status distribution',
        definition:
          'Point-in-time agent activation status distribution for the selected market code (NOT_APPLIED … ACTIVE / SUSPENDED / REJECTED) with a real total. Bounded aggregate over agent_activation.',
        value: {
          kind: 'STATUS_COUNTS',
          windowDays: 0,
          total: 1,
          counts: { ACTIVE: 1 },
        },
      },
      {
        ...advancedReportBase('R12', 'KPI'),
        name: 'Confirmed transaction value by currency',
        definition:
          'Confirmed transaction value for the selected market over the trailing 90 days: grouped by currency with real counts, exact-decimal total purchase amounts and total service-fee amounts, plus market totals. Bounded aggregates over transactions (status CONFIRMED) left-joined to transaction_service_fees.',
        value: {
          kind: 'TRANSACTION_VALUE',
          windowDays: 90,
          byCurrency: {
            MYR: {
              count: 2,
              totalPurchaseAmount: '187.0000000000',
              totalServiceFeeAmount: '10.0000000000',
            },
          },
          totals: {
            count: 2,
            totalPurchaseAmount: '187.0000000000',
            totalServiceFeeAmount: '10.0000000000',
          },
        },
      },
      {
        ...advancedReportBase('R13', 'KPI'),
        name: 'MCP accounts & ledger volume',
        definition:
          'MCP state for the selected market: account status distribution (ACTIVE / FROZEN / CLOSED) plus ledger entry volume over the trailing 90 days grouped by entry type with exact-decimal total amounts. Bounded aggregates over mcp_accounts and mcp_ledger_entries joined to mcp_accounts.',
        value: {
          kind: 'MCP_OVERVIEW',
          accounts: { total: 1, counts: { ACTIVE: 1 } },
          ledger: {
            windowDays: 90,
            groups: { TOP_UP: { count: 2, totalAmount: '1000.0000000000' } },
          },
        },
      },
      {
        ...advancedReportBase('R14', 'KPI'),
        name: 'iPoint / reward accrual volume',
        definition:
          'Reward accrual activity for the selected market over the trailing 90 days: daily accrual ledger entries grouped by entry type with exact-decimal total amounts, plus the reward-plan status distribution. Bounded aggregates over reward_daily_accruals and reward_plans.',
        value: {
          kind: 'REWARD_ACCRUAL',
          windowDays: 90,
          accruals: {
            groups: { DAILY: { count: 2, totalAmount: '100.0000000000' } },
          },
          plans: { total: 1, counts: { ACTIVE: 1 } },
        },
      },
      {
        ...advancedReportBase('R15', 'KPI'),
        name: 'Commission ledger & adjustments',
        definition:
          'Commission state for the selected market code over the trailing 90 days: commission ledger entries grouped by entry type with exact-decimal total amounts, plus adjustment requests grouped by status. Bounded aggregates over commission_ledger and commission_adjustment_request.',
        value: {
          kind: 'COMMISSION_OVERVIEW',
          windowDays: 90,
          ledger: {
            groups: { PAYOUT: { count: 1, totalAmount: '50.0000000000' } },
          },
          adjustments: { total: 1, counts: { APPROVED: 1 } },
        },
      },
      {
        ...advancedReportBase('R16', 'KPI'),
        name: 'Redemption order volume & catalog depth',
        definition:
          'Redemption volume for the selected market over the trailing 90 days: orders grouped by status with real counts and exact-decimal total points, plus the catalog-item status distribution. Bounded aggregates over redemption_orders and redemption_catalog_items.',
        value: {
          kind: 'REDEMPTION_VOLUME',
          windowDays: 90,
          orders: {
            COMPLETED: { count: 2, totalPoints: '10.0000000000' },
          },
          items: { total: 3, counts: { ACTIVE: 3 } },
        },
      },
      {
        ...advancedReportBase('R17', 'QUEUE'),
        name: 'Fulfilment exceptions & shipping payments',
        definition:
          'Point-in-time fulfilment exception state for the selected market: fulfilment exceptions (total, resolved, unresolved) plus shipping payments grouped by status (PENDING / PAID / FAILED / REFUNDED). Bounded aggregates over redemption_fulfilment_exceptions joined to fulfilments and orders, and redemption_shipping_payments.',
        value: {
          kind: 'FULFILMENT_OVERVIEW',
          exceptions: { total: 2, resolved: 1, unresolved: 1 },
          shippingPayments: { total: 1, counts: { PAID: 1 } },
        },
      },
      {
        ...advancedReportBase('R18', 'KPI'),
        name: 'Refund request overview',
        definition:
          'Refund activity for the selected market over the trailing 90 days: MCP refund requests grouped by status and redemption refund requests (joined to their order market) grouped by status, each with a real total. Bounded aggregates over mcp_refund_requests and redemption_refund_requests.',
        value: {
          kind: 'REFUND_OVERVIEW',
          windowDays: 90,
          mcp: { total: 1, counts: { REFUNDED: 1 } },
          redemption: { total: 1, counts: { APPROVED: 1 } },
        },
      },
      {
        ...advancedReportBase('R19', 'QUEUE'),
        name: 'Risk events & exception queues',
        definition:
          'Point-in-time risk / exception state for the selected market: risk events grouped by severity, review-queue tasks grouped by status, and reconciliation exceptions grouped by status, each with a real total. Reads ONLY the risk_* and reconciliation_* domain tables (read-only).',
        value: {
          kind: 'RISK_EXCEPTION_OVERVIEW',
          riskEvents: { total: 1, counts: { HIGH: 1 } },
          riskQueue: { total: 1, counts: { PENDING: 1 } },
          reconciliationExceptions: { total: 1, counts: { MISMATCHED: 1 } },
        },
      },
    ],
  };
}

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

afterEach(() => {
  cleanup();
});

async function signIn(url: string) {
  render(<AdminApp router={createAdminMemoryRouter([url])} />);
  fireEvent.change(await screen.findByLabelText('Admin email'), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(await screen.findByLabelText('Password'), {
    target: { value: 'Admin-Password-123!' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Continue securely' }),
  );
  fireEvent.change(await screen.findByLabelText('Authentication code'), {
    target: { value: '123456' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Open Admin workspace' }),
  );
  await screen.findByText('Bryan Admin');
}

describe('P7-S9 basic reports page', () => {
  it('renders all four bounded reports with their freshness state', async () => {
    mockP7S9OpsApi();
    await signIn(REPORTS_URL);

    await screen.findByRole('heading', { name: 'Basic reports' });
    expect(screen.getByTestId('report-R01')).toHaveTextContent(
      'Transaction counts',
    );
    expect(screen.getByTestId('report-R02')).toHaveTextContent(
      'MCP / iPoint adjustment summary',
    );
    expect(screen.getByTestId('report-R03')).toHaveTextContent(
      'Redemption / fulfilment queue overview',
    );
    expect(screen.getByTestId('report-R04')).toHaveTextContent(
      'Registration / activation trend',
    );
    expect(screen.getAllByTestId('report-FRESH')).toHaveLength(4);
    // Real counts rendered from the adapter response (R01 transaction
    // counts table).
    const r01 = screen.getByTestId('report-R01');
    expect(within(r01).getByTestId('count-CONFIRMED')).toHaveTextContent('2');
    expect(within(r01).getByTestId('count-total')).toHaveTextContent('2');
    // Trend values.
    expect(
      screen.getByText(/Totals: 2 registrations · 1 activations/i),
    ).toBeInTheDocument();
    // No export affordance anywhere (Command Center §7: no CSV/download).
    expect(
      screen.queryByRole('button', { name: /download|csv|export/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /download|csv|export/i }),
    ).not.toBeInTheDocument();
  });

  it('marks a report UNAVAILABLE with its reason — never a fabricated zero', async () => {
    const catalog = reportCatalogFixture();
    catalog.items = catalog.items.map((item) =>
      item.id === 'R03'
        ? {
            ...item,
            state: 'UNAVAILABLE',
            unavailable: true,
            unavailableReason: 'SOURCE_QUERY_FAILED',
            value: undefined,
          }
        : item,
    );
    mockP7S9OpsApi({ reportCatalog: catalog });
    await signIn(REPORTS_URL);

    await screen.findByRole('heading', { name: 'Basic reports' });
    expect(screen.getByTestId('report-UNAVAILABLE')).toHaveTextContent(
      'Unavailable',
    );
    expect(screen.getByTestId('report-unavailable-line').textContent).toContain(
      'never fabricated',
    );
    // The unavailable report shows no counts table and no zero.
    expect(screen.getByTestId('report-R03').textContent).not.toContain('Count');
  });

  it('marks a report STALE with the explicit stale snapshot line', async () => {
    const catalog = reportCatalogFixture();
    catalog.items = catalog.items.map((item) =>
      item.id === 'R04'
        ? {
            ...item,
            state: 'STALE',
            stale: true,
            asOf: '2026-08-07T10:00:00.000Z',
          }
        : item,
    );
    mockP7S9OpsApi({ reportCatalog: catalog });
    await signIn(REPORTS_URL);

    await screen.findByRole('heading', { name: 'Basic reports' });
    expect(screen.getByTestId('report-STALE')).toHaveTextContent('Stale');
    expect(screen.getByTestId('report-stale-line').textContent).toContain(
      'must not be treated as current',
    );
  });

  it('is accessible (axe-clean)', async () => {
    mockP7S9OpsApi();
    await signIn(REPORTS_URL);
    await screen.findByRole('heading', { name: 'Basic reports' });
    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(serious).toHaveLength(0);
  });
});

describe('P8-S5a advanced reports (R05–R19)', () => {
  it('renders all 15 advanced reports with names, definitions and key values', async () => {
    mockP7S9OpsApi({ reportCatalog: advancedReportCatalogFixture() });
    await signIn(REPORTS_URL);

    await screen.findByRole('heading', { name: 'Basic reports' });
    // All 19 cards are FRESH (4 basic + 15 advanced).
    expect(screen.getAllByTestId('report-FRESH')).toHaveLength(19);

    const expectations: ReadonlyArray<{
      id: string;
      name: string;
      definitionSnippet: string;
      assert: (card: HTMLElement) => void;
    }> = [
      {
        id: 'R05',
        name: 'Member KYC / merchant application operations',
        definitionSnippet: 'member KYC cases grouped by case status',
        assert: (card) => {
          expect(within(card).getByTestId('count-SUBMITTED')).toHaveTextContent(
            '2',
          );
          expect(within(card).getByTestId('count-VERIFIED')).toHaveTextContent(
            '1',
          );
          expect(within(card).getByTestId('count-APPROVED')).toHaveTextContent(
            '1',
          );
        },
      },
      {
        id: 'R06',
        name: 'Member wallet entry volume',
        definitionSnippet: 'exact-decimal total amounts',
        assert: (card) => {
          expect(within(card).getByTestId('amount-DEPOSIT')).toHaveTextContent(
            /^187$/u,
          );
          expect(
            within(card).getByTestId('amount-WITHDRAWAL'),
          ).toHaveTextContent(/^36$/u);
          expect(within(card).getByTestId('count-DEPOSIT')).toHaveTextContent(
            '2',
          );
        },
      },
      {
        id: 'R07',
        name: 'Reconciliation runs & run items',
        definitionSnippet: 'detection runs grouped by run status',
        assert: (card) => {
          expect(within(card).getByTestId('count-COMPLETED')).toHaveTextContent(
            '1',
          );
          expect(within(card).getByTestId('count-MATCHED')).toHaveTextContent(
            '2',
          );
        },
      },
      {
        id: 'R08',
        name: 'Selected market profile',
        definitionSnippet: 'Point-in-time profile of the selected market',
        assert: (card) => {
          expect(within(card).getByTestId('profile-code')).toHaveTextContent(
            'MY',
          );
          expect(within(card).getByTestId('profile-status')).toHaveTextContent(
            'ACTIVE',
          );
          expect(
            within(card).getByTestId('profile-currency'),
          ).toHaveTextContent('MYR');
          expect(
            within(card).getByTestId('profile-timezone'),
          ).toHaveTextContent('Asia/Kuala_Lumpur');
          expect(within(card).getByTestId('profile-members')).toHaveTextContent(
            '5',
          );
          expect(
            within(card).getByTestId('profile-branches'),
          ).toHaveTextContent('2');
          // A 0 in an authoritative row IS a real zero and renders as 0.
          expect(
            within(card).getByTestId('profile-mcp-accounts'),
          ).toHaveTextContent('0');
          expect(within(card).getByTestId('profile-agents')).toHaveTextContent(
            '1',
          );
          expect(
            within(card).getByTestId('profile-catalog-items'),
          ).toHaveTextContent('3');
        },
      },
      {
        id: 'R09',
        name: 'Member status distribution',
        definitionSnippet:
          'members with an enabled market presence grouped by member status',
        assert: (card) => {
          expect(within(card).getByTestId('count-ACTIVE')).toHaveTextContent(
            '4',
          );
          expect(within(card).getByTestId('count-total')).toHaveTextContent(
            '4',
          );
        },
      },
      {
        id: 'R10',
        name: 'Merchant branch status distribution',
        definitionSnippet:
          'merchant branch status distribution for the selected market',
        assert: (card) => {
          expect(within(card).getByTestId('count-ACTIVE')).toHaveTextContent(
            '2',
          );
          expect(within(card).getByTestId('count-total')).toHaveTextContent(
            '2',
          );
        },
      },
      {
        id: 'R11',
        name: 'Agent activation status distribution',
        definitionSnippet:
          'agent activation status distribution for the selected market code',
        assert: (card) => {
          expect(within(card).getByTestId('count-ACTIVE')).toHaveTextContent(
            '1',
          );
          expect(within(card).getByTestId('count-total')).toHaveTextContent(
            '1',
          );
        },
      },
      {
        id: 'R12',
        name: 'Confirmed transaction value by currency',
        definitionSnippet: 'grouped by currency with real counts',
        assert: (card) => {
          expect(within(card).getByTestId('count-MYR')).toHaveTextContent('2');
          expect(within(card).getByTestId('purchase-MYR')).toHaveTextContent(
            /^187$/u,
          );
          expect(within(card).getByTestId('service-fee-MYR')).toHaveTextContent(
            /^10$/u,
          );
          const totals = within(card).getByTestId('transaction-totals');
          expect(totals.textContent).toContain('187');
          expect(totals.textContent).toContain('10');
        },
      },
      {
        id: 'R13',
        name: 'MCP accounts & ledger volume',
        definitionSnippet: 'account status distribution',
        assert: (card) => {
          expect(within(card).getByTestId('count-ACTIVE')).toHaveTextContent(
            '1',
          );
          expect(within(card).getByTestId('amount-TOP_UP')).toHaveTextContent(
            /^1000$/u,
          );
        },
      },
      {
        id: 'R14',
        name: 'iPoint / reward accrual volume',
        definitionSnippet: 'daily accrual ledger entries grouped by entry type',
        assert: (card) => {
          expect(within(card).getByTestId('amount-DAILY')).toHaveTextContent(
            /^100$/u,
          );
          expect(within(card).getByTestId('count-ACTIVE')).toHaveTextContent(
            '1',
          );
        },
      },
      {
        id: 'R15',
        name: 'Commission ledger & adjustments',
        definitionSnippet: 'commission ledger entries grouped by entry type',
        assert: (card) => {
          expect(within(card).getByTestId('amount-PAYOUT')).toHaveTextContent(
            /^50$/u,
          );
          expect(within(card).getByTestId('count-APPROVED')).toHaveTextContent(
            '1',
          );
        },
      },
      {
        id: 'R16',
        name: 'Redemption order volume & catalog depth',
        definitionSnippet: 'orders grouped by status with real counts',
        assert: (card) => {
          expect(
            within(card).getByTestId('points-COMPLETED'),
          ).toHaveTextContent(/^10$/u);
          expect(within(card).getByTestId('count-ACTIVE')).toHaveTextContent(
            '3',
          );
        },
      },
      {
        id: 'R17',
        name: 'Fulfilment exceptions & shipping payments',
        definitionSnippet:
          'fulfilment exceptions (total, resolved, unresolved)',
        assert: (card) => {
          expect(
            within(card).getByTestId('exceptions-total'),
          ).toHaveTextContent('2');
          expect(
            within(card).getByTestId('exceptions-resolved'),
          ).toHaveTextContent('1');
          expect(
            within(card).getByTestId('exceptions-unresolved'),
          ).toHaveTextContent('1');
          expect(within(card).getByTestId('count-PAID')).toHaveTextContent('1');
        },
      },
      {
        id: 'R18',
        name: 'Refund request overview',
        definitionSnippet: 'MCP refund requests grouped by status',
        assert: (card) => {
          expect(within(card).getByTestId('count-REFUNDED')).toHaveTextContent(
            '1',
          );
          expect(within(card).getByTestId('count-APPROVED')).toHaveTextContent(
            '1',
          );
        },
      },
      {
        id: 'R19',
        name: 'Risk events & exception queues',
        definitionSnippet: 'risk events grouped by severity',
        assert: (card) => {
          expect(within(card).getByTestId('count-HIGH')).toHaveTextContent('1');
          expect(within(card).getByTestId('count-PENDING')).toHaveTextContent(
            '1',
          );
          expect(
            within(card).getByTestId('count-MISMATCHED'),
          ).toHaveTextContent('1');
        },
      },
    ];

    for (const expectation of expectations) {
      const card = screen.getByTestId(`report-${expectation.id}`);
      expect(card).toHaveTextContent(expectation.name);
      expect(card).toHaveTextContent(expectation.definitionSnippet);
      expectation.assert(card);
    }
  });

  it('marks advanced reports STALE or UNAVAILABLE — never a fabricated zero', async () => {
    const catalog = advancedReportCatalogFixture();
    catalog.items = catalog.items.map((item) => {
      if (item.id === 'R16') {
        return {
          ...item,
          state: 'STALE',
          stale: true,
          asOf: '2026-08-07T10:00:00.000Z',
        };
      }
      if (item.id === 'R19') {
        return {
          ...item,
          state: 'UNAVAILABLE',
          unavailable: true,
          unavailableReason: 'SOURCE_QUERY_FAILED',
          value: undefined,
        };
      }
      return item;
    });
    mockP7S9OpsApi({ reportCatalog: catalog });
    await signIn(REPORTS_URL);

    await screen.findByRole('heading', { name: 'Basic reports' });
    expect(screen.getByTestId('report-STALE')).toHaveTextContent('Stale');
    expect(screen.getByTestId('report-stale-line').textContent).toContain(
      'must not be treated as current',
    );
    const r16 = screen.getByTestId('report-R16');
    expect(r16).toHaveTextContent('Stale snapshot');
    // The stale snapshot still renders its authoritative value.
    expect(within(r16).getByTestId('points-COMPLETED')).toHaveTextContent(
      /^10$/u,
    );

    expect(screen.getByTestId('report-UNAVAILABLE')).toHaveTextContent(
      'Unavailable',
    );
    const r19 = screen.getByTestId('report-R19');
    expect(
      within(r19).getByTestId('report-unavailable-line').textContent,
    ).toContain('never fabricated');
    // The unavailable report renders NO value section and no table.
    expect(r19.textContent).not.toContain('Risk events by severity');
    expect(within(r19).queryByRole('table')).not.toBeInTheDocument();
  });

  it('exposes no export/download/CSV affordance on the advanced surface', async () => {
    mockP7S9OpsApi({ reportCatalog: advancedReportCatalogFixture() });
    await signIn(REPORTS_URL);

    await screen.findByRole('heading', { name: 'Basic reports' });
    // All 19 report cards are present.
    expect(screen.getByTestId('report-R19')).toHaveTextContent(
      'Risk events & exception queues',
    );
    // Command Center §7: no CSV/download/export affordance anywhere.
    expect(
      screen.queryByRole('button', { name: /download|csv|export/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /download|csv|export/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the bounded-window empty state for an advanced report with no rows', async () => {
    const catalog = advancedReportCatalogFixture();
    const r13 = catalog.items.find((item) => item.id === 'R13');
    if (r13) {
      r13.value = {
        kind: 'MCP_OVERVIEW',
        accounts: { total: 0, counts: {} },
        ledger: { windowDays: 90, groups: {} },
      };
    }
    mockP7S9OpsApi({ reportCatalog: catalog });
    await signIn(REPORTS_URL);

    await screen.findByRole('heading', { name: 'Basic reports' });
    const card = screen.getByTestId('report-R13');
    expect(
      within(card).getByText(/No rows in the bounded window \(90 days\)/),
    ).toBeInTheDocument();
    // Absence of rows is an empty state — never a fabricated zero row.
    expect(within(card).queryByTestId('count-ACTIVE')).not.toBeInTheDocument();
  });
});
