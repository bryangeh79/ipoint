import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import {
  rewardPlans,
  rewardRuleVersions,
  rewardSources,
  type Database,
} from '@ipoint/database';
import { DatabaseService } from '../database/database.service.js';
import type {
  CreateRuleVersionDto,
  PlanListQueryDto,
  RuleListQueryDto,
} from './reward.dto.js';
import {
  rewardPlanDuplicateError,
  rewardPlanInvalidStateError,
  rewardPlanNotFoundError,
  rewardRuleNoEffectiveVersionError,
  rewardRuleVersionNotFoundError,
  rewardSourceAlreadyConsumedError,
  rewardSourceDuplicateError,
  rewardSourceNotFoundError,
} from './reward.errors.js';
import type {
  PaginatedResponse,
  RewardPlanResponse,
  RewardRuleVersionResponse,
  RewardSourceResponse,
} from './reward.types.js';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const VALID_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ['ACTIVE', 'REVERSED'],
  ACTIVE: ['CAPPED', 'SUSPENDED', 'REVERSED', 'COMPLETED'],
  CAPPED: ['ACTIVE', 'COMPLETED', 'REVERSED'],
  SUSPENDED: ['ACTIVE', 'REVERSED'],
  REVERSED: [],
  COMPLETED: [],
};

@Injectable()
export class RewardService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // ─── Reward Rule Versions ──────────────────────────────────────────

  async createRuleVersion(
    input: CreateRuleVersionDto,
  ): Promise<RewardRuleVersionResponse> {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveTo = input.effectiveTo
      ? new Date(input.effectiveTo)
      : undefined;

    if (Number.isNaN(effectiveFrom.getTime())) {
      throw rewardRuleVersionNotFoundError();
    }

    const [version] = await this.database.db
      .insert(rewardRuleVersions)
      .values({
        name: input.name,
        description: input.description ?? null,
        effectiveFrom: effectiveFrom,
        effectiveTo: effectiveTo ?? null,
        rewardRate: input.rewardRate,
        capType: input.capType,
        capValue: input.capValue,
        minimumReward: input.minimumReward,
        marketId: input.marketId ?? null,
        createdBy: input.createdBy ?? '00000000-0000-0000-0000-000000000000',
        archivedAt: null,
      })
      .returning();

    return this.mapRuleVersion(version);
  }

  async getRuleVersions(
    query: RuleListQueryDto,
  ): Promise<PaginatedResponse<RewardRuleVersionResponse>> {
    const conditions = and(
      isNull(rewardRuleVersions.archivedAt),
      query.marketId
        ? eq(rewardRuleVersions.marketId, query.marketId)
        : undefined,
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
      items: rows.map((r) => this.mapRuleVersion(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getRuleVersion(id: string): Promise<RewardRuleVersionResponse> {
    const [row] = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(
        and(
          eq(rewardRuleVersions.id, id),
          isNull(rewardRuleVersions.archivedAt),
        ),
      )
      .limit(1);

    if (!row) throw rewardRuleVersionNotFoundError();
    return this.mapRuleVersion(row);
  }

  async findEffectiveRuleVersion(
    marketId: string,
    effectiveDate: Date,
  ): Promise<RewardRuleVersionResponse> {
    const rows = await this.database.db
      .select()
      .from(rewardRuleVersions)
      .where(
        and(
          isNull(rewardRuleVersions.archivedAt),
          lte(rewardRuleVersions.effectiveFrom, effectiveDate),
          sql`(${rewardRuleVersions.effectiveTo} is null or ${rewardRuleVersions.effectiveTo} > ${effectiveDate})`,
          sql`(${rewardRuleVersions.marketId} is null or ${rewardRuleVersions.marketId} = ${marketId})`,
        ),
      )
      .orderBy(desc(rewardRuleVersions.effectiveFrom))
      .limit(1);

    if (!rows[0]) throw rewardRuleNoEffectiveVersionError(marketId);
    return this.mapRuleVersion(rows[0]);
  }

  // ─── Reward Plans ──────────────────────────────────────────────────

  async createPlanFromSource(sourceId: string): Promise<RewardPlanResponse> {
    const [source] = await this.database.db
      .select()
      .from(rewardSources)
      .where(eq(rewardSources.id, sourceId))
      .limit(1);

    if (!source) throw rewardSourceNotFoundError();
    if (source.consumed) throw rewardSourceAlreadyConsumedError();

    return this.database.runTransaction(async (tx) => {
      const existingPlan = await tx
        .select({ id: rewardPlans.id })
        .from(rewardPlans)
        .where(
          and(
            eq(rewardPlans.sourceType, source.sourceType),
            eq(rewardPlans.sourceId, source.sourceId),
            eq(rewardPlans.memberId, source.memberId),
            eq(rewardPlans.marketId, source.marketId),
          ),
        )
        .limit(1);

      if (existingPlan[0]) throw rewardPlanDuplicateError();

      const [plan] = await tx
        .insert(rewardPlans)
        .values({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          memberId: source.memberId,
          marketId: source.marketId,
          merchantId: source.merchantId,
          status: 'SCHEDULED',
          totalEarned: '0',
          capAmount: source.rewardRuleVersionId
            ? null
            : await this.resolveCapAmount(tx, source),
          snapshot: {
            merchantPackageSnapshot: source.merchantPackageSnapshot,
            serviceFeeSnapshot: source.serviceFeeSnapshot,
            transactionAmount: source.transactionAmount,
            currency: source.currency,
          },
          ruleVersionId: null,
        })
        .returning();

      await tx
        .update(rewardSources)
        .set({ consumed: true })
        .where(eq(rewardSources.id, sourceId));

      return this.mapPlan(plan);
    });
  }

  async getMemberPlans(
    memberId: string,
    query: PlanListQueryDto,
  ): Promise<PaginatedResponse<RewardPlanResponse>> {
    const conditions = and(
      eq(rewardPlans.memberId, memberId),
      query.status ? eq(rewardPlans.status, query.status) : undefined,
      query.marketId ? eq(rewardPlans.marketId, query.marketId) : undefined,
    );

    const totalResult = await this.database.db
      .select({ total: count() })
      .from(rewardPlans)
      .where(conditions);

    const total = Number(totalResult[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.database.db
      .select()
      .from(rewardPlans)
      .where(conditions)
      .orderBy(desc(rewardPlans.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    return {
      items: rows.map((r) => this.mapPlan(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getPlan(id: string): Promise<RewardPlanResponse> {
    const [row] = await this.database.db
      .select()
      .from(rewardPlans)
      .where(eq(rewardPlans.id, id))
      .limit(1);

    if (!row) throw rewardPlanNotFoundError();
    return this.mapPlan(row);
  }

  async transitionPlanStatus(
    id: string,
    newStatus: string,
  ): Promise<RewardPlanResponse> {
    return this.database.runTransaction(async (tx) => {
      const [plan] = await tx
        .select()
        .from(rewardPlans)
        .where(eq(rewardPlans.id, id))
        .limit(1);

      if (!plan) throw rewardPlanNotFoundError();

      const allowedTransitions = VALID_TRANSITIONS[plan.status];
      if (!allowedTransitions?.includes(newStatus)) {
        throw rewardPlanInvalidStateError(plan.status, newStatus);
      }

      const updateData: Record<string, unknown> = {
        status: newStatus,
        updatedAt: new Date(),
      };

      if (newStatus === 'ACTIVE') {
        updateData.activatedAt = new Date();
      }
      if (newStatus === 'COMPLETED') {
        updateData.completedAt = new Date();
      }
      if (newStatus === 'REVERSED') {
        updateData.reversedAt = new Date();
      }

      const [updated] = await tx
        .update(rewardPlans)
        .set(updateData)
        .where(eq(rewardPlans.id, id))
        .returning();

      return this.mapPlan(updated);
    });
  }

  // ─── Reward Sources ────────────────────────────────────────────────

  async createSource(source: {
    sourceType: string;
    sourceId: string;
    memberId: string;
    marketId: string;
    merchantId: string;
    transactionAmount: string;
    currency: string;
    merchantPackageSnapshot?: Record<string, unknown>;
    serviceFeeSnapshot?: Record<string, unknown>;
    rewardRuleVersionId?: string | null;
  }): Promise<RewardSourceResponse> {
    const existing = await this.database.db
      .select({ id: rewardSources.id })
      .from(rewardSources)
      .where(
        and(
          eq(rewardSources.sourceType, source.sourceType),
          eq(rewardSources.sourceId, source.sourceId),
        ),
      )
      .limit(1);

    if (existing[0]) throw rewardSourceDuplicateError();

    const [row] = await this.database.db
      .insert(rewardSources)
      .values({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        memberId: source.memberId,
        marketId: source.marketId,
        merchantId: source.merchantId,
        transactionAmount: source.transactionAmount,
        currency: source.currency,
        merchantPackageSnapshot: source.merchantPackageSnapshot ?? null,
        serviceFeeSnapshot: source.serviceFeeSnapshot ?? null,
        rewardRuleVersionId: source.rewardRuleVersionId ?? null,
        consumed: false,
      })
      .returning();

    return this.mapSource(row);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async resolveCapAmount(
    tx: DbTransaction,
    source: typeof rewardSources.$inferSelect,
  ): Promise<string | null> {
    if (!source.rewardRuleVersionId) return null;

    const [rule] = await tx
      .select()
      .from(rewardRuleVersions)
      .where(eq(rewardRuleVersions.id, source.rewardRuleVersionId))
      .limit(1);

    if (!rule || rule.capType === 'NONE') return null;

    if (rule.capType === 'FLAT') return rule.capValue;

    if (rule.capType === 'RATIO') {
      const transactionAmount = Number(source.transactionAmount);
      const capRatio = Number(rule.capValue);
      return String(transactionAmount * capRatio);
    }

    return null;
  }

  private mapRuleVersion(
    row: typeof rewardRuleVersions.$inferSelect,
  ): RewardRuleVersionResponse {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
      rewardRate: row.rewardRate,
      capType: row.capType as RewardRuleVersionResponse['capType'],
      capValue: row.capValue,
      minimumReward: row.minimumReward,
      marketId: row.marketId,
      createdBy: row.createdBy,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapPlan(row: typeof rewardPlans.$inferSelect): RewardPlanResponse {
    return {
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      memberId: row.memberId,
      marketId: row.marketId,
      merchantId: row.merchantId,
      status: row.status as RewardPlanResponse['status'],
      totalEarned: row.totalEarned,
      capAmount: row.capAmount,
      snapshot: row.snapshot as Record<string, unknown> | null,
      ruleVersionId: row.ruleVersionId,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapSource(
    row: typeof rewardSources.$inferSelect,
  ): RewardSourceResponse {
    return {
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      memberId: row.memberId,
      marketId: row.marketId,
      merchantId: row.merchantId,
      transactionAmount: row.transactionAmount,
      currency: row.currency,
      merchantPackageSnapshot: row.merchantPackageSnapshot as Record<
        string,
        unknown
      > | null,
      serviceFeeSnapshot: row.serviceFeeSnapshot as Record<
        string,
        unknown
      > | null,
      rewardRuleVersionId: row.rewardRuleVersionId,
      consumed: row.consumed,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
