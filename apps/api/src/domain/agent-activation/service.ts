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
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { agentActivations, agentActivationStatusLogs } from '@ipoint/database';
import type { AgentActivationStatus } from '@ipoint/types';
import {
  AgentActivationError,
  activationNotFoundError,
  activationAlreadyExistsError,
  activationInvalidTransitionError,
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
}

export interface AgentActivationStatusResult {
  activationId: string;
  status: AgentActivationStatus;
  market: string;
  activatedAt: string | null;
  currency: string;
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
   * given market, then inserts a new activation record and status log.
   */
  async apply(
    memberId: string,
    market: string,
  ): Promise<AgentActivationApplyOutput> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        currency: 'MYR',
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

    return { activationId, status: toStatus };
  }

  /**
   * Confirm payment for an activation.
   * PENDING_PAYMENT → PAYMENT_CONFIRMED
   */
  async confirmPayment(
    activationId: string,
    paymentReference: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
   */
  async enrollCourse(activationId: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
   */
  async completeCourse(activationId: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
   */
  async submitApproval(activationId: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
   */
  async approveAndActivate(
    activationId: string,
    adminId: string,
  ): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
   */
  async reject(activationId: string, reason?: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
        changedBy: null,
        changedByType: 'ADMIN',
        reason: reason ?? null,
        changedAt: now,
      });
    });
  }

  /**
   * Suspend an active agent.
   * ACTIVE → SUSPENDED
   */
  async suspend(activationId: string, reason: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
        changedBy: null,
        changedByType: 'ADMIN',
        reason,
        changedAt: now,
      });
    });
  }

  /**
   * Reactivate a suspended agent.
   * SUSPENDED → ACTIVE
   */
  async reactivate(activationId: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
        changedBy: null,
        changedByType: 'SYSTEM',
        reason: null,
        changedAt: now,
      });
    });
  }

  /**
   * Deactivate an active agent.
   * ACTIVE → DEACTIVATED (terminal state)
   */
  async deactivate(activationId: string, reason: string): Promise<void> {
    const db = this.database.db;
    type Tx = Parameters<typeof db.transaction>[0] extends (
      tx: infer T,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ..._args: unknown[]
    ) => unknown
      ? T
      : never;

    const record = await this.findOrThrow(activationId);

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
          revocationReason: reason,
          updatedAt: now,
        })
        .where(eq(agentActivations.id, activationId));

      await tx.insert(agentActivationStatusLogs).values({
        logId: randomUUID(),
        activationId,
        fromStatus,
        toStatus,
        changedBy: null,
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
   */
  async getStatusById(
    activationId: string,
  ): Promise<AgentActivationStatusResult | null> {
    const db = this.database.db;

    const rows = await db
      .select()
      .from(agentActivations)
      .where(eq(agentActivations.id, activationId))
      .limit(1);

    if (rows.length === 0) return null;

    return this.toStatusResult(rows[0]!);
  }

  /* ================================================================ */
  /*  PRIVATE HELPERS                                                  */
  /* ================================================================ */

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
      status: row.status as AgentActivationStatus,
      market: row.market,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      currency: row.currency,
      paymentReference: row.paymentReference,
      courseReference: row.courseReference,
      rejectionReason: row.rejectionReason,
      revocationReason: row.revocationReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
