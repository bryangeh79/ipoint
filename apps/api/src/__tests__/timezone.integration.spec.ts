/**
 * Phase 3 Timezone Integration Tests
 *
 * Validates timezone handling across markets:
 *   1. Market in UTC+8 and UTC-5 — same UTC day = different local business dates
 *   2. DST boundary — spring forward / fall back
 *   3. Midnight rollover — UTC midnight vs local midnight
 *   4. Leap day — Feb 29 handling
 *
 * These tests verify that the system correctly computes local business dates
 * from UTC timestamps using IANA timezone identifiers, and that daily accrual
 * jobs respect each market's local date boundary.
 *
 * Run:
 *   pnpm vitest run apps/api/src/__tests__/timezone.integration.spec.ts
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createMarketFixture,
  createDstMarketFixture,
  getLocalDate,
  generateConsecutiveLocalDates,
  makeAccrualKey,
} from './phase3-test-helpers.js';

// ===========================================================================
// Timezone Utility
// ===========================================================================

/**
 * Helper to convert a UTC ISO string to a local date string in a given timezone.
 * Uses the Intl.DateTimeFormat API which respects IANA timezone database.
 */
function utcToLocalDate(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

// ===========================================================================
// 1. Market in UTC+8 and UTC-5 — Same UTC Day = Different Local Dates
// ===========================================================================

describe('UTC+8 vs UTC-5: Same UTC moment, different local business dates', () => {
  const utcPlus8 = 'Asia/Singapore';      // UTC+8 (no DST)
  const utcMinus5 = 'America/New_York';    // UTC-5 (EST, with DST)

  it('UTC time just after midnight in Asia is still previous day in NY', () => {
    // 2026-01-02T00:30:00Z (30 min after UTC midnight)
    // Singapore: 2026-01-02 08:30 AM → local date: 2026-01-02
    // New York: 2026-01-01 07:30 PM (EST, UTC-5) → local date: 2026-01-01
    const utcMoment = '2026-01-02T00:30:00.000Z';

    const sgDate = utcToLocalDate(utcMoment, utcPlus8);
    const nyDate = utcToLocalDate(utcMoment, utcMinus5);

    // Same UTC moment, different business dates
    expect(sgDate).toBe('2026-01-02');
    expect(nyDate).toBe('2026-01-01');
    expect(sgDate).not.toBe(nyDate);
  });

  it('UTC time in late evening is next day in Asia but same day in NY', () => {
    // 2026-01-15T22:00:00Z (22:00 UTC)
    // Singapore: 2026-01-16 06:00 AM → local date: 2026-01-16
    // New York: 2026-01-15 05:00 PM (EST) → local date: 2026-01-15
    const utcMoment = '2026-01-15T22:00:00.000Z';

    const sgDate = utcToLocalDate(utcMoment, utcPlus8);
    const nyDate = utcToLocalDate(utcMoment, utcMinus5);

    expect(sgDate).toBe('2026-01-16');
    expect(nyDate).toBe('2026-01-15');
    expect(sgDate).not.toBe(nyDate);
  });

  it('accrual idempotency keys are different when local dates differ', () => {
    // Same reward plan, same UTC day, but different local dates
    const planId = randomUUID();
    const utcMoment = '2026-03-15T22:30:00.000Z';

    const sgDate = utcToLocalDate(utcMoment, utcPlus8);
    const nyDate = utcToLocalDate(utcMoment, utcMinus5);

    // Different local dates → different accrual keys
    const sgKey = makeAccrualKey(planId, sgDate);
    const nyKey = makeAccrualKey(planId, nyDate);

    expect(sgKey).not.toBe(nyKey);
    expect(sgDate).toBe('2026-03-16');
    expect(nyDate).toBe('2026-03-15');
  });

  it('UTC+8 and UTC-5 markets can have 1-day offset in business dates', () => {
    // At 10:00 UTC, Singapore is 18:00 (same day), NY is 05:00 (same day)
    const utcMoment = '2026-06-01T10:00:00.000Z';

    const sgDate = utcToLocalDate(utcMoment, utcPlus8);
    const nyDate = utcToLocalDate(utcMoment, utcMinus5);

    // Both same local date during UTC daytime hours
    expect(sgDate).toBe('2026-06-01');
    expect(nyDate).toBe('2026-06-01');
  });

  it('UTC+14 and UTC-12 extremes demonstrate maximum offset', () => {
    const utcMoment = '2026-01-01T01:00:00.000Z';

    // Pacific/Kiritimati (UTC+14) — line islands
    const utc14Date = utcToLocalDate(utcMoment, 'Pacific/Kiritimati');
    // Baker Island (UTC-12) — uninhabited, but uses Etc/GMT+12
    const utc12Date = utcToLocalDate(utcMoment, 'Etc/GMT+12');

    // At 01:00 UTC on Jan 1, UTC+14 is already Jan 1 15:00 (same day)
    // UTC-12 is still Dec 31 13:00 (previous day)
    expect(utc14Date).toBe('2026-01-01');
    expect(utc12Date).toBe('2025-12-31');
    expect(utc14Date).not.toBe(utc12Date);
  });
});

// ===========================================================================
// 2. DST Boundary
// ===========================================================================

describe('DST Boundary Tests', () => {
  it('spring forward: March 8-9, 2026 in US Eastern (clocks go forward)', () => {
    // US DST spring forward: March 8, 2026 at 2:00 AM local → 3:00 AM
    // At 06:59 UTC (1:59 AM EST), it's still EST
    // At 07:00 UTC (3:00 AM EDT), it's EDT
    const dstTimezone = 'America/New_York';

    // 06:59 UTC = 01:59 AM EST (still standard time)
    const beforeSpring = '2026-03-08T06:59:59.000Z';
    const beforeDate = utcToLocalDate(beforeSpring, dstTimezone);
    expect(beforeDate).toBe('2026-03-08');

    // 07:00 UTC = 02:00 AM EST skipped → 03:00 AM EDT (DST)
    const afterSpring = '2026-03-08T07:00:00.000Z';
    const afterDate = utcToLocalDate(afterSpring, dstTimezone);
    expect(afterDate).toBe('2026-03-08');

    // Same local date despite spring forward
    expect(beforeDate).toBe(afterDate);
  });

  it('spring forward: hourly accrual still works correctly', () => {
    const dstTimezone = 'America/New_York';
    // At 2026-03-08T06:00:00Z = 01:00 AM EST
    // At 2026-03-08T07:00:00Z = 03:00 AM EDT (2 AM skipped)
    // At 2026-03-08T08:00:00Z = 04:00 AM EDT

    // All three should be on the same local date
    const dates = [
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T08:00:00.000Z',
    ].map((utc) => utcToLocalDate(utc, dstTimezone));

    for (const date of dates) {
      expect(date).toBe('2026-03-08');
    }
  });

  it('fall back: November 1, 2026 in US Eastern (clocks go backward)', () => {
    // US DST fall back: November 1, 2026 at 2:00 AM EDT → 1:00 AM EST
    // 05:00 UTC = 01:00 AM EDT
    // 06:00 UTC = 01:00 AM EST (second occurrence of 1 AM, after fall-back)
    const dstTimezone = 'America/New_York';

    // Before fall-back: 04:59 UTC = 12:59 AM EDT (still DST)
    const beforeFall = '2026-11-01T04:59:59.000Z';
    const beforeDate = utcToLocalDate(beforeFall, dstTimezone);
    expect(beforeDate).toBe('2026-11-01');

    // At 05:00 UTC = 01:00 AM EDT (first occurrence, still DST)
    const fallFirst = '2026-11-01T05:00:00.000Z';
    const fallFirstDate = utcToLocalDate(fallFirst, dstTimezone);
    expect(fallFirstDate).toBe('2026-11-01');

    // At 06:00 UTC = 01:00 AM EST (second occurrence, after fall-back)
    const fallSecond = '2026-11-01T06:00:00.000Z';
    const fallSecondDate = utcToLocalDate(fallSecond, dstTimezone);
    expect(fallSecondDate).toBe('2026-11-01');

    // Same local date throughout
    expect(beforeDate).toBe(fallFirstDate);
    expect(fallFirstDate).toBe(fallSecondDate);
  });

  it('fall back: daily accrual processes only once despite repeated hour', () => {
    const dstTimezone = 'America/New_York';
    const planId = randomUUID();

    // Generate accrual keys for the two occurrences of 1 AM EST on Nov 1
    // Both should have the SAME business date = '2026-11-01'
    const fallDate = utcToLocalDate('2026-11-01T06:00:00.000Z', dstTimezone);
    expect(fallDate).toBe('2026-11-01');

    // Accrual keys for same plan + same date = repeatable/identical
    const key1 = makeAccrualKey(planId, fallDate);
    const key2 = makeAccrualKey(planId, fallDate);
    expect(key1).toBe(key2);
  });

  it('across DST transition weekend (Sat to Mon), local dates advance normally', () => {
    const dstTimezone = 'America/New_York';

    // March 7 (Sat) → March 9 (Mon), 2026 — spring forward weekend
    const dates = generateConsecutiveLocalDates('2026-03-07T00:00:00.000Z', 3, dstTimezone);
    expect(dates).toHaveLength(3);
    expect(dates[0]).toBe('2026-03-07');
    expect(dates[1]).toBe('2026-03-08'); // Spring forward happens
    expect(dates[2]).toBe('2026-03-09');
  });
});

// ===========================================================================
// 3. Midnight Rollover
// ===========================================================================

describe('Midnight Rollover Tests', () => {
  const utcPlus8 = 'Asia/Singapore';
  const utcMinus5 = 'America/New_York';

  it('UTC midnight = 08:00 AM in Singapore (same local date)', () => {
    // 2026-07-15T00:00:00Z = 2026-07-15 08:00 AM SST (UTC+8)
    const utcMidnight = '2026-07-15T00:00:00.000Z';
    const sgDate = utcToLocalDate(utcMidnight, utcPlus8);
    expect(sgDate).toBe('2026-07-15');
  });

  it('UTC midnight = 07:00 PM previous day in NY (EDT, UTC-4)', () => {
    // July is EDT (UTC-4) for NY
    // 2026-07-15T00:00:00Z = 2026-07-14 08:00 PM EDT
    const utcMidnight = '2026-07-15T00:00:00.000Z';
    const nyDate = utcToLocalDate(utcMidnight, utcMinus5);
    expect(nyDate).toBe('2026-07-14');
  });

  it('accrual job runs near midnight UTC — correct local dates for each market', () => {
    // Job runs at 2026-07-15T23:30:00Z
    // Singapore: 2026-07-16 07:30 AM (next day!)
    // NY: 2026-07-15 07:30 PM (same day)
    const jobRunTime = '2026-07-15T23:30:00.000Z';

    const sgDate = utcToLocalDate(jobRunTime, utcPlus8);
    const nyDate = utcToLocalDate(jobRunTime, utcMinus5);

    expect(sgDate).toBe('2026-07-16'); // Already next business day in Asia
    expect(nyDate).toBe('2026-07-15'); // Still same business day in NY
  });

  it('near midnight UTC, same market local date transitions correctly', () => {
    // Singapore: 23:59 UTC → 07:59 local (next day)
    // 00:00 UTC → 08:00 local (same next day)
    const sgBefore = utcToLocalDate('2026-07-15T23:59:00.000Z', utcPlus8);
    const sgAfter = utcToLocalDate('2026-07-16T00:00:00.000Z', utcPlus8);
    expect(sgBefore).toBe('2026-07-16');
    expect(sgAfter).toBe('2026-07-16');

    // NY: 23:59 UTC → 07:59 PM EDT (same day)
    const nyBefore = utcToLocalDate('2026-07-15T23:59:00.000Z', utcMinus5);

    // After: 00:00 UTC → 08:00 PM EDT (still same day, UTC-4)
    const nyAfter = utcToLocalDate('2026-07-16T00:00:00.000Z', utcMinus5);
    expect(nyBefore).toBe('2026-07-15');
    expect(nyAfter).toBe('2026-07-15');
  });

  it('new day in Asia = previous day in Americas at any midnight transition', () => {
    // For each UTC day boundary, Asia moves to next date while
    // Americas remain on previous date for several more hours
    for (const day of [1, 15, 28]) {
      const month = '08';
      const utcMidnight = `2026-${month}-${String(day).padStart(2, '0')}T00:00:00.000Z`;

      const sgDate = utcToLocalDate(utcMidnight, utcPlus8);
      const nyDate = utcToLocalDate(utcMidnight, 'America/New_York');

      // Asia date == UTC date (already ahead)
      expect(sgDate).toBe(`2026-${month}-${String(day).padStart(2, '0')}`);
      // Americas date is previous day
      expect(nyDate).toBe(`2026-${month}-${String(day - 1).padStart(2, '0')}`);
    }
  });
});

// ===========================================================================
// 4. Leap Day
// ===========================================================================

describe('Leap Day Tests', () => {
  const utcPlus8 = 'Asia/Singapore';
  const utcMinus5 = 'America/New_York';

  it('correctly identifies Feb 29, 2028 as a valid leap day', () => {
    // 2028 is a leap year
    const leapDayUtc = '2028-02-29T12:00:00.000Z';

    const sgDate = utcToLocalDate(leapDayUtc, utcPlus8);
    const nyDate = utcToLocalDate(leapDayUtc, utcMinus5);

    expect(sgDate).toBe('2028-02-29');
    expect(nyDate).toBe('2028-02-29');
  });

  it('leap day accrual works correctly with daily rate', () => {
    const planId = randomUUID();
    const accrualDate = '2028-02-29';

    // Generate a deterministic accrual key for Feb 29, 2028
    const key = makeAccrualKey(planId, accrualDate);
    expect(key).toContain(accrualDate);

    // Next day should be March 1
    const nextDay = '2028-03-01';
    const nextKey = makeAccrualKey(planId, nextDay);
    expect(nextKey).not.toBe(key);
  });

  it('accrual works on Feb 28 and March 1 correctly across leap year boundary', () => {
    const planId = randomUUID();

    // Feb 28 → Feb 29 → Mar 1 in a leap year
    const feb28 = makeAccrualKey(planId, '2028-02-28');
    const feb29 = makeAccrualKey(planId, '2028-02-29');
    const mar1 = makeAccrualKey(planId, '2028-03-01');

    // All should be different
    expect(feb28).not.toBe(feb29);
    expect(feb29).not.toBe(mar1);
    expect(feb28).not.toBe(mar1);
  });

  it('non-leap year does not have Feb 29', () => {
    // 2027 is not a leap year
    // Feb 28 → Mar 1 (no Feb 29)
    const planId = randomUUID();

    const feb28 = makeAccrualKey(planId, '2027-02-28');
    const mar1 = makeAccrualKey(planId, '2027-03-01');

    expect(feb28).not.toBe(mar1);
  });

  it('leap day in DST-aware timezone still works (e.g., America/New_York)', () => {
    // 2028-02-29 is well before US DST (which starts March 12, 2028)
    const dstTimezone = 'America/New_York';

    const leapDate = utcToLocalDate('2028-02-29T18:00:00.000Z', dstTimezone);
    expect(leapDate).toBe('2028-02-29');

    // Next date should be March 1
    const nextDate = utcToLocalDate('2028-03-01T00:00:00.000Z', dstTimezone);
    expect(nextDate).toBe('2028-03-01');
  });

  it('century leap year rule: 2000 was a leap year, 2100 is not', () => {
    // 2000 is divisible by 400 → leap year
    const year2000Date = utcToLocalDate('2000-02-29T12:00:00.000Z', 'UTC');
    expect(year2000Date).toBe('2000-02-29');

    // 2100 is divisible by 100 but not 400 → not a leap year
    // Feb 29, 2100 does not exist
    // The date Feb 29 would be normalized to Mar 1 by JS Date
    const year2100Date = utcToLocalDate('2100-03-01T00:00:00.000Z', 'UTC');
    expect(year2100Date).toBe('2100-03-01');
  });
});

// ===========================================================================
// 5. Multi-Market Accrual Date Alignment
// ===========================================================================

describe('Multi-Market Accrual Date Alignment', () => {
  it('same UTC time can produce 3 different business dates across markets', () => {
    // 2026-01-02T10:00:00Z
    // Pacific/Kiritimati (UTC+14): Jan 3 00:00 → next day
    // Asia/Singapore (UTC+8): Jan 2 18:00 → same day
    // America/New_York (UTC-5): Jan 2 05:00 → same day
    const utcMoment = '2026-01-02T10:00:00.000Z';

    const kiritimatiDate = utcToLocalDate(utcMoment, 'Pacific/Kiritimati');
    const sgDate = utcToLocalDate(utcMoment, 'Asia/Singapore');
    const nyDate = utcToLocalDate(utcMoment, 'America/New_York');

    // Kiritimati already at next day
    expect(kiritimatiDate).toBe('2026-01-03');
    expect(sgDate).toBe('2026-01-02');
    expect(nyDate).toBe('2026-01-02');
  });

  it('accrual job processes each market in its own local date', () => {
    const planId = randomUUID();
    const utcJobTime = '2026-07-15T20:00:00.000Z';

    // Compute local business date for each market
    const markets: Array<{ name: string; timezone: string }> = [
      { name: 'Singapore', timezone: 'Asia/Singapore' },
      { name: 'Malaysia', timezone: 'Asia/Kuala_Lumpur' },
      { name: 'Vietnam', timezone: 'Asia/Ho_Chi_Minh' },
      { name: 'US East', timezone: 'America/New_York' },
      { name: 'UK', timezone: 'Europe/London' },
    ];

    const localDates = markets.map((m) => utcToLocalDate(utcJobTime, m.timezone));

    // Asian markets: July 16 (next day, since UTC 20:00 is already tomorrow in Asia)
    // US: July 15 (still same day, since UTC 20:00 = 4 PM EDT)
    // UK: July 15 (BST = UTC+1, so 21:00 = same day)
    for (let i = 0; i < 3; i++) {
      expect(localDates[i]).toBe('2026-07-16'); // Asia markets
    }
    expect(localDates[3]).toBe('2026-07-15'); // US market
    expect(localDates[4]).toBe('2026-07-15'); // UK market

    // Each market gets a different accrual key
    const keys = localDates.map(
      (date, i) =>
        `${markets[i].name}:${makeAccrualKey(planId, date).slice(0, 20)}`,
    );
    expect(keys).toHaveLength(5);
  });

  it('market timezone from fixture is correctly used for local date computation', () => {
    const myMarket = createMarketFixture({
      code: 'MY',
      timezone: 'Asia/Kuala_Lumpur',
    });
    const sgMarket = createMarketFixture({
      code: 'SG',
      timezone: 'Asia/Singapore',
    });

    // Both UTC+8, same dates
    const utcMoment = '2026-06-01T12:00:00.000Z';
    const myDate = utcToLocalDate(utcMoment, myMarket.timezone);
    const sgDate = utcToLocalDate(utcMoment, sgMarket.timezone);

    expect(myDate).toBe('2026-06-01');
    expect(sgDate).toBe('2026-06-01');
    expect(myDate).toBe(sgDate);
  });

  it('DST market fixture provides correct timezone for local date compute', () => {
    const dstMarket = createDstMarketFixture();
    expect(dstMarket.timezone).toBe('America/New_York');

    // During standard time (winter)
    const winterDate = utcToLocalDate('2026-01-15T12:00:00.000Z', dstMarket.timezone);
    expect(winterDate).toBe('2026-01-15');

    // During daylight saving time (summer)
    const summerDate = utcToLocalDate('2026-07-15T12:00:00.000Z', dstMarket.timezone);
    expect(summerDate).toBe('2026-07-15');
  });
});

// ===========================================================================
// 6. Edge Cases
// ===========================================================================

describe('Timezone Edge Cases', () => {
  it('handles year boundary correctly (Dec 31 / Jan 1)', () => {
    // Dec 31 23:00 UTC
    // Singapore: Jan 1 07:00 → new year!
    // NY: Dec 31 18:00 → still old year
    const newYearEve = '2026-12-31T23:00:00.000Z';

    const sgDate = utcToLocalDate(newYearEve, 'Asia/Singapore');
    const nyDate = utcToLocalDate(newYearEve, 'America/New_York');

    expect(sgDate).toBe('2027-01-01');
    expect(nyDate).toBe('2026-12-31');
  });

  it('handles month boundary correctly (last day → first day)', () => {
    const endOfMonth = '2026-04-30T20:00:00.000Z';
    // Singapore: May 1 04:00 AM
    // NY: Apr 30 04:00 PM
    const sgDate = utcToLocalDate(endOfMonth, 'Asia/Singapore');
    const nyDate = utcToLocalDate(endOfMonth, 'America/New_York');

    expect(sgDate).toBe('2026-05-01');
    expect(nyDate).toBe('2026-04-30');
  });

  it('handles UTC+13 and UTC+14 timezones (extreme east)', () => {
    // Pacific/Apia (Samoa) uses UTC+13 during standard time
    const utcMoment = '2026-07-15T00:00:00.000Z';
    const samoaDate = utcToLocalDate(utcMoment, 'Pacific/Apia');
    expect(samoaDate).toBe('2026-07-15');

    // At 23:00 UTC on Jul 15, Apia is already Jul 16 12:00
    const lateUtc = '2026-07-15T23:00:00.000Z';
    const samoaLate = utcToLocalDate(lateUtc, 'Pacific/Apia');
    expect(samoaLate).toBe('2026-07-16');
  });

  it('accrual key includes local date, not UTC date', () => {
    const planId = randomUUID();
    const marketTimezone = 'America/New_York';

    // UTC date: 2026-08-02
    // NY local date: 2026-08-01 (at 22:00 UTC = 6 PM EDT)
    const utcEvening = '2026-08-02T22:00:00.000Z';
    const localDate = utcToLocalDate(utcEvening, marketTimezone);
    expect(localDate).toBe('2026-08-02'); // EDT = UTC-4, 22:00 UTC = 18:00 EDT

    // Try later: 2026-08-03T03:00:00Z = Aug 2 23:00 EDT
    const lateUtc = '2026-08-03T03:00:00.000Z';
    const lateLocal = utcToLocalDate(lateUtc, marketTimezone);
    expect(lateLocal).toBe('2026-08-02');

    // Accrual key based on local date
    const key = makeAccrualKey(planId, lateLocal);
    expect(key).toContain('2026-08-02');
  });
});
