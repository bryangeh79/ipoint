import { describe, expect, it } from 'vitest';
import {
  describeReportReadError,
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
});
