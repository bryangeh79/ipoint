import { Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  adminUsers,
  isCanonicalPermission,
  marketAccess,
  markets,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
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
    if (!isCanonicalPermission(input.permission)) return false;
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

    return this.hasMarketAccess(input.adminUserId, input.marketId);
  }

  async hasMarketAccess(
    adminUserId: string,
    marketId: string,
  ): Promise<boolean> {
    const marketRows = await this.database.db
      .select({ accessId: marketAccess.id })
      .from(marketAccess)
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, adminUserId),
          eq(marketAccess.marketId, marketId),
          isNull(marketAccess.revokedAt),
          eq(markets.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return marketRows.length === 1;
  }

  async resolveCurrentMarket(
    adminUserId: string,
    sessionId: string,
  ): Promise<{ marketId: string | null; contextVersion: number } | null> {
    const rows = await this.database.db
      .select({
        marketId: sessions.currentAdminMarketId,
        contextVersion: sessions.marketContextVersion,
      })
      .from(sessions)
      .innerJoin(adminUsers, eq(adminUsers.accountId, sessions.accountId))
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(adminUsers.id, adminUserId),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async consumeStepUpGrant(input: {
    token: string | undefined;
    sessionId: string;
    adminUserId: string;
    permission: string;
    marketId?: string;
    target?: string;
  }): Promise<boolean> {
    if (!input.token) return false;
    try {
      const result = await this.database.pool.query(
        `UPDATE admin_step_up_grants
         SET used_at = now(), version = version + 1
         WHERE grant_hash = $1 AND session_id = $2 AND admin_user_id = $3
           AND action_class = $4
           AND market_id IS NOT DISTINCT FROM $5::uuid
           AND target_hash IS NOT DISTINCT FROM $6
           AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [
          hash(input.token),
          input.sessionId,
          input.adminUserId,
          input.permission,
          input.marketId ?? null,
          input.target ? hash(input.target) : null,
        ],
      );
      return result.rowCount === 1;
    } catch {
      // P7-S2A owns the grant table. Missing/unavailable step-up persistence
      // is security-sensitive and therefore fails closed.
      return false;
    }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
