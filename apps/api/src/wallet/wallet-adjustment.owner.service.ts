import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  adminUsers,
  ipointAdjustmentDecisions,
  ipointAdjustmentMarketRules,
  ipointAdjustmentReasonCodes,
  ipointAdjustmentRequests,
  markets,
  memberWalletAccounts,
  memberWalletEntries,
  roleAssignments,
  roles,
  type Database,
} from '@ipoint/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { RbacService } from '../platform-access/rbac.service.js';
import { TRANSACTION_EXECUTION_OPTIONS } from '../transaction/transaction-reliability.js';
import {
  walletAdjustmentAboveHardCapError,
  walletAdjustmentAttachmentRequiredError,
  walletAdjustmentCheckerRoutingDeniedError,
  walletAdjustmentDecisionReasonRequiredError,
  walletAdjustmentEvidenceStorageUnavailableError,
  walletAdjustmentExecutionFailedError,
  walletAdjustmentIdempotencyConflictError,
  walletAdjustmentIdempotencyKeyRequiredError,
  walletAdjustmentInsufficientBalanceError,
  walletAdjustmentInvalidAmountError,
  walletAdjustmentInvalidFieldError,
  walletAdjustmentMakerCheckerConflictError,
  walletAdjustmentMakerRequiredError,
  walletAdjustmentMarketAccessDeniedError,
  walletAdjustmentMarketContextMismatchError,
  walletAdjustmentMarketNotConfiguredError,
  walletAdjustmentMarketSelectionRequiredError,
  walletAdjustmentPermissionDeniedError,
  walletAdjustmentPriorRequestInvalidError,
  walletAdjustmentReasonCodeInvalidError,
  walletAdjustmentRequestNotFoundError,
  walletAdjustmentStateConflictError,
  walletAdjustmentWalletNotFoundError,
} from './wallet-adjustment.owner.errors.js';
import type {
  AdjustmentDecisionCommand,
  AdjustmentExecutionResult,
  CreateAdjustmentCommand,
  IpointAdjustmentDirection,
  WalletAdjustmentOwnerActor,
  WalletAdjustmentRequestView,
} from './wallet-adjustment.owner.types.js';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

/** Idempotency scope namespace for the OWNER create command. */
const ADJUSTMENT_OWNER_IDEMPOTENCY_SCOPE = 'ipoint.adjustment.owner.create';

/** Entry reference type written on the immutable wallet ledger entry. */
const LEDGER_REFERENCE_TYPE = 'IPOINT_ADJUSTMENT';

/** Amount grammar: positive exact decimal, at most 10 decimal places. */
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,10})?$/u;

interface MarketRuleRow {
  marketCode: string;
  softCap: string;
  hardCap: string;
  secureEvidenceAvailable: boolean;
  isActive: boolean;
}

interface ReasonCodeRow {
  code: string;
  isHighRisk: boolean;
  isActive: boolean;
}

/**
 * P7 SEC-01 secured Manual iPoint Adjustment owner (GATE-SEC-01).
 *
 * This owner lives in the frozen Phase 3 wallet domain (`apps/api/src/wallet/`)
 * as NEW code; the existing member-facing wallet behavior is untouched.
 * The full lifecycle (P7-OD-20) is enforced HERE so an in-process caller
 * receives the exact same controls as an HTTP route:
 *
 *   DRAFT -> SUBMITTED -> APPROVED | REJECTED -> EXECUTING -> EXECUTED | FAILED
 *
 * Owner contract:
 *  1. Identity + permission re-checked server-side for every command
 *     (`wallet.ipoint.adjust.maker` for create/submit,
 *     `wallet.ipoint.adjust.checker` for decide,
 *     `wallet.ipoint.adjust.execute` for execute) plus active Market Access.
 *  2. Selected-market enforcement: the server Current Admin Market must
 *     equal the wallet/request market (MARKET_CONTEXT_MISMATCH otherwise).
 *  3. Distinct server-derived Maker/Checker identities at EVERY amount,
 *     including Super Admin (runtime inequality + DB CHECK).
 *  4. Caps routing (P7-OD-10): versioned per-market soft/hard caps
 *     (Malaysia baseline 10,000 / 100,000 iPoint). > hard cap rejected at
 *     create. At/below soft cap a Finance Approver may check; above soft
 *     through hard cap a Super Admin MUST check. No threshold exemption,
 *     no cross-market fallback.
 *  5. Evidence (P7-OD-11): reason code + explanation + case reference +
 *     maker/checker identity + timestamps always required; opaque
 *     attachment reference mandatory above soft cap, for high-risk reason
 *     codes, or when the checker requests it. Above-soft-cap EXECUTION
 *     stays disabled until secure evidence storage is enabled for the
 *     market (P7-OD-11).
 *  6. Rejected requests are immutable; a replacement is a NEW request with
 *     new idempotency/decision records and explicit `priorRequestId`
 *     linkage (P7-OD-18).
 *  7. Payload-hash idempotency: unique (scope, key); same key + same
 *     payload replays the stored request; same key + different payload
 *     -> conflict. Deterministic concurrency via row locks.
 *  8. Execution: the wallet ledger append (dedicated wallet-domain command,
 *     exact-opposite direction semantics), request state -> EXECUTED and
 *     the immutable audit commit atomically in ONE transaction. On an
 *     injected ledger failure the whole transaction rolls back (no
 *     partial ledger) and the request is durably marked FAILED; retries
 *     never duplicate a ledger effect.
 *  9. No direct balance mutation anywhere outside the wallet-domain ledger
 *     append; the ledger entry is immutable with exact before/after
 *     snapshots and a unique idempotency key.
 */
@Injectable()
export class WalletAdjustmentOwnerService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ─── Maker: create (Draft/Create) ──────────────────────────────────

  async create(
    actor: WalletAdjustmentOwnerActor,
    command: CreateAdjustmentCommand,
  ): Promise<WalletAdjustmentRequestView> {
    if (!actor?.adminUserId) throw walletAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'wallet.ipoint.adjust.maker',
    });
    if (!allowed) throw walletAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw walletAdjustmentMarketSelectionRequiredError();

    const amount = command.amount.trim();
    if (!AMOUNT_PATTERN.test(amount))
      throw walletAdjustmentInvalidAmountError();
    if (/^0+$/u.test(amount.replace('.', ''))) {
      throw walletAdjustmentInvalidAmountError();
    }
    if (command.direction !== 'CREDIT' && command.direction !== 'DEBIT') {
      throw walletAdjustmentInvalidFieldError('direction');
    }
    const explanation = command.explanation?.trim() ?? '';
    if (!explanation || explanation.length > 2000) {
      throw walletAdjustmentInvalidFieldError('explanation');
    }
    const caseReference = command.caseReference?.trim() ?? '';
    if (!caseReference || caseReference.length > 200) {
      throw walletAdjustmentInvalidFieldError('caseReference');
    }
    const attachmentReference = command.attachmentReference?.trim() ?? null;
    if (attachmentReference && attachmentReference.length > 500) {
      throw walletAdjustmentInvalidFieldError('attachmentReference');
    }

    const idempotencyKey = command.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw walletAdjustmentIdempotencyKeyRequiredError();
    }

    const wallet = await this.walletRow(command.walletAccountId);
    if (!wallet) throw walletAdjustmentWalletNotFoundError();
    if (actor.currentMarketId !== wallet.marketId) {
      throw walletAdjustmentMarketContextMismatchError();
    }
    await this.assertMarketAccess(actor, wallet.marketId);

    const market = await this.activeMarketRow(wallet.marketId);
    if (!market) throw walletAdjustmentMarketAccessDeniedError();
    const rule = await this.activeMarketRule(market.code);
    if (!rule) throw walletAdjustmentMarketNotConfiguredError(market.code);
    if (!lteDecimal(amount, rule.hardCap)) {
      throw walletAdjustmentAboveHardCapError(amount, rule.hardCap);
    }

    const reason = await this.activeReasonCode(market.code, command.reasonCode);
    if (!reason) {
      throw walletAdjustmentReasonCodeInvalidError(command.reasonCode);
    }

    const aboveSoft = !lteDecimal(amount, rule.softCap);
    if ((aboveSoft || reason.isHighRisk) && !this.hasAttachment(command)) {
      throw walletAdjustmentAttachmentRequiredError();
    }

    if (command.priorRequestId) {
      await this.assertValidPriorRequest(
        command.priorRequestId,
        wallet.marketId,
        wallet.id,
      );
    }

    const memberId = wallet.memberId;
    const payloadHash = canonicalHash({
      operation: 'ipoint.adjustment.create',
      walletAccountId: wallet.id,
      memberId,
      marketId: wallet.marketId,
      direction: command.direction,
      amount,
      reasonCode: command.reasonCode.trim(),
      explanation,
      caseReference,
      attachmentReference,
      priorRequestId: command.priorRequestId ?? null,
    });
    const requestHash = canonicalHash({
      ...payloadFields(command, wallet, market.code),
      makerAdminUserId: actor.adminUserId,
      idempotencyKey,
    });
    const scope = `${ADJUSTMENT_OWNER_IDEMPOTENCY_SCOPE}:${wallet.id}:${actor.adminUserId}`;

    try {
      return await this.database.runTransaction(async (tx) => {
        const claimed = await tx
          .insert(ipointAdjustmentRequests)
          .values({
            walletAccountId: wallet.id,
            memberId,
            marketId: wallet.marketId,
            direction: command.direction,
            amount,
            state: 'DRAFT',
            reasonCode: command.reasonCode.trim(),
            explanation,
            caseReference,
            attachmentReference,
            makerAdminUserId: actor.adminUserId,
            idempotencyScope: scope,
            idempotencyKey,
            payloadHash,
            requestHash,
            priorRequestId: command.priorRequestId ?? null,
            version: 1,
          })
          .onConflictDoNothing({
            target: [
              ipointAdjustmentRequests.idempotencyScope,
              ipointAdjustmentRequests.idempotencyKey,
            ],
          })
          .returning();

        if (claimed.length === 0) {
          return this.replayOrConflict(tx, scope, idempotencyKey, payloadHash);
        }
        const request = claimed[0];
        if (!request) throw walletAdjustmentRequestNotFoundError();
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'ipoint.adjustment.create',
          entity: { type: 'ipoint_adjustment_request', id: request.id },
          marketId: wallet.marketId,
          before: null,
          after: { state: request.state, amount, direction: request.direction },
          reason: request.explanation,
          result: 'SUCCESS',
          requestId: actor.requestId ?? idempotencyKey,
          ipAddress: actor.ipAddress,
          summary: `Manual iPoint ${request.direction} adjustment of ${amount} requested for wallet ${wallet.id} (market ${market.code}).`,
        });
        return this.toView(request);
      }, TRANSACTION_EXECUTION_OPTIONS);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return this.replayOrConflict(
          this.database.db,
          scope,
          idempotencyKey,
          payloadHash,
        );
      }
      throw error;
    }
  }

  // ─── Maker: submit (DRAFT -> SUBMITTED) ────────────────────────────

  async submit(
    actor: WalletAdjustmentOwnerActor,
    requestId: string,
  ): Promise<WalletAdjustmentRequestView> {
    if (!actor?.adminUserId) throw walletAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'wallet.ipoint.adjust.maker',
    });
    if (!allowed) throw walletAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw walletAdjustmentMarketSelectionRequiredError();

    return this.database.runTransaction(async (tx) => {
      const request = await this.lockRequest(tx, requestId);
      if (!request) throw walletAdjustmentRequestNotFoundError();
      if (actor.currentMarketId !== request.marketId) {
        throw walletAdjustmentMarketContextMismatchError();
      }
      await this.assertMarketAccess(actor, request.marketId);
      if (request.makerAdminUserId !== actor.adminUserId) {
        throw walletAdjustmentMakerRequiredError();
      }
      if (request.state !== 'DRAFT') {
        throw walletAdjustmentStateConflictError(request.state);
      }
      const updated = await tx
        .update(ipointAdjustmentRequests)
        .set({
          state: 'SUBMITTED',
          submittedAt: new Date(),
          version: sql`${ipointAdjustmentRequests.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ipointAdjustmentRequests.id, requestId),
            eq(ipointAdjustmentRequests.version, request.version),
          ),
        )
        .returning();
      const row = updated[0];
      if (!row) throw walletAdjustmentStateConflictError(request.state);
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'ipoint.adjustment.submit',
        entity: { type: 'ipoint_adjustment_request', id: requestId },
        marketId: request.marketId,
        before: { state: request.state },
        after: { state: row.state },
        reason: request.explanation,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: `Manual iPoint adjustment ${requestId} submitted for checker review.`,
      });
      return this.toView(row);
    }, TRANSACTION_EXECUTION_OPTIONS);
  }

  // ─── Checker: decide (SUBMITTED -> APPROVED | REJECTED) ────────────

  async decide(
    actor: WalletAdjustmentOwnerActor,
    requestId: string,
    command: AdjustmentDecisionCommand,
  ): Promise<WalletAdjustmentRequestView> {
    if (!actor?.adminUserId) throw walletAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'wallet.ipoint.adjust.checker',
    });
    if (!allowed) throw walletAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw walletAdjustmentMarketSelectionRequiredError();

    const decisionReason = command.reason?.trim() ?? '';
    if (!decisionReason || decisionReason.length > 2000) {
      throw walletAdjustmentDecisionReasonRequiredError();
    }

    return this.database.runTransaction(async (tx) => {
      const request = await this.lockRequest(tx, requestId);
      if (!request) throw walletAdjustmentRequestNotFoundError();
      if (actor.currentMarketId !== request.marketId) {
        throw walletAdjustmentMarketContextMismatchError();
      }
      await this.assertMarketAccess(actor, request.marketId);
      if (request.makerAdminUserId === actor.adminUserId) {
        throw walletAdjustmentMakerCheckerConflictError();
      }
      if (request.state !== 'SUBMITTED') {
        throw walletAdjustmentStateConflictError(request.state);
      }

      // Checker revalidates the live target + limits inside the decision
      // boundary (P7-S1 §16): wallet still exists and matches the market.
      const wallet = await this.walletRowById(tx, request.walletAccountId);
      if (!wallet || wallet.market_id !== request.marketId) {
        throw walletAdjustmentWalletNotFoundError();
      }
      const market = await this.activeMarketRow(request.marketId);
      if (!market) throw walletAdjustmentMarketAccessDeniedError();
      const rule = await this.activeMarketRule(market.code);
      if (!rule) throw walletAdjustmentMarketNotConfiguredError(market.code);
      const aboveSoft = !lteDecimal(request.amount, rule.softCap);
      if (!lteDecimal(request.amount, rule.hardCap)) {
        throw walletAdjustmentAboveHardCapError(request.amount, rule.hardCap);
      }
      const reason = await this.activeReasonCode(
        market.code,
        request.reasonCode,
      );
      if (!reason) {
        throw walletAdjustmentReasonCodeInvalidError(request.reasonCode);
      }

      // Caps routing (P7-OD-10): above soft cap -> Super Admin MUST check.
      if (aboveSoft) {
        const isSuperAdmin = await this.hasRole(
          tx,
          actor.adminUserId,
          'SUPER_ADMIN',
        );
        if (!isSuperAdmin) throw walletAdjustmentCheckerRoutingDeniedError();
      }

      // Evidence (P7-OD-11): attachment mandatory above soft cap, for
      // high-risk reason codes, or when the checker explicitly requests it.
      if (
        (aboveSoft || reason.isHighRisk || command.requireAttachment) &&
        !request.attachmentReference
      ) {
        throw walletAdjustmentAttachmentRequiredError();
      }

      await tx.insert(ipointAdjustmentDecisions).values({
        adjustmentRequestId: requestId,
        marketId: request.marketId,
        checkerAdminUserId: actor.adminUserId,
        decision: command.decision,
        reason: decisionReason,
      });

      const updated = await tx
        .update(ipointAdjustmentRequests)
        .set({
          state: command.decision,
          checkerAdminUserId: actor.adminUserId,
          version: sql`${ipointAdjustmentRequests.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ipointAdjustmentRequests.id, requestId),
            eq(ipointAdjustmentRequests.version, request.version),
          ),
        )
        .returning();
      const row = updated[0];
      if (!row) throw walletAdjustmentStateConflictError(request.state);
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action:
          command.decision === 'APPROVED'
            ? 'ipoint.adjustment.approve'
            : 'ipoint.adjustment.reject',
        entity: { type: 'ipoint_adjustment_request', id: requestId },
        marketId: request.marketId,
        before: { state: request.state, checker: null },
        after: { state: row.state, checker: actor.adminUserId },
        reason: decisionReason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: `Manual iPoint adjustment ${requestId} ${command.decision.toLowerCase()} by checker ${actor.adminUserId}.`,
      });
      return this.toView(row);
    }, TRANSACTION_EXECUTION_OPTIONS);
  }

  // ─── Checker: execute (APPROVED -> EXECUTING -> EXECUTED | FAILED) ─

  async execute(
    actor: WalletAdjustmentOwnerActor,
    requestId: string,
  ): Promise<WalletAdjustmentRequestView> {
    if (!actor?.adminUserId) throw walletAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'wallet.ipoint.adjust.execute',
    });
    if (!allowed) throw walletAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw walletAdjustmentMarketSelectionRequiredError();

    // Set to true only once the execution attempt (EXECUTING + ledger
    // append) has started; validation failures before that point leave the
    // request APPROVED and retryable.
    let attempted = false;
    try {
      return await this.database.runTransaction(async (tx) => {
        const request = await this.lockRequest(tx, requestId);
        if (!request) throw walletAdjustmentRequestNotFoundError();
        if (actor.currentMarketId !== request.marketId) {
          throw walletAdjustmentMarketContextMismatchError();
        }
        await this.assertMarketAccess(actor, request.marketId);

        // Terminal outcomes replay without touching the ledger (retry
        // safety: no duplicate ledger effect).
        if (request.state === 'EXECUTED' || request.state === 'FAILED') {
          return this.toView(request);
        }
        if (request.state !== 'APPROVED') {
          throw walletAdjustmentStateConflictError(request.state);
        }
        if (request.makerAdminUserId === actor.adminUserId) {
          throw walletAdjustmentMakerCheckerConflictError();
        }

        // Full revalidation inside the execution boundary.
        const wallet = await this.walletRowById(tx, request.walletAccountId);
        if (!wallet || wallet.market_id !== request.marketId) {
          throw walletAdjustmentWalletNotFoundError();
        }
        const market = await this.activeMarketRow(request.marketId);
        if (!market) throw walletAdjustmentMarketAccessDeniedError();
        const rule = await this.activeMarketRule(market.code);
        if (!rule) throw walletAdjustmentMarketNotConfiguredError(market.code);
        const aboveSoft = !lteDecimal(request.amount, rule.softCap);
        if (!lteDecimal(request.amount, rule.hardCap)) {
          throw walletAdjustmentAboveHardCapError(request.amount, rule.hardCap);
        }
        const reason = await this.activeReasonCode(
          market.code,
          request.reasonCode,
        );
        if (!reason) {
          throw walletAdjustmentReasonCodeInvalidError(request.reasonCode);
        }
        if ((aboveSoft || reason.isHighRisk) && !request.attachmentReference) {
          throw walletAdjustmentAttachmentRequiredError();
        }
        // P7-OD-11: above-soft-cap execution stays disabled until secure
        // evidence storage is enabled for this market.
        if (aboveSoft && !rule.secureEvidenceAvailable) {
          throw walletAdjustmentEvidenceStorageUnavailableError();
        }

        attempted = true;
        // Atomic: state -> EXECUTING, wallet ledger append (dedicated
        // wallet-domain command), state -> EXECUTED, immutable audit and
        // the unique ledger idempotency claim all in ONE transaction.
        await tx
          .update(ipointAdjustmentRequests)
          .set({
            state: 'EXECUTING',
            version: sql`${ipointAdjustmentRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ipointAdjustmentRequests.id, requestId),
              eq(ipointAdjustmentRequests.version, request.version),
            ),
          );

        const result = await this.appendLedgerEntry(tx, {
          wallet,
          memberId: request.memberId,
          marketId: request.marketId,
          direction: request.direction,
          amount: request.amount,
          idempotencyKey: `ipoint-adjustment:${requestId}`,
          referenceId: requestId,
          reason: request.explanation,
          actorId: actor.adminUserId,
        });

        const updated = await tx
          .update(ipointAdjustmentRequests)
          .set({
            state: 'EXECUTED',
            ledgerEntryId: result.ledgerEntryId,
            executedAt: new Date(),
            version: sql`${ipointAdjustmentRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(ipointAdjustmentRequests.id, requestId))
          .returning();
        const row = updated[0];
        if (!row) throw walletAdjustmentExecutionFailedError();

        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'ipoint.adjustment.execute',
          entity: { type: 'ipoint_adjustment_request', id: requestId },
          marketId: request.marketId,
          before: { state: 'APPROVED', availableBalance: result.balanceBefore },
          after: { state: 'EXECUTED', availableBalance: result.balanceAfter },
          reason: request.explanation,
          result: 'SUCCESS',
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          summary: `Manual iPoint ${request.direction} adjustment of ${request.amount} executed on wallet ${request.walletAccountId} (ledger ${result.ledgerEntryId}).`,
        });
        return this.toView(row);
      }, TRANSACTION_EXECUTION_OPTIONS);
    } catch (error) {
      if (!attempted || !(error instanceof Error)) throw error;
      // The execution attempt failed: the transaction above rolled back
      // completely (no partial ledger). Durably mark the request FAILED in
      // a fresh transaction and record the failure audit. Retry-safe: a
      // later execute replays the FAILED outcome without touching the
      // ledger, so retries never create a duplicate ledger effect.
      const failed = await this.markFailed(requestId, actor, error);
      if (failed) return failed;
      throw error;
    }
  }

  // ─── Ledger append (dedicated wallet-domain command) ───────────────

  /**
   * The dedicated direction-aware wallet ledger append for iPoint
   * adjustments. Mirrors the frozen `WalletService.createLedgerEntry`
   * immutable-ledger semantics (sequence, exact before/after snapshots,
   * version-guarded balance update, global idempotency key) and adds the
   * exact-opposite direction semantics required by P7-OD-20:
   *   CREDIT -> available_balance += amount (ADJUSTMENT entry)
   *   DEBIT  -> available_balance -= amount (exact-opposite correction)
   * The entry stores the positive magnitude plus the exact before/after;
   * the direction is preserved by the request linkage and the balance
   * projection. Public so tests can inject a failure at the ledger seam.
   */
  async appendLedgerEntry(
    tx: DbTransaction,
    params: {
      wallet: {
        id: string;
        member_id: string;
        market_id: string;
        available_balance: string;
        version: number;
        archived_at: Date | null;
      };
      memberId: string;
      marketId: string;
      direction: IpointAdjustmentDirection;
      amount: string;
      idempotencyKey: string;
      referenceId: string;
      reason: string;
      actorId: string;
    },
  ): Promise<AdjustmentExecutionResult> {
    if (params.wallet.archived_at) throw walletAdjustmentWalletNotFoundError();

    const existing = await tx
      .select({ id: memberWalletEntries.id })
      .from(memberWalletEntries)
      .where(eq(memberWalletEntries.idempotencyKey, params.idempotencyKey))
      .limit(1);
    if (existing[0]) {
      return {
        ledgerEntryId: existing[0].id,
        balanceBefore: params.wallet.available_balance,
        balanceAfter: params.wallet.available_balance,
      };
    }

    const locked = await tx
      .select()
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.id, params.wallet.id))
      .for('update')
      .limit(1);
    const wallet = locked[0];
    if (!wallet || wallet.archivedAt)
      throw walletAdjustmentWalletNotFoundError();

    const balanceBefore = wallet.availableBalance;
    const delta =
      params.direction === 'CREDIT' ? params.amount : `-${params.amount}`;
    if (
      params.direction === 'DEBIT' &&
      !gteDecimal(balanceBefore, params.amount)
    ) {
      throw walletAdjustmentInsufficientBalanceError();
    }
    const balanceAfter = addDecimal(balanceBefore, delta);

    const maxSeq = await tx
      .select({
        next: sql<bigint>`COALESCE(MAX(${memberWalletEntries.entrySequence}), 0) + 1`,
      })
      .from(memberWalletEntries)
      .where(eq(memberWalletEntries.walletAccountId, wallet.id));
    const nextSeq = BigInt(String(maxSeq[0]?.next ?? 1));

    const updated = await tx
      .update(memberWalletAccounts)
      .set({
        availableBalance: sql`CAST(${memberWalletAccounts.availableBalance} AS numeric(38,10)) + CAST(${delta} AS numeric(38,10))`,
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
    if (!updated[0]) {
      throw walletAdjustmentExecutionFailedError();
    }

    const entries = await tx
      .insert(memberWalletEntries)
      .values({
        walletAccountId: wallet.id,
        memberId: params.memberId,
        marketId: params.marketId,
        entrySequence: nextSeq,
        entryType: 'ADJUSTMENT',
        amount: params.amount,
        balanceBefore,
        balanceAfter,
        idempotencyKey: params.idempotencyKey,
        referenceType: LEDGER_REFERENCE_TYPE,
        referenceId: params.referenceId,
        description: `Manual iPoint ${params.direction} adjustment (${params.referenceId}).`,
        reason: params.reason,
        actorId: params.actorId,
        marketTimezone: null,
      })
      .returning();
    const entry = entries[0];
    if (!entry) throw walletAdjustmentExecutionFailedError();
    return {
      ledgerEntryId: entry.id,
      balanceBefore,
      balanceAfter,
    };
  }

  // ─── Revalidation helpers ──────────────────────────────────────────

  private async walletRow(walletAccountId: string): Promise<
    | {
        id: string;
        memberId: string;
        marketId: string;
        availableBalance: string;
        version: number;
        archivedAt: Date | null;
      }
    | undefined
  > {
    const rows = await this.database.db
      .select({
        id: memberWalletAccounts.id,
        memberId: memberWalletAccounts.memberId,
        marketId: memberWalletAccounts.marketId,
        availableBalance: memberWalletAccounts.availableBalance,
        version: memberWalletAccounts.version,
        archivedAt: memberWalletAccounts.archivedAt,
      })
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.id, walletAccountId))
      .limit(1);
    const row = rows[0];
    if (!row || row.archivedAt) return undefined;
    return row;
  }

  private async walletRowById(
    db: DbExecutor,
    walletAccountId: string,
  ): Promise<
    | {
        id: string;
        member_id: string;
        market_id: string;
        available_balance: string;
        version: number;
        archived_at: Date | null;
      }
    | undefined
  > {
    const rows = await db
      .select({
        id: memberWalletAccounts.id,
        member_id: memberWalletAccounts.memberId,
        market_id: memberWalletAccounts.marketId,
        available_balance: memberWalletAccounts.availableBalance,
        version: memberWalletAccounts.version,
        archived_at: memberWalletAccounts.archivedAt,
      })
      .from(memberWalletAccounts)
      .where(eq(memberWalletAccounts.id, walletAccountId))
      .limit(1);
    const row = rows[0];
    if (!row || row.archived_at) return undefined;
    return row;
  }

  private async activeMarketRow(
    marketId: string,
  ): Promise<{ id: string; code: string } | undefined> {
    const rows = await this.database.db
      .select({ id: markets.id, code: markets.code })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.status, 'ACTIVE')))
      .limit(1);
    return rows[0];
  }

  private async activeMarketRule(
    marketCode: string,
  ): Promise<MarketRuleRow | undefined> {
    const rows = await this.database.db
      .select({
        marketCode: ipointAdjustmentMarketRules.marketCode,
        softCap: ipointAdjustmentMarketRules.softCap,
        hardCap: ipointAdjustmentMarketRules.hardCap,
        secureEvidenceAvailable:
          ipointAdjustmentMarketRules.secureEvidenceAvailable,
        isActive: ipointAdjustmentMarketRules.isActive,
      })
      .from(ipointAdjustmentMarketRules)
      .where(
        and(
          eq(ipointAdjustmentMarketRules.marketCode, marketCode),
          eq(ipointAdjustmentMarketRules.isActive, true),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async activeReasonCode(
    marketCode: string,
    code: string,
  ): Promise<ReasonCodeRow | undefined> {
    const rows = await this.database.db
      .select({
        code: ipointAdjustmentReasonCodes.code,
        isHighRisk: ipointAdjustmentReasonCodes.isHighRisk,
        isActive: ipointAdjustmentReasonCodes.isActive,
      })
      .from(ipointAdjustmentReasonCodes)
      .where(
        and(
          eq(ipointAdjustmentReasonCodes.marketCode, marketCode),
          eq(ipointAdjustmentReasonCodes.code, code),
          eq(ipointAdjustmentReasonCodes.isActive, true),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async assertMarketAccess(
    actor: WalletAdjustmentOwnerActor,
    marketId: string,
  ): Promise<void> {
    const ok = await this.rbac.hasMarketAccess(actor.adminUserId, marketId);
    if (!ok) throw walletAdjustmentMarketAccessDeniedError();
  }

  private async hasRole(
    db: DbExecutor,
    adminUserId: string,
    roleCode: string,
  ): Promise<boolean> {
    const rows = await db
      .select({ id: roles.id })
      .from(roles)
      .innerJoin(roleAssignments, eq(roleAssignments.roleId, roles.id))
      .innerJoin(adminUsers, eq(adminUsers.id, roleAssignments.adminUserId))
      .where(
        and(
          eq(roleAssignments.adminUserId, adminUserId),
          eq(roles.code, roleCode),
          isNull(roleAssignments.revokedAt),
          isNull(roles.archivedAt),
          eq(adminUsers.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  private async lockRequest(
    tx: DbTransaction,
    requestId: string,
  ): Promise<typeof ipointAdjustmentRequests.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(ipointAdjustmentRequests)
      .where(eq(ipointAdjustmentRequests.id, requestId))
      .for('update')
      .limit(1);
    return rows[0];
  }

  private async assertValidPriorRequest(
    priorRequestId: string,
    marketId: string,
    walletAccountId: string,
  ): Promise<void> {
    const rows = await this.database.db
      .select({
        id: ipointAdjustmentRequests.id,
        state: ipointAdjustmentRequests.state,
        marketId: ipointAdjustmentRequests.marketId,
        walletAccountId: ipointAdjustmentRequests.walletAccountId,
      })
      .from(ipointAdjustmentRequests)
      .where(eq(ipointAdjustmentRequests.id, priorRequestId))
      .limit(1);
    const prior = rows[0];
    if (
      !prior ||
      prior.state !== 'REJECTED' ||
      prior.marketId !== marketId ||
      prior.walletAccountId !== walletAccountId
    ) {
      throw walletAdjustmentPriorRequestInvalidError();
    }
  }

  private async replayOrConflict(
    db: DbExecutor,
    scope: string,
    key: string,
    payloadHash: string,
  ): Promise<WalletAdjustmentRequestView> {
    const rows = await db
      .select()
      .from(ipointAdjustmentRequests)
      .where(
        and(
          eq(ipointAdjustmentRequests.idempotencyScope, scope),
          eq(ipointAdjustmentRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.payloadHash !== payloadHash) {
      throw walletAdjustmentIdempotencyConflictError();
    }
    return this.toView(existing);
  }

  private async markFailed(
    requestId: string,
    actor: WalletAdjustmentOwnerActor,
    cause: Error,
  ): Promise<WalletAdjustmentRequestView | null> {
    try {
      return await this.database.runTransaction(async (tx) => {
        const request = await this.lockRequest(tx, requestId);
        if (!request) return null;
        if (request.state !== 'APPROVED' && request.state !== 'EXECUTING') {
          return null;
        }
        const updated = await tx
          .update(ipointAdjustmentRequests)
          .set({
            state: 'FAILED',
            failedAt: new Date(),
            version: sql`${ipointAdjustmentRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(ipointAdjustmentRequests.id, requestId))
          .returning();
        const row = updated[0];
        if (!row) return null;
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'ipoint.adjustment.execute_failed',
          entity: { type: 'ipoint_adjustment_request', id: requestId },
          marketId: request.marketId,
          before: { state: request.state },
          after: { state: 'FAILED' },
          reason: `Execution failed and fully rolled back. Cause: ${cause.message}`,
          result: 'FAILURE',
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          summary: `Manual iPoint adjustment ${requestId} execution failed; no ledger effect was committed.`,
        });
        return this.toView(row);
      }, TRANSACTION_EXECUTION_OPTIONS);
    } catch {
      return null;
    }
  }

  // ─── Projection + helpers ──────────────────────────────────────────

  private toView(
    row: typeof ipointAdjustmentRequests.$inferSelect,
  ): WalletAdjustmentRequestView {
    return {
      id: row.id,
      walletAccountId: row.walletAccountId,
      memberId: row.memberId,
      marketId: row.marketId,
      direction: row.direction,
      amount: row.amount,
      state: row.state,
      reasonCode: row.reasonCode,
      explanation: row.explanation,
      caseReference: row.caseReference,
      attachmentReference: row.attachmentReference,
      makerAdminUserId: row.makerAdminUserId,
      checkerAdminUserId: row.checkerAdminUserId,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      priorRequestId: row.priorRequestId,
      ledgerEntryId: row.ledgerEntryId,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private hasAttachment(command: CreateAdjustmentCommand): boolean {
    const reference = command.attachmentReference?.trim() ?? '';
    return reference.length > 0 && reference.length <= 500;
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

function payloadFields(
  command: CreateAdjustmentCommand,
  wallet: { id: string; memberId: string; marketId: string },
  marketCode: string,
): Record<string, unknown> {
  return {
    operation: 'ipoint.adjustment.create',
    walletAccountId: wallet.id,
    memberId: wallet.memberId,
    marketId: wallet.marketId,
    marketCode,
    direction: command.direction,
    amount: command.amount.trim(),
    reasonCode: command.reasonCode.trim(),
    explanation: command.explanation.trim(),
    caseReference: command.caseReference.trim(),
    attachmentReference: command.attachmentReference?.trim() ?? null,
    priorRequestId: command.priorRequestId ?? null,
  };
}

/** Canonical payload hash: stable-sorted keys + sha256 (never floats). */
export function canonicalHash(payload: Record<string, unknown>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(payload[key])}`)
    .join(',');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Exact decimal comparison: a <= b (strings, 38,10 scale). */
export function lteDecimal(a: string, b: string): boolean {
  return !gtDecimal(a, b);
}

/** Exact decimal comparison: a > b (strings, 38,10 scale). */
export function gtDecimal(a: string, b: string): boolean {
  const scale = (value: string) =>
    value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  const scaleMax = Math.max(scale(a), scale(b));
  const pad = (value: string) => {
    const [wholeRaw, fraction = ''] = value.split('.');
    const whole = wholeRaw ?? '0';
    return `${whole.padStart(20, '0')}.${fraction.padEnd(scaleMax, '0')}`;
  };
  return pad(a) > pad(b);
}

/** Exact decimal comparison: a >= b (strings, 38,10 scale). */
export function gteDecimal(a: string, b: string): boolean {
  const scale = (value: string) =>
    value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  const scaleMax = Math.max(scale(a), scale(b));
  const pad = (value: string) => {
    const [wholeRaw, fraction = ''] = value.split('.');
    const whole = wholeRaw ?? '0';
    return `${whole.padStart(20, '0')}.${fraction.padEnd(scaleMax, '0')}`;
  };
  return pad(a) >= pad(b);
}

/** Exact decimal addition with sign support (strings). */
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
