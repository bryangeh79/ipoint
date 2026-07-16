import { randomUUID } from 'node:crypto';

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import {
  DrizzlePocProvider,
  DRIZZLE_POC_PROVIDER,
} from '../drizzle/nest-provider.js';
import {
  PrismaPocProvider,
  PRISMA_POC_PROVIDER,
} from '../prisma/nest-provider.js';
import type { OrmHarness, QueryResultRow } from './harness.js';
import { errorText, hasSqlState, quote } from './harness.js';
import type { ExperimentalOrmProvider } from './nest-provider.js';

const MARKET_ID = '00000000-0000-4000-8000-000000000001';
const WALLET_ID = '00000000-0000-4000-8000-000000000002';
const MAKER_ID = '10000000-0000-4000-8000-000000000001';
const CHECKER_A_ID = '20000000-0000-4000-8000-000000000001';
const CHECKER_B_ID = '20000000-0000-4000-8000-000000000002';

export interface CaseResult {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
}

export interface OrmExperimentResult {
  orm: OrmHarness['name'];
  transactions: CaseResult[];
  idempotency: CaseResult[];
  makerChecker: CaseResult[];
  ledger: CaseResult[];
}

interface WalletRow extends QueryResultRow {
  balance: string;
  version: number;
}

interface CountRow extends QueryResultRow {
  count: bigint | string;
}

const countValue = (row: CountRow | undefined): number =>
  Number(row?.count ?? 0);

const expect: (condition: boolean, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const idSuffix = (): string => randomUUID().replaceAll('-', '');

export const resetDomainData = async (harness: OrmHarness): Promise<void> => {
  await harness.execute(
    'TRUNCATE TABLE audit_events, adjustment_actions, adjustment_requests, ledger_entries, idempotency_records RESTART IDENTITY CASCADE',
  );
  await harness.execute(
    `UPDATE wallets SET balance = 0, version = 0, updated_at = now() WHERE id = '${WALLET_ID}'`,
  );
  await harness.execute(`DELETE FROM wallets WHERE id <> '${WALLET_ID}'`);
};

const isRetryable = (error: unknown): boolean => {
  const code = (error as { code?: string }).code;
  return (
    code === 'P2034' ||
    hasSqlState(error, '40001') ||
    hasSqlState(error, '40P01')
  );
};

const creditWithRetry = async (
  harness: OrmHarness,
  key: string,
  amount: string,
  maxAttempts: number,
): Promise<{ attempts: number; conflicts: number }> => {
  let conflicts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await harness.transaction(async (transaction) => {
        await transaction.query(
          `SELECT balance FROM wallets WHERE id = '${WALLET_ID}'`,
        );
        await transaction.query('SELECT 1 AS waited FROM pg_sleep(0.015)');
        const updated = await transaction.query<WalletRow>(
          `UPDATE wallets SET balance = balance + ${amount}::numeric, version = version + 1, updated_at = now() WHERE id = '${WALLET_ID}' RETURNING balance, version`,
        );
        const balanceAfter = updated[0]?.balance;
        expect(
          balanceAfter !== undefined,
          'wallet update did not return a row',
        );
        const sourceId = randomUUID();
        await transaction.execute(
          `INSERT INTO ledger_entries (public_id, wallet_id, direction, amount, entry_type, source_type, source_id, idempotency_key, balance_after, effective_at) VALUES (${quote(`led_${idSuffix()}`)}, '${WALLET_ID}', 'CREDIT', ${amount}::numeric, 'CONCURRENT_CREDIT', 'POC', '${sourceId}', ${quote(key)}, ${balanceAfter}::numeric, now())`,
        );
      }, 'Serializable');
      return { attempts: attempt, conflicts };
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) throw error;
      conflicts += 1;
      await new Promise((resolve) =>
        setTimeout(resolve, attempt * 12 + Math.floor(Math.random() * 12)),
      );
    }
  }
  throw new Error('bounded retry loop exhausted unexpectedly');
};

const runDeadlockProbe = async (
  harness: OrmHarness,
): Promise<{
  rejected: number;
  retryableErrors: number;
  messages: string[];
}> => {
  const secondWalletId = '00000000-0000-4000-8000-000000000099';
  await harness.execute(
    `INSERT INTO wallets (id, public_id, market_id, owner_type, owner_id, currency, balance, version, updated_at) VALUES ('${secondWalletId}', 'wal_poc_deadlock', '${MARKET_ID}', 'MEMBER', '00000000-0000-4000-8000-000000000099', 'MYR', 0, 0, now()) ON CONFLICT (id) DO NOTHING`,
  );

  const lockInOrder = async (first: string, second: string): Promise<void> => {
    await harness.transaction(async (transaction) => {
      await transaction.query(
        `SELECT id FROM wallets WHERE id = '${first}' FOR UPDATE`,
      );
      await transaction.query('SELECT 1 AS waited FROM pg_sleep(0.15)');
      await transaction.query(
        `SELECT id FROM wallets WHERE id = '${second}' FOR UPDATE`,
      );
    });
  };

  const settled = await Promise.allSettled([
    lockInOrder(WALLET_ID, secondWalletId),
    lockInOrder(secondWalletId, WALLET_ID),
  ]);
  const errors = settled
    .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
    .map((item) => item.reason as unknown);
  return {
    rejected: errors.length,
    retryableErrors: errors.filter(isRetryable).length,
    messages: errors.map(errorText),
  };
};

const transactionExperiments = async (
  harness: OrmHarness,
): Promise<CaseResult[]> => {
  await resetDomainData(harness);
  const results: CaseResult[] = [];

  const rollbackKey = `rollback-${idSuffix()}`;
  try {
    await harness.transaction(async (transaction) => {
      await transaction.execute(
        `INSERT INTO idempotency_records (public_id, scope, key, request_hash) VALUES (${quote(`idem_${idSuffix()}`)}, 'ROLLBACK', ${quote(rollbackKey)}, '${'a'.repeat(64)}')`,
      );
      throw new Error('intentional rollback');
    });
  } catch (error) {
    expect(
      error instanceof Error && error.message === 'intentional rollback',
      'unexpected rollback error',
    );
  }
  const rollbackRows = await harness.query<CountRow>(
    `SELECT count(*) AS count FROM idempotency_records WHERE key = ${quote(rollbackKey)}`,
  );
  results.push({
    name: 'rollback',
    passed: countValue(rollbackRows[0]) === 0,
    details: { persistedRows: countValue(rollbackRows[0]) },
  });

  const nested = await harness.nestedSavepointProbe();
  results.push({
    name: 'nested-savepoint',
    passed: nested.outerPersisted && !nested.innerPersisted,
    details: nested,
  });

  const failureKey = `failure-${idSuffix()}`;
  try {
    await harness.transaction(async (transaction) => {
      const updated = await transaction.query<WalletRow>(
        `UPDATE wallets SET balance = balance + 5, version = version + 1 WHERE id = '${WALLET_ID}' RETURNING balance, version`,
      );
      await transaction.execute(
        `INSERT INTO ledger_entries (public_id, wallet_id, direction, amount, entry_type, source_type, source_id, idempotency_key, balance_after, effective_at) VALUES (${quote(`led_${idSuffix()}`)}, '${WALLET_ID}', 'CREDIT', 5, 'FAILURE_INJECTION', 'POC', '${randomUUID()}', ${quote(failureKey)}, ${updated[0]?.balance ?? '5'}, now())`,
      );
      throw new Error('injected after wallet and ledger writes');
    });
  } catch (error) {
    expect(
      error instanceof Error &&
        error.message === 'injected after wallet and ledger writes',
      'unexpected failure injection error',
    );
  }
  const afterFailure = await harness.query<WalletRow>(
    `SELECT balance, version FROM wallets WHERE id = '${WALLET_ID}'`,
  );
  const failedLedger = await harness.query<CountRow>(
    `SELECT count(*) AS count FROM ledger_entries WHERE idempotency_key = ${quote(failureKey)}`,
  );
  results.push({
    name: 'wallet-ledger-atomicity-failure-injection',
    passed:
      Number(afterFailure[0]?.balance) === 0 &&
      countValue(failedLedger[0]) === 0,
    details: {
      balance: afterFailure[0]?.balance,
      ledgerRows: countValue(failedLedger[0]),
    },
  });

  const concurrentCount = 10;
  const retryBound = 20;
  const retryRuns = await Promise.all(
    Array.from({ length: concurrentCount }, (_, index) =>
      creditWithRetry(
        harness,
        `concurrent-${index}-${idSuffix()}`,
        '1.00000000',
        retryBound,
      ),
    ),
  );
  const concurrentWallet = await harness.query<WalletRow>(
    `SELECT balance, version FROM wallets WHERE id = '${WALLET_ID}'`,
  );
  const concurrentLedger = await harness.query<CountRow>(
    "SELECT count(*) AS count FROM ledger_entries WHERE entry_type = 'CONCURRENT_CREDIT'",
  );
  const totalAttempts = retryRuns.reduce((sum, run) => sum + run.attempts, 0);
  const totalConflicts = retryRuns.reduce((sum, run) => sum + run.conflicts, 0);
  results.push({
    name: 'concurrent-updates-bounded-retry',
    passed:
      Number(concurrentWallet[0]?.balance) === concurrentCount &&
      countValue(concurrentLedger[0]) === concurrentCount &&
      retryRuns.every((run) => run.attempts <= retryBound),
    details: {
      operations: concurrentCount,
      balance: concurrentWallet[0]?.balance,
      ledgerRows: countValue(concurrentLedger[0]),
      totalAttempts,
      serializationConflicts: totalConflicts,
      maxAttemptsObserved: Math.max(...retryRuns.map((run) => run.attempts)),
      retryBound,
    },
  });

  const deadlock = await runDeadlockProbe(harness);
  results.push({
    name: 'deadlock-detection',
    passed: deadlock.rejected === 1 && deadlock.retryableErrors === 1,
    details: deadlock,
  });

  return results;
};

interface IdempotencyResponse {
  entryId: string;
  balance: string;
}

interface IdempotencyRow extends QueryResultRow {
  request_hash: string;
  status: string;
  response_body: IdempotencyResponse | null;
}

const creditExactlyOnce = async (
  harness: OrmHarness,
  key: string,
  requestHash: string,
  amount: string,
): Promise<IdempotencyResponse> =>
  harness.transaction(async (transaction) => {
    const inserted = await transaction.query<{ id: string }>(
      `INSERT INTO idempotency_records (public_id, scope, key, request_hash, status, locked_until) VALUES (${quote(`idem_${idSuffix()}`)}, 'LEDGER_CREDIT', ${quote(key)}, ${quote(requestHash)}, 'PROCESSING', now() + interval '30 seconds') ON CONFLICT (scope, key) DO NOTHING RETURNING id`,
    );
    if (inserted.length === 0) {
      const existing = await transaction.query<IdempotencyRow>(
        `SELECT request_hash, status, response_body FROM idempotency_records WHERE scope = 'LEDGER_CREDIT' AND key = ${quote(key)}`,
      );
      const record = existing[0];
      expect(record !== undefined, 'idempotency conflict row disappeared');
      if (record.request_hash !== requestHash) {
        throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
      }
      expect(
        record.status === 'COMPLETED' && record.response_body !== null,
        'idempotency result not completed',
      );
      return record.response_body;
    }

    const updated = await transaction.query<WalletRow>(
      `UPDATE wallets SET balance = balance + ${amount}::numeric, version = version + 1, updated_at = now() WHERE id = '${WALLET_ID}' RETURNING balance, version`,
    );
    const balanceAfter = updated[0]?.balance;
    expect(balanceAfter !== undefined, 'wallet update failed');
    const balanceText = String(balanceAfter);
    const entry = await transaction.query<{ id: string }>(
      `INSERT INTO ledger_entries (public_id, wallet_id, direction, amount, entry_type, source_type, source_id, idempotency_key, balance_after, effective_at) VALUES (${quote(`led_${idSuffix()}`)}, '${WALLET_ID}', 'CREDIT', ${amount}::numeric, 'IDEMPOTENT_CREDIT', 'IDEMPOTENCY', '${randomUUID()}', ${quote(key)}, ${balanceText}::numeric, now()) RETURNING id`,
    );
    const entryId = entry[0]?.id;
    expect(entryId !== undefined, 'ledger insert failed');
    await transaction.execute(
      `UPDATE idempotency_records SET status = 'COMPLETED', response_code = 200, response_body = jsonb_build_object('entryId', '${entryId}', 'balance', '${balanceText}'), completed_at = now(), locked_until = NULL WHERE scope = 'LEDGER_CREDIT' AND key = ${quote(key)}`,
    );
    return { entryId, balance: balanceText };
  });

const idempotencyExperiments = async (
  harness: OrmHarness,
): Promise<CaseResult[]> => {
  await resetDomainData(harness);
  const results: CaseResult[] = [];
  const hash = 'b'.repeat(64);

  const sameKey = `same-${idSuffix()}`;
  const first = await creditExactlyOnce(harness, sameKey, hash, '7.50000000');
  const second = await creditExactlyOnce(harness, sameKey, hash, '7.50000000');
  results.push({
    name: 'same-key-repeat-consistent-result',
    passed:
      first.entryId === second.entryId && first.balance === second.balance,
    details: { first, second },
  });

  const concurrentKey = `concurrent-idem-${idSuffix()}`;
  const concurrent = await Promise.all(
    Array.from({ length: 16 }, () =>
      creditExactlyOnce(harness, concurrentKey, hash, '2.25000000'),
    ),
  );
  const uniqueEntryIds = new Set(concurrent.map((result) => result.entryId));
  const concurrentLedger = await harness.query<CountRow>(
    `SELECT count(*) AS count FROM ledger_entries WHERE idempotency_key = ${quote(concurrentKey)}`,
  );
  const wallet = await harness.query<WalletRow>(
    `SELECT balance, version FROM wallets WHERE id = '${WALLET_ID}'`,
  );
  results.push({
    name: 'concurrent-repeat-exactly-once',
    passed:
      uniqueEntryIds.size === 1 &&
      countValue(concurrentLedger[0]) === 1 &&
      Number(wallet[0]?.balance) === 9.75,
    details: {
      callers: concurrent.length,
      uniqueResults: uniqueEntryIds.size,
      duplicateLedgerRows: countValue(concurrentLedger[0]) - 1,
      balance: wallet[0]?.balance,
    },
  });

  let mismatchRejected = false;
  try {
    await creditExactlyOnce(harness, sameKey, 'c'.repeat(64), '7.50000000');
  } catch (error) {
    mismatchRejected =
      error instanceof Error &&
      error.message === 'IDEMPOTENCY_PAYLOAD_MISMATCH';
  }
  results.push({
    name: 'same-key-different-payload-rejected',
    passed: mismatchRejected,
    details: { mismatchRejected },
  });

  return results;
};

interface AdjustmentRow extends QueryResultRow {
  id: string;
  maker_id: string;
  status: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: string;
  wallet_id: string;
  market_id: string;
  idempotency_key: string;
}

const createAdjustment = async (
  harness: OrmHarness,
  makerId: string,
  key: string,
): Promise<string> => {
  const row = await harness.query<{ id: string }>(
    `INSERT INTO adjustment_requests (public_id, market_id, wallet_id, maker_id, direction, amount, reason, idempotency_key, updated_at) VALUES (${quote(`adj_${idSuffix()}`)}, '${MARKET_ID}', '${WALLET_ID}', '${makerId}', 'CREDIT', 25.00000000, 'PoC governed adjustment', ${quote(key)}, now()) RETURNING id`,
  );
  const id = row[0]?.id;
  expect(id !== undefined, 'adjustment insert failed');
  return id;
};

const approveAndExecute = async (
  harness: OrmHarness,
  requestId: string,
  checkerId: string,
): Promise<{ executed: boolean; entryId?: string }> =>
  harness.transaction(async (transaction) => {
    const rows = await transaction.query<AdjustmentRow>(
      `SELECT id, maker_id, status, direction, amount, wallet_id, market_id, idempotency_key FROM adjustment_requests WHERE id = '${requestId}' FOR UPDATE`,
    );
    const request = rows[0];
    expect(request !== undefined, 'adjustment not found');
    if (request.maker_id === checkerId) throw new Error('MAKER_CANNOT_CHECK');
    if (request.status !== 'PENDING') return { executed: false };

    await transaction.execute(
      `UPDATE adjustment_requests SET status = 'APPROVED', checker_id = '${checkerId}', updated_at = now() WHERE id = '${requestId}'`,
    );
    await transaction.execute(
      `INSERT INTO adjustment_actions (public_id, request_id, actor_id, action, reason) VALUES (${quote(`act_${idSuffix()}`)}, '${requestId}', '${checkerId}', 'APPROVE', 'PoC approval')`,
    );
    await transaction.execute(
      `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, reason, request_id) VALUES (${quote(`aud_${idSuffix()}`)}, '${MARKET_ID}', '${checkerId}', 'ADJUSTMENT_APPROVED', 'adjustment_request', '${requestId}', 'PoC approval', ${quote(`req_${idSuffix()}`)})`,
    );

    const wallet = await transaction.query<WalletRow>(
      `UPDATE wallets SET balance = balance + ${request.amount}::numeric, version = version + 1, updated_at = now() WHERE id = '${request.wallet_id}' RETURNING balance, version`,
    );
    const balanceAfter = wallet[0]?.balance;
    expect(balanceAfter !== undefined, 'adjustment wallet update failed');
    const ledger = await transaction.query<{ id: string }>(
      `INSERT INTO ledger_entries (public_id, wallet_id, direction, amount, entry_type, source_type, source_id, idempotency_key, balance_after, effective_at) VALUES (${quote(`led_${idSuffix()}`)}, '${request.wallet_id}', '${request.direction}', ${request.amount}::numeric, 'MANUAL_ADJUSTMENT', 'ADJUSTMENT_REQUEST', '${requestId}', ${quote(request.idempotency_key)}, ${balanceAfter}::numeric, now()) RETURNING id`,
    );
    const entryId = ledger[0]?.id;
    expect(entryId !== undefined, 'adjustment ledger insert failed');
    await transaction.execute(
      `UPDATE adjustment_requests SET status = 'EXECUTED', executed_entry_id = '${entryId}', updated_at = now() WHERE id = '${requestId}'`,
    );
    await transaction.execute(
      `INSERT INTO adjustment_actions (public_id, request_id, actor_id, action, reason) VALUES (${quote(`act_${idSuffix()}`)}, '${requestId}', '${checkerId}', 'EXECUTE', 'PoC exactly-once execution')`,
    );
    await transaction.execute(
      `INSERT INTO audit_events (public_id, market_id, actor_id, action, entity_type, entity_id, reason, request_id, after) VALUES (${quote(`aud_${idSuffix()}`)}, '${MARKET_ID}', '${checkerId}', 'ADJUSTMENT_EXECUTED', 'adjustment_request', '${requestId}', 'PoC exactly-once execution', ${quote(`req_${idSuffix()}`)}, jsonb_build_object('ledgerEntryId', '${entryId}', 'balanceAfter', '${balanceAfter}'))`,
    );
    return { executed: true, entryId };
  });

const makerCheckerExperiments = async (
  harness: OrmHarness,
): Promise<CaseResult[]> => {
  await resetDomainData(harness);
  const results: CaseResult[] = [];

  const selfRequestId = await createAdjustment(
    harness,
    MAKER_ID,
    `adjust-self-${idSuffix()}`,
  );
  let selfRejected = false;
  try {
    await approveAndExecute(harness, selfRequestId, MAKER_ID);
  } catch (error) {
    selfRejected =
      error instanceof Error && error.message === 'MAKER_CANNOT_CHECK';
  }
  const selfState = await harness.query<{
    status: string;
    checker_id: string | null;
  }>(
    `SELECT status, checker_id FROM adjustment_requests WHERE id = '${selfRequestId}'`,
  );
  results.push({
    name: 'no-self-approval',
    passed:
      selfRejected &&
      selfState[0]?.status === 'PENDING' &&
      selfState[0]?.checker_id === null,
    details: { selfRejected, state: selfState[0] },
  });

  const requestId = await createAdjustment(
    harness,
    MAKER_ID,
    `adjust-concurrent-${idSuffix()}`,
  );
  const settled = await Promise.allSettled([
    approveAndExecute(harness, requestId, CHECKER_A_ID),
    approveAndExecute(harness, requestId, CHECKER_B_ID),
  ]);
  const values = settled
    .filter(
      (
        item,
      ): item is PromiseFulfilledResult<{
        executed: boolean;
        entryId?: string;
      }> => item.status === 'fulfilled',
    )
    .map((item) => item.value);
  const executedCount = values.filter((value) => value.executed).length;
  const repeated = await approveAndExecute(harness, requestId, CHECKER_A_ID);
  const requestState = await harness.query<{
    status: string;
    checker_id: string;
    executed_entry_id: string;
  }>(
    `SELECT status, checker_id, executed_entry_id FROM adjustment_requests WHERE id = '${requestId}'`,
  );
  const actionCount = await harness.query<CountRow>(
    `SELECT count(*) AS count FROM adjustment_actions WHERE request_id = '${requestId}'`,
  );
  const auditCount = await harness.query<CountRow>(
    `SELECT count(*) AS count FROM audit_events WHERE entity_id = '${requestId}'`,
  );
  const ledgerCount = await harness.query<CountRow>(
    `SELECT count(*) AS count FROM ledger_entries WHERE source_id = '${requestId}' AND entry_type = 'MANUAL_ADJUSTMENT'`,
  );
  results.push({
    name: 'concurrent-checkers-exactly-once-state-audit',
    passed:
      executedCount === 1 &&
      !repeated.executed &&
      requestState[0]?.status === 'EXECUTED' &&
      countValue(actionCount[0]) === 2 &&
      countValue(auditCount[0]) === 2 &&
      countValue(ledgerCount[0]) === 1,
    details: {
      concurrentOutcomes: values,
      executedCount,
      repeatExecuted: repeated.executed,
      finalState: requestState[0],
      actionRows: countValue(actionCount[0]),
      auditRows: countValue(auditCount[0]),
      ledgerRows: countValue(ledgerCount[0]),
      transitions: ['PENDING', 'APPROVED', 'EXECUTED'],
    },
  });

  return results;
};

const ledgerExperiments = async (
  harness: OrmHarness,
): Promise<CaseResult[]> => {
  const results: CaseResult[] = [];
  const original = await harness.query<{
    id: string;
    wallet_id: string;
    balance_after: string;
  }>(
    "SELECT id, wallet_id, balance_after FROM ledger_entries WHERE entry_type = 'MANUAL_ADJUSTMENT' LIMIT 1",
  );
  const originalEntry = original[0];
  expect(originalEntry !== undefined, 'maker/checker ledger entry is required');

  let updateBlocked = false;
  let deleteBlocked = false;
  try {
    await harness.execute(
      `UPDATE ledger_entries SET amount = 1 WHERE id = '${originalEntry.id}'`,
    );
  } catch (error) {
    updateBlocked = hasSqlState(error, '55000');
  }
  try {
    await harness.execute(
      `DELETE FROM ledger_entries WHERE id = '${originalEntry.id}'`,
    );
  } catch (error) {
    deleteBlocked = hasSqlState(error, '55000');
  }
  results.push({
    name: 'append-only-update-delete-blocked',
    passed: updateBlocked && deleteBlocked,
    details: { updateBlocked, deleteBlocked, sqlState: '55000' },
  });

  const compensationId = randomUUID();
  await harness.transaction(async (transaction) => {
    const wallet = await transaction.query<WalletRow>(
      `UPDATE wallets SET balance = balance - 5.00000000, version = version + 1, updated_at = now() WHERE id = '${WALLET_ID}' RETURNING balance, version`,
    );
    const balanceAfter = wallet[0]?.balance;
    expect(balanceAfter !== undefined, 'compensating wallet update failed');
    await transaction.execute(
      `INSERT INTO ledger_entries (id, public_id, wallet_id, direction, amount, entry_type, source_type, source_id, idempotency_key, balance_after, effective_at, reversal_of_entry_id) VALUES ('${compensationId}', ${quote(`led_${idSuffix()}`)}, '${WALLET_ID}', 'DEBIT', 5.00000000, 'REVERSAL', 'LEDGER_ENTRY', '${originalEntry.id}', ${quote(`reverse-${originalEntry.id}`)}, ${balanceAfter}::numeric, now(), '${originalEntry.id}')`,
    );
  });
  const totals = await harness.query<{
    wallet_balance: string;
    ledger_total: string;
  }>(
    `SELECT w.balance::text AS wallet_balance, COALESCE(sum(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE -l.amount END), 0)::text AS ledger_total FROM wallets w LEFT JOIN ledger_entries l ON l.wallet_id = w.id WHERE w.id = '${WALLET_ID}' GROUP BY w.balance`,
  );
  const originalStillExists = await harness.query<CountRow>(
    `SELECT count(*) AS count FROM ledger_entries WHERE id = '${originalEntry.id}'`,
  );
  results.push({
    name: 'compensating-entry-wallet-consistency',
    passed:
      totals[0]?.wallet_balance === totals[0]?.ledger_total &&
      countValue(originalStillExists[0]) === 1,
    details: {
      originalEntryId: originalEntry.id,
      compensationEntryId: compensationId,
      originalPreserved: countValue(originalStillExists[0]) === 1,
      walletBalance: totals[0]?.wallet_balance,
      signedLedgerTotal: totals[0]?.ledger_total,
    },
  });

  return results;
};

export const runOrmExperiments = async (
  harness: OrmHarness,
): Promise<OrmExperimentResult> => {
  const transactions = await transactionExperiments(harness);
  const idempotency = await idempotencyExperiments(harness);
  const makerChecker = await makerCheckerExperiments(harness);
  const ledger = await ledgerExperiments(harness);
  const all = [...transactions, ...idempotency, ...makerChecker, ...ledger];
  const failed = all.filter((result) => !result.passed);
  expect(
    failed.length === 0,
    `${harness.name} failed cases: ${JSON.stringify(failed)}`,
  );
  return { orm: harness.name, transactions, idempotency, makerChecker, ledger };
};

const closeModule = async (
  module: TestingModule | undefined,
): Promise<void> => {
  if (module !== undefined) await module.close();
};

export const runNestIntegrationProbe = async (
  orm: OrmHarness['name'],
  connectionString: string,
  verificationHarness: OrmHarness,
): Promise<CaseResult> => {
  const provider: ExperimentalOrmProvider =
    orm === 'prisma'
      ? new PrismaPocProvider(connectionString)
      : new DrizzlePocProvider(connectionString);
  const token = orm === 'prisma' ? PRISMA_POC_PROVIDER : DRIZZLE_POC_PROVIDER;
  let module: TestingModule | undefined;
  let transactionPropagated = false;
  let isolationRollback = false;
  const probeKey = `nest-${orm}-${idSuffix()}`;
  try {
    module = await Test.createTestingModule({
      providers: [
        { provide: token, useValue: provider },
        {
          provide: 'POC_CONSUMER',
          inject: [token],
          useFactory: (injected: ExperimentalOrmProvider) => ({
            transactionVisible: () =>
              injected.currentTransaction() !== undefined,
          }),
        },
      ],
    }).compile();
    await module.init();
    const injected = module.get<ExperimentalOrmProvider>(token);
    const consumer = module.get<{ transactionVisible: () => boolean }>(
      'POC_CONSUMER',
    );
    try {
      await injected.runInTransaction(async () => {
        transactionPropagated = consumer.transactionVisible();
        const transaction = injected.currentTransaction();
        expect(transaction !== undefined, 'transaction context missing');
        await transaction.execute(
          `INSERT INTO idempotency_records (public_id, scope, key, request_hash) VALUES (${quote(`idem_${idSuffix()}`)}, 'NEST_ISOLATION', ${quote(probeKey)}, '${'d'.repeat(64)}')`,
        );
        throw new Error('nest test isolation rollback');
      });
    } catch (error) {
      expect(
        error instanceof Error &&
          error.message === 'nest test isolation rollback',
        'unexpected Nest isolation error',
      );
    }
    const rows = await verificationHarness.query<CountRow>(
      `SELECT count(*) AS count FROM idempotency_records WHERE key = ${quote(probeKey)}`,
    );
    isolationRollback = countValue(rows[0]) === 0;
  } finally {
    await closeModule(module);
  }
  const poolAfterClose = provider.harness.pool.totalCount;
  return {
    name: 'nestjs-provider-lifecycle-di-transaction-isolation-cleanup',
    passed: transactionPropagated && isolationRollback && poolAfterClose === 0,
    details: {
      startup: true,
      shutdown: true,
      dependencyInjection: true,
      transactionPropagated,
      testIsolationRollback: isolationRollback,
      poolConnectionsAfterClose: poolAfterClose,
    },
  };
};

export const schemaSignature = async (
  harness: OrmHarness,
): Promise<QueryResultRow[]> =>
  harness.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('markets','wallets','ledger_entries','adjustment_requests','adjustment_actions','audit_events','versioned_rules','idempotency_records') ORDER BY table_name, ordinal_position`,
  );

export const constraintSignature = async (
  harness: OrmHarness,
): Promise<QueryResultRow[]> =>
  harness.query(
    `SELECT c.conrelid::regclass::text AS table_name, c.contype::text AS contype, regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g') AS definition FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conrelid::regclass::text IN ('markets','wallets','ledger_entries','adjustment_requests','adjustment_actions','audit_events','versioned_rules','idempotency_records') ORDER BY table_name, c.contype, definition`,
  );
