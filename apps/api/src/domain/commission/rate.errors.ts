/**
 * Commission Rate Owner — domain error codes and builders (D-054, CG-04).
 *
 * The legacy Phase 5 validation codes (INVALID_COMMISSION_TYPE,
 * INVALID_GENERATION, INVALID_RATE_TYPE, RATE_TYPE_MISMATCH, INVALID_MARKET,
 * INVALID_RATE_VALUE, INVALID_EFFECTIVE_RANGE, INVALID_TIMESTAMP,
 * RATE_VERSION_NOT_FOUND, OVERLAPPING_RATE_PERIOD) are preserved verbatim —
 * they are the frozen Phase 5 validation surface asserted by the accepted
 * P5-R1 suite. The D-054 owner controls add a COMMISSION_RATE_* family
 * mirroring the accepted D-050/D-053 owner error codes.
 *
 * @packageDocumentation
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Domain error for rate management operations.
 */
export class RateManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RateManagementError';
  }
}

/** Valid commission type values (frozen Phase 5 surface). */
export const VALID_COMMISSION_TYPES = [
  'AGENT_UPGRADE',
  'MEMBER_CONSUMPTION',
  'MERCHANT_RECRUITMENT',
  'AGENT_ACTIVATION_FEE',
];

/** Valid rate type values. */
export const VALID_RATE_TYPES = ['PERCENTAGE', 'FIXED'];

/**
 * Commission types mapped to their permitted generation sets (P5-R1
 * reconciliation 4.4 against the frozen P5-S0 contract):
 * - AGENT_UPGRADE: G1/G2 → 1, 2
 * - MEMBER_CONSUMPTION: G1/G2 → 1, 2
 * - MERCHANT_RECRUITMENT: single generation → 0
 * - AGENT_ACTIVATION_FEE: single generation → 0
 */
export const COMMISSION_GENERATIONS: Record<string, number[]> = {
  AGENT_UPGRADE: [1, 2],
  MEMBER_CONSUMPTION: [1, 2],
  MERCHANT_RECRUITMENT: [0],
  AGENT_ACTIVATION_FEE: [0],
};

/**
 * Supported commission types and their required rate_type per D-25 frozen.
 */
export const COMMISSION_TYPE_RATE_TYPE: Record<string, string> = {
  AGENT_UPGRADE: 'FIXED',
  MEMBER_CONSUMPTION: 'PERCENTAGE',
  MERCHANT_RECRUITMENT: 'PERCENTAGE',
  AGENT_ACTIVATION_FEE: 'FIXED',
};

/* ------------------------------------------------------------------ */
/*  HTTP Exception Helpers                                             */
/* ------------------------------------------------------------------ */

export function commissionRateBadRequest(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

export function commissionRateForbidden(code: string, message: string): never {
  throw new ForbiddenException({ code, message });
}

export function commissionRateNotFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

export function commissionRateConflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

export function commissionRateUnprocessable(
  code: string,
  message: string,
): never {
  throw new UnprocessableEntityException({ code, message });
}

/* ------------------------------------------------------------------ */
/*  Frozen Phase 5 validation error builders (codes preserved)         */
/* ------------------------------------------------------------------ */

/** Factory: invalid commission type. */
export function invalidCommissionTypeError(
  commissionType: string,
): RateManagementError {
  return new RateManagementError(
    'INVALID_COMMISSION_TYPE',
    `Invalid commission type: ${commissionType}. Valid values: ${VALID_COMMISSION_TYPES.join(', ')}`,
    { commissionType, validTypes: VALID_COMMISSION_TYPES },
  );
}

/** Factory: invalid generation for commission type. */
export function invalidGenerationError(
  commissionType: string,
  generation: number,
): RateManagementError {
  const allowedGenerations = COMMISSION_GENERATIONS[commissionType] ?? [];
  return new RateManagementError(
    'INVALID_GENERATION',
    `Invalid generation ${generation} for commission type ${commissionType}. Allowed: ${allowedGenerations.join(', ')}`,
    { commissionType, generation, allowedGenerations },
  );
}

/** Factory: invalid rate type. */
export function invalidRateTypeError(rateType: string): RateManagementError {
  return new RateManagementError(
    'INVALID_RATE_TYPE',
    `Invalid rate type: ${rateType}. Valid values: ${VALID_RATE_TYPES.join(', ')}`,
    { rateType, validTypes: VALID_RATE_TYPES },
  );
}

/** Factory: rate type mismatch for commission type. */
export function rateTypeMismatchError(
  commissionType: string,
  providedRateType: string,
  expectedRateType: string,
): RateManagementError {
  return new RateManagementError(
    'RATE_TYPE_MISMATCH',
    `Commission type ${commissionType} requires rate_type = ${expectedRateType}, but ${providedRateType} was provided`,
    { commissionType, providedRateType, expectedRateType },
  );
}

/** Factory: invalid effective range (effective_until <= effective_from). */
export function invalidEffectiveRangeError(
  effectiveFrom: string,
  effectiveUntil: string,
): RateManagementError {
  return new RateManagementError(
    'INVALID_EFFECTIVE_RANGE',
    `effective_until must be after effective_from, or null for open-ended`,
    { effectiveFrom, effectiveUntil },
  );
}

/** Factory: overlapping rate period detected. */
export function overlappingRatePeriodError(
  commissionType: string,
  generation: number,
  market: string,
  effectiveFrom: string,
  effectiveUntil: string | null,
  details?: Record<string, unknown>,
): RateManagementError {
  return new RateManagementError(
    'OVERLAPPING_RATE_PERIOD',
    `An active rate version already exists for ${commissionType} generation ${generation} in market ${market} that overlaps with the period [${effectiveFrom}, ${effectiveUntil ?? '∞'})`,
    {
      commissionType,
      generation,
      market,
      effectiveFrom,
      effectiveUntil,
      ...details,
    },
  );
}

/** Factory: rate version not found. */
export function rateVersionNotFoundError(id: string): RateManagementError {
  return new RateManagementError(
    'RATE_VERSION_NOT_FOUND',
    `Rate version not found: ${id}`,
    { id },
  );
}

/** Factory: invalid market code. */
export function invalidMarketError(market: string): RateManagementError {
  return new RateManagementError(
    'INVALID_MARKET',
    `Invalid market code: ${market}. Market code must be a 2-letter uppercase code (e.g., 'MY', 'SG')`,
    { market },
  );
}

/** Factory: invalid rate value. */
export function invalidRateValueError(
  rateValue: string,
  detail?: string,
): RateManagementError {
  return new RateManagementError(
    'INVALID_RATE_VALUE',
    detail ?? `Invalid rate value: ${rateValue}`,
    { rateValue },
  );
}

/* ------------------------------------------------------------------ */
/*  D-054 owner error builders (COMMISSION_RATE_* family)              */
/* ------------------------------------------------------------------ */

export function commissionRatePermissionDeniedError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_PERMISSION_DENIED',
    'You do not have permission to manage commission rates.',
  );
}

export function commissionRateMarketAccessDeniedError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

export function commissionRateMarketNotFoundError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_MARKET_NOT_FOUND',
    'The selected market was not found or is not active.',
  );
}

export function commissionRateMarketSelectionRequiredError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

export function commissionRateMarketContextMismatchError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

export function commissionRateIdempotencyKeyRequiredError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

export function commissionRateReasonRequiredError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_REASON_REQUIRED',
    'A reason between 1 and 500 characters is required.',
  );
}

export function commissionRateIdempotencyConflictError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

export function commissionRatePrecisionError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_PRECISION_EXCEEDED',
    'The rate must be a non-negative decimal with at most 10 decimals.',
  );
}

export function commissionRatePercentageLimitError(
  details?: Record<string, unknown>,
): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_PERCENTAGE_LIMIT',
    'A percentage rate cannot exceed 100%.',
    details,
  );
}

export function commissionRateActivationNotFutureError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
    'Activation must be at a strictly future market-local 00:00 in the selected market timezone.',
  );
}

export function commissionRateTimezoneMismatchError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_TIMEZONE_MISMATCH',
    'The supplied timezone does not match the selected market timezone.',
  );
}

export function commissionRateCreateFailedError(): RateManagementError {
  return new RateManagementError(
    'COMMISSION_RATE_CREATE_FAILED',
    'Failed to create commission rate version',
  );
}
