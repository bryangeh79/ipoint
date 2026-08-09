import { describe, expect, it } from 'vitest';
import {
  assignQueueSchema,
  createDefinitionSchema,
  createRunSchema,
  decideQueueSchema,
  listEventsQuerySchema,
  queueNotesSchema,
} from './admin-risk-controls.dto.js';
import {
  assertReviewTransition,
  configNumber,
  detectorConfigured,
  requiredDecimal,
  requiredPositiveInt,
  resolveSeverity,
} from './admin-risk-controls.service.js';
import { RiskError } from './admin-risk-controls.types.js';

describe('P8-S3 severity mapping', () => {
  it('accepts canonical severities and defaults to MEDIUM otherwise', () => {
    expect(resolveSeverity('HIGH')).toBe('HIGH');
    expect(resolveSeverity('CRITICAL')).toBe('CRITICAL');
    expect(resolveSeverity('LOW')).toBe('LOW');
    expect(resolveSeverity(undefined)).toBe('MEDIUM');
    expect(resolveSeverity('EXTREME')).toBe('MEDIUM');
    expect(resolveSeverity(42)).toBe('MEDIUM');
  });
});

describe('P8-S3 review queue state machine', () => {
  it('allows only OPEN -> IN_REVIEW for assign', () => {
    expect(() => assertReviewTransition('assign', 'OPEN')).not.toThrow();
    expect(() => assertReviewTransition('assign', 'IN_REVIEW')).toThrow(
      RiskError,
    );
    expect(() => assertReviewTransition('assign', 'RESOLVED')).toThrow(
      RiskError,
    );
  });

  it('allows decide and resolve only in IN_REVIEW', () => {
    expect(() => assertReviewTransition('decide', 'IN_REVIEW')).not.toThrow();
    expect(() => assertReviewTransition('decide', 'OPEN')).toThrow(RiskError);
    expect(() => assertReviewTransition('resolve', 'IN_REVIEW')).not.toThrow();
    expect(() => assertReviewTransition('resolve', 'OPEN')).toThrow(RiskError);
    expect(() => assertReviewTransition('resolve', 'RESOLVED')).toThrow(
      RiskError,
    );
  });

  it('allows notes in OPEN and IN_REVIEW but never after RESOLVED', () => {
    expect(() => assertReviewTransition('notes', 'OPEN')).not.toThrow();
    expect(() => assertReviewTransition('notes', 'IN_REVIEW')).not.toThrow();
    expect(() => assertReviewTransition('notes', 'RESOLVED')).toThrow(
      RiskError,
    );
  });
});

describe('P8-S3 detector configuration', () => {
  it('skips threshold detectors whose required operator config is absent', () => {
    expect(detectorConfigured('suspicious_amount_breach', {})).toBe(false);
    expect(
      detectorConfigured('suspicious_amount_breach', {
        max_single_amount: '50000.0000000000',
      }),
    ).toBe(true);
    expect(detectorConfigured('duplicate_confirmed_transaction', {})).toBe(
      false,
    );
    expect(
      detectorConfigured('duplicate_confirmed_transaction', {
        duplicate_window_minutes: 30,
      }),
    ).toBe(true);
    expect(
      detectorConfigured('adjustment_execution_velocity', {
        window_minutes: 1440,
      }),
    ).toBe(false);
    expect(
      detectorConfigured('adjustment_execution_velocity', {
        window_minutes: 1440,
        max_adjustment_count: 5,
      }),
    ).toBe(true);
    expect(
      detectorConfigured('admin_action_velocity', {
        window_minutes: 60,
        max_actions: 100,
      }),
    ).toBe(true);
    expect(
      detectorConfigured('security_event_failure_burst', {
        window_minutes: 15,
        max_failures: 5,
      }),
    ).toBe(true);
    expect(detectorConfigured('review_queue_aging', { max_open_days: 7 })).toBe(
      true,
    );
  });

  it('always runs structural detectors without any invented threshold', () => {
    expect(detectorConfigured('rate_period_overlap', {})).toBe(true);
    expect(detectorConfigured('cross_market_wallet_entry', {})).toBe(true);
  });

  it('ignores unknown detector codes', () => {
    expect(detectorConfigured('operator.invented.code', {})).toBe(false);
  });

  it('rejects zero/negative/non-integer operator thresholds', () => {
    expect(
      requiredPositiveInt({ window_minutes: 0 }, 'window_minutes'),
    ).toBeUndefined();
    expect(
      requiredPositiveInt({ window_minutes: -5 }, 'window_minutes'),
    ).toBeUndefined();
    expect(
      requiredPositiveInt({ window_minutes: 2.5 }, 'window_minutes'),
    ).toBeUndefined();
    expect(
      requiredPositiveInt({ window_minutes: '30' }, 'window_minutes'),
    ).toBe(30);
    expect(configNumber({ count: 4 }, 'count')).toBe(4);
  });

  it('keeps decimal thresholds exact strings for SQL comparison (no floats)', () => {
    expect(requiredDecimal({ amount: '50000.0000000000' }, 'amount')).toBe(
      '50000.0000000000',
    );
    expect(requiredDecimal({ amount: '0.01' }, 'amount')).toBe('0.01');
    expect(requiredDecimal({ amount: 5 }, 'amount')).toBe('5');
    expect(requiredDecimal({ amount: 5.5 }, 'amount')).toBeUndefined();
    expect(
      requiredDecimal({ amount: 'not-a-number' }, 'amount'),
    ).toBeUndefined();
    expect(requiredDecimal({}, 'amount')).toBeUndefined();
  });
});

describe('P8-S3 DTO validation', () => {
  it('validates definition creation with operator config', () => {
    const base = {
      code: 'suspicious_amount_breach',
      category: 'SUSPICIOUS_TRANSACTION',
      name: 'Amount breach',
      config: { max_single_amount: '50000.0000000000' },
      reason: 'Monthly control.',
    };
    expect(createDefinitionSchema.parse(base)).toBeTruthy();
    expect(
      createDefinitionSchema.parse({ ...base, severity: 'HIGH' }),
    ).toMatchObject({
      severity: 'HIGH',
    });
    expect(
      createDefinitionSchema.safeParse({ ...base, code: 'Bad Code!' }).success,
    ).toBe(false);
    expect(
      createDefinitionSchema.safeParse({ ...base, category: 'UNKNOWN' })
        .success,
    ).toBe(false);
    expect(
      createDefinitionSchema.safeParse({ ...base, name: '   ' }).success,
    ).toBe(false);
    expect(
      createDefinitionSchema.safeParse({ ...base, config: [1, 2] }).success,
    ).toBe(false);
  });

  it('validates run windows and review actions', () => {
    expect(
      createRunSchema.parse({
        category: 'SECURITY_EVENT',
        windowStart: '2026-01-01T00:00:00.000Z',
        windowEnd: '2026-02-01T00:00:00.000Z',
        reason: 'Scan.',
      }),
    ).toBeTruthy();
    expect(
      createRunSchema.safeParse({
        category: 'SECURITY_EVENT',
        windowStart: '2026-02-01T00:00:00.000Z',
        windowEnd: '2026-01-01T00:00:00.000Z',
        reason: 'Backwards.',
      }).success,
    ).toBe(false);
    expect(
      decideQueueSchema.parse({
        expectedVersion: 1,
        decision: 'WATCH',
        decisionReason: 'Monitor for 30 days.',
        reason: 'Review decision.',
      }),
    ).toBeTruthy();
    expect(
      decideQueueSchema.safeParse({
        expectedVersion: 1,
        decision: 'FREEZE_ACCOUNT',
        decisionReason: 'x',
        reason: 'y',
      }).success,
    ).toBe(false);
    expect(
      assignQueueSchema.parse({ expectedVersion: 1, reason: 'Claim.' }),
    ).toBeTruthy();
    expect(
      queueNotesSchema.safeParse({
        expectedVersion: 1,
        notes: 'x'.repeat(20_001),
        reason: 'Too long.',
      }).success,
    ).toBe(false);
  });

  it('validates event listing filters', () => {
    expect(
      listEventsQuerySchema.parse({ category: 'SECURITY_EVENT', limit: 10 }),
    ).toMatchObject({ category: 'SECURITY_EVENT', limit: 10 });
    expect(
      listEventsQuerySchema.safeParse({ severity: 'GIGANTIC' }).success,
    ).toBe(false);
  });
});
