import { RewardError } from './reward.types.js';

export function rewardPlanNotFoundError(): RewardError {
  return new RewardError('REWARD_PLAN_NOT_FOUND', 'Reward plan not found.');
}

export function rewardPlanDuplicateError(): RewardError {
  return new RewardError(
    'REWARD_PLAN_DUPLICATE',
    'A reward plan already exists for this source.',
  );
}

export function rewardPlanInvalidStateError(
  currentStatus: string,
  expectedStatus?: string,
): RewardError {
  return new RewardError(
    'REWARD_PLAN_INVALID_STATE',
    'The reward plan is not in a valid state for this operation.',
    { currentStatus, expectedStatus },
  );
}

export function rewardRuleVersionNotFoundError(): RewardError {
  return new RewardError(
    'REWARD_RULE_VERSION_NOT_FOUND',
    'Rule version not found.',
  );
}

export function rewardRuleNoEffectiveVersionError(
  marketId?: string,
): RewardError {
  return new RewardError(
    'REWARD_RULE_NO_EFFECTIVE_VERSION',
    'No effective rule version found for this market and date.',
    { marketId },
  );
}

export function rewardSourceNotFoundError(): RewardError {
  return new RewardError('REWARD_SOURCE_NOT_FOUND', 'Reward source not found.');
}

export function rewardSourceDuplicateError(): RewardError {
  return new RewardError(
    'REWARD_SOURCE_DUPLICATE',
    'A reward source with this type and id already exists.',
  );
}

export function rewardSourceAlreadyConsumedError(): RewardError {
  return new RewardError(
    'REWARD_SOURCE_ALREADY_CONSUMED',
    'This reward source has already been consumed.',
  );
}

export function rewardMarketAccessDeniedError(): RewardError {
  return new RewardError(
    'REWARD_MARKET_ACCESS_DENIED',
    'Market access denied.',
  );
}
