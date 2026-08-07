/**
 * P7-S8 Admin Agent Operations adapter types (Command Center 2026-08-07
 * §6.1, D-055 continuous sequence).
 *
 * Phase 7 read projection + orchestrated status operations over the FROZEN
 * Phase 5 agent-activation owner (`apps/api/src/domain/agent-activation`).
 * The adapter NEVER adds agent business rules and never writes domain
 * tables: every state transition (suspend/reactivate/deactivate) delegates
 * 1:1 to the owner commands with the server Current Admin Market
 * (RbacGuard `adminMarketContext` → market code) and the executing admin
 * identity (P5-R1 actor attribution). Agent Reapplication Policy is OPEN
 * (not implemented) — this surface exposes no reapplication behavior.
 *
 * Read semantics:
 * - Market-scoped list/search/detail projection over `agent_activation`
 *   joined with the member identity (public member id + profile display
 *   name), filtered by the server-selected market code. No fallback to
 *   another market.
 * - Capability state: a market is "agent-capable" only when an effective
 *   AGENT_ACTIVATION_FEE version exists (the exact precondition the owner
 *   enforces at apply time — `resolveFeeVersion`). Unconfigured markets
 *   show the explicit blocked state (`capability: AGENT_FEE_NOT_CONFIGURED`),
 *   never a fallback fee.
 * - Status history comes from the owner's append-only
 *   `agent_activation_status_log` rows (P5-S2 immutable log).
 */

/** Phase 7 adapter actor: server-owned admin identity + market context. */
export interface AgentOpsActor {
  adminUserId: string;
  ipAddress: string;
  requestId?: string;
  /** Server-owned Current Admin Market resolved by the RbacGuard. */
  currentMarketId?: string;
}

export type AgentOpsErrorCode =
  | 'AGENT_MARKET_NOT_FOUND'
  | 'AGENT_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'MARKET_ACCESS_DENIED'
  | 'MARKET_SELECTION_REQUIRED'
  | 'MARKET_CONTEXT_MISMATCH'
  | 'REASON_REQUIRED'
  | 'AGENT_FEE_NOT_CONFIGURED'
  | 'AGENT_INVALID_TRANSITION'
  | 'AGENT_INVALID_STATUS'
  | 'AGENT_ALREADY_EXISTS'
  | 'AGENT_PAYMENT_ALREADY_CONFIRMED'
  | 'AGENT_COURSE_ALREADY_COMPLETED'
  | 'AGENT_MISSING_PAYMENT'
  | 'AGENT_MISSING_COURSE'
  | 'AGENT_MISSING_APPROVAL'
  | 'AGENT_OWNERSHIP_MISMATCH'
  | 'AGENT_MARKET_MISMATCH'
  | 'AGENT_ALREADY_ACTIVE'
  | 'AGENT_ALREADY_SUSPENDED'
  | 'AGENT_ALREADY_DEACTIVATED'
  | 'AGENT_ALREADY_REJECTED'
  | 'AGENT_DEACTIVATED_CANNOT_REACTIVATE'
  | 'AGENT_REJECTED_CANNOT_TRANSITION';

export class AgentOpsError extends Error {
  constructor(
    public readonly code: AgentOpsErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentOpsError';
  }
}

/**
 * Agent activation lifecycle statuses (frozen P5-S2 contract, mirrored
 * from the canonical `agent_activation_status` enum).
 */
export const AGENT_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_CONFIRMED',
  'COURSE_PENDING',
  'COURSE_COMPLETED',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'REJECTED',
] as const;

export type AgentOpsStatus = (typeof AGENT_STATUSES)[number];

/** Capability state of the selected market for agent operations. */
export type AgentOpsCapabilityState =
  /** Effective AGENT_ACTIVATION_FEE version exists (owner apply precondition). */
  | 'CONFIGURED'
  /** Market has no effective activation fee version — explicitly blocked. */
  | 'AGENT_FEE_NOT_CONFIGURED';

export interface AgentOpsCapability {
  state: AgentOpsCapabilityState;
  /** Exact activation fee resolved at the projection instant, if any. */
  activation_fee: string | null;
  currency: string | null;
  fee_rate_version_id: string | null;
}

export interface AgentStatusHistoryEntryDto {
  log_id: string;
  from_status: AgentOpsStatus | null;
  to_status: AgentOpsStatus;
  changed_by: string | null;
  changed_by_type: string;
  reason: string | null;
  changed_at: string;
}

export interface AgentListItemDto {
  agent_id: string;
  member_id: string;
  public_member_id: string;
  member_display_name: string | null;
  status: AgentOpsStatus;
  market: string;
  activation_fee: string | null;
  activation_fee_currency: string;
  activated_at: string | null;
  created_at: string;
}

export interface AgentListResponse {
  market_id: string;
  market_code: string;
  capability: AgentOpsCapability;
  items: AgentListItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface AgentDetailResponse extends AgentListItemDto {
  payment_reference: string | null;
  payment_confirmed_at: string | null;
  course_reference: string | null;
  course_enrolled_at: string | null;
  course_completed_at: string | null;
  course_confirmed_by: string | null;
  approved_at: string | null;
  activated_by: string | null;
  fee_rate_version_id: string | null;
  rejection_reason: string | null;
  reactivation_count: number;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  updated_at: string;
  /** Append-only owner status log (P5-S2), newest first. */
  status_history: AgentStatusHistoryEntryDto[];
}

export interface AgentStatusActionResultDto {
  agent_id: string;
  status: AgentOpsStatus;
  updated_at: string;
}
