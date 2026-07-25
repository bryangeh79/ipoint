import { z } from 'zod';

/**
 * Schema for registering a referral during member registration.
 */
export const registerReferralSchema = z.object({
  referralCode: z.string().min(1).max(50),
});

/**
 * Schema for querying the referral tree.
 */
export const referralTreeQuerySchema = z.object({
  depth: z.coerce.number().min(1).max(5).default(2).optional(),
});

export type RegisterReferralDto = z.infer<typeof registerReferralSchema>;
export type ReferralTreeQueryDto = z.infer<typeof referralTreeQuerySchema>;
