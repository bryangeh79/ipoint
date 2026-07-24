import type { TransactionExecutionOptions } from '../database/database.service.js';

/**
 * Centralized write-boundary limits for the transaction engine.
 *
 * PostgreSQL applies both values with SET LOCAL, so pooled connections are not
 * mutated after COMMIT/ROLLBACK. Retries are limited to SQLSTATE 40001 and
 * 40P01 by DatabaseService; validation, authorization, balance, and other
 * business failures are never retried.
 */
export const TRANSACTION_EXECUTION_OPTIONS = {
  statementTimeoutMs: 10_000,
  lockTimeoutMs: 3_000,
  maxRetries: 2,
} as const satisfies TransactionExecutionOptions;
