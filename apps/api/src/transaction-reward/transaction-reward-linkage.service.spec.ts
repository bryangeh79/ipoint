import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import {
  TransactionRewardLinkageService,
  type TransactionSnapshotInput,
} from './transaction-reward-linkage.service.js';

// ── Mock helpers ──────────────────────────────────────────────────

function createMockDbWithTx(transactionFn: (tx: unknown) => Promise<unknown>) {
  // The transaction callback passed to db.transaction receives the tx object
  const tx = createMockTx();
  const mockDb = {
    transaction: vi
      .fn()
      .mockImplementation(
        (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
      ),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
        onConflictDoUpdate: () => ({
          set: vi.fn().mockResolvedValue([{ id: 'mock-wallet-id' }]),
        }),
        onConflictDoNothing: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: vi.fn().mockResolvedValue([{ id: 'updated-id' }]),
        }),
      }),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    // The mock tx is the same object, so methods work both on db and tx
    ...tx,
  };
  return { db: mockDb, pool: { end: vi.fn() }, tx };
}

function createMockTx() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'new-id' }]),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  };
}

function createService(
  overrides?: Partial<ReturnType<typeof createMockDbWithTx>>,
) {
  const mock = createMockDbWithTx(async () => {});
  const dbService = {
    db: overrides?.db ?? mock.db,
    pool: overrides?.pool ?? mock.pool,
    runTransaction: vi.fn(),
    onApplicationShutdown: vi.fn(),
  } as unknown as DatabaseService;
  const auditService = {
    recordPrivilegedAction: vi.fn().mockResolvedValue(undefined),
    appendWithinTransaction: vi.fn().mockResolvedValue(undefined),
    queryEntity: vi.fn(),
  } as unknown as AuditService;
  return {
    service: new TransactionRewardLinkageService(dbService, auditService),
    db: dbService,
    audit: auditService,
  };
}

function makeTransactionInput(
  overrides?: Partial<TransactionSnapshotInput>,
): TransactionSnapshotInput {
  return {
    transactionId: '550e8400-e29b-41d4-a716-446655440000',
    memberId: '660e8400-e29b-41d4-a716-446655440001',
    consumptionMarketId: '770e8400-e29b-41d4-a716-446655440002',
    merchantBranchId: '880e8400-e29b-41d4-a716-446655440003',
    amount: '100.00',
    currency: 'VND',
    transactionTime: new Date('2026-07-22T08:00:00.000Z'),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('TransactionRewardLinkageService', () => {
  describe('createRewardEntitlement', () => {
    it('creates a reward entitlement from a transaction input', async () => {
      const { service, db } = createService();
      const tx = createMockTx();

      // Mock: no existing source
      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValue([]);

      // Mock: merchant package lookup returns a service-fee package
      const mockPackage = {
        rows: [
          {
            assignment_id: 'assign-1',
            service_fee_version_id: 'v-1',
            special_percentage_id: null,
            service_fee_profile_id: 'pkg-1',
            package_code: 'BASIC',
            package_name: 'Basic Package',
            version_rate: '2.500000',
            special_rate: null,
          },
        ],
      };
      vi.mocked(tx.execute).mockResolvedValue(mockPackage);

      // Mock: reward rule version lookup
      const mockRule = {
        id: 'rule-1',
        rewardRate: '5.0000000000',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
      };
      // First call to execute (merchant package), second call uses select chain
      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      // Override where to chain orderBy
      const whereChain = {
        orderBy: vi.fn().mockResolvedValue([mockRule]),
      };
      vi.mocked(tx.where).mockReturnValue(whereChain as never);

      // Mock: insert returning IDs
      vi.mocked(tx.insert).mockReturnThis();
      vi.mocked(tx.values).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'plan-1' }]);
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'source-1' }]);

      // Wallet entry: onConflictDoUpdate returns id
      vi.mocked(tx.onConflictDoUpdate).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([
        { id: 'wallet-1' },
      ]);

      // Sequence query
      vi.mocked(tx.execute).mockResolvedValueOnce({
        rows: [{ max_seq: null }],
      });

      const input = makeTransactionInput();
      const result = await service.createRewardEntitlement(input);

      expect(result.isNew).toBe(true);
      expect(result.sourceId).toBe('source-1');
      expect(result.planId).toBe('plan-1');
      expect(result.rewardRuleVersionId).toBe('rule-1');
      // 100 * 5 / 100 = 5.00
      expect(result.rewardAmount).toBe('5.00');
      expect(result.merchantPackageId).toBe('pkg-1');
      expect(result.merchantPackageName).toBe('Basic Package');
      expect(result.merchantPackageRate).toBe('2.500000');
      expect(result.serviceFeeRate).toBe('2.500000');
    });

    it('returns existing entitlement on duplicate transaction ID (idempotent)', async () => {
      const { service, db } = createService();
      const tx = createMockTx();

      // Mock: existing source found
      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValueOnce([
        {
          id: 'existing-source',
          sourceId: '550e8400-e29b-41d4-a716-446655440000',
          memberId: '660e8400-e29b-41d4-a716-446655440001',
          marketId: '770e8400-e29b-41d4-a716-446655440002',
          transactionAmount: '100.0000000000',
          currency: 'VND',
          merchantPackageSnapshot: {
            package_id: 'pkg-1',
            name: 'Basic Package',
            rate: '2.500000',
          },
          serviceFeeSnapshot: { rate: '2.500000' },
          rewardRuleVersionId: 'rule-1',
          consumed: true,
        },
      ]);

      // Second select for plan lookup
      vi.mocked(tx.limit).mockResolvedValueOnce([
        { id: 'existing-plan' },
      ]);

      const input = makeTransactionInput();
      const result = await service.createRewardEntitlement(input);

      expect(result.isNew).toBe(false);
      expect(result.sourceId).toBe('existing-source');
      expect(result.planId).toBe('existing-plan');
      expect(result.rewardRuleVersionId).toBe('rule-1');
      expect(result.merchantPackageId).toBe('pkg-1');
      expect(result.serviceFeeRate).toBe('2.500000');
    });

    it('handles missing merchant package (no active assignment)', async () => {
      const { service, db } = createService();
      const tx = createMockTx();

      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValue([]);

      // No merchant package found
      vi.mocked(tx.execute).mockResolvedValue({ rows: [] });

      // No rule version found either
      const whereChain = {
        orderBy: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(tx.where).mockReturnValue(whereChain as never);

      vi.mocked(tx.insert).mockReturnThis();
      vi.mocked(tx.values).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'plan-2' }]);
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'source-2' }]);

      const input = makeTransactionInput();
      const result = await service.createRewardEntitlement(input);

      expect(result.isNew).toBe(true);
      expect(result.merchantPackageId).toBeNull();
      expect(result.merchantPackageName).toBeNull();
      expect(result.merchantPackageRate).toBeNull();
      expect(result.serviceFeeRate).toBeNull();
      expect(result.rewardRuleVersionId).toBeNull();
      expect(result.rewardAmount).toBeNull();
    });

    it('preserves historical merchant package snapshot after package change', async () => {
      const { service, db } = createService();
      const tx = createMockTx();

      // First call: existing source NOT found
      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValue([]);

      // Merchant package at transaction time (rate 2.5%)
      vi.mocked(tx.execute).mockResolvedValue({
        rows: [
          {
            assignment_id: 'assign-old',
            service_fee_version_id: 'v-old',
            special_percentage_id: null,
            service_fee_profile_id: 'pkg-old',
            package_code: 'OLD',
            package_name: 'Old Package',
            version_rate: '2.500000',
            special_rate: null,
          },
        ],
      });

      // Rule version
      const whereChain = {
        orderBy: vi
          .fn()
          .mockResolvedValue([
            { id: 'rule-1', rewardRate: '5.0000000000', capType: 'NONE', capValue: '0', minimumReward: '0' },
          ]),
      };
      vi.mocked(tx.where).mockReturnValue(whereChain as never);

      vi.mocked(tx.insert).mockReturnThis();
      vi.mocked(tx.values).mockReturnThis();
      // plan + source + wallet sequence query + wallet insert
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'plan-hist' }]);
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'source-hist' }]);
      vi.mocked(tx.execute).mockResolvedValueOnce({
        rows: [{ max_seq: null }],
      });
      vi.mocked(tx.onConflictDoUpdate).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([
        { id: 'wallet-hist' },
      ]);

      // Simulate: merchant changes package after transaction
      // (should NOT affect the snapshot already created)
      const input = makeTransactionInput();
      const result = await service.createRewardEntitlement(input);

      expect(result.merchantPackageName).toBe('Old Package');
      expect(result.merchantPackageRate).toBe('2.500000');
      expect(result.isNew).toBe(true);
    });

    it('uses the reward rule version effective at transaction time', async () => {
      const { service } = createService();
      const tx = createMockTx();

      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValue([]);

      // No merchant package
      vi.mocked(tx.execute).mockResolvedValue({ rows: [] });

      // Old rule version (should be used because it was effective at transaction time)
      const oldRule = {
        id: 'rule-old-v1',
        rewardRate: '3.0000000000',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
      };
      const whereChain = {
        orderBy: vi.fn().mockResolvedValue([oldRule]),
      };
      vi.mocked(tx.where).mockReturnValue(whereChain as never);

      // Mock inserts
      vi.mocked(tx.insert).mockReturnThis();
      vi.mocked(tx.values).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'plan-v1' }]);
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'source-v1' }]);
      vi.mocked(tx.execute).mockResolvedValueOnce({ rows: [{ max_seq: null }] });
      vi.mocked(tx.onConflictDoUpdate).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'wallet-v1' }]);

      const input = makeTransactionInput();
      const result = await service.createRewardEntitlement(input);

      expect(result.rewardRuleVersionId).toBe('rule-old-v1');
      // 100 * 3 / 100 = 3.00
      expect(result.rewardAmount).toBe('3.00');
    });

    it('handles cross-market: Malaysia member spending in Vietnam', async () => {
      const { service } = createService();
      const tx = createMockTx();

      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValue([]);

      // Merchant package in Vietnam market
      vi.mocked(tx.execute).mockResolvedValue({
        rows: [
          {
            assignment_id: 'assign-vn',
            service_fee_version_id: 'v-vn-1',
            special_percentage_id: null,
            service_fee_profile_id: 'pkg-vn',
            package_code: 'VN_STANDARD',
            package_name: 'Vietnam Standard',
            version_rate: '1.500000',
            special_rate: null,
          },
        ],
      });

      // Vietnam market rule version
      const vnRule = {
        id: 'rule-vn',
        rewardRate: '2.5000000000',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
      };
      const whereChain = {
        orderBy: vi.fn().mockResolvedValue([vnRule]),
      };
      vi.mocked(tx.where).mockReturnValue(whereChain as never);

      vi.mocked(tx.insert).mockReturnThis();
      vi.mocked(tx.values).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'plan-cross' }]);
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'source-cross' }]);
      vi.mocked(tx.execute).mockResolvedValueOnce({ rows: [{ max_seq: null }] });
      vi.mocked(tx.onConflictDoUpdate).mockReturnThis();
      vi.mocked(tx.returning).mockResolvedValueOnce([{ id: 'wallet-cross' }]);

      // Malaysia (MY) member spending in Vietnam (VND) market
      const input = makeTransactionInput({
        memberId: 'malaysia-member-001',
        consumptionMarketId: 'vietnam-market-001', // Vietnam consumption market
        merchantBranchId: 'vn-branch-001',
        amount: '500000.00', // 500,000 VND
        currency: 'VND',
      });

      const result = await service.createRewardEntitlement(input);

      expect(result.isNew).toBe(true);
      expect(result.rewardRuleVersionId).toBe('rule-vn');
      expect(result.merchantPackageName).toBe('Vietnam Standard');
      // Reward goes to Vietnam wallet (consumption market)
      // 500000 * 2.5 / 100 = 12500.00 VND
      expect(result.rewardAmount).toBe('12500.00');
    });
  });

  describe('getSourceByTransaction', () => {
    it('returns the reward source for a known transaction', async () => {
      const { service, db } = createService();
      const mockSource = {
        id: 'source-1',
        sourceType: 'TRANSACTION',
        sourceId: '550e8400-e29b-41d4-a716-446655440000',
        memberId: 'member-1',
        marketId: 'market-1',
        merchantId: 'merchant-1',
        transactionAmount: '100.0000000000',
        currency: 'VND',
        merchantPackageSnapshot: {
          package_name: 'Basic Package',
          rate: '2.500000',
        },
        serviceFeeSnapshot: { rate: '2.500000' },
        rewardRuleVersionId: 'rule-1',
        consumed: true,
        createdAt: new Date(),
      };

      // Mock the select chain
      db.db.select = vi.fn().mockReturnThis();
      (db.db as Record<string, unknown>).from = vi.fn().mockReturnThis();
      (db.db as Record<string, unknown>).where = vi.fn().mockReturnThis();
      (db.db as Record<string, unknown>).limit = vi
        .fn()
        .mockResolvedValue([mockSource]);

      const result = await service.getSourceByTransaction(
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(result).toBeDefined();
      expect(result.sourceType).toBe('TRANSACTION');
      expect(result.transactionAmount).toBe('100.0000000000');
      expect(result.currency).toBe('VND');
    });

    it('throws when transaction has no reward source', async () => {
      const { service, db } = createService();

      db.db.select = vi.fn().mockReturnThis();
      (db.db as Record<string, unknown>).from = vi.fn().mockReturnThis();
      (db.db as Record<string, unknown>).where = vi.fn().mockReturnThis();
      (db.db as Record<string, unknown>).limit = vi
        .fn()
        .mockResolvedValue([]);

      await expect(
        service.getSourceByTransaction('nonexistent-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reverseRewardEntitlement', () => {
    it('reverses reward when source transaction is reversed', async () => {
      const { service, db } = createService();
      const tx = createMockTx();

      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValue([
        {
          id: 'source-rev',
          memberId: 'member-1',
          marketId: 'market-1',
          consumed: true,
        },
      ]);

      vi.mocked(tx.update).mockReturnThis();
      vi.mocked(tx.set).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();

      await expect(
        service.reverseRewardEntitlement(
          '550e8400-e29b-41d4-a716-446655440000',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws when reversing a transaction without a reward source', async () => {
      const { service, db } = createService();
      const tx = createMockTx();

      vi.mocked(tx.select).mockReturnThis();
      vi.mocked(tx.from).mockReturnThis();
      vi.mocked(tx.where).mockReturnThis();
      vi.mocked(tx.limit).mockResolvedValue([]);

      await expect(
        service.reverseRewardEntitlement('nonexistent'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
