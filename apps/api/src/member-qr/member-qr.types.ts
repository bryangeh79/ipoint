/**
 * L-06 Member QR surface - domain types and error model.
 *
 * Implements the frozen Phase 2 contract surface GET/POST/DELETE
 * `/members/me/qr` (PHASE_2_API_CONTRACT.md §3.2 route table + §4.4
 * MemberQrResponse). Error codes are the contract §5 codes only:
 * MEMBER_NOT_FOUND, MEMBER_CLOSED, QR_REVOKED, QR_ACTIVE_EXISTS,
 * QR_NOT_FOUND, STATE_CONFLICT, IDEMPOTENCY_CONFLICT, VALIDATION_ERROR.
 * Never expose internal database ids, account email, phone, token secrets
 * or raw token material in any response.
 */

export type MemberQrStatus = 'ACTIVE' | 'ROTATED' | 'REVOKED';

/**
 * Public QR state returned to the owner. Contains only non-sensitive
 * claims: the QR public id, status, issuance/expiry timestamps and the
 * signed short-lived display token (L-06 signed rotating token). The
 * token payload carries only public_qr_id + issued/expiry + nonce.
 */
export interface MemberQrState {
  public_qr_id: string;
  status: 'ACTIVE';
  issued_at: string;
  expires_at: string;
  display_token: string;
}

/**
 * MemberQrResponse (§4.4). `qr` is null when the member exists but has no
 * QR identity row yet (documented GET behavior choice - see the L-06
 * delivery note): the client then issues one via POST.
 */
export interface MemberQrResponse {
  qr: MemberQrState | null;
}

export type MemberQrErrorCode =
  | 'MEMBER_NOT_FOUND'
  | 'MEMBER_CLOSED'
  | 'QR_REVOKED'
  | 'QR_ACTIVE_EXISTS'
  | 'QR_NOT_FOUND'
  | 'STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VALIDATION_ERROR';

export class MemberQrError extends Error {
  readonly code: MemberQrErrorCode;

  constructor(code: MemberQrErrorCode, message: string) {
    super(message);
    this.name = 'MemberQrError';
    this.code = code;
  }
}

export function memberNotFoundError(): MemberQrError {
  return new MemberQrError(
    'MEMBER_NOT_FOUND',
    'The member account was not found.',
  );
}

export function memberClosedError(): MemberQrError {
  return new MemberQrError('MEMBER_CLOSED', 'The member account is closed.');
}

export function qrRevokedError(): MemberQrError {
  return new MemberQrError('QR_REVOKED', 'The member QR identity is revoked.');
}

export function qrActiveExistsError(): MemberQrError {
  return new MemberQrError(
    'QR_ACTIVE_EXISTS',
    'An active member QR identity already exists.',
  );
}

export function qrNotFoundError(): MemberQrError {
  return new MemberQrError(
    'QR_NOT_FOUND',
    'The member has no QR identity to revoke.',
  );
}

export function qrStateConflictError(): MemberQrError {
  return new MemberQrError(
    'STATE_CONFLICT',
    'The member QR identity is in an inconsistent state.',
  );
}

export function qrIdempotencyConflictError(): MemberQrError {
  return new MemberQrError(
    'IDEMPOTENCY_CONFLICT',
    'The idempotency key was reused with a different request.',
  );
}

export function qrIdempotencyKeyRequiredError(): MemberQrError {
  return new MemberQrError(
    'VALIDATION_ERROR',
    'A valid Idempotency-Key header is required for this operation.',
  );
}

/**
 * Request context carried from the HTTP layer for audit recording.
 * Only non-sensitive metadata (request id, client ip) - never tokens.
 */
export interface MemberQrRequestMetadata {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}
