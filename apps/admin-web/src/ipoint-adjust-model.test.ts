import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  canCreateIpointAdjustment,
  canDecideIpointAdjustment,
  canExecuteIpointAdjustment,
  describeIpointAdjustmentReadError,
  describeIpointAdjustmentWriteError,
  formatIpointAmount,
  formatIpointUtc,
  ipointAdjustmentAboveSoftCap,
  ipointAdjustmentAmountValid,
  ipointAdjustmentExecutionBlocked,
  ipointAdjustmentStateLabel,
  isOwnRequest,
  orderIpointAdjustments,
} from './ipoint-adjust-model.js';

/**
 * P7-S7B iPoint adjustment presentation model tests. Formatting-only
 * helpers: exact-decimal strings are never parsed; status/caps/blocked
 * derivations are UI affordances only (the frozen SEC-01 owner is the
 * enforcement authority).
 */

describe('P7-S7B ipoint-adjust model', () => {
  it('labels lifecycle states with stable copy', () => {
    expect(ipointAdjustmentStateLabel('DRAFT')).toBe('Draft');
    expect(ipointAdjustmentStateLabel('SUBMITTED')).toBe('Submitted');
    expect(ipointAdjustmentStateLabel('APPROVED')).toBe('Approved');
    expect(ipointAdjustmentStateLabel('REJECTED')).toBe('Rejected');
    expect(ipointAdjustmentStateLabel('EXECUTING')).toBe('Executing');
    expect(ipointAdjustmentStateLabel('EXECUTED')).toBe('Executed');
    expect(ipointAdjustmentStateLabel('FAILED')).toBe('Failed');
    expect(ipointAdjustmentStateLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('compares amounts against the soft cap with exact decimals (never floats)', () => {
    expect(ipointAdjustmentAboveSoftCap('10000', '10000')).toBe(false);
    expect(ipointAdjustmentAboveSoftCap('10000.0000000001', '10000')).toBe(
      true,
    );
    expect(ipointAdjustmentAboveSoftCap('50000', '10000')).toBe(true);
    expect(ipointAdjustmentAboveSoftCap('9999.9999999999', '10000')).toBe(
      false,
    );
    expect(ipointAdjustmentAboveSoftCap('5000', undefined)).toBe(false);
  });

  it('flags the above-soft execution block only when evidence is disabled', () => {
    expect(
      ipointAdjustmentExecutionBlocked({
        state: 'APPROVED',
        amount: '50000',
        softCap: '10000',
        secureEvidenceAvailable: false,
      }),
    ).toBe(true);
    // Same amount with evidence enabled -> not blocked (server authority).
    expect(
      ipointAdjustmentExecutionBlocked({
        state: 'APPROVED',
        amount: '50000',
        softCap: '10000',
        secureEvidenceAvailable: true,
      }),
    ).toBe(false);
    // At/below soft cap -> never blocked by the evidence gate.
    expect(
      ipointAdjustmentExecutionBlocked({
        state: 'APPROVED',
        amount: '5000',
        softCap: '10000',
        secureEvidenceAvailable: false,
      }),
    ).toBe(false);
    // Non-APPROVED states are not execution-blocked.
    expect(
      ipointAdjustmentExecutionBlocked({
        state: 'SUBMITTED',
        amount: '50000',
        softCap: '10000',
        secureEvidenceAvailable: false,
      }),
    ).toBe(false);
  });

  it('applies the double gate (permission + sensitive-write environment)', () => {
    expect(
      canCreateIpointAdjustment(['wallet.ipoint.adjust.maker'], true),
    ).toBe(true);
    expect(
      canCreateIpointAdjustment(['wallet.ipoint.adjust.maker'], false),
    ).toBe(false);
    expect(canCreateIpointAdjustment(['dashboard.view'], true)).toBe(false);

    expect(
      canDecideIpointAdjustment(['wallet.ipoint.adjust.checker'], true),
    ).toBe(true);
    expect(
      canDecideIpointAdjustment(['wallet.ipoint.adjust.checker'], false),
    ).toBe(false);

    expect(
      canExecuteIpointAdjustment(['wallet.ipoint.adjust.execute'], true),
    ).toBe(true);
    expect(
      canExecuteIpointAdjustment(['wallet.ipoint.adjust.execute'], false),
    ).toBe(false);
  });

  it('flags the maker own request (Maker≠Checker UI affordance)', () => {
    const request = { makerAdminUserId: 'admin-1' };
    expect(isOwnRequest(request, 'admin-1')).toBe(true);
    expect(isOwnRequest(request, 'admin-2')).toBe(false);
    expect(isOwnRequest(request, undefined)).toBe(false);
  });

  it('keeps amounts as exact strings and renders stable UTC', () => {
    expect(formatIpointAmount('5000.0000000000')).toBe('5000.0000000000');
    expect(formatIpointAmount('0.0000000001')).toBe('0.0000000001');
    expect(formatIpointUtc('2026-08-06T00:00:00.000Z')).toBe(
      '2026-08-06T00:00:00.000Z',
    );
    expect(formatIpointUtc('not-a-date')).toBe('not-a-date');
  });

  it('validates the amount grammar (UI affordance only)', () => {
    expect(ipointAdjustmentAmountValid('5000')).toBe(true);
    expect(ipointAdjustmentAmountValid('5000.0000000001')).toBe(true);
    expect(ipointAdjustmentAmountValid('0.0000000001')).toBe(true);
    expect(ipointAdjustmentAmountValid('0')).toBe(false);
    expect(ipointAdjustmentAmountValid('0.0')).toBe(false);
    expect(ipointAdjustmentAmountValid('1.12345678901')).toBe(false);
    expect(ipointAdjustmentAmountValid('-5')).toBe(false);
    expect(ipointAdjustmentAmountValid('abc')).toBe(false);
  });

  it('orders the queue newest-first', () => {
    const items = [
      { id: 'a', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-08-03T00:00:00.000Z' },
      { id: 'c', createdAt: '2026-08-02T00:00:00.000Z' },
    ];
    expect(orderIpointAdjustments(items).map((item) => item.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('maps read errors to stable copy', () => {
    const denied = new ApiError(403, {
      code: 'WALLET_ADJUSTMENT_PERMISSION_DENIED',
      message: 'denied',
    });
    expect(describeIpointAdjustmentReadError(denied).title).toBe(
      'Permission denied',
    );
    expect(describeIpointAdjustmentReadError(new Error('boom')).title).toBe(
      'iPoint adjustment queue unavailable',
    );
  });

  it('maps write errors to stable copy', () => {
    const conflict = new ApiError(403, {
      code: 'WALLET_ADJUSTMENT_MAKER_CHECKER_CONFLICT',
      message: 'conflict',
    });
    expect(describeIpointAdjustmentWriteError(conflict)).toContain(
      'different administrator',
    );
    const evidence = new ApiError(422, {
      code: 'WALLET_ADJUSTMENT_EVIDENCE_STORAGE_UNAVAILABLE',
      message: 'evidence',
    });
    expect(describeIpointAdjustmentWriteError(evidence)).toContain(
      'secure evidence storage',
    );
    expect(describeIpointAdjustmentWriteError(new Error('boom'))).toContain(
      'could not be completed',
    );
  });
});
