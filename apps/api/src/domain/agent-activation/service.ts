/**
 * Agent Activation Lifecycle Domain Service
 *
 * Direct Drizzle ORM implementation handling the agent activation lifecycle
 * with full transition validation and audit logging.
 *
 * ## Status Machine (10 states)
 *
 * NOT_APPLIED → PENDING_PAYMENT → PAYMENT_CONFIRMED → COURSE_PENDING →
 * COURSE_COMPLETED → PENDING_APPROVAL → ACTIVE
 *                                      → REJECTED (from any pre-ACTIVE state)
 *                                      → SUSPENDED → ACTIVE (reactivate)
 *                                      → DEACTIVATED (terminal)
 *
 * ## P5-R1 Remediation (GATE-P5-01)
 *
 * - APPLY snapshots the versioned activation fee (commission_rate_version
 *   rows with commission_type = 'AGENT_ACTIVATION_FEE', generation 0) onto
 *   the activation record. Markets without an effective fee version cannot
 *   activate (AGENT_ACTIVATION_FEE_NOT_CONFIGURED). Historical activations
 *   are never repriced.
 * - Every member-scoped command verifies the activation belongs to the
 *   authenticated member (no cross-member mutation).
 * - Every admin transition records the executing admin (actor attribution)
 *   and verifies the activation market equals the server-selected market.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { desc, eq, and, lte, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  agentActivations,
  agentActivationStatusLogs,
  commissionRateVersions,
  markets,
} from '@ipoint/database';
import type { AgentActivationStatus } from '@ipoint/types';
import {
  AgentActivationError,
  activationNotFoundError,
  activationAlreadyExistsError,
  activationInvalidTransitionError,
  activationFeeNotConfiguredError,
  activationOwnershipMismatchError,
  activationMarketMismatchError,
} from './agent-activation.errors.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const PRE_ACTIVE_STATUSES: readonly AgentActivationStatus[] = [
  'NOT_APPLIED',
  'PENDING_PAYMENT',
  'PAYMENT_CONFIRMED',
  'COURSE_PENDING',
  'COURSE_COMPLETED',
  'PENDING_APPROVAL',
];

/** Commission type used for versioned activation fee configuration rows. */
const ACTIVATION_FEE_COMMISSION_TYPE = 'AGENT_ACTIVATION_FEE';

/** Fee config rows are single-generation (generation 0 per P5-S0). */
const ACTIVATION_FEE_GENERATION = 0;

/* ------------------------------------------------------------------ */
/*  Transition Map                                                     */
/* ------------------------------------------------------------------ */

/** Allowed transitions: (currentStatus, targetStatus) pairs. */
const ALLOWED_TRANSITIONS: Record<
  AgentActivationStatus,
  AgentActivationStatus[]
> = {
  NOT_APPLIED: ['PENDING_PAYMENT'],
  PENDING_PAYMENT: ['PAYMENT_CONFIRMED', 'REJECTED'],
  PAYMENT_CONFIRMED: ['COURSE_PENDING', 'REJECTED'],
  COURSE_PENDING: ['COURSE_COMPLETED', 'REJECTED'],
  COURSE_COMPLETED: ['PENDING_APPROVAL', 'REJECTED'],
  PENDING_APPROVAL: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE'],
  DEACTIVATED: [],
  REJECTED: [],
};

/* ------------------------------------------------------------------ */
/*  Return Types                                                      */
/* ------------------------------------------------------------------ */

export interface AgentActivationApplyOutput {
  activationId: string;
  status: AgentActivationStatus;
  /** Fee version id snapshotted onto the activation (null only pre-P5-R1 rows). */
  feeRateVersionId: string | null;
  /** Snapshotted activation fee amount (decimal string). */
  activationFee: string | null;
  /** Snapshotted activation fee currency. */
  activationFeeCurrency: string;
}

export interface AgentActivationStatusResult {
  activationId: string;
  status: AgentActivationStatus;
  market: string;
  activatedAt: string | null;
  currency: string;
  feeRateVersionId: string | null;
  activationFee: string | null;
  activationFeeCurrency: string;
  paymentReference: string | null;
  courseReference: string | null;
  rejectionReason: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class AgentActivationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  COMMAND METHODS                                                  */
  /* ================================================================ */

  /**
   * Apply for agent activation.
   * NOT_APPLIED → PENDING_PAYMENT
   *
   * Verifies the member does not have an existing activation in the
   * given market, resolves the versioned activation fee effective at
   * apply time, snapshots the fee version onto the activation record,
   * then inserts the activation record and status log.
   *
   * Markets without an effective AGENT_ACTIVATION_FEE version cannot
   * activate (other markets stay blocked until explicitly configured).
   */
  async apply(
    memberId: string,
    market: string,
  ): Promise<AgentActivationApplyOutput> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    // Verify no existing activation for this member+market
    const existing = await db
      .select()
      .from(agentActivations)
      .where(
        and(
          eq(agentActivations.memberId, memberId),
          eq(agentActivations.market, market),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw activationAlreadyExistsError(memberId, market);
    }

    // Resolve the versioned activation fee effective at apply time.
    const feeVersion = await this.resolveFeeVersion(db, market, new Date());

    const activationId = randomUUID();
    const now = new Date();
    const fromStatus: AgentActivationStatus = 'NOT_APPLIED';
    const toStatus: AgentActivationStatus = 'PENDING_PAYMENT';

    this.assertAllowedTransition(fromStatus, toStatus, 'apply');

    await db.transaction(async (tx: Tx) => {
      await tx.insert(agentActivations).values({
        id: activationId,
        memberId,
        market,
        status: toStatus,
        currency: feeVersion.currency,
        feeRateVersionId: feeVersion.rateVersionId,
        activationFee: feeVersion.feeAmount,
        activationFeeCurrency: feeVersion.currency,
        reactivationCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: null,
        changedByType: 'AGENT',
        reason: null,
        changedAt: now,
      });
    });

    return {
      activationId,
      status: toStatus,
      feeRateVersionId: feeVersion.rateVersionId,
      activationFee: feeVersion.feeAmount,
      activationFeeCurrency: feeVersion.currency,
    };
  }

  /**
   * Confirm payment for an activation.
   * PENDING_PAYMENT → PAYMENT_CONFIRMED
   *
   * P5-R1: the authenticated member must own the activation.
   */
  async confirmPayment(
    activationId: string,
    paymentReference: string,
    memberId: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOwnedOrThrow(activationId, memberId);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'PAYMENT_CONFIRMED';

    this.assertAllowedTransition(fromStatus, toStatus, 'confirmPayment');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          paymentReference,
          paymentConfirmedAt: now,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: null,
        changedByType: 'SYSTEM',
        reason: null,
        changedAt: now,
      });
    });
  }

  /**
   * Enroll activation in course.
   * PAYMENT_CONFIRMED → COURSE_PENDING
   *
   * P5-R1: the authenticated member must own the activation.
   */
  async enrollCourse(activationId: string, memberId: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOwnedOrThrow(activationId, memberId);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'COURSE_PENDING';

    this.assertAllowedTransition(fromStatus, toStatus, 'enrollCourse');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          courseEnrolledAt: now,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: null,
        changedByType: 'SYSTEM',
        reason: null,
        changedAt: now,
      });
    });
  }

  /**
   * Complete course for an activation.
   * COURSE_PENDING → COURSE_COMPLETED
   *
   * P5-R1: the authenticated member must own the activation.
   */
  async completeCourse(activationId: string, memberId: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOwnedOrThrow(activationId, memberId);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'COURSE_COMPLETED';

    this.assertAllowedTransition(fromStatus, toStatus, 'completeCourse');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          courseCompletedAt: now,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: null,
        changedByType: 'SYSTEM',
        reason: null,
        changedAt: now,
      });
    });
  }

  /**
   * Submit activation for admin approval.
   * COURSE_COMPLETED → PENDING_APPROVAL
   *
   * P5-R1: the authenticated member must own the activation.
   */
  async submitApproval(activationId: string, memberId: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOwnedOrThrow(activationId, memberId);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'PENDING_APPROVAL';

    this.assertAllowedTransition(fromStatus, toStatus, 'submitApproval');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: null,
        changedByType: 'AGENT',
        reason: null,
        changedAt: now,
      });
    });
  }

  /**
   * Approve and activate — atomic operation.
   * PENDING_APPROVAL → ACTIVE
   *
   * P5-R1: the executing admin is recorded (actor attribution) and the
   * activation market must equal the admin's server-selected market.
   */
  async approveAndActivate(
    activationId: string,
    adminId: string,
    market: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);
    this.assertActivationMarket(record, market);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'ACTIVE';

    this.assertAllowedTransition(fromStatus, toStatus, 'approveAndActivate');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          activatedAt: now,
          activatedBy: adminId,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: adminId,
        changedByType: 'ADMIN',
        reason: null,
        changedAt: now,
      });
    });
  }

  /**
   * Reject an application.
   * Any pre-ACTIVE state → REJECTED
   * REJECTED is a terminal state.
   *
   * P5-R1: the executing admin is recorded (actor attribution) and the
   * activation market must equal the admin's server-selected market.
   */
  async reject(
    activationId: string,
    adminId: string,
    market: string,
    reason?: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);
    this.assertActivationMarket(record, market);

    if (!PRE_ACTIVE_STATUSES.includes(record.status)) {
      throw new AgentActivationError(
        'AGENT_ACTIVATION_INVALID_TRANSITION',
        `Cannot reject activation in status ${record.status}. Only pre-ACTIVE statuses can be rejected.`,
        { currentStatus: record.status },
      );
    }

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'REJECTED';

    this.assertAllowedTransition(fromStatus, toStatus, 'reject');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          rejectionReason: reason ?? null,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: adminId,
        changedByType: 'ADMIN',
        reason: reason ?? null,
        changedAt: now,
      });
    });
  }

  /**
   * Suspend an active agent.
   * ACTIVE → SUSPENDED
   *
   * P5-R1: the executing admin is recorded (actor attribution) and the
   * activation market must equal the admin's server-selected market.
   */
  async suspend(
    activationId: string,
    adminId: string,
    market: string,
    reason: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);
    this.assertActivationMarket(record, market);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'SUSPENDED';

    this.assertAllowedTransition(fromStatus, toStatus, 'suspend');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: adminId,
        changedByType: 'ADMIN',
        reason,
        changedAt: now,
      });
    });
  }

  /**
   * Reactivate a suspended agent.
   * SUSPENDED → ACTIVE
   *
   * P5-R1: the executing admin is recorded (actor attribution) and the
   * activation market must equal the admin's server-selected market.
   */
  async reactivate(
    activationId: string,
    adminId: string,
    market: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);
    this.assertActivationMarket(record, market);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'ACTIVE';

    this.assertAllowedTransition(fromStatus, toStatus, 'reactivate');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          reactivationCount: (record.reactivationCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: adminId,
        changedByType: 'ADMIN',
        reason: null,
        changedAt: now,
      });
    });
  }

  /**
   * Deactivate an active agent.
   * ACTIVE → DEACTIVATED (terminal state)
   *
   * P5-R1: the executing admin is recorded (actor attribution, including
   * revoked_by) and the activation market must equal the admin's
   * server-selected market.
   */
  async deactivate(
    activationId: string,
    adminId: string,
    market: string,
    reason: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,

      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);
    this.assertActivationMarket(record, market);

    const fromStatus = record.status;
    const toStatus: AgentActivationStatus = 'DEACTIVATED';

    this.assertAllowedTransition(fromStatus, toStatus, 'deactivate');

    const now = new Date();

    await db.transaction(async (tx: Tx) => {
      await tx
        .update(agentActivations)
        .set({
          status: toStatus,
          revokedAt: now,
          revokedBy: adminId,
          revocationReason: reason,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: adminId,
        changedByType: 'ADMIN',
        reason,
        changedAt: now,
      });
    });
  }

  /* ================================================================ */
  /*  QUERY METHODS                                                    */
  /* ================================================================ */

  /**
   * Get the current activation status for a member in an optional market.
   * If market is omitted, returns the most recent activation across markets.
   */
  async getStatus(
    memberId: string,
    market?: string,
  ): Promise<AgentActivationStatusResult | null> {
    const db = this.database.db;

    const conditions = [eq(agentActivations.memberId, memberId)];
    if (market) {
      conditions.push(eq(agentActivations.market, market));
    }

    const rows = await db
      .select()
      .from(agentActivations)
      .where(and(...conditions))
      .orderBy(agentActivations.updatedAt)
      .limit(1);

    if (rows.length === 0) return null;

    return this.toStatusResult(rows[0]!);
  }

  /**
   * Get activation status by its ID.
   *
   * P5-R1: when a member context is provided, the activation must belong
   * to that member (no cross-member status disclosure).
   */
  async getStatusById(
    activationId: string,
    memberId?: string,
  ): Promise<AgentActivationStatusResult | null> {
    const db = this.database.db;

    const rows = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);

    if (rows.length === 0) return null;

    const record = rows[0]!;
    if (memberId && record.memberId !== memberId) {
      throw activationOwnershipMismatchError(activationId, memberId);
    }

    return this.toStatusResult(record);
  }

  /* ================================================================ */
  /*  PRIVATE HELPERS                                                  */
  /* ================================================================ */

  /**
   * Resolve the activation fee version effective at the given time for a
   * market. Only AGENT_ACTIVATION_FEE / generation 0 rows count.
   *
   * The fee currency comes from the market registry (markets.currency_code),
   * never from a hard-coded map. A market is "explicitly configured" only
   * when BOTH the registry entry and an effective fee version exist; other
   * markets cannot activate (AGENT_ACTIVATION_FEE_NOT_CONFIGURED).
   *
   * @throws activationFeeNotConfiguredError when the market is not configured
   */
  private async resolveFeeVersion(
    db: DatabaseService['db'],
    market: string,
    at: Date,
  ): Promise<{
    rateVersionId: string;
    feeAmount: string;
    currency: string;
  }> {
    // Market registry entry with an explicit currency is required.
    const marketRows = await db
      .select({ currencyCode: markets.currencyCode })
      .from(markets)
      .where(eq(markets.code, market))
      .limit(1);
    const currency = marketRows[0]?.currencyCode;
    if (!currency) {
      throw activationFeeNotConfiguredError(market);
    }

    const rows = await db
      .select({
        id: commissionRateVersions.id,
        rateValue: commissionRateVersions.rateValue,
      })
      .from(commissionRateVersions)
      .where(
        and(
          eq(
            commissionRateVersions.commissionType,
            ACTIVATION_FEE_COMMISSION_TYPE,
          ),
          eq(commissionRateVersions.generation, ACTIVATION_FEE_GENERATION),
          eq(commissionRateVersions.market, market),
          lte(commissionRateVersions.effectiveFrom, at),
          sql`(${commissionRateVersions.effectiveUntil} IS NULL OR ${commissionRateVersions.effectiveUntil} > ${at})`,
        ),
      )
      // D-054 §9: logical half-open resolution — when a successor fee
      // supersedes an open-ended predecessor, the LATEST effective start
      // wins (derived [start, next_start) windows).
      .orderBy(desc(commissionRateVersions.effectiveFrom))
      .limit(1);

    if (rows.length === 0) {
      throw activationFeeNotConfiguredError(market);
    }

    return {
      rateVersionId: rows[0]!.id,
      feeAmount: rows[0]!.rateValue,
      currency,
    };
  }

  /**
   * Find an activation record or throw NOT_FOUND.
   */
  private async findOrThrow(
    activationId: string,
  ): Promise<typeof agentActivations.$inferSelect> {
    const db = this.database.db;

    const rows = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);

    if (rows.length === 0) {
      throw activationNotFoundError(activationId);
    }

    return rows[0]!;
  }

  /**
   * Find an activation owned by the member or throw.
   */
  private async findOwnedOrThrow(
    activationId: string,
    memberId: string,
  ): Promise<typeof agentActivations.$inferSelect> {
    const record = await this.findOrThrow(activationId);
    if (record.memberId !== memberId) {
      throw activationOwnershipMismatchError(activationId, memberId);
    }
    return record;
  }

  /**
   * Assert the activation belongs to the server-selected market.
   */
  private assertActivationMarket(
    record: typeof agentActivations.$inferSelect,
    market: string,
  ): void {
    if (record.market !== market) {
      throw activationMarketMismatchError(record.id, market, record.market);
    }
  }

  /**
   * Assert that a transition from current status to target status is allowed.
   */
  private assertAllowedTransition(
    fromStatus: AgentActivationStatus,
    toStatus: AgentActivationStatus,
    action: string,
  ): void {
    const allowed = ALLOWED_TRANSITIONS[fromStatus];

    if (!allowed || !allowed.includes(toStatus)) {
      throw activationInvalidTransitionError(
        fromStatus,
        action,
        `Transition from ${fromStatus} to ${toStatus} is not allowed.`,
      );
    }
  }

  /**
   * Map a raw database row to the status result type.
   */
  private toStatusResult(
    row: typeof agentActivations.$inferSelect,
  ): AgentActivationStatusResult {
    return {
      activationId: row.id,
      status: row.status,
      market: row.market,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      currency: row.currency,
      feeRateVersionId: row.feeRateVersionId,
      activationFee: row.activationFee,
      activationFeeCurrency: row.activationFeeCurrency,
      paymentReference: row.paymentReference,
      courseReference: row.courseReference,
      rejectionReason: row.rejectionReason,
      revocationReason: row.revocationReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
