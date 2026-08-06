import {
  AdminApiClient,
  AdminCommissionOpsApiClient,
  AdminKycOpsApiClient,
  AdminMerchantApiClient,
  AdminPackageOpsApiClient,
  AdminRedemptionOpsApiClient,
  AdminRewardOpsApiClient,
  ApiClient,
} from '@ipoint/api-client';

const apiBaseUrl: string =
  typeof import.meta.env.VITE_API_BASE_URL === 'string'
    ? import.meta.env.VITE_API_BASE_URL
    : '/api/v1';

export const adminApi = new AdminApiClient(new ApiClient(apiBaseUrl));

/**
 * P7-S5B selected-market Admin Merchant Operations client.
 * Self-contained addition; the market is validated server-side against the
 * Current Admin Market on every request.
 */
export const adminMerchantApi = new AdminMerchantApiClient(
  new ApiClient(apiBaseUrl),
);

/**
 * P7-S5C selected-market Admin KYC review + privacy client.
 * Self-contained addition; the market is validated server-side against the
 * Current Admin Market on every request, and raw evidence requests carry the
 * recorded reason and step-up token headers.
 */
export const adminKycOpsApi = new AdminKycOpsApiClient(
  new ApiClient(apiBaseUrl),
);

/**
 * P7-S6A selected-market Admin Package Operations client.
 * Self-contained addition; the market is validated server-side against the
 * Current Admin Market on every request, and the privileged special-
 * percentage read carries the fresh step-up token.
 */
export const adminPackageOpsApi = new AdminPackageOpsApiClient(
  new ApiClient(apiBaseUrl),
);

/**
 * P7-S6B selected-market Admin Reward Configuration client.
 * Self-contained addition; the market is validated server-side against the
 * Current Admin Market on every request, and the SUPER_ADMIN-only schedule
 * write carries a mandatory Idempotency-Key + reason.
 */
export const adminRewardOpsApi = new AdminRewardOpsApiClient(
  new ApiClient(apiBaseUrl),
);

/**
 * P7-S6C selected-market Admin Redemption Rate Configuration client.
 * Self-contained addition; the market is validated server-side against the
 * Current Admin Market on every request, and the SUPER_ADMIN-only rate
 * write carries a mandatory Idempotency-Key + reason. Markets without an
 * approved configuration return the explicit blocked state (no fallback).
 */
export const adminRedemptionOpsApi = new AdminRedemptionOpsApiClient(
  new ApiClient(apiBaseUrl),
);

/**
 * P7-S6D selected-market Admin Commission Rate Configuration client.
 * Self-contained addition; the market is validated server-side against the
 * Current Admin Market on every request, and the SUPER_ADMIN-only rate
 * write carries a mandatory Idempotency-Key + reason. The create delegates
 * entirely to the secured Phase 5 owner command (D-054); the read exposes
 * the frozen taxonomy and the per-definition current/scheduled/history
 * windows. Markets that are not ACTIVE stay blocked (no fallback).
 */
export const adminCommissionOpsApi = new AdminCommissionOpsApiClient(
  new ApiClient(apiBaseUrl),
);
