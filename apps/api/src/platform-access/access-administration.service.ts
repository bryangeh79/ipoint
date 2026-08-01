import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  accounts,
  adminUsers,
  canonicalPermissionCatalog,
  controlledRoleCodes,
  controlledRoleTemplates,
  marketAccess,
  markets,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  roleTemplatePermissions,
  sessions,
  type ControlledRoleCode,
} from '@ipoint/database';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from './audit.service.js';
import type { AdminActionContext } from './market.service.js';

@Injectable()
export class AccessAdministrationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listAdminUsers(limit = 50) {
    const result = await this.database.pool.query<{
      id: string;
      account_id: string;
      email: string;
      display_name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
      role_codes: string[];
    }>(
      `SELECT au.id, au.account_id, a.email, au.display_name, au.status,
              au.created_at, au.updated_at,
              COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') role_codes
       FROM admin_users au
       JOIN accounts a ON a.id = au.account_id
       LEFT JOIN role_assignments ra ON ra.admin_user_id = au.id AND ra.revoked_at IS NULL
       LEFT JOIN roles r ON r.id = ra.role_id AND r.archived_at IS NULL
       GROUP BY au.id, a.email ORDER BY au.created_at DESC, au.id DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return { items: result.rows, asOf: new Date() };
  }

  async getAdminUser(adminUserId: string) {
    const result = await this.database.pool.query<{
      id: string;
      account_id: string;
      email: string;
      display_name: string;
      status: string;
      created_at: Date;
      updated_at: Date;
      roles: unknown;
      market_grants: unknown;
    }>(
      `SELECT au.id, au.account_id, a.email, au.display_name, au.status,
              au.created_at, au.updated_at,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code))
                FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
                WHERE ra.admin_user_id = au.id AND ra.revoked_at IS NULL AND r.archived_at IS NULL), '[]') roles,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('marketId', m.id, 'code', m.code, 'revokedAt', ma.revoked_at)
                ORDER BY ma.created_at DESC)
                FROM market_access ma JOIN markets m ON m.id = ma.market_id
                WHERE ma.admin_user_id = au.id), '[]') market_grants
       FROM admin_users au JOIN accounts a ON a.id = au.account_id
       WHERE au.id = $1 LIMIT 1`,
      [adminUserId],
    );
    const row = result.rows[0];
    if (!row) this.adminNotFound();
    return row;
  }

  async createAdminUser(
    input: { accountId: string; displayName: string },
    actor: AdminActionContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const accountRows = await tx
        .select({ id: accounts.id, status: accounts.status })
        .from(accounts)
        .where(eq(accounts.id, input.accountId))
        .limit(1);
      const account = accountRows[0];
      if (!account) {
        throw new NotFoundException({
          code: 'ACCOUNT_NOT_FOUND',
          message: 'Account not found.',
        });
      }
      if (account.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'ADMIN_NOT_ELIGIBLE',
          message: 'Only an active account can become an Admin.',
        });
      }
      const inserted = await tx
        .insert(adminUsers)
        .values({
          accountId: input.accountId,
          displayName: input.displayName.trim(),
          status: 'ACTIVE',
        })
        .onConflictDoNothing({ target: adminUsers.accountId })
        .returning();
      const admin = inserted[0];
      if (!admin) {
        throw new ConflictException({
          code: 'ADMIN_USER_ALREADY_EXISTS',
          message: 'This account already has an Admin identity.',
        });
      }
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'admin.user.created',
        entity: { type: 'admin_user', id: admin.id },
        after: { accountId: input.accountId, status: admin.status },
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'Admin identity created.',
      });
      return admin;
    });
  }

  async changeAdminStatus(
    targetAdminUserId: string,
    input: {
      status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
      expectedUpdatedAt: Date;
    },
    actor: AdminActionContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const currentRows = await tx
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, targetAdminUserId))
        .limit(1);
      const current = currentRows[0];
      if (!current) this.adminNotFound();
      if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
        this.versionConflict();
      }
      if (current.status === 'ARCHIVED' && input.status !== 'ARCHIVED') {
        throw new ConflictException({
          code: 'ADMIN_ACCOUNT_ARCHIVED',
          message: 'An archived Admin cannot be reactivated.',
        });
      }
      const now = new Date();
      const updatedRows = await tx
        .update(adminUsers)
        .set({
          status: input.status,
          updatedAt: now,
          archivedAt: input.status === 'ARCHIVED' ? now : null,
        })
        .where(
          and(
            eq(adminUsers.id, targetAdminUserId),
            eq(adminUsers.updatedAt, input.expectedUpdatedAt),
          ),
        )
        .returning();
      const updated = updatedRows[0];
      if (!updated) this.versionConflict();
      if (input.status !== 'ACTIVE') {
        await tx.execute(sql`
          update sessions s
          set revoked_at = ${now}, revoke_reason = ${`ADMIN_${input.status}`}
          where account_id = ${current.accountId}
            and coalesce(to_jsonb(s)->>'actor_purpose', 'ADMIN') = 'ADMIN'
            and revoked_at is null
        `);
      }
      if (input.status === 'ARCHIVED') {
        await tx
          .update(roleAssignments)
          .set({ revokedAt: now })
          .where(
            and(
              eq(roleAssignments.adminUserId, targetAdminUserId),
              isNull(roleAssignments.revokedAt),
            ),
          );
        await tx
          .update(marketAccess)
          .set({ revokedAt: now })
          .where(
            and(
              eq(marketAccess.adminUserId, targetAdminUserId),
              isNull(marketAccess.revokedAt),
            ),
          );
      }
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'admin.user.status_changed',
        entity: { type: 'admin_user', id: targetAdminUserId },
        before: { status: current.status },
        after: { status: input.status },
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'Admin status changed.',
      });
      return updated;
    });
  }

  async listRoleTemplates() {
    const rows = await this.database.db
      .select()
      .from(roles)
      .where(inArray(roles.code, [...controlledRoleCodes]));
    return {
      items: controlledRoleTemplates.map((template) => {
        const row = rows.find(({ code }) => code === template.code);
        if (!row) {
          throw new ConflictException({
            code: 'PERMISSION_CATALOG_MISMATCH',
            message: 'A controlled role template is unavailable.',
          });
        }
        return {
          ...row,
          permissions: roleTemplatePermissions[template.code],
        };
      }),
      asOf: new Date(),
    };
  }

  listPermissionCatalog() {
    return {
      version: 'P7-S1C-D047-v1',
      count: canonicalPermissionCatalog.length,
      items: canonicalPermissionCatalog,
    };
  }

  async assignRole(
    targetAdminUserId: string,
    roleId: string,
    actor: AdminActionContext,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from admin_users where id = ${targetAdminUserId} for update`,
      );
      const roleRows = await tx
        .select({ code: roles.code })
        .from(roles)
        .where(
          and(
            eq(roles.id, roleId),
            isNull(roles.archivedAt),
            inArray(roles.code, [...controlledRoleCodes]),
          ),
        )
        .limit(1);
      const roleCode = roleRows[0]?.code as ControlledRoleCode | undefined;
      if (!roleCode) this.roleNotFound();
      const activeRoles = await tx
        .select({ code: roles.code })
        .from(roleAssignments)
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(
          and(
            eq(roleAssignments.adminUserId, targetAdminUserId),
            isNull(roleAssignments.revokedAt),
          ),
        );
      this.assertRoleCombination(
        activeRoles.map(({ code }) => code as ControlledRoleCode),
        roleCode,
      );
      const inserted = await tx
        .insert(roleAssignments)
        .values({
          adminUserId: targetAdminUserId,
          roleId,
          assignedByAdminUserId: actor.adminUserId,
        })
        .onConflictDoNothing()
        .returning({ id: roleAssignments.id });
      if (inserted.length === 0) return;
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'rbac.role.assign',
        entity: { type: 'admin_user', id: targetAdminUserId },
        after: { roleId },
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'Admin role assigned.',
      });
    });
  }

  async revokeRole(
    targetAdminUserId: string,
    roleId: string,
    actor: AdminActionContext,
  ): Promise<boolean> {
    return this.database.db.transaction(async (tx) => {
      const revoked = await tx
        .update(roleAssignments)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(roleAssignments.adminUserId, targetAdminUserId),
            eq(roleAssignments.roleId, roleId),
            isNull(roleAssignments.revokedAt),
          ),
        )
        .returning({ id: roleAssignments.id });
      if (revoked.length === 0) return false;
      const remaining = await tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.adminUserId, targetAdminUserId),
            isNull(roleAssignments.revokedAt),
          ),
        )
        .limit(1);
      if (remaining.length === 0) {
        const target = await tx
          .select({ accountId: adminUsers.accountId })
          .from(adminUsers)
          .where(eq(adminUsers.id, targetAdminUserId))
          .limit(1);
        if (target[0]) {
          await tx.execute(sql`
            update sessions s
            set revoked_at = now(), revoke_reason = 'ADMIN_ACCESS_REMOVED'
            where account_id = ${target[0].accountId}
              and coalesce(to_jsonb(s)->>'actor_purpose', 'ADMIN') = 'ADMIN'
              and revoked_at is null
          `);
        }
      }
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'rbac.role.revoke',
        entity: { type: 'admin_user', id: targetAdminUserId },
        before: { roleId },
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'Admin role revoked.',
      });
      return true;
    });
  }

  async grantMarketAccess(
    targetAdminUserId: string,
    marketId: string,
    actor: AdminActionContext,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const targetRows = await tx
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .innerJoin(markets, eq(markets.id, marketId))
        .where(
          and(
            eq(adminUsers.id, targetAdminUserId),
            eq(adminUsers.status, 'ACTIVE'),
            eq(markets.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!targetRows[0]) {
        throw new ConflictException({
          code: 'MARKET_INACTIVE',
          message: 'The Admin or target market is not active.',
        });
      }
      const inserted = await tx
        .insert(marketAccess)
        .values({
          adminUserId: targetAdminUserId,
          marketId,
          grantedByAdminUserId: actor.adminUserId,
        })
        .onConflictDoNothing()
        .returning({ id: marketAccess.id });
      if (inserted.length === 0) return;
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'rbac.market.grant',
        entity: { type: 'admin_user', id: targetAdminUserId },
        marketId,
        after: { marketId },
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'Admin market access granted.',
      });
    });
  }

  async revokeMarketAccess(
    targetAdminUserId: string,
    marketId: string,
    actor: AdminActionContext,
  ): Promise<boolean> {
    return this.database.db.transaction(async (tx) => {
      const revoked = await tx
        .update(marketAccess)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(marketAccess.adminUserId, targetAdminUserId),
            eq(marketAccess.marketId, marketId),
            isNull(marketAccess.revokedAt),
          ),
        )
        .returning({ id: marketAccess.id });
      if (revoked.length === 0) return false;
      const targetRows = await tx
        .select({ accountId: adminUsers.accountId })
        .from(adminUsers)
        .where(eq(adminUsers.id, targetAdminUserId))
        .limit(1);
      await tx
        .update(sessions)
        .set({
          currentAdminMarketId: null,
          currentAdminMarketSelectedAt: null,
          marketContextVersion: sql`${sessions.marketContextVersion} + 1`,
        })
        .where(
          and(
            eq(sessions.currentAdminMarketId, marketId),
            eq(sessions.accountId, targetRows[0]?.accountId ?? ''),
          ),
        );
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'rbac.market.revoke',
        entity: { type: 'admin_user', id: targetAdminUserId },
        marketId,
        before: { marketId },
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'Admin market access revoked.',
      });
      return true;
    });
  }

  async listMarketGrants(targetAdminUserId: string) {
    const rows = await this.database.db
      .select({
        id: marketAccess.id,
        marketId: marketAccess.marketId,
        marketCode: markets.code,
        marketName: markets.name,
        marketStatus: markets.status,
        grantedAt: marketAccess.createdAt,
        revokedAt: marketAccess.revokedAt,
      })
      .from(marketAccess)
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(eq(marketAccess.adminUserId, targetAdminUserId));
    return { items: rows, asOf: new Date() };
  }

  async replaceRoleTemplatePermissions(
    roleId: string,
    input: { permissionCodes: string[]; expectedUpdatedAt: Date },
    actor: AdminActionContext,
  ) {
    return this.database.db.transaction(async (tx) => {
      const roleRows = await tx
        .select()
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);
      const role = roleRows[0];
      if (
        !role ||
        !controlledRoleCodes.includes(role.code as ControlledRoleCode)
      )
        this.roleNotFound();
      if (role.updatedAt.getTime() !== input.expectedUpdatedAt.getTime())
        this.versionConflict();
      const expected = roleTemplatePermissions[role.code as ControlledRoleCode];
      const supplied = [...new Set(input.permissionCodes)].sort();
      if (
        supplied.length !== expected.length ||
        supplied.some((code, index) => code !== [...expected].sort()[index])
      ) {
        throw new ConflictException({
          code: 'ROLE_TEMPLATE_IMMUTABLE',
          message: 'Only the approved controlled template can be applied.',
        });
      }
      const permissionRows = await tx
        .select({ id: permissions.id, code: permissions.code })
        .from(permissions)
        .where(inArray(permissions.code, supplied));
      if (permissionRows.length !== expected.length) {
        throw new ConflictException({
          code: 'PERMISSION_CATALOG_MISMATCH',
          message: 'The canonical permission catalog is incomplete.',
        });
      }
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));
      await tx.insert(rolePermissions).values(
        permissionRows.map(({ id }) => ({
          roleId: role.id,
          permissionId: id,
        })),
      );
      const now = new Date();
      await tx
        .update(roles)
        .set({ updatedAt: now })
        .where(eq(roles.id, role.id));
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'rbac.role.permissions_changed',
        entity: { type: 'role', id: role.id },
        after: { permissionCodes: supplied },
        reason: actor.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: 'Controlled role template permissions applied.',
      });
      return { roleId: role.id, permissionCodes: supplied, updatedAt: now };
    });
  }

  private assertRoleCombination(
    active: ControlledRoleCode[],
    candidate: ControlledRoleCode,
  ): void {
    const combined = new Set([...active, candidate]);
    const conflict =
      (combined.has('SUPER_ADMIN') && combined.size > 1) ||
      (combined.has('FINANCE_OPERATOR') && combined.has('FINANCE_APPROVER')) ||
      (combined.has('SUPPORT_READONLY_AUDITOR') && combined.size > 1);
    if (conflict) {
      throw new ConflictException({
        code: 'ROLE_ASSIGNMENT_CONFLICT',
        message: 'This role combination is not allowed.',
      });
    }
  }

  private adminNotFound(): never {
    throw new NotFoundException({
      code: 'ADMIN_USER_NOT_FOUND',
      message: 'Admin user not found.',
    });
  }

  private roleNotFound(): never {
    throw new NotFoundException({
      code: 'ROLE_NOT_FOUND',
      message: 'Controlled role template not found.',
    });
  }

  private versionConflict(): never {
    throw new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'The resource changed. Refresh and try again.',
    });
  }
}
