import { describe, expect, it } from 'vitest';
import {
  adminRouteManifest,
  navigationGroups,
  routePath,
} from './route-manifest.js';
import { hasEffectivePermission } from './route-guards.js';

describe('P7-S3A Admin route manifest', () => {
  it('defines exactly 40 unique stable routes with guard metadata', () => {
    expect(adminRouteManifest).toHaveLength(40);
    expect(new Set(adminRouteManifest.map(({ id }) => id)).size).toBe(40);
    expect(new Set(adminRouteManifest.map(({ path }) => path)).size).toBe(40);
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
      'Content Operations',
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
    expect(adminRouteManifest.find(({ id }) => id === 'ads')?.permission).toBe(
      'ads.view',
    );
    expect(
      adminRouteManifest.find(({ id }) => id === 'content')?.permission,
    ).toBe('content.view');
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
    // P7-S8: the refunds / fulfilment-exceptions / agents routes must no
    // longer carry the stale GATE-SEC-02 / SEC-03/15 / GATE-P5-01 gates —
    // SEC-02 (merge acd83556), SEC-03 (P6-R2 admin route security, merge
    // 8502065d) and GATE-P5-01 (P5-R1 owner remediation, merge b954f985)
    // are all integrated, and the P7-S8 pages implement the read/action
    // surfaces over the frozen owners. The canonical permissions still
    // guard every route.
    expect(
      adminRouteManifest.find(({ id }) => id === 'refunds')?.capabilityGate,
    ).toBeUndefined();
    expect(
      adminRouteManifest.find(({ id }) => id === 'fulfilment-exceptions')
        ?.capabilityGate,
    ).toBeUndefined();
    expect(
      adminRouteManifest.find(({ id }) => id === 'agents')?.capabilityGate,
    ).toBeUndefined();
    expect(
      adminRouteManifest.find(({ id }) => id === 'agent-detail')
        ?.capabilityGate,
    ).toBeUndefined();
    expect(
      adminRouteManifest.find(({ id }) => id === 'redemption-order-detail')
        ?.permission,
    ).toBe('redemption.order.read');
    // P7-S8 High-1 fix: every P7-S8 route must reference a canonical
    // catalog permission (packages/database/src/permission-catalog.ts).
    // The stale agent.activation.read / redemption.fulfilment.read /
    // redemption.refund.read codes do not exist in the catalog, so they
    // could never be granted and the routes were permanently denied.
    expect(
      adminRouteManifest.find(({ id }) => id === 'agents')?.permission,
    ).toBe('agent.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'agent-detail')?.permission,
    ).toBe('agent.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'fulfilment-exceptions')
        ?.permission,
    ).toBe('redemption.order.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'refunds')?.permission,
    ).toBe('redemption.order.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'refund-detail')?.permission,
    ).toBe('redemption.order.read');
    // P7-S9: the audit route uses the canonical audit.read and the reports
    // route uses the canonical report.read (the stale report.basic.read
    // code does not exist in the catalog — P7-S8 Review 2 drift, fixed
    // here). Both permissions are marketScoped and catalog-owned.
    expect(
      adminRouteManifest.find(({ id }) => id === 'audit')?.permission,
    ).toBe('audit.read');
    expect(
      adminRouteManifest.find(({ id }) => id === 'reports')?.permission,
    ).toBe('report.read');
    expect(
      adminRouteManifest.some(
        ({ permission }) => permission === 'report.basic.read',
      ),
    ).toBe(false);
    // Zero drift: the three non-canonical codes must not be required by
    // any manifest route.
    for (const staleCode of [
      'agent.activation.read',
      'redemption.fulfilment.read',
      'redemption.refund.read',
    ]) {
      expect(
        adminRouteManifest.some(({ permission }) => permission === staleCode),
      ).toBe(false);
    }
    // K-04 (D-056): the settings route must use a canonical catalog code.
    // The stale admin.profile.self code does not exist in the catalog; the
    // settings page's only server-backed capability is the Current Admin
    // Market preference (admin.market.select, ALL roles).
    expect(
      adminRouteManifest.find(({ id }) => id === 'settings')?.permission,
    ).toBe('admin.market.select');
    expect(
      adminRouteManifest.some(
        ({ permission }) => permission === 'admin.profile.self',
      ),
    ).toBe(false);
  });
});
