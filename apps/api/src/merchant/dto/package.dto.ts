import { z } from 'zod';

const decimalRate = z
  .string()
  .trim()
  .regex(/^\d{1,3}(?:\.\d{1,6})?$/, 'Rate must be a decimal string.')
  .refine((value) => {
    if (!/^\d{1,3}(?:\.\d{1,6})?$/.test(value)) return false;
    const [whole = '0', fraction = ''] = value.split('.');
    const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    return scaled > 0n && scaled <= 100_000_000n;
  }, 'Rate must be greater than 0 and less than or equal to 100.');

export const createPackageProfileSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,32}$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export const createPackageVersionSchema = z
  .object({
    rate: decimalRate,
    effective_from: z.iso.datetime({ offset: true }),
    effective_to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const updatePackageVersionSchema = createPackageVersionSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field is required.',
  );

export const createSpecialPercentageSchema = z
  .object({
    rate: decimalRate,
    description: z.string().trim().min(1).max(2000),
  })
  .strict();

export const assignPackageSchema = z
  .object({
    service_fee_version_id: z.uuid().optional(),
    special_percentage_id: z.uuid().optional(),
    is_default: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      Number(Boolean(value.service_fee_version_id)) +
        Number(Boolean(value.special_percentage_id)) ===
      1,
    'Exactly one package source is required.',
  );

export const packageChangeRequestSchema = z
  .object({
    service_fee_version_id: z.uuid(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type CreatePackageProfileDto = z.infer<
  typeof createPackageProfileSchema
>;
export type CreatePackageVersionDto = z.infer<
  typeof createPackageVersionSchema
>;
export type UpdatePackageVersionDto = z.infer<
  typeof updatePackageVersionSchema
>;
export type CreateSpecialPercentageDto = z.infer<
  typeof createSpecialPercentageSchema
>;
export type AssignPackageDto = z.infer<typeof assignPackageSchema>;
export type PackageChangeRequestDto = z.infer<
  typeof packageChangeRequestSchema
>;
