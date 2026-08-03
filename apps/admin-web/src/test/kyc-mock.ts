import { vi } from 'vitest';
import type {
  AdminKycOpsCaseDetailDto,
  AdminKycOpsListPageDto,
  AdminKycOpsMerchantDetailDto,
  AdminKycOpsMerchantQueueDto,
} from '@ipoint/api-client';
import {
  kycOpsMarketA,
  memberKycDetailFixture,
  memberKycEvidenceFixture,
  memberKycListPageFixture,
  merchantKycDetailFixture,
  merchantKycEvidenceFixture,
  merchantKycQueueFixture,
} from './kyc-fixtures.js';

/**
 * Shared P7-S5C page-test mock. Handles the shell endpoints (login, MFA,
 * bootstrap, markets, sessions) exactly like the member-ops mock, plus the
 * kyc-ops adapter endpoints with a mutable case store so review actions and
 * the evidence flow can be exercised end to end in jsdom.
 */

export interface KycOpsMockOptions {
  permissions?: string[];
  listBody?: AdminKycOpsListPageDto;
  merchantQueueBody?: AdminKycOpsMerchantQueueDto;
  detailFails?: { status: number; code: string; message?: string };
  listFails?: { status: number; code: string; message?: string };
  merchantDetailFails?: { status: number; code: string; message?: string };
  initialDetail?: AdminKycOpsCaseDetailDto;
  initialMerchantDetail?: AdminKycOpsMerchantDetailDto;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function mockKycOpsApi(
  options: KycOpsMockOptions | readonly string[] = {},
) {
  const resolved: KycOpsMockOptions = Array.isArray(options)
    ? { permissions: [...options] }
    : (options as KycOpsMockOptions);
  const permissions = resolved.permissions ?? [
    'member.kyc.read',
    'member.kyc.decide',
    'member.kyc.evidence.view',
    'merchant.kyc.view',
    'merchant.kyc.approve',
    'merchant.kyc.evidence.view',
  ];
  let memberDetail = resolved.initialDetail ?? memberKycDetailFixture();
  let merchantDetail =
    resolved.initialMerchantDetail ?? merchantKycDetailFixture();
  const market = {
    id: kycOpsMarketA,
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
          currentMarketId: kycOpsMarketA,
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

      // ── Member KYC endpoints ────────────────────────────────────────
      const memberEvidenceMatch =
        /\/admin\/kyc-ops\/members\/([^/]+)\/evidence$/u.exec(url);
      if (memberEvidenceMatch && method === 'GET') {
        if (!permissions.includes('member.kyc.evidence.view')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        const reason = headers.get('x-sensitive-access-reason')?.trim();
        if (!reason || reason.length < 8 || reason.length > 500) {
          return json({ code: 'SENSITIVE_VIEW_REASON_REQUIRED' }, 422);
        }
        if (!headers.get('x-step-up-token')) {
          return json({ code: 'MFA_STEP_UP_REQUIRED' }, 403);
        }
        return json(memberKycEvidenceFixture());
      }

      const memberActionMatch =
        /\/admin\/kyc-ops\/members\/([^/]+)\/(start-review|request-more-info|approve|reject|require-reverification)$/u.exec(
          url,
        );
      if (memberActionMatch && method === 'POST') {
        const action = memberActionMatch[2] ?? '';
        const statusMap: Record<string, AdminKycOpsCaseDetailDto['status']> = {
          'start-review': 'UNDER_REVIEW',
          'request-more-info': 'MORE_INFO_REQUIRED',
          approve: 'APPROVED',
          reject: 'REJECTED',
          'require-reverification': 'REVERIFICATION_REQUIRED',
        };
        const nextStatus = statusMap[action];
        if (nextStatus) {
          memberDetail = {
            ...memberKycEvidenceFixture(),
            status: nextStatus,
            reviewedAt:
              action === 'approve' || action === 'reject'
                ? '2026-08-01T12:30:00.000Z'
                : null,
          };
        }
        return json(memberDetail);
      }

      const memberDetailMatch = /\/admin\/kyc-ops\/members\/([^/]+)$/u.exec(
        url,
      );
      if (memberDetailMatch && method === 'GET') {
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
        return json(memberDetail);
      }

      const memberListMatch = /\/admin\/kyc-ops\/members(\?|$)/u.exec(url);
      if (memberListMatch && method === 'GET') {
        if (resolved.listFails) {
          return json(
            {
              code: resolved.listFails.code,
              message: resolved.listFails.message ?? resolved.listFails.code,
            },
            resolved.listFails.status,
          );
        }
        return json(resolved.listBody ?? memberKycListPageFixture());
      }

      // ── Merchant KYC endpoints ──────────────────────────────────────
      const merchantEvidenceMatch =
        /\/admin\/kyc-ops\/merchants\/([^/]+)\/evidence$/u.exec(url);
      if (merchantEvidenceMatch && method === 'GET') {
        if (!permissions.includes('merchant.kyc.evidence.view')) {
          return json({ code: 'PERMISSION_DENIED' }, 403);
        }
        const reason = headers.get('x-sensitive-access-reason')?.trim();
        if (!reason || reason.length < 8 || reason.length > 500) {
          return json({ code: 'SENSITIVE_VIEW_REASON_REQUIRED' }, 422);
        }
        if (!headers.get('x-step-up-token')) {
          return json({ code: 'MFA_STEP_UP_REQUIRED' }, 403);
        }
        return json(merchantKycEvidenceFixture());
      }

      const merchantReviewMatch =
        /\/admin\/kyc-ops\/merchants\/([^/]+)\/review$/u.exec(url);
      if (merchantReviewMatch && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as {
          decision: string;
          reason: string;
          rejected_fields?: string[];
        };
        merchantDetail = {
          ...merchantKycEvidenceFixture(),
          current: {
            ...merchantKycEvidenceFixture().current,
            status: body.decision,
            review: {
              review_id: 'review-1',
              reviewer_id: 'admin-1',
              decision: body.decision,
              reason: body.reason,
              rejected_fields: body.rejected_fields ?? [],
              reviewed_at: '2026-08-01T12:30:00.000Z',
            },
          },
        };
        return json({
          review_id: 'review-1',
          submission_id: 'sub-1',
          branch_id: kycOpsMarketA,
          kyc_status: body.decision,
          operational_status:
            body.decision === 'APPROVED' ? 'ACTIVE' : 'PENDING_KYC',
          reason: body.reason,
          rejected_fields: body.rejected_fields ?? [],
          reviewed_at: '2026-08-01T12:30:00.000Z',
        });
      }

      const merchantDetailMatch = /\/admin\/kyc-ops\/merchants\/([^/]+)$/u.exec(
        url,
      );
      if (merchantDetailMatch && method === 'GET') {
        if (resolved.merchantDetailFails) {
          return json(
            {
              code: resolved.merchantDetailFails.code,
              message:
                resolved.merchantDetailFails.message ??
                resolved.merchantDetailFails.code,
            },
            resolved.merchantDetailFails.status,
          );
        }
        return json(merchantDetail);
      }

      const merchantListMatch = /\/admin\/kyc-ops\/merchants(\?|$)/u.exec(url);
      if (merchantListMatch && method === 'GET') {
        return json(resolved.merchantQueueBody ?? merchantKycQueueFixture());
      }

      return json(
        { code: 'NOT_MOCKED', message: `Unhandled: ${method} ${url}` },
        500,
      );
    });

  return {
    fetchSpy,
    getMemberDetail: () => memberDetail,
    setMemberDetail: (next: AdminKycOpsCaseDetailDto) => {
      memberDetail = next;
    },
    getMerchantDetail: () => merchantDetail,
    setMerchantDetail: (next: AdminKycOpsMerchantDetailDto) => {
      merchantDetail = next;
    },
  };
}
