import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import {
  ipointAdjustmentDecisions,
  ipointAdjustmentMarketRules,
  ipointAdjustmentReasonCodes,
  ipointAdjustmentRequests,
  markets,
  memberProfiles,
  memberWalletAccounts,
  members,
} from '@ipoint/database';
import type { WalletAdjustmentOwnerService } from '../wallet/wallet-adjustment.owner.service.js';
import type { WalletAdjustmentRequestView } from '../wallet/wallet-adjustment.owner.types.js';
import { AdminIpointAdjustOpsService } from './admin-ipoint-adjust-ops.service.js';
import type { AdminIpointAdjustmentViewDto } from './admin-ipoint-adjust-ops.types.js';

/**
 * P7-S7B Admin iPoint Adjustment Operations adapter unit tests
 * (SEC-01 §6 / P7-S1 §17).
 *
 * The adapter is a Phase 7 read projection + orchestration layer over the
 * FROZEN SEC-01 owner. Every owner-level business control (RBAC,
 * selected market, Maker≠Checker inequality, caps routing, evidence,
 * idempotency, atomic execution, audit) lives inside
 * `WalletAdjustmentOwnerService` — the adapter performs NO such control
 * of its own.
 *
 * This spec therefore asserts:
 * 1. Delegation: the owner commands receive the exact server-derived
 *    actor (adminUserId/requestId/ipAddress/currentMarketId/
 *    marketContextVersion), the create command fields and the
 *    Idempotency-Key.
 * 2. The read projections: queue (state filter + pagination), detail
 *    with immutable decision history, config (market rules + reason
 *    codes, explicit blocked state for unconfigured markets) and the
 *    wallet/member lookup (masked, never evidence contents).
 * 3. No owner-level control is duplicated in the adapter.
 *
 * The database/owner surfaces are mocked; the HTTP contract is exercised
 * by the integration suite on a fresh database.
 */

let database: { db: DatabaseService['db']; pool: DatabaseService['pool'] };
let owner: Pick<
  WalletAdjustmentOwnerService,
  'create' | 'submit' | 'decide' | 'execute'
>;
let service: AdminIpointAdjustOpsService;

const MARKET_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const WALLET_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR = {
  adminUserId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-123',
  ipAddress: '127.0.0.1',
  currentMarketId: MARKET_ID,
  marketContextVersion: 3,
};

function requestRow(
  overrides: Partial<Record<string, unknown>> = {},
): typeof ipointAdjustmentRequests.$inferSelect {
  return {
    id: REQUEST_ID,
    walletAccountId: WALLET_ID,
    memberId: '55555555-5555-4555-8555-555555555555',
    marketId: MARKET_ID,
    direction: 'CREDIT',
    amount: '5000',
    state: 'SUBMITTED',
    reasonCode: 'OPERATIONAL_CORRECTION',
    explanation: 'Ops correction.',
    caseReference: 'CASE-001',
    attachmentReference: null,
    makerAdminUserId: ACTOR.adminUserId,
    checkerAdminUserId: null,
    submittedAt: new Date('2026-08-06T00:00:00.000Z'),
    executedAt: null,
    failedAt: null,
    priorRequestId: null,
    ledgerEntryId: null,
    version: 1,
    idempotencyScope: 'ipoint.adjustment.owner.create:wallet:actor',
    idempotencyKey: 'idem-1',
    payloadHash: 'a'.repeat(64),
    requestHash: 'b'.repeat(64),
    createdAt: new Date('2026-08-06T00:00:00.000Z'),
    updatedAt: new Date('2026-08-06T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * A query-chain mock: `.select().from(table).where(...)` returns a
 * thenable carrying the table's rows, with `limit()` / `orderBy()` /
 * `offset()` terminal methods. Rows are dispatched by table identity.
 */
function mockRowsByTable(
  rowsByTable: ReadonlyArray<readonly [unknown, unknown[]]>,
): DatabaseService['db'] {
  const rows = new Map<unknown, unknown[]>(rowsByTable);
  const terminal = (forTable: unknown[]) => {
    const result = Promise.resolve(forTable) as Promise<unknown[]> & {
      limit: ReturnType<typeof vi.fn>;
      orderBy: ReturnType<typeof vi.fn>;
      offset: ReturnType<typeof vi.fn>;
    };
    result.limit = vi.fn().mockReturnValue(result);
    result.orderBy = vi.fn().mockReturnValue(result);
    result.offset = vi.fn().mockResolvedValue(forTable);
    // `.where()`/`.orderBy()`/`.limit()` resolve to a chainable object;
    // awaiting the chain (or calling `.offset()`) resolves the rows.
    return result;
  };
  const from = vi.fn((table: unknown) => ({
    where: vi.fn(() => terminal(rows.get(table) ?? [])),
    innerJoin: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => terminal(rows.get(table) ?? [])),
        orderBy: vi.fn(() => terminal(rows.get(table) ?? [])),
      })),
    })),
  }));
  return {
    select: vi.fn().mockReturnValue({ from }),
  } as unknown as DatabaseService['db'];
}

function ownerView(
  overrides: Partial<WalletAdjustmentRequestView> = {},
): WalletAdjustmentRequestView {
  return {
    id: REQUEST_ID,
    walletAccountId: WALLET_ID,
    memberId: '55555555-5555-4555-8555-555555555555',
    marketId: MARKET_ID,
    direction: 'CREDIT',
    amount: '5000',
    state: 'DRAFT',
    reasonCode: 'OPERATIONAL_CORRECTION',
    explanation: 'Ops correction.',
    caseReference: 'CASE-001',
    attachmentReference: null,
    makerAdminUserId: ACTOR.adminUserId,
    checkerAdminUserId: null,
    submittedAt: null,
    executedAt: null,
    failedAt: null,
    priorRequestId: null,
    ledgerEntryId: null,
    version: 1,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  database = {
    db: {} as DatabaseService['db'],
    pool: { connect: vi.fn() } as unknown as DatabaseService['pool'],
  };
  owner = {
    create: vi.fn(),
    submit: vi.fn(),
    decide: vi.fn(),
    execute: vi.fn(),
  };
  service = new AdminIpointAdjustOpsService(
    database as unknown as DatabaseService,
    owner as unknown as WalletAdjustmentOwnerService,
  );
});

// ─── Owner command delegation ─────────────────────────────────────────

describe('owner command delegation (P7-S7B frozen SEC-01 owner)', () => {
  it('delegates create with the server actor, command fields and Idempotency-Key', async () => {
    vi.mocked(owner.create).mockResolvedValue(ownerView());
    const command = {
      walletAccountId: WALLET_ID,
      direction: 'CREDIT' as const,
      amount: '5000',
      reasonCode: 'OPERATIONAL_CORRECTION',
      explanation: 'Ops correction.',
      caseReference: 'CASE-001',
      idempotencyKey: 'idem-1',
    };

    const result = await service.create(ACTOR, command);

    expect(result.id).toBe(REQUEST_ID);
    expect(owner.create).toHaveBeenCalledTimes(1);
    const [ownerActor, ownerCommand] =
      vi.mocked(owner.create).mock.calls[0] ?? [];
    expect(ownerActor).toEqual({
      adminUserId: ACTOR.adminUserId,
      requestId: 'req-123',
      ipAddress: '127.0.0.1',
      currentMarketId: MARKET_ID,
      marketContextVersion: 3,
    });
    expect(ownerCommand).toEqual(command);
  });

  it('delegates submit/decide/execute with the server actor (no client control)', async () => {
    vi.mocked(owner.submit).mockResolvedValue(
      ownerView({ state: 'SUBMITTED' }),
    );
    vi.mocked(owner.decide).mockResolvedValue(ownerView({ state: 'APPROVED' }));
    vi.mocked(owner.execute).mockResolvedValue(
      ownerView({ state: 'EXECUTED' }),
    );

    await service.submit(ACTOR, REQUEST_ID);
    await service.decide(ACTOR, REQUEST_ID, {
      decision: 'APPROVED',
      reason: 'Evidence verified.',
      requireAttachment: false,
    });
    await service.execute(ACTOR, REQUEST_ID);

    expect(owner.submit).toHaveBeenCalledWith(
      expect.objectContaining({ currentMarketId: MARKET_ID }),
      REQUEST_ID,
    );
    expect(owner.decide).toHaveBeenCalledWith(
      expect.objectContaining({ currentMarketId: MARKET_ID }),
      REQUEST_ID,
      {
        decision: 'APPROVED',
        reason: 'Evidence verified.',
        requireAttachment: false,
      },
    );
    expect(owner.execute).toHaveBeenCalledWith(
      expect.objectContaining({ currentMarketId: MARKET_ID }),
      REQUEST_ID,
    );
  });
});

// ─── Read projections ────────────────────────────────────────────────

describe('read projections (P7-S7B Finance queue / detail / config / wallets)', () => {
  it('lists the queue with the state filter and pagination passthrough', async () => {
    database.db = mockRowsByTable([[ipointAdjustmentRequests, [requestRow()]]]);

    const result = await service.listForMarket(MARKET_ID, {
      state: 'SUBMITTED',
      limit: 25,
      offset: 10,
    });

    expect(result.marketId).toBe(MARKET_ID);
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(10);
    expect(result.items[0]?.state).toBe('SUBMITTED');
    expect(result.items[0]?.amount).toBe('5000');
    // Exact values survive the projection untouched.
    expect(result.items[0]?.createdAt).toBe('2026-08-06T00:00:00.000Z');
  });

  it('projects the detail with the immutable decision history', async () => {
    database.db = mockRowsByTable([
      [ipointAdjustmentRequests, [requestRow()]],
      [
        ipointAdjustmentDecisions,
        [
          {
            id: '66666666-6666-4666-8666-666666666666',
            adjustmentRequestId: REQUEST_ID,
            marketId: MARKET_ID,
            checkerAdminUserId: '77777777-7777-4777-8777-777777777777',
            decision: 'REJECTED',
            reason: 'Missing supporting evidence.',
            decidedAt: new Date('2026-08-06T01:00:00.000Z'),
          },
        ],
      ],
    ]);

    const result = await service.detail(MARKET_ID, REQUEST_ID);

    expect(result.request.id).toBe(REQUEST_ID);
    expect(result.decisions[0]?.decision).toBe('REJECTED');
    expect(result.decisions[0]?.reason).toBe('Missing supporting evidence.');
    expect(result.decisions[0]?.decidedAt).toBe('2026-08-06T01:00:00.000Z');
  });

  it('projects the maker config: rules + reason codes, configured=false for unconfigured markets', async () => {
    database.db = mockRowsByTable([
      [
        markets,
        [
          {
            id: MARKET_ID,
            code: 'MY',
            name: 'Malaysia',
            status: 'ACTIVE',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
            defaultLocale: 'en-MY',
          },
        ],
      ],
      [
        ipointAdjustmentMarketRules,
        [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            marketCode: 'MY',
            softCap: '10000',
            hardCap: '100000',
            secureEvidenceAvailable: false,
            isActive: true,
            version: 1,
          },
        ],
      ],
      [
        ipointAdjustmentReasonCodes,
        [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            marketCode: 'MY',
            code: 'OPERATIONAL_CORRECTION',
            label: 'Operational correction of a processing error',
            isHighRisk: false,
            isActive: true,
            version: 1,
          },
        ],
      ],
    ]);

    const result = await service.config(MARKET_ID);

    expect(result.configured).toBe(true);
    expect(result.marketCode).toBe('MY');
    expect(result.rule?.softCap).toBe('10000');
    expect(result.rule?.hardCap).toBe('100000');
    expect(result.rule?.secureEvidenceAvailable).toBe(false);
    expect(result.reasonCodes[0]?.code).toBe('OPERATIONAL_CORRECTION');
  });

  it('reports the explicit blocked state for a market without a rules row', async () => {
    database.db = mockRowsByTable([
      [
        markets,
        [
          {
            id: MARKET_ID,
            code: 'ZZ',
            name: 'Unconfigured',
            status: 'ACTIVE',
            currencyCode: 'MYR',
            timezone: 'Asia/Kuala_Lumpur',
            defaultLocale: 'en-MY',
          },
        ],
      ],
      [ipointAdjustmentMarketRules, []],
      [ipointAdjustmentReasonCodes, []],
    ]);

    const result = await service.config(MARKET_ID);

    expect(result.configured).toBe(false);
    expect(result.rule).toBeNull();
    expect(result.reasonCodes).toEqual([]);
  });

  it('looks up wallets with masked identity and exact balance strings', async () => {
    // The join-chain mock resolves rows from the FROM table only, so the
    // projected row carries every select alias (wallet + member + profile).
    database.db = mockRowsByTable([
      [
        memberWalletAccounts,
        [
          {
            walletId: WALLET_ID,
            memberId: '55555555-5555-4555-8555-555555555555',
            marketId: MARKET_ID,
            availableBalance: '5000.0000000000',
            archivedAt: null,
            updatedAt: new Date('2026-08-06T00:00:00.000Z'),
            memberPublicId: 'pub_abc123',
            displayName: 'Ali',
          },
        ],
      ],
      [members, []],
      [memberProfiles, []],
    ]);

    const result = await service.searchWallets(MARKET_ID, 'Ali', 20);

    expect(result[0]?.walletId).toBe(WALLET_ID);
    expect(result[0]?.memberPublicId).toBe('pub_abc123');
    expect(result[0]?.displayName).toBe('Ali');
    expect(result[0]?.availableBalance).toBe('5000.0000000000');
    expect(result[0]?.archived).toBe(false);
  });
});
