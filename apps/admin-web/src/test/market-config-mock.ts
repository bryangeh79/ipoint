import { vi } from 'vitest';
import type {
  AdminMarketDetailDto,
  AdminMarketUpdateInput,
  AdminMarketUpdateResultDto,
} from '@ipoint/api-client';
import {
  marketConfigMarketA,
  marketDetailFixture,
  marketUpdateResultFixture,
} from './market-config-fixtures.js';

/**
 * Shared P7-S6E page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions) exactly like the commission-config mock,
 * plus the market-ops endpoints (GET/PATCH `/admin/market-ops/markets/:id`).
 * Permission enforcement mirrors the canonical catalog: `market.read` for
 * the read, SUPER_ADMIN-only `market.manage` for the write; the write also
 * requires the Idempotency-Key header.
 */

export interface MarketConfigMockOptions {
  permissions?: string[];
  configBody?: AdminMarketDetailDto;
  configFails?: { status: number; code: string; message?: string };
  updateFails?: { status: number; code: string; message?: string };
  /** Reflect a successful update into the next read. */
  applyUpdate?: boolean;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockMarketConfigApi(
  options: MarketConfigMockOptions | readonly string[] = {},
) {
  const resolved: MarketConfigMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as MarketConfigMockOptions);
  const permissions = resolved.permissions ?? ['market.read', 'market.manage'];
  let config: AdminMarketDetailDto = resolved.configBody ?? marketDetailFixture;
  const market = {
    id: marketConfigMarketA,
    code: 'MY',
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
          currentMarketId: marketConfigMarketA,
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

      // ── Market-ops surface ─────────────────────────────────────────
      const marketMatch = /\/admin\/market-ops\/markets\/[^/]+$/u.exec(url);
      if (marketMatch && method === 'GET') {
        if (resolved.configFails) {
          return json(
            {
              code: resolved.configFails.code,
              message:
                resolved.configFails.message ?? resolved.configFails.code,
            },
            resolved.configFails.status,
          );
        }
        if (!permissions.includes('market.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        return json(config);
      }

      if (marketMatch && method === 'PATCH') {
        if (resolved.updateFails) {
          return json(
            {
              code: resolved.updateFails.code,
              message:
                resolved.updateFails.message ?? resolved.updateFails.code,
            },
            resolved.updateFails.status,
          );
        }
        if (!permissions.includes('market.manage')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (!headers.get('idempotency-key')) {
          return json({ code: 'MARKET_IDEMPOTENCY_KEY_REQUIRED' }, 400);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >;
        if (!body.reason || String(body.reason).trim().length === 0) {
          return json({ code: 'MARKET_REASON_REQUIRED' }, 400);
        }
        if (resolved.applyUpdate !== false) {
          config = {
            ...config,
            name: typeof body.name === 'string' ? body.name : config.name,
            currency_code:
              typeof body.currencyCode === 'string'
                ? body.currencyCode
                : config.currency_code,
            timezone:
              typeof body.timezone === 'string'
                ? body.timezone
                : config.timezone,
            default_locale:
              typeof body.defaultLocale === 'string'
                ? body.defaultLocale
                : config.default_locale,
            status:
              body.status === 'INACTIVE' || body.status === 'ACTIVE'
                ? body.status
                : config.status,
            updated_at: '2026-08-06T00:00:00.000Z',
          };
        }
        const input = body as unknown as AdminMarketUpdateInput;
        const result = marketUpdateResultFixture(
          input.status === 'INACTIVE' ? { status: 'INACTIVE' } : {},
        );
        return json(result);
      }

      return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
    });

  return { fetchSpy };
}
