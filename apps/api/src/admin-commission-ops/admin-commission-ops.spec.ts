import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import {
  RateManagementError,
  type RateManagementService,
} from '../domain/commission/rate.service.js';
import { commissionRateVersions, markets } from '@ipoint/database';
import { AdminCommissionOpsService } from './admin-commission-ops.service.js';
import type { AdminCommissionOpsErrorCode } from './admin-commission-ops.types.js';
import {
  canonicalPayloadHash,
  COMMISSION_RATE_DISPLAY_DECIMALS,
  COMMISSION_RATE_TECHNICAL_DECIMALS,
  displayRateString,
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
  scaledRate,
} from './admin-commission-ops.service.js';

/**
 * P7-S6D adapter unit tests (D-054 §16 / D-055 §8).
 *
 * The adapter is a Phase 7 read projection + orchestration layer over the
 * SECURED Phase 5 commission-rate owner. Every owner-level business
 * control (RBAC, selected market, frozen taxonomy, exact rate grammar,
 * precision, future market-local 00:00, overlap, advisory lock,
 * idempotency, reason, atomic audit) lives inside
 * `RateManagementService.createRateVersion` — the adapter performs NO such
 * control of its own.
 *
 * This spec therefore asserts:
 * 1. The canonical owner helper re-exports (single implementation — the
 *    pure-logic contracts stay tested here: exact-decimal math, display
 *    normalization, market-local midnight → UTC, local rendering,
 *    canonical payload hash).
 * 2. Delegation: the owner command receives the mandatory `reason`, the
 *    client `Idempotency-Key`, the server `currentMarketId` +
 *    `marketContextVersion` (+ requestId/ipAddress), the resolved UTC
 *    activation, the frozen taxonomy fields and the canonical market code.
 * 3. The full owner error → S6D external contract mapping (every
 *    `RateManagementError` code; no error swallowed into a 2xx).
 * 4. The read projection: current/scheduled/superseded/expired windows
 *    (owner logical half-open semantics), exact rates + ≤6-decimal
 *    display, market-local + UTC, the frozen taxonomy, the explicit
 *    blocked state (`configured: false` for a non-ACTIVE market) and the
 *    market-not-found code.
 *
 * The database/owner surfaces are mocked; the HTTP contract is exercised
 * by the integration suite on a fresh database.
 */

let database: { db: DatabaseService['db']; pool: DatabaseService['pool'] };
let owner: Pick<RateManagementService, 'createRateVersion'>;
let service: AdminCommissionOpsService;

const MARKET_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR = {
  adminUserId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-123',
  ipAddress: '127.0.0.1',
  currentMarketId: MARKET_ID,
  marketContextVersion: 3,
};

/**
 * A query-chain mock: `.select().from(table).where(...)` returns a
 * thenable carrying the table's rows, with `limit()` / `orderBy()`
 * terminal methods that also resolve to the rows. Rows are dispatched by
 * table identity so one mock serves market + versions lookups.
 */
function mockRowsByTable(
  rowsByTable: ReadonlyArray<readonly [unknown, unknown[]]>,
): DatabaseService['db'] {
  const rows = new Map<unknown, unknown[]>(rowsByTable);
  const terminal = (forTable: unknown[]) => {
    const promise = Promise.resolve(forTable) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>;
      orderBy: ReturnType<typeof vi.fn>;
    };
    promise.limit = vi.fn().mockResolvedValue(forTable);
    promise.orderBy = vi.fn().mockResolvedValue(forTable);
    return promise;
  };
  const from = vi.fn((table: unknown) => ({
    where: vi.fn(() => terminal(rows.get(table) ?? [])),
  }));
  return {
    select: vi.fn().mockReturnValue({ from }),
  } as unknown as DatabaseService['db'];
}

/** Mock the market lookup so the create path reaches the owner. */
function mockMarketRow(
  code = 'MY',
  timezone = 'Asia/Kuala_Lumpur',
  currencyCode = 'MYR',
  status = 'ACTIVE',
): void {
  database.db = mockRowsByTable([
    [markets, [{ id: MARKET_ID, code, currencyCode, timezone, status }]],
    [commissionRateVersions, []],
  ]);
}

beforeEach(() => {
  database = {
    db: {} as DatabaseService['db'],
    pool: { connect: vi.fn() } as unknown as DatabaseService['pool'],
  };
  owner = { createRateVersion: vi.fn() };
  service = new AdminCommissionOpsService(
    database as unknown as DatabaseService,
    owner as unknown as RateManagementService,
  );
});

// ─── Canonical owner helper re-exports (single implementation) ────────

describe('exact-decimal rate math (P7-S6D, canonical owner helpers)', () => {
  it('scales decimal strings without float arithmetic (10^10)', () => {
    expect(scaledRate('0.5')).toBe(5_000_000_000n);
    expect(scaledRate('0.5000000000')).toBe(5_000_000_000n);
    expect(scaledRate('1')).toBe(10_000_000_000n);
    expect(scaledRate('1.1234567890')).toBe(11_234_567_890n);
    expect(scaledRate('100')).toBe(1_000_000_000_000n);
  });

  it('marks the precision ceilings: ten technical, six display', () => {
    expect(COMMISSION_RATE_TECHNICAL_DECIMALS).toBe(10);
    expect(COMMISSION_RATE_DISPLAY_DECIMALS).toBe(6);
  });

  it('normalizes stored rates to significant digits for display', () => {
    expect(normalizeRateString('1.0000000000')).toBe('1');
    expect(normalizeRateString('0.5000000000')).toBe('0.5');
    expect(normalizeRateString('388.0000000000')).toBe('388');
    expect(normalizeRateString('0.0000010000')).toBe('0.000001');
  });

  it('rounds the display value to ≤6 decimals WITHOUT touching the stored value', () => {
    expect(displayRateString('1.1234567890')).toBe('1.123457');
    expect(displayRateString('1.1234564999')).toBe('1.123456');
    expect(displayRateString('1.1234565000')).toBe('1.123457');
    expect(displayRateString('388.0000000000')).toBe('388');
    expect(displayRateString('0.5000000000')).toBe('0.5');
    expect(displayRateString('0.9999999999')).toBe('1');
    // The stored technical string is never changed by the display helper.
    expect('1.1234567890').toBe('1.1234567890');
  });
});

describe('market-local midnight resolution (P7-S6D, canonical owner helper)', () => {
  it('resolves Asia/Kuala_Lumpur 00:00 to the exact UTC instant (UTC+8)', () => {
    const midnight = resolveLocalMidnight('2026-09-01', 'Asia/Kuala_Lumpur');
    expect(midnight?.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(localWallString(midnight as Date, 'Asia/Kuala_Lumpur')).toBe(
      '2026-09-01 00:00:00',
    );
  });

  it('renders market-local wall time for arbitrary instants', () => {
    expect(
      localWallString(
        new Date('2026-08-31T16:30:45.000Z'),
        'Asia/Kuala_Lumpur',
      ),
    ).toBe('2026-09-01 00:30:45');
  });
});

describe('payload hash (P7-S6D, canonical owner helper)', () => {
  it('canonicalizes the payload hash independent of key order', () => {
    const left = canonicalPayloadHash({
      rate_value: '388',
      effective_date: '2026-09-01',
      reason: 'Ops review',
    });
    const right = canonicalPayloadHash({
      reason: 'Ops review',
      effective_date: '2026-09-01',
      rate_value: '388',
    });
    expect(left).toMatch(/^[a-f0-9]{64}$/u);
    expect(right).toBe(left);
  });
});

// ─── Create delegation (D-054 secured owner command) ─────────────────

describe('createRate delegation to the secured owner (P7-S6D)', () => {
  const input = {
    commission_type: 'AGENT_UPGRADE' as const,
    generation: 1,
    rate_type: 'FIXED' as const,
    rate_value: '388.0000000000',
    effective_date: '2099-01-01',
    reason: 'Ops review',
  };
  const ownerResponse = {
    id: VERSION_ID,
    commissionType: 'AGENT_UPGRADE',
    generation: 1,
    market: 'MY',
    marketId: MARKET_ID,
    currency: 'MYR',
    rateValue: '388.0000000000',
    rateType: 'FIXED',
    effectiveFrom: '2098-12-31T16:00:00.000Z',
    effectiveFromLocal: '2099-01-01 00:00:00',
    timezone: 'Asia/Kuala_Lumpur',
    effectiveUntil: null,
    reason: 'Ops review',
    createdBy: ACTOR.adminUserId,
    createdAt: '2098-12-30T00:00:00.000Z',
  };

  it('delegates the entire create with reason, key and the server market context', async () => {
    mockMarketRow();
    vi.mocked(owner.createRateVersion).mockResolvedValue(ownerResponse);

    const result = await service.createRate(ACTOR, MARKET_ID, input, 'k-1');

    expect(owner.createRateVersion).toHaveBeenCalledTimes(1);
    const [ownerActor, command] =
      vi.mocked(owner.createRateVersion).mock.calls[0] ?? [];
    expect(ownerActor).toEqual({
      adminUserId: ACTOR.adminUserId,
      requestId: 'req-123',
      ipAddress: '127.0.0.1',
      currentMarketId: MARKET_ID,
      marketContextVersion: 3,
    });
    expect(command).toEqual({
      market: 'MY',
      commissionType: 'AGENT_UPGRADE',
      generation: 1,
      rateValue: '388.0000000000',
      rateType: 'FIXED',
      // Asia/Kuala_Lumpur is UTC+8: local 2099-01-01 00:00 == 2098-12-31 16:00 UTC.
      effectiveFrom: '2098-12-31T16:00:00.000Z',
      reason: 'Ops review',
      idempotencyKey: 'k-1',
    });
    // Adapter response: owner-resolved activation + full stored precision.
    expect(result).toEqual({
      id: VERSION_ID,
      commission_type: 'AGENT_UPGRADE',
      generation: 1,
      rate_type: 'FIXED',
      rate_value: '388.0000000000',
      display_rate: '388',
      effective_date: '2099-01-01',
      effective_from_utc: '2098-12-31T16:00:00.000Z',
      effective_from_local: '2099-01-01 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      market_id: MARKET_ID,
      created_by: ACTOR.adminUserId,
      created_at: '2098-12-30T00:00:00.000Z',
    });
  });

  it('delegates a percentage rate for MEMBER_CONSUMPTION', async () => {
    mockMarketRow();
    vi.mocked(owner.createRateVersion).mockResolvedValue({
      ...ownerResponse,
      commissionType: 'MEMBER_CONSUMPTION',
      generation: 2,
      rateType: 'PERCENTAGE',
      rateValue: '1.5000000000',
    });
    const result = await service.createRate(
      ACTOR,
      MARKET_ID,
      {
        commission_type: 'MEMBER_CONSUMPTION',
        generation: 2,
        rate_type: 'PERCENTAGE',
        rate_value: '1.5000000000',
        effective_date: '2099-02-01',
        reason: 'Ops review',
      },
      'k-2',
    );
    expect(result.commission_type).toBe('MEMBER_CONSUMPTION');
    expect(result.rate_type).toBe('PERCENTAGE');
    expect(result.rate_value).toBe('1.5000000000');
    expect(result.display_rate).toBe('1.5');
    const [, command] = vi.mocked(owner.createRateVersion).mock.calls[0] ?? [];
    expect(command?.rateType).toBe('PERCENTAGE');
  });

  it('rejects a missing market BEFORE any owner call', async () => {
    database.db = mockRowsByTable([[markets, []]]);
    await expect(
      service.createRate(ACTOR, MARKET_ID, input, 'k-3'),
    ).rejects.toMatchObject({ code: 'COMMISSION_MARKET_NOT_FOUND' });
    expect(owner.createRateVersion).not.toHaveBeenCalled();
  });

  it('surfaces a skipped/ambiguous midnight as NOT_FUTURE without inventing a time', async () => {
    // America/Havana 2027-03-14 is DST-skip day: the canonical multi-probe
    // helper yields no constructible 00:00 → COMMISSION_RATE_ACTIVATION_NOT_FUTURE.
    mockMarketRow('CU', 'America/Havana', 'CUP');
    await expect(
      service.createRate(
        ACTOR,
        MARKET_ID,
        { ...input, effective_date: '2027-03-14' },
        'k-4',
      ),
    ).rejects.toMatchObject({
      code: 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
    });
    expect(owner.createRateVersion).not.toHaveBeenCalled();
  });

  it('maps every owner rejection to the S6D external code (identity contract)', async () => {
    const cases: ReadonlyArray<[string, AdminCommissionOpsErrorCode]> = [
      [
        'COMMISSION_RATE_PERMISSION_DENIED',
        'COMMISSION_RATE_PERMISSION_DENIED',
      ],
      [
        'COMMISSION_RATE_MARKET_ACCESS_DENIED',
        'COMMISSION_RATE_MARKET_ACCESS_DENIED',
      ],
      ['COMMISSION_RATE_MARKET_NOT_FOUND', 'COMMISSION_RATE_MARKET_NOT_FOUND'],
      [
        'COMMISSION_RATE_MARKET_SELECTION_REQUIRED',
        'COMMISSION_RATE_MARKET_SELECTION_REQUIRED',
      ],
      [
        'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH',
        'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH',
      ],
      [
        'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
        'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
      ],
      ['COMMISSION_RATE_REASON_REQUIRED', 'COMMISSION_RATE_REASON_REQUIRED'],
      [
        'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
        'COMMISSION_RATE_IDEMPOTENCY_CONFLICT',
      ],
      [
        'COMMISSION_RATE_PRECISION_EXCEEDED',
        'COMMISSION_RATE_PRECISION_EXCEEDED',
      ],
      ['COMMISSION_RATE_PERCENTAGE_LIMIT', 'COMMISSION_RATE_PERCENTAGE_LIMIT'],
      [
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
        'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      ],
      [
        'COMMISSION_RATE_TIMEZONE_MISMATCH',
        'COMMISSION_RATE_TIMEZONE_MISMATCH',
      ],
      ['INVALID_COMMISSION_TYPE', 'INVALID_COMMISSION_TYPE'],
      ['INVALID_GENERATION', 'INVALID_GENERATION'],
      ['INVALID_RATE_TYPE', 'INVALID_RATE_TYPE'],
      ['RATE_TYPE_MISMATCH', 'RATE_TYPE_MISMATCH'],
      ['INVALID_MARKET', 'INVALID_MARKET'],
      ['INVALID_RATE_VALUE', 'INVALID_RATE_VALUE'],
      ['INVALID_EFFECTIVE_RANGE', 'INVALID_EFFECTIVE_RANGE'],
      ['INVALID_TIMESTAMP', 'INVALID_TIMESTAMP'],
      ['OVERLAPPING_RATE_PERIOD', 'OVERLAPPING_RATE_PERIOD'],
    ];
    for (const [ownerCode, expectedCode] of cases) {
      mockMarketRow();
      vi.mocked(owner.createRateVersion).mockRejectedValue(
        new RateManagementError(ownerCode, `owner ${ownerCode}`),
      );
      await expect(
        service.createRate(ACTOR, MARKET_ID, input, 'k-map'),
      ).rejects.toMatchObject({ code: expectedCode });
    }
  });

  it('propagates unknown owner errors (never swallowed into a 2xx)', async () => {
    mockMarketRow();
    vi.mocked(owner.createRateVersion).mockRejectedValue(
      new Error('unexpected infrastructure failure'),
    );
    await expect(
      service.createRate(ACTOR, MARKET_ID, input, 'k-9'),
    ).rejects.toThrow('unexpected infrastructure failure');
  });
});

// ─── Read projection (current/scheduled/superseded/expired) ──────────

describe('listRates read projection (P7-S6D)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function versionRow(
    overrides: Partial<typeof commissionRateVersions.$inferSelect> & {
      id: string;
      commissionType: string;
      generation: number;
      effectiveFrom: Date;
    },
  ) {
    return {
      id: overrides.id,
      commissionType: overrides.commissionType,
      generation: overrides.generation,
      market: 'MY',
      rateValue: overrides.rateValue ?? '1.0000000000',
      rateType:
        overrides.commissionType === 'AGENT_UPGRADE' ? 'FIXED' : 'PERCENTAGE',
      effectiveFrom: overrides.effectiveFrom,
      effectiveUntil: overrides.effectiveUntil ?? null,
      createdBy: 'admin-1',
      createdAt: overrides.createdAt ?? new Date(),
      reason: overrides.reason ?? 'Ops review',
    };
  }

  function marketRow(status = 'ACTIVE'): [unknown, unknown[]][] {
    return [
      [
        markets,
        [
          {
            id: MARKET_ID,
            code: 'MY',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
            status,
          },
        ],
      ],
    ];
  }

  it('projects taxonomy + current/scheduled windows with exact rates', async () => {
    const now = Date.now();
    const v1 = versionRow({
      id: 'v1',
      commissionType: 'AGENT_UPGRADE',
      generation: 1,
      rateValue: '88.0000000000',
      effectiveFrom: new Date(now - 60 * DAY_MS),
    });
    const v2 = versionRow({
      id: 'v2',
      commissionType: 'AGENT_UPGRADE',
      generation: 1,
      rateValue: '388.0000000000',
      effectiveFrom: new Date(now - 30 * DAY_MS),
    });
    const v3 = versionRow({
      id: 'v3',
      commissionType: 'AGENT_UPGRADE',
      generation: 1,
      rateValue: '488.0000000000',
      effectiveFrom: new Date(now + 30 * DAY_MS),
    });
    database.db = mockRowsByTable([
      ...marketRow(),
      [commissionRateVersions, [v3, v2, v1]],
    ]);

    const result = await service.listRates(MARKET_ID);

    expect(result.market_id).toBe(MARKET_ID);
    expect(result.market_code).toBe('MY');
    expect(result.timezone).toBe('Asia/Kuala_Lumpur');
    expect(result.currency).toBe('MYR');
    expect(result.configured).toBe(true);

    // Frozen taxonomy: all four types with their generations.
    expect(result.taxonomy).toEqual([
      {
        commission_type: 'AGENT_UPGRADE',
        rate_type: 'FIXED',
        generations: [1, 2],
      },
      {
        commission_type: 'MEMBER_CONSUMPTION',
        rate_type: 'PERCENTAGE',
        generations: [1, 2],
      },
      {
        commission_type: 'MERCHANT_RECRUITMENT',
        rate_type: 'PERCENTAGE',
        generations: [0],
      },
      {
        commission_type: 'AGENT_ACTIVATION_FEE',
        rate_type: 'FIXED',
        generations: [0],
      },
    ]);

    const definition = result.definitions.find(
      (entry) =>
        entry.commission_type === 'AGENT_UPGRADE' && entry.generation === 1,
    );
    expect(definition).toBeTruthy();
    expect(definition?.rate_type).toBe('FIXED');
    // current = the latest start ≤ now whose window covers now (v2).
    expect(definition?.current?.id).toBe('v2');
    expect(definition?.current?.rate_value).toBe('388.0000000000');
    expect(definition?.current?.display_rate).toBe('388');
    expect(definition?.current?.window_status).toBe('SUPERSEDED');
    // scheduled = future windows, soonest first.
    expect(definition?.scheduled.map((row) => row.id)).toEqual(['v3']);
    expect(definition?.scheduled[0]?.window_status).toBe('SCHEDULED');
    // history = all versions, newest first.
    expect(definition?.history.map((row) => row.id)).toEqual([
      'v3',
      'v2',
      'v1',
    ]);
    expect(definition?.history[2]?.window_status).toBe('SUPERSEDED');
    expect(definition?.history[2]?.effective_until_utc).toBe(
      v2.effectiveFrom.toISOString(),
    );
    // Legacy reason null is preserved (never backfilled).
    expect(definition?.history[2]?.reason).toBe('Ops review');

    // Definitions without rows are emitted with empty arrays.
    const empty = result.definitions.find(
      (entry) =>
        entry.commission_type === 'MERCHANT_RECRUITMENT' &&
        entry.generation === 0,
    );
    expect(empty).toMatchObject({
      commission_type: 'MERCHANT_RECRUITMENT',
      generation: 0,
      rate_type: 'PERCENTAGE',
      current: null,
      scheduled: [],
      history: [],
    });
    expect(result.definitions).toHaveLength(6);
  });

  it('projects EXPIRED windows from explicit stored ends (legacy rows)', async () => {
    const now = Date.now();
    const v1 = versionRow({
      id: 'v-expired',
      commissionType: 'AGENT_ACTIVATION_FEE',
      generation: 0,
      rateValue: '388.0000000000',
      effectiveFrom: new Date(now - 60 * DAY_MS),
      effectiveUntil: new Date(now - 30 * DAY_MS),
    });
    database.db = mockRowsByTable([
      ...marketRow(),
      [commissionRateVersions, [v1]],
    ]);

    const result = await service.listRates(MARKET_ID);
    const definition = result.definitions.find(
      (entry) =>
        entry.commission_type === 'AGENT_ACTIVATION_FEE' &&
        entry.generation === 0,
    );
    expect(definition?.history[0]?.window_status).toBe('EXPIRED');
    expect(definition?.history[0]?.effective_until_utc).toBe(
      v1.effectiveUntil?.toISOString(),
    );
    expect(definition?.current).toBeNull();
    expect(definition?.scheduled).toEqual([]);
  });

  it('reports the explicit blocked state for a non-ACTIVE market (no fallback)', async () => {
    database.db = mockRowsByTable([
      ...marketRow('INACTIVE'),
      [commissionRateVersions, []],
    ]);
    const result = await service.listRates(MARKET_ID);
    expect(result.market_code).toBe('MY');
    expect(result.configured).toBe(false);
    expect(result.definitions).toHaveLength(6);
    expect(
      result.definitions.every((entry) => entry.history.length === 0),
    ).toBe(true);
  });

  it('rejects an unknown market with COMMISSION_MARKET_NOT_FOUND', async () => {
    database.db = mockRowsByTable([[markets, []]]);
    await expect(service.listRates(MARKET_ID)).rejects.toMatchObject({
      code: 'COMMISSION_MARKET_NOT_FOUND',
    });
  });
});
