import { Badge, Card, Skeleton } from '@ipoint/ui';
import {
  isTerminalMemberStatus,
  memberStatusLabel,
  memberStatusTone,
  type MemberOpsActionState,
} from './member-ops-model.js';

/**
 * P7-S5A Member Operations state components.
 *
 * Small testable components for the required member surfaces: loading
 * skeleton, status badge with suspended/closed emphasis, and the explicit
 * unavailable-owner-capability action state. Error/empty/conflict/offline
 * states reuse the shell `ShellState`/`ApiErrorState` components.
 */

export function MemberListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card aria-label="Loading members" aria-busy="true">
      <Skeleton height={36} />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={44} />
      ))}
    </Card>
  );
}

export function MemberStatusBadge({
  status,
}: {
  status: Parameters<typeof memberStatusTone>[0];
}) {
  return (
    <Badge
      tone={memberStatusTone(status)}
      className={`admin-member-status admin-member-status--${status.toLowerCase()}`}
    >
      {memberStatusLabel(status)}
    </Badge>
  );
}

/** Suspended/closed members keep a persistent status notice on the page. */
export function MemberStatusNotice({
  status,
}: {
  status: Parameters<typeof memberStatusTone>[0];
}) {
  if (status === 'ACTIVE') return null;
  if (isTerminalMemberStatus(status)) {
    return (
      <p
        className="admin-member-notice admin-member-notice--closed"
        role="status"
      >
        This member is <strong>closed</strong> — no status action is available.
      </p>
    );
  }
  return (
    <p
      className="admin-member-notice admin-member-notice--suspended"
      role="status"
    >
      This member is <strong>suspended</strong> — limited actions are available.
    </p>
  );
}

/** Explicit unavailable-owner-capability affordance for an action. */
export function MemberActionUnavailable({
  state,
}: {
  state: MemberOpsActionState;
}) {
  return (
    <p className="admin-member-action-unavailable">
      <span>{state.label}</span>
      <small>{state.unavailableReason ?? 'Unavailable.'}</small>
    </p>
  );
}
