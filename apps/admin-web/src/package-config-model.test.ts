import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  canAssignPackages,
  canManageSpecialPercentages,
  canManageStandardPackages,
  describePackageReadError,
  formatPackageWindow,
  orderPackageProfiles,
  packageRateValid,
  packageVersionStatusLabel,
  packageWindowValid,
  SPECIAL_PERCENTAGE_CREATE_BLOCKED,
  versionActivateable,
} from './package-config-model.js';

describe('P7-S6A package configuration model', () => {
  it('labels version lifecycle statuses', () => {
    expect(packageVersionStatusLabel('DRAFT')).toBe('Draft');
    expect(packageVersionStatusLabel('SCHEDULED')).toBe('Scheduled');
    expect(packageVersionStatusLabel('ACTIVE')).toBe('Active');
    expect(packageVersionStatusLabel('EXPIRED')).toBe('Expired');
    expect(packageVersionStatusLabel('CANCELLED')).toBe('Cancelled');
    expect(packageVersionStatusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('orders catalog profiles by the locked A–F identities, then name', () => {
    const ordered = orderPackageProfiles([
      { code: 'D', name: 'D' },
      { code: 'A', name: 'A' },
      { code: 'Z', name: 'Zed' },
      { code: 'F', name: 'F' },
      { code: 'M', name: 'Extra' },
    ]);
    expect(ordered.map((profile) => profile.code)).toEqual([
      'A',
      'D',
      'F',
      'M',
      'Z',
    ]);
  });

  it('formats the effective window without client math', () => {
    expect(
      formatPackageWindow({
        effective_from: '2026-01-01T00:00:00.000Z',
        effective_to: null,
      }),
    ).toBe('2026-01-01T00:00:00.000Z → open');
    expect(
      formatPackageWindow({
        effective_from: '2026-01-01T00:00:00.000Z',
        effective_to: '2027-01-01T00:00:00.000Z',
      }),
    ).toBe('2026-01-01T00:00:00.000Z → 2027-01-01T00:00:00.000Z');
  });

  it('validates the locked D-010 rate range (>0% and <=100%) as decimal strings', () => {
    expect(packageRateValid('2.5')).toBe(true);
    expect(packageRateValid('100.000000')).toBe(true);
    expect(packageRateValid('0.000001')).toBe(true);
    expect(packageRateValid('0')).toBe(false);
    expect(packageRateValid('100.000001')).toBe(false);
    expect(packageRateValid('-1')).toBe(false);
    expect(packageRateValid('1e2')).toBe(false);
    expect(packageRateValid('abc')).toBe(false);
  });

  it('validates effective windows', () => {
    expect(packageWindowValid('2026-01-01T00:00:00.000Z', '')).toBe(true);
    expect(
      packageWindowValid(
        '2026-01-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
      ),
    ).toBe(true);
    expect(
      packageWindowValid(
        '2027-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ),
    ).toBe(false);
    expect(packageWindowValid('not-a-date', '')).toBe(false);
  });

  it('gates UI affordances on canonical permissions only', () => {
    expect(canManageStandardPackages(['merchant.package.manage'])).toBe(true);
    expect(canManageStandardPackages(['merchant.package.view'])).toBe(false);
    expect(
      canManageSpecialPercentages(['merchant.special_package.manage']),
    ).toBe(true);
    expect(canManageSpecialPercentages(['SUPER_ADMIN'])).toBe(false);
    expect(canAssignPackages(['merchant.package.assign'])).toBe(true);
    expect(canAssignPackages([])).toBe(false);
  });

  it('keeps the special-percentage create capability explicitly blocked', () => {
    expect(SPECIAL_PERCENTAGE_CREATE_BLOCKED.capability).toBe(
      'merchant.special_package.create',
    );
    expect(SPECIAL_PERCENTAGE_CREATE_BLOCKED.blockedPrerequisite).toContain(
      'OWNER-GAP',
    );
  });

  it('describes read errors with stable copy', () => {
    expect(
      describePackageReadError(new ApiError(403, { code: 'PERMISSION_DENIED' }))
        .title,
    ).toBe('Permission denied');
    expect(
      describePackageReadError(
        new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }),
      ).title,
    ).toBe('Market context changed');
    expect(
      describePackageReadError(new ApiError(503, { code: 'X' })).title,
    ).toBe('Package configuration unavailable');
  });

  it('flags only DRAFT/SCHEDULED versions as activateable', () => {
    expect(versionActivateable({ status: 'DRAFT' })).toBe(true);
    expect(versionActivateable({ status: 'SCHEDULED' })).toBe(true);
    expect(versionActivateable({ status: 'ACTIVE' })).toBe(false);
    expect(versionActivateable({ status: 'EXPIRED' })).toBe(false);
    expect(versionActivateable({ status: 'CANCELLED' })).toBe(false);
  });
});
