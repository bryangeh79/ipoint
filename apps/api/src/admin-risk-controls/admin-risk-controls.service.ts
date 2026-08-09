import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  riskDetectionRuns,
  riskEvents,
  riskIdempotencyKeys,
  riskIndicatorDefinitions,
  riskReviewQueue,
  type Database,
} from '@ipoint/database';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  AssignQueueDto,
  CreateDefinitionDto,
  CreateRunDto,
  DecideQueueDto,
  ListDefinitionsQueryDto,
  ListEventsQueryDto,
  ListQueueQueryDto,
  ListRunsQueryDto,
  QueueActionDto,
  QueueNotesDto,
} from './admin-risk-controls.dto.js';
import {
  RiskError,
  type ActiveDefinition,
  type AdminListResponse,
  type DetectedEvent,
  type RiskActor,
  type RiskDetectorCode,
  type RiskEventSeverity,
  type RiskIndicatorCategory,
  type RiskReviewStatus,
  type RiskRunStatus,
} from './admin-risk-controls.types.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type JsonObject = Record<string, unknown>;

/**
 * Detection windows are processed with exact numerics: monetary comparisons
 * run in PostgreSQL against numeric(38,10) columns with string thresholds, so
 * no float arithmetic can ever decide a detection (E-04).
 */

@Injectable()
export class AdminRiskControlsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Indicator definitions (configurable, market-scoped, versioned)
  // -------------------------------------------------------------------------

  async listDefinitions(
    actor: RiskActor,
    marketId: string,
    query: ListDefinitionsQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['market_id = $1'];
    if (!query.includeSuperseded) where.push('superseded_by_id IS NULL');
    if (query.category) {
      values.push(query.category);
      where.push(`category = $${values.length}`);
    }
    if (query.enabled !== undefined) {
      values.push(query.enabled);
      where.push(`enabled = $${values.length}`);
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT *, count(*) OVER()::int AS full_count
         FROM risk_indicator_definitions
        WHERE ${where.join(' AND ')}
        ORDER BY code, version, created_at
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map((row) => {
      const copy = { ...row };
      delete copy['full_count'];
      return definitionDto(copy);
    });
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getDefinition(
    actor: RiskActor,
    marketId: string,
    definitionId: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.definitionById(marketId, definitionId);
  }

  /**
   * Create the next version of a (market, code) indicator definition. A new
   * version is a NEW row (write-once history); it supersedes the current
   * version so the definition chain stays operator-auditable. No business
   * threshold is invented here: `config` is the operator's values and is
   * stored as-is.
   */
  async createDefinition(
    actor: RiskActor,
    marketId: string,
    input: CreateDefinitionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `definition.create:${input.code}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockCurrentDefinition(
          tx,
          marketId,
          input.code,
        );
        const severity = resolveSeverity(input.severity);
        const version = current ? Number(current.version) + 1 : 1;
        const now = new Date();
        const rows = await tx
          .insert(riskIndicatorDefinitions)
          .values({
            code: input.code,
            marketId,
            category: input.category,
            name: input.name,
            description: input.description ?? null,
            enabled: input.enabled,
            config: input.config,
            severity,
            version,
            createdByAdminUserId: actor.adminUserId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const created = required(rows[0]);
        if (current) {
          const superseded = await tx
            .update(riskIndicatorDefinitions)
            .set({
              supersededById: created.id,
              supersededAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(riskIndicatorDefinitions.id, current.id as string),
                eq(riskIndicatorDefinitions.marketId, marketId),
                sql`${riskIndicatorDefinitions.supersededById} is null`,
              ),
            )
            .returning();
          if (!superseded[0]) this.stale(current.version, 'superseded');
        }
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.definition.created',
          'risk_indicator_definition',
          created.id,
          current ? { id: current.id, version: current.version } : null,
          created,
          input.reason,
        );
        return definitionDto(toSnake(created));
      },
    );
  }

  // -------------------------------------------------------------------------
  // Detection runs
  // -------------------------------------------------------------------------

  async listRuns(
    actor: RiskActor,
    marketId: string,
    query: ListRunsQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['market_id = $1'];
    if (query.category) {
      values.push(query.category);
      where.push(`category = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`status = $${values.length}`);
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT *, count(*) OVER()::int AS full_count
         FROM risk_detection_runs
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map((row) => {
      const copy = { ...row };
      delete copy['full_count'];
      return runDto(copy);
    });
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async createRun(
    actor: RiskActor,
    marketId: string,
    input: CreateRunDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      'run.create',
      key,
      input,
      async (tx) => {
        const rows = await tx
          .insert(riskDetectionRuns)
          .values({
            marketId,
            category: input.category,
            status: 'PENDING',
            windowStartAt: new Date(input.windowStart),
            windowEndAt: new Date(input.windowEnd),
            runByAdminUserId: actor.adminUserId,
          })
          .returning();
        const row = required(rows[0]);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.run.created',
          'risk_detection_run',
          row.id,
          null,
          row,
          input.reason,
        );
        return runDto(toSnake(row));
      },
    );
  }

  /**
   * Execute (or re-execute) a run. COMPLETED runs replay the original result;
   * RUNNING runs conflict; PENDING/FAILED/CANCELLED runs take a fresh
   * detection snapshot. Re-execution clears terminal timestamps so
   * risk_detection_runs_timestamps_check holds in RUNNING state (P8-S2 H-1
   * lesson). Detection is strictly read-only over frozen tables; the only
   * writes are the risk domain tables plus the audit log. The run row is
   * locked FOR UPDATE inside the write transaction so concurrent executions
   * cannot both emit evidence; event inserts are ON CONFLICT DO NOTHING so a
   * retried run never duplicates events.
   */
  async executeRun(
    actor: RiskActor,
    marketId: string,
    runId: string,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `run.execute:${runId}`,
      key,
      { runId },
      async (tx) => {
        const run = await this.lockRun(tx, marketId, runId);
        const status = run.status as RiskRunStatus;
        if (status === 'COMPLETED') return runDto(toSnake(run)); // replay
        if (status === 'RUNNING') this.inProgress();
        const startedAt = new Date();
        const runningVersion = Number(run.version) + 1;
        await tx
          .update(riskDetectionRuns)
          .set({
            status: 'RUNNING',
            startedAt,
            completedAt: null,
            failedAt: null,
            cancelledAt: null,
            version: runningVersion,
            updatedAt: startedAt,
          })
          .where(
            and(
              eq(riskDetectionRuns.id, runId),
              eq(riskDetectionRuns.marketId, marketId),
              eq(riskDetectionRuns.status, status),
            ),
          );
        const outcome = await this.detect(
          marketId,
          run.category as RiskIndicatorCategory,
          run.windowStartAt as Date,
          run.windowEndAt as Date,
        );
        if (outcome.events.length > 0) {
          const inserted = await tx
            .insert(riskEvents)
            .values(
              outcome.events.map((event) => ({
                runId,
                marketId,
                indicatorId: event.indicatorId,
                indicatorCode: event.indicatorCode,
                indicatorVersion: event.indicatorVersion,
                category: event.category,
                severity: event.severity,
                entityType: event.entityType,
                entityId: event.entityId,
                entityMarketId: event.entityMarketId ?? marketId,
                payload: event.payload,
                detectionMetadata: event.detectionMetadata,
              })),
            )
            .onConflictDoNothing()
            .returning();
          if (inserted.length > 0) {
            // Flagging only: every detected event enters the review queue.
            // No account/merchant/ledger state is ever touched.
            await tx
              .insert(riskReviewQueue)
              .values(
                inserted.map((event) => ({
                  eventId: event.id,
                  marketId,
                })),
              )
              .onConflictDoNothing();
          }
        }
        const completedAt = new Date();
        const finalized = await tx
          .update(riskDetectionRuns)
          .set({
            status: 'COMPLETED',
            completedAt,
            definitionsScanned: outcome.definitionsScanned,
            eventsDetected: outcome.events.length,
            summary: {
              category: run.category,
              window_start: run.windowStartAt,
              window_end: run.windowEndAt,
              definitions_scanned: outcome.definitionsScanned,
              events_detected: outcome.events.length,
              detectors_run: outcome.detectorsRun,
            },
            version: runningVersion + 1,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(riskDetectionRuns.id, runId),
              eq(riskDetectionRuns.marketId, marketId),
              eq(riskDetectionRuns.status, 'RUNNING'),
              eq(riskDetectionRuns.version, runningVersion),
            ),
          )
          .returning();
        const finalizedRow = finalized[0];
        if (!finalizedRow) this.invalidTransition('RUNNING', 'CANCELLED');
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.run.executed',
          'risk_detection_run',
          runId,
          run,
          finalizedRow,
          'Run executed.',
        );
        return runDto(toSnake(finalizedRow));
      },
    ).catch(async (error) => {
      if (error instanceof RiskError) throw error;
      await this.markFailed(marketId, runId, error);
      throw error;
    });
  }

  async cancelRun(
    actor: RiskActor,
    marketId: string,
    runId: string,
    input: QueueActionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `run.cancel:${runId}`,
      key,
      input,
      async (tx) => {
        const run = await this.lockRun(tx, marketId, runId);
        const status = run.status as RiskRunStatus;
        if (status !== 'PENDING' && status !== 'RUNNING')
          this.invalidTransition(status, 'CANCELLED');
        const now = new Date();
        const rows = await tx
          .update(riskDetectionRuns)
          .set({
            status: 'CANCELLED',
            cancelledAt: now,
            version: Number(run.version) + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(riskDetectionRuns.id, runId),
              eq(riskDetectionRuns.marketId, marketId),
              eq(riskDetectionRuns.status, status),
              eq(riskDetectionRuns.version, run.version as number),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(run.version, 'unknown');
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.run.cancelled',
          'risk_detection_run',
          runId,
          run,
          updated,
          input.reason,
        );
        return runDto(toSnake(updated));
      },
    );
  }

  async getRun(actor: RiskActor, marketId: string, runId: string) {
    this.assertMarket(actor, marketId);
    const run = await this.runById(marketId, runId);
    const events = await this.database.pool.query(
      `SELECT * FROM risk_events
        WHERE run_id = $1 AND market_id = $2
        ORDER BY created_at, id`,
      [runId, marketId],
    );
    return {
      ...runDto(run),
      events: (events.rows as unknown as JsonObject[]).map((row) =>
        eventDto(row),
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Risk events
  // -------------------------------------------------------------------------

  async listEvents(
    actor: RiskActor,
    marketId: string,
    query: ListEventsQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['market_id = $1'];
    if (query.category) {
      values.push(query.category);
      where.push(`category = $${values.length}`);
    }
    if (query.severity) {
      values.push(query.severity);
      where.push(`severity = $${values.length}`);
    }
    if (query.indicatorCode) {
      values.push(query.indicatorCode);
      where.push(`indicator_code = $${values.length}`);
    }
    if (query.entityType) {
      values.push(query.entityType);
      where.push(`entity_type = $${values.length}`);
    }
    if (query.entityId) {
      values.push(query.entityId);
      where.push(`entity_id = $${values.length}`);
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT *, count(*) OVER()::int AS full_count
         FROM risk_events
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map((row) => {
      const copy = { ...row };
      delete copy['full_count'];
      return eventDto(copy);
    });
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getEvent(actor: RiskActor, marketId: string, eventId: string) {
    this.assertMarket(actor, marketId);
    return this.eventById(marketId, eventId);
  }

  // -------------------------------------------------------------------------
  // Review queue
  // -------------------------------------------------------------------------

  async listQueue(
    actor: RiskActor,
    marketId: string,
    query: ListQueueQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['q.market_id = $1'];
    if (query.status) {
      values.push(query.status);
      where.push(`q.status = $${values.length}`);
    }
    if (query.decision) {
      values.push(query.decision);
      where.push(`q.decision = $${values.length}`);
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT q.*, e.indicator_code, e.category, e.severity,
              e.entity_type, e.entity_id,
              count(*) OVER()::int AS full_count
         FROM risk_review_queue q
         JOIN risk_events e ON e.id = q.event_id AND e.market_id = q.market_id
        WHERE ${where.join(' AND ')}
        ORDER BY q.created_at DESC, q.id
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map((row) => {
      const copy = { ...row };
      delete copy['full_count'];
      return taskDto(copy);
    });
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getTask(actor: RiskActor, marketId: string, taskId: string) {
    this.assertMarket(actor, marketId);
    return this.taskById(marketId, taskId);
  }

  /** OPEN -> IN_REVIEW. With no assignee the actor claims the task. */
  async assignTask(
    actor: RiskActor,
    marketId: string,
    taskId: string,
    input: AssignQueueDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `queue.assign:${taskId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockTask(tx, marketId, taskId);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        assertReviewTransition('assign', current.status as RiskReviewStatus);
        const now = new Date();
        const changes: JsonObject = {
          status: 'IN_REVIEW',
          assignedAdminUserId: input.assigneeAdminUserId ?? actor.adminUserId,
          version: input.expectedVersion + 1,
          updatedAt: now,
        };
        const rows = await tx
          .update(riskReviewQueue)
          .set(changes)
          .where(
            and(
              eq(riskReviewQueue.id, taskId),
              eq(riskReviewQueue.marketId, marketId),
              eq(riskReviewQueue.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.queue.assigned',
          'risk_review_task',
          taskId,
          current,
          updated,
          input.reason,
        );
        return taskDto(toSnake(updated));
      },
    );
  }

  /** IN_REVIEW: record a neutral operational review decision. */
  async decideTask(
    actor: RiskActor,
    marketId: string,
    taskId: string,
    input: DecideQueueDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `queue.decide:${taskId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockTask(tx, marketId, taskId);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        assertReviewTransition('decide', current.status as RiskReviewStatus);
        const now = new Date();
        const changes: JsonObject = {
          decision: input.decision,
          decisionReason: input.decisionReason,
          version: input.expectedVersion + 1,
          updatedAt: now,
        };
        const rows = await tx
          .update(riskReviewQueue)
          .set(changes)
          .where(
            and(
              eq(riskReviewQueue.id, taskId),
              eq(riskReviewQueue.marketId, marketId),
              eq(riskReviewQueue.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.queue.decided',
          'risk_review_task',
          taskId,
          current,
          updated,
          input.reason,
        );
        return taskDto(toSnake(updated));
      },
    );
  }

  /** IN_REVIEW -> RESOLVED; a recorded decision is required. */
  async resolveTask(
    actor: RiskActor,
    marketId: string,
    taskId: string,
    input: QueueActionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `queue.resolve:${taskId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockTask(tx, marketId, taskId);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        assertReviewTransition('resolve', current.status as RiskReviewStatus);
        if (!current.decision) this.invalidTransition('IN_REVIEW', 'RESOLVED');
        const now = new Date();
        const rows = await tx
          .update(riskReviewQueue)
          .set({
            status: 'RESOLVED',
            resolvedByAdminUserId: actor.adminUserId,
            resolvedAt: now,
            version: input.expectedVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(riskReviewQueue.id, taskId),
              eq(riskReviewQueue.marketId, marketId),
              eq(riskReviewQueue.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.queue.resolved',
          'risk_review_task',
          taskId,
          current,
          updated,
          input.reason,
        );
        return taskDto(toSnake(updated));
      },
    );
  }

  /** Append an actor-stamped note; notes are append-only, never editable. */
  async appendTaskNotes(
    actor: RiskActor,
    marketId: string,
    taskId: string,
    input: QueueNotesDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `queue.notes:${taskId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockTask(tx, marketId, taskId);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        assertReviewTransition('notes', current.status as RiskReviewStatus);
        const now = new Date();
        const stamp = `${now.toISOString()} | ${actor.adminUserId}: ${input.notes}`;
        const previous = (current.notes as string | null) ?? null;
        const notesValue = previous ? `${previous}\n${stamp}` : stamp;
        const rows = await tx
          .update(riskReviewQueue)
          .set({
            notes: notesValue,
            version: input.expectedVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(riskReviewQueue.id, taskId),
              eq(riskReviewQueue.marketId, marketId),
              eq(riskReviewQueue.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'risk.queue.notes',
          'risk_review_task',
          taskId,
          { notes: previous },
          { notes: notesValue },
          input.reason,
        );
        return taskDto(toSnake(updated));
      },
    );
  }

  // -------------------------------------------------------------------------
  // Detection pipeline (READ-ONLY over frozen tables)
  // -------------------------------------------------------------------------

  private async activeDefinitions(
    marketId: string,
    category: RiskIndicatorCategory,
  ): Promise<ActiveDefinition[]> {
    const result = await this.database.pool.query(
      `SELECT id, code, market_id, category, name, enabled, config,
              severity, version
         FROM risk_indicator_definitions
        WHERE market_id = $1 AND category = $2
          AND enabled = true
          AND superseded_by_id IS NULL
          AND archived_at IS NULL
        ORDER BY code, version`,
      [marketId, category],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      id: text(row['id']),
      code: text(row['code']),
      marketId: text(row['market_id']),
      category: text(row['category']) as RiskIndicatorCategory,
      name: text(row['name']),
      enabled: Boolean(row['enabled']),
      config: asObject(row['config']),
      severity: text(row['severity'], 'MEDIUM') as RiskEventSeverity,
      version: Number(row['version'] ?? 1),
    }));
  }

  private async detect(
    marketId: string,
    category: RiskIndicatorCategory,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{
    events: DetectedEvent[];
    definitionsScanned: number;
    detectorsRun: Array<{ code: string; events: number }>;
  }> {
    const definitions = await this.activeDefinitions(marketId, category);
    const events: DetectedEvent[] = [];
    const detectorsRun: Array<{ code: string; events: number }> = [];
    for (const definition of definitions) {
      const config = definition.config;
      if (!detectorConfigured(definition.code, config)) continue;
      const items = await this.runDetector(
        marketId,
        definition,
        windowStart,
        windowEnd,
      );
      detectorsRun.push({ code: definition.code, events: items.length });
      events.push(...items);
    }
    return {
      events,
      definitionsScanned: definitions.length,
      detectorsRun,
    };
  }

  private async runDetector(
    marketId: string,
    definition: ActiveDefinition,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedEvent[]> {
    const config = definition.config;
    const context = {
      indicatorId: definition.id,
      indicatorCode: definition.code,
      indicatorVersion: definition.version,
      category: definition.category,
      severity: definition.severity,
    };
    switch (definition.code as RiskDetectorCode) {
      case 'suspicious_amount_breach':
        return this.detectSuspiciousAmount(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      case 'duplicate_confirmed_transaction':
        return this.detectDuplicateTransaction(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      case 'adjustment_execution_velocity':
        return this.detectAdjustmentVelocity(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      case 'rate_period_overlap':
        return this.detectRateOverlap(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      case 'cross_market_wallet_entry':
        return this.detectCrossMarketWalletEntry(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      case 'admin_action_velocity':
        return this.detectAdminVelocity(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      case 'security_event_failure_burst':
        return this.detectSecurityBurst(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      case 'review_queue_aging':
        return this.detectQueueAging(
          marketId,
          windowStart,
          windowEnd,
          config,
          context,
        );
      default:
        // Unknown / operator-invented codes are ignored by the engine.
        return [];
    }
  }

  private async detectSuspiciousAmount(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    const maxAmount = requiredDecimal(config, 'max_single_amount');
    if (!maxAmount) return [];
    const result = await this.database.pool.query(
      `SELECT t.id, t.purchase_amount, t.member_id, t.merchant_branch_id,
              t.currency, t.confirmed_at
         FROM transactions t
        WHERE t.market_id = $1
          AND t.status = 'CONFIRMED'
          AND t.confirmed_at >= $2 AND t.confirmed_at < $3
          AND t.purchase_amount > $4::numeric(38,10)
        ORDER BY t.confirmed_at, t.id`,
      [marketId, windowStart, windowEnd, maxAmount],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      ...context,
      entityType: 'transaction',
      entityId: text(row['id']),
      payload: {
        transaction_id: text(row['id']),
        member_id: text(row['member_id']),
        merchant_branch_id: text(row['merchant_branch_id']),
        purchase_amount: text(row['purchase_amount'], '0'),
        currency: text(row['currency']),
        confirmed_at: iso(row['confirmed_at']),
        max_single_amount: maxAmount,
      },
      detectionMetadata: {
        detector: context.indicatorCode,
        comparison: 'purchase_amount > max_single_amount',
      },
    }));
  }

  private async detectDuplicateTransaction(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    const windowMinutes = requiredPositiveInt(
      config,
      'duplicate_window_minutes',
    );
    if (!windowMinutes) return [];
    const result = await this.database.pool.query(
      `SELECT t1.id AS transaction_id, t1.member_id, t1.merchant_branch_id,
              t1.purchase_amount, t1.currency, t1.confirmed_at,
              t2.id AS prior_transaction_id, t2.confirmed_at AS prior_confirmed_at
         FROM transactions t1
         JOIN transactions t2
           ON t2.member_id = t1.member_id
          AND t2.merchant_branch_id = t1.merchant_branch_id
          AND t2.purchase_amount = t1.purchase_amount
          AND t2.id <> t1.id
          AND t2.confirmed_at <= t1.confirmed_at
          AND t1.confirmed_at - t2.confirmed_at
              <= make_interval(mins => $4)
        WHERE t1.market_id = $1
          AND t1.status = 'CONFIRMED' AND t2.status = 'CONFIRMED'
          AND t1.confirmed_at >= $2 AND t1.confirmed_at < $3
        ORDER BY t1.confirmed_at, t1.id`,
      [marketId, windowStart, windowEnd, windowMinutes],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      ...context,
      entityType: 'transaction',
      entityId: text(row['transaction_id']),
      payload: {
        transaction_id: text(row['transaction_id']),
        member_id: text(row['member_id']),
        merchant_branch_id: text(row['merchant_branch_id']),
        purchase_amount: text(row['purchase_amount'], '0'),
        currency: text(row['currency']),
        confirmed_at: iso(row['confirmed_at']),
        prior_transaction_id: text(row['prior_transaction_id']),
        prior_confirmed_at: iso(row['prior_confirmed_at']),
        duplicate_window_minutes: windowMinutes,
      },
      detectionMetadata: {
        detector: context.indicatorCode,
        match: 'same member + branch + amount within duplicate_window_minutes',
      },
    }));
  }

  private async detectAdjustmentVelocity(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    const windowMinutes = requiredPositiveInt(config, 'window_minutes');
    const maxCount = requiredPositiveInt(config, 'max_adjustment_count');
    if (!windowMinutes || !maxCount) return [];
    const result = await this.database.pool.query(
      `SELECT maker_admin_user_id,
              count(*)::int AS adjustment_count
         FROM (
           SELECT maker_admin_user_id, executed_at
             FROM mcp_adjustment_requests
            WHERE market_id = $1 AND status = 'EXECUTED'
              AND executed_at >= $2 AND executed_at < $3
           UNION ALL
           SELECT maker_admin_user_id, executed_at
             FROM ipoint_adjustment_requests
            WHERE market_id = $1 AND state = 'EXECUTED'
              AND executed_at >= $2 AND executed_at < $3
         ) adjustments
        GROUP BY maker_admin_user_id
        HAVING count(*) > $4`,
      [marketId, windowStart, windowEnd, maxCount],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      ...context,
      entityType: 'admin_user',
      entityId: text(row['maker_admin_user_id']),
      payload: {
        maker_admin_user_id: text(row['maker_admin_user_id']),
        adjustment_count: Number(row['adjustment_count'] ?? 0),
        window_minutes: windowMinutes,
        max_adjustment_count: maxCount,
        sources: ['mcp_adjustment_requests', 'ipoint_adjustment_requests'],
      },
      detectionMetadata: {
        detector: context.indicatorCode,
        comparison: 'executed adjustment count > max_adjustment_count',
      },
    }));
  }

  private async detectRateOverlap(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    void config; // structural detector: no operator threshold required
    const events: DetectedEvent[] = [];
    const reward = await this.database.pool.query(
      `SELECT a.id AS version_id, a.name, a.reward_rate,
              a.effective_from, a.effective_to,
              b.id AS overlapping_version_id
         FROM reward_rule_versions a
         JOIN reward_rule_versions b
           ON b.market_id = a.market_id
          AND b.id <> a.id
          AND a.effective_from < coalesce(b.effective_to, 'infinity'::timestamptz)
          AND b.effective_from < coalesce(a.effective_to, 'infinity'::timestamptz)
        WHERE a.market_id = $1
          AND a.effective_from >= $2 AND a.effective_from < $3
        ORDER BY a.id, b.id`,
      [marketId, windowStart, windowEnd],
    );
    for (const row of reward.rows as unknown as JsonObject[]) {
      events.push({
        ...context,
        entityType: 'reward_rule_version',
        entityId: text(row['version_id']),
        payload: {
          version_id: text(row['version_id']),
          name: text(row['name']),
          reward_rate: text(row['reward_rate'], '0'),
          effective_from: iso(row['effective_from']),
          effective_to: iso(row['effective_to']),
          overlapping_version_id: text(row['overlapping_version_id']),
        },
        detectionMetadata: {
          detector: context.indicatorCode,
          table: 'reward_rule_versions',
          signal: 'overlapping effective periods in the same market',
        },
      });
    }
    const fees = await this.database.pool.query(
      `SELECT a.id AS version_id, a.rate, a.effective_from, a.effective_to,
              b.id AS overlapping_version_id
         FROM service_fee_versions a
         JOIN service_fee_versions b
           ON b.market_id = a.market_id
          AND b.service_fee_profile_id = a.service_fee_profile_id
          AND b.id <> a.id
          AND a.effective_from < coalesce(b.effective_to, 'infinity'::timestamptz)
          AND b.effective_from < coalesce(a.effective_to, 'infinity'::timestamptz)
        WHERE a.market_id = $1
          AND a.status IN ('ACTIVE', 'SCHEDULED')
          AND b.status IN ('ACTIVE', 'SCHEDULED')
          AND a.effective_from >= $2 AND a.effective_from < $3
        ORDER BY a.id, b.id`,
      [marketId, windowStart, windowEnd],
    );
    for (const row of fees.rows as unknown as JsonObject[]) {
      events.push({
        ...context,
        entityType: 'service_fee_version',
        entityId: text(row['version_id']),
        payload: {
          version_id: text(row['version_id']),
          rate: text(row['rate'], '0'),
          effective_from: iso(row['effective_from']),
          effective_to: iso(row['effective_to']),
          overlapping_version_id: text(row['overlapping_version_id']),
        },
        detectionMetadata: {
          detector: context.indicatorCode,
          table: 'service_fee_versions',
          signal: 'overlapping effective periods in the same market',
        },
      });
    }
    return events;
  }

  private async detectCrossMarketWalletEntry(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    void config; // structural detector
    const result = await this.database.pool.query(
      `SELECT e.id AS entry_id, e.market_id AS entry_market_id,
              e.amount, e.entry_type, e.member_id, e.created_at,
              w.id AS wallet_account_id, w.market_id AS wallet_market_id
         FROM member_wallet_entries e
         JOIN member_wallet_accounts w ON w.id = e.wallet_account_id
        WHERE (e.market_id = $1 OR w.market_id = $1)
          AND e.market_id <> w.market_id
          AND e.created_at >= $2 AND e.created_at < $3
        ORDER BY e.id`,
      [marketId, windowStart, windowEnd],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      ...context,
      entityType: 'wallet_entry',
      entityId: text(row['entry_id']),
      entityMarketId: text(row['entry_market_id']),
      payload: {
        entry_id: text(row['entry_id']),
        entry_market_id: text(row['entry_market_id']),
        wallet_account_id: text(row['wallet_account_id']),
        wallet_market_id: text(row['wallet_market_id']),
        member_id: text(row['member_id']),
        amount: text(row['amount'], '0'),
        entry_type: text(row['entry_type']),
        created_at: iso(row['created_at']),
      },
      detectionMetadata: {
        detector: context.indicatorCode,
        signal: 'wallet entry market differs from wallet account market',
      },
    }));
  }

  private async detectAdminVelocity(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    const windowMinutes = requiredPositiveInt(config, 'window_minutes');
    const maxActions = requiredPositiveInt(config, 'max_actions');
    if (!windowMinutes || !maxActions) return [];
    const result = await this.database.pool.query(
      `SELECT actor_id, count(*)::int AS action_count,
              count(DISTINCT action)::int AS distinct_actions
         FROM audit_logs
        WHERE actor_type = 'ADMIN_USER' AND market_id = $1
          AND occurred_at >= $2 AND occurred_at < $3
        GROUP BY actor_id
        HAVING count(*) > $4`,
      [marketId, windowStart, windowEnd, maxActions],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      ...context,
      entityType: 'admin_user',
      entityId: text(row['actor_id']),
      payload: {
        admin_user_id: text(row['actor_id']),
        action_count: Number(row['action_count'] ?? 0),
        distinct_actions: Number(row['distinct_actions'] ?? 0),
        window_minutes: windowMinutes,
        max_actions: maxActions,
      },
      detectionMetadata: {
        detector: context.indicatorCode,
        comparison: 'audit action count > max_actions',
      },
    }));
  }

  private async detectSecurityBurst(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    const windowMinutes = requiredPositiveInt(config, 'window_minutes');
    const maxFailures = requiredPositiveInt(config, 'max_failures');
    if (!windowMinutes || !maxFailures) return [];
    const result = await this.database.pool.query(
      `SELECT m.id AS member_id, a.id AS account_id,
              count(se.id)::int AS failure_count
         FROM security_events se
         JOIN accounts a ON a.id = se.account_id
         JOIN members m ON m.account_id = a.id
         JOIN member_market_preferences p
           ON p.member_id = m.id AND p.market_id = $1 AND p.is_current = true
        WHERE se.result IN ('FAILURE', 'DENIED')
          AND se.occurred_at >= $2 AND se.occurred_at < $3
        GROUP BY m.id, a.id
        HAVING count(se.id) > $4`,
      [marketId, windowStart, windowEnd, maxFailures],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      ...context,
      entityType: 'member',
      entityId: text(row['member_id']),
      payload: {
        member_id: text(row['member_id']),
        account_id: text(row['account_id']),
        failure_count: Number(row['failure_count'] ?? 0),
        window_minutes: windowMinutes,
        max_failures: maxFailures,
        results: ['FAILURE', 'DENIED'],
      },
      detectionMetadata: {
        detector: context.indicatorCode,
        comparison: 'security failure count > max_failures',
      },
    }));
  }

  private async detectQueueAging(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
    config: JsonObject,
    context: DetectorContext,
  ): Promise<DetectedEvent[]> {
    const maxOpenDays = requiredPositiveInt(config, 'max_open_days');
    if (!maxOpenDays) return [];
    const asOf = new Date();
    const result = await this.database.pool.query(
      `SELECT q.id AS task_id, q.event_id, q.created_at
         FROM risk_review_queue q
        WHERE q.market_id = $1
          AND q.status = 'OPEN'
          AND q.created_at >= $2 AND q.created_at < $3
          AND q.created_at < $4::timestamptz - make_interval(days => $5)
        ORDER BY q.created_at, q.id`,
      [marketId, windowStart, windowEnd, asOf, maxOpenDays],
    );
    return (result.rows as unknown as JsonObject[]).map((row) => ({
      ...context,
      entityType: 'risk_review_task',
      entityId: text(row['task_id']),
      payload: {
        review_task_id: text(row['task_id']),
        event_id: text(row['event_id']),
        created_at: iso(row['created_at']),
        max_open_days: maxOpenDays,
      },
      detectionMetadata: {
        detector: context.indicatorCode,
        signal: 'review task stayed OPEN beyond max_open_days',
      },
    }));
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  private assertMarket(actor: RiskActor, marketId: string) {
    if (!actor.currentMarketId || actor.currentMarketId !== marketId) {
      throw new RiskError(
        'RISK_MARKET_MISMATCH',
        'The resource market must equal the server Current Admin Market.',
      );
    }
  }

  private async lockRun(
    tx: DatabaseTransaction,
    marketId: string,
    runId: string,
  ) {
    const result = await tx.execute(
      sql`SELECT * FROM risk_detection_runs
           WHERE id = ${safeUuid(runId)}::uuid
             AND market_id = ${safeUuid(marketId)}::uuid
           FOR UPDATE`,
    );
    const row = result.rows[0] as unknown as JsonObject | undefined;
    if (!row) await this.runNotFound(marketId, runId);
    return camelize(row as JsonObject);
  }

  private async lockTask(
    tx: DatabaseTransaction,
    marketId: string,
    taskId: string,
  ) {
    const result = await tx.execute(
      sql`SELECT * FROM risk_review_queue
           WHERE id = ${safeUuid(taskId)}::uuid
             AND market_id = ${safeUuid(marketId)}::uuid
           FOR UPDATE`,
    );
    const row = result.rows[0] as unknown as JsonObject | undefined;
    if (!row) await this.taskNotFound(marketId, taskId);
    return camelize(row as JsonObject);
  }

  private async lockCurrentDefinition(
    tx: DatabaseTransaction,
    marketId: string,
    code: string,
  ) {
    const result = await tx.execute(
      sql`SELECT * FROM risk_indicator_definitions
           WHERE market_id = ${safeUuid(marketId)}::uuid
             AND code = ${code}
             AND superseded_by_id IS NULL
             AND archived_at IS NULL
           FOR UPDATE`,
    );
    const row = result.rows[0] as unknown as JsonObject | undefined;
    return row ? camelize(row) : null;
  }

  private async runById(marketId: string, runId: string) {
    const result = await this.database.pool.query(
      'SELECT * FROM risk_detection_runs WHERE market_id = $1 AND id::text = $2',
      [marketId, runId],
    );
    if (!result.rows[0]) await this.runNotFound(marketId, runId);
    return runDto(result.rows[0] as unknown as JsonObject);
  }

  private async definitionById(marketId: string, definitionId: string) {
    const result = await this.database.pool.query(
      'SELECT * FROM risk_indicator_definitions WHERE market_id = $1 AND id::text = $2',
      [marketId, definitionId],
    );
    if (!result.rows[0]) {
      await this.definitionNotFound(marketId, definitionId);
    }
    return definitionDto(result.rows[0] as unknown as JsonObject);
  }

  private async eventById(marketId: string, eventId: string) {
    const result = await this.database.pool.query(
      'SELECT * FROM risk_events WHERE market_id = $1 AND id::text = $2',
      [marketId, eventId],
    );
    if (!result.rows[0]) await this.eventNotFound(marketId, eventId);
    return eventDto(result.rows[0] as unknown as JsonObject);
  }

  private async taskById(marketId: string, taskId: string) {
    const result = await this.database.pool.query(
      `SELECT q.*, e.indicator_code, e.category, e.severity,
              e.entity_type, e.entity_id
         FROM risk_review_queue q
         JOIN risk_events e ON e.id = q.event_id AND e.market_id = q.market_id
        WHERE q.market_id = $1 AND q.id::text = $2`,
      [marketId, taskId],
    );
    if (!result.rows[0]) await this.taskNotFound(marketId, taskId);
    return taskDto(result.rows[0] as unknown as JsonObject);
  }

  private async runNotFound(marketId: string, runId: string): Promise<never> {
    const foreign = await this.database.pool.query(
      'SELECT 1 FROM risk_detection_runs WHERE id::text = $1 LIMIT 1',
      [runId],
    );
    if (foreign.rows[0])
      throw new RiskError(
        'RISK_MARKET_MISMATCH',
        'The detection run belongs to another market.',
        { market_id: marketId },
      );
    throw new RiskError('RISK_NOT_FOUND', 'The detection run was not found.');
  }

  private async definitionNotFound(
    marketId: string,
    definitionId: string,
  ): Promise<never> {
    const foreign = await this.database.pool.query(
      'SELECT 1 FROM risk_indicator_definitions WHERE id::text = $1 LIMIT 1',
      [definitionId],
    );
    if (foreign.rows[0])
      throw new RiskError(
        'RISK_MARKET_MISMATCH',
        'The indicator definition belongs to another market.',
        { market_id: marketId },
      );
    throw new RiskError(
      'RISK_NOT_FOUND',
      'The indicator definition was not found.',
    );
  }

  private async eventNotFound(
    marketId: string,
    eventId: string,
  ): Promise<never> {
    const foreign = await this.database.pool.query(
      'SELECT 1 FROM risk_events WHERE id::text = $1 LIMIT 1',
      [eventId],
    );
    if (foreign.rows[0])
      throw new RiskError(
        'RISK_MARKET_MISMATCH',
        'The risk event belongs to another market.',
        { market_id: marketId },
      );
    throw new RiskError('RISK_NOT_FOUND', 'The risk event was not found.');
  }

  private async taskNotFound(marketId: string, taskId: string): Promise<never> {
    const foreign = await this.database.pool.query(
      'SELECT 1 FROM risk_review_queue WHERE id::text = $1 LIMIT 1',
      [taskId],
    );
    if (foreign.rows[0])
      throw new RiskError(
        'RISK_MARKET_MISMATCH',
        'The review task belongs to another market.',
        { market_id: marketId },
      );
    throw new RiskError('RISK_NOT_FOUND', 'The review task was not found.');
  }

  private async markFailed(
    marketId: string,
    runId: string,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error
        ? `Detection run failed: ${error.message}`.slice(0, 2000)
        : 'Detection run failed for an unknown reason.';
    await this.database.pool.query(
      `UPDATE risk_detection_runs
          SET status = 'FAILED', failed_at = now(),
              started_at = coalesce(started_at, now()),
              failure_reason = $3,
              version = version + 1,
              updated_at = now()
        WHERE id = $1 AND market_id = $2 AND status = 'PENDING'`,
      [runId, marketId, message],
    );
  }

  private async withIdempotency<T extends JsonObject>(
    actor: RiskActor,
    marketId: string,
    operation: string,
    key: string,
    payload: unknown,
    handler: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (!key || key.length > 200)
      throw new RiskError(
        'RISK_IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    const requestHash = hash(payload);
    try {
      return await this.database.db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(riskIdempotencyKeys)
          .where(
            and(
              eq(riskIdempotencyKeys.adminUserId, actor.adminUserId),
              eq(riskIdempotencyKeys.marketId, marketId),
              eq(riskIdempotencyKeys.operation, operation),
              eq(riskIdempotencyKeys.key, key),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing) {
          if (existing.requestHash !== requestHash || !existing.response)
            this.idempotencyConflict();
          return existing.response as T;
        }
        await tx.insert(riskIdempotencyKeys).values({
          adminUserId: actor.adminUserId,
          marketId,
          operation,
          key,
          requestHash,
        });
        const response = await handler(tx);
        await tx
          .update(riskIdempotencyKeys)
          .set({ response, statusCode: 200, updatedAt: new Date() })
          .where(
            and(
              eq(riskIdempotencyKeys.adminUserId, actor.adminUserId),
              eq(riskIdempotencyKeys.marketId, marketId),
              eq(riskIdempotencyKeys.operation, operation),
              eq(riskIdempotencyKeys.key, key),
            ),
          );
        return response;
      });
    } catch (error) {
      if (error instanceof RiskError) throw error;
      if (databaseCode(error) !== '23505') throw error;
      const rows = await this.database.db
        .select()
        .from(riskIdempotencyKeys)
        .where(
          and(
            eq(riskIdempotencyKeys.adminUserId, actor.adminUserId),
            eq(riskIdempotencyKeys.marketId, marketId),
            eq(riskIdempotencyKeys.operation, operation),
            eq(riskIdempotencyKeys.key, key),
          ),
        )
        .limit(1);
      const existing = rows[0];
      if (existing?.requestHash === requestHash && existing.response)
        return existing.response as T;
      if (existing) this.idempotencyConflict();
      throw new RiskError(
        'RISK_DUPLICATE',
        'A risk record with the same market-scoped identifier already exists.',
      );
    }
  }

  private async writeAudit(
    tx: DatabaseTransaction,
    actor: RiskActor,
    marketId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    reason: string,
  ) {
    await this.audit.appendWithinTransaction(tx, {
      actor: { type: 'ADMIN_USER', id: actor.adminUserId },
      action,
      entity: { type: entityType, id: entityId },
      marketId,
      before,
      after,
      reason,
      result: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      summary: `${entityType} risk operation completed.`,
    });
  }

  private invalidTransition(from: unknown, to: string): never {
    throw new RiskError(
      'RISK_INVALID_TRANSITION',
      `Transition ${text(from)} -> ${to} is not allowed.`,
      { from, to },
    );
  }

  private inProgress(): never {
    throw new RiskError(
      'RISK_RUN_IN_PROGRESS',
      'The detection run is already executing.',
    );
  }

  private stale(expected: unknown, actual: unknown): never {
    throw new RiskError(
      'RISK_STALE_VERSION',
      'The record changed. Refresh and retry.',
      { expected, actual },
    );
  }

  private idempotencyConflict(): never {
    throw new RiskError(
      'RISK_IDEMPOTENCY_CONFLICT',
      'The idempotency key was reused with a different payload.',
    );
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable)
// ---------------------------------------------------------------------------

interface DetectorContext {
  indicatorId: string;
  indicatorCode: string;
  indicatorVersion: number;
  category: RiskIndicatorCategory;
  severity: RiskEventSeverity;
}

/** Validate a severity value against the canonical enum; MEDIUM is the label default. */
export function resolveSeverity(value: unknown): RiskEventSeverity {
  if (
    typeof value === 'string' &&
    (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).includes(
      value as RiskEventSeverity,
    )
  ) {
    return value as RiskEventSeverity;
  }
  return 'MEDIUM';
}

/**
 * Strict review-queue state machine: OPEN -> IN_REVIEW -> RESOLVED. Notes may
 * be appended in OPEN and IN_REVIEW; RESOLVED tasks reject further mutations.
 */
export function assertReviewTransition(
  action: 'assign' | 'decide' | 'resolve' | 'notes',
  from: RiskReviewStatus,
): void {
  const reject = (target: string): never => {
    throw new RiskError(
      'RISK_INVALID_TRANSITION',
      `Transition ${from} -> ${target} is not allowed.`,
      { from, target },
    );
  };
  switch (action) {
    case 'assign':
      if (from !== 'OPEN') reject('IN_REVIEW');
      return;
    case 'decide':
      if (from !== 'IN_REVIEW') reject('decide');
      return;
    case 'resolve':
      if (from !== 'IN_REVIEW') reject('RESOLVED');
      return;
    case 'notes':
      if (from === 'RESOLVED') reject('NOTES');
      return;
  }
}

export function configNumber(
  config: JsonObject,
  key: string,
): number | undefined {
  const value = config[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
}

/** Positive integer operator threshold (e.g. window minutes, counts, days). */
export function requiredPositiveInt(
  config: JsonObject,
  key: string,
): number | undefined {
  const value = configNumber(config, key);
  if (value === undefined || !Number.isInteger(value) || value < 1)
    return undefined;
  return value;
}

/** Exact decimal operator threshold passed to SQL as a string (never a float). */
export function requiredDecimal(
  config: JsonObject,
  key: string,
): string | undefined {
  const value = config[key];
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/u.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Numbers are stringified exactly (small integers) or rejected.
    return Number.isInteger(value) ? String(value) : undefined;
  }
  return undefined;
}

/** Whether a detector may run: structural detectors always run; threshold detectors require their config keys. */
export function detectorConfigured(code: string, config: JsonObject): boolean {
  switch (code) {
    case 'suspicious_amount_breach':
      return requiredDecimal(config, 'max_single_amount') !== undefined;
    case 'duplicate_confirmed_transaction':
      return (
        requiredPositiveInt(config, 'duplicate_window_minutes') !== undefined
      );
    case 'adjustment_execution_velocity':
      return (
        requiredPositiveInt(config, 'window_minutes') !== undefined &&
        requiredPositiveInt(config, 'max_adjustment_count') !== undefined
      );
    case 'admin_action_velocity':
      return (
        requiredPositiveInt(config, 'window_minutes') !== undefined &&
        requiredPositiveInt(config, 'max_actions') !== undefined
      );
    case 'security_event_failure_burst':
      return (
        requiredPositiveInt(config, 'window_minutes') !== undefined &&
        requiredPositiveInt(config, 'max_failures') !== undefined
      );
    case 'review_queue_aging':
      return requiredPositiveInt(config, 'max_open_days') !== undefined;
    case 'rate_period_overlap':
    case 'cross_market_wallet_entry':
      return true;
    default:
      return false;
  }
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function required<T>(value: T | undefined): T {
  if (!value) throw new Error('Expected database row.');
  return value;
}

function safeUuid(value: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(value))
    throw new RiskError('RISK_NOT_FOUND', 'The record was not found.');
  return value;
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; cause?: unknown };
  return typeof record.code === 'string'
    ? record.code
    : databaseCode(record.cause);
}

function camelize(row: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/gu, (_m, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}

function toSnake(row: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/[A-Z]/gu, (letter: string) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as JsonObject;
  return {};
}

function definitionDto(row: JsonObject): JsonObject {
  return {
    id: row['id'],
    code: row['code'],
    market_id: row['market_id'],
    category: row['category'],
    name: row['name'],
    description: row['description'] ?? null,
    enabled: row['enabled'],
    config: row['config'],
    severity: row['severity'],
    version: Number(row['version'] ?? 0),
    superseded_by_id: row['superseded_by_id'] ?? null,
    superseded_at: iso(row['superseded_at']),
    created_by_admin_user_id: row['created_by_admin_user_id'],
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
    archived_at: iso(row['archived_at']),
  };
}

function runDto(row: JsonObject): JsonObject {
  return {
    id: row['id'],
    public_id: row['public_id'],
    market_id: row['market_id'],
    category: row['category'],
    status: row['status'],
    window_start_at: iso(row['window_start_at']),
    window_end_at: iso(row['window_end_at']),
    definitions_scanned: row['definitions_scanned'] ?? null,
    events_detected: row['events_detected'] ?? null,
    summary: row['summary'] ?? null,
    failure_reason: row['failure_reason'] ?? null,
    started_at: iso(row['started_at']),
    completed_at: iso(row['completed_at']),
    failed_at: iso(row['failed_at']),
    cancelled_at: iso(row['cancelled_at']),
    run_by_admin_user_id: row['run_by_admin_user_id'],
    version: Number(row['version'] ?? 0),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
    archived_at: iso(row['archived_at']),
  };
}

function eventDto(row: JsonObject): JsonObject {
  return {
    id: row['id'],
    run_id: row['run_id'],
    market_id: row['market_id'],
    indicator_id: row['indicator_id'],
    indicator_code: row['indicator_code'],
    indicator_version: Number(row['indicator_version'] ?? 0),
    category: row['category'],
    severity: row['severity'],
    entity_type: row['entity_type'],
    entity_id: row['entity_id'],
    entity_market_id: row['entity_market_id'] ?? null,
    payload: row['payload'],
    detection_metadata: row['detection_metadata'],
    status: row['status'],
    created_at: iso(row['created_at']),
  };
}

function taskDto(row: JsonObject): JsonObject {
  const dto: JsonObject = {
    id: row['id'],
    event_id: row['event_id'],
    market_id: row['market_id'],
    status: row['status'],
    assigned_admin_user_id: row['assigned_admin_user_id'] ?? null,
    decision: row['decision'] ?? null,
    decision_reason: row['decision_reason'] ?? null,
    notes: row['notes'] ?? null,
    resolved_by_admin_user_id: row['resolved_by_admin_user_id'] ?? null,
    resolved_at: iso(row['resolved_at']),
    version: Number(row['version'] ?? 0),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
    archived_at: iso(row['archived_at']),
  };
  if (row['indicator_code'] !== undefined) {
    dto['indicator_code'] = row['indicator_code'];
    dto['category'] = row['category'];
    dto['severity'] = row['severity'];
    dto['entity_type'] = row['entity_type'];
    dto['entity_id'] = row['entity_id'];
  }
  return dto;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return text(value, '');
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return fallback;
}
