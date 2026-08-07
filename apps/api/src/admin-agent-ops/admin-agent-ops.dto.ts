import { z } from 'zod';
import { AGENT_STATUSES } from './admin-agent-ops.types.js';

/** Agent list/search query (server-market-scoped; no client market input). */
export const agentListQuerySchema = z
  .object({
    /** Free-text search over public member id / referral code / display name. */
    q: z.string().trim().max(120).optional(),
    /** Optional lifecycle status filter. */
    status: z.enum(AGENT_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type AgentListQueryDto = z.infer<typeof agentListQuerySchema>;

/** Suspend an ACTIVE agent (mandatory reason; owner records it durably). */
export const agentSuspendSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type AgentSuspendDto = z.infer<typeof agentSuspendSchema>;

/** Deactivate an ACTIVE agent (mandatory reason; owner records it durably). */
export const agentDeactivateSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type AgentDeactivateDto = z.infer<typeof agentDeactivateSchema>;
