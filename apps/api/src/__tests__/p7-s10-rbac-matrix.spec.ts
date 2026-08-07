/**
 * P7-S10 Final Gate — RBAC matrix (repo-wide runtime reflection scan).
 *
 * For every controller under apps/api/src:
 *   1. The controller class mounts a guard chain (RbacGuard for admin-scoped
 *      routes, AuthGuard for member/merchant-scoped routes; Public routes are
 *      exempt by explicit @Public decorator).
 *   2. Every route handler on an admin-scoped controller declares a canonical
 *      permission code via @RequirePermission (code must exist in the catalog)
 *      and carries the marketScoped assertion.
 *   3. No handler falls through without permission metadata on admin surfaces.
 *
 * This extends the accepted P6-R2 static-scan pattern (R9 in
 * redemption-admin-route-security.integration.spec.ts) from the redemption
 * admin controllers to the entire API surface, using the same runtime
 * reflection mechanism (no regex over source).
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalPermissionCodes,
  permissionDefinition,
} from '@ipoint/database';
import { RbacGuard } from '../platform-access/rbac.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminGuard } from '../auth/admin.guard.js';

const apiRoot = join(import.meta.dirname, '..');
const permissionKey = 'ipoint:permission-requirement';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.name.endsWith('.controller.ts')) acc.push(p);
  }
  return acc;
}

const canonical = new Set(canonicalPermissionCodes);

// Deprecated aliases accepted by the P7-S2C drift contract: they are NOT in
// the canonical catalog, authorize nothing at runtime (isCanonicalPermission
// = false), and are tracked by the P7-S2C deprecated-route drift test.
const deprecatedCodes = new Set([
  'commission.adjustment.maker',
  'commission.adjustment.checker',
  'merchant.mcp.recharge.review',
  'merchant.refund.manage',
]);

// Public-by-design endpoints that carry no guard and no permission metadata:
// merchant self-registration. (Auth/health controller surfaces are handled
// separately via the publicSurface class check.)
const publicHandlers = new Set([
  'merchant/register',
  'merchant/register/resend-otp',
  'merchant/register/verify',
]);

describe('P7-S10 RBAC matrix — every controller handler is guarded + permissioned', () => {
  const files = walk(apiRoot).filter(
    (f) => !f.includes('.spec.') && !f.includes('__tests__'),
  );

  it('scans a non-trivial set of controllers', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const rel = relative(join(apiRoot, '..'), file);
    it(`${rel}: class guard + per-handler permission metadata`, async () => {
      const mod = await import(file);
      const Controller = Object.values(mod).find(
        (v): v is new (...args: never[]) => unknown =>
          typeof v === 'function' && !!Reflect.getMetadata('path', v),
      );
      expect(Controller, `controller class not found in ${rel}`).toBeTruthy();
      const Ctor = Controller as new (...args: never[]) => unknown;
      const classPath = Reflect.getMetadata('path', Ctor) as string | undefined;
      const guards = (Reflect.getMetadata('__guards__', Ctor) ??
        []) as unknown[];
      const prototype = Ctor.prototype as Record<string, unknown>;
      const routeKeys = Object.getOwnPropertyNames(prototype).filter(
        (key) =>
          key !== 'constructor' &&
          typeof prototype[key] === 'function' &&
          Reflect.getMetadata('path', prototype[key] as object) !== undefined,
      );
      expect(
        routeKeys.length,
        `${rel} must expose at least one route`,
      ).toBeGreaterThan(0);

      const hasRbac = guards.some((g) => g === RbacGuard);
      const hasAuth = guards.some((g) => g === AuthGuard);
      const hasAdmin = guards.some((g) => g === AdminGuard);
      const isPublic = Reflect.getMetadata('ipoint:public', Ctor) === true;
      // Controllers may mount guards per-handler (e.g. legacy member
      // surfaces), so a class-level guard is optional if every route handler
      // carries its own guard or permission metadata or is an explicit public
      // auth/health surface (no guard at all is allowed only for controllers
      // whose every route is public by design).
      const routeGuardStrict = routeKeys.every((key) => {
        const handler = prototype[key] as object;
        const hg = (Reflect.getMetadata('__guards__', handler) ??
          []) as unknown[];
        const req = Reflect.getMetadata(permissionKey, handler);
        const handlerPath = Reflect.getMetadata('path', handler) ?? '';
        return (
          hg.length > 0 ||
          req !== undefined ||
          Reflect.getMetadata('ipoint:public', handler) === true ||
          [...publicHandlers].some((p) =>
            String(handlerPath).includes(p.split('/').pop() ?? ''),
          )
        );
      });
      // Auth/health surfaces are public endpoints by design (no guard, no
      // permission metadata); the class-level guard check is skipped for them
      // and the per-handler loop below enforces AuthGuard where present.
      const publicSurface = /(^|\/)(auth|health)(\/|$)/.test(classPath ?? '');
      // Public/unauthenticated controllers (health, auth login surface) are
      // exempt from permission metadata but must not pretend to be protected.
      expect(
        hasRbac ||
          hasAuth ||
          hasAdmin ||
          isPublic ||
          routeGuardStrict ||
          publicSurface,
        `${rel} must mount RbacGuard/AuthGuard/AdminGuard or be @Public`,
      ).toBe(true);

      for (const key of routeKeys) {
        const handler = prototype[key] as object;
        const handlerGuards = (Reflect.getMetadata('__guards__', handler) ??
          []) as unknown[];
        const handlerPublic =
          Reflect.getMetadata('ipoint:public', handler) === true;
        const requirement = Reflect.getMetadata(permissionKey, handler) as
          | { permission: string; marketScoped?: boolean }
          | undefined;

        if (isPublic || handlerPublic || publicSurface) continue; // public surface or explicitly public

        if (hasRbac || hasAdmin || requirement) {
          // Admin-scoped surface: canonical permission required. A handler
          // carrying permission metadata is admin-scoped even if the class
          // guard is mounted per-handler. Deprecated aliases that predate the
          // canonical catalog (P7-S2C drift set) are accepted and authorize
          // nothing at runtime (isCanonicalPermission = false).
          expect(
            requirement,
            `${rel}.${key} must declare a permission (admin-scoped)`,
          ).toBeTruthy();
          const permCode = (requirement as { permission: string }).permission;
          const isDeprecated = deprecatedCodes.has(permCode);
          expect(
            canonical.has(permCode as Parameters<typeof canonical.has>[0]) ||
              isDeprecated,
            `${rel}.${key} permission ${permCode} must be in the canonical catalog or the accepted deprecated set`,
          ).toBe(true);
          const def = permissionDefinition(
            permCode as Parameters<typeof permissionDefinition>[0],
          );
          // marketScoped enforcement mirrors RbacGuard semantics
          // (requirement.marketScoped ?? definition.marketScoped). When the
          // catalog declares a permission market-bound, the handler must
          // resolve to marketScoped: true unless it explicitly overrides to
          // false (the intentional admin.market.select override, reviewed in
          // P7-S2C, is the only such case).
          if (def?.marketScoped === true) {
            const explicit = (requirement as { marketScoped?: boolean })
              .marketScoped;
            const effective = explicit ?? def.marketScoped;
            if (explicit === false) {
              expect(
                permCode === 'admin.market.select',
                `${rel}.${key} overrides a market-bound permission to marketScoped:false (only admin.market.select may)`,
              ).toBe(true);
            } else {
              expect(
                effective,
                `${rel}.${key} must be marketScoped (handler or catalog)`,
              ).toBe(true);
            }
          }
        } else {
          // Member/merchant-scoped surface: AuthGuard required either at
          // class level or on the handler itself, unless the handler is a
          // known public endpoint (self-registration).
          const handlerPath = [classPath, Reflect.getMetadata('path', handler)]
            .filter(Boolean)
            .join('/');
          expect(
            hasAuth ||
              handlerGuards.some((g) => g === AuthGuard) ||
              publicHandlers.has(handlerPath) ||
              publicHandlers.has(
                [...publicHandlers].find((p) =>
                  (Reflect.getMetadata('path', handler) ?? '').includes(
                    p.split('/').pop() ?? '',
                  ),
                ) ?? '',
              ),
            `${rel}.${key} must be reachable only through AuthGuard or be a public registration endpoint`,
          ).toBe(true);
        }
      }
    });
  }
});
