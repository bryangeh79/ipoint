import {
  ApiError,
  type AdminMerchantApplicationQueueStatus,
  type AdminMerchantBranchDetailDto,
  type AdminMerchantListStatus,
  type AdminMerchantReviewDecision,
} from '@ipoint/api-client';

/**
 * P7-S5B Admin Merchant Operations — pure presentation model.
 *
 * Formatting-only helpers: no client arithmetic on balances or rates, no
 * status derivation, no invented rules. Every status/value displayed comes
 * from the owner/adapter responses as returned.
 */

export const merchantOperationalStatusLabels: Readonly<Record<string, string>> =
  {
    PENDING_APPLICATION: 'Pending application',
    PENDING_KYC: 'Pending KYC',
    PENDING_MCP: 'Pending MCP',
    ACTIVE: 'Active',
    SUSPENDED: 'Suspended',
    CLOSURE_PENDING: 'Closure pending',
    CLOSED: 'Closed',
  };

export const merchantApplicationStatusLabels: Readonly<Record<string, string>> =
  {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under review',
    RESUBMISSION_REQUIRED: 'Resubmission required',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
  };

export const merchantKycStatusLabels: Readonly<Record<string, string>> =
  merchantApplicationStatusLabels;

export const merchantPackageStatusLabels: Readonly<Record<string, string>> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  PENDING_CHANGE: 'Pending change',
};

export function merchantOperationalStatusLabel(status: string): string {
  return merchantOperationalStatusLabels[status] ?? status;
}

export function merchantApplicationStatusLabel(status: string): string {
  return merchantApplicationStatusLabels[status] ?? status;
}

export function merchantKycStatusLabel(status: string): string {
  return merchantKycStatusLabels[status] ?? status;
}

export function merchantPackageStatusLabel(status: string): string {
  return merchantPackageStatusLabels[status] ?? status;
}

export const merchantApplicationQueueStatusFilterOptions: ReadonlyArray<{
  value: AdminMerchantApplicationQueueStatus | '';
  label: string;
}> = [
  { value: '', label: 'All statuses' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'RESUBMISSION_REQUIRED', label: 'Resubmission required' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export const merchantListStatusFilterOptions: ReadonlyArray<{
  value: AdminMerchantListStatus | '';
  label: string;
}> = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING_APPLICATION', label: 'Pending application' },
  { value: 'PENDING_KYC', label: 'Pending KYC' },
  { value: 'PENDING_MCP', label: 'Pending MCP' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'CLOSURE_PENDING', label: 'Closure pending' },
  { value: 'CLOSED', label: 'Closed' },
];

export const merchantReviewDecisionOptions: ReadonlyArray<{
  value: AdminMerchantReviewDecision;
  label: string;
}> = [
  { value: 'APPROVED', label: 'Approve' },
  { value: 'REJECTED', label: 'Reject' },
  { value: 'RESUBMISSION_REQUIRED', label: 'Request more information' },
];

export function formatMerchantTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export interface MerchantActionAvailability {
  canReviewApplication: boolean;
  canReviewKyc: boolean;
  canSuspend: boolean;
  canReactivate: boolean;
  canClose: boolean;
}

/**
 * Which approved owner actions are available for this branch, based on the
 * admin's effective server permissions and the current owner-reported
 * statuses. This is a presentation gate only — the server RbacGuard remains
 * the security boundary.
 */
export function merchantActionAvailability(
  detail: AdminMerchantBranchDetailDto,
  effectivePermissions: ReadonlyArray<string>,
): MerchantActionAvailability {
  const has = (permission: string) => effectivePermissions.includes(permission);
  const operationalStatus = detail.application.operational_status;
  const applicationStatus = detail.application.status;
  const kycStatus =
    detail.kyc.current !== null && typeof detail.kyc.current === 'object'
      ? String((detail.kyc.current as { status?: unknown }).status ?? '')
      : '';
  return {
    canReviewApplication:
      has('merchant.approve') &&
      (applicationStatus === 'SUBMITTED' ||
        applicationStatus === 'UNDER_REVIEW'),
    canReviewKyc: has('merchant.kyc.approve') && kycStatus === 'SUBMITTED',
    canSuspend: has('merchant.suspend') && operationalStatus === 'ACTIVE',
    canReactivate: has('merchant.suspend') && operationalStatus === 'SUSPENDED',
    canClose:
      has('merchant.close') &&
      operationalStatus !== 'CLOSED' &&
      operationalStatus !== 'CLOSURE_PENDING',
  };
}

export interface MerchantPageErrorCopy {
  title: string;
  description: string;
}

export function describeMerchantReadError(
  error: unknown,
): MerchantPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include the required merchant permission for this market.',
        };
      case 'MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load merchant operations.',
        };
      case 'MARKET_CONTEXT_MISMATCH':
        return {
          title: 'Market context mismatch',
          description:
            'The server-bound Current Admin Market changed. Refresh and try again.',
        };
      case 'MERCHANT_BRANCH_NOT_FOUND':
        return {
          title: 'Merchant branch not found',
          description:
            'This branch does not exist in the selected market, or you do not have access to it.',
        };
      default:
        return {
          title: 'Merchant operations unavailable',
          description: `${error.body.message ?? error.message} (${error.body.code ?? 'unknown'})`,
        };
    }
  }
  return {
    title: 'Merchant operations unavailable',
    description: error instanceof Error ? error.message : String(error),
  };
}

export interface MerchantActionErrorCopy {
  title: string;
  description: string;
}

export function describeMerchantActionError(
  error: unknown,
  actionLabel: string,
): MerchantActionErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'IDEMPOTENCY_KEY_CONFLICT':
        return {
          title: 'Duplicate request',
          description: `${actionLabel} was already submitted with this request key. Refresh to see the current state.`,
        };
      case 'MERCHANT_INVALID_TRANSITION':
        return {
          title: 'State conflict',
          description: `${actionLabel} is not valid for the current merchant state. Refresh and review the current state before trying again.`,
        };
      case 'MERCHANT_VERSION_CONFLICT':
        return {
          title: 'Server state changed',
          description:
            'The merchant changed during this request. Refresh and review before trying again.',
        };
      case 'PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description: `Your server permissions do not allow ${actionLabel.toLowerCase()}.`,
        };
      case 'MARKET_CONTEXT_MISMATCH':
        return {
          title: 'Market context mismatch',
          description:
            'The server-bound Current Admin Market changed. Refresh and try again.',
        };
      default:
        return {
          title: `${actionLabel} failed`,
          description: `${error.body.message ?? error.message} (${error.body.code ?? 'unknown'})`,
        };
    }
  }
  return {
    title: `${actionLabel} failed`,
    description: error instanceof Error ? error.message : String(error),
  };
}
