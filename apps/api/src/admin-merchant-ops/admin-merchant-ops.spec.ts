import { NotFoundException } from '@nestjs/common';
import type { Database } from '@ipoint/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { McpService } from '../merchant/mcp.service.js';
import type { MerchantService } from '../merchant/merchant.service.js';
import { AdminMerchantOpsService } from './admin-merchant-ops.service.js';

/**
 * P7-S5B adapter unit tests: composition, cross-market isolation, MCP-missing
 * handling, and the read-only package-history projection. Owner services are
 * mocked; the adapter's own logic (isolation + composition + projection) is
 * the unit under test.
 */

const profileA = {
  branch_id: 'branch-a',
  merchant_id: 'merchant-a',
  market_id: 'market-a',
  display_name: 'Branch A',
  primary_email: 'owner@example.com',
  phone: '+60123456789',
  address: '1 Jalan Test',
  about: null,
  business_hours: null,
  website: null,
  whatsapp: null,
  socials: null,
  logo_object_key: null,
  banner_object_key: null,
  gallery: [],
};

const application = {
  application_id: 'app-1',
  status: 'SUBMITTED',
  operational_status: 'PENDING_APPLICATION',
  submissions: [
    { id: 'sub-1', version: 1, submitted_at: new Date('2026-01-01') },
  ],
  reviews: [],
};

const kyc = {
  current: {
    submission_id: 'kyc-1',
    status: 'SUBMITTED',
    data: { pic_identity: { identity_number: '***1234' } },
  },
  previous: null,
};

const mcpAccount = {
  id: 'mcp-1',
  branch_id: 'branch-a',
  market_id: 'market-a',
  available_balance: '100.0000000000',
  total_balance: '100.0000000000',
  status: 'ACTIVE',
  version: 1,
};

function mcpNotFound(): NotFoundException {
  return new NotFoundException({ code: 'MCP_ACCOUNT_NOT_FOUND' });
}

describe('AdminMerchantOpsService (P7-S5B)', () => {
  let merchants: {
    getProfile: ReturnType<typeof vi.fn>;
    getApplication: ReturnType<typeof vi.fn>;
    getKyc: ReturnType<typeof vi.fn>;
  };
  let mcp: {
    summary: ReturnType<typeof vi.fn>;
    reconcile: ReturnType<typeof vi.fn>;
    adminLedger: ReturnType<typeof vi.fn>;
  };
  let database: { db: { select: ReturnType<typeof vi.fn> } };
  let service: AdminMerchantOpsService;

  beforeEach(() => {
    merchants = {
      getProfile: vi.fn(),
      getApplication: vi.fn(),
      getKyc: vi.fn(),
    };
    mcp = {
      summary: vi.fn(),
      reconcile: vi.fn(),
      adminLedger: vi.fn(),
    };
    const from = vi.fn();
    const innerJoin = vi.fn();
    const leftJoin = vi.fn();
    const where = vi.fn();
    const orderBy = vi.fn();
    const limit = vi.fn();
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      from,
      innerJoin,
      leftJoin,
      where,
      orderBy,
      limit,
    };
    const chainable = new Proxy(chain, {
      get(target, prop: string) {
        if (prop === 'then') return undefined;
        if (!(prop in target)) target[prop] = vi.fn();
        return target[prop];
      },
    });
    database = { db: { select: vi.fn().mockReturnValue(chainable) } };
    service = new AdminMerchantOpsService(
      merchants as unknown as MerchantService,
      mcp as unknown as McpService,
      database as unknown as DatabaseService,
    );
    from.mockReturnValue(chainable);
    innerJoin.mockReturnValue(chainable);
    leftJoin.mockReturnValue(chainable);
    where.mockReturnValue(chainable);
    orderBy.mockReturnValue(chainable);
    limit.mockResolvedValue([
      {
        assignment_id: 'assign-1',
        service_fee_version_id: 'sfv-1',
        special_percentage_id: 'sp-1',
        status: 'ACTIVE',
        is_default: true,
        version: 2,
        created_at: new Date('2026-02-01T00:00:00.000Z'),
        updated_at: new Date('2026-02-02T00:00:00.000Z'),
        service_fee_profile_id: 'sfp-1',
        service_fee_profile_code: 'A',
        service_fee_profile_name: 'Package A',
        rate: '0.0125',
        effective_from: new Date('2026-01-01T00:00:00.000Z'),
        effective_to: null,
        special_percentage_rate: '0.05',
        special_percentage_description: 'Special launch',
      },
    ]);
  });

  it('composes owner reads into a selected-market branch detail', async () => {
    merchants.getProfile.mockResolvedValue(profileA);
    merchants.getApplication.mockResolvedValue(application);
    merchants.getKyc.mockResolvedValue(kyc);
    mcp.summary.mockResolvedValue(mcpAccount);
    mcp.reconcile.mockResolvedValue({
      account_id: 'mcp-1',
      stored: { total: '100.0000000000', available: '100.0000000000' },
      computed: {
        total: '100.0000000000',
        available: '100.0000000000',
        entries: 1,
      },
      matches: true,
    });
    mcp.adminLedger.mockResolvedValue({
      items: [{ id: 'ledger-1', entry_type: 'OPENING_BALANCE' }],
      limit: 10,
      offset: 0,
    });

    const detail = await service.branchDetail('market-a', 'branch-a');

    expect(detail.profile.display_name).toBe('Branch A');
    expect(detail.application.status).toBe('SUBMITTED');
    expect(detail.kyc.current?.data).toEqual({
      pic_identity: { identity_number: '***1234' },
    });
    expect(detail.mcp?.account.id).toBe('mcp-1');
    expect(detail.mcp?.reconciliation?.matches).toBe(true);
    expect(detail.mcp?.recent_ledger?.items[0]?.entry_type).toBe(
      'OPENING_BALANCE',
    );
    // Package history projection: normalized timestamps + decimal strings.
    expect(detail.packages.items).toHaveLength(1);
    expect(detail.packages.items[0]).toMatchObject({
      assignment_id: 'assign-1',
      service_fee_profile_code: 'A',
      rate: '0.0125',
      special_percentage_rate: '0.05',
      is_default: true,
      version: 2,
      effective_from: '2026-01-01T00:00:00.000Z',
      created_at: '2026-02-01T00:00:00.000Z',
    });
    // Delegation calls happened against the owner services.
    expect(merchants.getProfile).toHaveBeenCalledWith('branch-a');
    expect(merchants.getApplication).toHaveBeenCalledWith('branch-a');
    expect(merchants.getKyc).toHaveBeenCalledWith('branch-a');
    expect(mcp.summary).toHaveBeenCalledWith('branch-a');
    expect(mcp.reconcile).toHaveBeenCalledWith('market-a', 'mcp-1');
    expect(mcp.adminLedger).toHaveBeenCalledWith('market-a', 'mcp-1', {
      limit: 10,
      offset: 0,
    });
  });

  it('hides out-of-market branches as not found (market isolation)', async () => {
    merchants.getProfile.mockResolvedValue({
      ...profileA,
      market_id: 'market-b',
    });

    await expect(
      service.branchDetail('market-a', 'branch-a'),
    ).rejects.toMatchObject({
      response: { code: 'MERCHANT_BRANCH_NOT_FOUND' },
      status: 404,
    });
    // No owner read beyond the profile is issued for an out-of-market branch.
    expect(merchants.getApplication).not.toHaveBeenCalled();
    expect(mcp.summary).not.toHaveBeenCalled();
  });

  it('surfaces owner branch-not-found unchanged', async () => {
    merchants.getProfile.mockRejectedValue(
      new NotFoundException({ code: 'MERCHANT_BRANCH_NOT_FOUND' }),
    );
    await expect(
      service.branchDetail('market-a', 'branch-a'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns null MCP summary when the branch has no MCP account', async () => {
    merchants.getProfile.mockResolvedValue(profileA);
    merchants.getApplication.mockResolvedValue(application);
    merchants.getKyc.mockResolvedValue(kyc);
    mcp.summary.mockRejectedValue(mcpNotFound());

    const detail = await service.branchDetail('market-a', 'branch-a');

    expect(detail.mcp).toBeNull();
    expect(mcp.reconcile).not.toHaveBeenCalled();
  });

  it('keeps reconciliation null when reconcile fails with no account', async () => {
    merchants.getProfile.mockResolvedValue(profileA);
    merchants.getApplication.mockResolvedValue(application);
    merchants.getKyc.mockResolvedValue(kyc);
    mcp.summary.mockResolvedValue(mcpAccount);
    mcp.reconcile.mockRejectedValue(mcpNotFound());
    mcp.adminLedger.mockResolvedValue({ items: [], limit: 10, offset: 0 });

    const detail = await service.branchDetail('market-a', 'branch-a');

    expect(detail.mcp?.account.id).toBe('mcp-1');
    expect(detail.mcp?.reconciliation).toBeNull();
    expect(detail.mcp?.recent_ledger?.items).toEqual([]);
  });

  it('propagates unexpected owner errors', async () => {
    merchants.getProfile.mockResolvedValue(profileA);
    merchants.getApplication.mockResolvedValue(application);
    merchants.getKyc.mockResolvedValue(kyc);
    mcp.summary.mockRejectedValue(new Error('owner boom'));

    await expect(service.branchDetail('market-a', 'branch-a')).rejects.toThrow(
      'owner boom',
    );
  });
});
