// DTO schemas for the redemption module.
// Canonical schema column mapping (P6-S0):
//   delivery_method → fulfilment_mode
//   is_active → status (redemption_catalog_status enum)
//   is_featured → is_featured (still canonical boolean)
//   fiat_currency → fiat_currency
//   sort_order → sort_order (still canonical)

import { z } from 'zod';

// ─── Shared ──────────────────────────────────────────────────────────────

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const idempotencyHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional();

// ─── Admin Catalog — Canonical Schema ───────────────────────────────────

export const adminCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
  itemType: z.enum(['PHYSICAL', 'DIGITAL_VOUCHER', 'SERVICE']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED']).optional(),
  isFeatured: z.coerce.boolean().optional(),
  fulfilmentMode: z
    .enum(['DELIVERY', 'PICKUP', 'DELIVERY_OR_PICKUP', 'DIGITAL', 'SERVICE'])
    .optional(),
  sort: z
    .enum([
      'name:asc',
      'name:desc',
      'createdAt:desc',
      'createdAt:asc',
      'sortOrder:asc',
    ])
    .default('createdAt:desc'),
});

export type AdminCatalogQueryDto = z.infer<typeof adminCatalogQuerySchema>;

// ─── Member Catalog ──────────────────────────────────────────────────────

export const memberCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
  itemType: z.enum(['PHYSICAL', 'DIGITAL_VOUCHER', 'SERVICE']).optional(),
  fulfilmentMode: z
    .enum(['DELIVERY', 'PICKUP', 'DELIVERY_OR_PICKUP', 'DIGITAL', 'SERVICE'])
    .optional(),
  sort: z
    .enum(['name:asc', 'name:desc', 'sortOrder:asc'])
    .default('sortOrder:asc'),
});

export type MemberCatalogQueryDto = z.infer<typeof memberCatalogQuerySchema>;

// ─── Rate Versions ───────────────────────────────────────────────────────

export const rateVersionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  rateType: z.enum(['POINTS_PER_CURRENCY', 'CURRENCY_PER_POINT']).optional(),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
});

export type RateVersionQueryDto = z.infer<typeof rateVersionQuerySchema>;

/**
 * Secured redemption rate owner create contract (D-053 §5-§8, §10-§11).
 *
 * The owner command re-enforces every control inside the service layer;
 * this transport schema provides the fast 400 boundary. `effectiveFrom`
 * must be the exact UTC instant of a strictly future market-local 00:00 in
 * the selected market's IANA timezone (resolved and verified inside the
 * owner). Versions are append-only and open-ended — effective ranges are
 * strictly increasing per market + rate type and never overlap
 * (D-050 pattern; effectiveUntil is intentionally not accepted). The
 * Idempotency-Key header is mandatory and injected by the controller.
 */
export const ownerRateCreateSchema = z
  .object({
    marketId: z.string().uuid({ message: 'A selected market is required' }),
    rateType: z.enum(['POINTS_PER_CURRENCY', 'CURRENCY_PER_POINT']),
    rateValue: z
      .string()
      .regex(
        /^\d+(\.\d{1,10})?$/u,
        'Must be a positive decimal with at most 10 decimals',
      ),
    fiatCurrency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    effectiveFrom: z
      .string()
      .datetime({ message: 'Must be a UTC ISO datetime' }),
    reason: z.string().trim().min(1, 'Reason is required').max(500),
  })
  .strict();

export type OwnerRateCreateDto = z.infer<typeof ownerRateCreateSchema>;

/**
 * Secured cancel contract (D-053 §9): the mandatory operator reason. The
 * Idempotency-Key header is mandatory and injected by the controller.
 */
export const ownerRateCancelSchema = z
  .object({
    reason: z.string().trim().min(1, 'Reason is required').max(500),
  })
  .strict();

export type OwnerRateCancelDto = z.infer<typeof ownerRateCancelSchema>;

// ─── Pickup Locations ────────────────────────────────────────────────────

export const pickupLocationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  isActive: z.coerce.boolean().optional(),
});

export type PickupLocationQueryDto = z.infer<typeof pickupLocationQuerySchema>;

// ─── Quote ───────────────────────────────────────────────────────────────

export const quoteQuerySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(99999).default(1),
});

export type QuoteQueryDto = z.infer<typeof quoteQuerySchema>;

export const createShippingPaymentSchema = z.object({
  quoteId: z.string().uuid(),
  amount: z.string().regex(/^\d+(?:\.\d{1,10})?$/),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/i),
  idempotencyKey: z.string().trim().min(1).max(255),
});

export type CreateShippingPaymentDto = z.infer<
  typeof createShippingPaymentSchema
>;

// ─── Path Param Schemas ───────────────────────────────────────────────────

export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export const itemIdParamSchema = z.object({
  itemId: z.string().uuid(),
});

export const marketIdParamSchema = z.object({
  marketId: z.string().uuid(),
});
