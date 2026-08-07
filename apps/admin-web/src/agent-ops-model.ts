import { ApiError } from '@ipoint/api-client';

/**
 * P7-S8 Admin Agent Operations — pure presentation model.
 *
 * Formatting-only helpers: no client-side status derivation, no invented
 * rules, no fallback values. Every status/value displayed comes from the
 * Phase 7 adapter (`apps/api/src/admin-agent-ops`) responses as returned.
 * The capability state is explicit: `CONFIGURED` or
 * `AGENT_FEE_NOT_CONFIGURED` (a market with no effective activation fee
 * never falls back to Malaysia or any other market).
 */

export const agentStatusLabels: Readonly<Record<string, string>> = {
  PENDING_PAYMENT: 'Pending payment',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  COURSE_PENDING: 'Course pending',
  COURSE_COMPLETED: 'Course completed',
  PENDING_APPROVAL: 'Pending approval',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
  REJECTED: 'Rejected',
};

export function agentStatusLabel(status: string): string {
  return agentStatusLabels[status] ?? status;
}

export const agentCapabilityLabels: Readonly<Record<string, string>> = {
  CONFIGURED: 'Agent activation configured',
  AGENT_FEE_NOT_CONFIGURED: 'Agent activation not configured',
};

export function agentCapabilityLabel(state: string): string {
  return agentCapabilityLabels[state] ?? state;
}

export interface AgentPageErrorCopy {
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

/**
 * Map a read error to the design-system state copy. The adapter surfaces
 * the explicit `AGENT_FEE_NOT_CONFIGURED` capability in the response
 * (never a fallback fee); a 403 from the canonical RbacGuard becomes the
 * permission-denied state.
 */
export function describeAgentReadError(error: unknown): AgentPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'MARKET_ACCESS_DENIED':
        return {
          kind: 'permission-denied',
          title: 'Permission denied',
          description:
            'Your effective server permissions do not allow agent operations for this market.',
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
    title: 'Unable to load agents',
    description:
      'Retry the bounded request or use its reference ID for support.',
  };
}

export function describeAgentActionError(error: unknown): AgentPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'MARKET_ACCESS_DENIED':
        return {
          kind: 'permission-denied',
          title: 'Permission denied',
          description:
            'Agent status changes require the agent.activation.manage permission for this market.',
        };
      case 'AGENT_INVALID_TRANSITION':
      case 'AGENT_ALREADY_ACTIVE':
      case 'AGENT_ALREADY_SUSPENDED':
      case 'AGENT_ALREADY_DEACTIVATED':
      case 'AGENT_ALREADY_REJECTED':
      case 'AGENT_DEACTIVATED_CANNOT_REACTIVATE':
      case 'AGENT_REJECTED_CANNOT_TRANSITION':
        return {
          kind: 'conflict',
          title: 'State changed',
          description:
            'The agent status no longer allows this action. Refresh and review the current state.',
        };
      case 'AGENT_FEE_NOT_CONFIGURED':
        return {
          kind: 'blocked-prerequisite',
          title: 'Capability unavailable',
          description:
            'This market has no effective agent activation fee, so agent status operations are not available.',
          blockedPrerequisite: 'AGENT_FEE_NOT_CONFIGURED',
        };
      case 'REASON_REQUIRED':
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
export function formatAgentUtc(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}
