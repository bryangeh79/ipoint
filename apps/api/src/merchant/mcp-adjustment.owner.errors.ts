import { McpAdjustmentOwnerError } from './mcp-adjustment.owner.types.js';

export function mcpAdjustmentPermissionDeniedError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_PERMISSION_DENIED',
    'You do not have permission to perform this MCP adjustment action.',
  );
}

export function mcpAdjustmentMarketSelectionRequiredError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

export function mcpAdjustmentMarketContextMismatchError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

export function mcpAdjustmentMarketAccessDeniedError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

export function mcpAdjustmentAccountNotFoundError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_ACCOUNT_NOT_FOUND',
    'The MCP account was not found or is closed.',
  );
}

export function mcpAdjustmentMarketNotConfiguredError(
  marketCode: string,
): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_MARKET_NOT_CONFIGURED',
    `Manual MCP adjustments are not configured for market ${marketCode}. There is no fallback configuration.`,
    { marketCode },
  );
}

export function mcpAdjustmentAboveHardCapError(
  amount: string,
  hardCap: string,
): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_ABOVE_HARD_CAP',
    `The adjustment amount ${amount} exceeds the hard cap of ${hardCap} for this market.`,
    { amount, hardCap },
  );
}

export function mcpAdjustmentReasonCodeInvalidError(
  code: string,
): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_REASON_CODE_INVALID',
    `The reason code "${code}" is not active in this market.`,
    { code },
  );
}

export function mcpAdjustmentAttachmentRequiredError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED',
    'An opaque attachment reference is required for this adjustment (above soft cap, high-risk reason code, or checker request).',
  );
}

export function mcpAdjustmentEvidenceStorageUnavailableError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
    'Execution above the soft cap remains disabled until secure evidence storage is approved and enabled for this market.',
  );
}

export function mcpAdjustmentIdempotencyKeyRequiredError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

export function mcpAdjustmentIdempotencyConflictError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

export function mcpAdjustmentRequestNotFoundError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_REQUEST_NOT_FOUND',
    'The adjustment request was not found.',
  );
}

export function mcpAdjustmentStateConflictError(
  state: string,
): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_STATE_CONFLICT',
    `The adjustment request cannot transition from state ${state}.`,
    { state },
  );
}

export function mcpAdjustmentMakerRequiredError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_MAKER_REQUIRED',
    'Only the request maker can perform this action.',
  );
}

export function mcpAdjustmentMakerCheckerConflictError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
    'The checker must be a different administrator than the maker, at every amount, including Super Admin.',
  );
}

export function mcpAdjustmentCheckerRoutingDeniedError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_CHECKER_ROUTING_DENIED',
    'This amount is above the soft cap and requires a Super Admin checker.',
  );
}

export function mcpAdjustmentInvalidAmountError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_INVALID_AMOUNT',
    'The adjustment amount must be a positive exact decimal with at most 10 decimal places.',
  );
}

export function mcpAdjustmentInsufficientBalanceError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_INSUFFICIENT_BALANCE',
    'The debit amount exceeds the MCP account available balance.',
  );
}

export function mcpAdjustmentPriorRequestInvalidError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_PRIOR_REQUEST_INVALID',
    'The prior request reference must be an existing REJECTED adjustment for the same account and market.',
  );
}

export function mcpAdjustmentDecisionReasonRequiredError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_DECISION_REASON_REQUIRED',
    'A decision reason between 1 and 2000 characters is required.',
  );
}

export function mcpAdjustmentExecutionFailedError(): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_EXECUTION_FAILED',
    'The adjustment execution failed and the request was marked FAILED.',
  );
}

export function mcpAdjustmentInvalidFieldError(
  field: string,
): McpAdjustmentOwnerError {
  return new McpAdjustmentOwnerError(
    'MCP_ADJUSTMENT_INVALID_FIELD',
    `The ${field} value is invalid.`,
    { field },
  );
}
