import { MemberOpsError } from './admin-member-ops.types.js';

/**
 * The member exists and the administrator holds a market grant, but the
 * member's current market preference is not the server-owned Current Admin
 * Market. The P7-S0 contract requires every ordinary read to be a
 * selected-market read; the adapter therefore rejects the cross-market
 * reference with the same MARKET_CONTEXT_MISMATCH code the platform uses for
 * any client/server market disagreement.
 */
export function memberOpsMarketMismatchError(): MemberOpsError {
  return new MemberOpsError(
    'MEMBER_OPS_MARKET_MISMATCH',
    'The member is not in the selected market. Refresh and review the current state.',
    { marketScope: 'SELECTED' },
  );
}
