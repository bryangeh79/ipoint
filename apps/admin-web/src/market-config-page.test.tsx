import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { marketConfigMarketA } from './test/market-config-fixtures.js';
import { mockMarketConfigApi } from './test/market-config-mock.js';

const MARKET_URL = `/admin/${marketConfigMarketA}/config/market`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([MARKET_URL])} />);
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

describe('P7-S6E market configuration page', () => {
  it('renders the registry projection with the current market values', async () => {
    mockMarketConfigApi();
    await signIn();

    await screen.findByRole('heading', { name: 'Market configuration' });
    // Wait for the form to be seeded from the server row.
    await screen.findByDisplayValue('Malaysia');
    expect(screen.getByTestId('market-status-ACTIVE')).toHaveTextContent(
      'ACTIVE',
    );
    const nameInput = screen.getByTestId(
      'market-name-input',
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('Malaysia');
    const currencyInput = screen.getByTestId(
      'market-currency-input',
    ) as HTMLInputElement;
    expect(currencyInput.value).toBe('MYR');
    const timezoneInput = screen.getByTestId(
      'market-timezone-input',
    ) as HTMLInputElement;
    expect(timezoneInput.value).toBe('Asia/Kuala_Lumpur');
    const localeInput = screen.getByTestId(
      'market-locale-input',
    ) as HTMLInputElement;
    expect(localeInput.value).toBe('en-MY');
    // Submit disabled until a change + reason are present.
    expect(
      (screen.getByTestId('market-submit-button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows loading, then error with retry when the read fails', async () => {
    mockMarketConfigApi({
      permissions: ['market.read'],
      configFails: { status: 503, code: 'DASHBOARD_DATA_UNAVAILABLE' },
    });
    await signIn();

    expect(
      await screen.findByText('Market configuration unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('denies the read surface without the market.read permission', async () => {
    mockMarketConfigApi({ permissions: ['dashboard.view'] });
    await signIn();

    expect(await screen.findByText(/market\.read/)).toBeInTheDocument();
  });

  it('shows the blocked state for a non-ACTIVE market (no fallback)', async () => {
    mockMarketConfigApi({
      permissions: ['market.read', 'market.manage'],
      configBody: {
        market_id: marketConfigMarketA,
        market_code: 'MY',
        name: 'Malaysia',
        status: 'INACTIVE',
        currency_code: 'MYR',
        timezone: 'Asia/Kuala_Lumpur',
        default_locale: 'en-MY',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
        configured: false,
      },
    });
    await signIn();

    expect(
      await screen.findByText('Market MY is not active'),
    ).toBeInTheDocument();
    // No form is rendered for a blocked market.
    expect(screen.queryByTestId('market-name-input')).not.toBeInTheDocument();
  });

  it('submits only the changed fields with a mandatory reason and auto Idempotency-Key', async () => {
    const { fetchSpy } = mockMarketConfigApi();
    await signIn();
    await screen.findByRole('heading', { name: 'Market configuration' });
    await screen.findByDisplayValue('Malaysia');

    fireEvent.change(screen.getByTestId('market-name-input'), {
      target: { value: 'Malaysia Renamed' },
    });
    fireEvent.change(screen.getByTestId('market-reason-input'), {
      target: { value: 'Rebranding' },
    });
    await userEvent.click(screen.getByTestId('market-submit-button'));

    expect(await screen.findByText(/Market MY updated/)).toBeInTheDocument();

    const patchCall = fetchSpy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    const [url, init] = patchCall as unknown as [string, RequestInit];
    expect(String(url)).toContain(
      `/admin/market-ops/markets/${marketConfigMarketA}`,
    );
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBeTruthy();
    // Only the changed name + the mandatory reason are sent (currency,
    // timezone, locale untouched).
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Malaysia Renamed',
      reason: 'Rebranding',
    });
  });

  it('shows the deactivation confirmation UI and sends the confirmation', async () => {
    const { fetchSpy } = mockMarketConfigApi();
    await signIn();
    await screen.findByRole('heading', { name: 'Market configuration' });
    await screen.findByDisplayValue('Malaysia');

    fireEvent.change(screen.getByTestId('market-status-select'), {
      target: { value: 'INACTIVE' },
    });
    // Confirmation required before submit is enabled.
    expect(
      (screen.getByTestId('market-submit-button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(/I confirm the deactivation of this market/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('market-reason-input'), {
      target: { value: 'Market wind-down' },
    });
    fireEvent.click(screen.getByTestId('market-deactivation-confirm'));
    expect(
      (screen.getByTestId('market-submit-button') as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    await userEvent.click(screen.getByTestId('market-submit-button'));
    expect(
      await screen.findByText(/Market MY deactivated/),
    ).toBeInTheDocument();

    const patchCall = fetchSpy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    const [, init] = patchCall as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      status: 'INACTIVE',
      deactivationConfirmed: true,
      reason: 'Market wind-down',
    });
  });

  it('surfaces a deactivation dependency rejection from the server', async () => {
    mockMarketConfigApi({
      permissions: ['market.read', 'market.manage'],
      updateFails: {
        status: 409,
        code: 'MARKET_DEACTIVATION_DEPENDENCY',
      },
    });
    await signIn();
    await screen.findByRole('heading', { name: 'Market configuration' });
    await screen.findByDisplayValue('Malaysia');

    fireEvent.change(screen.getByTestId('market-status-select'), {
      target: { value: 'INACTIVE' },
    });
    fireEvent.change(screen.getByTestId('market-reason-input'), {
      target: { value: 'Wind-down' },
    });
    fireEvent.click(screen.getByTestId('market-deactivation-confirm'));
    await userEvent.click(screen.getByTestId('market-submit-button'));

    expect(
      await screen.findByText(/cannot be deactivated while active resources/),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations on the loaded form', async () => {
    mockMarketConfigApi();
    await signIn();
    await screen.findByRole('heading', { name: 'Market configuration' });
    await screen.findByDisplayValue('Malaysia');
    const results = await axe.run(document.body);
    expect(results.violations).toHaveLength(0);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
});
