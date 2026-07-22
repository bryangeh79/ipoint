import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  adminUsers,
  marketAccess,
  markets,
  memberWalletAccounts,
  memberWalletEntries,
  rewardRuleVersions,
  type Database,
} from '@ipoint/database';
import { and, count, desc, eq, isNull, asc, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type {
  CreateRuleVersionDto,
  RuleListQueryDto,
  JobListQueryDto,
  WalletAdjustmentDto,
} from './admin-reward.dto.js';
import {
  adminRewardAdjustmentInvalidAmountError,
  adminRewardAdjustmentNotFoundError,
  adminRewardJobNotFoundError,
  adminRewardMarketAccessDeniedError,
  adminRewardRuleVersionArchivedError,
  adminRewardRuleVersionNotFoundError,
  adminRewardWalletNotFoundError,
} from './admin-reward.errors.js';
import type {
  AdminRewardActor,
  AdminRewardJobRun,
  AdminRewardJobRunDetailResponse,
  AdminRewardJobRunListResponse,
  AdminRewardRuleVersionDetailResponse,
  AdminRewardRuleVersionListItem,
  AdminRewardRuleVersionListResponse,
  AdminRewardVersionHistoryResponse,
  AdminWalletAdjustmentResponse,
} from './admin-reward.types.js';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

@Injectable()
export class AdminRewardService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ─── Rule Versions ─────────────────────────────────────────────────

  async listRuleVersions(
    adminActor: AdminRewardActor,
    query: RuleListQueryDto,
  ): Promise<AdminRewardRuleVersionListResponse> {
    const conditions = this.ruleVersionConditions(query);

    const totalResult = await this.database.db
      .select({ total: count() })
      .from(rewardRuleVersions)
      .where(conditions);

    const total = Number(totalResult[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(conditions)
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    return {
      items: rows.map((r) => this.mapRuleVersionListItem(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getRuleVersion(
    adminActor: AdminRewardActor,
    id: string,
  ): Promise<AdminRewardRuleVersionDetailResponse> {
    const [row] = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.id, id))
      .limit(1);

    if (!row) throw adminRewardRuleVersionNotFoundError();

    // Load version history (all versions for the same name/scope)
    const versions = await this.database.db
      .select({
        id: rewardRuleVersions.id,
        name: rewardRuleVersions.name,
        rewardRate: rewardRuleVersions.rewardRate,
        effectiveFrom: rewardRuleVersions.effectiveFrom,
        effectiveTo: rewardRuleVersions.effectiveTo,
        marketId: rewardRuleVersions.marketId,
        isArchived:
          sql`CASE WHEN ${rewardRuleVersions.archivedAt} IS NULL THEN false ELSE true END`.mapWith(
            Number,
          ),
        createdAt: rewardRuleVersions.createdAt,
      })
      .from(rewardRuleVersions)
      .where(
        and(
          eq(rewardRuleVersions.name, row.name),
          row.marketId
            ? eq(rewardRuleVersions.marketId, row.marketId)
            : isNull(rewardRuleVersions.marketId),
        ),
      )
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(50);

    return {
      ...this.mapRuleVersionListItem(row),
      versionHistory: versions.map((v) => ({
        id: v.id,
        name: v.name,
        rewardRate: String(v.rewardRate),
        effectiveFrom: v.effectiveFrom.toISOString(),
        effectiveTo: v.effectiveTo?.toISOString() ?? null,
        marketId: v.marketId,
        isArchived: Boolean(v.isArchived),
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async createRuleVersion(
    adminActor: AdminRewardActor,
    input: CreateRuleVersionDto,
  ): Promise<AdminRewardRuleVersionListItem> {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo
      ? new Date(input.effectiveTo)
      : undefined;

    const [version] = await this.database.db
      .insert(rewardRuleVersions)
      .values({
        name: input.name,
        description: input.description ?? null,
        effectiveFrom,
        effectiveTo: effectiveTo ?? null,
        rewardRate: input.rewardRate,
        capType: input.capType,
        capValue: input.capValue,
        minimumReward: input.minimumReward,
        marketId: input.marketId ?? null,
        createdBy: adminActor.adminUserId,
        archivedAt: null,
      })
      .returning();

    // Audit trail
    await this.audit.recordPrivilegedAction({
      actor: { type: 'ADMIN_USER', id: adminActor.adminUserId },
      action: 'reward.rule_version.create',
      entity: { type: 'reward_rule_version', id: version.id },
      marketId: input.marketId ?? undefined,
      after: this.sanitizeForAudit({
        name: version.name,
        rewardRate: version.rewardRate,
        capType: version.capType,
        capValue: version.capValue,
        effectiveFrom: version.effectiveFrom.toISOString(),
      }),
      reason: 'New reward rule version created',
      result: 'SUCCESS',
      requestId: adminActor.requestId,
      ipAddress: adminActor.ipAddress,
      summary: `Administrator created reward rule version "${version.name}".`,
    });

    return this.mapRuleVersionListItem(version);
  }

  async getRuleVersionHistory(
    adminActor: AdminRewardActor,
    id: string,
  ): Promise<AdminRewardVersionHistoryResponse> {
    const [row] = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.id, id))
      .limit(1);

    if (!row) throw adminRewardRuleVersionNotFoundError();

    // Load all versions with the same name scope (same name + same marketId scope)
    const versions = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(
        and(
          eq(rewardRuleVersions.name, row.name),
          row.marketId
            ? eq(rewardRuleVersions.marketId, row.marketId)
            : isNull(rewardRuleVersions.marketId),
        ),
      )
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(100);

    const total = versions.length;

    return {
      versions: versions.map((v) => ({
        id: v.id,
        name: v.name,
        rewardRate: v.rewardRate,
        effectiveFrom: v.effectiveFrom.toISOString(),
        effectiveTo: v.effectiveTo?.toISOString() ?? null,
        marketId: v.marketId,
        isArchived: v.archivedAt !== null,
        createdAt: v.createdAt.toISOString(),
      })),
      total,
    };
  }

  // ─── Job Run Monitoring ────────────────────────────────────────────

  async listJobRuns(
    adminActor: AdminRewardActor,
    query: JobListQueryDto,
  ): Promise<AdminRewardJobRunListResponse> {
    // Job runs are stored in a job_runs table or similar.
    // For Phase 3, we use a placeholder implementation that returns
    // sample data from reward rule version audit trail as a proxy.
    const conditions = and(
      query.jobType ? eq(rewardRuleVersions.name, query.jobType) : undefined,
    );

    const totalResult = await this.database.db
      .select({ total: count() })
      .from(rewardRuleVersions)
      .where(conditions);

    const total = Number(totalResult[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(conditions)
      .orderBy(desc(rewardRuleVersions.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        jobType: 'REWARD_PLAN_PROCESSING',
        status: 'COMPLETED' as const,
        startedAt: r.createdAt.toISOString(),
        completedAt: r.createdAt.toISOString(),
        processedCount: 0,
        failedCount: 0,
        errorMessage: null,
        triggeredBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getJobRunDetail(
    adminActor: AdminRewardActor,
    id: string,
  ): Promise<AdminRewardJobRunDetailResponse> {
    // Placeholder implementation — actual job run data would come from
    // a dedicated job_runs table in a future phase.
    const [row] = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.id, id))
      .limit(1);

    if (!row) throw adminRewardJobNotFoundError();

    return {
      id: row.id,
      jobType: 'REWARD_PLAN_PROCESSING',
      status: 'COMPLETED',
      startedAt: row.createdAt.toISOString(),
      completedAt: row.createdAt.toISOString(),
      processedCount: 0,
      failedCount: 0,
      errorMessage: null,
      triggeredBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      results: [],
    };
  }

  // ─── Wallet Adjustment (via Ledger) ────────────────────────────────

  async requestWalletAdjustment(
    adminActor: AdminRewardActor,
    walletId: string,
    input: WalletAdjustmentDto,
  ): Promise<AdminWalletAdjustmentResponse> {
    if (Number(input.amount) <= 0)
      throw adminRewardAdjustmentInvalidAmountError();

    return this.database.runTransaction(async (tx) => {
      // Lock the wallet account
      const [wallet] = await tx
        .select()
        .from(memberWalletAccounts)
        .where(eq(memberWalletAccounts.id, walletId))
        .for('update')
        .limit(1);

      if (!wallet) throw adminRewardWalletNotFoundError();

      // Assert market access
      await this.assertMarketAccess(
        tx,
        adminActor.adminUserId,
        wallet.marketId,
      );

      // Check idempotency
      const existingEntry = await tx
        .select()
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (existingEntry[0]) {
        return this.mapAdjustmentResponse(existingEntry[0]);
      }

      // Get next sequence number
      const maxSeqResult = await tx
        .select({
          maxSeq: sql<bigint>`COALESCE(MAX(${memberWalletEntries.entrySequence}), 0) + 1`,
        })
        .from(memberWalletEntries)
        .where(eq(memberWalletEntries.walletAccountId, walletId));

      const nextSeq = BigInt(String(maxSeqResult[0]?.maxSeq ?? 1));
      const amountNum = input.amount;
      const zero = '0';

      // ADJUSTMENT entry type: affects available balance only
      const pendingDelta = zero;
      const availableDelta = amountNum;
      const reversedDelta = zero;

      // Current balances snapshot
      const balanceBefore = wallet.availableBalance;

      // Compute new balances using SQL
      const newAvailable = sql`CAST(${memberWalletAccounts.availableBalance} AS numeric(38,10)) + CAST(${amountNum} AS numeric(38,10))`;

      // Update wallet balance with optimistic locking
      const updatedWallets = await tx
        .update(memberWalletAccounts)
        .set({
          availableBalance: newAvailable,
          version: sql`${memberWalletAccounts.version} + 1`,
          updatedAt: sql`NOW()`,
        })
        .where(
          and(
            eq(memberWalletAccounts.id, walletId),
            eq(memberWalletAccounts.version, wallet.version),
          ),
        )
        .returning();

      if (!updatedWallets[0]) {
        throw new Error('Concurrent wallet update detected. Please retry.');
      }

      const updatedWallet = updatedWallets[0];

      // Insert the immutable ledger entry
      const [entry] = await tx
        .insert(memberWalletEntries)
        .values({
          walletAccountId: walletId,
          memberId: wallet.memberId,
          marketId: wallet.marketId,
          entrySequence: nextSeq,
          entryType: 'ADJUSTMENT',
          amount: amountNum,
          balanceBefore,
          balanceAfter: updatedWallet.availableBalance,
          idempotencyKey: input.idempotencyKey,
          referenceType: 'ADMIN_ADJUSTMENT',
          referenceId: walletId,
          description: `Admin wallet adjustment: ${input.reason}`,
          reason: input.reason,
          actorId: adminActor.adminUserId,
          marketTimezone: null,
        })
        .returning();

      // Audit trail
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: adminActor.adminUserId },
        action: 'wallet.adjustment.create',
        entity: { type: 'wallet', id: walletId },
        marketId: wallet.marketId,
        before: { availableBalance: balanceBefore },
        after: { availableBalance: updatedWallet.availableBalance },
        reason: input.reason,
        result: 'SUCCESS',
        requestId: adminActor.requestId,
        ipAddress: adminActor.ipAddress,
        summary: `Admin wallet adjustment of ${amountNum} on wallet ${walletId}. Source: ${input.source}`,
      });

      // Handle compensating entry if requested (reversal via compensation)
      if (input.compensatingEntry) {
        const compensatingReason =
          input.compensatingReason ?? `Compensating entry for ${input.reason}`;

        // Compute balance before compensation (current available)
        const compBalanceBefore = updatedWallet.availableBalance;

        const compNewAvailable = sql`CAST(${memberWalletAccounts.availableBalance} AS numeric(38,10)) - CAST(${amountNum} AS numeric(38,10))`;

        const compUpdated = await tx
          .update(memberWalletAccounts)
          .set({
            availableBalance: compNewAvailable,
            version: sql`${memberWalletAccounts.version} + 1`,
            updatedAt: sql`NOW()`,
          })
          .where(
            and(
              eq(memberWalletAccounts.id, walletId),
              eq(memberWalletAccounts.version, updatedWallet.version),
            ),
          )
          .returning();

        if (compUpdated[0]) {
          const [compEntry] = await tx
            .insert(memberWalletEntries)
            .values({
              walletAccountId: walletId,
              memberId: wallet.memberId,
              marketId: wallet.marketId,
              entrySequence: nextSeq + 1n,
              entryType: 'COMPENSATION',
              amount: amountNum,
              balanceBefore: compBalanceBefore,
              balanceAfter: compUpdated[0].availableBalance,
              idempotencyKey: `${input.idempotencyKey}-comp`,
              referenceType: 'COMPENSATING_ADJUSTMENT',
              referenceId: entry.id,
              description: `Compensating entry: ${compensatingReason}`,
              reason: compensatingReason,
              actorId: adminActor.adminUserId,
              marketTimezone: null,
            })
            .returning();

          // Audit trail for compensating entry
          await this.audit.appendWithinTransaction(tx, {
            actor: { type: 'ADMIN_USER', id: adminActor.adminUserId },
            action: 'wallet.adjustment.compensate',
            entity: { type: 'wallet', id: walletId },
            marketId: wallet.marketId,
            before: { availableBalance: compBalanceBefore },
            after: { availableBalance: compUpdated[0].availableBalance },
            reason: compensatingReason,
            result: 'SUCCESS',
            requestId: adminActor.requestId,
            ipAddress: adminActor.ipAddress,
            summary: `Admin compensating entry of ${amountNum} on wallet ${walletId}. Original reason: ${input.reason}`,
          });

          return {
            ...this.mapAdjustmentResponse(entry),
            adjustmentState: 'EXECUTED',
          };
        }
      }

      return {
        ...this.mapAdjustmentResponse(entry),
        adjustmentState: 'EXECUTED',
      };
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private ruleVersionConditions(query: RuleListQueryDto) {
    return and(
      query.includeArchived ? undefined : isNull(rewardRuleVersions.archivedAt),
      query.marketId
        ? eq(rewardRuleVersions.marketId, query.marketId)
        : undefined,
    );
  }

  private async assertMarketAccess(
    db: DbExecutor,
    adminUserId: string,
    marketId: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: adminUsers.id })
      .from(marketAccess)
      .innerJoin(adminUsers, eq(adminUsers.id, marketAccess.adminUserId))
      .innerJoin(markets, eq(markets.id, marketAccess.marketId))
      .where(
        and(
          eq(marketAccess.adminUserId, adminUserId),
          eq(marketAccess.marketId, marketId),
          isNull(marketAccess.revokedAt),
          eq(adminUsers.status, 'ACTIVE'),
          eq(markets.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!rows[0]) throw adminRewardMarketAccessDeniedError();
  }

  private mapRuleVersionListItem(
    row: typeof rewardRuleVersions.$inferSelect,
  ): AdminRewardRuleVersionListItem {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      rewardRate: row.rewardRate,
      capType: row.capType,
      capValue: row.capValue,
      minimumReward: row.minimumReward,
      marketId: row.marketId,
      createdBy: row.createdBy,
      isArchived: row.archivedAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapAdjustmentResponse(
    row: typeof memberWalletEntries.$inferSelect,
  ): Omit<AdminWalletAdjustmentResponse, 'adjustmentState'> {
    return {
      walletId: row.walletAccountId,
      memberId: row.memberId,
      marketId: row.marketId,
      entryType: row.entryType,
      amount: row.amount,
      balanceBefore: row.balanceBefore,
      balanceAfter: row.balanceAfter,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      reason: row.reason,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private sanitizeForAudit(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
    );
  }
}
