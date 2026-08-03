import { describe, expect, it } from 'vitest';
import {
  canonicalPermissionCatalog,
  canonicalPermissionCodes,
} from '@ipoint/database';
import { adminStepUpStartSchema } from './auth.dto.js';
import { normalizeActionClass } from './auth.constants.js';

describe('step-up action-class normalization (P7-S2C-STEPUP-FIX)', () => {
  describe('normalizeActionClass', () => {
    it('keeps canonical lowercase permission codes unchanged', () => {
      expect(normalizeActionClass('admin.user.manage')).toBe(
        'admin.user.manage',
      );
      expect(normalizeActionClass('member.kyc.evidence.view')).toBe(
        'member.kyc.evidence.view',
      );
    });

    it('normalizes legacy UPPER_CASE and mixed-case action classes to lowercase', () => {
      // Pure case-fold: the canonical catalog code for the MFA-reset purpose
      // is `admin.mfa.reset`; the legacy `ADMIN_MFA_RESET` underscore form
      // folds to `admin_mfa_reset`, which matches no catalog consumer and
      // therefore fails closed.
      expect(normalizeActionClass('ADMIN_MFA_RESET')).toBe('admin_mfa_reset');
      expect(normalizeActionClass('ADMIN.MFA.RESET')).toBe('admin.mfa.reset');
      expect(normalizeActionClass('MEMBER.KYC.EVIDENCE.VIEW')).toBe(
        'member.kyc.evidence.view',
      );
    });

    it('normalizes mixed-case and whitespace-padded values', () => {
      expect(normalizeActionClass('  Admin.User.Manage  ')).toBe(
        'admin.user.manage',
      );
      expect(normalizeActionClass('Rbac.Role.Assign')).toBe('rbac.role.assign');
    });

    it('is idempotent', () => {
      expect(
        normalizeActionClass(normalizeActionClass('ADMIN.USER.MANAGE')),
      ).toBe('admin.user.manage');
    });
  });

  describe('case consistency across every high-risk (step-up) permission', () => {
    it('stores and looks up every step-up-required catalog code in the same canonical case', () => {
      const stepUpCodes = canonicalPermissionCatalog
        .filter((entry) => entry.stepUpRequired)
        .map((entry) => entry.code);
      expect(stepUpCodes.length).toBeGreaterThan(0);
      // Grant creation and RbacGuard lookup both normalize through
      // `normalizeActionClass`, so a canonical catalog code must already be
      // the fixed point of that function — otherwise creation and
      // consumption could still diverge.
      for (const code of stepUpCodes) {
        expect(normalizeActionClass(code)).toBe(code);
        expect(code).toBe(code.toLowerCase());
      }
      // Every step-up code is part of the canonical catalog.
      for (const code of stepUpCodes) {
        expect(canonicalPermissionCodes).toContain(code);
      }
    });
  });

  describe('adminStepUpStartSchema wire contract', () => {
    it('accepts canonical lowercase permission codes', () => {
      const parsed = adminStepUpStartSchema.parse({
        action_class: 'member.kyc.evidence.view',
        market_id: '11111111-1111-4111-8111-111111111111',
        target: 'acct_target',
      });
      expect(parsed.action_class).toBe('member.kyc.evidence.view');
    });

    it('accepts every high-risk catalog code through the schema', () => {
      const stepUpCodes = canonicalPermissionCatalog
        .filter((entry) => entry.stepUpRequired)
        .map((entry) => entry.code);
      for (const code of stepUpCodes) {
        expect(
          adminStepUpStartSchema.parse({ action_class: code }).action_class,
        ).toBe(code);
      }
    });

    it('normalizes legacy UPPER_CASE action classes to canonical form', () => {
      // The wire contract is the canonical (lowercase) catalog code; legacy
      // UPPER_CASE forms using the same separators fold to it. The legacy
      // underscore purpose code (`ADMIN_MFA_RESET`) folds to
      // `admin_mfa_reset`, which is deliberately not a catalog code.
      expect(
        adminStepUpStartSchema.parse({ action_class: 'ADMIN.MFA.RESET' })
          .action_class,
      ).toBe('admin.mfa.reset');
      expect(
        adminStepUpStartSchema.parse({
          action_class: 'MEMBER.KYC.EVIDENCE.VIEW',
        }).action_class,
      ).toBe('member.kyc.evidence.view');
      expect(
        adminStepUpStartSchema.parse({ action_class: 'ADMIN_MFA_RESET' })
          .action_class,
      ).toBe('admin_mfa_reset');
    });

    it('rejects action classes that are not permission-code shaped (fail closed)', () => {
      for (const invalid of [
        'admin user.manage',
        'admin.user.manage!',
        'admin.user.manage/extra',
        'a',
        'ab',
        '',
        '  ',
      ]) {
        expect(() =>
          adminStepUpStartSchema.parse({ action_class: invalid }),
        ).toThrow();
      }
    });

    it('rejects a non-string action_class', () => {
      expect(() =>
        adminStepUpStartSchema.parse({ action_class: 42 as unknown as string }),
      ).toThrow();
    });
  });
});
