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

export const adjustmentQueueQuerySchema = z
  .object({
    state: z
      .enum([
        'DRAFT',
        'SUBMITTED',
        'APPROVED',
        'REJECTED',
        'EXECUTING',
        'EXECUTED',
        'FAILED',
        'PENDING_APPROVAL',
        'CANCELLED',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const createAdjustmentSchema = z
  .object({
    type: z.enum(['MANUAL_CREDIT', 'MANUAL_DEBIT']),
    amount: mcpAmount,
    // P7-S7A D-046 evidence contract (P7-OD-11): reason code (market-scoped
    // catalog) + detailed explanation + case/ticket reference; an opaque
    // attachment reference is mandatory above the soft cap, for high-risk
    // reason codes, or when the checker requests it.
    reasonCode: z.string().trim().min(1).max(100),
    explanation: z.string().trim().min(1).max(2000),
    caseReference: z.string().trim().min(1).max(200),
    attachmentReference: z.string().trim().min(1).max(500).optional(),
    // P7-OD-18 replacement linkage: the prior REJECTED request id.
    priorRequestId: z.string().uuid().optional(),
  })
  .strict();

export const adjustmentDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(2000),
    // Checker explicitly requires an opaque attachment reference (P7-OD-11).
    requireAttachment: z.boolean().optional().default(false),
  })
  .strict();

export const adjustmentActionSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export const createRefundSchema = z
  .object({
    amount: mcpAmount,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export const reviewRefundSchema = z
  .object({
    decision: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type CreateRechargeDto = z.infer<typeof createRechargeSchema>;
export type ReviewRechargeDto = z.infer<typeof reviewRechargeSchema>;
export type LedgerQueryDto = z.infer<typeof ledgerQuerySchema>;
export type AdjustmentQueueQueryDto = z.infer<
  typeof adjustmentQueueQuerySchema
>;
export type CreateAdjustmentDto = z.infer<typeof createAdjustmentSchema>;
export type AdjustmentDecisionDto = z.infer<typeof adjustmentDecisionSchema>;
export type CreateRefundDto = z.infer<typeof createRefundSchema>;
export type ReviewRefundDto = z.infer<typeof reviewRefundSchema>;
