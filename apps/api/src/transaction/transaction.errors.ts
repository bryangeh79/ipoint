import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export const transactionErrorCodes = {
  idempotencyRequired: 'TRANSACTION_IDEMPOTENCY_KEY_REQUIRED',
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
  rewardRuleMissing: 'TRANSACTION_REWARD_RULE_MISSING',
  rewardRuleInvalid: 'TRANSACTION_REWARD_RULE_INVALID',
  previewCreationFailed: 'TRANSACTION_PREVIEW_CREATION_FAILED',
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
