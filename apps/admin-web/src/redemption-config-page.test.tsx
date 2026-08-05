import axe from 'axe-core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { redemptionOpsMarketA } from './test/redemption-config-fixtures.js';
import {
  mockRedemptionBlockedMarket,
  mockRedemptionConfigApi,
} from './test/redemption-config-mock.js';

const REDEMPTION_URL = `/admin/${redemptionOpsMarketA}/config/redemption-rates`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([REDEMPTION_URL])} />);
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

describe('P7-S6C redemption rate configuration page', () => {
  it('renders the approved bounds, versions and display-only rates', async () => {
    mockRedemptionConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });
    // Approved §7.2 bounds.
    expect(screen.getByTestId('redemption-config-initial')).toHaveTextContent(
      '1',
    );
    expect(screen.getByTestId('redemption-config-min')).toHaveTextContent(
      '0.5',
    );
    expect(screen.getByTestId('redemption-config-max')).toHaveTextContent('2');
    expect(screen.getByText('RM per 1 iPoint')).toBeInTheDocument();
    // Display value (≤6 decimals) shown; full precision visible too.
    expect(
      screen.getByTestId(
        'redemption-rate-22222222-2222-4222-8222-222222222222',
      ),
    ).toHaveTextContent('1.123457');
    expect(
      screen.getByTestId(
        'redemption-full-22222222-2222-4222-8222-222222222222',
      ),
    ).toHaveTextContent('1.1234567890');
    // Window statuses as badges + local and UTC times.
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01 00:00:00 → open')).toBeInTheDocument();
    expect(screen.getByText('2026-08-31T16:00:00.000Z')).toBeInTheDocument();
  });

  it('shows loading, then error with retry when the read fails', async () => {
    mockRedemptionConfigApi({
      permissions: ['redemption.rate.read'],
      scheduleFails: { status: 503, code: 'DASHBOARD_DATA_UNAVAILABLE' },
    });
    await signIn();

    expect(
      await screen.findByText('Redemption rate configuration unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('denies the read surface without the redemption.rate.read permission', async () => {
    mockRedemptionConfigApi({ permissions: ['dashboard.view'] });
    await signIn();

    expect(
      await screen.findByText(/redemption\.rate\.read/),
    ).toBeInTheDocument();
  });

  it('shows the blocked state without the SUPER_ADMIN manage permission', async () => {
    mockRedemptionConfigApi({ permissions: ['redemption.rate.read'] });
    await signIn();

    expect(
      await screen.findByText(/Managing redemption rates is Super Admin only/),
    ).toBeInTheDocument();
    // No rate input is rendered for non-managers.
    expect(
      screen.queryByLabelText('Rate per 1 iPoint'),
    ).not.toBeInTheDocument();
  });

  it('shows the explicit blocked state for an unapproved market (no fallback)', async () => {
    mockRedemptionBlockedMarket();
    await signIn();

    // The notice is rendered in the bounds section AND the create section,
    // so multiple matches are expected.
    expect(
      (
        await screen.findAllByText(
          /Redemption rate is not configured for market SG/,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /There is no fallback to Malaysia or any other market/,
      ).length,
    ).toBeGreaterThan(0);
    // No Malaysia bounds leak into the blocked market.
    expect(screen.queryByText('RM per 1 iPoint')).not.toBeInTheDocument();
    // The create form is replaced by the blocked notice.
    expect(
      screen.queryByLabelText('Rate per 1 iPoint'),
    ).not.toBeInTheDocument();
  });

  it('configures a rate with client validation, UTC preview and success message', async () => {
    mockRedemptionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });

    fireEvent.change(await screen.findByLabelText('Rate per 1 iPoint'), {
      target: { value: '1.1234567890' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Q3 redemption rate baseline' },
    });

    // Resolved-UTC preview (display helper).
    expect(
      await screen.findByTestId('redemption-utc-preview'),
    ).toHaveTextContent('2098-12-31T16:00:00.000Z');

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Configure redemption rate (Super Admin, audited)',
      }),
    );

    expect(
      await screen.findByText('Redemption rate 1.1234567890 scheduled.'),
    ).toBeInTheDocument();
    // The refreshed schedule shows the new scheduled version.
    expect((await screen.findAllByText('Scheduled')).length).toBeGreaterThan(0);
  });

  it('rejects out-of-bounds rates and missing reason before calling the server', async () => {
    const mock = mockRedemptionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });

    fireEvent.change(await screen.findByLabelText('Rate per 1 iPoint'), {
      target: { value: '2.01' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Above max' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Configure redemption rate (Super Admin, audited)',
      }),
    );
    expect(
      await screen.findByText(
        'Rate must be between 0.5 and 2 RM per 1 iPoint (approved bounds for this market).',
      ),
    ).toBeInTheDocument();

    // Missing reason is also a client-side stop.
    fireEvent.change(await screen.findByLabelText('Rate per 1 iPoint'), {
      target: { value: '1.5' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: '   ' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Configure redemption rate (Super Admin, audited)',
      }),
    );
    expect(
      await screen.findByText(
        'A reason is mandatory for every configured redemption rate.',
      ),
    ).toBeInTheDocument();

    // No create request ever reached the adapter.
    const createCalls = mock.mock.calls.filter(
      (call) =>
        String(call[0]).endsWith('/rates') && call[1]?.method === 'POST',
    );
    expect(createCalls.length).toBe(0);
  });

  it('surfaces the server overlap conflict (409) with stable copy', async () => {
    mockRedemptionConfigApi({
      createFails: { status: 409, code: 'REDEMPTION_RATE_OVERLAP' },
    });
    await signIn();
    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });

    fireEvent.change(await screen.findByLabelText('Rate per 1 iPoint'), {
      target: { value: '1.5' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Ops review' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Configure redemption rate (Super Admin, audited)',
      }),
    );

    expect(
      await screen.findByText(
        'A redemption rate version already exists for this market. Versions are immutable and overlap is prevented.',
      ),
    ).toBeInTheDocument();
  });

  it('cancels a scheduled version with a mandatory reason (append-only)', async () => {
    mockRedemptionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });

    // Only the SCHEDULED version offers the cancel action.
    const cancelButtons = screen.getAllByRole('button', {
      name: 'Cancel version',
    });
    expect(cancelButtons.length).toBe(1);

    fireEvent.click(cancelButtons[0]!);
    const cancelForm = await screen.findByTestId(
      'redemption-cancel-form-22222222-2222-4222-8222-222222222224',
    );
    expect(cancelForm).toBeInTheDocument();

    // Missing reason is a client-side stop.
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm cancel' }),
    );
    expect(
      await screen.findByText(
        'A reason is mandatory for every cancelled redemption rate.',
      ),
    ).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('Cancel reason'), {
      target: { value: 'Scheduled baseline no longer required' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm cancel' }),
    );

    // Success message + refreshed schedule shows the CANCELLED badge.
    expect(
      await screen.findByText('Redemption rate 1.8000000000 cancelled.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('redemption-window-CANCELLED'),
    ).toBeInTheDocument();
  });

  it('does not offer cancel orchestration without the manage capability gate', async () => {
    mockRedemptionConfigApi({ permissions: ['redemption.rate.read'] });
    await signIn();
    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });

    // Read-only actor: no create form, no cancel action on any version.
    expect(
      screen.queryByRole('button', { name: 'Cancel version' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Rate per 1 iPoint'),
    ).not.toBeInTheDocument();
  });

  it('surfaces the server already-cancelled conflict (409) with stable copy', async () => {
    mockRedemptionConfigApi({
      cancelFails: {
        status: 409,
        code: 'REDEMPTION_RATE_ALREADY_CANCELLED',
      },
    });
    await signIn();
    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel version' }));
    fireEvent.change(await screen.findByLabelText('Cancel reason'), {
      target: { value: 'Second attempt' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm cancel' }),
    );

    expect(
      await screen.findByText(
        'This redemption rate version has already been cancelled.',
      ),
    ).toBeInTheDocument();
  });

  it('runs axe with zero critical or serious violations (jsdom)', async () => {
    mockRedemptionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Redemption rate configuration',
    });
    const configuredResults = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const configuredSerious = configuredResults.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(configuredSerious).toEqual([]);

    // Unmount the first app before mounting the blocked-state app so no
    // duplicate landmarks accumulate.
    cleanup();
    adminApi.clearSession();
    mockRedemptionBlockedMarket();
    await signIn();
    await screen.findAllByText(
      /Redemption rate is not configured for market SG/,
    );
    const blockedResults = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const blockedSerious = blockedResults.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(blockedSerious).toEqual([]);
  });
});
