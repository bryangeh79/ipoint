import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  evidenceGate,
  evidenceReasonValid,
  kycErrorCopy,
  kycStatusLabel,
  memberKycActions,
  merchantKycActions,
  merchantKycStatusLabel,
} from './kyc-model.js';
import { memberKycDetailFixture } from './test/kyc-fixtures.js';

const WRITE_ENV = { online: true, desktop: true, standalone: false };
const PWA_ENV = { online: true, desktop: false, standalone: true };

describe('P7-S5C kyc-model', () => {
  it('labels and tones every member KYC status', () => {
    expect(kycStatusLabel('SUBMITTED')).toBe('Submitted');
    expect(kycStatusLabel('UNDER_REVIEW')).toBe('Under review');
    expect(kycStatusLabel('MORE_INFO_REQUIRED')).toBe('More info required');
    expect(kycStatusLabel('APPROVED')).toBe('Approved');
    expect(kycStatusLabel('REJECTED')).toBe('Rejected');
    expect(kycStatusLabel('REVERIFICATION_REQUIRED')).toBe(
      'Reverification required',
    );
    expect(merchantKycStatusLabel('RESUBMISSION_REQUIRED')).toBe(
      'Resubmission required',
    );
  });

  it('enables review actions only for the matching status, permission, and write environment', () => {
    const caseDetail = memberKycDetailFixture(); // SUBMITTED
    const actions = memberKycActions(
      caseDetail,
      ['member.kyc.read', 'member.kyc.decide'],
      WRITE_ENV,
    );
    const start = actions.find((action) => action.id === 'start-review');
    const approve = actions.find((action) => action.id === 'approve');
    expect(start?.available).toBe(true);
    expect(approve?.available).toBe(false);
    expect(approve?.unavailableReason).toContain('case status SUBMITTED');
  });

  it('blocks all review actions without member.kyc.decide or in the PWA', () => {
    const caseDetail = memberKycDetailFixture();
    const noPermission = memberKycActions(
      caseDetail,
      ['member.kyc.read'],
      WRITE_ENV,
    );
    expect(noPermission.every((action) => !action.available)).toBe(true);
    expect(noPermission[0]?.unavailableReason).toContain('member.kyc.decide');

    const pwa = memberKycActions(
      caseDetail,
      ['member.kyc.read', 'member.kyc.decide'],
      PWA_ENV,
    );
    expect(pwa.every((action) => !action.available)).toBe(true);
    expect(pwa[0]?.unavailableReason).toContain('not PWA');
  });

  it('gates merchant review decisions by status and permission', () => {
    const reviewer = merchantKycActions(
      'SUBMITTED',
      ['merchant.kyc.view', 'merchant.kyc.approve'],
      WRITE_ENV,
    );
    expect(reviewer.every((action) => action.available)).toBe(true);
    const support = merchantKycActions(
      'SUBMITTED',
      ['merchant.kyc.view'],
      WRITE_ENV,
    );
    expect(support.every((action) => !action.available)).toBe(true);
    const decided = merchantKycActions(
      'APPROVED',
      ['merchant.kyc.view', 'merchant.kyc.approve'],
      WRITE_ENV,
    );
    expect(decided.every((action) => !action.available)).toBe(true);
    expect(decided[0]?.unavailableReason).toContain('APPROVED');
  });

  it('requires the dedicated evidence permission for raw evidence', () => {
    expect(
      evidenceGate(['member.kyc.read'], 'member.kyc.evidence.view').allowed,
    ).toBe(false);
    expect(
      evidenceGate(
        ['member.kyc.read', 'member.kyc.evidence.view'],
        'member.kyc.evidence.view',
      ).allowed,
    ).toBe(true);
    expect(evidenceReasonValid('short')).toBe(false);
    expect(evidenceReasonValid('Identity verification review')).toBe(true);
  });

  it('maps evidence and market errors to stable copy', () => {
    expect(
      kycErrorCopy(
        new ApiError(422, { code: 'SENSITIVE_VIEW_REASON_REQUIRED' }),
      ).title,
    ).toBe('Reason required for evidence');
    expect(
      kycErrorCopy(new ApiError(403, { code: 'MFA_STEP_UP_REQUIRED' })).title,
    ).toBe('Identity verification required');
    expect(
      kycErrorCopy(new ApiError(409, { code: 'MARKET_CONTEXT_MISMATCH' }))
        .title,
    ).toBe('KYC case is outside the selected market');
    expect(kycErrorCopy(new Error('boom')).title).toBe(
      'KYC review unavailable',
    );
  });
});
