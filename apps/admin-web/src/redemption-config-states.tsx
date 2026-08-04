import { Alert, Badge, Button, Card } from '@ipoint/ui';
import type { AdminRedemptionRateVersionDto } from '@ipoint/api-client';
import { redemptionWindowStatusLabel } from './redemption-config-model.js';

/**
 * P7-S6C redemption-configuration state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry).
 */

export function RedemptionRateSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="redemption-rate-skeleton"
      aria-label="Loading redemption rate configuration"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

export function RedemptionWindowStatusBadge({
  status,
}: {
  status: AdminRedemptionRateVersionDto['window_status'];
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
    <Badge tone={tone} data-testid={`redemption-window-${status}`}>
      {redemptionWindowStatusLabel(status)}
    </Badge>
  );
}

export function RedemptionEmptyState() {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">No redemption rate configured</p>
        <p className="admin-state__body">
          No rate version exists for this market yet. Rates are exact
          decimals (local currency per 1 iPoint) and every version activates
          at a future market-local 00:00.
        </p>
      </div>
    </Card>
  );
}

export function RedemptionErrorState({
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

export function RedemptionPermissionDeniedState({
  permission,
}: {
  permission: string;
}) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">Permission denied</p>
        <p className="admin-state__body">
          The server did not grant the {permission} permission for this
          market. Navigation visibility is not authorization.
        </p>
      </div>
    </Card>
  );
}

export function RedemptionOfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">You are offline</p>
        <p className="admin-state__body">
          Redemption rate configuration needs a connection. Retry when you
          are back online.
        </p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Card>
  );
}

/**
 * Explicit blocked state for a market WITHOUT an approved redemption rate
 * configuration (§7.2). This surface NEVER falls back to Malaysia or any
 * other market — until Initial, Minimum, Maximum, Currency and Display
 * Unit are approved, the market stays blocked.
 */
export function RedemptionMarketBlockedNotice({ code }: { code: string }) {
  return (
    <Alert
      tone="warning"
      title={`Redemption rate is not configured for market ${code}`}
    >
      Market {code} has no approved redemption rate configuration yet.
      Initial, Minimum, Maximum, Currency and Display Unit must be approved
      before rates can be managed. There is no fallback to Malaysia or any
      other market.
    </Alert>
  );
}

/**
 * Explicit blocked state for the create capability when the actor is not
 * SUPER_ADMIN (`redemption.rate.manage` is SUPER_ADMIN-only — the server
 * is the authority).
 */
export function RedemptionManageBlockedNotice() {
  return (
    <Alert tone="warning" title="Managing redemption rates is Super Admin only">
      The server grants redemption.rate.manage to SUPER_ADMIN only. This
      surface is read-only for your role; every configured rate is recorded
      with a mandatory reason in the privileged audit trail.
    </Alert>
  );
}
