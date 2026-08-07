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
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import {
  P7S9_MARKET_ID,
  mockP7S9OpsApi,
  reportCatalogFixture,
} from './test/p7-s9-ops-mock.js';

const REPORTS_URL = `/admin/${P7S9_MARKET_ID}/reports`;

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
    expect(screen.getByText(/Totals: 2 registrations · 1 activations/i)).toBeInTheDocument();
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
    expect(screen.getByTestId('report-R03').textContent).not.toContain(
      'Count',
    );
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
