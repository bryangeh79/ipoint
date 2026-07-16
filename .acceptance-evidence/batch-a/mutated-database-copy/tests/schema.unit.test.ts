import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { expectedSchema } from '../src/expected-schema.js';
import { calculateMigrationChecksums } from '../src/migration-checksums.js';
import { migrationsDirectory } from '../src/paths.js';

describe('database foundation schema', () => {
  it('contains every required generic platform entity', () => {
    expect(Object.keys(expectedSchema)).toEqual(
      expect.arrayContaining([
        'accounts',
        'credentials',
        'sessions',
        'otps',
        'security_events',
        'markets',
        'admin_users',
        'roles',
        'permissions',
        'role_permissions',
        'role_assignments',
        'market_access',
        'audit_logs',
        'entity_timelines',
      ]),
    );
  });

  it('stores only hashes for credentials, sessions, and OTP secrets', () => {
    expect(expectedSchema.credentials).toContain('secret_hash');
    expect(expectedSchema.sessions).toEqual(
      expect.arrayContaining(['access_token_hash', 'refresh_token_hash']),
    );
    expect(expectedSchema.otps).toContain('code_hash');
    const secretColumns = [
      ...expectedSchema.credentials,
      ...expectedSchema.sessions,
      ...expectedSchema.otps,
    ];
    expect(secretColumns).not.toEqual(
      expect.arrayContaining([
        'password',
        'secret',
        'access_token',
        'refresh_token',
        'code',
      ]),
    );
  });

  it('keeps migrations explicit SQL and in the checksum set', async () => {
    const checksums = await calculateMigrationChecksums();
    expect(Object.keys(checksums)).toEqual([
      '0000_database_foundation.sql',
      '0001_auth_session_access_expiry.sql',
    ]);
    const migration = await readFile(
      `${migrationsDirectory}/0000_database_foundation.sql`,
      'utf8',
    );
    expect(migration).toContain('CREATE TRIGGER audit_logs_append_only');
    expect(migration).toContain('CREATE TRIGGER entity_timelines_append_only');
    expect(migration).not.toMatch(/member|merchant|wallet|commission|ipoint/iu);
  });
});
