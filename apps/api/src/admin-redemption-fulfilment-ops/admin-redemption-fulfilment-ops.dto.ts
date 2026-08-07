import { z } from 'zod';
import { FULFILMENT_QUEUE_STATUSES } from './admin-redemption-fulfilment-ops.types.js';

/** Pagination for queue/refund list reads (server-market-scoped). */
export const redemptionQueueQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type RedemptionQueueQueryDto = z.infer<
  typeof redemptionQueueQuerySchema
>;

/** Refund queue status filter (frozen refund-request statuses). */
export const refundQueueQuerySchema = z
  .object({
    status: z
      .enum([
        'PENDING_CHECKER',
        'APPROVED',
        'REJECTED',
        'EXECUTING',
        'COMPLETED',
        'FAILED',
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type RefundQueueQueryDto = z.infer<typeof refundQueueQuerySchema>;

/** Suspend an order (mandatory reason; owner records it durably). */
export const orderSuspendSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type OrderSuspendDto = z.infer<typeof orderSuspendSchema>;

/** Validate a queue-status path parameter against the six queues. */
export const queueStatusSchema = z.enum(FULFILMENT_QUEUE_STATUSES);
