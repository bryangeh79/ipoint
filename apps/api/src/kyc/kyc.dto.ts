import { z } from 'zod';

export const kycDocumentTypes = [
  'IDENTITY_FRONT',
  'IDENTITY_BACK',
  'PASSPORT',
  'PROOF_OF_ADDRESS',
  'SELFIE',
  'OTHER',
] as const;

export const kycIdentificationTypes = [
  'PASSPORT',
  'NATIONAL_ID',
  'DRIVING_LICENSE',
  'RESIDENCE_PERMIT',
  'OTHER',
] as const;

const idempotencyKey = z.string().trim().min(1).max(200);
const isoCountryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/u)
  .transform((value) => value.toUpperCase());
const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'dateOfBirth must be YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date <= new Date();
  }, 'dateOfBirth must be a valid date that is not in the future');
const residentialAddress = z
  .record(z.string().trim().min(1).max(100), z.string().trim().min(1).max(500))
  .refine((value) => Object.keys(value).length > 0, 'Address cannot be empty.');

export const createKycDraftSchema = z
  .object({ idempotencyKey: idempotencyKey.optional() })
  .strict();

export const updateKycDraftSchema = z
  .object({
    legalFullName: z.string().trim().min(1).max(500).optional(),
    identificationType: z.enum(kycIdentificationTypes).optional(),
    identificationNumber: z.string().trim().min(1).max(200).optional(),
    dateOfBirth: dateOfBirth.optional(),
    nationality: isoCountryCode.optional(),
    residentialAddress: residentialAddress.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one KYC field must be provided.',
  });

export const submitKycSchema = z.object({ idempotencyKey }).strict();

export const resubmitKycSchema = z.object({ idempotencyKey }).strict();

export const createDocumentSchema = z
  .object({
    documentType: z.enum(kycDocumentTypes),
    mimeType: z.string().trim().min(1).max(255),
    size: z.number().int().positive(),
    checksum: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{64}$/u),
  })
  .strict();

export type CreateKycDraftDto = z.infer<typeof createKycDraftSchema>;
export type UpdateKycDraftDto = z.infer<typeof updateKycDraftSchema>;
export type SubmitKycDto = z.infer<typeof submitKycSchema>;
export type ResubmitKycDto = z.infer<typeof resubmitKycSchema>;
export type CreateDocumentDto = z.infer<typeof createDocumentSchema>;
