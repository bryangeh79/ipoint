import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MetricCard } from './dashboard-cards.js';
import type { AdminDashboardMetricState } from '@ipoint/api-client';
import {
  dashboardCatalogFixture,
  dashboardDrillDownFixture,
} from './test/dashboard-fixtures.js';

function metric(id: string): AdminDashboardMetricState {
  const item = dashboardCatalogFixture().items.find(
    (candidate) => candidate.id === id,
  );
  if (!item) throw new Error(`Fixture metric missing: ${id}`);
  return item;
}

function renderCard(
  state: AdminDashboardMetricState,
  options: {
    drillDown?: ReturnType<typeof dashboardDrillDownFixture>;
    onRetry?: () => void;
  } = {},
) {
  return render(
    <MemoryRouter>
      <MetricCard
        metric={state}
        drillDown={options.drillDown}
        onRetry={options.onRetry ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('P7-S4B metric cards', () => {
  it('renders a fresh count card with name, definition, version, asOf and freshness', () => {
    const card = renderCard(metric('M01'), {
      drillDown: dashboardDrillDownFixture('M01'),
    });
    expect(
      screen.getByRole('heading', { name: /Member accounts/iu }),
    ).toBeInTheDocument();
    expect(screen.getByText('Definition v1')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText(/As of/iu)).toBeInTheDocument();
    expect(
      within(card.container).getByRole('link', { name: 'Open members' }),
    ).toBeInTheDocument();
  });

  it('renders a valid zero as zero but never as unavailable', () => {
    renderCard(metric('M07'), { drillDown: dashboardDrillDownFixture('M07') });
    expect(screen.getByTestId('metric-count')).toHaveTextContent('0');
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('renders M10 unavailable with reason disclosure and no value', () => {
    renderCard(metric('M10'));
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/no compliant durable source/iu),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('metric-count')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders source-permission denial as unavailable with disclosure', () => {
    const denied = {
      ...metric('M09'),
      state: 'UNAVAILABLE' as const,
      unavailableReason: 'SOURCE_PERMISSION_DENIED' as const,
      value: undefined,
    };
    renderCard(denied);
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText(/permissions/iu)).toBeInTheDocument();
    expect(screen.queryByTestId('metric-count')).not.toBeInTheDocument();
  });

  it('renders stale with the last value, last asOf and a manual refresh', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const stale = {
      ...metric('M02'),
      state: 'STALE' as const,
      asOf: '2026-08-01T11:00:00.000Z',
    };
    renderCard(stale, { onRetry });
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh metric' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // No drill-down link is offered for a stale value.
    expect(
      screen.queryByRole('link', { name: /open/iu }),
    ).not.toBeInTheDocument();
  });

  it('renders per-currency totals exactly without a cross-currency total', () => {
    const card = renderCard(metric('M13'), {
      drillDown: dashboardDrillDownFixture('M13'),
    });
    const totals = screen.getByTestId('metric-currency-totals');
    expect(within(totals).getByText('160.5000000000')).toBeInTheDocument();
    expect(within(totals).getByText('20.0000000000')).toBeInTheDocument();
    expect(within(totals).getAllByText('MYR').length).toBeGreaterThanOrEqual(1);
    expect(within(totals).getAllByText('SGD').length).toBeGreaterThanOrEqual(1);
    // No combined amount may ever be rendered.
    expect(screen.queryByText(/180\.5/u)).not.toBeInTheDocument();
    expect(screen.queryByText('0.0000000000')).not.toBeInTheDocument();
    // Masked drill-down reference is disclosed on the link.
    expect(
      within(card.container).getByRole('link', {
        name: /Open basic reports/iu,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Masked')).toBeInTheDocument();
  });

  it('renders the balance exactly with its currency code', () => {
    const card = renderCard(metric('M14'), {
      drillDown: dashboardDrillDownFixture('M14'),
    });
    expect(screen.getByTestId('metric-balance')).toHaveTextContent(
      '4123.4500000000',
    );
    expect(screen.getByText('MYR')).toBeInTheDocument();
    expect(
      within(card.container).getByRole('link', { name: /Open MCP accounts/iu }),
    ).toBeInTheDocument();
    expect(screen.getByText('Masked')).toBeInTheDocument();
  });

  it('renders the real reward-job status inline without a drill-down link', () => {
    const card = renderCard(metric('M12'), {
      drillDown: dashboardDrillDownFixture('M12'),
    });
    expect(screen.getByTestId('metric-job-status')).toBeInTheDocument();
    expect(
      screen.getByText(/DAILY_REWARD_ACCRUAL \(2026-08-01\)/u),
    ).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('Failed: 1')).toBeInTheDocument();
    expect(within(card.container).queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a queue summary with its labelled rows', () => {
    renderCard(metric('M11'), { drillDown: dashboardDrillDownFixture('M11') });
    expect(screen.getByText('Fulfilment exceptions')).toBeInTheDocument();
    expect(
      screen.getByText('Refund requests pending checker'),
    ).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows a per-card error state when the drill-down fetch failed', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <MetricCard
          metric={metric('M01')}
          detailState={{ failed: true, description: 'timeout' }}
          onRetry={onRetry}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/could not be refreshed/iu)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry metric' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the breakdown rows for merchants and agents', () => {
    renderCard(metric('M04'), { drillDown: dashboardDrillDownFixture('M04') });
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });
});
