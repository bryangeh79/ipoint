/**
 * P8-S3 Risk / Fraud / Operational Controls domain types.
 *
 * This domain is DETECTION + REVIEW + TRACEABILITY only: every detector is a
 * read-only query over frozen ledger/balance/transaction/adjustment/rate/
 * audit/security tables and this module never writes to them. There are NO
 * enforcement side-effects (no freeze / block / debit / disable / penalty /
 * confiscation / automatic permanent ban) and no invented business thresholds
 * (thresholds are operator-configurable definition config; detectors skip
 * definitions whose required config keys are absent).
 */

export const RISK_INDICATOR_CATEGORIES = [
  'SUSPICIOUS_TRANSACTION',
  'DUPLICATE_REPLAY',
  'ABNORMAL_ADJUSTMENT',
  'RATE_CONFIG_ANOMALY',
  'CROSS_MARKET_VIOLATION',
  'ACCOUNT_ADMIN_ABUSE',
  'SECURITY_EVENT',
  'REVIEW_QUEUE',
] as const;

export type RiskIndicatorCategory = (typeof RISK_INDICATOR_CATEGORIES)[number];

export const RISK_EVENT_SEVERITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

export type RiskEventSeverity = (typeof RISK_EVENT_SEVERITIES)[number];

export const RISK_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type RiskRunStatus = (typeof RISK_RUN_STATUSES)[number];

export const RISK_EVENT_STATUSES = ['FLAGGED'] as const;

export type RiskEventStatus = (typeof RISK_EVENT_STATUSES)[number];

export const RISK_REVIEW_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED'] as const;

export type RiskReviewStatus = (typeof RISK_REVIEW_STATUSES)[number];

export const RISK_REVIEW_DECISIONS = [
  'NO_ACTION',
  'WATCH',
  'ESCALATED',
] as const;

export type RiskReviewDecision = (typeof RISK_REVIEW_DECISIONS)[number];

/**
 * Canonical detector codes. One detector per indicator category; detectors are
 * wired by definition code so new operator-created definitions must reuse a
 * canonical code (unknown codes are skipped at run time).
 */
export const RISK_DETECTOR_CODES = [
  'suspicious_amount_breach',
  'duplicate_confirmed_transaction',
  'adjustment_execution_velocity',
  'rate_period_overlap',
  'cross_market_wallet_entry',
  'admin_action_velocity',
  'security_event_failure_burst',
  'review_queue_aging',
] as const;

export type RiskDetectorCode = (typeof RISK_DETECTOR_CODES)[number];

export interface RiskActor {
  adminUserId: string;
  currentMarketId?: string;
  requestId?: string;
  ipAddress?: string;
}

export type RiskErrorCode =
  | 'RISK_NOT_FOUND'
  | 'RISK_MARKET_MISMATCH'
  | 'RISK_INVALID_INPUT'
  | 'RISK_INVALID_TRANSITION'
  | 'RISK_STALE_VERSION'
  | 'RISK_IDEMPOTENCY_KEY_REQUIRED'
  | 'RISK_IDEMPOTENCY_CONFLICT'
  | 'RISK_RUN_IN_PROGRESS'
  | 'RISK_DUPLICATE'
  | 'RISK_DEFINITION_NOT_CURRENT';

export class RiskError extends Error {
  constructor(
    public readonly code: RiskErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RiskError';
  }
}

/** A detected signal produced by one detector for one active definition. */
export interface DetectedEvent {
  indicatorId: string;
  indicatorCode: string;
  indicatorVersion: number;
  category: RiskIndicatorCategory;
  severity: RiskEventSeverity;
  entityType: string;
  entityId: string;
  entityMarketId?: string;
  payload: Record<string, unknown>;
  detectionMetadata: Record<string, unknown>;
}

export interface RunTotals {
  definitionsScanned: number;
  eventsDetected: number;
  detectorsRun: Array<{ code: string; events: number }>;
}

export interface AdminListResponse<T> {
  market_id: string;
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Versioned-rows model: creating a definition version supersedes the current one. */
export interface ActiveDefinition {
  id: string;
  code: string;
  marketId: string;
  category: RiskIndicatorCategory;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  severity: RiskEventSeverity;
  version: number;
}
