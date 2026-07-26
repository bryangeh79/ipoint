/**
 * Member Consumption Commission Calculation Service
 *
 * Implements the Member Consumption commission logic as specified in
 * P5-S0 Sections 7, 8, 9.2, 14, and 16.
 *
 * ## Key Rules
 * - G1 = recognized service fee × 1%
 * - G2 = recognized service fee × 0.5%
 * - Fee snapshot from Phase 4 Transaction at CONFIRMED time
 * - Each generation independently evaluated for ACTIVE status
 * - No compression (G1 inactive doesn't block G2)
 * - No beneficiary substitution
 * - Decimal-only arithmetic (no float)
 * - HALF_UP rounding at posting scale (2dp)
 * - Independent line rounding per entry
 * - Zero-rounded → skip (no ledger entry)
 * - Per-market isolation
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { and, eq, lte, gt, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  agentActivations,
  referralRelationships,
  commissionProcessing,
  commissionRateVersions,
  commissionLedger,
  commissionStatusEvents,
  commissionProcessingResults,
  transactions,
  transactionServiceFees,
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

/** G1 commission rate: 1% = 0.01 */
const G1_RATE = '0.01';

/** G2 commission rate: 0.5% = 0.005 */
const G2_RATE = '0.005';

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
/*  Commission Result Type                                            */
/* ------------------------------------------------------------------ */

/**
 * Result for a single generation (G1 or G2) of member consumption.
 */
export interface MemberConsumptionGenerationResult {
  generation: number;
  beneficiaryId: string | null;
  beneficiaryActiveAtSource: boolean;
  amount: string | null;
  entryType: 'MEMBER_CONSUMPTION_G1_EARN' | 'MEMBER_CONSUMPTION_G2_EARN' | null;
  outcome:
    | 'CREATED'
    | 'SKIPPED_INELIGIBLE'
    | 'SKIPPED_NO_BENEFICIARY'
    | 'SKIPPED_ZERO_AMOUNT';
  ledgerEntryId: string | null;
  reason: string | null;
}

/**
 * Overall result of processing member consumption commission.
 */
export interface MemberConsumptionCommissionResult {
  transactionId: string;
  memberId: string;
  market: string;
  confirmedAt: string;
  recognizedServiceFee: string;
  processingId: string;
  completionOutcome: 'CREATED' | 'SKIPPED_INELIGIBLE' | 'FAILED';
  generations: MemberConsumptionGenerationResult[];
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

@Injectable()
export class MemberConsumptionCommissionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API                                                      */
  /* ================================================================ */

  /**
   * Process Member Consumption commission for a confirmed transaction.
   *
   * Called when a transaction reaches CONFIRMED status in the
   * Phase 4 Transaction Engine. Calculates and records commissions
   * for G1 and G2 referrers independently using the recognised
   * service fee snapshot at Confirm time.
   *
   * @param transactionId - The Phase 4 transaction ID
   * @returns Commission processing result
   * @throws Error on precondition failures (transaction not found, etc.)
   */
  async processMemberConsumption(
    transactionId: string,
  ): Promise<MemberConsumptionCommissionResult> {
    const db = this.database.db;

    // ---------------------------------------------------------------
    // 1. Look up transaction and its confirmed service fee
    // ---------------------------------------------------------------
    const txnRows = await db
      .select({
        id: transactions.id,
        memberId: transactions.memberId,
        marketCode: markets.code,
        currency: transactions.currency,
        status: transactions.status,
        confirmedAt: transactions.confirmedAt,
      })
      .from(transactions)
      .innerJoin(markets, eq(markets.id, transactions.marketId))
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (txnRows.length === 0) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    const txn = txnRows[0]!;

    if (txn.status !== 'CONFIRMED') {
      throw new Error(
        `Transaction ${transactionId} is not CONFIRMED (current status: ${txn.status}). Commission can only be processed for CONFIRMED transactions.`,
      );
    }

    if (!txn.confirmedAt) {
      throw new Error(
        `Transaction ${transactionId} has no confirmedAt timestamp.`,
      );
    }

    // ---------------------------------------------------------------
    // 2. Look up the recognized service fee
    // ---------------------------------------------------------------
    const feeRows = await db
      .select({
        amount: transactionServiceFees.amount,
      })
      .from(transactionServiceFees)
      .where(eq(transactionServiceFees.transactionId, transactionId))
      .limit(1);

    if (feeRows.length === 0) {
      throw new Error(
        `Service fee not found for transaction: ${transactionId}`,
      );
    }

    const recognizedServiceFee = feeRows[0]!.amount;

    const memberId = txn.memberId;
    const effectiveTime = txn.confirmedAt;
    const effectiveTimeIso = effectiveTime.toISOString();
    const marketCode = txn.marketCode;
    const currency = txn.currency;
    const sourceType = 'MEMBER_CONSUMPTION';
    const sourceReference = transactionId;

    // ---------------------------------------------------------------
    // 3. Determine G1 referrer (via referral_relationship)
    // ---------------------------------------------------------------
    const g1 = await this.findReferrer(db, memberId);
    const g1BeneficiaryId = g1?.referrerId ?? null;

    // ---------------------------------------------------------------
    // 4. Determine G2 referrer if G1 exists
    // ---------------------------------------------------------------
    let g2BeneficiaryId: string | null = null;
    if (g1BeneficiaryId) {
      const g2 = await this.findReferrer(db, g1BeneficiaryId);
      g2BeneficiaryId = g2?.referrerId ?? null;
    }

    // ---------------------------------------------------------------
    // 5. Build canonical processing key and check idempotency
    // ---------------------------------------------------------------
    const canonicalProcessingKey = `${marketCode}:${sourceType}:${sourceReference}`;

    const existingProcessing = await db
      .select({
        id: commissionProcessing.id,
        status: commissionProcessing.status,
      })
      .from(commissionProcessing)
      .where(
        eq(commissionProcessing.canonicalProcessingKey, canonicalProcessingKey),
      )
      .limit(1);

    if (existingProcessing.length > 0) {
      if (existingProcessing[0]!.status === 'COMPLETED') {
        return this.loadExistingResult(transactionId, marketCode);
      }
      if (existingProcessing[0]!.status === 'IN_FLIGHT') {
        throw new Error(
          `Member consumption commission for transaction ${transactionId} is already in progress.`,
        );
      }
    }

    // ---------------------------------------------------------------
    // 6. Look up commission rate versions
    // ---------------------------------------------------------------
    const g1RateVersion = await this.findRateVersion(
      db,
      'MEMBER_CONSUMPTION',
      1,
      marketCode,
      effectiveTime,
    );
    const g2RateVersion = await this.findRateVersion(
      db,
      'MEMBER_CONSUMPTION',
      2,
      marketCode,
      effectiveTime,
    );

    // ---------------------------------------------------------------
    // 7. Compute and record commissions (within a transaction)
    // ---------------------------------------------------------------
    const now = new Date();
    const processingId = randomUUID();
    const requestHash = sql<string>`encode(sha256(${canonicalProcessingKey}::bytea), 'hex')`;

    const generations: MemberConsumptionGenerationResult[] = [];

    await db.transaction(async (tx: Queryable) => {
      // 7a. Create commission_processing record
      await tx.insert(commissionProcessing).values({
        id: processingId,
        canonicalProcessingKey,
        sourceType: 'MEMBER_CONSUMPTION',
        sourceReference: transactionId,
        requestHash,
        status: 'IN_FLIGHT',
        completionOutcome: null,
        createdAt: now,
        completedAt: null,
      });

      // 7b. Process G1
      const g1Result = await this.processGeneration(tx, {
        generation: 1,
        beneficiaryId: g1BeneficiaryId,
        market: marketCode,
        currency,
        effectiveTime: effectiveTime,
        recognizedServiceFee,
        rateVersion: g1RateVersion,
        commissionRate: G1_RATE,
        processingId,
        sourceReference: transactionId,
        sourceType,
        memberId,
        now,
        entryType: 'MEMBER_CONSUMPTION_G1_EARN' as const,
      });
      generations.push(g1Result);

      // 7c. Process G2
      const g2Result = await this.processGeneration(tx, {
        generation: 2,
        beneficiaryId: g2BeneficiaryId,
        market: marketCode,
        currency,
        effectiveTime: effectiveTime,
        recognizedServiceFee,
        rateVersion: g2RateVersion,
        commissionRate: G2_RATE,
        processingId,
        sourceReference: transactionId,
        sourceType,
        memberId,
        now,
        entryType: 'MEMBER_CONSUMPTION_G2_EARN' as const,
      });
      generations.push(g2Result);

      // 7d. Determine overall outcome
      const hasCreated = generations.some((g) => g.outcome === 'CREATED');
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

    const hasCreated = generations.some((g) => g.outcome === 'CREATED');

    return {
      transactionId,
      memberId,
      market: marketCode,
      confirmedAt: effectiveTimeIso,
      recognizedServiceFee,
      processingId,
      completionOutcome: hasCreated ? 'CREATED' : 'SKIPPED_INELIGIBLE',
      generations,
    };
  }

  /* ================================================================ */
  /*  PRIVATE METHODS                                                  */
  /* ================================================================ */

  /**
   * Find the direct referrer for a member via referral_relationship.
   *
   * @returns The referrer's member ID, or null if no referrer exists.
   */
  private async findReferrer(
    db: Queryable,
    memberId: string,
  ): Promise<{ referrerId: string } | null> {
    const rows = await db
      .select({ referrerId: referralRelationships.referrerId })
      .from(referralRelationships)
      .where(eq(referralRelationships.refereeId, memberId))
      .limit(1);

    if (rows.length === 0) return null;
    return rows[0]!;
  }

  /**
   * Find the applicable commission rate version for a given type,
   * generation, market, and effective time.
   */
  private async findRateVersion(
    db: Queryable,
    commissionType: string,
    generation: number,
    market: string,
    effectiveTime: Date,
  ): Promise<{
    id: string;
    rateValue: string;
    rateType: string;
  } | null> {
    const rows = await db
      .select({
        id: commissionRateVersions.id,
        rateValue: commissionRateVersions.rateValue,
        rateType: commissionRateVersions.rateType,
      })
      .from(commissionRateVersions)
      .where(
        and(
          eq(commissionRateVersions.commissionType, commissionType),
          eq(commissionRateVersions.generation, generation),
          eq(commissionRateVersions.market, market),
          lte(commissionRateVersions.effectiveFrom, effectiveTime),
          sql`(${commissionRateVersions.effectiveUntil} IS NULL OR ${commissionRateVersions.effectiveUntil} > ${effectiveTime})`,
        ),
      )
      .orderBy(commissionRateVersions.effectiveFrom)
      .limit(1);

    if (rows.length === 0) return null;
    return rows[0]!;
  }

  /**
   * Process commission for a single generation.
   *
   * Handles eligibility checks, amount calculation with decimal
   * arithmetic, HALF_UP rounding at posting scale, and ledger writing.
   */
  private async processGeneration(
    tx: Queryable,
    params: ProcessGenerationParams,
  ): Promise<MemberConsumptionGenerationResult> {
    const {
      generation,
      beneficiaryId,
      market,
      currency,
      effectiveTime,
      recognizedServiceFee,
      rateVersion,
      commissionRate,
      processingId,
      sourceReference,
      now,
      entryType,
    } = params;

    // ---------------------------------------------------------------
    // Check: no beneficiary
    // ---------------------------------------------------------------
    if (!beneficiaryId) {
      return {
        generation,
        beneficiaryId: null,
        beneficiaryActiveAtSource: false,
        amount: null,
        entryType: null,
        outcome: 'SKIPPED_NO_BENEFICIARY',
        ledgerEntryId: null,
        reason: `No referrer found for generation ${generation}.`,
      };
    }

    // ---------------------------------------------------------------
    // Check: rate version must exist
    // ---------------------------------------------------------------
    if (!rateVersion) {
      return {
        generation,
        beneficiaryId,
        beneficiaryActiveAtSource: true,
        amount: null,
        entryType: null,
        outcome: 'SKIPPED_INELIGIBLE',
        ledgerEntryId: null,
        reason: `No rate version found for MEMBER_CONSUMPTION generation ${generation} in market ${market} at ${effectiveTime}.`,
      };
    }

    // ---------------------------------------------------------------
    // Check: referrer was ACTIVE at source event time
    // ---------------------------------------------------------------
    const referrerActive = await this.isReferrerActiveAtTime(
      tx,
      beneficiaryId,
      effectiveTime,
    );

    if (!referrerActive) {
      return {
        generation,
        beneficiaryId,
        beneficiaryActiveAtSource: false,
        amount: null,
        entryType: null,
        outcome: 'SKIPPED_INELIGIBLE',
        ledgerEntryId: null,
        reason: `Beneficiary was not ACTIVE at source event time (${effectiveTime}).`,
      };
    }

    // ---------------------------------------------------------------
    // Calculate commission: recognized_service_fee × rate
    //
    // Uses decimal arithmetic via PostgreSQL numeric type cast.
    // All intermediary arithmetic is carried at 10dp precision.
    // ---------------------------------------------------------------
    const unroundedAmount = sql<string>`
      CAST(${recognizedServiceFee} AS NUMERIC(38,10)) * CAST(${commissionRate} AS NUMERIC(38,10))
    `;

    // Round HALF_UP to posting scale (2dp)
    const postedAmount = sql<string>`
      ROUND(CAST(${unroundedAmount} AS NUMERIC(38,10)), ${POSTING_SCALE})
    `;

    // ---------------------------------------------------------------
    // Check idempotency: canonical entry key
    // ---------------------------------------------------------------
    const canonicalEntryKey = `${market}:${sourceReference}:${beneficiaryId}:${generation}:${entryType}`;

    const existingEntry = await tx
      .select({ id: commissionLedger.id })
      .from(commissionLedger)
      .where(eq(commissionLedger.canonicalEntryKey, canonicalEntryKey))
      .limit(1);

    if (existingEntry.length > 0) {
      return {
        generation,
        beneficiaryId,
        beneficiaryActiveAtSource: true,
        amount: existingEntry[0]!.id,
        entryType,
        outcome: 'CREATED',
        ledgerEntryId: existingEntry[0]!.id,
        reason: 'Entry already exists (idempotent replay).',
      };
    }

    // ---------------------------------------------------------------
    // Compute the exact decimal values using PostgreSQL NUMERIC
    // ---------------------------------------------------------------
    // Use a single SQL expression for unrounded + posted amounts
    // to keep calculations inside PG to preserve decimal precision.
    const calcRows = (await tx.execute(
      sql`
        SELECT
          (
            CAST(${recognizedServiceFee} AS NUMERIC(38,10))
            * CAST(${commissionRate} AS NUMERIC(38,10))
          )::TEXT AS unrounded,
          ROUND(
            CAST(${recognizedServiceFee} AS NUMERIC(38,10))
            * CAST(${commissionRate} AS NUMERIC(38,10)),
            ${POSTING_SCALE}
          )::TEXT AS posted
      `,
    )) as { unrounded: string; posted: string }[];

    const calcResult = calcRows[0];
    const unroundedVal: string = calcResult?.unrounded ?? '0';
    const postedVal: string = calcResult?.posted ?? '0';

    // Compute residual = unrounded - posted (decimal string arithmetic)
    const residualVal = this.subtractDecimalStrings(unroundedVal, postedVal);

    // ---------------------------------------------------------------
    // Zero-rounded check (D-26 frozen)
    // ---------------------------------------------------------------
    // If ABS(posted_amount) < 10^(-posting_scale), skip the entry.
    const zeroThreshold = Math.pow(10, -POSTING_SCALE);
    if (Math.abs(parseFloat(postedVal)) < zeroThreshold) {
      return {
        generation,
        beneficiaryId,
        beneficiaryActiveAtSource: true,
        amount: null,
        entryType: null,
        outcome: 'SKIPPED_ZERO_AMOUNT',
        ledgerEntryId: null,
        reason: `Commission ${postedVal} rounded to zero at posting scale (${POSTING_SCALE}dp).`,
      };
    }

    // ---------------------------------------------------------------
    // Create the ledger entry
    // ---------------------------------------------------------------
    const ledgerId = randomUUID();
    const publicReference = await this.generatePublicReference(tx, generation);

    // Snapshot: captured beneficiary ACTIVE status and revocation info
    const agentStatusSnapshot = await this.getAgentStatusSnapshot(
      tx,
      beneficiaryId,
      effectiveTime,
    );

    const rateSnapshot = {
      rateVersionId: rateVersion.id,
      rateValue: rateVersion.rateValue,
      rateType: rateVersion.rateType,
      calculationScale: CALCULATION_SCALE,
      postingScale: POSTING_SCALE,
      roundingMode: ROUNDING_MODE,
      unroundedAmount: unroundedVal,
      postedAmount: postedVal,
      residualAmount: residualVal,
      market,
      currency,
      recognizedServiceFee,
      calculationBasis: recognizedServiceFee,
      agentStatusAtSource: agentStatusSnapshot.status,
      activationId: agentStatusSnapshot.activationId,
      revokedAt: agentStatusSnapshot.revokedAt,
      reactivatedAt: agentStatusSnapshot.reactivatedAt,
      eligibilityResult: true,
      eligibilityReason: 'ACTIVE at source time, not revoked.',
    };

    await tx.insert(commissionLedger).values({
      id: ledgerId,
      publicReference,
      beneficiaryId,
      sourceType: 'MEMBER_CONSUMPTION',
      sourceReference,
      market,
      currency,
      amount: postedVal,
      rateVersionId: rateVersion.id,
      rateSnapshot,
      calculationBasis: recognizedServiceFee,
      generation,
      entryType,
      postingStatus: 'EARNED',
      canonicalEntryKey,
      processingId,
      effectiveTime: new Date(effectiveTime),
      createdAt: now,
      reversalLinkage: null,
      auditLinkage: null,
      notes: `Member consumption commission G${generation} for transaction ${sourceReference}`,
    });

    // ---------------------------------------------------------------
    // Create commission_status_event (D-01 frozen: Direct EARNED)
    // ---------------------------------------------------------------
    await tx.insert(commissionStatusEvents).values({
      eventId: randomUUID(),
      entryId: ledgerId,
      fromStatus: null,
      toStatus: 'EARNED',
      changedBy: null,
      changedByType: 'SYSTEM',
      reason:
        'Member consumption commission created (D-01 frozen: Direct EARNED).',
      changedAt: now,
      eventSequence: 1n,
    });

    // ---------------------------------------------------------------
    // Create commission_processing_result
    // ---------------------------------------------------------------
    await tx.insert(commissionProcessingResults).values({
      id: randomUUID(),
      processingId,
      beneficiaryId,
      generation,
      entryType,
      unroundedAmount: unroundedVal,
      postedAmount: postedVal,
      residualAmount: residualVal,
      roundingMode: ROUNDING_MODE,
      calculationScale: CALCULATION_SCALE,
      postingScale: POSTING_SCALE,
      outcome: 'CREATED',
      reason: null,
      createdAt: now,
    });

    return {
      generation,
      beneficiaryId,
      beneficiaryActiveAtSource: true,
      amount: postedVal,
      entryType,
      outcome: 'CREATED',
      ledgerEntryId: ledgerId,
      reason: null,
    };
  }

  /**
   * Load the existing processing result for a transaction.
   * Used for idempotent retrieval after COMPLETED status.
   */
  private async loadExistingResult(
    transactionId: string,
    marketCode: string,
  ): Promise<MemberConsumptionCommissionResult> {
    const db = this.database.db as Queryable;

    const txnRows = await db
      .select({
        id: transactions.id,
        memberId: transactions.memberId,
        confirmedAt: transactions.confirmedAt,
      })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (txnRows.length === 0) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    const txn = txnRows[0]!;
    const canonicalProcessingKey = `${marketCode}:MEMBER_CONSUMPTION:${transactionId}`;

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
        transactionId,
        memberId: txn.memberId,
        market: marketCode,
        confirmedAt: txn.confirmedAt?.toISOString() ?? '',
        recognizedServiceFee: '0',
        processingId: '',
        completionOutcome: 'SKIPPED_INELIGIBLE',
        generations: [],
      };
    }

    // Load service fee
    const feeRows = await db
      .select({ amount: transactionServiceFees.amount })
      .from(transactionServiceFees)
      .where(and(eq(transactionServiceFees.transactionId, transactionId)))
      .limit(1);

    const recognizedServiceFee = feeRows[0]?.amount ?? '0';

    // Load processing results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultRows: any[] = await db
      .select()
      .from(commissionProcessingResults)
      .where(eq(commissionProcessingResults.processingId, processing.id))
      .orderBy(commissionProcessingResults.generation);

    const generations: MemberConsumptionGenerationResult[] = resultRows.map(
      (r) => ({
        generation: r.generation,
        beneficiaryId: r.beneficiaryId,
        beneficiaryActiveAtSource: r.outcome === 'CREATED',
        amount: r.postedAmount,
        entryType:
          (r.entryType as MemberConsumptionGenerationResult['entryType']) ??
          null,
        outcome: r.outcome as MemberConsumptionGenerationResult['outcome'],
        ledgerEntryId: null,
        reason: r.reason,
      }),
    );

    return {
      transactionId,
      memberId: txn.memberId,
      market: marketCode,
      confirmedAt: txn.confirmedAt?.toISOString() ?? '',
      recognizedServiceFee,
      processingId: processing.id,
      completionOutcome: (processing.completionOutcome ??
        'SKIPPED_INELIGIBLE') as 'CREATED' | 'SKIPPED_INELIGIBLE' | 'FAILED',
      generations,
    };
  }

  /**
   * Check if a beneficiary was ACTIVE at the source event time
   * using the D-06 T1 cut-off rule.
   *
   * eligible = (agent_status_at_source = ACTIVE)
   *            AND (source_event_time < revoked_at OR revoked_at IS NULL)
   */
  private async isReferrerActiveAtTime(
    tx: Queryable,
    memberId: string,
    effectiveTime: Date,
  ): Promise<boolean> {
    // Per Section 8.5 (D-06 frozen):
    // eligible = (agent_status_at_source = ACTIVE)
    //            AND (source_event_time < revoked_at OR revoked_at IS NULL)
    const rows = await tx
      .select({ id: agentActivations.id })
      .from(agentActivations)
      .where(
        and(
          eq(agentActivations.memberId, memberId),
          eq(agentActivations.status, 'ACTIVE'),
          sql`${agentActivations.activatedAt} <= ${effectiveTime}`,
          sql`(${agentActivations.revokedAt} IS NULL
            OR ${agentActivations.revokedAt} > ${effectiveTime})`,
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Get the agent status snapshot for a beneficiary at a given time.
   * Returns the activation ID, status, and revocation/reactivation info.
   */
  private async getAgentStatusSnapshot(
    tx: Queryable,
    memberId: string,
    effectiveTime: Date,
  ): Promise<{
    activationId: string | null;
    status: string;
    revokedAt: string | null;
    reactivatedAt: string | null;
  }> {
    const rows = await tx
      .select({
        id: agentActivations.id,
        status: agentActivations.status,
        revokedAt: agentActivations.revokedAt,
      })
      .from(agentActivations)
      .where(
        and(
          eq(agentActivations.memberId, memberId),
          eq(agentActivations.status, 'ACTIVE'),
          sql`${agentActivations.activatedAt} <= ${effectiveTime}`,
          sql`(${agentActivations.revokedAt} IS NULL OR ${agentActivations.revokedAt} > ${effectiveTime})`,
        ),
      )
      .orderBy(agentActivations.activatedAt)
      .limit(1);

    if (rows.length === 0) {
      return {
        activationId: null,
        status: 'NOT_ACTIVE',
        revokedAt: null,
        reactivatedAt: null,
      };
    }

    const row = rows[0]!;
    return {
      activationId: row.id,
      status: row.status,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      reactivatedAt: null,
    };
  }

  /**
   * Generate a public reference for a ledger entry.
   *
   * Format: COM-YYMMDD-XXXXX-GN where XXXXX is a random hex suffix.
   */
  private async generatePublicReference(
    _tx: Queryable,
    generation: number,
  ): Promise<string> {
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const suffix = Math.floor(Math.random() * 0xfffff)
      .toString(16)
      .toUpperCase()
      .padStart(5, '0');
    return `COM-${datePart}-${suffix}-G${generation}`;
  }

  /**
   * Subtract two decimal strings and return the result as a string.
   * Used to compute residual = unrounded - posted at 10dp precision.
   */
  private subtractDecimalStrings(a: string, b: string): string {
    const scale = CALCULATION_SCALE;
    const aInt = BigInt(
      a.includes('.')
        ? a
            .replace('.', '')
            .padEnd(a.indexOf('.') + scale + 1, '0')
            .slice(0, a.indexOf('.') + scale + 1)
            .replace('.', '')
        : a + '0'.repeat(scale),
    );
    const bInt = BigInt(
      b.includes('.')
        ? b
            .replace('.', '')
            .padEnd(b.indexOf('.') + scale + 1, '0')
            .slice(0, b.indexOf('.') + scale + 1)
            .replace('.', '')
        : b + '0'.repeat(scale),
    );
    const resultInt = aInt - bInt;
    const sign = resultInt < 0n ? '-' : '';
    const absStr = (resultInt < 0n ? -resultInt : resultInt)
      .toString()
      .padStart(scale + 1, '0');
    const intPart = absStr.slice(0, absStr.length - scale) || '0';
    const fracPart = absStr.slice(absStr.length - scale);
    return `${sign}${intPart}.${fracPart}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Internal Types                                                    */
/* ------------------------------------------------------------------ */

interface ProcessGenerationParams {
  generation: number;
  beneficiaryId: string | null;
  market: string;
  currency: string;
  effectiveTime: Date;
  recognizedServiceFee: string;
  rateVersion: { id: string; rateValue: string; rateType: string } | null;
  commissionRate: string;
  processingId: string;
  sourceReference: string;
  sourceType: string;
  memberId: string;
  now: Date;
  entryType: 'MEMBER_CONSUMPTION_G1_EARN' | 'MEMBER_CONSUMPTION_G2_EARN';
}
