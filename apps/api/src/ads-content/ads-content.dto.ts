import { z } from 'zod';
import { ADS_CONTENT_STATUSES } from './ads-content.types.js';

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Only HTTP(S) URLs are allowed.',
  });
const nullableHttpUrl = httpUrl.nullable().optional();
const utcDate = z.string().datetime({ offset: true });
const nullableDate = utcDate.nullable().optional();
const reason = z.string().trim().min(1).max(500);

export const adsContentListQuerySchema = z
  .object({
    status: z.enum(ADS_CONTENT_STATUSES).optional(),
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type AdsContentListQueryDto = z.infer<typeof adsContentListQuerySchema>;

export const createPlacementSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Z0-9_]+$/u),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(500).nullable().optional(),
    position: z.number().int().min(0).max(10_000).default(0),
    reason,
  })
  .strict();
export type CreatePlacementDto = z.infer<typeof createPlacementSchema>;

export const createAdSchema = z
  .object({
    placementId: z.string().uuid(),
    feeConfigId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(180),
    summary: z.string().trim().max(500).nullable().optional(),
    creativeMediaUrl: httpUrl,
    creativeAltText: z.string().trim().min(1).max(240),
    targetUrl: nullableHttpUrl,
    isSponsored: z.literal(true).default(true),
    // Explicit nonblank disclosure label: the operator/client must supply the
    // market-appropriate label. There is deliberately no server default, so a
    // missing or blank value is rejected instead of silently publishing an
    // English fallback in another locale. A UI may prefill a localized
    // suggestion, but the submitted field must be explicit.
    sponsorLabel: z.string().trim().min(1).max(80),
    scheduleStartAt: nullableDate,
    scheduleEndAt: nullableDate,
    reason,
  })
  .strict();
export type CreateAdDto = z.infer<typeof createAdSchema>;

export const updateAdSchema = createAdSchema
  .omit({ placementId: true, reason: true, isSponsored: true })
  .partial()
  .extend({
    placementId: z.string().uuid().optional(),
    isSponsored: z.literal(true).optional(),
    expectedVersion: z.number().int().positive(),
    reason,
  })
  .strict();
export type UpdateAdDto = z.infer<typeof updateAdSchema>;

export const createArticleSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    title: z.string().trim().min(1).max(180),
    excerpt: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(50_000),
    coverMediaUrl: nullableHttpUrl,
    coverAltText: z.string().trim().min(1).max(240).nullable().optional(),
    isPromoted: z.boolean().default(false),
    sponsorLabel: z.string().trim().min(1).max(80).nullable().optional(),
    publishAt: nullableDate,
    unpublishAt: nullableDate,
    reason,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.isPromoted && !value.sponsorLabel) {
      ctx.addIssue({
        code: 'custom',
        path: ['sponsorLabel'],
        message: 'Promoted content requires a sponsor label.',
      });
    }
    if (value.coverMediaUrl && !value.coverAltText) {
      ctx.addIssue({
        code: 'custom',
        path: ['coverAltText'],
        message: 'Cover media requires alternative text.',
      });
    }
  });
export type CreateArticleDto = z.infer<typeof createArticleSchema>;

export const updateArticleSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .optional(),
    title: z.string().trim().min(1).max(180).optional(),
    excerpt: z.string().trim().min(1).max(500).optional(),
    body: z.string().trim().min(1).max(50_000).optional(),
    coverMediaUrl: nullableHttpUrl,
    coverAltText: z.string().trim().min(1).max(240).nullable().optional(),
    isPromoted: z.boolean().optional(),
    sponsorLabel: z.string().trim().min(1).max(80).nullable().optional(),
    publishAt: nullableDate,
    unpublishAt: nullableDate,
    expectedVersion: z.number().int().positive(),
    reason,
  })
  .strict();
export type UpdateArticleDto = z.infer<typeof updateArticleSchema>;

export const transitionSchema = z
  .object({
    status: z.enum(ADS_CONTENT_STATUSES),
    expectedVersion: z.number().int().positive(),
    reason,
  })
  .strict();
export type TransitionDto = z.infer<typeof transitionSchema>;
