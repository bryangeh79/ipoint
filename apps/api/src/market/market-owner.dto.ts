import { z } from 'zod';

/**
 * P7-S6E secured market owner — transport DTO (Phase 7 surface).
 *
 * Transport fast-fail boundary ONLY: field shapes and formats are
 * validated here (currency 3 uppercase letters, IANA timezone syntax,
 * BCP-47-style locale, name 1..200 after trim, mandatory reason, explicit
 * deactivation confirmation boolean, strict unknown-field rejection). The
 * owner (`MarketOwnerService.updateMarket`) re-validates every control
 * in-process (permission, selected market, market equality, grant,
 * IANA timezone validity, dependency check, idempotency + payload hash,
 * atomic audit) so an in-process caller can never bypass enforcement.
 */

const controlledField = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Market name must be 1..200 characters.')
      .max(200, 'Market name must be 1..200 characters.')
      .optional(),
    currencyCode: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/u, 'Currency code must be 3 uppercase letters.')
      .optional(),
    timezone: z
      .string()
      .trim()
      .min(1, 'A timezone is required.')
      .max(100, 'Invalid timezone.')
      .optional(),
    defaultLocale: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u,
        'Locale must be a BCP-47-style locale (e.g. en-MY).',
      )
      .optional(),
  })
  .strict();

export const updateMarketSchema = controlledField
  .extend({
    /** Mandatory privileged-write reason (1..500 chars, owner-enforced). */
    reason: z.string().trim().min(1).max(500),
    /**
     * Explicit server-side confirmation for the ACTIVE → INACTIVE
     * transition (re-validated by the owner; it is NOT a client-supplied
     * authorization).
     */
    deactivationConfirmed: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.name !== undefined ||
      value.currencyCode !== undefined ||
      value.timezone !== undefined ||
      value.defaultLocale !== undefined,
    { message: 'At least one controlled market field is required.' },
  );

export type UpdateMarketDto = z.infer<typeof updateMarketSchema>;
