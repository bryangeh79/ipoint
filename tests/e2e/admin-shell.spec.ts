import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const marketId = '11111111-1111-4111-8111-111111111111';

test('desktop Admin shell supports MFA, deep links, back, refresh and axe', async ({
  page,
}) => {
  await mockAdminApi(page, [
    'dashboard.view',
    'admin.profile.self',
    'admin.session.read',
  ]);
  await page.goto(`/admin/${marketId}/dashboard`);
  await expect(
    page.getByRole('heading', { name: 'Admin sign in' }),
  ).toBeVisible();
  await authenticate(page);
  await expect(page).toHaveURL(
    new RegExp(`/admin/${marketId}/dashboard$`, 'u'),
  );
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

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

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Admin sign in' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login\?returnTo=/u);
});

test('320px mobile drawer restores focus and offline mode denies session writes', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockAdminApi(page, ['dashboard.view', 'admin.session.read']);
  await page.goto('/admin/login');
  await authenticate(page);

  const menuButton = page.getByRole('button', {
    name: 'Open Admin navigation',
  });
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: 'Admin navigation' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await drawer.getByRole('link', { name: 'Sessions and security' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sessions and security' }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Offline — read-only shell')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Revoke all sessions' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Revoke', exact: true }),
  ).toBeDisabled();
});

async function authenticate(page: Page) {
  await page.getByLabel('Admin email').fill('admin@example.com');
  await page.getByLabel('Password').fill('Admin-Password-123!');
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await page.getByLabel('Authentication code').fill('123456');
  await page.getByRole('button', { name: 'Open Admin workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function mockAdminApi(page: Page, permissions: string[]) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/admin/login')) {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'MFA_REQUIRED',
          mfa_challenge_id: 'challenge'.repeat(4),
          expires_at: '2026-08-01T12:05:00.000Z',
        }),
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
        effectivePermissions: permissions,
        accessibleMarkets: [market()],
        currentMarket: market(),
        contextVersion: 1,
        availability: { operationalWorkspace: 'AVAILABLE' },
        asOf: '2026-08-01T12:00:00.000Z',
      });
      return;
    }
    if (path.endsWith('/admin/me/markets')) {
      await json(route, {
        items: [market()],
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
      await json(route, {
        sessions: [
          {
            id: 'session-1',
            deviceLabel: 'Current browser',
            ipAddress: null,
            userAgent: null,
            createdAt: '2026-08-01T10:00:00.000Z',
            lastActivityAt: '2026-08-01T12:00:00.000Z',
            idleExpiresAt: '2026-08-01T12:30:00.000Z',
            absoluteExpiresAt: '2026-08-01T18:00:00.000Z',
            familyMaxExpiresAt: '2026-08-08T10:00:00.000Z',
            current: true,
            revokedAt: null,
            revokeReason: null,
          },
        ],
      });
      return;
    }
    await route.fulfill({ status: 404, body: '{}' });
  });
}

function market() {
  return {
    id: marketId,
    code: 'MY',
    name: 'Malaysia',
    currencyCode: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    grantedAt: '2026-08-01T10:00:00.000Z',
    isSelected: true,
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
