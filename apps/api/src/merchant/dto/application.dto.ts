import { z } from 'zod';

export const submitMerchantApplicationSchema = z
  .object({
    application_data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const reviewMerchantApplicationSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED']),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export const merchantApplicationQueueSchema = z
  .object({
    status: z
      .enum([
        'SUBMITTED',
        'UNDER_REVIEW',
        'RESUBMISSION_REQUIRED',
        'APPROVED',
        'REJECTED',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const merchantStatusActionSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export type SubmitMerchantApplicationDto = z.infer<
  typeof submitMerchantApplicationSchema
>;
export type ReviewMerchantApplicationDto = z.infer<
  typeof reviewMerchantApplicationSchema
>;
export type MerchantApplicationQueueDto = z.infer<
  typeof merchantApplicationQueueSchema
>;
export type MerchantStatusActionDto = z.infer<
  typeof merchantStatusActionSchema
>;
