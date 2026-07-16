import type { Database } from '../src/client.js';
import { permissions, rolePermissions, roles } from '../schema/index.js';

export const foundationPermissions = [
  ['market.view', 'View the global market registry'],
  ['market.manage', 'Create and update market registry records'],
  ['rbac.view', 'View roles, permissions, and access assignments'],
  ['rbac.manage', 'Manage roles, permissions, and access assignments'],
  ['audit.view', 'View audit logs and entity timelines'],
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
