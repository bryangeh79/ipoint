import { ApiClient, MerchantTransactionApiClient } from '@ipoint/api-client';

/**
 * Singleton API clients for the merchant-web app.
 *
 * The raw `api` instance keeps the legacy merchant surface (auth,
 * profile, packages, MCP) working unchanged. `merchantTransactionApi`
 * is the typed P8-S5C adapter over the frozen Phase 4 merchant
 * transaction controller (preview / confirm / receipt / history).
 */
const apiBaseUrl: string =
  typeof import.meta.env.VITE_API_BASE_URL === 'string'
    ? import.meta.env.VITE_API_BASE_URL
    : '/api/v1';

export const api = new ApiClient(apiBaseUrl);
export const merchantTransactionApi = new MerchantTransactionApiClient(api);
