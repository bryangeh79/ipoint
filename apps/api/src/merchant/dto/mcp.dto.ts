import { z } from 'zod';

export const mcpAmount = z
  .string()
  .trim()
  .regex(/^\d{1,28}(?:\.\d{1,10})?$/, 'Amount must be an exact decimal string.')
  .refine((value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return (
      BigInt(whole) * 10_000_000_000n + BigInt(fraction.padEnd(10, '0')) > 0n
    );
  }, 'Amount must be greater than zero.');

export const createRechargeSchema = z
  .object({
    amount: mcpAmount,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export const reviewRechargeSchema = z
  .object({
    decision: z.enum(['COMPLETED', 'FAILED']),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export const ledgerQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type CreateRechargeDto = z.infer<typeof createRechargeSchema>;
export type ReviewRechargeDto = z.infer<typeof reviewRechargeSchema>;
export type LedgerQueryDto = z.infer<typeof ledgerQuerySchema>;
