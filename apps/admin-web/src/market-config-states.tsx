import { Badge, Button, Card } from '@ipoint/ui';

/**
 * P7-S6E market-configuration state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry).
 */

export function MarketConfigSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="market-config-skeleton"
      aria-label="Loading market configuration"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

export function MarketStatusBadge({
  status,
}: {
  status: 'ACTIVE' | 'INACTIVE';
}) {
  return (
    <Badge
      tone={status === 'ACTIVE' ? 'success' : 'warning'}
      data-testid={`market-status-${status}`}
    >
      {status}
    </Badge>
  );
}

export function MarketErrorState({
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

export function MarketPermissionDeniedState({
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

export function MarketOfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">You are offline</p>
        <p className="admin-state__body">
          Market configuration needs a connection. Retry when you are back
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
 * Explicit blocked state for the market (owner contract: markets are
 * managed only while ACTIVE). Over HTTP the canonical RbacGuard denies
 * non-ACTIVE markets with 403 first, so this state is defensive — the
 * server remains the authority.
 */
export function MarketBlockedNotice({ marketCode }: { marketCode: string }) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">Market {marketCode} is not active</p>
        <p className="admin-state__body">
          This market is blocked for configuration. The surface never falls back
          to another market.
        </p>
      </div>
    </Card>
  );
}
