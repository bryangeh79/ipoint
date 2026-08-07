import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markets,
  members,
  redemptionAuditLog,
  redemptionFulfilmentAudit,
  redemptionFulfilments,
  redemptionOrders,
  redemptionRateMarketRules,
  redemptionRefundRequests,
  redemptionShippingPaymentRecovery,
} from '@ipoint/database';
import type { DatabaseService } from '../database/database.service.js';
import { RedemptionFulfilmentService } from '../redemption/redemption-fulfilment.service.js';
import { RedemptionError } from '../redemption/redemption.errors.js';
import { RedemptionRefundService } from '../redemption/redemption-refund.service.js';
import { AdminRedemptionFulfilmentOpsService } from './admin-redemption-fulfilment-ops.service.js';
import { FULFILMENT_QUEUE_STATUSES } from './admin-redemption-fulfilment-ops.types.js';

/**
 * P7-S8 Admin Redemption Operations adapter unit tests (Command Center
 * 2026-08-07 §6.2-§6.6).
 *
 * The adapter is a Phase 7 read projection + orchestration layer over the
 * FROZEN Phase 6 redemption owner (`RedemptionFulfilmentService` +
 * `RedemptionRefundService`, SEC-02). Every owner-level business control
 * (transition validation, durable reason, immutable audit, atomic refund
 * execution) lives inside the owner services — the adapter performs NO
 * such control of its own and performs NO financial write.
 *
 * This spec therefore asserts:
 * 1. Delegation: suspend/resume/retry receive the exact frozen owner
 *    `ActorInfo` (ADMIN actorType, adminUserId, requestId, ipAddress)
 *    and the mandatory reason for suspend.
 * 2. The read projections: queue overview counts (six statuses + the
 *    explicit rate-configuration capability state), one queue page, the
 *    order audit merge, and the refund queue/detail with the REFUND_*
 *    status history.
 * 3. The owner error → adapter error mapping (no error swallowed into a
 *    2xx) and the queue-status validation.
 *
 * The database/owner surfaces are mocked; the HTTP contract is exercised
 * by the integration suite on a fresh database.
 */

let database: { db: DatabaseService['db']; pool: DatabaseService['pool'] };
let fulfilmentOwner: Pick<
  RedemptionFulfilmentService,
  'suspendOrder' | 'resumeOrder' | 'retryFulfilment'
>;
let refundOwner: Pick<RedemptionRefundService, never>;
let service: AdminRedemptionFulfilmentOpsService;

const MARKET_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const FULFILMENT_ID = '44444444-4444-4444-8444-444444444444';
const REFUND_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR = {
  adminUserId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-123',
  ipAddress: '127.0.0.1',
  currentMarketId: MARKET_ID,
};

const MARKET_ROW = { id: MARKET_ID, code: 'MY' };

function orderRow(
  overrides: Partial<Record<string, unknown>> = {},
): typeof redemptionOrders.$inferSelect {
  return {
    id: ORDER_ID,
    orderReference: 'RED-000001',
    marketId: MARKET_ID,
    memberId: '66666666-6666-4666-8666-666666666666',
    itemId: '77777777-7777-4777-8777-777777777777',
    walletAccountId: '88888888-8888-4888-8888-888888888888',
    walletEntryId: null,
    quoteId: null,
    rateVersionId: '99999999-9999-4999-8999-999999999999',
    rateValue: '1.0000000000',
    status: 'FULFILMENT_SUSPENDED',
    unroundedPointCost: '100.0000000000',
    postedPointCost: '100.0000000000',
    totalPoints: '100.0000000000',
    quantity: '1',
    backorderQuantity: '0',
    roundingMode: 'HALF_UP',
    calculationScale: 10,
    postingScale: 10,
    itemSnapshot: { name: 'iPoint Mug', sku: 'MUG-001' },
    rateSnapshot: {},
    idempotencyKey: null,
    notes: 'Suspended by ops',
    confirmedAt: new Date('2026-08-01T00:00:00.000Z'),
    processingStartedAt: null,
    readyForPickupAt: null,
    backorderedAt: null,
    fulfilledAt: null,
    termsVersion: 'v1',
    termsAcceptedAt: new Date('2026-08-01T00:00:00.000Z'),
    cancelledAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides,
  };
}

function fulfilmentRow(
  overrides: Partial<Record<string, unknown>> = {},
): typeof redemptionFulfilments.$inferSelect {
  return {
    id: FULFILMENT_ID,
    orderId: ORDER_ID,
    fulfilmentType: 'PHYSICAL',
    status: 'FAILED',
    shippingAddress: null,
    trackingNumber: null,
    courier: null,
    estimatedDeliveryDate: null,
    digitalValue: null,
    serviceScheduledAt: null,
    serviceNotes: null,
    fulfilledAt: null,
    failedAt: new Date('2026-08-02T00:00:00.000Z'),
    failureReason: 'Courier rejected',
    retryCount: 1,
    notes: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides,
  };
}

function refundRow(
  overrides: Partial<Record<string, unknown>> = {},
): typeof redemptionRefundRequests.$inferSelect {
  return {
    id: REFUND_ID,
    orderId: ORDER_ID,
    makerId: '11111111-1111-4111-8111-111111111111',
    checkerId: null,
    status: 'PENDING_CHECKER',
    refundAmount: '100.0000000000',
    reason: 'Damaged item',
    makerNotes: null,
    checkerNotes: null,
    walletEntryId: null,
    refundWalletEntryId: null,
    decidedAt: null,
    idempotencyScope: 'redemption.refund.owner.create',
    idempotencyKey: 'idem-1',
    payloadHash: 'a'.repeat(64),
    priorOrderStatus: 'FULFILMENT_EXCEPTION',
    executedAt: null,
    failedAt: null,
    failureReason: null,
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * A query-chain mock resolving rows by the FIRST table of each chain;
 * every method (where/orderBy/limit/offset/groupBy/innerJoin) returns a
 * thenable chain carrying the table's rows.
 */
function mockDb(
  rowsByTable: ReadonlyArray<readonly [unknown, unknown[]]>,
): DatabaseService['db'] {
  const rows = new Map<unknown, unknown[]>(rowsByTable);
  const chain = (
    table: unknown,
    forTable: unknown[],
  ): Record<string, unknown> => {
    const methods: Record<string, unknown> = {
      then: (resolve: (value: unknown[]) => void) => resolve(forTable),
      limit: vi.fn(() => chain(table, forTable)),
      orderBy: vi.fn(() => chain(table, forTable)),
      offset: vi.fn(() => chain(table, forTable)),
      where: vi.fn(() => chain(table, forTable)),
      groupBy: vi.fn(() => chain(table, forTable)),
      innerJoin: vi.fn(() => chain(table, forTable)),
      leftJoin: vi.fn(() => chain(table, forTable)),
    };
    return methods;
  };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn((table: unknown) => chain(table, rows.get(table) ?? [])),
    }),
  } as unknown as DatabaseService['db'];
}

beforeEach(() => {
  database = {
    db: {} as DatabaseService['db'],
    pool: { connect: vi.fn() } as unknown as DatabaseService['pool'],
  };
  fulfilmentOwner = {
    suspendOrder: vi.fn(),
    resumeOrder: vi.fn(),
    retryFulfilment: vi.fn(),
  };
  refundOwner = {};
  service = new AdminRedemptionFulfilmentOpsService(
    database as unknown as DatabaseService,
    fulfilmentOwner as unknown as RedemptionFulfilmentService,
    refundOwner as unknown as RedemptionRefundService,
  );
});

// ─── Owner command delegation ─────────────────────────────────────────

describe('owner command delegation (frozen Phase 6 owner)', () => {
  it('delegates suspendOrder with the owner ActorInfo and the reason', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionOrders, [orderRow()]],
    ]);
    vi.mocked(fulfilmentOwner.suspendOrder).mockResolvedValue(undefined);

    const result = await service.suspendOrder(
      ACTOR,
      MARKET_ID,
      ORDER_ID,
      'Fraud hold.',
    );

    expect(result).toMatchObject({
      ok: true,
      order_id: ORDER_ID,
      status: 'FULFILMENT_SUSPENDED',
    });
    expect(fulfilmentOwner.suspendOrder).toHaveBeenCalledTimes(1);
    const [orderId, reason, ownerActor] =
      vi.mocked(fulfilmentOwner.suspendOrder).mock.calls[0] ?? [];
    expect(orderId).toBe(ORDER_ID);
    expect(reason).toBe('Fraud hold.');
    expect(ownerActor).toEqual({
      actorType: 'ADMIN',
      actorId: ACTOR.adminUserId,
      requestId: 'req-123',
      ipAddress: '127.0.0.1',
    });
  });

  it('rejects an empty suspend reason (REDEMPTION_REASON_REQUIRED)', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionOrders, [orderRow()]],
    ]);
    await expect(
      service.suspendOrder(ACTOR, MARKET_ID, ORDER_ID, '   '),
    ).rejects.toMatchObject({ code: 'REDEMPTION_REASON_REQUIRED' });
    expect(fulfilmentOwner.suspendOrder).not.toHaveBeenCalled();
  });

  it('delegates resumeOrder and surfaces the owner-resolved target status', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionOrders, [orderRow({ status: 'CONFIRMED' })]],
    ]);
    vi.mocked(fulfilmentOwner.resumeOrder).mockResolvedValue('PROCESSING');

    const result = await service.resumeOrder(ACTOR, MARKET_ID, ORDER_ID);

    expect(result.status).toBe('PROCESSING');
    const [orderId, ownerActor] =
      vi.mocked(fulfilmentOwner.resumeOrder).mock.calls[0] ?? [];
    expect(orderId).toBe(ORDER_ID);
    expect(ownerActor?.actorId).toBe(ACTOR.adminUserId);
  });

  it('delegates retryFulfilment with the owner ActorInfo', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionFulfilments, [fulfilmentRow()]],
      [redemptionOrders, [orderRow()]],
    ]);
    vi.mocked(fulfilmentOwner.retryFulfilment).mockResolvedValue(
      fulfilmentRow({ status: 'PENDING' }) as unknown as Awaited<
        ReturnType<RedemptionFulfilmentService['retryFulfilment']>
      >,
    );

    const result = await service.retryFulfilment(
      ACTOR,
      MARKET_ID,
      FULFILMENT_ID,
    );

    expect(result).toMatchObject({ ok: true, status: 'PENDING' });
    const [fulfilmentId, ownerActor] =
      vi.mocked(fulfilmentOwner.retryFulfilment).mock.calls[0] ?? [];
    expect(fulfilmentId).toBe(FULFILMENT_ID);
    expect(ownerActor?.actorType).toBe('ADMIN');
    expect(ownerActor?.actorId).toBe(ACTOR.adminUserId);
  });

  it('rejects a cross-market fulfilment (REDEMPTION_ORDER_NOT_FOUND)', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionFulfilments, [fulfilmentRow()]],
      [redemptionOrders, []],
    ]);
    await expect(
      service.retryFulfilment(ACTOR, MARKET_ID, FULFILMENT_ID),
    ).rejects.toMatchObject({ code: 'REDEMPTION_ORDER_NOT_FOUND' });
    expect(fulfilmentOwner.retryFulfilment).not.toHaveBeenCalled();
  });

  it('maps owner REDEMPTION_ORDER_NOT_SUSPENDED to the adapter code', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionOrders, [orderRow()]],
    ]);
    vi.mocked(fulfilmentOwner.resumeOrder).mockRejectedValue(
      new RedemptionError(
        'REDEMPTION_ORDER_NOT_SUSPENDED',
        'Order 33333333-3333-4333-8333-333333333333 not suspended',
      ),
    );
    await expect(
      service.resumeOrder(ACTOR, MARKET_ID, ORDER_ID),
    ).rejects.toMatchObject({ code: 'REDEMPTION_ORDER_NOT_SUSPENDED' });
  });
});

// ─── Read projections ─────────────────────────────────────────────────

describe('read projections (P7-S8 §6.2-§6.5)', () => {
  it('builds the six-status queue overview with the rate capability state', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [
        redemptionOrders,
        [
          { status: 'READY_FOR_PICKUP', count: 2 },
          { status: 'BACKORDERED', count: 1 },
        ],
      ],
      [redemptionRateMarketRules, [{ id: 'rule-1' }]],
    ]);

    const result = await service.queueOverview(ACTOR, MARKET_ID);

    expect(result.market_code).toBe('MY');
    expect(result.rate_configured).toBe(true);
    expect(result.counts.READY_FOR_PICKUP).toBe(2);
    expect(result.counts.BACKORDERED).toBe(1);
    for (const status of FULFILMENT_QUEUE_STATUSES) {
      expect(typeof result.counts[status]).toBe('number');
    }
    expect(result.counts.FULFILMENT_EXCEPTION).toBe(0);
  });

  it('reports rate_configured=false when the market has no active rate rule', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionOrders, []],
      [redemptionRateMarketRules, []],
    ]);
    const result = await service.queueOverview(ACTOR, MARKET_ID);
    expect(result.rate_configured).toBe(false);
  });

  it('rejects an unknown queue status (REDEMPTION_QUEUE_STATUS_INVALID)', async () => {
    database.db = mockDb([[markets, [MARKET_ROW]]]);
    await expect(
      service.queue(ACTOR, MARKET_ID, 'BOGUS', { limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ code: 'REDEMPTION_QUEUE_STATUS_INVALID' });
  });

  it('maps one queue page with the linked fulfilment/refund/recovery rows', async () => {
    const order = orderRow({ status: 'REFUND_PENDING' });
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [
        redemptionOrders,
        [
          {
            ...order,
            total: 1,
            public_member_id: 'pub_abc',
            item_name: 'iPoint Mug',
            item_sku: 'MUG-001',
          },
        ],
      ],
      [members, [{ id: order.memberId, publicMemberId: 'pub_abc' }]],
      [redemptionFulfilments, [fulfilmentRow()]],
      [redemptionRefundRequests, [refundRow()]],
      [redemptionShippingPaymentRecovery, []],
    ]);

    const result = await service.queue(ACTOR, MARKET_ID, 'REFUND_PENDING', {
      limit: 50,
      offset: 0,
    });

    expect(result.status).toBe('REFUND_PENDING');
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.order_reference).toBe('RED-000001');
    expect(item.public_member_id).toBe('pub_abc');
    expect(item.fulfilment?.fulfilment_status).toBe('FAILED');
    expect(item.refund?.refund_status).toBe('PENDING_CHECKER');
    expect(item.refund?.refund_amount).toBe('100.0000000000');
  });

  it('merges fulfilment + order audit rows newest first', async () => {
    const order = orderRow();
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionOrders, [{ ...order, total: 1 }]],
      [
        redemptionFulfilmentAudit,
        [
          {
            id: 'audit-1',
            orderId: ORDER_ID,
            fulfilmentId: FULFILMENT_ID,
            eventType: 'ORDER_FULFILMENT_SUSPENDED',
            fromStatus: null,
            toStatus: 'FULFILMENT_SUSPENDED',
            actorType: 'ADMIN',
            actorId: ACTOR.adminUserId,
            summary: 'Admin suspension',
            metadata: {},
            occurredAt: new Date('2026-08-02T00:00:00.000Z'),
          },
        ],
      ],
      [
        redemptionAuditLog,
        [
          {
            id: 'audit-2',
            actorType: 'ADMIN',
            actorId: ACTOR.adminUserId,
            marketId: MARKET_ID,
            action: 'REFUND_REQUESTED',
            entityType: 'REDEMPTION_ORDER',
            entityId: ORDER_ID,
            before: null,
            after: {},
            reason: 'Damaged item',
            result: 'SUCCESS',
            requestId: null,
            ipAddress: null,
            occurredAt: new Date('2026-08-01T00:00:00.000Z'),
          },
        ],
      ],
    ]);

    const result = await service.orderAudit(ACTOR, MARKET_ID, ORDER_ID);

    expect(result).toHaveLength(2);
    expect(result[0]?.action).toBe('ORDER_FULFILMENT_SUSPENDED');
    expect(result[1]?.action).toBe('REFUND_REQUESTED');
  });

  it('returns the refund detail with the REFUND_* status history', async () => {
    const order = orderRow({ status: 'REFUND_PENDING' });
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [
        redemptionRefundRequests,
        [
          {
            refund: refundRow(),
            order: order,
          },
        ],
      ],
      [
        redemptionAuditLog,
        [
          {
            id: 'audit-3',
            actorType: 'ADMIN',
            actorId: ACTOR.adminUserId,
            marketId: MARKET_ID,
            action: 'REFUND_REQUESTED',
            entityType: 'REDEMPTION_ORDER',
            entityId: ORDER_ID,
            before: null,
            after: {},
            reason: 'Damaged item',
            result: 'SUCCESS',
            requestId: null,
            ipAddress: null,
            occurredAt: new Date('2026-08-02T00:00:00.000Z'),
          },
        ],
      ],
    ]);

    const result = await service.refundDetail(ACTOR, MARKET_ID, REFUND_ID);

    expect(result.refund_request_id).toBe(REFUND_ID);
    expect(result.order_reference).toBe('RED-000001');
    expect(result.status).toBe('PENDING_CHECKER');
    expect(result.status_history).toHaveLength(1);
    expect(result.status_history[0]?.action).toBe('REFUND_REQUESTED');
  });

  it('throws REDEMPTION_REFUND_NOT_FOUND for a cross-market refund', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [redemptionRefundRequests, []],
    ]);
    await expect(
      service.refundDetail(ACTOR, MARKET_ID, REFUND_ID),
    ).rejects.toMatchObject({ code: 'REDEMPTION_REFUND_NOT_FOUND' });
  });
});
