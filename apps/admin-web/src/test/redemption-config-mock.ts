import { vi } from 'vitest';
import type {
  AdminRedemptionRateCreateResultDto,
  AdminRedemptionRateListDto,
} from '@ipoint/api-client';
import {
  redemptionBlockedFixture,
  redemptionConfigFixture,
  redemptionOpsMarketA,
  redemptionRateCreateFixture,
} from './redemption-config-fixtures.js';

/**
 * Shared P7-S6C page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions) exactly like the reward-config mock, plus
 * the redemption-ops adapter endpoints (GET/POST
 * `/admin/redemption-ops/markets/:id/rates`). Permission enforcement
 * mirrors the canonical catalog: `redemption.rate.read` for the read,
 * SUPER_ADMIN-only `redemption.rate.manage` for the write; the write also
 * requires the Idempotency-Key header.
 */

export interface RedemptionConfigMockOptions {
  permissions?: string[];
  scheduleBody?: AdminRedemptionRateListDto;
  scheduleFails?: { status: number; code: string; message?: string };
  createFails?: { status: number; code: string; message?: string };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockRedemptionConfigApi(
  options: RedemptionConfigMockOptions | readonly string[] = {},
) {
  const resolved: RedemptionConfigMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as RedemptionConfigMockOptions);
  const permissions = resolved.permissions ?? [
    'redemption.rate.read',
    'redemption.rate.manage',
  ];
  let schedule = resolved.scheduleBody ?? redemptionConfigFixture;
  const market = {
    id: redemptionOpsMarketA,
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
          currentMarketId: redemptionOpsMarketA,
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

      // ── Redemption-ops adapter surface ──────────────────────────────
      const ratesMatch =
        /\/admin\/redemption-ops\/markets\/[^/]+\/rates$/u.exec(url);
      if (ratesMatch && method === 'GET') {
        if (resolved.scheduleFails) {
          return json(
            {
              code: resolved.scheduleFails.code,
              message:
                resolved.scheduleFails.message ?? resolved.scheduleFails.code,
            },
            resolved.scheduleFails.status,
          );
        }
        if (!permissions.includes('redemption.rate.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        return json(schedule);
      }

      if (ratesMatch && method === 'POST') {
        if (resolved.createFails) {
          return json(
            {
              code: resolved.createFails.code,
              message:
                resolved.createFails.message ?? resolved.createFails.code,
            },
            resolved.createFails.status,
          );
        }
        if (!permissions.includes('redemption.rate.manage')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (!headers.get('idempotency-key')) {
          return json({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          rate_value?: string;
          effective_date?: string;
          reason?: string;
        };
        const created: AdminRedemptionRateCreateResultDto = {
          ...redemptionRateCreateFixture,
          id: `new-rate-${Date.now()}`,
          rate_value: String(body.rate_value ?? '1.5000000000'),
          effective_date: String(body.effective_date ?? '2026-10-01'),
        };
        schedule = {
          ...schedule,
          rates: [
            ...(schedule.rates ?? []),
            {
              id: created.id,
              rate_type: 'POINTS_PER_CURRENCY',
              rate_value: created.rate_value,
              display_rate: created.display_rate,
              effective_from_utc: created.effective_from_utc,
              effective_from_local: created.effective_from_local,
              effective_until_utc: null,
              effective_until_local: null,
              window_status: 'SCHEDULED',
              created_by: 'admin-1',
              created_at: created.created_at,
            },
          ],
        };
        return json(created, 201);
      }

      return json({ code: 'NOT_FOUND', message: url }, 404);
    });

  return fetchSpy;
}

/** Serve the blocked (unapproved) market read for the blocked-state test. */
export function mockRedemptionBlockedMarket() {
  return mockRedemptionConfigApi({
    scheduleBody: redemptionBlockedFixture,
  });
}
