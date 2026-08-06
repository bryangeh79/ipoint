import { vi } from 'vitest';
import type {
  AdminIpointAdjustmentConfigDto,
  AdminIpointAdjustmentDecisionDto,
  AdminIpointAdjustmentDetailDto,
  AdminIpointAdjustmentDto,
  AdminIpointAdjustmentQueueDto,
  AdminIpointWalletLookupDto,
} from '@ipoint/api-client';
import {
  ipointAdjustConfigFixture,
  ipointAdjustDetailFixture,
  ipointAdjustMarketId,
  ipointAdjustQueueFixture,
  ipointAdjustRequestFixture,
  ipointAdjustWalletFixture,
} from './ipoint-adjust-fixtures.js';

/**
 * Shared P7-S7B page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions) exactly like the commission-config mock,
 * plus the ipoint-adjust-ops adapter endpoints (create/submit/decision/
 * execute/queue/detail/config/wallets). Permission enforcement mirrors
 * the canonical catalog: `wallet.ipoint.read` for the reads,
 * `wallet.ipoint.adjust.maker` for create+submit, `.checker`/`.execute`
 * for decide/execute with the mandatory `x-step-up-token` header.
 */

export interface IpointAdjustMockOptions {
  permissions?: string[];
  configBody?: AdminIpointAdjustmentConfigDto;
  queueBody?: AdminIpointAdjustmentQueueDto;
  walletBody?: AdminIpointWalletLookupDto[];
  configFails?: { status: number; code: string; message?: string };
  createFails?: { status: number; code: string; message?: string };
  decideFails?: { status: number; code: string; message?: string };
  executeFails?: { status: number; code: string; message?: string };
  detailBody?: AdminIpointAdjustmentDetailDto;
  /** Current admin user id (used to simulate the maker's own request). */
  actorId?: string;
  stepUpTokenRequired?: boolean;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockIpointAdjustApi(
  options: IpointAdjustMockOptions | readonly string[] = {},
) {
  const resolved: IpointAdjustMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as IpointAdjustMockOptions);
  const permissions = resolved.permissions ?? [
    'wallet.ipoint.read',
    'wallet.ipoint.adjust.maker',
    'wallet.ipoint.adjust.checker',
    'wallet.ipoint.adjust.execute',
  ];
  let config = resolved.configBody ?? ipointAdjustConfigFixture;
  let queue = resolved.queueBody ?? ipointAdjustQueueFixture;
  let detail = resolved.detailBody ?? ipointAdjustDetailFixture();
  const walletBody = resolved.walletBody ?? ipointAdjustWalletFixture;
  const actorId = resolved.actorId ?? '22222222-2222-4222-8222-222222222222';
  const stepUpTokenRequired = resolved.stepUpTokenRequired ?? true;

  const market = {
    id: ipointAdjustMarketId,
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
            id: actorId,
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
          currentMarketId: ipointAdjustMarketId,
          contextVersion: 3,
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/sessions/current')) {
        return json({
          valid: true,
          session_id: 'session-1',
          admin_user_id: actorId,
          mfa_recovery_used: false,
        });
      }
      if (url.endsWith('/admin/sessions')) return json({ sessions: [] });

      // ── MFA step-up (checker decide/execute) ───────────────────────
      if (
        url.endsWith('/auth/admin/mfa/step-up/challenge') &&
        method === 'POST'
      ) {
        return json({
          step_up_challenge_id: 'stepup-challenge-1',
          expires_at: '2026-08-01T12:15:00.000Z',
        });
      }
      if (url.endsWith('/auth/admin/mfa/step-up/verify') && method === 'POST') {
        return json({
          step_up_token: 'stepup-token-verified',
          expires_at: '2026-08-01T12:15:00.000Z',
        });
      }

      // ── ipoint-adjust-ops adapter surface ─────────────────────────
      const opsBase = '/admin/ipoint-adjust-ops/markets/';
      const idx = url.indexOf(opsBase);
      if (idx === -1) {
        return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
      }
      const path = url.slice(idx + opsBase.length);

      if (path === `${ipointAdjustMarketId}/config` && method === 'GET') {
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
        if (!permissions.includes('wallet.ipoint.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        return json(config);
      }

      const walletsMatch = /^([^/]+)\/wallets\?query=/u.exec(path);
      if (walletsMatch && method === 'GET') {
        if (!permissions.includes('wallet.ipoint.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (walletBody.length === 0) {
          return json({ code: 'WALLET_ADJUSTMENT_WALLET_LOOKUP_EMPTY' }, 404);
        }
        return json(walletBody);
      }

      const queueMatch = /^([^/]+)\/adjustments(?:\?.*)?$/u.exec(path);
      if (queueMatch && method === 'GET') {
        if (!permissions.includes('wallet.ipoint.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
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
        return json(queue);
      }

      const createMatch = /^([^/]+)\/adjustments$/u.exec(path);
      if (createMatch && method === 'POST') {
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
        if (!permissions.includes('wallet.ipoint.adjust.maker')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (!headers.get('idempotency-key')) {
          return json(
            { code: 'WALLET_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED' },
            400,
          );
        }
        const created = ipointAdjustRequestFixture({
          state: 'DRAFT',
          id: `request-${Date.now()}`,
        });
        // Reflect the created request into the next queue read.
        queue = {
          ...queue,
          items: [created, ...queue.items],
        };
        return json(created, 201);
      }

      const decisionMatch = /^([^/]+)\/adjustments\/([^/]+)\/decision$/u.exec(
        path,
      );
      if (decisionMatch && method === 'POST') {
        if (resolved.decideFails) {
          return json(
            {
              code: resolved.decideFails.code,
              message:
                resolved.decideFails.message ?? resolved.decideFails.code,
            },
            resolved.decideFails.status,
          );
        }
        if (!permissions.includes('wallet.ipoint.adjust.checker')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (stepUpTokenRequired && !headers.get('x-step-up-token')) {
          return json({ code: 'MFA_STEP_UP_REQUIRED' }, 403);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          decision?: string;
        };
        const decided = ipointAdjustRequestFixture({
          state: (body.decision ??
            'APPROVED') as AdminIpointAdjustmentDto['state'],
          checkerAdminUserId: actorId,
          submittedAt: '2026-08-06T00:30:00.000Z',
        });
        detail = ipointAdjustDetailFixture(decided);
        return json(decided);
      }

      const executeMatch = /^([^/]+)\/adjustments\/([^/]+)\/execute$/u.exec(
        path,
      );
      if (executeMatch && method === 'POST') {
        if (resolved.executeFails) {
          return json(
            {
              code: resolved.executeFails.code,
              message:
                resolved.executeFails.message ?? resolved.executeFails.code,
            },
            resolved.executeFails.status,
          );
        }
        if (!permissions.includes('wallet.ipoint.adjust.execute')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        if (stepUpTokenRequired && !headers.get('x-step-up-token')) {
          return json({ code: 'MFA_STEP_UP_REQUIRED' }, 403);
        }
        const executed = ipointAdjustRequestFixture({
          state: 'EXECUTED',
          checkerAdminUserId: actorId,
          submittedAt: '2026-08-06T00:30:00.000Z',
          executedAt: '2026-08-06T01:00:00.000Z',
          ledgerEntryId: '33333333-3333-4333-8333-333333333333',
        });
        detail = ipointAdjustDetailFixture(executed);
        return json(executed);
      }

      const submitMatch = /^([^/]+)\/adjustments\/([^/]+)\/submit$/u.exec(path);
      if (submitMatch && method === 'POST') {
        if (!permissions.includes('wallet.ipoint.adjust.maker')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        const submitted = ipointAdjustRequestFixture({
          state: 'SUBMITTED',
          submittedAt: '2026-08-06T00:30:00.000Z',
        });
        detail = ipointAdjustDetailFixture(submitted);
        return json(submitted);
      }

      const detailMatch = /^([^/]+)\/adjustments\/([^/]+)(?:\?.*)?$/u.exec(
        path,
      );
      if (detailMatch && method === 'GET') {
        if (!permissions.includes('wallet.ipoint.read')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
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
        return json(detail);
      }

      return json({ error: { code: 'NOT_FOUND', message: url } }, 404);
    });

  return { fetchSpy };
}
