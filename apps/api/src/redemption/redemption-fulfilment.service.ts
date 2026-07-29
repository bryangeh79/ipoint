import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  redemptionFulfilments,
  redemptionOrders,
  redemptionInventory,
  redemptionAuditLog,
  redemptionPickupLocations,
  redemptionWaitlistEntries,
} from '@ipoint/database';
import { and, eq, sql } from 'drizzle-orm';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import {
  redemptionBadRequest,
  redemptionConflict,
  redemptionForbidden,
  redemptionNotFound,
  redemptionErrorCodes,
} from './redemption.errors.js';
import type { TransactionExecutionOptions } from '../database/database.service.js';
import type {
  FulfilmentRecord,
  CreateFulfilmentParams,
  UpdateFulfilmentStatusParams,
  ActorInfo,
  PickupVerificationResult,
  VoucherRevealResult,
  WaitlistSubscription,
} from './redemption.types.js';

const TX_OPTIONS: TransactionExecutionOptions = {
  statementTimeoutMs: 5000,
  lockTimeoutMs: 3000,
  maxRetries: 3,
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [0, 5000, 30000, 120000];

/**
 * Valid order status transitions per P6 Contract §20.
 */
const ORDER_TRANSITIONS: Record<string, string[]> = {
  CONFIRMED: ['PROCESSING', 'BACKORDERED', 'FULFILMENT_SUSPENDED', 'FULFILLED'],
  PROCESSING: [
    'READY_FOR_PICKUP',
    'FULFILLED',
    'FULFILMENT_EXCEPTION',
    'FULFILMENT_SUSPENDED',
  ],
  READY_FOR_PICKUP: ['FULFILLED', 'FULFILMENT_SUSPENDED'],
  BACKORDERED: ['PROCESSING', 'FULFILMENT_SUSPENDED'],
  FULFILMENT_SUSPENDED: ['PROCESSING', 'READY_FOR_PICKUP', 'REFUND_PENDING'],
  FULFILMENT_EXCEPTION: ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
  FULFILLED: [],
};

const NON_RETRYABLE_KEYWORDS = [
  'invalid address',
  'invalid item',
  'invalid member',
  'fraud detected',
  'cancelled by provider',
  'item not found',
  'permission denied',
];

@Injectable()
export class RedemptionFulfilmentService {
  private readonly logger = new Logger(RedemptionFulfilmentService.name);
  private encryptionKey!: Buffer;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {
    const keyHex = process.env['REDEMPTION_VOUCHER_ENCRYPTION_KEY'] ?? '';
    if (keyHex) {
      this.encryptionKey = Buffer.from(keyHex, 'hex');
      if (this.encryptionKey.length !== 32) {
        throw new Error(
          'REDEMPTION_VOUCHER_ENCRYPTION_KEY must be 64 hex chars',
        );
      }
    }
  }

  // ─── Row Mapper ───────────────────────────────────────────────────────

  private toRecord(
    r: typeof redemptionFulfilments.$inferSelect,
  ): FulfilmentRecord {
    return {
      id: r.id,
      orderId: r.orderId,
      fulfilmentType: r.fulfilmentType as FulfilmentRecord['fulfilmentType'],
      status: r.status as FulfilmentRecord['status'],
      pickupLocationId: null,
      pickupCode: null,
      shippingAddress: r.shippingAddress as Record<string, unknown> | null,
      trackingNumber: r.trackingNumber,
      courier: r.courier,
      estimatedDeliveryDate: r.estimatedDeliveryDate ?? null,
      digitalValueEncrypted: null,
      voucherExpiresAt: null,
      serviceScheduledAt: r.serviceScheduledAt?.toISOString() ?? null,
      serviceNotes: r.serviceNotes,
      fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
      failedAt: r.failedAt?.toISOString() ?? null,
      failureReason: r.failureReason,
      retryCount: r.retryCount,
      maxRetries: MAX_RETRIES,
      nextRetryAt: null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  // ─── Audit helper ─────────────────────────────────────────────────────

  private async audit(
    tx: any,
    action: string,
    entityType: string,
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
      entityType,
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

  // ─── Create Fulfilment ────────────────────────────────────────────────

  async createFulfilment(
    params: CreateFulfilmentParams,
    actor: ActorInfo,
  ): Promise<FulfilmentRecord> {
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

      const os = order.status as string;
      if (!['CONFIRMED', 'PROCESSING', 'BACKORDERED'].includes(os)) {
        redemptionBadRequest(
          redemptionErrorCodes.fulfilmentInvalidTransition,
          `Order ${params.orderId} is '${os}' — cannot start fulfilment`,
        );
      }

      // Check duplicate
      const [existing] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.orderId, params.orderId))
        .limit(1);

      if (existing) {
        redemptionConflict(
          redemptionErrorCodes.fulfilmentAlreadyExists,
          `Fulfilment already exists for order ${params.orderId}`,
        );
      }

      // Validate pickup location
      if (params.pickupLocationId) {
        const [loc] = await tx
          .select()
          .from(redemptionPickupLocations)
          .where(
            and(
              eq(redemptionPickupLocations.id, params.pickupLocationId),
              eq(redemptionPickupLocations.isActive, true),
            ),
          )
          .limit(1);
        if (!loc) {
          redemptionNotFound(
            redemptionErrorCodes.pickupLocationNotFound,
            `Pickup location ${params.pickupLocationId} not found/inactive`,
          );
        }
      }

      const ft = params.fulfilmentType as 'PHYSICAL' | 'DIGITAL' | 'SERVICE';

      const [inserted] = await tx
        .insert(redemptionFulfilments)
        .values({
          orderId: params.orderId,
          fulfilmentType: ft,
          status: 'PENDING',
          shippingAddress: params.shippingAddress
            ? (params.shippingAddress as any)
            : null,
          trackingNumber: params.trackingNumber ?? null,
          courier: params.courier ?? null,
          estimatedDeliveryDate: params.estimatedDeliveryDate ?? null,
          serviceScheduledAt: params.serviceScheduledAt
            ? new Date(params.serviceScheduledAt)
            : null,
          serviceNotes: params.serviceNotes ?? null,
        })
        .returning();
      if (!inserted) throw new Error('Failed to create fulfilment record');

      // Advance order to PROCESSING
      if (os === 'CONFIRMED' || os === 'BACKORDERED') {
        await tx
          .update(redemptionOrders)
          .set({ status: 'PROCESSING' } as any)
          .where(eq(redemptionOrders.id, params.orderId));
      }

      await this.audit(
        tx,
        'FULFILMENT_CREATED',
        'REDEMPTION_ORDER',
        params.orderId,
        actor,
        { fulfilmentId: inserted.id, fulfilmentType: ft },
        'Fulfilment created',
      );

      // Auto-fulfil digital items
      if (ft === 'DIGITAL') {
        return this.completeDigital(inserted, order, actor, tx);
      }

      return this.toRecord(inserted);
    }, TX_OPTIONS);
  }

  // ─── Digital Auto-fulfilment ──────────────────────────────────────────

  private async completeDigital(
    fulfilment: typeof redemptionFulfilments.$inferSelect,
    order: typeof redemptionOrders.$inferSelect,
    actor: ActorInfo,
    tx: any,
  ): Promise<FulfilmentRecord> {
    const code = this.generateCode();
    const encrypted = this.encrypt(code);
    const hash = createHash('sha256').update(code).digest('hex');

    // Store encryted value on fulfilment
    await tx
      .update(redemptionFulfilments)
      .set({
        status: 'COMPLETED',
        digitalValue: encrypted,
        fulfilledAt: new Date(),
      } as any)
      .where(eq(redemptionFulfilments.id, fulfilment.id));

    // Mark order FULFILLED
    await tx
      .update(redemptionOrders)
      .set({ status: 'FULFILLED' } as any)
      .where(eq(redemptionOrders.id, order.id));

    await this.audit(
      tx,
      'FULFILMENT_COMPLETED',
      'REDEMPTION_ORDER',
      order.id,
      actor,
      {
        fulfilmentId: fulfilment.id,
        fulfilmentType: 'DIGITAL',
        hashPrefix: hash.substring(0, 16),
      },
      'Digital auto-fulfilment',
    );

    const [updated] = await tx
      .select()
      .from(redemptionFulfilments)
      .where(eq(redemptionFulfilments.id, fulfilment.id))
      .limit(1);
    return this.toRecord(updated!);
  }

  // ─── Voucher Crypto ───────────────────────────────────────────────────

  private generateCode(): string {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = randomBytes(16);
    let code = '';
    for (let i = 0; i < 16; i++) {
      code += charset[buf[i]! % charset.length]!;
      if ((i + 1) % 4 === 0 && i < 15) code += '-';
    }
    return code;
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  }

  private decrypt(data: string): string {
    const buf = Buffer.from(data, 'base64');
    const iv = buf.subarray(0, 16);
    const tag = buf.subarray(16, 32);
    const ct = buf.subarray(32);
    const d = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    d.setAuthTag(tag);
    return d.update(ct, undefined, 'utf-8') + d.final('utf-8');
  }

  // ─── Voucher Reveal ───────────────────────────────────────────────────

  async revealVoucher(
    orderId: string,
    memberId: string | null,
    actor: ActorInfo,
  ): Promise<VoucherRevealResult> {
    const [order] = await this.database.db
      .select()
      .from(redemptionOrders)
      .where(eq(redemptionOrders.id, orderId))
      .limit(1);
    if (!order)
      redemptionNotFound(
        redemptionErrorCodes.fulfilmentOrderNotFound,
        `Order ${orderId} not found`,
      );

    if (actor.actorType === 'MEMBER' && order.memberId !== memberId) {
      redemptionForbidden(
        redemptionErrorCodes.voucherRevealNotAuthorized,
        'Only own voucher codes can be viewed',
      );
    }
    if (order.status !== 'FULFILLED') {
      redemptionBadRequest(
        redemptionErrorCodes.fulfilmentInvalidTransition,
        `Order ${orderId} not fulfilled`,
      );
    }

    const [f] = await this.database.db
      .select()
      .from(redemptionFulfilments)
      .where(eq(redemptionFulfilments.orderId, orderId))
      .limit(1);
    if (!f || !f.digitalValue)
      redemptionNotFound(
        redemptionErrorCodes.fulfilmentNotFound,
        `No digital value for order ${orderId}`,
      );

    const plain = this.decrypt(f.digitalValue);
    const [audit] = await this.database.db
      .insert(redemptionAuditLog)
      .values({
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'VOUCHER_REVEAL',
        entityType: 'REDEMPTION_ORDER',
        entityId: orderId,
        after: { orderId },
        result: 'SUCCESS',
        occurredAt: new Date(),
      })
      .returning();
    if (!audit) throw new Error('Failed to create audit log entry');

    return { code: plain, orderId, auditEventId: audit.id };
  }

  // ─── Pickup Code ──────────────────────────────────────────────────────

  async generatePickupCode(fulfilmentId: string): Promise<string> {
    return this.database.runTransaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.id, fulfilmentId))
        .limit(1);
      if (!f)
        redemptionNotFound(
          redemptionErrorCodes.fulfilmentNotFound,
          `Fulfilment ${fulfilmentId} not found`,
        );
      if (f.fulfilmentType !== 'PHYSICAL') {
        redemptionBadRequest(
          redemptionErrorCodes.fulfilmentInvalidType,
          'Pickup codes only for physical fulfilment',
        );
      }

      const code = randomBytes(6)
        .toString('base64url')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .substring(0, 8);
      const codeHash = createHash('sha256').update(code).digest('hex');

      await tx
        .update(redemptionFulfilments)
        .set({
          digitalValue: `PICKUP_HASH:${codeHash}`,
        } as any)
        .where(eq(redemptionFulfilments.id, fulfilmentId));

      await this.audit(
        tx,
        'PICKUP_CODE_GENERATED',
        'REDEMPTION_FULFILMENT',
        fulfilmentId,
        { actorType: 'SYSTEM', actorId: null },
        { hashPrefix: codeHash.substring(0, 16) },
      );

      return code;
    }, TX_OPTIONS);
  }

  async verifyPickup(
    fulfilmentId: string,
    code: string,
    actor: ActorInfo,
  ): Promise<PickupVerificationResult> {
    return this.database.runTransaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.id, fulfilmentId))
        .limit(1);
      if (!f)
        return {
          verified: false,
          orderId: '',
          memberId: '',
          failureReason: 'Not found',
        };

      const stored = f.digitalValue ?? '';
      if (!stored.startsWith('PICKUP_HASH:')) {
        return {
          verified: false,
          orderId: f.orderId,
          memberId: '',
          failureReason: 'No pickup code',
        };
      }
      const storedHash = stored.slice('PICKUP_HASH:'.length);
      const providedHash = createHash('sha256').update(code).digest('hex');
      if (storedHash !== providedHash) {
        return {
          verified: false,
          orderId: f.orderId,
          memberId: '',
          failureReason: 'Invalid code',
        };
      }

      const [order] = await tx
        .select()
        .from(redemptionOrders)
        .where(eq(redemptionOrders.id, f.orderId))
        .limit(1);
      if (!order)
        return {
          verified: false,
          orderId: f.orderId,
          memberId: '',
          failureReason: 'Order not found',
        };
      if (order.status !== 'READY_FOR_PICKUP') {
        return {
          verified: false,
          orderId: f.orderId,
          memberId: order.memberId,
          failureReason: 'Not ready for pickup',
        };
      }

      await tx
        .update(redemptionFulfilments)
        .set({ status: 'COMPLETED', fulfilledAt: new Date() } as any)
        .where(eq(redemptionFulfilments.id, fulfilmentId));
      await tx
        .update(redemptionOrders)
        .set({ status: 'FULFILLED' } as any)
        .where(eq(redemptionOrders.id, f.orderId));

      await this.audit(
        tx,
        'PICKUP_VERIFIED',
        'REDEMPTION_ORDER',
        f.orderId,
        actor,
        { fulfilmentId },
      );
      return { verified: true, orderId: f.orderId, memberId: order.memberId };
    }, TX_OPTIONS);
  }

  // ─── Fulfilment Status Update ─────────────────────────────────────────

  async updateStatus(
    params: UpdateFulfilmentStatusParams,
    actor: ActorInfo,
  ): Promise<FulfilmentRecord> {
    return this.database.runTransaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.id, params.fulfilmentId))
        .limit(1);
      if (!f)
        redemptionNotFound(
          redemptionErrorCodes.fulfilmentNotFound,
          `Fulfilment ${params.fulfilmentId} not found`,
        );

      const valid: Record<string, string[]> = {
        PENDING: ['IN_PROGRESS', 'FAILED'],
        IN_PROGRESS: ['COMPLETED', 'FAILED'],
        COMPLETED: [],
        FAILED: [],
      };
      const allowed = valid[f.status] ?? [];
      if (!allowed.includes(params.status)) {
        redemptionBadRequest(
          redemptionErrorCodes.fulfilmentInvalidTransition,
          `Cannot transition from ${f.status} to ${params.status}`,
        );
      }

      const updates: Record<string, unknown> = { status: params.status };
      if (params.trackingNumber) updates.trackingNumber = params.trackingNumber;
      if (params.courier) updates.courier = params.courier;
      if (params.failureReason) updates.failureReason = params.failureReason;
      if (params.status === 'COMPLETED') updates.fulfilledAt = new Date();
      if (params.status === 'FAILED') updates.failedAt = new Date();

      await tx
        .update(redemptionFulfilments)
        .set(updates as any)
        .where(eq(redemptionFulfilments.id, params.fulfilmentId));

      // Map fulfilment completion to order status
      if (params.status === 'COMPLETED') {
        await tx
          .update(redemptionOrders)
          .set({ status: 'FULFILLED' } as any)
          .where(eq(redemptionOrders.id, f.orderId));
      }

      if (params.status === 'FAILED') {
        await this.handleFailure(
          f,
          params.failureReason ?? 'Unknown',
          actor,
          tx,
        );
      }

      await this.audit(
        tx,
        `FULFILMENT_${params.status}`,
        'REDEMPTION_FULFILMENT',
        params.fulfilmentId,
        actor,
        {
          fromStatus: f.status,
          toStatus: params.status,
          trackingNumber: params.trackingNumber,
        },
      );

      const [updated] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.id, params.fulfilmentId))
        .limit(1);
      return this.toRecord(updated!);
    }, TX_OPTIONS);
  }

  // ─── Failure & Retry (OD-26) ──────────────────────────────────────────

  private async handleFailure(
    fulfilment: typeof redemptionFulfilments.$inferSelect,
    reason: string,
    actor: ActorInfo,
    tx: any,
  ): Promise<void> {
    const attempt = fulfilment.retryCount + 1;
    const nonRetryable = NON_RETRYABLE_KEYWORDS.some((kw) =>
      reason.toLowerCase().includes(kw),
    );

    if (nonRetryable) {
      await tx
        .update(redemptionOrders)
        .set({ status: 'FULFILMENT_EXCEPTION' } as any)
        .where(eq(redemptionOrders.id, fulfilment.orderId));
      this.logger.error(
        `Non-retryable: fulfilment ${fulfilment.id} → FULFILMENT_EXCEPTION: ${reason}`,
      );
      return;
    }

    if (attempt >= MAX_RETRIES) {
      await tx
        .update(redemptionOrders)
        .set({ status: 'FULFILMENT_EXCEPTION' } as any)
        .where(eq(redemptionOrders.id, fulfilment.orderId));
      this.logger.warn(
        `Max retries (${MAX_RETRIES}) for fulfilment ${fulfilment.id}`,
      );
    } else {
      await tx
        .update(redemptionFulfilments)
        .set({
          status: 'PENDING',
          retryCount: attempt,
          failureReason: `Retry ${attempt}/${MAX_RETRIES}: ${reason}`,
        } as any)
        .where(eq(redemptionFulfilments.id, fulfilment.id));
      const delay =
        RETRY_DELAY_MS[Math.min(attempt, RETRY_DELAY_MS.length - 1)];
      this.logger.warn(
        `Fulfilment ${fulfilment.id} failed. Retry ${attempt}/${MAX_RETRIES} in ${delay}ms`,
      );
    }
  }

  async retryFulfilment(
    fulfilmentId: string,
    actor: ActorInfo,
  ): Promise<FulfilmentRecord> {
    return this.database.runTransaction(async (tx) => {
      const [f] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.id, fulfilmentId))
        .limit(1);
      if (!f)
        redemptionNotFound(
          redemptionErrorCodes.fulfilmentNotFound,
          `Fulfilment ${fulfilmentId} not found`,
        );
      if (f.status !== 'FAILED') {
        redemptionBadRequest(
          redemptionErrorCodes.fulfilmentInvalidTransition,
          `Fulfilment ${fulfilmentId} is not FAILED`,
        );
      }

      await tx
        .update(redemptionFulfilments)
        .set({ status: 'PENDING', failureReason: null } as any)
        .where(eq(redemptionFulfilments.id, fulfilmentId));
      await this.audit(
        tx,
        'FULFILMENT_RETRY',
        'REDEMPTION_FULFILMENT',
        fulfilmentId,
        actor,
        {},
      );

      const [updated] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.id, fulfilmentId))
        .limit(1);
      return this.toRecord(updated!);
    }, TX_OPTIONS);
  }

  // ─── Suspension (OD-28) ───────────────────────────────────────────────

  async suspendOrder(
    orderId: string,
    reason: string,
    actor: ActorInfo,
  ): Promise<void> {
    await this.transitionOrder(orderId, 'FULFILMENT_SUSPENDED', reason, actor);
  }

  async resumeOrder(orderId: string, actor: ActorInfo): Promise<string> {
    return this.database.runTransaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(redemptionOrders)
        .where(eq(redemptionOrders.id, orderId))
        .limit(1);
      if (!order)
        redemptionNotFound(
          redemptionErrorCodes.fulfilmentOrderNotFound,
          `Order ${orderId} not found`,
        );
      if (order.status !== 'FULFILMENT_SUSPENDED') {
        redemptionBadRequest(
          redemptionErrorCodes.orderNotSuspended,
          `Order ${orderId} not suspended`,
        );
      }

      const [f] = await tx
        .select()
        .from(redemptionFulfilments)
        .where(eq(redemptionFulfilments.orderId, orderId))
        .limit(1);
      let target = 'CONFIRMED';
      if (f) {
        target =
          f.fulfilmentType === 'PHYSICAL'
            ? 'PROCESSING'
            : f.status === 'COMPLETED'
              ? 'FULFILLED'
              : 'PROCESSING';
      }

      await tx
        .update(redemptionOrders)
        .set({ status: target } as any)
        .where(eq(redemptionOrders.id, orderId));
      await this.audit(
        tx,
        'ORDER_RESUMED',
        'REDEMPTION_ORDER',
        orderId,
        actor,
        { previousStatus: 'FULFILMENT_SUSPENDED', newStatus: target },
      );
      return target;
    }, TX_OPTIONS);
  }

  // ─── Backorder (OD-27) ────────────────────────────────────────────────

  async moveToBackorder(
    orderId: string,
    eta: string | null,
    actor: ActorInfo,
  ): Promise<void> {
    await this.transitionOrder(
      orderId,
      'BACKORDERED',
      eta ? `Est. restock: ${eta}` : 'Backordered',
      actor,
    );
  }

  async processRestock(orderId: string, actor: ActorInfo): Promise<void> {
    await this.transitionOrder(
      orderId,
      'PROCESSING',
      'Restock received',
      actor,
    );
  }

  // ─── Waitlist (OD-27) ─────────────────────────────────────────────────

  async subscribeWaitlist(
    memberId: string,
    marketId: string,
    itemId: string,
    requestedQuantity = '1',
  ): Promise<WaitlistSubscription> {
    return this.database.runTransaction(async (tx) => {
      // Check if already subscribed
      const [existing] = await tx
        .select()
        .from(redemptionWaitlistEntries)
        .where(
          and(
            eq(redemptionWaitlistEntries.memberId, memberId),
            eq(redemptionWaitlistEntries.catalogItemId, itemId),
          ),
        )
        .limit(1);

      if (existing) {
        if (existing.status === 'ACTIVE' || existing.status === 'NOTIFIED') {
          redemptionConflict(
            redemptionErrorCodes.waitlistAlreadyExists,
            `Member ${memberId} already subscribed to item ${itemId} (status: ${existing.status})`,
          );
        }
        // Re-activate expired/cancelled subscription
        await tx
          .update(redemptionWaitlistEntries)
          .set({
            status: 'ACTIVE',
            requestedQuantity,
            expiredAt: null,
            notifiedAt: null,
          } as any)
          .where(eq(redemptionWaitlistEntries.id, existing.id));

        const [updated] = await tx
          .select()
          .from(redemptionWaitlistEntries)
          .where(eq(redemptionWaitlistEntries.id, existing.id))
          .limit(1);
        return this.toWaitlistSubscription(updated!);
      }

      const [inserted] = await tx
        .insert(redemptionWaitlistEntries)
        .values({
          memberId,
          catalogItemId: itemId,
          marketId,
          status: 'ACTIVE',
          requestedQuantity,
        })
        .returning();

      return this.toWaitlistSubscription(inserted!);
    }, TX_OPTIONS);
  }

  async cancelWaitlist(
    subscriptionId: string,
    actor?: ActorInfo,
  ): Promise<void> {
    await this.database.runTransaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(redemptionWaitlistEntries)
        .where(eq(redemptionWaitlistEntries.id, subscriptionId))
        .limit(1);

      if (!entry) {
        redemptionNotFound(
          redemptionErrorCodes.waitlistNotFound,
          `Waitlist subscription ${subscriptionId} not found`,
        );
      }

      await tx
        .update(redemptionWaitlistEntries)
        .set({ status: 'CANCELLED' } as any)
        .where(eq(redemptionWaitlistEntries.id, subscriptionId));

      if (actor) {
        await this.audit(
          tx,
          'WAITLIST_CANCELLED',
          'REDEMPTION_WAITLIST',
          subscriptionId,
          actor,
          { memberId: entry.memberId, itemId: entry.catalogItemId },
        );
      }
    }, TX_OPTIONS);
  }

  async notifyWaitlist(itemId: string): Promise<number> {
    return this.database.runTransaction(async (tx) => {
      const entries = await tx
        .select()
        .from(redemptionWaitlistEntries)
        .where(
          and(
            eq(redemptionWaitlistEntries.catalogItemId, itemId),
            eq(redemptionWaitlistEntries.status, 'ACTIVE'),
          ),
        );

      for (const entry of entries) {
        await tx
          .update(redemptionWaitlistEntries)
          .set({ status: 'NOTIFIED', notifiedAt: new Date() } as any)
          .where(eq(redemptionWaitlistEntries.id, entry.id));
      }

      return entries.length;
    }, TX_OPTIONS);
  }

  async expireWaitlist(subscriptionId: string): Promise<void> {
    await this.database.runTransaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(redemptionWaitlistEntries)
        .where(eq(redemptionWaitlistEntries.id, subscriptionId))
        .limit(1);

      if (!entry) {
        redemptionNotFound(
          redemptionErrorCodes.waitlistNotFound,
          `Waitlist subscription ${subscriptionId} not found`,
        );
      }

      await tx
        .update(redemptionWaitlistEntries)
        .set({ status: 'EXPIRED', expiredAt: new Date() } as any)
        .where(eq(redemptionWaitlistEntries.id, subscriptionId));
    }, TX_OPTIONS);
  }

  // ─── Waitlist Row Mapper ────────────────────────────────────────────

  private toWaitlistSubscription(
    r: typeof redemptionWaitlistEntries.$inferSelect,
  ): WaitlistSubscription {
    return {
      id: r.id,
      memberId: r.memberId,
      marketId: r.marketId,
      itemId: r.catalogItemId,
      isActive: r.status === 'ACTIVE',
      createdAt: r.createdAt.toISOString(),
    };
  }

  /**
   * Helper to check inventory availability and notify waitlist (internal).
   */
  async checkAndNotifyWaitlist(itemId: string): Promise<number> {
    // Check if inventory has become available
    const [inventory] = await this.database.db
      .select()
      .from(redemptionInventory)
      .where(eq(redemptionInventory.itemId, itemId))
      .limit(1);

    if (!inventory) return 0;

    const totalQty = inventory.totalQuantity
      ? Number(inventory.totalQuantity)
      : 0;
    const reserved = Number(inventory.reservedQuantity);
    const fulfilled = Number(inventory.fulfilledQuantity);
    const backordered = Number(inventory.backorderQuantity);
    const used = reserved + fulfilled + backordered;
    const available = totalQty - used;

    if (available <= 0) return 0;

    return this.notifyWaitlist(itemId);
  }

  // ─── Common ───────────────────────────────────────────────────────────

  private async transitionOrder(
    orderId: string,
    to: string,
    reason: string,
    actor: ActorInfo,
  ): Promise<void> {
    await this.database.runTransaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(redemptionOrders)
        .where(eq(redemptionOrders.id, orderId))
        .limit(1);
      if (!order)
        redemptionNotFound(
          redemptionErrorCodes.fulfilmentOrderNotFound,
          `Order ${orderId} not found`,
        );
      const from = order.status;
      if (!(ORDER_TRANSITIONS[from] ?? []).includes(to)) {
        redemptionBadRequest(
          redemptionErrorCodes.fulfilmentInvalidTransition,
          `Cannot transition ${from} → ${to}`,
        );
      }
      await tx
        .update(redemptionOrders)
        .set({ status: to } as any)
        .where(eq(redemptionOrders.id, orderId));
      await this.audit(tx, `ORDER_${to}`, 'REDEMPTION_ORDER', orderId, actor, {
        fromStatus: from,
        toStatus: to,
        reason,
      });
    }, TX_OPTIONS);
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  async getByOrderId(orderId: string): Promise<FulfilmentRecord> {
    const [r] = await this.database.db
      .select()
      .from(redemptionFulfilments)
      .where(eq(redemptionFulfilments.orderId, orderId))
      .limit(1);
    if (!r)
      redemptionNotFound(
        redemptionErrorCodes.fulfilmentNotFound,
        `Fulfilment for order ${orderId} not found`,
      );
    return this.toRecord(r);
  }

  async getById(fulfilmentId: string): Promise<FulfilmentRecord> {
    const [r] = await this.database.db
      .select()
      .from(redemptionFulfilments)
      .where(eq(redemptionFulfilments.id, fulfilmentId))
      .limit(1);
    if (!r)
      redemptionNotFound(
        redemptionErrorCodes.fulfilmentNotFound,
        `Fulfilment ${fulfilmentId} not found`,
      );
    return this.toRecord(r);
  }

  async listPending(
    limit = 50,
    offset = 0,
  ): Promise<{ fulfilments: FulfilmentRecord[]; total: number }> {
    const pendingStatuses = ['PENDING', 'IN_PROGRESS'];
    const rows = await this.database.db
      .select()
      .from(redemptionFulfilments)
      .where(
        sql`${redemptionFulfilments.status} = ANY(${sql.param(pendingStatuses)}::text[])`,
      )
      .orderBy(redemptionFulfilments.createdAt)
      .limit(limit)
      .offset(offset);
    const countResult = await this.database.db
      .select({ count: sql<number>`count(*)` })
      .from(redemptionFulfilments)
      .where(
        sql`${redemptionFulfilments.status} = ANY(${sql.param(pendingStatuses)}::text[])`,
      );
    return {
      fulfilments: rows.map((r) => this.toRecord(r)),
      total: Number(countResult[0]?.count ?? 0),
    };
  }
}
