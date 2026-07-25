/**
 * Agent Activation Lifecycle Domain Service
 *
 * Implements the 10-state agent activation lifecycle with full
 * transition validation, audit logging, and market isolation.
 *
 * ## Frozen Contract (P5-S0 Section 4)
 *
 * - 10 states: NOT_APPLIED, PENDING_PAYMENT, PAYMENT_CONFIRMED,
 *   COURSE_PENDING, COURSE_COMPLETED, PENDING_APPROVAL, ACTIVE,
 *   SUSPENDED, DEACTIVATED, REJECTED
 * - Allowed transitions as defined in P5-S0 Section 4
 * - Multi-market: independent activation per (member_id, market)
 * - MY default activation fee = RM388 (market-configurable via D-08)
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentActivationAction,
  AgentActivationAuditEntry,
  AgentActivationRecord,
  AgentActivationStatus,
  AgentActivationTransitionResult,
} from '@ipoint/types';
import { ALLOWED_TRANSITIONS, TRANSITION_TARGETS } from '@ipoint/types';
import {
  getExpectedTargetStatus,
  validateTransition,
} from '@ipoint/validation';
import {
  activationAlreadyActiveError,
  activationAlreadyDeactivatedError,
  activationAlreadyExistsError,
  activationAlreadyRejectedError,
  activationAlreadySuspendedError,
  activationCourseAlreadyCompletedError,
  activationDeactivatedCannotReactivateError,
  activationFeeNotConfiguredError,
  activationInvalidTransitionError,
  activationMissingApprovalError,
  activationMissingCourseError,
  activationMissingPaymentError,
  activationPaymentAlreadyConfirmedError,
  activationRejectedCannotTransitionError,
  activationNotFoundError,
} from './agent-activation.errors.js';
import type {
  ActivationFeeConfigStore,
  AgentActivationRepository,
  CreateActivationDto,
  TransitionContext,
} from './agent-activation.types.js';

/* ------------------------------------------------------------------ */
/*  Activation Fee Default Configuration                               */
/* ------------------------------------------------------------------ */

/**
 * Default activation fee configuration used as fallback when no
 * market-specific configuration has been stored in the
 * commission_rate_version table.
 *
 * These values match P5-S1 seed data where commission_type = 'AGENT_UPGRADE'
 * and rate_type = 'FIXED'. Only MY (RM388.00) is hardcoded as the
 * contractual default; non-MY markets must be configured at runtime.
 */
const DEFAULT_ACTIVATION_FEES: Array<{
  market: string;
  fee: string;
  currency: string;
}> = [{ market: 'MY', fee: '388.00', currency: 'MYR' }];

/* ------------------------------------------------------------------ */
/*  Service Class                                                      */
/* ------------------------------------------------------------------ */

export class AgentActivationService {
  constructor(
    private readonly repository: AgentActivationRepository,
    private readonly feeConfigStore: ActivationFeeConfigStore,
  ) {}

  /* ================================================================ */
  /*  COMMAND METHODS                                                  */
  /* ================================================================ */

  /**
   * Apply for agent activation.
   * NOT_APPLIED → PENDING_PAYMENT
   *
   * Creates a new activation record for the member in the specified market.
   * Each member can have independent activation in each market.
   */
  async apply(
    dto: CreateActivationDto,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const { memberId, market } = dto;

    // Verify no existing activation for this member+market
    const existing = await this.repository.findByMemberAndMarket(
      memberId,
      market,
    );

    if (existing) {
      throw activationAlreadyExistsError(memberId, market);
    }

    // Resolve activation fee for the market
    const feeConfig = await this.getFeeConfig(market);

    // Build the new record
    const now = new Date().toISOString();
    const activationId = randomUUID();
    const fromStatus: AgentActivationStatus = 'NOT_APPLIED';
    const action: AgentActivationAction = 'APPLY';
    const toStatus = getExpectedTargetStatus(fromStatus, action) as
      | AgentActivationStatus
      | undefined;

    if (!toStatus) {
      throw activationInvalidTransitionError(fromStatus, action);
    }

    const record: AgentActivationRecord = {
      id: activationId,
      memberId,
      market,
      status: toStatus,
      previousStatus: fromStatus,
      activationFee: feeConfig.fee,
      activationFeeCurrency: feeConfig.currency,
      paymentConfirmedAt: null,
      courseEnrolledAt: null,
      courseCompletedAt: null,
      submittedForApprovalAt: null,
      activatedAt: null,
      activatedByAdminUserId: null,
      suspendedAt: null,
      revokedAt: null,
      deactivatedByAdminUserId: null,
      reason: context.reason,
      paymentReference: null,
      courseReference: null,
      approvalNotes: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.repository.insert(record);

    // Create audit log entry
    const auditEntry = await this.createAuditEntry(
      saved,
      fromStatus,
      toStatus,
      action,
      context,
    );

    return { record: saved, auditEntry };
  }

  /**
   * Confirm payment.
   * PENDING_PAYMENT → PAYMENT_CONFIRMED
   *
   * Records the payment confirmation timestamp and payment reference.
   */
  async confirmPayment(
    activationId: string,
    paymentReference: string,
    paymentConfirmedAt: string,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'CONFIRM_PAYMENT';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: payment should not already be confirmed
    if (record.paymentConfirmedAt) {
      throw activationPaymentAlreadyConfirmedError();
    }

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      paymentConfirmedAt,
      paymentReference,
      reason: context.reason ?? record.reason,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      { paymentReference },
    );

    return { record: saved, auditEntry };
  }

  /**
   * Enroll in course.
   * PAYMENT_CONFIRMED → COURSE_PENDING
   *
   * Records the course enrollment timestamp and optional course reference.
   */
  async enrollCourse(
    activationId: string,
    courseReference: string | undefined,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'ENROLL_COURSE';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: payment must be confirmed before course enrollment
    if (!record.paymentConfirmedAt) {
      throw activationMissingPaymentError();
    }

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      courseEnrolledAt: new Date().toISOString(),
      courseReference: courseReference ?? record.courseReference,
      reason: context.reason ?? record.reason,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      { courseReference },
    );

    return { record: saved, auditEntry };
  }

  /**
   * Complete course.
   * COURSE_PENDING → COURSE_COMPLETED
   *
   * Records the course completion timestamp and course reference.
   */
  async completeCourse(
    activationId: string,
    courseReference: string,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'COMPLETE_COURSE';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: course must be enrolled before it can be completed
    if (!record.courseEnrolledAt) {
      throw activationMissingCourseError();
    }

    // Business invariant: course should not already be completed
    if (record.courseCompletedAt) {
      throw activationCourseAlreadyCompletedError();
    }

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      courseCompletedAt: new Date().toISOString(),
      courseReference,
      reason: context.reason ?? record.reason,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      { courseReference },
    );

    return { record: saved, auditEntry };
  }

  /**
   * Submit for approval.
   * COURSE_COMPLETED → PENDING_APPROVAL
   *
   * Marks the activation as ready for admin review.
   */
  async submitForApproval(
    activationId: string,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'SUBMIT_FOR_APPROVAL';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: course must be completed before submission
    if (!record.courseCompletedAt) {
      throw activationMissingCourseError();
    }

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      submittedForApprovalAt: new Date().toISOString(),
      reason: context.reason ?? record.reason,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
    );

    return { record: saved, auditEntry };
  }

  /**
   * Approve and activate — atomic operation.
   * PENDING_APPROVAL → ACTIVE
   *
   * Both admin approval and system activation happen in a single atomic
   * transition as specified in P5-S0 Section 4.3.
   *
   * The activated_at timestamp becomes the agent's effective_time for
   * commission eligibility.
   */
  async approveAndActivate(
    activationId: string,
    adminUserId: string,
    approvalNotes: string | undefined,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'APPROVE_AND_ACTIVATE';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: must have been submitted for approval
    if (!record.submittedForApprovalAt) {
      throw activationMissingApprovalError();
    }

    const now = new Date().toISOString();

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      activatedAt: now,
      activatedByAdminUserId: adminUserId,
      approvalNotes: approvalNotes ?? record.approvalNotes,
      reason: context.reason ?? record.reason,
      updatedAt: now,
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      { adminUserId, approvalNotes },
    );

    return { record: saved, auditEntry };
  }

  /**
   * Reject application.
   * Any pre-ACTIVE state → REJECTED
   *
   * Pre-ACTIVE states: NOT_APPLIED, PENDING_PAYMENT, PAYMENT_CONFIRMED,
   * COURSE_PENDING, COURSE_COMPLETED, PENDING_APPROVAL
   *
   * REJECTED is a terminal state — no further transitions allowed.
   */
  async reject(
    activationId: string,
    adminUserId: string,
    reason: string,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'REJECT';
    const toStatus = this.validateAndGetTarget(record.status, action);

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      reason,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      { adminUserId, reason },
    );

    return { record: saved, auditEntry };
  }

  /**
   * Suspend agent.
   * ACTIVE → SUSPENDED only.
   *
   * During suspension, the agent does not earn new commissions.
   * Existing EARNED commissions are preserved.
   */
  async suspend(
    activationId: string,
    adminUserId: string,
    reason: string,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'SUSPEND';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: cannot suspend a non-ACTIVE agent
    if (record.status !== 'ACTIVE') {
      throw activationAlreadyActiveError();
    }

    if (record.suspendedAt) {
      throw activationAlreadySuspendedError();
    }

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      suspendedAt: new Date().toISOString(),
      reason,
      updatedAt: new Date().toISOString(),
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      { adminUserId, reason },
    );

    return { record: saved, auditEntry };
  }

  /**
   * Reactivate agent.
   * SUSPENDED → ACTIVE only.
   *
   * When reactivated, the agent becomes eligible for future commissions.
   * Past events during suspension remain ineligible.
   * No retroactive eligibility for suspension periods.
   */
  async reactivate(
    activationId: string,
    adminUserId: string,
    reason: string | undefined,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'REACTIVATE';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: SUSPENDED → ACTIVE only — already validated above
    // Business invariant: cannot reactivate if already active
    if (record.status === 'ACTIVE') {
      throw activationAlreadyActiveError();
    }

    // Business invariant: DEACTIVATED is terminal — cannot reactivate
    if (record.status === 'DEACTIVATED') {
      throw activationDeactivatedCannotReactivateError();
    }

    const now = new Date().toISOString();

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      // Clear suspended_at on reactivation to reflect current state
      suspendedAt: null,
      activatedAt: record.activatedAt ?? now,
      activatedByAdminUserId: record.activatedByAdminUserId ?? adminUserId,
      reason: reason ?? record.reason,
      updatedAt: now,
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      { adminUserId, reason },
    );

    return { record: saved, auditEntry };
  }

  /**
   * Deactivate agent.
   * ACTIVE → DEACTIVATED only.
   *
   * DEACTIVATED is a permanent terminal state.
   * The revoked_at timestamp (T1) is set to the current time as the
   * exact revocation effective timestamp.
   *
   * Per D-06 frozen: existing EARNED commissions from before revocation
   * are preserved. No clawback of upgrade commissions.
   */
  async deactivate(
    activationId: string,
    adminUserId: string,
    reason: string,
    context: TransitionContext,
  ): Promise<AgentActivationTransitionResult> {
    const record = await this.findOrThrow(activationId);
    const action: AgentActivationAction = 'DEACTIVATE';
    const toStatus = this.validateAndGetTarget(record.status, action);

    // Business invariant: cannot deactivate a non-ACTIVE agent
    if (record.status !== 'ACTIVE') {
      throw activationAlreadyActiveError();
    }

    if (record.revokedAt) {
      throw activationAlreadyDeactivatedError();
    }

    const now = new Date().toISOString();

    const updated: AgentActivationRecord = {
      ...record,
      status: toStatus,
      previousStatus: record.status,
      revokedAt: now,
      deactivatedByAdminUserId: adminUserId,
      reason,
      updatedAt: now,
      version: record.version + 1,
    };

    const saved = await this.repository.update(updated);

    const auditEntry = await this.createAuditEntry(
      saved,
      record.status,
      toStatus,
      action,
      context,
      {
        adminUserId,
        reason,
        revokedAt: now,
      },
    );

    return { record: saved, auditEntry };
  }

  /* ================================================================ */
  /*  QUERY METHODS                                                    */
  /* ================================================================ */

  /**
   * Find an activation record by ID.
   */
  async findById(id: string): Promise<AgentActivationRecord | null> {
    return this.repository.findById(id);
  }

  /**
   * Find activation record for a member in a market.
   */
  async findByMemberAndMarket(
    memberId: string,
    market: string,
  ): Promise<AgentActivationRecord | null> {
    return this.repository.findByMemberAndMarket(memberId, market);
  }

  /**
   * Check if a member is an active agent in a market.
   */
  async isActiveAgent(memberId: string, market: string): Promise<boolean> {
    const record = await this.repository.findByMemberAndMarket(
      memberId,
      market,
    );
    return record?.status === 'ACTIVE';
  }

  /**
   * Get audit log entries for an activation record.
   */
  async getAuditLog(
    activationId: string,
  ): Promise<AgentActivationAuditEntry[]> {
    await this.findOrThrow(activationId);
    return this.repository.findAuditEntries(activationId);
  }

  /* ================================================================ */
  /*  FEE CONFIGURATION                                                */
  /* ================================================================ */

  /**
   * Get the activation fee configuration for a market.
   * Falls back to the default configuration if no market-specific
   * configuration has been stored.
   */
  async getFeeConfig(market: string): Promise<{
    fee: string;
    currency: string;
  }> {
    try {
      return await this.feeConfigStore.getFeeConfig(market);
    } catch {
      // Fall back to default configuration
      const defaultConfig = DEFAULT_ACTIVATION_FEES.find(
        (c) => c.market === market,
      );

      if (!defaultConfig) {
        throw activationFeeNotConfiguredError(market);
      }

      return defaultConfig;
    }
  }

  /* ================================================================ */
  /*  TRANSITION UTILITIES                                             */
  /* ================================================================ */

  /**
   * Validate that a transition is allowed and return the target status.
   *
   * Also enforces forbidden transitions:
   * - DEACTIVATED → ACTIVE (terminal state)
   * - DEACTIVATED → NOT_APPLIED (terminal state — OPEN question)
   * - REJECTED → any non-REJECTED state (terminal state)
   * - SUSPENDED → any non-ACTIVE state (only reactivation allowed)
   */
  private validateAndGetTarget(
    fromStatus: AgentActivationStatus,
    action: AgentActivationAction,
  ): AgentActivationStatus {
    // Terminal state guards
    if (fromStatus === 'DEACTIVATED') {
      throw activationDeactivatedCannotReactivateError();
    }

    if (fromStatus === 'REJECTED') {
      throw activationRejectedCannotTransitionError();
    }

    // SUSPENDED can only transition via REACTIVATE
    if (fromStatus === 'SUSPENDED' && action !== 'REACTIVATE') {
      throw activationInvalidTransitionError(
        fromStatus,
        action,
        'SUSPENDED can only transition via REACTIVATE.',
      );
    }

    const toStatus = getExpectedTargetStatus(fromStatus, action) as
      | AgentActivationStatus
      | undefined;

    if (!toStatus) {
      throw activationInvalidTransitionError(
        fromStatus,
        action,
        `No valid transition from ${fromStatus} via ${action}.`,
      );
    }

    const validation = validateTransition(fromStatus, action, toStatus);
    if (!validation.allowed) {
      throw activationInvalidTransitionError(
        fromStatus,
        action,
        validation.reason,
      );
    }

    return toStatus;
  }

  /**
   * Find an activation record or throw.
   */
  private async findOrThrow(
    activationId: string,
  ): Promise<AgentActivationRecord> {
    const record = await this.repository.findById(activationId);
    if (!record) {
      throw activationNotFoundError(activationId);
    }
    return record;
  }

  /**
   * Create an audit log entry for a status transition.
   */
  private async createAuditEntry(
    record: AgentActivationRecord,
    fromStatus: AgentActivationStatus,
    toStatus: AgentActivationStatus,
    action: AgentActivationAction,
    context: TransitionContext,
    additionalMetadata?: Record<string, unknown>,
  ): Promise<AgentActivationAuditEntry> {
    const entry: AgentActivationAuditEntry = {
      id: randomUUID(),
      activationId: record.id,
      memberId: record.memberId,
      market: record.market,
      action,
      fromStatus,
      toStatus,
      actorAdminUserId: context.actorAdminUserId,
      actorType: context.actorType,
      reason: context.reason,
      metadata: {
        ...(context.metadata ?? {}),
        ...(additionalMetadata ?? {}),
      },
      occurredAt: new Date().toISOString(),
    };

    return this.repository.insertAuditEntry(entry);
  }
}
