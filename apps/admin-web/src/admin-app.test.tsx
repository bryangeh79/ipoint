import axe from 'axe-core';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';

const marketA = '11111111-1111-4111-8111-111111111111';
const marketB = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

describe('Admin routed shell components', () => {
  it('redirects a protected deep link to login and retains the safe target', async () => {
    const router = createAdminMemoryRouter([`/admin/${marketA}/dashboard`]);
    render(<AdminApp router={router} />);
    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/admin/login');
    expect(router.state.location.search).toContain('returnTo=');
  });

  it('completes password plus MFA and opens the protected dashboard', async () => {
    mockAdminApi(['dashboard.read']);
    const router = createAdminMemoryRouter(['/admin/login']);
    render(<AdminApp router={router} />);
    await signIn();
    expect(
      await screen.findByRole('heading', { name: 'Verify it’s you' }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '123456' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Open Admin workspace' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(`/admin/${marketA}/dashboard`);
  });

  it('enrolls MFA and renders recovery codes only after confirmation', async () => {
    mockAdminApi([]);
    render(
      <AdminApp router={createAdminMemoryRouter(['/admin/mfa/enroll'])} />,
    );
    fireEvent.change(await screen.findByLabelText('Admin email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Admin-Password-123!' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Start enrollment' }),
    );
    expect(await screen.findByText('Authenticator setup URI')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Six-digit verification code'), {
      target: { value: '123456' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm enrollment' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Store your recovery codes' }),
    ).toBeVisible();
    expect(screen.getByText('RECOVERY-CODE-01')).toBeVisible();
  });

  it('renders permission denied for a crafted deep link without permission', async () => {
    mockAdminApi(['dashboard.read']);
    render(
      <AdminApp
        router={createAdminMemoryRouter([`/admin/${marketA}/merchants`])}
      />,
    );
    await signInAndVerify();
    expect(
      await screen.findByRole('heading', { name: 'Permission denied' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /suspend|approve|execute/iu }),
    ).not.toBeInTheDocument();
  });

  it('renders a blocked prerequisite instead of an iPoint adjustment control', async () => {
    mockAdminApi(['wallet.ipoint.adjust.maker']);
    render(
      <AdminApp
        router={createAdminMemoryRouter([
          `/admin/${marketA}/ipoint-adjustments`,
        ])}
      />,
    );
    await signInAndVerify();
    expect(await screen.findByText('CAPABILITY_UNAVAILABLE')).toBeVisible();
    expect(screen.getByText('GATE-SEC-01')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /create|approve|execute/iu }),
    ).not.toBeInTheDocument();
  });

  it('shows only navigation allowed by effective permissions', async () => {
    mockAdminApi(['dashboard.read']);
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    expect(
      await screen.findByRole('link', { name: 'Dashboard' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Merchants' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
  });

  it('selects only a server-listed market and persists the revalidated hint', async () => {
    const api = mockAdminApi(['admin.profile.self'], null);
    render(<AdminApp router={createAdminMemoryRouter(['/admin/settings'])} />);
    await signInAndVerify();
    const selector = await screen.findByLabelText('Current Admin Market');
    await userEvent.selectOptions(selector, marketB);
    await waitFor(() =>
      expect(window.localStorage.getItem('ipoint.admin.market-hint')).toBe(
        marketB,
      ),
    );
    const put = api.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/admin/me/current-market') &&
        init?.method === 'PUT',
    );
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      market_id: marketB,
      expected_context_version: 3,
    });
  });

  it.each([
    'SESSION_IDLE_EXPIRED',
    'SESSION_ABSOLUTE_EXPIRED',
    'SESSION_FAMILY_EXPIRED',
    'SESSION_REVOKED',
  ])('returns to login for terminal session state %s', async (code) => {
    mockAdminApi(['dashboard.read']);
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    await signInAndVerify();
    act(() => adminApi.clearSession(code));
    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toBeVisible();
  });

  it('has no serious or critical axe violations on the login shell', async () => {
    render(<AdminApp router={createAdminMemoryRouter(['/admin/login'])} />);
    expect(
      await screen.findByRole('heading', { name: 'Admin sign in' }),
    ).toBeVisible();
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
  initialCurrentMarketId: string | null = marketA,
) {
  let currentMarketId = initialCurrentMarketId;
  let contextVersion = 3;
  const markets = [
    market(marketA, 'MY', 'Malaysia'),
    market(marketB, 'SG', 'Singapore'),
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
      if (
        url.endsWith('/auth/admin/mfa/enrollment/start') &&
        method === 'POST'
      ) {
        return json(
          {
            enrollment_challenge_id: 'enrollment'.repeat(4),
            otpauth_uri:
              'otpauth://totp/iPoint:admin@example.com?secret=SAFE-TEST-ONLY',
            expires_at: '2026-08-01T12:05:00.000Z',
          },
          202,
        );
      }
      if (
        url.endsWith('/auth/admin/mfa/enrollment/confirm') &&
        method === 'POST'
      ) {
        return json({
          recovery_codes: ['RECOVERY-CODE-01', 'RECOVERY-CODE-02'],
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
          availability: {
            operationalWorkspace: 'AVAILABLE',
          },
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
