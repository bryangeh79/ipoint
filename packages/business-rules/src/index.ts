import Decimal from 'decimal.js';

export function parseDecimal(value: Decimal.Value): Decimal {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) {
    throw new Error('Value must be a finite decimal');
  }
  return decimal;
}
