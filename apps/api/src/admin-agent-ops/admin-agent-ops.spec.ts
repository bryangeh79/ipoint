import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentActivationStatusLogs,
  agentActivations,
  commissionRateVersions,
  markets,
  memberProfiles,
  members,
} from '@ipoint/database';
import type { DatabaseService } from '../database/database.service.js';
import { AgentActivationService } from '../domain/agent-activation/service.js';
import { AgentActivationError } from '../domain/agent-activation/agent-activation.errors.js';
import { AdminAgentOpsService } from './admin-agent-ops.service.js';
import { AgentOpsError } from './admin-agent-ops.types.js';

/**
 * P7-S8 Admin Agent Operations adapter unit tests (Command Center
 * 2026-08-07 §6.1).
 *
 * The adapter is a Phase 7 read projection + orchestration layer over the
 * FROZEN Phase 5 agent-activation owner. Every owner-level business
 * control (transition validation, market consistency, durable reason,
 * immutable status log, P5-R1 actor attribution) lives inside
 * `AgentActivationService` — the adapter performs NO such control of its
 * own.
 *
 * This spec therefore asserts:
 * 1. Delegation: suspend/reactivate/deactivate receive the server-derived
 *    market code (from the RbacGuard Current Admin Market context) and
 *    the executing admin identity — never a client-supplied market.
 * 2. The read projections: list (capability state + item mapping) and
 *    detail (status history).
 * 3. The owner error → adapter error mapping (every AGENT_ACTIVATION_*
 *    code; no error swallowed into a 2xx).
 * 4. No owner-level control is duplicated in the adapter.
 *
 * The database/owner surfaces are mocked; the HTTP contract is exercised
 * by the integration suite on a fresh database.
 */

let database: { db: DatabaseService['db']; pool: DatabaseService['pool'] };
let owner: Pick<
  AgentActivationService,
  'suspend' | 'reactivate' | 'deactivate'
>;
let service: AdminAgentOpsService;

const MARKET_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR = {
  adminUserId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-123',
  ipAddress: '127.0.0.1',
  currentMarketId: MARKET_ID,
};

const MARKET_ROW = {
  id: MARKET_ID,
  code: 'MY',
  currencyCode: 'MYR',
};

function activationRow(
  overrides: Partial<Record<string, unknown>> = {},
): typeof agentActivations.$inferSelect {
  return {
    id: AGENT_ID,
    memberId: '55555555-5555-4555-8555-555555555555',
    status: 'ACTIVE',
    paymentReference: null,
    paymentConfirmedAt: null,
    courseCompletedAt: null,
    courseEnrolledAt: null,
    courseReference: null,
    courseConfirmedBy: null,
    approvedAt: null,
    activatedAt: new Date('2026-08-01T00:00:00.000Z'),
    activatedBy: null,
    market: 'MY',
    currency: 'MYR',
    feeRateVersionId: null,
    activationFee: null,
    activationFeeCurrency: 'MYR',
    rejectionReason: null,
    reactivationCount: 0,
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * A query-chain mock resolving rows by the FIRST table of each chain;
 * every terminal method (where/orderBy/limit/offset/innerJoin) keeps the
 * chain thenable with the table's rows.
 */
function mockDb(
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
    return result;
  };
  const chain = (table: unknown) => ({
    where: vi.fn(() => terminal(rows.get(table) ?? [])),
    innerJoin: vi.fn(() => chain(table)),
    leftJoin: vi.fn(() => chain(table)),
    orderBy: vi.fn(() => terminal(rows.get(table) ?? [])),
    limit: vi.fn(() => terminal(rows.get(table) ?? [])),
    offset: vi.fn(() => terminal(rows.get(table) ?? [])),
    groupBy: vi.fn(() => terminal(rows.get(table) ?? [])),
  });
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn((table: unknown) => chain(table)),
    }),
  } as unknown as DatabaseService['db'];
}

beforeEach(() => {
  database = {
    db: {} as DatabaseService['db'],
    pool: { connect: vi.fn() } as unknown as DatabaseService['pool'],
  };
  owner = { suspend: vi.fn(), reactivate: vi.fn(), deactivate: vi.fn() };
  service = new AdminAgentOpsService(
    database as unknown as DatabaseService,
    owner as unknown as AgentActivationService,
  );
});

// ─── Owner command delegation ─────────────────────────────────────────

describe('owner command delegation (frozen Phase 5 owner)', () => {
  it('delegates suspend with the server market code, admin identity and reason', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [agentActivations, [activationRow({ status: 'SUSPENDED' })]],
    ]);
    vi.mocked(owner.suspend).mockResolvedValue(undefined);

    const result = await service.suspendAgent(
      ACTOR,
      MARKET_ID,
      AGENT_ID,
      'Fraud review suspension.',
    );

    expect(result.agent_id).toBe(AGENT_ID);
    expect(owner.suspend).toHaveBeenCalledTimes(1);
    const [agentId, adminUserId, marketCode, reason] =
      vi.mocked(owner.suspend).mock.calls[0] ?? [];
    expect(agentId).toBe(AGENT_ID);
    expect(adminUserId).toBe(ACTOR.adminUserId);
    expect(marketCode).toBe('MY');
    expect(reason).toBe('Fraud review suspension.');
  });

  it('delegates reactivate with the server market code and admin identity', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [agentActivations, [activationRow()]],
    ]);
    vi.mocked(owner.reactivate).mockResolvedValue(undefined);

    const result = await service.reactivateAgent(ACTOR, MARKET_ID, AGENT_ID);

    expect(result.status).toBe('ACTIVE');
    const [agentId, adminUserId, marketCode] =
      vi.mocked(owner.reactivate).mock.calls[0] ?? [];
    expect(agentId).toBe(AGENT_ID);
    expect(adminUserId).toBe(ACTOR.adminUserId);
    expect(marketCode).toBe('MY');
  });

  it('delegates deactivate with the server market code, admin identity and reason', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [agentActivations, [activationRow({ status: 'DEACTIVATED' })]],
    ]);
    vi.mocked(owner.deactivate).mockResolvedValue(undefined);

    const result = await service.deactivateAgent(
      ACTOR,
      MARKET_ID,
      AGENT_ID,
      'Termination.',
    );

    expect(result.status).toBe('DEACTIVATED');
    const [agentId, adminUserId, marketCode, reason] =
      vi.mocked(owner.deactivate).mock.calls[0] ?? [];
    expect(agentId).toBe(AGENT_ID);
    expect(adminUserId).toBe(ACTOR.adminUserId);
    expect(marketCode).toBe('MY');
    expect(reason).toBe('Termination.');
  });

  it('rejects an empty suspend reason (REASON_REQUIRED)', async () => {
    database.db = mockDb([[markets, [MARKET_ROW]]]);
    await expect(
      service.suspendAgent(ACTOR, MARKET_ID, AGENT_ID, '   '),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    expect(owner.suspend).not.toHaveBeenCalled();
  });

  it('surfaces a missing market as AGENT_MARKET_NOT_FOUND before delegation', async () => {
    database.db = mockDb([]);
    await expect(
      service.suspendAgent(ACTOR, MARKET_ID, AGENT_ID, 'Reason.'),
    ).rejects.toMatchObject({ code: 'AGENT_MARKET_NOT_FOUND' });
    expect(owner.suspend).not.toHaveBeenCalled();
  });

  it('maps owner AGENT_ACTIVATION_NOT_FOUND to AGENT_NOT_FOUND', async () => {
    database.db = mockDb([[markets, [MARKET_ROW]]]);
    vi.mocked(owner.suspend).mockRejectedValue(
      new AgentActivationError(
        'AGENT_ACTIVATION_NOT_FOUND',
        'Agent activation record not found',
        { activationId: AGENT_ID },
      ),
    );
    await expect(
      service.suspendAgent(ACTOR, MARKET_ID, AGENT_ID, 'Reason.'),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('maps owner transition rejections to AGENT_INVALID_TRANSITION', async () => {
    database.db = mockDb([[markets, [MARKET_ROW]]]);
    vi.mocked(owner.suspend).mockRejectedValue(
      new AgentActivationError(
        'AGENT_ACTIVATION_INVALID_TRANSITION',
        'Cannot suspend from this status',
      ),
    );
    await expect(
      service.suspendAgent(ACTOR, MARKET_ID, AGENT_ID, 'Reason.'),
    ).rejects.toMatchObject({ code: 'AGENT_INVALID_TRANSITION' });
  });
});

// ─── Read projections ─────────────────────────────────────────────────

describe('read projections (P7-S8 §6.1)', () => {
  it('lists agents with the capability state CONFIGURED when a fee version exists', async () => {
    const activation = activationRow();
    const listRow = {
      id: activation.id,
      memberId: activation.memberId,
      publicMemberId: 'pub_abc',
      memberDisplayName: 'Alice',
      status: activation.status,
      market: activation.market,
      activationFee: activation.activationFee,
      activationFeeCurrency: activation.activationFeeCurrency,
      activatedAt: activation.activatedAt,
      createdAt: activation.createdAt,
      total: 1,
    };
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [
        commissionRateVersions,
        [
          {
            id: '77777777-7777-4777-8777-777777777777',
            rateValue: '388.0000000000',
            market: 'MY',
          },
        ],
      ],
      [agentActivations, [listRow]],
    ]);

    const result = await service.listAgents(ACTOR, MARKET_ID, {
      limit: 50,
      offset: 0,
    });

    expect(result.market_code).toBe('MY');
    expect(result.capability.state).toBe('CONFIGURED');
    expect(result.capability.activation_fee).toBe('388.0000000000');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      agent_id: AGENT_ID,
      public_member_id: 'pub_abc',
      status: 'ACTIVE',
      market: 'MY',
    });
  });

  it('reports the explicit blocked capability state when no fee version exists', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [commissionRateVersions, []],
      [agentActivations, []],
    ]);

    const result = await service.listAgents(ACTOR, MARKET_ID, {
      limit: 50,
      offset: 0,
    });

    expect(result.capability.state).toBe('AGENT_FEE_NOT_CONFIGURED');
    expect(result.capability.activation_fee).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  it('returns detail with the append-only status history (newest first)', async () => {
    const logs = [
      {
        logId: '99999999-9999-4999-8999-999999999999',
        activationId: AGENT_ID,
        fromStatus: 'PENDING_APPROVAL',
        toStatus: 'ACTIVE',
        changedBy: null,
        changedByType: 'SYSTEM',
        reason: null,
        changedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ];
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [
        agentActivations,
        [
          {
            activation: activationRow(),
            publicMemberId: 'pub_abc',
            memberDisplayName: 'Alice',
          },
        ],
      ],
      [agentActivationStatusLogs, logs],
      [members, []],
      [memberProfiles, []],
    ]);

    const result = await service.getAgent(ACTOR, MARKET_ID, AGENT_ID);

    expect(result.status).toBe('ACTIVE');
    expect(result.status_history).toHaveLength(1);
    expect(result.status_history[0]).toMatchObject({
      from_status: 'PENDING_APPROVAL',
      to_status: 'ACTIVE',
      changed_by_type: 'SYSTEM',
    });
  });

  it('throws AGENT_NOT_FOUND when the activation is not in the current market', async () => {
    database.db = mockDb([
      [markets, [MARKET_ROW]],
      [agentActivations, []],
    ]);
    await expect(
      service.getAgent(ACTOR, MARKET_ID, AGENT_ID),
    ).rejects.toBeInstanceOf(AgentOpsError);
  });
});
