import {
  ConflictException,
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RbacGuard } from './rbac.guard.js';
import type { RbacService } from './rbac.service.js';

describe('P7-S2C RBAC guard', () => {
  const rbac = {
    isAllowed: vi.fn(),
    resolveCurrentMarket: vi.fn(),
    hasMarketAccess: vi.fn(),
    consumeStepUpGrant: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    rbac.isAllowed.mockResolvedValue(true);
    rbac.resolveCurrentMarket.mockResolvedValue({
      marketId: '11111111-1111-4111-8111-111111111111',
      contextVersion: 2,
    });
    rbac.hasMarketAccess.mockResolvedValue(true);
    rbac.consumeStepUpGrant.mockResolvedValue(true);
  });

  it('denies a crafted request carrying a deprecated permission', async () => {
    const guard = createGuard('wallet.adjustment.create');
    await expect(guard.canActivate(context(request()))).rejects.toMatchObject({
      response: { code: 'PERMISSION_DENIED' },
    });
    expect(rbac.isAllowed).not.toHaveBeenCalled();
  });

  it('denies a cross-market route/header mismatch', async () => {
    const guard = createGuard('member.read');
    const crafted = request({
      params: { marketId: '22222222-2222-4222-8222-222222222222' },
      headers: {
        'x-market-id': '22222222-2222-4222-8222-222222222222',
      },
    });
    await expect(guard.canActivate(context(crafted))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('makes a market grant revocation effective on the next request', async () => {
    const guard = createGuard('member.read');
    rbac.hasMarketAccess
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(guard.canActivate(context(request()))).resolves.toBe(true);
    await expect(guard.canActivate(context(request()))).rejects.toMatchObject({
      response: { code: 'MARKET_ACCESS_DENIED' },
    });
  });

  it('requires and consumes a fresh step-up grant for marked permissions', async () => {
    const guard = createGuard('admin.user.manage');
    rbac.consumeStepUpGrant.mockResolvedValueOnce(false);
    await expect(guard.canActivate(context(request()))).rejects.toMatchObject({
      response: { code: 'MFA_STEP_UP_REQUIRED' },
    });
    rbac.consumeStepUpGrant.mockResolvedValueOnce(true);
    await expect(
      guard.canActivate(
        context(request({ headers: { 'x-step-up-token': 'opaque' } })),
      ),
    ).resolves.toBe(true);
  });

  it('requires a server Current Admin Market before market-scoped access', async () => {
    const guard = createGuard('member.read');
    rbac.resolveCurrentMarket.mockResolvedValueOnce({
      marketId: null,
      contextVersion: 1,
    });
    await expect(guard.canActivate(context(request()))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('keeps action permission independent from role names', async () => {
    const guard = createGuard('rbac.role.read');
    rbac.isAllowed.mockResolvedValueOnce(false);
    await expect(guard.canActivate(context(request()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  function createGuard(permission: string): RbacGuard {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({ permission }),
    } as unknown as Reflector;
    return new RbacGuard(reflector, rbac as unknown as RbacService);
  }
});

function request(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  return {
    actor: {
      type: 'ADMIN_USER',
      accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      adminUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    },
    params: {},
    headers: {},
    body: {},
    ...overrides,
  } as AuthenticatedRequest;
}

function context(req: AuthenticatedRequest): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
