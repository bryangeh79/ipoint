import { vi } from 'vitest';
import type {
  AdminAuditEntryDto,
  AdminAuditListDto,
  AdminAuditRawEntryDto,
  AdminReportCatalogDto,
  AdminReportDetailDto,
} from '@ipoint/api-client';

/**
 * Shared P7-S9 page-test mock: shell endpoints (login, MFA, bootstrap,
 * markets, sessions) plus the audit-ops and report-ops adapter endpoints.
 * Permission enforcement mirrors the canonical catalog: `audit.read` for
 * the masked audit list/detail, `audit.sensitive-diff.view` for the raw
 * evidence view (Support is never granted it), `report.read` for the
 * bounded reports. Only canonical catalog codes are ever granted.
 */

export const P7S9_MARKET_ID = '11111111-1111-4111-8111-111111111111';
export const P7S9_ENTRY_ID = '22222222-2222-4222-8222-222222222222';
export const P7S9_ENTRY_DENIED = '23232323-2323-4323-8323-232323232323';
export const P7S9_ACTOR_ID = '66666666-6666-4666-8666-666666666666';

export interface P7S9OpsMockOptions {
  permissions?: string[];
  auditList?: AdminAuditListDto;
  auditEntry?: AdminAuditEntryDto;
  auditRaw?: AdminAuditRawEntryDto;
  reportCatalog?: AdminReportCatalogDto;
  reportDetail?: AdminReportDetailDto;
  rawStatus?: number;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function maskedAuditEntryFixture(
  overrides: Partial<AdminAuditEntryDto> = {},
): AdminAuditEntryDto {
  return {
    id: P7S9_ENTRY_ID,
    occurredAt: '2026-08-07T12:00:00.000Z',
    actorType: 'ADMIN_USER',
    actorId: P7S9_ACTOR_ID,
    marketId: P7S9_MARKET_ID,
    action: 'REDEMPTION_REFUND_APPROVE',
    entityType: 'redemption_order',
    entityId: '33333333-3333-4333-8333-333333333333',
    result: 'SUCCESS',
    reason: 'documented reason',
    requestId: 'req-1',
    masked: true,
    beforeMasked: { status: 'PENDING_CHECKER' },
    afterMasked: {
      status: 'APPROVED',
      id_number: '[MASKED]',
      access_token: '[REDACTED]',
      note: 'approved by checker',
    },
    ...overrides,
  };
}

export function auditListFixture(
  items: AdminAuditEntryDto[] = [maskedAuditEntryFixture()],
): AdminAuditListDto {
  return {
    asOf: '2026-08-07T12:00:00.000Z',
    marketId: P7S9_MARKET_ID,
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  };
}

export function reportCatalogFixture(
  overrides: Partial<AdminReportCatalogDto> = {},
): AdminReportCatalogDto {
  return {
    asOf: '2026-08-07T12:00:00.000Z',
    marketId: P7S9_MARKET_ID,
    items: [
      {
        id: 'R01',
        key: 'transaction-counts',
        name: 'Transaction counts',
        definition:
          'Transaction counts for the selected market over the trailing 30 days, grouped by status.',
        definitionVersion: 1,
        freshnessClass: 'KPI',
        permission: 'report.read',
        source: 'transactions.',
        state: 'FRESH',
        stale: false,
        unavailable: false,
        asOf: '2026-08-07T12:00:00.000Z',
        queryDurationMs: 1.8,
        value: {
          kind: 'STATUS_COUNTS',
          windowDays: 30,
          total: 2,
          counts: { CONFIRMED: 2 },
        },
      },
      {
        id: 'R02',
        key: 'adjustment-summary',
        name: 'MCP / iPoint adjustment summary',
        definition:
          'Manual adjustment volume over the trailing 90 days: MCP by status and iPoint by state.',
        definitionVersion: 1,
        freshnessClass: 'KPI',
        permission: 'report.read',
        source: 'mcp_adjustment_requests + ipoint_adjustment_requests.',
        state: 'FRESH',
        stale: false,
        unavailable: false,
        asOf: '2026-08-07T12:00:00.000Z',
        queryDurationMs: 1.4,
        value: {
          kind: 'ADJUSTMENT_SUMMARY',
          windowDays: 90,
          mcp: { total: 1, counts: { PENDING_APPROVAL: 1 } },
          ipoint: { total: 1, counts: { EXECUTED: 1 } },
        },
      },
      {
        id: 'R03',
        key: 'redemption-queue-overview',
        name: 'Redemption / fulfilment queue overview',
        definition:
          'Current redemption orders by status and fulfilments by status for the selected market.',
        definitionVersion: 1,
        freshnessClass: 'QUEUE',
        permission: 'report.read',
        source: 'redemption_orders + redemption_fulfilments.',
        state: 'FRESH',
        stale: false,
        unavailable: false,
        asOf: '2026-08-07T12:00:00.000Z',
        queryDurationMs: 1.4,
        value: {
          kind: 'QUEUE_OVERVIEW',
          orders: { CONFIRMED: 1, READY_FOR_PICKUP: 1 },
          fulfilments: { COMPLETED: 1 },
        },
      },
      {
        id: 'R04',
        key: 'registration-activation-trend',
        name: 'Registration / activation trend',
        definition:
          'Daily member registrations and agent activations over the trailing 14 days.',
        definitionVersion: 1,
        freshnessClass: 'KPI',
        permission: 'report.read',
        source: 'member_market_preferences + agent_activation.',
        state: 'FRESH',
        stale: false,
        unavailable: false,
        asOf: '2026-08-07T12:00:00.000Z',
        queryDurationMs: 1.5,
        value: {
          kind: 'TREND',
          windowDays: 14,
          days: [
            { date: '2026-08-06', registrations: 1, activations: 1 },
            { date: '2026-08-07', registrations: 1, activations: 0 },
          ],
          totals: { registrations: 2, activations: 1 },
        },
      },
    ],
    ...overrides,
  };
}

export function mockP7S9OpsApi(options: P7S9OpsMockOptions = {}) {
  const permissions = options.permissions ?? [
    'audit.read',
    'audit.sensitive-diff.view',
    'report.read',
  ];
  const market = {
    id: P7S9_MARKET_ID,
    code: 'MY',
    name: 'Malaysia',
    currencyCode: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    grantedAt: '2026-01-01T00:00:00.000Z',
    isSelected: true,
  };

  return vi
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
            id: P7S9_ACTOR_ID,
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
          markets: [{ ...market, isSelected: true }],
          currentMarketId: P7S9_MARKET_ID,
        });
      }
      if (url.endsWith('/admin/sessions/current')) {
        return json({ session: { id: 'session-1' } });
      }
      if (url.endsWith('/admin/sessions')) return json({ sessions: [] });
      if (url.includes('/admin/mfa/step-up/challenge')) {
        return json({
          step_up_challenge_id: 'stepup-challenge-1',
          expires_at: '2026-08-01T12:05:00.000Z',
        });
      }
      if (url.includes('/admin/mfa/step-up/verify')) {
        return json({
          step_up_token: 'stepup-token-1',
          expires_at: '2026-08-01T12:09:00.000Z',
        });
      }

      // P7-S9 audit viewer
      const auditBase = '/admin/audit-ops/markets/';
      if (url.includes(auditBase) && url.split('?')[0]?.endsWith('/entries')) {
        return json(options.auditList ?? auditListFixture());
      }
      if (
        url.includes(auditBase) &&
        url.includes('/entries/') &&
        url.endsWith('/raw')
      ) {
        if (options.rawStatus && options.rawStatus >= 400) {
          // One-shot failure (step-up denial, 403 as the RbacGuard returns)
          // so the retry after step-up succeeds.
          const status = options.rawStatus;
          options.rawStatus = undefined;
          return json(
            {
              error: {
                code:
                  status === 403
                    ? 'MFA_STEP_UP_REQUIRED'
                    : 'MFA_STEP_UP_REQUIRED',
                message: 'Verify your identity again to continue.',
              },
            },
            status,
          );
        }
        return json(
          options.auditRaw ??
            ({
              id: P7S9_ENTRY_ID,
              occurredAt: '2026-08-07T12:00:00.000Z',
              actorType: 'ADMIN_USER',
              actorId: P7S9_ACTOR_ID,
              marketId: P7S9_MARKET_ID,
              action: 'REDEMPTION_REFUND_APPROVE',
              entityType: 'redemption_order',
              entityId: '33333333-3333-4333-8333-333333333333',
              result: 'SUCCESS',
              reason: 'documented reason',
              requestId: 'req-1',
              ipAddress: '203.0.113.9',
              raw: true,
              before: { status: 'PENDING_CHECKER' },
              after: {
                status: 'APPROVED',
                id_number: '800101-14-5678',
                access_token:
                  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
                note: 'approved by checker',
              },
            } satisfies AdminAuditRawEntryDto),
        );
      }
      if (url.includes(auditBase) && url.includes('/entries/')) {
        return json(options.auditEntry ?? maskedAuditEntryFixture());
      }

      // P7-S9 basic reports
      const reportBase = '/admin/report-ops/markets/';
      if (
        url.includes(reportBase) &&
        url.split('?')[0]?.endsWith('/reports') &&
        method === 'GET'
      ) {
        return json(options.reportCatalog ?? reportCatalogFixture());
      }
      if (url.includes(reportBase) && url.includes('/reports/')) {
        const reportId = url.split('/reports/')[1] ?? 'R01';
        const catalog = options.reportCatalog ?? reportCatalogFixture();
        const item = catalog.items.find((entry) => entry.id === reportId);
        if (item) {
          return json(
            options.reportDetail ?? { ...item, marketId: P7S9_MARKET_ID },
          );
        }
        return json(
          { error: { code: 'REPORT_UNDEFINED', message: 'Unknown report.' } },
          422,
        );
      }

      return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    });
}
