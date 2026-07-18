export type AdminKycErrorCode =
  | 'ADMIN_KYC_CASE_NOT_FOUND'
  | 'ADMIN_KYC_INVALID_STATE'
  | 'ADMIN_KYC_INVALID_TRANSITION'
  | 'ADMIN_KYC_SELF_REVIEW'
  | 'ADMIN_KYC_MARKET_ACCESS_DENIED'
  | 'ADMIN_KYC_IDEMPOTENCY_CONFLICT';

export class AdminKycError extends Error {
  constructor(
    readonly code: AdminKycErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminKycError';
  }
}

export function adminKycCaseNotFoundError(): AdminKycError {
  return new AdminKycError(
    'ADMIN_KYC_CASE_NOT_FOUND',
    'The KYC case was not found.',
  );
}

export function adminKycInvalidStateError(
  currentStatus?: string,
  expectedStatus?: string,
): AdminKycError {
  return new AdminKycError(
    'ADMIN_KYC_INVALID_STATE',
    'The KYC case is not in a valid state for this action.',
    currentStatus ? { currentStatus, expectedStatus } : undefined,
  );
}

export function adminKycInvalidTransitionError(
  fromStatus?: string,
  toStatus?: string,
): AdminKycError {
  return new AdminKycError(
    'ADMIN_KYC_INVALID_TRANSITION',
    'The KYC state transition could not be completed.',
    fromStatus ? { fromStatus, toStatus } : undefined,
  );
}

export function adminKycSelfReviewError(): AdminKycError {
  return new AdminKycError(
    'ADMIN_KYC_SELF_REVIEW',
    'Administrators cannot review their own member KYC case.',
  );
}

export function adminKycNoMarketAccessError(): AdminKycError {
  return new AdminKycError(
    'ADMIN_KYC_MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

export function adminKycIdempotencyConflictError(): AdminKycError {
  return new AdminKycError(
    'ADMIN_KYC_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}
