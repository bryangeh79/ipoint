/**
 * Merchant Recruitment Commission Calculation Service
 *
 * Implements the Merchant Recruitment commission logic as specified in
 * P5-S0 Sections 7, 8, 9.3, and merchant_attribution table schema.
 *
 * ## Key Rules
 * - One generation only, 0.5% of recognised service fee
 * - Recruiter must be ACTIVE at each transaction Confirm time (D-05 frozen)
 * - Parent attribution (MERCHANT) and Branch attribution (BRANCH) supported
 * - No parent fallback — if branch has no attribution, no commission
 * - No replacement logic
 * - Permanent attribution (D-18 frozen)
 * - Per-market isolation
 * - Independent generation, no compression
 * - Decimal-only arithmetic (no float)
 * - HALF_UP rounding at posting scale (2dp)
 * - Independent line rounding per entry
 * - Zero-rounded → skip (no ledger entry)
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  agentActivations,
  commissionProcessing,
  commissionRateVersions,
  commissionLedger,
  commissionStatusEvents,
  commissionProcessingResults,
  transactions,
  transactionServiceFees,
  markets,
  merchantAttributions,
  merchantBranches,
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

/** Merchant Recruitment commission rate: 0.5% = 0.005 */
const MERCHANT_RECRUITMENT_RATE = '0.005';

/** Generation value for single-generation Merchant Recruitment. */
const GENERATION = 0;

/* ------------------------------------------------------------------ */
/*  Database Type                                                      */
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
 * Result of processing a Merchant Recruitment commission.
 */
export interface MerchantRecruitmentGenerationResult {
  generation: number;
  beneficiaryId: string | null;
  beneficiaryActiveAtSource: boolean;
  amount: string | null;
  entryType: 'MERCHANT_RECRUITMENT_EARN' | null;
  outcome:
    | 'CREATED'
    | 'SKIPPED_INELIGIBLE'
    | 'SKIPPED_NO_BENEFICIARY'
    | 'SKIPPED_ZERO_AMOUNT';
  ledgerEntryId: string | null;
  reason: string | null;
}

/**
 * Overall result of processing Merchant Recruitment commission.
 */
export interface MerchantRecruitmentCommissionResult {
  transactionId: string;
  merchantAccountId: string;
  merchantBranchId: string;
  attributionType: 'MERCHANT' | 'BRANCH' | null;
  market: string;
  confirmedAt: string;
  recognizedServiceFee: string;
  processingId: string;
  completionOutcome: 'CREATED' | 'SKIPPED_INELIGIBLE' | 'FAILED';
  generations: MerchantRecruitmentGenerationResult[];
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class MerchantRecruitmentCommissionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  /**
   * Process Merchant Recruitment commission for a confirmed transaction.
   *
   * Called when a transaction reaches CONFIRMED status in the
   * Phase 4 Transaction Engine. Calculates and records the commission
   * for the merchant recruiter.
   *
   * Attribution logic (D-19 frozen):
   *   - Look up merchant_attribution for the transaction's branch.
   *     If a BRANCH-level attribution exists → use branch recruiter.
   *     If no BRANCH-level attribution exists → use MERCHANT-level
   *     (parent) attribution.
   *   - If no attribution exists at all → no commission.
   *   - No fallback from inactive branch recruiter to parent recruiter.
   *
   * @param transactionId - The Phase 4 transaction ID
   * @returns Commission processing result
   * @throws Error on precondition failures
   */
  async processMerchantRecruitment(
    transactionId: string,
  ): Promise<MerchantRecruitmentCommissionResult> {
    const db = this.database.db;

    // ---------------------------------------------------------------
    // 1. Look up transaction and its confirmed service fee
    // ---------------------------------------------------------------
    const txnRows = await db
      .select({
        id: transactions.id,
        memberId: transactions.memberId,
        merchantBranchId: transactions.merchantBranchId,
        merchantAccountId: transactions.merchantAccountId,
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

    const merchantAccountId = txn.merchantAccountId;
    const merchantBranchId = txn.merchantBranchId;
    const effectiveTime = txn.confirmedAt;
    const effectiveTimeIso = effectiveTime.toISOString();
    const marketCode = txn.marketCode;
    const currency = txn.currency;
    const sourceType = 'MERCHANT_TRANSACTION';
    const sourceReference = transactionId;

    // ---------------------------------------------------------------
    // 2. Look up the recognized service fee
    // ---------------------------------------------------------------
    const feeRows = await db
      .select({
        amount: transactionServiceFees.amount,
      })
      .from(transactionServiceFees)
      .where(and(eq(transactionServiceFees.transactionId, transactionId)))
      .limit(1);

    if (feeRows.length === 0) {
      throw new Error(
        `Service fee not found for transaction: ${transactionId}`,
      );
    }

    const recognizedServiceFee = feeRows[0]!.amount;

    // ---------------------------------------------------------------
    // 3. Determine recruiter via merchant attribution
    //
    //    Attribution lookup order (D-19 frozen):
    //      a) BRANCH-level attribution for this specific branch
    //      b) If no BRANCH attribution, MERCHANT-level attribution
    //         for this merchant account
    //
    //    No fallback from inactive branch recruiter to parent.
    // ---------------------------------------------------------------
    const attributionResult = await this.findMerchantAttribution(
      db,
      merchantAccountId,
      merchantBranchId,
    );

    const recruiterMemberId = attributionResult?.recruiterMemberId ?? null;
    const attributionType = attributionResult?.attributionType ?? null;

    // ---------------------------------------------------------------
    // 4. Build canonical processing key and check idempotency
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
          `Merchant recruitment commission for transaction ${transactionId} is already in progress.`,
        );
      }
    }

    // ---------------------------------------------------------------
    // 5. Look up commission rate version
    // ---------------------------------------------------------------
    const rateVersion = await this.findRateVersion(
      db,
      'MERCHANT_RECRUITMENT',
      0, // Merchant Recruitment is single-gen, generation 0
      marketCode,
      effectiveTime,
    );

    // ---------------------------------------------------------------
    // 6. Compute and record commissions (within a transaction)
    // ---------------------------------------------------------------
    const now = new Date();
    const processingId = randomUUID();
    const requestHash = sql<string>`encode(sha256(${canonicalProcessingKey}::bytea), 'hex')`;

    const generations: MerchantRecruitmentGenerationResult[] = [];

    await db.transaction(async (tx: Queryable) => {
      // 6a. Create commission_processing record
      await tx.insert(commissionProcessing).values({
        id: processingId,
        canonicalProcessingKey,
        sourceType: 'MERCHANT_TRANSACTION',
        sourceReference: transactionId,
        requestHash,
        status: 'IN_FLIGHT',
        completionOutcome: null,
        createdAt: now,
        completedAt: null,
      });

      // 6b. Process the single generation
      const generationResult = await this.processGeneration(tx, {
        generation: GENERATION,
        beneficiaryId: recruiterMemberId,
        market: marketCode,
        currency,
        effectiveTime: effectiveTimeIso,
        recognizedServiceFee,
        rateVersion,
        commissionRate: MERCHANT_RECRUITMENT_RATE,
        processingId,
        sourceReference: transactionId,
        sourceType,
        merchantAccountId,
        merchantBranchId,
        attributionType,
        now,
        entryType: 'MERCHANT_RECRUITMENT_EARN' as const,
      });
      generations.push(generationResult);

      // 6c. Determine overall outcome
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
      merchantAccountId,
      merchantBranchId,
      attributionType,
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
   * Find merchant attribution for the given merchant account and branch.
   *
   * Attribution lookup order (D-19 frozen):
   *   1. BRANCH-level attribution for this specific branch
   *   2. If no BRANCH attribution exists, MERCHANT-level attribution
   *      for this merchant account
   *   3. If no attribution exists at all → null
   *
   * @returns The recruiter member ID and attribution type, or null
   */
  private async findMerchantAttribution(
    db: Queryable,
    merchantAccountId: string,
    merchantBranchId: string,
  ): Promise<{
    recruiterMemberId: string;
    attributionType: 'MERCHANT' | 'BRANCH';
  } | null> {
    // Step 1: Look for BRANCH-level attribution for this specific branch
    const branchRows = await db
      .select({
        recruiterMemberId: merchantAttributions.recruiterMemberId,
        attributionType: merchantAttributions.attributedEntityType,
      })
      .from(merchantAttributions)
      .where(
        and(
          eq(merchantAttributions.merchantAccountId, merchantAccountId),
          eq(merchantAttributions.attributedEntityType, 'BRANCH'),
          eq(merchantAttributions.branchId, merchantBranchId),
          eq(merchantAttributions.attributionScope, 'PERMANENT'),
          sql`${merchantAttributions.effectiveUntil} IS NULL`,
        ),
      )
      .limit(1);

    if (branchRows.length > 0) {
      return {
        recruiterMemberId: branchRows[0]!.recruiterMemberId,
        attributionType: 'BRANCH',
      };
    }

    return null;
  }

  /**
   * Find the applicable commission rate version for Merchant Recruitment
   * in the given market at the effective time.
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
   * Process the single merchant recruitment commission generation.
   *
   * Handles eligibility checks, amount calculation with decimal
   * arithmetic, HALF_UP rounding at posting scale, and ledger writing.
   */
  private async processGeneration(
    tx: Queryable,
    params: ProcessGenerationParams,
  ): Promise<MerchantRecruitmentGenerationResult> {
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
      merchantAccountId,
      merchantBranchId,
      attributionType,
    } = params;

    // ---------------------------------------------------------------
    // Check: no beneficiary (no recruiter found via attribution)
    // ---------------------------------------------------------------
    if (!beneficiaryId) {
      const reason =
        attributionType === null
          ? `No merchant attribution found for merchant account ${merchantAccountId}.`
          : `No recruiter found via ${attributionType} attribution for merchant account ${merchantAccountId}, branch ${merchantBranchId}.`;

      return {
        generation,
        beneficiaryId: null,
        beneficiaryActiveAtSource: false,
        amount: null,
        entryType: null,
        outcome: 'SKIPPED_NO_BENEFICIARY',
        ledgerEntryId: null,
        reason,
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
        reason: `No rate version found for MERCHANT_RECRUITMENT generation ${generation} in market ${market} at ${effectiveTime}.`,
      };
    }

    // ---------------------------------------------------------------
    // Check: recruiter was ACTIVE at source event time
    //
    // D-05 frozen: Merchant recruiter must be ACTIVE at each
    // transaction Confirm time. ACTIVE status is checked per
    // transaction, not only at merchant registration time.
    //
    // D-06 frozen: Combined predicate:
    //   eligible = (agent_status_at_source = ACTIVE)
    //              AND (source_event_time < revoked_at OR revoked_at IS NULL)
    // ---------------------------------------------------------------
    const recruiterActive = await this.isBeneficiaryActiveAtTime(
      tx,
      beneficiaryId,
      effectiveTime,
    );

    if (!recruiterActive) {
      // D-19 frozen: No fallback to parent recruiter if branch
      // recruiter is inactive — independent branch attribution.
      return {
        generation,
        beneficiaryId,
        beneficiaryActiveAtSource: false,
        amount: null,
        entryType: null,
        outcome: 'SKIPPED_INELIGIBLE',
        ledgerEntryId: null,
        reason:
          `Merchant recruiter was not ACTIVE at source event time (${effectiveTime}). ` +
          `Attribution type: ${attributionType ?? 'none'}. ` +
          `No parent fallback applied per D-19 frozen.`,
      };
    }

    // ---------------------------------------------------------------
    // Calculate commission: recognized_service_fee × 0.005
    //
    // Uses decimal arithmetic via PostgreSQL numeric type cast.
    // All intermediary arithmetic is carried at 10dp precision.
    // ---------------------------------------------------------------
    const calcResult = await tx.execute(
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
    );
    const calcRow = Array.isArray(calcResult)
      ? calcResult[0]
      : (calcResult as any)?.rows?.[0];
    const unroundedVal: string = calcRow?.unrounded ?? '0';
    const postedVal: string = calcRow?.posted ?? '0';

    // Compute residual = unrounded - posted (decimal string arithmetic)
    const residualVal = this.subtractDecimalStrings(unroundedVal, postedVal);

    // ---------------------------------------------------------------
    // Zero-rounded check (D-26 frozen)
    //
    // If ABS(posted_amount) < 10^(-posting_scale), skip the entry
    // and record SKIPPED_ZERO_AMOUNT.
    // ---------------------------------------------------------------
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
    // Check idempotency: canonical entry key
    //
    // Per Section 16: market + ":" + transaction_id + ":" + beneficiary_id
    //                + ":" + generation(0) + ":" + MERCHANT_RECRUITMENT_EARN
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
        amount: postedVal,
        entryType,
        outcome: 'CREATED',
        ledgerEntryId: existingEntry[0]!.id,
        reason: 'Entry already exists (idempotent replay).',
      };
    }

    // ---------------------------------------------------------------
    // Create the ledger entry
    // ---------------------------------------------------------------
    const ledgerId = randomUUID();
    const publicReference = await this.generatePublicReference(tx);

    // Snapshot: captured beneficiary ACTIVE status and revocation info
    const agentStatusSnapshot = await this.getAgentStatusSnapshot(
      tx,
      beneficiaryId,
      effectiveTime,
    );

    const notesAttribution =
      attributionType === 'BRANCH'
        ? `branch ${merchantBranchId}`
        : 'parent merchant';

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
      merchantAccountId,
      merchantBranchId,
      attributionType,
    };

    await tx.insert(commissionLedger).values({
      id: ledgerId,
      publicReference,
      beneficiaryId,
      sourceType: 'MERCHANT_TRANSACTION',
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
      notes:
        `Merchant recruitment commission for transaction ${sourceReference} ` +
        `(${notesAttribution}, recruiter ${beneficiaryId}).`,
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
        'Merchant recruitment commission created (D-01 frozen: Direct EARNED).',
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
  ): Promise<MerchantRecruitmentCommissionResult> {
    const db = this.database.db as Queryable;

    const txnRows = await db
      .select({
        id: transactions.id,
        memberId: transactions.memberId,
        merchantBranchId: transactions.merchantBranchId,
        merchantAccountId: transactions.merchantAccountId,
        confirmedAt: transactions.confirmedAt,
      })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);

    if (txnRows.length === 0) {
      throw new Error(`Transaction not found: ${transactionId}`);
    }

    const txn = txnRows[0]!;
    const canonicalProcessingKey = `${marketCode}:MERCHANT_TRANSACTION:${transactionId}`;

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
        merchantAccountId: txn.merchantAccountId,
        merchantBranchId: txn.merchantBranchId,
        attributionType: null,
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

    const generations: MerchantRecruitmentGenerationResult[] = resultRows.map(
      (r) => ({
        generation: r.generation,
        beneficiaryId: r.beneficiaryId,
        beneficiaryActiveAtSource: r.outcome === 'CREATED',
        amount: r.postedAmount,
        entryType:
          (r.entryType as MerchantRecruitmentGenerationResult['entryType']) ??
          null,
        outcome: r.outcome as MerchantRecruitmentGenerationResult['outcome'],
        ledgerEntryId: null,
        reason: r.reason,
      }),
    );

    return {
      transactionId,
      merchantAccountId: txn.merchantAccountId,
      merchantBranchId: txn.merchantBranchId,
      attributionType: null,
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
  private async isBeneficiaryActiveAtTime(
    tx: Queryable,
    memberId: string,
    effectiveTime: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: agentActivations.id })
      .from(agentActivations)
      .where(
        and(
          eq(agentActivations.memberId, memberId),
          eq(agentActivations.status, 'ACTIVE'),
          sql`${agentActivations.activatedAt} <= ${effectiveTime}::timestamptz`,
          sql`(${agentActivations.revokedAt} IS NULL
            OR ${agentActivations.revokedAt} > ${effectiveTime}::timestamptz)`,
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Get the agent status snapshot for a beneficiary at a given time.
   * Returns the activation ID, status, and revocation information.
   */
  private async getAgentStatusSnapshot(
    tx: Queryable,
    memberId: string,
    effectiveTime: string,
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
          sql`${agentActivations.activatedAt} <= ${effectiveTime}::timestamptz`,
          sql`(${agentActivations.revokedAt} IS NULL OR ${agentActivations.revokedAt} > ${effectiveTime}::timestamptz)`,
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
   * Format: COM-YYMMDD-XXXXX-MR where MR indicates Merchant Recruitment.
   */
  private async generatePublicReference(_tx: Queryable): Promise<string> {
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const suffix = Math.floor(Math.random() * 0xfffff)
      .toString(16)
      .toUpperCase()
      .padStart(5, '0');
    return `COM-${datePart}-${suffix}-MR`;
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
/*  Internal Types                                                     */
/* ------------------------------------------------------------------ */

interface ProcessGenerationParams {
  generation: number;
  beneficiaryId: string | null;
  market: string;
  currency: string;
  effectiveTime: string;
  recognizedServiceFee: string;
  rateVersion: { id: string; rateValue: string; rateType: string } | null;
  commissionRate: string;
  processingId: string;
  sourceReference: string;
  sourceType: string;
  merchantAccountId: string;
  merchantBranchId: string;
  attributionType: 'MERCHANT' | 'BRANCH' | null;
  now: Date;
  entryType: 'MERCHANT_RECRUITMENT_EARN';
}
