import { AuditViewerError } from './admin-audit-ops.types.js';

/** The market does not exist or the audit entry is not visible in it. */
export function auditEntryNotFoundError(reference: string): AuditViewerError {
  return new AuditViewerError(
    'AUDIT_ENTRY_NOT_FOUND',
    `Audit entry not found for: ${reference}`,
    { reference },
  );
}
