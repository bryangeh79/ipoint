import { ApiError } from '@ipoint/api-client';

/**
 * P7-S9 Admin Basic Reports — pure presentation model.
 *
 * Formatting-only helpers. Every value, state and freshness flag displayed
 * comes from the Phase 7 adapter (`apps/api/src/admin-report-ops`)
 * responses as returned. An UNAVAILABLE report is rendered as unavailable —
 * never as a fabricated zero; a STALE report is rendered with the explicit
 * stale marker and its snapshot `asOf`.
 */

export function formatReportAsOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export interface ReportPageErrorCopy {
  title: string;
  description: string;
  kind: 'error' | 'permission-denied' | 'offline' | 'conflict';
}

export function describeReportReadError(error: unknown): ReportPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'MARKET_ACCESS_DENIED':
        return {
          kind: 'permission-denied',
          title: 'Permission denied',
          description:
            'Your effective server permissions do not allow viewing reports for this market.',
        };
      case 'MARKET_CONTEXT_MISMATCH':
      case 'MARKET_SELECTION_REQUIRED':
        return {
          kind: 'conflict',
          title: 'Market context changed',
          description:
            'Refresh the page and select the current Admin market before retrying.',
        };
      default:
        break;
    }
  }
  return {
    kind: 'error',
    title: 'Reports unavailable',
    description:
      'The bounded reports could not be loaded. Refresh the page to retry.',
  };
}

/** Human label for a report value kind. */
export const reportValueKindLabels: Readonly<Record<string, string>> = {
  STATUS_COUNTS: 'Counts by status',
  ADJUSTMENT_SUMMARY: 'Adjustment summary',
  QUEUE_OVERVIEW: 'Queue overview',
  TREND: 'Daily trend',
};

export function reportValueKindLabel(kind: string): string {
  return reportValueKindLabels[kind] ?? kind;
}
