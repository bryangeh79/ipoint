import {
  AdminRewardOpsError,
  REWARD_RATE_GOVERNANCE_MAX,
} from './admin-reward-ops.types.js';

/** The market does not exist or is not active. */
export function rewardMarketNotFoundError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_MARKET_NOT_FOUND',
    'The market was not found.',
  );
}

/** The rate is outside the §7.1 `0%`–`0.05%/day` governance range. */
export function rewardRateOutOfRangeError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_RATE_OUT_OF_RANGE',
    'The reward rate must be between 0% and 0.05% per day.',
    { unit: '%/day', min: '0', max: REWARD_RATE_GOVERNANCE_MAX },
  );
}

/** More than the §7.1 maximum six input decimals were supplied. */
export function rewardRatePrecisionExceededError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_RATE_PRECISION_EXCEEDED',
    'The reward rate supports at most 6 decimal places.',
    { maxDecimals: 6 },
  );
}

/** The rate exceeds the §7.1 governance ceiling (requires new governance). */
export function rewardRateExceedsGovernanceLimitError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
    'A reward rate above 0.05% per day requires a new Bryan and Command Center governance decision.',
    { unit: '%/day', max: '0.05' },
  );
}

/** The rate exceeds the §7.1 maximum for the referenced package (A–F). */
export function rewardRateExceedsPackageMaxError(
  packageReference: string,
  maxRatePerDay: string,
): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_RATE_EXCEEDS_PACKAGE_MAX',
    `The reward rate exceeds the ${packageReference} package maximum of ${maxRatePerDay}% per day.`,
    { packageReference, maxRatePerDay, unit: '%/day' },
  );
}

/** Activation must be at a strictly future market-local 00:00. */
export function rewardActivationNotFutureError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_ACTIVATION_NOT_FUTURE',
    'Reward rates activate only at a future market-local 00:00. Same-day or backdated activation is not allowed.',
  );
}

/** The new version would overlap the effective window of an existing version. */
export function rewardEffectiveWindowOverlapError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_EFFECTIVE_WINDOW_OVERLAP',
    'The effective window overlaps another reward rule version for this market.',
  );
}

/** The Idempotency-Key was already used with a different payload. */
export function rewardIdempotencyConflictError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_IDEMPOTENCY_CONFLICT',
    'The Idempotency-Key was already used with a different payload.',
  );
}

/** The rule version does not exist. */
export function rewardRuleVersionNotFoundError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REWARD_RULE_VERSION_NOT_FOUND',
    'The reward rule version was not found.',
  );
}

// ─── Canonical owner-sourced surface errors (D-050 rewiring, order §8) ─
// The secured owner command re-validates identity, permission, selected
// market, resource-market consistency, reason and idempotency key inside
// its own command. These factories surface those rejections with the same
// codes the canonical RbacGuard uses at the transport boundary, so the
// adapter's external contract stays consistent whether the guard or the
// owner command rejects.

/** The owner re-checked identity/permission inside its command (403). */
export function rewardPermissionDeniedError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'PERMISSION_DENIED',
    'You do not have permission for this action.',
  );
}

/** The owner re-checked the market grant inside its command (403). */
export function rewardMarketAccessDeniedError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'MARKET_ACCESS_DENIED',
    'The administrator does not have access to this market.',
  );
}

/** The owner requires the server Current Admin Market (409). */
export function rewardMarketSelectionRequiredError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'MARKET_SELECTION_REQUIRED',
    'Select an authorized market to continue.',
  );
}

/** Body market and server Current Admin Market disagree (409). */
export function rewardMarketContextMismatchError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'MARKET_CONTEXT_MISMATCH',
    'The selected market changed. Refresh and try again.',
  );
}

/** The owner requires the Idempotency-Key (400; controller also enforces). */
export function rewardIdempotencyKeyRequiredError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'IDEMPOTENCY_KEY_REQUIRED',
    'A valid Idempotency-Key header is required.',
  );
}

/** The owner requires a 1–500 character operator reason (400). */
export function rewardReasonRequiredError(): AdminRewardOpsError {
  return new AdminRewardOpsError(
    'REASON_REQUIRED',
    'A reason between 1 and 500 characters is required.',
  );
}
