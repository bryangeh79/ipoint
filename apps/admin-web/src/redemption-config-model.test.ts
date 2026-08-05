import { describe, expect, it } from 'vitest';
import { ApiError } from '@ipoint/api-client';
import {
  canManageRedemptionRates,
  canViewRedemptionRates,
  describeRedemptionReadError,
  describeRedemptionWriteError,
  formatRedemptionWindow,
  marketLocalTomorrow,
  redemptionCancellable,
  redemptionEffectiveDateFuture,
  redemptionRateGrammarValid,
  redemptionRateWithinBounds,
  redemptionWindowStatusLabel,
  resolveLocalMidnightUtc,
} from './redemption-config-model.js';

/**
 * P7-S6C redemption-configuration model unit tests (frozen contract §7.2).
 *
 * Pure presentation-model coverage: the exact-decimal grammar (≤10
 * technical decimals), the per-market bounds check against the
 * server-provided approved configuration (never hard-coded), the
 * market-local date validity, the market-local midnight → UTC display
 * helper, the window copy and the permission affordances. No numeric
 * parsing of rates ever happens client-side.
 */

describe('redemption rate grammar (§7.2 technical precision)', () => {
  it('accepts up to ten decimals', () => {
    expect(redemptionRateGrammarValid('1')).toBe(true);
    expect(redemptionRateGrammarValid('1.5')).toBe(true);
    expect(redemptionRateGrammarValid('1.1234567890')).toBe(true);
    expect(redemptionRateGrammarValid('0.5000000000')).toBe(true);
    expect(redemptionRateGrammarValid('2.0000000000')).toBe(true);
  });

  it('rejects eleven decimals and malformed input', () => {
    expect(redemptionRateGrammarValid('1.12345678901')).toBe(false);
    expect(redemptionRateGrammarValid('1.')).toBe(false);
    expect(redemptionRateGrammarValid('.5')).toBe(false);
    expect(redemptionRateGrammarValid('-1')).toBe(false);
    expect(redemptionRateGrammarValid('1,5')).toBe(false);
    expect(redemptionRateGrammarValid('')).toBe(false);
  });
});

describe('per-market bounds check (server-provided configuration)', () => {
  it('accepts the Malaysia bounds exactly at 0.50 / 1.00 / 2.00', () => {
    expect(redemptionRateWithinBounds('0.5000000000', '0.5', '2')).toBe(true);
    expect(redemptionRateWithinBounds('1.0000000000', '0.5', '2')).toBe(true);
    expect(redemptionRateWithinBounds('2.0000000000', '0.5', '2')).toBe(true);
    expect(redemptionRateWithinBounds('1.1234567890', '0.5', '2')).toBe(true);
  });

  it('rejects below the minimum and above the maximum', () => {
    expect(redemptionRateWithinBounds('0.49', '0.5', '2')).toBe(false);
    expect(redemptionRateWithinBounds('0.4999999999', '0.5', '2')).toBe(false);
    expect(redemptionRateWithinBounds('2.01', '0.5', '2')).toBe(false);
    expect(redemptionRateWithinBounds('2.0000000001', '0.5', '2')).toBe(false);
  });

  it('uses exact-decimal comparison (0.5000000000 ≥ 0.5, 2.0000000000 ≤ 2)', () => {
    // The boundaries are compared at the 10^10 scale — a value with more
    // digits than the bound string never suffers float drift.
    expect(redemptionRateWithinBounds('0.5000000000', '0.5', '2')).toBe(true);
    expect(redemptionRateWithinBounds('2', '0.5', '2')).toBe(true);
    expect(
      redemptionRateWithinBounds('1.1234567890', '0.5', '2.0000000000'),
    ).toBe(true);
  });
});

describe('market-local dates and midnight resolution', () => {
  it('accepts strictly future dates and rejects today/past', () => {
    const tomorrow = marketLocalTomorrow('Asia/Kuala_Lumpur');
    expect(redemptionEffectiveDateFuture(tomorrow, 'Asia/Kuala_Lumpur')).toBe(
      true,
    );
    expect(
      redemptionEffectiveDateFuture('2020-01-01', 'Asia/Kuala_Lumpur'),
    ).toBe(false);
    expect(
      redemptionEffectiveDateFuture('not-a-date', 'Asia/Kuala_Lumpur'),
    ).toBe(false);
  });

  it('resolves market-local midnight to UTC for display (UTC+8)', () => {
    const midnight = resolveLocalMidnightUtc('2026-09-01', 'Asia/Kuala_Lumpur');
    expect(midnight?.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });
});

describe('window copy and permission affordances', () => {
  it('labels the window statuses', () => {
    expect(redemptionWindowStatusLabel('ACTIVE')).toBe('Active');
    expect(redemptionWindowStatusLabel('SCHEDULED')).toBe('Scheduled');
    expect(redemptionWindowStatusLabel('SUPERSEDED')).toBe('Superseded');
    expect(redemptionWindowStatusLabel('EXPIRED')).toBe('Expired');
    expect(redemptionWindowStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(redemptionWindowStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('only SCHEDULED versions are cancellable (D-053 §9 affordance)', () => {
    expect(redemptionCancellable({ window_status: 'SCHEDULED' })).toBe(true);
    expect(redemptionCancellable({ window_status: 'ACTIVE' })).toBe(false);
    expect(redemptionCancellable({ window_status: 'EXPIRED' })).toBe(false);
    expect(redemptionCancellable({ window_status: 'SUPERSEDED' })).toBe(false);
    expect(redemptionCancellable({ window_status: 'CANCELLED' })).toBe(false);
  });

  it('formats open and closed windows from exact server strings', () => {
    expect(
      formatRedemptionWindow({
        effective_from_local: '2026-09-01 00:00:00',
        effective_until_local: null,
      }),
    ).toBe('2026-09-01 00:00:00 → open');
    expect(
      formatRedemptionWindow({
        effective_from_local: '2026-01-01 08:00:00',
        effective_until_local: '2026-09-01 00:00:00',
      }),
    ).toBe('2026-01-01 08:00:00 → 2026-09-01 00:00:00');
  });

  it('gates the UI affordances on the canonical permissions only', () => {
    expect(canViewRedemptionRates(['redemption.rate.read'])).toBe(true);
    expect(canViewRedemptionRates(['dashboard.view'])).toBe(false);
    expect(canManageRedemptionRates(['redemption.rate.manage'])).toBe(true);
    expect(canManageRedemptionRates(['redemption.rate.read'])).toBe(false);
    expect(canManageRedemptionRates(['SUPER_ADMIN'])).toBe(false);
  });

  it('describes read and write errors with stable copy', () => {
    expect(
      describeRedemptionReadError(
        new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }),
      ).title,
    ).toBe('Market context changed');
    expect(
      describeRedemptionWriteError(
        new ApiError(422, { code: 'REDEMPTION_RATE_BELOW_MINIMUM' }),
      ),
    ).toContain('below the approved minimum');
    expect(
      describeRedemptionWriteError(
        new ApiError(422, { code: 'REDEMPTION_RATE_MARKET_BLOCKED' }),
      ),
    ).toContain('no approved redemption rate configuration');
    expect(
      describeRedemptionWriteError(
        new ApiError(409, { code: 'REDEMPTION_RATE_OVERLAP' }),
      ),
    ).toContain('immutable');
    expect(
      describeRedemptionWriteError(
        new ApiError(409, { code: 'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE' }),
      ),
    ).toContain('not-yet-effective');
    expect(
      describeRedemptionWriteError(
        new ApiError(409, { code: 'REDEMPTION_RATE_ALREADY_CANCELLED' }),
      ),
    ).toContain('already been cancelled');
    expect(
      describeRedemptionWriteError(
        new ApiError(404, { code: 'REDEMPTION_RATE_VERSION_NOT_FOUND' }),
      ),
    ).toContain('was not found');
  });
});
