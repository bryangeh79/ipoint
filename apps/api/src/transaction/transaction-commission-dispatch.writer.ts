/**
 * Transaction Commission Dispatch Writer
 *
 * Writes dispatch events to the outbox table inside the same database
 * transaction as the CONFIRMED transaction commit. The outbox worker
 * picks up PENDING events and processes them through the commission engine.
 *
 * @packageDocumentation
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

const DISPATCH_EVENT_TYPES = [
  'MEMBER_CONSUMPTION',
  'MERCHANT_RECRUITMENT',
] as const;

export type DispatchEventType = (typeof DISPATCH_EVENT_TYPES)[number];

/**
 * Accepts any Drizzle DB or transaction object that supports execute().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = any;

@Injectable()
export class TransactionCommissionDispatchWriter {
  private readonly logger = new Logger(
    TransactionCommissionDispatchWriter.name,
  );

  /**
   * Write dispatch events for a confirmed transaction.
   * Call this inside the same database transaction as the CONFIRMED commit.
   * ON CONFLICT DO NOTHING ensures idempotency for replays.
   */
  async writeDispatches(
    db: Queryable,
    transactionId: string,
    eventTypes?: DispatchEventType[],
  ): Promise<void> {
    const types = eventTypes ?? DISPATCH_EVENT_TYPES;

    for (const eventType of types) {
      await db.execute(sql`
        INSERT INTO transaction_commission_dispatch
          (transaction_id, event_type, status, available_at)
        VALUES (
          ${transactionId}::uuid,
          ${eventType},
          'PENDING',
          now()
        )
        ON CONFLICT (transaction_id, event_type)
        DO NOTHING
      `);
    }
  }
}
