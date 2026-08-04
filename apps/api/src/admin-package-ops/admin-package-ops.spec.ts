import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import { AdminPackageOpsService } from './admin-package-ops.service.js';

/**
 * P7-S6A adapter unit tests: the read-only catalog/special-percentage
 * projections (grouping, exact decimal strings, ISO timestamps) and the
 * audit-of-view write on the privileged special-percentage read. The
 * database query builder is mocked; the adapter's own projection logic is
 * the unit under test. No owner service is invoked (the adapter never
 * delegates writes).
 */

interface DbShape {
  db: { select: ReturnType<typeof vi.fn> };
}

let database: DbShape;
let audit: { recordPrivilegedAction: ReturnType<typeof vi.fn> };
let service: AdminPackageOpsService;

/** Configure chained selects; each row set resolves one select() call. */
function mockDatabase(...rowSets: unknown[][]): void {
  const makeSelect = (rows: unknown[]) => {
    const from = vi.fn();
    const where = vi.fn();
    const orderBy = vi.fn();
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      from,
      where,
      orderBy,
    };
    const proxy = new Proxy(chain, {
      get(target, prop: string) {
        if (prop === 'then') return undefined;
        if (!(prop in target)) target[prop] = vi.fn();
        return target[prop];
      },
    });
    from.mockReturnValue(proxy);
    where.mockReturnValue(proxy);
    orderBy.mockResolvedValue(rows);
    return { select: vi.fn().mockReturnValue(proxy), orderBy };
  };

  const selects = rowSets.map((rows) => makeSelect(rows).select());
  const select = vi.fn();
  for (const prepared of selects) {
    select.mockReturnValueOnce(prepared);
  }
  database = { db: { select } };
}

beforeEach(() => {
  audit = { recordPrivilegedAction: vi.fn().mockResolvedValue(undefined) };
});

describe('AdminPackageOpsService (P7-S6A)', () => {
  it('groups versions under their profiles and returns exact decimal strings', async () => {
    mockDatabase(
      [
        {
          id: 'sfp-a',
          code: 'A',
          name: 'Package A',
          description: 'Standard package A',
        },
        { id: 'sfp-b', code: 'B', name: 'Package B', description: null },
      ],
      // Versions arrive from the DB already ordered newest-first.
      [
        {
          id: 'sfv-2',
          profile_id: 'sfp-a',
          rate: '5.000000',
          status: 'DRAFT',
          effective_from: new Date('2026-02-01T00:00:00.000Z'),
          effective_to: new Date('2027-02-01T00:00:00.000Z'),
          created_at: new Date('2026-01-03T00:00:00.000Z'),
        },
        {
          id: 'sfv-1',
          profile_id: 'sfp-a',
          rate: '2.500000',
          status: 'ACTIVE',
          effective_from: new Date('2026-01-01T00:00:00.000Z'),
          effective_to: null,
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    );
    service = new AdminPackageOpsService(
      database as unknown as DatabaseService,
      audit as unknown as AuditService,
    );

    const catalog = await service.catalog('market-a');

    expect(catalog.marketId).toBe('market-a');
    expect(catalog.items).toHaveLength(2);
    expect(catalog.items[0]).toMatchObject({
      code: 'A',
      name: 'Package A',
      description: 'Standard package A',
    });
    // Versions grouped under the right profile, newest first.
    expect(catalog.items[0]?.versions).toHaveLength(2);
    expect(catalog.items[0]?.versions[0]).toMatchObject({
      id: 'sfv-2',
      rate: '5.000000',
      status: 'DRAFT',
      effective_from: '2026-02-01T00:00:00.000Z',
      effective_to: '2027-02-01T00:00:00.000Z',
    });
    expect(catalog.items[0]?.versions[1]).toMatchObject({
      id: 'sfv-1',
      rate: '2.500000',
      status: 'ACTIVE',
      effective_to: null,
    });
    // Profile B has no versions.
    expect(catalog.items[1]?.versions).toEqual([]);
  });

  it('preserves numeric rates as strings without float conversion', async () => {
    mockDatabase(
      [{ id: 'sfp-a', code: 'A', name: 'Package A', description: null }],
      [
        {
          id: 'sfv-x',
          profile_id: 'sfp-a',
          rate: '0.012500',
          status: 'ACTIVE',
          effective_from: '2026-01-01T00:00:00.000Z',
          effective_to: null,
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ],
    );
    service = new AdminPackageOpsService(
      database as unknown as DatabaseService,
      audit as unknown as AuditService,
    );

    const catalog = await service.catalog('market-a');

    expect(catalog.items[0]?.versions[0]?.rate).toBe('0.012500');
    // Never a JS float.
    expect(typeof catalog.items[0]?.versions[0]?.rate).toBe('string');
  });

  it('projects special percentages and audits the privileged view', async () => {
    mockDatabase([
      {
        id: 'sp-1',
        rate: '12.500000',
        description: 'Special launch partner',
        created_by_admin_user_id: 'admin-1',
        created_at: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
    service = new AdminPackageOpsService(
      database as unknown as DatabaseService,
      audit as unknown as AuditService,
    );

    const result = await service.specialPercentages('market-a', {
      adminUserId: 'admin-1',
      requestId: 'req-1',
      ipAddress: '127.0.0.1',
    });

    expect(result.marketId).toBe('market-a');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'sp-1',
      rate: '12.500000',
      description: 'Special launch partner',
      created_by_admin_user_id: 'admin-1',
      created_at: '2026-03-01T00:00:00.000Z',
    });
    expect(audit.recordPrivilegedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'ADMIN_USER', id: 'admin-1' },
        action: 'ADMIN_SPECIAL_PERCENTAGE_LIST_VIEWED',
        entity: { type: 'SPECIAL_PERCENTAGE', id: 'market-a' },
        marketId: 'market-a',
        result: 'SUCCESS',
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
      }),
    );
  });

  it('returns an empty catalog and writes no audit for the ordinary read', async () => {
    mockDatabase([], []);
    service = new AdminPackageOpsService(
      database as unknown as DatabaseService,
      audit as unknown as AuditService,
    );

    const catalog = await service.catalog('market-a');

    expect(catalog.items).toEqual([]);
    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
  });
});
