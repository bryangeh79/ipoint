import { z } from 'zod';

/**
 * Phone number must be in E.164 format:
 * - Starts with +
 * - Followed by 1-3 digit country code
 * - Followed by subscriber number (6-14 digits total after +)
 * - Total length (with +): 8-15 digits
 */
const phoneRegex = /^\+[1-9]\d{6,14}$/;

export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .max(50)
      .transform((value) => {
        const trimmed = value.trim();
        return trimmed.length === 0 ? null : trimmed;
      })
      .refine(
        (value) => value === null || value.length >= 2,
        'Display name must be at least 2 characters.',
      )
      .optional()
      .nullable(),
    fullName: z.string().trim().optional().nullable(),
    phone: z
      .string()
      .regex(phoneRegex, 'Must be E.164 format.')
      .optional()
      .nullable(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD.')
      .optional()
      .nullable(),
    address: z.record(z.string(), z.unknown()).nullable().optional(),
    avatarObjectKey: z.string().optional().nullable(),
    language: z.string().optional().nullable(),
    locale: z.string().optional().nullable(),
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
