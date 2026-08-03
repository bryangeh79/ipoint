import {
  AdminApiClient,
  AdminMerchantApiClient,
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
