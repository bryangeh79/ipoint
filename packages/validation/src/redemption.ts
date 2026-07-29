import { z } from 'zod';

// ─── Shared primitives ───────────────────────────────────────────────────

const uuid = z.string().uuid();
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);
const idempotencyKey = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(1000);
const currency = z.string().trim().toUpperCase().length(3);
const nonEmptyName = z.string().trim().min(1).max(256);
export const nonEmptyText = z.string().trim().min(1);
const positiveNumeric = z.string().regex(/^\d+(\.\d+)?$/);

// ─── Enums ────────────────────────────────────────────────────────────────

const catalogStatuses = ['DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED'] as const;
const itemTypes = ['PHYSICAL', 'DIGITAL_VOUCHER', 'SERVICE'] as const;
const inventoryModes = ['UNLIMITED', 'TRACKED', 'ON_DEMAND'] as const;
const fulfilmentModes = [
  'DELIVERY',
  'PICKUP',
  'DELIVERY_OR_PICKUP',
  'DIGITAL',
  'SERVICE',
] as const;
const rateTypes = ['POINTS_PER_CURRENCY', 'CURRENCY_PER_POINT'] as const;
export const quoteStatuses = ['VALID', 'EXPIRED', 'CONSUMED'] as const;
export const refundStatuses = [
  'PENDING_CHECKER',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
] as const;
export const shippingPaymentStatuses = [
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED',
] as const;
export const waitlistStatuses = [
  'ACTIVE',
  'NOTIFIED',
  'EXPIRED',
  'CANCELLED',
] as const;

// ─── Admin Catalog CRUD ──────────────────────────────────────────────────

export const createCatalogItemSchema = z
  .object({
    marketId: uuid,
    sku: z.string().trim().max(64).optional(),
    name: nonEmptyName,
    description: z.string().trim().max(5000).optional(),
    itemType: z.enum(itemTypes),
    fiatReferenceValue: positiveNumeric,
    fiatCurrency: currency,
    fulfilmentMode: z.enum(fulfilmentModes).default('DELIVERY'),
    inventoryMode: z.enum(inventoryModes),
    imageUrl: z.string().url().max(2000).optional(),
    terms: z.string().trim().max(10000).optional(),
    isFeatured: z.boolean().default(false),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
    sortOrder: z.coerce.number().int().min(0).default(0),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    effectiveUntil: z.string().datetime({ offset: true }).optional(),
    idempotencyKey,
  })
  .strict()
  .refine(
    (data) => data.inventoryMode !== 'TRACKED' || data.inventoryMode != null,
    {
      message: 'totalInventory is required when inventoryMode is TRACKED',
      path: ['totalInventory'],
    },
  )
  .refine(
    (data) =>
      !data.effectiveFrom ||
      !data.effectiveUntil ||
      new Date(data.effectiveUntil) > new Date(data.effectiveFrom),
    {
      message: 'effectiveUntil must be after effectiveFrom',
      path: ['effectiveUntil'],
    },
  );

export const updateCatalogItemSchema = z
  .object({
    sku: z.string().trim().max(64).optional(),
    name: nonEmptyName.optional(),
    description: z.string().trim().max(5000).optional(),
    fiatReferenceValue: positiveNumeric.optional(),
    fiatCurrency: currency.optional(),
    fulfilmentMode: z.enum(fulfilmentModes).optional(),
    imageUrl: z.string().url().max(2000).optional(),
    terms: z.string().trim().max(10000).optional(),
    isFeatured: z.boolean().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    effectiveUntil: z.string().datetime({ offset: true }).optional(),
    version: z.coerce.number().int().positive(),
    idempotencyKey,
  })
  .strict()
  .refine(
    (data) =>
      !data.effectiveFrom ||
      !data.effectiveUntil ||
      new Date(data.effectiveUntil) > new Date(data.effectiveFrom),
    {
      message: 'effectiveUntil must be after effectiveFrom',
      path: ['effectiveUntil'],
    },
  );

export const catalogItemQuerySchema = z
  .object({
    page,
    pageSize,
    query: z.string().trim().max(200).optional(),
    itemType: z.enum(itemTypes).optional(),
    status: z.enum(catalogStatuses).optional(),
    isFeatured: z.coerce.boolean().optional(),
    fulfilmentMode: z.enum(fulfilmentModes).optional(),
    sort: z
      .enum([
        'name:asc',
        'name:desc',
        'createdAt:desc',
        'createdAt:asc',
        'sortOrder:asc',
      ])
      .default('createdAt:desc'),
  })
  .strict();

export const setCatalogStatusSchema = z
  .object({
    status: z.enum(catalogStatuses),
    reason,
    idempotencyKey,
  })
  .strict();

// ─── Member Catalog Browse ───────────────────────────────────────────────

export const memberCatalogQuerySchema = z
  .object({
    page,
    pageSize,
    query: z.string().trim().max(200).optional(),
    itemType: z.enum(itemTypes).optional(),
    fulfilmentMode: z.enum(fulfilmentModes).optional(),
    sort: z
      .enum(['name:asc', 'name:desc', 'sortOrder:asc'])
      .default('sortOrder:asc'),
  })
  .strict();

// ─── Rate Version Management ─────────────────────────────────────────────

export const createRateVersionSchema = z
  .object({
    marketId: uuid,
    rateType: z.enum(rateTypes),
    rateValue: z.string().regex(/^\d+(\.\d+)?$/),
    fiatCurrency: currency,
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveUntil: z.string().datetime({ offset: true }).optional(),
    notes: z.string().trim().max(500).optional(),
    idempotencyKey,
  })
  .strict()
  .refine((data) => Number(data.rateValue) > 0, {
    message: 'Rate value must be positive',
    path: ['rateValue'],
  })
  .refine(
    (data) =>
      !data.effectiveUntil ||
      new Date(data.effectiveUntil) > new Date(data.effectiveFrom),
    {
      message: 'effectiveUntil must be after effectiveFrom',
      path: ['effectiveUntil'],
    },
  );

export const rateVersionQuerySchema = z
  .object({
    page,
    pageSize,
    rateType: z.enum(rateTypes).optional(),
    status: z.enum(['SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
  })
  .strict();

export const cancelRateVersionSchema = z
  .object({ reason, idempotencyKey })
  .strict();

// ─── Pickup Location CRUD ────────────────────────────────────────────────

export const createPickupLocationSchema = z
  .object({
    marketId: uuid,
    name: nonEmptyName,
    address: z.record(z.string(), z.unknown()).default({}),
    contactName: z.string().trim().max(128).optional(),
    contactPhone: z.string().trim().max(32).optional(),
    operatingHours: z.record(z.string(), z.unknown()).default({}),
    isActive: z.boolean().default(true),
    idempotencyKey,
  })
  .strict();

export const updatePickupLocationSchema = z
  .object({
    name: nonEmptyName.optional(),
    address: z.record(z.string(), z.unknown()).optional(),
    contactName: z.string().trim().max(128).optional(),
    contactPhone: z.string().trim().max(32).optional(),
    operatingHours: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
    idempotencyKey,
  })
  .strict();

export const pickupLocationQuerySchema = z
  .object({
    page,
    pageSize,
    isActive: z.coerce.boolean().optional(),
  })
  .strict();

// ─── Quote Generation ────────────────────────────────────────────────────

export const createQuoteSchema = z
  .object({
    catalogItemId: uuid,
    marketId: uuid,
    quantity: z.coerce.number().int().min(1).max(99999).default(1),
    idempotencyKey,
  })
  .strict();

export const quoteQuerySchema = z
  .object({
    quantity: z.coerce.number().int().min(1).max(99999).default(1),
  })
  .strict();

// ─── Order Management ────────────────────────────────────────────────────

export const createOrderSchema = z
  .object({
    quoteId: uuid,
    marketId: uuid,
    idempotencyKey,
  })
  .strict();

export const orderQuerySchema = z
  .object({
    page,
    pageSize,
    memberId: uuid.optional(),
    status: z
      .enum([
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
      ])
      .optional(),
    sort: z.enum(['createdAt:desc', 'createdAt:asc']).default('createdAt:desc'),
  })
  .strict();

// ─── Refund Management ───────────────────────────────────────────────────

export const createRefundRequestSchema = z
  .object({
    orderId: uuid,
    reason,
    makerNotes: z.string().trim().max(1000).optional(),
    idempotencyKey,
  })
  .strict();

export const approveRefundRequestSchema = z
  .object({
    requestId: uuid,
    checkerNotes: z.string().trim().max(1000).optional(),
    walletEntryId: uuid,
    idempotencyKey,
  })
  .strict();

export const rejectRefundRequestSchema = z
  .object({
    requestId: uuid,
    checkerNotes: z.string().trim().max(1000).optional(),
    idempotencyKey,
  })
  .strict();

// ─── Shipping Payment ────────────────────────────────────────────────────

export const createShippingPaymentSchema = z
  .object({
    orderId: uuid,
    amount: positiveNumeric,
    currency,
    paymentProvider: z.string().trim().max(64).optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

// ─── Waitlist ────────────────────────────────────────────────────────────

export const createWaitlistEntrySchema = z
  .object({
    catalogItemId: uuid,
    marketId: uuid,
    requestedQuantity: positiveNumeric,
    idempotencyKey,
  })
  .strict();

// ─── Terms Acceptance ────────────────────────────────────────────────────

export const acceptTermsSchema = z
  .object({
    termsVersion: z.string().trim().min(1).max(64),
    idempotencyKey,
  })
  .strict();

// ─── Type Exports ────────────────────────────────────────────────────────

export type CreateCatalogItemDto = z.infer<typeof createCatalogItemSchema>;
export type UpdateCatalogItemDto = z.infer<typeof updateCatalogItemSchema>;
export type CatalogItemQueryDto = z.infer<typeof catalogItemQuerySchema>;
export type SetCatalogStatusDto = z.infer<typeof setCatalogStatusSchema>;
export type MemberCatalogQueryDto = z.infer<typeof memberCatalogQuerySchema>;
export type CreateRateVersionDto = z.infer<typeof createRateVersionSchema>;
export type RateVersionQueryDto = z.infer<typeof rateVersionQuerySchema>;
export type CancelRateVersionDto = z.infer<typeof cancelRateVersionSchema>;
export type CreatePickupLocationDto = z.infer<
  typeof createPickupLocationSchema
>;
export type UpdatePickupLocationDto = z.infer<
  typeof updatePickupLocationSchema
>;
export type PickupLocationQueryDto = z.infer<typeof pickupLocationQuerySchema>;
export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;
export type QuoteQueryDto = z.infer<typeof quoteQuerySchema>;
export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type OrderQueryDto = z.infer<typeof orderQuerySchema>;
export type CreateRefundRequestDto = z.infer<typeof createRefundRequestSchema>;
export type ApproveRefundRequestDto = z.infer<
  typeof approveRefundRequestSchema
>;
export type RejectRefundRequestDto = z.infer<typeof rejectRefundRequestSchema>;
export type CreateShippingPaymentDto = z.infer<
  typeof createShippingPaymentSchema
>;
export type CreateWaitlistEntryDto = z.infer<typeof createWaitlistEntrySchema>;
export type AcceptTermsDto = z.infer<typeof acceptTermsSchema>;
