import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  adminUsers,
  mcpAccounts,
  mcpAdjustmentDecisions,
  mcpAdjustmentMarketRules,
  mcpAdjustmentReasonCodes,
  mcpAdjustmentRequests,
  mcpLedgerEntries,
  markets,
  roleAssignments,
  roles,
  type Database,
} from '@ipoint/database';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { RbacService } from '../platform-access/rbac.service.js';
import { TRANSACTION_EXECUTION_OPTIONS } from '../transaction/transaction-reliability.js';
import {
  mcpAdjustmentAboveHardCapError,
  mcpAdjustmentAccountNotFoundError,
  mcpAdjustmentAttachmentRequiredError,
  mcpAdjustmentCheckerRoutingDeniedError,
  mcpAdjustmentDecisionReasonRequiredError,
  mcpAdjustmentEvidenceStorageUnavailableError,
  mcpAdjustmentExecutionFailedError,
  mcpAdjustmentIdempotencyConflictError,
  mcpAdjustmentIdempotencyKeyRequiredError,
  mcpAdjustmentInvalidAmountError,
  mcpAdjustmentInvalidFieldError,
  mcpAdjustmentMakerCheckerConflictError,
  mcpAdjustmentMakerRequiredError,
  mcpAdjustmentMarketAccessDeniedError,
  mcpAdjustmentMarketContextMismatchError,
  mcpAdjustmentMarketNotConfiguredError,
  mcpAdjustmentMarketSelectionRequiredError,
  mcpAdjustmentPermissionDeniedError,
  mcpAdjustmentPriorRequestInvalidError,
  mcpAdjustmentReasonCodeInvalidError,
  mcpAdjustmentRequestNotFoundError,
  mcpAdjustmentStateConflictError,
} from './mcp-adjustment.owner.errors.js';
import type {
  CreateMcpAdjustmentCommand,
  ExecuteMcpAdjustmentCommand,
  McpAdjustmentDecisionCommand,
  McpAdjustmentEntryType,
  McpAdjustmentExecutionResult,
  McpAdjustmentOwnerActor,
  McpAdjustmentRequestView,
  SubmitMcpAdjustmentCommand,
} from './mcp-adjustment.owner.types.js';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbExecutor = Database | DbTransaction;

/** Idempotency scope namespace for the OWNER create command. */
const ADJUSTMENT_OWNER_IDEMPOTENCY_SCOPE = 'mcp.adjustment.owner.create';

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

interface McpAccountRow {
  id: string;
  merchantBranchId: string;
  marketId: string;
  availableBalance: string;
  status: string;
  version: number;
}

/**
 * P7-S7A Manual MCP Adjustment owner (D-046 conformance, P7-OD-03/10/11/18).
 *
 * The owner lives in the merchant domain (`apps/api/src/merchant/`) as NEW
 * conformed code, reusing the accepted Phase 1 MCP durable request/decision
 * tables and the direction-aware MCP ledger append. Lifecycle:
 *
 *   DRAFT -> SUBMITTED -> APPROVED | REJECTED -> EXECUTING -> EXECUTED | FAILED
 *
 * Owner contract:
 *  1. Identity + permission re-checked server-side for every command
 *     (`merchant.mcp.adjust` for create/submit,
 *     `merchant.mcp.adjust.approve` for decide,
 *     `merchant.mcp.adjust.execute` for execute) plus active Market Access.
 *  2. Selected-market enforcement: the server Current Admin Market must
 *     equal the account/request market (MARKET_CONTEXT_MISMATCH otherwise).
 *  3. Distinct server-derived Maker/Checker identities at EVERY amount,
 *     including Super Admin (runtime inequality + DB CHECK).
 *  4. Caps routing (P7-OD-10): versioned per-market soft/hard caps
 *     (Malaysia baseline 10,000 / 100,000 MCP). > hard cap rejected at
 *     create. At/below soft cap a Finance Approver may check; above soft
 *     through hard cap a Super Admin MUST check. No threshold exemption,
 *     no cross-market fallback.
 *  5. Evidence (P7-OD-11): reason code + explanation + case reference +
 *     maker/checker identity + timestamps always required; opaque
 *     attachment reference mandatory above soft cap, for high-risk reason
 *     codes, or when the checker requests it. Above-soft-cap EXECUTION
 *     stays disabled until secure evidence storage is enabled for the
 *     market.
 *  6. Rejected requests are immutable; a replacement is a NEW request with
 *     new idempotency/decision records and explicit `priorRequestId`
 *     linkage (P7-OD-18).
 *  7. Payload-hash idempotency: unique (scope, key); same key + same
 *     payload replays the stored request; same key + different payload
 *     -> conflict. Deterministic concurrency via row locks.
 *  8. Execution: the direction-aware MCP ledger append (accepted Phase 1
 *     `append_mcp_ledger_entry` — already supports CREDIT/DEBIT), request
 *     state -> EXECUTED and the immutable audit commit atomically in ONE
 *     transaction. On an injected ledger failure the whole transaction
 *     rolls back (no partial ledger) and the request is durably marked
 *     FAILED; retries never duplicate a ledger effect.
 *  9. No direct balance mutation anywhere outside the MCP ledger append;
 *     the ledger entry is immutable with exact before/after snapshots and
 *     a unique idempotency key.
 */
@Injectable()
export class McpAdjustmentOwnerService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ─── Maker: create (Draft/Create) ──────────────────────────────────

  async create(
    actor: McpAdjustmentOwnerActor,
    command: CreateMcpAdjustmentCommand,
  ): Promise<McpAdjustmentRequestView> {
    if (!actor?.adminUserId) throw mcpAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'merchant.mcp.adjust',
    });
    if (!allowed) throw mcpAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw mcpAdjustmentMarketSelectionRequiredError();

    const amount = command.amount.trim();
    if (!AMOUNT_PATTERN.test(amount)) throw mcpAdjustmentInvalidAmountError();
    if (/^0+$/u.test(amount.replace('.', ''))) {
      throw mcpAdjustmentInvalidAmountError();
    }
    if (
      command.entryType !== 'MANUAL_CREDIT' &&
      command.entryType !== 'MANUAL_DEBIT'
    ) {
      throw mcpAdjustmentInvalidFieldError('entryType');
    }
    const explanation = command.explanation?.trim() ?? '';
    if (!explanation || explanation.length > 2000) {
      throw mcpAdjustmentInvalidFieldError('explanation');
    }
    const caseReference = command.caseReference?.trim() ?? '';
    if (!caseReference || caseReference.length > 200) {
      throw mcpAdjustmentInvalidFieldError('caseReference');
    }
    const attachmentReference = command.attachmentReference?.trim() ?? null;
    if (attachmentReference && attachmentReference.length > 500) {
      throw mcpAdjustmentInvalidFieldError('attachmentReference');
    }

    const idempotencyKey = command.idempotencyKey?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw mcpAdjustmentIdempotencyKeyRequiredError();
    }

    const account = await this.accountRow(command.mcpAccountId);
    if (!account || account.status === 'CLOSED') {
      throw mcpAdjustmentAccountNotFoundError();
    }
    if (actor.currentMarketId !== account.marketId) {
      throw mcpAdjustmentMarketContextMismatchError();
    }
    await this.assertMarketAccess(actor, account.marketId);

    const market = await this.activeMarketRow(account.marketId);
    if (!market) throw mcpAdjustmentMarketAccessDeniedError();
    const rule = await this.activeMarketRule(market.code);
    if (!rule) throw mcpAdjustmentMarketNotConfiguredError(market.code);
    if (!lteDecimal(amount, rule.hardCap)) {
      throw mcpAdjustmentAboveHardCapError(amount, rule.hardCap);
    }

    const reason = await this.activeReasonCode(market.code, command.reasonCode);
    if (!reason) {
      throw mcpAdjustmentReasonCodeInvalidError(command.reasonCode);
    }

    const aboveSoft = !lteDecimal(amount, rule.softCap);
    if ((aboveSoft || reason.isHighRisk) && !this.hasAttachment(command)) {
      throw mcpAdjustmentAttachmentRequiredError();
    }

    if (command.priorRequestId) {
      await this.assertValidPriorRequest(
        command.priorRequestId,
        account.marketId,
        account.id,
      );
    }

    const payloadHash = canonicalHash({
      operation: 'mcp.adjustment.create',
      mcpAccountId: account.id,
      marketId: account.marketId,
      entryType: command.entryType,
      amount,
      reasonCode: command.reasonCode.trim(),
      explanation,
      caseReference,
      attachmentReference,
      priorRequestId: command.priorRequestId ?? null,
    });
    const scope = `${ADJUSTMENT_OWNER_IDEMPOTENCY_SCOPE}:${account.id}:${actor.adminUserId}`;

    try {
      return await this.database.runTransaction(async (tx) => {
        const claimed = await tx
          .insert(mcpAdjustmentRequests)
          .values({
            mcpAccountId: account.id,
            marketId: account.marketId,
            makerAdminUserId: actor.adminUserId,
            entryType: command.entryType,
            amount,
            reason: explanation,
            evidence: {},
            status: 'DRAFT',
            idempotencyKey,
            payloadHash,
            idempotencyScope: scope,
            reasonCode: command.reasonCode.trim(),
            caseReference,
            attachmentReference,
            priorRequestId: command.priorRequestId ?? null,
            version: 1,
          })
          .onConflictDoNothing()
          .returning();

        if (claimed.length === 0) {
          return this.replayOrConflict(tx, scope, idempotencyKey, payloadHash);
        }
        const request = claimed[0];
        if (!request) throw mcpAdjustmentRequestNotFoundError();
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'MCP_ADJUSTMENT_CREATED',
          entity: { type: 'MCP_ADJUSTMENT_REQUEST', id: request.id },
          marketId: account.marketId,
          before: null,
          after: {
            state: request.status,
            amount,
            entryType: request.entryType,
          },
          reason: explanation,
          result: 'SUCCESS',
          requestId: actor.requestId ?? idempotencyKey,
          ipAddress: actor.ipAddress,
          summary: `Manual MCP ${request.entryType} adjustment of ${amount} requested for account ${account.id} (market ${market.code}).`,
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
    actor: McpAdjustmentOwnerActor,
    command: SubmitMcpAdjustmentCommand,
  ): Promise<McpAdjustmentRequestView> {
    if (!actor?.adminUserId) throw mcpAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'merchant.mcp.adjust',
    });
    if (!allowed) throw mcpAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw mcpAdjustmentMarketSelectionRequiredError();

    return this.database.runTransaction(async (tx) => {
      const request = await this.lockRequest(tx, command.requestId);
      if (!request) throw mcpAdjustmentRequestNotFoundError();
      if (actor.currentMarketId !== request.marketId) {
        throw mcpAdjustmentMarketContextMismatchError();
      }
      await this.assertMarketAccess(actor, request.marketId);
      if (request.makerAdminUserId !== actor.adminUserId) {
        throw mcpAdjustmentMakerRequiredError();
      }
      if (request.status !== 'DRAFT') {
        throw mcpAdjustmentStateConflictError(request.status);
      }
      const updated = await tx
        .update(mcpAdjustmentRequests)
        .set({
          status: 'SUBMITTED',
          submittedAt: new Date(),
          version: sql`${mcpAdjustmentRequests.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mcpAdjustmentRequests.id, command.requestId),
            eq(mcpAdjustmentRequests.version, request.version),
          ),
        )
        .returning();
      const row = updated[0];
      if (!row) throw mcpAdjustmentStateConflictError(request.status);
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action: 'MCP_ADJUSTMENT_SUBMITTED',
        entity: { type: 'MCP_ADJUSTMENT_REQUEST', id: command.requestId },
        marketId: request.marketId,
        before: { state: request.status },
        after: { state: row.status },
        reason: request.reason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: `Manual MCP adjustment ${command.requestId} submitted for checker review.`,
      });
      return this.toView(row);
    }, TRANSACTION_EXECUTION_OPTIONS);
  }

  // ─── Checker: decide (SUBMITTED -> APPROVED | REJECTED) ────────────

  async decide(
    actor: McpAdjustmentOwnerActor,
    requestId: string,
    command: McpAdjustmentDecisionCommand,
  ): Promise<McpAdjustmentRequestView> {
    if (!actor?.adminUserId) throw mcpAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'merchant.mcp.adjust.approve',
    });
    if (!allowed) throw mcpAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw mcpAdjustmentMarketSelectionRequiredError();

    const decisionReason = command.reason?.trim() ?? '';
    if (!decisionReason || decisionReason.length > 2000) {
      throw mcpAdjustmentDecisionReasonRequiredError();
    }

    return this.database.runTransaction(async (tx) => {
      const request = await this.lockRequest(tx, requestId);
      if (!request) throw mcpAdjustmentRequestNotFoundError();
      if (actor.currentMarketId !== request.marketId) {
        throw mcpAdjustmentMarketContextMismatchError();
      }
      await this.assertMarketAccess(actor, request.marketId);
      if (request.makerAdminUserId === actor.adminUserId) {
        throw mcpAdjustmentMakerCheckerConflictError();
      }
      if (request.status !== 'SUBMITTED') {
        throw mcpAdjustmentStateConflictError(request.status);
      }

      // Checker revalidates the live target + limits inside the decision
      // boundary (P7-S1 §16): account still exists, matches the market and
      // is not closed.
      const account = await this.accountRowById(tx, request.mcpAccountId);
      if (!account || account.status === 'CLOSED') {
        throw mcpAdjustmentAccountNotFoundError();
      }
      const market = await this.activeMarketRow(request.marketId);
      if (!market) throw mcpAdjustmentMarketAccessDeniedError();
      const rule = await this.activeMarketRule(market.code);
      if (!rule) throw mcpAdjustmentMarketNotConfiguredError(market.code);
      const aboveSoft = !lteDecimal(request.amount, rule.softCap);
      if (!lteDecimal(request.amount, rule.hardCap)) {
        throw mcpAdjustmentAboveHardCapError(request.amount, rule.hardCap);
      }
      const reason = await this.activeReasonCode(
        market.code,
        request.reasonCode ?? '',
      );
      if (!reason) {
        throw mcpAdjustmentReasonCodeInvalidError(request.reasonCode ?? '');
      }

      // Caps routing (P7-OD-10): above soft cap -> Super Admin MUST check.
      if (aboveSoft) {
        const isSuperAdmin = await this.hasRole(tx, actor.adminUserId);
        if (!isSuperAdmin) throw mcpAdjustmentCheckerRoutingDeniedError();
      }

      // Evidence (P7-OD-11): attachment mandatory above soft cap, for
      // high-risk reason codes, or when the checker explicitly requests it.
      if (
        (aboveSoft || reason.isHighRisk || command.requireAttachment) &&
        !request.attachmentReference
      ) {
        throw mcpAdjustmentAttachmentRequiredError();
      }

      await tx.insert(mcpAdjustmentDecisions).values({
        adjustmentRequestId: requestId,
        marketId: request.marketId,
        checkerAdminUserId: actor.adminUserId,
        decision: command.decision,
        reason: decisionReason,
      });

      const updated = await tx
        .update(mcpAdjustmentRequests)
        .set({
          status: command.decision,
          checkerAdminUserId: actor.adminUserId,
          version: sql`${mcpAdjustmentRequests.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mcpAdjustmentRequests.id, requestId),
            eq(mcpAdjustmentRequests.version, request.version),
          ),
        )
        .returning();
      const row = updated[0];
      if (!row) throw mcpAdjustmentStateConflictError(request.status);
      await this.audit.appendWithinTransaction(tx, {
        actor: { type: 'ADMIN_USER', id: actor.adminUserId },
        action:
          command.decision === 'APPROVED'
            ? 'MCP_ADJUSTMENT_APPROVED'
            : 'MCP_ADJUSTMENT_REJECTED',
        entity: { type: 'MCP_ADJUSTMENT_REQUEST', id: requestId },
        marketId: request.marketId,
        before: { state: request.status, checker: null },
        after: { state: row.status, checker: actor.adminUserId },
        reason: decisionReason,
        result: 'SUCCESS',
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        summary: `Manual MCP adjustment ${requestId} ${command.decision.toLowerCase()} by checker ${actor.adminUserId}.`,
      });
      return this.toView(row);
    }, TRANSACTION_EXECUTION_OPTIONS);
  }

  // ─── Checker: execute (APPROVED -> EXECUTING -> EXECUTED | FAILED) ─

  async execute(
    actor: McpAdjustmentOwnerActor,
    command: ExecuteMcpAdjustmentCommand,
  ): Promise<McpAdjustmentRequestView> {
    if (!actor?.adminUserId) throw mcpAdjustmentPermissionDeniedError();
    const allowed = await this.rbac.isAllowed({
      adminUserId: actor.adminUserId,
      permission: 'merchant.mcp.adjust.execute',
    });
    if (!allowed) throw mcpAdjustmentPermissionDeniedError();
    if (!actor.currentMarketId)
      throw mcpAdjustmentMarketSelectionRequiredError();

    // Set to true only once the execution attempt (EXECUTING + ledger
    // append) has started; validation failures before that point leave the
    // request APPROVED and retryable.
    let attempted = false;
    try {
      return await this.database.runTransaction(async (tx) => {
        const request = await this.lockRequest(tx, command.requestId);
        if (!request) throw mcpAdjustmentRequestNotFoundError();
        if (actor.currentMarketId !== request.marketId) {
          throw mcpAdjustmentMarketContextMismatchError();
        }
        await this.assertMarketAccess(actor, request.marketId);

        // Terminal outcomes replay without touching the ledger (retry
        // safety: no duplicate ledger effect).
        if (request.status === 'EXECUTED' || request.status === 'FAILED') {
          return this.toView(request);
        }
        if (request.status !== 'APPROVED') {
          throw mcpAdjustmentStateConflictError(request.status);
        }
        if (request.makerAdminUserId === actor.adminUserId) {
          throw mcpAdjustmentMakerCheckerConflictError();
        }

        // Full revalidation inside the execution boundary.
        const account = await this.accountRowById(tx, request.mcpAccountId);
        if (!account || account.status === 'CLOSED') {
          throw mcpAdjustmentAccountNotFoundError();
        }
        const market = await this.activeMarketRow(request.marketId);
        if (!market) throw mcpAdjustmentMarketAccessDeniedError();
        const rule = await this.activeMarketRule(market.code);
        if (!rule) throw mcpAdjustmentMarketNotConfiguredError(market.code);
        const aboveSoft = !lteDecimal(request.amount, rule.softCap);
        if (!lteDecimal(request.amount, rule.hardCap)) {
          throw mcpAdjustmentAboveHardCapError(request.amount, rule.hardCap);
        }
        const reason = await this.activeReasonCode(
          market.code,
          request.reasonCode ?? '',
        );
        if (!reason) {
          throw mcpAdjustmentReasonCodeInvalidError(request.reasonCode ?? '');
        }
        if ((aboveSoft || reason.isHighRisk) && !request.attachmentReference) {
          throw mcpAdjustmentAttachmentRequiredError();
        }
        // P7-OD-11: above-soft-cap execution stays disabled until secure
        // evidence storage is enabled for this market.
        if (aboveSoft && !rule.secureEvidenceAvailable) {
          throw mcpAdjustmentEvidenceStorageUnavailableError();
        }

        attempted = true;
        // Atomic: state -> EXECUTING, MCP ledger append (direction-aware),
        // state -> EXECUTED, immutable audit and the unique ledger
        // idempotency claim all in ONE transaction.
        await tx
          .update(mcpAdjustmentRequests)
          .set({
            status: 'EXECUTING',
            version: sql`${mcpAdjustmentRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mcpAdjustmentRequests.id, command.requestId),
              eq(mcpAdjustmentRequests.version, request.version),
            ),
          );

        const result = await this.appendLedgerEntry(tx, {
          account,
          marketId: request.marketId,
          entryType: request.entryType as McpAdjustmentEntryType,
          amount: request.amount,
          idempotencyKey: `mcp-adjustment:${command.requestId}`,
          referenceId: command.requestId,
          reason: request.reason,
          actorId: actor.adminUserId,
        });

        const updated = await tx
          .update(mcpAdjustmentRequests)
          .set({
            status: 'EXECUTED',
            ledgerEntryId: result.ledgerEntryId,
            executedAt: new Date(),
            version: sql`${mcpAdjustmentRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(mcpAdjustmentRequests.id, command.requestId))
          .returning();
        const row = updated[0];
        if (!row) throw mcpAdjustmentExecutionFailedError();

        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'MCP_ADJUSTMENT_EXECUTED',
          entity: { type: 'MCP_ADJUSTMENT_REQUEST', id: command.requestId },
          marketId: request.marketId,
          before: {
            state: 'APPROVED',
            availableBalance: result.balanceBefore,
          },
          after: { state: 'EXECUTED', availableBalance: result.balanceAfter },
          reason: request.reason,
          result: 'SUCCESS',
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          summary: `Manual MCP ${request.entryType} adjustment of ${request.amount} executed on account ${request.mcpAccountId} (ledger ${result.ledgerEntryId}).`,
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
      const failed = await this.markFailed(command.requestId, actor, error);
      if (failed) return failed;
      throw error;
    }
  }

  // ─── Ledger append (reuses the accepted direction-aware MCP owner) ─

  /**
   * The accepted Phase 1 MCP ledger append (`append_mcp_ledger_entry`) is
   * already direction-aware (CREDIT/DEBIT with exact before/after deltas,
   * balance invariants, global idempotency key) — unlike SEC-01's wallet
   * case, NO dedicated ledger command is required for MCP. Public so tests
   * can inject a failure at the ledger seam.
   */
  async appendLedgerEntry(
    tx: DbTransaction,
    params: {
      account: {
        id: string;
        merchantBranchId: string;
        marketId: string;
        availableBalance: string;
        status: string;
        version: number;
      };
      marketId: string;
      entryType: McpAdjustmentEntryType;
      amount: string;
      idempotencyKey: string;
      referenceId: string;
      reason: string;
      actorId: string;
    },
  ): Promise<McpAdjustmentExecutionResult> {
    const existing = await tx
      .select({ id: mcpLedgerEntries.id })
      .from(mcpLedgerEntries)
      .where(
        and(
          eq(mcpLedgerEntries.mcpAccountId, params.account.id),
          eq(mcpLedgerEntries.idempotencyKey, params.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return {
        ledgerEntryId: existing[0].id,
        balanceBefore: params.account.availableBalance,
        balanceAfter: params.account.availableBalance,
      };
    }

    const debit = params.entryType === 'MANUAL_DEBIT';
    const delta = debit ? `-${params.amount}` : params.amount;
    const postingHash = canonicalHash({
      requestId: params.referenceId,
      amount: params.amount,
      entryType: params.entryType,
    });
    const posting = await tx.execute(sql`
      SELECT * FROM append_mcp_ledger_entry(
        ${params.account.id}::uuid,
        ${params.entryType}::mcp_entry_type,
        ${debit ? 'DEBIT' : 'CREDIT'}::mcp_direction,
        ${params.amount}::numeric,
        ${delta}::numeric,
        ${delta}::numeric,
        'MCP_ADJUSTMENT', ${params.referenceId},
        ${params.idempotencyKey}, ${postingHash},
        'ADMIN_USER', ${params.actorId}, ${params.reason}, now()
      )
    `);
    const entryId = String(posting.rows[0]?.['entry_id']);
    if (!entryId) throw mcpAdjustmentExecutionFailedError();
    const projected = posting.rows[0]?.['projected_total_balance'];
    const balanceBefore =
      typeof projected === 'string' || typeof projected === 'number'
        ? String(projected)
        : '';
    // The append returns the projected balances; derive before/after from
    // the delta so the audit records the exact snapshots.
    const before = subtractDecimal(balanceBefore, delta);
    return {
      ledgerEntryId: entryId,
      balanceBefore: before,
      balanceAfter: balanceBefore,
    };
  }

  // ─── Finance read projections (queue / history) ────────────────────

  /**
   * Finance queue/history read projection (P7-S1 §16): bounded, market-
   * scoped, state-filterable. Callers must hold `merchant.mcp.view` at the
   * transport boundary; the projection never mutates owner state.
   */
  async listForMarket(
    marketId: string,
    options: { state?: string; limit: number; offset: number },
  ): Promise<{
    items: McpAdjustmentRequestView[];
    limit: number;
    offset: number;
  }> {
    const conditions = [eq(mcpAdjustmentRequests.marketId, marketId)];
    if (options.state) {
      conditions.push(eq(mcpAdjustmentRequests.status, options.state as never));
    }
    const rows = await this.database.db
      .select()
      .from(mcpAdjustmentRequests)
      .where(and(...conditions))
      .orderBy(desc(mcpAdjustmentRequests.createdAt))
      .limit(options.limit)
      .offset(options.offset);
    return {
      items: rows.map((row) => this.toView(row)),
      limit: options.limit,
      offset: options.offset,
    };
  }

  /** Request detail incl. immutable decision history. */
  async detail(
    marketId: string,
    requestId: string,
  ): Promise<{ request: McpAdjustmentRequestView; decisions: unknown[] }> {
    const rows = await this.database.db
      .select()
      .from(mcpAdjustmentRequests)
      .where(
        and(
          eq(mcpAdjustmentRequests.id, requestId),
          eq(mcpAdjustmentRequests.marketId, marketId),
        ),
      )
      .limit(1);
    const request = rows[0];
    if (!request) throw mcpAdjustmentRequestNotFoundError();
    const decisions = await this.database.db
      .select()
      .from(mcpAdjustmentDecisions)
      .where(eq(mcpAdjustmentDecisions.adjustmentRequestId, requestId));
    return { request: this.toView(request), decisions };
  }

  // ─── Revalidation helpers ──────────────────────────────────────────

  private async accountRow(
    accountId: string,
  ): Promise<McpAccountRow | undefined> {
    const rows = await this.database.db
      .select({
        id: mcpAccounts.id,
        merchantBranchId: mcpAccounts.merchantBranchId,
        marketId: mcpAccounts.marketId,
        availableBalance: mcpAccounts.availableBalance,
        status: mcpAccounts.status,
        version: mcpAccounts.version,
      })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.id, accountId))
      .limit(1);
    return rows[0];
  }

  private async accountRowById(
    db: DbExecutor,
    accountId: string,
  ): Promise<McpAccountRow | undefined> {
    const rows = await db
      .select({
        id: mcpAccounts.id,
        merchantBranchId: mcpAccounts.merchantBranchId,
        marketId: mcpAccounts.marketId,
        availableBalance: mcpAccounts.availableBalance,
        status: mcpAccounts.status,
        version: mcpAccounts.version,
      })
      .from(mcpAccounts)
      .where(eq(mcpAccounts.id, accountId))
      .limit(1);
    return rows[0];
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
        marketCode: mcpAdjustmentMarketRules.marketCode,
        softCap: mcpAdjustmentMarketRules.softCap,
        hardCap: mcpAdjustmentMarketRules.hardCap,
        secureEvidenceAvailable:
          mcpAdjustmentMarketRules.secureEvidenceAvailable,
        isActive: mcpAdjustmentMarketRules.isActive,
      })
      .from(mcpAdjustmentMarketRules)
      .where(
        and(
          eq(mcpAdjustmentMarketRules.marketCode, marketCode),
          eq(mcpAdjustmentMarketRules.isActive, true),
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
        code: mcpAdjustmentReasonCodes.code,
        isHighRisk: mcpAdjustmentReasonCodes.isHighRisk,
        isActive: mcpAdjustmentReasonCodes.isActive,
      })
      .from(mcpAdjustmentReasonCodes)
      .where(
        and(
          eq(mcpAdjustmentReasonCodes.marketCode, marketCode),
          eq(mcpAdjustmentReasonCodes.code, code),
          eq(mcpAdjustmentReasonCodes.isActive, true),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async assertMarketAccess(
    actor: McpAdjustmentOwnerActor,
    marketId: string,
  ): Promise<void> {
    const ok = await this.rbac.hasMarketAccess(actor.adminUserId, marketId);
    if (!ok) throw mcpAdjustmentMarketAccessDeniedError();
  }

  private async hasRole(db: DbExecutor, adminUserId: string): Promise<boolean> {
    const rows = await db
      .select({ id: roles.id })
      .from(roles)
      .innerJoin(roleAssignments, eq(roleAssignments.roleId, roles.id))
      .innerJoin(adminUsers, eq(adminUsers.id, roleAssignments.adminUserId))
      .where(
        and(
          eq(roleAssignments.adminUserId, adminUserId),
          eq(roles.code, 'SUPER_ADMIN'),
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
  ): Promise<typeof mcpAdjustmentRequests.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(mcpAdjustmentRequests)
      .where(eq(mcpAdjustmentRequests.id, requestId))
      .for('update')
      .limit(1);
    return rows[0];
  }

  private async assertValidPriorRequest(
    priorRequestId: string,
    marketId: string,
    mcpAccountId: string,
  ): Promise<void> {
    const rows = await this.database.db
      .select({
        id: mcpAdjustmentRequests.id,
        status: mcpAdjustmentRequests.status,
        marketId: mcpAdjustmentRequests.marketId,
        mcpAccountId: mcpAdjustmentRequests.mcpAccountId,
      })
      .from(mcpAdjustmentRequests)
      .where(eq(mcpAdjustmentRequests.id, priorRequestId))
      .limit(1);
    const prior = rows[0];
    if (
      !prior ||
      prior.status !== 'REJECTED' ||
      prior.marketId !== marketId ||
      prior.mcpAccountId !== mcpAccountId
    ) {
      throw mcpAdjustmentPriorRequestInvalidError();
    }
  }

  private async replayOrConflict(
    db: DbExecutor,
    scope: string,
    key: string,
    payloadHash: string,
  ): Promise<McpAdjustmentRequestView> {
    const rows = await db
      .select()
      .from(mcpAdjustmentRequests)
      .where(
        and(
          eq(mcpAdjustmentRequests.idempotencyScope, scope),
          eq(mcpAdjustmentRequests.idempotencyKey, key),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing || existing.payloadHash !== payloadHash) {
      throw mcpAdjustmentIdempotencyConflictError();
    }
    return this.toView(existing);
  }

  private async markFailed(
    requestId: string,
    actor: McpAdjustmentOwnerActor,
    cause: Error,
  ): Promise<McpAdjustmentRequestView | null> {
    try {
      return await this.database.runTransaction(async (tx) => {
        const request = await this.lockRequest(tx, requestId);
        if (!request) return null;
        if (request.status !== 'APPROVED' && request.status !== 'EXECUTING') {
          return null;
        }
        const updated = await tx
          .update(mcpAdjustmentRequests)
          .set({
            status: 'FAILED',
            failedAt: new Date(),
            version: sql`${mcpAdjustmentRequests.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(mcpAdjustmentRequests.id, requestId))
          .returning();
        const row = updated[0];
        if (!row) return null;
        await this.audit.appendWithinTransaction(tx, {
          actor: { type: 'ADMIN_USER', id: actor.adminUserId },
          action: 'MCP_ADJUSTMENT_EXECUTE_FAILED',
          entity: { type: 'MCP_ADJUSTMENT_REQUEST', id: requestId },
          marketId: request.marketId,
          before: { state: request.status },
          after: { state: 'FAILED' },
          reason: `Execution failed and fully rolled back. Cause: ${cause.message}`,
          result: 'FAILURE',
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          summary: `Manual MCP adjustment ${requestId} execution failed; no ledger effect was committed.`,
        });
        return this.toView(row);
      }, TRANSACTION_EXECUTION_OPTIONS);
    } catch {
      return null;
    }
  }

  // ─── Projection + helpers ──────────────────────────────────────────

  private toView(
    row: typeof mcpAdjustmentRequests.$inferSelect,
  ): McpAdjustmentRequestView {
    return {
      id: row.id,
      mcpAccountId: row.mcpAccountId,
      marketId: row.marketId,
      entryType: row.entryType as McpAdjustmentEntryType,
      amount: row.amount,
      state: row.status,
      reasonCode: row.reasonCode ?? '',
      explanation: row.reason,
      caseReference: row.caseReference ?? '',
      attachmentReference: row.attachmentReference ?? null,
      makerAdminUserId: row.makerAdminUserId,
      checkerAdminUserId: row.checkerAdminUserId ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      priorRequestId: row.priorRequestId ?? null,
      ledgerEntryId: row.ledgerEntryId ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private hasAttachment(command: CreateMcpAdjustmentCommand): boolean {
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

/** Exact decimal subtraction (strings; supports signed b). */
export function subtractDecimal(a: string, b: string): string {
  const scale = (value: string) =>
    value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  const scaleMax = Math.max(scale(a), scale(b));
  const toScaled = (value: string) => {
    const [wholeRaw, fraction = ''] = value.split('.');
    const whole = wholeRaw ?? '0';
    return BigInt(`${whole}${fraction.padEnd(scaleMax, '0')}`);
  };
  const result = toScaled(a) - toScaled(b);
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
