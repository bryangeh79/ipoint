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

/** UI affordance only — the server enforces the SUPER_ADMIN-only gate. */
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
 * P7-S6A owner-gap constant: the frozen Phase 1 owner command cannot record
 * the mandatory §7.3 reason for special-percentage creation, so the create
 * capability stays explicitly unavailable (see
 * `apps/api/src/admin-package-ops/admin-package-ops.module.ts`).
 */
export const SPECIAL_PERCENTAGE_CREATE_BLOCKED = {
  capability: 'merchant.special_package.create',
  blockedPrerequisite: 'P1-OWNER-GAP-MANDATORY-REASON',
  summary:
    'Creating special percentages is not available yet: the frozen Phase 1 owner command cannot record the mandatory reason the §7.3 contract requires. New special percentages stay read-only here until the owner command is remediated.',
} as const;

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
