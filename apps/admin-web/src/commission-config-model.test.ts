import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  canManageCommissionRates,
  canViewCommissionRates,
  commissionEffectiveDateFuture,
  commissionGenerationsFor,
  commissionPercentageWithinLimit,
  commissionRateGrammarValid,
  commissionRateTypeFor,
  commissionWindowStatusLabel,
  describeCommissionReadError,
  describeCommissionWriteError,
  formatCommissionWindow,
  marketLocalTomorrow,
  orderCommissionHistory,
  resolveLocalMidnightUtc,
} from './commission-config-model.js';
import { commissionTaxonomyFixture } from './test/commission-config-fixtures.js';

/**
 * P7-S6D commission-configuration model tests (pure presentation logic).
 */

describe('P7-S6D commission configuration model', () => {
  it('labels the four window statuses with stable copy', () => {
    expect(commissionWindowStatusLabel('ACTIVE')).toBe('Active');
    expect(commissionWindowStatusLabel('SCHEDULED')).toBe('Scheduled');
    expect(commissionWindowStatusLabel('SUPERSEDED')).toBe('Superseded');
    expect(commissionWindowStatusLabel('EXPIRED')).toBe('Expired');
    expect(commissionWindowStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('derives the frozen taxonomy from the server response (never hard-coded)', () => {
    expect(
      commissionRateTypeFor('AGENT_UPGRADE', commissionTaxonomyFixture),
    ).toBe('FIXED');
    expect(
      commissionRateTypeFor('MEMBER_CONSUMPTION', commissionTaxonomyFixture),
    ).toBe('PERCENTAGE');
    expect(
      commissionRateTypeFor('MERCHANT_RECRUITMENT', commissionTaxonomyFixture),
    ).toBe('PERCENTAGE');
    expect(
      commissionRateTypeFor('AGENT_ACTIVATION_FEE', commissionTaxonomyFixture),
    ).toBe('FIXED');
    expect(commissionRateTypeFor('UNKNOWN', commissionTaxonomyFixture)).toBe(
      undefined,
    );
    expect(
      commissionGenerationsFor('AGENT_UPGRADE', commissionTaxonomyFixture),
    ).toEqual([1, 2]);
    expect(
      commissionGenerationsFor(
        'MERCHANT_RECRUITMENT',
        commissionTaxonomyFixture,
      ),
    ).toEqual([0]);
  });

  it('validates the exact-decimal rate grammar (≤10 technical decimals)', () => {
    expect(commissionRateGrammarValid('388')).toBe(true);
    expect(commissionRateGrammarValid('388.0000000000')).toBe(true);
    expect(commissionRateGrammarValid('1.1234567890')).toBe(true);
    expect(commissionRateGrammarValid('1.12345678901')).toBe(false);
    expect(commissionRateGrammarValid('-88')).toBe(false);
    expect(commissionRateGrammarValid('abc')).toBe(false);
    expect(commissionRateGrammarValid('')).toBe(false);
  });

  it('caps percentages at 100 with exact-decimal math (never float)', () => {
    expect(commissionPercentageWithinLimit('100')).toBe(true);
    expect(commissionPercentageWithinLimit('100.0000000000')).toBe(true);
    expect(commissionPercentageWithinLimit('99.9999999999')).toBe(true);
    expect(commissionPercentageWithinLimit('100.0000000001')).toBe(false);
    expect(commissionPercentageWithinLimit('150')).toBe(false);
  });

  it('requires a strictly future market-local date', () => {
    expect(
      commissionEffectiveDateFuture('2099-01-01', 'Asia/Kuala_Lumpur'),
    ).toBe(true);
    expect(
      commissionEffectiveDateFuture('2020-01-01', 'Asia/Kuala_Lumpur'),
    ).toBe(false);
    expect(
      commissionEffectiveDateFuture('not-a-date', 'Asia/Kuala_Lumpur'),
    ).toBe(false);
  });

  it('resolves the market-local midnight to the exact UTC instant', () => {
    const midnight = resolveLocalMidnightUtc('2026-09-01', 'Asia/Kuala_Lumpur');
    expect(midnight?.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(marketLocalTomorrow('Asia/Kuala_Lumpur')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/u,
    );
  });

  it('orders history newest-first without mutating the input', () => {
    const input = [
      { effective_from_utc: '2026-01-01T00:00:00.000Z' },
      { effective_from_utc: '2026-09-01T00:00:00.000Z' },
    ];
    const ordered = orderCommissionHistory(input);
    expect(ordered[0]?.effective_from_utc).toBe('2026-09-01T00:00:00.000Z');
    expect(ordered[1]?.effective_from_utc).toBe('2026-01-01T00:00:00.000Z');
    expect(input[0]?.effective_from_utc).toBe('2026-01-01T00:00:00.000Z');
  });

  it('formats the window cell with exact server strings', () => {
    expect(
      formatCommissionWindow({
        effective_from_local: '2026-09-01 00:00:00',
        effective_until_local: null,
      }),
    ).toBe('2026-09-01 00:00:00 → open');
    expect(
      formatCommissionWindow({
        effective_from_local: '2026-07-25 00:00:00',
        effective_until_local: '2026-09-01 00:00:00',
      }),
    ).toBe('2026-07-25 00:00:00 → 2026-09-01 00:00:00');
  });

  it('gates the read/manage affordances on the exact permissions', () => {
    expect(canViewCommissionRates(['commission.rate.read'])).toBe(true);
    expect(canViewCommissionRates(['SUPER_ADMIN'])).toBe(false);
    expect(canManageCommissionRates(['commission.rate.manage'])).toBe(true);
    expect(canManageCommissionRates(['commission.rate.read'])).toBe(false);
  });

  it('describes read errors with stable copy per external code', () => {
    expect(
      describeCommissionReadError(
        new ApiError(403, {
          code: 'PERMISSION_DENIED',
          message: 'denied',
        }),
      ).title,
    ).toBe('Permission denied');
    expect(
      describeCommissionReadError(
        new ApiError(409, {
          code: 'MARKET_CONTEXT_MISMATCH',
          message: 'changed',
        }),
      ).title,
    ).toBe('Market context changed');
    expect(
      describeCommissionReadError(
        new ApiError(403, {
          code: 'COMMISSION_RATE_MARKET_ACCESS_DENIED',
          message: 'denied',
        }),
      ).title,
    ).toBe('Market access denied');
  });

  it('describes write errors with stable copy per external code', () => {
    expect(
      describeCommissionWriteError(
        new ApiError(422, { code: 'RATE_TYPE_MISMATCH', message: 'x' }),
      ),
    ).toContain('frozen commission-type contract');
    expect(
      describeCommissionWriteError(
        new ApiError(422, { code: 'INVALID_GENERATION', message: 'x' }),
      ),
    ).toContain('generation is not valid');
    expect(
      describeCommissionWriteError(
        new ApiError(422, {
          code: 'COMMISSION_RATE_PERCENTAGE_LIMIT',
          message: 'x',
        }),
      ),
    ).toContain('cannot exceed 100%');
    expect(
      describeCommissionWriteError(
        new ApiError(409, {
          code: 'OVERLAPPING_RATE_PERIOD',
          message: 'x',
        }),
      ),
    ).toContain('immutable and overlap is prevented');
    expect(
      describeCommissionWriteError(
        new ApiError(409, {
          code: 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
          message: 'x',
        }),
      ),
    ).toContain('different payload');
  });
});
