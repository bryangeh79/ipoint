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
