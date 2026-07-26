/**
 * Durable Transaction Commission Outbox Worker
 *
 * Claims PENDING dispatch events and processes them through the
 * commission engine. Multi-worker safe via FOR UPDATE SKIP LOCKED
 * without session-level advisory locks. Bounded retry with stale
 * lock recovery.
 *
 * Exposes `processBatchOnce()` for deterministic test invocation.
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

  /** Automatically start the worker on module init. */
  onModuleInit(): void {
    this.start();
  }

  /** Start the worker loop (non-blocking). */
  start(): void {
    if (this.running) return;
    this.running = true;
    setImmediate(() => this.tick());
  }

  stop(): void {
    this.running = false;
  }

  // ─────────────────────────────────────────────────────────────────
  //  Deterministic entry point for integration tests / admin ops
  // ─────────────────────────────────────────────────────────────────

  /**
   * Run exactly one batch cycle and return.
   * Designed for integration tests and manual reprocessing.
   */
  async processBatchOnce(): Promise<{ claimed: number; completed: number }> {
    return this.processBatch();
  }

  // ─────────────────────────────────────────────────────────────────
  //  Internal loop
  // ─────────────────────────────────────────────────────────────────

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
   * Lock-free multi-worker safety via UPDATE … FOR UPDATE SKIP LOCKED.
   * Returns counts for deterministic assertions.
   */
  private async processBatch(): Promise<{
    claimed: number;
    completed: number;
  }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = this.database.db;

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

    // Claim next batch using UPDATE … RETURNING with FOR UPDATE SKIP LOCKED
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

    const rows: DispatchRow[] = result.rows ?? [];
    let completed = 0;

    for (const row of rows) {
      const ok = await this.processEvent(db, row);
      if (ok) completed++;
    }

    return { claimed: rows.length, completed };
  }

  /**
   * Process a single dispatch event and update its status.
   * Returns true if the event reached COMPLETED, false otherwise.
   */
  async processEvent(db: any, row: DispatchRow): Promise<boolean> {
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
          return false;
      }

      await this.markCompleted(db, id);
      this.logger.debug(`Dispatch ${id} completed successfully`);
      return true;
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.logger.error(`Dispatch ${id} failed: ${errorMessage}`);
      await this.markFailed(db, id, errorMessage);
      return false;
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
