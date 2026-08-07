import { Inject, Injectable } from '@nestjs/common';
import {
  agentActivationStatusLogs,
  agentActivations,
  commissionRateVersions,
  markets,
  memberProfiles,
  members,
} from '@ipoint/database';
import { and, desc, eq, ilike, lte, or, sql } from 'drizzle-orm';
import { AgentActivationService } from '../domain/agent-activation/service.js';
import { AgentActivationError } from '../domain/agent-activation/agent-activation.errors.js';
import { DatabaseService } from '../database/database.service.js';
import type { AgentListQueryDto } from './admin-agent-ops.dto.js';
import {
  agentMarketNotFoundError,
  agentNotFoundError,
  agentReasonRequiredError,
} from './admin-agent-ops.errors.js';
import {
  AGENT_STATUSES,
  AgentOpsError,
  type AgentDetailResponse,
  type AgentListItemDto,
  type AgentListResponse,
  type AgentOpsActor,
  type AgentOpsCapability,
  type AgentOpsErrorCode,
  type AgentOpsStatus,
  type AgentStatusActionResultDto,
  type AgentStatusHistoryEntryDto,
} from './admin-agent-ops.types.js';

/** Frozen P5-S2 constants mirrored from the owner (`domain/agent-activation`). */
const ACTIVATION_FEE_COMMISSION_TYPE = 'AGENT_ACTIVATION_FEE';
const ACTIVATION_FEE_GENERATION = 0;

/**
 * P7-S8 Admin Agent Operations adapter service (Command Center 2026-08-07
 * §6.1).
 *
 * Phase 7 read projection + orchestration over the FROZEN Phase 5 agent
 * activation owner. All domain behavior — transition validation, market
 * consistency, durable reason, immutable status log and actor
 * attribution — stays inside the owner commands, which are invoked
 * unchanged with the server-owned Current Admin Market (resolved to the
 * market code by the RbacGuard context) and the executing admin identity.
 *
 * What the adapter adds (legitimate Phase 7 orchestration/read/UI
 * behavior only):
 *
 * 1. The market-scoped agent list/search/detail projection (join with the
 *    member identity; status + free-text filters; pagination) and the
 *    append-only status-history view (owner `agent_activation_status_log`).
 * 2. The explicit capability state: a market is agent-capable only when an
 *    effective AGENT_ACTIVATION_FEE version exists (the exact precondition
 *    the owner enforces at apply time). Unconfigured markets report
 *    `AGENT_FEE_NOT_CONFIGURED` — no fallback to Malaysia or any other
 *    market, and status operations on such a market stay blocked.
 * 3. The owner error → adapter error mapping (every `AGENT_ACTIVATION_*`
 *    code; no error swallowed into a 2xx).
 *
 * Agent Reapplication Policy is OPEN (not implemented): this surface does
 * not expose any reapplication behavior and no owner command for it exists.
 */
@Injectable()
export class AdminAgentOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AgentActivationService)
    private readonly owner: AgentActivationService,
  ) {}

  // ─── Read projections ──────────────────────────────────────────────

  /**
   * Selected-market agent list/search (read projection, `agent.read`).
   *
   * The market filter is server-owned: the RbacGuard resolved the Current
   * Admin Market and the URL `:marketId` must equal it. The projection
   * filters by the market CODE (the owner stores 2-letter market codes on
   * `agent_activation.market`) and joins the member identity. Free-text
   * search covers the public member id, the referral code and the member
   * profile display name (ILIKE, prefix-agnostic, bounded length).
   */
  async listAgents(
    actor: AgentOpsActor,
    marketId: string,
    query: AgentListQueryDto,
  ): Promise<AgentListResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw agentMarketNotFoundError();

    const capability = await this.capability(market.code);

    const conditions = [eq(agentActivations.market, market.code)];
    if (query.status) {
      conditions.push(eq(agentActivations.status, query.status));
    }
    if (query.q) {
      const pattern = `%${query.q}%`;
      conditions.push(
        or(
          ilike(members.publicMemberId, pattern),
          ilike(members.referralCode, pattern),
          ilike(memberProfiles.displayName, pattern),
        )!,
      );
    }

    const where = and(...conditions);
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [countRows, rows] = await Promise.all([
      this.database.db
        .select({ total: sql<number>`count(*)::int` })
        .from(agentActivations)
        .innerJoin(members, eq(members.id, agentActivations.memberId))
        .innerJoin(
          memberProfiles,
          eq(memberProfiles.memberId, agentActivations.memberId),
        )
        .where(where),
      this.database.db
        .select({
          id: agentActivations.id,
          memberId: agentActivations.memberId,
          publicMemberId: members.publicMemberId,
          memberDisplayName: memberProfiles.displayName,
          status: agentActivations.status,
          market: agentActivations.market,
          activationFee: agentActivations.activationFee,
          activationFeeCurrency: agentActivations.activationFeeCurrency,
          activatedAt: agentActivations.activatedAt,
          createdAt: agentActivations.createdAt,
        })
        .from(agentActivations)
        .innerJoin(members, eq(members.id, agentActivations.memberId))
        .innerJoin(
          memberProfiles,
          eq(memberProfiles.memberId, agentActivations.memberId),
        )
        .where(where)
        .orderBy(desc(agentActivations.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const items: AgentListItemDto[] = rows.map((row) => ({
      agent_id: row.id,
      member_id: row.memberId,
      public_member_id: row.publicMemberId,
      member_display_name: row.memberDisplayName,
      status: row.status as AgentOpsStatus,
      market: row.market,
      activation_fee:
        row.activationFee !== null ? String(row.activationFee) : null,
      activation_fee_currency: row.activationFeeCurrency,
      activated_at: row.activatedAt ? row.activatedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
    }));

    void actor;
    return {
      market_id: marketId,
      market_code: market.code,
      capability,
      items,
      total: countRows[0]?.total ?? 0,
      limit,
      offset,
    };
  }

  /**
   * Selected-market agent detail: the activation record (must belong to
   * the current market) plus the member identity and the append-only
   * status history (newest first).
   */
  async getAgent(
    actor: AgentOpsActor,
    marketId: string,
    agentId: string,
  ): Promise<AgentDetailResponse> {
    const market = await this.marketRow(marketId);
    if (!market) throw agentMarketNotFoundError();

    const rows = await this.database.db
      .select({
        activation: agentActivations,
        publicMemberId: members.publicMemberId,
        memberDisplayName: memberProfiles.displayName,
      })
      .from(agentActivations)
      .innerJoin(members, eq(members.id, agentActivations.memberId))
      .innerJoin(
        memberProfiles,
        eq(memberProfiles.memberId, agentActivations.memberId),
      )
      .where(
        and(
          eq(agentActivations.id, agentId),
          eq(agentActivations.market, market.code),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw agentNotFoundError(agentId);

    const activation = row.activation;
    const historyRows = await this.database.db
      .select()
      .from(agentActivationStatusLogs)
      .where(eq(agentActivationStatusLogs.activationId, agentId))
      .orderBy(desc(agentActivationStatusLogs.changedAt));

    const statusHistory: AgentStatusHistoryEntryDto[] = historyRows.map(
      (log) => ({
        log_id: log.logId,
        from_status: log.fromStatus as AgentOpsStatus | null,
        to_status: log.toStatus as AgentOpsStatus,
        changed_by: log.changedBy,
        changed_by_type: log.changedByType,
        reason: log.reason,
        changed_at: log.changedAt.toISOString(),
      }),
    );

    void actor;
    return {
      agent_id: activation.id,
      member_id: activation.memberId,
      public_member_id: row.publicMemberId,
      member_display_name: row.memberDisplayName,
      status: activation.status as AgentOpsStatus,
      market: activation.market,
      activation_fee:
        activation.activationFee !== null
          ? String(activation.activationFee)
          : null,
      activation_fee_currency: activation.activationFeeCurrency,
      activated_at: activation.activatedAt
        ? activation.activatedAt.toISOString()
        : null,
      created_at: activation.createdAt.toISOString(),
      payment_reference: activation.paymentReference,
      payment_confirmed_at: activation.paymentConfirmedAt
        ? activation.paymentConfirmedAt.toISOString()
        : null,
      course_reference: activation.courseReference,
      course_enrolled_at: activation.courseEnrolledAt
        ? activation.courseEnrolledAt.toISOString()
        : null,
      course_completed_at: activation.courseCompletedAt
        ? activation.courseCompletedAt.toISOString()
        : null,
      course_confirmed_by: activation.courseConfirmedBy,
      approved_at: activation.approvedAt
        ? activation.approvedAt.toISOString()
        : null,
      activated_by: activation.activatedBy,
      fee_rate_version_id: activation.feeRateVersionId,
      rejection_reason: activation.rejectionReason,
      reactivation_count: activation.reactivationCount,
      revoked_at: activation.revokedAt
        ? activation.revokedAt.toISOString()
        : null,
      revoked_by: activation.revokedBy,
      revocation_reason: activation.revocationReason,
      updated_at: activation.updatedAt.toISOString(),
      status_history: statusHistory,
    };
  }

  // ─── Orchestrated status operations (frozen P5 owner commands) ─────

  /**
   * Suspend an ACTIVE agent. Delegates 1:1 to the frozen owner command
   * `AgentActivationService.suspend(activationId, adminId, marketCode,
   * reason)` — transition validation, market consistency, durable reason
   * and the immutable status log are all owner-owned (P5-R1 actor
   * attribution). The market code is resolved from the server-owned
   * RbacGuard context, never client-supplied.
   */
  async suspendAgent(
    actor: AgentOpsActor,
    marketId: string,
    agentId: string,
    reason: string,
  ): Promise<AgentStatusActionResultDto> {
    const marketCode = await this.marketCode(marketId);
    const normalized = reason.trim();
    if (!normalized) throw agentReasonRequiredError();
    try {
      await this.owner.suspend(
        agentId,
        actor.adminUserId,
        marketCode,
        normalized,
      );
    } catch (error) {
      throw this.mapOwnerError(error);
    }
    return this.resultFor(agentId, 'SUSPENDED');
  }

  /**
   * Reactivate a SUSPENDED agent (SUSPENDED → ACTIVE, owner increments the
   * reactivation count and records the executing admin).
   */
  async reactivateAgent(
    actor: AgentOpsActor,
    marketId: string,
    agentId: string,
  ): Promise<AgentStatusActionResultDto> {
    const marketCode = await this.marketCode(marketId);
    try {
      await this.owner.reactivate(agentId, actor.adminUserId, marketCode);
    } catch (error) {
      throw this.mapOwnerError(error);
    }
    return this.resultFor(agentId, 'ACTIVE');
  }

  /**
   * Deactivate an ACTIVE agent (terminal state; owner records
   * revoked_at/revoked_by/revocation_reason).
   */
  async deactivateAgent(
    actor: AgentOpsActor,
    marketId: string,
    agentId: string,
    reason: string,
  ): Promise<AgentStatusActionResultDto> {
    const marketCode = await this.marketCode(marketId);
    const normalized = reason.trim();
    if (!normalized) throw agentReasonRequiredError();
    try {
      await this.owner.deactivate(
        agentId,
        actor.adminUserId,
        marketCode,
        normalized,
      );
    } catch (error) {
      throw this.mapOwnerError(error);
    }
    return this.resultFor(agentId, 'DEACTIVATED');
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async marketRow(
    marketId: string,
  ): Promise<{ id: string; code: string; currencyCode: string } | undefined> {
    const rows = await this.database.db
      .select({
        id: markets.id,
        code: markets.code,
        currencyCode: markets.currencyCode,
      })
      .from(markets)
      .where(eq(markets.id, marketId))
      .limit(1);
    return rows[0];
  }

  /** Resolve the market code; throws when the market does not exist. */
  private async marketCode(marketId: string): Promise<string> {
    const market = await this.marketRow(marketId);
    if (!market) throw agentMarketNotFoundError();
    return market.code;
  }

  /**
   * Explicit capability state: an effective AGENT_ACTIVATION_FEE version
   * for the market (the exact precondition the frozen owner's
   * `resolveFeeVersion` enforces). Unconfigured markets report
   * `AGENT_FEE_NOT_CONFIGURED` — the surface never falls back to another
   * market's fee.
   */
  private async capability(marketCode: string): Promise<AgentOpsCapability> {
    const now = new Date();
    const rows = await this.database.db
      .select({
        id: commissionRateVersions.id,
        rateValue: commissionRateVersions.rateValue,
        market: commissionRateVersions.market,
      })
      .from(commissionRateVersions)
      .where(
        and(
          eq(
            commissionRateVersions.commissionType,
            ACTIVATION_FEE_COMMISSION_TYPE,
          ),
          eq(commissionRateVersions.generation, ACTIVATION_FEE_GENERATION),
          eq(commissionRateVersions.market, marketCode),
          lte(commissionRateVersions.effectiveFrom, now),
          sql`(${commissionRateVersions.effectiveUntil} IS NULL OR ${commissionRateVersions.effectiveUntil} > ${now})`,
        ),
      )
      .orderBy(desc(commissionRateVersions.effectiveFrom))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return {
        state: 'AGENT_FEE_NOT_CONFIGURED',
        activation_fee: null,
        currency: null,
        fee_rate_version_id: null,
      };
    }
    const market = await this.marketByCode(row.market);
    return {
      state: 'CONFIGURED',
      activation_fee: String(row.rateValue),
      currency: market?.currencyCode ?? null,
      fee_rate_version_id: row.id,
    };
  }

  private async marketByCode(
    code: string,
  ): Promise<{ currencyCode: string } | undefined> {
    const rows = await this.database.db
      .select({ currencyCode: markets.currencyCode })
      .from(markets)
      .where(eq(markets.code, code))
      .limit(1);
    return rows[0];
  }

  /** Re-read the owner row after a successful status transition. */
  private async resultFor(
    agentId: string,
    expected: AgentOpsStatus,
  ): Promise<AgentStatusActionResultDto> {
    const rows = await this.database.db
      .select({
        status: agentActivations.status,
        updatedAt: agentActivations.updatedAt,
      })
      .from(agentActivations)
      .where(eq(agentActivations.id, agentId))
      .limit(1);
    const row = rows[0];
    if (!row) throw agentNotFoundError(agentId);
    return {
      agent_id: agentId,
      status: (row.status as AgentOpsStatus) ?? expected,
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /**
   * Translate the frozen owner's `AGENT_ACTIVATION_*` rejections into the
   * adapter error codes. Unknown codes propagate as-is (500 through the
   * controller) — no error is swallowed into a 2xx.
   */
  private mapOwnerError(error: unknown): AgentOpsError {
    if (error instanceof AgentActivationError) {
      const code = this.toAdapterCode(error.code);
      return new AgentOpsError(code, error.message, error.details);
    }
    if (error instanceof AgentOpsError) return error;
    throw error;
  }

  private toAdapterCode(code: string): AgentOpsErrorCode {
    switch (code) {
      case 'AGENT_ACTIVATION_NOT_FOUND':
        return 'AGENT_NOT_FOUND';
      case 'AGENT_ACTIVATION_FEE_NOT_CONFIGURED':
        return 'AGENT_FEE_NOT_CONFIGURED';
      case 'AGENT_ACTIVATION_INVALID_TRANSITION':
        return 'AGENT_INVALID_TRANSITION';
      case 'AGENT_ACTIVATION_INVALID_STATUS':
        return 'AGENT_INVALID_STATUS';
      case 'AGENT_ACTIVATION_ALREADY_EXISTS':
        return 'AGENT_ALREADY_EXISTS';
      case 'AGENT_ACTIVATION_PAYMENT_ALREADY_CONFIRMED':
        return 'AGENT_PAYMENT_ALREADY_CONFIRMED';
      case 'AGENT_ACTIVATION_COURSE_ALREADY_COMPLETED':
        return 'AGENT_COURSE_ALREADY_COMPLETED';
      case 'AGENT_ACTIVATION_MISSING_PAYMENT':
        return 'AGENT_MISSING_PAYMENT';
      case 'AGENT_ACTIVATION_MISSING_COURSE':
        return 'AGENT_MISSING_COURSE';
      case 'AGENT_ACTIVATION_MISSING_APPROVAL':
        return 'AGENT_MISSING_APPROVAL';
      case 'AGENT_ACTIVATION_OWNERSHIP_MISMATCH':
        return 'AGENT_OWNERSHIP_MISMATCH';
      case 'AGENT_ACTIVATION_MARKET_MISMATCH':
        return 'AGENT_MARKET_MISMATCH';
      case 'AGENT_ACTIVATION_ALREADY_ACTIVE':
        return 'AGENT_ALREADY_ACTIVE';
      case 'AGENT_ACTIVATION_ALREADY_SUSPENDED':
        return 'AGENT_ALREADY_SUSPENDED';
      case 'AGENT_ACTIVATION_ALREADY_DEACTIVATED':
        return 'AGENT_ALREADY_DEACTIVATED';
      case 'AGENT_ACTIVATION_ALREADY_REJECTED':
        return 'AGENT_ALREADY_REJECTED';
      case 'AGENT_ACTIVATION_DEACTIVATED_CANNOT_REACTIVATE':
        return 'AGENT_DEACTIVATED_CANNOT_REACTIVATE';
      case 'AGENT_ACTIVATION_REJECTED_CANNOT_TRANSITION':
        return 'AGENT_REJECTED_CANNOT_TRANSITION';
      default:
        return 'AGENT_INVALID_TRANSITION';
    }
  }
}

/** Statuses an admin may target through this surface (display/typing aid). */
export const ADMIN_AGENT_STATUSES = AGENT_STATUSES;
