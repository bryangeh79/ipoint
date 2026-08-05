// Commission rate owner DTO schemas (D-054, CG-04 gate).
//
// Transport fast-fail boundary only — every control is re-enforced inside
// `RateManagementService.createRateVersion`. Mirrors the accepted D-053
// `ownerRateCreateSchema` (zod, strict).

import { z } from 'zod';

/**
 * Secured commission-rate owner create contract (D-054 §5-§12).
 *
 * `effectiveFrom` must be the exact UTC instant of a strictly future
 * market-local 00:00 in the selected market's IANA timezone (resolved and
 * verified inside the owner). `effectiveUntil` is optional (NULL =
 * open-ended; half-open windows; a successor may start exactly at its
 * predecessor's stored end). The Idempotency-Key header is mandatory and
 * injected by the controller; the operator `reason` is mandatory.
 */
export const ownerRateCreateSchema = z
  .object({
    market: z
      .string()
      .regex(/^[A-Za-z]{2}$/u, 'Must be a 2-letter market code')
      .transform((value) => value.toUpperCase()),
    commissionType: z.enum([
      'AGENT_UPGRADE',
      'MEMBER_CONSUMPTION',
      'MERCHANT_RECRUITMENT',
      'AGENT_ACTIVATION_FEE',
    ]),
    generation: z.number().int(),
    rateValue: z
      .string()
      .regex(
        /^\d+(\.\d{1,10})?$/u,
        'Must be a non-negative decimal with at most 10 decimals',
      ),
    rateType: z.enum(['PERCENTAGE', 'FIXED']),
    effectiveFrom: z
      .string()
      .datetime({ message: 'Must be a UTC ISO datetime' }),
    effectiveUntil: z
      .string()
      .datetime({ message: 'Must be a UTC ISO datetime' })
      .nullish()
      .transform((value) => value ?? null),
    timezone: z.string().trim().min(1).max(64).optional(),
    reason: z.string().trim().min(1, 'Reason is required').max(500),
  })
  .strict();

export type OwnerRateCreateDto = z.infer<typeof ownerRateCreateSchema>;
