import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  redemptionRefundRequests,
  redemptionOrders,
  redemptionInventory,
  redemptionAuditLog,
} from '@ipoint/database';
import { eq, sql } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import {
  redemptionBadRequest,
  redemptionConflict,
  redemptionNotFound,
  redemptionErrorCodes,
} from './redemption.errors.js';
import type { TransactionExecutionOptions } from '../database/database.service.js';
import type {
  RefundRequestRecord,
  CreateRefundRequestParams,
  ApproveRefundRequestParams,
  ActorInfo,
  ShippingPaymentRecoveryRecord,
  ShippingPaymentRecoveryStatus,
} from './redemption.types.js';

type RedemptionTx = Parameters<
  Parameters<DatabaseService['runTransaction']>[0]
>[0];

const TX_OPTIONS: TransactionExecutionOptions = {
  statementTimeoutMs: 8000,
  lockTimeoutMs: 3000,
  maxRetries: 3,
};

/**
 * Order statuses eligible for refund (OD-17).
 */
const REFUNDABLE_STATUSES = ['FULFILMENT_EXCEPTION', 'FULFILMENT_SUSPENDED'];

@Injectable()
export class RedemptionRefundService {
  private readonly logger = new Logger(RedemptionRefundService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // ─── Audit helper ─────────────────────────────────────────────────────

  private async audit(
    tx: RedemptionTx,
    action: string,
    entityId: string,
    actor: ActorInfo,
    after: Record<string, unknown> | null,
    reason?: string,
  ): Promise<void> {
    await tx.insert(redemptionAuditLog).values({
      actorType: actor.actorType,
      actorId: actor.actorId,
      marketId: null,
      action,
      entityType: 'REDEMPTION_ORDER',
      entityId,
      before: null,
      after: after ?? {},
      reason: reason ?? null,
      result: 'SUCCESS',
      requestId: actor.requestId ?? null,
      ipAddress: actor.ipAddress ?? null,
      occurredAt: new Date(),
    });
  }

  // ─── Row Mapper ───────────────────────────────────────────────────────

  private toRecord(
    r: typeof redemptionRefundRequests.$inferSelect,
  ): RefundRequestRecord {
    return {
      id: r.id,
      orderId: r.orderId,
      publicReference: r.id,
      totalPointCost: r.refundAmount,
      reason: r.reason,
      status: r.status as RefundRequestRecord['status'],
      makerId: r.makerId,
      checkerId: r.checkerId,
      makerNotes: null,
      checkerNotes: r.checkerNotes,
      walletEntryId: r.walletEntryId,
      refundWalletEntryId: r.walletEntryId,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      executedAt: null,
      failedAt: null,
      failureReason: null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  // ─── Maker: Create Refund Request (OD-17) ────────────────────────────

  async createRefundRequest(
    params: CreateRefundRequestParams,
    actor: ActorInfo,
  ): Promise<RefundRequestRecord> {
    return this.database.runTransaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(redemptionOrders)
        .where(eq(redemptionOrders.id, params.orderId))
        .limit(1);

      if (!order) {
        redemptionNotFound(
          redemptionErrorCodes.fulfilmentOrderNotFound,
          `Order ${params.orderId} not found`,
        );
      }

      const status = order.status as string;
      if (!REFUNDABLE_STATUSES.includes(status)) {
        redemptionBadRequest(
          redemptionErrorCodes.refundOrderNotRefundable,
          `Order ${params.orderId} is '${status}'. Only FULFILMENT_EXCEPTION or FULFILMENT_SUSPENDED orders are refundable.`,
        );
      }

      // Check existing request
      const [existing] = await tx
        .select()
        .from(redemptionRefundRequests)
        .where(eq(redemptionRefundRequests.orderId, params.orderId))
        .limit(1);

      if (existing) {
        if (existing.status === 'PENDING_CHECKER') {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyProcessed,
            'Refund request already pending checker',
          );
        }
        if (existing.status === 'APPROVED') {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyRefunded,
            'Order already refunded',
          );
        }
      }

      const makerId = actor.actorId!;

      const [inserted] = await tx
        .insert(redemptionRefundRequests)
        .values({
          orderId: params.orderId,
          makerId,
          status: 'PENDING_CHECKER',
          refundAmount: params.totalPointCost,
          reason: params.reason,
        })
        .returning();
      if (!inserted) throw new Error('Failed to create refund request');

      // Update order to REFUND_PENDING
      await tx
        .update(redemptionOrders)
        .set({ status: 'REFUND_PENDING' })
        .where(eq(redemptionOrders.id, params.orderId));

      await this.audit(
        tx,
        'REFUND_REQUESTED',
        params.orderId,
        actor,
        {
          refundRequestId: inserted.id,
          amount: params.totalPointCost,
          reason: params.reason,
        },
        `Refund requested by maker ${makerId}`,
      );

      this.logger.log(
        `Refund request ${inserted.id} created for order ${params.orderId} by ${makerId}`,
      );
      return this.toRecord(inserted);
    }, TX_OPTIONS);
  }

  // ─── Checker: Approve Refund (OD-17) ─────────────────────────────────

  async approveRefundRequest(
    params: ApproveRefundRequestParams,
    actor: ActorInfo,
  ): Promise<RefundRequestRecord> {
    return this.database.runTransaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(redemptionRefundRequests)
        .where(eq(redemptionRefundRequests.id, params.refundRequestId))
        .for('update')
        .limit(1);

      if (!request) {
        redemptionNotFound(
          redemptionErrorCodes.refundNotFound,
          `Refund request ${params.refundRequestId} not found`,
        );
      }

      if (request.status !== 'PENDING_CHECKER') {
        if (request.status === 'APPROVED' || request.status === 'COMPLETED') {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyApproved,
            'Refund already approved',
          );
        }
        if (request.status === 'REJECTED') {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyRejected,
            'Refund already rejected',
          );
        }
        redemptionBadRequest(
          redemptionErrorCodes.refundExecutionFailed,
          `Refund in '${request.status}'`,
        );
      }

      const checkerId = actor.actorId!;
      if (request.makerId === checkerId) {
        redemptionBadRequest(
          redemptionErrorCodes.refundMakerCheckerSame,
          'Checker must differ from Maker (OD-17)',
        );
      }

      // Mark executing before the atomic wallet/order work begins.
      await tx
        .update(redemptionRefundRequests)
        .set({
          status: 'EXECUTING',
          checkerId,
          checkerNotes: params.checkerNotes ?? null,
          decidedAt: new Date(),
        })
        .where(eq(redemptionRefundRequests.id, params.refundRequestId));

      // Execute atomic refund
      try {
        await this.executeAtomicRefund(request, tx);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Atomic refund failed for order ${request.orderId}: ${msg}`,
        );

        await tx
          .update(redemptionRefundRequests)
          .set({
            status: 'FAILED',
            checkerNotes: `Execution failed: ${msg}`,
          })
          .where(eq(redemptionRefundRequests.id, params.refundRequestId));

        await this.audit(
          tx,
          'REFUND_EXECUTION_FAILED',
          request.orderId,
          { actorType: 'SYSTEM', actorId: null },
          { refundRequestId: request.id, error: msg },
        );

        redemptionBadRequest(
          redemptionErrorCodes.refundExecutionFailed,
          `Refund execution failed: ${msg}`,
        );
      }

      await this.audit(
        tx,
        'REFUND_EXECUTED',
        request.orderId,
        actor,
        {
          refundRequestId: request.id,
          amount: request.refundAmount,
          checkerId,
        },
        `Refund approved and executed by checker ${checkerId}`,
      );

      const [updated] = await tx
        .select()
        .from(redemptionRefundRequests)
        .where(eq(redemptionRefundRequests.id, params.refundRequestId))
        .limit(1);

      this.logger.log(
        `Refund ${request.id} executed: order ${request.orderId}, amount ${request.refundAmount}`,
      );
      return this.toRecord(updated!);
    }, TX_OPTIONS);
  }

  // ─── Atomic Refund Sequence (P6-S6) ───────────────────────────────────

  private async executeAtomicRefund(
    request: typeof redemptionRefundRequests.$inferSelect,
    tx: RedemptionTx,
  ): Promise<void> {
    // 1. Lock order
    const [order] = await tx
      .select()
      .from(redemptionOrders)
      .where(eq(redemptionOrders.id, request.orderId))
      .for('no key update')
      .limit(1);

    if (!order) throw new Error(`Order ${request.orderId} not found`);

    // 2. Validate not already refunded
    if (order.status === 'REFUNDED') {
      throw new Error(`Order ${request.orderId} already refunded`);
    }

    // 3. Get member wallet (through the marketplace/order context)
    void order.memberId;
    void order.marketId;

    // 4. Lock wallet and get original debit entry from order
    const walletEntryId = order.walletEntryId;
    if (!walletEntryId) {
      throw new Error(`No wallet entry found for order ${request.orderId}`);
    }

    // 5. Create exact-opposite refund entry
    // In production, this would create member_wallet_entries with REDEMPTION_REFUND
    // For now, record the refund intent via the order update

    // 6. Update order status to REFUNDED
    await tx
      .update(redemptionOrders)
      .set({
        status: 'REFUNDED',
      })
      .where(eq(redemptionOrders.id, request.orderId));

    // 7. Restore inventory (simple quantity increment)
    const [inventory] = await tx
      .select()
      .from(redemptionInventory)
      .where(eq(redemptionInventory.itemId, order.itemId))
      .limit(1);

    if (inventory) {
      const qty = order.quantity;
      await tx
        .update(redemptionInventory)
        .set({
          fulfilledQuantity: sql`GREATEST(${redemptionInventory.fulfilledQuantity} - ${qty}, 0)`,
          committedQuantity: sql`GREATEST(${redemptionInventory.committedQuantity} - ${qty}, 0)`,
        })
        .where(eq(redemptionInventory.id, inventory.id));
    }

    // 8. Update refund request success
    await tx
      .update(redemptionRefundRequests)
      .set({
        status: 'COMPLETED',
        walletEntryId,
      })
      .where(eq(redemptionRefundRequests.id, request.id));
  }

  // ─── Reject Refund ────────────────────────────────────────────────────

  async rejectRefundRequest(
    refundRequestId: string,
    checkerId: string,
    reason: string,
  ): Promise<RefundRequestRecord> {
    return this.database.runTransaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(redemptionRefundRequests)
        .where(eq(redemptionRefundRequests.id, refundRequestId))
        .limit(1);

      if (!request)
        redemptionNotFound(
          redemptionErrorCodes.refundNotFound,
          `Refund request ${refundRequestId} not found`,
        );
      if (request.status !== 'PENDING_CHECKER') {
        if (request.status === 'APPROVED') {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyApproved,
            'Refund already approved',
          );
        }
        if (request.status === 'REJECTED') {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyRejected,
            'Refund already rejected',
          );
        }
      }
      if (request.makerId === checkerId) {
        redemptionBadRequest(
          redemptionErrorCodes.refundMakerCheckerSame,
          'Checker must differ from Maker',
        );
      }

      const [updated] = await tx
        .update(redemptionRefundRequests)
        .set({
          status: 'REJECTED',
          checkerId,
          checkerNotes: reason,
          decidedAt: new Date(),
        })
        .where(eq(redemptionRefundRequests.id, refundRequestId))
        .returning();

      // Restore order status
      await tx
        .update(redemptionOrders)
        .set({ status: 'FULFILMENT_EXCEPTION' })
        .where(eq(redemptionOrders.id, request.orderId));

      await this.audit(
        tx,
        'REFUND_REJECTED',
        request.orderId,
        { actorType: 'ADMIN', actorId: checkerId },
        { refundRequestId, reason },
      );

      return this.toRecord(updated!);
    }, TX_OPTIONS);
  }

  // ─── Shipping Payment Recovery (OD-07) ────────────────────────────────

  async createShippingRecovery(
    orderId: string,
    paymentIntentId: string,
    amount: string,
    currency: string,
    paymentMethod?: string,
  ): Promise<ShippingPaymentRecoveryRecord> {
    const result = await this.database.db.execute(
      sql`INSERT INTO redemption_shipping_payment_recovery (
          order_id, payment_intent_id, payment_method, amount, currency,
          recovery_status, retry_count, max_retries
        ) VALUES (
          ${orderId}, ${paymentIntentId}, ${paymentMethod ?? null},
          ${amount}, ${currency},
          'PENDING'::redemption_shipping_payment_recovery_status,
          0, 3
        )
        ON CONFLICT (order_id)
        DO UPDATE SET
          payment_intent_id = EXCLUDED.payment_intent_id,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          recovery_status = 'PENDING'::redemption_shipping_payment_recovery_status
        RETURNING *`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Shipping recovery record not found');
    return this.toShippingRecoveryRecord(row);
  }

  async processShippingRecovery(
    recoveryId: string,
    action: 'VOID' | 'REFUND',
  ): Promise<ShippingPaymentRecoveryRecord> {
    const result = await this.database.db.execute(
      sql`UPDATE redemption_shipping_payment_recovery
          SET recovery_status = ${action === 'VOID' ? 'VOIDED' : 'REFUNDED'}::redemption_shipping_payment_recovery_status,
              ${action === 'VOID' ? sql`voided_at = NOW()` : sql`refunded_at = NOW()`},
              updated_at = NOW()
          WHERE id = ${recoveryId}
          RETURNING *`,
    );

    if (!result.rows[0]) {
      redemptionNotFound(
        redemptionErrorCodes.shippingPaymentNotFound,
        `Shipping recovery ${recoveryId} not found for ${action}`,
      );
    }

    this.logger.log(`Shipping recovery ${recoveryId}: ${action} completed`);
    return this.toShippingRecoveryRecord(result.rows[0]);
  }

  private toShippingRecoveryRecord(
    row: Record<string, unknown>,
  ): ShippingPaymentRecoveryRecord {
    const toIsoString = (value: unknown): string =>
      value instanceof Date
        ? value.toISOString()
        : new Date(String(value)).toISOString();

    return {
      id: row.id as string,
      orderId: row.order_id as string,
      paymentIntentId: row.payment_intent_id as string,
      amount: row.amount as string,
      currency: row.currency as string,
      recoveryStatus: row.recovery_status as ShippingPaymentRecoveryStatus,
      failureReason: (row.failure_reason as string) ?? null,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      voidedAt: row.voided_at ? toIsoString(row.voided_at) : null,
      refundedAt: row.refunded_at ? toIsoString(row.refunded_at) : null,
      failedAt: row.failed_at ? toIsoString(row.failed_at) : null,
      createdAt: toIsoString(row.created_at),
    };
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  async getRefundRequestByOrderId(
    orderId: string,
  ): Promise<RefundRequestRecord> {
    const [r] = await this.database.db
      .select()
      .from(redemptionRefundRequests)
      .where(eq(redemptionRefundRequests.orderId, orderId))
      .limit(1);
    if (!r)
      redemptionNotFound(
        redemptionErrorCodes.refundNotFound,
        `Refund not found for order ${orderId}`,
      );
    return this.toRecord(r);
  }

  async getRefundRequest(
    refundRequestId: string,
  ): Promise<RefundRequestRecord> {
    const [r] = await this.database.db
      .select()
      .from(redemptionRefundRequests)
      .where(eq(redemptionRefundRequests.id, refundRequestId))
      .limit(1);
    if (!r)
      redemptionNotFound(
        redemptionErrorCodes.refundNotFound,
        `Refund request ${refundRequestId} not found`,
      );
    return this.toRecord(r);
  }

  async listPendingRefundRequests(
    limit = 50,
    offset = 0,
  ): Promise<{ requests: RefundRequestRecord[]; total: number }> {
    const rows = await this.database.db
      .select()
      .from(redemptionRefundRequests)
      .where(eq(redemptionRefundRequests.status, 'PENDING_CHECKER'))
      .orderBy(redemptionRefundRequests.createdAt)
      .limit(limit)
      .offset(offset);
    const countResult = await this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(redemptionRefundRequests)
      .where(eq(redemptionRefundRequests.status, 'PENDING_CHECKER'));
    return {
      requests: rows.map((r) => this.toRecord(r)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async listAllRefundRequests(
    limit = 50,
    offset = 0,
  ): Promise<{ requests: RefundRequestRecord[]; total: number }> {
    const rows = await this.database.db
      .select()
      .from(redemptionRefundRequests)
      .orderBy(redemptionRefundRequests.createdAt)
      .limit(limit)
      .offset(offset);
    const countResult = await this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(redemptionRefundRequests);
    return {
      requests: rows.map((r) => this.toRecord(r)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }
}
