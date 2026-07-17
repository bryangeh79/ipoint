import { describe, expect, it } from 'vitest';
import {
  canExecuteAdjustment,
  filterMerchants,
  kycDiff,
} from './admin-model.js';

const rows = [
  {
    id: 'MY-1',
    name: 'Northstar',
    market: 'MY',
    application: 'APPROVED',
    kyc: 'SUBMITTED',
    status: 'PENDING_KYC',
  },
  {
    id: 'VN-2',
    name: 'Lotus',
    market: 'VN',
    application: 'APPROVED',
    kyc: 'APPROVED',
    status: 'ACTIVE',
  },
];

describe('admin merchant presentation', () => {
  it('filters by text and status', () => {
    expect(filterMerchants(rows, 'lotus', 'ACTIVE')).toEqual([rows[1]]);
    expect(filterMerchants(rows, '', 'PENDING_KYC')).toEqual([rows[0]]);
  });

  it('requires approved maker/checker separation before execution', () => {
    expect(
      canExecuteAdjustment({
        status: 'APPROVED',
        makerId: 'maker',
        checkerId: 'checker',
        currentActorId: 'checker',
      }),
    ).toBe(true);
    expect(
      canExecuteAdjustment({
        status: 'APPROVED',
        makerId: 'maker',
        checkerId: 'maker',
        currentActorId: 'maker',
      }),
    ).toBe(false);
  });

  it('marks changed KYC fields for side-by-side review', () => {
    expect(kycDiff({ address: 'B' }, { address: 'A' })[0]).toMatchObject({
      changed: true,
      previous: 'A',
      current: 'B',
    });
  });
});
