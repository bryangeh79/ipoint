import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { auditLogs, entityTimelines, type Database } from '@ipoint/database';
import { DatabaseService } from '../database/database.service.js';
import { redactAuditValue } from './audit-redaction.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface PrivilegedAuditInput {
  actor: {
    type: 'ACCOUNT' | 'ADMIN_USER' | 'SYSTEM';
    id?: string;
  };
  action: string;
  entity: {
    type: string;
    id: string;
  };
  marketId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  requestId?: string;
  ipAddress?: string;
  summary: string;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async recordPrivilegedAction(input: PrivilegedAuditInput): Promise<void> {
    await this.database.db.transaction((tx) =>
      this.appendWithinTransaction(tx, input),
    );
  }

  async queryEntity(
    adminUserId: string,
    query: { entityType: string; entityId: string; limit: number },
  ) {
    const normalizedType = query.entityType.trim().toLowerCase();
    const market = await this.database.pool.query<{ market_id: string }>(
      `SELECT market_id FROM merchant_branches
       WHERE id::text = $1 AND $2 IN ('merchant_branch', 'merchant')
       UNION ALL
       SELECT market_id FROM audit_logs
       WHERE lower(entity_type) = $2 AND entity_id = $1 AND market_id IS NOT NULL
       LIMIT 1`,
      [query.entityId, normalizedType],
    );
    const marketId = market.rows[0]?.market_id;
    if (!marketId)
      throw new ForbiddenException({ code: 'AUDIT_ENTITY_NOT_ACCESSIBLE' });
    const access = await this.database.pool.query(
      `SELECT 1 FROM market_access
       WHERE admin_user_id = $1 AND market_id = $2 AND revoked_at IS NULL
       LIMIT 1`,
      [adminUserId, marketId],
    );
    if (access.rowCount !== 1)
      throw new ForbiddenException({
        code: 'MARKET_ACCESS_DENIED',
        message: 'The administrator does not have access to this market.',
      });
    const [logs, timeline] = await Promise.all([
      this.database.pool.query(
        `SELECT * FROM audit_logs
         WHERE lower(entity_type) = $1 AND entity_id = $2
         ORDER BY occurred_at DESC LIMIT $3`,
        [normalizedType, query.entityId, query.limit],
      ),
      this.database.pool.query(
        `SELECT * FROM entity_timelines
         WHERE lower(entity_type) = $1 AND entity_id = $2
         ORDER BY occurred_at DESC LIMIT $3`,
        [normalizedType, query.entityId, query.limit],
      ),
    ]);
    return { logs: logs.rows, timeline: timeline.rows };
  }

  async appendWithinTransaction(
    tx: DatabaseTransaction,
    input: PrivilegedAuditInput,
  ): Promise<void> {
    const occurredAt = new Date();
    await tx.insert(auditLogs).values({
      actorType: input.actor.type,
      actorId: input.actor.id,
      marketId: input.marketId,
      action: input.action,
      entityType: input.entity.type,
      entityId: input.entity.id,
      before: redactAuditValue(input.before),
      after: redactAuditValue(input.after),
      reason: input.reason,
      result: input.result,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      occurredAt,
    });
    await tx.insert(entityTimelines).values({
      entityType: input.entity.type,
      entityId: input.entity.id,
      eventType: input.action,
      actorType: input.actor.type,
      actorId: input.actor.id,
      marketId: input.marketId,
      summary: input.summary,
      metadata: {
        result: input.result,
        requestId: input.requestId,
      },
      occurredAt,
    });
  }

  async appendWithinTransactionWithId(
    tx: DatabaseTransaction,
    input: PrivilegedAuditInput,
  ): Promise<string> {
    const occurredAt = new Date();
    const auditRows = await tx
      .insert(auditLogs)
      .values({
        actorType: input.actor.type,
        actorId: input.actor.id,
        marketId: input.marketId,
        action: input.action,
        entityType: input.entity.type,
        entityId: input.entity.id,
        before: redactAuditValue(input.before),
        after: redactAuditValue(input.after),
        reason: input.reason,
        result: input.result,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        occurredAt,
      })
      .returning({ id: auditLogs.id });
    const auditLogId = auditRows[0]?.id;
    if (!auditLogId) {
      throw new Error('Audit log insert did not return an identifier.');
    }
    await tx.insert(entityTimelines).values({
      entityType: input.entity.type,
      entityId: input.entity.id,
      eventType: input.action,
      actorType: input.actor.type,
      actorId: input.actor.id,
      marketId: input.marketId,
      summary: input.summary,
      metadata: {
        result: input.result,
        requestId: input.requestId,
      },
      occurredAt,
    });
    return auditLogId;
  }
}
