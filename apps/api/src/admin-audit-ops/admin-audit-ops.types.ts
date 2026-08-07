/**
 * Admin Audit Viewer read-model types (P7-S9, Command Center 2026-08-07 §7.1).
 *
 * Server-owned, selected-market, immutable audit projections over the
 * canonical `audit_logs` table (append-only by trigger; no UPDATE/DELETE
 * path exists). The viewer is READ-ONLY by construction: this surface
 * defines no write endpoints and performs no writes.
 *
 * Two views exist:
 * - Limited view (`audit.read`, ALL controlled roles incl. the Support /
 *   read-only auditor template): masked evidence only. Sensitive and
 *   identity-document fields inside `before`/`after` are masked, the
 *   source IP is never returned, and the payload carries `masked: true`.
 *   Support never sees raw ledgers.
 * - Raw evidence view (`audit.sensitive-diff.view`): the stored full
 *   evidence (before/after as persisted, source IP, request id). The
 *   catalog permission carries `stepUpRequired` + `sensitiveReasonRequired`
 *   and excludes the Support template, satisfying the frozen
 *   "support no raw ledgers" rule.
 */

export const AUDIT_VIEWER_VERSION = 1;

export const AUDIT_ACTOR_TYPES = [
  'ACCOUNT',
  'ADMIN_USER',
  'SYSTEM',
] as const;

export const AUDIT_RESULTS = ['SUCCESS', 'FAILURE', 'DENIED'] as const;

export type AuditViewerErrorCode =
  | 'AUDIT_ENTRY_NOT_FOUND'
  | 'AUDIT_FILTER_INVALID';

export class AuditViewerError extends Error {
  constructor(
    readonly code: AuditViewerErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AuditViewerError';
  }
}

export interface AuditViewerActor {
  adminUserId: string;
  requestId?: string;
}

/**
 * Limited (masked) audit entry projection. `beforeMasked`/`afterMasked`
 * are the masked JSON evidence; the raw stored values are never included,
 * `ipAddress` is never included, and `masked` is always true.
 */
export interface AuditEntryView {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  marketId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: string;
  reason: string | null;
  requestId: string | null;
  masked: true;
  beforeMasked: unknown;
  afterMasked: unknown;
}

export interface AuditEntryRawView {
  id: string;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  marketId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  result: string;
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
  raw: true;
  before: unknown;
  after: unknown;
}

export interface AuditListResponse {
  asOf: string;
  marketId: string;
  items: AuditEntryView[];
  total: number;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ */
/*  Masking                                                            */
/* ------------------------------------------------------------------ */

const sensitiveKey =
  /(?:password|secret|token|authorization|cookie|credential|hash|(?:otp|verification|recovery)_?code)$/iu;

const identityKey =
  /(?:nric|passport|national_id|identity_card|id_card|ic_number|id_number|document_number|ssn)/iu;

const jwtLike = /^eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/u;

/**
 * Mask one audit JSON value for the limited view.
 *
 * - Sensitive keys (password/token/secret/cookie/credential/hash/OTP
 *   codes) → `[REDACTED]`.
 * - Identity-document keys (NRIC / passport / national id / id-card) →
 *   `[MASKED]`.
 * - String values that are JWT-like bearer tokens → `[MASKED]`.
 * Recursion is bounded by the JSON depth of the stored audit value; the
 * database `jsonb` columns already cap the stored size. UUIDs, order
 * numbers, amounts and plain reasons are never masked (they are
 * identifiers, not secrets).
 */
export function maskAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskAuditValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (sensitiveKey.test(key)) return [key, '[REDACTED]'];
        if (identityKey.test(key)) return [key, '[MASKED]'];
        return [key, maskAuditValue(entry)];
      }),
    );
  }
  if (typeof value === 'string' && jwtLike.test(value)) return '[MASKED]';
  return value;
}

/** Free-text searchable columns (bounded ILIKE set, no raw SQL concat). */
export const AUDIT_SEARCH_COLUMNS = [
  'action',
  'entityType',
  'entityId',
  'actorId',
] as const;
