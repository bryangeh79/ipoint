/**
 * Correction Compensation & Idempotency Service (P5-S5)
 *
 * Implements P5-S0 Sections 16 (Idempotency) and 18 (Reversal/Refund
 * Compensation) for the Agent & Commission Engine.
 *
 * ## Key Rules (FROZEN)
 * - REVERSAL_COMPENSATION/REFUND_COMPENSATION entry types find ALL original
 *   commission entries for the source event (transaction)
 * - Original entries are NEVER modified or deleted (immutable ledger)
 * - Compensation creates exact opposite amount: amount = original.amount × -1
 * - Uses original posted amount (never recalculated at current rates)
 * - reversal_linkage = original_entry_id
 * - All compensations for one source event in single atomic transaction
 * - Over-compensation prevention: cumulative compensated amount <= original
 *   absolute amount
 * - D-06 revoked_at cut-off: source_event_time >= revoked_at → ineligible
 * - No Agent Upgrade clawback (D-06 frozen) — only member consumption
 *   entries are compensated
 * - Canonical key: correction_execution_id + ':' + original_entry_id
 *   + ':' + compensation_type
 * - commission_processing tracks each compensation run
 * - commission_processing_result per entry
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  agentActivations,
  correctionExecutions,
  commissionProcessing,
  commissionLedger,
  commissionStatusEvents,
  commissionProcessingResults,
  transactions,
  markets,
} from '@ipoint/database';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** The posting scale (2dp for MYR/SGD). */
const POSTING_SCALE = 2;

/** The calculation scale (10dp). */
const CALCULATION_SCALE = 10;

/** Rounding mode per D-24 frozen. */
const ROUNDING_MODE = 'HALF_UP';

/** The source type used in compensation processing records. */
const CORRECTION_SOURCE_TYPE = 'CORRECTION_EXECUTION';

/**
 * Compensation entry types as defined in commission_ledger entry_type CHECK
 * constraint (Section 23.6).
 */
const COMPENSATION_ENTRY_TYPES = {
  REVERSAL: 'REVERSAL_COMPENSATION',
  REFUND: 'REFUND_COMPENSATION',
} as const;

/* ------------------------------------------------------------------ */
/*  Database Type                                                     */
/* ------------------------------------------------------------------ */

/**
 * Queryable database handle — works for both the non-transactional
 * NodePgDatabase and PgTransaction callback types since they share
 * the same query builder interface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = any;

/* ------------------------------------------------------------------ */
/*  Domain Types                                                      */
/* ------------------------------------------------------------------ */

/**
 * Compensation type discriminator.
 * - REVERSAL: transaction entered REVERSED final state
 * - REFUND:   transaction entered REFUNDED final state
 */
export type CompensationType = 'REVERSAL' | 'REFUND';

/**
 * Parameters for initiating compensation processing.
 */
export interface CorrectionCompensationParams {
  /** Phase 4 Correction Execution ID that triggered this compensation. */
  correctionExecutionId: string;
  /** Original transaction ID being reversed/refunded. */
  transactionId: string;
  /** Market code (MY, SG, etc.). */
  market: string;
  /** Type of compensation: REVERSAL or REFUND. */
  compensationType: CompensationType;
  /** ISO timestamp of the correction execution event. */
  correctionEffectiveTime: string;
}

/**
 * Result for a single original entry compensation.
 */
export interface CompensationGenerationResult {
  /** The original commission entry this compensation relates to. */
  originalEntryId: string;
  /** The original entry's beneficiary member ID. */
  beneficiaryId: string | null;
  /** The original entry's generation (0, 1, 2). */
  generation: number;
  /** The original entry's type (e.g. MEMBER_CONSUMPTION_G1_EARN). */
  originalEntryType: string;
  /** Original posted amount (positive). */
  originalAmount: string;
  /** Compensation amount (original_amount × -1). */
  compensationAmount: string | null;
  /** Outcome of this compensation generation. */
  outcome:
    | 'CREATED'
    | 'SKIPPED_INELIGIBLE'
    | 'SKIPPED_ZERO_AMOUNT'
    | 'SKIPPED_OVER_COMPENSATED';
  /** The compensation ledger entry ID if CREATED. */
  compensationEntryId: string | null;
  /** Human-readable reason for the outcome. */
  reason: string | null;
}

/**
 * Overall result of processing a correction compensation run.
 */
export interface CompensationResult {
  /** The Correction Execution ID that triggered this processing. */
  correctionExecutionId: string;
  /** The original transaction ID. */
  transactionId: string;
  /** Market code. */
  market: string;
  /** Compensation type. */
  compensationType: CompensationType;
  /** The processing record ID. */
  processingId: string;
  /** Overall completion outcome. */
  completionOutcome: 'CREATED' | 'SKIPPED_INELIGIBLE' | 'FAILED';
  /** Results per original commission entry. */
  entries: CompensationGenerationResult[];
}

/* ------------------------------------------------------------------ */
/*  Error Class                                                       */
/* ------------------------------------------------------------------ */

/**
 * Domain error for compensation operations.
 */
export class CompensationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CompensationError';
  }
}

/** Factory: transaction not found. */
function compensationTransactionNotFoundError(
  transactionId: string,
): CompensationError {
  return new CompensationError(
    'COMPENSATION_TRANSACTION_NOT_FOUND',
    `Transaction not found: ${transactionId}`,
    { transactionId },
  );
}

/** Factory: transaction not in a correctable final state. */
function compensationTransactionNotCorrectableError(
  transactionId: string,
  status: string,
  expectedStatuses: string[],
): CompensationError {
  return new CompensationError(
    'COMPENSATION_TRANSACTION_NOT_CORRECTABLE',
    `Transaction ${transactionId} status ${status} is not eligible for compensation. Expected: ${expectedStatuses.join(' / ')}.`,
    { transactionId, currentStatus: status, expectedStatuses },
  );
}

/** Factory: correction execution not found. */
function compensationExecutionNotFoundError(
  correctionExecutionId: string,
): CompensationError {
  return new CompensationError(
    'COMPENSATION_EXECUTION_NOT_FOUND',
    `Correction execution record not found: ${correctionExecutionId}`,
    { correctionExecutionId },
  );
}

/** Factory: processing conflict (IN_FLIGHT). */
function compensationProcessingConflictError(
  correctionExecutionId: string,
): CompensationError {
  return new CompensationError(
    'COMPENSATION_PROCESSING_CONFLICT',
    `Compensation processing for correction execution ${correctionExecutionId} is already in progress.`,
    { correctionExecutionId },
  );
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

@Injectable()
export class CompensationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API — ENTRY POINT                                        */
  /* ================================================================ */

  /**
   * Process correction compensation for a reversed or refunded
   * Member Consumption transaction.
   *
   * Called when a Phase 4 Correction Execution completes and the
   * target transaction enters REVERSED or REFUNDED final state.
   *
   * **Agent Upgrade clawback rule (D-06 frozen):**
   *   Agent Upgrade commissions are permanently earned at activation
   *   time. NO compensation entries are generated for Agent Upgrade
   *   revocations. Only Member Consumption entries (MEMBER_CONSUMPTION
   *   source_type) are eligible for compensation.
   *
   * **D-06 revoked_at cut-off:**
   *   If the original commission entry's effective_time >= the
   *   beneficiary's revoked_at (and revoked_at IS NOT NULL), the
   *   beneficiary was NOT eligible at source time. The original entry
   *   should not have been created. Compensation is skipped for that
   *   entry and recorded as SKIPPED_INELIGIBLE.
   *
   * **Over-compensation prevention:**
   *   The cumulative absolute compensation amount for any single
   *   original entry MUST NOT exceed the original posted amount.
   *   If a previous compensation already covers the full amount,
   *   subsequent processing returns SKIPPED_OVER_COMPENSATED.
   *
   * @param params - Compensation parameters
   * @returns Compensation processing result
   * @throws CompensationError on precondition failures
   */
  async processCorrectionCompensation(
    params: CorrectionCompensationParams,
  ): Promise<CompensationResult> {
    const { correctionExecutionId, transactionId, market, compensationType } =
      params;

    const entryType =
      compensationType === 'REVERSAL'
        ? COMPENSATION_ENTRY_TYPES.REVERSAL
        : COMPENSATION_ENTRY_TYPES.REFUND;

    const db = this.database.db;

    // ---------------------------------------------------------------
    // 1. Validate correction execution exists (Phase 4 link)
    // ---------------------------------------------------------------
    const executionRows = await db
      .select({ id: correctionExecutions.id })
      .from(correctionExecutions)
      .where(eq(correctionExecutions.id, correctionExecutionId))
      .limit(1);

    if (executionRows.length === 0) {
      throw compensationExecutionNotFoundError(correctionExecutionId);
    }

    // ---------------------------------------------------------------
    // 2. Look up the transaction and validate status
    // ---------------------------------------------------------------
    const txnRows = await db
      .select({
        id: transactions.id,
        memberId: transactions.memberId,
        status: transactions.status,
        confirmedAt: transactions.confirmedAt,
      })
      .from(transactions)
      .innerJoin(markets, eq(markets.id, transactions.marketId))
      .where(and(eq(transactions.id, transactionId), eq(markets.code, market)))
      .limit(1);

    if (txnRows.length === 0) {
      throw compensationTransactionNotFoundError(transactionId);
    }

    const txn = txnRows[0]!;

    // Expected final states from Phase 4
    const expectedStatuses =
      compensationType === 'REVERSAL' ? ['REVERSED'] : ['REFUNDED'];

    if (!expectedStatuses.includes(txn.status)) {
      throw compensationTransactionNotCorrectableError(
        transactionId,
        txn.status,
        expectedStatuses,
      );
    }

    // ---------------------------------------------------------------
    // 3. Build canonical processing key and check idempotency
    //
    //    Canonical Processing Key for compensation runs:
    //    market + ":" + CORRECTION_EXECUTION + ":" + correction_execution_id
    //
    //    This ensures each correction execution is processed at most
    //    once, even if the trigger event is replayed.
    // ---------------------------------------------------------------
    const canonicalProcessingKey = `${market}:${CORRECTION_SOURCE_TYPE}:${correctionExecutionId}`;

    const existingProcessing = await db
      .select({
        id: commissionProcessing.id,
        status: commissionProcessing.status,
        completionOutcome: commissionProcessing.completionOutcome,
      })
      .from(commissionProcessing)
      .where(
        eq(commissionProcessing.canonicalProcessingKey, canonicalProcessingKey),
      )
      .limit(1);

    if (existingProcessing.length > 0) {
      if (existingProcessing[0]!.status === 'COMPLETED') {
        return this.loadExistingCompensationResult(
          correctionExecutionId,
          transactionId,
          market,
          compensationType,
        );
      }
      if (existingProcessing[0]!.status === 'IN_FLIGHT') {
        throw compensationProcessingConflictError(correctionExecutionId);
      }
    }

    // ---------------------------------------------------------------
    // 4. Find ALL original commission entries for this transaction
    //
    //    Per Section 18.2 Rule 1: find all original commission entries
    //    linked to the source event.
    //
    //    ONLY Member Consumption entries are eligible for compensation.
    //    Agent Upgrade entries are excluded per D-06 frozen (no clawback).
    // ---------------------------------------------------------------
    const originalEntries = await this.findOriginalCommissionEntries(
      db,
      transactionId,
      market,
    );

    if (originalEntries.length === 0) {
      // No original entries to compensate — this is a normal outcome
      // (e.g. the transaction generated no commissions due to eligibility
      //  failures, or it is an Agent Upgrade which is excluded).
      const now = new Date();
      const processingId = randomUUID();
      const requestHash = sql<string>`encode(sha256(${canonicalProcessingKey}::bytea), 'hex')`;

      await db.insert(commissionProcessing).values({
        id: processingId,
        canonicalProcessingKey,
        sourceType: CORRECTION_SOURCE_TYPE,
        sourceReference: correctionExecutionId,
        requestHash,
        status: 'COMPLETED',
        completionOutcome: 'SKIPPED_INELIGIBLE',
        createdAt: now,
        completedAt: now,
      });

      return {
        correctionExecutionId,
        transactionId,
        market,
        compensationType,
        processingId,
        completionOutcome: 'SKIPPED_INELIGIBLE',
        entries: [],
      };
    }

    // ---------------------------------------------------------------
    // 5. Process compensations within a single atomic transaction
    // ---------------------------------------------------------------
    const now = new Date();
    const processingId = randomUUID();
    const requestHash = sql<string>`encode(sha256(${canonicalProcessingKey}::bytea), 'hex')`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries: CompensationGenerationResult[] = [];

    await db.transaction(async (tx: Queryable) => {
      // 5a. Create commission_processing record (IN_FLIGHT)
      await tx.insert(commissionProcessing).values({
        id: processingId,
        canonicalProcessingKey,
        sourceType: CORRECTION_SOURCE_TYPE,
        sourceReference: correctionExecutionId,
        requestHash,
        status: 'IN_FLIGHT',
        completionOutcome: null,
        createdAt: now,
        completedAt: null,
      });

      // 5b. Process each original entry
      for (const original of originalEntries) {
        const result = await this.processCompensationEntry(tx, {
          original,
          correctionExecutionId,
          transactionId,
          market,
          entryType,
          compensationType,
          processingId,
          correctionEffectiveTime: params.correctionEffectiveTime,
          now,
        });
        entries.push(result);
      }

      // 5c. Determine overall outcome
      const hasCreated = entries.some((e) => e.outcome === 'CREATED');
      const completionOutcome = hasCreated ? 'CREATED' : 'SKIPPED_INELIGIBLE';

      await tx
        .update(commissionProcessing)
        .set({
          status: 'COMPLETED',
          completionOutcome,
          completedAt: now,
        })
        .where(eq(commissionProcessing.id, processingId));
    });

    const hasCreated = entries.some((e) => e.outcome === 'CREATED');

    return {
      correctionExecutionId,
      transactionId,
      market,
      compensationType,
      processingId,
      completionOutcome: hasCreated ? 'CREATED' : 'SKIPPED_INELIGIBLE',
      entries,
    };
  }

  /* ================================================================ */
  /*  PRIVATE METHODS                                                  */
  /* ================================================================ */

  /**
   * Find ALL original commission entries linked to the given transaction.
   *
   * Per Section 18.2 Rule 1:
   *   "Find all original commission entries linked to the source event."
   *
   * All entry types that match the transaction's source_reference are
   * returned. The caller filters by eligibility rules (D-06 no clawback
   * for Agent Upgrade, etc.).
   *
   * Excludes:
   *   - ADMIN_ADJUSTMENT entries (admin corrections are separate)
   *   - REVERSAL_COMPENSATION / REFUND_COMPENSATION entries (these
   *     are compensation entries themselves, never compensated again)
   *   - AGENT_UPGRADE_G1_EARN / AGENT_UPGRADE_G2_EARN (D-06 frozen:
   *     no Agent Upgrade clawback)
   *
   * @returns Array of original ledger entry rows
   */
  private async findOriginalCommissionEntries(
    db: Queryable,
    transactionId: string,
    _market: string,
  ): Promise<OriginalEntryRow[]> {
    // Per D-06 frozen: Agent Upgrade commissions are permanently earned
    // and are NOT clawed back. Only Member Consumption entries are
    // eligible for compensation.
    const compensatingEntryTypes = [
      'MEMBER_CONSUMPTION_G1_EARN',
      'MEMBER_CONSUMPTION_G2_EARN',
    ];

    const rows = await db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceType, 'MEMBER_CONSUMPTION'),
          eq(commissionLedger.sourceReference, transactionId),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sql`${commissionLedger.entryType} = ANY(${compensatingEntryTypes}::VARCHAR(40)[])`,
        ),
      )
      .orderBy(commissionLedger.generation);

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      beneficiaryId: r.beneficiaryId as string,
      sourceType: r.sourceType as string,
      sourceReference: r.sourceReference as string,
      market: r.market as string,
      currency: r.currency as string,
      amount: r.amount as string,
      rateVersionId: r.rateVersionId as string | null,
      rateSnapshot: r.rateSnapshot as Record<string, unknown> | null,
      calculationBasis: r.calculationBasis as string | null,
      generation: r.generation as number,
      entryType: r.entryType as string,
      canonicalEntryKey: r.canonicalEntryKey as string,
      processingId: r.processingId as string | null,
      effectiveTime: r.effectiveTime as Date,
      reversalLinkage: r.reversalLinkage as string | null,
      notes: r.notes as string | null,
    }));
  }

  /**
   * Process compensation for a single original commission entry.
   *
   * Implements the following checks (in order):
   * 1. D-06 revoked_at cut-off: skip if beneficiary was revoked at
   *    source event time
   * 2. Over-compensation prevention: skip if cumulative compensated
   *    amount already covers the original posted amount
   * 3. Zero-amount check: skip if the negated amount rounds to zero
   * 4. Idempotency: skip if canonical entry key already exists
   *
   * If all checks pass, creates:
   * - One commission_ledger entry (REVERSAL_COMPENSATION or
   *   REFUND_COMPENSATION) with amount = original.amount × -1
   * - One commission_status_event (to_status = EARNED)
   * - One commission_processing_result (outcome = CREATED)
   */
  private async processCompensationEntry(
    tx: Queryable,
    params: ProcessCompensationParams,
  ): Promise<CompensationGenerationResult> {
    const {
      original,
      correctionExecutionId,
      transactionId,
      market,
      entryType,
      compensationType,
      processingId,
      correctionEffectiveTime,
      now,
    } = params;

    const originalAmount = original.amount;
    const originalAbsAmount = originalAmount.startsWith('-')
      ? originalAmount.slice(1)
      : originalAmount;

    // ---------------------------------------------------------------
    // Check 1: D-06 revoked_at cut-off
    //
    //    If the beneficiary's activation was revoked at a timestamp
    //    <= the source event effective_time, the beneficiary was NOT
    //    eligible at source time. The original entry should not have
    //    been created. Skip compensation for this entry.
    //
    //    Agent Upgrade entries are already filtered out in
    //    findOriginalCommissionEntries, so this check only applies
    //    to Member Consumption entries.
    // ---------------------------------------------------------------
    const beneficiaryRevokedAt = await this.getBeneficiaryRevokedAt(
      tx,
      original.beneficiaryId,
    );

    if (beneficiaryRevokedAt !== null) {
      const effectiveTimeIso = original.effectiveTime.toISOString();
      if (effectiveTimeIso >= beneficiaryRevokedAt) {
        return {
          originalEntryId: original.id,
          beneficiaryId: original.beneficiaryId,
          generation: original.generation,
          originalEntryType: original.entryType,
          originalAmount,
          compensationAmount: null,
          outcome: 'SKIPPED_INELIGIBLE',
          compensationEntryId: null,
          reason:
            `D-06 revoked_at cut-off: beneficiary was revoked at ` +
            `${beneficiaryRevokedAt}, source event time ${effectiveTimeIso}. ` +
            `Original entry should not have been created. Compensation skipped.`,
        };
      }
    }

    // ---------------------------------------------------------------
    // Check 2: Over-compensation prevention
    //
    //    The cumulative absolute compensation amount for a single
    //    original entry MUST NOT exceed the original posted amount.
    //
    //    Query all existing compensation entries that reference this
    //    original entry via reversal_linkage. Sum their absolute
    //    amounts. If sum >= |original.amount|, skip.
    // ---------------------------------------------------------------
    const existingCompensationSum = await this.getExistingCompensationSum(
      tx,
      original.id,
    );

    if (existingCompensationSum !== null) {
      if (
        this.compareDecimal(existingCompensationSum, originalAbsAmount) >= 0
      ) {
        return {
          originalEntryId: original.id,
          beneficiaryId: original.beneficiaryId,
          generation: original.generation,
          originalEntryType: original.entryType,
          originalAmount,
          compensationAmount: null,
          outcome: 'SKIPPED_OVER_COMPENSATED',
          compensationEntryId: null,
          reason:
            `Over-compensation prevented: cumulative compensation ` +
            `${existingCompensationSum} >= original amount ${originalAbsAmount}.`,
        };
      }
    }

    // ---------------------------------------------------------------
    // Check 3: Zero-amount check (D-26 frozen pattern)
    //
    //    Compute compensation amount = original_amount × -1.
    //    If |compensation_amount| < 10^(-posting_scale), skip.
    // ---------------------------------------------------------------
    const compensationAmount = this.negateDecimalString(originalAmount);
    const zeroThreshold = Math.pow(10, -POSTING_SCALE);

    if (Math.abs(parseFloat(compensationAmount)) < zeroThreshold) {
      return {
        originalEntryId: original.id,
        beneficiaryId: original.beneficiaryId,
        generation: original.generation,
        originalEntryType: original.entryType,
        originalAmount,
        compensationAmount: null,
        outcome: 'SKIPPED_ZERO_AMOUNT',
        compensationEntryId: null,
        reason:
          `Compensation amount ${compensationAmount} rounds to zero ` +
          `at posting scale (${POSTING_SCALE}dp).`,
      };
    }

    // ---------------------------------------------------------------
    // Check 4: Idempotency — canonical entry key
    //
    //    Canonical Entry Key for compensation entries (Section 16.1):
    //      market + ":" + correction_execution_id + ":"
    //      + original_entry_id + ":" + compensation_type
    //
    //    Examples:
    //      MY:<uuid>:<uuid>:REVERSAL_COMPENSATION
    //      MY:<uuid>:<uuid>:REFUND_COMPENSATION
    // ---------------------------------------------------------------
    const canonicalEntryKey = `${market}:${correctionExecutionId}:${original.id}:${entryType}`;

    const existingEntry = await tx
      .select({ id: commissionLedger.id })
      .from(commissionLedger)
      .where(eq(commissionLedger.canonicalEntryKey, canonicalEntryKey))
      .limit(1);

    if (existingEntry.length > 0) {
      return {
        originalEntryId: original.id,
        beneficiaryId: original.beneficiaryId,
        generation: original.generation,
        originalEntryType: original.entryType,
        originalAmount,
        compensationAmount,
        outcome: 'CREATED',
        compensationEntryId: existingEntry[0]!.id,
        reason: 'Entry already exists (idempotent replay).',
      };
    }

    // ---------------------------------------------------------------
    // All checks passed — create compensation ledger entry
    //
    //    Per Section 18.2 Rule 2-4:
    //    - Do NOT modify or delete the original entry
    //    - Create exact opposite: amount = original.amount × (-1)
    //    - Copy all snapshot fields from the original entry
    //    - reversal_linkage = original_entry_id
    // ---------------------------------------------------------------
    const ledgerId = randomUUID();
    const publicReference = await this.generateCompensationPublicReference(
      tx,
      entryType,
    );

    // Copy the rate_snapshot from the original entry, add compensation
    // metadata for audit trail reference.
    const compensationRateSnapshot = {
      ...(original.rateSnapshot ?? {}),
      compensationType: entryType,
      correctionExecutionId,
      originalEntryId: original.id,
      originalAmount,
      compensationAmount,
      compensationEffectiveTime: correctionEffectiveTime,
    };

    const notesContext =
      compensationType === 'REVERSAL'
        ? `Reversal compensation for ${original.entryType} entry ${original.id}`
        : `Refund compensation for ${original.entryType} entry ${original.id}`;

    // 4a. Insert commission_ledger entry
    await tx.insert(commissionLedger).values({
      id: ledgerId,
      publicReference,
      beneficiaryId: original.beneficiaryId,
      sourceType: 'MEMBER_CONSUMPTION',
      sourceReference: transactionId,
      market: original.market,
      currency: original.currency,
      amount: compensationAmount,
      rateVersionId: original.rateVersionId,
      rateSnapshot: compensationRateSnapshot,
      calculationBasis: original.calculationBasis,
      generation: original.generation,
      entryType,
      postingStatus: 'EARNED',
      canonicalEntryKey,
      processingId,
      effectiveTime: original.effectiveTime,
      createdAt: now,
      reversalLinkage: original.id,
      auditLinkage: correctionExecutionId,
      notes: `${notesContext}. Correction execution: ${correctionExecutionId}.`,
    });

    // 4b. Create commission_status_event (D-01 frozen: Direct EARNED)
    await tx.insert(commissionStatusEvents).values({
      eventId: randomUUID(),
      entryId: ledgerId,
      fromStatus: null,
      toStatus: 'EARNED',
      changedBy: null,
      changedByType: 'SYSTEM',
      reason:
        `${compensationType} compensation created for entry ${original.id} ` +
        `(Correction Execution ${correctionExecutionId}). D-01 frozen: Direct EARNED.`,
      changedAt: now,
      eventSequence: 1n,
    });

    // 4c. Create commission_processing_result
    await tx.insert(commissionProcessingResults).values({
      id: randomUUID(),
      processingId,
      beneficiaryId: original.beneficiaryId,
      generation: original.generation,
      entryType,
      unroundedAmount: compensationAmount,
      postedAmount: compensationAmount,
      residualAmount: '0.0000000000',
      roundingMode: ROUNDING_MODE,
      calculationScale: CALCULATION_SCALE,
      postingScale: POSTING_SCALE,
      outcome: 'CREATED',
      reason: null,
      createdAt: now,
    });

    return {
      originalEntryId: original.id,
      beneficiaryId: original.beneficiaryId,
      generation: original.generation,
      originalEntryType: original.entryType,
      originalAmount,
      compensationAmount,
      outcome: 'CREATED',
      compensationEntryId: ledgerId,
      reason: null,
    };
  }

  /**
   * Check whether the beneficiary's agent activation had a revoked_at
   * timestamp. Returns the ISO string of revoked_at, or null if never
   * revoked.
   */
  private async getBeneficiaryRevokedAt(
    tx: Queryable,
    beneficiaryId: string,
  ): Promise<string | null> {
    const rows = await tx
      .select({ revokedAt: agentActivations.revokedAt })
      .from(agentActivations)
      .where(eq(agentActivations.memberId, beneficiaryId))
      .orderBy(agentActivations.activatedAt)
      .limit(1);

    if (rows.length === 0) return null;

    const revokedAt = rows[0]!.revokedAt as Date | null;
    return revokedAt ? revokedAt.toISOString() : null;
  }

  /**
   * Query the sum of existing compensation amounts linked to an
   * original entry via reversal_linkage.
   *
   * Returns the cumulative absolute amount as a decimal string, or
   * null if no compensation entries exist.
   */
  private async getExistingCompensationSum(
    tx: Queryable,
    originalEntryId: string,
  ): Promise<string | null> {
    // Per Section 23.6: compensation entries reference the original
    // entry via reversal_linkage.
    const rows = await tx.execute<{ total: string | null }>(
      sql`
        SELECT SUM(ABS(CAST(${commissionLedger.amount} AS NUMERIC(38,10))))::TEXT AS total
        FROM ${commissionLedger}
        WHERE ${commissionLedger.reversalLinkage} = ${originalEntryId}
      `,
    );

    const total = rows[0]?.total;
    return total ?? null;
  }

  /**
   * Negate a decimal string (multiply by -1).
   *
   * Examples:
   *   "88.00"  → "-88.00"
   *   "-38.50" → "38.50"
   *   "0.00"   → "0.00"
   */
  private negateDecimalString(value: string): string {
    if (value === '0' || value === '0.00' || value === '0.0000000000') {
      return value;
    }
    if (value.startsWith('-')) {
      return value.slice(1);
    }
    return `-${value}`;
  }

  /**
   * Compare two decimal strings using numeric comparison.
   *
   * Returns:
   *   -1 if a < b
   *    0 if a === b
   *    1 if a > b
   */
  private compareDecimal(a: string, b: string): number {
    // Use PostgreSQL-level comparison if running inside a query,
    // otherwise fall back to BigInt-based comparison.
    const scale = 10;
    const aInt = this.decimalToBigInt(a, scale);
    const bInt = this.decimalToBigInt(b, scale);
    if (aInt < bInt) return -1;
    if (aInt > bInt) return 1;
    return 0;
  }

  /**
   * Convert a decimal string to a BigInt at the given scale.
   * Used for precise decimal comparisons without floating point.
   */
  private decimalToBigInt(value: string, scale: number): bigint {
    const parts = value.split('.');
    const intPart = parts[0] ?? '0';
    const fracPart = (parts[1] ?? '').padEnd(scale, '0').slice(0, scale);
    return BigInt(`${intPart}${fracPart}`);
  }

  /**
   * Load the existing compensation result for idempotent retrieval.
   *
   * Called when the processing record already has COMPLETED status.
   * Reconstructs the CompensationResult from the stored processing
   * and processing_result records.
   */
  private async loadExistingCompensationResult(
    correctionExecutionId: string,
    transactionId: string,
    market: string,
    compensationType: CompensationType,
  ): Promise<CompensationResult> {
    const db = this.database.db as Queryable;

    const canonicalProcessingKey = `${market}:${CORRECTION_SOURCE_TYPE}:${correctionExecutionId}`;

    const processingRows = await db
      .select({
        id: commissionProcessing.id,
        completionOutcome: commissionProcessing.completionOutcome,
      })
      .from(commissionProcessing)
      .where(
        eq(commissionProcessing.canonicalProcessingKey, canonicalProcessingKey),
      )
      .limit(1);

    const processing = processingRows[0];

    if (!processing) {
      return {
        correctionExecutionId,
        transactionId,
        market,
        compensationType,
        processingId: '',
        completionOutcome: 'SKIPPED_INELIGIBLE',
        entries: [],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultRows: any[] = await db
      .select()
      .from(commissionProcessingResults)
      .where(eq(commissionProcessingResults.processingId, processing.id))
      .orderBy(commissionProcessingResults.generation);

    // Map processing results back to CompensationGenerationResult.
    // Since processing_result stores per-entry info but does not
    // store which original entry was compensated, we reconstruct
    // from the compensation ledger entries that were created.
    const compensationEntries = await db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.processingId, processing.id),
          sql`${commissionLedger.entryType} IN ('REVERSAL_COMPENSATION', 'REFUND_COMPENSATION')`,
        ),
      );

    const entryMap = new Map<string, Record<string, unknown>>();
    for (const ce of compensationEntries) {
      const reversalLinkage = ce.reversalLinkage as string;
      if (reversalLinkage) {
        entryMap.set(ce.id as string, ce);
      }
    }

    // Build entries from processing results
    const entries: CompensationGenerationResult[] = resultRows.map((r) => {
      const ce = entryMap.get(r.entryId as string) ?? null;
      return {
        originalEntryId:
          ce?.reversalLinkage ?? (r.originalEntryId as string) ?? '',
        beneficiaryId: r.beneficiaryId as string | null,
        generation: r.generation as number,
        originalEntryType: (r.entryType as string) ?? '',
        originalAmount: '0',
        compensationAmount: r.postedAmount as string | null,
        outcome: r.outcome as CompensationGenerationResult['outcome'],
        compensationEntryId: (r.entryId as string) ?? null,
        reason: r.reason as string | null,
      };
    });

    return {
      correctionExecutionId,
      transactionId,
      market,
      compensationType,
      processingId: processing.id,
      completionOutcome: (processing.completionOutcome ??
        'SKIPPED_INELIGIBLE') as 'CREATED' | 'SKIPPED_INELIGIBLE' | 'FAILED',
      entries,
    };
  }

  /**
   * Generate a public reference for a compensation ledger entry.
   *
   * Format: COM-YYMMDD-XXXXX-RC for Reversal Compensation,
   *         COM-YYMMDD-XXXXX-FC for Refund Compensation.
   *
   * RC = Reversal Compensation, FC = Refund Compensation.
   */
  private async generateCompensationPublicReference(
    _tx: Queryable,
    entryType: string,
  ): Promise<string> {
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const suffix = Math.floor(Math.random() * 0xfffff)
      .toString(16)
      .toUpperCase()
      .padStart(5, '0');
    const typeSuffix = entryType === 'REVERSAL_COMPENSATION' ? 'RC' : 'FC';
    return `COM-${datePart}-${suffix}-${typeSuffix}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Internal Types                                                     */
/* ------------------------------------------------------------------ */

/**
 * Shape of an original commission ledger entry row returned from
 * findOriginalCommissionEntries.
 */
interface OriginalEntryRow {
  id: string;
  beneficiaryId: string;
  sourceType: string;
  sourceReference: string;
  market: string;
  currency: string;
  amount: string;
  rateVersionId: string | null;
  rateSnapshot: Record<string, unknown> | null;
  calculationBasis: string | null;
  generation: number;
  entryType: string;
  canonicalEntryKey: string;
  processingId: string | null;
  effectiveTime: Date;
  reversalLinkage: string | null;
  notes: string | null;
}

/**
 * Internal parameters for processing a single compensation entry.
 */
interface ProcessCompensationParams {
  original: OriginalEntryRow;
  correctionExecutionId: string;
  transactionId: string;
  market: string;
  entryType: string;
  compensationType: 'REVERSAL' | 'REFUND';
  processingId: string;
  correctionEffectiveTime: string;
  now: Date;
}
