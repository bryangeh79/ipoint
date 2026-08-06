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
          reason: 'D-051 owner remediation evidence',
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

describe('D-051 mandatory special-percentage reason (DTO)', () => {
  const valid = {
    rate: '12.500000',
    description: 'Approved special rate',
  };

  it('accepts a trimmed non-blank reason up to 500 characters', () => {
    expect(
      createSpecialPercentageSchema.safeParse({
        ...valid,
        reason: '  Partner promotion 2026  ',
      }).success,
    ).toBe(true);
    expect(
      createSpecialPercentageSchema.safeParse({
        ...valid,
        reason: 'a'.repeat(500),
      }).success,
    ).toBe(true);
    // trim is applied by the schema
    const parsed = createSpecialPercentageSchema.safeParse({
      ...valid,
      reason: '  Partner promotion  ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe('Partner promotion');
  });

  it.each([
    undefined,
    '',
    '   ',
    '\t\n ',
    'a'.repeat(501),
    42,
    { text: 'reason' },
  ])('rejects reason %j', (reason) => {
    expect(
      createSpecialPercentageSchema.safeParse({ ...valid, reason }).success,
    ).toBe(false);
  });

  it('rejects actor-shaped fields (client cannot forge the actor)', () => {
    expect(
      createSpecialPercentageSchema.safeParse({
        ...valid,
        reason: 'Valid reason',
        createdByAdminUserId: '00000000-0000-0000-0000-000000000000',
        adminUserId: '00000000-0000-0000-0000-000000000000',
        marketId: '00000000-0000-0000-0000-000000000000',
      }).success,
    ).toBe(false);
  });
});
