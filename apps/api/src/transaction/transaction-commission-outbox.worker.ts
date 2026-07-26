/**
 * Durable Transaction Commission Outbox Worker
 *
 * Claims PENDING dispatch events and processes them through the
 * commission engine. Crash-safe via pg_try_advisory_lock for
 * exclusive worker access and bounded retry with stale lock recovery.
 *
 * @packageDocumentation
 */

import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { MemberConsumptionCommissionService } from '../domain/commission/member-consumption.service.js';
import { MerchantRecruitmentCommissionService } from '../domain/commission/merchant-recruitment.service.js';
import { sql } from 'drizzle-orm';

interface DispatchRow {
  id: string;
  transaction_id: string;
  event_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
}

const BATCH_SIZE = 10;
const STALE_LOCK_MINUTES = 5;
const WORKER_LOCK_ID = 1_741_203_710;

@Injectable()
export class TransactionCommissionOutboxWorker implements OnModuleInit {
  private readonly logger = new Logger(TransactionCommissionOutboxWorker.name);
  private running = false;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(MemberConsumptionCommissionService)
    private readonly memberConsumption: MemberConsumptionCommissionService,
    @Inject(MerchantRecruitmentCommissionService)
    private readonly merchantRecruitment: MerchantRecruitmentCommissionService,
  ) {}

  /** Automatically start the worker when the module initializes. */
  onModuleInit(): void {
    this.start();
  }

  /**
   * Start the outbox worker loop (non-blocking).
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    setImmediate(() => this.tick());
  }

  stop(): void {
    this.running = false;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      await this.processBatch();
    } catch (err) {
      this.logger.error(`Outbox worker tick failed: ${(err as Error).message}`);
    }
    if (this.running) {
      const delay = 1000 + Math.random() * 2000;
      setTimeout(() => this.tick(), delay);
    }
  }

  /**
   * Claim and process up to BATCH_SIZE pending dispatch events.
   */
  private async processBatch(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = this.database.db;

    const lockResult = await db.execute(
      sql`SELECT pg_try_advisory_lock(${WORKER_LOCK_ID}) as locked`,
    );
    if (!lockResult.rows[0]?.locked) {
      return;
    }

    try {
      // Recover stale PROCESSING events (worker crashed after claiming)
      await db.execute(sql`
        UPDATE transaction_commission_dispatch
        SET status = 'PENDING',
            locked_at = NULL,
            locked_by = NULL,
            attempts = attempts + 1
        WHERE status = 'PROCESSING'
          AND locked_at < now() - interval '${sql.raw(String(STALE_LOCK_MINUTES))} minutes'
          AND attempts < max_attempts
      `);

      // Claim next batch using UPDATE … RETURNING for atomicity
      const result = await db.execute(sql`
        UPDATE transaction_commission_dispatch
        SET status = 'PROCESSING',
            locked_at = now(),
            locked_by = concat('worker-', pg_backend_pid()),
            attempts = attempts + 1,
            last_error = NULL
        WHERE id IN (
          SELECT id FROM transaction_commission_dispatch
          WHERE status = 'PENDING'
            AND available_at <= now()
          ORDER BY available_at ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, transaction_id, event_type, status, attempts, max_attempts, last_error
      `);

      for (const row of result.rows) {
        await this.processEvent(db, row);
      }
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${WORKER_LOCK_ID})`);
    }
  }

  private async processEvent(db: any, row: DispatchRow): Promise<void> {
    const { id, transaction_id, event_type } = row;
    this.logger.debug(
      `Processing dispatch ${id}: ${event_type} for transaction ${transaction_id}`,
    );

    try {
      switch (event_type) {
        case 'MEMBER_CONSUMPTION':
          await this.memberConsumption.processMemberConsumption(transaction_id);
          break;
        case 'MERCHANT_RECRUITMENT':
          await this.merchantRecruitment.processMerchantRecruitment(
            transaction_id,
          );
          break;
        default:
          this.logger.warn(`Unknown dispatch event type: ${event_type}`);
          await this.markFailed(db, id, `Unknown event type: ${event_type}`);
          return;
      }

      await this.markCompleted(db, id);
      this.logger.debug(`Dispatch ${id} completed successfully`);
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.logger.error(`Dispatch ${id} failed: ${errorMessage}`);
      await this.markFailed(db, id, errorMessage);
    }
  }

  private async markCompleted(db: any, dispatchId: string): Promise<void> {
    await db.execute(sql`
      UPDATE transaction_commission_dispatch
      SET status = 'COMPLETED',
          completed_at = now(),
          locked_at = NULL,
          locked_by = NULL
      WHERE id = ${dispatchId}
    `);
  }

  private async markFailed(
    db: any,
    dispatchId: string,
    error: string,
  ): Promise<void> {
    await db.execute(sql`
      UPDATE transaction_commission_dispatch
      SET status = CASE
            WHEN attempts >= max_attempts THEN 'FAILED'
            ELSE 'PENDING'
          END,
          last_error = ${error},
          locked_at = NULL,
          locked_by = NULL,
          available_at = now() + interval '1 minute' * attempts
      WHERE id = ${dispatchId}
    `);
  }
}
