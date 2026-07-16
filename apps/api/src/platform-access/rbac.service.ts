import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  adminUsers,
  marketAccess,
  markets,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
} from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class RbacService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async isAllowed(input: {
    adminUserId: string;
    permission: string;
    marketId?: string;
  }): Promise<boolean> {
    const permissionRows = await this.database.db
      .select({ adminUserId: adminUsers.id })
      .from(adminUsers)
      .innerJoin(accounts, eq(accounts.id, adminUsers.accountId))
      .innerJoin(
        roleAssignments,
        and(
          eq(roleAssignments.adminUserId, adminUsers.id),
          isNull(roleAssignments.revokedAt),
        ),
      )
      .innerJoin(
        roles,
        and(eq(roles.id, roleAssignments.roleId), isNull(roles.archivedAt)),
      )
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(adminUsers.id, input.adminUserId),
          eq(adminUsers.status, 'ACTIVE'),
          eq(accounts.status, 'ACTIVE'),
          eq(permissions.code, input.permission),
        ),
      )
      .limit(1);
    if (permissionRows.length === 0) return false;
    if (!input.marketId) return true;

    const marketRows = await this.database.db
      .select({ accessId: marketAccess.id })
      .from(marketAccess)
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, input.adminUserId),
          eq(marketAccess.marketId, input.marketId),
          isNull(marketAccess.revokedAt),
          eq(markets.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return marketRows.length === 1;
  }
}
