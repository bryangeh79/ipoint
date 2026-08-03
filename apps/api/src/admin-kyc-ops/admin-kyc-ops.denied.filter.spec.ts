import {
  ConflictException,
  ForbiddenException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../platform-access/audit.service.js';
import { AdminKycDeniedAuditFilter } from './admin-kyc-ops.denied.filter.js';

/**
 * P7-S5C denied-sensitive-access audit filter unit tests (P7-S5C-FIX).
 *
 * The filter is controller-scoped and audits guard-level denials on every
 * `/admin/kyc-ops/**` route (permission, market, reason, step-up) with one
 * immutable privileged audit record (`result: 'DENIED'`) and then
 * serializes the standard error contract. These tests pin the audit
 * argument shape, the route-to-action mapping, fail-open behaviour (an
 * audit-append failure never blocks the denial response), and the
 * no-audit-for-non-denials rule.
 */

const ADMIN_USER_ID = 'admin-11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = 'acct-11111111-1111-4111-8111-111111111111';
const SESSION_ID = 'sess-11111111-1111-4111-8111-111111111111';
const MARKET_A = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const BRANCH_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = 'req-11111111';

interface AuditCall {
  actor: { type: 'ADMIN_USER'; id: string };
  action: string;
  entity: { type: string; id: string };
  marketId?: string;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  reason?: string;
  requestId?: string;
  ipAddress?: string;
  summary: string;
}

function buildRequest(overrides: Record<string, unknown> = {}): Request {
  const request = {
    method: 'GET',
    url: '/admin/kyc-ops/members/33333333-3333-4333-8333-333333333333/evidence',
    originalUrl:
      '/api/v1/admin/kyc-ops/members/33333333-3333-4333-8333-333333333333/evidence',
    ip: '127.0.0.1',
    route: { path: '/admin/kyc-ops/members/:id/evidence' },
    params: { id: CASE_ID },
    actor: {
      type: 'ADMIN_USER',
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      adminUserId: ADMIN_USER_ID,
    },
    adminMarketContext: { marketId: MARKET_A, contextVersion: 2 },
    requestId: REQUEST_ID,
    ...overrides,
  };
  return request as unknown as Request;
}

describe('AdminKycDeniedAuditFilter (P7-S5C denied-access audit)', () => {
  let filter: AdminKycDeniedAuditFilter;
  let audit: { recordPrivilegedAction: ReturnType<typeof vi.fn> };
  let request: Request;
  let response: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let host: ArgumentsHost;

  beforeEach(() => {
    audit = { recordPrivilegedAction: vi.fn().mockResolvedValue(undefined) };
    filter = new AdminKycDeniedAuditFilter(audit as unknown as AuditService);
    request = buildRequest();
    response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response as unknown as Response,
      }),
    } as ArgumentsHost;
  });

  it('audits a denied member evidence view (403 PERMISSION_DENIED) with the evidence action code', async () => {
    await filter.catch(
      new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      }),
      host,
    );

    expect(audit.recordPrivilegedAction).toHaveBeenCalledTimes(1);
    const call = audit.recordPrivilegedAction.mock.calls[0]?.[0] as AuditCall;
    expect(call).toMatchObject({
      actor: { type: 'ADMIN_USER', id: ADMIN_USER_ID },
      action: 'member.kyc.ops.evidence.view',
      entity: { type: 'member_kyc_case', id: CASE_ID },
      marketId: MARKET_A,
      result: 'DENIED',
      requestId: REQUEST_ID,
      ipAddress: '127.0.0.1',
    });
    expect(call.reason).toContain('PERMISSION_DENIED');
    expect(call.summary).toContain('DENIED');

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission for this action.',
        },
        requestId: REQUEST_ID,
        timestamp: expect.any(String) as unknown,
      }),
    );
  });

  it('audits a missing-recorded-reason denial (422 SENSITIVE_VIEW_REASON_REQUIRED)', async () => {
    await filter.catch(
      new UnprocessableEntityException({
        code: 'SENSITIVE_VIEW_REASON_REQUIRED',
        message: 'Enter a reason to view this information.',
      }),
      host,
    );

    expect(audit.recordPrivilegedAction).toHaveBeenCalledTimes(1);
    const call = audit.recordPrivilegedAction.mock.calls[0]?.[0] as AuditCall;
    expect(call.action).toBe('member.kyc.ops.evidence.view');
    expect(call.result).toBe('DENIED');
    expect(call.reason).toContain('SENSITIVE_VIEW_REASON_REQUIRED');
    expect(response.status).toHaveBeenCalledWith(422);
  });

  it('audits a market-access denial (403 MARKET_ACCESS_DENIED)', async () => {
    await filter.catch(
      new ForbiddenException({
        code: 'MARKET_ACCESS_DENIED',
        message: 'You do not have access to this market.',
      }),
      host,
    );

    expect(audit.recordPrivilegedAction).toHaveBeenCalledTimes(1);
    const call = audit.recordPrivilegedAction.mock.calls[0]?.[0] as AuditCall;
    expect(call.action).toBe('member.kyc.ops.evidence.view');
    expect(call.result).toBe('DENIED');
    expect(call.reason).toContain('MARKET_ACCESS_DENIED');
  });

  it('maps a member review-action denial to member.kyc.ops.decide', async () => {
    request = buildRequest({
      method: 'POST',
      url: '/admin/kyc-ops/members/33333333-3333-4333-8333-333333333333/approve',
      originalUrl:
        '/api/v1/admin/kyc-ops/members/33333333-3333-4333-8333-333333333333/approve',
      route: { path: '/admin/kyc-ops/members/:id/approve' },
    });

    await filter.catch(
      new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      }),
      host,
    );

    const call = audit.recordPrivilegedAction.mock.calls[0]?.[0] as AuditCall;
    expect(call).toMatchObject({
      action: 'member.kyc.ops.decide',
      entity: { type: 'member_kyc_case', id: CASE_ID },
      result: 'DENIED',
    });
  });

  it('maps a merchant evidence denial to merchant.kyc.ops.evidence.view on the branch entity', async () => {
    request = buildRequest({
      url: '/admin/kyc-ops/merchants/44444444-4444-4444-8444-444444444444/evidence',
      originalUrl:
        '/api/v1/admin/kyc-ops/merchants/44444444-4444-4444-8444-444444444444/evidence',
      route: { path: '/admin/kyc-ops/merchants/:branchId/evidence' },
      params: { branchId: BRANCH_ID },
    });

    await filter.catch(
      new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      }),
      host,
    );

    const call = audit.recordPrivilegedAction.mock.calls[0]?.[0] as AuditCall;
    expect(call).toMatchObject({
      action: 'merchant.kyc.ops.evidence.view',
      entity: { type: 'merchant_branch', id: BRANCH_ID },
      marketId: MARKET_A,
      result: 'DENIED',
    });
  });

  it('maps a merchant queue denial to merchant.kyc.ops.queue.view on the kyc_queue entity', async () => {
    request = buildRequest({
      url: '/admin/kyc-ops/merchants',
      originalUrl: '/api/v1/admin/kyc-ops/merchants',
      route: { path: '/admin/kyc-ops/merchants' },
      params: {},
    });

    await filter.catch(
      new ConflictException({
        code: 'MARKET_SELECTION_REQUIRED',
        message: 'Select an authorized market to continue.',
      }),
      host,
    );

    expect(audit.recordPrivilegedAction).toHaveBeenCalledTimes(1);
    const call = audit.recordPrivilegedAction.mock.calls[0]?.[0] as AuditCall;
    expect(call).toMatchObject({
      action: 'merchant.kyc.ops.queue.view',
      entity: { type: 'kyc_queue', id: MARKET_A },
      result: 'DENIED',
    });
    expect(response.status).toHaveBeenCalledWith(409);
  });

  it('falls back to the normalized URL path when request.route is absent', async () => {
    request = buildRequest({
      route: undefined,
      originalUrl:
        '/api/v1/admin/kyc-ops/members/33333333-3333-4333-8333-333333333333/evidence',
    });

    await filter.catch(
      new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      }),
      host,
    );

    const call = audit.recordPrivilegedAction.mock.calls[0]?.[0] as AuditCall;
    expect(call).toMatchObject({
      action: 'member.kyc.ops.evidence.view',
      entity: { type: 'member_kyc_case', id: CASE_ID },
      result: 'DENIED',
    });
  });

  it('does not audit non-denial responses (conflict codes outside the denial set)', async () => {
    request = buildRequest({
      method: 'POST',
      url: '/admin/kyc-ops/members/33333333-3333-4333-8333-333333333333/approve',
      originalUrl:
        '/api/v1/admin/kyc-ops/members/33333333-3333-4333-8333-333333333333/approve',
      route: { path: '/admin/kyc-ops/members/:id/approve' },
    });

    await filter.catch(
      new ConflictException({
        code: 'ADMIN_KYC_INVALID_STATE',
        message: 'The case is not in a reviewable state.',
      }),
      host,
    );

    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'ADMIN_KYC_INVALID_STATE',
          message: 'The case is not in a reviewable state.',
        },
      }),
    );
  });

  it('does not audit when the actor is not an ADMIN_USER', async () => {
    request = buildRequest({
      actor: {
        type: 'ACCOUNT',
        accountId: ACCOUNT_ID,
        sessionId: SESSION_ID,
      },
    });

    await filter.catch(
      new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission for this action.',
      }),
      host,
    );

    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('fail-open: an audit-append failure never blocks the denial response', async () => {
    audit.recordPrivilegedAction.mockRejectedValueOnce(
      new Error('audit store unavailable'),
    );
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(
        filter.catch(
          new ForbiddenException({
            code: 'PERMISSION_DENIED',
            message: 'You do not have permission for this action.',
          }),
          host,
        ),
      ).resolves.toBeUndefined();
      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'PERMISSION_DENIED' }),
        }),
      );
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('serializes unexpected non-HTTP exceptions as INTERNAL_ERROR without auditing', async () => {
    await filter.catch(new Error('boom'), host);

    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      }),
    );
  });
});
