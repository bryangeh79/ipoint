import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

export const packageRoot = resolve(sourceDirectory, '..');
export const migrationsDirectory = resolve(packageRoot, 'migrations');
export const checksumManifestPath = resolve(
  migrationsDirectory,
  'checksums.json',
);
