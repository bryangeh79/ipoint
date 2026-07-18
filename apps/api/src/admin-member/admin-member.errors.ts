import { AdminMemberError } from './admin-member.types.js';

export function memberNotFoundError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_NOT_FOUND',
    'The member was not found.',
  );
}

export function memberInvalidStatusError(
  currentStatus?: string,
  expectedStatus?: string,
): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_INVALID_STATUS',
    'The member is not in a valid status for this action.',
    currentStatus ? { currentStatus, expectedStatus } : undefined,
  );
}

export function memberStatusTransitionError(
  fromStatus?: string,
  toStatus?: string,
): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_STATUS_TRANSITION_FAILED',
    'The member status transition could not be completed.',
    fromStatus ? { fromStatus, toStatus } : undefined,
  );
}

export function memberCloseConfirmationRequiredError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_CLOSE_CONFIRMATION_REQUIRED',
    'Closing a member requires confirmationText to equal CONFIRM.',
  );
}

export function memberAlreadyClosedError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_ALREADY_CLOSED',
    'The member is already closed.',
  );
}

export function adminNoteTooLongError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_NOTE_TOO_LONG',
    'The admin note must not exceed 5000 characters.',
  );
}

export function adminNoteEmptyError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_NOTE_EMPTY',
    'The admin note must not be empty.',
  );
}

export function kycReverificationNotAllowedError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_KYC_REVERIFICATION_NOT_ALLOWED',
    'KYC reverification is not allowed for the member in its current state.',
  );
}

export function memberMarketAccessDeniedError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_MARKET_ACCESS_DENIED',
    'The administrator does not have access to this member market.',
  );
}

export function memberIdempotencyConflictError(): AdminMemberError {
  return new AdminMemberError(
    'ADMIN_MEMBER_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}
