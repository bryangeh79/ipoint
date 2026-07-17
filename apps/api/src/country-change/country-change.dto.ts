import { z } from 'zod';

export const submitCountryChangeSchema = z
  .object({
    requested_country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/u, 'Must be a valid ISO 3166-1 alpha-2 country code'),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type SubmitCountryChangeDto = z.infer<typeof submitCountryChangeSchema>;
