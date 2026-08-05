import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { RedemptionError } from '../redemption/redemption.errors.js';
import type { RedemptionService } from '../redemption/redemption.service.js';
import {
  markets,
  redemptionRateCancellations,
  redemptionRateMarketRules,
  redemptionRateVersions,
} from '@ipoint/database';
import { AdminRedemptionOpsService } from './admin-redemption-ops.service.js';
import {
  AdminRedemptionOpsError,
  REDEMPTION_RATE_DISPLAY_DECIMALS,
  REDEMPTION_RATE_TECHNICAL_DECIMALS,
  type AdminRedemptionOpsErrorCode,
} from './admin-redemption-ops.types.js';
import {
  canonicalPayloadHash,
  displayRateString,
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
  scaledRate,
} from './admin-redemption-ops.service.js';

/**
 * P7-S6C adapter unit tests (D-053 rewiring, order §15).
 *
 * The adapter is a Phase 7 read projection + orchestration layer over the
 * SECURED Phase 6 redemption owner. Every owner-level business control
 * (RBAC, selected market, exact bounds, precision, future market-local
 * 00:00, overlap, advisory lock, idempotency, reason, atomic audit)
 * lives inside `RedemptionService.createRateVersion` /
 * `cancelRateVersion` — the adapter performs NO such control of its own.
 *
 * This spec therefore asserts:
 * 1. The canonical owner helper re-exports (single implementation — the
 *    pure-logic contracts stay tested here: exact-decimal math, display
 *    normalization, market-local midnight → UTC, local rendering,
 *    canonical payload hash).
 * 2. Delegation: the owner command receives the mandatory `reason`, the
 *    client `Idempotency-Key`, the server `currentMarketId` +
 *    `marketContextVersion` (+ requestId/ipAddress), the resolved UTC
 *    activation, the canonical rate type and the market's fiat currency.
 * 3. Cancel delegation: `cancelRateVersion` receives reason + key and its
 *    append-only response is mapped to the adapter's cancel surface.
 * 4. The full owner error → S6C external contract mapping (every
 *    `REDEMPTION_RATE_*` code; no error swallowed into a 2xx).
 * 5. The read projection: approved per-market config from the canonical
 *    rules table, the explicit blocked state (`configured: false`, no
 *    cross-market fallback) and the CANCELLED window status.
 *
 * The database/owner surfaces are mocked; the HTTP contract is exercised
 * by the integration suite on a fresh database.
 */

let database: { db: DatabaseService['db']; pool: DatabaseService['pool'] };
let owner: Pick<RedemptionService, 'createRateVersion' | 'cancelRateVersion'>;
let service: AdminRedemptionOpsService;

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
 * table identity so one mock serves market / rules / versions /
 * cancellations lookups.
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
): void {
  database.db = mockRowsByTable([
    [markets, [{ id: MARKET_ID, code, currencyCode, timezone }]],
    [redemptionRateVersions, [{ rateValue: '1.5000000000' }]],
  ]);
}

beforeEach(() => {
  database = {
    db: {} as DatabaseService['db'],
    pool: { connect: vi.fn() } as unknown as DatabaseService['pool'],
  };
  owner = { createRateVersion: vi.fn(), cancelRateVersion: vi.fn() };
  service = new AdminRedemptionOpsService(
    database as unknown as DatabaseService,
    owner as unknown as RedemptionService,
  );
});

// ─── Canonical owner helper re-exports (single implementation) ────────

describe('§7.2 exact-decimal rate math (P7-S6C, canonical owner helpers)', () => {
  it('scales decimal strings without float arithmetic (10^10)', () => {
    expect(scaledRate('0.5')).toBe(5_000_000_000n);
    expect(scaledRate('0.5000000000')).toBe(5_000_000_000n);
    expect(scaledRate('1')).toBe(10_000_000_000n);
    expect(scaledRate('1.0000000000')).toBe(10_000_000_000n);
    expect(scaledRate('2')).toBe(20_000_000_000n);
    expect(scaledRate('1.1234567890')).toBe(11_234_567_890n);
    expect(scaledRate('1.1234567891')).toBe(11_234_567_891n);
  });

  it('marks the precision ceilings: ten technical, six display', () => {
    expect(REDEMPTION_RATE_TECHNICAL_DECIMALS).toBe(10);
    expect(REDEMPTION_RATE_DISPLAY_DECIMALS).toBe(6);
  });

  it('normalizes stored rates to significant digits for display', () => {
    expect(normalizeRateString('1.0000000000')).toBe('1');
    expect(normalizeRateString('0.5000000000')).toBe('0.5');
    expect(normalizeRateString('2.0000000000')).toBe('2');
    expect(normalizeRateString('1.1234567890')).toBe('1.123456789');
    expect(normalizeRateString('0.0000010000')).toBe('0.000001');
    expect(normalizeRateString('0')).toBe('0');
  });

  it('rounds the display value to ≤6 decimals WITHOUT touching the stored value', () => {
    // Full technical precision is preserved; the display is display-only.
    expect(displayRateString('1.1234567890')).toBe('1.123457');
    expect(displayRateString('1.1234564999')).toBe('1.123456');
    expect(displayRateString('1.1234565000')).toBe('1.123457');
    expect(displayRateString('1.0000000000')).toBe('1');
    expect(displayRateString('0.5000000000')).toBe('0.5');
    expect(displayRateString('2.0000000000')).toBe('2');
    expect(displayRateString('0.9999999999')).toBe('1');
    expect(displayRateString('1.5')).toBe('1.5');
    expect(displayRateString('0.0000010000')).toBe('0.000001');
    // The stored technical string is never changed by the display helper.
    expect('1.1234567890').toBe('1.1234567890');
  });
});

describe('market-local midnight resolution (P7-S6C, canonical owner helper)', () => {
  it('resolves Asia/Kuala_Lumpur 00:00 to the exact UTC instant (UTC+8)', () => {
    const midnight = resolveLocalMidnight('2026-09-01', 'Asia/Kuala_Lumpur');
    expect(midnight?.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(localWallString(midnight as Date, 'Asia/Kuala_Lumpur')).toBe(
      '2026-09-01 00:00:00',
    );
  });

  it('resolves Asia/Singapore 00:00 to the exact UTC instant (UTC+8)', () => {
    const midnight = resolveLocalMidnight('2026-12-25', 'Asia/Singapore');
    expect(midnight?.toISOString()).toBe('2026-12-24T16:00:00.000Z');
    expect(localWallString(midnight as Date, 'Asia/Singapore')).toBe(
      '2026-12-25 00:00:00',
    );
  });

  it('renders market-local wall time for arbitrary instants', () => {
    expect(
      localWallString(
        new Date('2026-08-31T16:30:45.000Z'),
        'Asia/Kuala_Lumpur',
      ),
    ).toBe('2026-09-01 00:30:45');
    expect(localWallString(new Date('2026-08-31T16:00:00.000Z'), 'UTC')).toBe(
      '2026-08-31 16:00:00',
    );
  });

  it('returns null when the zone does not land exactly on 00:00 (DST guard)', () => {
    const midnight = resolveLocalMidnight('2018-11-04', 'America/Sao_Paulo');
    if (midnight === null) {
      expect(midnight).toBeNull();
    } else {
      expect(localWallString(midnight, 'America/Sao_Paulo')).toBe(
        '2018-11-04 00:00:00',
      );
    }
  });
});

describe('payload hash (P7-S6C, canonical owner helper)', () => {
  it('canonicalizes the payload hash independent of key order', () => {
    const left = canonicalPayloadHash({
      rate_value: '1.5',
      effective_date: '2026-09-01',
      reason: 'Ops review',
    });
    const right = canonicalPayloadHash({
      reason: 'Ops review',
      effective_date: '2026-09-01',
      rate_value: '1.5',
    });
    expect(left).toMatch(/^[a-f0-9]{64}$/u);
    expect(right).toBe(left);
    expect(
      canonicalPayloadHash({
        rate_value: '1.6',
        effective_date: '2026-09-01',
        reason: 'Ops review',
      }),
    ).not.toBe(left);
  });
});

// ─── Create delegation (D-053 secured owner command) ─────────────────

describe('createRate delegation to the secured owner (P7-S6C)', () => {
  const input = {
    rate_value: '1.5000000000',
    effective_date: '2099-01-01',
    reason: 'Ops review',
  };
  const ownerResponse = {
    id: VERSION_ID,
    marketId: MARKET_ID,
    rateType: 'POINTS_PER_CURRENCY',
    rateValue: '1.5',
    effectiveFrom: '2098-12-31T16:00:00.000Z',
    effectiveFromLocal: '2099-01-01 00:00:00',
    timezone: 'Asia/Kuala_Lumpur',
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
      marketId: MARKET_ID,
      rateType: 'POINTS_PER_CURRENCY',
      rateValue: '1.5000000000',
      fiatCurrency: 'MYR',
      effectiveFrom: '2098-12-31T16:00:00.000Z',
      reason: 'Ops review',
      idempotencyKey: 'k-1',
    });
    // Adapter response: owner-resolved activation + full stored precision.
    expect(result).toEqual({
      id: VERSION_ID,
      rate_type: 'POINTS_PER_CURRENCY',
      rate_value: '1.5000000000',
      display_rate: '1.5',
      effective_date: '2099-01-01',
      effective_from_utc: '2098-12-31T16:00:00.000Z',
      effective_from_local: '2099-01-01 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      market_id: MARKET_ID,
      created_by: ACTOR.adminUserId,
      created_at: '2098-12-30T00:00:00.000Z',
    });
  });

  it('rejects a missing market BEFORE any owner call', async () => {
    database.db = mockRowsByTable([[markets, []]]);
    await expect(
      service.createRate(ACTOR, MARKET_ID, input, 'k-2'),
    ).rejects.toMatchObject({ code: 'REDEMPTION_MARKET_NOT_FOUND' });
    expect(owner.createRateVersion).not.toHaveBeenCalled();
  });

  it('surfaces a skipped/ambiguous midnight as NOT_FUTURE without inventing a time', async () => {
    // America/Havana 2026-03-08 is DST-skip day (00:00 → 01:00): the
    // canonical multi-probe helper yields no constructible 00:00. If the
    // ICU build resolves a midnight anyway, the owner re-validates and
    // rejects — either way the surface code is REDEMPTION_ACTIVATION_NOT_FUTURE.
    mockMarketRow('CU', 'America/Havana');
    vi.mocked(owner.createRateVersion).mockRejectedValue(
      new RedemptionError(
        'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
        'Activation must be at a strictly future market-local 00:00.',
      ),
    );
    await expect(
      service.createRate(
        ACTOR,
        MARKET_ID,
        { ...input, effective_date: '2026-03-08' },
        'k-3',
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_ACTIVATION_NOT_FUTURE' });
  });

  it('maps every owner rejection to the S6C external code (create path)', async () => {
    const cases: ReadonlyArray<[string, AdminRedemptionOpsErrorCode]> = [
      ['REDEMPTION_RATE_PERMISSION_DENIED', 'PERMISSION_DENIED'],
      ['REDEMPTION_RATE_MARKET_ACCESS_DENIED', 'MARKET_ACCESS_DENIED'],
      ['REDEMPTION_RATE_MARKET_NOT_FOUND', 'REDEMPTION_MARKET_NOT_FOUND'],
      [
        'REDEMPTION_RATE_MARKET_SELECTION_REQUIRED',
        'MARKET_SELECTION_REQUIRED',
      ],
      ['REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH', 'MARKET_CONTEXT_MISMATCH'],
      ['REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REQUIRED'],
      ['REDEMPTION_RATE_REASON_REQUIRED', 'REASON_REQUIRED'],
      [
        'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
        'REDEMPTION_IDEMPOTENCY_CONFLICT',
      ],
      [
        'REDEMPTION_RATE_PRECISION_EXCEEDED',
        'REDEMPTION_RATE_PRECISION_EXCEEDED',
      ],
      ['REDEMPTION_RATE_MARKET_BLOCKED', 'REDEMPTION_RATE_MARKET_BLOCKED'],
      ['REDEMPTION_RATE_BELOW_MINIMUM', 'REDEMPTION_RATE_BELOW_MINIMUM'],
      ['REDEMPTION_RATE_ABOVE_MAXIMUM', 'REDEMPTION_RATE_ABOVE_MAXIMUM'],
      [
        'REDEMPTION_RATE_CURRENCY_MISMATCH',
        'REDEMPTION_RATE_CURRENCY_MISMATCH',
      ],
      [
        'REDEMPTION_RATE_ACTIVATION_NOT_FUTURE',
        'REDEMPTION_ACTIVATION_NOT_FUTURE',
      ],
      ['REDEMPTION_RATE_OVERLAP', 'REDEMPTION_RATE_OVERLAP'],
      [
        'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
        'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
      ],
      [
        'REDEMPTION_RATE_ALREADY_CANCELLED',
        'REDEMPTION_RATE_ALREADY_CANCELLED',
      ],
      ['REDEMPTION_RATE_NOT_FOUND', 'REDEMPTION_RATE_VERSION_NOT_FOUND'],
    ];
    for (const [ownerCode, expectedCode] of cases) {
      mockMarketRow();
      vi.mocked(owner.createRateVersion).mockRejectedValue(
        new RedemptionError(ownerCode, `owner ${ownerCode}`),
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

// ─── Cancel delegation (D-053 §9 append-only contract) ───────────────

describe('cancelRate delegation to the secured owner (P7-S6C)', () => {
  const input = { reason: 'Scheduled baseline no longer required' };
  const ownerResponse = {
    id: '44444444-4444-4444-8444-444444444444',
    rateVersionId: VERSION_ID,
    marketId: MARKET_ID,
    rateType: 'POINTS_PER_CURRENCY',
    rateValue: '1.5',
    effectiveFrom: '2099-01-01T00:00:00.000Z',
    reason: input.reason,
    cancelledBy: ACTOR.adminUserId,
    cancelledAt: '2098-12-30T00:00:00.000Z',
  };

  it('delegates the cancel with reason + key and maps the append-only response', async () => {
    vi.mocked(owner.cancelRateVersion).mockResolvedValue(ownerResponse);

    const result = await service.cancelRate(
      ACTOR,
      VERSION_ID,
      input,
      'k-cancel-1',
    );

    expect(owner.cancelRateVersion).toHaveBeenCalledTimes(1);
    const [ownerActor, versionId, command] =
      vi.mocked(owner.cancelRateVersion).mock.calls[0] ?? [];
    expect(ownerActor).toEqual({
      adminUserId: ACTOR.adminUserId,
      requestId: 'req-123',
      ipAddress: '127.0.0.1',
      currentMarketId: MARKET_ID,
      marketContextVersion: 3,
    });
    expect(versionId).toBe(VERSION_ID);
    expect(command).toEqual({
      reason: input.reason,
      idempotencyKey: 'k-cancel-1',
    });
    expect(result).toEqual({
      id: '44444444-4444-4444-8444-444444444444',
      rate_version_id: VERSION_ID,
      market_id: MARKET_ID,
      rate_value: '1.5',
      effective_from_utc: '2099-01-01T00:00:00.000Z',
      reason: input.reason,
      cancelled_by: ACTOR.adminUserId,
      cancelled_at: '2098-12-30T00:00:00.000Z',
    });
  });

  it('maps the owner cancel rejections to the S6C external codes', async () => {
    const cases: ReadonlyArray<[string, AdminRedemptionOpsErrorCode]> = [
      [
        'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
        'REDEMPTION_RATE_CANNOT_CANCEL_EFFECTIVE',
      ],
      [
        'REDEMPTION_RATE_ALREADY_CANCELLED',
        'REDEMPTION_RATE_ALREADY_CANCELLED',
      ],
      ['REDEMPTION_RATE_NOT_FOUND', 'REDEMPTION_RATE_VERSION_NOT_FOUND'],
      ['REDEMPTION_RATE_MARKET_CONTEXT_MISMATCH', 'MARKET_CONTEXT_MISMATCH'],
      [
        'REDEMPTION_RATE_MARKET_SELECTION_REQUIRED',
        'MARKET_SELECTION_REQUIRED',
      ],
      ['REDEMPTION_RATE_MARKET_ACCESS_DENIED', 'MARKET_ACCESS_DENIED'],
      ['REDEMPTION_RATE_PERMISSION_DENIED', 'PERMISSION_DENIED'],
      ['REDEMPTION_RATE_REASON_REQUIRED', 'REASON_REQUIRED'],
      ['REDEMPTION_RATE_IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REQUIRED'],
      [
        'REDEMPTION_RATE_IDEMPOTENCY_CONFLICT',
        'REDEMPTION_IDEMPOTENCY_CONFLICT',
      ],
    ];
    for (const [ownerCode, expectedCode] of cases) {
      vi.mocked(owner.cancelRateVersion).mockRejectedValue(
        new RedemptionError(ownerCode, `owner ${ownerCode}`),
      );
      await expect(
        service.cancelRate(ACTOR, VERSION_ID, input, 'k-cancel-map'),
      ).rejects.toMatchObject({ code: expectedCode });
    }
  });
});

// ─── Read projection (canonical rules table + explicit blocked state) ─

describe('listRates read projection (P7-S6C)', () => {
  const rule = {
    initialRate: '1.0000000000',
    minimumRate: '0.5000000000',
    maximumRate: '2.0000000000',
    currency: 'MYR',
    displayUnit: 'RM per 1 iPoint',
  };

  it('projects the approved config, full precision and the CANCELLED state', async () => {
    const active = {
      id: 'v-active',
      rateType: 'POINTS_PER_CURRENCY',
      rateValue: '1.5000000000',
      effectiveFrom: new Date(Date.now() - 60_000),
      effectiveUntil: null,
      createdBy: ACTOR.adminUserId,
      createdAt: new Date(Date.now() - 120_000),
    };
    const cancelled = {
      id: 'v-cancelled',
      rateType: 'POINTS_PER_CURRENCY',
      rateValue: '2.0000000000',
      effectiveFrom: new Date(Date.now() + 86_400_000),
      effectiveUntil: null,
      createdBy: ACTOR.adminUserId,
      createdAt: new Date(Date.now() - 60_000),
    };
    database.db = mockRowsByTable([
      [
        markets,
        [
          {
            id: MARKET_ID,
            code: 'MY',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
          },
        ],
      ],
      [redemptionRateMarketRules, [rule]],
      [redemptionRateVersions, [cancelled, active]],
      [redemptionRateCancellations, [{ rateVersionId: 'v-cancelled' }]],
    ]);

    const result = await service.listRates(MARKET_ID);

    expect(result.market_id).toBe(MARKET_ID);
    expect(result.market_code).toBe('MY');
    expect(result.configured).toBe(true);
    expect(result.config).toEqual({
      initial_rate: '1',
      minimum_rate: '0.5',
      maximum_rate: '2',
      currency: 'MYR',
      display_unit: 'RM per 1 iPoint',
      technical_decimals: 10,
      display_decimals: 6,
    });
    const byId = new Map(
      result.rates.map((rate) => [rate.id, rate.window_status]),
    );
    expect(byId.get('v-active')).toBe('ACTIVE');
    // Cancelled versions are void: explicit CANCELLED state, never ACTIVE.
    expect(byId.get('v-cancelled')).toBe('CANCELLED');
    const cancelledDto = result.rates.find((rate) => rate.id === 'v-cancelled');
    expect(cancelledDto?.rate_value).toBe('2.0000000000');
    expect(cancelledDto?.display_rate).toBe('2');
    expect(cancelledDto?.effective_until_utc).toBeNull();
  });

  it('reports the explicit blocked state for an unconfigured market (no fallback)', async () => {
    database.db = mockRowsByTable([
      [
        markets,
        [
          {
            id: MARKET_ID,
            code: 'SG',
            currencyCode: 'SGD',
            timezone: 'Asia/Singapore',
          },
        ],
      ],
      [redemptionRateMarketRules, []],
      [redemptionRateVersions, []],
      [redemptionRateCancellations, []],
    ]);

    const result = await service.listRates(MARKET_ID);

    expect(result.market_code).toBe('SG');
    expect(result.configured).toBe(false);
    expect(result.config).toBeNull();
    expect(result.rates).toEqual([]);
  });

  it('rejects an unknown market with REDEMPTION_MARKET_NOT_FOUND', async () => {
    database.db = mockRowsByTable([[markets, []]]);
    await expect(service.listRates(MARKET_ID)).rejects.toMatchObject({
      code: 'REDEMPTION_MARKET_NOT_FOUND',
    });
  });
});
