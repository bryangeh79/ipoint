import { describe, expect, it } from 'vitest';
import {
  describeReportReadError,
  formatReportAmount,
  formatReportAsOf,
  reportValueKindLabel,
} from './reports-model.js';
import { ApiError } from '@ipoint/api-client';

describe('P7-S9 reports model', () => {
  it('labels report value kinds without inventing values', () => {
    expect(reportValueKindLabel('STATUS_COUNTS')).toBe('Counts by status');
    expect(reportValueKindLabel('TREND')).toBe('Daily trend');
    expect(reportValueKindLabel('FUTURE_KIND')).toBe('FUTURE_KIND');
  });

  it('formats ISO timestamps and leaves invalid values untouched', () => {
    expect(formatReportAsOf('2026-08-07T12:00:00.000Z')).not.toBe(
      '2026-08-07T12:00:00.000Z',
    );
    expect(formatReportAsOf('nope')).toBe('nope');
  });

  it('maps canonical guard errors to the permission-denied state copy', () => {
    const denied = describeReportReadError(
      new ApiError(403, { code: 'MARKET_ACCESS_DENIED' }),
    );
    expect(denied.kind).toBe('permission-denied');
    const conflict = describeReportReadError(
      new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }),
    );
    expect(conflict.kind).toBe('conflict');
    const generic = describeReportReadError(new Error('boom'));
    expect(generic.kind).toBe('error');
  });

  describe('formatReportAmount (P8-S4 exact-decimal display)', () => {
    it('trims trailing zeros losslessly from numeric(38,10) strings', () => {
      expect(formatReportAmount('187.0000000000')).toBe('187');
      expect(formatReportAmount('36.0000000000')).toBe('36');
      expect(formatReportAmount('1000.0000000000')).toBe('1000');
      expect(formatReportAmount('10.0000000000')).toBe('10');
      expect(formatReportAmount('0.0000000000')).toBe('0');
      expect(formatReportAmount('-12.0000000000')).toBe('-12');
    });

    it('keeps meaningful fractional digits untouched', () => {
      expect(formatReportAmount('1.2345678900')).toBe('1.23456789');
      expect(formatReportAmount('0.5000000000')).toBe('0.5');
      expect(formatReportAmount('123.4500000000')).toBe('123.45');
    });

    it('leaves non-decimal strings untouched and is null-safe', () => {
      expect(formatReportAmount('187')).toBe('187');
      expect(formatReportAmount(187)).toBe('187');
      expect(formatReportAmount(undefined)).toBe('0');
      expect(formatReportAmount(null)).toBe('0');
    });
  });
});
