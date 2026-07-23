/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Phase 3 — Negative Input Boundary Tests for Transaction Reward HALF_UP
 *
 * Validates that the TransactionRewardLinkageService correctly handles
 * negative transaction amounts in its calculateReward method.
 *
 * Since calculateReward is private, we test through createRewardEntitlement
 * and also verify the underlying rounding behavior via the service contract.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import {
  TransactionRewardLinkageService,
  type TransactionSnapshotInput,
} from './transaction-reward-linkage.service.js';

// ── Mock helpers ──────────────────────────────────────────────────

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

function createMockDbWithTx(transactionFn: (tx: unknown) => Promise<unknown>) {
  const tx = createMockTx();
  const mockDb = {
    transaction: vi
      .fn()
      .mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    ...tx,
  };
  return { db: mockDb, pool: { end: vi.fn() }, tx };
}

function createService() {
  const mock = createMockDbWithTx(async () => {});
  const dbService = {
    db: mock.db,
    pool: mock.pool,
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
    db: mock.db,
    audit: auditService,
    tx: mock.tx,
  };
}

function makeInput(
  overrides?: Partial<TransactionSnapshotInput>,
): TransactionSnapshotInput {
  return {
    transactionId: 'neg-input-0001',
    memberId: 'neg-input-member',
    consumptionMarketId: 'neg-input-market',
    merchantBranchId: 'neg-input-branch',
    amount: '100.00',
    currency: 'VND',
    transactionTime: new Date('2026-07-23T08:00:00.000Z'),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('TransactionRewardLinkageService — Negative Input Boundary', () => {
  describe('createRewardEntitlement with negative amounts', () => {
    it('rejects negative transaction amount (returns null rewardAmount)', async () => {
      const { service, tx } = createService();

      // No existing source (idempotency)
      vi.mocked(tx.limit).mockResolvedValueOnce([]);
      // Mock merchant package lookup returns null
      vi.mocked(tx.execute).mockResolvedValue({ rows: [] });
      // Mock reward rule version returns a valid rule
      vi.mocked(tx.limit).mockResolvedValueOnce([
        {
          id: 'rule-neg-1',
          rewardRate: '5.0000000000',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
        },
      ]);

      const input = makeInput({ amount: '-100.00' });
      const result = await service.createRewardEntitlement(input);

      // Negative amount should produce null reward with SCHEDULED status
      // (plan is created but reward is 0 since negative yields no points)
      expect(result.rewardAmount).toBeNull();
      expect(result.isNew).toBe(true);
    });

    it('rejects negative transaction amount with boundary near-zero negative', async () => {
      const { service, tx } = createService();

      vi.mocked(tx.limit).mockResolvedValueOnce([]);
      vi.mocked(tx.execute).mockResolvedValue({ rows: [] });
      vi.mocked(tx.limit).mockResolvedValueOnce([
        {
          id: 'rule-neg-2',
          rewardRate: '0.5000000000', // 0.5%
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
        },
      ]);

      // -0.01 * 0.5% = -0.00005 → rounds toward zero → 0 → null
      const input = makeInput({ amount: '-0.01' });
      const result = await service.createRewardEntitlement(input);

      expect(result.rewardAmount).toBeNull();
    });

    it('rejects transaction amount of exactly zero', async () => {
      const { service, tx } = createService();

      vi.mocked(tx.limit).mockResolvedValueOnce([]);
      vi.mocked(tx.execute).mockResolvedValue({ rows: [] });
      vi.mocked(tx.limit).mockResolvedValueOnce([
        {
          id: 'rule-zero-1',
          rewardRate: '5.0000000000',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
        },
      ]);

      const input = makeInput({ amount: '0.00' });
      const result = await service.createRewardEntitlement(input);

      expect(result.rewardAmount).toBeNull();
    });

    it('rejects negative amount with minimum reward set (negative still yields null)', async () => {
      const { service, tx } = createService();

      vi.mocked(tx.limit).mockResolvedValueOnce([]);
      vi.mocked(tx.execute).mockResolvedValue({ rows: [] });
      vi.mocked(tx.limit).mockResolvedValueOnce([
        {
          id: 'rule-neg-min',
          rewardRate: '10.0000000000', // 10%
          capType: 'NONE',
          capValue: '0',
          minimumReward: '5.00',
        },
      ]);

      // Even with a large negative amount -1000 * 10% = -100 (but then null),
      // minimum reward shouldn't apply since the result is negative
      const input = makeInput({ amount: '-1000.00' });
      const result = await service.createRewardEntitlement(input);

      expect(result.rewardAmount).toBeNull();
    });

    it('positive amount produces non-null rewardAmount as expected', async () => {
      const { service, tx } = createService();

      vi.mocked(tx.limit).mockResolvedValueOnce([]);
      vi.mocked(tx.execute).mockResolvedValue({ rows: [] });
      vi.mocked(tx.limit).mockResolvedValueOnce([
        {
          id: 'rule-pos-1',
          rewardRate: '5.0000000000',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
        },
      ]);
      // Also mock the wallet entry lookup for sequence number
      vi.mocked(tx.execute).mockResolvedValue({ rows: [{ max_seq: null }] });

      const input = makeInput({ amount: '100.00' });
      const result = await service.createRewardEntitlement(input);

      // 100 * 5% = 5.00 — positive amount produces a valid reward
      expect(result.rewardAmount).not.toBeNull();
      expect(result.isNew).toBe(true);
    });
  });
});
