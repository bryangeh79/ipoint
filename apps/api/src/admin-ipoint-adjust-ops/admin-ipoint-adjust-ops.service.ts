import { Inject, Injectable } from '@nestjs/common';
import {
  ipointAdjustmentDecisions,
  ipointAdjustmentMarketRules,
  ipointAdjustmentReasonCodes,
  ipointAdjustmentRequests,
  markets,
  memberProfiles,
  memberWalletAccounts,
  members,
} from '@ipoint/database';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { WalletAdjustmentOwnerService } from '../wallet/wallet-adjustment.owner.service.js';
import type {
  AdjustmentDecisionCommand,
  CreateAdjustmentCommand,
  WalletAdjustmentOwnerActor,
  WalletAdjustmentRequestView,
} from '../wallet/wallet-adjustment.owner.types.js';
import {
  ipointAdjustmentMarketNotFoundError,
  ipointAdjustmentRequestNotFoundError,
  ipointAdjustmentWalletLookupEmptyError,
} from './admin-ipoint-adjust-ops.errors.js';
/** Canonical UUID shape (exact-match guard for the wallet lookup). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

import type {
  AdminIpointAdjustOpsActor,
  AdminIpointAdjustmentConfigResponse,
  AdminIpointAdjustmentDecisionDto,
  AdminIpointAdjustmentDetailResponse,
  AdminIpointAdjustmentQueueResponse,
  AdminIpointAdjustmentViewDto,
  AdminIpointWalletLookupDto,
} from './admin-ipoint-adjust-ops.types.js';

/**
 * P7-S7B Admin iPoint Adjustment Operations adapter service (SEC-01 §6 /
 * P7-S1 §17).
 *
 * Phase 7 read projections + orchestration over the FROZEN SEC-01 owner
 * (`WalletAdjustmentOwnerService`). The adapter NEVER enforces owner-level
 * business controls: after GATE-SEC-01 every one of them lives inside the
 * frozen owner commands — RBAC re-check (`wallet.ipoint.adjust.maker` /
 * `.checker` / `.execute`), identity validation, selected-market
 * enforcement (`currentMarketId`), wallet/market consistency, caps
 * routing (P7-OD-10), evidence rules (P7-OD-11), Maker≠Checker inequality
 * at every amount, payload-hash idempotency, atomic owner-ledger
 * execution and the immutable audit.
 *
 * What the adapter adds (legitimate Phase 7 orchestration/read/UI
 * behavior only):
 *
 * 1. The Finance queue projection (`listForMarket`): state-filterable,
 *    paginated, market-scoped — read-only over the frozen request rows.
 * 2. The request detail projection (`detail`): the request plus the
 *    immutable decision history (P7-OD-11/18).
 * 3. The maker-form support projection (`config`): the versioned
 *    per-market caps + secure-evidence capability and the active
 *    reason-code catalog, with the explicit blocked state
 *    (`configured: false`) for markets without a rules row — no fallback.
 * 4. The wallet/member lookup (`searchWallets`) for the maker screen:
 *    masked identity + available balance, never evidence contents.
 * 5. The write commands delegate 1:1 to the frozen owner commands with
 *    the server Current Admin Market passed through (SEC-01 §6.3).
 *
 * Market enforcement is the canonical RbacGuard (`marketScoped`): the URL
 * market must equal the server-owned Current Admin Market and the actor
 * must hold the grant; the owner command re-enforces the same contract
 * in-process.
 */
@Injectable()
export class AdminIpointAdjustOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WalletAdjustmentOwnerService)
    private readonly owner: WalletAdjustmentOwnerService,
  ) {}

  // ─── Read projections ─────────────────────────────────────────────

  /** Finance queue projection (read-only; state-filterable, paginated). */
  async listForMarket(
    marketId: string,
    options: { state?: string; limit: number; offset: number },
  ): Promise<AdminIpointAdjustmentQueueResponse> {
    const conditions = [eq(ipointAdjustmentRequests.marketId, marketId)];
    if (options.state) {
      conditions.push(
        eq(ipointAdjustmentRequests.state, options.state as never),
      );
    }
    const rows = await this.database.db
      .select()
      .from(ipointAdjustmentRequests)
      .where(and(...conditions))
      .orderBy(desc(ipointAdjustmentRequests.createdAt))
      .limit(options.limit)
      .offset(options.offset);
    return {
      marketId,
      items: rows.map((row) => this.toView(row)),
      limit: options.limit,
      offset: options.offset,
    };
  }

  /** Request detail incl. the immutable decision history. */
  async detail(
    marketId: string,
    requestId: string,
  ): Promise<AdminIpointAdjustmentDetailResponse> {
    const rows = await this.database.db
      .select()
      .from(ipointAdjustmentRequests)
      .where(
        and(
          eq(ipointAdjustmentRequests.id, requestId),
          eq(ipointAdjustmentRequests.marketId, marketId),
        ),
      )
      .limit(1);
    const request = rows[0];
    if (!request) throw ipointAdjustmentRequestNotFoundError();
    const decisions = await this.database.db
      .select()
      .from(ipointAdjustmentDecisions)
      .where(eq(ipointAdjustmentDecisions.adjustmentRequestId, requestId));
    return {
      request: this.toView(request),
      decisions: decisions.map(
        (decision): AdminIpointAdjustmentDecisionDto => ({
          id: decision.id,
          adjustmentRequestId: decision.adjustmentRequestId,
          marketId: decision.marketId,
          checkerAdminUserId: decision.checkerAdminUserId,
          decision: decision.decision as 'APPROVED' | 'REJECTED',
          reason: decision.reason,
          decidedAt: decision.decidedAt.toISOString(),
        }),
      ),
    };
  }

  /**
   * Maker-form support projection: market rules (caps + secure-evidence
   * capability) and the active reason-code catalog.
   */
  async config(marketId: string): Promise<AdminIpointAdjustmentConfigResponse> {
    const marketRows = await this.database.db
      .select()
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    const market = marketRows[0];
    if (!market) throw ipointAdjustmentMarketNotFoundError();

    const ruleRows = await this.database.db
      .select()
      .from(ipointAdjustmentMarketRules)
      .where(
        and(
          eq(ipointAdjustmentMarketRules.marketCode, market.code),
          eq(ipointAdjustmentMarketRules.isActive, true),
        ),
      )
      .limit(1);
    const rule = ruleRows[0] ?? null;

    const reasonCodeRows = await this.database.db
      .select()
      .from(ipointAdjustmentReasonCodes)
      .where(
        and(
          eq(ipointAdjustmentReasonCodes.marketCode, market.code),
          eq(ipointAdjustmentReasonCodes.isActive, true),
        ),
      )
      .orderBy(ipointAdjustmentReasonCodes.code);

    return {
      marketId,
      marketCode: market.code,
      timezone: market.timezone,
      currency: market.currencyCode,
      configured: market.status === 'ACTIVE' && rule !== null,
      rule: rule
        ? {
            marketCode: rule.marketCode,
            softCap: rule.softCap,
            hardCap: rule.hardCap,
            secureEvidenceAvailable: rule.secureEvidenceAvailable,
            isActive: rule.isActive,
          }
        : null,
      reasonCodes: reasonCodeRows.map((reason) => ({
        code: reason.code,
        label: reason.label,
        isHighRisk: reason.isHighRisk,
        isActive: reason.isActive,
      })),
    };
  }

  /**
   * Wallet/member lookup for the maker screen (masked identity + balance;
   * never evidence contents). Matches by member public id, display name or
   * wallet/member id within the selected market.
   */
  async searchWallets(
    marketId: string,
    query: string,
    limit: number,
  ): Promise<AdminIpointWalletLookupDto[]> {
    const trimmed = query.trim();
    const term = `%${trimmed}%`;
    // UUID columns have no ilike operator in PostgreSQL, so an exact id
    // match is added ONLY when the query is a valid UUID (avoids an
    // invalid-input-syntax error for text searches like "pub_...").
    const isUuid = UUID_PATTERN.test(trimmed);
    const rows = await this.database.db
      .select({
        walletId: memberWalletAccounts.id,
        memberId: memberWalletAccounts.memberId,
        marketId: memberWalletAccounts.marketId,
        availableBalance: memberWalletAccounts.availableBalance,
        archivedAt: memberWalletAccounts.archivedAt,
        memberPublicId: members.publicMemberId,
        displayName: memberProfiles.displayName,
      })
      .from(memberWalletAccounts)
      .innerJoin(members, eq(members.id, memberWalletAccounts.memberId))
      .leftJoin(
        memberProfiles,
        eq(memberProfiles.memberId, memberWalletAccounts.memberId),
      )
      .where(
        and(
          eq(memberWalletAccounts.marketId, marketId),
          or(
            ilike(members.publicMemberId, term),
            ilike(memberProfiles.displayName, term),
            ...(isUuid
              ? [eq(memberWalletAccounts.id, trimmed), eq(members.id, trimmed)]
              : []),
          ),
        ),
      )
      .orderBy(desc(memberWalletAccounts.updatedAt))
      .limit(limit);
    if (rows.length === 0) throw ipointAdjustmentWalletLookupEmptyError();
    return rows.map((row) => ({
      walletId: row.walletId,
      memberId: row.memberId,
      memberPublicId: row.memberPublicId,
      displayName: row.displayName ?? null,
      marketId: row.marketId,
      availableBalance: row.availableBalance,
      archived: row.archivedAt !== null,
    }));
  }

  // ─── Owner command delegation (frozen SEC-01 owner) ────────────────

  /** Maker create (DRAFT). Idempotency-Key is mandatory (owner enforces). */
  create(
    actor: AdminIpointAdjustOpsActor,
    command: CreateAdjustmentCommand,
  ): Promise<WalletAdjustmentRequestView> {
    return this.owner.create(this.ownerActor(actor), command);
  }

  /** Maker submit (DRAFT -> SUBMITTED). */
  submit(
    actor: AdminIpointAdjustOpsActor,
    requestId: string,
  ): Promise<WalletAdjustmentRequestView> {
    return this.owner.submit(this.ownerActor(actor), requestId);
  }

  /** Checker decide (SUBMITTED -> APPROVED | REJECTED). */
  decide(
    actor: AdminIpointAdjustOpsActor,
    requestId: string,
    command: AdjustmentDecisionCommand,
  ): Promise<WalletAdjustmentRequestView> {
    return this.owner.decide(this.ownerActor(actor), requestId, command);
  }

  /** Checker execute (APPROVED -> EXECUTING -> EXECUTED | FAILED). */
  execute(
    actor: AdminIpointAdjustOpsActor,
    requestId: string,
  ): Promise<WalletAdjustmentRequestView> {
    return this.owner.execute(this.ownerActor(actor), requestId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private ownerActor(
    actor: AdminIpointAdjustOpsActor,
  ): WalletAdjustmentOwnerActor {
    return {
      adminUserId: actor.adminUserId,
      ipAddress: actor.ipAddress ?? 'unknown',
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
      ...(actor.currentMarketId
        ? { currentMarketId: actor.currentMarketId }
        : {}),
      ...(actor.marketContextVersion !== undefined
        ? { marketContextVersion: actor.marketContextVersion }
        : {}),
    };
  }

  private toView(
    row: typeof ipointAdjustmentRequests.$inferSelect,
  ): AdminIpointAdjustmentViewDto {
    return {
      id: row.id,
      walletAccountId: row.walletAccountId,
      memberId: row.memberId,
      marketId: row.marketId,
      direction: row.direction as 'CREDIT' | 'DEBIT',
      amount: row.amount,
      state: row.state as AdminIpointAdjustmentViewDto['state'],
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
}
