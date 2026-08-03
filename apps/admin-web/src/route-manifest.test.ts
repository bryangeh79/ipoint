import { describe, expect, it } from 'vitest';
import {
  adminRouteManifest,
  navigationGroups,
  routePath,
} from './route-manifest.js';
import { hasEffectivePermission } from './route-guards.js';

describe('P7-S3A Admin route manifest', () => {
  it('defines exactly 33 unique stable routes with guard metadata', () => {
    expect(adminRouteManifest).toHaveLength(33);
    expect(new Set(adminRouteManifest.map(({ id }) => id)).size).toBe(33);
    expect(new Set(adminRouteManifest.map(({ path }) => path)).size).toBe(33);
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
  });

  it('keeps hard-gated capabilities discoverable without executable controls', () => {
    expect(
      adminRouteManifest.find(({ id }) => id === 'ipoint-adjustments')
        ?.capabilityGate,
    ).toEqual({
      capability: 'wallet.ipoint.adjust',
      blockedPrerequisite: 'GATE-SEC-01',
    });
    expect(
      adminRouteManifest.find(({ id }) => id === 'refunds')?.capabilityGate,
    ).toMatchObject({ blockedPrerequisite: 'GATE-SEC-02' });
  });
});
