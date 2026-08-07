import { Alert, Badge, Button, Card, Spinner } from '@ipoint/ui';
import type { AdminAuditEntryDto } from '@ipoint/api-client';
import {
  auditActorLabel,
  auditResultLabel,
  formatAuditUtc,
} from './audit-model.js';

/**
 * P7-S9 Audit Viewer state components (design-system states: loading /
 * empty / error / permission-denied / blocked / offline-retry / success).
 */

export function AuditSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="audit-skeleton"
      aria-label="Loading audit entries"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

const resultTones: Readonly<
  Record<string, 'neutral' | 'success' | 'warning' | 'error' | 'info'>
> = {
  SUCCESS: 'success',
  FAILURE: 'error',
  DENIED: 'warning',
};

export function AuditResultBadge({ result }: { result: string }) {
  return (
    <Badge tone={resultTones[result] ?? 'neutral'} data-testid={`audit-result-${result}`}>
      {auditResultLabel(result)}
    </Badge>
  );
}

export function AuditEmptyState() {
  return (
    <Card>
      <div className="admin-state" data-testid="audit-empty">
        <h3 className="admin-reward-muted">No audit entries</h3>
        <p>
          No immutable audit entries match the current filters for this
          market. Widen the filters or time range to see more.
        </p>
      </div>
    </Card>
  );
}

export function AuditErrorState({
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

/** Masked evidence renderer: shows exactly what the server returned. */
export function MaskedEvidence({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <details className="admin-audit-evidence" data-testid="masked-evidence">
      <summary>{label} (masked)</summary>
      <pre className="admin-audit-pre">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function AuditRowExpanded({ entry }: { entry: AdminAuditEntryDto }) {
  return (
    <div className="admin-audit-detail" data-testid="audit-entry-detail">
      <dl className="admin-audit-dl">
        <div>
          <dt>Entry</dt>
          <dd>{entry.id}</dd>
        </div>
        <div>
          <dt>Occurred</dt>
          <dd>{formatAuditUtc(entry.occurredAt)}</dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd>
            {auditActorLabel(entry.actorType)}{' '}
            {entry.actorId ? `(${entry.actorId})` : ''}
          </dd>
        </div>
        <div>
          <dt>Entity</dt>
          <dd>
            {entry.entityType} / {entry.entityId}
          </dd>
        </div>
        {entry.reason ? (
          <div>
            <dt>Reason</dt>
            <dd>{entry.reason}</dd>
          </div>
        ) : null}
        {entry.requestId ? (
          <div>
            <dt>Request</dt>
            <dd>{entry.requestId}</dd>
          </div>
        ) : null}
      </dl>
      <MaskedEvidence label="Before" value={entry.beforeMasked} />
      <MaskedEvidence label="After" value={entry.afterMasked} />
    </div>
  );
}

export function AuditLoadingButton() {
  return (
    <span className="admin-state" data-testid="audit-raw-loading">
      <Spinner size="sm" /> Loading raw evidence…
    </span>
  );
}
