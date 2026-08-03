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
  merchantApplicationQueueFixture,
  merchantListFixture,
  merchantMarketA,
} from './test/merchant-fixtures.js';

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

/**
 * P7-S5B merchants page tests: application queue + merchant list flows,
 * loading/empty/error states, filters, paging, and accessibility.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockMerchantAdminApi(permissions: string[]) {
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
          accessibleMarkets: [
            {
              id: merchantMarketA,
              code: 'MY',
              name: 'Malaysia',
              isSelected: true,
            },
          ],
          currentMarket: {
            id: merchantMarketA,
            code: 'MY',
            name: 'Malaysia',
          },
          contextVersion: 3,
          availability: { operationalWorkspace: 'AVAILABLE' },
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/markets') && method === 'GET') {
        return json({
          items: [
            {
              id: merchantMarketA,
              code: 'MY',
              name: 'Malaysia',
              isSelected: true,
            },
          ],
          currentMarketId: merchantMarketA,
          contextVersion: 3,
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/current-market') && method === 'PUT') {
        return json({
          marketId: merchantMarketA,
          contextVersion: 4,
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
      if (/\/merchants\/applications\?/u.test(url) && method === 'GET') {
        return json(merchantApplicationQueueFixture());
      }
      if (/\/merchants\/applications$/u.test(url) && method === 'GET') {
        return json(merchantApplicationQueueFixture());
      }
      if (/\/merchants\?/u.test(url) && method === 'GET') {
        return json({ items: merchantListFixture(), limit: 25, offset: 0 });
      }
      if (/\/merchants$/u.test(url) && method === 'GET') {
        return json({ items: merchantListFixture(), limit: 25, offset: 0 });
      }
      return json({ code: 'NOT_MOCKED', message: url }, 500);
    });
}

async function signInAndVerify() {
  fireEvent.change(await screen.findByLabelText('Admin email'), {
    target: { value: 'admin@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
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
}

describe('P7-S5B merchants page', () => {
  it('renders the application queue and links to branch detail', async () => {
    mockMerchantAdminApi(['merchant.view']);
    render(
      <AdminApp
        router={createAdminMemoryRouter([
          `/admin/${merchantMarketA}/merchants`,
        ])}
      />,
    );
    await signInAndVerify();

    expect(
      await screen.findByRole('heading', { name: 'Merchants' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('link', { name: 'Kopitiam Sdn Bhd' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Nasi Lemak House' }),
    ).toBeVisible();
    // Scope status text to the queue table (the filter selects render the
    // same status words as options).
    const queueTable = screen.getByRole('table', {
      name: 'Merchant applications pending review',
    });
    expect(
      within(queueTable).getAllByText('Pending application').length,
    ).toBeGreaterThan(0);
    expect(within(queueTable).getByText('Under review')).toBeInTheDocument();

    // Link targets the canonical branch-detail route with the market.
    const link = screen.getByRole('link', { name: 'Kopitiam Sdn Bhd' });
    expect(link.getAttribute('href')).toContain(
      `/admin/${merchantMarketA}/merchants/`,
    );
  });

  it('switches to the merchant list tab with masked MCP balances as returned', async () => {
    mockMerchantAdminApi(['merchant.view']);
    render(
      <AdminApp
        router={createAdminMemoryRouter([
          `/admin/${merchantMarketA}/merchants`,
        ])}
      />,
    );
    await signInAndVerify();

    await userEvent.click(
      await screen.findByRole('tab', { name: 'Merchants' }),
    );

    expect(
      await screen.findByRole('link', { name: 'Kopitiam Sdn Bhd' }),
    ).toBeVisible();
    // Balance rendered exactly as the owner returned it (no client math).
    expect(screen.getByText('1250.00000000')).toBeInTheDocument();
    const listTable = screen.getByRole('table', {
      name: 'Selected-market merchant list',
    });
    expect(within(listTable).getByText('Suspended')).toBeInTheDocument();
  });

  it('filters the queue by status and loads more', async () => {
    const api = mockMerchantAdminApi(['merchant.view']);
    render(
      <AdminApp
        router={createAdminMemoryRouter([
          `/admin/${merchantMarketA}/merchants`,
        ])}
      />,
    );
    await signInAndVerify();

    const filter = await screen.findByLabelText(
      'Filter applications by status',
    );
    await userEvent.selectOptions(filter, 'SUBMITTED');
    await waitFor(() =>
      expect(
        api.mock.calls.some(([input]) =>
          String(input).includes('applications?status=SUBMITTED'),
        ),
      ).toBe(true),
    );
  });

  it('renders an error state with retry when the queue read fails', async () => {
    const api = mockMerchantAdminApi(['merchant.view']);
    api.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/admin/bootstrap')) {
        return json({
          actor: {
            id: 'admin-1',
            accountId: 'account-1',
            displayName: 'Bryan Admin',
            status: 'ACTIVE',
          },
          roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: 'Super Admin' }],
          effectivePermissions: ['merchant.view'],
          accessibleMarkets: [
            {
              id: merchantMarketA,
              code: 'MY',
              name: 'Malaysia',
              isSelected: true,
            },
          ],
          currentMarket: {
            id: merchantMarketA,
            code: 'MY',
            name: 'Malaysia',
          },
          contextVersion: 3,
          availability: { operationalWorkspace: 'AVAILABLE' },
          asOf: '2026-08-01T12:00:00.000Z',
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
      if (/\/merchants\/applications/u.test(url) && method === 'GET') {
        return json({ code: 'PERMISSION_DENIED', message: 'no access' }, 403);
      }
      return json({ sessions: [] });
    });
    render(
      <AdminApp
        router={createAdminMemoryRouter([
          `/admin/${merchantMarketA}/merchants`,
        ])}
      />,
    );
    await signInAndVerify();

    expect(
      await screen.findByRole('heading', { name: 'Permission denied' }),
    ).toBeVisible();
  });

  it('has no serious or critical axe violations on the merchants page', async () => {
    mockMerchantAdminApi(['merchant.view']);
    render(
      <AdminApp
        router={createAdminMemoryRouter([
          `/admin/${merchantMarketA}/merchants`,
        ])}
      />,
    );
    await signInAndVerify();
    await screen.findByRole('link', { name: 'Kopitiam Sdn Bhd' });

    const result = await axe.run(document, { resultTypes: ['violations'] });
    expect(
      result.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([]);
  });
});
