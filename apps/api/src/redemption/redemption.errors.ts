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

  // Shipping Payment Recovery
  shippingPaymentNotFound: 'REDEMPTION_SHIPPING_PAYMENT_NOT_FOUND',
  shippingPaymentNotRecoverable: 'REDEMPTION_SHIPPING_PAYMENT_NOT_RECOVERABLE',
  shippingPaymentRecoveryFailed: 'REDEMPTION_SHIPPING_PAYMENT_RECOVERY_FAILED',
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
