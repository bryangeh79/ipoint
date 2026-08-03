import {
  ApiError,
  type AdminMemberOpsProfileDto,
  type AdminMemberOpsStatus,
} from '@ipoint/api-client';
import { routePath } from './route-manifest.js';

/**
 * P7-S5A Member Operations presentation model.
 *
 * Pure helpers only: status labels/tones, action availability derived from
 * member status + effective permissions + write environment, href building,
 * and stable error copy. No arithmetic and no client-side truth — every value
 * shown is the masked server projection.
 */

export type MemberOpsActionId =
  | 'suspend'
  | 'reactivate'
  | 'close'
  | 'revoke-sessions'
  | 'require-reverification';

export const MEMBER_OPS_ACTIONS: ReadonlyArray<{
  id: MemberOpsActionId;
  label: string;
  permission: string;
  allowedStatuses: ReadonlyArray<AdminMemberOpsStatus>;
}> = [
  {
    id: 'suspend',
    label: 'Suspend member',
    permission: 'member.status.manage',
    allowedStatuses: ['ACTIVE'],
  },
  {
    id: 'reactivate',
    label: 'Reactivate member',
    permission: 'member.status.manage',
    allowedStatuses: ['SUSPENDED'],
  },
  {
    id: 'close',
    label: 'Close member',
    permission: 'member.status.manage',
    allowedStatuses: ['ACTIVE', 'SUSPENDED'],
  },
  {
    id: 'revoke-sessions',
    label: 'Revoke all sessions',
    permission: 'member.session.revoke',
    allowedStatuses: ['ACTIVE', 'SUSPENDED', 'PENDING_EMAIL_VERIFICATION'],
  },
  {
    id: 'require-reverification',
    label: 'Require KYC reverification',
    permission: 'member.reverification.require',
    allowedStatuses: ['ACTIVE', 'SUSPENDED', 'PENDING_EMAIL_VERIFICATION'],
  },
];

export function memberStatusLabel(status: AdminMemberOpsStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'SUSPENDED':
      return 'Suspended';
    case 'CLOSED':
      return 'Closed';
    default:
      return 'Pending email verification';
  }
}

export function memberStatusTone(
  status: AdminMemberOpsStatus,
): 'success' | 'warning' | 'neutral' | 'error' {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'SUSPENDED':
      return 'warning';
    case 'CLOSED':
      return 'error';
    default:
      return 'neutral';
  }
}

export function isTerminalMemberStatus(status: AdminMemberOpsStatus): boolean {
  return status === 'CLOSED';
}

export interface MemberOpsActionState {
  id: MemberOpsActionId;
  label: string;
  /** The owner command is available for this member/actor/write env. */
  available: boolean;
  /** Shown when the capability is unavailable (owner/state/perm boundary). */
  unavailableReason?: string;
}

/**
 * Which owner actions this actor may invoke for this member. This is a UI
 * affordance only — the server enforces permission, market, and state.
 */
export function memberOpsActions(
  profile: AdminMemberOpsProfileDto,
  effectivePermissions: ReadonlyArray<string>,
  writeEnvironment: { online: boolean; desktop: boolean; standalone: boolean },
): MemberOpsActionState[] {
  const canWrite =
    writeEnvironment.online &&
    writeEnvironment.desktop &&
    !writeEnvironment.standalone;
  return MEMBER_OPS_ACTIONS.map((action) => {
    const hasPermission = effectivePermissions.includes(action.permission);
    const statusAllowed = action.allowedStatuses.includes(profile.status);
    if (hasPermission && statusAllowed && canWrite) {
      return { id: action.id, label: action.label, available: true };
    }
    const reasons: string[] = [];
    if (!hasPermission) reasons.push('server permission');
    if (!statusAllowed) reasons.push(`member status ${profile.status}`);
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

/** Require-reverification additionally needs an approved KYC case. */
export function reverificationCapability(profile: AdminMemberOpsProfileDto): {
  available: boolean;
  reason?: string;
} {
  if (profile.kyc?.status === 'APPROVED') return { available: true };
  return {
    available: false,
    reason:
      profile.kyc === null
        ? 'No KYC case exists for this member.'
        : `The KYC case is ${profile.kyc.status}; only an approved case can be sent for reverification.`,
  };
}

export function memberDetailHref(
  marketId: string,
  publicMemberId: string,
): string {
  return routePath('member-detail', { marketId, memberId: publicMemberId });
}

export function maskedLabel(label: string): string {
  return `${label} (masked)`;
}

export function memberOpsErrorCopy(error: unknown): {
  title: string;
  description: string;
} {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Member operations unavailable',
      description: error instanceof Error ? error.message : String(error),
    };
  }
  switch (error.body.code) {
    case 'MARKET_SELECTION_REQUIRED':
      return {
        title: 'No Current Admin Market selected',
        description:
          'Select an authorized market from the top bar to view members.',
      };
    case 'MARKET_CONTEXT_MISMATCH':
      return {
        title: 'Member is outside the selected market',
        description:
          'The server-bound Current Admin Market changed or this member belongs to another market. Refresh the current view.',
      };
    case 'PERMISSION_DENIED':
    case 'ADMIN_MEMBER_MARKET_ACCESS_DENIED':
      return {
        title: 'Permission denied',
        description:
          'Your server permissions or market grant do not allow this member operation.',
      };
    case 'ADMIN_MEMBER_NOT_FOUND':
      return {
        title: 'Member not found',
        description:
          'No member matches this identifier in the selected market.',
      };
    case 'ADMIN_MEMBER_INVALID_STATUS':
      return {
        title: 'Member status conflict',
        description:
          'The member is not in the expected status for that action. Refresh and review the current state.',
      };
    case 'ADMIN_MEMBER_ALREADY_CLOSED':
      return {
        title: 'Member already closed',
        description:
          'This member is already closed and cannot be closed again.',
      };
    case 'ADMIN_MEMBER_KYC_REVERIFICATION_NOT_ALLOWED':
      return {
        title: 'Reverification not allowed',
        description:
          'Only an approved KYC case can be sent for reverification.',
      };
    case 'ADMIN_MEMBER_CLOSE_CONFIRMATION_REQUIRED':
      return {
        title: 'Confirmation required',
        description: 'Type CONFIRM exactly to close this member.',
      };
    case 'ADMIN_MEMBER_IDEMPOTENCY_CONFLICT':
      return {
        title: 'Repeated request differs',
        description:
          'The same idempotency key was reused with a different payload. Refresh and start a new request.',
      };
    default:
      return {
        title: 'Member operation failed',
        description: `${error.body.message ?? error.message} (${error.body.code ?? 'unknown'})`,
      };
  }
}
