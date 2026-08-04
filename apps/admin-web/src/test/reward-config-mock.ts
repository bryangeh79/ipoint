import { vi } from 'vitest';
import type {
  AdminRewardRuleCreateResultDto,
  AdminRewardRuleListDto,
} from '@ipoint/api-client';
import {
  rewardOpsMarketA,
  rewardRuleCreateFixture,
  rewardScheduleFixture,
} from './reward-config-fixtures.js';

/**
 * Shared P7-S6B page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions) exactly like the package-config mock, plus
 * the reward-ops adapter endpoints (GET/POST `/admin/reward-ops/markets/
 * :id/rules`). Permission enforcement mirrors the canonical catalog:
 * `reward.rule.read` for the read, SUPER_ADMIN-only `reward.rule.schedule`
 * for the write; the write also requires the Idempotency-Key header.
 */

export interface RewardConfigMockOptions {
  permissions?: string[];
  scheduleBody?: AdminRewardRuleListDto;
  scheduleFails?: { status: number; code: string; message?: string };
  createFails?: { status: number; code: string; message?: string };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockRewardConfigApi(
  options: RewardConfigMockOptions | readonly string[] = {},
) {
  const resolved: RewardConfigMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as RewardConfigMockOptions);
  const permissions = resolved.permissions ?? [
    'reward.rule.read',
    'reward.rule.schedule',
  ];
  let schedule = resolved.scheduleBody ?? rewardScheduleFixture;
  const market = {
    id: rewardOpsMarketA,
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
          currentMarketId: rewardOpsMarketA,
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

      // ── Reward-ops adapter surface ──────────────────────────────────
      const rulesMatch = /\/admin\/reward-ops\/markets\/[^/]+\/rules$/u.exec(
        url,
      );
      if (rulesMatch && method === 'GET') {
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
        if (!permissions.includes('reward.rule.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        return json(schedule);
      }

      if (rulesMatch && method === 'POST') {
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
        if (!permissions.includes('reward.rule.schedule')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (!headers.get('idempotency-key')) {
          return json({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          package_reference?: string;
          rate?: string;
          effective_date?: string;
          reason?: string;
        };
        const created: AdminRewardRuleCreateResultDto = {
          ...rewardRuleCreateFixture,
          id: `new-rule-${Date.now()}`,
          package_reference: body.package_reference ?? 'C',
          reward_rate: String(body.rate ?? '0.05'),
          effective_date: String(body.effective_date ?? '2026-10-01'),
        };
        schedule = {
          ...schedule,
          rules: [
            {
              id: created.id,
              name: `Package ${created.package_reference} Reward Rate`,
              description: null,
              reward_rate: created.reward_rate,
              cap_type: 'NONE',
              cap_value: '0',
              minimum_reward: '0',
              package_reference: created.package_reference,
              effective_from_utc: created.effective_from_utc,
              effective_from_local: created.effective_from_local,
              effective_until_utc: null,
              effective_until_local: null,
              timezone: created.timezone,
              window_status: 'SCHEDULED',
              market_id: rewardOpsMarketA,
              created_by: 'admin-1',
              created_at: '2026-08-04T00:00:00.000Z',
            },
            ...schedule.rules,
          ],
        };
        return json(created, 201);
      }

      return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
    });

  return { fetchSpy };
}
