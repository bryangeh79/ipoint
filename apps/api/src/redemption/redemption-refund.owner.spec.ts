/**
 * SEC-02 Refund Owner unit suite (GATE-SEC-02).
 *
 * Covers the owner controls that are pure service logic:
 *   - identity guard (ADMIN actor only)
 *   - full-refund-only enforcement (exact-decimal)
 *   - CREATE idempotency: same key + payload replay / different payload 409
 *   - order-level conflicts (pending / already refunded / not refundable)
 *   - approve terminal states (COMPLETED / REJECTED / FAILED never
 *     re-execute; execution failure marks the request durably FAILED)
 *   - reject restores the exact pre-refund order status
 *   - immutable audit payloads (actor/action/before/after/reason/result)
 *
 * Real-PostgreSQL behavior (ledger credit, atomicity, concurrency,
 * commission absence) is covered by the integration suite.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConfigService } from '../config/config.service.js';
import type { DatabaseService } from '../database/database.service.js';
import { RedemptionRefundService, canonicalHash } from './redemption-refund.service.js';
import type { ActorInfo } from './redemption.types.js';

type MockTransactionCallback = (tx: unknown) => unknown;

describe('RedemptionRefundService — SEC-02 owner controls', () => {
  const orderId = randomUUID();
  const memberId = randomUUID();
  const marketId = randomUUID();
  const adminUserId = randomUUID();
  const checkerUserId = randomUUID();

  const adminActor: ActorInfo = {
    actorType: 'ADMIN',
    actorId: adminUserId,
    ipAddress: '127.0.0.1',
    requestId: 'req-1',
  };
  const checkerActor: ActorInfo = {
    actorType: 'ADMIN',
    actorId: checkerUserId,
    ipAddress: '127.0.0.1',
    requestId: 'req-2',
  };

  function createMockDb(): any {
    return {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      runTransaction: vi.fn(),
      db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      },
    };
  }

  function createMockConfig(): any {
    return {
      get: vi.fn().mockReturnValue(''),
      getOrThrow: vi.fn().mockReturnValue(''),
    };
  }

  function createOrderRow(overrides: Record<string, unknown> = {}): any {
    return {
      id: orderId,
      orderReference: 'REF-001',
      memberId,
      marketId,
      walletAccountId: randomUUID(),
      walletEntryId: randomUUID(),
      itemId: randomUUID(),
      quoteId: randomUUID(),
      status: 'FULFILMENT_EXCEPTION',
      totalPoints: '5000.0000000000',
      quantity: '1',
      backorderQuantity: '0',
      itemSnapshot: { name: 'Item' },
      rateSnapshot: { rate: 0.01 },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function createRefundRequestRow(
    overrides: Record<string, unknown> = {},
  ): any {
    return {
      id: randomUUID(),
      orderId,
      makerId: adminUserId,
      checkerId: null,
      status: 'PENDING_CHECKER',
      refundAmount: '5000.0000000000',
      reason: 'Item out of stock',
      makerNotes: null,
      checkerNotes: null,
      walletEntryId: null,
      refundWalletEntryId: null,
      priorOrderStatus: 'FULFILMENT_EXCEPTION',
      idempotencyScope: `redemption.refund.create:${orderId}`,
      idempotencyKey: `refund-create-${orderId}`,
      payloadHash: 'hash',
      executedAt: null,
      failedAt: null,
      failureReason: null,
      decidedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  /**
   * Build a transaction mock that records insert/update `values()` payloads
   * so audit + state writes can be asserted.
   */
  function makeTx(behaviors?: Record<string, any>): any {
    const recorded: Record<string, unknown[]> = {};
    const tx: any = {
      recorded,
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(),
      for: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn((values: Record<string, unknown>) => {
        const calls = recorded['insert'] ?? [];
        calls.push(values);
        recorded['insert'] = calls;
        return tx;
      }),
      onConflictDoNothing: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn((values: Record<string, unknown>) => {
        const calls = recorded['update'] ?? [];
        calls.push(values);
        recorded['update'] = calls;
        return tx;
      }),
      ...behaviors,
    };
    return tx;
  }

  let service: RedemptionRefundService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new RedemptionRefundService(
      mockDb as any,
      createMockConfig() as any,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Identity guard
  // ═══════════════════════════════════════════════════════════════════════

  describe('identity guard', () => {
    it('rejects a MEMBER actor on create', async () => {
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '5000',
            reason: 'Test',
            makerId: adminUserId,
            idempotencyKey: 'k',
          },
          { actorType: 'MEMBER', actorId: memberId },
        ),
      ).rejects.toThrow(/administrator identity/i);
    });

    it('rejects an actor without an admin id on approve', async () => {
      await expect(
        service.approveRefundRequest(
          { refundRequestId: randomUUID(), checkerId: checkerUserId },
          { actorType: 'ADMIN', actorId: null },
        ),
      ).rejects.toThrow(/administrator identity/i);
    });

    it('rejects an undefined actor on reject', async () => {
      await expect(
        service.rejectRefundRequest(randomUUID(), '', 'No'),
      ).rejects.toThrow(/administrator identity/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CREATE validation
  // ═══════════════════════════════════════════════════════════════════════

  describe('createRefundRequest — owner validation', () => {
    it('requires an idempotency key', async () => {
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([createOrderRow()]) // order
                .mockResolvedValueOnce([]) // idempotency claim lookup
                .mockResolvedValueOnce([]), // no existing request
            }),
          ),
      );
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '5000',
            reason: 'Test',
            makerId: adminUserId,
          },
          adminActor,
        ),
      ).rejects.toThrow(/idempotency key/i);
    });

    it('requires a reason', async () => {
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([createOrderRow()]) // order
                .mockResolvedValueOnce([]) // idempotency claim lookup
                .mockResolvedValueOnce([]), // no existing request
            }),
          ),
      );
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '5000',
            reason: '   ',
            makerId: adminUserId,
            idempotencyKey: 'k',
          },
          adminActor,
        ),
      ).rejects.toThrow(/reason/i);
    });

    it('rejects a partial refund (full refund only, OD-12 PENDING)', async () => {
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([createOrderRow()]) // order
                .mockResolvedValueOnce([]) // idempotency claim lookup
                .mockResolvedValueOnce([]), // no existing request
            }),
          ),
      );
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '2500.0000000000',
            reason: 'Test',
            makerId: adminUserId,
            idempotencyKey: 'k',
          },
          adminActor,
        ),
      ).rejects.toThrow(/full refund only/i);
    });

    it('accepts an amount with equivalent trailing-zero precision', async () => {
      const requestRow = createRefundRequestRow();
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([createOrderRow()]) // order
                .mockResolvedValueOnce([]) // idempotency claim lookup
                .mockResolvedValueOnce([]), // no existing request
              returning: vi.fn().mockResolvedValue([requestRow]),
            }),
          ),
      );
      const result = await service.createRefundRequest(
        {
          orderId,
          memberId,
          marketId,
          totalPointCost: '5000',
          reason: 'Test',
          makerId: adminUserId,
          idempotencyKey: 'k',
        },
        adminActor,
      );
      expect(result.status).toBe('PENDING_CHECKER');
    });

    it('rejects a member/market that does not match the order', async () => {
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([createOrderRow()]) // order
                .mockResolvedValueOnce([]) // idempotency claim lookup
                .mockResolvedValueOnce([]), // no existing request
            }),
          ),
      );
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId: randomUUID(),
            marketId,
            totalPointCost: '5000',
            reason: 'Test',
            makerId: adminUserId,
            idempotencyKey: 'k',
          },
          adminActor,
        ),
      ).rejects.toThrow(/does not match the order/i);
    });

    it('rejects a non-refundable order status (CONFIRMED)', async () => {
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([
                  createOrderRow({ status: 'CONFIRMED' }),
                ]) // order
                .mockResolvedValueOnce([]) // idempotency claim lookup
                .mockResolvedValueOnce([]), // no existing request
            }),
          ),
      );
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '5000',
            reason: 'Test',
            makerId: adminUserId,
            idempotencyKey: 'k',
          },
          adminActor,
        ),
      ).rejects.toThrow(/refundable/i);
    });

    it('rejects when the order is already refunded', async () => {
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([
                  createOrderRow({ status: 'REFUNDED' }),
                ]) // order
                .mockResolvedValueOnce([]), // idempotency claim lookup
            }),
          ),
      );
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '5000',
            reason: 'Test',
            makerId: adminUserId,
            idempotencyKey: 'k',
          },
          adminActor,
        ),
      ).rejects.toThrow(/already refunded/i);
    });

    it('rejects when a PENDING_CHECKER request already exists', async () => {
      const existing = createRefundRequestRow({ status: 'PENDING_CHECKER' });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi
                .fn()
                .mockResolvedValueOnce([createOrderRow()]) // order
                .mockResolvedValueOnce([]) // idempotency claim lookup
                .mockResolvedValueOnce([existing]),
            }),
          ),
      );
      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '5000',
            reason: 'Test',
            makerId: adminUserId,
            idempotencyKey: 'k2',
          },
          adminActor,
        ),
      ).rejects.toThrow(/pending checker/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CREATE idempotency
  // ═══════════════════════════════════════════════════════════════════════

  describe('createRefundRequest — idempotency', () => {
    it('replays the stored request for the same key + payload', async () => {
      const stored = createRefundRequestRow({
        status: 'COMPLETED',
        refundWalletEntryId: randomUUID(),
        payloadHash: canonicalHash({
          operation: 'redemption.refund.create',
          orderId,
          memberId,
          marketId,
          totalPointCost: '5000.0000000000',
          reason: 'Item out of stock',
          makerId: adminUserId,
          makerNotes: null,
        }),
      });
      const tx = makeTx({
        limit: vi
          .fn()
          .mockResolvedValueOnce([createOrderRow()]) // order
          .mockResolvedValueOnce([stored]), // idempotency claim lookup
        returning: vi.fn().mockResolvedValue([]), // INSERT never reached
      });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) => cb(tx),
      );

      const result = await service.createRefundRequest(
        {
          orderId,
          memberId,
          marketId,
          totalPointCost: '5000.0000000000',
          reason: 'Item out of stock',
          makerId: adminUserId,
          idempotencyKey: `refund-create-${orderId}`,
        },
        adminActor,
      );
      expect(result.id).toBe(stored.id);
      expect(result.status).toBe('COMPLETED'); // duplicate requests return the same result
    });

    it('conflicts for the same key with a different payload', async () => {
      const stored = createRefundRequestRow({
        status: 'PENDING_CHECKER',
        payloadHash: 'other-payload-hash',
      });
      const tx = makeTx({
        limit: vi
          .fn()
          .mockResolvedValueOnce([createOrderRow()]) // order
          .mockResolvedValueOnce([stored]), // idempotency claim lookup
        returning: vi.fn().mockResolvedValue([]),
      });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) => cb(tx),
      );

      await expect(
        service.createRefundRequest(
          {
            orderId,
            memberId,
            marketId,
            totalPointCost: '5000.0000000000',
            reason: 'Item out of stock',
            makerId: adminUserId,
            idempotencyKey: `refund-create-${orderId}`,
          },
          adminActor,
        ),
      ).rejects.toThrow(/different payload/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Approve terminal states + failure semantics
  // ═══════════════════════════════════════════════════════════════════════

  describe('approveRefundRequest — terminal states', () => {
    it('never re-executes a COMPLETED request', async () => {
      const requestRow = createRefundRequestRow({ status: 'COMPLETED' });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi.fn().mockResolvedValue([requestRow]),
            }),
          ),
      );
      await expect(
        service.approveRefundRequest(
          { refundRequestId: requestRow.id, checkerId: checkerUserId },
          checkerActor,
        ),
      ).rejects.toThrow(/already approved/i);
    });

    it('never re-executes a REJECTED request', async () => {
      const requestRow = createRefundRequestRow({ status: 'REJECTED' });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi.fn().mockResolvedValue([requestRow]),
            }),
          ),
      );
      await expect(
        service.approveRefundRequest(
          { refundRequestId: requestRow.id, checkerId: checkerUserId },
          checkerActor,
        ),
      ).rejects.toThrow(/already rejected/i);
    });

    it('rejects a FAILED request without re-executing (durable terminal)', async () => {
      const requestRow = createRefundRequestRow({
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: 'previous failure',
      });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) =>
          cb(
            makeTx({
              limit: vi.fn().mockResolvedValue([requestRow]),
            }),
          ),
      );
      await expect(
        service.approveRefundRequest(
          { refundRequestId: requestRow.id, checkerId: checkerUserId },
          checkerActor,
        ),
      ).rejects.toThrow(/FAILED/i);
    });

    it('durably marks the request FAILED when execution fails', async () => {
      const requestRow = createRefundRequestRow({ status: 'PENDING_CHECKER' });
      // First tx: request -> order select returns [] (order missing) -> throw.
      const firstTx = makeTx({
        limit: vi
          .fn()
          .mockResolvedValueOnce([requestRow]) // request
          .mockResolvedValueOnce([]), // order not found -> executeAtomicRefund throws
      });
      // markFailed tx: request -> update -> FAILED + audit.
      const failedRow = createRefundRequestRow({
        status: 'FAILED',
        failedAt: new Date(),
      });
      const secondTx = makeTx({
        limit: vi.fn().mockResolvedValueOnce([requestRow]),
        returning: vi.fn().mockResolvedValue([failedRow]),
      });
      mockDb.runTransaction
        .mockImplementationOnce(
          async (cb: MockTransactionCallback) => cb(firstTx),
        )
        .mockImplementationOnce(
          async (cb: MockTransactionCallback) => cb(secondTx),
        );

      await expect(
        service.approveRefundRequest(
          { refundRequestId: requestRow.id, checkerId: checkerUserId },
          checkerActor,
        ),
      ).rejects.toThrow(/Refund execution failed/i);

      const failedUpdate = (secondTx.recorded['update'] ?? []).find(
        (values) => values['status'] === 'FAILED',
      );
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate!['checkerId']).toBe(checkerUserId);
      expect(failedUpdate!['failedAt']).toBeInstanceOf(Date);
      expect(String(failedUpdate!['failureReason'])).toContain('rolled back');
    });

    it('records the REFUND_EXECUTED audit with before/after/reason/result', async () => {
      const requestRow = createRefundRequestRow({ status: 'PENDING_CHECKER' });
      const orderRow = createOrderRow({ status: 'REFUND_PENDING' });
      const walletRow = {
        id: randomUUID(),
        memberId,
        marketId,
        availableBalance: '10000.0000000000',
        version: 1,
        archivedAt: null,
      };
      const completedRow = createRefundRequestRow({
        status: 'COMPLETED',
        checkerId: checkerUserId,
        decidedAt: new Date(),
      });
      const refundEntry = {
        id: randomUUID(),
        entryType: 'REDEMPTION_REFUND',
      };
      const tx = makeTx({
        limit: vi
          .fn()
          .mockResolvedValueOnce([requestRow]) // request
          .mockResolvedValueOnce([orderRow]) // order
          .mockResolvedValueOnce([walletRow]) // wallet
          .mockResolvedValueOnce([]) // inventory (none)
          .mockResolvedValueOnce([completedRow]), // final request
        returning: vi.fn().mockResolvedValue([refundEntry]),
      });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) => cb(tx),
      );

      const result = await service.approveRefundRequest(
        { refundRequestId: requestRow.id, checkerId: checkerUserId },
        checkerActor,
      );
      expect(result.status).toBe('COMPLETED');

      const executedAudit = (tx.recorded['insert'] ?? []).find(
        (values) => values['action'] === 'REFUND_EXECUTED',
      );
      expect(executedAudit).toBeDefined();
      expect(executedAudit!['actorType']).toBe('ADMIN');
      expect(executedAudit!['actorId']).toBe(checkerUserId);
      expect(executedAudit!['entityId']).toBe(orderId);
      expect(executedAudit!['result']).toBe('SUCCESS');
      expect(executedAudit!['reason']).toBe('Item out of stock');
      expect(executedAudit!['before']).toEqual({ status: 'PENDING_CHECKER' });
      expect((executedAudit!['after'] as Record<string, unknown>)['status']).toBe(
        'COMPLETED',
      );
      expect(executedAudit!['requestId']).toBe('req-2');
      expect(executedAudit!['ipAddress']).toBe('127.0.0.1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Reject
  // ═══════════════════════════════════════════════════════════════════════

  describe('rejectRefundRequest — exact restoration', () => {
    it('restores the exact pre-refund order status (FULFILMENT_SUSPENDED)', async () => {
      const requestRow = createRefundRequestRow({
        status: 'PENDING_CHECKER',
        priorOrderStatus: 'FULFILMENT_SUSPENDED',
      });
      const rejectedRow = createRefundRequestRow({
        status: 'REJECTED',
        checkerId: checkerUserId,
        decidedAt: new Date(),
      });
      const restoredOrder = { ...createOrderRow(), marketId };
      const tx = makeTx({
        limit: vi.fn().mockResolvedValueOnce([requestRow]),
        returning: vi
          .fn()
          .mockResolvedValueOnce([rejectedRow])
          .mockResolvedValueOnce([restoredOrder]),
      });
      mockDb.runTransaction.mockImplementation(
        async (cb: MockTransactionCallback) => cb(tx),
      );

      const result = await service.rejectRefundRequest(
        requestRow.id,
        checkerUserId,
        'Not eligible',
      );
      expect(result.status).toBe('REJECTED');
      expect(result.checkerId).toBe(checkerUserId);

      const orderUpdate = (tx.recorded['update'] ?? []).find(
        (values) =>
          Object.prototype.hasOwnProperty.call(values, 'status') &&
          values['checkerId'] === undefined,
      );
      expect(orderUpdate).toBeDefined();
      expect(orderUpdate!['status']).toBe('FULFILMENT_SUSPENDED');

      const rejectedAudit = (tx.recorded['insert'] ?? []).find(
        (values) => values['action'] === 'REFUND_REJECTED',
      );
      expect(rejectedAudit).toBeDefined();
      expect(rejectedAudit!['result']).toBe('SUCCESS');
      expect(rejectedAudit!['after']).toEqual({
        status: 'REJECTED',
        refundRequestId: requestRow.id,
        reason: 'Not eligible',
      });
    });

    it('requires a rejection reason', async () => {
      await expect(
        service.rejectRefundRequest(randomUUID(), checkerUserId, '  '),
      ).rejects.toThrow(/reason/i);
    });
  });
});
