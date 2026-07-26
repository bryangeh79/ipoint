/**
 * Admin Adjustment Maker/Checker Service
 *
 * Implements the Admin Adjustment workflow as specified in
 * P5-S0 Sections 13 (D-13/D-14 frozen), 23.11 (commission_adjustment_request),
 * and Section 25 (Admin Commission APIs).
 *
 * ## Key Rules (FROZEN)
 * - Two-person rule: Maker submits, Checker approves/rejects (D-13 frozen)
 * - All adjustments require a Checker — no threshold exception (D-14 frozen)
 * - maker_id/checker_id extracted from auth principal, NOT from request body
 * - maker_id != checker_id enforced at application and DB level
 * - Zero amount rejected (chk_adjustment_nonzero)
 * - Atomic approval = all or nothing within a single DB transaction
 *   (1) INSERT commission_ledger (entry_type = ADMIN_ADJUSTMENT)
 *   (2) INSERT commission_status_event (to_status = EARNED)
 *   (3) UPDATE commission_adjustment_request → APPROVED with ledger_entry_id
 * - One ledger entry per adjustment request (UNIQUE ledger_entry_id)
 * - commission_status_event must be created with every ledger entry
 * - Reject: status → REJECTED, no ledger entry created
 * - Immutable ledger: ADMIN_ADJUSTMENT entries are never modified
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  commissionAdjustmentRequests,
  commissionLedger,
  commissionStatusEvents,
} from '@ipoint/database';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** The status value for a newly created adjustment awaiting checker review. */
const STATUS_PENDING_CHECKER = 'PENDING_CHECKER';

/** The status value after checker approval. */
const STATUS_APPROVED = 'APPROVED';

/** The status value after checker rejection. */
const STATUS_REJECTED = 'REJECTED';

/** The posting status value for all commission ledger entries (D-01 frozen). */
const POSTING_STATUS_EARNED = 'EARNED';

/** Actor type for admin-initiated status events. */
const CHANGED_BY_TYPE_ADMIN = 'ADMIN';

/** The posting scale (2dp for MYR/SGD). */
const POSTING_SCALE = 2;

/** Entry type for admin adjustment ledger entries. */
const ADMIN_ADJUSTMENT_ENTRY_TYPE = 'ADMIN_ADJUSTMENT';

/** Source type for admin adjustments. */
const ADMIN_ADJUSTMENT_SOURCE_TYPE = 'ADMIN_ADJUSTMENT';

/* ------------------------------------------------------------------ */
/*  Database Type                                                     */
/* ------------------------------------------------------------------ */

/**
 * Queryable database handle — works for both the non-transactional
 * NodePgDatabase and PgTransaction callback types since they share
 * the same query builder interface.
 */
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = any;

/* ------------------------------------------------------------------ */
/*  Domain Types                                                      */
/* ------------------------------------------------------------------ */

/**
 * Result returned when creating a new adjustment request.
 */
export interface CreateAdjustmentResult {
  /** The adjustment request UUID. */
  adjustmentId: string;
  /** The public reference for this adjustment. */
  publicReference: string;
  /** Always 'PENDING_CHECKER' on creation. */
  status: string;
}

/**
 * Result returned when approving an adjustment request.
 */
export interface ApproveAdjustmentResult {
  /** The adjustment request UUID. */
  adjustmentId: string;
  /** Always 'APPROVED' on successful approval. */
  status: string;
  /** The UUID of the created commission ledger entry. */
  entryId: string;
}

/**
 * Result returned when rejecting an adjustment request.
 */
export interface RejectAdjustmentResult {
  /** The adjustment request UUID. */
  adjustmentId: string;
  /** Always 'REJECTED' on successful rejection. */
  status: string;
}

/**
 * A single adjustment request row returned to callers.
 */
export interface AdjustmentRequestRow {
  /** The adjustment request UUID. */
  id: string;
  /** Human-readable reference for this adjustment. */
  publicReference: string;
  /** The member UUID receiving the adjustment. */
  beneficiaryId: string;
  /** The adjustment amount (positive = credit, negative = debit). */
  amount: string;
  /** Market code (e.g., 'MY', 'SG'). */
  market: string;
  /** Currency code (e.g., 'MYR', 'SGD'). */
  currency: string;
  /** Reason for the adjustment. */
  reason: string;
  /** Optional external audit reference. */
  auditReference: string | null;
  /** Current status: PENDING_CHECKER, APPROVED, or REJECTED. */
  status: string;
  /** The admin UUID who created this request. */
  makerId: string;
  /** The admin UUID who approved/rejected this request (null if pending). */
  checkerId: string | null;
  /** Optional notes from the maker. */
  makerNotes: string | null;
  /** Optional notes from the checker (e.g., rejection reason). */
  checkerNotes: string | null;
  /** The commission ledger entry UUID (null if pending or rejected). */
  ledgerEntryId: string | null;
  /** Timestamp when the checker decided (null if pending). */
  decidedAt: string | null;
  /** Timestamp when the request was created. */
  createdAt: string;
  /** Timestamp when the request was last updated. */
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Error Class                                                       */
/* ------------------------------------------------------------------ */

/**
 * Domain error for admin adjustment operations.
 */
export class AdjustmentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdjustmentError';
  }
}

/** Factory: adjustment request not found. */
function adjustmentNotFoundError(adjustmentId: string): AdjustmentError {
  return new AdjustmentError(
    'ADJUSTMENT_NOT_FOUND',
    `Adjustment request not found: ${adjustmentId}`,
    { adjustmentId },
  );
}

/** Factory: adjustment not in PENDING_CHECKER status. */
function adjustmentInvalidStatusError(
  adjustmentId: string,
  currentStatus: string,
): AdjustmentError {
  return new AdjustmentError(
    'ADJUSTMENT_INVALID_STATUS',
    `Adjustment request ${adjustmentId} is not in PENDING_CHECKER status (current: ${currentStatus})`,
    { adjustmentId, currentStatus },
  );
}

/** Factory: adjustment already decided. */
function adjustmentAlreadyDecidedError(
  adjustmentId: string,
  currentStatus: string,
): AdjustmentError {
  return new AdjustmentError(
    'ADJUSTMENT_ALREADY_DECIDED',
    `Adjustment request ${adjustmentId} has already been decided (status: ${currentStatus})`,
    { adjustmentId, currentStatus },
  );
}

/** Factory: maker and checker are the same person. */
function adjustmentMakerCheckerSameError(
  adjustmentId: string,
  adminId: string,
): AdjustmentError {
  return new AdjustmentError(
    'ADJUSTMENT_MAKER_CHECKER_SAME',
    'Maker and checker cannot be the same person',
    { adjustmentId, adminId },
  );
}

/** Factory: invalid adjustment amount. */
function adjustmentInvalidAmountError(amount: string): AdjustmentError {
  return new AdjustmentError(
    'ADJUSTMENT_INVALID_AMOUNT',
    `Adjustment amount must be non-zero (received: ${amount})`,
    { amount },
  );
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

@Injectable()
export class AdjustmentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  /**
   * Create a new admin adjustment request (Maker action).
   *
   * Creates a PENDING_CHECKER adjustment request. The maker_id is
   * extracted from the auth principal (NOT from the request body).
   *
   * **Rules enforced:**
   * - maker_id comes from the caller's auth principal
   * - Zero amount is rejected per D-13 frozen (chk_adjustment_nonzero)
   * - amount must be a valid decimal string at up to 10dp precision
   *
   * @param makerId - The authenticated admin's UUID (from auth principal)
   * @param beneficiaryId - The member UUID receiving the adjustment
   * @param amount - The adjustment amount as a decimal string (non-zero)
   * @param market - Market code (e.g., 'MY', 'SG')
   * @param currency - Currency code (e.g., 'MYR', 'SGD')
   * @param reason - Human-readable reason for the adjustment
   * @param auditReference - Optional external audit reference
   * @returns The created adjustment request details
   * @throws AdjustmentError on validation failures
   */
  async createAdjustment(
    makerId: string,
    beneficiaryId: string,
    amount: string,
    market: string,
    currency: string,
    reason: string,
    auditReference?: string,
  ): Promise<CreateAdjustmentResult> {
    // ---------------------------------------------------------------
    // Validation: zero amount check (D-13 frozen)
    // ---------------------------------------------------------------
    const parsedAmount = this.parseDecimal(amount);
    if (parsedAmount === 0n) {
      throw adjustmentInvalidAmountError(amount);
    }

    // ---------------------------------------------------------------
    // Build the adjustment request
    // ---------------------------------------------------------------
    const db = this.database.db;
    const adjustmentId = randomUUID();
    const publicReference = await this.generatePublicReference(db);
    const now = new Date();

    await db.insert(commissionAdjustmentRequests).values({
      id: adjustmentId,
      publicReference,
      beneficiaryId,
      amount,
      market,
      currency,
      reason,
      auditReference: auditReference ?? null,
      status: STATUS_PENDING_CHECKER,
      makerId,
      checkerId: null,
      makerNotes: null,
      checkerNotes: null,
      ledgerEntryId: null,
      decidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      adjustmentId,
      publicReference,
      status: STATUS_PENDING_CHECKER,
    };
  }

  /**
   * Approve a pending adjustment request (Checker action).
   *
   * Executes the following atomically within a single database
   * transaction (per Section 23.11 commit contract):
   *   1. INSERT into commission_ledger (entry_type = ADMIN_ADJUSTMENT)
   *   2. INSERT into commission_status_event (to_status = EARNED)
   *   3. UPDATE commission_adjustment_request
   *      SET status = APPROVED, checker_id = auth_principal,
   *          decided_at = NOW(), ledger_entry_id = new_ledger_entry.id
   *
   * If any step fails, the entire transaction rolls back.
   *
   * **Rules enforced:**
   * - Adjustment must be in PENDING_CHECKER status
   * - Adjustment must not already be decided
   * - checker_id must differ from maker_id (D-14 frozen)
   * - One ledger entry per adjustment request (UNIQUE ledger_entry_id)
   * - commission_status_event created with the ledger entry
   *
   * @param checkerId - The authenticated admin's UUID (from auth principal)
   * @param adjustmentId - The adjustment request UUID to approve
   * @returns The approval result with the created ledger entry ID
   * @throws AdjustmentError on precondition failures
   */
  async approveAdjustment(
    checkerId: string,
    adjustmentId: string,
  ): Promise<ApproveAdjustmentResult> {
    const db = this.database.db;

    // ---------------------------------------------------------------
    // 1. Look up the adjustment request
    // ---------------------------------------------------------------
    const rows = await db
      .select()
      .from(commissionAdjustmentRequests)
      .where(eq(commissionAdjustmentRequests.id, adjustmentId))
      .limit(1);

    if (rows.length === 0) {
      throw adjustmentNotFoundError(adjustmentId);
    }

    const adjustment = rows[0]!;

    // ---------------------------------------------------------------
    // 2. Validate status: must be PENDING_CHECKER
    // ---------------------------------------------------------------
    if (
      adjustment.status === STATUS_APPROVED ||
      adjustment.status === STATUS_REJECTED
    ) {
      throw adjustmentAlreadyDecidedError(adjustmentId, adjustment.status);
    }

    if (adjustment.status !== STATUS_PENDING_CHECKER) {
      throw adjustmentInvalidStatusError(adjustmentId, adjustment.status);
    }

    // ---------------------------------------------------------------
    // 3. Validate maker_id != checker_id (D-14 frozen)
    // ---------------------------------------------------------------
    if (adjustment.makerId === checkerId) {
      throw adjustmentMakerCheckerSameError(adjustmentId, checkerId);
    }

    // ---------------------------------------------------------------
    // 4. Atomic approval transaction
    //
    //    Per Section 23.11 commit contract:
    //    (1) INSERT commission_ledger (entry_type = ADMIN_ADJUSTMENT)
    //    (2) INSERT commission_status_event (to_status = EARNED)
    //    (3) UPDATE commission_adjustment_request → APPROVED
    //
    //    If any step fails, entire transaction rolls back.
    // ---------------------------------------------------------------
    const ledgerId = randomUUID();
    const publicReference = await this.generatePublicReference(db);
    const now = new Date();

    await db.transaction(async (tx: Queryable) => {
      // 4a. Re-validate inside the transaction (optimistic lock)
      const currentRows = await tx
        .select()
        .from(commissionAdjustmentRequests)
        .where(eq(commissionAdjustmentRequests.id, adjustmentId))
        .forUpdate()
        .limit(1);

      if (currentRows.length === 0) {
        throw adjustmentNotFoundError(adjustmentId);
      }

      const current = currentRows[0]!;

      if (current.status !== STATUS_PENDING_CHECKER) {
        if (
          current.status === STATUS_APPROVED ||
          current.status === STATUS_REJECTED
        ) {
          throw adjustmentAlreadyDecidedError(adjustmentId, current.status);
        }
        throw adjustmentInvalidStatusError(adjustmentId, current.status);
      }

      // 4b. Insert commission_ledger entry
      await tx.insert(commissionLedger).values({
        id: ledgerId,
        publicReference,
        beneficiaryId: current.beneficiaryId,
        sourceType: ADMIN_ADJUSTMENT_SOURCE_TYPE,
        sourceReference: adjustmentId,
        market: current.market,
        currency: current.currency,
        amount: current.amount,
        rateVersionId: null,
        rateSnapshot: {
          adjustmentReason: current.reason,
          auditReference: current.auditReference,
          makerId: current.makerId,
          postingScale: POSTING_SCALE,
        },
        calculationBasis: current.amount,
        generation: 0,
        entryType: ADMIN_ADJUSTMENT_ENTRY_TYPE,
        postingStatus: POSTING_STATUS_EARNED,
        canonicalEntryKey: `${current.market}:${ADMIN_ADJUSTMENT_SOURCE_TYPE}:${adjustmentId}`,
        processingId: null,
        effectiveTime: now,
        createdAt: now,
        reversalLinkage: null,
        auditLinkage: adjustmentId,
        notes: `Admin adjustment: ${current.reason}`,
      });

      // 4c. Insert commission_status_event (D-01 frozen: Direct EARNED)
      await tx.insert(commissionStatusEvents).values({
        eventId: randomUUID(),
        entryId: ledgerId,
        fromStatus: null,
        toStatus: POSTING_STATUS_EARNED,
        changedBy: checkerId,
        changedByType: CHANGED_BY_TYPE_ADMIN,
        reason: `Admin adjustment approved by checker ${checkerId}`,
        changedAt: now,
        eventSequence: 1n,
      });

      // 4d. Update the adjustment request
      //
      // The UNIQUE(ledger_entry_id) constraint ensures at most one
      // ledger entry per adjustment request, preventing duplicate
      // financial entries on retry.
      await tx
        .update(commissionAdjustmentRequests)
        .set({
          status: STATUS_APPROVED,
          checkerId,
          decidedAt: now,
          ledgerEntryId: ledgerId,
          updatedAt: now,
        })
        .where(eq(commissionAdjustmentRequests.id, adjustmentId));
    });

    return {
      adjustmentId,
      status: STATUS_APPROVED,
      entryId: ledgerId,
    };
  }

  /**
   * Reject a pending adjustment request (Checker action).
   *
   * Sets the adjustment status to REJECTED. No ledger entry is created.
   *
   * **Rules enforced:**
   * - Adjustment must be in PENDING_CHECKER status
   * - Adjustment must not already be decided
   * - checker_id must differ from maker_id (D-14 frozen)
   * - REJECTED: status set, decided_at set, ledger_entry_id IS NULL
   *   (per chk_decided_fields constraint)
   *
   * @param checkerId - The authenticated admin's UUID (from auth principal)
   * @param adjustmentId - The adjustment request UUID to reject
   * @param reason - Optional rejection reason (stored in checkerNotes)
   * @returns The rejection result
   * @throws AdjustmentError on precondition failures
   */
  async rejectAdjustment(
    checkerId: string,
    adjustmentId: string,
    reason?: string,
  ): Promise<RejectAdjustmentResult> {
    const db = this.database.db;

    // ---------------------------------------------------------------
    // 1. Look up the adjustment request
    // ---------------------------------------------------------------
    const rows = await db
      .select()
      .from(commissionAdjustmentRequests)
      .where(eq(commissionAdjustmentRequests.id, adjustmentId))
      .limit(1);

    if (rows.length === 0) {
      throw adjustmentNotFoundError(adjustmentId);
    }

    const adjustment = rows[0]!;

    // ---------------------------------------------------------------
    // 2. Validate status: must be PENDING_CHECKER
    // ---------------------------------------------------------------
    if (
      adjustment.status === STATUS_APPROVED ||
      adjustment.status === STATUS_REJECTED
    ) {
      throw adjustmentAlreadyDecidedError(adjustmentId, adjustment.status);
    }

    if (adjustment.status !== STATUS_PENDING_CHECKER) {
      throw adjustmentInvalidStatusError(adjustmentId, adjustment.status);
    }

    // ---------------------------------------------------------------
    // 3. Validate maker_id != checker_id (D-14 frozen)
    // ---------------------------------------------------------------
    if (adjustment.makerId === checkerId) {
      throw adjustmentMakerCheckerSameError(adjustmentId, checkerId);
    }

    // ---------------------------------------------------------------
    // 4. Reject the adjustment (no ledger entry created)
    //
    //    Per chk_decided_fields constraint:
    //    REJECTED → checker_id IS NOT NULL, decided_at IS NOT NULL,
    //                ledger_entry_id IS NULL
    // ---------------------------------------------------------------
    const now = new Date();

    await db.transaction(async (tx: Queryable) => {
      // 4a. Re-validate inside transaction (optimistic lock)
      const currentRows = await tx
        .select()
        .from(commissionAdjustmentRequests)
        .where(eq(commissionAdjustmentRequests.id, adjustmentId))
        .forUpdate()
        .limit(1);

      if (currentRows.length === 0) {
        throw adjustmentNotFoundError(adjustmentId);
      }

      const current = currentRows[0]!;

      if (current.status !== STATUS_PENDING_CHECKER) {
        if (
          current.status === STATUS_APPROVED ||
          current.status === STATUS_REJECTED
        ) {
          throw adjustmentAlreadyDecidedError(adjustmentId, current.status);
        }
        throw adjustmentInvalidStatusError(adjustmentId, current.status);
      }

      // 4b. Update to REJECTED
      await tx
        .update(commissionAdjustmentRequests)
        .set({
          status: STATUS_REJECTED,
          checkerId,
          checkerNotes: reason ?? null,
          decidedAt: now,
          ledgerEntryId: null,
          updatedAt: now,
        })
        .where(eq(commissionAdjustmentRequests.id, adjustmentId));
    });

    return {
      adjustmentId,
      status: STATUS_REJECTED,
    };
  }

  /**
   * List adjustment requests with PENDING_CHECKER status.
   *
   * If adminId is provided, only returns requests created by that admin.
   * If adminId is omitted, returns all pending requests.
   *
   * @param adminId - Optional admin UUID to filter by maker
   * @returns Array of pending adjustment requests
   */
  async getPendingAdjustments(
    adminId?: string,
  ): Promise<AdjustmentRequestRow[]> {
    const db = this.database.db;

    const conditions = [
      eq(commissionAdjustmentRequests.status, STATUS_PENDING_CHECKER),
    ];

    if (adminId) {
      conditions.push(eq(commissionAdjustmentRequests.makerId, adminId));
    }

    const rows = await db
      .select()
      .from(commissionAdjustmentRequests)
      .where(and(...conditions))
      .orderBy(commissionAdjustmentRequests.createdAt);

    return rows.map((r) => this.toRow(r));
  }

  /**
   * Get a single adjustment request by its UUID.
   *
   * Returns the adjustment request regardless of status
   * (PENDING_CHECKER, APPROVED, or REJECTED).
   *
   * @param id - The adjustment request UUID
   * @returns The adjustment request, or null if not found
   */
  async getAdjustmentById(id: string): Promise<AdjustmentRequestRow | null> {
    const db = this.database.db;

    const rows = await db
      .select()
      .from(commissionAdjustmentRequests)
      .where(eq(commissionAdjustmentRequests.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    return this.toRow(rows[0]!);
  }

  /* ================================================================ */
  /*  PRIVATE METHODS                                                  */
  /* ================================================================ */

  /**
   * Parse a decimal string into a BigInt for zero-amount checking.
   *
   * Uses exact arithmetic with 10dp scale to avoid floating-point
   * errors when checking for zero.
   */
  private parseDecimal(value: string): bigint {
    const parts = value.split('.');
    const intPart = parts[0] ?? '0';
    const fracPart = (parts[1] ?? '').padEnd(10, '0').slice(0, 10);
    return BigInt(`${intPart}${fracPart}`);
  }

  /**
   * Generate a unique public reference for an adjustment request.
   *
   * Format: ADJ-YYMMDD-XXXXX where XXXXX is a random hex suffix.
   */
  private async generatePublicReference(_db: Queryable): Promise<string> {
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const suffix = Math.floor(Math.random() * 0xfffff)
      .toString(16)
      .toUpperCase()
      .padStart(5, '0');
    return `ADJ-${datePart}-${suffix}`;
  }

  /**
   * Map a raw database row to the public AdjustmentRequestRow type.
   */
  private toRow(r: Record<string, unknown>): AdjustmentRequestRow {
    return {
      id: r.id as string,
      publicReference: r.publicReference as string,
      beneficiaryId: r.beneficiaryId as string,
      amount: r.amount as string,
      market: r.market as string,
      currency: r.currency as string,
      reason: r.reason as string,
      auditReference: (r.auditReference as string) ?? null,
      status: r.status as string,
      makerId: r.makerId as string,
      checkerId: (r.checkerId as string) ?? null,
      makerNotes: (r.makerNotes as string) ?? null,
      checkerNotes: (r.checkerNotes as string) ?? null,
      ledgerEntryId: (r.ledgerEntryId as string) ?? null,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: (r.createdAt as Date).toISOString(),
      updatedAt: (r.updatedAt as Date).toISOString(),
    };
  }
}
