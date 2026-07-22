import { z } from 'zod';

export const rewardPlanStatuses = [
  'SCHEDULED',
  'ACTIVE',
  'CAPPED',
  'SUSPENDED',
  'REVERSED',
  'COMPLETED',
] as const;

export const rewardCapTypes = ['NONE', 'FLAT', 'RATIO'] as const;

const numericString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/u, 'Must be a numeric string');

const positiveNumericString = z
  .string()
  .regex(/^\d+(\.\d+)?$/u, 'Must be a positive numeric string');

export const createRuleVersionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    effectiveFrom: z
      .string()
      .datetime({ message: 'Must be a UTC ISO datetime' }),
    effectiveTo: z
      .string()
      .datetime({ message: 'Must be a UTC ISO datetime' })
      .optional(),
    rewardRate: positiveNumericString,
    capType: z.enum(rewardCapTypes).default('NONE'),
    capValue: numericString.default('0'),
    minimumReward: positiveNumericString.default('0'),
    marketId: z.string().uuid().optional().nullable(),
    createdBy: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.capType === 'NONE' && data.capValue !== '0') {
        return false;
      }
      if (
        data.capType !== 'NONE' &&
        (data.capValue === '0' || Number(data.capValue) <= 0)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'capValue must be 0 when capType is NONE, and > 0 when capType is FLAT or RATIO',
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

export const planListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(rewardPlanStatuses).optional(),
    marketId: z.string().uuid().optional(),
  })
  .strict();

export type PlanListQueryDto = z.infer<typeof planListQuerySchema>;

export const ruleListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    marketId: z.string().uuid().optional(),
  })
  .strict();

export type RuleListQueryDto = z.infer<typeof ruleListQuerySchema>;
