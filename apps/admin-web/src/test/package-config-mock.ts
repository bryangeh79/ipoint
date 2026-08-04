import { vi } from 'vitest';
import type {
  AdminMerchantBranchDetailDto,
  AdminPackageCatalogDto,
  AdminSpecialPercentageListDto,
} from '@ipoint/api-client';
import {
  merchantBranchDetailFixture,
  packageCatalogFixture,
  packageOpsMarketA,
  specialPercentagesFixture,
} from './package-config-fixtures.js';

/**
 * Shared P7-S6A page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions, step-up) exactly like the member-ops/kyc
 * mocks, plus the package-ops adapter endpoints and the frozen Phase 1
 * owner write routes used by the configuration page.
 */

export interface PackageConfigMockOptions {
  permissions?: string[];
  catalogBody?: AdminPackageCatalogDto;
  specialsBody?: AdminSpecialPercentageListDto;
  merchantDetailBody?: AdminMerchantBranchDetailDto;
  catalogFails?: { status: number; code: string; message?: string };
  specialsFails?: { status: number; code: string; message?: string };
  merchantListBody?: {
    items: Array<{ branch_id: string; name: string }>;
    limit: number;
    offset: number;
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockPackageConfigApi(
  options: PackageConfigMockOptions | readonly string[] = {},
) {
  const resolved: PackageConfigMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as PackageConfigMockOptions);
  const permissions = resolved.permissions ?? [
    'merchant.package.view',
    'merchant.package.manage',
    'merchant.package.assign',
    'merchant.special_package.manage',
  ];
  let catalog = resolved.catalogBody ?? packageCatalogFixture;
  let specials = resolved.specialsBody ?? specialPercentagesFixture;
  let merchantDetail =
    resolved.merchantDetailBody ?? merchantBranchDetailFixture;
  const market = {
    id: packageOpsMarketA,
    code: 'MA',
    name: 'Malaysia',
    currencyCode: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    grantedAt: '2026-01-01T00:00:00.000Z',
    isSelected: true,
  };

  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);

      if (url.endsWith('/auth/admin/login') && method === 'POST') {
        return json(
          {
            code: 'MFA_REQUIRED',
            mfa_challenge_id: 'challenge'.repeat(4),
            expires_at: '2026-08-01T12:05:00.000Z',
          },
          202,
        );
      }
      if (url.endsWith('/auth/admin/mfa/challenge') && method === 'POST') {
        return json({
          accessToken: 'admin-access-token',
          refreshToken: 'admin-refresh-token',
          accessExpiresAt: '2026-08-01T12:15:00.000Z',
          refreshExpiresAt: '2026-08-08T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/bootstrap')) {
        return json({
          actor: {
            id: 'admin-1',
            accountId: 'account-1',
            displayName: 'Bryan Admin',
            status: 'ACTIVE',
          },
          roles: [{ id: 'role-1', code: 'SUPER_ADMIN', name: 'Super Admin' }],
          effectivePermissions: permissions,
          accessibleMarkets: [{ ...market, isSelected: true }],
          currentMarket: market,
          contextVersion: 3,
          availability: { operationalWorkspace: 'AVAILABLE' },
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/markets') && method === 'GET') {
        return json({
          items: [{ ...market, isSelected: true }],
          currentMarketId: packageOpsMarketA,
          contextVersion: 3,
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/sessions/current')) {
        return json({
          valid: true,
          session_id: 'session-1',
          admin_user_id: 'admin-1',
          mfa_recovery_used: false,
        });
      }
      if (url.endsWith('/admin/sessions')) return json({ sessions: [] });
      if (
        url.endsWith('/auth/admin/mfa/step-up/challenge') &&
        method === 'POST'
      ) {
        return json(
          {
            step_up_challenge_id: 'challenge'.repeat(4),
            expires_at: '2026-08-01T12:15:00.000Z',
          },
          202,
        );
      }
      if (url.endsWith('/auth/admin/mfa/step-up/verify') && method === 'POST') {
        return json({
          step_up_token: 'stepup-grant-token',
          expires_at: '2026-08-01T12:15:00.000Z',
        });
      }

      // ── Package-ops adapter reads ───────────────────────────────────
      const catalogMatch =
        /\/admin\/package-ops\/markets\/[^/]+\/packages$/u.exec(url);
      if (catalogMatch && method === 'GET') {
        if (resolved.catalogFails) {
          return json(
            {
              code: resolved.catalogFails.code,
              message:
                resolved.catalogFails.message ?? resolved.catalogFails.code,
            },
            resolved.catalogFails.status,
          );
        }
        if (!permissions.includes('merchant.package.view')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        return json(catalog);
      }

      const specialsMatch =
        /\/admin\/package-ops\/markets\/[^/]+\/special-percentages$/u.exec(url);
      if (specialsMatch && method === 'GET') {
        if (resolved.specialsFails) {
          return json(
            {
              code: resolved.specialsFails.code,
              message:
                resolved.specialsFails.message ?? resolved.specialsFails.code,
            },
            resolved.specialsFails.status,
          );
        }
        if (!permissions.includes('merchant.special_package.manage')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (!headers.get('x-step-up-token')) {
          return json({ code: 'MFA_STEP_UP_REQUIRED' }, 403);
        }
        return json(specials);
      }

      // ── Frozen owner write routes (typed pass-through) ─────────────
      const versionCreateMatch =
        /\/admin\/markets\/[^/]+\/packages\/[^/]+\/versions$/u.exec(url);
      if (versionCreateMatch && method === 'POST') {
        if (!permissions.includes('merchant.package.manage')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          rate?: string;
        };
        catalog = {
          ...catalog,
          items: catalog.items.map((profile) => ({
            ...profile,
            versions: [
              {
                id: `new-version-${Date.now()}`,
                profile_id: profile.id,
                rate: String(body.rate ?? '0').padEnd(8, '0'),
                status: 'DRAFT',
                effective_from: '2027-01-01T00:00:00.000Z',
                effective_to: null,
                created_at: '2026-08-01T00:00:00.000Z',
              },
              ...profile.versions,
            ],
          })),
        };
        return json(
          {
            id: `new-version-${Date.now()}`,
            profile_id: catalog.items[0]?.id,
            rate: String(body.rate ?? '0').padEnd(8, '0'),
            status: 'DRAFT',
            effective_from: '2027-01-01T00:00:00.000Z',
            effective_to: null,
            created_at: '2026-08-01T00:00:00.000Z',
          },
          201,
        );
      }

      const activateMatch =
        /\/admin\/markets\/[^/]+\/packages\/[^/]+\/versions\/[^/]+\/activate$/u.exec(
          url,
        );
      if (activateMatch && method === 'PATCH') {
        if (!permissions.includes('merchant.package.manage')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        catalog = {
          ...catalog,
          items: catalog.items.map((profile) => ({
            ...profile,
            versions: profile.versions.map((version) => ({
              ...version,
              status: 'ACTIVE',
            })),
          })),
        };
        return json({ id: 'activated-1', status: 'ACTIVE' });
      }

      const assignMatch =
        /\/admin\/markets\/[^/]+\/merchants\/[^/]+\/packages\/assignments$/u.exec(
          url,
        );
      if (assignMatch && method === 'POST') {
        if (!permissions.includes('merchant.package.assign')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          service_fee_version_id?: string;
        };
        merchantDetail = {
          ...merchantDetail,
          packages: {
            items: [
              {
                ...merchantDetail.packages.items[0]!,
                assignment_id: `new-assignment-${Date.now()}`,
                service_fee_version_id:
                  body.service_fee_version_id ??
                  merchantDetail.packages.items[0]?.service_fee_version_id ??
                  null,
                is_default: true,
              },
              ...merchantDetail.packages.items.map((item) => ({
                ...item,
                is_default: false,
              })),
            ],
            limit: 20,
            offset: 0,
          },
        };
        return json(
          { id: `new-assignment-${Date.now()}`, is_default: true },
          201,
        );
      }

      const setDefaultMatch =
        /\/admin\/markets\/[^/]+\/merchants\/[^/]+\/packages\/assignments\/[^/]+\/set-default$/u.exec(
          url,
        );
      if (setDefaultMatch && method === 'PATCH') {
        if (!permissions.includes('merchant.package.assign')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        return json({ id: 'default-1', is_default: true });
      }

      // ── Owner merchant read surfaces used by the reassignment UI ────
      const merchantListMatch =
        /\/admin\/markets\/[^/]+\/merchants(\?|$)/u.exec(url);
      if (merchantListMatch && method === 'GET') {
        return json(
          resolved.merchantListBody ?? {
            items: [
              {
                branch_id: merchantDetail.branch_id,
                merchant_id: merchantDetail.merchant_id,
                name: merchantDetail.profile.display_name,
                status: 'ACTIVE',
                market_id: packageOpsMarketA,
                created_at: '2026-07-01T00:00:00.000Z',
                application_status: 'APPROVED',
                kyc_status: 'APPROVED',
                mcp_account_id: null,
                available_balance: null,
              },
            ],
            limit: 10,
            offset: 0,
          },
        );
      }

      const merchantDetailMatch =
        /\/admin\/markets\/[^/]+\/merchants\/[^/]+\/detail$/u.exec(url);
      if (merchantDetailMatch && method === 'GET') {
        return json(merchantDetail);
      }

      return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
    });

  return { fetchSpy };
}
