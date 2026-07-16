import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MerchantOwnershipGuard } from '../guards/merchant-ownership.guard.js';
import type { MerchantService } from '../merchant.service.js';

describe('MerchantOwnershipGuard', () => {
  it('passes the authenticated account, target branch and market header to ownership validation', async () => {
    const assertOwnership = vi.fn().mockResolvedValue(undefined);
    const guard = new MerchantOwnershipGuard({
      assertOwnership,
    } as unknown as MerchantService);
    const context = contextFor({
      actor: { accountId: 'account-1' },
      params: { branchId: 'branch-1' },
      headers: { 'x-market-id': 'market-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(assertOwnership).toHaveBeenCalledWith(
      'account-1',
      'branch-1',
      'market-1',
    );
  });

  it('fails closed when branch or actor context is missing', async () => {
    const guard = new MerchantOwnershipGuard({
      assertOwnership: vi.fn(),
    } as unknown as MerchantService);

    await expect(
      guard.canActivate(contextFor({ params: {}, headers: {} })),
    ).resolves.toBe(false);
  });
});

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
