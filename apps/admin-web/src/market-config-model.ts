import { ApiError } from '@ipoint/api-client';

/**
 * P7-S6E Admin Market Configuration — pure presentation model.
 *
 * Formatting-only helpers for the secured market owner surface
 * (`apps/api/src/market/market-owner.*`): field-format affordances
 * (name 1..200, currency 3 uppercase letters, BCP-47-style locale, IANA
 * timezone validity), error copy, permission affordances and the
 * deactivation form state. UI affordances are never authorization — the
 * server (canonical RbacGuard + the market owner) enforces permission,
 * market scope, step-up, reason, idempotency and the dependency gate.
 */

/** Market name grammar: trimmed, 1..200 chars (server contract). */
export function marketNameValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 200;
}

/** Currency code grammar: exactly 3 uppercase letters. */
export function marketCurrencyValid(currency: string): boolean {
  return /^[A-Z]{3}$/u.test(currency.trim());
}

/** BCP-47-style locale grammar (server contract). */
export function marketLocaleValid(locale: string): boolean {
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(locale.trim());
}

/** IANA timezone validity (Intl-based, mirrors the server validator). */
export function marketTimezoneValid(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Controlled-field draft for the update form. Only fields the operator
 * explicitly edits are sent (the server ignores nothing — a strict DTO
 * rejects unknown fields and the owner requires at least one change).
 */
export interface MarketConfigDraft {
  name: string;
  currencyCode: string;
  timezone: string;
  defaultLocale: string;
  status: 'ACTIVE' | 'INACTIVE';
  reason: string;
  deactivationConfirmed: boolean;
}

/** UI affordance only — the server enforces permission and market. */
export function canViewMarket(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('market.read');
}

/** UI affordance only — the server enforces the SUPER_ADMIN-only gate. */
export function canManageMarket(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('market.manage');
}

export interface MarketPageErrorCopy {
  title: string;
  description: string;
}

export function describeMarketReadError(error: unknown): MarketPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'MARKET_PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include the market.read permission for this market.',
        };
      case 'MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load market configuration.',
        };
      case 'MARKET_CONTEXT_MISMATCH':
        return {
          title: 'Market context changed',
          description:
            'The selected market changed while loading. Refresh and try again.',
        };
      case 'MARKET_ACCESS_DENIED':
        return {
          title: 'Market access denied',
          description:
            'Your administrator account does not have access to this market, or the market is not active.',
        };
      case 'NETWORK_OFFLINE':
        return {
          title: 'You are offline',
          description:
            'Market configuration needs a connection. Check your network and retry.',
        };
    }
  }
  return {
    title: 'Market configuration unavailable',
    description:
      'The market configuration could not be loaded. Retry, or try again later.',
  };
}

export function describeMarketWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'MARKET_DEACTIVATION_DEPENDENCY':
        return 'This market cannot be deactivated while active resources depend on it (merchants, members or configuration references). Resolve the dependencies first.';
      case 'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED':
        return 'Confirm the deactivation to continue.';
      case 'MARKET_NO_CHANGES':
        return 'No market fields changed.';
      case 'MARKET_INVALID_FIELD':
        return 'One or more fields are invalid — check the name, currency code, timezone and locale formats.';
      case 'MARKET_IDEMPOTENCY_CONFLICT':
        return 'The request was retried with a different payload. Refresh and retry.';
      case 'MARKET_REASON_REQUIRED':
        return 'A reason between 1 and 500 characters is required.';
      case 'MARKET_IDEMPOTENCY_KEY_REQUIRED':
        return 'A valid Idempotency-Key header is required.';
      case 'MARKET_PERMISSION_DENIED':
      case 'PERMISSION_DENIED':
        return 'The server denied this action.';
      case 'MARKET_ACCESS_DENIED':
        return 'The administrator does not have access to this market, or the market is not active.';
      case 'MARKET_CONTEXT_MISMATCH':
        return 'The selected market changed. Refresh and retry.';
      case 'MFA_STEP_UP_REQUIRED':
        return 'Verify your identity again to manage the market.';
      case 'NETWORK_OFFLINE':
        return 'You are offline. Retry when connected.';
    }
  }
  return 'The action could not be completed. Retry, or try again later.';
}
