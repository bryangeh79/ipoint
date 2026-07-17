import { describe, expect, it } from 'vitest';
import {
  createPackageVersionSchema,
  createSpecialPercentageSchema,
} from '../dto/package.dto.js';

describe('service-fee decimal validation', () => {
  const effectiveWindow = {
    effective_from: '2026-07-17T00:00:00.000Z',
    effective_to: '2027-07-17T00:00:00.000Z',
  };

  it.each(['0.000001', '2.500000', '100', '100.000000'])(
    'accepts an exact decimal rate of %s',
    (rate) => {
      expect(
        createPackageVersionSchema.safeParse({ rate, ...effectiveWindow })
          .success,
      ).toBe(true);
      expect(
        createSpecialPercentageSchema.safeParse({
          rate,
          description: 'Approved special rate',
        }).success,
      ).toBe(true);
    },
  );

  it.each(['0', '-1', '100.000001', '1e2', '2.1234567', 2.5])(
    'rejects an invalid or floating-point rate of %s',
    (rate) => {
      expect(
        createPackageVersionSchema.safeParse({ rate, ...effectiveWindow })
          .success,
      ).toBe(false);
    },
  );
});
