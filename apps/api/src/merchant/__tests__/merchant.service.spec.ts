import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../../auth/auth.service.js';
import type { DatabaseService } from '../../database/database.service.js';
import type { AuditService } from '../../platform-access/audit.service.js';
import type { MarketService } from '../../platform-access/market.service.js';
import { updateMerchantProfileSchema } from '../dto/profile.dto.js';
import {
  deriveMerchantOperationalStatus,
  MerchantService,
} from '../merchant.service.js';

describe('MerchantService', () => {
  it.each([
    [false, false, false, 'PENDING_APPLICATION'],
    [true, false, false, 'PENDING_KYC'],
    [true, true, false, 'PENDING_MCP'],
    [true, true, true, 'ACTIVE'],
  ] as const)(
    'derives independent application/KYC/MCP activation inputs',
    (applicationApproved, kycApproved, threshold, expected) => {
      expect(
        deriveMerchantOperationalStatus({
          applicationApproved,
          kycApproved,
          meetsActivationThreshold: threshold,
        }),
      ).toBe(expected);
    },
  );

  it('does not deactivate a merchant that was activated before MCP fell below 100', () => {
    expect(
      deriveMerchantOperationalStatus({
        applicationApproved: true,
        kycApproved: true,
        meetsActivationThreshold: false,
        previouslyActivated: true,
      }),
    ).toBe('ACTIVE');
  });

  it.each(['email', 'primary_email', 'login_email', 'contact_email'])(
    'rejects immutable email input %s instead of silently stripping it',
    (field) => {
      expect(
        updateMerchantProfileSchema.safeParse({ [field]: 'new@example.com' })
          .success,
      ).toBe(false);
    },
  );

  it('allows the primary owner in the matching market', async () => {
    const limit = vi.fn().mockResolvedValue([{ marketId: 'market-1' }]);
    const database = databaseWithOwnershipResult(limit);
    const service = createService(database);

    await expect(
      service.assertOwnership('account-1', 'branch-1', 'market-1'),
    ).resolves.toBeUndefined();
  });

  it('denies an account without merchant group ownership', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const service = createService(databaseWithOwnershipResult(limit));

    await expect(
      service.assertOwnership('account-2', 'branch-1', 'market-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a market header that does not match the branch market', async () => {
    const limit = vi.fn().mockResolvedValue([{ marketId: 'market-1' }]);
    const service = createService(databaseWithOwnershipResult(limit));

    await expect(
      service.assertOwnership('account-1', 'branch-1', 'market-2'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'MERCHANT_MARKET_MISMATCH',
      }) as unknown,
    });
  });
});

function databaseWithOwnershipResult(limit: ReturnType<typeof vi.fn>) {
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  const select = vi.fn().mockReturnValue({ from });
  return { db: { select } } as unknown as DatabaseService;
}

function createService(database: DatabaseService): MerchantService {
  return new MerchantService(
    database,
    {} as AuthService,
    {} as MarketService,
    {} as AuditService,
  );
}
