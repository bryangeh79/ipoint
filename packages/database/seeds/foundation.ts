import type { Database } from '../src/client.js';
import {
  permissions,
  rolePermissions,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
} from '../schema/index.js';

export const foundationPermissions = [
  ['market.view', 'View the global market registry'],
  ['market.manage', 'Create and update market registry records'],
  ['rbac.view', 'View roles, permissions, and access assignments'],
  ['rbac.manage', 'Manage roles, permissions, and access assignments'],
  ['audit.view', 'View audit logs and entity timelines'],
  ['merchant.view', 'View merchants in authorized markets'],
  ['merchant.approve', 'Review merchant applications and KYC'],
  ['merchant.suspend', 'Suspend and reactivate merchants'],
  ['merchant.close', 'Review merchant closure requests'],
  ['merchant.referral.correct', 'Correct merchant referral evidence'],
  ['merchant.package.view', 'View merchant service-fee packages'],
  ['merchant.package.manage', 'Manage service-fee profiles and versions'],
  ['merchant.package.assign', 'Assign merchant service-fee packages'],
  ['merchant.mcp.view', 'View merchant MCP accounts and ledgers'],
  ['merchant.mcp.recharge.review', 'Review MCP recharge requests'],
  ['merchant.mcp.refund.review', 'Review MCP refund requests'],
  ['merchant.mcp.adjust', 'Create manual MCP adjustments'],
  ['merchant.mcp.adjust.approve', 'Approve manual MCP adjustments'],
  ['merchant.mcp.adjust.execute', 'Execute approved MCP adjustments'],
  ['merchant.mcp.reverse', 'Create governed MCP reversal entries'],
] as const;

export const standardServiceFeeProfiles = [
  ['A', '2.500000'],
  ['B', '5.000000'],
  ['C', '10.000000'],
  ['D', '15.000000'],
  ['E', '20.000000'],
  ['F', '25.000000'],
] as const;

export async function seedFoundation(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(permissions)
      .values(
        foundationPermissions.map(([code, description]) => ({
          code,
          description,
        })),
      )
      .onConflictDoNothing({ target: permissions.code });

    await tx
      .insert(roles)
      .values([
        {
          code: 'SUPER_ADMIN',
          name: 'Super Admin',
          description: 'System role with all platform foundation permissions.',
          isSystem: true,
        },
        {
          code: 'VIEWER',
          name: 'Viewer',
          description:
            'System role with read-only platform foundation permissions.',
          isSystem: true,
        },
      ])
      .onConflictDoNothing({ target: roles.code });

    await tx
      .insert(serviceFeeProfiles)
      .values(
        standardServiceFeeProfiles.map(([code]) => ({
          code,
          name: `Standard Package ${code}`,
          description: `Standard merchant service-fee package ${code}.`,
        })),
      )
      .onConflictDoNothing({ target: serviceFeeProfiles.code });

    const profileRows = await tx.select().from(serviceFeeProfiles);
    await tx
      .insert(serviceFeeVersions)
      .values(
        standardServiceFeeProfiles.map(([code, rate]) => {
          const profile = profileRows.find((row) => row.code === code);
          if (!profile) throw new Error(`Service-fee profile ${code} missing.`);
          return {
            serviceFeeProfileId: profile.id,
            rate,
            effectiveFrom: new Date('1970-01-01T00:00:00.000Z'),
            status: 'ACTIVE' as const,
          };
        }),
      )
      .onConflictDoNothing();

    const permissionRows = await tx.select().from(permissions);
    const roleRows = await tx.select().from(roles);
    const superAdmin = roleRows.find((role) => role.code === 'SUPER_ADMIN');
    const viewer = roleRows.find((role) => role.code === 'VIEWER');
    if (!superAdmin || !viewer)
      throw new Error('Foundation roles were not created.');

    await tx
      .insert(rolePermissions)
      .values([
        ...permissionRows.map((permission) => ({
          roleId: superAdmin.id,
          permissionId: permission.id,
        })),
        ...permissionRows
          .filter((permission) => permission.code.endsWith('.view'))
          .map((permission) => ({
            roleId: viewer.id,
            permissionId: permission.id,
          })),
      ])
      .onConflictDoNothing();
  });
}
