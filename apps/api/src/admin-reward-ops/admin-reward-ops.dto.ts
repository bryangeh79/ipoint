import { z } from 'zod';
import { REWARD_RATE_MAX_DECIMALS } from './admin-reward-ops.types.js';

/**
 * P7-S6B Admin Reward Configuration DTOs (frozen contract §7.1).
 *
 * The rate is an exact decimal string in `%/day` with at most six input
 * decimals (`^\d+(\.\d{1,6})?$`). `0` and `0.000000` are valid (the §7.1
 * minimum is `0%`); the server additionally enforces the `0.05%/day`
 * governance ceiling and the per-package A–F maxima, which are policy
 * validations (not part of the transport grammar).
 *
 * `effective_date` is the market-local calendar date (`YYYY-MM-DD`) of the
 * activation; the server resolves the market-local `00:00` of that date to
 * the exact UTC instant using the market's IANA timezone. Same-day or
 * backdated dates are rejected — activation is only ever at a future
 * market-local midnight.
 */

export const rewardPackageReferences = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const createRewardRuleSchema = z
  .object({
    /** §7.1 package reference the rate applies to (A–F). */
    package_reference: z.enum(rewardPackageReferences),
    /** Exact decimal string (`%/day`), `0`–`0.05`, at most 6 decimals. */
    rate: z
      .string()
      .trim()
      .regex(
        /^\d+(\.\d{1,6})?$/u,
        `Must be a non-negative decimal string with at most ${REWARD_RATE_MAX_DECIMALS} decimal places.`,
      ),
    /** Market-local calendar date (YYYY-MM-DD) of the activation 00:00. */
    effective_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Must be a YYYY-MM-DD market-local date.'),
    /** Mandatory privileged-write reason (§7 / §15). */
    reason: z.string().trim().min(1).max(500),
    description: z.string().trim().max(500).optional(),
  })
  .strict();

export type CreateRewardRuleDto = z.infer<typeof createRewardRuleSchema>;
