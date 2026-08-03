import {
  memberListQuerySchema,
  notesListQuerySchema,
} from '../admin-member/admin-member.dto.js';

/**
 * P7-S5A Member Operations query DTOs.
 *
 * These are the frozen Phase 2 schemas reused verbatim, minus the
 * client-supplied market filters (`marketId` / `currentMarket`): the adapter
 * derives the market exclusively from the server-owned Current Admin Market
 * resolved by the P7-S2 RbacGuard, so no client input can re-scope a read to
 * another market.
 */

export const memberOpsListQuerySchema = memberListQuerySchema.omit({
  marketId: true,
  currentMarket: true,
});

export const memberOpsNotesListQuerySchema = notesListQuerySchema;

export type MemberOpsListQueryDto = ReturnType<
  typeof memberOpsListQuerySchema.parse
>;

export type MemberOpsNotesListQueryDto = ReturnType<
  typeof memberOpsNotesListQuerySchema.parse
>;
