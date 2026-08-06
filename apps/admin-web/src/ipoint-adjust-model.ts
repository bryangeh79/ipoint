import { ApiError, type AdminIpointAdjustmentDto } from '@ipoint/api-client';

/**
 * P7-S7B Manual iPoint Adjustment — pure presentation model (SEC-01 §6 /
 * P7-S1 §17, P7-OD-03/10/11/18/20).
 *
 * Formatting-only helpers: no client arithmetic on amounts beyond the
 * display grammar, no status derivation, no invented rules. Every
 * status/value displayed comes from the Phase 7 adapter responses as
 * returned. Amounts are exact decimal strings (numeric(38,10)) and are
 * never parsed or reformatted numerically. UI affordances are never
 * authorization — the frozen SEC-01 owner enforces permission, market,
 * Maker≠Checker inequality, caps routing, evidence and execution rules
 * server-side.
 */

export const ipointAdjustmentStateLabels: Readonly<Record<string, string>> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXECUTING: 'Executing',
  EXECUTED: 'Executed',
  FAILED: 'Failed',
};

export function ipointAdjustmentStateLabel(state: string): string {
  return ipointAdjustmentStateLabels[state] ?? state;
}

/** Exact-decimal comparison of two amount strings (never floats). */
function scaledAmount(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return (
    BigInt(whole) * 10_000_000_000n +
    BigInt(fraction.padEnd(10, '0').slice(0, 10) || '0')
  );
}

/**
 * UI affordance only — the server (frozen owner) enforces the per-market
 * caps. `true` when the amount is strictly above the market soft cap
 * (Super Admin checker routing + secure-evidence execution gate).
 */
export function ipointAdjustmentAboveSoftCap(
  amount: string,
  softCap: string | undefined,
): boolean {
  if (!softCap) return false;
  return scaledAmount(amount) > scaledAmount(softCap);
}

/**
 * UI affordance only — mirrors the owner's execution gate (P7-OD-11):
 * above-soft-cap execution stays disabled until secure evidence storage
 * is enabled for the market. The server remains the authority.
 */
export function ipointAdjustmentExecutionBlocked(input: {
  state: string;
  amount: string;
  softCap?: string;
  secureEvidenceAvailable: boolean;
}): boolean {
  return (
    input.state === 'APPROVED' &&
    ipointAdjustmentAboveSoftCap(input.amount, input.softCap) &&
    !input.secureEvidenceAvailable
  );
}

/** Maker screen double gate: the maker permission AND the sensitive-write env. */
export function canCreateIpointAdjustment(
  effectivePermissions: ReadonlyArray<string>,
  canPerformSensitiveWrite: boolean,
): boolean {
  return (
    effectivePermissions.includes('wallet.ipoint.adjust.maker') &&
    canPerformSensitiveWrite
  );
}

/** Checker screen gate: the checker permission AND the sensitive-write env. */
export function canDecideIpointAdjustment(
  effectivePermissions: ReadonlyArray<string>,
  canPerformSensitiveWrite: boolean,
): boolean {
  return (
    effectivePermissions.includes('wallet.ipoint.adjust.checker') &&
    canPerformSensitiveWrite
  );
}

/** Execute gate: the execute permission AND the sensitive-write env. */
export function canExecuteIpointAdjustment(
  effectivePermissions: ReadonlyArray<string>,
  canPerformSensitiveWrite: boolean,
): boolean {
  return (
    effectivePermissions.includes('wallet.ipoint.adjust.execute') &&
    canPerformSensitiveWrite
  );
}

/**
 * Checker UI affordance mirroring the owner's Maker≠Checker inequality
 * (P7-OD-03/10): the checker controls are disabled for the maker's own
 * request at every amount, including Super Admin. The server enforces the
 * inequality regardless.
 */
export function isOwnRequest(
  request: Pick<AdminIpointAdjustmentDto, 'makerAdminUserId'>,
  currentAdminUserId: string | undefined,
): boolean {
  return Boolean(
    currentAdminUserId && request.makerAdminUserId === currentAdminUserId,
  );
}

/** Amount display: exact string with full precision (never parsed). */
export function formatIpointAmount(amount: string): string {
  return amount;
}

/** Stable UTC display for ISO instants (fallback: raw string). */
export function formatIpointUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}

/** Sort queue newest-first for display (server order is authority). */
export function orderIpointAdjustments<T extends { createdAt: string }>(
  items: ReadonlyArray<T>,
): T[] {
  return [...items].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

export interface IpointAdjustmentPageErrorCopy {
  title: string;
  description: string;
}

export function describeIpointAdjustmentReadError(
  error: unknown,
): IpointAdjustmentPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'WALLET_ADJUSTMENT_PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include wallet.ipoint.read for this market.',
        };
      case 'MARKET_SELECTION_REQUIRED':
      case 'WALLET_ADJUSTMENT_MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load the iPoint adjustment queue.',
        };
      case 'MARKET_CONTEXT_MISMATCH':
      case 'WALLET_ADJUSTMENT_MARKET_CONTEXT_MISMATCH':
        return {
          title: 'Market context changed',
          description:
            'The selected market changed while loading. Refresh and try again.',
        };
      case 'MARKET_ACCESS_DENIED':
      case 'WALLET_ADJUSTMENT_MARKET_ACCESS_DENIED':
        return {
          title: 'Market access denied',
          description:
            'Your administrator account does not have access to this market, or the market is not active.',
        };
      case 'WALLET_ADJUSTMENT_REQUEST_NOT_FOUND':
      case 'WALLET_ADJUSTMENT_MARKET_NOT_FOUND':
        return {
          title: 'Not found',
          description: 'The adjustment request does not exist in this market.',
        };
      case 'NETWORK_OFFLINE':
        return {
          title: 'You are offline',
          description:
            'The iPoint adjustment queue needs a connection. Check your network and retry.',
        };
    }
  }
  return {
    title: 'iPoint adjustment queue unavailable',
    description:
      'The adjustment queue could not be loaded. Retry, or try again later.',
  };
}

export function describeIpointAdjustmentWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'WALLET_ADJUSTMENT_ABOVE_HARD_CAP':
        return 'The amount exceeds the hard cap for this market and cannot be adjusted.';
      case 'WALLET_ADJUSTMENT_REASON_CODE_INVALID':
        return 'The reason code is not active in this market.';
      case 'WALLET_ADJUSTMENT_ATTACHMENT_REQUIRED':
        return 'An attachment reference is required above the soft cap, for high-risk reason codes, or when the checker requests it.';
      case 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE':
        return 'Execution above the soft cap remains disabled until secure evidence storage is enabled for this market.';
      case 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT':
        return 'The checker must be a different administrator than the maker, at every amount, including Super Admin.';
      case 'WALLET_ADJUSTMENT_CHECKER_ROUTING_DENIED':
        return 'This amount is above the soft cap and requires a Super Admin checker.';
      case 'WALLET_ADJUSTMENT_INSUFFICIENT_BALANCE':
        return 'The debit amount exceeds the wallet available balance.';
      case 'WALLET_ADJUSTMENT_IDEMPOTENCY_CONFLICT':
        return 'The request was retried with a different payload. Refresh and retry.';
      case 'WALLET_ADJUSTMENT_DECISION_REASON_REQUIRED':
        return 'A decision reason between 1 and 2000 characters is required.';
      case 'WALLET_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED':
      case 'WALLET_ADJUSTMENT_INVALID_FIELD':
      case 'WALLET_ADJUSTMENT_INVALID_AMOUNT':
        return 'The request is not well-formed. Check the values and retry.';
      case 'WALLET_ADJUSTMENT_STATE_CONFLICT':
        return 'The request cannot transition from its current state. Refresh and retry.';
      case 'WALLET_ADJUSTMENT_MARKET_NOT_CONFIGURED':
        return 'Manual iPoint adjustments are not configured for this market.';
      case 'WALLET_ADJUSTMENT_MARKET_CONTEXT_MISMATCH':
      case 'MARKET_CONTEXT_MISMATCH':
        return 'The selected market changed. Refresh and retry.';
      case 'WALLET_ADJUSTMENT_PERMISSION_DENIED':
      case 'PERMISSION_DENIED':
        return 'The server denied this action.';
      case 'NETWORK_OFFLINE':
        return 'You are offline. Retry when connected.';
    }
  }
  return 'The action could not be completed. Retry, or try again later.';
}

/** Amount grammar for the maker form (UI affordance; owner enforces). */
export function ipointAdjustmentAmountValid(amount: string): boolean {
  return (
    /^\d+(?:\.\d{1,10})?$/u.test(amount.trim()) &&
    !/^0+(?:\.0+)?$/u.test(amount.trim())
  );
}
