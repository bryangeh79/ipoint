import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export const transactionErrorCodes = {
  idempotencyRequired: 'TRANSACTION_IDEMPOTENCY_KEY_REQUIRED',
  confirmIdempotencyRequired: 'TRANSACTION_CONFIRM_IDEMPOTENCY_KEY_REQUIRED',
  idempotencyMismatch: 'TRANSACTION_IDEMPOTENCY_MISMATCH',
  merchantAccessDenied: 'TRANSACTION_MERCHANT_ACCESS_DENIED',
  merchantContextAmbiguous: 'TRANSACTION_MERCHANT_CONTEXT_AMBIGUOUS',
  merchantInactive: 'TRANSACTION_MERCHANT_INACTIVE',
  marketMismatch: 'TRANSACTION_MARKET_MISMATCH',
  settingsMissing: 'TRANSACTION_MARKET_SETTINGS_MISSING',
  amountInvalid: 'TRANSACTION_AMOUNT_INVALID',
  amountScaleInvalid: 'TRANSACTION_AMOUNT_SCALE_INVALID',
  amountBelowMinimum: 'TRANSACTION_AMOUNT_BELOW_MINIMUM',
  amountAboveMaximum: 'TRANSACTION_AMOUNT_ABOVE_MAXIMUM',
  qrInvalid: 'TRANSACTION_MEMBER_QR_INVALID',
  qrExpired: 'TRANSACTION_MEMBER_QR_EXPIRED',
  memberInactive: 'TRANSACTION_MEMBER_INACTIVE',
  packageSelectionRequired: 'TRANSACTION_PACKAGE_SELECTION_REQUIRED',
  packageInvalid: 'TRANSACTION_PACKAGE_INVALID',
  packageMissing: 'TRANSACTION_PACKAGE_MISSING',
  mcpAccountMissing: 'TRANSACTION_MCP_ACCOUNT_MISSING',
  insufficientMcp: 'TRANSACTION_INSUFFICIENT_MCP',
  rewardRuleMissing: 'TRANSACTION_REWARD_RULE_MISSING',
  rewardRuleInvalid: 'TRANSACTION_REWARD_RULE_INVALID',
  previewCreationFailed: 'TRANSACTION_PREVIEW_CREATION_FAILED',
  previewNotFound: 'TRANSACTION_PREVIEW_NOT_FOUND',
  previewExpired: 'TRANSACTION_PREVIEW_EXPIRED',
  previewAlreadyConfirmed: 'TRANSACTION_PREVIEW_ALREADY_CONFIRMED',
  previewInvalidState: 'TRANSACTION_PREVIEW_INVALID_STATE',
  confirmationFailed: 'TRANSACTION_CONFIRMATION_FAILED',
  listFilterInvalid: 'TRANSACTION_LIST_FILTER_INVALID',
  listCursorInvalid: 'TRANSACTION_LIST_CURSOR_INVALID',
  receiptNotFound: 'TRANSACTION_RECEIPT_NOT_FOUND',
  receiptAccessDenied: 'TRANSACTION_RECEIPT_ACCESS_DENIED',
  reversalNotAllowed: 'TRANSACTION_REVERSAL_NOT_ALLOWED',
  refundNotAllowed: 'TRANSACTION_REFUND_NOT_ALLOWED',
  reversalAlreadyRequested: 'TRANSACTION_REVERSAL_ALREADY_REQUESTED',
  refundAlreadyRequested: 'TRANSACTION_REFUND_ALREADY_REQUESTED',
  correctionConflict: 'TRANSACTION_CORRECTION_CONFLICT',
  correctionReasonInvalid: 'TRANSACTION_CORRECTION_REASON_INVALID',
  correctionAccessDenied: 'TRANSACTION_CORRECTION_ACCESS_DENIED',
  correctionNotFound: 'TRANSACTION_CORRECTION_NOT_FOUND',
  correctionExecutionFailed: 'TRANSACTION_CORRECTION_EXECUTION_FAILED',
} as const;

export function transactionBadRequest(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

export function transactionForbidden(code: string, message: string): never {
  throw new ForbiddenException({ code, message });
}

export function transactionNotFound(code: string, message: string): never {
  throw new NotFoundException({ code, message });
}

export function transactionConflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}
