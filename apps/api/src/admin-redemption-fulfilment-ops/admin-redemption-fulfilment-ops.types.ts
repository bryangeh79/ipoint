/**
 * P7-S8 Admin Redemption Operations adapter types (Command Center
 * 2026-08-07 §6.2-§6.6, D-055 continuous sequence).
 *
 * Phase 7 read projection + orchestration over the FROZEN Phase 6
 * redemption owner (`apps/api/src/redemption`: `RedemptionFulfilmentService`
 * + `RedemptionRefundService`, SEC-02). The adapter NEVER rewrites owner
 * logic and never performs financial writes: every status operation
 * (suspend/resume/retry) delegates 1:1 to the owner commands with the
 * server Current Admin Market, and every refund view is a read projection
 * over the SEC-02 owner rows/audit.
 *
 * Read semantics:
 * - Fulfilment queues: six market-scoped operational status queues
 *   (READY_FOR_PICKUP / BACKORDERED / FULFILMENT_SUSPENDED /
 *   FULFILMENT_EXCEPTION / REFUND_PENDING / REFUNDED), each a bounded read
 *   projection of `redemption_orders` with the linked fulfilment, refund
 *   request and shipping-payment recovery records. No fabricated counts
 *   and no cross-market fallback.
 * - Capability state: each queue response reports whether the market has an
 *   active redemption rate rule (`rate_configured` — the same canonical
 *   `redemption_rate_market_rules` source the owner enforces, D-053 §6).
 *   An unconfigured market is explicitly reported, never silently treated
 *   as a fallback market.
 * - Refund operations views: queue/detail/status-history read face over the
 *   SEC-02 owner rows and the owner's immutable `redemption_audit_log`
 *   events (REFUND_REQUESTED / REFUND_APPROVED / REFUND_EXECUTED /
 *   REFUND_REJECTED / REFUND_EXECUTION_FAILED). No refund write exists on
 *   this surface — approval/creation stay on the frozen Phase 6 routes.
 * - Audit: every Phase 7 layer operation (suspend/resume/retry) calls the
 *   frozen owner commands, which append their own immutable audit rows
 *   (`redemption_fulfilment_audit` / `redemption_audit_log`); the order
 *   audit view exposes that owner-owned history.
 *
 * Zero-commission invariant (OD-29): the redemption flow must never produce
 * commission. The owner module does not import the commission domain and
 * no redemption path writes `commission_ledger`; the integration spec
 * asserts this end-to-end (no owner change).
 */

/** Phase 7 adapter actor: server-owned admin identity + market context. */
export interface RedemptionFulfilmentOpsActor {
  adminUserId: string;
  ipAddress: string;
  requestId?: string;
  /** Server-owned Current Admin Market resolved by the RbacGuard. */
  currentMarketId?: string;
}

export type RedemptionFulfilmentOpsErrorCode =
  | 'REDEMPTION_MARKET_NOT_FOUND'
  | 'REDEMPTION_ORDER_NOT_FOUND'
  | 'REDEMPTION_FULFILMENT_NOT_FOUND'
  | 'REDEMPTION_REFUND_NOT_FOUND'
  | 'REDEMPTION_QUEUE_STATUS_INVALID'
  | 'REDEMPTION_ORDER_NOT_SUSPENDED'
  | 'REDEMPTION_ORDER_CANNOT_SUSPEND'
  | 'REDEMPTION_FULFILMENT_INVALID_TRANSITION'
  | 'REDEMPTION_FULFILMENT_NOT_FAILED'
  | 'REDEMPTION_FULFILMENT_MAX_RETRIES'
  | 'REDEMPTION_FULFILMENT_NON_RETRYABLE'
  | 'REDEMPTION_REASON_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'MARKET_ACCESS_DENIED'
  | 'MARKET_SELECTION_REQUIRED'
  | 'MARKET_CONTEXT_MISMATCH';

export class RedemptionFulfilmentOpsError extends Error {
  constructor(
    public readonly code: RedemptionFulfilmentOpsErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RedemptionFulfilmentOpsError';
  }
}

/**
 * The six Phase 7 fulfilment/refund operational status queues (Command
 * Center 2026-08-07 §6.2). Mirrors the frozen `redemption_order_status`
 * enum values these queues read.
 */
export const FULFILMENT_QUEUE_STATUSES = [
  'READY_FOR_PICKUP',
  'BACKORDERED',
  'FULFILMENT_SUSPENDED',
  'FULFILMENT_EXCEPTION',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

export type FulfilmentQueueStatus = (typeof FULFILMENT_QUEUE_STATUSES)[number];

export interface FulfilmentLinkDto {
  fulfilment_id: string;
  fulfilment_type: string;
  fulfilment_status: string;
  tracking_number: string | null;
  courier: string | null;
  failure_reason: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
}

export interface RefundLinkDto {
  refund_request_id: string;
  refund_status: string;
  refund_amount: string;
  maker_id: string;
  checker_id: string | null;
  decided_at: string | null;
  executed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

export interface ShippingRecoveryLinkDto {
  recovery_id: string;
  recovery_status: string;
  amount: string;
  currency: string;
  retry_count: number;
  max_retries: number;
  failed_at: string | null;
}

export interface FulfilmentQueueItemDto {
  order_id: string;
  order_reference: string;
  member_id: string;
  public_member_id: string;
  item_name: string;
  item_sku: string | null;
  total_points: string;
  quantity: string;
  backorder_quantity: string;
  status: string;
  confirmed_at: string | null;
  ready_for_pickup_at: string | null;
  backordered_at: string | null;
  fulfilled_at: string | null;
  updated_at: string;
  fulfilment: FulfilmentLinkDto | null;
  refund: RefundLinkDto | null;
  shipping_recovery: ShippingRecoveryLinkDto | null;
}

export interface FulfilmentQueueResponse {
  market_id: string;
  market_code: string;
  status: FulfilmentQueueStatus;
  /** Active redemption rate rule present for the market (D-053 §6 source). */
  rate_configured: boolean;
  items: FulfilmentQueueItemDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface FulfilmentQueueOverviewResponse {
  market_id: string;
  market_code: string;
  rate_configured: boolean;
  counts: Record<FulfilmentQueueStatus, number>;
}

export interface OrderAuditEntryDto {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  reason: string | null;
  result: string;
  request_id: string | null;
  occurred_at: string;
}

export interface OrderDetailResponse {
  market_id: string;
  market_code: string;
  order: {
    order_id: string;
    order_reference: string;
    member_id: string;
    public_member_id: string;
    item_name: string;
    item_sku: string | null;
    status: string;
    total_points: string;
    quantity: string;
    backorder_quantity: string;
    rate_value: string;
    confirmed_at: string | null;
    ready_for_pickup_at: string | null;
    backordered_at: string | null;
    fulfilled_at: string | null;
    cancelled_at: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  fulfilment: FulfilmentLinkDto | null;
  refund: RefundLinkDto | null;
  shipping_recovery: ShippingRecoveryLinkDto | null;
  /** Owner-owned immutable audit trail (fulfilment + order events). */
  audit: OrderAuditEntryDto[];
}

export interface RefundRequestViewDto {
  refund_request_id: string;
  order_id: string;
  order_reference: string;
  status: string;
  refund_amount: string;
  reason: string;
  maker_id: string;
  checker_id: string | null;
  maker_notes: string | null;
  checker_notes: string | null;
  prior_order_status: string | null;
  decided_at: string | null;
  executed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefundQueueResponse {
  market_id: string;
  market_code: string;
  items: RefundRequestViewDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface RefundStatusHistoryEntryDto {
  id: string;
  action: string;
  reason: string | null;
  result: string;
  actor_id: string | null;
  occurred_at: string;
}

export interface RefundDetailResponse extends RefundRequestViewDto {
  status_history: RefundStatusHistoryEntryDto[];
}

export interface OperationResultDto {
  ok: true;
  order_id?: string;
  fulfilment_id?: string;
  status?: string;
  updated_at: string;
}
