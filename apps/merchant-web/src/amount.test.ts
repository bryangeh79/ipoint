import { describe, expect, it } from 'vitest';
import { money, trimAmount } from './amount.js';

describe('trimAmount (exact-decimal display only)', () => {
  it('trims trailing zeros losslessly', () => {
    expect(trimAmount('120.5000000000')).toBe('120.5');
    expect(trimAmount('187.0000000000')).toBe('187');
    expect(trimAmount('0.0000000000')).toBe('0');
    expect(trimAmount('-0.2500000000')).toBe('-0.25');
    expect(trimAmount('42')).toBe('42');
  });

  it('never converts the value to a Number', () => {
    const input = '0.1000000000000000055511151231257827';
    expect(trimAmount(input)).toBe(input.replace(/0+$/, ''));
  });

  it('formats money with the currency code prefix', () => {
    expect(money('MYR', '120.5000000000')).toBe('MYR 120.5');
    expect(money('MYR', '88.0000000000')).toBe('MYR 88');
  });
});
