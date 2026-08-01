import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AccessAdministrationController } from './access-administration.controller.js';
import { AdminMarketContextController } from './admin-market-context.controller.js';

const endpoints = [
  [AccessAdministrationController, 'listUsers', 'users'],
  [AccessAdministrationController, 'userDetail', 'users/:adminUserId'],
  [AccessAdministrationController, 'createUser', 'users'],
  [AccessAdministrationController, 'changeStatus', 'users/:adminUserId/status'],
  [AccessAdministrationController, 'listRoles', 'roles'],
  [AccessAdministrationController, 'assignRole', 'users/:adminUserId/roles'],
  [
    AccessAdministrationController,
    'revokeRole',
    'users/:adminUserId/roles/:roleId',
  ],
  [AccessAdministrationController, 'listPermissions', 'permissions'],
  [
    AccessAdministrationController,
    'replaceRolePermissions',
    'roles/:roleId/permissions',
  ],
  [
    AccessAdministrationController,
    'listMarketGrants',
    'users/:adminUserId/market-grants',
  ],
  [
    AccessAdministrationController,
    'grantMarket',
    'users/:adminUserId/market-grants',
  ],
  [
    AccessAdministrationController,
    'revokeMarket',
    'users/:adminUserId/market-grants/:marketId',
  ],
  [AdminMarketContextController, 'accessibleMarkets', 'me/markets'],
  [AdminMarketContextController, 'bootstrap', 'bootstrap'],
  [AdminMarketContextController, 'selectCurrentMarket', 'me/current-market'],
] as const;

describe('P7-S2C OpenAPI route consistency', () => {
  it.each(endpoints)(
    '%s.%s exposes %s with HTTP metadata',
    (controller, method, path) => {
      const handler = (
        controller.prototype as unknown as Record<string, object>
      )[method];
      expect(handler).toBeDefined();
      expect(Reflect.getMetadata(PATH_METADATA, handler!)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler!)).toBeTypeOf(
        'number',
      );
    },
  );

  it('keeps both controller groups under the versioned admin API root', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, AccessAdministrationController),
    ).toBe('admin');
    expect(
      Reflect.getMetadata(PATH_METADATA, AdminMarketContextController),
    ).toBe('admin');
  });
});
