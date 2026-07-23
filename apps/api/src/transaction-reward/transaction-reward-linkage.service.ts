import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  memberWalletAccounts,
  memberWalletEntries,
  rewardPlans,
  rewardRuleVersions,
  rewardSources,
  type Database,
} from '@ipoint/database';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';

type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/**
 * Transaction data required to create a reward entitlement snapshot.
 * This is captured at transaction-creation time and must not be altered
 * by future merchant package or rule version changes.
 */
export interface TransactionSnapshotInput {
  /** Unique transaction identifier */
  transactionId: string;
  /** Member who performed the transaction */
  memberId: string;
  /** Consumption market (where the transaction occurred) */
  consumptionMarketId: string;
  /** Merchant branch where the transaction was performed */
  merchantBranchId: string;
  /** Transaction amount as a numeric string (e.g. "100.00") */
  amount: string;
  /** ISO-4217 currency code (e.g. "VND", "MYR") */
  currency: string;
  /** The time the transaction was created */
  transactionTime: Date;
}

/**
 * Result returned after creating a reward entitlement.
 */
export interface RewardEntitlementResult {
  sourceId: string;
  planId: string;
  rewardRuleVersionId: string | null;
  rewardAmount: string | null;
  merchantPackageId: string | null;
  merchantPackageName: string | null;
  merchantPackageRate: string | null;
  serviceFeeRate: string | null;
  isNew: boolean;
}

/**
 * Transaction → Reward linkage service.
 *
 * Captures a point-in-time snapshot of merchant package and reward rule
 * configuration at transaction creation, then creates an idempotent
 * reward entitlement against the member's wallet in the consumption market.
 *
 * Idempotency guarantee: a second call with the same transactionId
 * returns the existing entitlement without creating duplicates.
 *
 * Historical integrity: future merchant package changes or reward rule
 * version updates do NOT alter previously created snapshots.
 */
@Injectable()
export class TransactionRewardLinkageService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Create a reward entitlement from a completed transaction.
   *
   * Steps:
   * 1. Check for existing reward source (idempotency).
   * 2. Lock the merchant branch and resolve its active package at transaction time.
   * 3. Look up the effective reward rule version at transaction time.
   * 4. Insert reward_sources snapshot.
   * 5. Insert reward_plans entitlement.
   * 6. Optionally create a pending wallet entry.
   *
   * Returns the existing result if the transaction has already been processed.
   */
  async createRewardEntitlement(
    input: TransactionSnapshotInput,
  ): Promise<RewardEntitlementResult> {
    return this.database.db.transaction(async (tx) => {
      // ── 1. Idempotency check via unique constraint ──────────────
      const existing = await tx
        .select({
          id: rewardSources.id,
          sourceId: rewardSources.sourceId,
          memberId: rewardSources.memberId,
          marketId: rewardSources.marketId,
          transactionAmount: rewardSources.transactionAmount,
          currency: rewardSources.currency,
          merchantPackageSnapshot: rewardSources.merchantPackageSnapshot,
          serviceFeeSnapshot: rewardSources.serviceFeeSnapshot,
          rewardRuleVersionId: rewardSources.rewardRuleVersionId,
          consumed: rewardSources.consumed,
        })
        .from(rewardSources)
        .where(
          and(
            eq(rewardSources.sourceType, 'TRANSACTION'),
            eq(rewardSources.sourceId, input.transactionId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const source = existing[0]!;
        // Also fetch the associated plan
        const planRows = await tx
          .select({ id: rewardPlans.id })
          .from(rewardPlans)
          .where(
            and(
              eq(rewardPlans.sourceType, 'TRANSACTION'),
              eq(rewardPlans.sourceId, input.transactionId),
              eq(rewardPlans.memberId, source.memberId),
              eq(rewardPlans.marketId, source.marketId),
            ),
          )
          .limit(1);

        return {
          sourceId: source.id,
          planId: planRows[0]?.id ?? '',
          rewardRuleVersionId: source.rewardRuleVersionId,
          rewardAmount: null,
          merchantPackageId:
            (source.merchantPackageSnapshot as Record<string, string> | null)
              ?.package_id ?? null,
          merchantPackageName:
            (source.merchantPackageSnapshot as Record<string, string> | null)
              ?.name ?? null,
          merchantPackageRate:
            (source.merchantPackageSnapshot as Record<string, string> | null)
              ?.rate ?? null,
          serviceFeeRate:
            (source.serviceFeeSnapshot as Record<string, string> | null)
              ?.rate ?? null,
          isNew: false,
        };
      }

      // ── 2. Lock merchant branch & resolve active package ─────────
      const packageSnapshot = await this.resolveMerchantPackageAtTime(
        tx,
        input.merchantBranchId,
        input.transactionTime,
      );

      let serviceFeeRate: string | null = null;
      if (packageSnapshot) {
        // If it's a service-fee version, get the rate directly
        // If it's a special percentage, get that rate
        serviceFeeRate = packageSnapshot.rate ?? null;
      }

      // ── 3. Resolve effective reward rule version ─────────────────
      const ruleVersion = await this.resolveRewardRuleVersion(
        tx,
        input.consumptionMarketId,
        input.transactionTime,
      );

      // ── 4. Calculate reward amount ───────────────────────────────
      // reward = transactionAmount × rewardRate (HALF_UP rounding)
      let rewardAmount: string | null = null;
      if (ruleVersion) {
        rewardAmount = this.calculateReward(
          input.amount,
          ruleVersion.rewardRate,
          ruleVersion.capType,
          ruleVersion.capValue,
          ruleVersion.minimumReward,
        );
      }

      // ── 5. Insert reward_plans entitlement ────────────────────
      const planRows = await tx
        .insert(rewardPlans)
        .values({
          sourceType: 'TRANSACTION',
          sourceId: input.transactionId,
          memberId: input.memberId,
          marketId: input.consumptionMarketId,
          merchantId: input.merchantBranchId,
          status: rewardAmount ? 'SCHEDULED' : 'COMPLETED',
          ...(ruleVersion
            ? {
                ruleVersionId: ruleVersion.id,
                totalEarned: rewardAmount ?? '0',
                capAmount:
                  ruleVersion.capType !== 'NONE'
                    ? ruleVersion.capValue
                    : undefined,
              }
            : {}),
          snapshot: {
            transaction_amount: input.amount,
            transaction_currency: input.currency,
            transaction_time: input.transactionTime.toISOString(),
            ...(packageSnapshot ? { merchant_package: packageSnapshot } : {}),
            ...(ruleVersion ? { reward_rule: ruleVersion } : {}),
          },
          activatedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: rewardPlans.id });

      const planId = planRows[0]?.id ?? '';

      // ── 6. Insert reward_sources snapshot ──────────────────────
      const sourceRows = await tx
        .insert(rewardSources)
        .values({
          sourceType: 'TRANSACTION',
          sourceId: input.transactionId,
          memberId: input.memberId,
          marketId: input.consumptionMarketId,
          merchantId: input.merchantBranchId,
          transactionAmount: normalizeDecimal(input.amount),
          currency: input.currency,
          merchantPackageSnapshot: packageSnapshot ?? {},
          serviceFeeSnapshot: serviceFeeRate ? { rate: serviceFeeRate } : {},
          rewardRuleVersionId: ruleVersion?.id ?? null,
          consumed: !!rewardAmount,
          createdAt: new Date(),
        })
        .returning({ id: rewardSources.id });

      const sourceId = sourceRows[0]?.id ?? '';

      // ── 7. Create pending wallet entry if reward is payable ──────
      if (rewardAmount && numericGreater(rewardAmount, '0')) {
        await this.createPendingWalletEntry(
          tx,
          input.memberId,
          input.consumptionMarketId,
          rewardAmount,
          input.transactionId,
        );
      }

      // ── 8. Audit trail ─────────────────────────────────────────
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'SYSTEM' },
        action: 'REWARD_ENTITLEMENT_CREATED',
        entity: { type: 'REWARD_PLAN', id: planId },
        marketId: input.consumptionMarketId,
        after: {
          sourceId,
          transactionId: input.transactionId,
          memberId: input.memberId,
          merchantBranchId: input.merchantBranchId,
          amount: input.amount,
          currency: input.currency,
          rewardAmount,
          ruleVersionId: ruleVersion?.id ?? null,
        },
        result: 'SUCCESS',
        summary: `Reward entitlement created for transaction ${input.transactionId}`,
      });

      return {
        sourceId,
        planId,
        rewardRuleVersionId: ruleVersion?.id ?? null,
        rewardAmount,
        merchantPackageId: packageSnapshot?.service_fee_profile_id ?? null,
        merchantPackageName: packageSnapshot?.package_name ?? null,
        merchantPackageRate: packageSnapshot?.rate ?? null,
        serviceFeeRate,
        isNew: true,
      };
    });
  }

  /**
   * Retrieve the reward source snapshot for a given transaction.
   */
  async getSourceByTransaction(transactionId: string) {
    const rows = await this.database.db
      .select({
        id: rewardSources.id,
        sourceType: rewardSources.sourceType,
        sourceId: rewardSources.sourceId,
        memberId: rewardSources.memberId,
        marketId: rewardSources.marketId,
        merchantId: rewardSources.merchantId,
        transactionAmount: rewardSources.transactionAmount,
        currency: rewardSources.currency,
        merchantPackageSnapshot: rewardSources.merchantPackageSnapshot,
        serviceFeeSnapshot: rewardSources.serviceFeeSnapshot,
        rewardRuleVersionId: rewardSources.rewardRuleVersionId,
        consumed: rewardSources.consumed,
        createdAt: rewardSources.createdAt,
      })
      .from(rewardSources)
      .where(
        and(
          eq(rewardSources.sourceType, 'TRANSACTION'),
          eq(rewardSources.sourceId, transactionId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'REWARD_SOURCE_NOT_FOUND',
        message: `No reward source found for transaction ${transactionId}.`,
      });
    }
    return row;
  }

  /**
   * Reverse a reward entitlement when its source transaction is reversed.
   *
   * Idempotent: calling with an already-reversed transaction does nothing.
   */
  async reverseRewardEntitlement(transactionId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const sourceRows = await tx
        .select({
          id: rewardSources.id,
          memberId: rewardSources.memberId,
          marketId: rewardSources.marketId,
          consumed: rewardSources.consumed,
        })
        .from(rewardSources)
        .where(
          and(
            eq(rewardSources.sourceType, 'TRANSACTION'),
            eq(rewardSources.sourceId, transactionId),
          ),
        )
        .limit(1);

      if (sourceRows.length === 0) {
        throw new NotFoundException({
          code: 'REWARD_SOURCE_NOT_FOUND',
          message: `Cannot reverse: no reward source for transaction ${transactionId}.`,
        });
      }

      const source = sourceRows[0]!;

      // Update reward source
      await tx
        .update(rewardSources)
        .set({ consumed: false })
        .where(eq(rewardSources.id, source.id));

      // Update reward plans to REVERSED
      await tx
        .update(rewardPlans)
        .set({
          status: 'REVERSED',
          reversedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(rewardPlans.sourceType, 'TRANSACTION'),
            eq(rewardPlans.sourceId, transactionId),
            eq(rewardPlans.memberId, source.memberId),
            eq(rewardPlans.marketId, source.marketId),
          ),
        );

      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'SYSTEM' },
        action: 'REWARD_ENTITLEMENT_REVERSED',
        entity: { type: 'REWARD_SOURCE', id: source.id },
        marketId: source.marketId,
        after: { consumed: false },
        result: 'SUCCESS',
        summary: `Reward entitlement reversed for transaction ${transactionId}`,
      });
    });
  }

  // ── Private helpers ─────────────────────────────────────────────

  /**
   * Resolve the merchant's effective package at a given point in time.
   */
  private async resolveMerchantPackageAtTime(
    tx: DatabaseTransaction,
    merchantBranchId: string,
    atTime: Date,
  ): Promise<Record<string, string | null> | null> {
    // Find the active default package assignment for the branch at the given time
    const rows = await tx.execute<{
      assignment_id: string;
      service_fee_version_id: string | null;
      special_percentage_id: string | null;
      service_fee_profile_id: string | null;
      package_code: string | null;
      package_name: string | null;
      version_rate: string | null;
      special_rate: string | null;
    }>(sql`
      SELECT
        a.id AS assignment_id,
        a.service_fee_version_id,
        a.special_percentage_id,
        p.id AS service_fee_profile_id,
        p.code AS package_code,
        p.name AS package_name,
        v.rate AS version_rate,
        sp.rate AS special_rate
      FROM merchant_package_assignments a
      LEFT JOIN service_fee_versions v
        ON v.id = a.service_fee_version_id
        AND v.effective_from <= ${atTime}
        AND (v.effective_to IS NULL OR v.effective_to > ${atTime})
      LEFT JOIN service_fee_profiles p
        ON p.id = v.service_fee_profile_id
      LEFT JOIN special_percentages sp
        ON sp.id = a.special_percentage_id
      WHERE a.merchant_branch_id = ${merchantBranchId}
        AND a.status = 'ACTIVE'
        AND a.is_default = true
      LIMIT 1
    `);

    const row = rows.rows[0];
    if (!row) return null;

    const rate = row.version_rate ?? row.special_rate;
    return {
      assignment_id: row.assignment_id,
      service_fee_profile_id: row.service_fee_profile_id,
      package_code: row.package_code,
      package_name: row.package_name,
      rate,
      service_fee_version_id: row.service_fee_version_id,
      special_percentage_id: row.special_percentage_id,
    };
  }

  /**
   * Resolve the effective reward rule version for a market at a given time.
   */
  private async resolveRewardRuleVersion(
    tx: DatabaseTransaction,
    marketId: string,
    atTime: Date,
  ): Promise<{
    id: string;
    rewardRate: string;
    capType: string;
    capValue: string;
    minimumReward: string;
  } | null> {
    const rows = await tx
      .select({
        id: rewardRuleVersions.id,
        rewardRate: rewardRuleVersions.rewardRate,
        capType: rewardRuleVersions.capType,
        capValue: rewardRuleVersions.capValue,
        minimumReward: rewardRuleVersions.minimumReward,
      })
      .from(rewardRuleVersions)
      .where(
        and(
          eq(rewardRuleVersions.marketId, marketId),
          sql`${rewardRuleVersions.effectiveFrom} <= ${atTime}`,
          sql`(${rewardRuleVersions.effectiveTo} IS NULL OR ${rewardRuleVersions.effectiveTo} > ${atTime})`,
        ),
      )
      .orderBy(rewardRuleVersions.effectiveFrom)
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Calculate the reward amount using HALF_UP rounding.
   *
   * reward = transactionAmount × rewardRate / 100
   *
   * The result is rounded to 2 decimal places using HALF_UP rounding.
   * Cap and minimum reward constraints are then applied.
   */
  private calculateReward(
    amount: string,
    rate: string,
    capType: string,
    capValue: string,
    minimumReward: string,
  ): string | null {
    const amt = BigInt(sanitizeDecimal(amount));
    const rte = BigInt(sanitizeDecimal(rate));
    const precision = 10000000000n; // 10 decimal places for intermediate calc

    // reward = amount * rate / 100 (rate is stored as a percentage)
    // Using BigInt arithmetic:
    //   raw = amount * 10^10 * rate * 10^10 = amount * rate * 10^20
    //   reward * 100 = amount * rate (from: amount * rate / 100 * 100)
    //   So reward_2dp = raw / 10^20 with HALF_UP rounding
    const raw = amt * rte;
    const scale = precision * precision; // 10^20
    // Sign-aware HALF_UP rounding: raw >= 0 rounds away from zero (standard HALF_UP)
    // raw < 0 rounds toward negative infinity (correct HALF_UP for negatives)
    const reward2dp =
      raw >= 0n ? (raw + scale / 2n) / scale : (raw - scale / 2n) / scale;

    // Negative reward is impossible — guard before formatting to avoid crash
    // in cap/min comparison or string formatting with negative values
    if (reward2dp <= 0n) return null;

    // Convert to 2-decimal string
    const whole = reward2dp / 100n;
    const frac = reward2dp % 100n;
    let result = `${whole.toString()}.${frac.toString().padStart(2, '0')}`;

    // Apply cap
    if (capType === 'FLAT' || capType === 'RATIO') {
      const cap = BigInt(sanitizeDecimal2(capValue));
      const resultBig = BigInt(sanitizeDecimal2(result));
      if (resultBig > cap) {
        result = formatDecimal2(capValue);
      }
    }

    // Apply minimum
    const min = BigInt(sanitizeDecimal2(minimumReward));
    const resultBig = BigInt(sanitizeDecimal2(result));
    if (resultBig < min) {
      result = formatDecimal2(minimumReward);
    }

    // Never return zero or negative — rewards must be positive monetary value
    if (resultBig <= 0n) return null;

    return result;
  }

  /**
   * Create a pending member wallet entry for the reward amount.
   */
  private async createPendingWalletEntry(
    tx: DatabaseTransaction,
    memberId: string,
    marketId: string,
    rewardAmount: string,
    transactionId: string,
  ): Promise<void> {
    // Get or create the member wallet account
    const walletRows = await tx
      .insert(memberWalletAccounts)
      .values({
        memberId,
        marketId,
        pendingBalance: normalizeDecimal(rewardAmount),
        availableBalance: '0',
        reversedBalance: '0',
        version: 1,
      })
      .onConflictDoUpdate({
        target: [memberWalletAccounts.memberId, memberWalletAccounts.marketId],
        set: {
          pendingBalance: sql`${memberWalletAccounts.pendingBalance} + ${normalizeDecimal(rewardAmount)}`,
          version: sql`${memberWalletAccounts.version} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: memberWalletAccounts.id });

    const walletId = walletRows[0]?.id;
    if (!walletId) return;

    // Insert wallet entry with a deterministic idempotency key
    const idempotencyKey = `reward:tx:${transactionId}`;

    // Get the current sequence number
    const nextSeq: bigint = await (async () => {
      const rows = await tx.execute<{ max_seq: string | null }>(sql`
        SELECT MAX(entry_sequence)::text AS max_seq
        FROM member_wallet_entries
        WHERE wallet_account_id = ${walletId}
      `);
      return rows.rows[0]?.max_seq ? BigInt(rows.rows[0].max_seq) + 1n : 1n;
    })();

    await tx
      .insert(memberWalletEntries)
      .values({
        walletAccountId: walletId,
        memberId,
        marketId,
        entrySequence: nextSeq,
        entryType: 'PENDING',
        amount: normalizeDecimal(rewardAmount),
        balanceBefore: '0',
        balanceAfter: normalizeDecimal(rewardAmount),
        idempotencyKey,
        referenceType: 'TRANSACTION',
        referenceId: transactionId,
        description: `Reward from transaction ${transactionId}`,
        reason: 'TRANSACTION_REWARD',
        actorId: 'SYSTEM',
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [memberWalletEntries.idempotencyKey],
      });
  }
}

// ── Utility functions ─────────────────────────────────────────────

/**
 * Normalize a decimal string to exactly 10 decimal places (precision 38,10).
 */
function normalizeDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(10, '0')}`;
}

/**
 * Sanitize a decimal to BigInt-compatible integer (10 decimal places).
 * Converts "100.00" to "1000000000000" (scale 10).
 */
function sanitizeDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return `${whole}${fraction.padEnd(10, '0')}`;
}

/**
 * Sanitize a decimal to BigInt-compatible integer (2 decimal places).
 */
function sanitizeDecimal2(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return `${whole}${fraction.padEnd(2, '0')}`;
}

/**
 * Format a value to exactly 2 decimal places.
 * Handles decimal strings like "50.50" or integer strings like "100"
 * and ensures exactly 2 fractional digits.
 */
function formatDecimal2(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/**
 * Compare two numeric strings: returns true if a > b.
 */
function numericGreater(a: string, b: string): boolean {
  const aNorm = sanitizeDecimal2(a);
  const bNorm = sanitizeDecimal2(b);
  return BigInt(aNorm) > BigInt(bNorm);
}
