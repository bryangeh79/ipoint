import { Alert, Badge, Button, Card } from '@ipoint/ui';
import type { AdminCommissionRateVersionDto } from '@ipoint/api-client';
import { commissionWindowStatusLabel } from './commission-config-model.js';

/**
 * P7-S6D commission-configuration state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry).
 */

export function CommissionRateSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="commission-rate-skeleton"
      aria-label="Loading commission rate configuration"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

export function CommissionWindowStatusBadge({
  status,
}: {
  status: AdminCommissionRateVersionDto['window_status'];
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
    <Badge tone={tone} data-testid={`commission-window-${status}`}>
      {commissionWindowStatusLabel(status)}
    </Badge>
  );
}

export function CommissionEmptyState() {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">No commission rates configured</p>
        <p className="admin-state__body">
          No rate version exists for this market yet. Rates are exact decimals
          (FIXED amounts in the market currency, PERCENTAGE up to 100%) and
          every version activates at a future market-local 00:00.
        </p>
      </div>
    </Card>
  );
}

export function CommissionErrorState({
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

export function CommissionPermissionDeniedState({
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

export function CommissionOfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">You are offline</p>
        <p className="admin-state__body">
          Commission rate configuration needs a connection. Retry when you are
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
 * Explicit blocked state for the market (owner contract: rates are managed
 * only on ACTIVE markets). Over HTTP the canonical RbacGuard denies
 * non-ACTIVE markets with 403 first, so this state is defensive — the
 * server remains the authority.
 */
export function CommissionMarketBlockedNotice({ code }: { code: string }) {
  return (
    <Alert
      tone="warning"
      title={`Market ${code} is blocked for rate management`}
    >
      Commission rates can be managed only on ACTIVE markets. This market is not
      active, so the surface stays read-only-blocked — there is no fallback to
      any other market.
    </Alert>
  );
}

/**
 * Explicit blocked state for the schedule capability when the actor is not
 * SUPER_ADMIN (the route's capability gate `commission.rate.manage` is
 * discoverability metadata only — the server is the authority).
 */
export function CommissionManageBlockedNotice() {
  return (
    <Alert tone="warning" title="Managing commission rates is Super Admin only">
      The server grants commission.rate.manage to SUPER_ADMIN only. This surface
      is read-only for your role; every created rate version is recorded with a
      mandatory reason in the privileged audit trail.
    </Alert>
  );
}
