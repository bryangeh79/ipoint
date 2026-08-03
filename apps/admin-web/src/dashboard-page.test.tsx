import axe from 'axe-core';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import {
  dashboardCatalogFixture,
  dashboardDrillDownFixture,
  dashboardMarketA,
  dashboardMarketB,
} from './test/dashboard-fixtures.js';

const freshCatalog = dashboardCatalogFixture(dashboardMarketA);

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

describe('P7-S4B dashboard page', () => {
  it('loads the catalog and renders all seven sections with states', async () => {
    const api = mockAdminApi(['dashboard.view']);
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    expect(
      await screen.findByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible();

    // All section headings (scoped to the dashboard region — the navigation
    // groups use the same words as headings in the side rail).
    const dashboard = await screen.findByRole('region', { name: 'Dashboard' });
    for (const section of [
      'People',
      'Commerce',
      'Reviews',
      'Network',
      'Finance and operations queues',
      "Today's confirmed transactions",
      'MCP balance',
    ]) {
      expect(
        within(dashboard).getByRole('heading', { name: section }),
      ).toBeInTheDocument();
    }

    // Catalog was fetched for the selected market.
    await waitFor(() =>
      expect(
        api.mock.calls.some(([url]) =>
          String(url).endsWith('/admin/dashboard/metrics'),
        ),
      ).toBe(true),
    );

    // Freshness summary live region: M01–M09, M11–M14 fresh; M10 unavailable.
    expect(
      screen.getByText(/13 fresh, 0 stale, 1 unavailable/iu),
    ).toBeInTheDocument();

    // Unavailable M10 with disclosure, never zero (badge + state panel).
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/no compliant durable source/iu),
    ).toBeInTheDocument();
  });

  it('renders per-currency rows exactly and masks sensitive drill-down', async () => {
    mockAdminApi(['dashboard.view']);
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    const todaySection = await screen.findByRole('heading', {
      name: "Today's confirmed transactions",
    });
    const totals = await screen.findByTestId('metric-currency-totals');
    expect(within(totals).getByText('160.5000000000')).toBeInTheDocument();
    expect(within(totals).getByText('20.0000000000')).toBeInTheDocument();
    expect(screen.queryByText(/180\.5/u)).not.toBeInTheDocument();
    expect(
      within(todaySection.closest('section')!).getAllByText('Masked').length,
    ).toBeGreaterThan(0);
  });

  it('refreshes the dashboard when the server-bound market changes', async () => {
    const api = mockAdminApi(['dashboard.view']);
    const router = createAdminMemoryRouter(['/admin/login']);
    render(<AdminApp router={router} />);
    await signInAndVerify();
    await waitFor(() =>
      expect(
        api.mock.calls.filter(([url]) =>
          String(url).endsWith('/admin/dashboard/metrics'),
        ),
      ).toHaveLength(1),
    );

    // The top-bar selector is server-owned: switching it changes the server
    // Current Admin Market without auto-rewriting the URL. The dashboard for
    // the new market loads when the user opens its deep link.
    const selector = await screen.findByLabelText('Current Admin Market');
    await userEvent.selectOptions(selector, dashboardMarketB);
    await waitFor(() =>
      expect(window.localStorage.getItem('ipoint.admin.market-hint')).toBe(
        dashboardMarketB,
      ),
    );
    await act(async () => {
      await router.navigate(`/admin/${dashboardMarketB}/dashboard`);
    });

    await waitFor(() =>
      expect(
        api.mock.calls.filter(([url]) =>
          String(url).endsWith('/admin/dashboard/metrics'),
        ),
      ).toHaveLength(2),
    );
    expect(
      screen.getByText(/selected-market operational summary/i),
    ).toBeInTheDocument();
  });

  it('shows an error state with retry when the catalog fetch fails', async () => {
    mockAdminApi(['dashboard.view'], {
      dashboardFails: true,
    });
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    expect(
      await screen.findByRole('heading', { name: 'Dashboard unavailable' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retry dashboard' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('metric-count')).not.toBeInTheDocument();
  });

  it('shows a stale metric with its last value and refresh action', async () => {
    const api = mockAdminApi(['dashboard.view'], {
      staleMetricIds: ['M02'],
    });
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    expect(await screen.findByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
    const refreshButtons = screen.getAllByRole('button', {
      name: 'Refresh metric',
    });
    await userEvent.click(refreshButtons[0]!);
    await waitFor(() =>
      expect(
        api.mock.calls.filter(([url]) =>
          String(url).endsWith('/admin/dashboard/metrics'),
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('keeps the dashboard read-only (no write controls on the page)', async () => {
    mockAdminApi(['dashboard.view']);
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    expect(
      (await screen.findAllByTestId('metric-count')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /approve|execute|submit|reject/iu }),
    ).not.toBeInTheDocument();
  });

  it('has no serious or critical axe violations on the loaded dashboard', async () => {
    mockAdminApi(['dashboard.view']);
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    await screen.findByTestId('metric-currency-totals');
    await waitFor(() =>
      expect(screen.getByText(/13 fresh/iu)).toBeInTheDocument(),
    );
    const result = await axe.run(document, {
      resultTypes: ['violations'],
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([]);
  });
});

async function signIn() {
  fireEvent.change(await screen.findByLabelText('Admin email'), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'Admin-Password-123!' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Continue securely' }),
  );
}

async function signInAndVerify() {
  await signIn();
  fireEvent.change(await screen.findByLabelText('Authentication code'), {
    target: { value: '123456' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Open Admin workspace' }),
  );
  await screen.findByText('Bryan Admin');
}

function mockAdminApi(
  permissions: string[],
  options: {
    dashboardFails?: boolean;
    staleMetricIds?: string[];
  } = {},
) {
  let currentMarketId = dashboardMarketA;
  let contextVersion = 3;
  const markets = [
    market(dashboardMarketA, 'MY', 'Malaysia'),
    market(dashboardMarketB, 'SG', 'Singapore'),
  ];
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/admin/login') && method === 'POST') {
        return json(
          {
            code: 'MFA_REQUIRED',
            mfa_challenge_id: 'challenge'.repeat(4),
            expires_at: '2026-08-01T12:05:00.000Z',
          },
          202,
        );
      }
      if (url.endsWith('/auth/admin/mfa/challenge') && method === 'POST') {
        return json({
          accessToken: 'admin-access-token',
          refreshToken: 'admin-refresh-token',
          accessExpiresAt: '2026-08-01T12:15:00.000Z',
          refreshExpiresAt: '2026-08-08T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/bootstrap')) {
        return json({
          actor: {
            id: 'admin-1',
            accountId: 'account-1',
            displayName: 'Bryan Admin',
            status: 'ACTIVE',
          },
          roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: 'Super Admin' }],
          effectivePermissions: permissions,
          accessibleMarkets: markets.map((item) => ({
            ...item,
            isSelected: item.id === currentMarketId,
          })),
          currentMarket:
            markets.find(({ id }) => id === currentMarketId) ?? null,
          contextVersion,
          availability: { operationalWorkspace: 'AVAILABLE' },
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/markets') && method === 'GET') {
        return json({
          items: markets.map((item) => ({
            ...item,
            isSelected: item.id === currentMarketId,
          })),
          currentMarketId,
          contextVersion,
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/current-market') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as {
          market_id: string;
          expected_context_version: number;
        };
        currentMarketId = body.market_id;
        contextVersion += 1;
        return json({
          marketId: currentMarketId,
          contextVersion,
          selectedAt: '2026-08-01T12:01:00.000Z',
        });
      }
      if (url.endsWith('/admin/sessions/current')) {
        return json({
          valid: true,
          session_id: 'session-1',
          admin_user_id: 'admin-1',
          mfa_recovery_used: false,
        });
      }
      if (url.endsWith('/admin/sessions')) return json({ sessions: [] });
      if (url.endsWith('/admin/dashboard/metrics') && method === 'GET') {
        if (options.dashboardFails) {
          return json(
            {
              code: 'SOURCE_QUERY_FAILED',
              message: 'Dashboard source query failed.',
            },
            503,
          );
        }
        const items = freshCatalog.items.map((item) =>
          options.staleMetricIds?.includes(item.id)
            ? { ...item, state: 'STALE', asOf: '2026-08-01T11:00:00.000Z' }
            : item,
        );
        return json({ ...freshCatalog, items });
      }
      const metricDetail = /\/admin\/dashboard\/metrics\/(M\d{2})$/u.exec(url);
      if (metricDetail && method === 'GET') {
        const metric = freshCatalog.items.find(
          (item) => item.id === metricDetail[1],
        );
        if (!metric || metric.state !== 'FRESH') {
          return json(
            {
              code: 'DASHBOARD_DATA_UNAVAILABLE',
              message: 'This metric is currently unavailable.',
            },
            503,
          );
        }
        return json({
          ...metric,
          marketId: currentMarketId,
          drillDown: dashboardDrillDownFixture(metric.id, currentMarketId),
        });
      }
      throw new Error(`Unexpected Admin API request: ${method} ${url}`);
    });
}

function market(id: string, code: string, name: string) {
  return {
    id,
    code,
    name,
    currencyCode: code === 'MY' ? 'MYR' : 'SGD',
    timezone: code === 'MY' ? 'Asia/Kuala_Lumpur' : 'Asia/Singapore',
    locale: 'en',
    grantedAt: '2026-08-01T10:00:00.000Z',
    isSelected: false,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
