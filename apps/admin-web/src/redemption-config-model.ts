import {
  ApiError,
  type AdminRedemptionRateVersionDto,
} from '@ipoint/api-client';

/**
 * P7-S6C Admin Redemption Rate Configuration — pure presentation model.
 *
 * Formatting-only helpers: no client arithmetic on rates, no status
 * derivation, no invented rules. Every status/value displayed comes from
 * the Phase 7 adapter (`apps/api/src/admin-redemption-ops`) responses as
 * returned. Rates are exact decimal strings (local currency per 1 iPoint,
 * at most ten technical decimals, §7.2 Malaysia bounds 0.50–2.00) and are
 * never parsed or reformatted numerically. The ≤6-decimal display value is
 * server-derived (`display_rate`) and display-only.
 */

export const redemptionWindowStatusLabels: Readonly<Record<string, string>> = {
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  SUPERSEDED: 'Superseded',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

export function redemptionWindowStatusLabel(status: string): string {
  return redemptionWindowStatusLabels[status] ?? status;
}

/**
 * Server rule for the rate input: exact decimal string with at most ten
 * decimals (mirrors the §7.2 technical ceiling). Bounds checks against the
 * approved per-market minimum/maximum are separate so the specific
 * message can be shown.
 */
export function redemptionRateGrammarValid(rate: string): boolean {
  return /^\d+(?:\.\d{1,10})?$/u.test(rate.trim());
}

/**
 * §7.2 per-market bound check: `minimum ≤ rate ≤ maximum`. Exact-decimal
 * comparison only (scale 10^10) — never float arithmetic. The bounds come
 * from the server-provided approved configuration (versioned per-market
 * rules) — never hard-coded client-side.
 */
export function redemptionRateWithinBounds(
  rate: string,
  minimumRate: string,
  maximumRate: string,
): boolean {
  if (!redemptionRateGrammarValid(rate)) return false;
  return (
    scaledRate(rate) >= scaledRate(minimumRate) &&
    scaledRate(rate) <= scaledRate(maximumRate)
  );
}

/** Scale an exact decimal string to 10^10 integer units (string math). */
function scaledRate(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return (
    BigInt(whole) * 10_000_000_000n + BigInt(fraction.padEnd(10, '0') || '0')
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
export function redemptionEffectiveDateFuture(
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
export function formatRedemptionUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}

/** Sort the versions newest-first for display (server order is authority). */
export function orderRedemptionRates<T extends { effective_from_utc: string }>(
  rates: ReadonlyArray<T>,
): T[] {
  return [...rates].sort(
    (left, right) =>
      Date.parse(right.effective_from_utc) -
      Date.parse(left.effective_from_utc),
  );
}

/** UI affordance only — the server enforces permission and market. */
export function canViewRedemptionRates(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('redemption.rate.read');
}

/** UI affordance only — the server enforces permission and market. */
export function canManageRedemptionRates(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('redemption.rate.manage');
}

/**
 * Only a future scheduled, not-yet-effective version is cancellable
 * (D-053 §9). UI affordance only — the server re-checks cancellability
 * (active/expired/historically-used versions are rejected with 409).
 */
export function redemptionCancellable(rate: {
  window_status: string;
}): boolean {
  return rate.window_status === 'SCHEDULED';
}

export interface RedemptionPageErrorCopy {
  title: string;
  description: string;
}

export function describeRedemptionReadError(
  error: unknown,
): RedemptionPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include the redemption.rate.read permission for this market.',
        };
      case 'MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load redemption rate configuration.',
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
      case 'NETWORK_OFFLINE':
        return {
          title: 'You are offline',
          description:
            'Redemption rate configuration needs a connection. Check your network and retry.',
        };
    }
  }
  return {
    title: 'Redemption rate configuration unavailable',
    description:
      'The redemption rate configuration could not be loaded. Retry, or try again later.',
  };
}

export function describeRedemptionWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'REDEMPTION_RATE_MARKET_BLOCKED':
        return 'This market has no approved redemption rate configuration yet (Initial, Minimum, Maximum, Currency and Display Unit must be approved).';
      case 'REDEMPTION_RATE_BELOW_MINIMUM':
        return 'The redemption rate is below the approved minimum for this market.';
      case 'REDEMPTION_RATE_ABOVE_MAXIMUM':
        return 'The redemption rate is above the approved maximum for this market.';
      case 'REDEMPTION_RATE_PRECISION_EXCEEDED':
        return 'The redemption rate supports at most 10 decimal places.';
      case 'REDEMPTION_ACTIVATION_NOT_FUTURE':
        return 'Redemption rates activate only at a future market-local 00:00.';
      case 'REDEMPTION_RATE_OVERLAP':
        return 'A redemption rate version already exists for this market. Versions are immutable and overlap is prevented.';
      case 'REDEMPTION_IDEMPOTENCY_CONFLICT':
        return 'The request was retried with a different payload. Refresh and retry.';
      case 'REDEMPTION_MARKET_NOT_FOUND':
        return 'The market was not found.';
      case 'REDEMPTION_RATE_VERSION_NOT_FOUND':
        return 'The redemption rate version was not found.';
      case 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE':
        return 'Only a scheduled, not-yet-effective redemption rate version can be cancelled.';
      case 'REDEMPTION_RATE_ALREADY_CANCELLED':
        return 'This redemption rate version has already been cancelled.';
      case 'IDEMPOTENCY_KEY_REQUIRED':
        return 'A valid Idempotency-Key header is required.';
      case 'PERMISSION_DENIED':
        return 'The server denied this action.';
      case 'NETWORK_OFFLINE':
        return 'You are offline. Retry when connected.';
    }
  }
  return 'The action could not be completed. Retry, or try again later.';
}

/** Window cell copy — exact server strings, no client derivation. */
export function formatRedemptionWindow(
  rate: Pick<
    AdminRedemptionRateVersionDto,
    'effective_from_local' | 'effective_until_local'
  >,
): string {
  if (!rate.effective_until_local) {
    return `${rate.effective_from_local} → open`;
  }
  return `${rate.effective_from_local} → ${rate.effective_until_local}`;
}
