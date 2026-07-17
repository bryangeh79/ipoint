import { z } from 'zod';

export const merchantDocumentTypes = [
  'business_registration',
  'pic_identity',
  'pic_address_proof',
  'bank_statement',
  'financial_statement',
  'operating_license',
  'memorandum_articles',
  'board_resolution',
  'others',
] as const;

const uuid = z.string().uuid();
const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const submitMerchantKycSchema = z
  .object({
    business_certification: z
      .object({
        registration_number: requiredText(200),
        business_name_registered: requiredText(500),
        business_type: z.enum([
          'sole_proprietorship',
          'partnership',
          'private_limited',
          'public_limited',
          'others',
        ]),
        tax_id: requiredText(200),
        registered_address: requiredText(2000),
        proof_of_registration_document_id: uuid,
      })
      .strict(),
    pic_identity: z
      .object({
        full_name: requiredText(500),
        identity_type: z.enum(['nric', 'passport', 'others']),
        identity_number: requiredText(200),
        date_of_birth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/u, 'date_of_birth must be YYYY-MM-DD')
          .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
            message: 'date_of_birth must be a valid date',
          }),
        nationality: requiredText(100),
        proof_of_identity_document_id: uuid,
        proof_of_address_document_id: uuid,
      })
      .strict(),
    pic_contact: z
      .object({
        email: z.string().trim().email().max(320),
        phone: requiredText(50),
      })
      .strict(),
  })
  .strict();

export const createMerchantDocumentIntentSchema = z
  .object({
    document_type: z.enum(merchantDocumentTypes),
    file_name: requiredText(500),
    mime_type: z
      .string()
      .trim()
      .max(255)
      .refine(
        (value) => value.startsWith('image/') || value === 'application/pdf',
        'Only image/* and application/pdf are allowed.',
      ),
    file_size_bytes: z
      .number()
      .int()
      .positive()
      .max(15 * 1024 * 1024),
    content_hash: z.string().regex(/^[a-fA-F0-9]{64}$/u),
  })
  .strict();

export const merchantKycQueueSchema = z
  .object({
    status: z
      .enum(['SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const reviewMerchantKycSchema = z
  .object({
    decision: z
      .enum([
        'APPROVED',
        'REJECTED',
        'RESUBMISSION_REQUIRED',
        'approved',
        'rejected',
        'resubmission_required',
      ])
      .transform((value) => value.toUpperCase() as MerchantKycDecision),
    reason: requiredText(2000),
    rejected_fields: z.array(requiredText(200)).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.decision === 'RESUBMISSION_REQUIRED' &&
      value.rejected_fields.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rejected_fields'],
        message: 'At least one rejected field is required for resubmission.',
      });
    }
  });

export type MerchantKycDecision =
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMISSION_REQUIRED';
export type SubmitMerchantKycDto = z.infer<typeof submitMerchantKycSchema>;
export type CreateMerchantDocumentIntentDto = z.infer<
  typeof createMerchantDocumentIntentSchema
>;
export type MerchantKycQueueDto = z.infer<typeof merchantKycQueueSchema>;
export type ReviewMerchantKycDto = z.infer<typeof reviewMerchantKycSchema>;
