import { vi } from 'vitest';
import type {
  AdminMemberOpsListPageDto,
  AdminMemberOpsProfileDto,
} from '@ipoint/api-client';
import {
  memberOpsListPageFixture,
  memberOpsMarketA,
  memberOpsProfileFixture,
} from './member-ops-fixtures.js';

/**
 * Shared P7-S5A page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions) exactly like the dashboard mock, plus the
 * member-ops adapter endpoints with a mutable profile store so status actions
 * and notes can be exercised end to end in jsdom.
 */

export interface MemberOpsMockOptions {
  permissions?: string[];
  listBody?: AdminMemberOpsListPageDto;
  detailFails?: { status: number; code: string; message?: string };
  listFails?: { status: number; code: string; message?: string };
  /** Override the mutable profile served by the detail endpoint. */
  initialProfile?: AdminMemberOpsProfileDto;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockMemberOpsApi(
  options: MemberOpsMockOptions | readonly string[] = {},
) {
  const resolved: MemberOpsMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as MemberOpsMockOptions);
  let currentMarketId = memberOpsMarketA;
  let contextVersion = 3;
  let profile = resolved.initialProfile ?? memberOpsProfileFixture();
  const permissions = resolved.permissions ?? [
    'member.read',
    'member.status.manage',
    'member.session.revoke',
    'member.reverification.require',
    'member.note.create',
    'member.note.read',
  ];
  const market = {
    id: memberOpsMarketA,
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
          contextVersion,
          availability: { operationalWorkspace: 'AVAILABLE' },
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/markets') && method === 'GET') {
        return json({
          items: [{ ...market, isSelected: true }],
          currentMarketId,
          contextVersion,
          asOf: '2026-08-01T12:00:00.000Z',
        });
      }
      if (url.endsWith('/admin/me/current-market') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as {
          market_id: string;
          expected_context_version: number;
        };
        currentMarketId = body.market_id;
        contextVersion += 1;
        return json({
          marketId: currentMarketId,
          contextVersion,
          selectedAt: '2026-08-01T12:01:00.000Z',
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

      // ── P7-S5A member ops endpoints ─────────────────────────────────
      const listMatch = /\/admin\/member-ops\/members(\?|$)/u.exec(url);
      if (listMatch && method === 'GET') {
        if (resolved.listFails) {
          return json(
            {
              code: resolved.listFails.code,
              message: resolved.listFails.message ?? resolved.listFails.code,
            },
            resolved.listFails.status,
          );
        }
        return json(resolved.listBody ?? memberOpsListPageFixture());
      }

      const notesMatch =
        /\/admin\/member-ops\/members\/([^/]+)\/notes(\?|$)/u.exec(url);
      if (notesMatch && method === 'GET') {
        return json({
          notes: profile.notes,
          total: profile.notes.length,
          page: 1,
          pageSize: 20,
        });
      }

      const notesAddMatch =
        /\/admin\/member-ops\/members\/([^/]+)\/notes$/u.exec(url);
      if (notesAddMatch && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as {
          content: string;
          isInternal: boolean;
          idempotencyKey: string;
        };
        profile = {
          ...profile,
          notes: [
            ...profile.notes,
            {
              id: `note-${profile.notes.length + 1}`,
              adminUserId: 'admin-1',
              marketId: profile.currentMarketId,
              content: body.content,
              isInternal: body.isInternal,
              createdAt: '2026-08-01T12:30:00.000Z',
            },
          ],
        };
        return json(profile);
      }

      const actionMatch =
        /\/admin\/member-ops\/members\/([^/]+)\/(suspend|reactivate|close|revoke-sessions|require-reverification)$/u.exec(
          url,
        );
      if (actionMatch && method === 'POST') {
        const action = actionMatch[2];
        if (action === 'suspend') {
          profile = { ...profile, status: 'SUSPENDED' };
        } else if (action === 'reactivate') {
          profile = { ...profile, status: 'ACTIVE' };
        } else if (action === 'close') {
          profile = {
            ...profile,
            status: 'CLOSED',
            closedAt: '2026-08-01T12:30:00.000Z',
          };
        } else if (action === 'require-reverification') {
          profile = {
            ...profile,
            kyc: profile.kyc
              ? {
                  ...profile.kyc,
                  status: 'REVERIFICATION_REQUIRED',
                  reverificationRequiredAt: '2026-08-01T12:30:00.000Z',
                }
              : null,
          };
        }
        return json(profile);
      }

      const detailMatch = /\/admin\/member-ops\/members\/([^/]+)$/u.exec(url);
      if (detailMatch && method === 'GET') {
        if (resolved.detailFails) {
          return json(
            {
              code: resolved.detailFails.code,
              message:
                resolved.detailFails.message ?? resolved.detailFails.code,
            },
            resolved.detailFails.status,
          );
        }
        return json(profile);
      }

      return json(
        { code: 'NOT_MOCKED', message: `Unhandled: ${method} ${url}` },
        500,
      );
    });

  return {
    fetchSpy,
    getProfile: () => profile,
    setProfile: (next: AdminMemberOpsProfileDto) => {
      profile = next;
    },
  };
}
