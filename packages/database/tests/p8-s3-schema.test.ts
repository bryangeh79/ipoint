import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  riskDetectionRuns,
  riskEventSeverity,
  riskEventStatus,
  riskEvents,
  riskIdempotencyKeys,
  riskIndicatorCategory,
  riskIndicatorDefinitions,
  riskReviewDecision,
  riskReviewQueue,
  riskReviewStatus,
  riskRunStatus,
} from '../schema/index.js';
import { expectedSchema } from '../src/expected-schema.js';

describe('P8-S3 Risk / Fraud / Operational Controls schema', () => {
  it('freezes the eight indicator categories and lifecycle enums', () => {
    expect(riskIndicatorCategory.enumValues).toEqual([
      'SUSPICIOUS_TRANSACTION',
      'DUPLICATE_REPLAY',
      'ABNORMAL_ADJUSTMENT',
      'RATE_CONFIG_ANOMALY',
      'CROSS_MARKET_VIOLATION',
      'ACCOUNT_ADMIN_ABUSE',
      'SECURITY_EVENT',
      'REVIEW_QUEUE',
    ]);
    expect(riskEventSeverity.enumValues).toEqual([
      'LOW',
      'MEDIUM',
      'HIGH',
      'CRITICAL',
    ]);
    expect(riskRunStatus.enumValues).toEqual([
      'PENDING',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]);
    expect(riskEventStatus.enumValues).toEqual(['FLAGGED']);
    expect(riskReviewStatus.enumValues).toEqual([
      'OPEN',
      'IN_REVIEW',
      'RESOLVED',
    ]);
    expect(riskReviewDecision.enumValues).toEqual([
      'NO_ACTION',
      'WATCH',
      'ESCALATED',
    ]);
  });

  it('freezes market-scoped definition, run, event, queue and idempotency tables', () => {
    expect(expectedSchema.risk_indicator_definitions).toEqual(
      expect.arrayContaining([
        'code',
        'market_id',
        'category',
        'name',
        'enabled',
        'config',
        'severity',
        'version',
        'superseded_by_id',
        'superseded_at',
        'created_by_admin_user_id',
        'archived_at',
      ]),
    );
    expect(expectedSchema.risk_detection_runs).toEqual(
      expect.arrayContaining([
        'public_id',
        'market_id',
        'category',
        'status',
        'window_start_at',
        'window_end_at',
        'definitions_scanned',
        'events_detected',
        'summary',
        'failure_reason',
        'run_by_admin_user_id',
        'version',
        'archived_at',
      ]),
    );
    expect(expectedSchema.risk_events).toEqual(
      expect.arrayContaining([
        'run_id',
        'market_id',
        'indicator_id',
        'indicator_code',
        'indicator_version',
        'category',
        'severity',
        'entity_type',
        'entity_id',
        'entity_market_id',
        'payload',
        'detection_metadata',
        'status',
      ]),
    );
    expect(expectedSchema.risk_review_queue).toEqual(
      expect.arrayContaining([
        'event_id',
        'market_id',
        'status',
        'assigned_admin_user_id',
        'decision',
        'decision_reason',
        'notes',
        'resolved_by_admin_user_id',
        'resolved_at',
        'version',
        'archived_at',
      ]),
    );
    expect(expectedSchema.risk_idempotency_keys).toEqual(
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

  it('enforces lifecycle timestamps, versioning, immutability and market consistency', () => {
    expect(
      getTableConfig(riskIndicatorDefinitions).uniqueConstraints.map(
        (item) => item.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'risk_indicator_definitions_id_market_unique',
        'risk_indicator_definitions_code_version_unique',
      ]),
    );
    expect(
      getTableConfig(riskIndicatorDefinitions).checks.map((item) => item.name),
    ).toEqual(
      expect.arrayContaining([
        'risk_indicator_definitions_version_check',
        'risk_indicator_definitions_supersede_consistency',
        'risk_indicator_definitions_config_check',
        'risk_indicator_definitions_archive_check',
      ]),
    );
    expect(
      getTableConfig(riskDetectionRuns).checks.map((item) => item.name),
    ).toEqual(
      expect.arrayContaining([
        'risk_detection_runs_window_check',
        'risk_detection_runs_version_check',
        'risk_detection_runs_totals_check',
        'risk_detection_runs_timestamps_check',
        'risk_detection_runs_failure_reason_check',
        'risk_detection_runs_archive_check',
      ]),
    );
    expect(
      getTableConfig(riskEvents).foreignKeys.map((item) => item.getName()),
    ).toEqual(
      expect.arrayContaining([
        'risk_events_run_market_fk',
        'risk_events_indicator_market_fk',
      ]),
    );
    expect(
      getTableConfig(riskEvents).uniqueConstraints.map((item) => item.name),
    ).toEqual(
      expect.arrayContaining([
        'risk_events_id_market_unique',
        'risk_events_run_reference_unique',
      ]),
    );
    expect(getTableConfig(riskEvents).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'risk_events_status_check',
        'risk_events_payload_check',
        'risk_events_metadata_check',
      ]),
    );
    expect(
      getTableConfig(riskReviewQueue).checks.map((item) => item.name),
    ).toEqual(
      expect.arrayContaining([
        'risk_review_queue_version_check',
        'risk_review_queue_decision_consistency',
        'risk_review_queue_notes_check',
        'risk_review_queue_timestamps_check',
        'risk_review_queue_archive_check',
      ]),
    );
    expect(
      getTableConfig(riskReviewQueue).foreignKeys.map((item) => item.getName()),
    ).toContain('risk_review_queue_event_market_fk');
    expect(
      getTableConfig(riskIdempotencyKeys).uniqueConstraints.map(
        (item) => item.name,
      ),
    ).toContain('risk_idempotency_scope_unique');
  });
});
