import { Inject, Injectable } from '@nestjs/common';
import { marketAccess, roleAssignments } from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from './audit.service.js';
import type { AdminActionContext } from './market.service.js';

@Injectable()
export class AccessAdministrationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async assignRole(
    targetAdminUserId: string,
    roleId: string,
    actor: AdminActionContext,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
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
}
