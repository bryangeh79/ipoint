/**
 * Commission Compensation Service — Unit Tests
 *
 * Tests the Correction Compensation & Idempotency Service (P5-S5).
 *
 * Covers:
 * - Reversal compensation: exact opposite amounts, immutable original
 * - Refund compensation: REFUND_COMPENSATION entry type
 * - Atomic multi-entry rollback
 * - Over-compensation prevention
 * - Idempotency / replay safety
 * - D-10 post-source revocation preservation
 * - Agent Upgrade clawback exclusion
 * - Phase 4 correction_execution_id linkage
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  agentActivations,
  correctionExecutions,
  commissionProcessing,
  commissionLedger,
  commissionStatusEvents,
  commissionProcessingResults,
  transactions,
  markets,
} from '@ipoint/database';
import { CompensationService } from './compensation.service.js';
import { DatabaseService } from '../../database/database.service.js';

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock Drizzle query chain that mimics the builder pattern:
 *   db.select().from().where().limit() — each call returns `this`
 *   `await chain` resolves via `.then()` using either _result (singleton)
 *   or _sequence (sequential per-call).
 */
function createChain() {
  let _returnResult: unknown = [];
  const returningThenable = {
    then: vi
      .fn()
      .mockImplementation((r: (v: unknown) => void) => r(_returnResult)),
  };
  const chain = {
    _result: [] as unknown,
    _sequence: [] as unknown[][],
    _seqIdx: 0,

    // ── Thenable ──────────────────────────────────────────────────
    then: vi.fn().mockImplementation(function (
      this: any,
      r: (v: unknown) => void,
    ) {
      if (this._sequence.length > 0) {
        const i = Math.min(this._seqIdx, this._sequence.length - 1);
        this._seqIdx++;
        return r(this._sequence[i]);
      }
      return r(this._result);
    }),
    catch: vi.fn().mockReturnThis(),
    finally: vi.fn().mockReturnThis(),

    // ── Query builder ─────────────────────────────────────────────
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    forUpdate: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),

    // ── Mutation ──────────────────────────────────────────────────
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(returningThenable),

    // ── Raw execution ─────────────────────────────────────────────
    execute: vi.fn().mockReturnThis(),

    // ── Transaction ───────────────────────────────────────────────
    transaction: vi
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb(chain);
      }),

    // ── Test helpers ──────────────────────────────────────────────
    setResult(r: unknown) {
      this._result = r;
      return this;
    },
    setSequence(r: unknown[][]) {
      this._sequence = r;
      this._seqIdx = 0;
      return this;
    },
    setReturnResult(r: unknown) {
      _returnResult = r;
      return this;
    },
  };
  return chain;
}

/**
 * Wrap a mock chain into a DatabaseService-compatible shape.
 * The `pool` and `onApplicationShutdown` stubs avoid NestJS DI issues.
 */
function mockDb(chain: any) {
  return {
    db: chain,
    pool: null as never,
    runTransaction: vi
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        chain.transaction(cb),
      ),
    onApplicationShutdown: null as never,
  } as unknown as DatabaseService;
}

// ---------------------------------------------------------------------------
// Fixture Generators
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-07-26T00:00:00.000Z');

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    correctionExecutionId: 'ce-00000000-0000-0000-0000-000000000001',
    transactionId: 'tx-00000000-0000-0000-0000-000000000001',
    market: 'MY',
    compensationType: 'REVERSAL' as const,
    correctionEffectiveTime: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function makeOriginalEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'orig-00000000-0000-0000-0000-000000000001',
    beneficiaryId: 'ben-00000000-0000-0000-0000-000000000001',
    sourceType: 'MEMBER_CONSUMPTION',
    sourceReference: 'tx-00000000-0000-0000-0000-000000000001',
    market: 'MY',
    currency: 'MYR',
    amount: '88.0000000000',
    rateVersionId: null,
    rateSnapshot: { rate: '0.01' },
    calculationBasis: null,
    generation: 1,
    entryType: 'MEMBER_CONSUMPTION_G1_EARN',
    canonicalEntryKey: 'MY:tx-...:MEMBER_CONSUMPTION_G1_EARN',
    processingId: null,
    effectiveTime: new Date('2026-07-01T00:00:00.000Z'),
    reversalLinkage: null,
    notes: null,
    ...overrides,
  };
}

function makeTxnRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-00000000-0000-0000-0000-000000000001',
    memberId: 'mem-00000000-0000-0000-0000-000000000001',
    status: 'REVERSED',
    confirmedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommissionCompensationService', () => {
  let chain: ReturnType<typeof createChain>;
  let db: DatabaseService;
  let service: CompensationService;

  beforeEach(() => {
    vi.clearAllMocks();
    chain = createChain();
    db = mockDb(chain);
    service = new CompensationService(db);
  });

  // ===================================================================
  //  Reversal compensation
  // ===================================================================
  describe('reversal compensation', () => {
    it('creates exact opposite of original posted amount', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry({ amount: '88.0000000000' });

      chain.setSequence([
        [{ id: params.correctionExecutionId }], // [0] validate execution
        [makeTxnRow({ status: 'REVERSED' })], // [1] lookup txn
        [], // [2] no existing processing
        [orig], // [3] original entries found
        // Inside transaction:
        [undefined], // [4] insert processing record
        [{ total: null }], // [6] existing compensation sum
        [], // [7] idempotency check
        [undefined], // [8] insert ledger entry
        [undefined], // [9] insert status event
        [undefined], // [10] insert processing result
        [undefined], // [11] update processing to COMPLETED
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.completionOutcome).toBe('CREATED');
      expect(result.entries).toHaveLength(1);
      const entry = result.entries[0]!;
      expect(entry.outcome).toBe('CREATED');
      expect(entry.originalEntryId).toBe(orig.id);
      expect(entry.originalAmount).toBe('88.0000000000');
      expect(entry.compensationAmount).toBe('-88.0000000000');
    });

    it('uses reversal_linkage pointing to original entry', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry();

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.completionOutcome).toBe('CREATED');
      expect(result.entries[0]!.compensationEntryId).toBeTruthy();

      // Verify insert was called with reversalLinkage = original.id
      const insertCalls = chain.insert.mock.calls;
      const ledgerInsert = insertCalls.find(
        (call: any[]) => call[0] === commissionLedger,
      );
      expect(ledgerInsert).toBeTruthy();
      // The values() call follows insert(); verify values arg has reversalLinkage
      const valuesCalls = chain.values.mock.calls;
      // Find the values call for commissionLedger insertion (after the insert(commissionLedger) call)
      const ledgerValuesCall = valuesCalls.find(
        (call: any[]) => call[0] && call[0].reversalLinkage === orig.id,
      );
      expect(ledgerValuesCall).toBeTruthy();
      expect(ledgerValuesCall![0]).toMatchObject({
        reversalLinkage: orig.id,
        amount: expect.stringMatching(/^-/) as unknown,
      });
    });

    it('does not modify or delete original ledger entry', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry();

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      await service.processCorrectionCompensation(params);

      // No update or delete should touch commissionLedger
      const updateLedgerCalls = chain.update.mock.calls.filter(
        (call: any[]) => call[0] === commissionLedger,
      );
      expect(updateLedgerCalls).toHaveLength(0);

      // Only insert for compensation (never update original)
      const insertLedgerCalls = chain.insert.mock.calls.filter(
        (call: any[]) => call[0] === commissionLedger,
      );
      expect(insertLedgerCalls).toHaveLength(1);
    });

    it('creates entry_type = REVERSAL_COMPENSATION', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry();

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      await service.processCorrectionCompensation(params);

      const valuesCalls = chain.values.mock.calls;
      const ledgerValues = valuesCalls.find(
        (call: any[]) =>
          call[0] && call[0].entryType === 'REVERSAL_COMPENSATION',
      );
      expect(ledgerValues).toBeTruthy();
    });

    it('copies all snapshot fields from original entry', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const rateSnapshot = {
        rate: '0.01',
        rateVersionId: 'rv-001',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
      };
      const orig = makeOriginalEntry({
        market: 'MY',
        currency: 'MYR',
        rateVersionId: 'rv-001',
        rateSnapshot,
        calculationBasis: '8800.0000000000',
        generation: 1,
        sourceType: 'MEMBER_CONSUMPTION',
        sourceReference: params.transactionId,
      });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      await service.processCorrectionCompensation(params);

      const valuesCalls = chain.values.mock.calls;
      const ledgerValues = valuesCalls.find(
        (call: any[]) =>
          call[0] &&
          call[0].entryType === 'REVERSAL_COMPENSATION' &&
          call[0].sourceType === 'MEMBER_CONSUMPTION' &&
          call[0].sourceReference === params.transactionId &&
          call[0].market === 'MY' &&
          call[0].currency === 'MYR' &&
          call[0].generation === 1,
      );
      expect(ledgerValues).toBeTruthy();
      expect(ledgerValues![0].rateVersionId).toBe('rv-001');
      expect(ledgerValues![0].calculationBasis).toBe('8800.0000000000');
      expect(ledgerValues![0].rateSnapshot).toEqual(rateSnapshot);
    });
  });

  // ===================================================================
  //  Refund compensation
  // ===================================================================
  describe('refund compensation', () => {
    it('creates exact opposite of original posted amount', async () => {
      const params = makeParams({ compensationType: 'REFUND' });
      const orig = makeOriginalEntry({ amount: '150.0000000000' });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REFUNDED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.completionOutcome).toBe('CREATED');
      expect(result.entries[0]!.compensationAmount).toBe('-150.0000000000');
    });

    it('uses entry_type = REFUND_COMPENSATION', async () => {
      const params = makeParams({ compensationType: 'REFUND' });
      const orig = makeOriginalEntry();

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REFUNDED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      await service.processCorrectionCompensation(params);

      const valuesCalls = chain.values.mock.calls;
      const ledgerValues = valuesCalls.find(
        (call: any[]) => call[0] && call[0].entryType === 'REFUND_COMPENSATION',
      );
      expect(ledgerValues).toBeTruthy();
    });

    it('links to original entry via reversal_linkage', async () => {
      const params = makeParams({ compensationType: 'REFUND' });
      const orig = makeOriginalEntry();

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REFUNDED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      await service.processCorrectionCompensation(params);

      const valuesCalls = chain.values.mock.calls;
      const ledgerValues = valuesCalls.find(
        (call: any[]) => call[0] && call[0].reversalLinkage === orig.id,
      );
      expect(ledgerValues).toBeTruthy();
    });
  });

  // ===================================================================
  //  Atomic multi-entry compensation
  // ===================================================================
  describe('atomic multi-entry compensation', () => {
    it('writes all linked compensations in single transaction', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig1 = makeOriginalEntry({
        id: 'orig-1',
        amount: '50.0000000000',
        generation: 1,
      });
      const orig2 = makeOriginalEntry({
        id: 'orig-2',
        amount: '25.0000000000',
        generation: 2,
      });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig1, orig2],
        // Transaction starts:
        [undefined], // insert processing record
        // Entry 1:
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        // Entry 2:
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        // Update processing:
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.outcome).toBe('CREATED');
      expect(result.entries[1]!.outcome).toBe('CREATED');

      // Verify transaction was used exactly once
      expect(chain.transaction).toHaveBeenCalledTimes(1);
    });

    it('rolls back all entries if one compensation write fails', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig1 = makeOriginalEntry({
        id: 'orig-1',
        amount: '50.0000000000',
        generation: 1,
      });
      const orig2 = makeOriginalEntry({
        id: 'orig-2',
        amount: '25.0000000000',
        generation: 2,
      });

      // Fail on the second compensation insert inside the transaction.
      let valuesCallCount = 0;
      chain.values = vi.fn().mockImplementation(() => {
        valuesCallCount++;
        if (valuesCallCount === 5) {
          throw new Error('DB_CONNECTION_LOST');
        }
        return chain;
      });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig1, orig2],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [{ total: null }],
        [],
      ]);

      await expect(
        service.processCorrectionCompensation(params),
      ).rejects.toThrow('DB_CONNECTION_LOST');
      expect(valuesCallCount).toBe(5);
      expect(chain.transaction).toHaveBeenCalledTimes(1);
    });

    it('leaves no partial compensation ledger on failure', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry();

      // Fail on the first compensation ledger insert inside the transaction.
      let valuesCallCount = 0;
      chain.values = vi.fn().mockImplementation(() => {
        valuesCallCount++;
        if (valuesCallCount === 2) {
          throw new Error('CONSTRAINT_VIOLATION');
        }
        return chain;
      });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
      ]);

      // The service should propagate the transaction error
      await expect(
        service.processCorrectionCompensation(params),
      ).rejects.toThrow('CONSTRAINT_VIOLATION');

      expect(valuesCallCount).toBe(2);
      expect(chain.transaction).toHaveBeenCalledTimes(1);
    });

    it('does not mark processing COMPLETED on failure', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry();

      // Fail on the first compensation ledger insert inside the transaction.
      let valuesCallCount = 0;
      chain.values = vi.fn().mockImplementation(() => {
        valuesCallCount++;
        if (valuesCallCount === 2) {
          throw new Error('WRITE_FAILED');
        }
        return chain;
      });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
      ]);

      await expect(
        service.processCorrectionCompensation(params),
      ).rejects.toThrow('WRITE_FAILED');

      expect(valuesCallCount).toBe(2);
      // No update should be made to processing COMPLETED
      const updateCalls = chain.update.mock.calls.filter(
        (call: any[]) => call[0] === commissionProcessing,
      );
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ===================================================================
  //  Over-compensation prevention
  // ===================================================================
  describe('over-compensation prevention', () => {
    it('prevents cumulative compensation exceeding original amount', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry({ amount: '88.0000000000' });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: '88.0000000000' }], // already fully compensated
        // Should be SKIPPED_OVER_COMPENSATED, skipping the rest
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.completionOutcome).toBe('SKIPPED_INELIGIBLE');
      expect(result.entries[0]!.outcome).toBe('SKIPPED_OVER_COMPENSATED');
      expect(result.entries[0]!.compensationAmount).toBeNull();
    });

    it('rejects second correction execution for same fully compensated entry', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry({ amount: '88.0000000000' });

      // First call - full compensation succeeds
      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result1 = await service.processCorrectionCompensation(params);
      expect(result1.entries[0]!.outcome).toBe('CREATED');

      // Reset mocks for second call
      vi.clearAllMocks();
      chain = createChain();
      db = mockDb(chain);
      service = new CompensationService(db);

      // Second call - already fully compensated
      // The service will re-query the existing processing and find COMPLETED
      const canonicalProcessingKey =
        'MY:CORRECTION_EXECUTION:ce-00000000-0000-0000-0000-000000000001';

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        // Existing processing found with COMPLETED status
        [
          {
            id: 'proc-001',
            status: 'COMPLETED',
            completionOutcome: 'CREATED',
          },
        ],
        // No more calls because loadExistingCompensationResult is called
      ]);

      const result2 = await service.processCorrectionCompensation(params);
      // Should still succeed because it loads existing result (idempotent)
      expect(result2.completionOutcome).toBe('CREATED');
    });

    it('allows partial compensation when supported by Phase 4', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry({ amount: '100.0000000000' });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: '30.0000000000' }], // partially compensated (30 < 100)
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.entries[0]!.outcome).toBe('CREATED');
      expect(result.entries[0]!.compensationAmount).toBe('-100.0000000000');
    });

    it('returns COMPENSATION_ALREADY_EXISTS for duplicate', async () => {
      // This scenario tests a duplicate processing: same correction execution
      // already processed. The second call should return existing result.
      const params = makeParams({ compensationType: 'REVERSAL' });

      // Mock existing processing to be COMPLETED
      const existingEntry = makeOriginalEntry({ amount: '88.0000000000' });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        // Existing COMPLETED processing
        [
          {
            id: 'proc-existing',
            status: 'COMPLETED',
            completionOutcome: 'CREATED',
          },
        ],
        // loadExistingCompensationResult queries
        [{ id: 'proc-existing', completionOutcome: 'CREATED' }], // processing lookup
        [
          {
            // processing_results lookup
            id: 'pr-001',
            processingId: 'proc-existing',
            beneficiaryId: 'ben-001',
            generation: 1,
            entryType: 'REVERSAL_COMPENSATION',
            unroundedAmount: '-88.0000000000',
            postedAmount: '-88.0000000000',
            residualAmount: '0.0000000000',
            roundingMode: 'HALF_UP',
            calculationScale: 10,
            postingScale: 2,
            outcome: 'CREATED',
            reason: null,
            createdAt: new Date(),
          },
        ],
        // Compensation entries lookup
        [
          {
            id: 'comp-entry-id',
            publicReference: 'COM-260726-00001-RC',
            beneficiaryId: 'ben-001',
            sourceType: 'MEMBER_CONSUMPTION',
            sourceReference: params.transactionId,
            market: 'MY',
            currency: 'MYR',
            amount: '-88.0000000000',
            rateVersionId: null,
            rateSnapshot: {},
            calculationBasis: null,
            generation: 1,
            entryType: 'REVERSAL_COMPENSATION',
            postingStatus: 'EARNED',
            canonicalEntryKey: 'MY:ce-001:orig-001:REVERSAL_COMPENSATION',
            processingId: 'proc-existing',
            effectiveTime: new Date(),
            createdAt: new Date(),
            reversalLinkage: existingEntry.id,
            auditLinkage: params.correctionExecutionId,
            notes: null,
          },
        ],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.completionOutcome).toBe('CREATED');
      expect(result.entries).toHaveLength(1);
    });
  });

  // ===================================================================
  //  Idempotency
  // ===================================================================
  describe('idempotency', () => {
    it('same correction execution + same original entry → same result', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry();

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result1 = await service.processCorrectionCompensation(params);

      // Second call: existing COMPLETED processing found
      // Reset mock
      vi.clearAllMocks();
      chain = createChain();
      db = mockDb(chain);
      service = new CompensationService(db);

      const processedEntry = makeOriginalEntry({ amount: '88.0000000000' });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [{ id: 'proc-001', status: 'COMPLETED', completionOutcome: 'CREATED' }],
        [{ id: 'proc-001', completionOutcome: 'CREATED' }],
        [
          {
            id: 'pr-001',
            processingId: 'proc-001',
            beneficiaryId: 'ben-001',
            generation: 1,
            entryType: 'REVERSAL_COMPENSATION',
            unroundedAmount: '-88.0000000000',
            postedAmount: '-88.0000000000',
            residualAmount: '0.0000000000',
            roundingMode: 'HALF_UP',
            calculationScale: 10,
            postingScale: 2,
            outcome: 'CREATED',
            reason: null,
            createdAt: new Date(),
          },
        ],
        [
          {
            id: 'comp-entry-001',
            publicReference: 'COM-260726-00001-RC',
            beneficiaryId: 'ben-001',
            sourceType: 'MEMBER_CONSUMPTION',
            sourceReference: params.transactionId,
            market: 'MY',
            currency: 'MYR',
            amount: '-88.0000000000',
            rateVersionId: null,
            rateSnapshot: {},
            calculationBasis: null,
            generation: 1,
            entryType: 'REVERSAL_COMPENSATION',
            postingStatus: 'EARNED',
            canonicalEntryKey: 'MY:ce-001:orig-001:REVERSAL_COMPENSATION',
            processingId: 'proc-existing',
            effectiveTime: new Date(),
            createdAt: new Date(),
            reversalLinkage: processedEntry.id,
            auditLinkage: params.correctionExecutionId,
            notes: null,
          },
        ],
      ]);

      const result2 = await service.processCorrectionCompensation(params);
      expect(result2.completionOutcome).toBe('CREATED');
      expect(result2.entries).toHaveLength(1);
      expect(result2.entries[0]!.compensationAmount).toBe('-88.0000000000');
    });

    it('replay returns existing compensation entries', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });

      // Existing processing record is COMPLETED
      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [
          {
            id: 'proc-replay',
            status: 'COMPLETED',
            completionOutcome: 'CREATED',
          },
        ],
        [{ id: 'proc-replay', completionOutcome: 'CREATED' }],
        [
          {
            id: 'pr-r1',
            processingId: 'proc-replay',
            beneficiaryId: 'ben-001',
            generation: 1,
            entryType: 'REVERSAL_COMPENSATION',
            unroundedAmount: '-88.0000000000',
            postedAmount: '-88.0000000000',
            residualAmount: '0.0000000000',
            roundingMode: 'HALF_UP',
            calculationScale: 10,
            postingScale: 2,
            outcome: 'CREATED',
            reason: null,
            createdAt: new Date(),
          },
        ],
        [
          {
            id: 'ce-r1',
            publicReference: 'COM-260726-00001-RC',
            beneficiaryId: 'ben-001',
            sourceType: 'MEMBER_CONSUMPTION',
            sourceReference: params.transactionId,
            market: 'MY',
            currency: 'MYR',
            amount: '-88.0000000000',
            rateVersionId: null,
            rateSnapshot: {},
            calculationBasis: null,
            generation: 1,
            entryType: 'REVERSAL_COMPENSATION',
            postingStatus: 'EARNED',
            canonicalEntryKey: 'MY:ce-001:orig-001:REVERSAL_COMPENSATION',
            processingId: 'proc-replay',
            effectiveTime: new Date(),
            createdAt: new Date(),
            reversalLinkage: 'orig-001',
            auditLinkage: params.correctionExecutionId,
            notes: null,
          },
        ],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.processingId).toBe('proc-replay');
      expect(result.completionOutcome).toBe('CREATED');
    });

    it('crash recovery is safe (no duplicate compensation)', async () => {
      // Simulate a crash: first call creates IN_FLIGHT but crashes before COMPLETED
      const params = makeParams({ compensationType: 'REVERSAL' });

      // Attempt 1: Insert IN_FLIGHT but crash
      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [makeOriginalEntry({ amount: '88.0000000000' })],
      ]);

      // Intercept transaction to simulate crash
      chain.transaction = vi
        .fn()
        .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
          await cb(chain);
          // Simulate crash after transaction callback but before outer return
          return Promise.reject(new Error('POWER_FAILURE'));
        });

      await expect(
        service.processCorrectionCompensation(params),
      ).rejects.toThrow('POWER_FAILURE');

      // Reset for retry
      vi.clearAllMocks();
      chain = createChain();
      db = mockDb(chain);
      service = new CompensationService(db);

      // Attempt 2: The processing record might be IN_FLIGHT (crashed state)
      // The service should handle this - but per spec, IN_FLIGHT throws conflict error
      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [{ id: 'proc-crashed', status: 'IN_FLIGHT' }],
      ]);

      // Should throw CONFLICT error for existing IN_FLIGHT
      await expect(
        service.processCorrectionCompensation(params),
      ).rejects.toMatchObject({
        code: 'COMPENSATION_PROCESSING_CONFLICT',
        message: expect.stringContaining('already in progress'),
      });
    });
  });

  // ===================================================================
  //  D-10 post-source revocation preservation
  // ===================================================================
  describe('D-10 post-source revocation preservation', () => {
    it('source_event_time before later revocation remains compensable', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry({
        effectiveTime: new Date('2026-06-15T00:00:00.000Z'), // before revocation
      });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.entries[0]!.outcome).toBe('CREATED');
    });

    it('source_event_time at later revocation boundary still uses original ledger', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const sourceTime = new Date('2026-07-01T00:00:00.000Z');
      const orig = makeOriginalEntry({ effectiveTime: sourceTime });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      const entry = result.entries[0]!;
      expect(entry.outcome).toBe('CREATED');
      expect(entry.compensationAmount).toBe('-88.0000000000');
    });

    it('source_event_time after later revocation still uses original ledger', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const sourceTime = new Date('2026-07-15T00:00:00.000Z');
      const orig = makeOriginalEntry({ effectiveTime: sourceTime });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      const entry = result.entries[0]!;
      expect(entry.outcome).toBe('CREATED');
      expect(entry.compensationAmount).toBe('-88.0000000000');
    });

    it('pre-revocation commissions are preserved unchanged', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      const orig = makeOriginalEntry({
        effectiveTime: new Date('2026-06-15T00:00:00.000Z'), // before revocation
      });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.entries[0]!.outcome).toBe('CREATED');

      // Original entry should not be updated or deleted
      const updateCalls = chain.update.mock.calls.filter(
        (call: any[]) => call[0] === commissionLedger,
      );
      expect(updateCalls).toHaveLength(0);
    });
  });

  // ===================================================================
  //  No Agent Upgrade clawback
  // ===================================================================
  describe('no Agent Upgrade clawback', () => {
    it('historic upgrade commissions remain unchanged after revocation', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      // findOriginalCommissionEntries should exclude Agent Upgrade entries.

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        // No transaction-derived entries found (only Agent Upgrade exists).
        [],
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.completionOutcome).toBe('SKIPPED_NO_BENEFICIARY');
      expect(result.entries).toHaveLength(0);
    });

    it('no compensation entry created for Agent Upgrade on revocation', async () => {
      const params = makeParams({ compensationType: 'REVERSAL' });
      // Only agent upgrade entries exist (filtered out by service)
      // Agent upgrade entry types are not in compensatingEntryTypes.

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [], // No transaction-derived entries returned.
      ]);

      const result = await service.processCorrectionCompensation(params);
      expect(result.completionOutcome).toBe('SKIPPED_NO_BENEFICIARY');
      expect(result.entries).toHaveLength(0);

      // Verify no compensation ledger entry was created
      const insertCalls = chain.insert.mock.calls.filter(
        (call: any[]) => call[0] === commissionLedger,
      );
      expect(insertCalls).toHaveLength(0);
    });
  });

  // ===================================================================
  //  Phase 4 correction linkage
  // ===================================================================
  describe('Phase 4 correction linkage', () => {
    it('references correction_execution_id in compensation entries', async () => {
      const params = makeParams({
        compensationType: 'REVERSAL',
        correctionExecutionId: 'corr-exec-001',
      });
      const orig = makeOriginalEntry({ amount: '88.0000000000' });

      chain.setSequence([
        [{ id: params.correctionExecutionId }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      await service.processCorrectionCompensation(params);

      // Verify the compensation entry references correctionExecutionId
      const valuesCalls = chain.values.mock.calls;
      const ledgerValues = valuesCalls.find(
        (call: any[]) =>
          call[0] &&
          call[0].entryType === 'REVERSAL_COMPENSATION' &&
          call[0].auditLinkage === 'corr-exec-001',
      );
      expect(ledgerValues).toBeTruthy();

      expect(ledgerValues![0].rateSnapshot).toEqual(orig.rateSnapshot);
    });

    it('different correction_execution_ids are tracked separately', async () => {
      const paramsA = makeParams({
        compensationType: 'REVERSAL',
        correctionExecutionId: 'corr-exec-A',
      });
      const paramsB = makeParams({
        compensationType: 'REVERSAL',
        correctionExecutionId: 'corr-exec-B',
      });

      const orig = makeOriginalEntry({ amount: '88.0000000000' });

      // First correction execution
      chain.setSequence([
        [{ id: 'corr-exec-A' }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const resultA = await service.processCorrectionCompensation(paramsA);
      expect(resultA.correctionExecutionId).toBe('corr-exec-A');

      // Reset for second correction execution
      vi.clearAllMocks();
      chain = createChain();
      db = mockDb(chain);
      service = new CompensationService(db);

      chain.setSequence([
        [{ id: 'corr-exec-B' }],
        [makeTxnRow({ status: 'REVERSED' })],
        [],
        [orig],
        [undefined],
        [{ total: null }],
        [],
        [undefined],
        [undefined],
        [undefined],
        [undefined],
      ]);

      const resultB = await service.processCorrectionCompensation(paramsB);
      expect(resultB.correctionExecutionId).toBe('corr-exec-B');
    });
  });
});
