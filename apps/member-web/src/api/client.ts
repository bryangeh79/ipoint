import { ApiClient } from '@ipoint/api-client';

const DEFAULT_BASE_URL = 'http://localhost:3000/api/v1';

function getBaseUrl(): string {
  try {
    // Vite exposes env vars through import.meta.env
    const envUrl =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      (import.meta.env.VITE_API_BASE_URL as string | undefined);
    return envUrl || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

/**
 * Singleton API client instance for the member-web app.
 * Uses in-memory token storage only (never localStorage/sessionStorage).
 * On page load, session restore is attempted via the refresh endpoint.
 */
export const apiClient = new ApiClient(getBaseUrl());
