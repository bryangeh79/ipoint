import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../database/database.service.js';
import type { AuditService } from '../platform-access/audit.service.js';
import { MemberQrService } from './member-qr.service.js';
import { MemberQrError } from './member-qr.types.js';
import { verifyMemberQrToken } from './member-qr.crypto.js';

const SIGNING_SECRET = 'unit-test-signing-secret-at-least-32-characters';

const ACCOUNT_ID = randomUUID();
const MEMBER_ID = randomUUID();

interface QrRowFixture {
  id: string;
  publicQrId: string;
  status: 'ACTIVE' | 'ROTATED' | 'REVOKED';
  issuedAt: Date;
  expiresAt: Date | null;
}

function qrRow(overrides: Partial<QrRowFixture> = {}): QrRowFixture {
  const now = new Date();
  return {
    id: randomUUID(),
    publicQrId: `qrv1_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    status: 'ACTIVE',
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
    ...overrides,
  };
}

function toRow(
  row: QrRowFixture,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: row.id,
    memberId: MEMBER_ID,
    publicQrId: row.publicQrId,
    status: row.status,
    rotatedFromId: null,
    rotatedToId: null,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.status === 'REVOKED' ? new Date() : null,
    reason: row.status === 'REVOKED' ? 'MEMBER_INITIATED' : null,
    ...extra,
  };
}

const memberRow = { id: MEMBER_ID, status: 'ACTIVE' };

interface FakeDrizzle {
  /** Terminal results consumed in call order by awaited chain calls. */
  queue: unknown[];
  /** execute() results in call order (set_config, then lock). */
  executeQueue: unknown[];
  execute: ReturnType<typeof vi.fn>;
  db: DatabaseService;
  audit: AuditService;
  transaction: ReturnType<typeof vi.fn>;
  appendWithinTransaction: ReturnType<typeof vi.fn>;
  recordPrivilegedAction: ReturnType<typeof vi.fn>;
}

function createFake(): FakeDrizzle {
  const fake = {} as FakeDrizzle;
  fake.queue = [];
  fake.executeQueue = [];
  fake.execute = vi.fn(async () => {
    const value = fake.executeQueue.shift();
    return value ?? { rows: [] };
  });
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const get = (
      _target: Record<string, unknown>,
      prop: string | symbol,
    ): unknown => {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => {
          const value = fake.queue.shift();
          if (value === undefined) {
            throw new Error('FakeDrizzle: no scripted terminal result left.');
          }
          resolve(value);
        };
      }
      if (prop === 'execute') return fake.execute;
      if (prop === 'transaction') return fake.transaction;
      return () => proxy;
    };
    const proxy = new Proxy(chain, { get });
    return proxy;
  };
  const dbChain = makeChain();
  fake.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => {
    const tx = makeChain();
    return cb(tx);
  });
  fake.appendWithinTransaction = vi.fn().mockResolvedValue(undefined);
  fake.recordPrivilegedAction = vi.fn().mockResolvedValue(undefined);
  fake.audit = {
    appendWithinTransaction: fake.appendWithinTransaction,
    recordPrivilegedAction: fake.recordPrivilegedAction,
  } as unknown as AuditService;
  fake.db = { db: dbChain, pool: {} } as unknown as DatabaseService;
  return fake;
}

function makeService(fake: FakeDrizzle): MemberQrService {
  return new MemberQrService(fake.db, fake.audit);
}

function requestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const metadata = { requestId: 'req-1', ipAddress: '127.0.0.1' };

describe('P8-L06 MemberQrService', () => {
  beforeAll(() => {
    process.env['MEMBER_QR_SIGNING_SECRET'] = SIGNING_SECRET;
    process.env['MEMBER_QR_TTL_SECONDS'] = '300';
  });

  afterAll(() => {
    delete process.env['MEMBER_QR_SIGNING_SECRET'];
    delete process.env['MEMBER_QR_TTL_SECONDS'];
  });

  describe('GET', () => {
    it('returns MEMBER_NOT_FOUND when the account has no member row', async () => {
      const fake = createFake();
      fake.queue.push([]); // resolveMember
      const svc = makeService(fake);
      await expect(svc.getQr(ACCOUNT_ID, metadata)).rejects.toMatchObject({
        code: 'MEMBER_NOT_FOUND',
      });
    });

    it('returns MEMBER_CLOSED for a closed member', async () => {
      const fake = createFake();
      fake.queue.push([{ id: MEMBER_ID, status: 'CLOSED' }]);
      const svc = makeService(fake);
      await expect(svc.getQr(ACCOUNT_ID, metadata)).rejects.toMatchObject({
        code: 'MEMBER_CLOSED',
      });
    });

    it('returns a null QR state when the member has no QR row yet', async () => {
      const fake = createFake();
      fake.queue.push([memberRow]); // resolveMember
      fake.queue.push([]); // latestQrRow -> none
      const svc = makeService(fake);
      const result = await svc.getQr(ACCOUNT_ID, metadata);
      expect(result).toEqual({ qr: null });
      expect(fake.recordPrivilegedAction).toHaveBeenCalledTimes(1);
    });

    it('returns the active QR state with a verifiable signed token', async () => {
      const fake = createFake();
      const row = qrRow();
      fake.queue.push([memberRow]);
      fake.queue.push([toRow(row)]);
      const svc = makeService(fake);
      const result = await svc.getQr(ACCOUNT_ID, metadata);
      expect(result.qr).not.toBeNull();
      expect(result.qr?.public_qr_id).toBe(row.publicQrId);
      expect(result.qr?.status).toBe('ACTIVE');
      const verified = verifyMemberQrToken(
        result.qr!.display_token,
        SIGNING_SECRET,
      );
      expect(verified?.public_qr_id).toBe(row.publicQrId);
      // Audit payload must never carry the display token or any hash.
      const auditAfter = fake.recordPrivilegedAction.mock.calls[0]?.[0]
        ?.after as Record<string, unknown> | undefined;
      expect(auditAfter).not.toHaveProperty('display_token');
      expect(auditAfter).not.toHaveProperty('token_hash');
    });

    it('returns QR_REVOKED when the latest identity is revoked', async () => {
      const fake = createFake();
      const row = qrRow({ status: 'REVOKED' });
      fake.queue.push([memberRow]);
      fake.queue.push([toRow(row)]);
      const svc = makeService(fake);
      await expect(svc.getQr(ACCOUNT_ID, metadata)).rejects.toMatchObject({
        code: 'QR_REVOKED',
      });
    });
  });

  describe('POST (rotate / issue)', () => {
    it('requires an idempotency key', async () => {
      const fake = createFake();
      fake.queue.push([memberRow]);
      const svc = makeService(fake);
      await expect(
        svc.rotateQr(ACCOUNT_ID, undefined, metadata),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('issues the first QR identity when no row exists', async () => {
      const fake = createFake();
      const created = qrRow();
      fake.queue.push([memberRow]); // resolveMember
      fake.queue.push([]); // idempotency lookup -> none
      fake.queue.push([]); // idempotency insert values (await, unused)
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.executeQueue.push({ rows: [{ id: MEMBER_ID }] }); // lockMemberRow
      fake.queue.push([]); // latestQrRow -> none
      fake.queue.push([toRow(created)]); // insert returning
      fake.queue.push([]); // idempotency update set/where (await, unused)
      const svc = makeService(fake);
      const result = await svc.rotateQr(ACCOUNT_ID, 'key-issue', metadata);
      expect(result.qr?.public_qr_id).toBe(created.publicQrId);
      expect(fake.appendWithinTransaction).toHaveBeenCalledTimes(1);
      const auditInput = fake.appendWithinTransaction.mock.calls[0]?.[1] as
        | { action?: string }
        | undefined;
      expect(auditInput?.action).toBe('member.qr.issued');
    });

    it('rotates when an ACTIVE row exists (chain + new ACTIVE)', async () => {
      const fake = createFake();
      const oldRow = qrRow({ publicQrId: 'qrv1_old' });
      const created = qrRow({ publicQrId: 'qrv1_new' });
      fake.queue.push([memberRow]);
      fake.queue.push([]); // idempotency lookup
      fake.queue.push([]); // idempotency insert values
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.executeQueue.push({ rows: [{ id: MEMBER_ID }] }); // lock
      fake.queue.push([toRow(oldRow)]); // latestQrRow
      fake.queue.push([{ id: oldRow.id }]); // supersede update returning
      fake.queue.push([toRow(created, { rotatedFromId: oldRow.id })]); // insert returning
      fake.queue.push([]); // chain-link update (await, unused)
      fake.queue.push([]); // idempotency update set/where
      const svc = makeService(fake);
      const result = await svc.rotateQr(ACCOUNT_ID, 'key-rotate', metadata);
      expect(result.qr?.public_qr_id).toBe('qrv1_new');
      const auditInput = fake.appendWithinTransaction.mock.calls[0]?.[1] as
        | { action?: string }
        | undefined;
      expect(auditInput?.action).toBe('member.qr.rotated');
    });

    it('replays the stored response for the same idempotency key', async () => {
      const fake = createFake();
      const stored = { qr: { public_qr_id: 'qrv1_replay', status: 'ACTIVE' } };
      fake.queue.push([memberRow]);
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.queue.push([
        {
          id: randomUUID(),
          scope: `member-qr:rotate:${MEMBER_ID}`,
          key: 'key-replay',
          requestHash: requestHash({ rotate: true }),
          response: stored,
          statusCode: 200,
        },
      ]); // idempotency lookup -> hit
      const svc = makeService(fake);
      const result = await svc.rotateQr(ACCOUNT_ID, 'key-replay', metadata);
      expect(result).toEqual(stored);
      // Handler must not run: no lock execute, no insert, no audit.
      expect(fake.execute).toHaveBeenCalledTimes(1); // set_config only
      expect(fake.appendWithinTransaction).not.toHaveBeenCalled();
    });

    it('returns QR_REVOKED when the latest identity is revoked', async () => {
      const fake = createFake();
      const revoked = qrRow({ status: 'REVOKED', publicQrId: 'qrv1_revoked' });
      fake.queue.push([memberRow]);
      fake.queue.push([]); // idempotency lookup
      fake.queue.push([]); // idempotency insert values
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.executeQueue.push({ rows: [{ id: MEMBER_ID }] }); // lock
      fake.queue.push([toRow(revoked)]); // latestQrRow
      const svc = makeService(fake);
      await expect(
        svc.rotateQr(ACCOUNT_ID, 'key-revoked', metadata),
      ).rejects.toMatchObject({ code: 'QR_REVOKED' });
    });
  });

  describe('DELETE (revoke)', () => {
    it('requires an idempotency key', async () => {
      const fake = createFake();
      fake.queue.push([memberRow]);
      const svc = makeService(fake);
      await expect(
        svc.revokeQr(ACCOUNT_ID, {}, undefined, metadata),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('returns QR_NOT_FOUND when no QR row exists', async () => {
      const fake = createFake();
      fake.queue.push([memberRow]);
      fake.queue.push([]); // idempotency lookup
      fake.queue.push([]); // idempotency insert values
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.executeQueue.push({ rows: [{ id: MEMBER_ID }] }); // lock
      fake.queue.push([]); // latestQrRow -> none
      const svc = makeService(fake);
      await expect(
        svc.revokeQr(ACCOUNT_ID, {}, 'key-none', metadata),
      ).rejects.toMatchObject({ code: 'QR_NOT_FOUND' });
    });

    it('returns QR_REVOKED when already revoked', async () => {
      const fake = createFake();
      const revoked = qrRow({ status: 'REVOKED' });
      fake.queue.push([memberRow]);
      fake.queue.push([]);
      fake.queue.push([]);
      fake.executeQueue.push({ rows: [] });
      fake.executeQueue.push({ rows: [{ id: MEMBER_ID }] });
      fake.queue.push([toRow(revoked)]); // latestQrRow
      const svc = makeService(fake);
      await expect(
        svc.revokeQr(ACCOUNT_ID, {}, 'key-revoked', metadata),
      ).rejects.toMatchObject({ code: 'QR_REVOKED' });
    });

    it('revokes an ACTIVE identity and audits it', async () => {
      const fake = createFake();
      const active = qrRow();
      fake.queue.push([memberRow]);
      fake.queue.push([]); // idempotency lookup
      fake.queue.push([]); // idempotency insert values
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.executeQueue.push({ rows: [{ id: MEMBER_ID }] }); // lock
      fake.queue.push([toRow(active)]); // latestQrRow
      fake.queue.push([toRow(active, { status: 'REVOKED' })]); // revoke update returning
      fake.queue.push([]); // idempotency update set/where
      const svc = makeService(fake);
      await expect(
        svc.revokeQr(
          ACCOUNT_ID,
          { reason: 'Member request' },
          'key-revoke',
          metadata,
        ),
      ).resolves.toBeUndefined();
      const auditInput = fake.appendWithinTransaction.mock.calls[0]?.[1] as
        | { action?: string; reason?: string }
        | undefined;
      expect(auditInput?.action).toBe('member.qr.revoked');
      expect(auditInput?.reason).toBe('Member request');
    });

    it('replays 204 without touching state (same key)', async () => {
      const fake = createFake();
      fake.queue.push([memberRow]);
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.queue.push([
        {
          id: randomUUID(),
          scope: `member-qr:revoke:${MEMBER_ID}`,
          key: 'key-replay',
          requestHash: requestHash({ reason: null }),
          response: { revoked: true },
          statusCode: 204,
        },
      ]); // idempotency lookup -> hit
      const svc = makeService(fake);
      await expect(
        svc.revokeQr(ACCOUNT_ID, {}, 'key-replay', metadata),
      ).resolves.toBeUndefined();
      expect(fake.execute).toHaveBeenCalledTimes(1); // set_config only
      expect(fake.appendWithinTransaction).not.toHaveBeenCalled();
    });
  });

  describe('idempotency conflict', () => {
    it('returns IDEMPOTENCY_CONFLICT when the same key is reused with a different payload', async () => {
      const fake = createFake();
      fake.queue.push([memberRow]);
      fake.executeQueue.push({ rows: [] }); // set_config
      fake.queue.push([
        {
          id: randomUUID(),
          scope: `member-qr:revoke:${MEMBER_ID}`,
          key: 'key-conflict',
          requestHash: 'c'.repeat(64),
          response: { revoked: true },
          statusCode: 204,
        },
      ]); // idempotency lookup -> request hash mismatch
      const svc = makeService(fake);
      await expect(
        svc.revokeQr(
          ACCOUNT_ID,
          { reason: 'Other reason' },
          'key-conflict',
          metadata,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    });
  });

  describe('error class', () => {
    it('carries the contract error code', () => {
      const error = new MemberQrError(
        'QR_REVOKED',
        'The member QR identity is revoked.',
      );
      expect(error.code).toBe('QR_REVOKED');
      expect(error.message).toBe('The member QR identity is revoked.');
    });
  });
});
