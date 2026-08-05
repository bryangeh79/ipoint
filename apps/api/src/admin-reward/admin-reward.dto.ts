import { z } from 'zod';

export const rewardCapTypes = ['NONE', 'FLAT', 'RATIO'] as const;

/**
 * §7.1 reward-rate grammar: `%/day` decimal string, non-negative, at most
 * six input decimals. Enforced at the transport boundary (400 on
 * violation) and again inside the owner command (exact BigInt math).
 */
const rateString = z
  .string()
  .regex(
    /^\d+(\.\d{1,6})?$/u,
    'Must be a non-negative decimal with at most 6 decimals',
  );

const numericString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/u, 'Must be a numeric string');

/**
 * Secured Phase 3 reward-rule create contract (D-052/D-050).
 *
 * The owner command now requires the operator reason (durable on the
 * version row) and a selected market; the `Idempotency-Key` header is
 * mandatory and injected by the controller after transport validation.
 * `effectiveFrom` must be the exact UTC instant of a strictly future
 * market-local 00:00 in the market's IANA timezone (resolved and verified
 * inside the owner command). Versions are append-only and open-ended
 * (`effective_to` is always NULL), so effective ranges are strictly
 * increasing per market scope and can never overlap.
 */
export const createRuleVersionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    effectiveFrom: z
      .string()
      .datetime({ message: 'Must be a UTC ISO datetime' }),
    rewardRate: rateString,
    capType: z.enum(rewardCapTypes).default('NONE'),
    capValue: numericString.default('0'),
    minimumReward: z
      .string()
      .regex(/^\d+(\.\d+)?$/u, 'Must be a positive numeric string')
      .default('0'),
    marketId: z.string().uuid({ message: 'A selected market is required' }),
    reason: z.string().trim().min(1, 'Reason is required').max(500),
  })
  .strict()
  .refine(
    (data) => {
      if (data.capType === 'NONE' && data.capValue !== '0') return false;
      if (
        data.capType !== 'NONE' &&
        (data.capValue === '0' || Number(data.capValue) <= 0)
      )
        return false;
      return true;
    },
    {
      message:
        'capValue must be 0 when capType is NONE, and > 0 when capType is FLAT or RATIO',
      path: ['capValue'],
    },
  );

export type CreateRuleVersionDto = z.infer<typeof createRuleVersionSchema>;

export const ruleListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    marketId: z.string().uuid().optional(),
    includeArchived: z.coerce.boolean().default(false),
  })
  .strict();

export type RuleListQueryDto = z.infer<typeof ruleListQuerySchema>;

export const jobListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    jobType: z.string().trim().optional(),
    status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']).optional(),
  })
  .strict();

export type JobListQueryDto = z.infer<typeof jobListQuerySchema>;

export const walletAdjustmentSchema = z
  .object({
    amount: z
      .string()
      .regex(
        /^\d+(\.\d{1,10})?$/u,
        'Must be a positive numeric string with up to 10 decimal places.',
      ),
    reason: z.string().trim().min(1).max(1000),
    source: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(1).max(200),
    compensatingEntry: z.boolean().default(false),
    compensatingReason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.compensatingEntry && !data.compensatingReason) {
        return false;
      }
      return true;
    },
    {
      message: 'compensatingReason is required when compensatingEntry is true',
      path: ['compensatingReason'],
    },
  );

export type WalletAdjustmentDto = z.infer<typeof walletAdjustmentSchema>;
