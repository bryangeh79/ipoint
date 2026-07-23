import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { JobService } from './job.service.js';
import {
  ADVISORY_LOCK_NAMESPACE,
  JOB_TYPE_DAILY_REWARD_ACCRUAL,
} from './job.types.js';
import { jobRunLockAcquisitionError } from './job.errors.js';

const JOB_QUEUE_NAME = 'daily-reward-accrual';

/**
 * Generates a PostgreSQL advisory lock key from lock dimensions.
 * Uses a 64-bit bigint hash of (job_type, market_id, local_business_date).
 *
 * Lock dimensions:
 *   - job_type (text)
 *   - market_id (uuid)
 *   - local_business_date (date string)
 */
function advisoryLockKey(
  jobType: string,
  marketId: string,
  localBusinessDate: string,
): bigint {
  // Build a deterministic hash from string dimensions
  const input = `${jobType}:${marketId}:${localBusinessDate}`;
  let hash = BigInt(ADVISORY_LOCK_NAMESPACE);
  for (let i = 0; i < input.length; i++) {
    // FNV-1a-like mixing for distribution across 64-bit space
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * BigInt(1099511628211)) & BigInt('0xFFFFFFFFFFFFFFFF');
  }
  // Ensure positive bigint (clear sign bit)
  return hash & BigInt('0x7FFFFFFFFFFFFFFF');
}

@Injectable()
export class JobSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly recurringIntervalMs: number;
  private readonly workerCount: number;
  private readonly pool: Pool;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(JobService) private readonly jobService: JobService,
  ) {
    this.pool = database.pool;
    // Default: every 5 minutes; configurable via env
    this.recurringIntervalMs = Number(
      process.env['DAILY_JOB_INTERVAL_MS'] ?? (5 * 60 * 1000).toString(),
    );
    this.workerCount = Number(process.env['DAILY_JOB_WORKER_COUNT'] ?? '3');
  }

  async onApplicationBootstrap(): Promise<void> {
    // Skip scheduler startup during integration tests to avoid
    // interfering with test-specific database state and preventing
    // bootstrap-side effects that would skip dependent tests.
    if (process.env['NODE_ENV'] === 'test') {
      return;
    }
    await this.startScheduler();
  }

  onApplicationShutdown(): void {
    this.stopScheduler();
  }

  // ─── Queue Schema Setup ─────────────────────────────────────

  /**
   * Ensure the job queue schema exists. Creates the schema and
   * job_queue table for tracking scheduled jobs.
   */
  async ensureQueueSchema(): Promise<void> {
    await this.database.db.execute(sql`
      CREATE SCHEMA IF NOT EXISTS ipoint_jobs;
    `);

    await this.database.db.execute(sql`
      CREATE TABLE IF NOT EXISTS ipoint_jobs.job_queue (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}',
        state text NOT NULL DEFAULT 'created',
        retry_limit integer NOT NULL DEFAULT 3,
        retry_count integer NOT NULL DEFAULT 0,
        retry_delay_seconds integer NOT NULL DEFAULT 60,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        completed_at timestamptz,
        archived_at timestamptz
      );
    `);

    await this.database.db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_job_queue_state_name
        ON ipoint_jobs.job_queue (state, name);
    `);
  }

  /**
   * Enqueue a recurring daily reward accrual job for all active markets.
   */
  async enqueueDailyAccrualJobs(): Promise<void> {
    // Get all active markets with their timezones
    const markets = await this.database.db.execute<{
      id: string;
      timezone: string;
    }>(sql`
      SELECT id, timezone FROM markets WHERE status = 'ACTIVE'
    `);

    for (const market of markets.rows as { id: string; timezone: string }[]) {
      const localNow = new Date().toLocaleString('en-CA', {
        timeZone: market.timezone,
        dateStyle: 'short',
      }); // YYYY-MM-DD format

      const [datePart = ''] = localNow.split(', ');
      const localDateStr = datePart;

      await this.enqueueJob({
        name: JOB_QUEUE_NAME,
        data: {
          marketId: market.id,
          localBusinessDate: localDateStr,
          marketTimezone: market.timezone,
        },
      });
    }
  }

  /**
   * Enqueue a single job into the job queue.
   */
  async enqueueJob(params: {
    name: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    // Use same-day deduplication in the queue to avoid duplicate enqueues
    await this.database.db.execute(sql`
      INSERT INTO ipoint_jobs.job_queue (name, data, state)
      VALUES (
        ${params.name},
        ${JSON.stringify(params.data)}::jsonb,
        'created'
      )
      ON CONFLICT DO NOTHING
    `);
  }

  // ─── Advisory Lock Worker ──────────────────────────────────────────

  /**
   * Attempt to acquire a transaction-level advisory lock for a job.
   * Uses pg_try_advisory_xact_lock for non-blocking acquisition.
   * The lock dimensions are: job_type + market_id + local_business_date.
   *
   * Returns true if the lock was acquired (caller should proceed).
   * Returns false if another worker holds the lock.
   */
  async tryAcquireLock(
    jobType: string,
    marketId: string,
    localBusinessDate: string,
  ): Promise<boolean> {
    const lockKey = advisoryLockKey(jobType, marketId, localBusinessDate);

    const result = await this.database.db.execute<{ locked: boolean }>(sql`
      SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked
    `);

    const locked = result.rows[0]?.locked === true;
    if (!locked) {
      throw jobRunLockAcquisitionError(jobType, marketId, localBusinessDate);
    }
    return true;
  }

  /**
   * Release an advisory lock (called after job completes or fails).
   * Since xact locks are transaction-scoped, they auto-release on
   * COMMIT/ROLLBACK. This is a no-op for explicit release but kept
   * for clarity.
   */
  releaseLock(
    jobType: string,
    marketId: string,
    localBusinessDate: string,
  ): void {
    void jobType;
    void marketId;
    void localBusinessDate;
    // Transaction-level advisory locks auto-release at end of transaction.
    // No explicit release needed.
  }

  // ─── Scheduler Lifecycle ───────────────────────────────────────────

  /**
   * Start the recurring scheduler.
   * Polls the job queue for pending jobs and processes them.
   */
  async startScheduler(): Promise<void> {
    await this.ensureQueueSchema();

    // Initial enqueue (will be rescheduled on each tick)
    await this.enqueueDailyAccrualJobs();

    // Start recurring poll interval
    this.intervalHandle = setInterval(async () => {
      try {
        await this.pollQueue();
      } catch (err) {
        console.error('[JobScheduler] Poll error:', err);
      }
    }, this.recurringIntervalMs);

    // Immediately poll once
    await this.pollQueue();
  }

  /**
   * Stop the recurring scheduler.
   */
  stopScheduler(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Poll the job queue and dispatch work to workers.
   * Spawns up to workerCount parallel workers for pending jobs.
   */
  async pollQueue(): Promise<void> {
    // Fetch up to workerCount pending jobs, mark them as active atomically
    const jobs = await this.database.db.execute<{
      id: string;
      name: string;
      data: Record<string, unknown>;
    }>(sql`
      UPDATE ipoint_jobs.job_queue
      SET state = 'active', started_at = now()
      WHERE id IN (
        SELECT id FROM ipoint_jobs.job_queue
        WHERE state = 'created'
        ORDER BY created_at ASC
        LIMIT ${this.workerCount}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, name, data
    `);

    const rows = jobs.rows as {
      id: string;
      name: string;
      data: Record<string, unknown>;
    }[];

    // Process each job. In production these would run in parallel
    // with a concurrency limit. We process serially here for simplicity.
    for (const job of rows) {
      try {
        await this.processJob(job.id, job.name, job.data);
      } catch (err) {
        console.error(`[JobScheduler] Job ${job.id} failed:`, err);
        await this.failJob(
          job.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Re-enqueue the next round of daily accrual jobs
    await this.enqueueDailyAccrualJobs();
  }

  /**
   * Process a single job from the queue.
   */
  async processJob(
    jobId: string,
    _name: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { marketId, localBusinessDate, marketTimezone } = data as {
      marketId: string;
      localBusinessDate: string;
      marketTimezone: string;
    };

    // Acquire advisory lock (transaction-level)
    // This runs inside a transaction so the lock auto-releases
    await this.tryAcquireLock(
      JOB_TYPE_DAILY_REWARD_ACCRUAL,
      marketId,
      localBusinessDate,
    );

    const result = await this.jobService.processDailyAccruals({
      marketId,
      localBusinessDate,
      marketTimezone,
    });

    await this.database.db.execute(sql`
      UPDATE ipoint_jobs.job_queue
      SET state = 'completed', completed_at = now()
      WHERE id = ${jobId}
    `);

    console.log(
      `[JobScheduler] Completed job ${jobId}: processed=${result.processedCount}, failed=${result.failedCount}`,
    );
  }

  /**
   * Mark a job as failed, handling retry logic.
   */
  async failJob(jobId: string, errorMessage: string): Promise<void> {
    await this.database.db.execute(sql`
      UPDATE ipoint_jobs.job_queue
      SET
        state = 'failed',
        completed_at = now(),
        data = jsonb_set(data, '{error}', to_jsonb(${errorMessage}::text))
      WHERE id = ${jobId}
    `);
  }
}
