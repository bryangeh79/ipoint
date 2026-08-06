import { describe, expect, it } from 'vitest';
import { ApiError } from '@ipoint/api-client';
import {
  canManageMarket,
  canViewMarket,
  describeMarketReadError,
  describeMarketWriteError,
  marketCurrencyValid,
  marketLocaleValid,
  marketNameValid,
  marketTimezoneValid,
} from './market-config-model.js';

/**
 * P7-S6E Admin Market Configuration — pure presentation model tests.
 * Formatting/affordance helpers only; the server remains the authority.
 */

describe('market-config-model (P7-S6E)', () => {
  it('marketNameValid: trimmed 1..200', () => {
    expect(marketNameValid('Malaysia')).toBe(true);
    expect(marketNameValid('  Malaysia  ')).toBe(true);
    expect(marketNameValid('')).toBe(false);
    expect(marketNameValid('   ')).toBe(false);
    expect(marketNameValid('x'.repeat(201))).toBe(false);
    expect(marketNameValid('x'.repeat(200))).toBe(true);
  });

  it('marketCurrencyValid: exactly 3 uppercase letters', () => {
    expect(marketCurrencyValid('MYR')).toBe(true);
    expect(marketCurrencyValid('SGD')).toBe(true);
    expect(marketCurrencyValid('myr')).toBe(false);
    expect(marketCurrencyValid('MY')).toBe(false);
    expect(marketCurrencyValid('MYR1')).toBe(false);
  });

  it('marketTimezoneValid: IANA identifiers only', () => {
    expect(marketTimezoneValid('Asia/Kuala_Lumpur')).toBe(true);
    expect(marketTimezoneValid('UTC')).toBe(true);
    expect(marketTimezoneValid('Not/AZone')).toBe(false);
    expect(marketTimezoneValid('')).toBe(false);
  });

  it('marketLocaleValid: BCP-47-style locales', () => {
    expect(marketLocaleValid('en-MY')).toBe(true);
    expect(marketLocaleValid('zh-Hans-CN')).toBe(true);
    expect(marketLocaleValid('en')).toBe(true);
    expect(marketLocaleValid('English!')).toBe(false);
    expect(marketLocaleValid('')).toBe(false);
  });

  it('canViewMarket / canManageMarket: server permission affordances', () => {
    expect(canViewMarket(['market.read'])).toBe(true);
    expect(canViewMarket(['dashboard.view'])).toBe(false);
    expect(canManageMarket(['market.read'])).toBe(false);
    expect(canManageMarket(['market.read', 'market.manage'])).toBe(true);
  });

  it('describeMarketReadError: maps owner codes to copy', () => {
    expect(
      describeMarketReadError(
        new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }),
      ).title,
    ).toBe('Market context changed');
    expect(
      describeMarketReadError(
        new ApiError(403, { code: 'MARKET_ACCESS_DENIED' }),
      ).title,
    ).toBe('Market access denied');
    expect(describeMarketReadError(new Error('network down')).title).toBe(
      'Market configuration unavailable',
    );
  });

  it('describeMarketWriteError: maps owner codes to copy', () => {
    expect(
      describeMarketWriteError(
        new ApiError(409, { code: 'MARKET_DEACTIVATION_DEPENDENCY' }),
      ),
    ).toContain('active resources depend');
    expect(
      describeMarketWriteError(
        new ApiError(400, {
          code: 'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED',
        }),
      ),
    ).toContain('Confirm the deactivation');
    expect(
      describeMarketWriteError(
        new ApiError(403, { code: 'MFA_STEP_UP_REQUIRED' }),
      ),
    ).toContain('Verify your identity');
    expect(
      describeMarketWriteError(
        new ApiError(400, { code: 'MARKET_NO_CHANGES' }),
      ),
    ).toContain('No market fields changed');
    expect(describeMarketWriteError(new Error('boom'))).toContain(
      'could not be completed',
    );
  });
});
