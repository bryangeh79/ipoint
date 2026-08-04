import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { packageOpsMarketA } from './test/package-config-fixtures.js';
import { mockPackageConfigApi } from './test/package-config-mock.js';

const PACKAGES_URL = `/admin/${packageOpsMarketA}/config/packages`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([PACKAGES_URL])} />);
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

describe('P7-S6A package configuration page', () => {
  it('renders the catalog with exact decimal rates and lifecycle badges', async () => {
    mockPackageConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Merchant package configuration',
    });
    // Standard packages A and B with exact decimal strings.
    expect(await screen.findByText('2.500000')).toBeInTheDocument();
    expect(screen.getByText('5.000000')).toBeInTheDocument();
    expect(screen.getByText('3.000000')).toBeInTheDocument();
    // Statuses rendered as lifecycle badges.
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    // The DRAFT version is activateable, so the activate action is present.
    expect(
      screen.getByRole('button', { name: 'Activate 3.000000' }),
    ).toBeInTheDocument();
    // Pinning notice (never moved / no batch migration).
    expect(
      screen.getByText(/never move existing merchant assignments/iu),
    ).toBeInTheDocument();
    // Blocked special-percentage creation notice is always visible.
    expect(
      screen.getByText('Special percentage creation unavailable'),
    ).toBeInTheDocument();
  });

  it('shows loading, then error with retry when the catalog read fails', async () => {
    mockPackageConfigApi({
      permissions: ['merchant.package.view'],
      catalogFails: { status: 503, code: 'DASHBOARD_DATA_UNAVAILABLE' },
    });
    await signIn();

    expect(
      await screen.findByText('Package configuration unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('denies the special-percentage surface without the SUPER_ADMIN permission', async () => {
    mockPackageConfigApi({
      permissions: ['merchant.package.view', 'merchant.package.manage'],
    });
    await signIn();

    await screen.findByRole('heading', {
      name: 'Merchant package configuration',
    });
    // Permission-denied card for the privileged surface; the catalog still
    // renders (server authority, not UI hiding).
    expect(
      await screen.findByText(/merchant\.special_package\.manage/),
    ).toBeInTheDocument();
    expect(screen.getByText('2.500000')).toBeInTheDocument();
  });

  it('requires step-up before listing special percentages, then lists them audited', async () => {
    mockPackageConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Merchant package configuration',
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'View special percentages' }),
    );
    // Step-up challenge appears.
    await screen.findByText('Verify to view special percentages');
    fireEvent.change(
      await screen.findByLabelText('Special percentage verification code'),
      { target: { value: '654321' } },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('12.500000')).toBeInTheDocument();
    expect(screen.getByText('Special launch partner')).toBeInTheDocument();
  });

  it('creates and activates a draft version through the owner commands', async () => {
    const mock = mockPackageConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Merchant package configuration',
    });
    fireEvent.change(await screen.findByLabelText('Rate for package A'), {
      target: { value: '4.5' },
    });
    fireEvent.change(await screen.findByLabelText('Effective from for A'), {
      target: { value: '2027-01-01T00:00' },
    });
    fireEvent.change(await screen.findByLabelText('Effective to for A'), {
      target: { value: '2027-06-01T00:00' },
    });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Create draft version' })[0]!,
    );

    await waitFor(() =>
      expect(
        mock.fetchSpy.mock.calls.some(([url]) =>
          String(url).endsWith(
            `/admin/markets/${packageOpsMarketA}/packages/22222222-2222-4222-8222-222222222222/versions`,
          ),
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByText(/Draft version created for package A/iu),
    ).toBeInTheDocument();

    // Activate the draft (owner route with Idempotency-Key).
    await userEvent.click(
      screen.getByRole('button', { name: 'Activate 3.000000' }),
    );
    await waitFor(() =>
      expect(
        mock.fetchSpy.mock.calls.some(([url, init]) => {
          const method = (init as RequestInit | undefined)?.method ?? 'GET';
          return (
            method === 'PATCH' &&
            String(url).includes(
              '/versions/33333333-3333-4333-8333-333333333334/activate',
            )
          );
        }),
      ).toBe(true),
    );
    expect(
      await screen.findByText(/Version 3\.000000 activated/iu),
    ).toBeInTheDocument();
  });

  it('rejects an invalid rate locally before any owner call', async () => {
    const mock = mockPackageConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Merchant package configuration',
    });
    fireEvent.change(await screen.findByLabelText('Rate for package A'), {
      target: { value: '0' },
    });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Create draft version' })[0]!,
    );

    expect(
      await screen.findByText(/Rate must be a decimal string >0% and <=100%/iu),
    ).toBeInTheDocument();
    expect(
      mock.fetchSpy.mock.calls.some(([url]) =>
        String(url).includes(
          '/packages/22222222-2222-4222-8222-222222222222/versions',
        ),
      ),
    ).toBe(false);
  });

  it('searches a merchant and explicitly reassigns with the default switch', async () => {
    const mock = mockPackageConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Merchant package configuration',
    });
    const search = await screen.findByLabelText('Search merchants');
    fireEvent.change(search, { target: { value: 'Acme' } });
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await userEvent.click(
      await screen.findByRole('button', { name: 'Acme Package Co' }),
    );
    await screen.findByText('Current assignments');
    // The rate appears in the catalog AND the assignments table.
    expect((await screen.findAllByText('2.500000')).length).toBeGreaterThan(0);

    // Explicit assignment with the version picker.
    await userEvent.selectOptions(
      await screen.findByLabelText('Assign version'),
      '33333333-3333-4333-8333-333333333333',
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Assign package (explicit, audited)',
      }),
    );
    await waitFor(() =>
      expect(
        mock.fetchSpy.mock.calls.some(([url, init]) => {
          const method = (init as RequestInit | undefined)?.method ?? 'GET';
          return (
            method === 'POST' && String(url).includes('/packages/assignments')
          );
        }),
      ).toBe(true),
    );
    expect(
      await screen.findByText(/previous assignment stays pinned in history/iu),
    ).toBeInTheDocument();
  });

  it('runs axe with zero critical or serious violations', async () => {
    mockPackageConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Merchant package configuration',
    });
    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(serious).toEqual([]);
  });
});
