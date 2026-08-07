import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import {
  P7S8_AGENT_ID,
  P7S8_MARKET_ID,
  agentDetailFixture,
  mockP7S8OpsApi,
} from './test/p7-s8-ops-mock.js';

const LIST_URL = `/admin/${P7S8_MARKET_ID}/agents`;
const DETAIL_URL = `/admin/${P7S8_MARKET_ID}/agents/${P7S8_AGENT_ID}`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
});

afterEach(() => {
  cleanup();
});

async function signIn(url: string) {
  render(<AdminApp router={createAdminMemoryRouter([url])} />);
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

describe('P7-S8 agent operations pages', () => {
  it('renders the agent list with the CONFIGURED capability state', async () => {
    mockP7S8OpsApi();
    await signIn(LIST_URL);

    await screen.findByRole('heading', { name: 'Agents' });
    expect(screen.getByText('AG-ALICE')).toBeInTheDocument();
    expect(screen.getByText('AG-CAROL')).toBeInTheDocument();
    expect(screen.getByTestId('agent-status-ACTIVE')).toHaveTextContent(
      'Active',
    );
    expect(
      screen.getByTestId('agent-status-PENDING_APPROVAL'),
    ).toHaveTextContent('Pending approval');
    expect(screen.getAllByText('388.0000000000 MYR').length).toBe(2);
    expect(screen.getByTestId('agent-total')).toHaveTextContent('2 agent(s)');
    // Capability banner only appears for the blocked state.
    expect(
      screen.queryByText('Agent activation not configured'),
    ).not.toBeInTheDocument();
  });

  it('shows the explicit blocked capability banner for an unconfigured market', async () => {
    mockP7S8OpsApi({ agentCapability: 'AGENT_FEE_NOT_CONFIGURED' });
    await signIn(LIST_URL);

    await screen.findByRole('heading', { name: 'Agents' });
    expect(
      screen.getByText('Agent activation not configured'),
    ).toBeInTheDocument();
  });

  it('filters by status and passes the filter to the adapter', async () => {
    mockP7S8OpsApi();
    await signIn(LIST_URL);
    await screen.findByRole('heading', { name: 'Agents' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fireEvent.change(await screen.findByLabelText('Status filter'), {
      target: { value: 'ACTIVE' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = fetchSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((callUrl) => callUrl.includes('/admin/agent-ops/'));
    expect(calls.some((callUrl) => callUrl.includes('status=ACTIVE'))).toBe(
      true,
    );
  });

  it('denies the agent list without the agent.read permission', async () => {
    // The route requires the canonical agent.read; the route guard shows
    // the permission-denied shell before the page fetch is attempted.
    mockP7S8OpsApi({ permissions: ['redemption.order.read'] });
    await signIn(LIST_URL);

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('renders the agent detail with the status history and actions', async () => {
    mockP7S8OpsApi();
    await signIn(DETAIL_URL);

    await screen.findByRole('heading', { name: 'Agent detail' });
    expect(screen.getByTestId('agent-public-id')).toHaveTextContent('AG-ALICE');
    expect(screen.getByText('PENDING_APPROVAL → ACTIVE')).toBeInTheDocument();
    expect(screen.getByTestId('agent-suspend')).toBeEnabled();
    expect(screen.getByTestId('agent-reactivate')).toBeDisabled();
  });

  it('suspends an ACTIVE agent and refreshes the detail', async () => {
    mockP7S8OpsApi({
      agentDetail: agentDetailFixture(),
      agentStatusAction: {
        agent_id: P7S8_AGENT_ID,
        status: 'SUSPENDED',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    });
    await signIn(DETAIL_URL);
    await screen.findByRole('heading', { name: 'Agent detail' });

    fireEvent.change(await screen.findByLabelText(/Reason/), {
      target: { value: 'Compliance review.' },
    });
    await userEvent.click(screen.getByTestId('agent-suspend'));
    expect(await screen.findByText(/Agent suspended/)).toBeInTheDocument();
  });

  it('blocks status actions without agent.activation.manage (permission denied)', async () => {
    mockP7S8OpsApi({
      permissions: ['agent.read', 'redemption.order.read'],
      agentDetail: agentDetailFixture(),
    });
    await signIn(DETAIL_URL);
    await screen.findByRole('heading', { name: 'Agent detail' });

    fireEvent.change(await screen.findByLabelText(/Reason/), {
      target: { value: 'Attempt.' },
    });
    await userEvent.click(screen.getByTestId('agent-suspend'));
    expect(
      await screen.findByText(
        'Agent status changes require the agent.activation.manage permission for this market.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the agent list accessible (axe, no violations)', async () => {
    mockP7S8OpsApi();
    await signIn(LIST_URL);
    await screen.findByRole('heading', { name: 'Agents' });

    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    expect(results.violations).toHaveLength(0);
  });
});
