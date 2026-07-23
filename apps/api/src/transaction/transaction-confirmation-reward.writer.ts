import { Inject, Injectable } from '@nestjs/common';
import {
  memberWalletAccounts,
  memberWalletEntries,
  rewardPlans,
  rewardSources,
  type Database,
} from '@ipoint/database';
import { Decimal } from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../platform-access/audit.service.js';

export type TransactionDatabaseClient = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface ConfirmedRewardInput {
  transactionId: string;
  memberId: string;
  marketId: string;
  merchantBranchId: string;
  amount: string;
  currency: string;
  transactionTime: Date;
  packageSnapshot: Record<string, unknown>;
  serviceFeeRate: string;
  serviceFeeAmount: string;
  rewardRuleVersionId: string;
  rewardRate: string;
  dailyRewardAmount: string;
  rewardCap: string;
  rewardStartBusinessDate: string;
  marketTimezone: string;
}

export interface ConfirmedRewardResult {
  sourceId: string;
  planId: string;
  walletAccountId: string | null;
  walletEntryId: string | null;
}

@Injectable()
export class TransactionConfirmationRewardWriter {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async createRewardEntitlementInTransaction(
    tx: TransactionDatabaseClient,
    input: ConfirmedRewardInput,
  ): Promise<ConfirmedRewardResult> {
    const normalizedAmount = normalizeFinancial(input.amount);
    const normalizedDailyReward = normalizeFinancial(input.dailyRewardAmount);
    const normalizedRewardCap = normalizeFinancial(input.rewardCap);

    const planRows = await tx
      .insert(rewardPlans)
      .values({
        sourceType: 'TRANSACTION',
        sourceId: input.transactionId,
        memberId: input.memberId,
        marketId: input.marketId,
        merchantId: input.merchantBranchId,
        status: 'SCHEDULED',
        totalEarned: normalizedDailyReward,
        capAmount: normalizedRewardCap,
        ruleVersionId: input.rewardRuleVersionId,
        snapshot: {
          transaction_amount: normalizedAmount,
          transaction_currency: input.currency,
          transaction_time: input.transactionTime.toISOString(),
          merchant_package: input.packageSnapshot,
          service_fee: {
            rate: input.serviceFeeRate,
            amount: input.serviceFeeAmount,
          },
          reward_rule: {
            id: input.rewardRuleVersionId,
            rate: input.rewardRate,
            daily_reward_amount: normalizedDailyReward,
            cap: normalizedRewardCap,
            start_business_date: input.rewardStartBusinessDate,
            market_timezone: input.marketTimezone,
            rounding_mode: 'HALF_UP',
          },
        },
        activatedAt: input.transactionTime,
        createdAt: input.transactionTime,
        updatedAt: input.transactionTime,
      })
      .returning({ id: rewardPlans.id });
    const planId = planRows[0]?.id;
    if (!planId) {
      throw new Error('Reward plan insert did not return an identifier.');
    }

    const sourceRows = await tx
      .insert(rewardSources)
      .values({
        sourceType: 'TRANSACTION',
        sourceId: input.transactionId,
        memberId: input.memberId,
        marketId: input.marketId,
        merchantId: input.merchantBranchId,
        transactionAmount: normalizedAmount,
        currency: input.currency,
        merchantPackageSnapshot: input.packageSnapshot,
        serviceFeeSnapshot: {
          rate: input.serviceFeeRate,
          amount: input.serviceFeeAmount,
        },
        rewardRuleVersionId: input.rewardRuleVersionId,
        consumed: true,
        createdAt: input.transactionTime,
      })
      .returning({ id: rewardSources.id });
    const sourceId = sourceRows[0]?.id;
    if (!sourceId) {
      throw new Error('Reward source insert did not return an identifier.');
    }

    let walletAccountId: string | null = null;
    let walletEntryId: string | null = null;
    if (new Decimal(normalizedDailyReward).gt(0)) {
      const walletResult = await this.appendPendingWalletEntry(
        tx,
        input,
        normalizedDailyReward,
      );
      walletAccountId = walletResult.walletAccountId;
      walletEntryId = walletResult.walletEntryId;
    }

    await this.audit.appendWithinTransaction(tx, {
      actor: { type: 'SYSTEM' },
      action: 'REWARD_ENTITLEMENT_CREATED',
      entity: { type: 'REWARD_PLAN', id: planId },
      marketId: input.marketId,
      after: {
        sourceId,
        transactionId: input.transactionId,
        memberId: input.memberId,
        merchantBranchId: input.merchantBranchId,
        amount: normalizedAmount,
        currency: input.currency,
        dailyRewardAmount: normalizedDailyReward,
        rewardCap: normalizedRewardCap,
        rewardRuleVersionId: input.rewardRuleVersionId,
        rewardStartBusinessDate: input.rewardStartBusinessDate,
      },
      result: 'SUCCESS',
      summary: `Reward entitlement created for transaction ${input.transactionId}`,
    });

    return { sourceId, planId, walletAccountId, walletEntryId };
  }

  private async appendPendingWalletEntry(
    tx: TransactionDatabaseClient,
    input: ConfirmedRewardInput,
    rewardAmount: string,
  ): Promise<{ walletAccountId: string; walletEntryId: string }> {
    await tx
      .insert(memberWalletAccounts)
      .values({
        memberId: input.memberId,
        marketId: input.marketId,
        pendingBalance: '0',
        availableBalance: '0',
        reversedBalance: '0',
        version: 1,
        createdAt: input.transactionTime,
        updatedAt: input.transactionTime,
      })
      .onConflictDoNothing({
        target: [memberWalletAccounts.memberId, memberWalletAccounts.marketId],
      });

    const walletRows = await tx
      .select()
      .from(memberWalletAccounts)
      .where(
        and(
          eq(memberWalletAccounts.memberId, input.memberId),
          eq(memberWalletAccounts.marketId, input.marketId),
        ),
      )
      .limit(1)
      .for('update');
    const wallet = walletRows[0];
    if (!wallet) {
      throw new Error('Member wallet account could not be resolved.');
    }

    const balanceBefore = normalizeFinancial(wallet.pendingBalance);
    const balanceAfter = new Decimal(balanceBefore)
      .plus(rewardAmount)
      .toFixed(10);
    const sequenceRows = await tx.execute<{ nextSequence: string }>(sql`
      SELECT (COALESCE(MAX(entry_sequence), 0) + 1)::text AS "nextSequence"
      FROM member_wallet_entries
      WHERE wallet_account_id = ${wallet.id}
    `);
    const nextSequence = BigInt(sequenceRows.rows[0]?.nextSequence ?? '1');

    await tx
      .update(memberWalletAccounts)
      .set({
        pendingBalance: balanceAfter,
        version: sql`${memberWalletAccounts.version} + 1`,
        updatedAt: input.transactionTime,
      })
      .where(eq(memberWalletAccounts.id, wallet.id));

    const entryRows = await tx
      .insert(memberWalletEntries)
      .values({
        walletAccountId: wallet.id,
        memberId: input.memberId,
        marketId: input.marketId,
        entrySequence: nextSequence,
        entryType: 'PENDING',
        amount: rewardAmount,
        balanceBefore,
        balanceAfter,
        idempotencyKey: `reward:tx:${input.transactionId}`,
        referenceType: 'TRANSACTION',
        referenceId: input.transactionId,
        description: `Reward from transaction ${input.transactionId}`,
        reason: 'TRANSACTION_REWARD',
        actorId: 'SYSTEM',
        marketTimezone: input.marketTimezone,
        createdAt: input.transactionTime,
      })
      .returning({ id: memberWalletEntries.id });
    const walletEntryId = entryRows[0]?.id;
    if (!walletEntryId) {
      throw new Error(
        'Member wallet entry insert did not return an identifier.',
      );
    }

    return { walletAccountId: wallet.id, walletEntryId };
  }
}

function normalizeFinancial(value: string): string {
  return new Decimal(value).toFixed(10);
}
