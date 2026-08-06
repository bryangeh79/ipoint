import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { commissionOpsMarketA } from './test/commission-config-fixtures.js';
import {
  mockCommissionConfigApi,
  mockCommissionConfigApi as mockCommissionBlockedMarket,
} from './test/commission-config-mock.js';

const COMMISSION_URL = `/admin/${commissionOpsMarketA}/config/commissions`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([COMMISSION_URL])} />);
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

describe('P7-S6D commission rate configuration page', () => {
  it('renders the per-definition table with current + scheduled + full precision', async () => {
    mockCommissionConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });
    // Current version marker + display/full precision.
    expect(
      screen.getByTestId('commission-current-AGENT_UPGRADE-1'),
    ).toHaveTextContent('(current)');
    expect(
      screen.getByTestId('commission-rate-version-upgrade-388'),
    ).toHaveTextContent('388');
    expect(
      screen.getByTestId('commission-full-version-upgrade-388'),
    ).toHaveTextContent('388.0000000000');
    // Window statuses as badges + local and UTC times.
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Superseded')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(
      screen.getByText('2026-07-25 00:00:00 → 2026-09-01 00:00:00'),
    ).toBeInTheDocument();
    expect(screen.getByText('2026-09-01T00:00:00.000Z')).toBeInTheDocument();
    // Not-configured definitions show the explicit empty state (4 of the
    // 6 frozen definitions have no versions in the fixture).
    expect(
      screen.getByTestId('commission-definition-MERCHANT_RECRUITMENT-0'),
    ).toHaveTextContent('MERCHANT_RECRUITMENT G0');
    expect(screen.getAllByText(/Not configured yet/).length).toBe(4);
  });

  it('shows loading, then error with retry when the read fails', async () => {
    mockCommissionConfigApi({
      permissions: ['commission.rate.read'],
      configFails: { status: 503, code: 'DASHBOARD_DATA_UNAVAILABLE' },
    });
    await signIn();

    expect(
      await screen.findByText('Commission rate configuration unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('denies the read surface without the commission.rate.read permission', async () => {
    mockCommissionConfigApi({ permissions: ['dashboard.view'] });
    await signIn();

    expect(
      await screen.findByText(/commission\.rate\.read/),
    ).toBeInTheDocument();
  });

  it('shows the blocked state without the SUPER_ADMIN manage permission', async () => {
    mockCommissionConfigApi({ permissions: ['commission.rate.read'] });
    await signIn();

    expect(
      await screen.findByText(/Managing commission rates is Super Admin only/),
    ).toBeInTheDocument();
    // No rate input is rendered for non-managers.
    expect(
      screen.queryByLabelText('Rate (FIXED — MYR)'),
    ).not.toBeInTheDocument();
  });

  it('shows the explicit blocked state for a non-ACTIVE market (no fallback)', async () => {
    mockCommissionBlockedMarket({
      configBody: {
        market_id: commissionOpsMarketA,
        market_code: 'MY',
        timezone: 'Asia/Kuala_Lumpur',
        currency: 'MYR',
        configured: false,
        taxonomy: [],
        definitions: [],
      },
    });
    await signIn();

    // The blocked notice is rendered in the table section AND the create
    // section, so multiple matches are expected.
    expect(
      (await screen.findAllByText(/Market MY is blocked for rate management/))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/no fallback to any other market/).length,
    ).toBeGreaterThan(0);
    // The create form is replaced by the blocked notice.
    expect(
      screen.queryByLabelText('Rate (FIXED — MYR)'),
    ).not.toBeInTheDocument();
  });

  it('creates a rate with client validation, UTC preview and success message', async () => {
    mockCommissionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });

    // FIXED rate for AGENT_UPGRADE (default type) in MYR.
    fireEvent.change(await screen.findByLabelText('Rate (FIXED — MYR)'), {
      target: { value: '388.0000000000' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Q3 commission rate baseline' },
    });

    // Resolved-UTC preview (display helper).
    expect(
      await screen.findByTestId('commission-utc-preview'),
    ).toHaveTextContent('2098-12-31T16:00:00.000Z');

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create commission rate (Super Admin, audited)',
      }),
    );

    expect(
      await screen.findByText(
        'AGENT_UPGRADE generation 1 rate 388.0000000000 scheduled.',
      ),
    ).toBeInTheDocument();
    // The refreshed table shows the new scheduled version.
    expect((await screen.findAllByText('Scheduled')).length).toBeGreaterThan(0);
  });

  it('switches the rate unit between FIXED and PERCENTAGE per commission type', async () => {
    mockCommissionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });

    fireEvent.change(await screen.findByLabelText('Commission type'), {
      target: { value: 'MEMBER_CONSUMPTION' },
    });
    // PERCENTAGE unit label replaces the currency label; generations G1/G2.
    expect(
      await screen.findByLabelText('Rate (PERCENTAGE %)'),
    ).toBeInTheDocument();
    const generationSelect = screen.getByLabelText(
      'Generation',
    ) as HTMLSelectElement;
    expect(generationSelect.options.length).toBe(2);
    expect(generationSelect.options[0]?.text).toBe('Generation 1');

    // A percentage above 100 is a client-side stop.
    fireEvent.change(await screen.findByLabelText('Rate (PERCENTAGE %)'), {
      target: { value: '150' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Over cap' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create commission rate (Super Admin, audited)',
      }),
    );
    expect(
      await screen.findByText('A percentage rate cannot exceed 100%.'),
    ).toBeInTheDocument();
  });

  it('rejects invalid rates and missing reason before calling the server', async () => {
    const mock = mockCommissionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });

    fireEvent.change(await screen.findByLabelText('Rate (FIXED — MYR)'), {
      target: { value: '1.12345678901' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Too precise' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create commission rate (Super Admin, audited)',
      }),
    );
    expect(
      await screen.findByText(
        'Rate must be a non-negative decimal string with at most 10 decimal places.',
      ),
    ).toBeInTheDocument();

    // Missing reason is also a client-side stop.
    fireEvent.change(await screen.findByLabelText('Rate (FIXED — MYR)'), {
      target: { value: '388' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: '   ' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create commission rate (Super Admin, audited)',
      }),
    );
    expect(
      await screen.findByText(
        'A reason is mandatory for every created commission rate.',
      ),
    ).toBeInTheDocument();

    // No create request ever reached the adapter.
    const createCalls = mock.fetchSpy.mock.calls.filter(
      (call) =>
        String(call[0]).endsWith('/rates') && call[1]?.method === 'POST',
    );
    expect(createCalls.length).toBe(0);
  });

  it('surfaces the server overlap conflict (409) with stable copy', async () => {
    mockCommissionConfigApi({
      createFails: { status: 409, code: 'OVERLAPPING_RATE_PERIOD' },
    });
    await signIn();
    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });

    fireEvent.change(await screen.findByLabelText('Rate (FIXED — MYR)'), {
      target: { value: '388' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Ops review' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create commission rate (Super Admin, audited)',
      }),
    );

    expect(
      await screen.findByText(
        'A rate version already exists for this commission type and generation in this market. Versions are immutable and overlap is prevented.',
      ),
    ).toBeInTheDocument();
  });

  it('surfaces the server taxonomy rejection (422) with stable copy', async () => {
    mockCommissionConfigApi({
      createFails: { status: 422, code: 'INVALID_GENERATION' },
    });
    await signIn();
    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });

    fireEvent.change(await screen.findByLabelText('Rate (FIXED — MYR)'), {
      target: { value: '388' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2099-01-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Ops review' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create commission rate (Super Admin, audited)',
      }),
    );

    expect(
      await screen.findByText(
        'The generation is not valid for the selected commission type.',
      ),
    ).toBeInTheDocument();
  });

  it('does not render the create form without the manage capability gate', async () => {
    mockCommissionConfigApi({ permissions: ['commission.rate.read'] });
    await signIn();
    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });

    // Read-only actor: no create form.
    expect(
      screen.queryByRole('button', {
        name: 'Create commission rate (Super Admin, audited)',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Rate (FIXED — MYR)'),
    ).not.toBeInTheDocument();
  });

  it('runs axe with zero critical or serious violations (jsdom)', async () => {
    mockCommissionConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Commission rate configuration',
    });
    const configuredResults = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const configuredSerious = configuredResults.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(configuredSerious).toEqual([]);
    void cleanup;
  });
});
