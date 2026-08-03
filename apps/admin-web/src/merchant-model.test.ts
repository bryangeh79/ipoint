import { describe, expect, it } from 'vitest';
import { ApiError } from '@ipoint/api-client';
import {
  describeMerchantActionError,
  describeMerchantReadError,
  merchantActionAvailability,
  merchantApplicationStatusLabel,
  merchantOperationalStatusLabel,
  merchantPackageStatusLabel,
} from './merchant-model.js';
import { merchantBranchDetailFixture } from './test/merchant-fixtures.js';

/**
 * P7-S5B merchant presentation model tests: formatting-only helpers and
 * presentation gates (server RbacGuard remains the security boundary).
 */

describe('merchant presentation labels', () => {
  it('labels owner operational statuses', () => {
    expect(merchantOperationalStatusLabel('ACTIVE')).toBe('Active');
    expect(merchantOperationalStatusLabel('SUSPENDED')).toBe('Suspended');
    expect(merchantOperationalStatusLabel('CLOSED')).toBe('Closed');
    expect(merchantOperationalStatusLabel('PENDING_MCP')).toBe('Pending MCP');
    // Unknown statuses pass through unchanged (never invented).
    expect(merchantOperationalStatusLabel('MYSTERY')).toBe('MYSTERY');
  });

  it('labels application and package statuses', () => {
    expect(merchantApplicationStatusLabel('UNDER_REVIEW')).toBe('Under review');
    expect(merchantApplicationStatusLabel('RESUBMISSION_REQUIRED')).toBe(
      'Resubmission required',
    );
    expect(merchantPackageStatusLabel('ACTIVE')).toBe('Active');
  });
});

describe('merchantActionAvailability (presentation gate only)', () => {
  const activeDetail = merchantBranchDetailFixture();

  it('offers suspend for ACTIVE branches with the permission', () => {
    const availability = merchantActionAvailability(activeDetail, [
      'merchant.view',
      'merchant.suspend',
      'merchant.close',
    ]);
    expect(availability.canSuspend).toBe(true);
    expect(availability.canReactivate).toBe(false);
    expect(availability.canClose).toBe(true);
    // Application already APPROVED: no review offered.
    expect(availability.canReviewApplication).toBe(false);
    // KYC already APPROVED: no KYC review offered.
    expect(availability.canReviewKyc).toBe(false);
  });

  it('never offers suspend without the suspend permission', () => {
    const availability = merchantActionAvailability(activeDetail, [
      'merchant.view',
    ]);
    expect(availability.canSuspend).toBe(false);
    expect(availability.canClose).toBe(false);
  });

  it('offers reactivate only for SUSPENDED branches', () => {
    const suspended = {
      ...merchantBranchDetailFixture(),
      application: {
        ...merchantBranchDetailFixture().application,
        operational_status: 'SUSPENDED',
      },
    };
    const availability = merchantActionAvailability(suspended, [
      'merchant.suspend',
    ]);
    expect(availability.canReactivate).toBe(true);
    expect(availability.canSuspend).toBe(false);
  });

  it('offers application review only for SUBMITTED/UNDER_REVIEW applications', () => {
    const pending = {
      ...merchantBranchDetailFixture(),
      application: {
        ...merchantBranchDetailFixture().application,
        status: 'SUBMITTED',
      },
    };
    const availability = merchantActionAvailability(pending, [
      'merchant.approve',
    ]);
    expect(availability.canReviewApplication).toBe(true);
  });

  it('offers KYC review only for SUBMITTED KYC with the permission', () => {
    const pendingKyc = {
      ...merchantBranchDetailFixture(),
      kyc: {
        current: {
          submission_id: 'kyc-2',
          submission_version: 2,
          status: 'SUBMITTED',
          submitted_at: '2026-08-01T00:00:00.000Z',
          data: {},
        },
        previous: null,
      },
    };
    const availability = merchantActionAvailability(pendingKyc, [
      'merchant.kyc.approve',
    ]);
    expect(availability.canReviewKyc).toBe(true);
  });
});

describe('describeMerchantReadError', () => {
  it('maps permission denial to a distinct copy', () => {
    const copy = describeMerchantReadError(
      new ApiError(403, { code: 'PERMISSION_DENIED', message: 'no' }),
    );
    expect(copy.title).toBe('Permission denied');
  });

  it('maps market mismatch to a refresh hint', () => {
    const copy = describeMerchantReadError(
      new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH', message: 'no' }),
    );
    expect(copy.title).toBe('Market context mismatch');
  });

  it('maps missing branch to not found', () => {
    const copy = describeMerchantReadError(
      new ApiError(404, { code: 'MERCHANT_BRANCH_NOT_FOUND', message: 'no' }),
    );
    expect(copy.title).toBe('Merchant branch not found');
  });

  it('falls back to the raw message for unknown codes', () => {
    const copy = describeMerchantReadError(
      new ApiError(400, { code: 'WEIRD', message: 'odd' }),
    );
    expect(copy.description).toContain('odd');
  });
});

describe('describeMerchantActionError', () => {
  it('maps invalid transition to a state-conflict hint', () => {
    const copy = describeMerchantActionError(
      new ApiError(409, { code: 'MERCHANT_INVALID_TRANSITION', message: 'no' }),
      'Suspension',
    );
    expect(copy.title).toBe('State conflict');
    expect(copy.description).toContain('current merchant state');
  });

  it('maps idempotency conflict to a duplicate-request hint', () => {
    const copy = describeMerchantActionError(
      new ApiError(409, { code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'no' }),
      'Application review',
    );
    expect(copy.title).toBe('Duplicate request');
  });
});
