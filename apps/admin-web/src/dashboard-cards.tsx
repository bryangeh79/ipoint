import type {
  AdminDashboardDrillDownReference,
  AdminDashboardJobRunSnapshot,
  AdminDashboardMetricState,
  AdminDashboardMetricValue,
} from '@ipoint/api-client';
import { Badge, Card } from '@ipoint/ui';
import { Link } from 'react-router-dom';
import {
  drillDownHref,
  drillDownLabel,
  formatCount,
  formatTimestamp,
  metricCountRows,
  metricSensitiveValueSummary,
} from './dashboard-model.js';
import {
  FreshnessBadge,
  MetricCardErrorState,
  MetricCardHeader,
  MetricDefinition,
  StaleState,
  UnavailableState,
} from './dashboard-states.js';

/**
 * P7-S4B metric card renderers.
 *
 * Values are displayed EXACTLY as the server returned them. Financial amounts
 * (CURRENCY_TOTALS, BALANCE) are rendered as strings with their currency code
 * and are never summed, converted, or recomputed on the client.
 */

export function MetricValue({ value }: { value: AdminDashboardMetricValue }) {
  switch (value.kind) {
    case 'COUNT':
      return (
        <div className="admin-dashboard-value" data-testid="metric-count">
          {formatCount(value.count)}
        </div>
      );
    case 'BREAKDOWN':
      return (
        <div className="admin-dashboard-rows" data-testid="metric-breakdown">
          {metricCountRows(value).map((row) => (
            <div className="admin-dashboard-row" key={row.label}>
              <span>{row.label}</span>
              <strong>{formatCount(row.count)}</strong>
            </div>
          ))}
        </div>
      );
    case 'QUEUE_SUMMARY':
      return (
        <div
          className="admin-dashboard-rows"
          data-testid="metric-queue-summary"
        >
          {metricCountRows(value).map((row) => (
            <div className="admin-dashboard-row" key={row.label}>
              <span>{row.label}</span>
              <strong>{formatCount(row.count)}</strong>
            </div>
          ))}
        </div>
      );
    case 'JOB_STATUS':
      return <JobStatusValue value={value} />;
    case 'CURRENCY_TOTALS':
      return <CurrencyTotalRows value={value} />;
    case 'BALANCE':
      return (
        <div className="admin-dashboard-value admin-dashboard-value--balance">
          <strong data-testid="metric-balance">
            {value.totalAvailableBalance}
          </strong>
          <span className="admin-dashboard-currency">{value.currency}</span>
        </div>
      );
    default:
      return null;
  }
}

function JobStatusValue({
  value,
}: {
  value: Extract<AdminDashboardMetricValue, { kind: 'JOB_STATUS' }>;
}) {
  return (
    <div className="admin-dashboard-rows" data-testid="metric-job-status">
      {value.latestRun ? (
        <JobRunSnapshot run={value.latestRun} />
      ) : (
        <p className="admin-dashboard-muted">
          No real daily job run has been recorded yet in this window.
        </p>
      )}
      <div className="admin-dashboard-row admin-dashboard-row--statuses">
        <span>Runs (trailing 30 market days)</span>
        <span className="admin-dashboard-status-counts">
          {metricCountRows(value).map((row) => (
            <Badge key={row.label} tone="neutral">
              {row.label}: {row.count}
            </Badge>
          ))}
        </span>
      </div>
    </div>
  );
}

function JobRunSnapshot({ run }: { run: AdminDashboardJobRunSnapshot }) {
  const tone =
    run.status === 'COMPLETED'
      ? 'success'
      : run.status === 'FAILED'
        ? 'error'
        : run.status === 'RUNNING'
          ? 'info'
          : 'warning';
  return (
    <div className="admin-dashboard-job-run">
      <div className="admin-dashboard-row">
        <span>
          Latest run — {run.jobType} ({run.localBusinessDate})
        </span>
        <Badge tone={tone}>{run.status}</Badge>
      </div>
      <dl className="admin-dashboard-job-run__details">
        <div>
          <dt>Started</dt>
          <dd>
            {run.startedAt ? formatTimestamp(run.startedAt) : 'Not started'}
          </dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>
            {run.completedAt
              ? formatTimestamp(run.completedAt)
              : 'Not completed'}
          </dd>
        </div>
        <div>
          <dt>Entitlements</dt>
          <dd>{formatCount(run.totalEntitlements)}</dd>
        </div>
        <div>
          <dt>Processed</dt>
          <dd>{formatCount(run.processedCount)}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{formatCount(run.failedCount)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * M13 — per-currency rows. Counts and amounts are shown exactly as returned;
 * no cross-currency total is ever computed or displayed.
 */
function CurrencyTotalRows({
  value,
}: {
  value: Extract<AdminDashboardMetricValue, { kind: 'CURRENCY_TOTALS' }>;
}) {
  if (value.totals.length === 0) {
    return (
      <p className="admin-dashboard-muted">
        No confirmed transactions since the market-local start of today.
      </p>
    );
  }
  return (
    <div
      className="admin-dashboard-rows admin-dashboard-rows--currency"
      data-testid="metric-currency-totals"
    >
      {value.totals.map((total) => (
        <div className="admin-dashboard-row" key={total.currency}>
          <span>
            <Badge tone="brand">{total.currency}</Badge>{' '}
            {formatCount(total.count)} transaction{total.count === 1 ? '' : 's'}
          </span>
          <strong className="admin-dashboard-amount">
            {total.totalAmount}
            <span className="admin-dashboard-currency">{total.currency}</span>
          </strong>
        </div>
      ))}
    </div>
  );
}

export function MetricCard({
  metric,
  drillDown,
  detailState,
  onRetry,
}: {
  metric: AdminDashboardMetricState;
  drillDown?: AdminDashboardDrillDownReference;
  /** Error state of the drill-down detail fetch, when it failed. */
  detailState?: { failed: boolean; description?: string };
  onRetry: () => void;
}) {
  const href = drillDown ? drillDownHref(drillDown) : null;
  const sensitiveSummary = metricSensitiveValueSummary(metric.id);

  return (
    <Card
      className={`admin-dashboard-card admin-dashboard-card--${metric.state.toLowerCase()}`}
      aria-labelledby={`admin-metric-${metric.id}-title`}
    >
      <MetricCardHeader
        name={metric.name}
        definitionVersion={metric.definitionVersion}
      >
        <FreshnessBadge state={metric.state} asOf={metric.asOf} />
      </MetricCardHeader>

      <MetricDefinition definition={metric.definition} source={metric.source} />

      {metric.state === 'UNAVAILABLE' ? (
        <UnavailableState reason={metric.unavailableReason} />
      ) : null}

      {metric.state === 'STALE' ? (
        <>
          {metric.value ? (
            <div className="admin-dashboard-stale-value">
              <MetricValue value={metric.value} />
            </div>
          ) : null}
          <StaleState lastAsOf={metric.asOf} onRetry={onRetry} />
        </>
      ) : null}

      {metric.state === 'FRESH' && metric.value ? (
        <>
          <MetricValue value={metric.value} />
          {sensitiveSummary ? (
            <p className="admin-dashboard-sensitive-summary">
              {sensitiveSummary}
            </p>
          ) : null}
        </>
      ) : null}

      {metric.state === 'FRESH' && detailState?.failed ? (
        <MetricCardErrorState name={metric.name} onRetry={onRetry} />
      ) : null}

      <footer className="admin-dashboard-card__foot">
        <span className="admin-dashboard-asof">
          As of{' '}
          <time dateTime={metric.asOf}>{formatTimestamp(metric.asOf)}</time>
        </span>
        {href && metric.state === 'FRESH' ? (
          <Link className="admin-dashboard-drilldown" to={href}>
            {drillDownLabel(metric.id)}
            {drillDown?.masking ? (
              <Badge tone="neutral" className="admin-dashboard-masking-badge">
                Masked
              </Badge>
            ) : null}
          </Link>
        ) : null}
      </footer>
    </Card>
  );
}
