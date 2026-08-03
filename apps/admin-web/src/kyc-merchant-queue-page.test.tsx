import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { kycOpsMarketA } from './test/kyc-fixtures.js';
import { mockKycOpsApi } from './test/kyc-mock.js';

const QUEUE_URL = `/admin/${kycOpsMarketA}/kyc/merchants`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([QUEUE_URL])} />);
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

describe('P7-S5C merchant KYC queue page', () => {
  it('renders masked queue rows with statuses and detail links', async () => {
    mockKycOpsApi(['merchant.kyc.view']);
    await signIn();
    await screen.findByRole('heading', { name: 'Merchant KYC queue' });

    expect(
      await screen.findByText(/2 submissions on this page/iu),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme Sdn Bhd' })).toHaveAttribute(
      'href',
      `/admin/${kycOpsMarketA}/kyc/merchants/44444444-4444-4444-8444-444444444444`,
    );
    expect(screen.getByText('Beta Trading')).toBeInTheDocument();
    expect(screen.getAllByText('Resubmission required').length).toBeGreaterThan(
      0,
    );
    // Queue rows never carry the submission payload.
    expect(screen.queryByText('registration_number')).not.toBeInTheDocument();
  });

  it('filters by status without a client market parameter', async () => {
    const mock = mockKycOpsApi(['merchant.kyc.view']);
    await signIn();
    await screen.findByRole('heading', { name: 'Merchant KYC queue' });

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
      if (value.includes('/admin/kyc-ops/merchants')) {
        expect(value).not.toMatch(/[?&]market/);
      }
    }
  });

  it('renders the empty state when the server returns no submissions', async () => {
    mockKycOpsApi({
      permissions: ['merchant.kyc.view'],
      merchantQueueBody: {
        items: [],
        marketId: kycOpsMarketA,
        limit: 50,
        offset: 0,
      },
    });
    await signIn();
    await screen.findByRole('heading', { name: 'Merchant KYC queue' });
    expect(
      await screen.findByText('No merchant KYC submissions found'),
    ).toBeInTheDocument();
  });

  it('renders conflict and permission-denied states', async () => {
    const mock = mockKycOpsApi(['merchant.kyc.view']);
    const original = mock.fetchSpy.getMockImplementation();
    mock.fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/admin/kyc-ops/merchants')) {
        return new Response(
          JSON.stringify({ code: 'MARKET_CONTEXT_MISMATCH' }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      if (original) return original(input, init);
      return new Response(JSON.stringify({ code: 'NOT_MOCKED' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    });
    await signIn();
    await screen.findByRole('heading', { name: 'Merchant KYC queue' });
    expect(
      await screen.findByText('KYC case is outside the selected market'),
    ).toBeInTheDocument();
  });

  it('has zero serious or critical axe violations on the loaded queue', async () => {
    mockKycOpsApi(['merchant.kyc.view']);
    await signIn();
    await screen.findByRole('heading', { name: 'Merchant KYC queue' });
    await screen.findByText(/2 submissions on this page/iu);
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
