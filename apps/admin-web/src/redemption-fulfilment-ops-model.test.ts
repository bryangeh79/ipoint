import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  describeRedemptionActionError,
  describeRedemptionReadError,
  formatRedemptionUtc,
  fulfilmentQueueLabel,
  refundStatusLabel,
} from './redemption-fulfilment-ops-model.js';

describe('P7-S8 redemption ops model', () => {
  it('labels the six operational queue statuses', () => {
    expect(fulfilmentQueueLabel('READY_FOR_PICKUP')).toBe('Ready for pickup');
    expect(fulfilmentQueueLabel('BACKORDERED')).toBe('Backordered');
    expect(fulfilmentQueueLabel('FULFILMENT_SUSPENDED')).toBe(
      'Fulfilment suspended',
    );
    expect(fulfilmentQueueLabel('FULFILMENT_EXCEPTION')).toBe(
      'Fulfilment exception',
    );
    expect(fulfilmentQueueLabel('REFUND_PENDING')).toBe('Refund pending');
    expect(fulfilmentQueueLabel('REFUNDED')).toBe('Refunded');
    expect(fulfilmentQueueLabel('BOGUS')).toBe('BOGUS');
  });

  it('labels the refund request statuses', () => {
    expect(refundStatusLabel('PENDING_CHECKER')).toBe('Pending checker');
    expect(refundStatusLabel('COMPLETED')).toBe('Completed');
    expect(refundStatusLabel('FAILED')).toBe('Failed');
  });

  it('maps read errors to design-system state copy', () => {
    expect(
      describeRedemptionReadError(
        new ApiError(403, { code: 'PERMISSION_DENIED' }),
      ).kind,
    ).toBe('permission-denied');
    expect(
      describeRedemptionReadError(
        new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }),
      ).kind,
    ).toBe('conflict');
    expect(
      describeRedemptionReadError(
        new ApiError(422, { code: 'REDEMPTION_QUEUE_STATUS_INVALID' }),
      ).title,
    ).toBe('Invalid queue status');
    expect(describeRedemptionReadError(new Error('x')).kind).toBe('error');
  });

  it('maps action errors including the frozen-owner conflict codes', () => {
    expect(
      describeRedemptionActionError(
        new ApiError(400, {
          code: 'REDEMPTION_FULFILMENT_INVALID_TRANSITION',
        }),
      ).kind,
    ).toBe('conflict');
    expect(
      describeRedemptionActionError(
        new ApiError(400, { code: 'REDEMPTION_ORDER_NOT_SUSPENDED' }),
      ).kind,
    ).toBe('conflict');
    expect(
      describeRedemptionActionError(
        new ApiError(400, { code: 'REDEMPTION_REASON_REQUIRED' }),
      ).title,
    ).toBe('Reason required');
    expect(
      describeRedemptionActionError(
        new ApiError(403, { code: 'PERMISSION_DENIED' }),
      ).kind,
    ).toBe('permission-denied');
  });

  it('renders UTC timestamps without re-deriving them', () => {
    expect(formatRedemptionUtc('2026-08-02T00:00:00.000Z')).toBe(
      '2026-08-02T00:00:00.000Z',
    );
    expect(formatRedemptionUtc(null)).toBe('—');
  });
});
