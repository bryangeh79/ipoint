import {
  ApiError,
  type AdminCommissionRateVersionDto,
  type AdminCommissionTaxonomyEntryDto,
} from '@ipoint/api-client';

/**
 * P7-S6D Admin Commission Rate Configuration — pure presentation model.
 *
 * Formatting-only helpers: no client arithmetic on rates beyond the
 * display grammar, no status derivation, no invented rules. Every
 * status/value displayed comes from the Phase 7 adapter
 * (`apps/api/src/admin-commission-ops`) responses as returned. Rates are
 * exact decimal strings (FIXED = market currency amounts, PERCENTAGE =
 * percent, at most ten technical decimals, D-054 §7) and are never parsed
 * or reformatted numerically. The ≤6-decimal display value is
 * server-derived (`display_rate`) and display-only. The frozen taxonomy
 * (commission types × generations × rate types) is taken from the server
 * read response — never hard-coded client-side.
 */

export const commissionWindowStatusLabels: Readonly<Record<string, string>> = {
  ACTIVE: 'Active',
  SCHEDULED: 'Scheduled',
  SUPERSEDED: 'Superseded',
  EXPIRED: 'Expired',
};

export function commissionWindowStatusLabel(status: string): string {
  return commissionWindowStatusLabels[status] ?? status;
}

/**
 * Server rule for the rate input: exact decimal string with at most ten
 * decimals (mirrors the D-054 §7 technical ceiling). The percentage cap
 * (≤100%) and the frozen taxonomy match are the owner's enforcement and
 * are surfaced from the server rejections.
 */
export function commissionRateGrammarValid(rate: string): boolean {
  return /^\d+(?:\.\d{1,10})?$/u.test(rate.trim());
}

/**
 * Percentage ≤ 100% check (UI affordance; the owner enforces the cap).
 * Exact-decimal comparison only — never float arithmetic.
 */
export function commissionPercentageWithinLimit(rate: string): boolean {
  if (!commissionRateGrammarValid(rate)) return false;
  const [whole = '0', fraction = ''] = rate.trim().split('.');
  const scaled =
    BigInt(whole) * 10_000_000_000n + BigInt(fraction.padEnd(10, '0') || '0');
  return scaled <= 1_000_000_000_000n; // 100.0000000000
}

/** Frozen rate type for a commission type (server taxonomy authority). */
export function commissionRateTypeFor(
  commissionType: string,
  taxonomy: ReadonlyArray<AdminCommissionTaxonomyEntryDto>,
): string | undefined {
  return taxonomy.find((entry) => entry.commission_type === commissionType)
    ?.rate_type;
}

/** Allowed generations for a commission type (server taxonomy authority). */
export function commissionGenerationsFor(
  commissionType: string,
  taxonomy: ReadonlyArray<AdminCommissionTaxonomyEntryDto>,
): number[] {
  return (
    taxonomy.find((entry) => entry.commission_type === commissionType)
      ?.generations ?? []
  );
}

/** Market-local "today" for the given IANA timezone, as a YYYY-MM-DD string. */
export function marketLocalToday(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
}

/**
 * Market-local "tomorrow" (strictly-future minimum for the date picker).
 * Approximated by probing noon UTC of the next calendar day in the zone;
 * the server is the authority on activation dates.
 */
export function marketLocalTomorrow(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(map.get('year') ?? '0');
  const month = Number(map.get('month') ?? '0');
  const day = Number(map.get('day') ?? '0');
  const probe = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0, 0));
  const tomorrow = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(probe);
  const map2 = new Map(tomorrow.map((part) => [part.type, part.value]));
  return `${map2.get('year')}-${map2.get('month')}-${map2.get('day')}`;
}

/** The date must be strictly after today in the market's local calendar. */
export function commissionEffectiveDateFuture(
  dateStr: string,
  timeZone: string,
): boolean {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return false;
  return trimmed > marketLocalToday(timeZone);
}

/**
 * Resolve the UTC instant of the market-local midnight of a calendar date
 * (display helper mirroring the server's resolution; the server result is
 * the authority). Returns null when the zone's wall clock does not land
 * exactly on 00:00 for that date (DST edge).
 */
export function resolveLocalMidnightUtc(
  dateStr: string,
  timeZone: string,
): Date | null {
  const dateParts = dateStr.split('-').map((value) => Number(value));
  const year = dateParts[0] ?? 0;
  const month = dateParts[1] ?? 0;
  const day = dateParts[2] ?? 0;
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  const probeParts = localParts(probe, timeZone);
  const localAsUtc = Date.UTC(
    probeParts.year,
    probeParts.month - 1,
    probeParts.day,
    probeParts.hour,
    probeParts.minute,
    probeParts.second,
  );
  const offsetMs = localAsUtc - probe.getTime();
  const midnight = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs,
  );
  const wall = localParts(midnight, timeZone);
  if (
    wall.year !== year ||
    wall.month !== month ||
    wall.day !== day ||
    wall.hour !== 0 ||
    wall.minute !== 0 ||
    wall.second !== 0
  ) {
    return null;
  }
  return midnight;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(at: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = new Map(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.get('year') ?? '0'),
    month: Number(map.get('month') ?? '0'),
    day: Number(map.get('day') ?? '0'),
    hour: Number(map.get('hour') ?? '0'),
    minute: Number(map.get('minute') ?? '0'),
    second: Number(map.get('second') ?? '0'),
  };
}

/** Format an ISO instant as a stable UTC string for display. */
export function formatCommissionUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}

/** Sort the history newest-first for display (server order is authority). */
export function orderCommissionHistory<
  T extends { effective_from_utc: string },
>(rates: ReadonlyArray<T>): T[] {
  return [...rates].sort(
    (left, right) =>
      Date.parse(right.effective_from_utc) -
      Date.parse(left.effective_from_utc),
  );
}

/** UI affordance only — the server enforces permission and market. */
export function canViewCommissionRates(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('commission.rate.read');
}

/** UI affordance only — the server enforces the SUPER_ADMIN-only gate. */
export function canManageCommissionRates(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('commission.rate.manage');
}

export interface CommissionPageErrorCopy {
  title: string;
  description: string;
}

export function describeCommissionReadError(
  error: unknown,
): CommissionPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
      case 'COMMISSION_RATE_PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include the commission.rate.read permission for this market.',
        };
      case 'MARKET_SELECTION_REQUIRED':
      case 'COMMISSION_RATE_MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load commission rate configuration.',
        };
      case 'MARKET_CONTEXT_MISMATCH':
      case 'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH':
        return {
          title: 'Market context changed',
          description:
            'The selected market changed while loading. Refresh and try again.',
        };
      case 'MARKET_ACCESS_DENIED':
      case 'COMMISSION_RATE_MARKET_ACCESS_DENIED':
        return {
          title: 'Market access denied',
          description:
            'Your administrator account does not have access to this market, or the market is not active.',
        };
      case 'NETWORK_OFFLINE':
        return {
          title: 'You are offline',
          description:
            'Commission rate configuration needs a connection. Check your network and retry.',
        };
    }
  }
  return {
    title: 'Commission rate configuration unavailable',
    description:
      'The commission rate configuration could not be loaded. Retry, or try again later.',
  };
}

export function describeCommissionWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'COMMISSION_RATE_MARKET_NOT_FOUND':
        return 'This market is not active, so commission rates cannot be managed yet.';
      case 'RATE_TYPE_MISMATCH':
        return 'The rate type does not match the frozen commission-type contract for the selected type.';
      case 'INVALID_GENERATION':
        return 'The generation is not valid for the selected commission type.';
      case 'COMMISSION_RATE_PERCENTAGE_LIMIT':
        return 'A percentage rate cannot exceed 100%.';
      case 'COMMISSION_RATE_PRECISION_EXCEEDED':
        return 'The rate supports at most 10 decimal places.';
      case 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE':
        return 'Commission rates activate only at a future market-local 00:00.';
      case 'OVERLAPPING_RATE_PERIOD':
        return 'A rate version already exists for this commission type and generation in this market. Versions are immutable and overlap is prevented.';
      case 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT':
        return 'The request was retried with a different payload. Refresh and retry.';
      case 'COMMISSION_RATE_REASON_REQUIRED':
        return 'A reason between 1 and 500 characters is required.';
      case 'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED':
        return 'A valid Idempotency-Key header is required.';
      case 'COMMISSION_RATE_PERMISSION_DENIED':
      case 'PERMISSION_DENIED':
        return 'The server denied this action.';
      case 'MARKET_ACCESS_DENIED':
      case 'COMMISSION_RATE_MARKET_ACCESS_DENIED':
        return 'The administrator does not have access to this market.';
      case 'MARKET_CONTEXT_MISMATCH':
      case 'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH':
        return 'The selected market changed. Refresh and retry.';
      case 'NETWORK_OFFLINE':
        return 'You are offline. Retry when connected.';
    }
  }
  return 'The action could not be completed. Retry, or try again later.';
}

/** Window cell copy — exact server strings, no client derivation. */
export function formatCommissionWindow(
  rate: Pick<
    AdminCommissionRateVersionDto,
    'effective_from_local' | 'effective_until_local'
  >,
): string {
  if (!rate.effective_until_local) {
    return `${rate.effective_from_local} → open`;
  }
  return `${rate.effective_from_local} → ${rate.effective_until_local}`;
}
