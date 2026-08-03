import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { kycOpsMarketA } from './test/kyc-fixtures.js';
import { mockKycOpsApi } from './test/kyc-mock.js';

const MEMBERS_URL = `/admin/${kycOpsMarketA}/kyc/members`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([MEMBERS_URL])} />);
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

describe('P7-S5C member KYC queue page', () => {
  it('renders masked queue rows with statuses and links to case detail', async () => {
    mockKycOpsApi(['member.kyc.read']);
    await signIn();
    await screen.findByRole('heading', { name: 'Member KYC queue' });

    expect(
      await screen.findByText(/3 member KYC cases in the selected market/iu),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /mem_public_1/ })).toHaveAttribute(
      'href',
      `/admin/${kycOpsMarketA}/kyc/members/33333333-3333-4333-8333-333333333333`,
    );
    // Masked emails only; the raw email never appears.
    expect(screen.getByText(/j\*\*\*@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText('jane@example.com')).not.toBeInTheDocument();
    expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Under review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
  });

  it('filters by status through the adapter without a client market parameter', async () => {
    const mock = mockKycOpsApi(['member.kyc.read']);
    await signIn();
    await screen.findByRole('heading', { name: 'Member KYC queue' });

    fireEvent.change(await screen.findByLabelText('Status'), {
      target: { value: 'SUBMITTED' },
    });
    await waitFor(() =>
      expect(
        mock.fetchSpy.mock.calls.some(([url]) =>
          String(url).includes('status=SUBMITTED'),
        ),
      ).toBe(true),
    );
    for (const [url] of mock.fetchSpy.mock.calls) {
      const value = String(url);
      if (value.includes('/admin/kyc-ops/members')) {
        expect(value).not.toMatch(/[?&]market/);
      }
    }
  });

  it('renders the empty state when the server returns no cases', async () => {
    mockKycOpsApi({
      permissions: ['member.kyc.read'],
      listBody: {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
        marketId: kycOpsMarketA,
      },
    });
    await signIn();
    await screen.findByRole('heading', { name: 'Member KYC queue' });
    expect(
      await screen.findByText('No member KYC cases found'),
    ).toBeInTheDocument();
  });

  it('renders an explicit conflict state for a market context mismatch', async () => {
    mockKycOpsApi({
      permissions: ['member.kyc.read'],
      listFails: { status: 409, code: 'MARKET_CONTEXT_MISMATCH' },
    });
    await signIn();
    await screen.findByRole('heading', { name: 'Member KYC queue' });
    expect(
      await screen.findByText('KYC case is outside the selected market'),
    ).toBeInTheDocument();
  });

  it('renders a permission-denied state without the route permission', async () => {
    mockKycOpsApi({ permissions: ['dashboard.view'] });
    await signIn();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('has zero serious or critical axe violations on the loaded queue', async () => {
    mockKycOpsApi(['member.kyc.read']);
    await signIn();
    await screen.findByRole('heading', { name: 'Member KYC queue' });
    await screen.findByText(/3 member KYC cases/iu);
    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(serious).toHaveLength(0);
  });
});
