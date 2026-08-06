/**
 * P7-S7A — Manual MCP Adjustment Maker/Checker owner types (D-046 conformance).
 *
 * Lifecycle (P7-OD-03/10/11, P7-S1 §16):
 *   DRAFT -> SUBMITTED -> APPROVED | REJECTED -> EXECUTING -> EXECUTED | FAILED
 *
 * The owner reuses the accepted Phase 1 MCP durable request/decision tables
 * (`mcp_adjustment_requests` / `mcp_adjustment_decisions`) and the
 * direction-aware MCP ledger append (`append_mcp_ledger_entry`) — the MCP
 * ledger owner already supports CREDIT/DEBIT natively, so unlike SEC-01's
 * wallet case no dedicated ledger command is required.
 */

export class McpAdjustmentOwnerError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpAdjustmentOwnerError';
    this.code = code;
    this.details = details;
  }
}

export type McpAdjustmentEntryType = 'MANUAL_CREDIT' | 'MANUAL_DEBIT';

export type McpAdjustmentState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED'
  // Legacy Phase 1 states still present in the shared enum; rows created
  // before migration 0035 keep their original values and must stay readable.
  | 'PENDING_APPROVAL'
  | 'CANCELLED';

/**
 * Server-derived admin actor. `currentMarketId` is the server Current
 * Admin Market resolved at the transport boundary (RbacGuard); the owner
 * re-validates it inside every command so no in-process caller can bypass
 * market context.
 */
export interface McpAdjustmentOwnerActor {
  adminUserId: string;
  ipAddress: string;
  requestId?: string;
  currentMarketId?: string;
  marketContextVersion?: number;
}

/** Maker create command (Draft/Create step). */
export interface CreateMcpAdjustmentCommand {
  mcpAccountId: string;
  entryType: McpAdjustmentEntryType;
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
export interface SubmitMcpAdjustmentCommand {
  requestId: string;
}

/** Checker decision command: SUBMITTED -> APPROVED | REJECTED. */
export interface McpAdjustmentDecisionCommand {
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
export interface ExecuteMcpAdjustmentCommand {
  requestId: string;
}

/** Immutable durable request projection returned by every owner command. */
export interface McpAdjustmentRequestView {
  id: string;
  mcpAccountId: string;
  marketId: string;
  entryType: McpAdjustmentEntryType;
  amount: string;
  state: McpAdjustmentState;
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
export interface McpAdjustmentExecutionResult {
  ledgerEntryId: string;
  balanceBefore: string;
  balanceAfter: string;
}
