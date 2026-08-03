import {
  ApiError,
  type AdminKycOpsCaseDetailDto,
  type AdminKycOpsMerchantDetailDto,
  type AdminKycOpsStatus,
} from '@ipoint/api-client';
import { routePath } from './route-manifest.js';

/**
 * P7-S5C KYC review presentation model.
 *
 * Pure helpers only: status labels/tones, action availability derived from
 * case status + effective permissions + write environment, evidence gating
 * copy, href building, and stable error copy. No client-side truth — every
 * value shown is the masked server projection; raw evidence is only ever
 * fetched through the dedicated evidence request (permission + reason +
 * step-up + audit).
 */

export type MemberKycActionId =
  | 'start-review'
  | 'request-more-info'
  | 'approve'
  | 'reject'
  | 'require-reverification';

export const MEMBER_KYC_ACTIONS: ReadonlyArray<{
  id: MemberKycActionId;
  label: string;
  allowedStatuses: ReadonlyArray<AdminKycOpsStatus>;
}> = [
  {
    id: 'start-review',
    label: 'Start review',
    allowedStatuses: ['SUBMITTED'],
  },
  {
    id: 'request-more-info',
    label: 'Request more information',
    allowedStatuses: ['UNDER_REVIEW'],
  },
  {
    id: 'approve',
    label: 'Approve',
    allowedStatuses: ['UNDER_REVIEW'],
  },
  {
    id: 'reject',
    label: 'Reject',
    allowedStatuses: ['UNDER_REVIEW'],
  },
  {
    id: 'require-reverification',
    label: 'Require reverification',
    allowedStatuses: ['APPROVED'],
  },
];

export function kycStatusLabel(status: AdminKycOpsStatus): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Not started';
    case 'DRAFT':
      return 'Draft';
    case 'SUBMITTED':
      return 'Submitted';
    case 'UNDER_REVIEW':
      return 'Under review';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    case 'MORE_INFO_REQUIRED':
      return 'More info required';
    case 'REVERIFICATION_REQUIRED':
      return 'Reverification required';
  }
}

export function kycStatusTone(
  status: AdminKycOpsStatus,
): 'success' | 'warning' | 'neutral' | 'error' {
  switch (status) {
    case 'APPROVED':
      return 'success';
    case 'REJECTED':
      return 'error';
    case 'UNDER_REVIEW':
    case 'MORE_INFO_REQUIRED':
    case 'REVERIFICATION_REQUIRED':
      return 'warning';
    default:
      return 'neutral';
  }
}

export interface MemberKycActionState {
  id: MemberKycActionId;
  label: string;
  /** The owner command is available for this case/actor/write env. */
  available: boolean;
  unavailableReason?: string;
}

/**
 * Which member KYC review actions this actor may invoke. UI affordance only
 * — the server enforces permission, market, and state machine.
 */
export function memberKycActions(
  caseDetail: AdminKycOpsCaseDetailDto,
  effectivePermissions: ReadonlyArray<string>,
  writeEnvironment: { online: boolean; desktop: boolean; standalone: boolean },
): MemberKycActionState[] {
  const canWrite =
    writeEnvironment.online &&
    writeEnvironment.desktop &&
    !writeEnvironment.standalone;
  const hasDecide = effectivePermissions.includes('member.kyc.decide');
  return MEMBER_KYC_ACTIONS.map((action) => {
    const statusAllowed = action.allowedStatuses.includes(caseDetail.status);
    if (hasDecide && statusAllowed && canWrite) {
      return { id: action.id, label: action.label, available: true };
    }
    const reasons: string[] = [];
    if (!hasDecide) reasons.push('server permission member.kyc.decide');
    if (!statusAllowed) reasons.push(`case status ${caseDetail.status}`);
    if (!canWrite)
      reasons.push(
        'privileged writes need the online desktop Admin Web (not PWA)',
      );
    return {
      id: action.id,
      label: action.label,
      available: false,
      unavailableReason: `Unavailable: ${reasons.join('; ')}.`,
    };
  });
}

export interface MerchantKycActionState {
  id: 'approve' | 'reject' | 'resubmission';
  label: string;
  available: boolean;
  unavailableReason?: string;
}

/** Merchant KYC review decisions available for the current submission. */
export function merchantKycActions(
  status: string,
  effectivePermissions: ReadonlyArray<string>,
  writeEnvironment: { online: boolean; desktop: boolean; standalone: boolean },
): MerchantKycActionState[] {
  const canWrite =
    writeEnvironment.online &&
    writeEnvironment.desktop &&
    !writeEnvironment.standalone;
  const canApprove = effectivePermissions.includes('merchant.kyc.approve');
  const reviewable = status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  const base: ReadonlyArray<
    Omit<MerchantKycActionState, 'available' | 'unavailableReason'>
  > = [
    { id: 'approve', label: 'Approve submission' },
    { id: 'reject', label: 'Reject submission' },
    { id: 'resubmission', label: 'Request resubmission' },
  ];
  return base.map((action) => {
    if (canApprove && reviewable && canWrite) {
      return { ...action, available: true };
    }
    const reasons: string[] = [];
    if (!canApprove) reasons.push('server permission merchant.kyc.approve');
    if (!reviewable) reasons.push(`submission status ${status}`);
    if (!canWrite)
      reasons.push(
        'privileged writes need the online desktop Admin Web (not PWA)',
      );
    return {
      ...action,
      available: false,
      unavailableReason: `Unavailable: ${reasons.join('; ')}.`,
    };
  });
}

export function merchantKycStatusLabel(status: string): string {
  switch (status) {
    case 'SUBMITTED':
      return 'Submitted';
    case 'UNDER_REVIEW':
      return 'Under review';
    case 'RESUBMISSION_REQUIRED':
      return 'Resubmission required';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    default:
      return status;
  }
}

export function merchantKycStatusTone(
  status: string,
): 'success' | 'warning' | 'neutral' | 'error' {
  switch (status) {
    case 'APPROVED':
      return 'success';
    case 'REJECTED':
      return 'error';
    case 'UNDER_REVIEW':
    case 'RESUBMISSION_REQUIRED':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Evidence-gating prerequisites for the §6.4 evidence panel. */
export function evidenceGate(
  effectivePermissions: ReadonlyArray<string>,
  permission: 'member.kyc.evidence.view' | 'merchant.kyc.evidence.view',
): {
  allowed: boolean;
  missingPermission: boolean;
  reasonRequired: boolean;
  stepUpRequired: boolean;
} {
  const allowed = effectivePermissions.includes(permission);
  return {
    allowed,
    missingPermission: !allowed,
    reasonRequired: true,
    stepUpRequired: true,
  };
}

/** Server rule: recorded reason is 8..500 characters. */
export function evidenceReasonValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= 8 && trimmed.length <= 500;
}

export function memberKycCaseHref(marketId: string, caseId: string): string {
  return routePath('member-kyc-detail', { marketId, caseId });
}

export function merchantKycCaseHref(
  marketId: string,
  branchId: string,
): string {
  return routePath('merchant-kyc-detail', { marketId, branchId });
}

export function kycErrorCopy(error: unknown): {
  title: string;
  description: string;
} {
  if (!(error instanceof ApiError)) {
    return {
      title: 'KYC review unavailable',
      description: error instanceof Error ? error.message : String(error),
    };
  }
  switch (error.body.code) {
    case 'MARKET_SELECTION_REQUIRED':
      return {
        title: 'No Current Admin Market selected',
        description:
          'Select an authorized market from the top bar to review KYC.',
      };
    case 'MARKET_CONTEXT_MISMATCH':
      return {
        title: 'KYC case is outside the selected market',
        description:
          'The server-bound Current Admin Market changed or this case belongs to another market. Refresh the current view.',
      };
    case 'PERMISSION_DENIED':
    case 'MARKET_ACCESS_DENIED':
    case 'ADMIN_KYC_MARKET_ACCESS_DENIED':
      return {
        title: 'Permission denied',
        description:
          'Your server permissions or market grant do not allow this KYC review action.',
      };
    case 'SENSITIVE_VIEW_REASON_REQUIRED':
      return {
        title: 'Reason required for evidence',
        description:
          'Enter a recorded reason (8 characters or more) to view sensitive evidence.',
      };
    case 'MFA_STEP_UP_REQUIRED':
      return {
        title: 'Identity verification required',
        description:
          'Verify with MFA step-up before viewing sensitive KYC evidence.',
      };
    case 'ADMIN_KYC_CASE_NOT_FOUND':
      return {
        title: 'KYC case not found',
        description:
          'No KYC case matches this identifier in the selected market.',
      };
    case 'ADMIN_KYC_INVALID_STATE':
    case 'ADMIN_KYC_INVALID_TRANSITION':
      return {
        title: 'KYC case state conflict',
        description:
          'The case is not in the expected state for that action. Refresh and review the current state.',
      };
    case 'ADMIN_KYC_IDEMPOTENCY_CONFLICT':
      return {
        title: 'Repeated request differs',
        description:
          'The same idempotency key was reused with a different payload. Refresh and start a new request.',
      };
    case 'ADMIN_KYC_SELF_REVIEW':
      return {
        title: 'Self-review blocked',
        description:
          'An administrator cannot review a KYC case for their own account.',
      };
    case 'MERCHANT_BRANCH_NOT_FOUND':
      return {
        title: 'Merchant branch not found',
        description:
          'No merchant branch matches this identifier in the selected market.',
      };
    default:
      return {
        title: 'KYC review operation failed',
        description: `${error.body.message ?? error.message} (${error.body.code ?? 'unknown'})`,
      };
  }
}
