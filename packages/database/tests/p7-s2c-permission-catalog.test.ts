import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalPermissionCatalog,
  canonicalPermissionCodes,
  controlledRoleCodes,
  isCanonicalPermission,
  permissionDefinition,
  roleTemplatePermissions,
} from '../src/permission-catalog.js';
import { foundationPermissions } from '../seeds/foundation.js';

const deprecatedRouteCodes = new Set([
  // NOTE: 'wallet.adjustment.create' was intentionally REMOVED with the
  // insecure immediate iPoint adjustment endpoint (P7 SEC-01 / P7-AC-15):
  // the decorator no longer exists anywhere, which is strictly safer than
  // a deprecated-but-present alias. Guard-level denial of the literal code
  // is still covered by apps/api/src/platform-access/p7-s2c-rbac.guard.spec.ts.
  'commission.adjustment.maker',
  'commission.adjustment.checker',
  'merchant.mcp.recharge.review',
  'merchant.refund.manage',
]);

describe('P7-S2C canonical permission catalog', () => {
  it('contains exactly 67 unique canonical codes and six controlled roles', () => {
    expect(canonicalPermissionCatalog).toHaveLength(67);
    expect(new Set(canonicalPermissionCodes).size).toBe(67);
    expect(controlledRoleCodes).toEqual([
      'SUPER_ADMIN',
      'OPERATIONS_ADMIN',
      'FINANCE_OPERATOR',
      'FINANCE_APPROVER',
      'KYC_REVIEWER',
      'SUPPORT_READONLY_AUDITOR',
    ]);
    expect(foundationPermissions.map(([code]) => code)).toEqual(
      canonicalPermissionCodes,
    );
  });

  it('freezes the six-role matrix including Maker/Checker separation', () => {
    expect(
      Object.fromEntries(
        Object.entries(roleTemplatePermissions).map(([role, codes]) => [
          role,
          codes.length,
        ]),
      ),
    ).toEqual({
      SUPER_ADMIN: 67,
      OPERATIONS_ADMIN: 31,
      FINANCE_OPERATOR: 25,
      FINANCE_APPROVER: 28,
      KYC_REVIEWER: 21,
      SUPPORT_READONLY_AUDITOR: 19,
    });
    expect(roleTemplatePermissions.FINANCE_OPERATOR).toContain(
      'wallet.ipoint.adjust.maker',
    );
    expect(roleTemplatePermissions.FINANCE_OPERATOR).not.toContain(
      'wallet.ipoint.adjust.checker',
    );
    expect(roleTemplatePermissions.FINANCE_APPROVER).toContain(
      'wallet.ipoint.adjust.checker',
    );
    expect(roleTemplatePermissions.FINANCE_APPROVER).not.toContain(
      'wallet.ipoint.adjust.maker',
    );
    expect(roleTemplatePermissions.SUPPORT_READONLY_AUDITOR).not.toContain(
      'member.note.create',
    );
  });

  it('marks every high-risk permission with independent step-up enforcement', () => {
    const stepUpCodes = canonicalPermissionCatalog
      .filter(({ stepUpRequired }) => stepUpRequired)
      .map(({ code }) => code);
    expect(stepUpCodes).toEqual(
      expect.arrayContaining([
        'admin.user.manage',
        'admin.mfa.reset',
        'rbac.role.assign',
        'rbac.permission.assign',
        'rbac.market.grant',
        'market.manage',
        'merchant.special_package.manage',
        'merchant.mcp.adjust.approve',
        'wallet.ipoint.adjust.checker',
        'redemption.refund.approve',
        'redemption.voucher.reveal',
        'audit.sensitive-diff.view',
      ]),
    );
    expect(permissionDefinition('redemption.voucher.reveal')).toMatchObject({
      marketScoped: true,
      stepUpRequired: true,
      sensitiveReasonRequired: true,
    });
  });

  it('keeps deprecated aliases outside the catalog so they authorize nothing', () => {
    for (const code of deprecatedRouteCodes) {
      expect(isCanonicalPermission(code), code).toBe(false);
    }
    expect(isCanonicalPermission('rbac.manage')).toBe(false);
    expect(isCanonicalPermission('audit.view')).toBe(false);
    expect(isCanonicalPermission('market.view')).toBe(false);
  });

  it('has zero unexplained drift between decorators and the manifest', async () => {
    const apiSource = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../apps/api/src',
    );
    const files = await typescriptFiles(apiSource);
    const decorated = new Set<string>();
    const pattern = /RequirePermission\(\s*['"]([^'"]+)['"]/gu;
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(pattern)) {
        if (match[1]) decorated.add(match[1]);
      }
    }
    const unexplained = [...decorated].filter(
      (code) => !isCanonicalPermission(code) && !deprecatedRouteCodes.has(code),
    );
    expect(unexplained).toEqual([]);
    expect([...deprecatedRouteCodes].every((code) => decorated.has(code))).toBe(
      true,
    );
  });

  it('does not auto-expand Super Admin for a newly inserted permission code', () => {
    expect(roleTemplatePermissions.SUPER_ADMIN).toEqual(
      canonicalPermissionCodes,
    );
    expect(roleTemplatePermissions.SUPER_ADMIN).not.toContain(
      'future.unreviewed.permission',
    );
  });
});

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    }),
  );
  return nested.flat();
}
