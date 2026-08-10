/**
 * P8-S8 Full Final UAT — fail-closed guards.
 *
 * Mirrors the S1-S4/S6 `P8SN_DESTRUCTIVE_TEST` guard pattern exactly: every
 * UAT spec that writes financial state requires
 *   1. a DATABASE_URL naming a dedicated test database matching
 *      `^ipoint_p8s8_[a-z0-9_]{1,63}$`, and
 *   2. the explicit `P8S8_DESTRUCTIVE_TEST` environment opt-in.
 *
 * The guard never accepts `ipoint_ci`, production-looking names, or
 * maintenance databases. A UAT run that fails either check refuses to
 * start (fail-closed) instead of running against a shared database.
 *
 * @packageDocumentation
 */

export const DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8S8_DESTRUCTIVE_TEST';

const TEST_DATABASE_NAME_PATTERN = /^ipoint_p8s8_[a-z0-9_]{1,63}$/u;

const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
]);

/**
 * Extract the database name from a connection string and validate it
 * against the dedicated `ipoint_p8s8_*` test pattern. Returns the name
 * when the URL is valid and the name matches; returns null otherwise.
 */
export function testDatabaseName(
  databaseUrlValue: string | undefined,
): string | null {
  if (!databaseUrlValue) return null;
  let name: string;
  try {
    name = new URL(databaseUrlValue).pathname.replace(/^\//u, '').trim();
  } catch {
    return null;
  }
  if (!name) return null;
  if (PROTECTED_DATABASE_NAMES.has(name)) return null;
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) return null;
  return name;
}

/**
 * True when the caller explicitly opted into destructive UAT execution via
 * `P8S8_DESTRUCTIVE_TEST` (values `1` / `true` / `yes`, case-insensitive).
 */
export function destructiveTestOptIn(
  env: Record<string, string | undefined>,
): boolean {
  const value = env[DESTRUCTIVE_TEST_OPT_IN_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Fail-closed preflight used by the UAT entry point (vitest spec). Throws
 * with an actionable message when the environment does not permit UAT.
 */
export function assertUatAllowed(databaseUrlValue: string | undefined): {
  databaseName: string;
} {
  const databaseName = testDatabaseName(databaseUrlValue);
  if (!databaseName) {
    throw new Error(
      `P8-S8 UAT harness is fail-closed: DATABASE_URL must name a dedicated test database matching ^ipoint_p8s8_[a-z0-9_]+$ and must not be a protected database (received ${databaseUrlValue ?? 'unset'}).`,
    );
  }
  if (!destructiveTestOptIn(process.env)) {
    throw new Error(
      `P8-S8 UAT harness is fail-closed: set ${DESTRUCTIVE_TEST_OPT_IN_ENV}=1 to allow recreating the dedicated test database "${databaseName}".`,
    );
  }
  return { databaseName };
}
