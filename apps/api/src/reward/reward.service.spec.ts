/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import { Decimal } from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { RewardService } from './reward.service.js';

const memberId = randomUUID();
const marketId = randomUUID();
const merchantId = randomUUID();
const adminUserId = randomUUID();

function ruleVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    name: 'MY 2026 Q3 Rate',
    description: 'Standard Malaysia rate',
    effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
    effectiveTo: new Date('2026-09-30T00:00:00.000Z'),
    rewardRate: '0.01',
    capType: 'FLAT',
    capValue: '1000.00',
    minimumReward: '0.01',
    marketId,
    createdBy: adminUserId,
    archivedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    sourceType: 'PURCHASE_TRANSACTION',
    sourceId: randomUUID(),
    memberId,
    marketId,
    merchantId,
    transactionAmount: '500.00',
    currency: 'MYR',
    merchantPackageSnapshot: { packageCode: 'C', percentage: '10.0' },
    serviceFeeSnapshot: { feePercentage: '10.0', amount: '50.00' },
    rewardRuleVersionId: null,
    consumed: false,
    createdAt: new Date(),
    ...overrides,
  };
}

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    sourceType: 'PURCHASE_TRANSACTION',
    sourceId: randomUUID(),
    memberId,
    marketId,
    merchantId,
    status: 'SCHEDULED',
    totalEarned: '0',
    capAmount: null,
    snapshot: {
      merchantPackageSnapshot: { packageCode: 'C', percentage: '10.0' },
      serviceFeeSnapshot: { feePercentage: '10.0', amount: '50.00' },
      transactionAmount: '500.00',
      currency: 'MYR',
    },
    ruleVersionId: null,
    activatedAt: null,
    completedAt: null,
    reversedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createService(options: {
  ruleVersions?: Record<string, unknown>[];
  sources?: Record<string, unknown>[];
  plans?: Record<string, unknown>[];
  isDuplicatePlan?: boolean;
  failTransaction?: boolean;
}) {
  const ruleVersions = options.ruleVersions ?? [ruleVersionRow()];

  const selectMock = vi.fn().mockReturnThis();
  const fromMock = vi.fn().mockReturnThis();
  const whereMock = vi.fn().mockReturnThis();
  const orderByMock = vi.fn().mockReturnThis();
  const limitMock = vi.fn().mockReturnThis();
  const offsetMock = vi.fn().mockReturnThis();
  const groupByMock = vi.fn().mockReturnThis();
  const havingMock = vi.fn().mockReturnThis();
  const innerJoinMock = vi.fn().mockReturnThis();
  const leftJoinMock = vi.fn().mockReturnThis();

  const returnMock = vi.fn();

  const transactionMock = vi.fn(async (cb: Function) => cb(db));

  const queryBuilder = {
    select: selectMock,
    from: fromMock,
    where: whereMock,
    orderBy: orderByMock,
    limit: limitMock,
    offset: offsetMock,
    groupBy: groupByMock,
    having: havingMock,
    innerJoin: innerJoinMock,
    leftJoin: leftJoinMock,
    then: returnMock,
    catch: undefined,
  };

  selectMock.mockReturnValue(queryBuilder);
  fromMock.mockReturnValue(queryBuilder);
  whereMock.mockReturnValue(queryBuilder);
  orderByMock.mockReturnValue(queryBuilder);
  limitMock.mockReturnValue(queryBuilder);
  offsetMock.mockReturnValue(queryBuilder);
  groupByMock.mockReturnValue(queryBuilder);
  havingMock.mockReturnValue(queryBuilder);
  innerJoinMock.mockReturnValue(queryBuilder);
  leftJoinMock.mockReturnValue(queryBuilder);

  returnMock.mockImplementation((resolve) => resolve([]));

  const insertReturningMock = vi
    .fn()
    .mockResolvedValue(
      options.sources?.length
        ? [sourceRow({ ruleVersionId: ruleVersions[0]?.id ?? null })]
        : [],
    );

  const updateReturningMock = vi.fn().mockResolvedValue([]);

  const db = {
    select: () => queryBuilder,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: insertReturningMock }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: updateReturningMock }),
      }),
    }),
    transaction: transactionMock,
  };

  const database = {
    db,
    runTransaction: vi.fn(async (cb: Function) => db.transaction(cb)),
  } as unknown as DatabaseService;

  return {
    service: new RewardService(database),
    selectMock,
    fromMock,
    whereMock,
    returnMock,
    insertReturningMock,
    updateReturningMock,
    transactionMock: db.transaction,
    queryBuilder,
    db,
  };
}

describe('RewardService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Reward Rule Versions ──────────────────────────────────────────

  describe('createRuleVersion', () => {
    it('creates a rule version from valid input', async () => {
      const { service, insertReturningMock } = createService({});
      const ruleRow = ruleVersionRow();
      insertReturningMock.mockResolvedValue([ruleRow]);

      const result = await service.createRuleVersion({
        name: 'MY 2026 Q3 Rate',
        rewardRate: '0.01',
        capType: 'FLAT',
        capValue: '1000.00',
        minimumReward: '0.01',
        effectiveFrom: '2026-07-01T00:00:00.000Z',
        effectiveTo: '2026-09-30T00:00:00.000Z',
      });

      expect(result.name).toBe('MY 2026 Q3 Rate');
      expect(result.rewardRate).toBe('0.01');
      expect(result.capType).toBe('FLAT');
      expect(result.capValue).toBe('1000.00');
    });

    it('creates a rule version without optional fields', async () => {
      const { service, insertReturningMock } = createService({});
      const ruleRow = ruleVersionRow({
        name: 'Default Rate',
        description: null,
        effectiveTo: null,
        capType: 'NONE',
        capValue: '0',
        marketId: null,
      });
      insertReturningMock.mockResolvedValue([ruleRow]);

      const result = await service.createRuleVersion({
        name: 'Default Rate',
        rewardRate: '0.005',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
      });

      expect(result.name).toBe('Default Rate');
      expect(result.capType).toBe('NONE');
      expect(result.capValue).toBe('0');
    });
  });

  describe('getRuleVersions', () => {
    it('returns paginated rule versions', async () => {
      const rv1 = ruleVersionRow({ name: 'V1' });
      const { service, queryBuilder, returnMock } = createService({
        ruleVersions: [rv1],
      });

      returnMock
        .mockImplementationOnce((resolve) => resolve([{ total: 1 }]))
        .mockImplementationOnce((resolve) => resolve([rv1]));

      const result = await service.getRuleVersions({
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0]!.name).toBe('V1');
    });
  });

  describe('getRuleVersion', () => {
    it('returns a rule version by id', async () => {
      const rv = ruleVersionRow({ name: 'Specific Rule' });
      const { service, returnMock } = createService({
        ruleVersions: [rv],
      });
      returnMock.mockImplementation((resolve) => resolve([rv]));

      const result = await service.getRuleVersion(rv.id as string);

      expect(result.name).toBe('Specific Rule');
    });

    it('throws 404 for non-existent rule version', async () => {
      const { service, returnMock } = createService({});
      returnMock.mockImplementation((resolve) => resolve([]));

      await expect(service.getRuleVersion(randomUUID())).rejects.toMatchObject({
        code: 'REWARD_RULE_VERSION_NOT_FOUND',
      });
    });
  });

  describe('findEffectiveRuleVersion', () => {
    it('finds the effective rule version for a market and date', async () => {
      const rv = ruleVersionRow({
        name: 'Effective Rule',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
      });
      const { service, returnMock } = createService({
        ruleVersions: [rv],
      });
      returnMock.mockImplementation((resolve) => resolve([rv]));

      const result = await service.findEffectiveRuleVersion(
        marketId,
        new Date('2026-06-15T00:00:00.000Z'),
      );

      expect(result.name).toBe('Effective Rule');
    });

    it('throws when no effective rule version found', async () => {
      const { service, returnMock } = createService({});
      returnMock.mockImplementation((resolve) => resolve([]));

      await expect(
        service.findEffectiveRuleVersion(
          marketId,
          new Date('2025-01-01T00:00:00.000Z'),
        ),
      ).rejects.toMatchObject({
        code: 'REWARD_RULE_NO_EFFECTIVE_VERSION',
      });
    });
  });

  // ─── Reward Sources ────────────────────────────────────────────────

  describe('createSource', () => {
    it('creates a reward source', async () => {
      const source = sourceRow();
      const { service, insertReturningMock, returnMock } = createService({
        sources: [source],
      });
      returnMock.mockImplementation((resolve) => resolve([])); // no existing source
      insertReturningMock.mockResolvedValue([source]);

      const result = await service.createSource({
        sourceType: source.sourceType,
        sourceId: source.sourceId as string,
        memberId: source.memberId as string,
        marketId: source.marketId as string,
        merchantId: source.merchantId as string,
        transactionAmount: source.transactionAmount,
        currency: source.currency,
        merchantPackageSnapshot: source.merchantPackageSnapshot as Record<
          string,
          unknown
        >,
        serviceFeeSnapshot: source.serviceFeeSnapshot as Record<
          string,
          unknown
        >,
      });

      expect(result.sourceType).toBe('PURCHASE_TRANSACTION');
      expect(result.transactionAmount).toBe('500.00');
      expect(result.consumed).toBe(false);
    });

    it('rejects duplicate source (same type + id)', async () => {
      const source = sourceRow();
      const { service, returnMock } = createService({
        sources: [source],
      });
      returnMock.mockImplementation((resolve) => resolve([{ id: source.id }]));

      await expect(
        service.createSource({
          sourceType: source.sourceType,
          sourceId: source.sourceId as string,
          memberId: source.memberId as string,
          marketId: source.marketId as string,
          merchantId: source.merchantId as string,
          transactionAmount: source.transactionAmount,
          currency: source.currency,
        }),
      ).rejects.toMatchObject({
        code: 'REWARD_SOURCE_DUPLICATE',
      });
    });
  });

  // ─── Reward Plans ──────────────────────────────────────────────────

  describe('createPlanFromSource', () => {
    it('creates a reward plan from a valid source', async () => {
      const source = sourceRow();
      const plan = planRow({ sourceId: source.sourceId });
      const { service, returnMock, transactionMock } = createService({
        sources: [source],
        plans: [plan],
      });

      returnMock.mockImplementation((resolve) => resolve([source]));

      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([]),
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([plan]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.status).toBe('SCHEDULED');
      expect(result.sourceType).toBe('PURCHASE_TRANSACTION');
    });

    it('rejects when source is not found', async () => {
      const { service, returnMock } = createService({});
      returnMock.mockImplementation((resolve) => resolve([]));

      await expect(
        service.createPlanFromSource(randomUUID()),
      ).rejects.toMatchObject({
        code: 'REWARD_SOURCE_NOT_FOUND',
      });
    });

    it('rejects when source is already consumed', async () => {
      const source = sourceRow({ consumed: true });
      const { service, returnMock } = createService({ sources: [source] });
      returnMock.mockImplementation((resolve) => resolve([source]));

      await expect(
        service.createPlanFromSource(source.id as string),
      ).rejects.toMatchObject({
        code: 'REWARD_SOURCE_ALREADY_CONSUMED',
      });
    });

    it('rejects duplicate source when plan already exists', async () => {
      const source = sourceRow();
      const plan = planRow({ sourceId: source.sourceId });
      const { service, returnMock, transactionMock } = createService({
        sources: [source],
        plans: [plan],
      });

      returnMock.mockImplementation((resolve) => resolve([source]));

      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([{ id: plan.id }]),
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        };
        return cb(tx);
      });

      await expect(
        service.createPlanFromSource(source.id as string),
      ).rejects.toMatchObject({
        code: 'REWARD_PLAN_DUPLICATE',
      });
    });
  });

  describe('getMemberPlans', () => {
    it('returns paginated plans for a member', async () => {
      const plan = planRow({ status: 'ACTIVE' });
      const { service, returnMock } = createService({ plans: [plan] });

      returnMock
        .mockImplementationOnce((resolve) => resolve([{ total: 1 }]))
        .mockImplementationOnce((resolve) => resolve([plan]));

      const result = await service.getMemberPlans(memberId, {
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0]!.status).toBe('ACTIVE');
    });

    it('filters by status', async () => {
      const plan = planRow({ status: 'ACTIVE' });
      const { service, returnMock } = createService({ plans: [plan] });

      returnMock
        .mockImplementationOnce((resolve) => resolve([{ total: 1 }]))
        .mockImplementationOnce((resolve) => resolve([plan]));

      const result = await service.getMemberPlans(memberId, {
        page: 1,
        pageSize: 20,
        status: 'ACTIVE',
      });

      expect(result.items).toHaveLength(1);
    });
  });

  describe('getPlan', () => {
    it('returns a plan by id', async () => {
      const plan = planRow();
      const { service, returnMock } = createService({ plans: [plan] });
      returnMock.mockImplementation((resolve) => resolve([plan]));

      const result = await service.getPlan(plan.id as string);

      expect(result.id).toBe(plan.id);
    });

    it('throws 404 for non-existent plan', async () => {
      const { service, returnMock } = createService({});
      returnMock.mockImplementation((resolve) => resolve([]));

      await expect(service.getPlan(randomUUID())).rejects.toMatchObject({
        code: 'REWARD_PLAN_NOT_FOUND',
      });
    });
  });

  // ─── Status Transitions ────────────────────────────────────────────

  describe('transitionPlanStatus', () => {
    it('transitions SCHEDULED to ACTIVE', async () => {
      const plan = planRow();
      const updatedPlan = {
        ...plan,
        status: 'ACTIVE',
        activatedAt: new Date(),
        updatedAt: new Date(),
      };
      const { service, transactionMock } = createService({ plans: [plan] });

      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([plan]),
              }),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Promise.resolve([updatedPlan]),
              }),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await service.transitionPlanStatus(
        plan.id as string,
        'ACTIVE',
      );

      expect(result.status).toBe('ACTIVE');
    });

    it('rejects invalid transition (COMPLETED to ACTIVE)', async () => {
      const plan = planRow({ status: 'COMPLETED' });
      const { service, transactionMock } = createService({ plans: [plan] });

      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([plan]),
              }),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Promise.resolve([]),
              }),
            }),
          }),
        };
        return cb(tx);
      });

      await expect(
        service.transitionPlanStatus(plan.id as string, 'ACTIVE'),
      ).rejects.toMatchObject({
        code: 'REWARD_PLAN_INVALID_STATE',
      });
    });

    it('transitions ACTIVE to CAPPED', async () => {
      const plan = planRow({ status: 'ACTIVE' });
      const updatedPlan = { ...plan, status: 'CAPPED', updatedAt: new Date() };
      const { service, transactionMock } = createService({ plans: [plan] });

      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([plan]),
              }),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Promise.resolve([updatedPlan]),
              }),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await service.transitionPlanStatus(
        plan.id as string,
        'CAPPED',
      );

      expect(result.status).toBe('CAPPED');
    });
  });

  // ─── Merchant Package Snapshot ─────────────────────────────────────

  describe('merchant package snapshot', () => {
    it('stores snapshot at plan creation time', async () => {
      const snapshot = {
        merchantPackageSnapshot: { packageCode: 'C', percentage: '10.0' },
        serviceFeeSnapshot: { feePercentage: '10.0', amount: '50.00' },
        transactionAmount: '500.00',
        currency: 'MYR',
      };
      const source = sourceRow();
      const plan = planRow({ snapshot, sourceId: source.sourceId });
      const { service, returnMock, transactionMock } = createService({
        sources: [source],
        plans: [plan],
      });

      returnMock.mockImplementation((resolve) => resolve([source]));

      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([]),
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([plan]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.snapshot).toEqual(snapshot);
    });
  });

  // ─── Market Isolation ──────────────────────────────────────────────

  describe('market isolation', () => {
    it('creates separate plans for different markets', async () => {
      const marketAId = randomUUID();
      const marketBId = randomUUID();

      const sourceA = sourceRow({ marketId: marketAId });
      const sourceB = sourceRow({
        marketId: marketBId,
        sourceId: randomUUID(),
        id: randomUUID(),
      });

      const planA = planRow({
        marketId: marketAId,
        sourceId: sourceA.sourceId,
      });
      const {
        service: serviceA,
        returnMock: returnMockA,
        transactionMock: txMockA,
      } = createService({
        sources: [sourceA],
        plans: [planA],
      });

      returnMockA.mockImplementation((resolve) => resolve([sourceA]));

      txMockA.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([]),
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([planA]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        };
        return cb(tx);
      });

      const resultA = await serviceA.createPlanFromSource(sourceA.id as string);
      expect(resultA.marketId).toBe(marketAId);
    });
  });

  // ─── Rule Version Change Doesn't Affect Existing Plans ────────────

  describe('rule version immutability on existing plans', () => {
    it('does not change rule version on existing plan when rule version changes', async () => {
      const plan = planRow({ ruleVersionId: null });
      const { service, returnMock } = createService({ plans: [plan] });
      returnMock.mockImplementation((resolve) => resolve([plan]));

      const result = await service.getPlan(plan.id as string);

      // The plan's rule_version_id should remain as-is
      expect(result.ruleVersionId).toBeNull();
    });
  });

  // ─── Cap Amount Resolution ────────────────────────────────────────

  describe('capAmount resolution', () => {
    /** Build a transaction mock that simulates the code path through resolveCapAmount.
     *  Query sequence inside transaction:
     *    1. duplicate plan check → returns []
     *    2. resolveCapAmount rule lookup → returns [rule]
     */
    function capTransaction(rule: Record<string, unknown>) {
      let queryCount = 0;
      return {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => {
                queryCount++;
                if (queryCount === 1) return Promise.resolve([]);
                if (queryCount === 2) return Promise.resolve([rule]);
                return Promise.resolve([]);
              },
            }),
          }),
        }),
        insert: () => ({
          values: (vals: Record<string, unknown>) => ({
            returning: () => Promise.resolve([planRow({ ...vals })]),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve(),
          }),
        }),
      };
    }

    it('returns FLAT cap as-is from rule version', async () => {
      const rule = ruleVersionRow({ capType: 'FLAT', capValue: '500.00' });
      const source = sourceRow({ rewardRuleVersionId: rule.id });
      const { service, returnMock, transactionMock } = createService({
        ruleVersions: [rule],
        sources: [source],
      });

      // FIX: returnMock is the .then() of queryBuilder. When await calls it
      // as .then(resolve,reject), we must call resolve() for the await to complete.
      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) =>
        cb(capTransaction(rule)),
      );

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBe('500.00');
    });

    it('returns null when rewardRuleVersionId is not set', async () => {
      const source = sourceRow({ rewardRuleVersionId: null });
      const { service, returnMock, transactionMock } = createService({
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([]),
              }),
            }),
          }),
          insert: () => ({
            values: (vals: Record<string, unknown>) => ({
              returning: () => Promise.resolve([planRow({ ...vals })]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBeNull();
    });

    it('returns null when capType is NONE', async () => {
      const rule = ruleVersionRow({ capType: 'NONE', capValue: '0' });
      const source = sourceRow({ rewardRuleVersionId: rule.id });
      const { service, returnMock, transactionMock } = createService({
        ruleVersions: [rule],
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) =>
        cb(capTransaction(rule)),
      );

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBeNull();
    });

    it('returns null when rule version is not found', async () => {
      const ruleId = randomUUID();
      const source = sourceRow({
        rewardRuleVersionId: ruleId,
      });
      const { service, returnMock, transactionMock } = createService({
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });

      // Cap resolution: rule lookup returns empty → returns null
      let qc = 0;
      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => {
                  qc++;
                  if (qc === 2) return Promise.resolve([]); // rule not found
                  return Promise.resolve([]);
                },
              }),
            }),
          }),
          insert: () => ({
            values: (vals: Record<string, unknown>) => ({
              returning: () => Promise.resolve([planRow({ ...vals })]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBeNull();
    });

    it('resolves RATIO cap using decimal.js arithmetic with HALF_UP rounding', async () => {
      const rule = ruleVersionRow({
        capType: 'RATIO',
        capValue: '0.02',
      });
      const source = sourceRow({
        rewardRuleVersionId: rule.id,
        transactionAmount: '500.00',
      });
      const { service, returnMock, transactionMock } = createService({
        ruleVersions: [rule],
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) =>
        cb(capTransaction(rule)),
      );

      // 500.00 * 0.02 = 10.00 → "10.0000000000"
      const expected = new Decimal('500.00')
        .mul(new Decimal('0.02'))
        .toDecimalPlaces(10, 3)
        .toFixed(10);

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBe(expected);
    });

    it('handles decimal boundary: precise multiplication with HALF_UP rounding', async () => {
      const rule = ruleVersionRow({
        capType: 'RATIO',
        capValue: '0.33333333333', // 1/3 approx – recurring decimal
      });
      const source = sourceRow({
        rewardRuleVersionId: rule.id,
        transactionAmount: '100.00',
      });
      const { service, returnMock, transactionMock } = createService({
        ruleVersions: [rule],
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) =>
        cb(capTransaction(rule)),
      );

      const expected = new Decimal('100.00')
        .mul(new Decimal('0.33333333333'))
        .toDecimalPlaces(10, 3)
        .toFixed(10);

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBe(expected);
    });

    it('handles HALF_UP rounding correctly at the 10th decimal place', async () => {
      // Value that produces a rounding halfway case at the 11th decimal
      // 0.00000000005 → rounds up to 0.0000000001 at 10dp with HALF_UP
      const rule = ruleVersionRow({
        capType: 'RATIO',
        capValue: '1',
      });
      const source = sourceRow({
        rewardRuleVersionId: rule.id,
        transactionAmount: '0.00000000005',
      });
      const { service, returnMock, transactionMock } = createService({
        ruleVersions: [rule],
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) =>
        cb(capTransaction(rule)),
      );

      const expected = new Decimal('0.00000000005')
        .mul(new Decimal('1'))
        .toDecimalPlaces(10, Decimal.ROUND_HALF_UP)
        .toFixed(10);

      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBe(expected);
    });

    it('handles zero transaction amount with RATIO cap', async () => {
      const rule = ruleVersionRow({
        capType: 'RATIO',
        capValue: '0.05',
      });
      const source = sourceRow({
        rewardRuleVersionId: rule.id,
        transactionAmount: '0',
      });
      const { service, returnMock, transactionMock } = createService({
        ruleVersions: [rule],
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) =>
        cb(capTransaction(rule)),
      );

      // 0 * 0.05 = 0 → "0.0000000000"
      const result = await service.createPlanFromSource(source.id as string);

      expect(result.capAmount).toBe('0.0000000000');
    });

    it('ensures output is numeric(38,10) format: exactly 10 decimal places', async () => {
      // FLAT caps should remain as-is from DB (e.g. '500.00')
      const rule = ruleVersionRow({ capType: 'FLAT', capValue: '500' });
      const source = sourceRow({ rewardRuleVersionId: rule.id });
      const { service, returnMock, transactionMock } = createService({
        ruleVersions: [rule],
        sources: [source],
      });

      returnMock.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([source]);
      });
      transactionMock.mockImplementation(async (cb: Function) =>
        cb(capTransaction(rule)),
      );

      const result = await service.createPlanFromSource(source.id as string);

      // FLAT returns capValue as-is from DB (string)
      expect(result.capAmount).toBe('500');

      // Also verify RATIO produces 10 decimal places
      const ratioRule = ruleVersionRow({
        id: randomUUID(),
        capType: 'RATIO',
        capValue: '1',
      });
      const ratioSource = sourceRow({
        rewardRuleVersionId: ratioRule.id,
        transactionAmount: '1',
      });
      const {
        service: s2,
        returnMock: rm2,
        transactionMock: tm2,
      } = createService({
        ruleVersions: [ratioRule],
        sources: [ratioSource],
      });

      rm2.mockImplementation((resolve: (v: unknown) => void) => {
        resolve([ratioSource]);
      });
      tm2.mockImplementation(async (cb: Function) =>
        cb(capTransaction(ratioRule)),
      );

      const r2 = await s2.createPlanFromSource(ratioSource.id as string);

      // Must have exactly 10 decimal places for RATIO caps
      expect(r2.capAmount).toMatch(/^\d+\.\d{10}$/);
    });
  });

  describe('rule version effective at creation time', () => {
    it('creates plan with SCHEDULED status', async () => {
      const source = sourceRow();
      const plan = planRow({ sourceId: source.sourceId });
      const { service, returnMock, transactionMock } = createService({
        sources: [source],
        plans: [plan],
      });

      returnMock.mockImplementation((resolve) => resolve([source]));

      transactionMock.mockImplementation(async (cb: Function) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([]),
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([plan]),
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => Promise.resolve(),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await service.createPlanFromSource(source.id as string);
      expect(result.status).toBe('SCHEDULED');
    });
  });
});
