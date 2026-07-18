import { z } from 'zod';

const optionalBoolean = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}, z.boolean().optional());

const latitudeSchema = z.coerce.number().finite().min(-90).max(90);
const longitudeSchema = z.coerce.number().finite().min(-180).max(180);
const radiusSchema = z.coerce.number().finite().positive().max(50);
const optionalText = z.string().trim().min(1).max(200).optional();

export const merchantListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    query: optionalText,
    category: optionalText,
    merchantType: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
    isOnline: optionalBoolean,
    isOffline: optionalBoolean,
    city: optionalText,
    region: optionalText,
    openNow: optionalBoolean,
    sort: z
      .enum(['relevance', 'newest', 'name', 'distance'])
      .default('relevance'),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    radius: radiusSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: 'custom',
        path: hasLatitude ? ['longitude'] : ['latitude'],
        message: 'Latitude and longitude must be provided together.',
      });
    }
    if (
      (value.radius !== undefined || value.sort === 'distance') &&
      !hasLatitude
    ) {
      context.addIssue({
        code: 'custom',
        path: ['latitude'],
        message: 'Coordinates are required for radius or distance sorting.',
      });
    }
  });

export const merchantNearbyQuerySchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    radius: radiusSchema.default(5),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    category: optionalText,
  })
  .strict();

export type MerchantListQuery = z.infer<typeof merchantListQuerySchema>;
export type MerchantNearbyQuery = z.infer<typeof merchantNearbyQuerySchema>;
