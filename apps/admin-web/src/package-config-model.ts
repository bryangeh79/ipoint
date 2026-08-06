import { ApiError, type AdminPackageVersionDto } from '@ipoint/api-client';

/**
 * P7-S6A Admin Package Operations — pure presentation model.
 *
 * Formatting-only helpers: no client arithmetic on rates, no status
 * derivation, no invented rules. Every status/value displayed comes from
 * the Phase 7 adapter / frozen Phase 1 owner responses as returned. Rates
 * are exact decimal strings (numeric(12,6)) and are never parsed or
 * reformatted numerically.
 */

export const packageVersionStatusLabels: Readonly<Record<string, string>> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

export function packageVersionStatusLabel(status: string): string {
  return packageVersionStatusLabels[status] ?? status;
}

export const packageAssignmentStatusLabels: Readonly<Record<string, string>> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  PENDING_CHANGE: 'Pending change',
};

export function packageAssignmentStatusLabel(status: string): string {
  return packageAssignmentStatusLabels[status] ?? status;
}

/** The locked standard package identities (Phase 1 domain fact, A–F). */
export const standardPackageCodes: ReadonlyArray<string> = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
];

/** Sort catalog profiles by the locked A–F ordering, then by name. */
export function orderPackageProfiles<T extends { code: string; name: string }>(
  profiles: ReadonlyArray<T>,
): T[] {
  return [...profiles].sort((left, right) => {
    const leftIndex = standardPackageCodes.indexOf(left.code);
    const rightIndex = standardPackageCodes.indexOf(right.code);
    if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
    if (leftIndex !== -1) return -1;
    if (rightIndex !== -1) return 1;
    return left.name.localeCompare(right.name);
  });
}

export function formatPackageTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}

export function formatPackageWindow(
  version: Pick<AdminPackageVersionDto, 'effective_from' | 'effective_to'>,
): string {
  const from = formatPackageTimestamp(version.effective_from);
  if (!version.effective_to) return `${from} → open`;
  return `${from} → ${formatPackageTimestamp(version.effective_to)}`;
}

/** UI affordance only — the server enforces permission and market. */
export function canManageStandardPackages(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('merchant.package.manage');
}

/**
 * UI affordance only — the server enforces the SUPER_ADMIN-only gate.
 * The page combines this permission gate with
 * `canPerformSensitiveAdminWrite` (online desktop web) before showing the
 * create form (double gate, mirroring the accepted S6D commission page).
 */
export function canManageSpecialPercentages(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('merchant.special_package.manage');
}

/** UI affordance only — the server enforces the SUPER_ADMIN-only gate. */
export function canAssignPackages(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('merchant.package.assign');
}

/**
 * Client-side validity affordance for the special-percentage create
 * form (mirrors the server DTO): rate must be an exact decimal string in
 * (0, 100] with at most 6 decimals, description and reason non-blank.
 * UI affordances are never authorization — the server re-enforces every
 * check inside the D-051 secured owner command.
 */
export function specialPercentageFormValid(input: {
  rate: string;
  description: string;
  reason: string;
}): boolean {
  return (
    packageRateValid(input.rate) &&
    input.description.trim().length > 0 &&
    input.reason.trim().length > 0 &&
    input.reason.trim().length <= 500
  );
}

/** UI affordance only — the server enforces the SUPER_ADMIN-only gate. */
export function canCreateSpecialPercentages(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return canManageSpecialPercentages(effectivePermissions);
}

/**
 * D-051 rewire: the frozen Phase 1 owner gap is closed — the secured
 * owner command records the mandatory §7.3 reason durably, so the create
 * capability is exposed through the S6A surface (see
 * `apps/api/src/admin-package-ops/admin-package-ops.module.ts`). The
 * blocked-constant is removed; the create form is gated by the
 * SUPER_ADMIN permission AND the sensitive-write environment.
 */

export interface PackagePageErrorCopy {
  title: string;
  description: string;
}

export function describePackageReadError(error: unknown): PackagePageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include the required package permission for this market.',
        };
      case 'MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load package configuration.',
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
            'Your administrator account does not have access to this market.',
        };
      case 'MFA_STEP_UP_REQUIRED':
        return {
          title: 'Verification required',
          description:
            'Verify your identity again to view special percentages.',
        };
      case 'NETWORK_OFFLINE':
        return {
          title: 'You are offline',
          description:
            'Package configuration needs a connection. Check your network and retry.',
        };
    }
  }
  return {
    title: 'Package configuration unavailable',
    description:
      'The package configuration could not be loaded. Retry, or try again later.',
  };
}

/** Server rule for the rate input: decimal string, >0 and <=100 (D-010). */
export function packageRateValid(rate: string): boolean {
  const trimmed = rate.trim();
  if (!/^\d{1,3}(?:\.\d{1,6})?$/u.test(trimmed)) return false;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return scaled > 0n && scaled <= 100_000_000n;
}

/** Effective-window validity: end, when present, must be after start. */
export function packageWindowValid(
  effectiveFrom: string,
  effectiveTo: string,
): boolean {
  const from = Date.parse(effectiveFrom);
  if (!effectiveTo) return !Number.isNaN(from);
  const to = Date.parse(effectiveTo);
  return !Number.isNaN(from) && !Number.isNaN(to) && to > from;
}

/** Version is actionable (can be activated) only in DRAFT or SCHEDULED. */
export function versionActivateable(
  version: Pick<AdminPackageVersionDto, 'status'>,
): boolean {
  return version.status === 'DRAFT' || version.status === 'SCHEDULED';
}

/**
 * Write-error copy for the special-percentage create form (D-051
 * contract). Maps the server codes the S6A surface returns: 403
 * permission/step-up, 400 validation/idempotency-key, 409 market /
 * idempotency conflicts, and the generic offline/unknown fallback.
 */
export function describeSpecialPercentageWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT':
        return 'The request was retried with a different payload. Refresh and retry.';
      case 'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH':
      case 'MARKET_CONTEXT_MISMATCH':
        return 'The selected market changed. Refresh and retry.';
      case 'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED':
      case 'MARKET_SELECTION_REQUIRED':
        return 'Select an authorized market from the top bar first.';
      case 'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED':
      case 'MARKET_ACCESS_DENIED':
        return 'Your administrator account does not have access to this market.';
      case 'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND':
        return 'The selected market does not exist or is not active.';
      case 'SPECIAL_PERCENTAGE_REASON_REQUIRED':
        return 'A reason of 1 to 500 characters is required for this privileged action.';
      case 'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED':
        return 'A valid Idempotency-Key header is required. Refresh and retry.';
      case 'SPECIAL_PERCENTAGE_PERMISSION_DENIED':
      case 'PERMISSION_DENIED':
        return 'The server denied this action: the special-package permission is SUPER_ADMIN only.';
      case 'MFA_STEP_UP_REQUIRED':
        return 'Verify your identity again to create special percentages.';
      case 'VALIDATION_ERROR':
        return 'Check the highlighted information: rate must be an exact decimal >0% and ≤100% (max 6 decimals), description and reason are required.';
      case 'NETWORK_OFFLINE':
        return 'You are offline. Retry when connected.';
    }
  }
  return 'The action could not be completed. Retry, or try again later.';
}
