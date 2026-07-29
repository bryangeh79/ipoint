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
