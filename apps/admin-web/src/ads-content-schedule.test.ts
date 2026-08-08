import { describe, expect, it } from 'vitest';
import {
  localControlFromUtc,
  utcFromLocalControl,
} from './ads-content-schedule.js';

describe('P8-S1 explicit-UTC schedule conversion', () => {
  it('fixes a datetime-local value to the UTC instant without local-time interpretation', () => {
    // In Asia/Kuala_Lumpur the previous `new Date(text).toISOString()` turned
    // 12:00 into 04:00Z. The explicit-UTC parse must not shift.
    expect(utcFromLocalControl('2026-08-08T12:00')).toBe(
      '2026-08-08T12:00:00.000Z',
    );
    expect(utcFromLocalControl('2026-08-08T04:00')).toBe(
      '2026-08-08T04:00:00.000Z',
    );
    expect(utcFromLocalControl('2026-08-08T00:00')).toBe(
      '2026-08-08T00:00:00.000Z',
    );
  });

  it('round-trips stored instants through a non-UTC browser without shifting', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Kuala_Lumpur';
      for (const stored of [
        '2026-08-08T12:00:00.000Z',
        '2026-08-08T04:00:00.000Z',
        '2026-08-08T00:00:00.000Z',
        '2026-08-07T16:00:00.000Z',
      ]) {
        expect(utcFromLocalControl(localControlFromUtc(stored))).toBe(stored);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('keeps create and edit payloads identical for an unchanged schedule', () => {
    // Editing a record and saving without touching the schedule must produce
    // the exact same stored UTC instants.
    const storedStart = '2026-08-08T02:30:00.000Z';
    const storedEnd = '2026-08-20T14:00:00.000Z';
    const startControl = localControlFromUtc(storedStart);
    const endControl = localControlFromUtc(storedEnd);
    expect(utcFromLocalControl(startControl)).toBe(storedStart);
    expect(utcFromLocalControl(endControl)).toBe(storedEnd);
  });

  it('returns null for empty or malformed control values', () => {
    expect(utcFromLocalControl('')).toBeNull();
    expect(utcFromLocalControl('   ')).toBeNull();
    expect(utcFromLocalControl('not-a-date')).toBeNull();
    expect(utcFromLocalControl('2026-08-08')).toBeNull();
    expect(utcFromLocalControl('2026-08-08T25:00')).toBeNull();
  });

  it('returns an empty control value for null timestamps', () => {
    expect(localControlFromUtc(null)).toBe('');
    expect(localControlFromUtc('')).toBe('');
    expect(localControlFromUtc('invalid')).toBe('');
  });
});
