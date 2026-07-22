import type { dailyJobStatus } from '@ipoint/database';

export type DailyJobStatus = (typeof dailyJobStatus.enumValues)[number];

export const JOB_TYPE_DAILY_REWARD_ACCRUAL = 'DAILY_REWARD_ACCRUAL';

export type JobType = typeof JOB_TYPE_DAILY_REWARD_ACCRUAL;

export class DailyJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DailyJobError';
  }
}

export interface DailyJobRunResponse {
  id: string;
  jobType: string;
  marketId: string;
  localBusinessDate: string;
  status: DailyJobStatus;
  startedAt: string | null;
  completedAt: string | null;
  totalEntitlements: number;
  processedCount: number;
  failedCount: number;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RewardDailyAccrualResponse {
  id: string;
  rewardPlanId: string;
  memberId: string;
  marketId: string;
  rewardRuleVersionId: string | null;
  marketTimezone: string;
  marketLocalDate: string;
  executedAtUtc: string;
  amount: string;
  ledgerEntryType: string;
  idempotencyKey: string;
  auditCorrelationId: string | null;
  createdAt: string;
}

export interface DailyAccrualResult {
  accrual: RewardDailyAccrualResponse | null;
  error?: string;
}

export interface EligibleRewardPlan {
  id: string;
  memberId: string;
  marketId: string;
  ruleVersionId: string | null;
  totalEarned: string;
  capAmount: string | null;
  snapshot: Record<string, unknown> | null;
}

export interface ProcessDailyAccrualsParams {
  marketId: string;
  localBusinessDate: string;
  marketTimezone: string;
}

export interface JobRunCheckpoint {
  jobRunId: string;
  marketId: string;
  localBusinessDate: string;
  totalEligible: number;
  processedCount: number;
  failedCount: number;
}

/** Advisory lock namespace for daily reward jobs */
export const ADVISORY_LOCK_NAMESPACE = 42_000_001;
