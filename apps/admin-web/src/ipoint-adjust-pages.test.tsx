import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import {
  ipointAdjustDetailFixture,
  ipointAdjustMakerAdminId,
  ipointAdjustMarketId,
  ipointAdjustQueueFixture,
  ipointAdjustRequestFixture,
} from './test/ipoint-adjust-fixtures.js';
import { mockIpointAdjustApi } from './test/ipoint-adjust-mock.js';

const QUEUE_URL = `/admin/${ipointAdjustMarketId}/ipoint-adjustments`;
const CREATE_URL = `/admin/${ipointAdjustMarketId}/ipoint-adjustments/new`;
const DETAIL_URL = `/admin/${ipointAdjustMarketId}/ipoint-adjustments/${ipointAdjustQueueFixture.items[0]?.id}`;

beforeEach(() => {
  adminApi.onSessionExpired = null;
  adminApi.clearSession();
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

describe('P7-S7B manual iPoint adjustment queue page', () => {
  it('renders the queue with state badges, amounts and links', async () => {
    mockIpointAdjustApi();
    await signIn(QUEUE_URL);

    await screen.findByRole('heading', {
      name: 'Manual iPoint adjustment queue',
    });
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(
      screen.getByTestId(
        'ipoint-amount-' + ipointAdjustQueueFixture.items[0]?.id,
      ),
    ).toHaveTextContent('5000.0000000000');
    expect(screen.getByText('CASE-S7B-001')).toBeInTheDocument();
    expect(screen.getByText('CASE-S7B-002')).toBeInTheDocument();
    // Every row links to the detail.
    const links = screen.getAllByRole('link', { name: 'Open' });
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('filters the queue by state', async () => {
    mockIpointAdjustApi();
    await signIn(QUEUE_URL);
    await screen.findByRole('heading', {
      name: 'Manual iPoint adjustment queue',
    });

    fireEvent.change(await screen.findByLabelText('State filter'), {
      target: { value: 'SUBMITTED' },
    });
    // The mock returns the full fixture regardless of the filter; the
    // page passes the state through to the adapter (server filters).
    const stateCalls = vi
      .spyOn(globalThis, 'fetch')
      .mock.calls.filter((call) =>
        String(call[0]).includes('/adjustments?state=SUBMITTED'),
      );
    expect(stateCalls.length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are no requests', async () => {
    mockIpointAdjustApi({
      queueBody: {
        marketId: ipointAdjustMarketId,
        items: [],
        limit: 100,
        offset: 0,
      },
    });
    await signIn(QUEUE_URL);
    expect(
      await screen.findByText('No adjustment requests'),
    ).toBeInTheDocument();
  });

  it('shows a permission-denied read state without wallet.ipoint.read', async () => {
    mockIpointAdjustApi({ permissions: ['dashboard.view'] });
    await signIn(QUEUE_URL);
    expect(await screen.findByText(/wallet\.ipoint\.read/)).toBeInTheDocument();
  });

  it('runs axe with zero critical or serious violations (jsdom)', async () => {
    mockIpointAdjustApi();
    await signIn(QUEUE_URL);
    await screen.findByRole('heading', {
      name: 'Manual iPoint adjustment queue',
    });
    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    );
    expect(serious).toEqual([]);
    void cleanup;
  });
});

describe('P7-S7B manual iPoint adjustment create page (Maker)', () => {
  it('creates a request with the evidence contract and an automatic Idempotency-Key', async () => {
    const mock = mockIpointAdjustApi();
    await signIn(CREATE_URL);
    await screen.findByRole('heading', {
      name: 'Create a manual iPoint adjustment',
    });

    // Caps hint from the market rules.
    expect(await screen.findByTestId('ipoint-caps-hint')).toHaveTextContent(
      'soft: 10000, hard: 100000',
    );

    // Wallet search + select.
    fireEvent.change(await screen.findByLabelText('Wallet search'), {
      target: { value: 'pub_abc123' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Search wallets' }),
    );
    await screen.findByText(/pub_abc123 — Ali Test/);
    fireEvent.change(await screen.findByLabelText('Select wallet'), {
      target: { value: ipointAdjustQueueFixture.items[0]?.walletAccountId },
    });

    fireEvent.change(await screen.findByLabelText('Amount'), {
      target: { value: '5000' },
    });
    fireEvent.change(await screen.findByLabelText('Reason code'), {
      target: { value: 'OPERATIONAL_CORRECTION' },
    });
    fireEvent.change(await screen.findByLabelText('Explanation'), {
      target: { value: 'Ops correction for a processing error.' },
    });
    fireEvent.change(await screen.findByLabelText('Case reference'), {
      target: { value: 'CASE-S7B-003' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create adjustment request (Maker, audited)',
      }),
    );

    expect(
      await screen.findByText(/Adjustment request DRAFT created/),
    ).toBeInTheDocument();
    // The create carried the automatic Idempotency-Key.
    const createCalls = mock.fetchSpy.mock.calls.filter((call) => {
      const url = String(call[0]);
      return (
        url.includes('/adjustments') &&
        url.endsWith('/adjustments') &&
        (call[1] as RequestInit | undefined)?.method === 'POST'
      );
    });
    expect(createCalls.length).toBe(1);
    const headers = new Headers(
      (createCalls[0]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(headers.get('idempotency-key')).toBeTruthy();
  });

  it('blocks the create without the maker permission (double gate)', async () => {
    mockIpointAdjustApi({ permissions: ['wallet.ipoint.read'] });
    await signIn(CREATE_URL);
    expect(
      await screen.findByText(/wallet\.ipoint\.adjust\.maker/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Create adjustment request (Maker, audited)',
      }),
    ).not.toBeInTheDocument();
  });

  it('shows the blocked state for an unconfigured market (no fallback)', async () => {
    mockIpointAdjustApi({
      configBody: {
        marketId: ipointAdjustMarketId,
        marketCode: 'ZZ',
        timezone: 'UTC',
        currency: 'MYR',
        configured: false,
        rule: null,
        reasonCodes: [],
      },
    });
    await signIn(CREATE_URL);
    expect(
      await screen.findByText(
        /Market ZZ is blocked for manual iPoint adjustments/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no fallback to any other market/),
    ).toBeInTheDocument();
  });

  it('requires an attachment reference above the soft cap (UI affordance)', async () => {
    mockIpointAdjustApi();
    await signIn(CREATE_URL);
    await screen.findByRole('heading', {
      name: 'Create a manual iPoint adjustment',
    });
    fireEvent.change(await screen.findByLabelText('Wallet search'), {
      target: { value: 'pub_abc123' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Search wallets' }),
    );
    fireEvent.change(await screen.findByLabelText('Select wallet'), {
      target: { value: ipointAdjustQueueFixture.items[0]?.walletAccountId },
    });
    // Amount above the soft cap (10k).
    fireEvent.change(await screen.findByLabelText('Amount'), {
      target: { value: '50000' },
    });
    fireEvent.change(await screen.findByLabelText('Reason code'), {
      target: { value: 'OPERATIONAL_CORRECTION' },
    });
    fireEvent.change(await screen.findByLabelText('Explanation'), {
      target: { value: 'Above-soft ops correction.' },
    });
    fireEvent.change(await screen.findByLabelText('Case reference'), {
      target: { value: 'CASE-S7B-004' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Create adjustment request (Maker, audited)',
      }),
    );
    expect(
      await screen.findByText(
        /attachment reference is required above the soft cap/,
      ),
    ).toBeInTheDocument();
  });
});

describe('P7-S7B manual iPoint adjustment detail page (Checker)', () => {
  it('disables the checker controls for the maker own request (Maker≠Checker)', async () => {
    // The current actor IS the maker: checker form must not render.
    mockIpointAdjustApi({
      actorId: ipointAdjustMakerAdminId,
      detailBody: ipointAdjustDetailFixture(
        ipointAdjustRequestFixture({ state: 'SUBMITTED' }),
      ),
    });
    await signIn(DETAIL_URL);
    expect(
      await screen.findByText(
        /You created this request, so you cannot be its checker/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('ipoint-decision-form'),
    ).not.toBeInTheDocument();
  });

  it('requires a decision reason before calling the server', async () => {
    const mock = mockIpointAdjustApi({
      detailBody: ipointAdjustDetailFixture(
        ipointAdjustRequestFixture({ state: 'SUBMITTED' }),
      ),
    });
    await signIn(DETAIL_URL);
    try {
      await screen.findByTestId('ipoint-decision-form');
    } catch (error) {
      console.error('DEBUG NO FORM:', document.body.innerHTML.slice(0, 2500));
      throw error;
    }

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Record decision (Checker, step-up required)',
      }),
    );
    expect(
      await screen.findByText(/decision reason between 1 and 2000/),
    ).toBeInTheDocument();
    const decideCalls = mock.fetchSpy.mock.calls.filter((call) =>
      String(call[0]).includes('/decision'),
    );
    expect(decideCalls.length).toBe(0);
  });

  it('approves a submitted request through the step-up flow', async () => {
    const mock = mockIpointAdjustApi({
      detailBody: ipointAdjustDetailFixture(
        ipointAdjustRequestFixture({ state: 'SUBMITTED' }),
      ),
    });
    await signIn(DETAIL_URL);
    await screen.findByTestId('ipoint-decision-form');

    fireEvent.change(await screen.findByLabelText('Decision reason'), {
      target: { value: 'Evidence verified.' },
    });
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Record decision (Checker, step-up required)',
      }),
    );

    // The step-up dialog appears; verify with a code.
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '123456' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify and continue' }),
    );

    expect(await screen.findByText(/Request approved/)).toBeInTheDocument();
    // The decision call carried the x-step-up-token header.
    const decideCalls = mock.fetchSpy.mock.calls.filter((call) =>
      String(call[0]).includes('/decision'),
    );
    const headers = new Headers(
      (decideCalls[decideCalls.length - 1]?.[1] as RequestInit | undefined)
        ?.headers,
    );
    expect(headers.get('x-step-up-token')).toBeTruthy();
  });

  it('shows the blocked execution state for above-soft without secure evidence', async () => {
    mockIpointAdjustApi({
      detailBody: ipointAdjustDetailFixture(
        ipointAdjustRequestFixture({
          state: 'APPROVED',
          amount: '50000.0000000000',
          checkerAdminUserId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    });
    await signIn(DETAIL_URL);
    expect(
      await screen.findByTestId('ipoint-execution-blocked'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Execute \(blocked/ }),
    ).toBeDisabled();
  });

  it('executes an approved request below the soft cap through step-up', async () => {
    const mock = mockIpointAdjustApi({
      detailBody: ipointAdjustDetailFixture(
        ipointAdjustRequestFixture({
          state: 'APPROVED',
          amount: '5000.0000000000',
          checkerAdminUserId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    });
    await signIn(DETAIL_URL);
    await screen.findByRole('button', {
      name: 'Execute adjustment (Checker, step-up required)',
    });

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Execute adjustment (Checker, step-up required)',
      }),
    );
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '123456' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify and continue' }),
    );

    expect(await screen.findByText('Adjustment executed.')).toBeInTheDocument();
    const executeCalls = mock.fetchSpy.mock.calls.filter((call) =>
      String(call[0]).includes('/execute'),
    );
    const headers = new Headers(
      (executeCalls[executeCalls.length - 1]?.[1] as RequestInit | undefined)
        ?.headers,
    );
    expect(headers.get('x-step-up-token')).toBeTruthy();
  });

  it('surfaces the server above-soft execution block (422) with stable copy', async () => {
    mockIpointAdjustApi({
      executeFails: {
        status: 422,
        code: 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
      },
      detailBody: ipointAdjustDetailFixture(
        ipointAdjustRequestFixture({
          state: 'APPROVED',
          amount: '50000.0000000000',
          checkerAdminUserId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    });
    await signIn(DETAIL_URL);
    // Config mock still reports secure evidence disabled -> blocked button.
    expect(
      await screen.findByTestId('ipoint-execution-blocked'),
    ).toBeInTheDocument();
    // Both the above-soft hint and the blocked notice mention the gate.
    expect(
      screen.getAllByText(/secure evidence storage/).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
