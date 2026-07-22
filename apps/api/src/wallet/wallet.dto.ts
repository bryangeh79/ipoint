import { z } from 'zod';

export const walletEntryTypeSchema = z.enum([
  'PENDING',
  'AVAILABLE',
  'REVERSED',
  'COMPENSATION',
  'ADJUSTMENT',
]);

export const createLedgerEntrySchema = z
  .object({
    memberId: z.string().uuid('Must be a valid member ID.'),
    marketId: z.string().uuid('Must be a valid market ID.'),
    entryType: walletEntryTypeSchema,
    amount: z
      .string()
      .regex(
        /^\d+(\.\d{1,10})?$/,
        'Must be a positive numeric string with up to 10 decimal places.',
      ),
    idempotencyKey: z.string().min(1).max(255),
    referenceType: z.string().min(1).max(100).optional(),
    referenceId: z.string().min(1).max(255).optional(),
    description: z.string().max(500).optional(),
    reason: z.string().max(1000).optional(),
    actorId: z.string().max(255).optional(),
    marketTimezone: z.string().max(100).optional(),
  })
  .strict();

export type CreateLedgerEntryDto = z.infer<typeof createLedgerEntrySchema>;

export const paginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type PaginationQueryDto = z.infer<typeof paginationQuerySchema>;
