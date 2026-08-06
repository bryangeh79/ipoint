import { z } from 'zod';
import { COMMISSION_RATE_TECHNICAL_DECIMALS } from './admin-commission-ops.constants.js';

/**
 * P7-S6D Admin Commission Rate Configuration create DTO (D-054 §16 /
 * D-055 §8).
 *
 * Transport fast-fail boundary ONLY: field shapes are validated here
 * (frozen enum membership, exact-decimal grammar with at most ten
 * technical decimals, market-local calendar date, mandatory reason). The
 * cross-field taxonomy match (rate_type ↔ commission_type, generation ↔
 * commission_type) is deliberately NOT duplicated in the adapter — it is
 * the frozen owner's enforcement (D-054 §6) and surfaces as 422
 * `RATE_TYPE_MISMATCH` / `INVALID_GENERATION` on this surface. Every
 * control is re-enforced inside
 * `RateManagementService.createRateVersion` (D-054 §5–§12).
 *
 * `effective_date` is the market-local calendar date (`YYYY-MM-DD`) of the
 * activation; the adapter resolves the market-local `00:00` of that date
 * to the exact UTC instant using the market's IANA timezone (canonical
 * owner helper). Same-day/backdated dates are rejected by the owner —
 * versions are strictly future-effective and history is immutable.
 */

export const createCommissionRateSchema = z
  .object({
    /** Frozen commission type (AGENT_UPGRADE | MEMBER_CONSUMPTION |
     * MERCHANT_RECRUITMENT | AGENT_ACTIVATION_FEE). */
    commission_type: z.enum([
      'AGENT_UPGRADE',
      'MEMBER_CONSUMPTION',
      'MERCHANT_RECRUITMENT',
      'AGENT_ACTIVATION_FEE',
    ]),
    /** Generation (0 | 1 | 2) — membership per commission type is the
     * owner's frozen enforcement (D-054 §6). */
    generation: z.number().int(),
    /** PERCENTAGE or FIXED — the frozen match with commission_type is the
     * owner's frozen enforcement (D-054 §6). */
    rate_type: z.enum(['PERCENTAGE', 'FIXED']),
    /** Exact decimal string (NUMERIC(38,10) compatible), ≤10 decimals. */
    rate_value: z
      .string()
      .trim()
      .regex(
        /^\d+(\.\d{1,10})?$/u,
        `Must be a non-negative decimal string with at most ${COMMISSION_RATE_TECHNICAL_DECIMALS} decimal places.`,
      ),
    /** Market-local calendar date (YYYY-MM-DD) of the activation 00:00. */
    effective_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Must be a YYYY-MM-DD market-local date.'),
    /** Mandatory privileged-write reason (1..500 chars, D-054 §11). */
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type CreateCommissionRateDto = z.infer<
  typeof createCommissionRateSchema
>;
