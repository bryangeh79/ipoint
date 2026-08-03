import { Alert, Button, Card, EmptyState, Skeleton } from '@ipoint/ui';
import type { ReactNode } from 'react';

/**
 * P7-S5B Admin Merchant Operations — state components.
 * Reuses shell-state conventions: loading skeleton, explicit empty, error
 * with retry, suspended and conflict banners. UNAVAILABLE/missing values are
 * never rendered as zero or fabricated.
 */

export function MerchantListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <section
      className="admin-merchants-loading"
      aria-label="Loading merchant operations"
      aria-live="polite"
      aria-busy="true"
    >
      <Skeleton width="38%" height={30} />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={52} />
      ))}
    </section>
  );
}

export function MerchantEmptyState({
  title = 'No merchants found',
  description = 'The server confirmed that this authorized view is empty.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <EmptyState title={title} description={description} action={action} />
    </Card>
  );
}

export function MerchantErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="admin-merchants-error">
      <EmptyState
        title={title}
        description={description}
        action={
          onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      />
    </Card>
  );
}

export function MerchantSuspendedBanner() {
  return (
    <Alert tone="warning" title="Merchant suspended" role="status">
      This merchant is suspended. Suspension preserves the MCP account and its
      balances (owner behavior); reactivation requires the suspend permission.
    </Alert>
  );
}

export function MerchantClosedBanner() {
  return (
    <Alert tone="warning" title="Merchant closed" role="status">
      This merchant is closed. Historical package and transaction evidence
      remains immutable and read-only.
    </Alert>
  );
}

export function MerchantConflictBanner({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Alert tone="error" title={title} role="alert">
      {description}
    </Alert>
  );
}

export function MerchantActionSuccessBanner({ message }: { message: string }) {
  return (
    <Alert tone="success" title="Action completed" role="status">
      {message}
    </Alert>
  );
}
