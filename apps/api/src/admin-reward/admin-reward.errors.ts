import { AdminRewardError } from './admin-reward.types.js';

export function adminRewardRuleVersionNotFoundError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_RULE_VERSION_NOT_FOUND',
    'The reward rule version was not found.',
  );
}

export function adminRewardRuleVersionArchivedError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_RULE_VERSION_ARCHIVED',
    'The reward rule version has been archived.',
  );
}

export function adminRewardJobNotFoundError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_JOB_NOT_FOUND',
    'The reward job run was not found.',
  );
}

export function adminRewardMarketAccessDeniedError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

export function adminRewardIdempotencyConflictError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}

// ─── D-052/D-050 secured owner command errors ───────────────────────

export function adminRewardPermissionDeniedError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_PERMISSION_DENIED',
    'You do not have permission to schedule reward rule versions.',
  );
}

export function adminRewardMarketNotFoundError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_MARKET_NOT_FOUND',
    'The selected market was not found or is not active.',
  );
}

export function adminRewardMarketSelectionRequiredError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

export function adminRewardMarketContextMismatchError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

export function adminRewardIdempotencyKeyRequiredError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

export function adminRewardReasonRequiredError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_REASON_REQUIRED',
    'A reason between 1 and 500 characters is required.',
  );
}

export function adminRewardRatePrecisionError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_RATE_PRECISION_EXCEEDED',
    'The reward rate must be a non-negative decimal with at most 6 decimals.',
  );
}

export function adminRewardRateExceedsGovernanceLimitError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
    'The reward rate exceeds the 0.05%/day governance limit.',
  );
}

export function adminRewardActivationNotFutureError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_ACTIVATION_NOT_FUTURE',
    'Activation must be at a strictly future market-local 00:00.',
  );
}

export function adminRewardEffectiveWindowOverlapError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP',
    'The effective window overlaps an existing reward rule version for this market.',
  );
}
