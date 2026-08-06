import { MarketOwnerError } from './market-owner.types.js';

/**
 * P7-S6E secured market owner — error factories.
 *
 * Every `MarketOwnerErrorCode` in `market-owner.types.ts` has exactly one
 * factory here; the controller maps each code to its HTTP status (403 /
 * 404 / 409 / 400 / 500 — see the type doc). The owner never swallows an
 * error into a 2xx: unexpected failures propagate as 500.
 */

/** The actor is not an eligible Super Admin with market.manage. */
export function marketPermissionDeniedError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_PERMISSION_DENIED',
    'You do not have permission to manage the market.',
  );
}

/** The admin has no active (non-revoked) grant for an ACTIVE market. */
export function marketAccessDeniedError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

/** The actor has no server-owned Current Admin Market selected. */
export function marketSelectionRequiredError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

/** The command market disagrees with the server Current Admin Market. */
export function marketContextMismatchError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

/** The market row does not exist. */
export function marketNotFoundError(): MarketOwnerError {
  return new MarketOwnerError('MARKET_NOT_FOUND', 'The market was not found.');
}

/** A reason between 1 and 500 characters is mandatory. */
export function marketReasonRequiredError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_REASON_REQUIRED',
    'A reason between 1 and 500 characters is required.',
  );
}

/** A valid Idempotency-Key is mandatory for every update. */
export function marketIdempotencyKeyRequiredError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

/** The Idempotency-Key was already used with a different payload. */
export function marketIdempotencyConflictError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

/** No controlled field actually changed. */
export function marketNoChangesError(): MarketOwnerError {
  return new MarketOwnerError('MARKET_NO_CHANGES', 'No market fields changed.');
}

/** One or more controlled fields failed format validation. */
export function marketInvalidFieldError(
  details: Record<string, unknown>,
): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_INVALID_FIELD',
    'One or more market fields are invalid.',
    details,
  );
}

/** ACTIVE → INACTIVE requires the explicit deactivation confirmation. */
export function marketDeactivationConfirmationRequiredError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED',
    'Explicit deactivation confirmation is required.',
  );
}

/** The market still has active dependent resources (merchants, members, configuration). */
export function marketDeactivationDependencyError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_DEACTIVATION_DEPENDENCY',
    'The market cannot be deactivated while active resources depend on it.',
  );
}

/** The market row update failed (unexpected persistence error). */
export function marketUpdateFailedError(): MarketOwnerError {
  return new MarketOwnerError(
    'MARKET_UPDATE_FAILED',
    'The market update failed. Try again.',
  );
}
