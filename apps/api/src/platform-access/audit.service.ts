import { Inject, Injectable } from '@nestjs/common';
import { auditLogs, entityTimelines, type Database } from '@ipoint/database';
import { DatabaseService } from '../database/database.service.js';
import { redactAuditValue } from './audit-redaction.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface PrivilegedAuditInput {
  actor: {
    type: 'ADMIN_USER' | 'SYSTEM';
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
}
