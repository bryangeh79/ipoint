import { z } from 'zod';

/**
 * P7-S6A Admin Package Operations special-percentage create DTO
 * (frozen contract §7.3, D-051 §2/§6).
 *
 * Transport fast-fail boundary ONLY: field shapes are validated here
 * (exact-decimal rate grammar with at most six decimals and the locked
 * D-010 (0, 100] range, mandatory description, mandatory reason 1..500).
 * The schema is `.strict()` — actor-shaped fields (admin user id, market
 * selection, idempotency key) are rejected at the boundary and can never
 * reach the owner command; every control is re-enforced inside
 * `PackageService.createSpecialPercentage` (D-051).
 */

const decimalRate = z
  .string()
  .trim()
  .regex(
    /^\d{1,3}(?:\.\d{1,6})?$/u,
    'Rate must be a decimal string with at most 6 decimal places.',
  )
  .refine((value) => {
    if (!/^\d{1,3}(?:\.\d{1,6})?$/u.test(value)) return false;
    const [whole = '0', fraction = ''] = value.split('.');
    const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    return scaled > 0n && scaled <= 100_000_000n;
  }, 'Rate must be greater than 0 and less than or equal to 100.');

export const createSpecialPercentageSchema = z
  .object({
    /** Exact decimal string (numeric(12,6) compatible), (0, 100], ≤6dp. */
    rate: decimalRate,
    /** Human-readable label of the special percentage (1..2000 chars). */
    description: z.string().trim().min(1).max(2000),
    /**
     * Mandatory operator reason (frozen contract §7.3, D-051 §2).
     * Trimmed, non-blank (whitespace-only fails min(1) after trim),
     * 1..500 characters — the same contract the owner enforces.
     */
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type CreateSpecialPercentageDto = z.infer<
  typeof createSpecialPercentageSchema
>;
