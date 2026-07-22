import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import {
  dailyJobRuns,
  rewardDailyAccruals,
  rewardPlans,
  rewardRuleVersions,
  memberWalletAccounts,
  memberWalletEntries,
  markets,
  type Database,
} from '@ipoint/database';
import { DatabaseService } from '../database/database.service.js';
import {
  JOB_TYPE_DAILY_REWARD_ACCRUAL,
  type DailyAccrualResult,
  type DailyJobRunResponse,
  type DailyJobStatus,
  type EligibleRewardPlan,
  type ProcessDailyAccrualsParams,
  type RewardDailyAccrualResponse,
} from './job.types.js';
import {
  jobRunNotFoundError,
  jobRunAlreadyExistsError,
  jobRunInvalidStateError,
  noEligibleRewardPlansError,
  rewardPlanAccrualCalculationError,
  accrualDuplicateError,
} from './job.errors.js';

// Configure decimal.js for financial precision
Decimal.set({ rounding: 3, precision: 50 });

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class JobService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // ─── Job Run Lifecycle ─────────────────────────────────────────────

  /**
   * Create a new daily job run record.
   * Uses ON CONFLICT to safely handle race conditions.
   */
  async createJobRun(params: {
    jobType: string;
    marketId: string;
    localBusinessDate: string;
  }): Promise<DailyJobRunResponse> {
    return this.database.runTransaction(async (tx) => {
      const [run] = await tx
        .insert(dailyJobRuns)
        .values({
          jobType: params.jobType,
          marketId: params.marketId,
          localBusinessDate: params.localBusinessDate,
          status: 'PENDING',
          totalEntitlements: 0,
          processedCount: 0,
          failedCount: 0,
        })
        .onConflictDoNothing()
        .returning();

      if (!run) {
        // Conflict — row already exists, fetch it
        const existing = await tx
          .select()
          .from(dailyJobRuns)
          .where(
            and(
              eq(dailyJobRuns.jobType, params.jobType),
              eq(dailyJobRuns.marketId, params.marketId),
              eq(dailyJobRuns.localBusinessDate, params.localBusinessDate),
            ),
          )
          .limit(1);

        if (existing[0]) {
          throw jobRunAlreadyExistsError(
            params.jobType,
            params.marketId,
            params.localBusinessDate,
          );
        }
        throw jobRunNotFoundError();
      }

      return this.mapJobRun(run);
    });
  }

  /**
   * Update job run status and progress.
   */
  async updateJobRun(
    runId: string,
    updates: {
      status?: string;
      startedAt?: Date;
      completedAt?: Date | null;
      totalEntitlements?: number;
      processedCount?: number;
      failedCount?: number;
      errorDetail?: string | null;
    },
  ): Promise<DailyJobRunResponse> {
    // Build typed updates object - drizzle .set() requires a partial insert type
    const setData: Partial<typeof dailyJobRuns.$inferInsert> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        (setData as Record<string, unknown>)[key] = value;
      }
    }
    setData.updatedAt = new Date();

    const [run] = await this.database.db
      .update(dailyJobRuns)
      .set(setData)
      .where(eq(dailyJobRuns.id, runId))
      .returning();

    if (!run) throw jobRunNotFoundError();
    return this.mapJobRun(run);
  }

  /**
   * Get a job run by its composite key.
   */
  async getJobRun(
    jobType: string,
    marketId: string,
    localBusinessDate: string,
  ): Promise<DailyJobRunResponse> {
    const [run] = await this.database.db
      .select()
      .from(dailyJobRuns)
      .where(
        and(
          eq(dailyJobRuns.jobType, jobType),
          eq(dailyJobRuns.marketId, marketId),
          eq(dailyJobRuns.localBusinessDate, localBusinessDate),
        ),
      )
      .limit(1);

    if (!run) throw jobRunNotFoundError();
    return this.mapJobRun(run);
  }

  /**
   * List job runs for a market with optional status filter.
   */
  async listJobRuns(params: {
    marketId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    runs: DailyJobRunResponse[];
    total: number;
  }> {
    const conditions = and(
      params.marketId ? eq(dailyJobRuns.marketId, params.marketId) : undefined,
      params.status
        ? eq(dailyJobRuns.status, params.status as DailyJobStatus)
        : undefined,
    );

    const totalResult = await this.database.db
      .select({ total: count() })
      .from(dailyJobRuns)
      .where(conditions);

    const total = Number(totalResult[0]?.total ?? 0);
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    const rows = await this.database.db
      .select()
      .from(dailyJobRuns)
      .where(conditions)
      .orderBy(sql`${dailyJobRuns.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    return {
      runs: rows.map((r) => this.mapJobRun(r)),
      total,
    };
  }

  // ─── Core Accrual Processing ───────────────────────────────────────

  /**
   * Process daily reward accruals for a given market on a given business date.
   *
   * This is the main entry point for the daily reward job.
   * - Scans reward plans that are ACTIVE or CAPPED
   * - Calculates the daily accrual amount per plan
   * - Creates accrual records with idempotency
   * - Creates wallet ledger entries for each accrual
   * - Updates job run progress
   *
   * @returns A job run checkpoint with counts
   */
  async processDailyAccruals(params: ProcessDailyAccrualsParams): Promise<{
    jobRunId: string;
    processedCount: number;
    failedCount: number;
    results: DailyAccrualResult[];
  }> {
    return this.database.runTransaction(async (tx) => {
      // 1. Create job run record
      const jobRun = await this.createJobRunInTx(tx, params);

      // Update to RUNNING
      const [runningRun] = await tx
        .update(dailyJobRuns)
        .set({
          status: 'RUNNING',
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dailyJobRuns.id, jobRun.id))
        .returning();

      if (!runningRun) throw jobRunNotFoundError();

      // 2. Fetch the market timezone for date calculations
      const [market] = await tx
        .select({ timezone: markets.timezone, id: markets.id })
        .from(markets)
        .where(eq(markets.id, params.marketId))
        .limit(1);

      if (!market) {
        throw new Error(`Market ${params.marketId} not found`);
      }

      // 3. Scan eligible reward plans
      const eligiblePlans = await this.scanEligiblePlansInTx(tx, params);

      if (eligiblePlans.length === 0) {
        // No eligible plans — mark as completed with zero counts
        await tx
          .update(dailyJobRuns)
          .set({
            status: 'COMPLETED',
            completedAt: new Date(),
            totalEntitlements: 0,
            processedCount: 0,
            failedCount: 0,
            updatedAt: new Date(),
          })
          .where(eq(dailyJobRuns.id, jobRun.id));

        return {
          jobRunId: jobRun.id,
          processedCount: 0,
          failedCount: 0,
          results: [],
        };
      }

      const totalEligible = eligiblePlans.length;
      let processedCount = 0;
      let failedCount = 0;
      const results: DailyAccrualResult[] = [];

      // 4. Process each eligible plan
      for (const plan of eligiblePlans) {
        try {
          const result = await this.processSinglePlanInTx(
            tx,
            plan,
            params,
            market.timezone,
          );
          results.push(result);
          if (result.accrual) {
            processedCount++;
          } else {
            failedCount++;
          }
        } catch (err) {
          results.push({
            accrual: null,
            error: err instanceof Error ? err.message : String(err),
          });
          failedCount++;
        }
      }

      // 5. Update job run as completed
      await tx
        .update(dailyJobRuns)
        .set({
          status: failedCount > 0 ? 'FAILED' : 'COMPLETED',
          completedAt: new Date(),
          totalEntitlements: totalEligible,
          processedCount,
          failedCount,
          errorDetail:
            failedCount > 0
              ? `Processed ${processedCount}/${totalEligible} plans. ${failedCount} failed.`
              : null,
          updatedAt: new Date(),
        })
        .where(eq(dailyJobRuns.id, jobRun.id));

      return {
        jobRunId: jobRun.id,
        processedCount,
        failedCount,
        results,
      };
    });
  }

  /**
   * Create job run within existing transaction.
   */
  private async createJobRunInTx(
    tx: DbTransaction,
    params: ProcessDailyAccrualsParams,
  ) {
    const [run] = await tx
      .insert(dailyJobRuns)
      .values({
        jobType: JOB_TYPE_DAILY_REWARD_ACCRUAL,
        marketId: params.marketId,
        localBusinessDate: params.localBusinessDate,
        status: 'PENDING',
        totalEntitlements: 0,
        processedCount: 0,
        failedCount: 0,
      })
      .onConflictDoNothing()
      .returning();

    if (!run) {
      // Re-fetch existing
      const existing = await tx
        .select()
        .from(dailyJobRuns)
        .where(
          and(
            eq(dailyJobRuns.jobType, JOB_TYPE_DAILY_REWARD_ACCRUAL),
            eq(dailyJobRuns.marketId, params.marketId),
            eq(dailyJobRuns.localBusinessDate, params.localBusinessDate),
          ),
        )
        .limit(1);

      if (existing[0]) {
        throw jobRunAlreadyExistsError(
          JOB_TYPE_DAILY_REWARD_ACCRUAL,
          params.marketId,
          params.localBusinessDate,
        );
      }
      throw jobRunNotFoundError();
    }

    return run;
  }

  /**
   * Scan for eligible reward plans that need daily accrual processing.
   */
  private async scanEligiblePlansInTx(
    tx: DbTransaction,
    params: ProcessDailyAccrualsParams,
  ): Promise<EligibleRewardPlan[]> {
    const rows = await tx
      .select({
        id: rewardPlans.id,
        memberId: rewardPlans.memberId,
        marketId: rewardPlans.marketId,
        ruleVersionId: rewardPlans.ruleVersionId,
        totalEarned: rewardPlans.totalEarned,
        capAmount: rewardPlans.capAmount,
        snapshot: rewardPlans.snapshot,
      })
      .from(rewardPlans)
      .where(
        and(
          eq(rewardPlans.marketId, params.marketId),
          sql`${rewardPlans.status} IN ('ACTIVE', 'CAPPED')`,
        ),
      );

    // Filter out plans that already have an accrual for this date
    // (idempotency — same-day duplicate prevention)
    const planIds = rows.map((r) => r.id);

    if (planIds.length === 0) return [];

    const existingAccruals = await tx
      .select({ rewardPlanId: rewardDailyAccruals.rewardPlanId })
      .from(rewardDailyAccruals)
      .where(
        and(
          inArray(rewardDailyAccruals.rewardPlanId, planIds),
          eq(rewardDailyAccruals.marketLocalDate, params.localBusinessDate),
        ),
      );

    const existingPlanIds = new Set(
      existingAccruals.map((a) => a.rewardPlanId),
    );

    return rows
      .filter((r) => !existingPlanIds.has(r.id))
      .map((r) => ({
        id: r.id,
        memberId: r.memberId,
        marketId: r.marketId,
        ruleVersionId: r.ruleVersionId,
        totalEarned: r.totalEarned,
        capAmount: r.capAmount,
        snapshot: r.snapshot as Record<string, unknown> | null,
      }));
  }

  /**
   * Process a single reward plan's daily accrual.
   * - Calculate daily amount based on reward rate
   * - Apply cap if configured
   * - Create accrual record
   * - Create wallet entry
   */
  private async processSinglePlanInTx(
    tx: DbTransaction,
    plan: EligibleRewardPlan,
    params: ProcessDailyAccrualsParams,
    marketTimezone: string,
  ): Promise<DailyAccrualResult> {
    // 1. Calculate daily accrual amount
    const dailyAmount = await this.calculateDailyAccrual(tx, plan);

    if (
      new Decimal(dailyAmount).isZero() ||
      new Decimal(dailyAmount).isNegative()
    ) {
      return {
        accrual: null,
        error: `Calculated daily amount (${dailyAmount}) is not positive for plan ${plan.id}`,
      };
    }

    // 2. Apply cap check
    const appliedAmount = await this.applyCap(tx, plan, dailyAmount);

    if (new Decimal(appliedAmount).isZero()) {
      return {
        accrual: null,
        error: `Daily amount after cap is zero for plan ${plan.id}`,
      };
    }

    // 3. Build idempotency key
    const idempotencyKey = this.buildIdempotencyKey(
      plan.id,
      params.localBusinessDate,
    );

    // 4. Create accrual record (idempotent via unique constraint)
    const existingAccrual = await tx
      .select()
      .from(rewardDailyAccruals)
      .where(
        and(
          eq(rewardDailyAccruals.rewardPlanId, plan.id),
          eq(rewardDailyAccruals.marketLocalDate, params.localBusinessDate),
          eq(rewardDailyAccruals.ledgerEntryType, 'PENDING'),
        ),
      )
      .limit(1);

    const existingRow = existingAccrual[0];
    if (existingRow) {
      // Already processed — idempotent
      return { accrual: this.mapAccrual(existingRow) };
    }

    const executedAtUtc = new Date();
    const [accrual] = await tx
      .insert(rewardDailyAccruals)
      .values({
        rewardPlanId: plan.id,
        memberId: plan.memberId,
        marketId: plan.marketId,
        rewardRuleVersionId: plan.ruleVersionId,
        marketTimezone: marketTimezone,
        marketLocalDate: params.localBusinessDate,
        executedAtUtc,
        amount: appliedAmount,
        ledgerEntryType: 'PENDING' as const,
        idempotencyKey,
        auditCorrelationId: plan.id,
      })
      .returning();

    if (!accrual) {
      return {
        accrual: null,
        error: `Failed to create accrual record for plan ${plan.id}`,
      };
    }

    // 5. Create wallet ledger entry
    // Get or create wallet account with row-level lock
    const wallets = await tx
      .select()
      .from(memberWalletAccounts)
      .where(
        and(
          eq(memberWalletAccounts.memberId, plan.memberId),
          eq(memberWalletAccounts.marketId, plan.marketId),
        ),
      )
      .for('update')
      .limit(1);

    let wallet: typeof memberWalletAccounts.$inferSelect;
    const firstWallet = wallets[0];
    if (!firstWallet) {
      const inserted = await tx
        .insert(memberWalletAccounts)
        .values({
          memberId: plan.memberId,
          marketId: plan.marketId,
        })
        .returning();
      const insertedWallet = inserted[0];
      if (!insertedWallet) {
        throw new Error('Failed to create wallet account');
      }
      wallet = insertedWallet;
    } else {
      wallet = firstWallet;
    }

    // Compute new balances
    const newPending = sql`CAST(${memberWalletAccounts.pendingBalance} AS numeric(38,10)) + CAST(${appliedAmount} AS numeric(38,10))`;

    // Get next sequence number
    const maxSeqResult = await tx
      .select({
        maxSeq: sql<bigint>`COALESCE(MAX(${memberWalletEntries.entrySequence}), 0) + 1`,
      })
      .from(memberWalletEntries)
      .where(eq(memberWalletEntries.walletAccountId, wallet.id));

    const nextSeq = BigInt(String(maxSeqResult[0]?.maxSeq ?? 1));

    // Update wallet balance with optimistic lock
    const updatedWallets = await tx
      .update(memberWalletAccounts)
      .set({
        pendingBalance: newPending,
        version: sql`${memberWalletAccounts.version} + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(memberWalletAccounts.id, wallet.id),
          eq(memberWalletAccounts.version, wallet.version),
        ),
      )
      .returning();

    if (!updatedWallets[0]) {
      return {
        accrual: null,
        error: `Concurrent wallet update for plan ${plan.id}. Please retry.`,
      };
    }

    // Insert wallet ledger entry
    await tx
      .insert(memberWalletEntries)
      .values({
        walletAccountId: wallet.id,
        memberId: plan.memberId,
        marketId: plan.marketId,
        entrySequence: nextSeq,
        entryType: 'PENDING',
        amount: appliedAmount,
        balanceBefore: wallet.pendingBalance,
        balanceAfter: sql`CAST(${wallet.pendingBalance} AS numeric(38,10)) + CAST(${appliedAmount} AS numeric(38,10))`,
        idempotencyKey: `DAILY_ACCRUAL_${idempotencyKey}`,
        referenceType: 'DAILY_REWARD_ACCRUAL',
        referenceId: accrual.id,
        description: `Daily reward accrual for ${params.localBusinessDate}`,
        reason: 'DAILY_REWARD_ACCRUAL',
        actorId: '00000000-0000-0000-0000-000000000000', // SYSTEM actor
        marketTimezone: marketTimezone,
      })
      .returning();

    return { accrual: this.mapAccrual(accrual) };
  }

  // ─── Calculation ───────────────────────────────────────────────────

  /**
   * Calculate the daily accrual amount for a reward plan.
   * Formula: (totalEarned) * (dailyRate / 365)
   * Uses Decimal.js for all operations with HALF_UP rounding.
   */
  private async calculateDailyAccrual(
    tx: DbTransaction,
    plan: EligibleRewardPlan,
  ): Promise<string> {
    // Fetch effective rule version
    let rewardRate: string;
    let minimumReward: string;

    if (plan.ruleVersionId) {
      const [rule] = await tx
        .select({
          rewardRate: rewardRuleVersions.rewardRate,
          minimumReward: rewardRuleVersions.minimumReward,
        })
        .from(rewardRuleVersions)
        .where(eq(rewardRuleVersions.id, plan.ruleVersionId))
        .limit(1);

      if (!rule) {
        throw rewardPlanAccrualCalculationError(
          plan.id,
          `Rule version ${plan.ruleVersionId} not found`,
        );
      }
      rewardRate = rule.rewardRate;
      minimumReward = rule.minimumReward;
    } else {
      // Use snapshot rate if no explicit version
      const snapshot = plan.snapshot;
      const merchantPackageSnapshot = snapshot?.merchantPackageSnapshot as
        | Record<string, unknown>
        | undefined;
      rewardRate = String(
        (merchantPackageSnapshot?.percentage as string) ?? '0',
      );
      minimumReward = '0';
    }

    // Calculate daily rate: rewardRate / 365
    const rateDecimal = new Decimal(rewardRate);
    const dailyRate = rateDecimal.dividedBy(365);

    // If plan has a totalEarned, use it for calculation
    const totalEarnedDecimal = new Decimal(plan.totalEarned);
    let dailyAmount = totalEarnedDecimal.mul(dailyRate);

    // Apply minimum reward
    const minRewardDecimal = new Decimal(minimumReward);
    if (dailyAmount.lessThan(minRewardDecimal)) {
      dailyAmount = minRewardDecimal;
    }

    // Round to 10 decimal places, HALF_UP
    return dailyAmount.toDecimalPlaces(10, 3).toString();
  }

  /**
   * Apply cap logic to the calculated daily amount.
   */
  private async applyCap(
    tx: DbTransaction,
    plan: EligibleRewardPlan,
    dailyAmount: string,
  ): Promise<string> {
    // If no cap is configured, return the full amount
    if (!plan.capAmount) {
      return dailyAmount;
    }

    const capDecimal = new Decimal(plan.capAmount);
    const totalEarnedDecimal = new Decimal(plan.totalEarned);
    const dailyDecimal = new Decimal(dailyAmount);

    // If adding daily amount would exceed cap, cap it
    const newTotalIfAdded = totalEarnedDecimal.plus(dailyDecimal);
    if (newTotalIfAdded.greaterThan(capDecimal)) {
      // Cap the daily amount to the remaining cap space
      const remainingCapSpace = capDecimal.minus(totalEarnedDecimal);
      if (remainingCapSpace.isNegative() || remainingCapSpace.isZero()) {
        return '0';
      }
      return remainingCapSpace
        .toDecimalPlaces(10, 3)
        .toString();
    }

    return dailyAmount;
  }

  // ─── Idempotency ───────────────────────────────────────────────────

  /**
   * Build an idempotency key for a daily accrual.
   */
  private buildIdempotencyKey(
    rewardPlanId: string,
    localBusinessDate: string,
  ): string {
    return `DAILY_ACCRUAL:${rewardPlanId}:${localBusinessDate}`;
  }

  // ─── Retry Logic ────────────────────────────────────────────────────

  /**
   * Retry processing for previously failed accrual items.
   * Only retries items that have an error detail set.
   */
  async retryFailedItems(jobRunId: string): Promise<{
    retried: number;
    succeeded: number;
    failed: number;
  }> {
    return this.database.runTransaction(async (tx) => {
      const [jobRun] = await tx
        .select()
        .from(dailyJobRuns)
        .where(eq(dailyJobRuns.id, jobRunId))
        .limit(1);

      if (!jobRun) throw jobRunNotFoundError();
      if (jobRun.status !== 'FAILED') {
        throw jobRunInvalidStateError(jobRun.status, 'FAILED');
      }

      // Find accruals in the given job run's market/date that have no accrual
      // Note: In a more sophisticated implementation, we'd have a failed_items
      // table. For now, we re-process via the plan scanning logic which skips
      // already-processed plans.
      const marketTimezone = jobRun.marketId; // fetch from markets
      const market = await tx
        .select({ timezone: markets.timezone })
        .from(markets)
        .where(eq(markets.id, jobRun.marketId))
        .limit(1);

      const marketRow = market[0];
      if (!marketRow) {
        throw new Error(`Market ${jobRun.marketId} not found`);
      }

      // Re-process with same params — idempotent accruals will be skipped
      const result = await this.processDailyAccruals({
        marketId: jobRun.marketId,
        localBusinessDate: jobRun.localBusinessDate,
        marketTimezone: marketRow.timezone,
      });

      return {
        retried: result.processedCount + result.failedCount,
        succeeded: result.processedCount,
        failed: result.failedCount,
      };
    });
  }

  // ─── Mappers ────────────────────────────────────────────────────────

  private mapJobRun(
    row: typeof dailyJobRuns.$inferSelect,
  ): DailyJobRunResponse {
    return {
      id: row.id,
      jobType: row.jobType,
      marketId: row.marketId,
      localBusinessDate: row.localBusinessDate,
      status: row.status as DailyJobRunResponse['status'],
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      totalEntitlements: row.totalEntitlements,
      processedCount: row.processedCount,
      failedCount: row.failedCount,
      errorDetail: row.errorDetail,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapAccrual(
    row: typeof rewardDailyAccruals.$inferSelect,
  ): RewardDailyAccrualResponse {
    return {
      id: row.id,
      rewardPlanId: row.rewardPlanId,
      memberId: row.memberId,
      marketId: row.marketId,
      rewardRuleVersionId: row.rewardRuleVersionId,
      marketTimezone: row.marketTimezone,
      marketLocalDate: row.marketLocalDate,
      executedAtUtc: row.executedAtUtc.toISOString(),
      amount: row.amount,
      ledgerEntryType: row.ledgerEntryType,
      idempotencyKey: row.idempotencyKey,
      auditCorrelationId: row.auditCorrelationId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
