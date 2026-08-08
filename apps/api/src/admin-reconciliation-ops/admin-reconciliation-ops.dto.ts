import { z } from 'zod';
import {
  RECONCILIATION_CLASSIFICATIONS,
  RECONCILIATION_EXCEPTION_STATUSES,
  RECONCILIATION_KINDS,
  RECONCILIATION_RUN_STATUSES,
} from './admin-reconciliation-ops.types.js';

const utcDate = z.string().datetime({ offset: true });
const reason = z.string().trim().min(1).max(500);
const notes = z.string().trim().min(1).max(10_000);
const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(1).max(200);

export const createRunSchema = z
  .object({
    kind: z.enum(RECONCILIATION_KINDS),
    windowStart: utcDate,
    windowEnd: utcDate,
    reason,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.windowStart);
    const end = Date.parse(value.windowEnd);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['windowEnd'],
        message: 'windowEnd must be later than windowStart.',
      });
    }
  });
export type CreateRunDto = z.infer<typeof createRunSchema>;

export const listRunsQuerySchema = z
  .object({
    kind: z.enum(RECONCILIATION_KINDS).optional(),
    status: z.enum(RECONCILIATION_RUN_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListRunsQueryDto = z.infer<typeof listRunsQuerySchema>;

export const listExceptionsQuerySchema = z
  .object({
    kind: z.enum(RECONCILIATION_KINDS).optional(),
    status: z.enum(RECONCILIATION_EXCEPTION_STATUSES).optional(),
    classification: z.enum(RECONCILIATION_CLASSIFICATIONS).optional(),
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListExceptionsQueryDto = z.infer<typeof listExceptionsQuerySchema>;

export const exceptionActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason,
  })
  .strict();
export type ExceptionActionDto = z.infer<typeof exceptionActionSchema>;

export const exceptionNotesSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    notes,
    reason,
  })
  .strict();
export type ExceptionNotesDto = z.infer<typeof exceptionNotesSchema>;

export const idempotencyKeyHeaderSchema = z.object({
  idempotencyKey: idempotencyKey.optional(),
});
export type IdempotencyKeyHeaderDto = z.infer<
  typeof idempotencyKeyHeaderSchema
>;

export { uuid, reason, notes, idempotencyKey };
