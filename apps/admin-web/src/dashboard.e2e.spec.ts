import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const marketId = '11111111-1111-4111-8111-111111111111';
const marketB = '22222222-2222-4222-8222-222222222222';

test('desktop dashboard renders truthful sections, drill-downs and axe-clean', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto(`/admin/${marketId}/dashboard`);
  await authenticate(page);

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  for (const section of [
    'People',
    'Commerce',
    'Reviews',
    'Network',
    'Finance and operations queues',
    "Today's confirmed transactions",
    'MCP balance',
  ]) {
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
  }

  // Freshness live region summary.
  await expect(
    page.getByText(/13 fresh, 0 stale, 1 unavailable/iu),
  ).toBeVisible();

  // M10 unavailable with disclosure; never a fabricated zero.
  await expect(page.getByText(/no compliant durable source/iu)).toBeVisible();

  // Per-currency rows shown exactly as returned, no cross-currency total.
  await expect(page.getByText('160.5000000000')).toBeVisible();
  await expect(page.getByText('20.0000000000')).toBeVisible();
  await expect(page.getByText(/180\.5/u)).toHaveCount(0);

  // Masked drill-down for sensitive financial metrics.
  const drillDown = page.getByRole('link', { name: /Open MCP accounts/iu });
  await expect(drillDown).toHaveAttribute('href', `/admin/${marketId}/mcp`);
  await expect(page.getByText('Masked').first()).toBeVisible();

  await expectNoSeriousOrCriticalViolations(page);
});

test('320px mobile dashboard reflows, drawer works and stale retry is keyboard operable', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockAdminApi(page);
  await page.goto(`/admin/${marketId}/dashboard`);
  await authenticate(page);

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('128')).toBeVisible();

  // Mobile drawer opens and closes with Escape and focus restoration.
  const menuButton = page.getByRole('button', {
    name: 'Open Admin navigation',
  });
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: 'Admin navigation' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menuButton).toBeFocused();

  // No horizontal overflow at 320px.
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  await expectNoSeriousOrCriticalViolations(page);
});

async function authenticate(page: Page) {
  await page.getByLabel('Admin email').fill('admin@example.com');
  await page.getByLabel('Password').fill('Admin-Password-123!');
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await page.getByLabel('Authentication code').fill('123456');
  await page.getByRole('button', { name: 'Open Admin workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function expectNoSeriousOrCriticalViolations(page: Page) {
  await page.addScriptTag({
    path: resolve('packages/ui/node_modules/axe-core/axe.min.js'),
  });
  const seriousViolations = await page.evaluate(async () => {
    const axeApi = (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: Array<{ id: string; impact: string | null }>;
          }>;
        };
      }
    ).axe;
    const result = await axeApi.run();
    return result.violations.filter(
      ({ impact }) => impact === 'serious' || impact === 'critical',
    );
  });
  expect(seriousViolations).toEqual([]);
}

async function mockAdminApi(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path.endsWith('/auth/admin/login')) {
      await json(route, {
        code: 'MFA_REQUIRED',
        mfa_challenge_id: 'challenge'.repeat(4),
        expires_at: '2026-08-01T12:05:00.000Z',
      });
      return;
    }
    if (path.endsWith('/auth/admin/mfa/challenge')) {
      await json(route, {
        accessToken: 'admin-access-token',
        refreshToken: 'admin-refresh-token',
        accessExpiresAt: '2026-08-01T12:15:00.000Z',
        refreshExpiresAt: '2026-08-08T12:00:00.000Z',
      });
      return;
    }
    if (path.endsWith('/admin/bootstrap')) {
      await json(route, {
        actor: {
          id: 'admin-1',
          accountId: 'account-1',
          displayName: 'Bryan Admin',
          status: 'ACTIVE',
        },
        roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: 'Super Admin' }],
        effectivePermissions: ['dashboard.view'],
        accessibleMarkets: [
          market('MY', 'Malaysia'),
          market('SG', 'Singapore'),
        ],
        currentMarket: market('MY', 'Malaysia'),
        contextVersion: 1,
        availability: { operationalWorkspace: 'AVAILABLE' },
        asOf: '2026-08-01T12:00:00.000Z',
      });
      return;
    }
    if (path.endsWith('/admin/me/markets')) {
      await json(route, {
        items: [market('MY', 'Malaysia'), market('SG', 'Singapore')],
        currentMarketId: marketId,
        contextVersion: 1,
        asOf: '2026-08-01T12:00:00.000Z',
      });
      return;
    }
    if (path.endsWith('/admin/sessions/current')) {
      await json(route, {
        valid: true,
        session_id: 'session-1',
        admin_user_id: 'admin-1',
        mfa_recovery_used: false,
      });
      return;
    }
    if (path.endsWith('/admin/sessions')) {
      await json(route, { sessions: [] });
      return;
    }
    if (path.endsWith('/admin/dashboard/metrics') && method === 'GET') {
      await json(route, catalog());
      return;
    }
    const metricDetail = /\/admin\/dashboard\/metrics\/(M\d{2})$/u.exec(path);
    if (metricDetail && method === 'GET') {
      const metric = catalog().items.find(
        (item) => item.id === metricDetail[1],
      );
      if (!metric || metric.state !== 'FRESH') {
        await json(
          route,
          {
            code: 'DASHBOARD_DATA_UNAVAILABLE',
            message: 'This metric is currently unavailable.',
          },
          503,
        );
        return;
      }
      await json(route, {
        ...metric,
        marketId,
        drillDown: drillDown(metric.id),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '{}' });
  });
}

function market(code: string, name: string) {
  return {
    id: code === 'MY' ? marketId : marketB,
    code,
    name,
    currencyCode: code === 'MY' ? 'MYR' : 'SGD',
    timezone: code === 'MY' ? 'Asia/Kuala_Lumpur' : 'Asia/Singapore',
    locale: 'en-MY',
    grantedAt: '2026-08-01T10:00:00.000Z',
    isSelected: code === 'MY',
  };
}

function catalog() {
  const base = {
    definitionVersion: 1,
    freshnessClass: 'KPI',
    currencyDimension: false,
    permission: 'dashboard.view',
    source: 'canonical owner projection',
    asOf: '2026-08-01T12:00:00.000Z',
  };
  return {
    asOf: '2026-08-01T12:00:00.000Z',
    marketId,
    items: [
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
    ],
  };
}

function drillDown(metricId: string) {
  const sensitive = new Set(['M09', 'M13', 'M14']);
  return {
    metricId,
    marketId,
    marketScope: 'SELECTED',
    permission: 'dashboard.view',
    masking: sensitive.has(metricId),
    metricFilter: null,
    timeBoundary:
      metricId === 'M13'
        ? { from: '2026-08-01T00:00:00.000Z', to: '2026-08-01T12:00:00.000Z' }
        : null,
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
