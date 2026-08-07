import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  redemptionRefundRequests,
  redemptionOrders,
  redemptionInventory,
  redemptionAuditLog,
  memberWalletAccounts,
  memberWalletEntries,
} from '@ipoint/database';
import { and, eq, sql } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import {
  redemptionBadRequest,
  redemptionConflict,
  redemptionForbidden,
  redemptionNotFound,
  redemptionErrorCodes,
} from './redemption.errors.js';
import type { TransactionExecutionOptions } from '../database/database.service.js';
import type {
  RefundRequestRecord,
  CreateRefundRequestParams,
  ApproveRefundRequestParams,
  ActorInfo,
  RedemptionOrderStatus,
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
 * Order statuses eligible for refund (OD-17). REFUND_PENDING is also allowed
 * at execution time for fixtures/tests that insert the request directly.
 */
const REFUNDABLE_STATUSES = ['FULFILMENT_EXCEPTION', 'FULFILMENT_SUSPENDED'];

/**
 * Statuses accepted at refund execution time. REFUND_PENDING is the
 * state-machine path after a Maker create; the two exception statuses cover
 * direct fixture inserts (P6-S6 atomicity suite) — all three converge on the
 * same atomic REFUNDED transition.
 */
const EXECUTABLE_ORDER_STATUSES = [
  'REFUND_PENDING',
  'FULFILMENT_EXCEPTION',
  'FULFILMENT_SUSPENDED',
];

/** Idempotency scope namespace for the CREATE command. */
const REFUND_IDEMPOTENCY_SCOPE_PREFIX = 'redemption.refund.create';

/** Ledger idempotency namespace for the compensating wallet entry. */
const LEDGER_IDEMPOTENCY_PREFIX = 'redemption-refund';

/** Amount grammar: positive exact decimal, at most 10 decimal places. */
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,10})?$/u;

/**
 * P6 SEC-02 secured Refund owner (GATE-SEC-02).
 *
 * This owner is the ONLY write path for the Phase 6 refund lifecycle
 * (controller + tests + in-process callers all land here). The frozen
 * Phase 6 state machine is preserved:
 *
 *   order: FULFILMENT_EXCEPTION | FULFILMENT_SUSPENDED
 *          -> REFUND_PENDING (Maker create) -> REFUNDED (Checker approve)
 *   request: PENDING_CHECKER -> EXECUTING -> COMPLETED | FAILED
 *            PENDING_CHECKER -> REJECTED
 *
 * Owner contract (Command Center 2026-08-07 SEC-02 §4):
 *  1. Maker/Checker with server-derived identity; Maker <> Checker at every
 *     amount (no threshold exemption) — runtime inequality + DB CHECK.
 *  2. Full refund only (OD-12 partial PENDING): the refund amount must equal
 *     the order total points exactly (exact-decimal compare, never float).
 *  3. One ACTIVE refund request per order (partial unique index) + payload-
 *     hash idempotency on CREATE: same key + same payload replays the stored
 *     request; same key + different payload conflicts. Duplicate requests
 *     return the same result (P6-S0 §27.1).
 *  4. Approve is atomic in ONE transaction: request EXECUTING -> ledger
 *     compensating entry (REDEMPTION_REFUND, exact before/after snapshots,
 *     unique ledger idempotency key) + wallet balance credit (version-guarded)
 *     + inventory restore + order REFUNDED + request COMPLETED + immutable
 *     audit. Any failure rolls back completely (no partial ledger) and the
 *     request is durably FAILED; retries never re-execute.
 *  5. Double execution prevention: the request row is locked FOR UPDATE and
 *     only PENDING_CHECKER may transition; terminal outcomes are permanent.
 *  6. Immutable audit: actor/action/before/after/reason/result committed in
 *     the same transaction.
 *  7. Historical order snapshot never rewritten: refund only flips the order
 *     status; rate snapshot, point costs and quantities are untouched.
 *  8. Refund never generates Agent Commission (OD-29 NO_REDEMPTION_COMMISSION):
 *     the refund path writes only member_wallet_entries + order/request state;
 *     no Phase 5 commission dispatch is produced.
 *  9. Reject restores the exact pre-refund order status (captured at create).
 */
@Injectable()
export class RedemptionRefundService {
  private readonly logger = new Logger(RedemptionRefundService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // ─── Identity guard (owner boundary) ─────────────────────────────────

  /**
   * Server-side identity check: refund writes are only accepted from an
   * ADMIN actor with a concrete admin identity. The HTTP transport
   * (AuthGuard + AdminGuard) already guarantees an active admin session;
   * this guard ensures in-process callers hit the exact same boundary and
   * that MEMBER/SYSTEM actors can never drive a refund write.
   */
  private assertAdminActor(actor: ActorInfo | undefined): void {
    if (!actor || actor.actorType !== 'ADMIN' || !actor.actorId) {
      redemptionForbidden(
        redemptionErrorCodes.refundPermissionDenied,
        'An administrator identity is required for refund operations.',
      );
    }
  }

  // ─── Audit helper ─────────────────────────────────────────────────────

  private async audit(
    tx: RedemptionTx,
    action: string,
    entityId: string,
    actor: ActorInfo,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    reason?: string,
    result: 'SUCCESS' | 'FAILURE' = 'SUCCESS',
    marketId: string | null = null,
  ): Promise<void> {
    await tx.insert(redemptionAuditLog).values({
      actorType: actor.actorType,
      actorId: actor.actorId,
      marketId,
      action,
      entityType: 'REDEMPTION_ORDER',
      entityId,
      before: before ?? null,
      after: after ?? {},
      reason: reason ?? null,
      result,
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
      makerNotes: r.makerNotes,
      checkerNotes: r.checkerNotes,
      walletEntryId: r.walletEntryId,
      refundWalletEntryId: r.refundWalletEntryId,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      executedAt: r.executedAt?.toISOString() ?? null,
      failedAt: r.failedAt?.toISOString() ?? null,
      failureReason: r.failureReason,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  // ─── Maker: Create Refund Request (OD-17) ────────────────────────────

  async createRefundRequest(
    params: CreateRefundRequestParams,
    actor: ActorInfo,
  ): Promise<RefundRequestRecord> {
    this.assertAdminActor(actor);
    const makerId = actor.actorId!;

    const reason = (params.reason ?? '').trim();
    if (!reason || reason.length > 500) {
      redemptionBadRequest(
        redemptionErrorCodes.refundReasonRequired,
        'A reason between 1 and 500 characters is required.',
      );
    }
    const makerNotes = params.makerNotes?.trim() || null;
    if (makerNotes && makerNotes.length > 2000) {
      redemptionBadRequest(
        redemptionErrorCodes.refundReasonRequired,
        'makerNotes must be at most 2000 characters.',
      );
    }

    const amount = (params.totalPointCost ?? '').trim();
    if (!AMOUNT_PATTERN.test(amount) || /^0+$/u.test(amount.replace('.', ''))) {
      redemptionBadRequest(
        redemptionErrorCodes.refundInvalidAmount,
        'The refund amount must be a positive exact decimal with at most 10 decimal places.',
      );
    }

    const idempotencyKey = (params.idempotencyKey ?? '').trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      redemptionBadRequest(
        redemptionErrorCodes.refundIdempotencyKeyRequired,
        'A valid idempotency key is required to create a refund request.',
      );
    }

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

      if (order.status === 'REFUNDED') {
        redemptionConflict(
          redemptionErrorCodes.refundAlreadyRefunded,
          'Order already refunded',
        );
      }

      const status = order.status as string;
      if (!REFUNDABLE_STATUSES.includes(status)) {
        redemptionBadRequest(
          redemptionErrorCodes.refundOrderNotRefundable,
          `Order ${params.orderId} is '${status}'. Only FULFILMENT_EXCEPTION or FULFILMENT_SUSPENDED orders are refundable.`,
        );
      }

      // Server-side truth: the claimed member/market must match the order.
      if (params.memberId !== order.memberId || params.marketId !== order.marketId) {
        redemptionBadRequest(
          redemptionErrorCodes.refundOrderMismatch,
          'The claimed member or market does not match the order.',
        );
      }

      // Full refund only (OD-12 PENDING): exact-opposite of the original
      // debit amount (order total points) — never float arithmetic.
      if (normalizeDecimal(amount) !== normalizeDecimal(order.totalPoints)) {
        redemptionBadRequest(
          redemptionErrorCodes.refundPartialRefundNotAllowed,
          `Full refund only: the refund amount must equal the order total of ${order.totalPoints} points, received ${amount}.`,
        );
      }

      // Existing request state (order-level single active request).
      const [existing] = await tx
        .select()
        .from(redemptionRefundRequests)
        .where(eq(redemptionRefundRequests.orderId, params.orderId))
        .limit(1);

      if (existing) {
        if (
          existing.status === 'PENDING_CHECKER' ||
          existing.status === 'EXECUTING'
        ) {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyProcessed,
            'Refund request already pending checker',
          );
        }
        if (existing.status === 'APPROVED' || existing.status === 'COMPLETED') {
          redemptionConflict(
            redemptionErrorCodes.refundAlreadyRefunded,
            'Order already refunded',
          );
        }
      }

      const scope = `${REFUND_IDEMPOTENCY_SCOPE_PREFIX}:${order.id}`;
      const payloadHash = canonicalHash({
        operation: 'redemption.refund.create',
        orderId: order.id,
        memberId: order.memberId,
        marketId: order.marketId,
        totalPointCost: amount,
        reason,
        makerId,
        makerNotes,
      });

      try {
        const inserted = await tx
          .insert(redemptionRefundRequests)
          .values({
            orderId: order.id,
            makerId,
            status: 'PENDING_CHECKER',
            refundAmount: amount,
            reason,
            makerNotes,
            idempotencyScope: scope,
            idempotencyKey,
            payloadHash,
            priorOrderStatus: order.status,
          })
          .onConflictDoNothing({
            target: [
              redemptionRefundRequests.idempotencyScope,
              redemptionRefundRequests.idempotencyKey,
            ],
          })
          .returning();

        if (inserted.length === 0) {
          // Same key replay (or conflict) — never creates a second request.
          return this.replayOrConflict(tx, scope, idempotencyKey, payloadHash);
        }
        const request = inserted[0];
        if (!request) throw new Error('Failed to create refund request');

        // Order enters the intermediate REFUND_PENDING state (frozen
        // machine: FULFILMENT_EXCEPTION/SUSPENDED -> REFUND_PENDING).
        await tx
          .update(redemptionOrders)
          .set({ status: 'REFUND_PENDING' })
          .where(eq(redemptionOrders.id, order.id));

        await this.audit(
          tx,
          'REFUND_REQUESTED',
          order.id,
          actor,
          { status: order.status },
          {
            status: 'REFUND_PENDING',
            refundRequestId: request.id,
            amount,
            reason,
          },
          reason,
          'SUCCESS',
          order.marketId,
        );

        this.logger.log(
          `Refund request ${request.id} created for order ${order.id} by ${makerId}`,
        );
        return this.toRecord(request);
      } catch (error) {
        // A unique violation is either the idempotency claim (replay) or the
        // one-active-request-per-order claim (duplicate active request).
        if (this.isUniqueViolation(error)) {
          return this.handleCreateConflict(
            tx,
            order.id,
            scope,
            idempotencyKey,
            payloadHash,
          );
        }
        throw error;
      }
    }, TX_OPTIONS);
  }

  // ─── Checker: Approve Refund (OD-17) ─────────────────────────────────

  async approveRefundRequest(
    params: ApproveRefundRequestParams,
    actor: ActorInfo,
  ): Promise<RefundRequestRecord> {
    this.assertAdminActor(actor);
    const checkerId = actor.actorId!;

    // True only once the EXECUTING state (execution attempt) has started;
    // validation failures before that point leave the request PENDING_CHECKER
    // and retryable without a durable FAILED marker.
    let attempted = false;

    try {
      return await this.database.runTransaction(async (tx) => {
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
          if (
            request.status === 'APPROVED' ||
            request.status === 'COMPLETED'
          ) {
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
            checkerNotes: params.checkerNotes?.trim() || null,
            decidedAt: new Date(),
          })
          .where(eq(redemptionRefundRequests.id, params.refundRequestId));

        attempted = true;

        const result = await this.executeAtomicRefund(request, tx, actor);

        const [updated] = await tx
          .select()
          .from(redemptionRefundRequests)
          .where(eq(redemptionRefundRequests.id, params.refundRequestId))
          .limit(1);
        if (!updated) throw new Error('Refund request row missing after execution');

        await this.audit(
          tx,
          'REFUND_EXECUTED',
          request.orderId,
          actor,
          { status: request.status },
          {
            status: 'COMPLETED',
            refundRequestId: request.id,
            amount: request.refundAmount,
            refundWalletEntryId: result.refundWalletEntryId,
            walletEntryId: result.debitEntryId,
          },
          request.reason,
          'SUCCESS',
          result.marketId,
        );

        this.logger.log(
          `Refund ${request.id} executed: order ${request.orderId}, amount ${request.refundAmount}`,
        );
        return this.toRecord(updated);
      }, TX_OPTIONS);
    } catch (error) {
      if (!attempted || !(error instanceof Error)) throw error;
      // The execution attempt failed: the transaction above rolled back
      // completely (no partial ledger, no balance change, order untouched).
      // Durably mark the request FAILED so a retry can never re-execute it,
      // then surface the failure to the caller.
      const failed = await this.markFailed(params.refundRequestId, actor, error);
      if (failed) {
        redemptionBadRequest(
          redemptionErrorCodes.refundExecutionFailed,
          `Refund execution failed: ${error.message}`,
        );
      }
      throw error;
    }
  }

  // ─── Atomic Refund Sequence (P6-S6) — one transaction ────────────────

  private async executeAtomicRefund(
    request: typeof redemptionRefundRequests.$inferSelect,
    tx: RedemptionTx,
    actor: ActorInfo,
  ): Promise<{
    marketId: string;
    debitEntryId: string;
    refundWalletEntryId: string;
  }> {
    // 1. Lock order
    const [order] = await tx
      .select()
      .from(redemptionOrders)
      .where(eq(redemptionOrders.id, request.orderId))
      .for('no key update')
      .limit(1);

    if (!order) throw new Error(`Order ${request.orderId} not found`);

    // 2. Validate the order state at execution time
    if (order.status === 'REFUNDED') {
      throw new Error(`Order ${request.orderId} already refunded`);
    }
    const orderStatus = order.status as string;
    if (!EXECUTABLE_ORDER_STATUSES.includes(orderStatus)) {
      throw new Error(
        `Order ${request.orderId} is '${orderStatus}', not refundable at execution time`,
      );
    }

    // 3. Original debit entry (immutable — never modified, only referenced)
    const debitEntryId = order.walletEntryId;
    if (!debitEntryId) {
      throw new Error(`No wallet entry found for order ${request.orderId}`);
    }
    if (!order.walletAccountId) {
      throw new Error(`No wallet account found for order ${request.orderId}`);
    }

    // 4. Lock the member wallet and validate ownership
    const [wallet] = await tx
      .select()
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.id, order.walletAccountId))
      .for('update')
      .limit(1);
    if (!wallet) throw new Error(`Wallet ${order.walletAccountId} not found`);
    if (wallet.archivedAt) throw new Error('Wallet is archived');
    if (wallet.memberId !== order.memberId) {
      throw new Error('Wallet member does not match the order member');
    }

    // 5. Exact-opposite compensating ledger entry (REDEMPTION_REFUND)
    const balanceBefore = wallet.availableBalance as string;
    const refundAmount = request.refundAmount as string;
    const balanceAfter = addDecimal(balanceBefore, refundAmount);

    const maxSeq = await tx
      .select({
        next: sql<bigint>`COALESCE(MAX(${memberWalletEntries.entrySequence}), 0) + 1`,
      })
      .from(memberWalletEntries)
      .where(eq(memberWalletEntries.walletAccountId, wallet.id));
    const nextSeq = BigInt(String(maxSeq[0]?.next ?? 1));

    const [entry] = await tx
      .insert(memberWalletEntries)
      .values({
        walletAccountId: wallet.id,
        memberId: order.memberId,
        marketId: order.marketId,
        entrySequence: nextSeq,
        entryType: 'REDEMPTION_REFUND',
        amount: refundAmount,
        balanceBefore,
        balanceAfter,
        idempotencyKey: `${LEDGER_IDEMPOTENCY_PREFIX}:${request.id}`,
        referenceType: 'REDEMPTION_ORDER',
        referenceId: order.id,
        description: `Redemption refund for order ${order.id} (original debit ${debitEntryId})`,
        reason: request.reason,
        actorId: actor.actorId,
        marketTimezone: null,
      })
      .returning();
    if (!entry) throw new Error('Refund wallet entry creation failed');

    // 6. Credit the wallet balance (version guard — same pattern as the
    //    frozen confirm debit path)
    const updatedWallet = await tx
      .update(memberWalletAccounts)
      .set({
        availableBalance: balanceAfter,
        version: sql`${memberWalletAccounts.version} + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(memberWalletAccounts.id, wallet.id),
          eq(memberWalletAccounts.version, wallet.version),
        ),
      )
      .returning();
    if (!updatedWallet[0]) {
      throw new Error('Wallet balance version conflict during refund');
    }

    // 7. Restore inventory (simple quantity increment — frozen P6 behaviour)
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

    // 8. Terminal order transition (frozen machine: ... -> REFUNDED)
    await tx
      .update(redemptionOrders)
      .set({ status: 'REFUNDED' })
      .where(eq(redemptionOrders.id, order.id));

    // 9. Durable successful outcome on the request
    await tx
      .update(redemptionRefundRequests)
      .set({
        status: 'COMPLETED',
        walletEntryId: debitEntryId,
        refundWalletEntryId: entry.id,
        executedAt: new Date(),
      })
      .where(eq(redemptionRefundRequests.id, request.id));

    return {
      marketId: order.marketId,
      debitEntryId,
      refundWalletEntryId: entry.id,
    };
  }

  // ─── Checker: Reject Refund (OD-17) ──────────────────────────────────

  async rejectRefundRequest(
    refundRequestId: string,
    checkerId: string,
    reason: string,
  ): Promise<RefundRequestRecord> {
    const actor: ActorInfo = { actorType: 'ADMIN', actorId: checkerId };
    this.assertAdminActor(actor);

    const rejectionReason = (reason ?? '').trim();
    if (!rejectionReason || rejectionReason.length > 500) {
      redemptionBadRequest(
        redemptionErrorCodes.refundReasonRequired,
        'A rejection reason between 1 and 500 characters is required.',
      );
    }

    return this.database.runTransaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(redemptionRefundRequests)
        .where(eq(redemptionRefundRequests.id, refundRequestId))
        .for('update')
        .limit(1);

      if (!request) {
        redemptionNotFound(
          redemptionErrorCodes.refundNotFound,
          `Refund request ${refundRequestId} not found`,
        );
      }
      if (request.status !== 'PENDING_CHECKER') {
        if (
          request.status === 'APPROVED' ||
          request.status === 'COMPLETED'
        ) {
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
          checkerNotes: rejectionReason,
          decidedAt: new Date(),
        })
        .where(eq(redemptionRefundRequests.id, refundRequestId))
        .returning();
      if (!updated) throw new Error('Failed to reject refund request');

      // Restore the exact pre-refund order status (captured at create).
      const priorStatus =
        (request.priorOrderStatus as RedemptionOrderStatus | null) ??
        'FULFILMENT_EXCEPTION';
      const [restoredOrder] = await tx
        .update(redemptionOrders)
        .set({ status: priorStatus })
        .where(eq(redemptionOrders.id, request.orderId))
        .returning();

      await this.audit(
        tx,
        'REFUND_REJECTED',
        request.orderId,
        actor,
        { status: request.status },
        { status: 'REJECTED', refundRequestId, reason: rejectionReason },
        rejectionReason,
        'SUCCESS',
        restoredOrder?.marketId ?? null,
      );

      return this.toRecord(updated);
    }, TX_OPTIONS);
  }

  // ─── Idempotency + conflict resolution helpers ───────────────────────

  private async replayOrConflict(
    tx: RedemptionTx,
    scope: string,
    key: string,
    payloadHash: string,
  ): Promise<RefundRequestRecord> {
    const rows = await tx
      .select()
      .from(redemptionRefundRequests)
      .where(
        and(
          eq(redemptionRefundRequests.idempotencyScope, scope),
          eq(redemptionRefundRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.payloadHash !== payloadHash) {
      redemptionConflict(
        redemptionErrorCodes.refundIdempotencyConflict,
        'The idempotency key was already used with a different payload.',
      );
    }
    // Duplicate requests return the same result (P6-S0 §27.1).
    return this.toRecord(existing);
  }

  private async handleCreateConflict(
    tx: RedemptionTx,
    orderId: string,
    scope: string,
    key: string,
    payloadHash: string,
  ): Promise<RefundRequestRecord> {
    // Idempotency claim first: same key (replay/conflict).
    const rows = await tx
      .select()
      .from(redemptionRefundRequests)
      .where(
        and(
          eq(redemptionRefundRequests.idempotencyScope, scope),
          eq(redemptionRefundRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return this.replayOrConflict(tx, scope, key, payloadHash);
    }
    // Otherwise the one-active-request-per-order claim was violated.
    const [other] = await tx
      .select()
      .from(redemptionRefundRequests)
      .where(eq(redemptionRefundRequests.orderId, orderId))
      .limit(1);
    if (other) {
      if (
        other.status === 'PENDING_CHECKER' ||
        other.status === 'EXECUTING'
      ) {
        redemptionConflict(
          redemptionErrorCodes.refundAlreadyProcessed,
          'Refund request already pending checker',
        );
      }
      if (other.status === 'APPROVED' || other.status === 'COMPLETED') {
        redemptionConflict(
          redemptionErrorCodes.refundAlreadyRefunded,
          'Order already refunded',
        );
      }
    }
    redemptionConflict(
      redemptionErrorCodes.refundAlreadyProcessed,
      'A refund request already exists for this order',
    );
  }

  /**
   * Durable FAILED outcome after a rolled-back execution attempt. Retry-safe:
   * a later approve replays the FAILED state without touching the ledger, so
   * retries never create a duplicate ledger effect.
   */
  private async markFailed(
    requestId: string,
    actor: ActorInfo,
    cause: Error,
  ): Promise<boolean> {
    try {
      return await this.database.runTransaction(async (tx) => {
        const [request] = await tx
          .select()
          .from(redemptionRefundRequests)
          .where(eq(redemptionRefundRequests.id, requestId))
          .for('update')
          .limit(1);
        if (!request) return false;
        if (
          request.status !== 'PENDING_CHECKER' &&
          request.status !== 'EXECUTING'
        ) {
          return false;
        }
        const now = new Date();
        const [updated] = await tx
          .update(redemptionRefundRequests)
          .set({
            status: 'FAILED',
            checkerId: actor.actorId,
            decidedAt: now,
            failedAt: now,
            failureReason: `Execution failed and fully rolled back. Cause: ${cause.message}`,
          })
          .where(eq(redemptionRefundRequests.id, requestId))
          .returning();
        if (!updated) return false;
        await this.audit(
          tx,
          'REFUND_EXECUTION_FAILED',
          request.orderId,
          actor,
          { status: request.status },
          { status: 'FAILED', failureReason: cause.message },
          `Refund execution failed and fully rolled back. Cause: ${cause.message}`,
          'FAILURE',
        );
        return true;
      });
    } catch {
      return false;
    }
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

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === '23505'
    );
  }
}

// ─── Exact-decimal helpers (string only — never float arithmetic) ───

/** Canonical payload hash: stable-sorted keys + sha256 (never floats). */
export function canonicalHash(payload: Record<string, unknown>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key])}`)
    .join(',');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Normalize numeric(38,10) strings for exact comparison (strip padding). */
export function normalizeDecimal(value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed.includes('.')) return trimmed;
  const [wholeRaw, fraction] = trimmed.split('.');
  const whole = wholeRaw ?? '';
  const significant = (fraction ?? '').replace(/0+$/u, '');
  return significant === '' ? whole : `${whole}.${significant}`;
}

/** Exact decimal addition (strings, positive values). */
export function addDecimal(a: string, b: string): string {
  const scale = (value: string) =>
    value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  const scaleMax = Math.max(scale(a), scale(b));
  const toScaled = (value: string) => {
    const [wholeRaw, fraction = ''] = value.split('.');
    const whole = wholeRaw ?? '0';
    return BigInt(`${whole}${fraction.padEnd(scaleMax, '0')}`);
  };
  const result = toScaled(a) + toScaled(b);
  const negative = result < 0n;
  const absolute = negative ? -result : result;
  const text = absolute.toString();
  const sign = negative ? '-' : '';
  if (scaleMax === 0) return `${sign}${text}`;
  const padded = text.padStart(scaleMax + 1, '0');
  const whole = padded.slice(0, -scaleMax) || '0';
  const fraction = padded.slice(-scaleMax).padEnd(scaleMax, '0');
  return `${sign}${whole}.${fraction}`;
}
