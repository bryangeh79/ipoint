import { z } from 'zod';

const phoneRegex = /^\+[1-9]\d{6,14}$/;

export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .refine((v) => v.trim().length > 0, 'Cannot be pure whitespace.')
      .optional(),
    fullName: z.string().trim().optional(),
    phone: z.string().regex(phoneRegex, 'Must be E.164 format.').optional(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD.')
      .optional(),
    address: z.record(z.string(), z.unknown()).nullable().optional(),
    avatarObjectKey: z.string().optional(),
    language: z.string().optional(),
    locale: z.string().optional(),
    marketingOptIn: z.boolean().optional(),
    gender: z.enum(['male', 'female', 'prefer_not_to_say'] as const).optional(),
    country: z.undefined({
      message: 'Country cannot be modified via Profile API.',
    }),
    account_country: z.undefined({
      message: 'Country cannot be modified via Profile API.',
    }),
  })
  .strict();

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
