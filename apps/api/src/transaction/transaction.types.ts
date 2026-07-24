/**
 * Phase 4 transaction domain primitives.
 *
 * Financial values cross the application boundary as decimal strings. Database
 * numeric columns remain the authority; JavaScript Number must not be used for
 * transaction, MCP, service-fee, or reward calculations.
 */
export type FinancialDecimal = string;

export const TRANSACTION_STATUSES = [
  'DRAFT',
  'PREVIEWED',
  'CONFIRMED',
  'REVERSAL_REQUESTED',
  'REFUND_REQUESTED',
  'REVERSED',
  'REFUNDED',
  'REJECTED',
  'FAILED',
  'EXPIRED',
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_IDEMPOTENCY_OPERATIONS = [
  'PREVIEW',
  'CONFIRM',
] as const;

export type TransactionIdempotencyOperation =
  (typeof TRANSACTION_IDEMPOTENCY_OPERATIONS)[number];

export interface MerchantPackageSnapshot {
  assignmentId: string;
  assignmentVersion: number;
  serviceFeeVersionId: string | null;
  specialPercentageId: string | null;
  rate: FinancialDecimal;
}

export interface RewardRuleSnapshot {
  rewardRuleVersionId: string;
  rate: FinancialDecimal;
  principal: FinancialDecimal;
  cap: FinancialDecimal;
  startBusinessDate: string;
  marketId: string;
  timezone: string;
  roundingMode: 'HALF_UP';
}

export interface TransactionFinancialSnapshot {
  marketId: string;
  currency: string;
  purchaseAmount: FinancialDecimal;
  serviceFeeRate: FinancialDecimal;
  serviceFeeAmount: FinancialDecimal;
  mcpDebit: FinancialDecimal;
  merchantPackage: MerchantPackageSnapshot;
  rewardRule: RewardRuleSnapshot;
}
