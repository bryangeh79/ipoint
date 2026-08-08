import { describe, expect, it } from 'vitest';
import {
  createRunSchema,
  exceptionActionSchema,
  exceptionNotesSchema,
  listExceptionsQuerySchema,
  listRunsQuerySchema,
} from './admin-reconciliation-ops.dto.js';
import {
  classificationFor,
  computeTotals,
  eqScaled,
  formatScaledBigInt,
  signedDelta,
  sub,
  toScaledBigInt,
} from './admin-reconciliation-ops.service.js';
import type { DetectedItem } from './admin-reconciliation-ops.types.js';

describe('P8-S2 exact decimal helpers', () => {
  it('scales and formats numeric(38,10) values exactly', () => {
    expect(toScaledBigInt('0.0000000000')).toBe(0n);
    expect(toScaledBigInt('1.0000000000')).toBe(10_000_000_000n);
    expect(toScaledBigInt('123.4567890123')).toBe(1_234_567_890_123n);
    expect(toScaledBigInt('-5.5000000000')).toBe(-55_000_000_000n);
    expect(toScaledBigInt(42)).toBe(420_000_000_000n);
    expect(toScaledBigInt(null)).toBe(0n);
    expect(toScaledBigInt(undefined)).toBe(0n);
    expect(toScaledBigInt('')).toBe(0n);
    expect(toScaledBigInt('0000.0000000001')).toBe(1n);
    expect(formatScaledBigInt(10_000_000_000n)).toBe('1.0000000000');
    expect(formatScaledBigInt(-55_000_000_000n)).toBe('-5.5000000000');
    expect(formatScaledBigInt(0n)).toBe('0.0000000000');
  });

  it('subtracts exactly without float rounding', () => {
    expect(sub('0.3000000000', '0.1000000000')).toBe('0.2000000000');
    expect(sub('1.0000000000', '0.9999999999')).toBe('0.0000000001');
    expect(eqScaled('100.0000000000', '100.0000000000')).toBe(true);
    expect(eqScaled('100.0000000000', '100.0000000001')).toBe(false);
  });

  it('signs wallet entry deltas by entry type', () => {
    expect(signedDelta('AVAILABLE', '50.0000000000')).toBe('50.0000000000');
    expect(signedDelta('REDEMPTION_DEBIT', '25.0000000000')).toBe(
      '-25.0000000000',
    );
    expect(signedDelta('REVERSED', '10.0000000000')).toBe('-10.0000000000');
  });
});

describe('P8-S2 totals and classification helpers', () => {
  const item = (
    status: DetectedItem['status'],
    expected: string,
    actual: string,
  ): DetectedItem => ({
    referenceType: 'test',
    referenceId: '1',
    status,
    expectedAmount: expected,
    actualAmount: actual,
    differenceAmount: sub(actual, expected),
    evidence: {},
  });

  it('computes matched/mismatched counts and exact totals', () => {
    const totals = computeTotals([
      item('MATCHED', '10.0000000000', '10.0000000000'),
      item('MISMATCHED', '10.0000000000', '8.0000000000'),
      item('MISSING', '5.0000000000', '0.0000000000'),
    ]);
    expect(totals).toEqual({
      expectedTotal: '25.0000000000',
      actualTotal: '18.0000000000',
      differenceTotal: '-7.0000000000',
      matchedCount: 1,
      mismatchedCount: 2,
      exceptionCount: 2,
    });
  });

  it('classifies exception types from item status', () => {
    expect(classificationFor('MISSING')).toBe('MISSING_EXPECTED');
    expect(classificationFor('UNEXPECTED')).toBe('UNEXPECTED_EXTRA');
    expect(classificationFor('MISMATCHED')).toBe('AMOUNT_MISMATCH');
    expect(classificationFor('MATCHED')).toBe('AMOUNT_MISMATCH');
  });
});

describe('P8-S2 DTO validation', () => {
  it('requires an increasing window on run creation', () => {
    const base = {
      kind: 'MCP',
      windowStart: '2026-08-01T00:00:00.000Z',
      windowEnd: '2026-08-08T00:00:00.000Z',
      reason: 'Monthly reconciliation.',
    };
    expect(createRunSchema.parse(base)).toBeTruthy();
    expect(
      createRunSchema.safeParse({
        ...base,
        windowEnd: '2026-07-31T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      createRunSchema.safeParse({ ...base, kind: 'UNKNOWN' }).success,
    ).toBe(false);
    expect(createRunSchema.safeParse({ ...base, reason: '   ' }).success).toBe(
      false,
    );
  });

  it('validates list queries and exception actions', () => {
    expect(listRunsQuerySchema.parse({ kind: 'MCP', limit: 5 })).toMatchObject({
      kind: 'MCP',
      limit: 5,
    });
    expect(
      listExceptionsQuerySchema.safeParse({ status: 'OPEN' }).success,
    ).toBe(true);
    expect(
      listExceptionsQuerySchema.safeParse({ classification: 'BOGUS' }).success,
    ).toBe(false);
    expect(
      exceptionActionSchema.parse({ expectedVersion: 2, reason: 'ok' }),
    ).toBeTruthy();
    expect(
      exceptionActionSchema.safeParse({ expectedVersion: 0, reason: 'ok' })
        .success,
    ).toBe(false);
    expect(
      exceptionNotesSchema.parse({
        expectedVersion: 1,
        notes: 'note',
        reason: 'investigation note',
      }),
    ).toBeTruthy();
    expect(
      exceptionNotesSchema.safeParse({
        expectedVersion: 1,
        notes: 'x'.repeat(10_001),
        reason: 'investigation note',
      }).success,
    ).toBe(false);
  });
});
