/**
 * P8-L06 member QR integration suite - fail-closed guards.
 *
 * Mirrors the P8-S1..S4/S6/S8 `P8SN_DESTRUCTIVE_TEST` guard pattern: the
 * integration suite that recreates its database requires
 *   1. a DATABASE_URL naming a dedicated test database matching
 *      `^ipoint_p8l06_[a-z0-9_]{1,63}$`, and
 *   2. the explicit `P8L06_DESTRUCTIVE_TEST` environment opt-in.
 *
 * The guard never accepts `ipoint_ci`, production-looking names, or
 * maintenance databases. A run that fails either check refuses to start
 * (fail-closed) instead of touching a shared database.
 *
 * @packageDocumentation
 */

export const DESTRUCTIVE_TEST_OPT_IN_ENV = 'P8L06_DESTRUCTIVE_TEST';

const TEST_DATABASE_NAME_PATTERN = /^ipoint_p8l06_[a-z0-9_]{1,63}$/u;

const PROTECTED_DATABASE_NAMES = new Set([
  'postgres',
  'template0',
  'template1',
]);

/**
 * Extract the database name from a connection string and validate it
 * against the dedicated `ipoint_p8l06_*` test pattern. Returns the name
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
 * True when the caller explicitly opted into destructive execution via
 * `P8L06_DESTRUCTIVE_TEST` (values `1` / `true` / `yes`, case-insensitive).
 */
export function destructiveTestOptIn(
  env: Record<string, string | undefined>,
): boolean {
  const value = env[DESTRUCTIVE_TEST_OPT_IN_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}
