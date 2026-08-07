import { Alert, Badge, Button, Card } from '@ipoint/ui';
import type { AdminPackageVersionDto } from '@ipoint/api-client';
import { packageVersionStatusLabel } from './package-config-model.js';

/**
 * P7-S6A package-configuration state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry).
 */

export function PackageCatalogSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="package-catalog-skeleton"
      aria-label="Loading package catalog"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

export function PackageVersionStatusBadge({
  status,
}: {
  status: AdminPackageVersionDto['status'];
}) {
  const tone =
    status === 'ACTIVE'
      ? 'success'
      : status === 'SCHEDULED'
        ? 'info'
        : status === 'DRAFT'
          ? 'neutral'
          : 'warning';
  return (
    <Badge tone={tone} data-testid={`version-status-${status}`}>
      {packageVersionStatusLabel(status)}
    </Badge>
  );
}

export function PackageEmptyState() {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">No packages configured</p>
        <p className="admin-state__body">
          No standard merchant packages exist for this market yet. New package
          versions never move existing merchant assignments.
        </p>
      </div>
    </Card>
  );
}

export function PackageErrorState({
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

export function PackagePermissionDeniedState({
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

export function PackageOfflineState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">You are offline</p>
        <p className="admin-state__body">
          Package configuration needs a connection. Retry when you are back
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
 * Explicit notice when the role holds merchant.special_package.manage but
 * the current environment cannot perform sensitive admin writes (D-051
 * rewire: creation is exposed, but only on the online desktop web flow).
 */
export function SpecialPercentageManageBlockedNotice() {
  return (
    <Alert
      tone="warning"
      title="Creating special percentages needs the online desktop Admin Web"
    >
      Your role can manage special percentages, but creating them is a sensitive
      write: sign in on the online desktop Admin Web to create a new special
      percentage with a mandatory reason and Idempotency-Key.
    </Alert>
  );
}
