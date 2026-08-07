import { Alert, Badge, Button, Card } from '@ipoint/ui';
import type { AdminAgentOpsStatus } from '@ipoint/api-client';
import { agentCapabilityLabel, agentStatusLabel } from './agent-ops-model.js';

/**
 * P7-S8 Agent Operations state components (design-system states:
 * loading / empty / error / permission-denied / blocked / offline-retry /
 * success).
 */

export function AgentOpsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="admin-state admin-state--skeleton"
      data-testid="agent-ops-skeleton"
      aria-label="Loading agents"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="admin-state__row" />
      ))}
    </div>
  );
}

const agentStatusTones: Readonly<
  Record<string, 'neutral' | 'success' | 'warning' | 'error' | 'info'>
> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DEACTIVATED: 'error',
  REJECTED: 'error',
  PENDING_APPROVAL: 'info',
  PAYMENT_CONFIRMED: 'info',
  COURSE_COMPLETED: 'info',
  COURSE_PENDING: 'neutral',
  PENDING_PAYMENT: 'neutral',
};

export function AgentStatusBadge({ status }: { status: AdminAgentOpsStatus }) {
  return (
    <Badge
      tone={agentStatusTones[status] ?? 'neutral'}
      data-testid={`agent-status-${status}`}
    >
      {agentStatusLabel(status)}
    </Badge>
  );
}

export function AgentCapabilityBanner({ state }: { state: string }) {
  if (state === 'CONFIGURED') return null;
  return (
    <Alert tone="warning" title={agentCapabilityLabel(state)}>
      This market has no effective agent activation fee, so agent status
      operations are blocked. No fallback fee from another market is applied.
    </Alert>
  );
}

export function AgentOpsEmptyState({
  description = 'No agent activations exist for this market in the selected state.',
}: {
  description?: string;
}) {
  return (
    <Card>
      <div className="admin-state" role="status">
        <p className="admin-state__title">No agents found</p>
        <p className="admin-state__body">{description}</p>
      </div>
    </Card>
  );
}

export function AgentActionSuccess({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <Alert tone="success" title={message}>
      The server confirmed the operation.
      <Button variant="ghost" size="sm" onClick={onClose}>
        Dismiss
      </Button>
    </Alert>
  );
}
