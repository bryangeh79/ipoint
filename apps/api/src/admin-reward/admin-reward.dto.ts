import { z } from 'zod';

export const rewardCapTypes = ['NONE', 'FLAT', 'RATIO'] as const;

const positiveNumericString = z
  .string()
  .regex(/^\d+(\.\d+)?$/u, 'Must be a positive numeric string');

const numericString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/u, 'Must be a numeric string');

export const createRuleVersionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    effectiveFrom: z.string().datetime({ message: 'Must be a UTC ISO datetime' }),
    effectiveTo: z
      .string()
      .datetime({ message: 'Must be a UTC ISO datetime' })
      .optional(),
    rewardRate: positiveNumericString,
    capType: z.enum(rewardCapTypes).default('NONE'),
    capValue: numericString.default('0'),
    minimumReward: positiveNumericString.default('0'),
    marketId: z.string().uuid().optional().nullable(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.capType === 'NONE' && data.capValue !== '0') return false;
      if (data.capType !== 'NONE' && (data.capValue === '0' || Number(data.capValue) <= 0)) return false;
      return true;
    },
    {
      message: 'capValue must be 0 when capType is NONE, and > 0 when capType is FLAT or RATIO',
      path: ['capValue'],
    },
  )
  .refine(
    (data) => {
      if (!data.effectiveTo) return true;
      return new Date(data.effectiveTo) > new Date(data.effectiveFrom);
    },
    {
      message: 'effectiveTo must be after effectiveFrom',
      path: ['effectiveTo'],
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
      .regex(/^\d+(\.\d{1,10})?$/u, 'Must be a positive numeric string with up to 10 decimal places.'),
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
