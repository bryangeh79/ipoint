import { Alert, Badge, Button, Card } from '@ipoint/ui';
import type { AdminIpointAdjustmentDto } from '@ipoint/api-client';
import { ipointAdjustmentStateLabel } from './ipoint-adjust-model.js';

/**
 * P7-S7B iPoint adjustment state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry /
 * success).
 */

export function IpointAdjustmentSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="ipoint-adjustment-skeleton"
      aria-label="Loading iPoint adjustment queue"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

const stateTones: Readonly<
  Record<string, 'neutral' | 'success' | 'warning' | 'error' | 'info'>
> = {
  EXECUTED: 'success',
  APPROVED: 'info',
  SUBMITTED: 'info',
  DRAFT: 'neutral',
  EXECUTING: 'warning',
  REJECTED: 'warning',
  FAILED: 'error',
};

export function IpointAdjustmentStateBadge({
  state,
}: {
  state: AdminIpointAdjustmentDto['state'];
}) {
  return (
    <Badge
      tone={stateTones[state] ?? 'neutral'}
      data-testid={`adjustment-state-${state}`}
    >
      {ipointAdjustmentStateLabel(state)}
    </Badge>
  );
}

export function IpointAdjustmentEmptyState() {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">No adjustment requests</p>
        <p className="admin-state__body">
          No manual iPoint adjustment requests exist for this market in the
          selected state.
        </p>
      </div>
    </Card>
  );
}

export function IpointAdjustmentErrorState({
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
      <div className="admin-state" role="alert">
        <p className="admin-state__title">{title}</p>
        <p className="admin-state__body">{description}</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

export function IpointAdjustmentPermissionDeniedState({
  permission,
}: {
  permission: string;
}) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">Permission denied</p>
        <p className="admin-state__body">
          The server did not grant the {permission} permission for this market.
          Navigation visibility is not authorization.
        </p>
      </div>
    </Card>
  );
}

export function IpointAdjustmentOfflineState({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">You are offline</p>
        <p className="admin-state__body">
          The iPoint adjustment queue needs a connection. Retry when you are
          back online.
        </p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

/**
 * Explicit blocked notice: the market has no rules row (unconfigured) —
 * never a fallback to another market.
 */
export function IpointAdjustmentMarketBlockedNotice({
  marketCode,
}: {
  marketCode: string;
}) {
  return (
    <Alert
      tone="warning"
      title={`Market ${marketCode} is blocked for manual iPoint adjustments`}
    >
      Manual iPoint adjustments are not configured for this market. There is no
      fallback to any other market. A versioned per-market rules row with
      soft/hard caps and the secure-evidence capability is required before
      requests can be created.
    </Alert>
  );
}

/** Success/error action feedback (inline alert). */
export function IpointAdjustmentActionNotice({
  tone,
  text,
}: {
  tone: 'success' | 'error';
  text: string;
}) {
  return (
    <Alert tone={tone} title="Manual iPoint adjustment" role="status">
      {text}
    </Alert>
  );
}
