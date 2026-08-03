import { Badge, Button, Card, EmptyState, Skeleton } from '@ipoint/ui';
import type { ReactNode } from 'react';
import {
  freshnessLabel,
  formatTimestamp,
  unavailableReasonLabel,
} from './dashboard-model.js';

/**
 * P7-S4B dashboard state components.
 *
 * Every card state (loading, stale, unavailable, error) is a small testable
 * component. UNAVAILABLE is never rendered as zero, and STALE always shows
 * the last server `asOf` with a manual refresh action.
 */

export function DashboardCardSkeleton({ label }: { label: string }) {
  return (
    <Card
      className="admin-dashboard-card admin-dashboard-card--loading"
      aria-label={`Loading ${label}`}
      aria-busy="true"
    >
      <div className="admin-dashboard-card__head">
        <Skeleton width="60%" height={18} />
        <Skeleton width={72} height={20} />
      </div>
      <Skeleton height={42} />
      <Skeleton width="45%" height={12} />
    </Card>
  );
}

export function FreshnessBadge({
  state,
  asOf,
}: {
  state: 'FRESH' | 'STALE' | 'UNAVAILABLE';
  asOf?: string;
}) {
  const tone =
    state === 'FRESH' ? 'success' : state === 'STALE' ? 'warning' : 'neutral';
  return (
    <Badge
      tone={tone}
      className={`admin-dashboard-freshness admin-dashboard-freshness--${state.toLowerCase()}`}
      title={asOf ? `Source query time: ${formatTimestamp(asOf)}` : undefined}
    >
      {freshnessLabel(state)}
    </Badge>
  );
}

export function MetricCardHeader({
  name,
  definitionVersion,
  children,
}: {
  name: string;
  definitionVersion: number;
  children?: ReactNode;
}) {
  return (
    <div className="admin-dashboard-card__head">
      <h3>{name}</h3>
      <div className="admin-dashboard-card__meta">
        {children}
        <span className="admin-dashboard-definition-version">
          Definition v{definitionVersion}
        </span>
      </div>
    </div>
  );
}

export function MetricDefinition({
  definition,
  source,
}: {
  definition: string;
  source: string;
}) {
  return (
    <details className="admin-dashboard-definition">
      <summary>Definition and source</summary>
      <p>{definition}</p>
      <p className="admin-dashboard-source">
        <span>Source:</span> {source}
      </p>
    </details>
  );
}

export function StaleState({
  lastAsOf,
  onRetry,
}: {
  lastAsOf: string;
  onRetry: () => void;
}) {
  return (
    <div className="admin-dashboard-state admin-dashboard-state--stale">
      <p>
        This metric is stale. Last server value as of{' '}
        <time dateTime={lastAsOf}>{formatTimestamp(lastAsOf)}</time>. Refresh
        before acting on it.
      </p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Refresh metric
      </Button>
    </div>
  );
}

export function UnavailableState({
  reason,
  onRetry,
}: {
  reason?:
    | 'NO_DURABLE_SOURCE'
    | 'SOURCE_QUERY_FAILED'
    | 'SOURCE_PERMISSION_DENIED';
  onRetry?: () => void;
}) {
  return (
    <div className="admin-dashboard-state admin-dashboard-state--unavailable">
      <strong>Unavailable</strong>
      <p>{unavailableReasonLabel(reason)}</p>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function DashboardEmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="admin-shell-state">
      <EmptyState
        title="No dashboard metrics"
        description="The server returned an empty metric catalog for the selected market."
        action={
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    </Card>
  );
}

export function DashboardErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <Card className="admin-shell-state">
      <EmptyState
        title={title}
        description={description}
        action={
          <Button variant="secondary" onClick={onRetry}>
            Retry dashboard
          </Button>
        }
      />
    </Card>
  );
}

export function MetricCardErrorState({
  name,
  onRetry,
}: {
  name: string;
  onRetry: () => void;
}) {
  return (
    <div className="admin-dashboard-state admin-dashboard-state--error">
      <p>{name} could not be refreshed.</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Retry metric
      </Button>
    </div>
  );
}
