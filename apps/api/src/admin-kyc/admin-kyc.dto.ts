import { z } from 'zod';

const kycStatuses = [
  'NOT_STARTED',
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'MORE_INFO_REQUIRED',
  'REVERIFICATION_REQUIRED',
] as const;

const optionalDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();

export const kycCaseFilterDto = z
  .object({
    status: z.enum(kycStatuses).optional(),
    marketId: z.string().uuid().optional(),
    dateFrom: optionalDate,
    dateTo: optionalDate,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(
    (value) =>
      !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    { message: 'dateFrom must not be after dateTo.', path: ['dateFrom'] },
  );

const reasonSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export const startReviewSchema = reasonSchema;
export const requestMoreInfoSchema = reasonSchema;
export const approveSchema = reasonSchema;
export const rejectSchema = reasonSchema;
export const requireReverificationSchema = reasonSchema;

export type KycCaseFilterDto = z.infer<typeof kycCaseFilterDto>;
export type StartReviewDto = z.infer<typeof startReviewSchema>;
export type RequestMoreInfoDto = z.infer<typeof requestMoreInfoSchema>;
export type ApproveDto = z.infer<typeof approveSchema>;
export type RejectDto = z.infer<typeof rejectSchema>;
export type RequireReverificationDto = z.infer<
  typeof requireReverificationSchema
>;
export type AdminKycActionDto = StartReviewDto;
