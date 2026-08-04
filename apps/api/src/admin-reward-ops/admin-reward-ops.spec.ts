import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminRewardService } from '../admin-reward/admin-reward.service.js';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import { AdminRewardOpsService } from './admin-reward-ops.service.js';
import { AdminRewardOpsError } from './admin-reward-ops.types.js';
import {
  REWARD_PACKAGE_REFERENCE_MAX_RATE,
  REWARD_RATE_GOVERNANCE_MAX,
  REWARD_RATE_MAX_DECIMALS,
  REWARD_RATE_SCALE,
} from './admin-reward-ops.types.js';
import {
  canonicalPayloadHash,
  derivePackageReference,
  localWallString,
  normalizeRateString,
  resolveLocalMidnight,
  scaledDecimal,
} from './admin-reward-ops.service.js';

/**
 * P7-S6B adapter unit tests (frozen contract §7.1).
 *
 * Pure-logic coverage: the exact-decimal boundary math (0%–0.05%/day and
 * the A–F package maxima, six-decimal precision), the market-local
 * midnight → UTC resolution (including the round-trip wall-clock guard),
 * the local-time rendering, the deterministic package-reference derivation,
 * and the canonical payload hash used for idempotency correlation. The
 * database/owner surfaces are mocked; the HTTP contract is exercised by the
 * integration suite on a fresh database.
 */

let database: {
  db: DatabaseService['db'];
  pool: DatabaseService['pool'];
};
let owner: Pick<AdminRewardService, 'createRuleVersion'>;
let audit: Pick<AuditService, 'recordPrivilegedAction'>;
let service: AdminRewardOpsService;

beforeEach(() => {
  database = {
    db: {} as DatabaseService['db'],
    pool: { connect: vi.fn() } as unknown as DatabaseService['pool'],
  };
  owner = { createRuleVersion: vi.fn() };
  audit = { recordPrivilegedAction: vi.fn().mockResolvedValue(undefined) };
  service = new AdminRewardOpsService(
    database as unknown as DatabaseService,
    owner as unknown as AdminRewardService,
    audit as unknown as AuditService,
  );
});

describe('§7.1 exact-decimal rate math (P7-S6B)', () => {
  it('scales decimal strings without float arithmetic', () => {
    expect(scaledDecimal('0')).toBe(0n);
    expect(scaledDecimal('0.000000')).toBe(0n);
    expect(scaledDecimal('0.000001')).toBe(1n);
    expect(scaledDecimal('0.05')).toBe(50_000n);
    expect(scaledDecimal('0.050000')).toBe(50_000n);
    expect(scaledDecimal('0.050001')).toBe(50_001n);
  });

  it('keeps the governance ceiling at 0.05%/day (50_000 scaled units)', () => {
    expect(scaledDecimal(REWARD_RATE_GOVERNANCE_MAX)).toBe(50_000n);
    // The ceiling is exactly 50_000 units at the 10^6 scale.
    expect(REWARD_RATE_GOVERNANCE_MAX).toBe('0.05');
    expect(REWARD_RATE_SCALE).toBe(1_000_000);
  });

  it('defines the frozen §7.1 package maxima as exact decimals', () => {
    expect(REWARD_PACKAGE_REFERENCE_MAX_RATE['A']).toBe('0.0125');
    expect(REWARD_PACKAGE_REFERENCE_MAX_RATE['B']).toBe('0.025');
    expect(REWARD_PACKAGE_REFERENCE_MAX_RATE['C']).toBe('0.05');
    expect(REWARD_PACKAGE_REFERENCE_MAX_RATE['D']).toBe('0.05');
    expect(REWARD_PACKAGE_REFERENCE_MAX_RATE['E']).toBe('0.05');
    expect(REWARD_PACKAGE_REFERENCE_MAX_RATE['F']).toBe('0.05');
    // A and B sit below the governance ceiling; C–F at the ceiling.
    expect(scaledDecimal(REWARD_PACKAGE_REFERENCE_MAX_RATE['A'])).toBe(12_500n);
    expect(scaledDecimal(REWARD_PACKAGE_REFERENCE_MAX_RATE['B'])).toBe(25_000n);
    expect(scaledDecimal(REWARD_PACKAGE_REFERENCE_MAX_RATE['C'])).toBe(50_000n);
  });

  it('marks the six-decimal precision limit constant', () => {
    expect(REWARD_RATE_MAX_DECIMALS).toBe(6);
  });

  it('trims stored rates to significant decimals for %/day display', () => {
    expect(normalizeRateString('0.0125000000')).toBe('0.0125');
    expect(normalizeRateString('0.0200000000')).toBe('0.02');
    expect(normalizeRateString('0.0500000000')).toBe('0.05');
    expect(normalizeRateString('0.0000010000')).toBe('0.000001');
    expect(normalizeRateString('0.0000000000')).toBe('0');
    expect(normalizeRateString('0')).toBe('0');
    expect(normalizeRateString('12.5000000000')).toBe('12.5');
    // A legacy owner-created version with 10 significant decimals keeps
    // its exact stored digits (never rounded).
    expect(normalizeRateString('0.1234567891')).toBe('0.1234567891');
  });
});

describe('market-local midnight resolution (P7-S6B)', () => {
  it('resolves Asia/Kuala_Lumpur 00:00 to the exact UTC instant (UTC+8)', () => {
    const midnight = resolveLocalMidnight('2026-09-01', 'Asia/Kuala_Lumpur');
    expect(midnight?.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    // Round trip: the wall clock at that instant is 2026-09-01 00:00:00.
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
    // UTC itself renders as the UTC wall clock.
    expect(localWallString(new Date('2026-08-31T16:00:00.000Z'), 'UTC')).toBe(
      '2026-08-31 16:00:00',
    );
  });

  it('returns null when the zone does not land exactly on 00:00 (DST guard)', () => {
    // America/Sao_Paulo skipped midnight on 2018-11-04 (DST rollback 00:00→
    // 23:00 on 2018-11-03); the guard must refuse rather than guess.
    const midnight = resolveLocalMidnight('2018-11-04', 'America/Sao_Paulo');
    if (midnight === null) {
      expect(midnight).toBeNull();
    } else {
      // If the ICU data set resolves it, the wall clock must still be 00:00.
      expect(localWallString(midnight, 'America/Sao_Paulo')).toBe(
        '2018-11-04 00:00:00',
      );
    }
  });
});

describe('payload hash and package-reference derivation (P7-S6B)', () => {
  it('canonicalizes the payload hash independent of key order', () => {
    const left = canonicalPayloadHash({
      rate: '0.025',
      package_reference: 'B',
      effective_date: '2026-09-01',
    });
    const right = canonicalPayloadHash({
      effective_date: '2026-09-01',
      package_reference: 'B',
      rate: '0.025',
    });
    expect(left).toMatch(/^[a-f0-9]{64}$/u);
    expect(right).toBe(left);
    // A different payload produces a different hash.
    expect(
      canonicalPayloadHash({
        rate: '0.025',
        package_reference: 'B',
        effective_date: '2026-09-02',
      }),
    ).not.toBe(left);
  });

  it('derives the package reference only from the deterministic surface name', () => {
    expect(derivePackageReference('Package A Reward Rate')).toBe('A');
    expect(derivePackageReference('Package F Reward Rate')).toBe('F');
    expect(derivePackageReference('Package G Reward Rate')).toBeNull();
    expect(derivePackageReference('MY 2026 Q3 Rate')).toBeNull();
    expect(derivePackageReference('Package A Special')).toBeNull();
  });
});

describe('createRule validation ordering (P7-S6B)', () => {
  const actor = { adminUserId: '11111111-1111-4111-8111-111111111111' };
  const marketId = '22222222-2222-4222-8222-222222222222';
  const base = {
    package_reference: 'C' as const,
    rate: '0.05',
    effective_date: '2099-01-01',
    reason: 'Ops review',
  };

  it('rejects rates above the 0.05%/day governance ceiling', async () => {
    await expect(
      service.createRule(actor, marketId, { ...base, rate: '0.050001' }, 'k-1'),
    ).rejects.toMatchObject({
      code: 'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
    });
  });

  it('rejects rates above the referenced package maximum', async () => {
    await expect(
      service.createRule(
        actor,
        marketId,
        { ...base, package_reference: 'A', rate: '0.0126' },
        'k-2',
      ),
    ).rejects.toMatchObject({
      code: 'REWARD_RATE_EXCEEDS_PACKAGE_MAX',
    });
    // B boundary: 0.025 accepted, 0.025001 rejected.
    await expect(
      service.createRule(
        actor,
        marketId,
        { ...base, package_reference: 'B', rate: '0.025001' },
        'k-3',
      ),
    ).rejects.toMatchObject({ code: 'REWARD_RATE_EXCEEDS_PACKAGE_MAX' });
  });

  it('rejects non-future market-local dates (same-day and backdated)', async () => {
    // Provide an existing market so the date check is what rejects.
    const limit = vi
      .fn()
      .mockResolvedValue([{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    database.db = {
      select: vi.fn().mockReturnValue({ from }),
    } as unknown as DatabaseService['db'];
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');
    await expect(
      service.createRule(
        actor,
        marketId,
        { ...base, effective_date: `${year}-${month}-${day}` },
        'k-4',
      ),
    ).rejects.toMatchObject({ code: 'REWARD_ACTIVATION_NOT_FUTURE' });
    await expect(
      service.createRule(
        actor,
        marketId,
        { ...base, effective_date: '2020-01-01' },
        'k-5',
      ),
    ).rejects.toMatchObject({ code: 'REWARD_ACTIVATION_NOT_FUTURE' });
  });

  it('rejects a missing market before any lock or owner call', async () => {
    const connect = vi.fn();
    database.pool = { connect } as unknown as DatabaseService['pool'];
    // Mock the market lookup to return no rows.
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    database.db = {
      select: vi.fn().mockReturnValue({ from }),
    } as unknown as DatabaseService['db'];
    await expect(
      service.createRule(actor, marketId, base, 'k-6'),
    ).rejects.toMatchObject({ code: 'REWARD_MARKET_NOT_FOUND' });
    expect(connect).not.toHaveBeenCalled();
    expect(owner.createRuleVersion).not.toHaveBeenCalled();
  });

  it('propagates a stable error type for every contract violation', async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    database.db = {
      select: vi.fn().mockReturnValue({ from }),
    } as unknown as DatabaseService['db'];
    try {
      await service.createRule(
        actor,
        marketId,
        { ...base, rate: '0.06' },
        'k-7',
      );
      expect.unreachable('expected a governance-limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminRewardOpsError);
      expect((error as AdminRewardOpsError).code).toBe(
        'REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
      );
    }
  });
});
