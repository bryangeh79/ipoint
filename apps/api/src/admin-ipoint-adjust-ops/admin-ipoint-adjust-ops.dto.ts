import { z } from 'zod';

/**
 * P7-S7B Admin iPoint Adjustment Operations DTOs (SEC-01 §6 / P7-S1 §17).
 *
 * Transport fast-fail boundary ONLY: field shapes are validated here
 * (exact-decimal amount grammar, evidence lengths, decision enum). The
 * cross-field business controls (caps routing, reason-code catalog
 * membership, attachment rules, Maker≠Checker inequality, idempotency
 * payload hashing) are deliberately NOT duplicated in the adapter — they
 * are the frozen SEC-01 owner's enforcement and surface with the owner
 * error codes mapped at the HTTP boundary.
 */

/** Exact positive decimal, at most 10 decimal places (owner grammar). */
export const ipointAdjustmentAmount = z
  .string()
  .trim()
  .regex(
    /^\d+(?:\.\d{1,10})?$/u,
    'Must be a positive exact decimal string with at most 10 decimal places.',
  )
  .refine((value) => !/^0+(?:\.0+)?$/u.test(value), {
    message: 'Must be greater than zero.',
  });

export const createIpointAdjustmentSchema = z
  .object({
    walletAccountId: z.string().uuid(),
    direction: z.enum(['CREDIT', 'DEBIT']),
    amount: ipointAdjustmentAmount,
    reasonCode: z.string().trim().min(1).max(100),
    explanation: z.string().trim().min(1).max(2000),
    caseReference: z.string().trim().min(1).max(200),
    // Opaque attachment reference (never contents; ≤500 chars).
    attachmentReference: z.string().trim().min(1).max(500).optional(),
    // P7-OD-18 replacement linkage: the prior immutable REJECTED request.
    priorRequestId: z.string().uuid().optional(),
  })
  .strict();

export const ipointAdjustmentDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(2000),
    // Checker explicitly requires an opaque attachment reference (P7-OD-11).
    requireAttachment: z.boolean().optional().default(false),
  })
  .strict();

export const ipointAdjustmentQueueQuerySchema = z
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
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const ipointWalletLookupQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type CreateIpointAdjustmentDto = z.infer<
  typeof createIpointAdjustmentSchema
>;
export type IpointAdjustmentDecisionDto = z.infer<
  typeof ipointAdjustmentDecisionSchema
>;
export type IpointAdjustmentQueueQueryDto = z.infer<
  typeof ipointAdjustmentQueueQuerySchema
>;
export type IpointWalletLookupQueryDto = z.infer<
  typeof ipointWalletLookupQuerySchema
>;
