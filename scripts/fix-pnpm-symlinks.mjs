#!/usr/bin/env node
// fix-pnpm-symlinks.mjs — Repair broken host-path symlinks in node_modules
// Run from workspace root:  node22 scripts/fix-pnpm-symlinks.mjs
//
// Problem: pnpm on Windows creates absolute symlinks that break in the sandbox.
// Or:      pnpm install removed the hoisted dirs but the .pnpm store remains.
// Fix:     Recreate all missing hoisted symlinks from the .pnpm virtual store.
//
// Usage:   node22 scripts/fix-pnpm-symlinks.mjs [--dry-run] [--essential-only]

import {
  existsSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  symlinkSync,
  mkdirSync,
} from 'fs';
import { resolve, join, relative, dirname } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const NM = join(ROOT, 'node_modules');
const PNPM = join(NM, '.pnpm');
const DRY_RUN = process.argv.includes('--dry-run');
const ESSENTIAL_ONLY = process.argv.includes('--essential-only');

if (!existsSync(PNPM)) {
  console.error('ERROR: .pnpm virtual store not found at ' + PNPM);
  process.exit(1);
}

console.log(
  'Mode: ' +
    (DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE') +
    (ESSENTIAL_ONLY ? ', essential packages only' : ', all packages'),
);

// ── Build store map ──
// Maps full package name → real path inside .pnpm store
// e.g., "prettier" → "node_modules/.pnpm/prettier@3.7.3/node_modules/prettier"
//        "@eslint/js" → "node_modules/.pnpm/@eslint+js@9.39.1/node_modules/@eslint/js"
const storeMap = new Map();

function indexPackage(virtualEntryPath, itemName) {
  // itemName could be "prettier" or "@eslint" (scoped parent)
  const itemPath = join(virtualEntryPath, itemName);
  if (!existsSync(itemPath)) return;

  if (itemName.startsWith('@') && lstatSync(itemPath).isDirectory()) {
    // It's a scope directory, index its children
    try {
      for (const sub of readdirSync(itemPath)) {
        const fullName = itemName + '/' + sub;
        const fullPath = join(itemPath, sub);
        storeMap.set(fullName, fullPath);
      }
    } catch {}
  } else {
    storeMap.set(itemName, itemPath);
  }
}

for (const entry of readdirSync(PNPM)) {
  const nmDir = join(PNPM, entry, 'node_modules');
  if (existsSync(nmDir)) {
    try {
      for (const item of readdirSync(nmDir)) {
        indexPackage(nmDir, item);
      }
    } catch {}
  }
}

console.log('Store indexed: ' + storeMap.size + ' packages');

// ── Packages that MUST be hoisted for the pipeline to work ──
const ESSENTIAL = [
  'prettier',
  'vitest',
  'eslint',
  'typescript',
  '@eslint/js',
  '@eslint/eslintrc',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/parser',
  '@vitejs/plugin-react',
  '@vitest/coverage-v8',
  '@playwright/test',
  '@ipoint/database',
  // types
  '@types/node',
  '@types/react',
  '@types/react-dom',
  // bin dependencies
  'vite',
  'tsc',
];

// ── Ensure a directory exists ──
function ensureDir(dir) {
  if (existsSync(dir)) return;
  if (DRY_RUN) {
    console.log('  [DRY] mkdir -p ' + dir);
    return;
  }
  mkdirSync(dir, { recursive: true });
}

// ── Create a symlink (with parent dir) ──
function createSymlink(targetPath, linkPath, pkgName) {
  if (existsSync(linkPath)) {
    // Already exists and is valid
    if (existsSync(realpath(linkPath))) return;
    // Broken — remove it
    if (!DRY_RUN) unlinkSync(linkPath);
  }

  if (DRY_RUN) {
    console.log(
      '  [DRY] symlink: ' + pkgName + ' \u2192 ' + relative(ROOT, targetPath),
    );
    return;
  }

  ensureDir(dirname(linkPath));
  try {
    symlinkSync(targetPath, linkPath, 'dir');
    console.log('  CREATED: ' + pkgName);
  } catch (e) {
    console.error('  FAIL: ' + pkgName + ' \u2192 ' + e.message);
  }
}

// ── Create symlinks ──
let created = 0;
const targetPackages = ESSENTIAL_ONLY ? ESSENTIAL : [...storeMap.keys()];

console.log('\nCreating symlinks...');

for (const pkgName of targetPackages) {
  if (DRY_RUN && !ESSENTIAL_ONLY && targetPackages.length > 100) {
    // In dry-run all mode, just show first 10 to keep output manageable
    if (created >= 10) {
      created = targetPackages.length;
      break;
    }
  }

  const targetPath = storeMap.get(pkgName);
  if (!targetPath || !existsSync(targetPath)) {
    if (ESSENTIAL_ONLY) console.log('  SKIP: ' + pkgName + ' (not in store)');
    continue;
  }

  // Determine link path
  let linkPath;
  if (pkgName.startsWith('@')) {
    const [scope, name] = pkgName.split('/');
    linkPath = join(NM, scope, name);
  } else {
    linkPath = join(NM, pkgName);
  }

  createSymlink(targetPath, linkPath, pkgName);
  created++;
}

console.log('\nCreated: ' + created + ' symlinks');

// ── Also recreate .bin scripts if missing ──
const binDir = join(NM, '.bin');
const vendorBinDir = join(NM, '.pnpm', 'node_modules');

if (!existsSync(binDir)) {
  if (DRY_RUN) {
    console.log('  [DRY] Would create .bin directory');
  } else {
    ensureDir(binDir);
    console.log('Created .bin directory');
  }
}

// Try to create .bin shims from the vendor bin
const vendorBins = join(PNPM, 'node_modules');
if (existsSync(vendorBins) && existsSync(join(vendorBins, '.bin'))) {
  console.log('Found vendor .bin, linking...');
  if (!DRY_RUN) {
    try {
      const bins = readdirSync(join(vendorBins, '.bin'));
      for (const bin of bins) {
        const src = join(vendorBins, '.bin', bin);
        const dest = join(binDir, bin);
        if (!existsSync(dest)) {
          try {
            const content = readlinkSync(src);
            symlinkSync(content, dest);
          } catch {
            // Copy instead
          }
        }
      }
    } catch {}
  }
}

console.log('\nDone. Run `ls -la node_modules/prettier` to verify.');

function realpath(p) {
  try {
    return readlinkSync(p);
  } catch {
    return p;
  }
}
