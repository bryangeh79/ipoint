import { z } from 'zod';

const reason = z.string().trim().min(8).max(500);
const expectedUpdatedAt = z.coerce.date();

export const adminUserListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createAdminUserSchema = z.object({
  account_id: z.string().uuid(),
  display_name: z.string().trim().min(2).max(120),
  reason,
});

export const changeAdminStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
  expected_updated_at: expectedUpdatedAt,
  reason,
});

export const roleCommandSchema = z.object({ reason });
export const assignRoleSchema = roleCommandSchema.extend({
  role_id: z.string().uuid(),
});

export const replaceRolePermissionsSchema = z.object({
  permission_codes: z.array(z.string().min(3).max(120)).max(66),
  expected_updated_at: expectedUpdatedAt,
  reason,
});

export const marketGrantSchema = z.object({
  market_id: z.string().uuid(),
  reason,
});

export const marketRevokeSchema = z.object({ reason });

export const selectCurrentMarketSchema = z.object({
  market_id: z.string().uuid(),
  expected_context_version: z.number().int().positive(),
});

export type AdminUserListQueryDto = z.infer<typeof adminUserListQuerySchema>;
export type CreateAdminUserDto = z.infer<typeof createAdminUserSchema>;
export type ChangeAdminStatusDto = z.infer<typeof changeAdminStatusSchema>;
export type RoleCommandDto = z.infer<typeof roleCommandSchema>;
export type AssignRoleDto = z.infer<typeof assignRoleSchema>;
export type ReplaceRolePermissionsDto = z.infer<
  typeof replaceRolePermissionsSchema
>;
export type MarketGrantDto = z.infer<typeof marketGrantSchema>;
export type MarketRevokeDto = z.infer<typeof marketRevokeSchema>;
export type SelectCurrentMarketDto = z.infer<typeof selectCurrentMarketSchema>;
