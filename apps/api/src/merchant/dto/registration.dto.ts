import { z } from 'zod';

export const addressSchema = z
  .object({
    line_1: z.string().trim().min(1).max(200),
    line_2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    postcode: z.string().trim().min(1).max(20),
    country_code: z.string().trim().length(2).toUpperCase(),
  })
  .strict();

export const registerMerchantSchema = z
  .object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(12).max(256),
    otp_id: z.uuid(),
    otp_code: z.string().trim().min(4).max(12),
    market_id: z.uuid(),
    account_country: z.string().trim().length(2).toUpperCase(),
    channel: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]{1,12}$/u),
    display_name: z.string().trim().min(1).max(160),
    group_name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    address: addressSchema.optional(),
    referral_account_id: z.uuid().optional(),
    terms_version: z.string().trim().min(1).max(80),
    locale: z.string().trim().min(2).max(35).optional(),
  })
  .strict();

export type RegisterMerchantDto = z.infer<typeof registerMerchantSchema>;
