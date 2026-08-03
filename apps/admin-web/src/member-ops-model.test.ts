import { ApiError } from '@ipoint/api-client';
import { describe, expect, it } from 'vitest';
import {
  isTerminalMemberStatus,
  memberOpsActions,
  memberOpsErrorCopy,
  memberStatusLabel,
  memberStatusTone,
  reverificationCapability,
} from './member-ops-model.js';
import { memberOpsProfileFixture } from './test/member-ops-fixtures.js';
import type { AdminMemberOpsProfileDto } from '@ipoint/api-client';

const FULL_PERMISSIONS = [
  'member.read',
  'member.status.manage',
  'member.session.revoke',
  'member.reverification.require',
  'member.note.create',
  'member.note.read',
];

const DESKTOP_ENV = { online: true, desktop: true, standalone: false };
const PWA_ENV = { online: true, desktop: true, standalone: true };
const OFFLINE_ENV = { online: false, desktop: true, standalone: false };

describe('member status labels and tones', () => {
  it('labels every canonical status', () => {
    expect(memberStatusLabel('ACTIVE')).toBe('Active');
    expect(memberStatusLabel('SUSPENDED')).toBe('Suspended');
    expect(memberStatusLabel('CLOSED')).toBe('Closed');
    expect(memberStatusLabel('PENDING_EMAIL_VERIFICATION')).toBe(
      'Pending email verification',
    );
  });

  it('maps tones with error for closed', () => {
    expect(memberStatusTone('ACTIVE')).toBe('success');
    expect(memberStatusTone('SUSPENDED')).toBe('warning');
    expect(memberStatusTone('CLOSED')).toBe('error');
    expect(memberStatusTone('PENDING_EMAIL_VERIFICATION')).toBe('neutral');
  });

  it('treats CLOSED as terminal and nothing else', () => {
    expect(isTerminalMemberStatus('CLOSED')).toBe(true);
    expect(isTerminalMemberStatus('SUSPENDED')).toBe(false);
    expect(isTerminalMemberStatus('ACTIVE')).toBe(false);
  });
});

describe('memberOpsActions availability', () => {
  it('enables suspend, close, revoke, reverification for an ACTIVE member with full permissions', () => {
    const profile = memberOpsProfileFixture();
    const states = memberOpsActions(profile, FULL_PERMISSIONS, DESKTOP_ENV);
    const byId = Object.fromEntries(states.map((state) => [state.id, state]));
    expect(byId.suspend?.available).toBe(true);
    expect(byId.close?.available).toBe(true);
    expect(byId['revoke-sessions']?.available).toBe(true);
    expect(byId['require-reverification']?.available).toBe(true);
    // Reactivate requires SUSPENDED status.
    expect(byId.reactivate?.available).toBe(false);
    expect(byId.reactivate?.unavailableReason).toMatch(/member status ACTIVE/);
  });

  it('enables reactivate for a SUSPENDED member and disables suspend/close for CLOSED', () => {
    const suspended = memberOpsProfileFixture({ status: 'SUSPENDED' });
    const suspendedStates = Object.fromEntries(
      memberOpsActions(suspended, FULL_PERMISSIONS, DESKTOP_ENV).map(
        (state) => [state.id, state],
      ),
    );
    expect(suspendedStates.reactivate?.available).toBe(true);
    expect(suspendedStates.suspend?.available).toBe(false);

    const closed = memberOpsProfileFixture({ status: 'CLOSED' });
    const closedStates = Object.fromEntries(
      memberOpsActions(closed, FULL_PERMISSIONS, DESKTOP_ENV).map((state) => [
        state.id,
        state,
      ]),
    );
    expect(closedStates.suspend?.available).toBe(false);
    expect(closedStates.close?.available).toBe(false);
    expect(closedStates.reactivate?.available).toBe(false);
  });

  it('denies actions without the server permission (UI affordance only)', () => {
    const profile = memberOpsProfileFixture();
    const states = memberOpsActions(profile, ['member.read'], DESKTOP_ENV);
    const byId = Object.fromEntries(states.map((state) => [state.id, state]));
    for (const id of [
      'suspend',
      'close',
      'revoke-sessions',
      'require-reverification',
    ] as const) {
      expect(byId[id]?.available).toBe(false);
      expect(byId[id]?.unavailableReason).toMatch(/server permission/);
    }
  });

  it('blocks privileged writes in the read-only PWA and offline environments', () => {
    const profile = memberOpsProfileFixture();
    const pwaStates = memberOpsActions(profile, FULL_PERMISSIONS, PWA_ENV);
    expect(pwaStates.find((state) => state.id === 'suspend')?.available).toBe(
      false,
    );
    const offlineStates = memberOpsActions(
      profile,
      FULL_PERMISSIONS,
      OFFLINE_ENV,
    );
    expect(
      offlineStates.find((state) => state.id === 'suspend')?.available,
    ).toBe(false);
  });
});

describe('reverificationCapability', () => {
  it('requires an approved KYC case', () => {
    expect(reverificationCapability(memberOpsProfileFixture()).available).toBe(
      true,
    );
    const noKyc = memberOpsProfileFixture({ kyc: null });
    expect(reverificationCapability(noKyc).available).toBe(false);
    expect(reverificationCapability(noKyc).reason).toMatch(/No KYC case/);

    const pending = memberOpsProfileFixture({
      kyc: {
        ...(memberOpsProfileFixture().kyc as NonNullable<
          AdminMemberOpsProfileDto['kyc']
        >),
        status: 'SUBMITTED',
      },
    });
    expect(reverificationCapability(pending).available).toBe(false);
    expect(reverificationCapability(pending).reason).toMatch(/SUBMITTED/);
  });
});

describe('memberOpsErrorCopy', () => {
  function apiError(status: number, code: string) {
    return new ApiError(status, { code, message: code });
  }

  it('classifies permission, conflict, and not-found codes', () => {
    expect(memberOpsErrorCopy(apiError(403, 'PERMISSION_DENIED')).title).toBe(
      'Permission denied',
    );
    expect(
      memberOpsErrorCopy(apiError(409, 'MARKET_CONTEXT_MISMATCH')).title,
    ).toBe('Member is outside the selected market');
    expect(
      memberOpsErrorCopy(apiError(409, 'ADMIN_MEMBER_INVALID_STATUS')).title,
    ).toBe('Member status conflict');
    expect(
      memberOpsErrorCopy(apiError(404, 'ADMIN_MEMBER_NOT_FOUND')).title,
    ).toBe('Member not found');
  });

  it('falls back to a stable generic copy for unknown errors', () => {
    expect(memberOpsErrorCopy(new Error('boom')).title).toBe(
      'Member operations unavailable',
    );
  });
});
