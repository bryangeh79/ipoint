import { z } from 'zod';
import {
  RISK_EVENT_SEVERITIES,
  RISK_INDICATOR_CATEGORIES,
  RISK_REVIEW_DECISIONS,
  RISK_REVIEW_STATUSES,
  RISK_RUN_STATUSES,
} from './admin-risk-controls.types.js';

const utcDate = z.string().datetime({ offset: true });
const reason = z.string().trim().min(1).max(500);
const notes = z.string().trim().min(1).max(20_000);
const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(1).max(200);
const decisionReason = z.string().trim().min(1).max(2000);

/** Operator-configurable indicator config: flat object of primitives. */
const indicatorConfig = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .default({});

const definitionCode = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9_]+$/u, 'code must be lowercase snake_case (a-z0-9_).');

export const createDefinitionSchema = z
  .object({
    code: definitionCode,
    category: z.enum(RISK_INDICATOR_CATEGORIES),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000).optional(),
    enabled: z.boolean().default(true),
    config: indicatorConfig,
    severity: z.enum(RISK_EVENT_SEVERITIES).optional(),
    reason,
  })
  .strict();
export type CreateDefinitionDto = z.infer<typeof createDefinitionSchema>;

export const listDefinitionsQuerySchema = z
  .object({
    category: z.enum(RISK_INDICATOR_CATEGORIES).optional(),
    enabled: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    includeSuperseded: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListDefinitionsQueryDto = z.infer<
  typeof listDefinitionsQuerySchema
>;

export const createRunSchema = z
  .object({
    category: z.enum(RISK_INDICATOR_CATEGORIES),
    windowStart: utcDate,
    windowEnd: utcDate,
    reason,
  })
  .strict()
  .superRefine((value, ctx) => {
    const start = Date.parse(value.windowStart);
    const end = Date.parse(value.windowEnd);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['windowEnd'],
        message: 'windowEnd must be later than windowStart.',
      });
    }
  });
export type CreateRunDto = z.infer<typeof createRunSchema>;

export const listRunsQuerySchema = z
  .object({
    category: z.enum(RISK_INDICATOR_CATEGORIES).optional(),
    status: z.enum(RISK_RUN_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListRunsQueryDto = z.infer<typeof listRunsQuerySchema>;

export const listEventsQuerySchema = z
  .object({
    category: z.enum(RISK_INDICATOR_CATEGORIES).optional(),
    severity: z.enum(RISK_EVENT_SEVERITIES).optional(),
    indicatorCode: z.string().trim().min(1).max(100).optional(),
    entityType: z.string().trim().min(1).max(40).optional(),
    entityId: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListEventsQueryDto = z.infer<typeof listEventsQuerySchema>;

export const listQueueQuerySchema = z
  .object({
    status: z.enum(RISK_REVIEW_STATUSES).optional(),
    decision: z.enum(RISK_REVIEW_DECISIONS).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type ListQueueQueryDto = z.infer<typeof listQueueQuerySchema>;

export const queueActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason,
  })
  .strict();
export type QueueActionDto = z.infer<typeof queueActionSchema>;

export const assignQueueSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    assigneeAdminUserId: uuid.optional(),
    reason,
  })
  .strict();
export type AssignQueueDto = z.infer<typeof assignQueueSchema>;

export const decideQueueSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    decision: z.enum(RISK_REVIEW_DECISIONS),
    decisionReason,
    reason,
  })
  .strict();
export type DecideQueueDto = z.infer<typeof decideQueueSchema>;

export const queueNotesSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    notes,
    reason,
  })
  .strict();
export type QueueNotesDto = z.infer<typeof queueNotesSchema>;

export { uuid, reason, notes, idempotencyKey, decisionReason };
