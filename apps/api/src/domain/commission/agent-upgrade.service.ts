/**
 * Agent Upgrade Commission Calculation Service
 *
 * Implements the Agent Upgrade commission logic as specified in
 * P5-S0 Sections 7, 8, 9.1, 14, and 16.
 *
 * ## Key Rules
 * - No compression (G1 inactive doesn't block G2)
 * - No beneficiary substitution
 * - Status at activated_at (not payment time)
 * - MY defaults: G1=RM88, G2=RM38 (market-configurable D-09)
 * - Rate version lookup at activated_at time
 * - One commission per activation+generation (idempotency)
 * - Decimal arithmetic only (no float)
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { and, eq, lte, sql } from 'drizzle-orm';
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
} from '@ipoint/database';
import {
  upgradeActivationNotFoundError,
  upgradeActivationNotActiveError,
  upgradeRateNotFoundError,
  upgradeProcessingConflictError,
} from './agent-upgrade.errors.js';
import type {
  AgentUpgradeCommissionResult,
  AgentUpgradeGenerationResult,
  AgentUpgradeCommissionsResponse,
  AgentUpgradeLedgerEntry,
} from './agent-upgrade.types.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** The posting scale (2dp for MYR/SGD). */
const POSTING_SCALE = 2;

/** The calculation scale (10dp). */
const CALCULATION_SCALE = 10;

/** Rounding mode per D-24 frozen. */
const ROUNDING_MODE = 'HALF_UP';

/** Default currency for MY market. */
const DEFAULT_CURRENCY: Record<string, string> = {
  MY: 'MYR',
};

/* ------------------------------------------------------------------ */
/*  Database Type                                                       */
/* ------------------------------------------------------------------ */

/**
 * Queryable database handle — works for both the non-transactional
 * NodePgDatabase and PgTransaction callback types since they share
 * the same query builder interface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = any;

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class AgentUpgradeCommissionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  /**
   * Process Agent Upgrade commission.
   *
   * Called when an agent activation reaches ACTIVE state.
   * Calculates and records commissions for G1 and G2 referrers
   * independently.
   *
   * @param activationId - The agent activation ID
   * @returns Commission processing result
   * @throws AgentUpgradeCommissionError on precondition failures
   */
  async processAgentUpgrade(
    activationId: string,
  ): Promise<AgentUpgradeCommissionResult> {
    const db = this.database.db;

    // ---------------------------------------------------------------
    // 1. Look up activation record
    // ---------------------------------------------------------------
    const activationRows = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);

    if (activationRows.length === 0) {
      throw upgradeActivationNotFoundError(activationId);
    }

    const activation = activationRows[0]!;
    const { memberId, market, activatedAt } = activation;

    if (activation.status !== 'ACTIVE') {
      throw upgradeActivationNotActiveError(activationId, activation.status);
    }

    if (!activatedAt) {
      throw upgradeActivationNotActiveError(
        activationId,
        `${activation.status} (no activatedAt timestamp)`,
      );
    }

    const effectiveTime = activatedAt.toISOString();
    const marketCode = market as string;
    const currency = DEFAULT_CURRENCY[marketCode] ?? 'MYR';
    const sourceType = 'AGENT_ACTIVATION';
    const sourceReference = activationId;

    // ---------------------------------------------------------------
    // 2. Determine G1 referrer (via referral_relationship)
    // ---------------------------------------------------------------
    const g1 = await this.findActiveReferrer(db, memberId, effectiveTime);
    const g1BeneficiaryId = g1?.referrerId ?? null;

    // ---------------------------------------------------------------
    // 3. Determine G2 referrer if G1 exists
    // ---------------------------------------------------------------
    let g2BeneficiaryId: string | null = null;
    if (g1BeneficiaryId) {
      const g2 = await this.findActiveReferrer(
        db,
        g1BeneficiaryId,
        effectiveTime,
      );
      g2BeneficiaryId = g2?.referrerId ?? null;
    }

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
        return this.loadExistingResult(activationId, marketCode);
      }
      if (existingProcessing[0]!.status === 'IN_FLIGHT') {
        throw upgradeProcessingConflictError(activationId);
      }
    }

    // ---------------------------------------------------------------
    // 5. Look up commission rate versions
    // ---------------------------------------------------------------
    const g1RateVersion = await this.findRateVersion(
      db,
      'AGENT_UPGRADE',
      1,
      marketCode,
      activatedAt,
    );
    const g2RateVersion = await this.findRateVersion(
      db,
      'AGENT_UPGRADE',
      2,
      marketCode,
      activatedAt,
    );

    if (!g1RateVersion && !g2RateVersion) {
      throw upgradeRateNotFoundError(marketCode, 1, effectiveTime);
    }

    // ---------------------------------------------------------------
    // 6. Compute and record commissions (within a transaction)
    // ---------------------------------------------------------------
    const now = new Date();
    const processingId = randomUUID();
    const requestHash = sql<string>`encode(sha256(${canonicalProcessingKey}::bytea), 'hex')`;

    const generations: AgentUpgradeGenerationResult[] = [];

    await db.transaction(async (tx: Queryable) => {
      // 6a. Create commission_processing record
      await tx.insert(commissionProcessing).values({
        id: processingId,
        canonicalProcessingKey,
        sourceType: 'AGENT_ACTIVATION',
        sourceReference: activationId,
        requestHash,
        status: 'IN_FLIGHT',
        completionOutcome: null,
        createdAt: now,
        completedAt: null,
      });

      // 6b. Process G1
      const g1Result = await this.processGeneration(tx, {
        activationId,
        generation: 1,
        beneficiaryId: g1BeneficiaryId,
        market: marketCode,
        currency,
        effectiveTime,
        rateVersion: g1RateVersion,
        processingId,
        sourceReference: activationId,
        sourceType,
        memberId,
        now,
      });
      generations.push(g1Result);

      // 6c. Process G2
      const g2Result = await this.processGeneration(tx, {
        activationId,
        generation: 2,
        beneficiaryId: g2BeneficiaryId,
        market: marketCode,
        currency,
        effectiveTime,
        rateVersion: g2RateVersion,
        processingId,
        sourceReference: activationId,
        sourceType,
        memberId,
        now,
      });
      generations.push(g2Result);

      // 6d. Determine overall outcome
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
      activationId,
      memberId,
      market: marketCode,
      activatedAt: effectiveTime,
      processingId,
      completionOutcome: hasCreated ? 'CREATED' : 'SKIPPED_INELIGIBLE',
      generations,
    };
  }

  /**
   * Get upgrade commission details for an activation.
   *
   * Queries existing ledger entries for this activation
   * and returns commission details.
   *
   * @param activationId - The agent activation ID
   * @returns Commission details
   */
  async getUpgradeCommission(
    activationId: string,
  ): Promise<AgentUpgradeCommissionsResponse | null> {
    const db = this.database.db;

    // Look up activation
    const activationRows = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);

    if (activationRows.length === 0) return null;

    const activation = activationRows[0]!;

    // Query ledger entries for this activation (source_reference)
    const ledgerRows = await db
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.sourceType, 'AGENT_ACTIVATION'),
          eq(commissionLedger.sourceReference, activationId),
        ),
      )
      .orderBy(commissionLedger.generation);

    const commissions: AgentUpgradeLedgerEntry[] = ledgerRows.map((e) => ({
      entryId: e.id,
      publicReference: e.publicReference,
      beneficiaryId: e.beneficiaryId,
      sourceType: e.sourceType,
      sourceReference: e.sourceReference,
      market: e.market,
      currency: e.currency,
      amount: e.amount,
      generation: e.generation,
      entryType: e.entryType,
      postingStatus: e.postingStatus,
      effectiveTime: e.effectiveTime.toISOString(),
      rateSnapshot: e.rateSnapshot as Record<string, unknown> | null,
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      activationId,
      memberId: activation.memberId,
      market: activation.market,
      activatedAt: activation.activatedAt?.toISOString() ?? null,
      commissions,
    };
  }

  /* ================================================================ */
  /*  PRIVATE METHODS                                                  */
  /* ================================================================ */

  /**
   * Find the active referrer for a member at a given effective time.
   *
   * Checks that the referrer is ACTIVE in the same market at the
   * activation time (eligibility check per Section 8.1).
   *
   * @returns The referrer's member ID and activation status, or null
   */
  private async findActiveReferrer(
    db: Queryable,
    memberId: string,
    _effectiveTime: string,
  ): Promise<{ referrerId: string; isActive: boolean } | null> {
    // Find the direct referrer
    const referralRows = await db
      .select({ referrerId: referralRelationships.referrerId })
      .from(referralRelationships)
      .where(eq(referralRelationships.refereeId, memberId))
      .limit(1);

    if (referralRows.length === 0) return null;

    const referrerId = referralRows[0]!.referrerId;

    // Active status check is done later in processGeneration
    return { referrerId, isActive: false };
  }

  /**
   * Find the active rate version for a commission type, generation,
   * and market at the given effective time.
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
   * Handles eligibility checks, amount calculation, and ledger writing.
   */
  private async processGeneration(
    tx: Queryable,
    params: ProcessGenerationParams,
  ): Promise<AgentUpgradeGenerationResult> {
    const {
      activationId,
      generation,
      beneficiaryId,
      market,
      currency,
      effectiveTime,
      rateVersion,
      processingId,
      sourceReference,
      now,
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
        reason: `No rate version found for AGENT_UPGRADE generation ${generation} in market ${market} at ${effectiveTime}.`,
      };
    }

    // ---------------------------------------------------------------
    // Check: referrer active at source time
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
    // Calculate fixed amount
    // ---------------------------------------------------------------
    const fixedAmount = rateVersion.rateValue;
    const entryType =
      generation === 1 ? 'AGENT_UPGRADE_G1_EARN' : 'AGENT_UPGRADE_G2_EARN';

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
    // Create the ledger entry
    // ---------------------------------------------------------------
    const ledgerId = randomUUID();
    const publicReference = await this.generatePublicReference(tx, generation);

    const rateSnapshot = {
      rateVersionId: rateVersion.id,
      rateValue: rateVersion.rateValue,
      rateType: rateVersion.rateType,
      calculationScale: CALCULATION_SCALE,
      postingScale: POSTING_SCALE,
      roundingMode: ROUNDING_MODE,
      unroundedAmount: fixedAmount,
      postedAmount: fixedAmount,
      residualAmount: '0.0000000000',
      market,
      currency,
      agentStatusAtSource: 'ACTIVE',
      activationId,
      revokedAt: null,
      reactivatedAt: null,
      eligibilityResult: true,
      eligibilityReason: 'ACTIVE at source time, not revoked.',
    };

    await tx.insert(commissionLedger).values({
      id: ledgerId,
      publicReference,
      beneficiaryId,
      sourceType: 'AGENT_ACTIVATION',
      sourceReference,
      market,
      currency,
      amount: fixedAmount,
      rateVersionId: rateVersion.id,
      rateSnapshot,
      calculationBasis: fixedAmount,
      generation,
      entryType,
      postingStatus: 'EARNED',
      canonicalEntryKey,
      processingId,
      effectiveTime: new Date(effectiveTime),
      createdAt: now,
      reversalLinkage: null,
      auditLinkage: null,
      notes: `Agent upgrade commission G${generation} for activation ${activationId}`,
    });

    // ---------------------------------------------------------------
    // Create commission_status_event
    // ---------------------------------------------------------------
    await tx.insert(commissionStatusEvents).values({
      eventId: randomUUID(),
      entryId: ledgerId,
      fromStatus: null,
      toStatus: 'EARNED',
      changedBy: null,
      changedByType: 'SYSTEM',
      reason: 'Agent upgrade commission created (D-01 frozen: Direct EARNED).',
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
      unroundedAmount: fixedAmount,
      postedAmount: fixedAmount,
      residualAmount: '0.0000000000',
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
      amount: fixedAmount,
      entryType,
      outcome: 'CREATED',
      ledgerEntryId: ledgerId,
      reason: null,
    };
  }

  /**
   * Load the existing processing result for an activation.
   * Used for idempotent retrieval after COMPLETED status.
   */
  private async loadExistingResult(
    activationId: string,
    marketCode: string,
  ): Promise<AgentUpgradeCommissionResult> {
    const db = this.database.db as Queryable;

    const activationRows = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);

    if (activationRows.length === 0) {
      throw upgradeActivationNotFoundError(activationId);
    }

    const activation = activationRows[0]!;

    const canonicalProcessingKey = `${marketCode}:AGENT_ACTIVATION:${activationId}`;

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
        activationId,
        memberId: activation.memberId,
        market: marketCode,
        activatedAt: activation.activatedAt?.toISOString() ?? '',
        processingId: '',
        completionOutcome: 'SKIPPED_INELIGIBLE',
        generations: [],
      };
    }

    // Load processing results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultRows: any[] = await db
      .select()
      .from(commissionProcessingResults)
      .where(eq(commissionProcessingResults.processingId, processing.id))
      .orderBy(commissionProcessingResults.generation);

    const generations: AgentUpgradeGenerationResult[] = resultRows.map((r) => ({
      generation: r.generation,
      beneficiaryId: r.beneficiaryId,
      beneficiaryActiveAtSource: r.outcome === 'CREATED',
      amount: r.postedAmount,
      entryType:
        (r.entryType as AgentUpgradeGenerationResult['entryType']) ?? null,
      outcome: r.outcome as AgentUpgradeGenerationResult['outcome'],
      ledgerEntryId: null,
      reason: r.reason,
    }));

    return {
      activationId,
      memberId: activation.memberId,
      market: marketCode,
      activatedAt: activation.activatedAt?.toISOString() ?? '',
      processingId: processing.id,
      completionOutcome: (processing.completionOutcome ??
        'SKIPPED_INELIGIBLE') as 'CREATED' | 'SKIPPED_INELIGIBLE' | 'FAILED',
      generations,
    };
  }

  /**
   * Check if a referrer was ACTIVE at a specific time.
   */
  private async isReferrerActiveAtTime(
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
          sql`(${agentActivations.revokedAt} IS NULL OR ${agentActivations.revokedAt} > ${effectiveTime}::timestamptz)`,
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Generate a public reference for a ledger entry.
   *
   * Format: COM-YYMMDD-XXXXX-GN where XXXXX is an incrementing hex suffix.
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
}

/* ------------------------------------------------------------------ */
/*  Internal Types                                                     */
/* ------------------------------------------------------------------ */

interface ProcessGenerationParams {
  activationId: string;
  generation: number;
  beneficiaryId: string | null;
  market: string;
  currency: string;
  effectiveTime: string;
  rateVersion: { id: string; rateValue: string; rateType: string } | null;
  processingId: string;
  sourceReference: string;
  sourceType: string;
  memberId: string;
  now: Date;
}
