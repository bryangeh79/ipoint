import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marketAccess, markets } from '@ipoint/database';
import type { DatabaseService } from '../database/database.service.js';
import { MarketOwnerService } from './market-owner.service.js';
import { MarketOwnerError } from './market-owner.types.js';
import {
  canonicalPayloadHash,
  isValidIanaTimezone,
  MARKET_LOCALE_PATTERN,
  marketOwnerLockKey,
} from './market-owner.service.js';
import type {
  MarketOwnerActor,
  UpdateMarketCommand,
} from './market-owner.types.js';

/**
 * P7-S6E secured market owner unit tests.
 *
 * The owner is the SOLE enforcement boundary for every market-manage
 * control (P7-AC-11/12): permission re-check, selected market, market
 * equality, non-revoked grant, controlled change surface + format
 * validation, deactivation confirmation gate, mandatory reason/key,
 * operation-scoped idempotency with the canonical payload hash and the
 * atomic audit. This spec asserts the pure helpers and the early-fail
 * controls before the write transaction; the transaction paths (replay /
 * conflict / concurrency / dependency / atomic audit) are exercised by
 * the integration suite on a fresh PostgreSQL database.
 */

let database: {
  db: DatabaseService['db'];
  pool: DatabaseService['pool'];
  runTransaction: ReturnType<typeof vi.fn>;
};
let rbac: { isAllowed: ReturnType<typeof vi.fn> };
let audit: { appendWithinTransaction: ReturnType<typeof vi.fn> };
let service: MarketOwnerService;

const MARKET_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

const ACTOR: MarketOwnerActor = {
  adminUserId: ADMIN_ID,
  requestId: 'req-123',
  ipAddress: '127.0.0.1',
  currentMarketId: MARKET_ID,
  marketContextVersion: 3,
};

const MARKET_ROW = {
  id: MARKET_ID,
  code: 'MY',
  name: 'Malaysia',
  status: 'ACTIVE' as const,
  currencyCode: 'MYR',
  timezone: 'Asia/Kuala_Lumpur',
  defaultLocale: 'en-MY',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

/**
 * Minimal query-chain mock for the pre-transaction lookups: the market
 * lookup (`from(markets)`) and the market-access chain
 * (`from(marketAccess).innerJoin(...).innerJoin(...)`).
 */
function mockDb(
  marketRowsValue: unknown[],
  accessRowsValue: unknown[],
): DatabaseService['db'] {
  const terminal = (rows: unknown[]) => {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>;
      orderBy: ReturnType<typeof vi.fn>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    promise.orderBy = vi.fn().mockResolvedValue(rows);
    return promise;
  };
  const from = vi.fn((table: unknown) => {
    if (table === markets) {
      return {
        where: vi.fn(() => terminal(marketRowsValue)),
      };
    }
    if (table === marketAccess) {
      return {
        innerJoin: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => terminal(accessRowsValue)),
          })),
        })),
      };
    }
    return { where: vi.fn(() => terminal([])) };
  });
  return {
    select: vi.fn().mockReturnValue({ from }),
  } as unknown as DatabaseService['db'];
}

/**
 * Minimal transaction mock: advisory lock + fresh idempotency claim + the
 * market re-read inside the lock. Tests that exercise the transaction
 * paths beyond the replay/conflict decision use this shape.
 */
function makeTx(overrides: Record<string, unknown> = {}): {
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
} {
  const terminal = (rows: unknown[]) => {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  };
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => terminal([MARKET_ROW])),
      })),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'claim-1' }]),
        }),
      }),
    }),
    ...overrides,
  };
  return tx as unknown as {
    execute: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
}

function makeService(
  options: {
    allowed?: boolean;
    marketRow?: unknown[];
    accessRow?: unknown[];
    tx?: Record<string, unknown>;
  } = {},
): MarketOwnerService {
  const {
    allowed = true,
    marketRow = [MARKET_ROW],
    accessRow = [{}],
    tx = makeTx(),
  } = options;
  database = {
    db: mockDb(marketRow, accessRow),
    pool: {} as never,
    runTransaction: vi
      .fn()
      .mockImplementation(async (cb: unknown) =>
        (cb as (transaction: unknown) => Promise<unknown>)(tx),
      ),
  };
  rbac = { isAllowed: vi.fn().mockResolvedValue(allowed) };
  audit = { appendWithinTransaction: vi.fn().mockResolvedValue(undefined) };
  service = new MarketOwnerService(
    database as unknown as DatabaseService,
    audit as unknown as ConstructorParameters<typeof MarketOwnerService>[1],
    {
      isAllowed: rbac.isAllowed,
    } as unknown as ConstructorParameters<typeof MarketOwnerService>[2],
  );
  return service;
}

function command(
  overrides: Partial<UpdateMarketCommand> = {},
): UpdateMarketCommand {
  return {
    name: 'Malaysia Renamed',
    reason: 'Unit test market rename',
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

async function expectOwnerError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('MarketOwnerService (P7-S6E)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('pure helpers', () => {
    it('canonicalPayloadHash: sorted keys + sha256 hex (64 chars)', () => {
      const hash = canonicalPayloadHash({ b: 2, a: 1 });
      expect(hash).toMatch(/^[0-9a-f]{64}$/u);
      // Key order must not matter.
      expect(canonicalPayloadHash({ b: 2, a: 1 })).toBe(
        canonicalPayloadHash({ a: 1, b: 2 }),
      );
      // Different payload → different hash.
      expect(canonicalPayloadHash({ b: 3, a: 1 })).not.toBe(hash);
    });

    it('isValidIanaTimezone: accepts real IANA ids, rejects garbage', () => {
      expect(isValidIanaTimezone('Asia/Kuala_Lumpur')).toBe(true);
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('Not/AZone')).toBe(false);
      expect(isValidIanaTimezone('')).toBe(false);
    });

    it('MARKET_LOCALE_PATTERN: BCP-47-style locales', () => {
      expect(MARKET_LOCALE_PATTERN.test('en-MY')).toBe(true);
      expect(MARKET_LOCALE_PATTERN.test('zh-Hans-CN')).toBe(true);
      expect(MARKET_LOCALE_PATTERN.test('en')).toBe(true);
      expect(MARKET_LOCALE_PATTERN.test('English')).toBe(false);
      expect(MARKET_LOCALE_PATTERN.test('')).toBe(false);
    });

    it('marketOwnerLockKey: stable FNV-1a bigint per market', () => {
      const first = marketOwnerLockKey(MARKET_ID);
      const second = marketOwnerLockKey(MARKET_ID);
      expect(first).toBe(second);
      expect(first).not.toBe(
        marketOwnerLockKey('33333333-3333-4333-8333-333333333333'),
      );
      expect(first).toBeGreaterThan(0n);
    });
  });

  describe('authorization (owner re-check)', () => {
    it('rejects a missing admin actor (MARKET_PERMISSION_DENIED)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket({} as MarketOwnerActor, MARKET_ID, command()),
        'MARKET_PERMISSION_DENIED',
      );
    });

    it('rejects an admin without market.manage (MARKET_PERMISSION_DENIED)', async () => {
      makeService({ allowed: false });
      await expectOwnerError(
        service.updateMarket(ACTOR, MARKET_ID, command()),
        'MARKET_PERMISSION_DENIED',
      );
    });
  });

  describe('reason and idempotency key', () => {
    it('rejects a missing/blank/overlong reason (MARKET_REASON_REQUIRED)', async () => {
      makeService();
      for (const reason of [undefined, '   ', 'x'.repeat(501)]) {
        await expectOwnerError(
          service.updateMarket(ACTOR, MARKET_ID, command({ reason })),
          'MARKET_REASON_REQUIRED',
        );
      }
    });

    it('rejects a missing/blank/overlong idempotency key', async () => {
      makeService();
      for (const idempotencyKey of [undefined, '   ', 'x'.repeat(201)]) {
        await expectOwnerError(
          service.updateMarket(ACTOR, MARKET_ID, command({ idempotencyKey })),
          'MARKET_IDEMPOTENCY_KEY_REQUIRED',
        );
      }
    });
  });

  describe('market consistency', () => {
    it('rejects when no Current Admin Market is selected (MARKET_SELECTION_REQUIRED)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(
          { ...ACTOR, currentMarketId: undefined },
          MARKET_ID,
          command(),
        ),
        'MARKET_SELECTION_REQUIRED',
      );
    });

    it('rejects when command market != Current Admin Market (MARKET_CONTEXT_MISMATCH)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(
          ACTOR,
          '33333333-3333-4333-8333-333333333333',
          command(),
        ),
        'MARKET_CONTEXT_MISMATCH',
      );
    });

    it('rejects a revoked grant / non-ACTIVE market (MARKET_ACCESS_DENIED)', async () => {
      // The market-access chain returns no row → grant absent or revoked,
      // or the market is not ACTIVE.
      makeService({ accessRow: [] });
      await expectOwnerError(
        service.updateMarket(ACTOR, MARKET_ID, command()),
        'MARKET_ACCESS_DENIED',
      );
    });

    it('rejects an unknown market (MARKET_NOT_FOUND)', async () => {
      makeService({ marketRow: [] });
      await expectOwnerError(
        service.updateMarket(ACTOR, MARKET_ID, command()),
        'MARKET_NOT_FOUND',
      );
    });
  });

  describe('controlled change surface', () => {
    it('rejects a no-op update (MARKET_NO_CHANGES)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(ACTOR, MARKET_ID, command({ name: 'Malaysia' })),
        'MARKET_NO_CHANGES',
      );
    });

    it('rejects an invalid name (MARKET_INVALID_FIELD)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(ACTOR, MARKET_ID, command({ name: '   ' })),
        'MARKET_INVALID_FIELD',
      );
      await expectOwnerError(
        service.updateMarket(
          ACTOR,
          MARKET_ID,
          command({ name: 'x'.repeat(201) }),
        ),
        'MARKET_INVALID_FIELD',
      );
    });

    it('rejects an invalid currency code (MARKET_INVALID_FIELD)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(
          ACTOR,
          MARKET_ID,
          command({ currencyCode: 'myr' }),
        ),
        'MARKET_INVALID_FIELD',
      );
      await expectOwnerError(
        service.updateMarket(ACTOR, MARKET_ID, command({ currencyCode: 'MY' })),
        'MARKET_INVALID_FIELD',
      );
    });

    it('rejects an invalid IANA timezone (MARKET_INVALID_FIELD)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(
          ACTOR,
          MARKET_ID,
          command({ timezone: 'Mars/Olympus' }),
        ),
        'MARKET_INVALID_FIELD',
      );
    });

    it('rejects an invalid locale (MARKET_INVALID_FIELD)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(
          ACTOR,
          MARKET_ID,
          command({ defaultLocale: 'English!' }),
        ),
        'MARKET_INVALID_FIELD',
      );
    });

    it('rejects a status value outside the allowlist (MARKET_INVALID_FIELD)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(
          ACTOR,
          MARKET_ID,
          command({ status: 'ARCHIVED' as 'ACTIVE' }),
        ),
        'MARKET_INVALID_FIELD',
      );
    });
  });

  describe('deactivation confirmation', () => {
    it('rejects ACTIVE → INACTIVE without confirmation (MARKET_DEACTIVATION_CONFIRMATION_REQUIRED)', async () => {
      makeService();
      await expectOwnerError(
        service.updateMarket(ACTOR, MARKET_ID, command({ status: 'INACTIVE' })),
        'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED',
      );
    });
  });

  describe('error class identity', () => {
    it('owner errors are MarketOwnerError instances with codes', async () => {
      makeService();
      try {
        await service.updateMarket(
          ACTOR,
          MARKET_ID,
          command({ status: 'INACTIVE' }),
        );
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(MarketOwnerError);
        expect((error as MarketOwnerError).code).toBe(
          'MARKET_DEACTIVATION_CONFIRMATION_REQUIRED',
        );
      }
    });
  });
});
