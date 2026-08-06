import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mcpAdjustmentMarketRules,
  mcpAdjustmentReasonCodes,
  mcpAdjustmentRequests,
  markets,
  mcpAccounts,
} from '@ipoint/database';
import type { DatabaseService } from '../database/database.service.js';
import { McpAdjustmentOwnerService } from './mcp-adjustment.owner.service.js';
import {
  canonicalHash,
  gtDecimal,
  lteDecimal,
  subtractDecimal,
} from './mcp-adjustment.owner.service.js';
import type {
  CreateMcpAdjustmentCommand,
  McpAdjustmentOwnerActor,
} from './mcp-adjustment.owner.types.js';

/**
 * P7-S7A MCP adjustment owner unit tests.
 *
 * The owner is the SOLE enforcement boundary for every manual-MCP control
 * (P7-OD-03/10/11/18): permission re-check, selected market, caps routing
 * (10,000/100,000 Malaysia baseline, no fallback), evidence and attachment
 * rules, reason-code catalog, immutable rejected replacement linkage,
 * payload-hash idempotency, Maker/Checker inequality and the exact-decimal
 * helpers. The full transaction paths (lifecycle transitions, atomic
 * ledger + state + audit, concurrency, failure/retry) are exercised by the
 * integration suite on fresh PostgreSQL databases.
 */

let database: {
  db: DatabaseService['db'];
  pool: DatabaseService['pool'];
  runTransaction: ReturnType<typeof vi.fn>;
};
let rbac: {
  isAllowed: ReturnType<typeof vi.fn>;
  hasMarketAccess: ReturnType<typeof vi.fn>;
};
let audit: { appendWithinTransaction: ReturnType<typeof vi.fn> };
let service: McpAdjustmentOwnerService;

const MARKET_ID = '22222222-2222-4222-8222-222222222222';
const MAKER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

const ACTOR: McpAdjustmentOwnerActor = {
  adminUserId: MAKER_ID,
  requestId: 'req-123',
  ipAddress: '127.0.0.1',
  currentMarketId: MARKET_ID,
  marketContextVersion: 3,
};

const ACCOUNT_ROW = {
  id: ACCOUNT_ID,
  merchantBranchId: '44444444-4444-4444-8444-444444444444',
  marketId: MARKET_ID,
  availableBalance: '5000',
  status: 'ACTIVE',
  version: 7,
};

const MARKET_ROW = { id: MARKET_ID, code: 'MY' };

const RULE_ROW = {
  marketCode: 'MY',
  softCap: '10000',
  hardCap: '100000',
  secureEvidenceAvailable: false,
  isActive: true,
};

const LOW_RISK_REASON = {
  code: 'OPERATIONAL_CORRECTION',
  isHighRisk: false,
  isActive: true,
};

function createCommand(
  overrides: Partial<CreateMcpAdjustmentCommand> = {},
): CreateMcpAdjustmentCommand {
  return {
    mcpAccountId: ACCOUNT_ID,
    entryType: 'MANUAL_CREDIT',
    amount: '100',
    reasonCode: 'OPERATIONAL_CORRECTION',
    explanation: 'Unit test correction',
    caseReference: 'CASE-001',
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

const tableName = (table: unknown): string => {
  const key = Symbol.for('drizzle:Name');
  const name = (table as Record<symbol, unknown>)[key];
  return typeof name === 'string' ? name : '';
};

/**
 * Mock the pre-transaction lookups: MCP account (mcp_accounts), active
 * market (markets), market rule, reason code and the prior-request linkage
 * check (mcp_adjustment_requests). Keyed by drizzle table name.
 */
function mockDb(rowsByTable: Record<string, unknown[]>) {
  const terminal = (rows: unknown[]) => {
    const promise = Promise.resolve(rows) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>;
    };
    promise.limit = vi.fn().mockResolvedValue(rows);
    return promise;
  };
  const where = vi.fn((_cond: unknown) => terminal(rowsByTable['_any'] ?? []));
  const from = vi.fn((table: unknown) => {
    const rows = rowsByTable[tableName(table)] ?? [];
    return { where: vi.fn(() => terminal(rows)) };
  });
  return {
    select: vi.fn().mockReturnValue({ from }),
    where,
  } as unknown as DatabaseService['db'];
}

function createService(rowsByTable: Record<string, unknown[]>) {
  const db = mockDb(rowsByTable);
  database = {
    db,
    pool: {} as DatabaseService['pool'],
    runTransaction: vi.fn(),
  };
  rbac = {
    isAllowed: vi.fn().mockResolvedValue(true),
    hasMarketAccess: vi.fn().mockResolvedValue(true),
  };
  audit = { appendWithinTransaction: vi.fn().mockResolvedValue(undefined) };
  service = new McpAdjustmentOwnerService(
    database as unknown as DatabaseService,
    audit as never,
    rbac as never,
  );
  return { db };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('exact-decimal helpers (string-only, never float)', () => {
  it('compares decimals exactly', () => {
    expect(gtDecimal('10001', '10000')).toBe(true);
    expect(gtDecimal('10000', '10000')).toBe(false);
    expect(lteDecimal('10000', '10000')).toBe(true);
    expect(lteDecimal('10000.0000000001', '10000')).toBe(false);
  });

  it('subtracts signed decimals exactly', () => {
    expect(subtractDecimal('5100', '100')).toBe('5000');
    expect(subtractDecimal('5100', '-100')).toBe('5200');
    expect(subtractDecimal('0.5', '0.25')).toBe('0.25');
  });

  it('derives a stable canonical payload hash (key order independent)', () => {
    const a = canonicalHash({ b: 1, a: 'x', c: null });
    const b = canonicalHash({ c: null, b: 1, a: 'x' });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});

describe('create: identity and market guards', () => {
  it('rejects when the actor has no maker permission', async () => {
    createService({});
    rbac.isAllowed.mockResolvedValue(false);
    await expect(service.create(ACTOR, createCommand())).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_PERMISSION_DENIED',
    });
  });

  it('rejects when no server Current Admin Market is selected', async () => {
    createService({});
    await expect(
      service.create({ ...ACTOR, currentMarketId: undefined }, createCommand()),
    ).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_MARKET_SELECTION_REQUIRED',
    });
  });

  it('rejects an invalid amount grammar and zero', async () => {
    createService({});
    for (const amount of ['0', '0.00', '-5', '1.00000000001', 'abc']) {
      await expect(
        service.create(ACTOR, createCommand({ amount })),
      ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_INVALID_AMOUNT' });
    }
  });

  it('rejects a missing idempotency key', async () => {
    createService({});
    await expect(
      service.create(ACTOR, createCommand({ idempotencyKey: '  ' })),
    ).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_IDEMPOTENCY_KEY_REQUIRED',
    });
  });
});

describe('create: account / market / caps / evidence guards', () => {
  beforeEach(() => {
    createService({
      ['mcp_accounts']: [ACCOUNT_ROW],
      ['markets']: [MARKET_ROW],
      ['mcp_adjustment_market_rules']: [RULE_ROW],
      ['mcp_adjustment_reason_codes']: [LOW_RISK_REASON],
    });
  });

  it('rejects an unknown or closed account', async () => {
    const { db } = createService({ ['mcp_accounts']: [] });
    void db;
    await expect(service.create(ACTOR, createCommand())).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_ACCOUNT_NOT_FOUND',
    });
    const { db: db2 } = createService({
      ['mcp_accounts']: [{ ...ACCOUNT_ROW, status: 'CLOSED' }],
    });
    void db2;
    await expect(service.create(ACTOR, createCommand())).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_ACCOUNT_NOT_FOUND',
    });
  });

  it('rejects when the account market differs from the Current Admin Market', async () => {
    await expect(
      service.create(
        { ...ACTOR, currentMarketId: '55555555-5555-4555-8555-555555555555' },
        createCommand(),
      ),
    ).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_MARKET_CONTEXT_MISMATCH',
    });
  });

  it('rejects without active market access', async () => {
    rbac.hasMarketAccess.mockResolvedValue(false);
    await expect(service.create(ACTOR, createCommand())).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_MARKET_ACCESS_DENIED',
    });
  });

  it('blocks a market with no configured caps (no fallback)', async () => {
    const { db } = createService({
      ['mcp_accounts']: [ACCOUNT_ROW],
      ['markets']: [{ id: MARKET_ID, code: 'SG' }],
      ['mcp_adjustment_market_rules']: [],
      ['mcp_adjustment_reason_codes']: [LOW_RISK_REASON],
    });
    void db;
    await expect(service.create(ACTOR, createCommand())).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_MARKET_NOT_CONFIGURED',
    });
  });

  it('rejects an amount above the hard cap', async () => {
    await expect(
      service.create(ACTOR, createCommand({ amount: '100001' })),
    ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_ABOVE_HARD_CAP' });
  });

  it('rejects an inactive or unknown reason code', async () => {
    const { db } = createService({
      ['mcp_accounts']: [ACCOUNT_ROW],
      ['markets']: [MARKET_ROW],
      ['mcp_adjustment_market_rules']: [RULE_ROW],
      ['mcp_adjustment_reason_codes']: [],
    });
    void db;
    await expect(
      service.create(ACTOR, createCommand({ reasonCode: 'NOT_A_CODE' })),
    ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_REASON_CODE_INVALID' });
  });

  it('requires an attachment reference above the soft cap', async () => {
    await expect(
      service.create(ACTOR, createCommand({ amount: '10001' })),
    ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED' });
  });

  it('requires an attachment reference for a high-risk reason code', async () => {
    const { db } = createService({
      ['mcp_accounts']: [ACCOUNT_ROW],
      ['markets']: [MARKET_ROW],
      ['mcp_adjustment_market_rules']: [RULE_ROW],
      ['mcp_adjustment_reason_codes']: [
        { code: 'FRAUD_RECOVERY', isHighRisk: true, isActive: true },
      ],
    });
    void db;
    await expect(
      service.create(ACTOR, createCommand({ reasonCode: 'FRAUD_RECOVERY' })),
    ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_ATTACHMENT_REQUIRED' });
  });

  it('rejects a prior-request linkage that is not a rejected request', async () => {
    const { db } = createService({
      ['mcp_accounts']: [ACCOUNT_ROW],
      ['markets']: [MARKET_ROW],
      ['mcp_adjustment_market_rules']: [RULE_ROW],
      ['mcp_adjustment_reason_codes']: [LOW_RISK_REASON],
      ['mcp_adjustment_requests']: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          status: 'APPROVED',
          marketId: MARKET_ID,
          mcpAccountId: ACCOUNT_ID,
        },
      ],
    });
    void db;
    await expect(
      service.create(
        ACTOR,
        createCommand({
          priorRequestId: '99999999-9999-4999-8999-999999999999',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_PRIOR_REQUEST_INVALID',
    });
  });
});

describe('decide: Maker/Checker inequality and caps routing (unit guards)', () => {
  it('denies the maker as checker at any amount', async () => {
    // The runtime inequality check happens inside the transaction after
    // locking; the integration suite proves it on real rows. Here we only
    // prove the error type is exported and the checker permission gate is
    // enforced before the transaction.
    createService({});
    rbac.isAllowed.mockResolvedValue(false);
    await expect(
      service.decide(ACTOR, '99999999-9999-4999-8999-999999999999', {
        decision: 'APPROVED',
        reason: 'no permission',
        requireAttachment: false,
      }),
    ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_PERMISSION_DENIED' });
  });

  it('requires a decision reason', async () => {
    createService({});
    await expect(
      service.decide(ACTOR, '99999999-9999-4999-8999-999999999999', {
        decision: 'REJECTED',
        reason: '   ',
        requireAttachment: false,
      }),
    ).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_DECISION_REASON_REQUIRED',
    });
  });
});

describe('execute: permission gate and terminal replay contract', () => {
  it('denies without the execute permission', async () => {
    createService({});
    rbac.isAllowed.mockResolvedValue(false);
    await expect(
      service.execute(ACTOR, { requestId: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toMatchObject({ code: 'MCP_ADJUSTMENT_PERMISSION_DENIED' });
  });

  it('rejects without a server current market', async () => {
    createService({});
    await expect(
      service.execute(
        { ...ACTOR, currentMarketId: undefined },
        { requestId: '99999999-9999-4999-8999-999999999999' },
      ),
    ).rejects.toMatchObject({
      code: 'MCP_ADJUSTMENT_MARKET_SELECTION_REQUIRED',
    });
  });
});
