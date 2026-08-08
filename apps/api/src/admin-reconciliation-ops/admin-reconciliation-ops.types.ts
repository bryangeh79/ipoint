/**
 * P8-S2 Advanced Financial Reconciliation domain types.
 *
 * This domain is DETECTION + REVIEW + TRACEABILITY only. Every read touches
 * frozen ledger/balance/order tables through read-only queries; this module
 * never writes to ledger/transaction/reward/commission/redemption tables and
 * never performs destructive automatic correction.
 */

export const RECONCILIATION_KINDS = [
  'MCP',
  'IPOINT',
  'TRANSACTION_LEDGER',
  'COMMISSION',
  'REFUND',
  'REDEMPTION',
] as const;

export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

export const RECONCILIATION_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type ReconciliationRunStatus =
  (typeof RECONCILIATION_RUN_STATUSES)[number];

export const RECONCILIATION_EXCEPTION_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'CLOSED',
] as const;

export type ReconciliationExceptionStatus =
  (typeof RECONCILIATION_EXCEPTION_STATUSES)[number];

export const RECONCILIATION_ITEM_STATUSES = [
  'MATCHED',
  'MISMATCHED',
  'MISSING',
  'UNEXPECTED',
] as const;

export type ReconciliationItemStatus =
  (typeof RECONCILIATION_ITEM_STATUSES)[number];

export const RECONCILIATION_CLASSIFICATIONS = [
  'AMOUNT_MISMATCH',
  'MISSING_EXPECTED',
  'UNEXPECTED_EXTRA',
  'REFERENCE_MISMATCH',
  'STATUS_MISMATCH',
  'LEDGER_INVARIANT_VIOLATION',
] as const;

export type ReconciliationClassification =
  (typeof RECONCILIATION_CLASSIFICATIONS)[number];

export interface ReconciliationActor {
  adminUserId: string;
  currentMarketId?: string;
  requestId?: string;
  ipAddress?: string;
}

export type ReconciliationErrorCode =
  | 'RECONCILIATION_NOT_FOUND'
  | 'RECONCILIATION_MARKET_MISMATCH'
  | 'RECONCILIATION_INVALID_INPUT'
  | 'RECONCILIATION_INVALID_TRANSITION'
  | 'RECONCILIATION_STALE_VERSION'
  | 'RECONCILIATION_IDEMPOTENCY_KEY_REQUIRED'
  | 'RECONCILIATION_IDEMPOTENCY_CONFLICT'
  | 'RECONCILIATION_RUN_IN_PROGRESS'
  | 'RECONCILIATION_DUPLICATE';

export class ReconciliationError extends Error {
  constructor(
    public readonly code: ReconciliationErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ReconciliationError';
  }
}

export interface DetectedItem {
  referenceType: string;
  referenceId: string;
  status: ReconciliationItemStatus;
  expectedAmount: string;
  actualAmount: string;
  differenceAmount: string;
  evidence: Record<string, unknown>;
}

export interface RunTotals {
  expectedTotal: string;
  actualTotal: string;
  differenceTotal: string;
  matchedCount: number;
  mismatchedCount: number;
  exceptionCount: number;
}

export interface AdminListResponse<T> {
  market_id: string;
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
