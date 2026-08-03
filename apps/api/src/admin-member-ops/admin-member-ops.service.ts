import { Inject, Injectable } from '@nestjs/common';
import { members } from '@ipoint/database';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AdminMemberService } from '../admin-member/admin-member.service.js';
import {
  memberListQuerySchema,
  type AddAdminNoteDto,
  type CloseMemberDto,
  type NotesListQueryDto,
  type ReactivateMemberDto,
  type RequireReverificationDto,
  type RevokeSessionsDto,
  type SuspendMemberDto,
} from '../admin-member/admin-member.dto.js';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import { memberOpsMarketMismatchError } from './admin-member-ops.errors.js';
import type {
  MemberOpsActor,
  MemberOpsDetailResponse,
  MemberOpsListResponse,
  MemberOpsNotesListResponse,
} from './admin-member-ops.types.js';

/**
 * Client-facing list input: the frozen owner schema output minus the
 * client-supplied market fields and with the sort field made optional (the
 * owner service applies its default ordering when absent). The adapter
 * derives the market exclusively from the server-owned Current Admin Market,
 * so market parameters are structurally impossible here.
 */
export type MemberOpsListInput = Omit<
  z.output<typeof memberListQuerySchema>,
  'marketId' | 'currentMarket' | 'sort'
> & {
  sort?:
    | 'createdAt:desc'
    | 'createdAt:asc'
    | 'publicMemberId:asc'
    | 'publicMemberId:desc';
};

type OwnerListInput = Parameters<AdminMemberService['listMembers']>[1];

/**
 * P7-S5A Member Operations adapter service.
 *
 * This is a thin Phase 7 orchestration layer over the frozen Phase 2
 * AdminMemberService (D-048). It adds exactly one thing the owner endpoints
 * do not enforce: the P7-S0 selected-market contract that every ordinary
 * read/write is bounded to the server-owned Current Admin Market. All domain
 * behaviour — typed validation, state/concurrency checks, required reason,
 * masking, idempotency, and atomic audit — stays inside the owner commands,
 * which are invoked unchanged.
 *
 * No member/account table is written here and no wallet, ledger, or balance
 * projection exists on this surface.
 */
@Injectable()
export class AdminMemberOpsService {
  constructor(
    @Inject(AdminMemberService) private readonly owner: AdminMemberService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /** Selected-market member list: the market filter is server-owned only. */
  async listMembers(
    actor: MemberOpsActor,
    marketId: string,
    filters: MemberOpsListInput,
  ): Promise<MemberOpsListResponse> {
    // The owner runtime tolerates an absent sort (falls back to its default
    // ordering); the cast only satisfies the owner's output-shape typing.
    const response = await this.owner.listMembers(actor, {
      ...filters,
      currentMarket: marketId,
    } as OwnerListInput);
    return { ...response, marketId };
  }

  /** Selected-market member detail with audit-of-view. */
  async getMember(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
  ): Promise<MemberOpsDetailResponse> {
    const detail = await this.owner.getMember(actor, publicMemberId);
    this.assertSelectedMarket(detail, marketId);
    await this.auditView(actor, detail, marketId);
    return detail;
  }

  suspendMember(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    input: SuspendMemberDto,
  ): Promise<MemberOpsDetailResponse> {
    return this.inSelectedMarket(actor, marketId, publicMemberId, (owner) =>
      owner.suspendMember(actor, publicMemberId, input),
    );
  }

  reactivateMember(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    input: ReactivateMemberDto,
  ): Promise<MemberOpsDetailResponse> {
    return this.inSelectedMarket(actor, marketId, publicMemberId, (owner) =>
      owner.reactivateMember(actor, publicMemberId, input),
    );
  }

  closeMember(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    input: CloseMemberDto,
  ): Promise<MemberOpsDetailResponse> {
    return this.inSelectedMarket(actor, marketId, publicMemberId, (owner) =>
      owner.closeMember(actor, publicMemberId, input),
    );
  }

  revokeSessions(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    input: RevokeSessionsDto,
  ): Promise<MemberOpsDetailResponse> {
    return this.inSelectedMarket(actor, marketId, publicMemberId, (owner) =>
      owner.revokeSessions(actor, publicMemberId, input),
    );
  }

  requireReverification(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    input: RequireReverificationDto,
  ): Promise<MemberOpsDetailResponse> {
    return this.inSelectedMarket(actor, marketId, publicMemberId, (owner) =>
      owner.requireReverification(actor, publicMemberId, input),
    );
  }

  addAdminNote(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    input: AddAdminNoteDto,
  ): Promise<MemberOpsDetailResponse> {
    return this.inSelectedMarket(actor, marketId, publicMemberId, (owner) =>
      owner.addAdminNote(actor, publicMemberId, input),
    );
  }

  /** Selected-market notes list (masked summaries only). */
  async getMemberNotes(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    query: NotesListQueryDto,
  ): Promise<MemberOpsNotesListResponse> {
    const detail = await this.owner.getMember(actor, publicMemberId);
    this.assertSelectedMarket(detail, marketId);
    return this.owner.getMemberNotes(actor, publicMemberId, query);
  }

  // ─── Selected-market helpers ────────────────────────────────────────

  private async inSelectedMarket(
    actor: MemberOpsActor,
    marketId: string,
    publicMemberId: string,
    run: (owner: AdminMemberService) => Promise<MemberOpsDetailResponse>,
  ): Promise<MemberOpsDetailResponse> {
    const detail = await this.owner.getMember(actor, publicMemberId);
    this.assertSelectedMarket(detail, marketId);
    return run(this.owner);
  }

  private assertSelectedMarket(
    detail: MemberOpsDetailResponse,
    marketId: string,
  ): void {
    if (detail.currentMarketId !== marketId)
      throw memberOpsMarketMismatchError();
  }

  /**
   * Audit-of-view for the privileged member detail read. The owner audit
   * trail (AuditService) is reused as-is; the record carries the same
   * internal member identifier the owner uses for its write audit so the
   * future Audit Viewer correlates views and actions on one entity.
   */
  private async auditView(
    actor: MemberOpsActor,
    detail: MemberOpsDetailResponse,
    marketId: string,
  ): Promise<void> {
    const internalId = await this.resolveInternalMemberId(
      detail.publicMemberId,
    );
    await this.audit.recordPrivilegedAction({
      actor: { type: 'ADMIN_USER', id: actor.adminUserId },
      action: 'member.ops.view',
      entity: { type: 'member', id: internalId ?? detail.publicMemberId },
      marketId,
      result: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      summary: 'Administrator viewed a masked member profile.',
    });
  }

  private async resolveInternalMemberId(
    publicMemberId: string,
  ): Promise<string | null> {
    const rows = await this.database.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.publicMemberId, publicMemberId))
      .limit(1);
    return rows[0]?.id ?? null;
  }
}
