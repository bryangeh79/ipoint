import type {
  AdminMemberDetailResponse,
  AdminMemberListResponse,
  AdminMemberNotesListResponse,
} from '../admin-member/admin-member.types.js';

/**
 * P7-S5A Member Operations adapter types.
 *
 * The adapter reuses the frozen Phase 2 Admin Member response contracts
 * verbatim (masking, pagination shape, status history, notes) and only adds
 * the selected-market envelope on top. No wallet, ledger, balance, or raw
 * projection is introduced: Member Operations never exposes financial
 * detail beyond the owner's approved masked summaries.
 */

export type MemberOpsMemberListItem =
  AdminMemberListResponse['members'][number];

export interface MemberOpsListResponse extends AdminMemberListResponse {
  /** Server-owned Current Admin Market the list was bounded to. */
  marketId: string;
}

export type MemberOpsDetailResponse = AdminMemberDetailResponse;

export type MemberOpsNotesListResponse = AdminMemberNotesListResponse;

export type MemberOpsErrorCode = 'MEMBER_OPS_MARKET_MISMATCH';

export class MemberOpsError extends Error {
  constructor(
    readonly code: MemberOpsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MemberOpsError';
  }
}

export interface MemberOpsActor {
  adminUserId: string;
  requestId?: string;
  ipAddress?: string;
}
