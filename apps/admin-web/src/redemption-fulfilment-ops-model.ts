import { ApiError } from '@ipoint/api-client';

/**
 * P7-S8 Admin Redemption Fulfilment Operations — pure presentation model.
 *
 * Formatting-only helpers: no client-side status derivation, no invented
 * rules, no fallback values. Every status/value displayed comes from the
 * Phase 7 adapter (`apps/api/src/admin-redemption-fulfilment-ops`)
 * responses as returned. Amounts are exact decimal strings and are never
 * parsed or reformatted numerically.
 */

export const fulfilmentQueueLabels: Readonly<Record<string, string>> = {
  READY_FOR_PICKUP: 'Ready for pickup',
  BACKORDERED: 'Backordered',
  FULFILMENT_SUSPENDED: 'Fulfilment suspended',
  FULFILMENT_EXCEPTION: 'Fulfilment exception',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
};

export function fulfilmentQueueLabel(status: string): string {
  return fulfilmentQueueLabels[status] ?? status;
}

export const refundStatusLabels: Readonly<Record<string, string>> = {
  PENDING_CHECKER: 'Pending checker',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXECUTING: 'Executing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export function refundStatusLabel(status: string): string {
  return refundStatusLabels[status] ?? status;
}

export interface RedemptionOpsPageErrorCopy {
  title: string;
  description: string;
  blockedPrerequisite?: string;
  kind:
    | 'error'
    | 'permission-denied'
    | 'blocked-prerequisite'
    | 'offline'
    | 'conflict';
}

/** Map a read error to the design-system state copy. */
export function describeRedemptionReadError(
  error: unknown,
): RedemptionOpsPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'MARKET_ACCESS_DENIED':
        return {
          kind: 'permission-denied',
          title: 'Permission denied',
          description:
            'Your effective server permissions do not allow redemption operations for this market.',
        };
      case 'MARKET_CONTEXT_MISMATCH':
      case 'MARKET_SELECTION_REQUIRED':
        return {
          kind: 'conflict',
          title: 'Market context changed',
          description:
            'Refresh the page and select the current Admin market before retrying.',
        };
      case 'REDEMPTION_QUEUE_STATUS_INVALID':
        return {
          kind: 'error',
          title: 'Invalid queue status',
          description: 'The requested fulfilment queue status is not valid.',
        };
      default:
        break;
    }
  }
  return {
    kind: 'error',
    title: 'Unable to load this view',
    description:
      'Retry the bounded request or use its reference ID for support.',
  };
}

/** Map an action (suspend/resume/retry) error to the design-system state. */
export function describeRedemptionActionError(
  error: unknown,
): RedemptionOpsPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'MARKET_ACCESS_DENIED':
        return {
          kind: 'permission-denied',
          title: 'Permission denied',
          description:
            'Fulfilment actions require the redemption.fulfilment.manage permission for this market.',
        };
      case 'REDEMPTION_FULFILMENT_INVALID_TRANSITION':
      case 'REDEMPTION_ORDER_NOT_SUSPENDED':
      case 'REDEMPTION_ORDER_CANNOT_SUSPEND':
      case 'REDEMPTION_FULFILMENT_NOT_FAILED':
      case 'REDEMPTION_FULFILMENT_MAX_RETRIES':
      case 'REDEMPTION_FULFILMENT_NON_RETRYABLE':
        return {
          kind: 'conflict',
          title: 'State changed',
          description:
            'The order/fulfilment state no longer allows this action. Refresh and review the current state.',
        };
      case 'REDEMPTION_REASON_REQUIRED':
        return {
          kind: 'error',
          title: 'Reason required',
          description: 'Enter a reason to perform this action.',
        };
      default:
        break;
    }
  }
  return {
    kind: 'error',
    title: 'Action did not complete',
    description:
      'The request did not complete. No success is assumed; refresh before retrying.',
  };
}

/** Exact UTC timestamp renderer (server timestamps are never re-derived). */
export function formatRedemptionUtc(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}
