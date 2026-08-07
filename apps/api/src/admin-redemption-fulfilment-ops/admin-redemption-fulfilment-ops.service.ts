import { Inject, Injectable } from '@nestjs/common';
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
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { RedemptionFulfilmentService } from '../redemption/redemption-fulfilment.service.js';
import { RedemptionError } from '../redemption/redemption.errors.js';
import { RedemptionRefundService } from '../redemption/redemption-refund.service.js';
import type { ActorInfo } from '../redemption/redemption.types.js';
import type {
  RefundQueueQueryDto,
  RedemptionQueueQueryDto,
} from './admin-redemption-fulfilment-ops.dto.js';
import {
  redemptionFulfilmentNotFoundError,
  redemptionMarketNotFoundError,
  redemptionOrderNotFoundError,
  redemptionQueueStatusInvalidError,
  redemptionReasonRequiredError,
  redemptionRefundNotFoundError,
} from './admin-redemption-fulfilment-ops.errors.js';
import {
  FULFILMENT_QUEUE_STATUSES,
  RedemptionFulfilmentOpsError,
  type FulfilmentLinkDto,
  type FulfilmentQueueItemDto,
  type FulfilmentQueueOverviewResponse,
  type FulfilmentQueueResponse,
  type FulfilmentQueueStatus,
  type OperationResultDto,
  type OrderAuditEntryDto,
  type OrderDetailResponse,
  type RedemptionFulfilmentOpsActor,
  type RedemptionFulfilmentOpsErrorCode,
  type RefundDetailResponse,
  type RefundLinkDto,
  type RefundQueueResponse,
  type RefundRequestViewDto,
  type RefundStatusHistoryEntryDto,
  type ShippingRecoveryLinkDto,
} from './admin-redemption-fulfilment-ops.types.js';

/**
 * P7-S8 Admin Redemption Operations adapter service (Command Center
 * 2026-08-07 §6.2-§6.6).
 *
 * Phase 7 read projection + orchestration over the FROZEN Phase 6
 * redemption owner (`RedemptionFulfilmentService` + `RedemptionRefundService`,
 * SEC-02). No frozen redemption file is modified and no owner command is
 * duplicated:
 *
 * - Suspend/resume/retry delegate 1:1 to the owner commands
 *   (`suspendOrder` / `resumeOrder` / `retryFulfilment`) with the server
 *   Current Admin Market resource check (the target order/fulfilment must
 *   belong to the Current Admin Market — P6-R2 pattern). The owner owns
 *   transition validation, durable reason and the immutable audit rows
 *   (`redemption_fulfilment_audit` / `redemption_audit_log`).
 * - The six fulfilment queues and the refund queue/detail/status-history
 *   views are bounded read projections, market-scoped to the Current Admin
 *   Market, with the explicit rate-configuration capability state
 *   (`rate_configured` — canonical `redemption_rate_market_rules` source,
 *   D-053 §6; no fallback market).
 * - No financial write exists on this surface; refund creation/approval
 *   stay exclusively on the frozen Phase 6 routes.
 */
@Injectable()
export class AdminRedemptionFulfilmentOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedemptionFulfilmentService)
    private readonly fulfilmentOwner: RedemptionFulfilmentService,
    @Inject(RedemptionRefundService)
    private readonly refundOwner: RedemptionRefundService,
  ) {}

  // ─── Fulfilment queue read projections ─────────────────────────────

  /** Six-status queue overview counts for the Current Admin Market. */
  async queueOverview(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
  ): Promise<FulfilmentQueueOverviewResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();

    const rows = await this.database.db
      .select({
        status: redemptionOrders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(redemptionOrders)
      .where(eq(redemptionOrders.marketId, marketId))
      .groupBy(redemptionOrders.status);

    const counts = Object.fromEntries(
      FULFILMENT_QUEUE_STATUSES.map((status) => [status, 0]),
    ) as Record<FulfilmentQueueStatus, number>;
    for (const row of rows) {
      const status = row.status as string;
      if (status in counts) counts[status as FulfilmentQueueStatus] = row.count;
    }

    void actor;
    return {
      market_id: marketId,
      market_code: market.code,
      rate_configured: await this.rateConfigured(market.code),
      counts,
    };
  }

  /** One operational status queue (bounded read projection). */
  async queue(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    status: string,
    query: RedemptionQueueQueryDto,
  ): Promise<FulfilmentQueueResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();
    if (!(FULFILMENT_QUEUE_STATUSES as readonly string[]).includes(status)) {
      throw redemptionQueueStatusInvalidError(status);
    }
    const queueStatus = status as FulfilmentQueueStatus;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const where = and(
      eq(redemptionOrders.marketId, marketId),
      eq(redemptionOrders.status, queueStatus),
    );

    const [countRows, rows] = await Promise.all([
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(redemptionOrders)
        .where(where),
      this.database.db
        .select()
        .from(redemptionOrders)
        .where(where)
        .orderBy(desc(redemptionOrders.updatedAt))
        .limit(limit)
        .offset(offset),
    ]);

    const items = await this.withLinks(marketId, rows);

    void actor;
    return {
      market_id: marketId,
      market_code: market.code,
      status: queueStatus,
      rate_configured: await this.rateConfigured(market.code),
      items,
      total: countRows[0]?.total ?? 0,
      limit,
      offset,
    };
  }

  /** Order detail: order + fulfilment + refund + recovery + owner audit. */
  async orderDetail(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    orderId: string,
  ): Promise<OrderDetailResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();

    const orderRows = await this.database.db
      .select()
      .from(redemptionOrders)
      .where(
        and(
          eq(redemptionOrders.id, orderId),
          eq(redemptionOrders.marketId, marketId),
        ),
      )
      .limit(1);
    const order = orderRows[0];
    if (!order) throw redemptionOrderNotFoundError(orderId);

    const memberRows = await this.database.db
      .select({ publicMemberId: members.publicMemberId })
      .from(members)
      .where(eq(members.id, order.memberId))
      .limit(1);

    const [fulfilments, refunds, recoveries, audits] = await Promise.all([
      this.database.db
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.orderId, orderId))
        .limit(1),
      this.database.db
        .select()
        .from(redemptionRefundRequests)
        .where(eq(redemptionRefundRequests.orderId, orderId))
        .orderBy(desc(redemptionRefundRequests.createdAt))
        .limit(1),
      this.database.db
        .select()
        .from(redemptionShippingPaymentRecovery)
        .where(eq(redemptionShippingPaymentRecovery.orderId, orderId))
        .limit(1),
      this.orderAuditRows(orderId),
    ]);

    const snapshot = order.itemSnapshot as Record<string, unknown> | null;
    const name =
      typeof snapshot?.name === 'string' ? snapshot.name : 'Redemption item';
    const sku = typeof snapshot?.sku === 'string' ? snapshot.sku : null;

    void actor;
    return {
      market_id: marketId,
      market_code: market.code,
      order: {
        order_id: order.id,
        order_reference: order.orderReference,
        member_id: order.memberId,
        public_member_id: memberRows[0]?.publicMemberId ?? '',
        item_name: name,
        item_sku: sku,
        status: order.status,
        total_points: String(order.totalPoints),
        quantity: String(order.quantity),
        backorder_quantity: String(order.backorderQuantity),
        rate_value: String(order.rateValue),
        confirmed_at: order.confirmedAt
          ? order.confirmedAt.toISOString()
          : null,
        ready_for_pickup_at: order.readyForPickupAt
          ? order.readyForPickupAt.toISOString()
          : null,
        backordered_at: order.backorderedAt
          ? order.backorderedAt.toISOString()
          : null,
        fulfilled_at: order.fulfilledAt
          ? order.fulfilledAt.toISOString()
          : null,
        cancelled_at: order.cancelledAt
          ? order.cancelledAt.toISOString()
          : null,
        notes: order.notes,
        created_at: order.createdAt.toISOString(),
        updated_at: order.updatedAt.toISOString(),
      },
      fulfilment: fulfilments[0] ? this.toFulfilmentLink(fulfilments[0]) : null,
      refund: refunds[0] ? this.toRefundLink(refunds[0]) : null,
      shipping_recovery: recoveries[0]
        ? this.toRecoveryLink(recoveries[0])
        : null,
      audit: audits,
    };
  }

  /** Order audit history (owner-owned immutable rows), newest first. */
  async orderAudit(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    orderId: string,
  ): Promise<OrderAuditEntryDto[]> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();
    const orderRows = await this.database.db
      .select({ id: redemptionOrders.id })
      .from(redemptionOrders)
      .where(
        and(
          eq(redemptionOrders.id, orderId),
          eq(redemptionOrders.marketId, marketId),
        ),
      )
      .limit(1);
    if (!orderRows[0]) throw redemptionOrderNotFoundError(orderId);
    void actor;
    return this.orderAuditRows(orderId);
  }

  // ─── Orchestrated status operations (frozen Phase 6 owner) ─────────

  /**
   * Suspend an order (owner `suspendOrder`, OD-28). The target order must
   * belong to the Current Admin Market (resource-market consistency,
   * P6-R2); the reason is mandatory and stored durably by the owner, which
   * also appends the immutable audit row.
   */
  async suspendOrder(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    orderId: string,
    reason: string,
  ): Promise<OperationResultDto> {
    await this.assertOrderInMarket(marketId, orderId);
    const normalized = reason.trim();
    if (!normalized) throw redemptionReasonRequiredError();
    try {
      await this.fulfilmentOwner.suspendOrder(
        orderId,
        normalized,
        this.ownerActor(actor),
      );
    } catch (error) {
      throw this.mapOwnerError(error);
    }
    return {
      ok: true,
      order_id: orderId,
      status: 'FULFILMENT_SUSPENDED',
      updated_at: new Date().toISOString(),
    };
  }

  /** Resume a suspended order (owner `resumeOrder`, OD-28). */
  async resumeOrder(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    orderId: string,
  ): Promise<OperationResultDto> {
    await this.assertOrderInMarket(marketId, orderId);
    let target: string;
    try {
      target = await this.fulfilmentOwner.resumeOrder(
        orderId,
        this.ownerActor(actor),
      );
    } catch (error) {
      throw this.mapOwnerError(error);
    }
    return {
      ok: true,
      order_id: orderId,
      status: target,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Retry a FAILED fulfilment (owner `retryFulfilment`, OD-26 — the admin
   * failure-recovery operation). The fulfilment's order must belong to the
   * Current Admin Market.
   */
  async retryFulfilment(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    fulfilmentId: string,
  ): Promise<OperationResultDto> {
    await this.assertFulfilmentInMarket(marketId, fulfilmentId);
    try {
      await this.fulfilmentOwner.retryFulfilment(
        fulfilmentId,
        this.ownerActor(actor),
      );
    } catch (error) {
      throw this.mapOwnerError(error);
    }
    return {
      ok: true,
      fulfilment_id: fulfilmentId,
      status: 'PENDING',
      updated_at: new Date().toISOString(),
    };
  }

  // ─── Refund operations views (SEC-02 owner read face) ──────────────

  /** Refund queue: refund requests of the Current Admin Market. */
  async refundQueue(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    query: RefundQueueQueryDto,
  ): Promise<RefundQueueResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const conditions = [
      inArray(
        redemptionRefundRequests.orderId,
        this.database.db
          .select({ id: redemptionOrders.id })
          .from(redemptionOrders)
          .where(eq(redemptionOrders.marketId, marketId)),
      ),
    ];
    if (query.status) {
      conditions.push(eq(redemptionRefundRequests.status, query.status));
    }
    const where = and(...conditions);

    const [countRows, rows] = await Promise.all([
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(redemptionRefundRequests)
        .where(where),
      this.database.db
        .select()
        .from(redemptionRefundRequests)
        .where(where)
        .orderBy(desc(redemptionRefundRequests.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const orderRefs = await this.orderReferences(
      rows.map((row) => row.orderId),
    );

    void actor;
    return {
      market_id: marketId,
      market_code: market.code,
      items: rows.map((row) =>
        this.toRefundView(row, orderRefs.get(row.orderId) ?? ''),
      ),
      total: countRows[0]?.total ?? 0,
      limit,
      offset,
    };
  }

  /** Refund detail + owner audit status history (REFUND_* events). */
  async refundDetail(
    actor: RedemptionFulfilmentOpsActor,
    marketId: string,
    refundRequestId: string,
  ): Promise<RefundDetailResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw redemptionMarketNotFoundError();

    const rows = await this.database.db
      .select({ refund: redemptionRefundRequests, order: redemptionOrders })
      .from(redemptionRefundRequests)
      .innerJoin(
        redemptionOrders,
        eq(redemptionOrders.id, redemptionRefundRequests.orderId),
      )
      .where(
        and(
          eq(redemptionRefundRequests.id, refundRequestId),
          eq(redemptionOrders.marketId, marketId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw redemptionRefundNotFoundError(refundRequestId);

    const historyRows = await this.database.db
      .select()
      .from(redemptionAuditLog)
      .where(
        and(
          eq(redemptionAuditLog.entityType, 'REDEMPTION_ORDER'),
          eq(redemptionAuditLog.entityId, row.refund.orderId),
          sql`${redemptionAuditLog.action} LIKE 'REFUND%'`,
        ),
      )
      .orderBy(desc(redemptionAuditLog.occurredAt));

    const history: RefundStatusHistoryEntryDto[] = historyRows.map((entry) => ({
      id: entry.id,
      action: entry.action,
      reason: entry.reason,
      result: entry.result,
      actor_id: entry.actorId,
      occurred_at: entry.occurredAt.toISOString(),
    }));

    void actor;
    return {
      ...this.toRefundView(row.refund, row.order.orderReference),
      status_history: history,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async marketRow(
    marketId: string,
  ): Promise<{ id: string; code: string } | undefined> {
    const rows = await this.database.db
      .select({ id: markets.id, code: markets.code })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    return rows[0];
  }

  /** D-053 §6 source: active per-market redemption rate rule present? */
  private async rateConfigured(marketCode: string): Promise<boolean> {
    const rows = await this.database.db
      .select({ id: redemptionRateMarketRules.id })
      .from(redemptionRateMarketRules)
      .where(
        and(
          eq(redemptionRateMarketRules.marketCode, marketCode),
          eq(redemptionRateMarketRules.isActive, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  private async withLinks(
    marketId: string,
    orders: Array<typeof redemptionOrders.$inferSelect>,
  ): Promise<FulfilmentQueueItemDto[]> {
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length === 0) return [];

    const [memberRows, fulfilments, refunds, recoveries] = await Promise.all([
      this.database.db
        .select({ id: members.id, publicMemberId: members.publicMemberId })
        .from(members)
        .where(
          inArray(
            members.id,
            Array.from(new Set(orders.map((order) => order.memberId))),
          ),
        ),
      this.database.db
        .select()
        .from(redemptionFulfilments)
        .where(inArray(redemptionFulfilments.orderId, orderIds)),
      this.database.db
        .select()
        .from(redemptionRefundRequests)
        .where(inArray(redemptionRefundRequests.orderId, orderIds)),
      this.database.db
        .select()
        .from(redemptionShippingPaymentRecovery)
        .where(inArray(redemptionShippingPaymentRecovery.orderId, orderIds)),
    ]);

    const memberMap = new Map(memberRows.map((m) => [m.id, m.publicMemberId]));
    const fulfilmentByOrder = new Map(fulfilments.map((f) => [f.orderId, f]));
    const refundByOrder = new Map(refunds.map((r) => [r.orderId, r]));
    const recoveryByOrder = new Map(recoveries.map((r) => [r.orderId, r]));

    void marketId;
    return orders.map((order) => {
      const snapshot = order.itemSnapshot as Record<string, unknown> | null;
      const name =
        typeof snapshot?.name === 'string' ? snapshot.name : 'Redemption item';
      const sku = typeof snapshot?.sku === 'string' ? snapshot.sku : null;
      const fulfilment = fulfilmentByOrder.get(order.id);
      const refund = refundByOrder.get(order.id);
      const recovery = recoveryByOrder.get(order.id);
      return {
        order_id: order.id,
        order_reference: order.orderReference,
        member_id: order.memberId,
        public_member_id: memberMap.get(order.memberId) ?? '',
        item_name: name,
        item_sku: sku,
        total_points: String(order.totalPoints),
        quantity: String(order.quantity),
        backorder_quantity: String(order.backorderQuantity),
        status: order.status,
        confirmed_at: order.confirmedAt
          ? order.confirmedAt.toISOString()
          : null,
        ready_for_pickup_at: order.readyForPickupAt
          ? order.readyForPickupAt.toISOString()
          : null,
        backordered_at: order.backorderedAt
          ? order.backorderedAt.toISOString()
          : null,
        fulfilled_at: order.fulfilledAt
          ? order.fulfilledAt.toISOString()
          : null,
        updated_at: order.updatedAt.toISOString(),
        fulfilment: fulfilment ? this.toFulfilmentLink(fulfilment) : null,
        refund: refund ? this.toRefundLink(refund) : null,
        shipping_recovery: recovery ? this.toRecoveryLink(recovery) : null,
      };
    });
  }

  private toFulfilmentLink(
    row: typeof redemptionFulfilments.$inferSelect,
  ): FulfilmentLinkDto {
    return {
      fulfilment_id: row.id,
      fulfilment_type: row.fulfilmentType,
      fulfilment_status: row.status,
      tracking_number: row.trackingNumber,
      courier: row.courier,
      failure_reason: row.failureReason,
      retry_count: row.retryCount,
      max_retries: 3,
      created_at: row.createdAt.toISOString(),
    };
  }

  private toRefundLink(
    row: typeof redemptionRefundRequests.$inferSelect,
  ): RefundLinkDto {
    return {
      refund_request_id: row.id,
      refund_status: row.status,
      refund_amount: String(row.refundAmount),
      maker_id: row.makerId,
      checker_id: row.checkerId,
      decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
      executed_at: row.executedAt ? row.executedAt.toISOString() : null,
      failed_at: row.failedAt ? row.failedAt.toISOString() : null,
      failure_reason: row.failureReason,
    };
  }

  private toRecoveryLink(
    row: typeof redemptionShippingPaymentRecovery.$inferSelect,
  ): ShippingRecoveryLinkDto {
    return {
      recovery_id: row.id,
      recovery_status: row.recoveryStatus,
      amount: String(row.amount),
      currency: row.currency,
      retry_count: row.retryCount,
      max_retries: row.maxRetries,
      failed_at: row.failedAt ? row.failedAt.toISOString() : null,
    };
  }

  private toRefundView(
    row: typeof redemptionRefundRequests.$inferSelect,
    orderReference: string,
  ): RefundRequestViewDto {
    return {
      refund_request_id: row.id,
      order_id: row.orderId,
      order_reference: orderReference,
      status: row.status,
      refund_amount: String(row.refundAmount),
      reason: row.reason,
      maker_id: row.makerId,
      checker_id: row.checkerId,
      maker_notes: row.makerNotes,
      checker_notes: row.checkerNotes,
      prior_order_status: row.priorOrderStatus,
      decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
      executed_at: row.executedAt ? row.executedAt.toISOString() : null,
      failed_at: row.failedAt ? row.failedAt.toISOString() : null,
      failure_reason: row.failureReason,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async orderReferences(
    orderIds: string[],
  ): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.database.db
      .select({
        id: redemptionOrders.id,
        orderReference: redemptionOrders.orderReference,
      })
      .from(redemptionOrders)
      .where(inArray(redemptionOrders.id, orderIds));
    return new Map(rows.map((row) => [row.id, row.orderReference]));
  }

  private async orderAuditRows(orderId: string): Promise<OrderAuditEntryDto[]> {
    const [fulfilmentEvents, orderEvents] = await Promise.all([
      this.database.db
        .select()
        .from(redemptionFulfilmentAudit)
        .where(eq(redemptionFulfilmentAudit.orderId, orderId))
        .orderBy(desc(redemptionFulfilmentAudit.occurredAt)),
      this.database.db
        .select()
        .from(redemptionAuditLog)
        .where(
          and(
            eq(redemptionAuditLog.entityType, 'REDEMPTION_ORDER'),
            eq(redemptionAuditLog.entityId, orderId),
          ),
        )
        .orderBy(desc(redemptionAuditLog.occurredAt)),
    ]);

    const entries: OrderAuditEntryDto[] = [
      ...fulfilmentEvents.map((event) => ({
        id: event.id,
        action: event.eventType,
        entity_type: 'REDEMPTION_FULFILMENT',
        entity_id: event.fulfilmentId ?? event.orderId,
        actor_type: event.actorType,
        actor_id: event.actorId,
        reason: event.summary,
        result: 'SUCCESS',
        request_id: null,
        occurred_at: event.occurredAt.toISOString(),
      })),
      ...orderEvents.map((event) => ({
        id: event.id,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId,
        actor_type: event.actorType,
        actor_id: event.actorId,
        reason: event.reason,
        result: event.result,
        request_id: event.requestId,
        occurred_at: event.occurredAt.toISOString(),
      })),
    ];
    entries.sort(
      (left, right) =>
        new Date(right.occurred_at).getTime() -
        new Date(left.occurred_at).getTime(),
    );
    return entries;
  }

  /** Resource-market consistency: the order must belong to the market. */
  private async assertOrderInMarket(
    marketId: string,
    orderId: string,
  ): Promise<void> {
    const rows = await this.database.db
      .select({ id: redemptionOrders.id })
      .from(redemptionOrders)
      .where(
        and(
          eq(redemptionOrders.id, orderId),
          eq(redemptionOrders.marketId, marketId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw redemptionOrderNotFoundError(orderId);
  }

  /** Resource-market consistency: the fulfilment's order must be in the market. */
  private async assertFulfilmentInMarket(
    marketId: string,
    fulfilmentId: string,
  ): Promise<void> {
    const rows = await this.database.db
      .select({ orderId: redemptionFulfilments.orderId })
      .from(redemptionFulfilments)
      .where(eq(redemptionFulfilments.id, fulfilmentId))
      .limit(1);
    const orderId = rows[0]?.orderId;
    if (!orderId) throw redemptionFulfilmentNotFoundError(fulfilmentId);
    await this.assertOrderInMarket(marketId, orderId);
  }

  /** Adapt the surface actor into the frozen owner ActorInfo. */
  private ownerActor(actor: RedemptionFulfilmentOpsActor): ActorInfo {
    return {
      actorType: 'ADMIN',
      actorId: actor.adminUserId,
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
    };
  }

  /**
   * Translate the frozen owner's REDEMPTION_* rejections into the adapter
   * error codes. Unknown owner codes propagate as-is (500 through the
   * controller) — no error is swallowed into a 2xx.
   */
  private mapOwnerError(error: unknown): RedemptionFulfilmentOpsError {
    if (error instanceof RedemptionError) {
      const code = this.toAdapterCode(error.code);
      return new RedemptionFulfilmentOpsError(code, error.message);
    }
    if (error instanceof RedemptionFulfilmentOpsError) return error;
    throw error;
  }

  private toAdapterCode(code: string): RedemptionFulfilmentOpsErrorCode {
    switch (code) {
      case 'REDEMPTION_FULFILMENT_NOT_FOUND':
        return 'REDEMPTION_FULFILMENT_NOT_FOUND';
      case 'REDEMPTION_FULFILMENT_ORDER_NOT_FOUND':
        return 'REDEMPTION_ORDER_NOT_FOUND';
      case 'REDEMPTION_FULFILMENT_INVALID_TRANSITION':
        return 'REDEMPTION_FULFILMENT_INVALID_TRANSITION';
      case 'REDEMPTION_FULFILMENT_MAX_RETRIES':
        return 'REDEMPTION_FULFILMENT_MAX_RETRIES';
      case 'REDEMPTION_FULFILMENT_NON_RETRYABLE':
        return 'REDEMPTION_FULFILMENT_NON_RETRYABLE';
      case 'REDEMPTION_ORDER_NOT_SUSPENDED':
        return 'REDEMPTION_ORDER_NOT_SUSPENDED';
      case 'REDEMPTION_ORDER_CANNOT_SUSPEND':
        return 'REDEMPTION_ORDER_CANNOT_SUSPEND';
      default:
        return 'REDEMPTION_FULFILMENT_INVALID_TRANSITION';
    }
  }
}
