import { Alert, Badge, Button, Card } from '@ipoint/ui';
import type { AdminRewardRuleVersionDto } from '@ipoint/api-client';
import { rewardWindowStatusLabel } from './reward-config-model.js';

/**
 * P7-S6B reward-configuration state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry).
 */

export function RewardScheduleSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="reward-schedule-skeleton"
      aria-label="Loading reward schedule"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

export function RewardWindowStatusBadge({
  status,
}: {
  status: AdminRewardRuleVersionDto['window_status'];
}) {
  const tone =
    status === 'ACTIVE'
      ? 'success'
      : status === 'SCHEDULED'
        ? 'info'
        : status === 'SUPERSEDED' || status === 'EXPIRED'
          ? 'warning'
          : 'neutral';
  return (
    <Badge tone={tone} data-testid={`reward-window-${status}`}>
      {rewardWindowStatusLabel(status)}
    </Badge>
  );
}

export function RewardEmptyState() {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">No reward rates scheduled</p>
        <p className="admin-state__body">
          No reward rule versions exist for this market yet. Rates are exact
          decimals (%/day) and every version activates at a future market-local
          00:00.
        </p>
      </div>
    </Card>
  );
}

export function RewardErrorState({
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

export function RewardPermissionDeniedState({
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

export function RewardOfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">You are offline</p>
        <p className="admin-state__body">
          Reward configuration needs a connection. Retry when you are back
          online.
        </p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

/**
 * Explicit blocked state for the schedule capability when the actor is not
 * SUPER_ADMIN (the route's capability gate `reward.rule.schedule` is
 * discoverability metadata only — the server is the authority).
 */
export function RewardScheduleBlockedNotice() {
  return (
    <Alert tone="warning" title="Scheduling reward rates is Super Admin only">
      The server grants reward.rule.schedule to SUPER_ADMIN only. This surface
      is read-only for your role; every scheduled version is recorded with a
      mandatory reason in the privileged audit trail.
    </Alert>
  );
}
