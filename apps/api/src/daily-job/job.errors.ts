import { DailyJobError } from './job.types.js';

export function jobRunNotFoundError(): DailyJobError {
  return new DailyJobError('JOB_RUN_NOT_FOUND', 'Daily job run not found.');
}

export function jobRunAlreadyExistsError(
  jobType: string,
  marketId: string,
  localBusinessDate: string,
): DailyJobError {
  return new DailyJobError(
    'JOB_RUN_ALREADY_EXISTS',
    `A job run already exists for ${jobType}/${marketId}/${localBusinessDate}.`,
    { jobType, marketId, localBusinessDate },
  );
}

export function jobRunInvalidStateError(
  currentStatus: string,
  expectedStatus?: string,
): DailyJobError {
  return new DailyJobError(
    'JOB_RUN_INVALID_STATE',
    'The job run is not in a valid state for this operation.',
    { currentStatus, expectedStatus },
  );
}

export function jobRunLockAcquisitionError(
  jobType: string,
  marketId: string,
  localBusinessDate: string,
): DailyJobError {
  return new DailyJobError(
    'JOB_RUN_LOCK_ACQUISITION_FAILED',
    `Failed to acquire advisory lock for ${jobType}/${marketId}/${localBusinessDate}. Another worker may be processing this job.`,
    { jobType, marketId, localBusinessDate },
  );
}

export function accrualDuplicateError(
  rewardPlanId: string,
  marketLocalDate: string,
): DailyJobError {
  return new DailyJobError(
    'ACCRUAL_DUPLICATE',
    `An accrual already exists for reward plan ${rewardPlanId} on ${marketLocalDate}.`,
    { rewardPlanId, marketLocalDate },
  );
}

export function noEligibleRewardPlansError(marketId: string): DailyJobError {
  return new DailyJobError(
    'NO_ELIGIBLE_REWARD_PLANS',
    `No eligible reward plans found for market ${marketId}.`,
    { marketId },
  );
}

export function rewardPlanAccrualCalculationError(
  rewardPlanId: string,
  reason: string,
): DailyJobError {
  return new DailyJobError(
    'REWARD_PLAN_ACCRUAL_CALCULATION_ERROR',
    `Failed to calculate daily accrual for reward plan ${rewardPlanId}: ${reason}`,
    { rewardPlanId, reason },
  );
}
