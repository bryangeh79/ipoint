export type AdminRewardRuleVersionStatus = 'ACTIVE' | 'ARCHIVED';

export type AdminAdjustmentState = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'CANCELLED';

export type AdminRewardErrorCode =
  | 'ADMIN_REWARD_RULE_VERSION_NOT_FOUND'
  | 'ADMIN_REWARD_RULE_VERSION_ARCHIVED'
  | 'ADMIN_REWARD_JOB_NOT_FOUND'
  | 'ADMIN_REWARD_MARKET_ACCESS_DENIED'
  | 'ADMIN_REWARD_WALLET_NOT_FOUND'
  | 'ADMIN_REWARD_ADJUSTMENT_INVALID_AMOUNT'
  | 'ADMIN_REWARD_ADJUSTMENT_NOT_FOUND'
  | 'ADMIN_REWARD_IDEMPOTENCY_CONFLICT';

export class AdminRewardError extends Error {
  constructor(
    readonly code: AdminRewardErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminRewardError';
  }
}

export interface AdminRewardActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
}

export interface AdminRewardRuleVersionListItem {
  id: string;
  name: string;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  rewardRate: string;
  capType: string;
  capValue: string;
  minimumReward: string;
  marketId: string | null;
  createdBy: string;
  isArchived: boolean;
  createdAt: string;
}

export interface AdminRewardRuleVersionDetailResponse extends AdminRewardRuleVersionListItem {
  versionHistory: Array<{
    id: string;
    name: string;
    rewardRate: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    marketId: string | null;
    isArchived: boolean;
    createdAt: string;
  }>;
}

export interface AdminRewardRuleVersionListResponse {
  items: AdminRewardRuleVersionListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminRewardVersionHistoryResponse {
  versions: Array<{
    id: string;
    name: string;
    rewardRate: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    marketId: string | null;
    isArchived: boolean;
    createdAt: string;
  }>;
  total: number;
}

export interface AdminRewardJobRun {
  id: string;
  jobType: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  processedCount: number;
  failedCount: number;
  errorMessage: string | null;
  triggeredBy: string;
  createdAt: string;
}

export interface AdminRewardJobRunListResponse {
  items: AdminRewardJobRun[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminRewardJobRunDetailResponse extends AdminRewardJobRun {
  results: Array<{
    sourceId: string;
    memberId: string;
    status: string;
    amount: string | null;
    error: string | null;
  }>;
}

export interface AdminWalletAdjustmentResponse {
  walletId: string;
  memberId: string;
  marketId: string;
  entryType: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  actorId: string | null;
  createdAt: string;
  adjustmentState: AdminAdjustmentState;
}

export interface AdminWalletAdjustmentRequest {
  id: string;
  walletId: string;
  memberId: string;
  marketId: string;
  amount: string;
  reason: string;
  source: string;
  requestedBy: string;
  approvedBy: string | null;
  state: AdminAdjustmentState;
  createdAt: string;
  updatedAt: string;
}
