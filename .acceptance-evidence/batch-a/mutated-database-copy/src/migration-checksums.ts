import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { checksumManifestPath, migrationsDirectory } from './paths.js';

export type MigrationChecksums = Record<string, string>;

export async function calculateMigrationChecksums(): Promise<MigrationChecksums> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/u.test(file))
    .sort();
  const entries = await Promise.all(
    files.map(async (file) => {
      const contents = await readFile(`${migrationsDirectory}/${file}`);
      return [
        file,
        createHash('sha256').update(contents).digest('hex'),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function readChecksumManifest(): Promise<MigrationChecksums> {
  return JSON.parse(
    await readFile(checksumManifestPath, 'utf8'),
  ) as MigrationChecksums;
}

export async function verifyMigrationChecksums(): Promise<MigrationChecksums> {
  const [actual, expected] = await Promise.all([
    calculateMigrationChecksums(),
    readChecksumManifest(),
  ]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Migration checksum mismatch. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
  return actual;
}

async function main(): Promise<void> {
  const checksums = await calculateMigrationChecksums();
  if (process.argv.includes('--write')) {
    await writeFile(
      checksumManifestPath,
      `${JSON.stringify(checksums, null, 2)}\n`,
    );
    console.log(
      `Wrote ${Object.keys(checksums).length} checksum(s) to ${basename(checksumManifestPath)}.`,
    );
    return;
  }
  await verifyMigrationChecksums();
  console.log(
    `Verified ${Object.keys(checksums).length} immutable migration checksum(s).`,
  );
}

if (process.argv[1]?.endsWith('migration-checksums.ts')) {
  await main();
}
