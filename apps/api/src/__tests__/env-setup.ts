/**
 * Test Environment Setup
 *
 * Loads DATABASE_URL from env or from an external env file.
 *
 * Priority:
 * 1. process.env.DATABASE_URL (already set — use as-is)
 * 2. process.env.IPOINT_ENV_FILE (read from external file)
 * 3. Throw explicit error
 *
 * Security:
 * - Never logs the password
 * - Never writes credentials to source files
 */
import { readFileSync } from 'node:fs';

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('='))
        continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      // Only set DATABASE_URL and REDIS_URL from env file
      if (
        (key === 'DATABASE_URL' || key === 'REDIS_URL') &&
        !process.env[key]
      ) {
        process.env[key] = value;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[env-setup] Could not load env file ${filePath}: ${msg}`);
  }
}

if (!process.env['DATABASE_URL']) {
  const envFile = process.env['IPOINT_ENV_FILE'];
  if (envFile) {
    loadEnvFile(envFile);
  }
}

if (!process.env['DATABASE_URL']) {
  throw new Error(
    'TEST_DATABASE_ENV_MISSING: DATABASE_URL is not set and no IPOINT_ENV_FILE was found. ' +
      'Set IPOINT_ENV_FILE=C:\\path\\.env.local to load from an external file.',
  );
}
