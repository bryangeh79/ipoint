import { describe, expect, it } from 'vitest';
import {
  auditActorLabel,
  auditReasonValid,
  auditResultLabel,
  describeAuditReadError,
  formatAuditUtc,
} from './audit-model.js';
import { ApiError } from '@ipoint/api-client';

describe('P7-S9 audit model', () => {
  it('labels actor types and results without inventing values', () => {
    expect(auditActorLabel('ADMIN_USER')).toBe('Admin');
    expect(auditActorLabel('ACCOUNT')).toBe('Account');
    expect(auditActorLabel('SYSTEM')).toBe('System');
    expect(auditActorLabel('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
    expect(auditResultLabel('SUCCESS')).toBe('Success');
    expect(auditResultLabel('DENIED')).toBe('Denied');
    expect(auditResultLabel('MAYBE')).toBe('MAYBE');
  });

  it('formats ISO timestamps and leaves invalid values untouched', () => {
    expect(formatAuditUtc('2026-08-07T12:00:00.000Z')).not.toBe(
      '2026-08-07T12:00:00.000Z',
    );
    expect(formatAuditUtc('not-a-date')).toBe('not-a-date');
  });

  it('validates the recorded reason length (8–500 chars)', () => {
    expect(auditReasonValid('short')).toBe(false);
    expect(auditReasonValid('  ')).toBe(false);
    expect(auditReasonValid('eight char')).toBe(true);
    expect(auditReasonValid('x'.repeat(501))).toBe(false);
    expect(auditReasonValid('x'.repeat(500))).toBe(true);
  });

  it('maps canonical guard errors to the permission-denied state copy', () => {
    const denied = describeAuditReadError(
      new ApiError(403, { code: 'PERMISSION_DENIED' }),
    );
    expect(denied.kind).toBe('permission-denied');
    const conflict = describeAuditReadError(
      new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }),
    );
    expect(conflict.kind).toBe('conflict');
    const generic = describeAuditReadError(new Error('boom'));
    expect(generic.kind).toBe('error');
  });
});
