import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import { auditListQuerySchema } from './admin-audit-ops.dto.js';
import { AdminAuditOpsService } from './admin-audit-ops.service.js';
import { maskAuditValue } from './admin-audit-ops.types.js';

const MARKET_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = { adminUserId: '22222222-2222-4222-8222-222222222222' };

const MARKET_ROW = { id: MARKET_ID, code: 'MA' };

function dbMock(
  overrides: {
    marketRow?: unknown;
    rows?: unknown[];
    fail?: boolean;
  } = {},
): DatabaseService {
  const rows = overrides.rows ?? [];
  return {
    pool: {
      query: async (sqlText: string, params: unknown[]) => {
        if (/FROM markets/u.test(sqlText)) {
          return {
            rows:
              overrides.marketRow === false
                ? []
                : ([overrides.marketRow ?? MARKET_ROW] as unknown[]),
          };
        }
        if (overrides.fail) throw new Error('connection refused');
        if (/SELECT count/u.test(sqlText))
          return { rows: [{ total: rows.length }] };
        return { rows };
      },
    },
  } as unknown as DatabaseService;
}

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    occurred_at: new Date('2026-08-07T12:00:00.000Z'),
    actor_type: 'ADMIN_USER',
    actor_id: ACTOR.adminUserId,
    market_id: MARKET_ID,
    action: 'REDEMPTION_REFUND_APPROVE',
    entity_type: 'redemption_order',
    entity_id: '33333333-3333-4333-8333-333333333333',
    before: { status: 'PENDING_CHECKER' },
    after: {
      status: 'APPROVED',
      id_number: '800101-14-5678',
      access_token:
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      note: 'approved by checker',
    },
    reason: 'documented reason',
    result: 'SUCCESS',
    request_id: 'req-123',
    ip_address: '203.0.113.9',
    ...overrides,
  };
}

describe('maskAuditValue (P7-S9 sensitive masking)', () => {
  it('redacts sensitive keys (password/token/secret/cookie/credential/hash/otp)', () => {
    const masked = maskAuditValue({
      access_token: 'abc',
      password: 'x',
      client_secret: 'y',
      cookie: 'z',
      otp_code: '123456',
    }) as Record<string, unknown>;
    expect(masked['access_token']).toBe('[REDACTED]');
    expect(masked['password']).toBe('[REDACTED]');
    expect(masked['client_secret']).toBe('[REDACTED]');
    expect(masked['cookie']).toBe('[REDACTED]');
    expect(masked['otp_code']).toBe('[REDACTED]');
  });

  it('masks identity-document keys (nric/passport/id_number/ic_number/ssn)', () => {
    const masked = maskAuditValue({
      nric: '800101-14-5678',
      passport_number: 'A12345678',
      id_number: 'x',
      ic_number: 'y',
      ssn: '123-45-6789',
    }) as Record<string, unknown>;
    expect(masked['nric']).toBe('[MASKED]');
    expect(masked['passport_number']).toBe('[MASKED]');
    expect(masked['id_number']).toBe('[MASKED]');
    expect(masked['ic_number']).toBe('[MASKED]');
    expect(masked['ssn']).toBe('[MASKED]');
  });

  it('masks JWT-like string values anywhere in the tree', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const masked = maskAuditValue({ payload: jwt, list: [jwt] });
    expect(masked).toEqual({
      payload: '[MASKED]',
      list: ['[MASKED]'],
    });
  });

  it('recurses through nested objects and arrays', () => {
    const masked = maskAuditValue({
      profile: {
        documents: [{ nric: '800101-14-5678' }],
      },
    }) as { profile: { documents: Array<{ nric: string }> } };
    expect(masked.profile.documents[0]?.nric).toBe('[MASKED]');
  });

  it('never masks plain identifiers, amounts or reasons', () => {
    const masked = maskAuditValue({
      amount: '120.50',
      order_reference: 'RP-2026-000123',
      status: 'APPROVED',
      member_id: '33333333-3333-4333-8333-333333333333',
      note: 'approved by checker',
    });
    expect(masked).toEqual({
      amount: '120.50',
      order_reference: 'RP-2026-000123',
      status: 'APPROVED',
      member_id: '33333333-3333-4333-8333-333333333333',
      note: 'approved by checker',
    });
  });
});

describe('AdminAuditOpsService (P7-S9)', () => {
  it('lists entries for the selected market with masked evidence and no raw IP', async () => {
    const service = new AdminAuditOpsService(dbMock({ rows: [auditRow()] }));
    const response = await service.listEntries(ACTOR, MARKET_ID, {
      limit: 50,
      offset: 0,
    });
    expect(response.marketId).toBe(MARKET_ID);
    expect(response.total).toBe(1);
    const item = response.items[0];
    expect(item?.masked).toBe(true);
    expect(
      (item as unknown as Record<string, unknown>)['ipAddress'],
    ).toBeUndefined();
    expect(item?.beforeMasked).toEqual({ status: 'PENDING_CHECKER' });
    const after = item?.afterMasked as Record<string, unknown>;
    expect(after['id_number']).toBe('[MASKED]');
    expect(after['access_token']).toBe('[REDACTED]');
    expect(after['note']).toBe('approved by checker');
  });

  it('returns a single masked entry for the market', async () => {
    const service = new AdminAuditOpsService(dbMock({ rows: [auditRow()] }));
    const entry = await service.getEntry(ACTOR, MARKET_ID, ENTRY_ID);
    expect(entry.id).toBe(ENTRY_ID);
    expect(entry.masked).toBe(true);
    expect(
      (entry as unknown as Record<string, unknown>)['ipAddress'],
    ).toBeUndefined();
  });

  it('returns the raw evidence view with stored values (raw view)', async () => {
    const service = new AdminAuditOpsService(dbMock({ rows: [auditRow()] }));
    const raw = await service.getRawEntry(ACTOR, MARKET_ID, ENTRY_ID);
    expect(raw.raw).toBe(true);
    expect(raw.ipAddress).toBe('203.0.113.9');
    expect(raw.after).toEqual(auditRow().after);
  });

  it('throws AUDIT_ENTRY_NOT_FOUND for a missing market', async () => {
    const service = new AdminAuditOpsService(dbMock({ marketRow: false }));
    await expect(
      service.listEntries(ACTOR, MARKET_ID, { limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ code: 'AUDIT_ENTRY_NOT_FOUND' });
    await expect(
      service.getEntry(ACTOR, MARKET_ID, ENTRY_ID),
    ).rejects.toMatchObject({ code: 'AUDIT_ENTRY_NOT_FOUND' });
  });

  it('scopes the SQL to the selected market (no cross-market leakage)', async () => {
    const queries: string[] = [];
    const service = new AdminAuditOpsService({
      pool: {
        query: async (sqlText: string) => {
          queries.push(sqlText);
          if (/FROM markets/u.test(sqlText)) return { rows: [MARKET_ROW] };
          if (/SELECT count/u.test(sqlText)) return { rows: [{ total: 0 }] };
          return { rows: [] };
        },
      },
    } as unknown as DatabaseService);
    await service.listEntries(ACTOR, MARKET_ID, {
      actorType: 'ADMIN_USER',
      result: 'SUCCESS',
      q: 'redemption',
      limit: 25,
      offset: 10,
    });
    const listQuery = queries.find((q) => /FROM audit_logs/u.test(q));
    expect(listQuery).toContain('market_id = $1');
    expect(listQuery).toContain('actor_type = $2');
    expect(listQuery).toContain('result = $3');
    expect(listQuery).toContain('ILIKE');
    expect(listQuery).toContain('ORDER BY occurred_at DESC');
    expect(listQuery).toMatch(/LIMIT \$\d+ OFFSET \$\d+/u);
  });
});

describe('audit list query schema (P7-S9)', () => {
  it('accepts bounded filters and defaults', () => {
    const parsed = auditListQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
    const full = auditListQuerySchema.parse({
      actorType: 'ADMIN_USER',
      result: 'SUCCESS',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-07T00:00:00.000Z',
      q: 'order',
      limit: 100,
      offset: 5,
    });
    expect(full.actorType).toBe('ADMIN_USER');
  });

  it('rejects an inverted time range', () => {
    expect(() =>
      auditListQuerySchema.parse({
        from: '2026-08-07T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects unknown keys, oversized pagination and invalid actor types', () => {
    expect(() => auditListQuerySchema.parse({ bogus: 1 })).toThrow();
    expect(() => auditListQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => auditListQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => auditListQuerySchema.parse({ actorType: 'ROBOT' })).toThrow();
  });
});
