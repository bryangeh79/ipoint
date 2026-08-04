import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import type { RedemptionService } from '../redemption/redemption.service.js';
import { AdminRedemptionOpsService } from './admin-redemption-ops.service.js';
import { AdminRedemptionOpsError } from './admin-redemption-ops.types.js';
import {
  REDEMPTION_RATE_DISPLAY_DECIMALS,
  REDEMPTION_RATE_MARKET_RULES,
  REDEMPTION_RATE_SCALE,
  REDEMPTION_RATE_TECHNICAL_DECIMALS,
} from './admin-redemption-ops.types.js';
import {
  canonicalPayloadHash,
  displayRateString,
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
  scaledDecimal,
} from './admin-redemption-ops.service.js';

/**
 * P7-S6C adapter unit tests (frozen contract §7.2).
 *
 * Pure-logic coverage: the exact-decimal boundary math (Malaysia
 * 0.50 / 1.00 / 2.00 bounds at the 10^10 scale, ten-decimal technical
 * precision), the display-only ≤6-decimal rounding (never touching the
 * stored value), the market-local midnight → UTC resolution (including
 * the round-trip wall-clock guard), the local-time rendering, and the
 * canonical payload hash used for idempotency correlation. The
 * database/owner surfaces are mocked; the HTTP contract is exercised by
 * the integration suite on a fresh database.
 */

let database: {
  db: DatabaseService['db'];
  pool: DatabaseService['pool'];
};
let owner: Pick<RedemptionService, 'createRateVersion'>;
let audit: Pick<AuditService, 'recordPrivilegedAction'>;
let service: AdminRedemptionOpsService;

beforeEach(() => {
  database = {
    db: {} as DatabaseService['db'],
    pool: { connect: vi.fn() } as unknown as DatabaseService['pool'],
  };
  owner = { createRateVersion: vi.fn() };
  audit = { recordPrivilegedAction: vi.fn().mockResolvedValue(undefined) };
  service = new AdminRedemptionOpsService(
    database as unknown as DatabaseService,
    owner as unknown as RedemptionService,
    audit as unknown as AuditService,
  );
});

/** Mock the market lookup so the create path reaches the rate checks. */
function mockMarketRow(code = 'MY', timezone = 'Asia/Kuala_Lumpur') {
  const limit = vi
    .fn()
    .mockResolvedValue([
      { id: 'market-1', code, currencyCode: 'MYR', timezone },
    ]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  database.db = {
    select: vi.fn().mockReturnValue({ from }),
  } as unknown as DatabaseService['db'];
}

describe('§7.2 exact-decimal rate math (P7-S6C)', () => {
  it('scales decimal strings without float arithmetic (10^10)', () => {
    expect(scaledDecimal('0.5')).toBe(5_000_000_000n);
    expect(scaledDecimal('0.5000000000')).toBe(5_000_000_000n);
    expect(scaledDecimal('1')).toBe(10_000_000_000n);
    expect(scaledDecimal('1.0000000000')).toBe(10_000_000_000n);
    expect(scaledDecimal('2')).toBe(20_000_000_000n);
    expect(scaledDecimal('1.1234567890')).toBe(11_234_567_890n);
    expect(scaledDecimal('1.1234567891')).toBe(11_234_567_891n);
    expect(REDEMPTION_RATE_SCALE).toBe(10_000_000_000n);
  });

  it('defines the approved Malaysia §7.2 bounds as exact decimals', () => {
    const my = REDEMPTION_RATE_MARKET_RULES['MY'];
    expect(my).toBeTruthy();
    expect(my?.initialRate).toBe('1.0000000000');
    expect(my?.minimumRate).toBe('0.5000000000');
    expect(my?.maximumRate).toBe('2.0000000000');
    expect(my?.currency).toBe('MYR');
    expect(my?.displayUnit).toBe('RM per 1 iPoint');
    // Malaysia bounds, exact: 0.50 → 5e9, 1.00 → 1e10, 2.00 → 2e10.
    expect(scaledDecimal(my?.minimumRate ?? '')).toBe(5_000_000_000n);
    expect(scaledDecimal(my?.initialRate ?? '')).toBe(10_000_000_000n);
    expect(scaledDecimal(my?.maximumRate ?? '')).toBe(20_000_000_000n);
  });

  it('has no other approved market (blocked, no fallback)', () => {
    // Only MY is approved under D-046 §7.2. Any other market code must
    // resolve to NO rule (blocked state) — the surface never falls back.
    expect(Object.keys(REDEMPTION_RATE_MARKET_RULES)).toEqual(['MY']);
    expect(REDEMPTION_RATE_MARKET_RULES['SG']).toBeUndefined();
    expect(REDEMPTION_RATE_MARKET_RULES['GB']).toBeUndefined();
    expect(REDEMPTION_RATE_MARKET_RULES['US']).toBeUndefined();
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

describe('market-local midnight resolution (P7-S6C)', () => {
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

describe('payload hash (P7-S6C)', () => {
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

describe('createRate validation ordering (P7-S6C)', () => {
  const actor = { adminUserId: '11111111-1111-4111-8111-111111111111' };
  const marketId = '22222222-2222-4222-8222-222222222222';
  const base = {
    rate_value: '1.5',
    effective_date: '2099-01-01',
    reason: 'Ops review',
  };

  it('rejects rates below the approved Malaysia minimum (0.50)', async () => {
    mockMarketRow('MY');
    await expect(
      service.createRate(
        actor,
        marketId,
        { ...base, rate_value: '0.49' },
        'k-1',
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_BELOW_MINIMUM' });
    await expect(
      service.createRate(
        actor,
        marketId,
        { ...base, rate_value: '0.4999999999' },
        'k-1b',
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_BELOW_MINIMUM' });
    // At the minimum boundary the scaled value is exactly within range.
    const my = REDEMPTION_RATE_MARKET_RULES['MY'];
    expect(scaledDecimal('0.5000000000')).toBe(
      scaledDecimal(my?.minimumRate ?? ''),
    );
  });

  it('rejects rates above the approved Malaysia maximum (2.00)', async () => {
    mockMarketRow('MY');
    await expect(
      service.createRate(
        actor,
        marketId,
        { ...base, rate_value: '2.01' },
        'k-2',
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_ABOVE_MAXIMUM' });
    await expect(
      service.createRate(
        actor,
        marketId,
        { ...base, rate_value: '2.0000000001' },
        'k-2b',
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_ABOVE_MAXIMUM' });
    // At the maximum boundary the scaled value is exactly within range.
    const my = REDEMPTION_RATE_MARKET_RULES['MY'];
    expect(scaledDecimal('2.0000000000')).toBe(
      scaledDecimal(my?.maximumRate ?? ''),
    );
  });

  it('keeps the initial Malaysia value 1.00 exactly inside the bounds', () => {
    const my = REDEMPTION_RATE_MARKET_RULES['MY'];
    const initial = scaledDecimal('1.0000000000');
    expect(initial).toBeGreaterThanOrEqual(
      scaledDecimal(my?.minimumRate ?? ''),
    );
    expect(initial).toBeLessThanOrEqual(scaledDecimal(my?.maximumRate ?? ''));
  });

  it('accepts the full ten-decimal technical precision within bounds', () => {
    // 1.1234567890 is a valid technical value (10 decimals) inside the
    // Malaysia bounds; 1.12345678901 (11 decimals) exceeds the grammar.
    const my = REDEMPTION_RATE_MARKET_RULES['MY'];
    const technical = scaledDecimal('1.1234567890');
    expect(technical).toBeGreaterThanOrEqual(
      scaledDecimal(my?.minimumRate ?? ''),
    );
    expect(technical).toBeLessThanOrEqual(scaledDecimal(my?.maximumRate ?? ''));
    expect('1.12345678901'.split('.')[1]?.length ?? 0).toBe(11);
    expect(/^\d+(\.\d{1,10})?$/u.test('1.1234567890')).toBe(true);
    expect(/^\d+(\.\d{1,10})?$/u.test('1.12345678901')).toBe(false);
  });

  it('rejects non-future market-local dates (same-day and backdated)', async () => {
    mockMarketRow('MY');
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');
    await expect(
      service.createRate(
        actor,
        marketId,
        { ...base, effective_date: `${year}-${month}-${day}` },
        'k-4',
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_ACTIVATION_NOT_FUTURE' });
    await expect(
      service.createRate(
        actor,
        marketId,
        { ...base, effective_date: '2020-01-01' },
        'k-5',
      ),
    ).rejects.toMatchObject({ code: 'REDEMPTION_ACTIVATION_NOT_FUTURE' });
  });

  it('blocks markets without an approved configuration (no fallback)', async () => {
    mockMarketRow('SG', 'Asia/Singapore');
    await expect(
      service.createRate(actor, marketId, base, 'k-6'),
    ).rejects.toMatchObject({ code: 'REDEMPTION_RATE_MARKET_BLOCKED' });
    expect(owner.createRateVersion).not.toHaveBeenCalled();
  });

  it('rejects a missing market before any lock or owner call', async () => {
    const connect = vi.fn();
    database.pool = { connect } as unknown as DatabaseService['pool'];
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    database.db = {
      select: vi.fn().mockReturnValue({ from }),
    } as unknown as DatabaseService['db'];
    await expect(
      service.createRate(actor, marketId, base, 'k-7'),
    ).rejects.toMatchObject({ code: 'REDEMPTION_MARKET_NOT_FOUND' });
    expect(connect).not.toHaveBeenCalled();
    expect(owner.createRateVersion).not.toHaveBeenCalled();
  });

  it('propagates a stable error type for every contract violation', async () => {
    mockMarketRow('MY');
    try {
      await service.createRate(
        actor,
        marketId,
        { ...base, rate_value: '2.01' },
        'k-8',
      );
      expect.unreachable('expected an above-maximum rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminRedemptionOpsError);
      expect((error as AdminRedemptionOpsError).code).toBe(
        'REDEMPTION_RATE_ABOVE_MAXIMUM',
      );
    }
  });
});
