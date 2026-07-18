import { z } from 'zod';

const memberStatuses = [
  'PENDING_EMAIL_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
] as const;
const kycLevels = ['NONE', 'LEVEL_1', 'LEVEL_2'] as const;
const optionalDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();
const idempotencyKey = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(1).max(500);

export const memberListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    query: z.string().trim().min(1).max(200).optional(),
    status: z.enum(memberStatuses).optional(),
    kycLevel: z.enum(kycLevels).optional(),
    marketId: z.string().uuid().optional(),
    createdAfter: optionalDate,
    createdBefore: optionalDate,
    sort: z
      .enum([
        'createdAt:desc',
        'createdAt:asc',
        'publicMemberId:asc',
        'publicMemberId:desc',
      ])
      .default('createdAt:desc'),
  })
  .strict()
  .refine(
    (value) =>
      !value.createdAfter ||
      !value.createdBefore ||
      value.createdAfter <= value.createdBefore,
    {
      message: 'createdAfter must not be after createdBefore.',
      path: ['createdAfter'],
    },
  );

export const notesListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const suspendMemberSchema = z
  .object({ reason, idempotencyKey })
  .strict();
export const reactivateMemberSchema = suspendMemberSchema;
export const closeMemberSchema = z
  .object({
    reason,
    confirmationText: z.literal('CONFIRM'),
    idempotencyKey,
  })
  .strict();
export const revokeSessionsSchema = suspendMemberSchema;
export const requireReverificationSchema = suspendMemberSchema;
export const addAdminNoteSchema = z
  .object({
    content: z.string().trim().min(1).max(5000),
    isInternal: z.boolean().default(false),
    idempotencyKey,
  })
  .strict();

export type MemberListQueryDto = z.infer<typeof memberListQuerySchema>;
export type NotesListQueryDto = z.infer<typeof notesListQuerySchema>;
export type SuspendMemberDto = z.infer<typeof suspendMemberSchema>;
export type ReactivateMemberDto = z.infer<typeof reactivateMemberSchema>;
export type CloseMemberDto = z.infer<typeof closeMemberSchema>;
export type RevokeSessionsDto = z.infer<typeof revokeSessionsSchema>;
export type RequireReverificationDto = z.infer<
  typeof requireReverificationSchema
>;
export type AddAdminNoteDto = z.infer<typeof addAdminNoteSchema>;
