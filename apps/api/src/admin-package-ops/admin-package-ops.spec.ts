import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import type { PackageService } from '../merchant/package.service.js';
import { createSpecialPercentageSchema } from './admin-package-ops.dto.js';
import { AdminPackageOpsService } from './admin-package-ops.service.js';
import { AdminPackageOpsError } from './admin-package-ops.types.js';
import type { AdminPackageOpsErrorCode } from './admin-package-ops.types.js';

/**
 * P7-S6A adapter unit tests.
 *
 * The adapter is a Phase 7 read projection + ONE orchestrated create over
 * the D-051-secured Phase 1 owner command (`PackageService
 * .createSpecialPercentage`). Every owner-level business control (RBAC,
 * selected market, mandatory reason, operation-scoped idempotency with the
 * canonical payload hash, atomic immutable audit) lives inside the owner —
 * the adapter performs NO such control of its own.
 *
 * This spec therefore asserts:
 * 1. The read projections (grouping, exact decimal strings, ISO
 *    timestamps) and the audit-of-view write on the privileged read.
 * 2. Delegation: the owner command receives the server actor (adminUserId
 *    + requestId/ipAddress + currentMarketId/marketContextVersion), the
 *    validated DTO and the client Idempotency-Key.
 * 3. The full owner error → S6A external contract mapping (every
 *    `SPECIAL_PERCENTAGE_*` code preserved verbatim; unknown codes
 *    propagate as-is, never swallowed into a 2xx).
 * 4. The transport DTO (exact-decimal rate ≤6dp in (0, 100], mandatory
 *    description + reason, strict schema rejecting actor-shaped fields).
 *
 * The database/audit/owner surfaces are mocked; the HTTP contract is
 * exercised by the integration suite on a fresh database.
 */

interface DbShape {
  db: { select: ReturnType<typeof vi.fn> };
}

let database: DbShape;
let audit: { recordPrivilegedAction: ReturnType<typeof vi.fn> };
let owner: Pick<PackageService, 'createSpecialPercentage'>;
let service: AdminPackageOpsService;

const MARKET_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR = {
  adminUserId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-123',
  ipAddress: '127.0.0.1',
  currentMarketId: MARKET_ID,
  marketContextVersion: 3,
};

const CREATE_INPUT = {
  rate: '12.500000',
  description: 'Special launch partner',
  reason: 'Approved partner promotion',
};

const OWNER_RESPONSE = {
  id: '33333333-3333-4333-8333-333333333333',
  rate: '12.500000',
  description: 'Special launch partner',
  reason: 'Approved partner promotion',
  marketId: MARKET_ID,
  market: 'MA',
  createdBy: ACTOR.adminUserId,
  createdAt: '2026-08-01T00:00:00.000Z',
};

/** Adapter surface shape: owner values verbatim, snake_case field names. */
const ADAPTER_RESPONSE = {
  id: OWNER_RESPONSE.id,
  rate: OWNER_RESPONSE.rate,
  description: OWNER_RESPONSE.description,
  reason: OWNER_RESPONSE.reason,
  marketId: OWNER_RESPONSE.marketId,
  market: OWNER_RESPONSE.market,
  created_by: OWNER_RESPONSE.createdBy,
  created_at: OWNER_RESPONSE.createdAt,
};

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
  owner = { createSpecialPercentage: vi.fn() };
  service = new AdminPackageOpsService(
    database as unknown as DatabaseService,
    audit as unknown as AuditService,
    owner as unknown as PackageService,
  );
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
      owner as unknown as PackageService,
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
      owner as unknown as PackageService,
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
      owner as unknown as PackageService,
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
      owner as unknown as PackageService,
    );

    const catalog = await service.catalog('market-a');

    expect(catalog.items).toEqual([]);
    expect(audit.recordPrivilegedAction).not.toHaveBeenCalled();
  });
});

// ─── Create delegation (D-051 secured owner command) ─────────────────

describe('createSpecialPercentage delegation to the secured owner (P7-S6A / D-051)', () => {
  it('delegates the entire create with the server actor, DTO and Idempotency-Key', async () => {
    vi.mocked(owner.createSpecialPercentage).mockResolvedValue(OWNER_RESPONSE);

    const result = await service.createSpecialPercentage(
      ACTOR,
      MARKET_ID,
      CREATE_INPUT,
      'k-1',
    );

    expect(owner.createSpecialPercentage).toHaveBeenCalledTimes(1);
    const [marketId, ownerActor, input, key] =
      vi.mocked(owner.createSpecialPercentage).mock.calls[0] ?? [];
    expect(marketId).toBe(MARKET_ID);
    expect(ownerActor).toEqual({
      adminUserId: ACTOR.adminUserId,
      requestId: 'req-123',
      ipAddress: '127.0.0.1',
      currentMarketId: MARKET_ID,
      marketContextVersion: 3,
    });
    expect(input).toEqual(CREATE_INPUT);
    expect(key).toBe('k-1');

    // Adapter response: the owner-resolved immutable result verbatim
    // (field names mapped onto the S6A surface style — no value derived).
    expect(result).toEqual(ADAPTER_RESPONSE);
  });

  it('forwards an actor without optional fields when absent', async () => {
    vi.mocked(owner.createSpecialPercentage).mockResolvedValue(OWNER_RESPONSE);

    await service.createSpecialPercentage(
      { adminUserId: ACTOR.adminUserId },
      MARKET_ID,
      CREATE_INPUT,
      'k-2',
    );

    const [, ownerActor] =
      vi.mocked(owner.createSpecialPercentage).mock.calls[0] ?? [];
    expect(ownerActor).toEqual({ adminUserId: ACTOR.adminUserId });
  });

  it('maps every owner rejection to the S6A external code (identity contract)', async () => {
    const cases: ReadonlyArray<[string, AdminPackageOpsErrorCode]> = [
      [
        'SPECIAL_PERCENTAGE_PERMISSION_DENIED',
        'SPECIAL_PERCENTAGE_PERMISSION_DENIED',
      ],
      [
        'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED',
        'SPECIAL_PERCENTAGE_MARKET_SELECTION_REQUIRED',
      ],
      [
        'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH',
        'SPECIAL_PERCENTAGE_MARKET_CONTEXT_MISMATCH',
      ],
      [
        'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND',
        'SPECIAL_PERCENTAGE_MARKET_NOT_FOUND',
      ],
      [
        'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED',
        'SPECIAL_PERCENTAGE_MARKET_ACCESS_DENIED',
      ],
      [
        'SPECIAL_PERCENTAGE_REASON_REQUIRED',
        'SPECIAL_PERCENTAGE_REASON_REQUIRED',
      ],
      [
        'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED',
        'SPECIAL_PERCENTAGE_IDEMPOTENCY_KEY_REQUIRED',
      ],
      [
        'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT',
        'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT',
      ],
      ['SPECIAL_PERCENTAGE_CREATE_FAILED', 'SPECIAL_PERCENTAGE_CREATE_FAILED'],
    ];
    for (const [ownerCode, expectedCode] of cases) {
      vi.mocked(owner.createSpecialPercentage).mockRejectedValue(
        Object.assign(new Error(`owner ${ownerCode}`), { code: ownerCode }),
      );
      await expect(
        service.createSpecialPercentage(
          ACTOR,
          MARKET_ID,
          CREATE_INPUT,
          'k-map',
        ),
      ).rejects.toMatchObject({ code: expectedCode });
    }
  });

  it('propagates unknown owner errors (never swallowed into a 2xx)', async () => {
    vi.mocked(owner.createSpecialPercentage).mockRejectedValue(
      new Error('unexpected infrastructure failure'),
    );
    await expect(
      service.createSpecialPercentage(ACTOR, MARKET_ID, CREATE_INPUT, 'k-9'),
    ).rejects.toThrow('unexpected infrastructure failure');
  });

  it('propagates a non-SPECIAL_PERCENTAGE_* error object untouched', async () => {
    vi.mocked(owner.createSpecialPercentage).mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'DB_CONNECTION_LOST' }),
    );
    await expect(
      service.createSpecialPercentage(ACTOR, MARKET_ID, CREATE_INPUT, 'k-10'),
    ).rejects.toMatchObject({ code: 'DB_CONNECTION_LOST' });
  });
});

// ─── Transport DTO (fast-fail boundary) ─────────────────────────────

describe('createSpecialPercentageSchema (P7-S6A transport DTO)', () => {
  it('accepts exact-decimal rates in (0, 100] with at most six decimals', () => {
    for (const rate of ['0.000001', '2.5', '12.500000', '100.000000']) {
      expect(
        createSpecialPercentageSchema.safeParse({
          rate,
          description: 'Partner',
          reason: 'Approved',
        }).success,
      ).toBe(true);
    }
  });

  it('rejects rates above six decimals, zero, over 100 and malformed values', () => {
    for (const rate of [
      '0',
      '0.000000',
      '12.3456789',
      '100.000001',
      '-1',
      '1e2',
      'abc',
    ]) {
      expect(
        createSpecialPercentageSchema.safeParse({
          rate,
          description: 'Partner',
          reason: 'Approved',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects a missing/blank reason and an over-length reason', () => {
    for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
      expect(
        createSpecialPercentageSchema.safeParse({
          rate: '12.500000',
          description: 'Partner',
          ...(reason === undefined ? {} : { reason }),
        }).success,
      ).toBe(false);
    }
    expect(
      createSpecialPercentageSchema.safeParse({
        rate: '12.500000',
        description: 'Partner',
        reason: 'x'.repeat(500),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing description and actor-shaped fields (strict)', () => {
    expect(
      createSpecialPercentageSchema.safeParse({
        rate: '12.500000',
        reason: 'Approved',
      }).success,
    ).toBe(false);
    expect(
      createSpecialPercentageSchema.safeParse({
        rate: '12.500000',
        description: 'Partner',
        reason: 'Approved',
        adminUserId: 'forged',
      }).success,
    ).toBe(false);
    expect(
      createSpecialPercentageSchema.safeParse({
        rate: '12.500000',
        description: 'Partner',
        reason: 'Approved',
        marketId: 'forged',
      }).success,
    ).toBe(false);
  });
});

// ─── Error class shape (pure) ────────────────────────────────────────

describe('AdminPackageOpsError (P7-S6A)', () => {
  it('carries the typed code, message and details', () => {
    const error = new AdminPackageOpsError(
      'SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT',
      'conflict',
      { key: 'k' },
    );
    expect(error.code).toBe('SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT');
    expect(error.message).toBe('conflict');
    expect(error.details).toEqual({ key: 'k' });
    expect(error.name).toBe('AdminPackageOpsError');
  });
});
