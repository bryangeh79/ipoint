import { z } from 'zod';
import { REDEMPTION_RATE_TECHNICAL_DECIMALS } from './admin-redemption-ops.types.js';

/**
 * P7-S6C Admin Redemption Rate Configuration DTOs (frozen contract §7.2).
 *
 * The rate is an exact decimal string in local currency per 1 iPoint with
 * at most ten input decimals (`^\d+(\.\d{1,10})?$` — the §7.2 technical
 * ceiling). The per-market minimum/maximum bounds are policy validations
 * enforced by the secured Phase 6 owner inside its command (D-053 §6) —
 * the transport grammar only guarantees the exact-decimal shape.
 * `effective_date` is the market-local calendar date (`YYYY-MM-DD`) of the
 * activation; the server resolves the market-local `00:00` of that date to
 * the exact UTC instant using the market's IANA timezone. Same-day or
 * backdated dates are rejected by the owner — versions are strictly
 * future-effective and history is immutable.
 */

export const createRedemptionRateSchema = z
  .object({
    /** Exact decimal string (local currency per 1 iPoint), ≤10 decimals. */
    rate_value: z
      .string()
      .trim()
      .regex(
        /^\d+(\.\d{1,10})?$/u,
        `Must be a non-negative decimal string with at most ${REDEMPTION_RATE_TECHNICAL_DECIMALS} decimal places.`,
      ),
    /** Market-local calendar date (YYYY-MM-DD) of the activation 00:00. */
    effective_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Must be a YYYY-MM-DD market-local date.'),
    /** Mandatory privileged-write reason (§7 / §15). */
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type CreateRedemptionRateDto = z.infer<
  typeof createRedemptionRateSchema
>;

/**
 * Cancel DTO: the mandatory operator reason (1..500 chars, D-053 §9/§11 —
 * the secured owner rejects blank/overlength reasons). The Idempotency-Key
 * travels in the header; the target version id in the URL.
 */
export const cancelRedemptionRateSchema = z
  .object({
    /** Mandatory privileged-write reason (§7 / §15 / D-053 §11). */
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type CancelRedemptionRateDto = z.infer<
  typeof cancelRedemptionRateSchema
>;
