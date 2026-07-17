import { z } from 'zod';

export const updateMarketSchema = z
  .object({
    marketId: z.string().uuid('Must be a valid market ID.'),
  })
  .strict();

export type UpdateMarketDto = z.infer<typeof updateMarketSchema>;
