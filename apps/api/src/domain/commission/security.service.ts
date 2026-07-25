/**
 * Commission Domain Security & Authorization Service (P5-S7)
 *
 * Central authorization enforcement for commission domain operations.
 * All assertion methods throw typed `CommissionSecurityError` on failure.
 * Methods that query the database inject `DatabaseService`.
 *
 * ## Responsibilities
 * - Ownership verification (assertOwnCommission, assertBeneficiaryAccess)
 * - Admin permission checks (assertAdminAccess)
 * - Maker/checker segregation (assertCheckerNotMaker)
 * - Auth principal validation (assertMemberIdFromPrincipal,
 *   assertMakerIdFromPrincipal, assertCheckerIdFromPrincipal)
 * - Data sanitization (anonymizeReferralTree)
 * - Deadlock prevention (getCanonicalLockOrder)
 *
 * @packageDocumentation
 */

import { eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  commissionLedger,
  commissionAdjustmentRequests,
  adminUsers,
  members,
} from '@ipoint/database';
import type { RequestActor } from '../../auth/auth.types.js';

/* ------------------------------------------------------------------ */
/*  Error Class                                                       */
/* ------------------------------------------------------------------ */

/**
 * Domain error for commission security and authorization violations.
 */
export class CommissionSecurityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CommissionSecurityError';
  }
}

/* ------------------------------------------------------------------ */
/*  Error Factory Functions                                           */
/* ------------------------------------------------------------------ */

/** Factory: commission ledger entry not found. */
function entryNotFoundError(entryId: string): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_ENTRY_NOT_FOUND',
    `Commission ledger entry not found: ${entryId}`,
    { entryId },
  );
}

/** Factory: the member does not own the specified commission entry. */
function notEntryOwnerError(
  entryId: string,
  memberId: string,
): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_NOT_ENTRY_OWNER',
    `Member ${memberId} is not the beneficiary of commission entry ${entryId}`,
    { entryId, memberId },
  );
}

/** Factory: cross-member access denied. */
function crossMemberAccessError(
  entryId: string,
  memberId: string,
): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_CROSS_MEMBER_ACCESS',
    `Member ${memberId} attempted cross-member access to commission entry ${entryId}`,
    { entryId, memberId },
  );
}

/** Factory: admin does not have commission permissions. */
function adminPermissionDeniedError(adminId: string): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_ADMIN_PERMISSION_DENIED',
    `Admin ${adminId} does not have commission administration permissions`,
    { adminId },
  );
}

/** Factory: checker and maker are the same person. */
function checkerMakerSameError(
  adjustmentId: string,
  makerId: string,
  checkerId: string,
): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_CHECKER_MAKER_SAME',
    'Checker and maker cannot be the same person',
    { adjustmentId, makerId, checkerId },
  );
}

/** Factory: adjustment request not found. */
function adjustmentNotFoundError(
  adjustmentId: string,
): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_ADJUSTMENT_NOT_FOUND',
    `Adjustment request not found: ${adjustmentId}`,
    { adjustmentId },
  );
}

/** Factory: the provided member ID does not match the authenticated principal. */
function memberIdMismatchError(
  providedMemberId: string,
): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_MEMBER_ID_MISMATCH',
    'Provided member ID does not match the authenticated principal',
    { providedMemberId },
  );
}

/** Factory: account resolution found no valid member association. */
function memberResolutionError(): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_MEMBER_RESOLUTION_FAILED',
    'Could not resolve member identity from the provided principal',
  );
}

/** Factory: the provided maker ID does not match the authenticated principal. */
function makerIdMismatchError(
  providedMakerId: string,
): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_MAKER_ID_MISMATCH',
    'Provided maker ID does not match the authenticated principal',
    { providedMakerId },
  );
}

/** Factory: the provided checker ID does not match the authenticated principal. */
function checkerIdMismatchError(
  providedCheckerId: string,
): CommissionSecurityError {
  return new CommissionSecurityError(
    'COMMISSION_CHECKER_ID_MISMATCH',
    'Provided checker ID does not match the authenticated principal',
    { providedCheckerId },
  );
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

/**
 * Security and authorization enforcement for the commission domain.
 *
 * All assertion methods throw `CommissionSecurityError` on failure.
 */
@Injectable()
export class CommissionSecurityService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /* ================================================================ */
  /*  OWNERSHIP VERIFICATION                                           */
  /* ================================================================ */

  /**
   * Verify that a commission ledger entry belongs to the specified member.
   *
   * Queries the `commission_ledger` table and checks that
   * `beneficiaryId` matches `memberId`.
   *
   * @param entryId - The UUID of the commission ledger entry
   * @param memberId - The UUID of the claiming member
   * @returns The verified beneficiary member UUID on success
   * @throws {CommissionSecurityError} If the entry is not found or
   *   does not belong to the member
   */
  async assertOwnCommission(
    entryId: string,
    memberId: string,
  ): Promise<string> {
    const db = this.database.db;

    const rows = await db
      .select({ beneficiaryId: commissionLedger.beneficiaryId })
      .from(commissionLedger)
      .where(eq(commissionLedger.id, entryId))
      .limit(1);

    if (rows.length === 0) {
      throw entryNotFoundError(entryId);
    }

    const beneficiaryId = rows[0]!.beneficiaryId;

    if (beneficiaryId !== memberId) {
      throw notEntryOwnerError(entryId, memberId);
    }

    return beneficiaryId;
  }

  /**
   * Verify that the requesting member is the beneficiary of the entry.
   *
   * Semantically similar to `assertOwnCommission` but uses a distinct
   * error code (`COMMISSION_CROSS_MEMBER_ACCESS`) to distinguish
   * between a routine ownership check and an explicit cross-member
   * access protection.
   *
   * @param entryId - The UUID of the commission ledger entry
   * @param requestingMemberId - The UUID of the requesting member
   * @throws {CommissionSecurityError} If the entry is not found or
   *   the requesting member is not the beneficiary
   */
  async assertBeneficiaryAccess(
    entryId: string,
    requestingMemberId: string,
  ): Promise<void> {
    const db = this.database.db;

    const rows = await db
      .select({ beneficiaryId: commissionLedger.beneficiaryId })
      .from(commissionLedger)
      .where(eq(commissionLedger.id, entryId))
      .limit(1);

    if (rows.length === 0) {
      throw entryNotFoundError(entryId);
    }

    if (rows[0]!.beneficiaryId !== requestingMemberId) {
      throw crossMemberAccessError(entryId, requestingMemberId);
    }
  }

  /* ================================================================ */
  /*  ADMIN PERMISSION CHECKS                                          */
  /* ================================================================ */

  /**
   * Verify that the admin user exists and has an active status.
   *
   * Checks that the provided `adminId` references a row in the
   * `admin_users` table with `status = 'ACTIVE'`.
   *
   * For fine-grained RBAC (e.g. `commission.admin`,
   * `commission.adjustment.maker`, `commission.adjustment.checker`),
   * use `RbacGuard` with `@RequirePermission()` at the controller layer.
   * This method provides a secondary domain-layer check for scenarios
   * where the guard has already run but a fresh verification is needed
   * (e.g. background job processing, internal service calls).
   *
   * @param adminId - The UUID of the admin user
   * @returns The verified admin UUID on success
   * @throws {CommissionSecurityError} If the admin is not found or
   *   not active
   */
  async assertAdminAccess(adminId: string): Promise<string> {
    const db = this.database.db;

    const rows = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId))
      .limit(1);

    if (rows.length === 0) {
      throw adminPermissionDeniedError(adminId);
    }

    return adminId;
  }

  /* ================================================================ */
  /*  MAKER / CHECKER SEGREGATION                                     */
  /* ================================================================ */

  /**
   * Verify that the checker is not the same person as the maker for
   * an adjustment request.
   *
   * Enforces the two-person rule (D-14 frozen): the admin who created
   * the adjustment request (maker) may not also approve or reject it
   * (checker).
   *
   * @param adjustmentId - The UUID of the adjustment request
   * @param checkerId - The UUID of the intended checker
   * @returns The `makerId` of the adjustment request on success
   * @throws {CommissionSecurityError} If the adjustment request is
   *   not found, or if `makerId === checkerId`
   */
  async assertCheckerNotMaker(
    adjustmentId: string,
    checkerId: string,
  ): Promise<string> {
    const db = this.database.db;

    const rows = await db
      .select({ makerId: commissionAdjustmentRequests.makerId })
      .from(commissionAdjustmentRequests)
      .where(eq(commissionAdjustmentRequests.id, adjustmentId))
      .limit(1);

    if (rows.length === 0) {
      throw adjustmentNotFoundError(adjustmentId);
    }

    const makerId = rows[0]!.makerId;

    if (makerId === checkerId) {
      throw checkerMakerSameError(adjustmentId, makerId, checkerId);
    }

    return makerId;
  }

  /* ================================================================ */
  /*  AUTH PRINCIPAL VALIDATION                                       */
  /* ================================================================ */

  /**
   * Verify that the provided member ID matches the authenticated
   * principal's member identity.
   *
   * For **ACCOUNT-type** actors, this method resolves the member UUID
   * linked to the principal's `accountId` via the `members` table
   * (`members.accountId`), then compares it against the provided
   * member ID.
   *
   * Used to prevent member ID spoofing in member-facing endpoints.
   *
   * @param providedMemberId - The member UUID supplied in the request
   * @param authPrincipal - The authenticated request actor from the guard
   * @returns The verified member UUID on success
   * @throws {CommissionSecurityError} If the member ID cannot be verified
   *   or does not match the principal
   */
  async assertMemberIdFromPrincipal(
    providedMemberId: string,
    authPrincipal: RequestActor,
  ): Promise<string> {
    if (authPrincipal.type !== 'ACCOUNT') {
      throw memberResolutionError();
    }

    const db = this.database.db;

    // Resolve member UUID from the account linked to this principal
    const rows = await db
      .select({ memberId: members.id })
      .from(members)
      .where(eq(members.accountId, authPrincipal.accountId))
      .limit(1);

    if (rows.length === 0) {
      throw memberResolutionError();
    }

    const resolvedMemberId = rows[0]!.memberId;

    if (resolvedMemberId !== providedMemberId) {
      throw memberIdMismatchError(providedMemberId);
    }

    return resolvedMemberId;
  }

  /**
   * Verify that the provided maker ID matches the authenticated
   * principal's admin identity.
   *
   * For **ADMIN_USER-type** actors, the principal's `adminUserId`
   * must equal the provided maker ID.
   *
   * Used to prevent admin ID spoofing in adjustment maker endpoints.
   *
   * @param providedMakerId - The maker UUID supplied in the request
   *   or derived from context
   * @param authPrincipal - The authenticated request actor from the guard
   * @returns The verified maker UUID on success
   * @throws {CommissionSecurityError} If the principal is not an admin
   *   user or the maker ID does not match
   */
  assertMakerIdFromPrincipal(
    providedMakerId: string,
    authPrincipal: RequestActor,
  ): string {
    if (authPrincipal.type !== 'ADMIN_USER' || !authPrincipal.adminUserId) {
      throw memberResolutionError();
    }

    if (authPrincipal.adminUserId !== providedMakerId) {
      throw makerIdMismatchError(providedMakerId);
    }

    return providedMakerId;
  }

  /**
   * Verify that the provided checker ID matches the authenticated
   * principal's admin identity.
   *
   * For **ADMIN_USER-type** actors, the principal's `adminUserId`
   * must equal the provided checker ID.
   *
   * Used to prevent admin ID spoofing in adjustment checker endpoints.
   *
   * @param providedCheckerId - The checker UUID supplied in the request
   *   or derived from context
   * @param authPrincipal - The authenticated request actor from the guard
   * @returns The verified checker UUID on success
   * @throws {CommissionSecurityError} If the principal is not an admin
   *   user or the checker ID does not match
   */
  assertCheckerIdFromPrincipal(
    providedCheckerId: string,
    authPrincipal: RequestActor,
  ): string {
    if (authPrincipal.type !== 'ADMIN_USER' || !authPrincipal.adminUserId) {
      throw memberResolutionError();
    }

    if (authPrincipal.adminUserId !== providedCheckerId) {
      throw checkerIdMismatchError(providedCheckerId);
    }

    return providedCheckerId;
  }

  /* ================================================================ */
  /*  DATA SANITIZATION                                                */
  /* ================================================================ */

  /**
   * Strip raw member identifiers from a referral tree response to
   * prevent unintended exposure of internal UUIDs.
   *
   * The `ReferralTreeResponse` type already exposes only
   * non-identifying data (referral code, masked reference, boolean
   * flags, aggregate counts). This method validates that no raw
   * member UUIDs leak through, and returns a sanitized copy with
   * defaulted-safe values.
   *
   * @param tree - The raw referral tree data (which may contain
   *   internal or extraneous fields)
   * @returns A sanitized response with only public-safe fields
   */
  anonymizeReferralTree<
    T extends {
      myCode: string;
      referrer?: {
        maskedReference?: string;
        isAgent?: boolean;
      } | null;
      referrals?: {
        g1Count?: number;
        g2Count?: number;
        g1Agents?: number;
        g2Agents?: number;
      };
    },
  >(
    tree: T,
  ): {
    myCode: string;
    referrer: {
      maskedReference: string;
      isAgent: boolean;
    } | null;
    referrals: {
      g1Count: number;
      g2Count: number;
      g1Agents: number;
      g2Agents: number;
    };
  } {
    return {
      myCode: tree.myCode,
      referrer: tree.referrer
        ? {
            maskedReference: tree.referrer.maskedReference ?? '***',
            isAgent: tree.referrer.isAgent ?? false,
          }
        : null,
      referrals: {
        g1Count: tree.referrals?.g1Count ?? 0,
        g2Count: tree.referrals?.g2Count ?? 0,
        g1Agents: tree.referrals?.g1Agents ?? 0,
        g2Agents: tree.referrals?.g2Agents ?? 0,
      },
    };
  }

  /* ================================================================ */
  /*  DEADLOCK PREVENTION                                              */
  /* ================================================================ */

  /**
   * Return a deterministic canonical lock order for a set of
   * beneficiary UUIDs.
   *
   * Sorting UUIDs in ascending lexical (string) order before
   * acquiring database row locks prevents deadlocks when multiple
   * transactions attempt to lock the same set of rows in different
   * orders. All code paths that lock commission-related rows
   * should call this method to establish an agreed ordering.
   *
   * UUIDs are compared using standard lexical sort (`localeCompare`),
   * which is deterministic for fixed-format hex strings.
   *
   * @param beneficiaryIds - Array of beneficiary member UUIDs
   * @returns A new array sorted in ascending UUID order (lexical)
   */
  getCanonicalLockOrder(beneficiaryIds: string[]): string[] {
    return [...beneficiaryIds].sort((a, b) => a.localeCompare(b));
  }
}
