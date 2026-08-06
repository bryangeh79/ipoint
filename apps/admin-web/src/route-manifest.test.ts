import { describe, expect, it } from 'vitest';
import {
  adminRouteManifest,
  navigationGroups,
  routePath,
} from './route-manifest.js';
import { hasEffectivePermission } from './route-guards.js';

describe('P7-S3A Admin route manifest', () => {
  it('defines exactly 36 unique stable routes with guard metadata', () => {
    expect(adminRouteManifest).toHaveLength(36);
    expect(new Set(adminRouteManifest.map(({ id }) => id)).size).toBe(36);
    expect(new Set(adminRouteManifest.map(({ path }) => path)).size).toBe(36);
    for (const route of adminRouteManifest) {
      expect(route.path).toMatch(/^\/admin\//u);
      expect(route.loader).toMatch(/^(public|bootstrap|session)$/u);
      expect(route.errorBoundary).toMatch(
        /^(authentication|protected-route)$/u,
      );
      expect(route.breadcrumb).toBeTruthy();
      expect(['none', 'selected', 'resource']).toContain(route.market);
      expect(['full', 'read-only', 'desktop-only']).toContain(
        route.mobilePolicy,
      );
    }
  });

  it('contains every approved navigation group in order', () => {
    expect(navigationGroups).toEqual([
      'Overview',
      'People',
      'Commerce',
      'Reviews',
      'Network',
      'Finance',
      'Configuration',
      'Redemption',
      'Governance',
      'Access Control',
      'Security',
      'Account',
    ]);
  });

  it('builds encoded deep links and rejects missing parameters', () => {
    expect(
      routePath('member-detail', { marketId: 'my', memberId: 'A/B' }),
    ).toBe('/admin/my/members/A%2FB');
    expect(() => routePath('dashboard')).toThrow('Missing route parameter');
    // P7-S5C KYC case-detail deep links (append-only routes).
    expect(
      routePath('member-kyc-detail', {
        marketId: 'my',
        caseId: '33333333-3333-4333-8333-333333333333',
      }),
    ).toBe('/admin/my/kyc/members/33333333-3333-4333-8333-333333333333');
    expect(
      routePath('merchant-kyc-detail', {
        marketId: 'my',
        branchId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toBe('/admin/my/kyc/merchants/44444444-4444-4444-8444-444444444444');
  });

  it('requires the exact effective permission without role inference', () => {
    // Canonical P7-S2 catalog value (packages/database/src/permission-catalog.ts)
    // is dashboard.view; the manifest must not drift from it.
    expect(
      adminRouteManifest.find(({ id }) => id === 'dashboard')?.permission,
    ).toBe('dashboard.view');
    expect(hasEffectivePermission(['dashboard.view'], 'dashboard.view')).toBe(
      true,
    );
    expect(hasEffectivePermission(['SUPER_ADMIN'], 'dashboard.view')).toBe(
      false,
    );
    // The outdated dashboard.read alias is not a canonical permission and must
    // not be required by any manifest route (zero drift vs the catalog).
    expect(
      adminRouteManifest.some(
        ({ permission }) => permission === 'dashboard.read',
      ),
    ).toBe(false);
    // P7-S6A: the packages route must use the canonical merchant.package.view
    // (the catalog has no merchant.package.read code — zero drift).
    expect(
      adminRouteManifest.find(({ id }) => id === 'packages')?.permission,
    ).toBe('merchant.package.view');
    expect(
      adminRouteManifest.some(
        ({ permission }) => permission === 'merchant.package.read',
      ),
    ).toBe(false);
    // P7-S6C: the redemption-rates route must use the canonical
    // redemption.rate.read (added to the Phase 7-owned catalog with this
    // capability) and must no longer carry the stale SEC-03/15 gate — the
    // schedule capability (redemption.rate.manage) is now implemented.
    expect(
      adminRouteManifest.find(({ id }) => id === 'redemption-rates')
        ?.permission,
    ).toBe('redemption.rate.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'redemption-rates')
        ?.capabilityGate,
    ).toBeUndefined();
    // P7-S6D: the commissions route must use the canonical
    // commission.rate.read and must no longer carry the stale
    // commission.rate.schedule gate — the manage capability
    // (commission.rate.manage) is now implemented by the S6D page.
    expect(
      adminRouteManifest.find(({ id }) => id === 'commissions')?.permission,
    ).toBe('commission.rate.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'commissions')?.capabilityGate,
    ).toBeUndefined();
    // P7-S6E: the market route must use the canonical market.read and must
    // carry no capability gate (the market.manage capability is
    // implemented by the S6E secured owner surface; SUPER_ADMIN + step-up
    // is enforced server-side).
    expect(
      adminRouteManifest.find(({ id }) => id === 'market')?.permission,
    ).toBe('market.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'market')?.capabilityGate,
    ).toBeUndefined();
  });

  it('keeps hard-gated capabilities discoverable without executable controls', () => {
    // P7-S7B: the ipoint-adjustments route must use the canonical
    // wallet.ipoint.read and must no longer carry the stale GATE-SEC-01
    // gate — the Maker/Checker workflow (wallet.ipoint.adjust.maker /
    // .checker / .execute) is now implemented by the S7B pages over the
    // frozen SEC-01 owner.
    expect(
      adminRouteManifest.find(({ id }) => id === 'ipoint-adjustments')
        ?.permission,
    ).toBe('wallet.ipoint.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'ipoint-adjustments')
        ?.capabilityGate,
    ).toBeUndefined();
    expect(
      adminRouteManifest.find(({ id }) => id === 'refunds')?.capabilityGate,
    ).toMatchObject({ blockedPrerequisite: 'GATE-SEC-02' });
  });
});
