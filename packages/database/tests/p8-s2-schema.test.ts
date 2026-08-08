import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  reconciliationExceptionStatus,
  reconciliationExceptions,
  reconciliationIdempotencyKeys,
  reconciliationItemStatus,
  reconciliationKind,
  reconciliationRunItems,
  reconciliationRuns,
  reconciliationRunStatus,
} from '../schema/index.js';
import { expectedSchema } from '../src/expected-schema.js';

describe('P8-S2 Advanced Financial Reconciliation schema', () => {
  it('freezes the six reconciliation kinds and lifecycle enums', () => {
    expect(reconciliationKind.enumValues).toEqual([
      'MCP',
      'IPOINT',
      'TRANSACTION_LEDGER',
      'COMMISSION',
      'REFUND',
      'REDEMPTION',
    ]);
    expect(reconciliationRunStatus.enumValues).toEqual([
      'PENDING',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]);
    expect(reconciliationExceptionStatus.enumValues).toEqual([
      'OPEN',
      'ACKNOWLEDGED',
      'RESOLVED',
      'CLOSED',
    ]);
    expect(reconciliationItemStatus.enumValues).toEqual([
      'MATCHED',
      'MISMATCHED',
      'MISSING',
      'UNEXPECTED',
    ]);
  });

  it('freezes market-scoped run, item and exception tables', () => {
    expect(expectedSchema.reconciliation_runs).toEqual(
      expect.arrayContaining([
        'public_id',
        'market_id',
        'kind',
        'status',
        'window_start_at',
        'window_end_at',
        'expected_total',
        'actual_total',
        'difference_total',
        'run_by_admin_user_id',
        'version',
        'archived_at',
      ]),
    );
    expect(expectedSchema.reconciliation_run_items).toEqual(
      expect.arrayContaining([
        'run_id',
        'market_id',
        'reference_type',
        'reference_id',
        'status',
        'expected_amount',
        'actual_amount',
        'difference_amount',
        'evidence',
      ]),
    );
    expect(expectedSchema.reconciliation_exceptions).toEqual(
      expect.arrayContaining([
        'run_id',
        'market_id',
        'kind',
        'expected_amount',
        'actual_amount',
        'difference_amount',
        'classification',
        'status',
        'investigation_notes',
        'acknowledged_by_admin_user_id',
        'resolved_by_admin_user_id',
        'closed_by_admin_user_id',
        'version',
        'archived_at',
      ]),
    );
    expect(expectedSchema.reconciliation_idempotency_keys).toEqual(
      expect.arrayContaining([
        'admin_user_id',
        'market_id',
        'operation',
        'key',
        'request_hash',
        'response',
        'status_code',
      ]),
    );
  });

  it('enforces market consistency, lifecycle timestamps, soft delete and immutability', () => {
    expect(
      getTableConfig(reconciliationRuns).uniqueConstraints.map(
        (item) => item.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'reconciliation_runs_public_id_unique',
        'reconciliation_runs_id_market_unique',
      ]),
    );
    expect(
      getTableConfig(reconciliationRuns).checks.map((item) => item.name),
    ).toEqual(
      expect.arrayContaining([
        'reconciliation_runs_window_check',
        'reconciliation_runs_version_check',
        'reconciliation_runs_totals_check',
        'reconciliation_runs_timestamps_check',
        'reconciliation_runs_archive_check',
      ]),
    );
    expect(
      getTableConfig(reconciliationRunItems).foreignKeys.map((item) =>
        item.getName(),
      ),
    ).toEqual(
      expect.arrayContaining(['reconciliation_run_items_run_market_fk']),
    );
    expect(
      getTableConfig(reconciliationRunItems).uniqueConstraints.map(
        (item) => item.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'reconciliation_run_items_reference_unique',
        'reconciliation_run_items_id_market_unique',
      ]),
    );
    expect(
      getTableConfig(reconciliationExceptions).checks.map((item) => item.name),
    ).toEqual(
      expect.arrayContaining([
        'reconciliation_exceptions_timestamps_check',
        'reconciliation_exceptions_version_check',
        'reconciliation_exceptions_notes_check',
        'reconciliation_exceptions_archive_check',
      ]),
    );
    expect(
      getTableConfig(reconciliationIdempotencyKeys).uniqueConstraints.map(
        (item) => item.name,
      ),
    ).toContain('reconciliation_idempotency_scope_unique');
  });
});
