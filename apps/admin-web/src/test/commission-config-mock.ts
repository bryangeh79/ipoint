import { vi } from 'vitest';
import type {
  AdminCommissionRateCreateResultDto,
  AdminCommissionRateListDto,
} from '@ipoint/api-client';
import {
  commissionConfigFixture,
  commissionOpsMarketA,
  commissionRateCreateFixture,
} from './commission-config-fixtures.js';

/**
 * Shared P7-S6D page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions) exactly like the redemption-config mock,
 * plus the commission-ops adapter endpoints (GET/POST `/admin/commission-
 * ops/markets/:id/rates`). Permission enforcement mirrors the canonical
 * catalog: `commission.rate.read` for the read, SUPER_ADMIN-only
 * `commission.rate.manage` for the write; the write also requires the
 * Idempotency-Key header.
 */

export interface CommissionConfigMockOptions {
  permissions?: string[];
  configBody?: AdminCommissionRateListDto;
  configFails?: { status: number; code: string; message?: string };
  createFails?: { status: number; code: string; message?: string };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockCommissionConfigApi(
  options: CommissionConfigMockOptions | readonly string[] = {},
) {
  const resolved: CommissionConfigMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as CommissionConfigMockOptions);
  const permissions = resolved.permissions ?? [
    'commission.rate.read',
    'commission.rate.manage',
  ];
  let config = resolved.configBody ?? commissionConfigFixture;
  const market = {
    id: commissionOpsMarketA,
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
          currentMarketId: commissionOpsMarketA,
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

      // ── Commission-ops adapter surface ─────────────────────────────
      const ratesMatch =
        /\/admin\/commission-ops\/markets\/[^/]+\/rates$/u.exec(url);
      if (ratesMatch && method === 'GET') {
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
        if (!permissions.includes('commission.rate.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        return json(config);
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
        if (!permissions.includes('commission.rate.manage')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (!headers.get('idempotency-key')) {
          return json(
            { code: 'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED' },
            400,
          );
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          commission_type?: string;
          generation?: number;
          rate_type?: string;
          rate_value?: string;
          effective_date?: string;
          reason?: string;
        };
        const created: AdminCommissionRateCreateResultDto = {
          ...commissionRateCreateFixture,
          id: `new-rate-${Date.now()}`,
          commission_type: body.commission_type ?? 'AGENT_UPGRADE',
          generation: body.generation ?? 1,
          rate_type: body.rate_type ?? 'FIXED',
          rate_value: String(body.rate_value ?? '388'),
          effective_date: String(body.effective_date ?? '2026-10-01'),
        };
        // Reflect the created version into the next read (SCHEDULED).
        config = {
          ...config,
          definitions: config.definitions.map((definition) => {
            if (
              definition.commission_type === created.commission_type &&
              definition.generation === created.generation
            ) {
              return {
                ...definition,
                scheduled: [
                  {
                    id: created.id,
                    commission_type: created.commission_type,
                    generation: created.generation,
                    rate_type: created.rate_type,
                    rate_value: created.rate_value,
                    display_rate: created.display_rate,
                    effective_from_utc: created.effective_from_utc,
                    effective_from_local: created.effective_from_local,
                    effective_until_utc: null,
                    effective_until_local: null,
                    window_status: 'SCHEDULED',
                    reason: body.reason ?? null,
                    created_by: 'admin-1',
                    created_at: '2026-08-04T00:00:00.000Z',
                  },
                  ...definition.scheduled,
                ],
                history: [
                  {
                    id: created.id,
                    commission_type: created.commission_type,
                    generation: created.generation,
                    rate_type: created.rate_type,
                    rate_value: created.rate_value,
                    display_rate: created.display_rate,
                    effective_from_utc: created.effective_from_utc,
                    effective_from_local: created.effective_from_local,
                    effective_until_utc: null,
                    effective_until_local: null,
                    window_status: 'SCHEDULED',
                    reason: body.reason ?? null,
                    created_by: 'admin-1',
                    created_at: '2026-08-04T00:00:00.000Z',
                  },
                  ...definition.history,
                ],
              };
            }
            return definition;
          }),
        };
        return json(created, 201);
      }

      return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
    });

  return { fetchSpy };
}
