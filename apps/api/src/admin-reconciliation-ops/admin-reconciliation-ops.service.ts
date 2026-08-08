import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  reconciliationExceptions,
  reconciliationIdempotencyKeys,
  reconciliationRunItems,
  reconciliationRuns,
  type Database,
} from '@ipoint/database';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  CreateRunDto,
  ExceptionActionDto,
  ExceptionNotesDto,
  ListExceptionsQueryDto,
  ListRunsQueryDto,
} from './admin-reconciliation-ops.dto.js';
import {
  ReconciliationError,
  type AdminListResponse,
  type DetectedItem,
  type ReconciliationActor,
  type ReconciliationClassification,
  type ReconciliationKind,
  type ReconciliationRunStatus,
  type RunTotals,
} from './admin-reconciliation-ops.types.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
type JsonObject = Record<string, unknown>;

/**
 * Exact-decimal comparison scale. All financial columns use numeric(38,10);
 * amounts are compared as 10-decimal scaled BigInts so no float rounding can
 * ever decide a match (E-04).
 */
const SCALE = 10n;
const SCALE_FACTOR = 10n ** SCALE;
const ZERO = 0n;

const CREDIT_ENTRY_TYPES = new Set([
  'PENDING',
  'AVAILABLE',
  'COMPENSATION',
  'ADJUSTMENT',
  'REDEMPTION_REFUND',
]);
const DEBIT_ENTRY_TYPES = new Set(['REVERSED', 'REDEMPTION_DEBIT']);

@Injectable()
export class AdminReconciliationOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  async listRuns(
    actor: ReconciliationActor,
    marketId: string,
    query: ListRunsQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['market_id = $1'];
    if (query.kind) {
      values.push(query.kind);
      where.push(`kind = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`status = $${values.length}`);
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT *, count(*) OVER()::int AS full_count
         FROM reconciliation_runs
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
    actor: ReconciliationActor,
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
          .insert(reconciliationRuns)
          .values({
            marketId,
            kind: input.kind,
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
          'reconciliation.run.created',
          'reconciliation_run',
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
   * Execute (or re-execute) a run. COMPLETED runs replay the original result
   * (no new evidence); RUNNING runs conflict; PENDING/FAILED/CANCELLED runs
   * execute a fresh detection snapshot. Detection is strictly read-only; the
   * only writes are the run's own reconciliation tables plus the audit log.
   * Retry safety: the run row is locked FOR UPDATE inside the write
   * transaction, so two concurrent executions cannot both produce evidence.
   */
  async executeRun(
    actor: ReconciliationActor,
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
        const status = run.status as ReconciliationRunStatus;
        if (status === 'COMPLETED') return runDto(toSnake(run)); // idempotent replay
        if (status === 'RUNNING') this.inProgress();
        const startedAt = new Date();
        const runningVersion = Number(run.version) + 1;
        // Re-execution from FAILED/CANCELLED must clear the terminal
        // timestamps: reconciliation_runs_timestamps_check requires all of
        // completed_at/failed_at/cancelled_at to be NULL in RUNNING state.
        await tx
          .update(reconciliationRuns)
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
              eq(reconciliationRuns.id, runId),
              eq(reconciliationRuns.marketId, marketId),
              eq(reconciliationRuns.status, status),
            ),
          );
        const items = await this.detect(
          marketId,
          run.kind as ReconciliationKind,
          run.windowStartAt as Date,
          run.windowEndAt as Date,
        );
        const totals = computeTotals(items);
        if (items.length > 0) {
          await tx
            .insert(reconciliationRunItems)
            .values(
              items.map((item) => ({
                runId,
                marketId,
                referenceType: item.referenceType,
                referenceId: item.referenceId,
                status: item.status,
                expectedAmount: item.expectedAmount,
                actualAmount: item.actualAmount,
                differenceAmount: item.differenceAmount,
                evidence: item.evidence,
              })),
            )
            .onConflictDoNothing();
          const exceptions = items
            .filter((item) => item.status !== 'MATCHED')
            .map((item) => ({
              runId,
              marketId,
              kind: run.kind as ReconciliationKind,
              referenceType: item.referenceType,
              referenceId: item.referenceId,
              expectedAmount: item.expectedAmount,
              actualAmount: item.actualAmount,
              differenceAmount: item.differenceAmount,
              classification: classificationFor(item.status),
            }));
          if (exceptions.length > 0) {
            await tx
              .insert(reconciliationExceptions)
              .values(exceptions)
              .onConflictDoNothing();
          }
        }
        const completedAt = new Date();
        const finalized = await tx
          .update(reconciliationRuns)
          .set({
            status: 'COMPLETED',
            completedAt,
            expectedTotal: totals.expectedTotal,
            actualTotal: totals.actualTotal,
            differenceTotal: totals.differenceTotal,
            matchedCount: totals.matchedCount,
            mismatchedCount: totals.mismatchedCount,
            exceptionCount: totals.exceptionCount,
            summary: {
              kind: run.kind,
              window_start: run.windowStartAt,
              window_end: run.windowEndAt,
              item_count: items.length,
              matched_count: totals.matchedCount,
              mismatched_count: totals.mismatchedCount,
              exception_count: totals.exceptionCount,
            },
            version: runningVersion + 1,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(reconciliationRuns.id, runId),
              eq(reconciliationRuns.marketId, marketId),
              eq(reconciliationRuns.status, 'RUNNING'),
              eq(reconciliationRuns.version, runningVersion),
            ),
          )
          .returning();
        const finalizedRow = finalized[0];
        if (!finalizedRow) {
          // The run was cancelled while detection was in flight; the
          // transaction rolls back and no evidence is persisted.
          this.invalidTransition('RUNNING', 'CANCELLED');
        }
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'reconciliation.run.executed',
          'reconciliation_run',
          runId,
          run,
          finalizedRow,
          'Run executed.',
        );
        return runDto(toSnake(finalizedRow));
      },
    ).catch(async (error) => {
      if (error instanceof ReconciliationError) throw error;
      await this.markFailed(marketId, runId, error);
      throw error;
    });
  }

  async cancelRun(
    actor: ReconciliationActor,
    marketId: string,
    runId: string,
    input: ExceptionActionDto,
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
        const status = run.status as ReconciliationRunStatus;
        if (status !== 'PENDING' && status !== 'RUNNING')
          this.invalidTransition(status, 'CANCELLED');
        const now = new Date();
        const rows = await tx
          .update(reconciliationRuns)
          .set({
            status: 'CANCELLED',
            cancelledAt: now,
            version: Number(run.version) + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(reconciliationRuns.id, runId),
              eq(reconciliationRuns.marketId, marketId),
              eq(reconciliationRuns.status, status),
              eq(reconciliationRuns.version, run.version),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(run.version, 'unknown');
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'reconciliation.run.cancelled',
          'reconciliation_run',
          runId,
          run,
          updated,
          input.reason,
        );
        return runDto(toSnake(updated));
      },
    );
  }

  async getRun(actor: ReconciliationActor, marketId: string, runId: string) {
    this.assertMarket(actor, marketId);
    const run = await this.runById(marketId, runId);
    const items = await this.database.pool.query(
      `SELECT * FROM reconciliation_run_items
        WHERE run_id = $1 AND market_id = $2
        ORDER BY created_at, id`,
      [runId, marketId],
    );
    const exceptions = await this.database.pool.query(
      `SELECT * FROM reconciliation_exceptions
        WHERE run_id = $1 AND market_id = $2
        ORDER BY created_at, id`,
      [runId, marketId],
    );
    return {
      ...runDto(run),
      items: items.rows.map((row) => runItemDto(row as JsonObject)),
      exceptions: exceptions.rows.map((row) => exceptionDto(row as JsonObject)),
    };
  }

  async listRunItems(
    actor: ReconciliationActor,
    marketId: string,
    runId: string,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    await this.runById(marketId, runId);
    const result = await this.database.pool.query(
      `SELECT *, count(*) OVER()::int AS full_count
         FROM reconciliation_run_items
        WHERE run_id = $1 AND market_id = $2
        ORDER BY created_at, id`,
      [runId, marketId],
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map((row) => {
      const copy = { ...row };
      delete copy['full_count'];
      return runItemDto(copy);
    });
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: rows.length,
      offset: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Exception queue
  // -------------------------------------------------------------------------

  async listExceptions(
    actor: ReconciliationActor,
    marketId: string,
    query: ListExceptionsQueryDto,
  ): Promise<AdminListResponse<JsonObject>> {
    this.assertMarket(actor, marketId);
    const values: unknown[] = [marketId];
    const where = ['market_id = $1'];
    if (query.kind) {
      values.push(query.kind);
      where.push(`kind = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`status = $${values.length}`);
    }
    if (query.classification) {
      values.push(query.classification);
      where.push(`classification = $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      where.push(
        `(reference_type ILIKE $${values.length} OR reference_id ILIKE $${values.length} OR coalesce(investigation_notes, '') ILIKE $${values.length})`,
      );
    }
    values.push(query.limit, query.offset);
    const result = await this.database.pool.query(
      `SELECT *, count(*) OVER()::int AS full_count
         FROM reconciliation_exceptions
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const rows = result.rows as unknown as JsonObject[];
    const items = rows.map((row) => {
      const copy = { ...row };
      delete copy['full_count'];
      return exceptionDto(copy);
    });
    return {
      market_id: marketId,
      items,
      total: Number(rows[0]?.['full_count'] ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getException(
    actor: ReconciliationActor,
    marketId: string,
    exceptionId: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.exceptionById(marketId, exceptionId);
  }

  async acknowledgeException(
    actor: ReconciliationActor,
    marketId: string,
    exceptionId: string,
    input: ExceptionActionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.transitionException(
      actor,
      marketId,
      exceptionId,
      'acknowledge',
      'OPEN',
      'ACKNOWLEDGED',
      input,
      key,
    );
  }

  async resolveException(
    actor: ReconciliationActor,
    marketId: string,
    exceptionId: string,
    input: ExceptionActionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.transitionException(
      actor,
      marketId,
      exceptionId,
      'resolve',
      'ACKNOWLEDGED',
      'RESOLVED',
      input,
      key,
    );
  }

  async closeException(
    actor: ReconciliationActor,
    marketId: string,
    exceptionId: string,
    input: ExceptionActionDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.transitionException(
      actor,
      marketId,
      exceptionId,
      'close',
      'RESOLVED',
      'CLOSED',
      input,
      key,
    );
  }

  async appendExceptionNotes(
    actor: ReconciliationActor,
    marketId: string,
    exceptionId: string,
    input: ExceptionNotesDto,
    key: string,
  ) {
    this.assertMarket(actor, marketId);
    return this.withIdempotency(
      actor,
      marketId,
      `exception.notes:${exceptionId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockException(tx, marketId, exceptionId);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        if ((current.status as string) === 'CLOSED')
          this.invalidTransition('CLOSED', 'NOTES');
        const now = new Date();
        const stamp = `${now.toISOString()} — ${actor.adminUserId}: ${input.notes}`;
        const previous = (current.investigationNotes as string | null) ?? null;
        const investigationNotes = previous ? `${previous}\n${stamp}` : stamp;
        const rows = await tx
          .update(reconciliationExceptions)
          .set({
            investigationNotes,
            version: input.expectedVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(reconciliationExceptions.id, exceptionId),
              eq(reconciliationExceptions.marketId, marketId),
              eq(reconciliationExceptions.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          'reconciliation.exception.notes',
          'reconciliation_exception',
          exceptionId,
          { investigation_notes: previous },
          { investigation_notes: investigationNotes },
          input.reason,
        );
        return exceptionDto(toSnake(updated));
      },
    );
  }

  private async transitionException(
    actor: ReconciliationActor,
    marketId: string,
    exceptionId: string,
    action: 'acknowledge' | 'resolve' | 'close',
    from: string,
    to: string,
    input: ExceptionActionDto,
    key: string,
  ) {
    return this.withIdempotency(
      actor,
      marketId,
      `exception.${action}:${exceptionId}`,
      key,
      input,
      async (tx) => {
        const current = await this.lockException(tx, marketId, exceptionId);
        if (Number(current.version) !== input.expectedVersion)
          this.stale(input.expectedVersion, current.version);
        if ((current.status as string) !== from)
          this.invalidTransition(current.status, to);
        const now = new Date();
        const changes: JsonObject = {
          status: to,
          version: input.expectedVersion + 1,
          updatedAt: now,
        };
        if (action === 'acknowledge') {
          changes['acknowledgedByAdminUserId'] = actor.adminUserId;
          changes['acknowledgedAt'] = now;
        } else if (action === 'resolve') {
          changes['resolvedByAdminUserId'] = actor.adminUserId;
          changes['resolvedAt'] = now;
        } else {
          changes['closedByAdminUserId'] = actor.adminUserId;
          changes['closedAt'] = now;
        }
        const rows = await tx
          .update(reconciliationExceptions)
          .set(changes)
          .where(
            and(
              eq(reconciliationExceptions.id, exceptionId),
              eq(reconciliationExceptions.marketId, marketId),
              eq(reconciliationExceptions.version, input.expectedVersion),
            ),
          )
          .returning();
        const updated = rows[0];
        if (!updated) this.stale(input.expectedVersion, current.version);
        await this.writeAudit(
          tx,
          actor,
          marketId,
          `reconciliation.exception.${action}d`,
          'reconciliation_exception',
          exceptionId,
          current,
          updated,
          input.reason,
        );
        return exceptionDto(toSnake(updated));
      },
    );
  }

  // -------------------------------------------------------------------------
  // Difference detection (READ-ONLY: frozen tables are never written)
  // -------------------------------------------------------------------------

  private async detect(
    marketId: string,
    kind: ReconciliationKind,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedItem[]> {
    switch (kind) {
      case 'MCP':
        return this.detectMcp(marketId, windowStart, windowEnd);
      case 'IPOINT':
        return this.detectIpoint(marketId, windowStart, windowEnd);
      case 'TRANSACTION_LEDGER':
        return this.detectTransactionLedger(marketId, windowStart, windowEnd);
      case 'COMMISSION':
        return this.detectCommission(marketId, windowStart, windowEnd);
      case 'REFUND':
        return this.detectRefund(marketId, windowStart, windowEnd);
      case 'REDEMPTION':
        return this.detectRedemption(marketId, windowStart, windowEnd);
      default:
        throw new ReconciliationError(
          'RECONCILIATION_INVALID_INPUT',
          `Unsupported reconciliation kind: ${text(kind)}`,
        );
    }
  }

  /** MCP: ledger net (lifetime) vs maintained balance columns per account. */
  private async detectMcp(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedItem[]> {
    const result = await this.database.pool.query(
      `SELECT a.id AS account_id, a.total_balance, a.available_balance,
              coalesce(sum(e.balance_delta), 0)::numeric(38,10) AS ledger_total,
              coalesce(sum(e.available_delta), 0)::numeric(38,10) AS ledger_available,
              count(e.id)::int AS entry_count
         FROM mcp_accounts a
         LEFT JOIN mcp_ledger_entries e ON e.mcp_account_id = a.id
        WHERE a.market_id = $1
          AND (
            EXISTS (
              SELECT 1 FROM mcp_ledger_entries e2
               WHERE e2.mcp_account_id = a.id
                 AND e2.effective_at >= $2 AND e2.effective_at < $3
            )
            OR (a.created_at >= $2 AND a.created_at < $3)
          )
        GROUP BY a.id
        ORDER BY a.id`,
      [marketId, windowStart, windowEnd],
    );
    const items: DetectedItem[] = [];
    for (const row of result.rows as JsonObject[]) {
      const accountId = text(row['account_id']);
      items.push(
        comparisonItem(
          'mcp_account_total',
          accountId,
          text(row['ledger_total'], '0'),
          text(row['total_balance'], '0'),
          {
            account_id: accountId,
            balance_column: 'total_balance',
            entry_count: Number(row['entry_count'] ?? 0),
          },
        ),
      );
      items.push(
        comparisonItem(
          'mcp_account_available',
          accountId,
          text(row['ledger_available'], '0'),
          text(row['available_balance'], '0'),
          {
            account_id: accountId,
            balance_column: 'available_balance',
            entry_count: Number(row['entry_count'] ?? 0),
          },
        ),
      );
    }
    return items;
  }

  /**
   * iPoint: per-wallet-entry ledger invariant — the recorded balance delta
   * must equal the signed amount for the entry type. Debit types (REVERSED,
   * REDEMPTION_DEBIT) move down; credit types move up.
   */
  private async detectIpoint(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedItem[]> {
    const result = await this.database.pool.query(
      `SELECT w.id AS wallet_account_id,
              e.id AS entry_id, e.entry_type, e.amount,
              e.balance_before, e.balance_after, e.created_at
         FROM member_wallet_entries e
         JOIN member_wallet_accounts w ON w.id = e.wallet_account_id
        WHERE w.market_id = $1
          AND e.created_at >= $2 AND e.created_at < $3
        ORDER BY e.id`,
      [marketId, windowStart, windowEnd],
    );
    const items: DetectedItem[] = [];
    for (const row of result.rows as JsonObject[]) {
      const entryType = text(row['entry_type']);
      const amount = text(row['amount'], '0');
      const expectedDelta = signedDelta(entryType, amount);
      const before = text(row['balance_before'], '0');
      const after = text(row['balance_after'], '0');
      const actualDelta = sub(after, before);
      const status = eqScaled(expectedDelta, actualDelta)
        ? 'MATCHED'
        : 'MISMATCHED';
      items.push({
        referenceType: 'wallet_entry',
        referenceId: text(row['entry_id']),
        status,
        expectedAmount: expectedDelta,
        actualAmount: actualDelta,
        differenceAmount: sub(actualDelta, expectedDelta),
        evidence: {
          wallet_account_id: text(row['wallet_account_id']),
          entry_type: entryType,
          amount,
          balance_before: before,
          balance_after: after,
          expected_delta: expectedDelta,
          actual_delta: actualDelta,
        },
      });
    }
    return items;
  }

  /**
   * Transaction-to-ledger: every CONFIRMED transaction must have exactly one
   * MCP debit equal to its purchase amount, and a reward source whose
   * recorded transaction amount matches the purchase.
   */
  private async detectTransactionLedger(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedItem[]> {
    const result = await this.database.pool.query(
      `SELECT t.id AS transaction_id, t.purchase_amount, t.member_id,
              count(tmd.id)::int AS debit_count,
              coalesce(sum(tmd.amount), 0)::numeric(38,10) AS debit_total,
              rl.id AS reward_link_id, rs.id AS reward_source_id,
              rs.transaction_amount AS reward_source_amount,
              rs.member_id AS reward_source_member
         FROM transactions t
         LEFT JOIN transaction_mcp_debits tmd ON tmd.transaction_id = t.id
         LEFT JOIN transaction_reward_links rl ON rl.transaction_id = t.id
         LEFT JOIN reward_sources rs ON rs.id = rl.reward_source_id
        WHERE t.market_id = $1
          AND t.status = 'CONFIRMED'
          AND t.confirmed_at >= $2 AND t.confirmed_at < $3
        GROUP BY t.id, rl.id, rs.id, rs.transaction_amount, rs.member_id
        ORDER BY t.id`,
      [marketId, windowStart, windowEnd],
    );
    const items: DetectedItem[] = [];
    for (const row of result.rows as JsonObject[]) {
      const transactionId = text(row['transaction_id']);
      const purchase = text(row['purchase_amount'], '0');
      const debitCount = Number(row['debit_count'] ?? 0);
      const debitTotal = text(row['debit_total'], '0');
      items.push(
        comparisonItem(
          'transaction_mcp_debit',
          transactionId,
          purchase,
          debitTotal,
          { transaction_id: transactionId, debit_count: debitCount },
          debitCount === 0 ? 'MISSING' : undefined,
        ),
      );
      const linkId = row['reward_link_id'];
      const sourceAmount = row['reward_source_amount'];
      const sourceMember = row['reward_source_member'];
      const rewardMatched =
        linkId != null &&
        sourceAmount != null &&
        eqScaled(sourceAmount, purchase) &&
        text(sourceMember) === text(row['member_id'], '');
      items.push({
        referenceType: 'transaction_reward_source',
        referenceId: transactionId,
        status:
          linkId == null ? 'MISSING' : rewardMatched ? 'MATCHED' : 'MISMATCHED',
        expectedAmount: purchase,
        actualAmount: sourceAmount == null ? '0' : text(sourceAmount),
        differenceAmount: sub(
          sourceAmount == null ? '0' : text(sourceAmount),
          purchase,
        ),
        evidence: {
          transaction_id: transactionId,
          reward_link_id: linkId == null ? null : text(linkId),
          reward_source_id:
            row['reward_source_id'] == null
              ? null
              : text(row['reward_source_id']),
          reward_source_amount:
            sourceAmount == null ? null : text(sourceAmount),
          reward_source_member:
            sourceMember == null ? null : text(sourceMember),
        },
      });
    }
    return items;
  }

  /**
   * Commission: every COMPLETED processing with outcome CREATED must have
   * exactly one ledger posting in the run market. Processings whose postings
   * all belong to another market are out of scope for this market's run.
   */
  private async detectCommission(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedItem[]> {
    const marketRows = await this.database.pool.query(
      'SELECT code FROM markets WHERE id = $1',
      [marketId],
    );
    const marketCode = text(
      (marketRows.rows[0] as Record<string, unknown> | undefined)?.['code'],
    );
    if (!marketCode) return [];
    const result = await this.database.pool.query(
      `SELECT cp.id AS processing_id, cp.source_type, cp.source_reference,
              cp.status AS processing_status, cp.completion_outcome,
              count(cl.id)::int AS all_posting_count,
              count(cl.id) FILTER (WHERE cl.market = $1)::int AS market_posting_count,
              coalesce(sum(cl.amount) FILTER (WHERE cl.market = $1), 0)::numeric(38,10) AS market_posting_total
         FROM commission_processing cp
         LEFT JOIN commission_ledger cl ON cl.processing_id = cp.id
        WHERE cp.created_at >= $2 AND cp.created_at < $3
          AND cp.status = 'COMPLETED' AND cp.completion_outcome = 'CREATED'
        GROUP BY cp.id
        HAVING count(cl.id) FILTER (WHERE cl.market = $1) > 0
            OR count(cl.id) = 0
        ORDER BY cp.id`,
      [marketCode, windowStart, windowEnd],
    );
    const items: DetectedItem[] = [];
    for (const row of result.rows as JsonObject[]) {
      const processingId = text(row['processing_id']);
      const marketPostingCount = Number(row['market_posting_count'] ?? 0);
      const postingTotal = text(row['market_posting_total'], '0');
      const status =
        marketPostingCount === 1
          ? 'MATCHED'
          : marketPostingCount === 0
            ? 'MISSING'
            : 'MISMATCHED';
      items.push({
        referenceType: 'commission_processing',
        referenceId: processingId,
        status,
        expectedAmount: status === 'MATCHED' ? postingTotal : '0',
        actualAmount: postingTotal,
        differenceAmount: status === 'MATCHED' ? '0' : postingTotal,
        evidence: {
          processing_id: processingId,
          source_type: text(row['source_type'], ''),
          source_reference: text(row['source_reference'], ''),
          processing_status: text(row['processing_status'], ''),
          completion_outcome: text(row['completion_outcome'], ''),
          market: marketCode,
          all_posting_count: Number(row['all_posting_count'] ?? 0),
          market_posting_count: marketPostingCount,
          market_posting_total: postingTotal,
        },
      });
    }
    return items;
  }

  /** Refund: approved refunds must have their compensating ledger credit. */
  private async detectRefund(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedItem[]> {
    const items: DetectedItem[] = [];
    const mcp = await this.database.pool.query(
      `SELECT r.id AS refund_id, r.status, r.amount, r.ledger_entry_id,
              le.amount AS ledger_amount, le.entry_type AS ledger_entry_type,
              le.direction AS ledger_direction
         FROM mcp_refund_requests r
         LEFT JOIN mcp_ledger_entries le ON le.id = r.ledger_entry_id
        WHERE r.market_id = $1 AND r.status = 'APPROVED'
          AND r.updated_at >= $2 AND r.updated_at < $3
        ORDER BY r.id`,
      [marketId, windowStart, windowEnd],
    );
    for (const row of mcp.rows as JsonObject[]) {
      const refundId = text(row['refund_id']);
      const amount = text(row['amount'], '0');
      const entryId = row['ledger_entry_id'];
      const ledgerAmount = row['ledger_amount'];
      const entryType = text(row['ledger_entry_type'], '');
      const direction = text(row['ledger_direction'], '');
      const compensated =
        entryId != null &&
        ledgerAmount != null &&
        eqScaled(ledgerAmount, amount) &&
        direction === 'CREDIT' &&
        ['REFUND', 'MANUAL_CREDIT', 'REVERSAL'].includes(entryType);
      items.push({
        referenceType: 'mcp_refund',
        referenceId: refundId,
        status:
          entryId == null ? 'MISSING' : compensated ? 'MATCHED' : 'MISMATCHED',
        expectedAmount: amount,
        actualAmount: ledgerAmount == null ? '0' : text(ledgerAmount),
        differenceAmount: sub(
          ledgerAmount == null ? '0' : text(ledgerAmount),
          amount,
        ),
        evidence: {
          refund_id: refundId,
          status: text(row['status'], ''),
          ledger_entry_id: entryId == null ? null : text(entryId),
          ledger_entry_type: entryType,
          ledger_direction: direction,
        },
      });
    }
    const redemption = await this.database.pool.query(
      `SELECT r.id AS refund_id, r.status, r.refund_amount,
              r.refund_wallet_entry_id, we.amount AS wallet_amount,
              we.entry_type AS wallet_entry_type, o.market_id
         FROM redemption_refund_requests r
         JOIN redemption_orders o ON o.id = r.order_id
         LEFT JOIN member_wallet_entries we ON we.id = r.refund_wallet_entry_id
        WHERE o.market_id = $1
          AND r.updated_at >= $2 AND r.updated_at < $3
          AND r.status IN ('COMPLETED', 'REJECTED', 'FAILED')
        ORDER BY r.id`,
      [marketId, windowStart, windowEnd],
    );
    for (const row of redemption.rows as JsonObject[]) {
      const refundId = text(row['refund_id']);
      const status = text(row['status'], '');
      const amount = text(row['refund_amount'], '0');
      const entryId = row['refund_wallet_entry_id'];
      const walletAmount = row['wallet_amount'];
      if (status === 'COMPLETED') {
        const matched =
          entryId != null &&
          walletAmount != null &&
          eqScaled(walletAmount, amount);
        items.push({
          referenceType: 'redemption_refund',
          referenceId: refundId,
          status:
            entryId == null ? 'MISSING' : matched ? 'MATCHED' : 'MISMATCHED',
          expectedAmount: amount,
          actualAmount: walletAmount == null ? '0' : text(walletAmount),
          differenceAmount: sub(
            walletAmount == null ? '0' : text(walletAmount),
            amount,
          ),
          evidence: {
            refund_id: refundId,
            status,
            refund_wallet_entry_id: entryId == null ? null : text(entryId),
            wallet_entry_type: text(row['wallet_entry_type'], ''),
          },
        });
      } else if (entryId != null) {
        // A rejected/failed refund must not have a compensating credit.
        items.push({
          referenceType: 'redemption_refund',
          referenceId: refundId,
          status: 'UNEXPECTED',
          expectedAmount: '0',
          actualAmount: walletAmount == null ? '0' : text(walletAmount),
          differenceAmount: walletAmount == null ? '0' : text(walletAmount),
          evidence: {
            refund_id: refundId,
            status,
            refund_wallet_entry_id: text(entryId),
            wallet_entry_type: text(row['wallet_entry_type'], ''),
          },
        });
      }
    }
    return items;
  }

  /**
   * Redemption: non-refunded orders must have their wallet debit equal to the
   * posted point cost, and digital-voucher orders must have one voucher code
   * per unit ordered.
   */
  private async detectRedemption(
    marketId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DetectedItem[]> {
    const result = await this.database.pool.query(
      `SELECT o.id AS order_id, o.status, o.total_points, o.wallet_entry_id,
              o.quantity, c.item_type, we.amount AS wallet_amount,
              count(v.id)::int AS voucher_count
         FROM redemption_orders o
         LEFT JOIN member_wallet_entries we ON we.id = o.wallet_entry_id
         LEFT JOIN redemption_voucher_codes v ON v.order_id = o.id
         JOIN redemption_catalog_items c ON c.id = o.item_id
        WHERE o.market_id = $1
          AND o.confirmed_at >= $2 AND o.confirmed_at < $3
          AND o.status IN ('CONFIRMED','PROCESSING','READY_FOR_PICKUP',
                           'BACKORDERED','FULFILMENT_SUSPENDED',
                           'FULFILMENT_EXCEPTION','FULFILLED')
        GROUP BY o.id, c.item_type, we.amount
        ORDER BY o.id`,
      [marketId, windowStart, windowEnd],
    );
    const items: DetectedItem[] = [];
    for (const row of result.rows as JsonObject[]) {
      const orderId = text(row['order_id']);
      const points = text(row['total_points'], '0');
      const entryId = row['wallet_entry_id'];
      const walletAmount = row['wallet_amount'];
      const debitMatched =
        entryId != null &&
        walletAmount != null &&
        eqScaled(walletAmount, points);
      items.push({
        referenceType: 'redemption_order_debit',
        referenceId: orderId,
        status:
          entryId == null ? 'MISSING' : debitMatched ? 'MATCHED' : 'MISMATCHED',
        expectedAmount: points,
        actualAmount: walletAmount == null ? '0' : text(walletAmount),
        differenceAmount: sub(
          walletAmount == null ? '0' : text(walletAmount),
          points,
        ),
        evidence: {
          order_id: orderId,
          status: text(row['status'], ''),
          wallet_entry_id: entryId == null ? null : text(entryId),
        },
      });
      if (row['item_type'] === 'DIGITAL_VOUCHER') {
        const quantity = Number(row['quantity'] ?? 0);
        const voucherCount = Number(row['voucher_count'] ?? 0);
        items.push({
          referenceType: 'redemption_order_vouchers',
          referenceId: orderId,
          status:
            voucherCount === 0
              ? 'MISSING'
              : voucherCount === quantity
                ? 'MATCHED'
                : 'MISMATCHED',
          expectedAmount: text(quantity),
          actualAmount: text(voucherCount),
          differenceAmount: text(voucherCount - quantity),
          evidence: {
            order_id: orderId,
            item_type: text(row['item_type'], ''),
            quantity,
            voucher_count: voucherCount,
          },
        });
      }
    }
    return items;
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  private assertMarket(actor: ReconciliationActor, marketId: string) {
    if (!actor.currentMarketId || actor.currentMarketId !== marketId) {
      throw new ReconciliationError(
        'RECONCILIATION_MARKET_MISMATCH',
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
      sql`SELECT * FROM reconciliation_runs
           WHERE id = ${safeUuid(runId)}::uuid
             AND market_id = ${safeUuid(marketId)}::uuid
           FOR UPDATE`,
    );
    const row = result.rows[0] as unknown as JsonObject | undefined;
    if (!row) await this.runNotFound(marketId, runId);
    return camelize(row as JsonObject);
  }

  private async lockException(
    tx: DatabaseTransaction,
    marketId: string,
    exceptionId: string,
  ) {
    const result = await tx.execute(
      sql`SELECT * FROM reconciliation_exceptions
           WHERE id = ${safeUuid(exceptionId)}::uuid
             AND market_id = ${safeUuid(marketId)}::uuid
           FOR UPDATE`,
    );
    const row = result.rows[0] as unknown as JsonObject | undefined;
    if (!row) await this.exceptionNotFound(marketId, exceptionId);
    return camelize(row as JsonObject);
  }

  private async runById(marketId: string, runId: string) {
    const result = await this.database.pool.query(
      'SELECT * FROM reconciliation_runs WHERE market_id = $1 AND id::text = $2',
      [marketId, runId],
    );
    if (!result.rows[0]) await this.runNotFound(marketId, runId);
    return runDto(result.rows[0] as unknown as JsonObject);
  }

  private async exceptionById(marketId: string, exceptionId: string) {
    const result = await this.database.pool.query(
      'SELECT * FROM reconciliation_exceptions WHERE market_id = $1 AND id::text = $2',
      [marketId, exceptionId],
    );
    if (!result.rows[0]) await this.exceptionNotFound(marketId, exceptionId);
    return exceptionDto(result.rows[0] as unknown as JsonObject);
  }

  private async runNotFound(marketId: string, runId: string): Promise<never> {
    const foreign = await this.database.pool.query(
      'SELECT 1 FROM reconciliation_runs WHERE id::text = $1 LIMIT 1',
      [runId],
    );
    if (foreign.rows[0])
      throw new ReconciliationError(
        'RECONCILIATION_MARKET_MISMATCH',
        'The reconciliation run belongs to another market.',
        { market_id: marketId },
      );
    throw new ReconciliationError(
      'RECONCILIATION_NOT_FOUND',
      'The reconciliation run was not found.',
    );
  }

  private async exceptionNotFound(
    marketId: string,
    exceptionId: string,
  ): Promise<never> {
    const foreign = await this.database.pool.query(
      'SELECT 1 FROM reconciliation_exceptions WHERE id::text = $1 LIMIT 1',
      [exceptionId],
    );
    if (foreign.rows[0])
      throw new ReconciliationError(
        'RECONCILIATION_MARKET_MISMATCH',
        'The reconciliation exception belongs to another market.',
        { market_id: marketId },
      );
    throw new ReconciliationError(
      'RECONCILIATION_NOT_FOUND',
      'The reconciliation exception was not found.',
    );
  }

  private async markFailed(
    marketId: string,
    runId: string,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof Error
        ? `Reconciliation run failed: ${error.message}`.slice(0, 2000)
        : 'Reconciliation run failed for an unknown reason.';
    await this.database.pool.query(
      `UPDATE reconciliation_runs
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
    actor: ReconciliationActor,
    marketId: string,
    operation: string,
    key: string,
    payload: unknown,
    handler: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (!key || key.length > 200)
      throw new ReconciliationError(
        'RECONCILIATION_IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    const requestHash = hash(payload);
    try {
      return await this.database.db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(reconciliationIdempotencyKeys)
          .where(
            and(
              eq(reconciliationIdempotencyKeys.adminUserId, actor.adminUserId),
              eq(reconciliationIdempotencyKeys.marketId, marketId),
              eq(reconciliationIdempotencyKeys.operation, operation),
              eq(reconciliationIdempotencyKeys.key, key),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing) {
          if (existing.requestHash !== requestHash || !existing.response)
            this.idempotencyConflict();
          return existing.response as T;
        }
        await tx.insert(reconciliationIdempotencyKeys).values({
          adminUserId: actor.adminUserId,
          marketId,
          operation,
          key,
          requestHash,
        });
        const response = await handler(tx);
        await tx
          .update(reconciliationIdempotencyKeys)
          .set({ response, statusCode: 200, updatedAt: new Date() })
          .where(
            and(
              eq(reconciliationIdempotencyKeys.adminUserId, actor.adminUserId),
              eq(reconciliationIdempotencyKeys.marketId, marketId),
              eq(reconciliationIdempotencyKeys.operation, operation),
              eq(reconciliationIdempotencyKeys.key, key),
            ),
          );
        return response;
      });
    } catch (error) {
      if (error instanceof ReconciliationError) throw error;
      if (databaseCode(error) !== '23505') throw error;
      const rows = await this.database.db
        .select()
        .from(reconciliationIdempotencyKeys)
        .where(
          and(
            eq(reconciliationIdempotencyKeys.adminUserId, actor.adminUserId),
            eq(reconciliationIdempotencyKeys.marketId, marketId),
            eq(reconciliationIdempotencyKeys.operation, operation),
            eq(reconciliationIdempotencyKeys.key, key),
          ),
        )
        .limit(1);
      const existing = rows[0];
      if (existing?.requestHash === requestHash && existing.response)
        return existing.response as T;
      if (existing) this.idempotencyConflict();
      throw new ReconciliationError(
        'RECONCILIATION_DUPLICATE',
        'A reconciliation record with the same market-scoped identifier already exists.',
      );
    }
  }

  private async writeAudit(
    tx: DatabaseTransaction,
    actor: ReconciliationActor,
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
      summary: `${entityType} reconciliation operation completed.`,
    });
  }

  private invalidTransition(from: unknown, to: string): never {
    throw new ReconciliationError(
      'RECONCILIATION_INVALID_TRANSITION',
      `Transition ${text(from)} -> ${to} is not allowed.`,
      { from, to },
    );
  }

  private inProgress(): never {
    throw new ReconciliationError(
      'RECONCILIATION_RUN_IN_PROGRESS',
      'The reconciliation run is already executing.',
    );
  }

  private stale(expected: unknown, actual: unknown): never {
    throw new ReconciliationError(
      'RECONCILIATION_STALE_VERSION',
      'The record changed. Refresh and retry.',
      { expected, actual },
    );
  }

  private idempotencyConflict(): never {
    throw new ReconciliationError(
      'RECONCILIATION_IDEMPOTENCY_CONFLICT',
      'The idempotency key was reused with a different payload.',
    );
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable)
// ---------------------------------------------------------------------------

export function toScaledBigInt(
  value: string | number | null | undefined,
): bigint {
  if (value == null) return ZERO;
  const textValue = text(value).trim();
  if (!textValue) return ZERO;
  const negative = textValue.startsWith('-');
  const unsigned = negative ? textValue.slice(1) : textValue;
  const [whole = '', fraction = ''] = unsigned.split('.');
  const wholePart = whole === '' ? '0' : whole.replace(/^0+(?=\d)/u, '');
  const fractionPart = (fraction + '0'.repeat(10)).slice(0, 10);
  let scaled = BigInt(wholePart || '0') * SCALE_FACTOR + BigInt(fractionPart);
  if (negative) scaled = -scaled;
  return scaled;
}

export function formatScaledBigInt(value: bigint): string {
  const negative = value < ZERO;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE_FACTOR;
  const fraction = (absolute % SCALE_FACTOR).toString().padStart(10, '0');
  const sign = negative ? '-' : '';
  return `${sign}${whole.toString()}.${fraction}`;
}

export function sub(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): string {
  return formatScaledBigInt(toScaledBigInt(a) - toScaledBigInt(b));
}

export function eqScaled(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  return toScaledBigInt(a) === toScaledBigInt(b);
}

/** Signed balance delta for a wallet entry type: debit types move down. */
export function signedDelta(entryType: string, amount: string): string {
  if (DEBIT_ENTRY_TYPES.has(entryType)) return sub(`-${amount}`, '0');
  if (CREDIT_ENTRY_TYPES.has(entryType)) return sub(amount, '0');
  // Unknown entry types have no defined sign: report the raw amount as the
  // expected delta so an unrecognized type surfaces as a review item only if
  // the recorded delta disagrees with the recorded amount magnitude.
  return sub(amount, '0');
}

export function classificationFor(
  status: string,
): ReconciliationClassification {
  switch (status) {
    case 'MISSING':
      return 'MISSING_EXPECTED';
    case 'UNEXPECTED':
      return 'UNEXPECTED_EXTRA';
    default:
      return 'AMOUNT_MISMATCH';
  }
}

export function computeTotals(items: DetectedItem[]): RunTotals {
  let expected = ZERO;
  let actual = ZERO;
  let matched = 0;
  let mismatched = 0;
  for (const item of items) {
    expected += toScaledBigInt(item.expectedAmount);
    actual += toScaledBigInt(item.actualAmount);
    if (item.status === 'MATCHED') matched += 1;
    else mismatched += 1;
  }
  return {
    expectedTotal: formatScaledBigInt(expected),
    actualTotal: formatScaledBigInt(actual),
    differenceTotal: formatScaledBigInt(actual - expected),
    matchedCount: matched,
    mismatchedCount: mismatched,
    exceptionCount: mismatched,
  };
}

function comparisonItem(
  referenceType: string,
  referenceId: string,
  expected: string,
  actual: string,
  evidence: JsonObject,
  forcedStatus?: DetectedItem['status'],
): DetectedItem {
  const matched = eqScaled(expected, actual);
  return {
    referenceType,
    referenceId,
    status: forcedStatus ?? (matched ? 'MATCHED' : 'MISMATCHED'),
    expectedAmount: expected,
    actualAmount: actual,
    differenceAmount: sub(actual, expected),
    evidence,
  };
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
    throw new ReconciliationError(
      'RECONCILIATION_NOT_FOUND',
      'The record was not found.',
    );
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

function runDto(row: JsonObject): JsonObject {
  return {
    id: row['id'],
    public_id: row['public_id'],
    market_id: row['market_id'],
    kind: row['kind'],
    status: row['status'],
    window_start_at: iso(row['window_start_at']),
    window_end_at: iso(row['window_end_at']),
    expected_total: row['expected_total'] ?? null,
    actual_total: row['actual_total'] ?? null,
    difference_total: row['difference_total'] ?? null,
    matched_count: row['matched_count'] ?? null,
    mismatched_count: row['mismatched_count'] ?? null,
    exception_count: row['exception_count'] ?? null,
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

function runItemDto(row: JsonObject): JsonObject {
  return {
    id: row['id'],
    run_id: row['run_id'],
    market_id: row['market_id'],
    reference_type: row['reference_type'],
    reference_id: row['reference_id'],
    status: row['status'],
    expected_amount: row['expected_amount'],
    actual_amount: row['actual_amount'],
    difference_amount: row['difference_amount'],
    evidence: row['evidence'],
    created_at: iso(row['created_at']),
  };
}

function exceptionDto(row: JsonObject): JsonObject {
  return {
    id: row['id'],
    run_id: row['run_id'],
    market_id: row['market_id'],
    kind: row['kind'],
    reference_type: row['reference_type'],
    reference_id: row['reference_id'],
    expected_amount: row['expected_amount'],
    actual_amount: row['actual_amount'],
    difference_amount: row['difference_amount'],
    classification: row['classification'],
    status: row['status'],
    investigation_notes: row['investigation_notes'] ?? null,
    acknowledged_by_admin_user_id: row['acknowledged_by_admin_user_id'] ?? null,
    acknowledged_at: iso(row['acknowledged_at']),
    resolved_by_admin_user_id: row['resolved_by_admin_user_id'] ?? null,
    resolved_at: iso(row['resolved_at']),
    closed_by_admin_user_id: row['closed_by_admin_user_id'] ?? null,
    closed_at: iso(row['closed_at']),
    version: Number(row['version'] ?? 0),
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
    archived_at: iso(row['archived_at']),
  };
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return text(value, '');
}

/**
 * Type-safe stringification for raw SQL row values: only primitives and
 * Dates are stringified; anything else falls back (never "[object Object]").
 */
function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return fallback;
}
