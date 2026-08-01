import { describe, expect, it } from 'vitest';
import {
  adminRouteManifest,
  navigationGroups,
  routePath,
} from './route-manifest.js';
import { hasEffectivePermission } from './route-guards.js';

describe('P7-S3A Admin route manifest', () => {
  it('defines exactly 31 unique stable routes with guard metadata', () => {
    expect(adminRouteManifest).toHaveLength(31);
    expect(new Set(adminRouteManifest.map(({ id }) => id)).size).toBe(31);
    expect(new Set(adminRouteManifest.map(({ path }) => path)).size).toBe(31);
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
  });

  it('requires the exact effective permission without role inference', () => {
    expect(hasEffectivePermission(['dashboard.read'], 'dashboard.read')).toBe(
      true,
    );
    expect(hasEffectivePermission(['SUPER_ADMIN'], 'dashboard.read')).toBe(
      false,
    );
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
