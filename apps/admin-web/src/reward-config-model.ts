import { ApiError, type AdminRewardRuleVersionDto } from '@ipoint/api-client';

/**
 * P7-S6B Admin Reward Configuration — pure presentation model.
 *
 * Formatting-only helpers: no client arithmetic on rates, no status
 * derivation, no invented rules. Every status/value displayed comes from
 * the Phase 7 adapter (`apps/api/src/admin-reward-ops`) responses as
 * returned. Rates are exact decimal strings in `%/day` (0%–0.05%/day,
 * at most six decimals, package A–F maxima) and are never parsed or
 * reformatted numerically.
 */

export const rewardWindowStatusLabels: Readonly<Record<string, string>> = {
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  SUPERSEDED: 'Superseded',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
};

export function rewardWindowStatusLabel(status: string): string {
  return rewardWindowStatusLabels[status] ?? status;
}

/** The locked §7.1 package identities (D-046 domain fact, A–F). */
export const rewardPackageCodes: ReadonlyArray<string> = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
];

/**
 * Server rule for the rate input: exact decimal string with at most six
 * decimals (mirrors the transport grammar). Boundary checks against the
 * §7.1 governance ceiling and the package maxima are separate so the
 * package-specific message can be shown.
 */
export function rewardRateGrammarValid(rate: string): boolean {
  return /^\d+(?:\.\d{1,6})?$/u.test(rate.trim());
}

/**
 * §7.1 governance ceiling check: 0%–0.05%/day (50_000 scaled units at
 * 10^6). Exact-decimal comparison only — never float arithmetic.
 */
export function rewardRateWithinGovernance(rate: string): boolean {
  const trimmed = rate.trim();
  if (!rewardRateGrammarValid(trimmed)) return false;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return scaled <= 50_000n;
}

/**
 * §7.1 package-maximum check (A 0.0125, B 0.025, C–F 0.05 %/day).
 * Exact-decimal comparison against the adapter-provided max string.
 */
export function rewardRateWithinPackageMax(
  rate: string,
  maxRatePerDay: string,
): boolean {
  if (!rewardRateGrammarValid(rate)) return false;
  const [whole = '0', fraction = ''] = rate.trim().split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  const [maxWhole = '0', maxFraction = ''] = maxRatePerDay.trim().split('.');
  const maxScaled =
    BigInt(maxWhole) * 1_000_000n + BigInt(maxFraction.padEnd(6, '0'));
  return scaled <= maxScaled;
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
export function rewardEffectiveDateFuture(
  dateStr: string,
  timeZone: string,
): boolean {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return false;
  return trimmed > marketLocalToday(timeZone);
}

/**
 * Resolve the UTC instant of the market-local midnight of a calendar date
 * (display helper mirroring the server's `resolveLocalMidnight`; the
 * server result is the authority). Returns null when the zone's wall clock
 * does not land exactly on 00:00 for that date (DST edge).
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
export function formatRewardUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString();
}

/** Sort the schedule newest-first for display (server order is authority). */
export function orderRewardRules<T extends { effective_from_utc: string }>(
  rules: ReadonlyArray<T>,
): T[] {
  return [...rules].sort(
    (left, right) =>
      Date.parse(right.effective_from_utc) -
      Date.parse(left.effective_from_utc),
  );
}

/** UI affordance only — the server enforces permission and market. */
export function canViewRewardRules(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('reward.rule.read');
}

/** UI affordance only — the server enforces the SUPER_ADMIN-only gate. */
export function canScheduleRewardRules(
  effectivePermissions: ReadonlyArray<string>,
): boolean {
  return effectivePermissions.includes('reward.rule.schedule');
}

export interface RewardPageErrorCopy {
  title: string;
  description: string;
}

export function describeRewardReadError(error: unknown): RewardPageErrorCopy {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'PERMISSION_DENIED':
        return {
          title: 'Permission denied',
          description:
            'Your server permissions do not include the reward.rule.read permission for this market.',
        };
      case 'MARKET_SELECTION_REQUIRED':
        return {
          title: 'No Current Admin Market selected',
          description:
            'Select an authorized market from the top bar to load reward configuration.',
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
            'Reward configuration needs a connection. Check your network and retry.',
        };
    }
  }
  return {
    title: 'Reward configuration unavailable',
    description:
      'The reward configuration could not be loaded. Retry, or try again later.',
  };
}

export function describeRewardWriteError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.body.code) {
      case 'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT':
        return 'A reward rate above 0.05% per day requires a new governance decision.';
      case 'REWARD_RATE_EXCEEDS_PACKAGE_MAX':
        return 'The reward rate exceeds the maximum for the selected package.';
      case 'REWARD_ACTIVATION_NOT_FUTURE':
        return 'Reward rates activate only at a future market-local 00:00.';
      case 'REWARD_EFFECTIVE_WINDOW_OVERLAP':
        return 'The effective window overlaps another reward rule version for this market.';
      case 'REWARD_IDEMPOTENCY_CONFLICT':
        return 'The request was retried with a different payload. Refresh and retry.';
      case 'REWARD_MARKET_NOT_FOUND':
        return 'The market was not found.';
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
export function formatRewardWindow(
  rule: Pick<
    AdminRewardRuleVersionDto,
    'effective_from_local' | 'effective_until_local'
  >,
): string {
  if (!rule.effective_until_local) {
    return `${rule.effective_from_local} → open`;
  }
  return `${rule.effective_from_local} → ${rule.effective_until_local}`;
}
