import { ApiError } from '@ipoint/api-client';

/**
 * P7-S9 Admin Audit Viewer — pure presentation model.
 *
 * Formatting-only helpers: no client-side masking or status derivation.
 * Every value displayed comes from the Phase 7 adapter
 * (`apps/api/src/admin-audit-ops`) responses as returned — the masked
 * limited view (masked:true, no raw IP, no raw fields) for every role
 * including Support, and the raw evidence view only when the server
 * returns it (audit.sensitive-diff.view, step-up + recorded reason).
 */

export const auditActorLabels: Readonly<Record<string, string>> = {
  ACCOUNT: 'Account',
  ADMIN_USER: 'Admin',
  SYSTEM: 'System',
};

export function auditActorLabel(actorType: string): string {
  return auditActorLabels[actorType] ?? actorType;
}

export const auditResultLabels: Readonly<Record<string, string>> = {
  SUCCESS: 'Success',
  FAILURE: 'Failure',
  DENIED: 'Denied',
};

export function auditResultLabel(result: string): string {
  return auditResultLabels[result] ?? result;
}

/** Format a UTC ISO timestamp as local date + time for display. */
export function formatAuditUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export interface AuditPageErrorCopy {
  title: string;
  description: string;
  kind:
    | 'error'
    | 'permission-denied'
    | 'blocked-prerequisite'
    | 'offline'
    | 'conflict';
}

/**
 * Map a read error to the design-system state copy. 403 from the canonical
 * RbacGuard becomes the permission-denied state; a raw-view step-up
 * rejection is described separately by the raw panel.
 */
export function describeAuditReadError(error: unknown): AuditPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'MARKET_ACCESS_DENIED':
        return {
          kind: 'permission-denied',
          title: 'Permission denied',
          description:
            'Your effective server permissions do not allow viewing the audit log for this market.',
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
    title: 'Audit log unavailable',
    description:
      'The audit viewer could not be loaded. Refresh the page to retry.',
  };
}

export function auditReasonValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= 8 && trimmed.length <= 500;
}
