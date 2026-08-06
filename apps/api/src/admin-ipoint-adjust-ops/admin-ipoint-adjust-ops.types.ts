/**
 * P7-S7B Admin iPoint Adjustment Operations adapter types (SEC-01 §6 /
 * P7-S1 §17, P7-OD-03/10/11/18/20).
 *
 * Phase 7 adapter over the FROZEN SEC-01 owner
 * (`apps/api/src/wallet/wallet-adjustment.owner.service.ts`). The adapter
 * exposes the owner commands over HTTP (create → submit → decide →
 * execute), the Finance read projections (queue + detail with immutable
 * decision history) and the maker-form support projections (market rules,
 * reason-code catalog, wallet/member lookup). Every owner-level business
 * control (RBAC re-check, selected-market enforcement, Maker≠Checker
 * inequality, caps routing, evidence rules, idempotency, atomic
 * execution, audit) stays inside the frozen owner — the adapter performs
 * NO such control of its own.
 *
 * Transport contracts (SEC-01 §6.3): the server Current Admin Market is
 * enforced by the canonical RbacGuard (`marketScoped` permissions);
 * `Idempotency-Key` is mandatory on create; `x-step-up-token` is required
 * for checker/execute (catalog `stepUpRequired`).
 */

/** One iPoint adjustment request row, projected for the Finance UI. */
export interface AdminIpointAdjustmentViewDto {
  id: string;
  walletAccountId: string;
  memberId: string;
  marketId: string;
  direction: 'CREDIT' | 'DEBIT';
  /** Exact decimal string (numeric(38,10)) — never parsed client-side. */
  amount: string;
  state:
    | 'DRAFT'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'EXECUTING'
    | 'EXECUTED'
    | 'FAILED';
  reasonCode: string;
  explanation: string;
  caseReference: string;
  /** Opaque attachment reference (never contents). */
  attachmentReference: string | null;
  makerAdminUserId: string;
  checkerAdminUserId: string | null;
  submittedAt: string | null;
  executedAt: string | null;
  failedAt: string | null;
  priorRequestId: string | null;
  ledgerEntryId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Immutable decision history row (P7-OD-11/18). */
export interface AdminIpointAdjustmentDecisionDto {
  id: string;
  adjustmentRequestId: string;
  marketId: string;
  checkerAdminUserId: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  decidedAt: string;
}

/** Bounded Finance queue projection (state-filterable, paginated). */
export interface AdminIpointAdjustmentQueueResponse {
  marketId: string;
  items: AdminIpointAdjustmentViewDto[];
  limit: number;
  offset: number;
}

/** Request detail incl. the immutable decision history. */
export interface AdminIpointAdjustmentDetailResponse {
  request: AdminIpointAdjustmentViewDto;
  decisions: AdminIpointAdjustmentDecisionDto[];
}

/** Versioned per-market caps + evidence capability (P7-OD-10/11). */
export interface AdminIpointAdjustmentMarketRuleDto {
  marketCode: string;
  softCap: string;
  hardCap: string;
  secureEvidenceAvailable: boolean;
  isActive: boolean;
}

/** Market-scoped reason-code catalog entry (P7-OD-11). */
export interface AdminIpointAdjustmentReasonCodeDto {
  code: string;
  label: string;
  isHighRisk: boolean;
  isActive: boolean;
}

/**
 * Maker-form support projection: the configured market rules (caps +
 * secure-evidence capability) and the active reason-code catalog. A
 * market without a rules row is reported with the explicit blocked state
 * (`configured: false`) — never a fallback to another market.
 */
export interface AdminIpointAdjustmentConfigResponse {
  marketId: string;
  marketCode: string;
  timezone: string;
  currency: string;
  configured: boolean;
  rule: AdminIpointAdjustmentMarketRuleDto | null;
  reasonCodes: AdminIpointAdjustmentReasonCodeDto[];
}

/** Wallet/member lookup row for the maker screen (masked, no evidence). */
export interface AdminIpointWalletLookupDto {
  walletId: string;
  memberId: string;
  memberPublicId: string;
  displayName: string | null;
  marketId: string;
  /** Exact decimal string — never parsed client-side. */
  availableBalance: string;
  archived: boolean;
}

/** Create-command result (owner view). */
export type AdminIpointAdjustmentCreateResponse = AdminIpointAdjustmentViewDto;

/** Decide/execute command result (owner view). */
export type AdminIpointAdjustmentDecisionResponse =
  AdminIpointAdjustmentViewDto;

/**
 * Server-derived actor for the owner delegation. Built by the controller
 * from the authenticated session (CurrentActor), the RbacGuard-resolved
 * Current Admin Market, the request correlation id and the IP address.
 * Client input never reaches the actor object.
 */
export interface AdminIpointAdjustOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
  /**
   * Server-owned Current Admin Market resolved by the canonical RbacGuard
   * (SEC-01 §6.3). Passed through into the frozen owner command so it
   * applies the exact same selected-market enforcement as the canonical
   * route.
   */
  currentMarketId?: string;
  marketContextVersion?: number;
}
