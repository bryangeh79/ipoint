import axe from 'axe-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import { rewardOpsMarketA } from './test/reward-config-fixtures.js';
import { mockRewardConfigApi } from './test/reward-config-mock.js';

const REWARD_URL = `/admin/${rewardOpsMarketA}/config/reward-rates`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

async function signIn() {
  render(<AdminApp router={createAdminMemoryRouter([REWARD_URL])} />);
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

describe('P7-S6B reward configuration page', () => {
  it('renders the schedule with exact decimal rates, statuses and UTC', async () => {
    mockRewardConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Reward rate configuration',
    });
    // Exact decimal strings straight from the adapter (the B rate 0.025 and
    // the A rate 0.0125 also appear in the maxima table, so use getAllBy).
    expect((await screen.findAllByText('0.025')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.0125').length).toBeGreaterThan(0);
    // Window statuses as badges.
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Superseded')).toBeInTheDocument();
    // Market-local AND resolved UTC both shown.
    expect(screen.getByText('2026-09-01 00:00:00 → open')).toBeInTheDocument();
    expect(screen.getByText('2026-08-31T16:00:00.000Z')).toBeInTheDocument();
    // Package maxima table.
    expect(screen.getByText('Package rate maxima (§7.1)')).toBeInTheDocument();
    expect(screen.getByTestId('reward-max-A')).toHaveTextContent('A');
  });

  it('shows loading, then error with retry when the schedule read fails', async () => {
    mockRewardConfigApi({
      permissions: ['reward.rule.read'],
      scheduleFails: { status: 503, code: 'DASHBOARD_DATA_UNAVAILABLE' },
    });
    await signIn();

    expect(
      await screen.findByText('Reward configuration unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('denies the read surface without the reward.rule.read permission', async () => {
    mockRewardConfigApi({ permissions: ['dashboard.view'] });
    await signIn();

    expect(await screen.findByText(/reward\.rule\.read/)).toBeInTheDocument();
  });

  it('shows the blocked state without the SUPER_ADMIN schedule permission', async () => {
    mockRewardConfigApi({ permissions: ['reward.rule.read'] });
    await signIn();

    await screen.findByRole('heading', {
      name: 'Reward rate configuration',
    });
    expect(
      await screen.findByText('Scheduling reward rates is Super Admin only'),
    ).toBeInTheDocument();
    // The read table still renders (server authority, not UI hiding).
    expect(screen.getAllByText('0.025').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', {
        name: 'Schedule reward rate (Super Admin, audited)',
      }),
    ).not.toBeInTheDocument();
  });

  it('schedules a rate with the mandatory reason and an Idempotency-Key', async () => {
    const mock = mockRewardConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Reward rate configuration',
    });
    fireEvent.change(await screen.findByLabelText('Rate percent per day'), {
      target: { value: '0.0125' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Q4 rate review' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Schedule reward rate (Super Admin, audited)',
      }),
    );

    await waitFor(() =>
      expect(
        mock.fetchSpy.mock.calls.some(([url, init]) => {
          const method = (init as RequestInit | undefined)?.method ?? 'GET';
          return (
            method === 'POST' &&
            String(url).endsWith(
              `/admin/reward-ops/markets/${rewardOpsMarketA}/rules`,
            )
          );
        }),
      ).toBe(true),
    );
    const [url, init] = mock.fetchSpy.mock.calls.find(
      ([callUrl, callInit]) =>
        (callInit as RequestInit | undefined)?.method === 'POST' &&
        String(callUrl).endsWith(
          `/admin/reward-ops/markets/${rewardOpsMarketA}/rules`,
        ),
    ) ?? [undefined, undefined];
    expect(String(url)).toContain('/admin/reward-ops/markets/');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual(
      {
        package_reference: 'C',
        rate: '0.0125',
        effective_date: '2026-10-01',
        reason: 'Q4 rate review',
      },
    );
    expect(
      await screen.findByText(/Reward rate scheduled for package C/iu),
    ).toBeInTheDocument();
  });

  it('rejects an invalid rate locally before any server call', async () => {
    const mock = mockRewardConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Reward rate configuration',
    });
    // Package A max is 0.0125: 0.0126 must be rejected client-side.
    fireEvent.change(await screen.findByLabelText('Package reference'), {
      target: { value: 'A' },
    });
    fireEvent.change(await screen.findByLabelText('Rate percent per day'), {
      target: { value: '0.0126' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(await screen.findByLabelText('Reason'), {
      target: { value: 'Q4 rate review' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Schedule reward rate (Super Admin, audited)',
      }),
    );

    expect(
      await screen.findByText(/exceeds the A package maximum of 0\.0125%/iu),
    ).toBeInTheDocument();
    expect(
      mock.fetchSpy.mock.calls.some(([callUrl, callInit]) => {
        const method = (callInit as RequestInit | undefined)?.method ?? 'GET';
        return (
          method === 'POST' &&
          String(callUrl).includes('/admin/reward-ops/markets/')
        );
      }),
    ).toBe(false);
  });

  it('requires a reason before scheduling', async () => {
    const mock = mockRewardConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Reward rate configuration',
    });
    fireEvent.change(await screen.findByLabelText('Rate percent per day'), {
      target: { value: '0.02' },
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2026-10-01' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Schedule reward rate (Super Admin, audited)',
      }),
    );

    expect(
      await screen.findByText(/reason is mandatory/iu),
    ).toBeInTheDocument();
    expect(
      mock.fetchSpy.mock.calls.some(([callUrl, callInit]) => {
        const method = (callInit as RequestInit | undefined)?.method ?? 'GET';
        return (
          method === 'POST' &&
          String(callUrl).includes('/admin/reward-ops/markets/')
        );
      }),
    ).toBe(false);
  });

  it('shows the resolved UTC preview of the chosen activation date', async () => {
    mockRewardConfigApi();
    await signIn();

    await screen.findByRole('heading', {
      name: 'Reward rate configuration',
    });
    fireEvent.change(await screen.findByLabelText('Activation date'), {
      target: { value: '2026-10-01' },
    });
    expect(await screen.findByTestId('reward-utc-preview')).toHaveTextContent(
      '2026-10-01 00:00:00 (Asia/Kuala_Lumpur) = 2026-09-30T16:00:00.000Z UTC',
    );
  });

  it('runs axe with zero critical or serious violations', async () => {
    mockRewardConfigApi();
    await signIn();
    await screen.findByRole('heading', {
      name: 'Reward rate configuration',
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
