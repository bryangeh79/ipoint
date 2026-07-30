import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { RedemptionFulfilmentService } from './redemption-fulfilment.service.js';

type MockTransactionCallback = (tx: unknown) => unknown;

describe('RedemptionFulfilmentService', () => {
  const orderId = randomUUID();
  const memberId = randomUUID();
  const marketId = randomUUID();
  const adminUserId = randomUUID();

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
        orderBy: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
      },
    };
  }

  function createOrderRow(overrides: Record<string, unknown> = {}): any {
    return {
      id: orderId,
      orderReference: 'REF-001',
      memberId,
      marketId,
      walletAccountId: randomUUID(),
      walletEntryId: null,
      catalogItemId: randomUUID(),
      quoteId: randomUUID(),
      status: 'CONFIRMED',
      pointsCost: '5000.0000000000',
      currencyCost: null,
      quantity: 1,
      backorderQuantity: 0,
      itemSnapshot: {},
      rateSnapshot: {},
      notes: null,
      correlationId: null,
      confirmedAt: new Date(),
      processingStartedAt: null,
      readyForPickupAt: null,
      backorderedAt: null,
      fulfilledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      ...overrides,
    };
  }

  function createFulfilmentRow(overrides: Record<string, unknown> = {}): any {
    return {
      id: randomUUID(),
      orderId,
      marketId,
      fulfilmentNumber: 1,
      fulfilmentType: 'PHYSICAL',
      status: 'PENDING',
      quantity: 1,
      pickupLocationId: null,
      trackingReference: null,
      digitalPayload: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      ...overrides,
    };
  }

  let service: RedemptionFulfilmentService;
  let mockDb: any;

  beforeEach(() => {
    // Set encryption key so constructor initializes this.encryptionKey
    process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'] =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    mockDb = createMockDb();
    service = new RedemptionFulfilmentService(mockDb as any);
  });

  afterEach(() => {
    delete process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'];
  });

  describe('createFulfilment', () => {
    it('should create a physical fulfilment for a CONFIRMED order', async () => {
      const orderRow = createOrderRow();
      const fulfilmentRow = createFulfilmentRow({
        trackingNumber: 'TRACK-123',
      });

      // Sequential mock: 1st limit(1) returns order, 2nd returns [] (no existing fulfilment)
      const limitMock = vi
        .fn()
        .mockResolvedValueOnce([orderRow])
        .mockResolvedValueOnce([]);

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: limitMock,
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([fulfilmentRow]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      const result = await service.createFulfilment(
        {
          orderId,
          fulfilmentType: 'PHYSICAL',
          trackingNumber: 'TRACK-123',
        },
        { actorType: 'ADMIN', actorId: adminUserId },
      );

      expect(result.fulfilmentType).toBe('PHYSICAL');
      expect(result.status).toBe('PENDING');
      expect(result.trackingNumber).toBe('TRACK-123');
    });

    it('should reject if order does not exist', async () => {
      const limitMock = vi.fn().mockResolvedValueOnce([]);

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: limitMock,
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      await expect(
        service.createFulfilment(
          { orderId, fulfilmentType: 'PHYSICAL' },
          { actorType: 'ADMIN', actorId: adminUserId },
        ),
      ).rejects.toThrow();
    });

    it('should reject if order is not in a fulfilable state', async () => {
      const orderRow = createOrderRow({ status: 'REFUNDED' });

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([orderRow]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      await expect(
        service.createFulfilment(
          { orderId, fulfilmentType: 'PHYSICAL' },
          { actorType: 'ADMIN', actorId: adminUserId },
        ),
      ).rejects.toThrow();
    });
  });

  describe('updateStatus', () => {
    it('should transition from PENDING to IN_PROGRESS', async () => {
      const fulfilmentRow = createFulfilmentRow({ status: 'PENDING' });
      const updatedRow = createFulfilmentRow({ status: 'IN_PROGRESS' });

      const limitMock = vi
        .fn()
        .mockResolvedValueOnce([fulfilmentRow])
        .mockResolvedValueOnce([updatedRow]);

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: limitMock,
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      const result = await service.updateStatus(
        { fulfilmentId: fulfilmentRow.id, status: 'IN_PROGRESS' },
        { actorType: 'ADMIN', actorId: adminUserId },
      );

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should reject invalid transition (COMPLETED to IN_PROGRESS)', async () => {
      const fulfilmentRow = createFulfilmentRow({ status: 'DELIVERED' });

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([fulfilmentRow]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn(),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      await expect(
        service.updateStatus(
          { fulfilmentId: fulfilmentRow.id, status: 'IN_PROGRESS' },
          { actorType: 'ADMIN', actorId: adminUserId },
        ),
      ).rejects.toThrow();
    });
  });

  describe('voucher code generation', () => {
    it('should generate a voucher code in correct format', () => {
      const code = (service as any).generateCode();
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      const hash = createHash('sha256').update(code).digest('hex');
      expect(hash).toHaveLength(64);
      const encrypted = (service as any).encrypt(code);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(code);
    });

    it('should produce different codes on each call', () => {
      const c1 = (service as any).generateCode();
      const c2 = (service as any).generateCode();
      expect(c1).not.toBe(c2);
    });
  });

  describe('suspendOrder', () => {
    it('should transition CONFIRMED to FULFILMENT_SUSPENDED', async () => {
      const orderRow = createOrderRow();

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([orderRow]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      await expect(
        service.suspendOrder(orderId, 'Member suspended', {
          actorType: 'SYSTEM',
          actorId: null,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('waitlist', () => {
    it('should create a waitlist subscription', async () => {
      const insertedRow = {
        id: randomUUID(),
        memberId,
        marketId,
        catalogItemId: randomUUID(),
        status: 'ACTIVE',
        requestedQuantity: '1',
        notifiedAt: null,
        expiredAt: null,
        createdAt: new Date(),
      };

      const limitMock = vi.fn().mockResolvedValueOnce([]);

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: limitMock,
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([insertedRow]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      const itemId = randomUUID();
      const result = await service.subscribeWaitlist(
        memberId,
        marketId,
        itemId,
      );
      expect(result.memberId).toBe(memberId);
      expect(result.isActive).toBe(true);
    });

    it('should re-activate expired or cancelled subscription', async () => {
      const existingId = randomUUID();
      const existingRow = {
        id: existingId,
        memberId,
        marketId,
        catalogItemId: randomUUID(),
        status: 'EXPIRED',
        requestedQuantity: '1',
        notifiedAt: null,
        expiredAt: new Date(),
        createdAt: new Date(),
      };

      const limitMock = vi.fn().mockResolvedValue([existingRow]);

      mockDb.runTransaction.mockImplementation(async (cb: MockTransactionCallback) =>
        cb({
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: limitMock,
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        }),
      );

      const result = await service.subscribeWaitlist(
        memberId,
        marketId,
        randomUUID(),
      );
      expect(result.id).toBe(existingId);
    });
  });
});
