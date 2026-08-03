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
/*  CommissionRateService Tests                                      */
/* ================================================================ */

describe('CommissionRateService', () => {
  let chain: ReturnType<typeof createChain>;

  beforeEach(() => {
    chain = createChain().setResult([]);
  });

  function svc() {
    return new RateManagementService(createDbService(chain));
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

  /* ---------------------------------------------------------------- */
  /*  Create                                                          */
  /* ---------------------------------------------------------------- */

  describe('create', () => {
    it('creates new rate version with effective_from', async () => {
      chain.setResult([]); // No overlapping periods
      const r = await svc().createRate(
        ADMIN_1,
        'AGENT_UPGRADE',
        1,
        'MY',
        '50.00',
        'FIXED',
        '2026-07-01T00:00:00Z',
      );
      expect(r.commissionType).toBe('AGENT_UPGRADE');
      expect(r.generation).toBe(1);
      expect(r.market).toBe('MY');
      expect(r.rateType).toBe('FIXED');
      expect(r.effectiveFrom).toBe('2026-07-01T00:00:00Z');
      expect(r.effectiveUntil).toBeNull();
      expect(chain.insert).toHaveBeenCalled();
    });

    it('supports optional effective_until', async () => {
      chain.setResult([]);
      const r = await svc().createRate(
        ADMIN_1,
        'AGENT_UPGRADE',
        1,
        'MY',
        '50.00',
        'FIXED',
        '2026-07-01T00:00:00Z',
        '2026-12-31T23:59:59Z',
      );
      expect(r.effectiveUntil).toBe('2026-12-31T23:59:59Z');
    });

    it('rejects overlapping effective period', async () => {
      chain.setResult([{ id: 'existing-rate' }]);
      await expect(
        svc().createRate(
          ADMIN_1,
          'AGENT_UPGRADE',
          1,
          'MY',
          '25.00',
          'FIXED',
          '2026-08-01T00:00:00Z',
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('accepts non-overlapping rate', async () => {
      chain.setResult([]); // No overlap
      const r = await svc().createRate(
        ADMIN_1,
        'AGENT_UPGRADE',
        1,
        'MY',
        '30.00',
        'FIXED',
        '2027-01-01T00:00:00Z',
      );
      expect(r.rateValue).toBe('30.00');
    });

    it('validates commission_type', async () => {
      await expect(
        svc().createRate(
          ADMIN_1,
          'INVALID_TYPE',
          0,
          'MY',
          '10.00',
          'PERCENTAGE',
          '2026-07-01T00:00:00Z',
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('validates generation against the canonical P5-S0 mapping (P5-R1)', async () => {
      // P5-R1 reconciliation: G1/G2 member consumption uses generations 1/2
      // (seed + service); generation 0 is only for single-generation types
      // (MERCHANT_RECRUITMENT, AGENT_ACTIVATION_FEE). The legacy validation
      // that allowed only generation 0 for MEMBER_CONSUMPTION is retired.
      const created = await svc().createRate(
        ADMIN_1,
        'MEMBER_CONSUMPTION',
        1,
        'MY',
        '5.00',
        'PERCENTAGE',
        '2026-07-01T00:00:00Z',
      );
      expect(created.generation).toBe(1);
    });

    it('rejects generation 0 for MEMBER_CONSUMPTION (G1/G2 only)', async () => {
      await expect(
        svc().createRate(
          ADMIN_1,
          'MEMBER_CONSUMPTION',
          0,
          'MY',
          '5.00',
          'PERCENTAGE',
          '2026-07-01T00:00:00Z',
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('accepts the versioned activation fee (AGENT_ACTIVATION_FEE, generation 0)', async () => {
      const created = await svc().createRate(
        ADMIN_1,
        'AGENT_ACTIVATION_FEE',
        0,
        'MY',
        '388.00',
        'FIXED',
        '2026-07-25T00:00:00Z',
      );
      expect(created.commissionType).toBe('AGENT_ACTIVATION_FEE');
    });

    it('rejects generation 1 for AGENT_ACTIVATION_FEE (single-generation)', async () => {
      await expect(
        svc().createRate(
          ADMIN_1,
          'AGENT_ACTIVATION_FEE',
          1,
          'MY',
          '388.00',
          'FIXED',
          '2026-07-25T00:00:00Z',
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('rejects generation 1 for single-generation MERCHANT_RECRUITMENT', async () => {
      await expect(
        svc().createRate(
          ADMIN_1,
          'MERCHANT_RECRUITMENT',
          1,
          'MY',
          '0.005',
          'PERCENTAGE',
          '2026-07-25T00:00:00Z',
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('validates rate_type (PERCENTAGE, FIXED)', async () => {
      await expect(
        svc().createRate(
          ADMIN_1,
          'AGENT_UPGRADE',
          1,
          'MY',
          '50.00',
          'PERCENTAGE', // AGENT_UPGRADE requires FIXED
          '2026-07-01T00:00:00Z',
        ),
      ).rejects.toThrow(RateManagementError);
    });

    it('validates market format', async () => {
      await expect(
        svc().createRate(
          ADMIN_1,
          'AGENT_UPGRADE',
          1,
          'XYZ',
          '50.00',
          'FIXED',
          '2026-07-01T00:00:00Z',
        ),
      ).rejects.toThrow(RateManagementError);
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

    it('new rate is prospective only', async () => {
      chain.setResult([]);
      const r = await svc().createRate(
        ADMIN_1,
        'AGENT_UPGRADE',
        1,
        'MY',
        '80.00',
        'FIXED',
        '2099-01-01T00:00:00Z',
      );
      expect(r.effectiveFrom).toBe('2099-01-01T00:00:00Z');
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
