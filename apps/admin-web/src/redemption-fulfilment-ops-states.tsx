import { Alert, Badge, Card } from '@ipoint/ui';
import type { AdminFulfilmentQueueStatus } from '@ipoint/api-client';
import {
  fulfilmentQueueLabel,
  refundStatusLabel,
} from './redemption-fulfilment-ops-model.js';

/**
 * P7-S8 Redemption Operations state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry /
 * success).
 */

export function RedemptionOpsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="redemption-ops-skeleton"
      aria-label="Loading redemption operations"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

const queueTones: Readonly<
  Record<string, 'neutral' | 'success' | 'warning' | 'error' | 'info'>
> = {
  READY_FOR_PICKUP: 'info',
  BACKORDERED: 'warning',
  FULFILMENT_SUSPENDED: 'warning',
  FULFILMENT_EXCEPTION: 'error',
  REFUND_PENDING: 'warning',
  REFUNDED: 'success',
};

export function FulfilmentQueueBadge({
  status,
}: {
  status: AdminFulfilmentQueueStatus;
}) {
  return (
    <Badge
      tone={queueTones[status] ?? 'neutral'}
      data-testid={`queue-status-${status}`}
    >
      {fulfilmentQueueLabel(status)}
    </Badge>
  );
}

const refundTones: Readonly<
  Record<string, 'neutral' | 'success' | 'warning' | 'error' | 'info'>
> = {
  COMPLETED: 'success',
  APPROVED: 'info',
  PENDING_CHECKER: 'neutral',
  EXECUTING: 'warning',
  REJECTED: 'warning',
  FAILED: 'error',
};

export function RefundStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      tone={refundTones[status] ?? 'neutral'}
      data-testid={`refund-status-${status}`}
    >
      {refundStatusLabel(status)}
    </Badge>
  );
}

export function RateCapabilityBanner({
  rateConfigured,
  marketCode,
}: {
  rateConfigured: boolean;
  marketCode: string;
}) {
  if (rateConfigured) return null;
  return (
    <Alert tone="warning" title="Redemption rate not configured">
      Market {marketCode} has no active redemption rate rule, so member
      redemptions are not available for this market. No fallback rate from
      another market is applied.
    </Alert>
  );
}

export function RedemptionOpsEmptyState({
  title = 'No records found',
  description = 'The server confirmed that this authorized view is empty.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">{title}</p>
        <p className="admin-state__body">{description}</p>
      </div>
    </Card>
  );
}
