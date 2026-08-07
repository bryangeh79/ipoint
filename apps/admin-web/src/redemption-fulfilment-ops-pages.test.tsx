import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, createAdminMemoryRouter } from './admin-app.js';
import { adminApi } from './admin-api.js';
import {
  P7S8_FULFILMENT_ID,
  P7S8_MARKET_ID,
  P7S8_ORDER_ID,
  P7S8_REFUND_ID,
  mockP7S8OpsApi,
  orderDetailFixture,
  queueFixture,
  queueOverviewFixture,
  refundDetailFixture,
  refundQueueFixture,
} from './test/p7-s8-ops-mock.js';

const QUEUES_URL = `/admin/${P7S8_MARKET_ID}/redemptions/orders`;
const EXCEPTIONS_URL = `/admin/${P7S8_MARKET_ID}/redemptions/exceptions`;
const ORDER_URL = `/admin/${P7S8_MARKET_ID}/redemptions/orders/${P7S8_ORDER_ID}`;
const REFUNDS_URL = `/admin/${P7S8_MARKET_ID}/redemptions/refunds`;
const REFUND_URL = `/admin/${P7S8_MARKET_ID}/redemptions/refunds/${P7S8_REFUND_ID}`;

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

describe('P7-S8 redemption operations pages', () => {
  it('renders the six-status queue tabs with counts', async () => {
    mockP7S8OpsApi();
    await signIn(QUEUES_URL);

    await screen.findByRole('heading', { name: 'Fulfilment queues' });
    expect(screen.getByTestId('queue-tabs')).toBeInTheDocument();
    expect(screen.getByText('Ready for pickup (1)')).toBeInTheDocument();
    expect(screen.getByText('Fulfilment exception (2)')).toBeInTheDocument();
    expect(screen.getByText('Refunded (0)')).toBeInTheDocument();
    // Rate capability is configured in the fixture — no banner.
    expect(
      screen.queryByText('Redemption rate not configured'),
    ).not.toBeInTheDocument();
  });

  it('shows the rate-not-configured capability banner', async () => {
    mockP7S8OpsApi({
      queueOverview: {
        ...queueOverviewFixture(),
        rate_configured: false,
      },
      queue: queueFixture(),
    });
    await signIn(QUEUES_URL);

    await screen.findByRole('heading', { name: 'Fulfilment queues' });
    expect(
      screen.getByText('Redemption rate not configured'),
    ).toBeInTheDocument();
  });

  it('lists one queue with the linked fulfilment failure reason', async () => {
    mockP7S8OpsApi();
    await signIn(EXCEPTIONS_URL);

    await screen.findByRole('heading', { name: 'Fulfilment queues' });
    expect(screen.getByText('ORD-000042')).toBeInTheDocument();
    expect(screen.getByText(/Courier rejected/)).toBeInTheDocument();
    expect(
      screen.getByTestId(`queue-points-${P7S8_ORDER_ID}`),
    ).toHaveTextContent('10000.0000000000');
    const links = screen.getAllByRole('link', { name: 'Open' });
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('switches queue tabs and reloads the selected status', async () => {
    mockP7S8OpsApi();
    await signIn(QUEUES_URL);
    await screen.findByRole('heading', { name: 'Fulfilment queues' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fireEvent.click(screen.getByTestId('queue-tab-REFUND_PENDING'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = fetchSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((callUrl) => callUrl.includes('/queues/'));
    expect(
      calls.some((callUrl) => callUrl.includes('/queues/REFUND_PENDING')),
    ).toBe(true);
  });

  it('renders the order detail with audit history and retry action', async () => {
    mockP7S8OpsApi();
    await signIn(ORDER_URL);

    await screen.findByRole('heading', { name: 'Redemption order detail' });
    expect(screen.getByTestId('order-reference')).toHaveTextContent(
      'ORD-000042',
    );
    expect(screen.getByTestId('order-status')).toHaveTextContent(
      'FULFILMENT_EXCEPTION',
    );
    expect(screen.getByText('FULFILMENT_FAILED')).toBeInTheDocument();
    expect(screen.getByTestId('fulfilment-retry')).toBeEnabled();
    expect(screen.getByTestId('order-suspend')).toBeEnabled();
  });

  it('retries a FAILED fulfilment and confirms the result', async () => {
    mockP7S8OpsApi({
      orderDetail: orderDetailFixture(),
      fulfilmentAction: {
        ok: true,
        fulfilment_id: P7S8_FULFILMENT_ID,
        status: 'PENDING',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    });
    await signIn(ORDER_URL);
    await screen.findByRole('heading', { name: 'Redemption order detail' });

    await userEvent.click(screen.getByTestId('fulfilment-retry'));
    expect(
      await screen.findByText('Fulfilment retry queued — PENDING'),
    ).toBeInTheDocument();
  });

  it('renders the refund queue with status badges', async () => {
    mockP7S8OpsApi();
    await signIn(REFUNDS_URL);

    await screen.findByRole('heading', { name: 'Refund queue' });
    expect(
      screen.getByTestId('refund-status-PENDING_CHECKER'),
    ).toHaveTextContent('Pending checker');
    expect(
      screen.getByTestId(`refund-amount-${P7S8_REFUND_ID}`),
    ).toHaveTextContent('10000.0000000000');
    expect(
      screen.getByText('Item unavailable - refund required'),
    ).toBeInTheDocument();
  });

  it('renders the refund detail with the REFUND_* status history', async () => {
    mockP7S8OpsApi();
    await signIn(REFUND_URL);

    await screen.findByRole('heading', { name: 'Refund detail' });
    expect(screen.getByTestId('refund-order-reference')).toHaveTextContent(
      'ORD-000042',
    );
    expect(screen.getByText('REFUND_REQUESTED')).toBeInTheDocument();
    expect(screen.getByTestId('refund-amount')).toHaveTextContent(
      '10000.0000000000',
    );
  });

  it('denies the queue read without redemption.order.read', async () => {
    // The route requires the canonical redemption.order.read; the route
    // guard shows the permission-denied shell before the page fetch is
    // attempted.
    mockP7S8OpsApi({ permissions: ['agent.read'] });
    await signIn(QUEUES_URL);

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
  });

  it('keeps the queues page accessible (axe, no violations)', async () => {
    mockP7S8OpsApi();
    await signIn(QUEUES_URL);
    await screen.findByRole('heading', { name: 'Fulfilment queues' });

    const results = await axe.run(document.body, {
      rules: { region: { enabled: false } },
    });
    expect(results.violations).toHaveLength(0);
  });
});
