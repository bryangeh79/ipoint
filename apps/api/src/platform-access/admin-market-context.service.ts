import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  accounts,
  adminUsers,
  marketAccess,
  markets,
  permissions,
  roleAssignments,
  rolePermissions,
  roles,
  sessions,
} from '@ipoint/database';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import type { RequestActor } from '../auth/auth.types.js';
import { AuditService } from './audit.service.js';
import type { AdminActionContext } from './market.service.js';

@Injectable()
export class AdminMarketContextService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async accessibleMarkets(actor: RequestActor) {
    const adminUserId = this.requireAdmin(actor);
    await this.assertEligibleAdmin(adminUserId);
    const context = await this.sessionContext(actor.sessionId, adminUserId);
    const rows = await this.database.db
      .select({
        id: markets.id,
        code: markets.code,
        name: markets.name,
        currencyCode: markets.currencyCode,
        timezone: markets.timezone,
        locale: markets.defaultLocale,
        grantedAt: marketAccess.createdAt,
      })
      .from(marketAccess)
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, adminUserId),
          isNull(marketAccess.revokedAt),
          eq(markets.status, 'ACTIVE'),
        ),
      );
    return {
      items: rows.map((market) => ({
        ...market,
        isSelected: market.id === context.currentAdminMarketId,
      })),
      currentMarketId: context.currentAdminMarketId,
      contextVersion: context.marketContextVersion,
      asOf: new Date(),
    };
  }

  async bootstrap(actor: RequestActor) {
    const adminUserId = this.requireAdmin(actor);
    await this.assertEligibleAdmin(adminUserId);
    const [adminRows, roleRows, permissionRows, accessibleMarkets] =
      await Promise.all([
        this.database.db
          .select({
            id: adminUsers.id,
            accountId: adminUsers.accountId,
            displayName: adminUsers.displayName,
            status: adminUsers.status,
          })
          .from(adminUsers)
          .where(eq(adminUsers.id, adminUserId))
          .limit(1),
        this.database.db
          .selectDistinct({ id: roles.id, code: roles.code, name: roles.name })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .where(
            and(
              eq(roleAssignments.adminUserId, adminUserId),
              isNull(roleAssignments.revokedAt),
              isNull(roles.archivedAt),
            ),
          ),
        this.database.db
          .selectDistinct({ code: permissions.code })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .innerJoin(
            permissions,
            eq(permissions.id, rolePermissions.permissionId),
          )
          .where(
            and(
              eq(roleAssignments.adminUserId, adminUserId),
              isNull(roleAssignments.revokedAt),
              isNull(roles.archivedAt),
            ),
          ),
        this.accessibleMarkets(actor),
      ]);
    return {
      actor: adminRows[0],
      roles: roleRows,
      effectivePermissions: permissionRows.map(({ code }) => code),
      accessibleMarkets: accessibleMarkets.items,
      currentMarket: accessibleMarkets.currentMarketId
        ? accessibleMarkets.items.find(
            ({ id }) => id === accessibleMarkets.currentMarketId,
          )
        : null,
      contextVersion: accessibleMarkets.contextVersion,
      availability: {
        operationalWorkspace:
          accessibleMarkets.items.length > 0
            ? 'AVAILABLE'
            : 'MARKET_SELECTION_UNAVAILABLE',
      },
      asOf: new Date(),
    };
  }

  async selectCurrentMarket(
    actor: RequestActor,
    input: { marketId: string; expectedContextVersion: number },
    action: AdminActionContext,
  ) {
    const adminUserId = this.requireAdmin(actor);
    await this.assertEligibleAdmin(adminUserId);
    return this.database.db.transaction(async (tx) => {
      const currentRows = await tx
        .select({
          accountId: sessions.accountId,
          currentAdminMarketId: sessions.currentAdminMarketId,
          selectedAt: sessions.currentAdminMarketSelectedAt,
          marketContextVersion: sessions.marketContextVersion,
        })
        .from(sessions)
        .innerJoin(adminUsers, eq(adminUsers.accountId, sessions.accountId))
        .where(
          and(
            eq(sessions.id, actor.sessionId),
            eq(adminUsers.id, adminUserId),
            isNull(sessions.revokedAt),
          ),
        )
        .limit(1);
      const current = currentRows[0];
      if (!current) this.marketDenied('SESSION_REVOKED');
      if (current.marketContextVersion !== input.expectedContextVersion) {
        throw new ConflictException({
          code: 'MARKET_CONTEXT_MISMATCH',
          message: 'The selected market changed. Refresh and try again.',
        });
      }
      const grant = await tx
        .select({ id: marketAccess.id })
        .from(marketAccess)
        .innerJoin(markets, eq(markets.id, marketAccess.marketId))
        .where(
          and(
            eq(marketAccess.adminUserId, adminUserId),
            eq(marketAccess.marketId, input.marketId),
            isNull(marketAccess.revokedAt),
            eq(markets.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!grant[0]) this.marketDenied('MARKET_ACCESS_DENIED');
      if (current.currentAdminMarketId === input.marketId) {
        return {
          marketId: input.marketId,
          contextVersion: current.marketContextVersion,
          selectedAt: current.selectedAt,
        };
      }
      const selectedAt = new Date();
      const updated = await tx
        .update(sessions)
        .set({
          currentAdminMarketId: input.marketId,
          currentAdminMarketSelectedAt: selectedAt,
          marketContextVersion: input.expectedContextVersion + 1,
        })
        .where(
          and(
            eq(sessions.id, actor.sessionId),
            eq(sessions.marketContextVersion, input.expectedContextVersion),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ version: sessions.marketContextVersion });
      if (!updated[0]) {
        throw new ConflictException({
          code: 'MARKET_CONTEXT_MISMATCH',
          message: 'The selected market changed. Refresh and try again.',
        });
      }
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: adminUserId },
        action: 'admin.current_market.changed',
        entity: { type: 'admin_session', id: actor.sessionId },
        marketId: input.marketId,
        before: { marketId: current.currentAdminMarketId },
        after: {
          marketId: input.marketId,
          contextVersion: updated[0].version,
        },
        result: 'SUCCESS',
        requestId: action.requestId,
        ipAddress: action.ipAddress,
        summary: 'Current Admin Market changed.',
      });
      return {
        marketId: input.marketId,
        contextVersion: updated[0].version,
        selectedAt,
      };
    });
  }

  private async assertEligibleAdmin(adminUserId: string): Promise<void> {
    const rows = await this.database.db
      .select({ id: adminUsers.id })
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
      .where(
        and(
          eq(adminUsers.id, adminUserId),
          eq(adminUsers.status, 'ACTIVE'),
          eq(accounts.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new ForbiddenException({
        code: 'ADMIN_NOT_ELIGIBLE',
        message: 'This account cannot access Admin.',
      });
    }
  }

  private async sessionContext(sessionId: string, adminUserId: string) {
    const rows = await this.database.db
      .select({
        currentAdminMarketId: sessions.currentAdminMarketId,
        marketContextVersion: sessions.marketContextVersion,
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
    if (!rows[0]) this.marketDenied('SESSION_REVOKED');
    return rows[0];
  }

  private requireAdmin(actor: RequestActor): string {
    if (actor.type !== 'ADMIN_USER' || !actor.adminUserId) {
      throw new ForbiddenException({
        code: 'ADMIN_NOT_ELIGIBLE',
        message: 'This account cannot access Admin.',
      });
    }
    return actor.adminUserId;
  }

  private marketDenied(code: string): never {
    throw new ForbiddenException({
      code,
      message: 'The Admin session or market is not authorized.',
    });
  }
}
