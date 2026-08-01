import type { Database } from '../src/client.js';
import {
  permissions,
  rolePermissions,
  roles,
  serviceFeeProfiles,
  serviceFeeVersions,
} from '../schema/index.js';
import {
  canonicalPermissionCatalog,
  controlledRoleTemplates,
  roleTemplatePermissions,
} from '../src/permission-catalog.js';
import { eq, inArray, sql } from 'drizzle-orm';

export const foundationPermissions = canonicalPermissionCatalog.map(
  ({ code, description }) => [code, description] as const,
);

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
        canonicalPermissionCatalog.map(({ code, description }) => ({
          code,
          description,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.code,
        set: { description: sql`excluded.description` },
      });

    await tx
      .insert(roles)
      .values(
        controlledRoleTemplates.map((role) => ({
          ...role,
          isSystem: true,
        })),
      )
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

    const permissionRows = await tx
      .select()
      .from(permissions)
      .where(
        inArray(
          permissions.code,
          canonicalPermissionCatalog.map(({ code }) => code),
        ),
      );
    const roleRows = await tx.select().from(roles);
    const controlledRoles = roleRows.filter((role) =>
      controlledRoleTemplates.some((template) => template.code === role.code),
    );
    if (controlledRoles.length !== controlledRoleTemplates.length)
      throw new Error('Controlled role templates were not created.');

    await tx.delete(rolePermissions).where(
      inArray(
        rolePermissions.roleId,
        controlledRoles.map(({ id }) => id),
      ),
    );

    await tx
      .insert(rolePermissions)
      .values(
        controlledRoles.flatMap((role) =>
          permissionRows
            .filter((permissionRow) =>
              roleTemplatePermissions[
                role.code as keyof typeof roleTemplatePermissions
              ].includes(
                permissionRow.code as (typeof canonicalPermissionCatalog)[number]['code'],
              ),
            )
            .map((permissionRow) => ({
              roleId: role.id,
              permissionId: permissionRow.id,
            })),
        ),
      )
      .onConflictDoNothing();

    const legacyViewer = roleRows.find((role) => role.code === 'VIEWER');
    if (legacyViewer) {
      await tx
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, legacyViewer.id));
      await tx
        .update(roles)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(roles.id, legacyViewer.id));
    }
  });
}
