import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Redemption Center Error codes and error class.
 */
export type RedemptionErrorCode = string;

/**
 * Custom error class for redemption domain errors.
 */
export class RedemptionError extends Error {
  public readonly code: RedemptionErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: RedemptionErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RedemptionError';
    this.code = code;
    this.details = details;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Error Codes
// ═════════════════════════════════════════════════════════════════════════

export const redemptionErrorCodes = {
  // Fulfilment
  fulfilmentNotFound: 'REDEMPTION_FULFILMENT_NOT_FOUND',
  fulfilmentOrderNotFound: 'REDEMPTION_FULFILMENT_ORDER_NOT_FOUND',
  fulfilmentInvalidTransition: 'REDEMPTION_FULFILMENT_INVALID_TRANSITION',
  fulfilmentInvalidType: 'REDEMPTION_FULFILMENT_INVALID_TYPE',
  fulfilmentAlreadyExists: 'REDEMPTION_FULFILMENT_ALREADY_EXISTS',
  fulfilmentMaxRetries: 'REDEMPTION_FULFILMENT_MAX_RETRIES',
  fulfilmentNonRetryable: 'REDEMPTION_FULFILMENT_NON_RETRYABLE',

  // Pickup
  pickupLocationNotFound: 'REDEMPTION_PICKUP_LOCATION_NOT_FOUND',
  pickupCodeGenerationFailed: 'REDEMPTION_PICKUP_CODE_GENERATION_FAILED',
  pickupCodeInvalid: 'REDEMPTION_PICKUP_CODE_INVALID',
  pickupVerificationFailed: 'REDEMPTION_PICKUP_VERIFICATION_FAILED',

  // Digital Voucher
  voucherCodeGenerationFailed: 'REDEMPTION_VOUCHER_CODE_GENERATION_FAILED',
  voucherCodeEncryptionFailed: 'REDEMPTION_VOUCHER_ENCRYPTION_FAILED',
  voucherRevealNotAuthorized: 'REDEMPTION_VOUCHER_REVEAL_NOT_AUTHORIZED',

  // Backorder
  backorderNotAllowed: 'REDEMPTION_BACKORDER_NOT_ALLOWED',
  backorderQuantityExceeded: 'REDEMPTION_BACKORDER_QUANTITY_EXCEEDED',

  // Waitlist
  waitlistNotFound: 'REDEMPTION_WAITLIST_NOT_FOUND',
  waitlistAlreadyExists: 'REDEMPTION_WAITLIST_ALREADY_EXISTS',

  // Suspension
  orderNotSuspended: 'REDEMPTION_ORDER_NOT_SUSPENDED',
  orderCannotSuspend: 'REDEMPTION_ORDER_CANNOT_SUSPEND',

  // Refund
  refundNotFound: 'REDEMPTION_REFUND_NOT_FOUND',
  refundAlreadyProcessed: 'REDEMPTION_REFUND_ALREADY_PROCESSED',
  refundOrderNotRefundable: 'REDEMPTION_ORDER_NOT_REFUNDABLE',
  refundAlreadyApproved: 'REDEMPTION_REFUND_ALREADY_APPROVED',
  refundAlreadyRejected: 'REDEMPTION_REFUND_ALREADY_REJECTED',
  refundMakerCheckerSame: 'REDEMPTION_REFUND_MAKER_CHECKER_SAME',
  refundExecutionFailed: 'REDEMPTION_REFUND_EXECUTION_FAILED',
  refundAlreadyRefunded: 'REDEMPTION_ALREADY_REFUNDED',
  // SEC-02 refund owner (GATE-SEC-02)
  refundPermissionDenied: 'REDEMPTION_REFUND_PERMISSION_DENIED',
  refundReasonRequired: 'REDEMPTION_REFUND_REASON_REQUIRED',
  refundIdempotencyKeyRequired: 'REDEMPTION_REFUND_IDEMPOTENCY_KEY_REQUIRED',
  refundIdempotencyConflict: 'REDEMPTION_REFUND_IDEMPOTENCY_CONFLICT',
  refundPartialRefundNotAllowed: 'REDEMPTION_PARTIAL_REFUND_NOT_ALLOWED',
  refundInvalidAmount: 'REDEMPTION_REFUND_INVALID_AMOUNT',
  refundOrderMismatch: 'REDEMPTION_REFUND_ORDER_MISMATCH',

  // Shipping Payment Recovery
  shippingPaymentNotFound: 'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND',
  shippingPaymentNotRecoverable: 'REDEMPTION_SHIPPING_PAYMENT_NOT_RECOVERABLE',
  shippingPaymentRecoveryFailed: 'REDEMPTION_SHIPPING_PAYMENT_RECOVERY_FAILED',

  // D-053 secured redemption rate owner (CG-03)
  ratePermissionDenied: 'REDEMPTION_RATE_PERMISSION_DENIED',
  rateMarketAccessDenied: 'REDEMPTION_RATE_MARKET_ACCESS_DENIED',
  rateMarketNotFound: 'REDEMPTION_RATE_MARKET_NOT_FOUND',
  rateMarketSelectionRequired: 'REDEMPTION_RATE_MARKET_SELECTION_REQUIRED',
  rateMarketContextMismatch: 'REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH',
  rateIdempotencyKeyRequired: 'REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED',
  rateReasonRequired: 'REDEMPTION_RATE_REASON_REQUIRED',
  rateIdempotencyConflict: 'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
  ratePrecisionExceeded: 'REDEMPTION_RATE_PRECISION_EXCEEDED',
  rateMarketBlocked: 'REDEMPTION_RATE_MARKET_BLOCKED',
  rateBelowMinimum: 'REDEMPTION_RATE_BELOW_MINIMUM',
  rateAboveMaximum: 'REDEMPTION_RATE_ABOVE_MAXIMUM',
  rateCurrencyMismatch: 'REDEMPTION_RATE_CURRENCY_MISMATCH',
  rateActivationNotFuture: 'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
  rateOverlap: 'REDEMPTION_RATE_OVERLAP',
  rateCannotCancelEffective: 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
  rateAlreadyCancelled: 'REDEMPTION_RATE_ALREADY_CANCELLED',
  rateNotFound: 'REDEMPTION_RATE_NOT_FOUND',
} as const;

// ═════════════════════════════════════════════════════════════════════════
// HTTP Exception Helpers
// ═════════════════════════════════════════════════════════════════════════

export function redemptionBadRequest(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

export function redemptionForbidden(code: string, message: string): never {
  throw new ForbiddenException({ code, message });
}

export function redemptionNotFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

export function redemptionConflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

// ═════════════════════════════════════════════════════════════════════════
// D-053 Secured Redemption Rate Owner — error builders
// ═════════════════════════════════════════════════════════════════════════

export function redemptionRatePermissionDeniedError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.ratePermissionDenied,
    'You do not have permission to manage redemption rates.',
  );
}

export function redemptionRateMarketAccessDeniedError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateMarketAccessDenied,
    'The administrator does not have access to this market.',
  );
}

export function redemptionRateMarketNotFoundError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateMarketNotFound,
    'The selected market was not found or is not active.',
  );
}

export function redemptionRateMarketSelectionRequiredError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateMarketSelectionRequired,
    'Select an authorized market to continue.',
  );
}

export function redemptionRateMarketContextMismatchError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateMarketContextMismatch,
    'The selected market changed. Refresh and try again.',
  );
}

export function redemptionRateIdempotencyKeyRequiredError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateIdempotencyKeyRequired,
    'A valid Idempotency-Key header is required.',
  );
}

export function redemptionRateReasonRequiredError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateReasonRequired,
    'A reason between 1 and 500 characters is required.',
  );
}

export function redemptionRateIdempotencyConflictError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateIdempotencyConflict,
    'The idempotency key was already used with a different payload.',
  );
}

export function redemptionRatePrecisionError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.ratePrecisionExceeded,
    'The rate must be a positive decimal with at most 10 decimals.',
  );
}

export function redemptionRateMarketBlockedError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateMarketBlocked,
    'Redemption rates are not configured for this market.',
  );
}

export function redemptionRateBelowMinimumError(
  details?: Record<string, unknown>,
): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateBelowMinimum,
    'The rate is below the approved minimum for this market.',
    details,
  );
}

export function redemptionRateAboveMaximumError(
  details?: Record<string, unknown>,
): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateAboveMaximum,
    'The rate exceeds the approved maximum for this market.',
    details,
  );
}

export function redemptionRateCurrencyMismatchError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateCurrencyMismatch,
    'The fiat currency does not match the approved market configuration.',
  );
}

export function redemptionRateActivationNotFutureError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateActivationNotFuture,
    'Activation must be at a strictly future market-local 00:00.',
  );
}

export function redemptionRateOverlapError(
  details?: Record<string, unknown>,
): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateOverlap,
    'The effective window overlaps an existing rate version for this market and rate type.',
    details,
  );
}

export function redemptionRateCannotCancelEffectiveError(
  details?: Record<string, unknown>,
): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateCannotCancelEffective,
    'Only a scheduled, not-yet-effective rate version can be cancelled.',
    details,
  );
}

export function redemptionRateAlreadyCancelledError(): RedemptionError {
  return new RedemptionError(
    redemptionErrorCodes.rateAlreadyCancelled,
    'This rate version has already been cancelled.',
  );
}
