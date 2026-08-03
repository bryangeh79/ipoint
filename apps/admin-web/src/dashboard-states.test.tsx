import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DashboardCardSkeleton,
  DashboardEmptyState,
  DashboardErrorState,
  FreshnessBadge,
  MetricCardErrorState,
  MetricCardHeader,
  MetricDefinition,
  StaleState,
  UnavailableState,
} from './dashboard-states.js';

describe('P7-S4B dashboard state components', () => {
  it('renders a labelled loading skeleton per card', () => {
    render(<DashboardCardSkeleton label="M01" />);
    expect(screen.getByLabelText('Loading M01')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading M01')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('renders the three freshness badges with exact labels', () => {
    render(
      <div>
        <FreshnessBadge state="FRESH" asOf="2026-08-01T12:00:00.000Z" />
        <FreshnessBadge state="STALE" asOf="2026-08-01T11:00:00.000Z" />
        <FreshnessBadge state="UNAVAILABLE" />
      </div>,
    );
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('shows definition and source disclosure inside details', () => {
    render(
      <MetricDefinition
        definition="Count of active members."
        source="members joined to member_market_preferences."
      />,
    );
    const summary = screen.getByText('Definition and source');
    expect(summary).toBeInTheDocument();
    // Content is present (hidden until opened) but queryable.
    expect(screen.getByText('Count of active members.')).toBeInTheDocument();
    expect(
      screen.getByText(/members joined to member_market_preferences/iu),
    ).toBeInTheDocument();
  });

  it('renders the card header with version and freshness meta', () => {
    render(
      <MetricCardHeader name="Active members" definitionVersion={3}>
        <FreshnessBadge state="FRESH" />
      </MetricCardHeader>,
    );
    expect(
      screen.getByRole('heading', { name: 'Active members' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Definition v3')).toBeInTheDocument();
  });

  it('stale state shows last asOf and triggers manual retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <StaleState lastAsOf="2026-08-01T11:00:00.000Z" onRetry={onRetry} />,
    );
    expect(screen.getByText(/stale/iu)).toBeInTheDocument();
    expect(screen.getByText(/2026/u)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh metric' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NO_DURABLE_SOURCE', /no compliant durable source/iu],
    ['SOURCE_QUERY_FAILED', /no value was fabricated/iu],
    ['SOURCE_PERMISSION_DENIED', /permissions/iu],
  ] as const)(
    'unavailable state discloses reason %s and never renders a zero',
    (reason, expectation) => {
      render(<UnavailableState reason={reason} />);
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
      expect(screen.getByText(expectation)).toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    },
  );

  it('unavailable state without a reason still refuses a fabricated value', () => {
    render(<UnavailableState />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/0\b/u)).not.toBeInTheDocument();
  });

  it('empty and error states offer bounded retry', async () => {
    const user = userEvent.setup();
    const emptyRetry = vi.fn();
    const errorRetry = vi.fn();
    render(<DashboardEmptyState onRetry={emptyRetry} />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(emptyRetry).toHaveBeenCalledTimes(1);

    render(
      <DashboardErrorState
        title="Dashboard unavailable"
        description="Source query failed."
        onRetry={errorRetry}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Retry dashboard' }));
    expect(errorRetry).toHaveBeenCalledTimes(1);
  });

  it('per-card error state retries the metric only', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<MetricCardErrorState name="Active members" onRetry={onRetry} />);
    expect(
      screen.getByText(/Active members could not be refreshed/iu),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry metric' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
