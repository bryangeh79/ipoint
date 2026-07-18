import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { MarketService } from '../market/market.service.js';
import type { MerchantListQuery } from './discovery.dto.js';
import { DiscoveryService } from './discovery.service.js';
import type { MerchantDiscoveryError } from './discovery.types.js';
import { OpenNowStatus } from './discovery.types.js';

const accountId = randomUUID();
const marketId = randomUUID();

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    merchant_id: 'MY-M-000001',
    display_name: 'Acme Group',
    branch_name: 'Acme Central',
    category: { id: randomUUID(), code: 'FOOD', name: 'Food' },
    categories: [{ id: randomUUID(), code: 'FOOD', name: 'Food' }],
    is_online: true,
    is_offline: true,
    distance: null,
    packages: [
      {
        code: 'A',
        name: 'Package A',
        rate: '2.500000',
        isDefault: true,
      },
    ],
    logo_url: 'https://cdn.example/logo.png',
    banner_url: null,
    about_us: 'Public about text',
    address: { city: 'Kuala Lumpur', region: 'W.P.' },
    business_hours: { monday: [{ open: '09:00', close: '18:00' }] },
    phone: '+60312345678',
    whatsapp: '+60123456789',
    website: 'https://example.com',
    social_links: { instagram: 'acme' },
    gallery: [{ url: 'https://cdn.example/gallery.png', position: 1 }],
    longitude: 101.6869,
    latitude: 3.139,
    internal_email: 'private@example.com',
    kyc_document: 'secret',
    admin_notes: 'private',
    ...overrides,
  };
}

function makeService(discoveryRows: Record<string, unknown>[] = [row()]) {
  const query = vi.fn(
    (text: string): Promise<{ rows: Record<string, unknown>[] }> => {
      if (text.includes('from markets')) {
        return {
          rows: [{ status: 'ACTIVE', timezone: 'Asia/Kuala_Lumpur' }],
        };
      }
      if (text.includes('from merchant_categories')) {
        return {
          rows: [
            {
              id: randomUUID(),
              code: 'FOOD',
              name: 'Food',
              sortOrder: 1,
            },
          ],
        };
      }
      return { rows: discoveryRows };
    },
  );
  const database = { pool: { query } } as unknown as DatabaseService;
  const marketService = {
    getMarket: vi.fn().mockResolvedValue({
      currentMarket: {
        id: marketId,
        code: 'MY',
        name: 'Malaysia',
        isCurrent: true,
        isEnabled: true,
        sortOrder: 0,
      },
      enabledMarkets: [],
    }),
  } as unknown as MarketService;
  return { service: new DiscoveryService(database, marketService), query };
}

const baseFilters: MerchantListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'relevance',
};

describe('DiscoveryService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('list returns current market merchants and excludes other markets in SQL', async () => {
    const { service, query } = makeService();
    const result = await service.listMerchants(accountId, baseFilters);
    expect(result.items[0]?.merchantId).toBe('MY-M-000001');
    const discoveryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_branches'),
    );
    expect(discoveryCall?.[0]).toContain('b.market_id = $1');
    expect(discoveryCall?.[1]).toEqual([marketId]);
  });

  it('filters work for category and online/offline', async () => {
    const { service, query } = makeService();
    await service.listMerchants(accountId, {
      ...baseFilters,
      category: 'FOOD',
      isOnline: true,
      isOffline: false,
    });
    const discoveryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_branches'),
    );
    expect(discoveryCall?.[0]).toContain('merchant_branch_categories fbc');
    expect(discoveryCall?.[0]).toContain('b.is_online');
    expect(discoveryCall?.[0]).toContain('b.is_offline');
    expect(discoveryCall?.[1]).toEqual([marketId, 'FOOD', true, false]);
  });

  it('searches by name/query with trigram relevance', async () => {
    const { service, query } = makeService();
    await service.listMerchants(accountId, {
      ...baseFilters,
      query: 'Acme',
    });
    const discoveryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_branches'),
    );
    expect(discoveryCall?.[0]).toContain('b.name % $2');
    expect(discoveryCall?.[0]).toContain('similarity(b.name, $2)');
    expect(discoveryCall?.[1]).toEqual([marketId, 'Acme']);
  });

  it('paginates results', async () => {
    const { service } = makeService([
      row({ merchant_id: 'M-1' }),
      row({ merchant_id: 'M-2' }),
      row({ merchant_id: 'M-3' }),
    ]);
    const result = await service.listMerchants(accountId, {
      ...baseFilters,
      page: 2,
      pageSize: 2,
    });
    expect(result).toMatchObject({ total: 3, totalPages: 2, page: 2 });
    expect(result.items.map((item) => item.merchantId)).toEqual(['M-3']);
  });

  it('uses stable requested sorting', async () => {
    const { service, query } = makeService();
    await service.listMerchants(accountId, { ...baseFilters, sort: 'newest' });
    const discoveryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_branches'),
    );
    expect(discoveryCall?.[0]).toContain(
      'order by b.created_at desc, lower(b.name), b.id',
    );
  });

  it('openNow filter uses the market timezone schedule', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T02:00:00.000Z'));
    const { service } = makeService();
    const open = await service.listMerchants(accountId, {
      ...baseFilters,
      openNow: true,
    });
    const closed = await service.listMerchants(accountId, {
      ...baseFilters,
      openNow: false,
    });
    expect(open.total).toBe(1);
    expect(open.items[0]?.openNow).toBe(OpenNowStatus.OPEN);
    expect(closed.total).toBe(0);
  });

  it('handles overnight hours and missing schedules', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T17:00:00.000Z'));
    const { service } = makeService();
    expect(
      service.isOpenNow(
        { monday: [{ open: '22:00', close: '02:00' }] },
        'Asia/Kuala_Lumpur',
      ),
    ).toBe(OpenNowStatus.OPEN);
    expect(service.isOpenNow(null, 'Asia/Kuala_Lumpur')).toBe(
      OpenNowStatus.UNKNOWN,
    );
  });

  it('nearby applies radius and current market isolation', async () => {
    const { service, query } = makeService([row({ distance: 1.25 })]);
    const result = await service.findNearby(accountId, 3.139, 101.6869, 5, {
      page: 1,
      pageSize: 20,
    });
    const discoveryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_branches'),
    );
    expect(discoveryCall?.[0]).toContain('b.coordinates <@ circle');
    expect(discoveryCall?.[0]).toContain('b.market_id = $1');
    expect(result.items[0]?.distance).toBe(1.25);
  });

  it('nearby sorts by distance then name and id', async () => {
    const { service, query } = makeService();
    await service.findNearby(accountId, 3.139, 101.6869, 5, {
      page: 1,
      pageSize: 20,
    });
    const discoveryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_branches'),
    );
    expect(discoveryCall?.[0]).toMatch(
      /order by b\.coordinates <-> point\([^)]*\), lower\(b\.name\), b\.id/u,
    );
  });

  it('detail returns full public info without sensitive fields', async () => {
    const { service } = makeService();
    const result = await service.getMerchant(accountId, 'MY-M-000001');
    expect(result).toMatchObject({
      merchantId: 'MY-M-000001',
      aboutUs: 'Public about text',
      phone: '+60312345678',
      coordinates: { latitude: 3.139, longitude: 101.6869 },
    });
    expect(result).not.toHaveProperty('internal_email');
    expect(result).not.toHaveProperty('kyc_document');
    expect(result).not.toHaveProperty('admin_notes');
  });

  it('rejects cross-market or missing merchant detail', async () => {
    const { service } = makeService([]);
    await expect(
      service.getMerchant(accountId, 'OTHER-MARKET-MERCHANT'),
    ).rejects.toMatchObject({
      code: 'DISCOVERY_MERCHANT_NOT_FOUND',
    } satisfies Partial<MerchantDiscoveryError>);
  });

  it('hides suspended and closed merchants through active visibility rules', async () => {
    const { service, query } = makeService([]);
    await service.listMerchants(accountId, baseFilters);
    const discoveryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_branches'),
    );
    expect(discoveryCall?.[0]).toContain("b.status = 'ACTIVE'");
    expect(discoveryCall?.[0]).toContain('b.is_publicly_visible = true');
  });

  it('lists active categories for the current market', async () => {
    const { service, query } = makeService();
    const result = await service.getCategories(accountId);
    expect(result[0]).toMatchObject({ code: 'FOOD', sortOrder: 1 });
    const categoryCall = query.mock.calls.find(([text]) =>
      text.includes('from merchant_categories'),
    );
    expect(categoryCall?.[1]).toEqual([marketId]);
  });

  it('returns empty paginated results', async () => {
    const { service } = makeService([]);
    await expect(
      service.listMerchants(accountId, baseFilters),
    ).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
  });
});
