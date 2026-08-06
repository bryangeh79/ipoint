import { randomUUID } from 'node:crypto';
import {
  merchantApiIdempotencyKeys,
  rewardRuleVersions,
} from '@ipoint/database';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../platform-access/audit.service.js';
import type { RbacService } from '../platform-access/rbac.service.js';
import { AdminRewardService } from './admin-reward.service.js';

const adminUserId = randomUUID();
const marketId = randomUUID();

const now = new Date('2026-07-22T00:00:00.000Z');
/**
 * 2030-06-14T16:00:00Z == 2030-06-15 00:00:00 in Asia/Kuala_Lumpur (UTC+8)
 * — a strictly future market-local midnight for the activation checks.
 */
const futureMidnight = new Date('2030-06-14T16:00:00.000Z');
const actor = {
  adminUserId,
  ipAddress: '127.0.0.1',
  currentMarketId: marketId,
  marketContextVersion: 2,
};

function query(result: unknown[]) {
  const promise = Promise.resolve(result);
  return {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    then: promise.then.bind(promise),
  };
}

function mutation(returning: unknown[][]) {
  const promise = Promise.resolve([]);
  return {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve(returning.shift() ?? [])),
    then: promise.then.bind(promise),
  };
}

function createService(
  selects: unknown[][] = [],
  returning: unknown[][] = [],
  rbac: Partial<Pick<RbacService, 'isAllowed'>> = {},
) {
  const selectQueue = [...selects];
  const returningQueue = [...returning];
  const db = {
    select: vi.fn(() => query(selectQueue.shift() ?? [])),
    insert: vi.fn(() => mutation(returningQueue)),
    update: vi.fn(() => mutation(returningQueue)),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    transaction: vi.fn((cb: (tx: typeof db) => Promise<unknown>) => cb(db)),
  };
  const database = {
    db,
    runTransaction: vi.fn((callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
    ),
  };
  const audit = new AuditService(database as unknown as DatabaseService);
  const rbacMock = {
    isAllowed: vi.fn().mockResolvedValue(true),
    ...rbac,
  };
  return {
    service: new AdminRewardService(
      database as unknown as DatabaseService,
      audit,
      rbacMock as unknown as RbacService,
    ),
    db,
    database,
    rbac: rbacMock,
  };
}

/** Version row fixture returned by the mocked insert. */
function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    name: 'New Rule',
    description: 'Test',
    effectiveFrom: futureMidnight,
    effectiveTo: null,
    rewardRate: '0.05',
    capType: 'NONE',
    capValue: '0',
    minimumReward: '0',
    marketId,
    createdBy: adminUserId,
    reason: 'Test reason',
    archivedAt: null,
    createdAt: now,
    ...overrides,
  };
}

describe('AdminRewardService', () => {
  // ─── Rule CRUD ─────────────────────────────────────────────────────

  it('lists rule versions with pagination', async () => {
    const { service } = createService([
      [{ total: 1 }],
      [
        {
          id: randomUUID(),
          name: 'Standard Rewards v1',
          description: 'Default reward rule',
          reason: null,
          effectiveFrom: now,
          effectiveTo: null,
          rewardRate: '0.05',
          capType: 'FLAT',
          capValue: '100',
          minimumReward: '0',
          marketId,
          createdBy: adminUserId,
          archivedAt: null,
          createdAt: now,
        },
      ],
    ]);
    const result = await service.listRuleVersions(actor, {
      page: 1,
      pageSize: 20,
      includeArchived: false,
    });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]?.name).toBe('Standard Rewards v1');
    expect(result.items[0]?.isArchived).toBe(false);
  });

  it('gets rule version detail with version history', async () => {
    const ruleId = randomUUID();
    const { service } = createService([
      [
        {
          id: ruleId,
          name: 'Standard Rewards v2',
          description: 'Updated rule',
          effectiveFrom: now,
          effectiveTo: null,
          rewardRate: '0.06',
          capType: 'FLAT',
          capValue: '150',
          minimumReward: '0',
          marketId,
          createdBy: adminUserId,
          archivedAt: null,
          createdAt: now,
        },
      ],
      [
        {
          id: ruleId,
          name: 'Standard Rewards v2',
          rewardRate: '0.06',
          effectiveFrom: now,
          effectiveTo: null,
          marketId,
          isArchived: false,
          createdAt: now,
        },
        {
          id: randomUUID(),
          name: 'Standard Rewards v2',
          rewardRate: '0.05',
          effectiveFrom: new Date('2026-06-01'),
          effectiveTo: null,
          marketId,
          isArchived: false,
          createdAt: new Date('2026-06-01'),
        },
      ],
    ]);
    const result = await service.getRuleVersion(actor, ruleId);
    expect(result.versionHistory).toHaveLength(2);
    expect(result.versionHistory[0]?.name).toBe('Standard Rewards v2');
  });

  it('creates a rule version atomically with idempotency, audit and local + UTC times', async () => {
    const ruleId = randomUUID();
    const claimId = randomUUID();
    const { service, db, database } = createService(
      [
        [{ id: adminUserId }], // market access
        [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }], // market row
        [], // overlap: no existing rows
      ],
      [
        [{ id: claimId }], // idempotency claim insert
        [versionRow({ id: ruleId })], // version insert
        [], // audit_logs insert
        [], // entity_timelines insert
        [], // mechanism update
      ],
    );
    const result = await service.createRuleVersion(actor, {
      name: 'New Rule',
      description: 'Test',
      effectiveFrom: futureMidnight.toISOString(),
      rewardRate: '0.05',
      capType: 'NONE',
      capValue: '0',
      minimumReward: '0',
      marketId,
      reason: 'Test reason',
      idempotencyKey: 'key-1',
    });
    expect(result.id).toBe(ruleId);
    expect(result.name).toBe('New Rule');
    expect(result.effectiveFrom).toBe('2030-06-14T16:00:00.000Z');
    expect(result.effectiveFromLocal).toBe('2030-06-15 00:00:00');
    expect(result.timezone).toBe('Asia/Kuala_Lumpur');
    expect(result.marketId).toBe(marketId);
    expect(result.reason).toBe('Test reason');
    // The whole command runs in ONE transaction (atomic write + audit).
    expect(database.runTransaction).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledWith(merchantApiIdempotencyKeys);
    expect(db.insert).toHaveBeenCalledWith(rewardRuleVersions);
  });

  it('rejects when the actor lacks the reward.rule.schedule permission', async () => {
    const { service } = createService([], [], {
      isAllowed: vi.fn().mockResolvedValue(false),
    });
    await expect(
      service.createRuleVersion(actor, {
        name: 'New Rule',
        effectiveFrom: futureMidnight.toISOString(),
        rewardRate: '0.05',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId,
        reason: 'Test reason',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_PERMISSION_DENIED' });
  });

  it('rejects missing, blank and overlength reasons', async () => {
    const { service } = createService();
    const base = {
      name: 'New Rule',
      effectiveFrom: futureMidnight.toISOString(),
      rewardRate: '0.05',
      capType: 'NONE' as const,
      capValue: '0',
      minimumReward: '0',
      marketId,
      idempotencyKey: 'key-1',
    };
    await expect(service.createRuleVersion(actor, base)).rejects.toMatchObject({
      code: 'ADMIN_REWARD_REASON_REQUIRED',
    });
    await expect(
      service.createRuleVersion(actor, { ...base, reason: '   ' }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_REASON_REQUIRED' });
    await expect(
      service.createRuleVersion(actor, { ...base, reason: 'x'.repeat(501) }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_REASON_REQUIRED' });
  });

  it('rejects a missing idempotency key', async () => {
    const { service } = createService();
    await expect(
      service.createRuleVersion(actor, {
        name: 'New Rule',
        effectiveFrom: futureMidnight.toISOString(),
        rewardRate: '0.05',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId,
        reason: 'Test reason',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('rejects when no server Current Admin Market is selected', async () => {
    const { service } = createService();
    await expect(
      service.createRuleVersion(
        { adminUserId, ipAddress: '127.0.0.1' },
        {
          name: 'New Rule',
          effectiveFrom: futureMidnight.toISOString(),
          rewardRate: '0.05',
          capType: 'NONE',
          capValue: '0',
          minimumReward: '0',
          marketId,
          reason: 'Test reason',
          idempotencyKey: 'key-1',
        },
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_MARKET_SELECTION_REQUIRED' });
  });

  it('rejects when the body market differs from the server Current Admin Market', async () => {
    const { service } = createService();
    await expect(
      service.createRuleVersion(actor, {
        name: 'New Rule',
        effectiveFrom: futureMidnight.toISOString(),
        rewardRate: '0.05',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId: randomUUID(),
        reason: 'Test reason',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_MARKET_CONTEXT_MISMATCH' });
  });

  it('accepts the 0% and 0.05% boundaries', async () => {
    for (const rate of ['0', '0.05']) {
      const ruleId = randomUUID();
      const { service } = createService(
        [
          [{ id: adminUserId }],
          [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
          [],
        ],
        [
          [{ id: randomUUID() }],
          [versionRow({ id: ruleId, rewardRate: rate })],
          [],
          [],
          [],
        ],
      );
      const result = await service.createRuleVersion(actor, {
        name: 'New Rule',
        effectiveFrom: futureMidnight.toISOString(),
        rewardRate: rate,
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId,
        reason: 'Test reason',
        idempotencyKey: `key-${rate}`,
      });
      expect(result.id).toBe(ruleId);
    }
  });

  it('rejects negative rates, rates above 0.05 and more than six decimals', async () => {
    const { service } = createService([
      [{ id: adminUserId }],
      [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
      [{ id: adminUserId }],
      [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
      [{ id: adminUserId }],
      [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
    ]);
    const base = {
      name: 'New Rule',
      effectiveFrom: futureMidnight.toISOString(),
      capType: 'NONE' as const,
      capValue: '0',
      minimumReward: '0',
      marketId,
      reason: 'Test reason',
      idempotencyKey: 'key-1',
    };
    await expect(
      service.createRuleVersion(actor, { ...base, rewardRate: '-0.01' }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_RATE_PRECISION_EXCEEDED' });
    await expect(
      service.createRuleVersion(actor, { ...base, rewardRate: '0.050001' }),
    ).rejects.toMatchObject({
      code: 'ADMIN_REWARD_RATE_EXCEEDS_GOVERNANCE_LIMIT',
    });
    await expect(
      service.createRuleVersion(actor, { ...base, rewardRate: '0.0000001' }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_RATE_PRECISION_EXCEEDED' });
  });

  it('rejects activation that is not a future market-local 00:00', async () => {
    const { service } = createService([
      [{ id: adminUserId }],
      [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
      [{ id: adminUserId }],
      [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
    ]);
    const base = {
      name: 'New Rule',
      rewardRate: '0.05',
      capType: 'NONE' as const,
      capValue: '0',
      minimumReward: '0',
      marketId,
      reason: 'Test reason',
      idempotencyKey: 'key-1',
    };
    // Past market-local midnight (2020-01-01 00:00 KL == 2019-12-31 16:00Z).
    await expect(
      service.createRuleVersion(actor, {
        ...base,
        effectiveFrom: '2019-12-31T16:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_ACTIVATION_NOT_FUTURE' });
    // Future but NOT a market-local midnight (KL 01:00).
    await expect(
      service.createRuleVersion(actor, {
        ...base,
        effectiveFrom: '2030-06-14T17:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_ACTIVATION_NOT_FUTURE' });
  });

  it('rejects overlapping effective windows', async () => {
    const { service } = createService(
      [
        [{ id: adminUserId }],
        [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
        [{ effectiveFrom: futureMidnight }], // existing row at same instant
      ],
      [[{ id: randomUUID() }]],
    );
    await expect(
      service.createRuleVersion(actor, {
        name: 'New Rule',
        effectiveFrom: futureMidnight.toISOString(),
        rewardRate: '0.05',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId,
        reason: 'Test reason',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_EFFECTIVE_WINDOW_OVERLAP' });
  });

  it('replays the original result for the same key and payload', async () => {
    const ruleId = randomUUID();
    const storedResponse = {
      id: ruleId,
      name: 'New Rule',
      rewardRate: '0.05',
      effectiveFrom: '2030-06-14T16:00:00.000Z',
      effectiveFromLocal: '2030-06-15 00:00:00',
      timezone: 'Asia/Kuala_Lumpur',
      marketId,
      reason: 'Test reason',
      createdBy: adminUserId,
      createdAt: now.toISOString(),
    };
    const input = {
      name: 'New Rule',
      effectiveFrom: futureMidnight.toISOString(),
      rewardRate: '0.05',
      capType: 'NONE' as const,
      capValue: '0',
      minimumReward: '0',
      marketId,
      reason: 'Test reason',
      idempotencyKey: 'key-1',
    };
    // The mechanism row stores the canonical payload hash (sorted keys +
    // sha256); a replay with the identical payload matches it.
    const hash = await import('./admin-reward.service.js').then((m) =>
      m.canonicalPayloadHash({
        name: 'New Rule',
        description: null,
        effectiveFrom: futureMidnight.toISOString(),
        rewardRate: '0.05',
        capType: 'NONE',
        capValue: '0',
        minimumReward: '0',
        marketId,
        reason: 'Test reason',
      }),
    );
    const existingRow = {
      id: randomUUID(),
      scope: 'reward.rule.owner.create',
      key: 'key-1',
      requestHash: hash,
      response: storedResponse,
      statusCode: 201,
    };
    const replayService = createService(
      [
        [{ id: adminUserId }],
        [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
        [existingRow],
      ],
      [[]],
    );
    const result = await replayService.service.createRuleVersion(actor, input);
    expect(result.id).toBe(ruleId);
    expect(replayService.database.runTransaction).toHaveBeenCalled();
  });

  it('rejects the same key with a different payload', async () => {
    const { service } = createService(
      [
        [{ id: adminUserId }],
        [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
        [
          {
            id: randomUUID(),
            scope: 'reward.rule.owner.create',
            key: 'key-1',
            requestHash: 'a'.repeat(64), // different hash
            response: { id: randomUUID() },
            statusCode: 201,
          },
        ],
      ],
      [[]],
    );
    await expect(
      service.createRuleVersion(actor, {
        name: 'New Rule',
        effectiveFrom: futureMidnight.toISOString(),
        rewardRate: '0.05',
        capType: 'NONE' as const,
        capValue: '0',
        minimumReward: '0',
        marketId,
        reason: 'Test reason',
        idempotencyKey: 'key-1',
      }),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_IDEMPOTENCY_CONFLICT' });
  });

  it('returns version history for a rule', async () => {
    const ruleId = randomUUID();
    const { service } = createService([
      [
        {
          id: ruleId,
          name: 'Rule A',
          marketId,
        },
      ],
      [
        {
          id: ruleId,
          name: 'Rule A',
          rewardRate: '0.05',
          effectiveFrom: now,
          effectiveTo: null,
          marketId,
          archivedAt: null,
          createdAt: now,
        },
      ],
    ]);
    const result = await service.getRuleVersionHistory(actor, ruleId);
    expect(result.versions).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('throws when rule version is not found', async () => {
    const { service } = createService([[]]);
    await expect(
      service.getRuleVersion(actor, randomUUID()),
    ).rejects.toMatchObject({ code: 'ADMIN_REWARD_RULE_VERSION_NOT_FOUND' });
  });

  // ─── Audit Trail Presence ──────────────────────────────────────────

  it('writes the owner audit atomically inside the create transaction', async () => {
    const auditSpyTx = vi.spyOn(
      AuditService.prototype,
      'appendWithinTransaction',
    );
    const ruleId = randomUUID();
    const { service } = createService(
      [
        [{ id: adminUserId }],
        [{ id: marketId, timezone: 'Asia/Kuala_Lumpur' }],
        [],
      ],
      [
        [{ id: randomUUID() }],
        [versionRow({ id: ruleId, name: 'Audit Test Rule' })],
        [],
        [],
        [],
      ],
    );

    await service.createRuleVersion(actor, {
      name: 'Audit Test Rule',
      effectiveFrom: futureMidnight.toISOString(),
      rewardRate: '0.01',
      capType: 'NONE',
      capValue: '0',
      minimumReward: '0',
      marketId,
      reason: 'Audit reason',
      idempotencyKey: 'audit-key',
    });

    expect(auditSpyTx).toHaveBeenCalledWith(
      expect.anything(), // the transaction handle
      expect.objectContaining({
        action: 'reward.rule_version.create',
        actor: { type: 'ADMIN_USER', id: adminUserId },
        marketId,
        reason: 'Audit reason',
        result: 'SUCCESS',
      }),
    );
    auditSpyTx.mockRestore();
  });
});
