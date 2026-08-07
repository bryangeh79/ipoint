// Redemption Service Types — Canonical Schema (P6-S0)
//
// These types define the internal service-layer interfaces.
// They match the canonical Drizzle schema columns and are NOT
// re-exported from @ipoint/types (which uses DTO-suffixed names).

// ─── Core Domain Types ───────────────────────────────────────────────────

export interface RedemptionAdminActor {
  adminUserId: string;
  ipAddress: string;
  requestId?: string;
  /**
   * Server-owned Current Admin Market resolved by the canonical RbacGuard
   * (D-053 §5). The secured rate owner commands REQUIRE it so in-process
   * callers (Phase 7 adapters) get the exact same selected-market
   * enforcement as the HTTP route.
   */
  currentMarketId?: string;
  marketContextVersion?: number;
}

export interface RedemptionCatalogItem {
  id: string;
  marketId: string;
  sku: string | null;
  name: string;
  description: string | null;
  itemType: string;
  ownership: string;
  status: string;
  fiatReferenceValue: string;
  fiatCurrency: string;
  fulfilmentMode: string;
  inventoryMode: string;
  imageUrl: string | null;
  terms: string | null;
  isFeatured: boolean;
  tags: string[];
  sortOrder: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionCatalogListItem {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  fiatReferenceValue: string;
  fiatCurrency: string;
  inventoryMode: string;
  fulfilmentMode: string;
  status: string;
  isFeatured: boolean;
  imageUrl: string | null;
  tags: string[];
  sortOrder: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  version: number;
}

export interface RedemptionCatalogListResponse {
  items: RedemptionCatalogListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RedemptionRateVersion {
  id: string;
  marketId: string;
  rateType: string;
  rateValue: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Versioned per-market rate configuration (D-053 §6). Resolved from
 * `redemption_rate_market_rules` by market code; the owner command blocks
 * markets without an active rule (`configured: false`).
 */
export interface RedemptionRateMarketConfig {
  configured: boolean;
  initialRate: string | null;
  minimumRate: string | null;
  maximumRate: string | null;
  currency: string | null;
  displayUnit: string | null;
}

/**
 * Secured owner create command (D-053 §5-§8, §10-§11). `reason` and
 * `idempotencyKey` are REQUIRED by the command (enforced in the service
 * layer, never only at the transport) but typed optional so every
 * in-process caller is forced through the same enforcement and cannot
 * bypass it at compile time.
 */
export interface CreateRateVersionCommand {
  marketId: string;
  rateType: 'POINTS_PER_CURRENCY' | 'CURRENCY_PER_POINT';
  rateValue: string;
  fiatCurrency: string;
  effectiveFrom: string;
  reason?: string;
  idempotencyKey?: string;
}

/**
 * Secured owner cancel command (D-053 §9-§11). `reason` and
 * `idempotencyKey` are REQUIRED by the command.
 */
export interface CancelRateVersionCommand {
  reason?: string;
  idempotencyKey?: string;
}

/**
 * Create response of the secured owner command: the resolved UTC instant
 * AND the market-local wall time of the activation, the market timezone
 * and the durable reason (frozen contract §7).
 */
export interface RedemptionRateVersionCreateResponse {
  id: string;
  marketId: string;
  rateType: string;
  rateValue: string;
  effectiveFrom: string;
  effectiveFromLocal: string;
  timezone: string;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}

/**
 * Cancel response: the append-only cancellation event (D-053 §9) with the
 * target version reference. The immutable rate-version row is untouched.
 */
export interface RedemptionRateCancelResponse {
  id: string;
  rateVersionId: string;
  marketId: string;
  rateType: string;
  rateValue: string;
  effectiveFrom: string;
  reason: string;
  cancelledBy: string;
  cancelledAt: string;
}

export interface RedemptionRateVersionListItem {
  id: string;
  rateType: string;
  rateValue: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: string;
  createdAt: string;
}

export interface RedemptionPickupLocation {
  id: string;
  marketId: string;
  name: string;
  address: Record<string, unknown>;
  contactName: string | null;
  contactPhone: string | null;
  operatingHours: Record<string, unknown>;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionPickupLocationListItem {
  id: string;
  name: string;
  address: Record<string, unknown>;
  isActive: boolean;
}

export interface RedemptionQuote {
  quoteId: string;
  catalogItemId: string;
  marketId: string;
  rateVersionId: string;
  rateSnapshot: Record<string, unknown>;
  unroundedPointCost: string;
  postedPointCost: string;
  quantity: number;
  payloadHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface ShippingCostResponse {
  fulfilmentMode: string;
  shippingFee: string;
  currency: string;
  isFree: boolean;
}

export type ShippingPaymentStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'NO_PAYMENT_NEEDED';

// ─── Service Result Types — Canonical Schema ─────────────────────────────

export interface MemberCatalogItem {
  id: string;
  name: string;
  sku: string | null;
  itemType: string;
  fiatReferenceValue: string;
  fiatCurrency: string;
  inventoryMode: string;
  fulfilmentMode: string;
  imageUrl: string | null;
  tags: string[];
  isFeatured: boolean;
  sortOrder: number;
}

export interface MemberCatalogListResponse {
  items: MemberCatalogItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ItemDetailResponse {
  id: string;
  marketId: string;
  name: string;
  description: string | null;
  itemType: string;
  fiatReferenceValue: string;
  fiatCurrency: string;
  inventoryMode: string;
  imageUrl: string | null;
  terms: string | null;
  fulfilmentMode: string;
  tags: string[];
  isFeatured: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  version: number;
}

// ═════════════════════════════════════════════════════════════════════════
// P6-S5: Fulfilment Types
// ═════════════════════════════════════════════════════════════════════════

export type RedemptionOrderStatus =
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'READY_FOR_PICKUP'
  | 'BACKORDERED'
  | 'FULFILMENT_SUSPENDED'
  | 'FULFILMENT_EXCEPTION'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'FULFILLED';

export type FulfilmentType = 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
export type FulfilmentStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED';
export type RefundRequestStatus =
  | 'PENDING_CHECKER'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED';
export type ShippingPaymentRecoveryStatus =
  | 'PENDING'
  | 'VOIDING'
  | 'VOIDED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'FAILED';

export interface ActorInfo {
  actorType: 'ADMIN' | 'SYSTEM' | 'MEMBER';
  actorId: string | null;
  requestId?: string;
  ipAddress?: string;
}

export interface FulfilmentRecord {
  id: string;
  orderId: string;
  fulfilmentType: FulfilmentType;
  status: FulfilmentStatus;
  pickupLocationId: string | null;
  pickupCode: string | null;
  shippingAddress: Record<string, unknown> | null;
  trackingNumber: string | null;
  courier: string | null;
  estimatedDeliveryDate: string | null;
  digitalValueEncrypted: string | null;
  voucherExpiresAt: string | null;
  serviceScheduledAt: string | null;
  serviceNotes: string | null;
  fulfilledAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFulfilmentParams {
  orderId: string;
  fulfilmentType: FulfilmentType;
  pickupLocationId?: string;
  shippingAddress?: Record<string, unknown>;
  trackingNumber?: string;
  courier?: string;
  estimatedDeliveryDate?: string;
  serviceScheduledAt?: string;
  serviceNotes?: string;
}

export interface UpdateFulfilmentStatusParams {
  fulfilmentId: string;
  status: FulfilmentStatus;
  failureReason?: string;
  trackingNumber?: string;
  courier?: string;
}

export interface FulfilmentExceptionRecord {
  id: string;
  fulfilmentId: string;
  orderId: string;
  severity: 'RETRYABLE' | 'NON_RETRYABLE';
  retryAttempt: number;
  errorCode: string;
  errorMessage: string;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
}

export interface FulfilmentAuditEntry {
  id: string;
  orderId: string;
  fulfilmentId: string | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface PickupVerificationResult {
  verified: boolean;
  orderId: string;
  memberId: string;
  failureReason?: string;
}

export interface VoucherCodeResult {
  plaintext: string;
  encrypted: string;
  hash: string;
}

export interface VoucherRevealResult {
  code: string;
  orderId: string;
  auditEventId: string;
}

export interface WaitlistSubscription {
  id: string;
  memberId: string;
  marketId: string;
  itemId: string;
  isActive: boolean;
  createdAt: string;
}

// ═════════════════════════════════════════════════════════════════════════
// P6-S4: Confirm Order Types
// ═════════════════════════════════════════════════════════════════════════

export interface RedemptionOrderResponse {
  id: string;
  orderReference: string;
  marketId: string;
  memberId: string;
  itemId: string;
  walletAccountId: string;
  walletEntryId: string;
  quoteId: string;
  status: string;
  totalPointCost: string;
  quantity: string;
  backorderQuantity: string;
  itemSnapshot: Record<string, unknown>;
  rateSnapshot: Record<string, unknown>;
  idempotencyKey: string | null;
  confirmedAt: string;
  createdAt: string;
}

export interface ConfirmOrderInput {
  quoteId: string;
  idempotencyKey: string;
  expectedItemVersion: number;
  expectedTotalPoints: string;
  expectedQuantity: string;
  fulfilment: {
    type: 'DELIVERY' | 'PICKUP';
    deliveryAddress?: Record<string, unknown>;
    pickupLocationId?: string;
  };
  termsAcceptance: {
    accepted: boolean;
    termsVersion: string;
  };
  shippingPaymentIntentReference?: string;
}

// ═════════════════════════════════════════════════════════════════════════
// P6-S6: Refund Types
// ═════════════════════════════════════════════════════════════════════════

export interface RefundRequestRecord {
  id: string;
  orderId: string;
  publicReference: string;
  totalPointCost: string;
  reason: string;
  status: RefundRequestStatus;
  makerId: string;
  checkerId: string | null;
  makerNotes: string | null;
  checkerNotes: string | null;
  walletEntryId: string | null;
  refundWalletEntryId: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRefundRequestParams {
  orderId: string;
  memberId: string;
  marketId: string;
  totalPointCost: string;
  reason: string;
  makerId: string;
  makerNotes?: string;
  /**
   * SEC-02: required operation-level idempotency key (enforced in the
   * owner, never only at the transport). Same key + same payload replays;
   * same key + different payload is rejected.
   */
  idempotencyKey?: string;
}

export interface ApproveRefundRequestParams {
  refundRequestId: string;
  checkerId: string;
  checkerNotes?: string;
}

export interface ShippingPaymentRecoveryRecord {
  id: string;
  orderId: string;
  paymentIntentId: string;
  amount: string;
  currency: string;
  recoveryStatus: ShippingPaymentRecoveryStatus;
  failureReason: string | null;
  retryCount: number;
  maxRetries: number;
  voidedAt: string | null;
  refundedAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

export interface OrderLockMetadata {
  correlationId: string;
  reason: string;
}
