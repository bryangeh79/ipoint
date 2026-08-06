import { WalletAdjustmentOwnerError } from './wallet-adjustment.owner.types.js';

export function walletAdjustmentPermissionDeniedError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_PERMISSION_DENIED',
    'You do not have permission to perform this iPoint adjustment action.',
  );
}

export function walletAdjustmentMarketSelectionRequiredError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

export function walletAdjustmentMarketContextMismatchError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

export function walletAdjustmentMarketAccessDeniedError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

export function walletAdjustmentWalletNotFoundError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_WALLET_NOT_FOUND',
    'The wallet was not found or is archived.',
  );
}

export function walletAdjustmentMarketNotConfiguredError(
  marketCode: string,
): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_MARKET_NOT_CONFIGURED',
    `Manual iPoint adjustments are not configured for market ${marketCode}. There is no fallback configuration.`,
    { marketCode },
  );
}

export function walletAdjustmentAboveHardCapError(
  amount: string,
  hardCap: string,
): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_ABOVE_HARD_CAP',
    `The adjustment amount ${amount} exceeds the hard cap of ${hardCap} for this market.`,
    { amount, hardCap },
  );
}

export function walletAdjustmentReasonCodeInvalidError(
  code: string,
): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_REASON_CODE_INVALID',
    `The reason code "${code}" is not active in this market.`,
    { code },
  );
}

export function walletAdjustmentAttachmentRequiredError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_ATTACHMENT_REQUIRED',
    'An opaque attachment reference is required for this adjustment (above soft cap, high-risk reason code, or checker request).',
  );
}

export function walletAdjustmentEvidenceStorageUnavailableError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
    'Execution above the soft cap remains disabled until secure evidence storage is approved and enabled for this market.',
  );
}

export function walletAdjustmentIdempotencyKeyRequiredError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

export function walletAdjustmentIdempotencyConflictError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

export function walletAdjustmentRequestNotFoundError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_REQUEST_NOT_FOUND',
    'The adjustment request was not found.',
  );
}

export function walletAdjustmentStateConflictError(
  state: string,
): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_STATE_CONFLICT',
    `The adjustment request cannot transition from state ${state}.`,
    { state },
  );
}

export function walletAdjustmentMakerRequiredError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_MAKER_REQUIRED',
    'Only the request maker can perform this action.',
  );
}

export function walletAdjustmentMakerCheckerConflictError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
    'The checker must be a different administrator than the maker, at every amount, including Super Admin.',
  );
}

export function walletAdjustmentCheckerRoutingDeniedError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_CHECKER_ROUTING_DENIED',
    'This amount is above the soft cap and requires a Super Admin checker.',
  );
}

export function walletAdjustmentInvalidAmountError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_INVALID_AMOUNT',
    'The adjustment amount must be a positive exact decimal with at most 10 decimal places.',
  );
}

export function walletAdjustmentInsufficientBalanceError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_INSUFFICIENT_BALANCE',
    'The debit amount exceeds the wallet available balance.',
  );
}

export function walletAdjustmentPriorRequestInvalidError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_PRIOR_REQUEST_INVALID',
    'The prior request reference must be an existing REJECTED adjustment for the same wallet and market.',
  );
}

export function walletAdjustmentDecisionReasonRequiredError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_DECISION_REASON_REQUIRED',
    'A decision reason between 1 and 2000 characters is required.',
  );
}

export function walletAdjustmentExecutionFailedError(): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_EXECUTION_FAILED',
    'The adjustment execution failed and the request was marked FAILED.',
  );
}

export function walletAdjustmentInvalidFieldError(
  field: string,
): WalletAdjustmentOwnerError {
  return new WalletAdjustmentOwnerError(
    'WALLET_ADJUSTMENT_INVALID_FIELD',
    `The ${field} value is invalid.`,
    { field },
  );
}
