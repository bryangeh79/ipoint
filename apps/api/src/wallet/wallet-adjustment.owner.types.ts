/**
 * P7 SEC-01 — Manual iPoint Adjustment Maker/Checker owner types.
 *
 * The owner lives in the frozen Phase 3 wallet domain (`apps/api/src/wallet/`)
 * as NEW code; the existing member-facing wallet behavior is untouched.
 * Lifecycle (P7-OD-20): DRAFT -> SUBMITTED -> APPROVED | REJECTED ->
 * EXECUTING -> EXECUTED | FAILED.
 */

export class WalletAdjustmentOwnerError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WalletAdjustmentOwnerError';
    this.code = code;
    this.details = details;
  }
}

export type IpointAdjustmentDirection = 'CREDIT' | 'DEBIT';

export type IpointAdjustmentState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED';

/**
 * Server-derived admin actor. `currentMarketId` is the server Current
 * Admin Market resolved at the transport boundary (RbacGuard); the owner
 * re-validates it inside every command so no in-process caller can bypass
 * market context.
 */
export interface WalletAdjustmentOwnerActor {
  adminUserId: string;
  ipAddress: string;
  requestId?: string;
  currentMarketId?: string;
  marketContextVersion?: number;
}

/** Maker create command (Draft/Create step). */
export interface CreateAdjustmentCommand {
  walletAccountId: string;
  direction: IpointAdjustmentDirection;
  amount: string;
  reasonCode: string;
  explanation: string;
  caseReference: string;
  attachmentReference?: string;
  /** Replacement linkage for an immutable REJECTED request (P7-OD-18). */
  priorRequestId?: string;
  idempotencyKey: string;
}

/** Maker submit command: DRAFT -> SUBMITTED. */
export interface SubmitAdjustmentCommand {
  requestId: string;
}

/** Checker decision command: SUBMITTED -> APPROVED | REJECTED. */
export interface AdjustmentDecisionCommand {
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  /**
   * Checker explicitly requests an attachment (P7-OD-11). When set, an
   * APPROVED decision is impossible without an opaque attachment
   * reference; the checker must reject instead.
   */
  requireAttachment: boolean;
}

/** Checker execute command: APPROVED -> EXECUTING -> EXECUTED | FAILED. */
export interface ExecuteAdjustmentCommand {
  requestId: string;
}

/** Immutable durable request projection returned by every owner command. */
export interface WalletAdjustmentRequestView {
  id: string;
  walletAccountId: string;
  memberId: string;
  marketId: string;
  direction: IpointAdjustmentDirection;
  amount: string;
  state: IpointAdjustmentState;
  reasonCode: string;
  explanation: string;
  caseReference: string;
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

/** Execution outcome detail (ledger result). */
export interface AdjustmentExecutionResult {
  ledgerEntryId: string;
  balanceBefore: string;
  balanceAfter: string;
}
