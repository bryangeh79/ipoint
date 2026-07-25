import { z } from 'zod';

// ─── Member-facing schemas ────────────────────────────────────────

export const applySchema = z
  .object({
    market: z.string().trim().min(1).max(10),
  })
  .strict();

export const confirmPaymentSchema = z
  .object({
    activationId: z.string().uuid(),
    paymentReference: z.string().trim().min(1).max(255),
  })
  .strict();

export const enrollCourseSchema = z
  .object({
    activationId: z.string().uuid(),
  })
  .strict();

export const completeCourseSchema = z
  .object({
    activationId: z.string().uuid(),
  })
  .strict();

export const submitApprovalSchema = z
  .object({
    activationId: z.string().uuid(),
  })
  .strict();

export const statusQuerySchema = z
  .object({
    market: z.string().trim().min(1).max(10).optional(),
  })
  .strict();

// ─── Admin schemas ────────────────────────────────────────────────

export const rejectSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const suspendSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const deactivateSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

// ─── Inferred DTO types ───────────────────────────────────────────

export type ApplyDto = z.infer<typeof applySchema>;
export type ConfirmPaymentDto = z.infer<typeof confirmPaymentSchema>;
export type EnrollCourseDto = z.infer<typeof enrollCourseSchema>;
export type CompleteCourseDto = z.infer<typeof completeCourseSchema>;
export type SubmitApprovalDto = z.infer<typeof submitApprovalSchema>;
export type StatusQueryDto = z.infer<typeof statusQuerySchema>;
export type RejectDto = z.infer<typeof rejectSchema>;
export type SuspendDto = z.infer<typeof suspendSchema>;
export type DeactivateDto = z.infer<typeof deactivateSchema>;
