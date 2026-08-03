import { KycOpsError } from './admin-kyc-ops.types.js';

/**
 * The KYC case/submission exists and the administrator holds a market grant,
 * but the case's market is not the server-owned Current Admin Market. The
 * P7-S0 contract requires every ordinary read to be a selected-market read;
 * the adapter therefore rejects the cross-market reference with the same
 * MARKET_CONTEXT_MISMATCH code the platform uses for any client/server
 * market disagreement.
 */
export function kycOpsMarketMismatchError(): KycOpsError {
  return new KycOpsError(
    'KYC_OPS_MARKET_MISMATCH',
    'The KYC case is not in the selected market. Refresh and review the current state.',
    { marketScope: 'SELECTED' },
  );
}
