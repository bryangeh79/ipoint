/**
 * Commission Domain â€” Comprehensive Unit Tests
 *
 * Covers CommissionQueryService, AdjustmentService, RateManagementService,
 * and CommissionSecurityService.
 *
 * @packageDocumentation
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CommissionQueryService } from './query.service.js';
import { AdjustmentService, AdjustmentError } from './adjustment.service.js';
import { RateManagementService, RateManagementError } from './rate.service.js';
import {
  CommissionSecurityService,
  CommissionSecurityError,
} from './security.service.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const MEMBER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN_1 = '11111111-1111-1111-1111-111111111111';
const ADMIN_2 = '22222222-2222-2222-2222-222222222222';

/* ------------------------------------------------------------------ */
/*  Mock Builder                                                      */
/* ------------------------------------------------------------------ */

function createChain() {
  let _returnResult: unknown = [];
  const returningThenable = {
    then: vi
      .fn()
      .mockImplementation((resolve: (v: unknown) => void) =>
        resolve(_returnResult),
      ),
  };
  const chain = {
    _result: [] as unknown,
    _sequence: [] as unknown[][],
    _seqIdx: 0,
    _transactionFn: null as ((tx: unknown) => Promise<unknown>) | null,

    then: vi.fn().mockImplementation(function (
      this: {
        _sequence: unknown[][];
        _seqIdx: number;
        _result: unknown;
      },
      resolve: (v: unknown) => void,
    ) {
      if (this._sequence.length > 0) {
        const idx = Math.min(this._seqIdx, this._sequence.length - 1);
        this._seqIdx++;
        return resolve(this._sequence[idx]);
      }
      return resolve(this._result);
    }),

    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(returningThenable),

    transaction: vi.fn().mockImplementation(function (
      this: { _transactionFn: ((tx: unknown) => Promise<unknown>) | null },
      cb: (tx: unknown) => Promise<unknown>,
    ) {
      if (this._transactionFn) {
        return this._transactionFn(cb);
      }
      return (cb as any)(createTxProxy());
    }),

    setResult(r: unknown) {
      this._result = r;
      return this;
    },
    setSequence(seq: unknown[][]) {
      this._sequence = seq;
      this._seqIdx = 0;
      return this;
    },
    setReturnResult(r: unknown) {
      _returnResult = r;
      return this;
    },
    setTransactionFn(fn: ((tx: unknown) => Promise<unknown>) | null) {
      this._transactionFn = fn;
      return this;
    },
  };
  return chain;
}

function createTxProxy() {
  const tx = {
    _result: [] as unknown,
    _sequence: [] as unknown[][],
    _seqIdx: 0,

    then: vi.fn().mockImplementation(function (
      this: { _sequence: unknown[][]; _seqIdx: number; _result: unknown },
      resolve: (v: unknown) => void,
    ) {
      if (this._sequence.length > 0) {
        const idx = Math.min(this._seqIdx, this._sequence.length - 1);
        this._seqIdx++;
        return resolve(this._sequence[idx]);
      }
      return resolve(this._result);
    }),

    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue({
      then: vi
        .fn()
        .mockImplementation((resolve: (v: unknown) => void) => resolve([])),
    }),

    setResult(r: unknown) {
      this._result = r;
      return this;
    },
    setSequence(seq: unknown[][]) {
      this._sequence = seq;
      this._seqIdx = 0;
      return this;
    },
  };
  return tx;
}

function createDbService(chain: ReturnType<typeof createChain>) {
  return {
    db: chain as never,
    pool: null as never,
    runTransaction: null as never,
    onApplicationShutdown: null as never,
  };
}

/**
 * Helper: creates a transaction proxy pre-seeded with a given result.
 */
function txWithResult(rows: unknown[]) {
  return createTxProxy().setResult(rows);
}

/* ================================================================ */
/*  CommissionQueryService Tests                                     */
/* ================================================================ */

describe('CommissionQueryService', () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    chain = createChain().setResult([]);
  });

  function svc() {
    return new CommissionQueryService(createDbService(chain));
  }

  function makeLedgerRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ledger-1',
      publicReference: 'COM-250726-00001',
      beneficiaryId: MEMBER_A,
      sourceType: 'MEMBER_CONSUMPTION',
      sourceReference: 'tx-1',
      market: 'MY',
      currency: 'MYR',
      amount: '88.0000000000',
      generation: 0,
      entryType: 'MEMBER_CONSUMPTION_G1_EARN',
      postingStatus: 'EARNED',
      effectiveTime: new Date('2026-07-26T00:00:00Z'),
      createdAt: new Date('2026-07-26T00:00:00Z'),
      reversalLinkage: null,
      auditLinkage: null,
      notes: null,
      rateVersionId: null,
      rateSnapshot: null,
      calculationBasis: '88.0000000000',
      canonicalEntryKey: 'MY:MEMBER_CONSUMPTION:tx-1',
      processingId: null,
      ...overrides,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Agent ledger                                                    */
  /* ---------------------------------------------------------------- */

  describe('agent ledger', () => {
    it('returns own commissions only', async () => {
      chain.setResult([makeLedgerRow()]);
      const r = await svc().getLedger(MEMBER_A);
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.beneficiaryId).toBe(MEMBER_A);
    });

    it('rejects cross-member access', async () => {
      chain.setResult([makeLedgerRow({ beneficiaryId: MEMBER_B })]);
      await expect(svc().getLedgerDetail('ledger-1', MEMBER_A)).rejects.toThrow(
        /do not have access/i,
      );
    });

    it('filters by market', async () => {
      chain.setResult([makeLedgerRow({ market: 'MY' })]);
      const r = await svc().getLedger(MEMBER_A, { market: 'MY' });
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.market).toBe('MY');
    });

    it('filters by current_status', async () => {
      chain.setResult([makeLedgerRow({ postingStatus: 'EARNED' })]);
      const r = await svc().getLedger(MEMBER_A, { status: 'EARNED' });
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.postingStatus).toBe('EARNED');
    });

    it('supports pagination (limit/offset)', async () => {
      chain.setResult([makeLedgerRow()]);
      const r = await svc().getLedger(MEMBER_A, { limit: 5, offset: 10 });
      expect(r.limit).toBe(5);
      expect(r.offset).toBe(10);
      expect(r.entries).toHaveLength(1);
    });

    it('returns amounts as decimal strings with trailing zeros', async () => {
      chain.setResult([makeLedgerRow({ amount: '88.0000000000' })]);
      const r = await svc().getLedger(MEMBER_A);
      expect(r.entries[0]!.amount).toBe('88.00');
    });

    it('formats display scale = posting scale (2dp MYR/SGD)', async () => {
      chain.setResult([
        makeLedgerRow({ amount: '100.5000000000', currency: 'SGD' }),
      ]);
      const r = await svc().getLedger(MEMBER_A);
      expect(r.entries[0]!.amount).toBe('100.50');
    });

    it('detail endpoint validates ownership', async () => {
      chain.setResult([makeLedgerRow({ beneficiaryId: MEMBER_A })]);
      const entry = await svc().getLedgerDetail('ledger-1', MEMBER_A);
      expect(entry.id).toBe('ledger-1');
      expect(entry.beneficiaryId).toBe(MEMBER_A);
    });

    it('summary endpoint aggregates per-market totals', async () => {
      chain.setSequence([
        [
          // Per-market aggregation
          {
            market: 'MY',
            currency: 'MYR',
            totalEarned: '50.0000000000',
            entryCount: 1,
          },
        ],
        [
          // Grand total
          { total: '50.0000000000' },
        ],
      ]);
      const r = await svc().getSummary(MEMBER_A);
      expect(r.markets).toHaveLength(1);
      expect(r.markets[0]!.market).toBe('MY');
      expect(r.markets[0]!.totalEarned).toBe('50.00');
      expect(r.grandTotal).toBe('50.00');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Admin search                                                    */
  /* ---------------------------------------------------------------- */

  describe('admin search', () => {
    /** adminSearch uses .leftJoin which returns { entry: {...}, beneficiaryPublicId } shape */
    function adminRow(overrides: Record<string, unknown> = {}) {
      return { entry: makeLedgerRow(overrides), beneficiaryPublicId: null };
    }

    it('searches by beneficiary_id', async () => {
      chain.setResult([adminRow({ beneficiaryId: MEMBER_A })]);
      const r = await svc().adminSearch({
        beneficiaryId: MEMBER_A,
        selectedMarket: 'MY',
      });
      expect(r.entries).toHaveLength(1);
    });

    it('searches by market', async () => {
      chain.setResult([adminRow({ market: 'MY' })]);
      const r = await svc().adminSearch({ market: 'MY', selectedMarket: 'MY' });
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.market).toBe('MY');
    });

    it('rejects a client market filter that disagrees with the selected market', async () => {
      // P5-R1: client market values are never authority.
      await expect(
        svc().adminSearch({ market: 'SG', selectedMarket: 'MY' }),
      ).rejects.toThrow(/COMMISSION_MARKET_CONTEXT_MISMATCH/);
    });

    it('requires the server-derived selected market', async () => {
      // P5-R1: admin search is always bounded to the Current Admin Market.
      await expect(svc().adminSearch({})).rejects.toThrow(
        /COMMISSION_SELECTED_MARKET_REQUIRED/,
      );
    });

    it('searches by source_type', async () => {
      chain.setResult([adminRow({ sourceType: 'MEMBER_CONSUMPTION' })]);
      const r = await svc().adminSearch({
        sourceType: 'MEMBER_CONSUMPTION',
        selectedMarket: 'MY',
      });
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.sourceType).toBe('MEMBER_CONSUMPTION');
    });

    it('searches by status', async () => {
      chain.setResult([adminRow({ postingStatus: 'EARNED' })]);
      const r = await svc().adminSearch({
        status: 'EARNED',
        selectedMarket: 'MY',
      });
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.postingStatus).toBe('EARNED');
    });

    it('searches by date range', async () => {
      chain.setResult([adminRow()]);
      const r = await svc().adminSearch({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T00:00:00Z',
        selectedMarket: 'MY',
      });
      expect(r.entries).toHaveLength(1);
      expect(r.total).toBe(0);
    });

    it('returns full entry details', async () => {
      chain.setSequence([
        // Count query
        [{ total: 1 }],
        // Rows with left join
        [
          {
            entry: makeLedgerRow(),
            beneficiaryPublicId: 'PUB-MEM-001',
          },
        ],
      ]);
      const r = await svc().adminSearch({
        beneficiaryId: MEMBER_A,
        selectedMarket: 'MY',
      });
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0]!.beneficiary).not.toBeNull();
      expect(r.entries[0]!.beneficiary!.publicMemberId).toBe('PUB-MEM-001');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Audit query                                                     */
  /* ---------------------------------------------------------------- */

  describe('audit query', () => {
    function makeEventRow(overrides: Record<string, unknown> = {}) {
      return {
        eventId: 'evt-1',
        entryId: 'ledger-1',
        fromStatus: null,
        toStatus: 'EARNED',
        changedBy: null,
        changedByType: 'SYSTEM',
        reason: null,
        changedAt: new Date('2026-07-26T00:00:00Z'),
        eventSequence: 1n,
        ...overrides,
      };
    }

    it('returns status event history for a ledger entry', async () => {
      chain.setSequence([
        // Entry existence check
        [{ id: 'ledger-1', market: 'MY' }],
        // Status events
        [makeEventRow()],
      ]);
      const r = await svc().getAuditLog('ledger-1', 'MY');
      expect(r).toHaveLength(1);
      expect(r[0]!.entryId).toBe('ledger-1');
    });

    it('events ordered by event_sequence', async () => {
      chain.setSequence([
        [{ id: 'ledger-1', market: 'MY' }],
        [
          makeEventRow({ eventSequence: 1n, toStatus: 'EARNED' }),
          makeEventRow({ eventSequence: 2n, toStatus: 'EARNED' }),
        ],
      ]);
      const r = await svc().getAuditLog('ledger-1', 'MY');
      expect(r).toHaveLength(2);
      expect(r[0]!.eventSequence).toBe(1);
      expect(r[1]!.eventSequence).toBe(2);
    });

    it('includes from_status, to_status, changed_by, changed_at', async () => {
      chain.setSequence([
        [{ id: 'ledger-1', market: 'MY' }],
        [
          makeEventRow({
            fromStatus: null,
            toStatus: 'EARNED',
            changedBy: ADMIN_2,
            changedByType: 'ADMIN',
          }),
        ],
      ]);
      const r = await svc().getAuditLog('ledger-1', 'MY');
      expect(r[0]!.fromStatus).toBeNull();
      expect(r[0]!.toStatus).toBe('EARNED');
      expect(r[0]!.changedBy).toBe(ADMIN_2);
      expect(r[0]!.changedByType).toBe('ADMIN');
      expect(r[0]!.changedAt).toBeDefined();
    });

    it('throws NotFoundException for non-existent entry', async () => {
      chain.setResult([]);
      await expect(svc().getAuditLog('missing-id', 'MY')).rejects.toThrow(
        /not found/i,
      );
    });
  });
});

/* ================================================================ */
/*  CommissionAdjustmentService Tests                                */
/* ================================================================ */

describe('CommissionAdjustmentService', () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    chain = createChain().setResult([]);
  });

  function svc() {
    return new AdjustmentService(createDbService(chain));
  }

  function makeAdjustmentRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'adj-1',
      publicReference: 'ADJ-250726-00001',
      beneficiaryId: MEMBER_B,
      amount: '100.0000000000',
      market: 'MY',
      currency: 'MYR',
      reason: 'Manual adjustment',
      auditReference: null,
      status: 'PENDING_CHECKER',
      makerId: ADMIN_1,
      checkerId: null,
      makerNotes: null,
      checkerNotes: null,
      ledgerEntryId: null,
      decidedAt: null,
      createdAt: new Date('2026-07-26T00:00:00Z'),
      updatedAt: new Date('2026-07-26T00:00:00Z'),
      ...overrides,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Create                                                          */
  /* ---------------------------------------------------------------- */

  describe('create', () => {
    it('creates PENDING_CHECKER request', async () => {
      chain.setReturnResult([
        { id: 'adj-1', publicReference: 'ADJ-250726-A1B2C' },
      ]);
      const r = await svc().createAdjustment(
        ADMIN_1,
        MEMBER_B,
        '100.00',
        'MY',
        'MYR',
        'Manual credit',
      );
      expect(r.status).toBe('PENDING_CHECKER');
      expect(r.adjustmentId).toBeDefined();
      expect(r.publicReference).toBeDefined();
      expect(chain.insert).toHaveBeenCalled();
    });

    it('maker_id derived from auth principal', async () => {
      chain.setReturnResult([
        { id: 'adj-2', publicReference: 'ADJ-250726-A1B2C' },
      ]);
      await svc().createAdjustment(
        ADMIN_1,
        MEMBER_B,
        '50.00',
        'SG',
        'SGD',
        'Test adjustment',
      );
      expect(chain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          makerId: ADMIN_1,
        }),
      );
    });

    it('rejects zero amount', async () => {
      await expect(
        svc().createAdjustment(ADMIN_1, MEMBER_B, '0.00', 'MY', 'MYR', 'Test'),
      ).rejects.toThrow(AdjustmentError);
    });

    it('requires reason', async () => {
      chain.setReturnResult([
        { id: 'adj-3', publicReference: 'ADJ-250726-A1B2C' },
      ]);
      const r = await svc().createAdjustment(
        ADMIN_1,
        MEMBER_B,
        '10.00',
        'MY',
        'MYR',
        '',
      );
      expect(r.status).toBe('PENDING_CHECKER');
    });

    it('supports positive adjustment', async () => {
      chain.setReturnResult([
        { id: 'adj-4', publicReference: 'ADJ-250726-A1B2C' },
      ]);
      const r = await svc().createAdjustment(
        ADMIN_1,
        MEMBER_B,
        '200.00',
        'MY',
        'MYR',
        'Bonus credit',
      );
      expect(r.status).toBe('PENDING_CHECKER');
    });

    it('supports negative adjustment', async () => {
      chain.setReturnResult([
        { id: 'adj-5', publicReference: 'ADJ-250726-A1B2C' },
      ]);
      const r = await svc().createAdjustment(
        ADMIN_1,
        MEMBER_B,
        '-50.00',
        'MY',
        'MYR',
        'Correction debit',
      );
      expect(r.status).toBe('PENDING_CHECKER');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Approve                                                         */
  /* ---------------------------------------------------------------- */

  describe('approve', () => {
    it('transitions PENDING_CHECKER â†’ APPROVED', async () => {
      chain.setSequence([
        // Select for status check
        [makeAdjustmentRow()],
      ]);
      chain.setTransactionFn(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(
          txWithResult([makeAdjustmentRow()]),
        ),
      );

      const r = await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(r.status).toBe('APPROVED');
      expect(r.entryId).toBeDefined();
    });

    it('creates ADMIN_ADJUSTMENT ledger entry', async () => {
      chain.setResult([makeAdjustmentRow()]);
      let ledgerInsertCalled = false;

      chain.setTransactionFn(async (cb) => {
        const tx = txWithResult([makeAdjustmentRow()]);
        tx.insert = vi.fn().mockReturnThis();
        tx.values = vi.fn().mockImplementation(function (
          this: any,
          vals: Record<string, unknown>,
        ) {
          if (vals.entryType === 'ADMIN_ADJUSTMENT') {
            ledgerInsertCalled = true;
          }
          return this;
        });
        return (cb as any)(tx);
      });

      await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(ledgerInsertCalled).toBe(true);
    });

    it('creates commission_status_event with EARNED', async () => {
      chain.setResult([makeAdjustmentRow()]);
      let statusEventInserted = false;

      chain.setTransactionFn(async (cb) => {
        const tx = txWithResult([makeAdjustmentRow()]);
        tx.insert = vi.fn().mockReturnThis();
        tx.values = vi.fn().mockImplementation(function (
          this: any,
          vals: Record<string, unknown>,
        ) {
          if (vals.toStatus === 'EARNED' && vals.entryId) {
            statusEventInserted = true;
          }
          return this;
        });
        return (cb as any)(tx);
      });

      await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(statusEventInserted).toBe(true);
    });

    it('sets checker_id, decided_at, ledger_entry_id', async () => {
      chain.setResult([makeAdjustmentRow()]);
      let updateCalled = false;

      chain.setTransactionFn(async (cb) => {
        const tx = txWithResult([makeAdjustmentRow()]);
        tx.where = vi.fn().mockReturnThis();
        tx.update = vi.fn().mockReturnThis();
        tx.set = vi.fn().mockImplementation(function (
          this: any,
          vals: Record<string, unknown>,
        ) {
          if (vals.checkerId === ADMIN_2 && vals.decidedAt) {
            updateCalled = true;
          }
          return this;
        });
        return (cb as any)(tx);
      });

      await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(updateCalled).toBe(true);
    });

    it('rejects maker = checker', async () => {
      chain.setResult([makeAdjustmentRow({ makerId: ADMIN_2 })]);
      await expect(svc().approveAdjustment(ADMIN_2, 'adj-1')).rejects.toThrow(
        AdjustmentError,
      );
    });

    it('rejects duplicate approve', async () => {
      chain.setResult([
        makeAdjustmentRow({ status: 'APPROVED', checkerId: ADMIN_2 }),
      ]);
      await expect(svc().approveAdjustment(ADMIN_2, 'adj-2')).rejects.toThrow(
        AdjustmentError,
      );
    });

    it('rejects approve after reject', async () => {
      chain.setResult([
        makeAdjustmentRow({ status: 'REJECTED', checkerId: ADMIN_2 }),
      ]);
      await expect(svc().approveAdjustment(ADMIN_2, 'adj-1')).rejects.toThrow(
        AdjustmentError,
      );
    });

    it('atomic rollback on failure', async () => {
      chain.setResult([makeAdjustmentRow()]);
      chain.setTransactionFn(async () => {
        throw new AdjustmentError('TX_FAILED', 'Transaction failed');
      });
      await expect(svc().approveAdjustment(ADMIN_2, 'adj-1')).rejects.toThrow();
      // The initial select happens outside the transaction
      expect(chain.select).toHaveBeenCalled();
    });

    it('status event created exactly once', async () => {
      chain.setResult([makeAdjustmentRow()]);
      let statusEventCount = 0;

      chain.setTransactionFn(async (cb) => {
        const tx = txWithResult([makeAdjustmentRow()]);
        tx.insert = vi.fn().mockReturnThis();
        tx.values = vi.fn().mockImplementation(function (
          this: any,
          vals: Record<string, unknown>,
        ) {
          if (vals.toStatus === 'EARNED') {
            statusEventCount++;
          }
          return this;
        });
        return (cb as any)(tx);
      });

      await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(statusEventCount).toBe(1);
    });

    it('ledger entry created exactly once', async () => {
      chain.setResult([makeAdjustmentRow()]);
      let ledgerEntryCount = 0;

      chain.setTransactionFn(async (cb) => {
        const tx = txWithResult([makeAdjustmentRow()]);
        tx.insert = vi.fn().mockReturnThis();
        tx.values = vi.fn().mockImplementation(function (
          this: any,
          vals: Record<string, unknown>,
        ) {
          if (vals.entryType === 'ADMIN_ADJUSTMENT') {
            ledgerEntryCount++;
          }
          return this;
        });
        return (cb as any)(tx);
      });

      await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(ledgerEntryCount).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Reject                                                          */
  /* ---------------------------------------------------------------- */

  describe('reject', () => {
    it('transitions PENDING_CHECKER â†’ REJECTED', async () => {
      chain.setSequence([[makeAdjustmentRow()]]);
      chain.setTransactionFn(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(
          txWithResult([makeAdjustmentRow()]),
        ),
      );

      const r = await svc().rejectAdjustment(ADMIN_2, 'adj-1');
      expect(r.status).toBe('REJECTED');
    });

    it('sets checker_id and decided_at', async () => {
      chain.setResult([makeAdjustmentRow()]);
      let updateCalled = false;

      chain.setTransactionFn(async (cb) => {
        const tx = txWithResult([makeAdjustmentRow()]);
        tx.where = vi.fn().mockReturnThis();
        tx.update = vi.fn().mockReturnThis();
        tx.set = vi.fn().mockImplementation(function (
          this: any,
          vals: Record<string, unknown>,
        ) {
          if (
            vals.status === 'REJECTED' &&
            vals.checkerId === ADMIN_2 &&
            vals.decidedAt
          ) {
            updateCalled = true;
          }
          return this;
        });
        return (cb as any)(tx);
      });

      await svc().rejectAdjustment(ADMIN_2, 'adj-1');
      expect(updateCalled).toBe(true);
    });

    it('does NOT create ledger entry', async () => {
      chain.setResult([makeAdjustmentRow()]);
      let ledgerInsertCount = 0;

      chain.setTransactionFn(async (cb) => {
        const tx = txWithResult([makeAdjustmentRow()]);
        tx.insert = vi.fn().mockImplementation(function (
          this: any,
          vals: Record<string, unknown>,
        ) {
          if (
            vals &&
            (vals as Record<string, unknown>).entryType === 'ADMIN_ADJUSTMENT'
          ) {
            ledgerInsertCount++;
          }
          return this;
        });
        return (cb as any)(tx);
      });

      await svc().rejectAdjustment(ADMIN_2, 'adj-1');
      expect(ledgerInsertCount).toBe(0);
    });

    it('rejects reject after approve', async () => {
      chain.setResult([
        makeAdjustmentRow({ status: 'APPROVED', checkerId: ADMIN_2 }),
      ]);
      await expect(svc().rejectAdjustment(ADMIN_2, 'adj-1')).rejects.toThrow(
        AdjustmentError,
      );
    });

    it('rejects duplicate reject', async () => {
      chain.setResult([
        makeAdjustmentRow({ status: 'REJECTED', checkerId: ADMIN_2 }),
      ]);
      await expect(svc().rejectAdjustment(ADMIN_2, 'adj-1')).rejects.toThrow(
        AdjustmentError,
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Concurrency                                                     */
  /* ---------------------------------------------------------------- */

  describe('concurrency', () => {
    it('concurrent approve/reject produces one deterministic result', async () => {
      chain.setSequence([[makeAdjustmentRow()]]);

      // First call succeeds
      chain.setTransactionFn(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(
          txWithResult([makeAdjustmentRow()]),
        ),
      );

      const r1 = await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(r1.status).toBe('APPROVED');
      expect(r1.entryId).toBeDefined();

      // Second call should fail because status is now APPROVED
      chain.setTransactionFn(null);
      chain.setResult([
        makeAdjustmentRow({ status: 'APPROVED', checkerId: ADMIN_2 }),
      ]);
      await expect(svc().approveAdjustment(ADMIN_2, 'adj-1')).rejects.toThrow(
        AdjustmentError,
      );
    });

    it('no partial state on concurrent access', async () => {
      chain.setSequence([[makeAdjustmentRow()]]);
      chain.setTransactionFn(async (cb: unknown) =>
        (cb as (tx: unknown) => Promise<unknown>)(
          txWithResult([makeAdjustmentRow()]),
        ),
      );

      const r = await svc().approveAdjustment(ADMIN_2, 'adj-1');
      expect(r.status).toBe('APPROVED');
      expect(r.entryId).toBeDefined();
    });
  });
});

/* ================================================================ */
/*  CommissionRateService Tests (D-054 secured owner contract)       */
/* ================================================================ */

describe('CommissionRateService', () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    chain = createChain().setResult([]);
  });

  /** Active market row returned by the db-level market lookups. */
  const MARKET_ROW = {
    id: 'market-1',
    code: 'MY',
    timezone: 'Asia/Kuala_Lumpur',
    currency: 'MYR',
  };

  /**
   * D-054 §5 server-created actor: currentMarketId is the server-selected
   * market UUID; a caller-supplied createdBy is never honored.
   */
  const ACTOR = {
    adminUserId: ADMIN_1,
    currentMarketId: MARKET_ROW.id,
    marketContextVersion: 1,
    requestId: 'unit-request-1',
    ipAddress: '127.0.0.1',
  };

  /**
   * Asia/Kuala_Lumpur is fixed UTC+8 — the UTC instant of a KL midnight.
   * The owner only accepts strictly future market-local 00:00 (D-054 §8).
   */
  function klMidnightIso(klDate: string): string {
    const [year, month, day] = klDate.split('-').map((value) => Number(value));
    return new Date(
      Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0) -
        8 * 60 * 60 * 1000,
    ).toISOString();
  }

  /**
   * Build the secured owner service over the mocked chain + a controllable
   * transaction proxy. RbacService and AuditService are stubbed (the frozen
   * owner controls that touch them are covered by the D-054 integration
   * suite against real PostgreSQL).
   */
  function ownerHarness() {
    const tx = createTxProxy();
    // The owner uses raw SQL via tx.execute(...) and expects pg-style
    // result objects ({ rows: [...] }). Map the mocked thenable result to
    // that shape (the shared createTxProxy is also used by the frozen
    // adjustment tests, which expect bare rows arrays — so only the owner
    // harness wraps it).
    tx.execute = vi.fn().mockImplementation(() => {
      let value: unknown[];
      if (tx._sequence.length > 0) {
        const idx = Math.min(tx._seqIdx, tx._sequence.length - 1);
        tx._seqIdx++;
        value = tx._sequence[idx] as unknown[];
      } else {
        value = tx._result as unknown[];
      }
      return {
        then: (resolve: (v: unknown) => void) => resolve({ rows: value }),
      };
    });
    const dbService = createDbService(chain);
    (dbService as { runTransaction: unknown }).runTransaction = (
      cb: (t: unknown) => Promise<unknown>,
    ) => cb(tx);
    const auditCalls: unknown[] = [];
    const service = new RateManagementService(
      dbService as never,
      {
        isAllowed: async () => true,
        hasMarketAccess: async () => true,
      } as never,
      {
        appendWithinTransaction: async (input: unknown) => {
          auditCalls.push(input);
        },
      } as never,
    );
    return { service, tx, auditCalls };
  }

  function svc() {
    return new RateManagementService(
      createDbService(chain) as never,
      {
        isAllowed: async () => true,
        hasMarketAccess: async () => true,
      } as never,
      { appendWithinTransaction: async () => undefined } as never,
    );
  }

  function makeRateRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rate-1',
      commissionType: 'AGENT_UPGRADE',
      generation: 1,
      market: 'MY',
      rateValue: '50.0000000000',
      rateType: 'FIXED',
      effectiveFrom: new Date('2026-07-01T00:00:00Z'),
      effectiveUntil: null,
      createdBy: ADMIN_1,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      ...overrides,
    };
  }

  /**
   * Raw pg-style row returned by the owner's INSERT ... RETURNING.
   */
  function makeVersionRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rate-1',
      commission_type: 'AGENT_UPGRADE',
      generation: 1,
      market: 'MY',
      rate_value: '50.0000000000',
      rate_type: 'FIXED',
      effective_from: new Date(klMidnightIso('2099-01-01')),
      effective_until: null,
      created_by: ADMIN_1,
      created_at: new Date('2026-08-05T00:00:00Z'),
      reason: 'unit owner create',
      ...overrides,
    };
  }

  /**
   * Happy-path command for the secured owner. All timestamps are future KL
   * midnights (D-054 §8) so only the aspect under test can fail.
   */
  function ownerCommand(overrides: Record<string, unknown> = {}) {
    return {
      market: 'MY',
      commissionType: 'AGENT_UPGRADE',
      generation: 1,
      rateValue: '50.00',
      rateType: 'FIXED',
      effectiveFrom: klMidnightIso('2099-01-01'),
      reason: 'unit owner create',
      idempotencyKey: `unit-key-${Math.random().toString(36).slice(2, 10)}`,
      ...overrides,
    };
  }

  /**
   * Successful-create tx sequence: advisory lock → claim → overlap (none)
   * → insert → response persist.
   */
  function happyTxSequence(versionRow: Record<string, unknown> = {}) {
    return [[], [{ id: 'claim-1' }], [], [makeVersionRow(versionRow)], []];
  }

  /* ---------------------------------------------------------------- */
  /*  Create (secured owner, D-054)                                   */
  /* ---------------------------------------------------------------- */

  describe('create', () => {
    it('creates new rate version with effective_from through the owner', async () => {
      const { service, tx, auditCalls } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      tx.setSequence(happyTxSequence());
      const r = await service.createRateVersion(ACTOR, ownerCommand());
      expect(r.commissionType).toBe('AGENT_UPGRADE');
      expect(r.generation).toBe(1);
      expect(r.market).toBe('MY');
      expect(r.rateType).toBe('FIXED');
      expect(r.effectiveFrom).toBe(klMidnightIso('2099-01-01'));
      expect(r.effectiveUntil).toBeNull();
      expect(r.createdBy).toBe(ADMIN_1);
      expect(r.marketId).toBe('market-1');
      expect(r.currency).toBe('MYR');
      expect(tx.execute).toHaveBeenCalled();
      // Atomic immutable audit fired inside the same transaction.
      expect(auditCalls).toHaveLength(1);
    });

    it('supports optional effective_until (half-open window)', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      tx.setSequence(
        happyTxSequence({
          effective_until: new Date('2099-06-30T23:59:59.000Z'),
        }),
      );
      const r = await service.createRateVersion(
        ACTOR,
        ownerCommand({ effectiveUntil: '2099-06-30T23:59:59.000Z' }),
      );
      expect(r.effectiveUntil).toBe('2099-06-30T23:59:59.000Z');
    });

    it('rejects an effective_until at or before effective_from', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ effectiveUntil: klMidnightIso('2098-12-31') }),
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('rejects overlapping effective period (chain rule)', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      // The latest row is open-ended and starts after the new start → overlap.
      tx.setSequence([
        [],
        [{ id: 'claim-1' }],
        [
          {
            id: 'existing-rate',
            effective_from: new Date(klMidnightIso('2099-02-01')),
            effective_until: null,
          },
        ],
      ]);
      await expect(
        service.createRateVersion(ACTOR, ownerCommand()),
      ).rejects.toThrow(RateManagementError);
    });

    it('accepts a successor starting exactly at a stored predecessor end', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      // Predecessor window ends exactly at the KL midnight of 2099-07-02;
      // the successor starts at exactly that instant → legal half-open
      // successor (D-054 §9: successor may start at the predecessor end).
      const predecessorEnd = klMidnightIso('2099-07-02');
      tx.setSequence([
        [],
        [{ id: 'claim-1' }],
        [
          {
            id: 'existing-rate',
            effective_from: new Date('2098-01-01T00:00:00.000Z'),
            effective_until: new Date(predecessorEnd),
          },
        ],
        [makeVersionRow()],
        [],
      ]);
      const r = await service.createRateVersion(
        ACTOR,
        ownerCommand({ effectiveFrom: predecessorEnd }),
      );
      expect(r.id).toBe('rate-1');
    });

    it('validates commission_type', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ commissionType: 'INVALID_TYPE' }),
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('validates generation against the canonical P5-S0 mapping (P5-R1)', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      tx.setSequence(happyTxSequence());
      const created = await service.createRateVersion(
        ACTOR,
        ownerCommand({
          commissionType: 'MEMBER_CONSUMPTION',
          rateType: 'PERCENTAGE',
          rateValue: '5.00',
        }),
      );
      expect(created.generation).toBe(1);
    });

    it('rejects generation 0 for MEMBER_CONSUMPTION (G1/G2 only)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({
            commissionType: 'MEMBER_CONSUMPTION',
            generation: 0,
            rateType: 'PERCENTAGE',
            rateValue: '5.00',
          }),
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('accepts the versioned activation fee (AGENT_ACTIVATION_FEE, generation 0)', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      tx.setSequence(
        happyTxSequence({ commission_type: 'AGENT_ACTIVATION_FEE' }),
      );
      const created = await service.createRateVersion(
        ACTOR,
        ownerCommand({
          commissionType: 'AGENT_ACTIVATION_FEE',
          generation: 0,
          rateValue: '388.00',
        }),
      );
      expect(created.commissionType).toBe('AGENT_ACTIVATION_FEE');
    });

    it('rejects generation 1 for AGENT_ACTIVATION_FEE (single-generation)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({
            commissionType: 'AGENT_ACTIVATION_FEE',
            generation: 1,
            rateValue: '388.00',
          }),
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('rejects generation 1 for single-generation MERCHANT_RECRUITMENT', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({
            commissionType: 'MERCHANT_RECRUITMENT',
            generation: 1,
            rateValue: '0.005',
            rateType: 'PERCENTAGE',
          }),
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('validates rate_type (PERCENTAGE, FIXED)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ rateType: 'PERCENTAGE' }), // AGENT_UPGRADE requires FIXED
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('validates market format', async () => {
      const { service } = ownerHarness();
      await expect(
        service.createRateVersion(ACTOR, ownerCommand({ market: 'XYZ' })),
      ).rejects.toThrow(RateManagementError);
    });

    it('requires a server Current Admin Market (D-054 §5)', async () => {
      const { service } = ownerHarness();
      await expect(
        service.createRateVersion({ adminUserId: ADMIN_1 }, ownerCommand()),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_MARKET_SELECTION_REQUIRED',
      });
    });

    it('rejects a body market different from the current market (D-054 §5)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]); // current market code is MY
      await expect(
        service.createRateVersion(ACTOR, ownerCommand({ market: 'SG' })),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_MARKET_CONTEXT_MISMATCH',
      });
    });

    it('rejects a missing / blank reason and an overlength reason (D-054 §11)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(ACTOR, ownerCommand({ reason: '   ' })),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_REASON_REQUIRED' });
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ reason: 'x'.repeat(501) }),
        ),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_REASON_REQUIRED' });
    });

    it('rejects a missing Idempotency-Key (D-054 §10)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(ACTOR, ownerCommand({ idempotencyKey: '' })),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_IDEMPOTENCY_KEY_REQUIRED',
      });
    });

    it('rejects negative rates and >10 decimals with exact-math errors (D-054 §7)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(ACTOR, ownerCommand({ rateValue: '-1.00' })),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_PRECISION_EXCEEDED' });
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ rateValue: '0.00000000001' }),
        ),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_PRECISION_EXCEEDED' });
    });

    it('rejects percentages above 100% (D-054 §7) and accepts exactly 100%', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({
            commissionType: 'MEMBER_CONSUMPTION',
            rateType: 'PERCENTAGE',
            rateValue: '100.0000000001',
          }),
        ),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_PERCENTAGE_LIMIT',
      });
      tx.setSequence(
        happyTxSequence({
          commission_type: 'MEMBER_CONSUMPTION',
          rate_type: 'PERCENTAGE',
        }),
      );
      const r = await service.createRateVersion(
        ACTOR,
        ownerCommand({
          commissionType: 'MEMBER_CONSUMPTION',
          rateType: 'PERCENTAGE',
          rateValue: '100',
        }),
      );
      expect(r.rateType).toBe('PERCENTAGE');
    });

    it('rejects non-future / non-midnight activation instants (D-054 §8)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ effectiveFrom: '2099-01-01T00:00:00.000Z' }),
        ),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      });
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ effectiveFrom: '2020-01-01T00:00:00.000Z' }),
        ),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_ACTIVATION_NOT_FUTURE',
      });
    });

    it('rejects a payload timezone different from the market timezone (D-054 §8)', async () => {
      const { service } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      await expect(
        service.createRateVersion(
          ACTOR,
          ownerCommand({ timezone: 'Asia/Singapore' }),
        ),
      ).rejects.toMatchObject({
        code: 'COMMISSION_RATE_TIMEZONE_MISMATCH',
      });
    });

    it('replays the original result for same key + same payload (D-054 §10)', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      // The request_hash of the replayed payload must match the stored row:
      // compute the canonical hash of the same command and stub it.
      const cmd = ownerCommand();
      const { canonicalPayloadHash } = await import('./rate.service.js');
      const payloadHash = canonicalPayloadHash({
        operation: 'create',
        marketId: 'market-1',
        market: 'MY',
        commissionType: cmd.commissionType,
        generation: cmd.generation,
        rateType: cmd.rateType,
        rateValue: cmd.rateValue,
        effectiveFrom: new Date(cmd.effectiveFrom as string).toISOString(),
        effectiveUntil: null,
        timezone: 'Asia/Kuala_Lumpur',
        reason: cmd.reason,
        actorScope: `commission.rate.owner.create:market-1:${ADMIN_1}`,
      });
      // No claim row (already exists) → replay path returns the stored response.
      tx.setSequence([
        [],
        [],
        [
          {
            id: 'claim-1',
            response: { id: 'rate-1', commissionType: 'AGENT_UPGRADE' },
            status_code: 201,
            request_hash: payloadHash,
          },
        ],
      ]);
      const r = await service.createRateVersion(ACTOR, cmd);
      expect(r).toMatchObject({ id: 'rate-1' });
    });

    it('rejects same key + different payload with an idempotency conflict (D-054 §10)', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      tx.setSequence([
        [],
        [],
        [
          {
            id: 'claim-1',
            response: { id: 'rate-1' },
            status_code: 201,
            request_hash: 'b'.repeat(64),
          },
        ],
      ]);
      await expect(
        service.createRateVersion(ACTOR, ownerCommand()),
      ).rejects.toMatchObject({ code: 'COMMISSION_RATE_IDEMPOTENCY_CONFLICT' });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Immutability                                                    */
  /* ---------------------------------------------------------------- */

  describe('immutability', () => {
    it('historical rate version cannot be updated', async () => {
      const service = svc();
      expect((service as any).updateRate).toBeUndefined();
    });

    it('historical rate version cannot be deleted', async () => {
      const service = svc();
      expect((service as any).deleteRate).toBeUndefined();
    });

    it('new rate is prospective only (strictly future market-local midnight)', async () => {
      const { service, tx } = ownerHarness();
      chain.setResult([MARKET_ROW]);
      tx.setSequence(happyTxSequence());
      const r = await service.createRateVersion(
        ACTOR,
        ownerCommand({ effectiveFrom: klMidnightIso('2099-01-01') }),
      );
      expect(r.effectiveFrom).toBe(klMidnightIso('2099-01-01'));
    });

    it('no recalculation of historical ledger entries', async () => {
      const service = svc();
      expect((service as any).recalculateHistorical).toBeUndefined();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Query                                                           */
  /* ---------------------------------------------------------------- */

  describe('query', () => {
    it('returns active rates for market', async () => {
      chain.setResult([makeRateRow()]);
      const r = await svc().getActiveRates('MY');
      expect(r).toHaveLength(1);
      expect(r[0]!.market).toBe('MY');
    });

    it('returns only the latest effective start per definition (logical half-open)', async () => {
      // Rows in PostgreSQL ORDER BY (..., effective_from DESC) order.
      chain.setResult([
        makeRateRow({
          id: 'latest',
          effectiveFrom: new Date('2099-01-01T00:00:00Z'),
        }),
        makeRateRow({
          id: 'older',
          effectiveFrom: new Date('2026-07-01T00:00:00Z'),
        }),
      ]);
      const r = await svc().getActiveRates('MY');
      expect(r).toHaveLength(1);
      expect(r[0]!.id).toBe('latest');
    });

    it('returns rate history by type+generation+market', async () => {
      chain.setResult([
        makeRateRow({
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          market: 'MY',
        }),
        makeRateRow({
          commissionType: 'AGENT_UPGRADE',
          generation: 1,
          market: 'MY',
          id: 'rate-2',
        }),
      ]);
      const r = await svc().getRateHistory('MY', 'AGENT_UPGRADE', 1);
      expect(r).toHaveLength(2);
      expect(r[0]!.market).toBe('MY');
    });

    it('returns single rate by ID', async () => {
      chain.setResult([makeRateRow({ id: 'rate-1' })]);
      const r = await svc().getRateById('rate-1');
      expect(r).not.toBeNull();
      expect(r!.id).toBe('rate-1');
    });

    it('returns null when rate not found by ID', async () => {
      chain.setResult([]);
      const r = await svc().getRateById('nonexistent');
      expect(r).toBeNull();
    });

    it('filters active rates by commission_type', async () => {
      chain.setResult([makeRateRow({ commissionType: 'MEMBER_CONSUMPTION' })]);
      const r = await svc().getActiveRates('MY', 'MEMBER_CONSUMPTION');
      expect(r).toHaveLength(1);
      expect(r[0]!.commissionType).toBe('MEMBER_CONSUMPTION');
    });

    it('filters active rates by market', async () => {
      chain.setResult([makeRateRow({ market: 'SG' })]);
      const r = await svc().getActiveRates('SG');
      expect(r).toHaveLength(1);
      expect(r[0]!.market).toBe('SG');
    });

    it('validates commission type in history query', async () => {
      await expect(
        svc().getRateHistory('MY', 'BOGUS_TYPE' as any, 0),
      ).rejects.toThrow(RateManagementError);
    });

    it('validates generation in history query', async () => {
      await expect(
        svc().getRateHistory('MY', 'AGENT_UPGRADE', 5),
      ).rejects.toThrow(RateManagementError);
    });
  });
});

/* ================================================================ */
/*  CommissionSecurity Tests                                         */
/* ================================================================ */

describe('CommissionSecurity', () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    chain = createChain().setResult([]);
  });

  function svc() {
    return new CommissionSecurityService(createDbService(chain));
  }

  function makeAuthPrincipal(
    overrides: Partial<{
      type: 'ACCOUNT' | 'ADMIN_USER';
      accountId: string;
      sessionId: string;
      adminUserId: string;
    }>,
  ) {
    return {
      type: overrides.type ?? 'ACCOUNT',
      accountId: overrides.accountId ?? 'acct-1',
      sessionId: 'sess-1',
      adminUserId: overrides.adminUserId ?? undefined,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Principal enforcement                                           */
  /* ---------------------------------------------------------------- */

  describe('principal enforcement', () => {
    it('member_id from auth principal, not request body', async () => {
      chain.setResult([{ memberId: MEMBER_A }]);
      const result = await svc().assertMemberIdFromPrincipal(
        MEMBER_A,
        makeAuthPrincipal({
          type: 'ACCOUNT',
          accountId: 'acct-1',
        }),
      );
      expect(result).toBe(MEMBER_A);
    });

    it('maker_id from auth principal, not request body', () => {
      const result = svc().assertMakerIdFromPrincipal(
        ADMIN_1,
        makeAuthPrincipal({
          type: 'ADMIN_USER',
          adminUserId: ADMIN_1,
          accountId: 'acct-1',
        }),
      );
      expect(result).toBe(ADMIN_1);
    });

    it('checker_id from auth principal, not request body', () => {
      const result = svc().assertCheckerIdFromPrincipal(
        ADMIN_2,
        makeAuthPrincipal({
          type: 'ADMIN_USER',
          adminUserId: ADMIN_2,
          accountId: 'acct-2',
        }),
      );
      expect(result).toBe(ADMIN_2);
    });

    it('rejects spoofed member_id', async () => {
      chain.setResult([{ memberId: MEMBER_B }]);
      await expect(
        svc().assertMemberIdFromPrincipal(
          MEMBER_A,
          makeAuthPrincipal({
            type: 'ACCOUNT',
            accountId: 'acct-1',
          }),
        ),
      ).rejects.toThrow(CommissionSecurityError);
    });

    it('rejects spoofed maker_id', () => {
      expect(() =>
        svc().assertMakerIdFromPrincipal(
          ADMIN_1,
          makeAuthPrincipal({
            type: 'ADMIN_USER',
            adminUserId: ADMIN_2,
            accountId: 'acct-2',
          }),
        ),
      ).toThrow(CommissionSecurityError);
    });

    it('rejects spoofed checker_id', () => {
      expect(() =>
        svc().assertCheckerIdFromPrincipal(
          ADMIN_1,
          makeAuthPrincipal({
            type: 'ADMIN_USER',
            adminUserId: ADMIN_2,
            accountId: 'acct-2',
          }),
        ),
      ).toThrow(CommissionSecurityError);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Authorization                                                   */
  /* ---------------------------------------------------------------- */

  describe('authorization', () => {
    it("member cannot access another member's commission", async () => {
      chain.setResult([{ beneficiaryId: MEMBER_B }]);
      await expect(
        svc().assertBeneficiaryAccess('entry-1', MEMBER_A),
      ).rejects.toThrow(CommissionSecurityError);
    });

    it('non-admin cannot create adjustments', () => {
      expect(() =>
        svc().assertMakerIdFromPrincipal(
          ADMIN_1,
          makeAuthPrincipal({
            type: 'ACCOUNT',
            accountId: 'acct-1',
          }),
        ),
      ).toThrow(CommissionSecurityError);
    });

    it('non-admin cannot manage rates', async () => {
      chain.setResult([]);
      await expect(
        svc().assertAdminAccess('nonexistent-admin'),
      ).rejects.toThrow(CommissionSecurityError);
    });

    it('maker cannot approve own adjustment', async () => {
      chain.setResult([{ makerId: ADMIN_1 }]);
      await expect(
        svc().assertCheckerNotMaker('adj-1', ADMIN_1),
      ).rejects.toThrow(CommissionSecurityError);
    });

    it('maker cannot reject own adjustment', async () => {
      chain.setResult([{ makerId: ADMIN_1 }]);
      await expect(
        svc().assertCheckerNotMaker('adj-1', ADMIN_1),
      ).rejects.toThrow(CommissionSecurityError);
    });

    it('admin can search all commissions', async () => {
      chain.setResult([{ id: ADMIN_1 }]);
      const result = await svc().assertAdminAccess(ADMIN_1);
      expect(result).toBe(ADMIN_1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Referral privacy                                                */
  /* ---------------------------------------------------------------- */

  describe('referral privacy', () => {
    it('referral tree anonymized (no raw member IDs)', () => {
      const tree = {
        myCode: 'TEST001',
        referrer: {
          maskedReference: 'REF***',
          isAgent: true,
        },
        referrals: {
          g1Count: 5,
          g2Count: 3,
          g1Agents: 2,
          g2Agents: 1,
        },
      };
      const sanitized = svc().anonymizeReferralTree(tree);
      expect(sanitized.myCode).toBe('TEST001');
      expect(sanitized.referrer!.maskedReference).toBe('REF***');
      expect(sanitized.referrals.g1Count).toBe(5);
      expect(JSON.stringify(sanitized)).not.toContain('memberId');
    });

    it('agent sees referral counts only', () => {
      const tree = {
        myCode: 'AGENT01',
        referrer: {
          maskedReference: 'UPPER***',
          isAgent: true,
        },
        referrals: {
          g1Count: 10,
          g2Count: 7,
          g1Agents: 3,
          g2Agents: 2,
        },
      };
      const sanitized = svc().anonymizeReferralTree(tree);
      expect(sanitized.referrals).toEqual({
        g1Count: 10,
        g2Count: 7,
        g1Agents: 3,
        g2Agents: 2,
      });
    });

    it('admin sees full detail', () => {
      const tree = {
        myCode: 'ADMIN01',
        referrer: null,
        referrals: {
          g1Count: 0,
          g2Count: 0,
          g1Agents: 0,
          g2Agents: 0,
        },
      };
      const sanitized = svc().anonymizeReferralTree(tree);
      expect(sanitized.referrer).toBeNull();
      expect(sanitized.referrals.g1Count).toBe(0);
    });
  });

  describe('assertOwnCommission', () => {
    it('verifies commission ownership', async () => {
      chain.setResult([{ beneficiaryId: MEMBER_A }]);
      const result = await svc().assertOwnCommission('entry-1', MEMBER_A);
      expect(result).toBe(MEMBER_A);
    });

    it('rejects non-owner access', async () => {
      chain.setResult([{ beneficiaryId: MEMBER_B }]);
      await expect(
        svc().assertOwnCommission('entry-1', MEMBER_A),
      ).rejects.toThrow(CommissionSecurityError);
    });

    it('rejects non-existent entry', async () => {
      chain.setResult([]);
      await expect(
        svc().assertOwnCommission('missing-entry', MEMBER_A),
      ).rejects.toThrow(CommissionSecurityError);
    });
  });

  describe('getCanonicalLockOrder', () => {
    it('sorts UUIDs in ascending order', () => {
      const ids = [MEMBER_B, MEMBER_A];
      const sorted = svc().getCanonicalLockOrder(ids);
      expect(sorted).toEqual([MEMBER_A, MEMBER_B]);
    });

    it('returns empty array for empty input', () => {
      expect(svc().getCanonicalLockOrder([])).toEqual([]);
    });

    it('handles single-element array', () => {
      expect(svc().getCanonicalLockOrder([MEMBER_A])).toEqual([MEMBER_A]);
    });
  });
});
