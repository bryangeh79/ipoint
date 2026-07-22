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

export function adminRewardWalletNotFoundError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_WALLET_NOT_FOUND',
    'The wallet was not found.',
  );
}

export function adminRewardAdjustmentInvalidAmountError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_ADJUSTMENT_INVALID_AMOUNT',
    'The adjustment amount must be a positive numeric value.',
  );
}

export function adminRewardAdjustmentNotFoundError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_ADJUSTMENT_NOT_FOUND',
    'The wallet adjustment was not found.',
  );
}

export function adminRewardIdempotencyConflictError(): AdminRewardError {
  return new AdminRewardError(
    'ADMIN_REWARD_IDEMPOTENCY_CONFLICT',
    'The idempotency key was already used with a different payload.',
  );
}
