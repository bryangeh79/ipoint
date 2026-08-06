export type AdminRewardRuleVersionStatus = 'ACTIVE' | 'ARCHIVED';

export type AdminRewardErrorCode =
  | 'ADMIN_REWARD_RULE_VERSION_NOT_FOUND'
  | 'ADMIN_REWARD_RULE_VERSION_ARCHIVED'
  | 'ADMIN_REWARD_JOB_NOT_FOUND'
  | 'ADMIN_REWARD_MARKET_ACCESS_DENIED'
  | 'ADMIN_REWARD_WALLET_NOT_FOUND'
  | 'ADMIN_REWARD_ADJUSTMENT_INVALID_AMOUNT'
  | 'ADMIN_REWARD_ADJUSTMENT_NOT_FOUND'
  | 'ADMIN_REWARD_IDEMPOTENCY_CONFLICT'
  // ─── D-052/D-050 secured owner command ─────────────────────────────
  | 'ADMIN_REWARD_PERMISSION_DENIED'
  | 'ADMIN_REWARD_MARKET_NOT_FOUND'
  | 'ADMIN_REWARD_MARKET_SELECTION_REQUIRED'
  | 'ADMIN_REWARD_MARKET_CONTEXT_MISMATCH'
  | 'ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED'
  | 'ADMIN_REWARD_REASON_REQUIRED'
  | 'ADMIN_REWARD_RATE_PRECISION_EXCEEDED'
  | 'ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT'
  | 'ADMIN_REWARD_ACTIVATION_NOT_FUTURE'
  | 'ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP';

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

/**
 * Authenticated ADMIN_USER actor for the owner command.
 *
 * `currentMarketId`/`marketContextVersion` carry the server-owned Current
 * Admin Market resolved by the canonical RbacGuard on HTTP routes. The
 * owner command requires them on every create so that in-process callers
 * (Phase 7 adapters) get the exact same selected-market enforcement as the
 * route.
 */
export interface AdminRewardActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  currentMarketId?: string;
  marketContextVersion?: number;
}

/**
 * Owner create command accepted by `AdminRewardService.createRuleVersion`.
 *
 * `reason` and `idempotencyKey` are REQUIRED by the command (enforced in
 * the service layer — never at the controller only) but typed optional so
 * every in-process caller is forced through the same enforcement and
 * cannot bypass it at compile time.
 */
export interface CreateRuleVersionCommand {
  name: string;
  description?: string;
  effectiveFrom: string;
  rewardRate: string;
  capType: 'NONE' | 'FLAT' | 'RATIO';
  capValue: string;
  minimumReward: string;
  marketId: string;
  reason?: string;
  idempotencyKey?: string;
}

export interface AdminRewardRuleVersionListItem {
  id: string;
  name: string;
  description: string | null;
  reason: string | null;
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

/**
 * Create response of the secured owner command: the resolved UTC instant
 * AND the market-local wall time of the activation are both returned
 * (frozen contract §7.1), with the market timezone and the durable reason.
 */
export interface AdminRewardRuleVersionCreateResponse {
  id: string;
  name: string;
  rewardRate: string;
  effectiveFrom: string;
  effectiveFromLocal: string;
  timezone: string;
  marketId: string;
  reason: string | null;
  createdBy: string;
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
