export type RewardPlanStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'CAPPED'
  | 'SUSPENDED'
  | 'REVERSED'
  | 'COMPLETED';

export type RewardCapType = 'NONE' | 'FLAT' | 'RATIO';

export class RewardError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RewardError';
  }
}

export interface RewardRuleVersionResponse {
  id: string;
  name: string;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  rewardRate: string;
  capType: RewardCapType;
  capValue: string;
  minimumReward: string;
  marketId: string | null;
  createdBy: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface RewardPlanResponse {
  id: string;
  sourceType: string;
  sourceId: string;
  memberId: string;
  marketId: string;
  merchantId: string;
  status: RewardPlanStatus;
  totalEarned: string;
  capAmount: string | null;
  snapshot: Record<string, unknown> | null;
  ruleVersionId: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  reversedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RewardSourceResponse {
  id: string;
  sourceType: string;
  sourceId: string;
  memberId: string;
  marketId: string;
  merchantId: string;
  transactionAmount: string;
  currency: string;
  merchantPackageSnapshot: Record<string, unknown> | null;
  serviceFeeSnapshot: Record<string, unknown> | null;
  rewardRuleVersionId: string | null;
  consumed: boolean;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
