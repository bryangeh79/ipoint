import { z } from 'zod';
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS } from './admin-audit-ops.types.js';

/**
 * Audit viewer query (P7-S9). The market is never taken from the client —
 * it comes from the server Current Admin Market (RbacGuard marketScoped
 * contract). Filters are bounded: actor type / action / entity type /
 * result / ISO-8601 time range / free-text search, with bounded
 * pagination (max 100 rows per page).
 */
export const auditListQuerySchema = z
  .object({
    actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
    action: z.string().trim().min(1).max(120).optional(),
    entityType: z.string().trim().min(1).max(100).optional(),
    result: z.enum(AUDIT_RESULTS).optional(),
    /** Inclusive ISO-8601 lower bound (UTC). */
    from: z.string().datetime({ offset: true }).optional(),
    /** Inclusive ISO-8601 upper bound (UTC). */
    to: z.string().datetime({ offset: true }).optional(),
    /** Free-text search over action / entity type / entity id / actor id. */
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict()
  .refine(
    ({ from, to }) =>
      !from || !to || new Date(from).getTime() <= new Date(to).getTime(),
    { message: 'from must not be later than to', path: ['from'] },
  );

export type AuditListQueryDto = z.infer<typeof auditListQuerySchema>;
