import { Alert, Badge, Button, Card } from '@ipoint/ui';
import type { AdminReportStateDto } from '@ipoint/api-client';
import { formatReportAsOf } from './reports-model.js';

/**
 * P7-S9 Basic Reports state components (design-system states: loading /
 * empty / error / permission-denied / blocked / offline-retry / success,
 * plus the explicit freshness states FRESH / STALE / UNAVAILABLE).
 */

export function ReportSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="reports-skeleton"
      aria-label="Loading reports"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

export function ReportErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <Alert tone="error" title={title}>
        {description}
      </Alert>
      <div className="admin-reward-form">
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

const freshnessTones: Readonly<
  Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'info'>
> = {
  FRESH: 'success',
  STALE: 'warning',
  UNAVAILABLE: 'error',
};

export function ReportFreshnessBadge({ state }: { state: string }) {
  const label =
    state === 'FRESH'
      ? 'Fresh'
      : state === 'STALE'
        ? 'Stale'
        : state === 'UNAVAILABLE'
          ? 'Unavailable'
          : state;
  return (
    <Badge tone={freshnessTones[state] ?? 'neutral'} data-testid={`report-${state}`}>
      {label}
    </Badge>
  );
}

/**
 * Freshness disclosure line: asOf + explicit stale/unavailable markers.
 * An UNAVAILABLE report never shows a fabricated zero — only the reason.
 */
export function ReportFreshnessLine({ report }: { report: AdminReportStateDto }) {
  if (report.unavailable) {
    return (
      <p className="admin-reward-muted" data-testid="report-unavailable-line">
        <strong>Unavailable</strong> —{' '}
        {report.unavailableReason === 'NO_DURABLE_SOURCE'
          ? 'no compliant durable source exists yet.'
          : 'the source could not be read. No value is shown — a zero is never fabricated for an unavailable source.'}{' '}
        (as of {formatReportAsOf(report.asOf)})
      </p>
    );
  }
  if (report.stale) {
    return (
      <p className="admin-reward-muted" data-testid="report-stale-line">
        <strong>Stale snapshot</strong> — the live source failed; the previous
        snapshot (as of {formatReportAsOf(report.asOf)}) is shown and must
        not be treated as current.
      </p>
    );
  }
  return (
    <p className="admin-reward-muted" data-testid="report-fresh-line">
      Source query at {formatReportAsOf(report.asOf)}
      {typeof report.queryDurationMs === 'number'
        ? ` · measured ${report.queryDurationMs} ms`
        : ' · served from the bounded snapshot cache'}
    </p>
  );
}
