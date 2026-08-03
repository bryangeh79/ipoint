import axe from 'axe-core';
import {
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
  merchantBranchA,
  merchantBranchDetailFixture,
  merchantMarketA,
} from './test/merchant-fixtures.js';

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

/**
 * P7-S5B merchant branch detail page tests: composed detail rendering
 * (masked KYC, package history, MCP summary), suspended state, approved
 * status actions with owner audit, conflict handling, and accessibility.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface MockOptions {
  permissions?: string[];
  detail?: unknown;
  detailError?: { code: string; message: string; status: number };
  actionError?: { code: string; message: string; status: number };
}

function mockDetailAdminApi(options: MockOptions = {}) {
  const {
    permissions = ['merchant.view'],
    detail = merchantBranchDetailFixture(),
    detailError,
    actionError,
  } = options;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
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
      if (/\/merchants\/[^/]+\/detail$/u.test(url) && method === 'GET') {
        if (detailError) {
          return json(
            { code: detailError.code, message: detailError.message },
            detailError.status,
          );
        }
        return json(detail);
      }
      if (/\/application\/review$/u.test(url) && method === 'POST') {
        if (actionError) {
          return json(
            { code: actionError.code, message: actionError.message },
            actionError.status,
          );
        }
        return json({
          application_id: 'app-1',
          branch_id: merchantBranchA,
          application_status: 'APPROVED',
          operational_status: 'PENDING_KYC',
        });
      }
      if (/\/kyc\/review$/u.test(url) && method === 'POST') {
        if (actionError) {
          return json(
            { code: actionError.code, message: actionError.message },
            actionError.status,
          );
        }
        return json({
          review_id: 'kyc-review-2',
          submission_id: 'kyc-2',
          branch_id: merchantBranchA,
          kyc_status: 'APPROVED',
          operational_status: 'PENDING_MCP',
          reason: 'Fixture KYC approval',
          rejected_fields: [],
          reviewed_at: '2026-08-01T12:00:00.000Z',
        });
      }
      if (/\/suspend$/u.test(url) && method === 'POST') {
        return json({
          branch_id: merchantBranchA,
          operational_status: 'SUSPENDED',
        });
      }
      return json({ code: 'NOT_MOCKED', message: url }, 500);
    });
  return { spy, calls };
}

async function openDetail() {
  render(
    <AdminApp
      router={createAdminMemoryRouter([
        `/admin/${merchantMarketA}/merchants/${merchantBranchA}`,
      ])}
    />,
  );
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

describe('P7-S5B merchant detail page', () => {
  it('renders profile, status, masked KYC, package history, and MCP summary', async () => {
    mockDetailAdminApi();
    await openDetail();

    expect(
      await screen.findByRole('heading', { name: 'Kopitiam Sdn Bhd' }),
    ).toBeVisible();
    // Profile
    expect(screen.getByText('owner@kopitiam.example')).toBeInTheDocument();
    // Status card (scoped: 'Active'/'Approved' labels also appear in other
    // sections such as package status and review history).
    const statusCard = (
      await screen.findByRole('heading', { name: 'Status' })
    ).closest('.admin-merchant-section') as HTMLElement;
    expect(within(statusCard).getByText('Active')).toBeVisible();
    // Application + KYC statuses are both 'Approved' in this fixture.
    expect(
      within(statusCard).getAllByText('Approved').length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(statusCard).getByText('M-00000001')).toBeVisible();
    // Masked KYC values rendered exactly as owner masked them; raw values
    // are never present in the DOM.
    expect(screen.getByText('***2345')).toBeInTheDocument();
    expect(screen.getByText('****1234')).toBeInTheDocument();
    expect(screen.getByText('***789')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('900101-01-1234');
    // Package history
    expect(screen.getByText('Package A')).toBeInTheDocument();
    expect(screen.getByText('0.012500')).toBeInTheDocument();
    // MCP summary (available + total balances are both 1250.00000000).
    expect(screen.getAllByText('1250.00000000').length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText('Matches')).toBeInTheDocument();
    expect(screen.getByText('TRANSACTION_DEDUCTION')).toBeInTheDocument();
  });

  it('shows the suspended banner when the branch is suspended', async () => {
    mockDetailAdminApi({
      detail: {
        ...merchantBranchDetailFixture(),
        application: {
          ...merchantBranchDetailFixture().application,
          operational_status: 'SUSPENDED',
        },
      },
    });
    await openDetail();

    expect(
      await screen.findByRole('heading', { name: 'Kopitiam Sdn Bhd' }),
    ).toBeVisible();
    expect(screen.getByText('Merchant suspended')).toBeInTheDocument();
    expect(
      screen.getByText(/suspension preserves the mcp account/iu),
    ).toBeInTheDocument();
  });

  it('hides action forms when the current state offers no approved action', async () => {
    mockDetailAdminApi({
      // ACTIVE + APPROVED KYC + only merchant.view: no actions.
      permissions: ['merchant.view'],
    });
    await openDetail();

    expect(
      await screen.findByText(
        'No actions are available for the current merchant state and your effective permissions.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /suspend|close|review/iu }),
    ).not.toBeInTheDocument();
  });

  it('submits an application review through the owner command and refreshes', async () => {
    const { calls } = mockDetailAdminApi({
      permissions: ['merchant.view', 'merchant.approve'],
      detail: {
        ...merchantBranchDetailFixture(),
        application: {
          ...merchantBranchDetailFixture().application,
          status: 'SUBMITTED',
        },
      },
    });
    await openDetail();

    const form = await screen.findByRole('heading', {
      name: 'Review application',
    });
    const card = form.closest('form');
    expect(card).not.toBeNull();
    if (card) {
      await userEvent.selectOptions(
        within(card as HTMLElement).getByLabelText(
          'Application review decision',
        ),
        'APPROVED',
      );
      await userEvent.type(
        within(card as HTMLElement).getByLabelText('Application review reason'),
        'Fixture approval',
      );
      await userEvent.click(
        within(card as HTMLElement).getByRole('button', {
          name: 'Submit application review',
        }),
      );
    }

    expect(await screen.findByText(/action completed/iu)).toBeVisible();
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' && call.url.endsWith('/application/review'),
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        calls.filter((call) =>
          call.url.endsWith(`/merchants/${merchantBranchA}/detail`),
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('shows a conflict banner when the owner rejects an invalid transition', async () => {
    const { calls } = mockDetailAdminApi({
      permissions: ['merchant.view', 'merchant.approve'],
      detail: {
        ...merchantBranchDetailFixture(),
        application: {
          ...merchantBranchDetailFixture().application,
          status: 'SUBMITTED',
        },
      },
      actionError: {
        code: 'MERCHANT_INVALID_TRANSITION',
        message: 'invalid',
        status: 409,
      },
    });
    await openDetail();

    const heading = await screen.findByRole('heading', {
      name: 'Review application',
    });
    const card = heading.closest('form');
    expect(card).not.toBeNull();
    if (card) {
      await userEvent.type(
        within(card as HTMLElement).getByLabelText('Application review reason'),
        'Try anyway',
      );
      await userEvent.click(
        within(card as HTMLElement).getByRole('button', {
          name: 'Submit application review',
        }),
      );
    }

    expect(await screen.findByText(/state conflict/iu)).toBeVisible();
    expect(
      screen.getByText(/not valid for the current merchant state/iu),
    ).toBeInTheDocument();
  });

  it('shows the rejected-fields input when KYC decision is resubmission', async () => {
    mockDetailAdminApi({
      permissions: ['merchant.view', 'merchant.kyc.approve'],
      detail: {
        ...merchantBranchDetailFixture(),
        kyc: {
          current: {
            submission_id: 'kyc-2',
            submission_version: 2,
            status: 'SUBMITTED',
            submitted_at: '2026-08-01T00:00:00.000Z',
            data: {},
          },
          previous: null,
        },
      },
    });
    await openDetail();

    const heading = await screen.findByRole('heading', {
      name: 'Review KYC',
    });
    const card = heading.closest('form');
    expect(card).not.toBeNull();
    if (card) {
      await userEvent.selectOptions(
        within(card as HTMLElement).getByLabelText('KYC review decision'),
        'RESUBMISSION_REQUIRED',
      );
      expect(
        within(card as HTMLElement).getByLabelText(
          'Rejected KYC fields (comma separated)',
        ),
      ).toBeVisible();
    }
  });

  it('renders the not-found copy for a missing branch', async () => {
    mockDetailAdminApi({
      detailError: {
        code: 'MERCHANT_BRANCH_NOT_FOUND',
        message: 'Merchant branch not found.',
        status: 404,
      },
    });
    await openDetail();

    expect(
      await screen.findByRole('heading', {
        name: 'Merchant branch not found',
      }),
    ).toBeVisible();
  });

  it('renders the market mismatch copy when the current market changed', async () => {
    mockDetailAdminApi({
      detailError: {
        code: 'MARKET_CONTEXT_MISMATCH',
        message: 'changed',
        status: 409,
      },
    });
    await openDetail();

    expect(
      await screen.findByRole('heading', {
        name: 'Market context mismatch',
      }),
    ).toBeVisible();
  });

  it('has no serious or critical axe violations on the detail page', async () => {
    mockDetailAdminApi({
      permissions: ['merchant.view', 'merchant.suspend', 'merchant.close'],
    });
    await openDetail();
    await screen.findByRole('heading', { name: 'Kopitiam Sdn Bhd' });

    const result = await axe.run(document, { resultTypes: ['violations'] });
    expect(
      result.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([]);
  });
});
