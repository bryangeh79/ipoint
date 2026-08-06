import { AdminCommissionOpsError } from './admin-commission-ops.types.js';

/**
 * P7-S6D Admin Commission Rate Configuration adapter error factories
 * (D-054 §16 / D-055 §8).
 *
 * The external codes mirror the pre-existing canonical commission-rate
 * surface (the D-054 owner contract): frozen Phase 5 validation codes are
 * preserved verbatim (`INVALID_COMMISSION_TYPE`, `INVALID_GENERATION`,
 * `INVALID_RATE_TYPE`, `RATE_TYPE_MISMATCH`, `INVALID_MARKET`,
 * `INVALID_RATE_VALUE`, `INVALID_EFFECTIVE_RANGE`, `INVALID_TIMESTAMP`,
 * `OVERLAPPING_RATE_PERIOD`) and the D-054 owner controls surface with
 * their `COMMISSION_RATE_*` codes. The only adapter-native code is
 * `COMMISSION_MARKET_NOT_FOUND` (read/create market lookup, 404).
 *
 * Every owner `RateManagementError` is mapped code-for-code (no error is
 * swallowed into a 2xx); unknown owner codes propagate and surface as 500
 * through the controller.
 */

/** The market does not exist (adapter read/create lookup). */
export function commissionMarketNotFoundError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_MARKET_NOT_FOUND',
    'The market was not found.',
  );
}

/** The market is not ACTIVE / the owner resolved no active market row. */
export function commissionRateMarketNotFoundError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_MARKET_NOT_FOUND',
    'The selected market was not found or is not active.',
  );
}

/** The authenticated admin lacks the commission.rate.manage permission. */
export function commissionRatePermissionDeniedError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_PERMISSION_DENIED',
    'You do not have permission to manage commission rates.',
  );
}

/** The admin has no active grant for the selected market. */
export function commissionRateMarketAccessDeniedError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

/** The actor has no server-owned Current Admin Market selected. */
export function commissionRateMarketSelectionRequiredError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

/** The resource market disagrees with the server Current Admin Market. */
export function commissionRateMarketContextMismatchError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

/** A valid Idempotency-Key is mandatory for every write. */
export function commissionRateIdempotencyKeyRequiredError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

/** The Idempotency-Key was already used with a different payload. */
export function commissionRateIdempotencyConflictError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

/** A reason between 1 and 500 characters is mandatory. */
export function commissionRateReasonRequiredError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_REASON_REQUIRED',
    'A reason between 1 and 500 characters is required.',
  );
}

/** More than the technical ceiling of ten decimals were supplied. */
export function commissionRatePrecisionExceededError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_PRECISION_EXCEEDED',
    'The rate must be a non-negative decimal with at most 10 decimals.',
  );
}

/** A percentage rate cannot exceed 100%. */
export function commissionRatePercentageLimitError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_PERCENTAGE_LIMIT',
    'A percentage rate cannot exceed 100%.',
  );
}

/** Activation must be at a strictly future market-local 00:00. */
export function commissionRateActivationNotFutureError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
    'Activation must be at a strictly future market-local 00:00 in the selected market timezone.',
  );
}

/** The supplied timezone does not match the selected market timezone. */
export function commissionRateTimezoneMismatchError(): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'COMMISSION_RATE_TIMEZONE_MISMATCH',
    'The supplied timezone does not match the selected market timezone.',
  );
}

/** Invalid commission type (frozen Phase 5 code, preserved verbatim). */
export function invalidCommissionTypeError(
  commissionType: string,
  validTypes: readonly string[],
): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'INVALID_COMMISSION_TYPE',
    `Invalid commission type: ${commissionType}. Valid values: ${validTypes.join(', ')}`,
    { commissionType, validTypes },
  );
}

/** Invalid generation for the commission type (frozen Phase 5 code). */
export function invalidGenerationError(
  commissionType: string,
  generation: number,
  allowedGenerations: readonly number[],
): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'INVALID_GENERATION',
    `Invalid generation ${generation} for commission type ${commissionType}. Allowed: ${allowedGenerations.join(', ')}`,
    { commissionType, generation, allowedGenerations },
  );
}

/** Invalid rate type (frozen Phase 5 code). */
export function invalidRateTypeError(
  rateType: string,
  validTypes: readonly string[],
): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'INVALID_RATE_TYPE',
    `Invalid rate type: ${rateType}. Valid values: ${validTypes.join(', ')}`,
    { rateType, validTypes },
  );
}

/** Rate type mismatch for the commission type (frozen Phase 5 code). */
export function rateTypeMismatchError(
  commissionType: string,
  providedRateType: string,
  expectedRateType: string,
): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'RATE_TYPE_MISMATCH',
    `Commission type ${commissionType} requires rate_type = ${expectedRateType}, but ${providedRateType} was provided`,
    { commissionType, providedRateType, expectedRateType },
  );
}

/** Invalid market code (frozen Phase 5 code). */
export function invalidMarketError(market: string): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'INVALID_MARKET',
    `Invalid market code: ${market}. Market code must be a 2-letter uppercase code (e.g., 'MY', 'SG')`,
    { market },
  );
}

/** Invalid rate value (frozen Phase 5 code). */
export function invalidRateValueError(
  rateValue: string,
  detail?: string,
): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'INVALID_RATE_VALUE',
    detail ?? `Invalid rate value: ${rateValue}`,
    { rateValue },
  );
}

/** Invalid effective range (frozen Phase 5 code). */
export function invalidEffectiveRangeError(
  effectiveFrom: string,
  effectiveUntil: string,
): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'INVALID_EFFECTIVE_RANGE',
    `effective_until must be after effective_from, or null for open-ended`,
    { effectiveFrom, effectiveUntil },
  );
}

/** Invalid timestamp (frozen Phase 5 code). */
export function invalidTimestampError(value: string): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'INVALID_TIMESTAMP',
    `Invalid timestamp: ${value}`,
    { value },
  );
}

/** The new version would overlap an existing effective window. */
export function overlappingRatePeriodError(
  commissionType: string,
  generation: number,
  market: string,
  effectiveFrom: string,
  effectiveUntil: string | null,
): AdminCommissionOpsError {
  return new AdminCommissionOpsError(
    'OVERLAPPING_RATE_PERIOD',
    `An active rate version already exists for ${commissionType} generation ${generation} in market ${market} that overlaps with the period [${effectiveFrom}, ${effectiveUntil ?? '∞'})`,
    { commissionType, generation, market, effectiveFrom, effectiveUntil },
  );
}
