/**
 * Redemption Center Domain Types (Canonical P6-S0)
 *
 * @packageDocumentation
 */

// ─── Enumerations ─────────────────────────────────────────────────────────

export const REDEMPTION_CATALOG_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'DISABLED',
  'ARCHIVED',
] as const;

export type RedemptionCatalogStatus =
  (typeof REDEMPTION_CATALOG_STATUSES)[number];

export const REDEMPTION_ITEM_TYPES = [
  'PHYSICAL',
  'DIGITAL_VOUCHER',
  'SERVICE',
] as const;

export type RedemptionItemType = (typeof REDEMPTION_ITEM_TYPES)[number];

export const REDEMPTION_OWNERSHIP = ['PLATFORM_OWNED'] as const;

export type RedemptionOwnership = (typeof REDEMPTION_OWNERSHIP)[number];

export const REDEMPTION_FULFILMENT_MODES = [
  'DELIVERY',
  'PICKUP',
  'DELIVERY_OR_PICKUP',
  'DIGITAL',
  'SERVICE',
] as const;

export type RedemptionFulfilmentMode =
  (typeof REDEMPTION_FULFILMENT_MODES)[number];

export const REDEMPTION_INVENTORY_MODES = [
  'UNLIMITED',
  'TRACKED',
  'ON_DEMAND',
] as const;

export type RedemptionInventoryMode =
  (typeof REDEMPTION_INVENTORY_MODES)[number];

export const REDEMPTION_QUOTE_STATUSES = [
  'VALID',
  'EXPIRED',
  'CONSUMED',
] as const;

export type RedemptionQuoteStatus = (typeof REDEMPTION_QUOTE_STATUSES)[number];

export const REDEMPTION_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_PICKUP',
  'BACKORDERED',
  'FULFILMENT_SUSPENDED',
  'FULFILMENT_EXCEPTION',
  'REFUND_PENDING',
  'REFUNDED',
  'FULFILLED',
  'CANCELLED',
] as const;

export type RedemptionOrderStatus = (typeof REDEMPTION_ORDER_STATUSES)[number];

export const REDEMPTION_FULFILMENT_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
] as const;

export type RedemptionFulfilmentStatus =
  (typeof REDEMPTION_FULFILMENT_STATUSES)[number];

export const REDEMPTION_FULFILMENT_TYPES = [
  'PHYSICAL',
  'DIGITAL',
  'SERVICE',
] as const;

export type RedemptionFulfilmentType =
  (typeof REDEMPTION_FULFILMENT_TYPES)[number];

export const REDEMPTION_WAITLIST_STATUSES = [
  'ACTIVE',
  'NOTIFIED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type RedemptionWaitlistStatus =
  (typeof REDEMPTION_WAITLIST_STATUSES)[number];

export const REDEMPTION_REFUND_STATUSES = [
  'PENDING_CHECKER',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
] as const;

export type RedemptionRefundStatus =
  (typeof REDEMPTION_REFUND_STATUSES)[number];

export const REDEMPTION_SHIPPING_PAYMENT_STATUSES = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
] as const;

export type RedemptionShippingPaymentStatus =
  (typeof REDEMPTION_SHIPPING_PAYMENT_STATUSES)[number];

export const REDEMPTION_RATE_TYPES = [
  'POINTS_PER_CURRENCY',
  'CURRENCY_PER_POINT',
] as const;

export type RedemptionRateType = (typeof REDEMPTION_RATE_TYPES)[number];

export const REDEMPTION_ROUNDING_MODES = [
  'HALF_UP',
  'HALF_DOWN',
  'HALF_EVEN',
  'FLOOR',
  'CEILING',
] as const;

export type RedemptionRoundingMode = (typeof REDEMPTION_ROUNDING_MODES)[number];

// ─── DTOs ─────────────────────────────────────────────────────────────────

export interface RedemptionRateVersionDTO {
  id: string;
  marketId: string;
  rateType: RedemptionRateType;
  rateValue: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  createdBy: string;
  createdAt: string;
}

export interface RedemptionCatalogItemDTO {
  id: string;
  marketId: string;
  sku: string | null;
  name: string;
  description: string | null;
  itemType: RedemptionItemType;
  ownership: RedemptionOwnership;
  status: RedemptionCatalogStatus;
  fiatReferenceValue: string;
  fiatCurrency: string;
  fulfilmentMode: RedemptionFulfilmentMode;
  inventoryMode: RedemptionInventoryMode;
  imageUrl: string | null;
  terms: string | null;
  isFeatured: boolean;
  tags: string[] | null;
  sortOrder: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionInventoryDTO {
  id: string;
  itemId: string;
  totalQuantity: string | null;
  reservedQuantity: string;
  fulfilledQuantity: string;
  backorderQuantity: string;
  version: number;
  updatedAt: string;
}

export interface RedemptionQuoteDTO {
  id: string;
  memberId: string;
  marketId: string;
  catalogItemId: string;
  status: RedemptionQuoteStatus;
  rateVersionId: string;
  rateSnapshot: Record<string, unknown>;
  unroundedPointCost: string;
  postedPointCost: string;
  payloadHash: string;
  expiresAt: string;
  consumedAt: string | null;
  idempotencyKey: string;
  createdAt: string;
}

export interface RedemptionOrderDTO {
  id: string;
  orderReference: string;
  marketId: string;
  memberId: string;
  itemId: string;
  walletAccountId: string;
  walletEntryId: string | null;
  quoteId: string | null;
  rateVersionId: string;
  rateValue: string;
  status: RedemptionOrderStatus;
  unroundedPointCost: string;
  postedPointCost: string;
  totalPoints: string;
  quantity: string;
  backorderQuantity: string;
  roundingMode: RedemptionRoundingMode;
  calculationScale: number;
  postingScale: number;
  itemSnapshot: Record<string, unknown>;
  rateSnapshot: Record<string, unknown>;
  idempotencyKey: string | null;
  notes: string | null;
  confirmedAt: string | null;
  processingStartedAt: string | null;
  readyForPickupAt: string | null;
  backorderedAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionFulfilmentDTO {
  id: string;
  orderId: string;
  fulfilmentType: RedemptionFulfilmentType;
  status: RedemptionFulfilmentStatus;
  shippingAddress: Record<string, unknown> | null;
  trackingNumber: string | null;
  courier: string | null;
  estimatedDeliveryDate: string | null;
  digitalValue: string | null;
  serviceScheduledAt: string | null;
  serviceNotes: string | null;
  fulfilledAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionRefundRequestDTO {
  id: string;
  orderId: string;
  makerId: string;
  checkerId: string | null;
  status: RedemptionRefundStatus;
  refundAmount: string;
  reason: string;
  makerNotes: string | null;
  checkerNotes: string | null;
  walletEntryId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionAuditLogDTO {
  id: string;
  actorType: string;
  actorId: string | null;
  marketId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  result: string;
  requestId: string | null;
  ipAddress: string | null;
  occurredAt: string;
}

export interface RedemptionPickupLocationDTO {
  id: string;
  marketId: string;
  name: string;
  address: Record<string, unknown>;
  contactName: string | null;
  contactPhone: string | null;
  operatingHours: Record<string, unknown> | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionWaitlistEntryDTO {
  id: string;
  memberId: string;
  catalogItemId: string;
  marketId: string;
  status: RedemptionWaitlistStatus;
  requestedQuantity: string;
  notifiedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
}

export interface RedemptionVoucherCodeDTO {
  id: string;
  orderId: string;
  catalogItemId: string;
  marketId: string;
  codeHash: string;
  codeEncrypted: string;
  expiryDate: string | null;
  usedAt: string | null;
  createdAt: string;
}

export interface RedemptionShippingPaymentDTO {
  id: string;
  orderId: string;
  marketId: string;
  amount: string;
  currency: string;
  status: RedemptionShippingPaymentStatus;
  paymentProvider: string | null;
  paymentIntentId: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  failedAt: string | null;
  refundedAt: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionTermsAcceptanceDTO {
  id: string;
  memberId: string;
  marketId: string;
  termsVersion: string;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

// ─── Input Types (for service layer) ──────────────────────────────────────

export interface CreateRedemptionOrderInput {
  memberId: string;
  marketId: string;
  catalogItemId: string;
  quoteId: string;
  quantity: number;
  notes?: string;
}

export interface CreateRedemptionRefundInput {
  orderId: string;
  reason: string;
  makerId: string;
  makerNotes?: string;
}

export interface ApproveRedemptionRefundInput {
  requestId: string;
  checkerId: string;
  checkerNotes?: string;
  walletEntryId: string;
}

export interface RejectRedemptionRefundInput {
  requestId: string;
  checkerId: string;
  checkerNotes?: string;
}

// ─── Wallet Entry Type Extension ──────────────────────────────────────────

export type ExtendedWalletEntryType =
  | 'PENDING'
  | 'AVAILABLE'
  | 'REVERSED'
  | 'COMPENSATION'
  | 'ADJUSTMENT'
  | 'REDEMPTION_DEBIT'
  | 'REDEMPTION_REFUND';
