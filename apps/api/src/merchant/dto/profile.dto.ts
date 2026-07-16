import { z } from 'zod';
import { addressSchema } from './registration.dto.js';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
const intervalSchema = z
  .object({ opens: timeSchema, closes: timeSchema })
  .strict();
const daySchema = z.array(intervalSchema).max(4);

export const businessHoursSchema = z
  .object({
    monday: daySchema.optional(),
    tuesday: daySchema.optional(),
    wednesday: daySchema.optional(),
    thursday: daySchema.optional(),
    friday: daySchema.optional(),
    saturday: daySchema.optional(),
    sunday: daySchema.optional(),
  })
  .strict();

const nullableObjectKey = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !value.includes('://'), 'Expected an opaque object key.')
  .nullable();

export const updateMerchantProfileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().min(3).max(40).nullable().optional(),
    address: addressSchema.nullable().optional(),
    about: z.string().trim().max(1000).nullable().optional(),
    business_hours: businessHoursSchema.nullable().optional(),
    website: z.url().max(500).nullable().optional(),
    whatsapp: z.string().trim().min(3).max(80).nullable().optional(),
    socials: z
      .record(z.string().trim().min(1).max(40), z.url().max(500))
      .nullable()
      .optional(),
    logo_object_key: nullableObjectKey.optional(),
    banner_object_key: nullableObjectKey.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required.',
  });

export const addGalleryEntrySchema = z
  .object({
    object_key: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine(
        (value) => !value.includes('://'),
        'Expected an opaque object key.',
      ),
    position: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();

export type UpdateMerchantProfileDto = z.infer<
  typeof updateMerchantProfileSchema
>;
export type AddGalleryEntryDto = z.infer<typeof addGalleryEntrySchema>;
