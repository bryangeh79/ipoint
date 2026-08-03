import { Badge, Card, Skeleton } from '@ipoint/ui';
import type { AdminKycOpsStatus } from '@ipoint/api-client';
import {
  kycStatusLabel,
  kycStatusTone,
  merchantKycStatusLabel,
  merchantKycStatusTone,
  type MemberKycActionState,
  type MerchantKycActionState,
} from './kyc-model.js';

/**
 * P7-S5C KYC review state components.
 *
 * Loading skeletons, status badges, the locked-evidence notice, and the
 * explicit unavailable-action affordance. Error/empty/conflict/offline
 * states reuse the shell `ShellState`/`ApiErrorState` components.
 */

export function KycQueueSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card aria-label="Loading KYC queue" aria-busy="true">
      <Skeleton height={36} />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={44} />
      ))}
    </Card>
  );
}

export function KycStatusBadge({ status }: { status: AdminKycOpsStatus }) {
  return (
    <Badge
      tone={kycStatusTone(status)}
      className={`admin-kyc-status admin-kyc-status--${status.toLowerCase()}`}
    >
      {kycStatusLabel(status)}
    </Badge>
  );
}

export function MerchantKycStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      tone={merchantKycStatusTone(status)}
      className={`admin-kyc-status admin-kyc-status--${status.toLowerCase()}`}
    >
      {merchantKycStatusLabel(status)}
    </Badge>
  );
}

/** Locked raw-evidence notice shown when the actor lacks the evidence permission. */
export function EvidenceLockedNotice({ permission }: { permission: string }) {
  return (
    <p className="admin-kyc-evidence-locked" role="status">
      <strong>Raw evidence is locked.</strong> Viewing sensitive KYC evidence
      requires the <code>{permission}</code> permission, a recorded reason, and
      MFA step-up. Masked summaries remain available above.
    </p>
  );
}

export function MemberKycActionUnavailable({
  state,
}: {
  state: MemberKycActionState;
}) {
  return (
    <p className="admin-kyc-action-unavailable">
      <span>{state.label}</span>
      <small>{state.unavailableReason ?? 'Unavailable.'}</small>
    </p>
  );
}

export function MerchantKycActionUnavailable({
  state,
}: {
  state: MerchantKycActionState;
}) {
  return (
    <p className="admin-kyc-action-unavailable">
      <span>{state.label}</span>
      <small>{state.unavailableReason ?? 'Unavailable.'}</small>
    </p>
  );
}
