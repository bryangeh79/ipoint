import { describe, expect, it } from 'vitest';
import { parseDecimal } from './index.js';

describe('parseDecimal', () => {
  it('preserves decimal precision', () => {
    expect(parseDecimal('0.1').plus('0.2').toString()).toBe('0.3');
  });

  it('rejects non-finite values', () => {
    expect(() => parseDecimal('Infinity')).toThrow('finite decimal');
  });
});
