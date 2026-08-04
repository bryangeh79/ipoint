import {
  AdminApiClient,
  AdminKycOpsApiClient,
  AdminMerchantApiClient,
  AdminPackageOpsApiClient,
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
