import { AdminPackageOpsError } from './admin-package-ops.types.js';

/**
 * P7-S6A Admin Package Operations special-percentage create error
 * factories (frozen contract §7.3, D-051).
 *
 * The external codes preserve the D-051 owner contract verbatim
 * (`SPECIAL_PERCENTAGE_*` — see `apps/api/src/merchant/package.errors.ts`);
 * the adapter maps every owner rejection code-for-code (no error is
 * swallowed into a 2xx) and the controller assigns the HTTP status for
 * each code. The only pre-existing adapter-native code is
 * `PACKAGE_OPS_MARKET_MISMATCH` (legacy read-side helper).
 *
 * HTTP mapping (controller): PERMISSION_DENIED + MARKET_ACCESS_DENIED →
 * 403; MARKET_NOT_FOUND → 404; MARKET_SELECTION_REQUIRED +
 * MARKET_CONTEXT_MISMATCH + IDEMPOTENCY_CONFLICT → 409;
 * REASON_REQUIRED + IDEMPOTENCY_KEY_REQUIRED → 400.
 *
 * CREATE_FAILED keeps the owner's existing code but surfaces with 500
 * semantics on this surface: the owner raises it only when the atomic
 * insert returned no row — a genuine server-side failure, not a client
 * contract violation (the canonical Phase 1 route keeps its own 409).
 * Unknown owner codes propagate as-is and surface as 500 through the
 * controller — no error is ever swallowed into a 2xx.
 */

/** The authenticated admin lacks the merchant.special_package.manage permission. */
export function specialPercentagePermissionDeniedError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_PERMISSION_DENIED',
    'You do not have permission to create a special percentage.',
  );
}

/** The actor has no server-owned Current Admin Market selected. */
export function specialPercentageMarketSelectionRequiredError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

/** The resource market disagrees with the server Current Admin Market. */
export function specialPercentageMarketContextMismatchError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

/** The selected market does not exist or is not ACTIVE. */
export function specialPercentageMarketNotFoundError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND',
    'The selected market does not exist or is not active.',
  );
}

/** The admin has no active grant for the selected market. */
export function specialPercentageMarketAccessDeniedError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED',
    'You do not have access to this market.',
  );
}

/** A reason between 1 and 500 characters is mandatory. */
export function specialPercentageReasonRequiredError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_REASON_REQUIRED',
    'A reason of 1 to 500 characters is required for this privileged action.',
  );
}

/** A valid Idempotency-Key is mandatory for every write. */
export function specialPercentageIdempotencyKeyRequiredError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

/** The Idempotency-Key was already used with a different payload. */
export function specialPercentageIdempotencyConflictError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT',
    'The Idempotency-Key cannot be reused for this request.',
  );
}

/** The owner could not persist the special percentage. */
export function specialPercentageCreateFailedError(): AdminPackageOpsError {
  return new AdminPackageOpsError(
    'SPECIAL_PERCENTAGE_CREATE_FAILED',
    'The special percentage could not be created.',
  );
}
