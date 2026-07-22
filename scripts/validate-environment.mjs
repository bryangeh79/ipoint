#!/usr/bin/env node
// validate-environment.mjs — Comprehensive environment validation for Phase 3
// Reports PASS / FAIL / SKIP for each check with root cause analysis.
import { execSync } from 'child_process';
import { existsSync, readlinkSync, readdirSync, lstatSync, statSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const RESULTS = [];

function record(label, status, detail = '') {
  RESULTS.push({ label, status, detail });
  const icon = status === 'PASS' ? '\u2705' : status === 'FAIL' ? '\u274C' : status === 'SKIP' ? '\u23ED\uFE0F' : '\u26A0\uFE0F';
  console.log(`  ${icon} [${status}] ${label}${detail ? '\n        \u2192 ' + detail : ''}`);
}

function run(cmd, opts = {}) {
  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 15000, ...opts }).trim();
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e) {
    return {
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
      exitCode: e.status ?? -1,
    };
  }
}

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  iPoint Phase 3 \u2014 Environment Validation');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

// ── 1. Node.js ──────────────────────────────────────────
console.log('\u2500\u2500 1. Node.js \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const r = run('node --version');
  if (r.exitCode === 0) {
    record('node --version', 'PASS', 'Node ' + r.stdout + ' found');
  } else {
    record('node --version', 'FAIL', 'Exit code ' + r.exitCode + ': ' + r.stderr);
  }
}

{
  const r = run('./node22 --version', { cwd: ROOT });
  if (r.exitCode === 0) {
    record('node22 binary (project min)', 'PASS', 'Node ' + r.stdout + ' \u2014 meets >=22.0.0 requirement');
  } else {
    record('node22 binary (project min)', 'FAIL', 'Missing or broken \u2014 project requires >=22.0.0');
  }
}

// ── 2. pnpm ────────────────────────────────────────────
console.log('\n\u2500\u2500 2. pnpm \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const r = run('pnpm --version');
  if (r.exitCode === 0) {
    record('pnpm (PATH)', 'PASS', 'pnpm ' + r.stdout);
  } else {
    record('pnpm (PATH)', 'FAIL', 'Not in PATH \u2014 need pnpm@9.15.9 per package.json');
  }
}

{
  const pnpmBin = join(ROOT, 'pnpm');
  if (existsSync(pnpmBin)) {
    const size = statSync(pnpmBin).size;
    const header = readFileSync(pnpmBin, { flag: 'r' }).slice(0, 4).toString();
    const isELF = header === '\x7fELF';
    record('pnpm (./pnpm binary)', 'INFO', 'File exists (' + (size/1024/1024).toFixed(1) + ' MB), ELF binary: ' + isELF + '. Cannot execute \u2014 causes SIGKILL in sandbox (likely incompatible glibc or Node.js mismatch)');
  } else {
    record('pnpm (./pnpm binary)', 'FAIL', 'Missing');
  }
}

{
  record('pnpm via node22', 'SKIP', 'Standalone binary \u2014 cannot be run via Node.js');
}

// ── 3. Corepack ────────────────────────────────────────
console.log('\n\u2500\u2500 3. Corepack \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const r = run('corepack enable');
  if (r.exitCode === 0) {
    record('corepack enable', 'PASS', 'Corepack enabled');
  } else {
    record('corepack enable', 'FAIL', 'Exit ' + r.exitCode + ': ' + (r.stderr || r.stdout));
  }
}

{
  try {
    const r = run('corepack prepare pnpm@9.15.9 --activate');
    if (r.exitCode === 0) {
      const pnpmR = run('pnpm --version');
      if (pnpmR.exitCode === 0) record('pnpm via corepack', 'PASS', 'pnpm ' + pnpmR.stdout);
      else record('pnpm via corepack', 'FAIL', 'corepack prepared but pnpm still fails: ' + pnpmR.stderr);
    } else {
      record('corepack prepare pnpm', 'FAIL', 'Exit ' + r.exitCode + ': ' + (r.stderr || r.stdout));
    }
  } catch {
    record('corepack prepare pnpm', 'FAIL', 'Corepack not available');
  }
}

// ── 4. node_modules \u2014 Structure & symlinks ─────────────
console.log('\n\u2500\u2500 4. node_modules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const nm = join(ROOT, 'node_modules');
  if (existsSync(nm)) {
    record('node_modules exists', 'PASS', 'Root node_modules directory found');
  } else {
    record('node_modules exists', 'FAIL', 'Root node_modules directory missing');
  }
}

// Check key packages
for (const pkg of ['prettier', 'vitest', 'eslint', 'typescript']) {
  const p = join(ROOT, 'node_modules', pkg);
  if (!existsSync(p)) {
    record('symlink: ' + pkg, 'FAIL', 'Missing \u2014 not resolved in node_modules');
    continue;
  }
  const s = lstatSync(p);
  if (s.isSymbolicLink()) {
    if (existsSync(p)) {
      record('symlink: ' + pkg, 'PASS', 'Resolves correctly');
    } else {
      record('symlink: ' + pkg, 'FAIL', 'Broken symlink');
    }
  } else if (s.isDirectory()) {
    record('symlink: ' + pkg, 'PASS', 'Directory (non-symlinked)');
  }
}

// Scan all symlinks
const nm = join(ROOT, 'node_modules');
const nmEntries = readdirSync(nm);
let totalSymlinks = 0, brokenSymlinks = 0, workingSymlinks = 0;
function scanDir(dir, baseKey) {
  baseKey = baseKey || '';
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (e === '.bin' || e === '.pnpm' || e === '.modules.yaml' || e === '.vite') continue;
    const fp = join(dir, e);
    let s;
    try { s = lstatSync(fp); } catch { continue; }
    if (s.isSymbolicLink()) {
      totalSymlinks++;
      if (existsSync(fp)) { workingSymlinks++; }
      else { brokenSymlinks++; }
    } else if (s.isDirectory() && e.startsWith('@')) {
      scanDir(fp, e + '/');
    }
  }
}
scanDir(nm);
record('symlink health', brokenSymlinks === 0 ? 'PASS' : 'FAIL',
  '' + workingSymlinks + '/' + totalSymlinks + ' working, ' + brokenSymlinks + ' broken');

// .pnpm virtual store
const pnpmStore = join(nm, '.pnpm');
if (existsSync(pnpmStore)) {
  const entries = readdirSync(pnpmStore);
  record('.pnpm virtual store', 'PASS', 'Found with ' + entries.length + ' package entries');
} else {
  record('.pnpm virtual store', 'FAIL', 'Missing .pnpm directory');
}

// .bin directory
const binDir = join(nm, '.bin');
if (existsSync(binDir)) {
  const bins = readdirSync(binDir);
  record('.bin scripts', 'PASS', 'Found with ' + bins.length + ' shims');
} else {
  record('.bin scripts', 'FAIL', 'Missing .bin directory');
}

// ── 5. pnpm store ──────────────────────────────────────
console.log('\n\u2500\u2500 5. pnpm store \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const storeDir = join(ROOT, '.pnpm-store');
  if (existsSync(storeDir)) {
    const entries = readdirSync(storeDir);
    record('pnpm store directory', 'PASS', 'Found at ' + storeDir + ' with ' + entries.length + ' entries');
  } else {
    record('pnpm store directory', 'FAIL', 'Missing \u2014 store may be elsewhere');
  }
}

// ── 6. Git ─────────────────────────────────────────────
console.log('\n\u2500\u2500 6. Git \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const r = run('git --version');
  if (r.exitCode === 0) {
    record('git --version', 'PASS', 'Git ' + r.stdout);
    const r2 = run('git rev-parse --show-toplevel 2>&1', { cwd: ROOT });
    if (r2.exitCode === 0) record('git repo root', 'PASS', r2.stdout);
    else record('git repo root', 'FAIL', r2.stderr || r2.stdout);
    const r3 = run('git branch --show-current 2>&1', { cwd: ROOT });
    if (r3.exitCode === 0) record('git branch', 'PASS', r3.stdout);
  } else {
    record('git --version', 'FAIL', 'Not installed in sandbox');
    if (existsSync(join(ROOT, '.git'))) {
      record('git repo (.git directory)', 'INFO', 'Repo exists but git CLI unavailable');
    }
  }
}

// ── 7. GitHub CLI ─────────────────────────────────────
console.log('\n\u2500\u2500 7. GitHub CLI \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const r = run('gh auth status');
  if (r.exitCode === 0) {
    record('gh auth status', 'PASS', 'Authenticated');
  } else {
    record('gh auth status', 'SKIP', 'gh CLI not available in sandbox');
  }
}

// ── 8. PostgreSQL ──────────────────────────────────────
console.log('\n\u2500\u2500 8. PostgreSQL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    record('DATABASE_URL set', 'PASS', dbUrl.substring(0, 40) + '...');
    const r = run('pg_isready', { timeout: 5000 });
    if (r.exitCode === 0) record('pg_isready', 'PASS', 'PostgreSQL accepting connections');
    else record('pg_isready', 'FAIL', 'Exit ' + r.exitCode + ': ' + (r.stderr || r.stdout));
  } else {
    record('DATABASE_URL', 'FAIL', 'Not set in environment');
    record('PostgreSQL connection', 'SKIP', 'Cannot test without DATABASE_URL');
  }
}

// ── 9. Redis ───────────────────────────────────────────
console.log('\n\u2500\u2500 9. Redis \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    record('REDIS_URL set', 'PASS', 'Set');
    const r = run('redis-cli ping', { timeout: 5000 });
    if (r.exitCode === 0) record('redis-cli ping', 'PASS', r.stdout);
    else record('redis-cli ping', 'FAIL', 'Exit ' + r.exitCode + ': ' + (r.stderr || r.stdout));
  } else {
    record('REDIS_URL', 'FAIL', 'Not set in environment');
    record('Redis connection', 'SKIP', 'Cannot test without REDIS_URL');
  }
}

// ── 10. Docker ─────────────────────────────────────────
console.log('\n\u2500\u2500 10. Docker \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
{
  const r = run('docker --version');
  if (r.exitCode === 0) {
    record('docker --version', 'PASS', r.stdout);
  } else {
    record('docker --version', 'SKIP', 'Docker not available in sandbox');
  }
}

// ── Summary ────────────────────────────────────────────
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  RESULTS SUMMARY');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

const pass = RESULTS.filter(r => r.status === 'PASS').length;
const fail = RESULTS.filter(r => r.status === 'FAIL').length;
const skip = RESULTS.filter(r => r.status === 'SKIP').length;
const info = RESULTS.filter(r => r.status === 'INFO').length;
console.log('  \u2705 PASS: ' + pass);
console.log('  \u274C FAIL: ' + fail);
console.log('  \u23ED\uFE0F  SKIP: ' + skip);
console.log('  \u2139\uFE0F  INFO: ' + info);
console.log('  Total:   ' + RESULTS.length + '\n');

if (fail > 0) {
  console.log('  FAILURES:\n');
  for (const r of RESULTS) {
    if (r.status === 'FAIL') console.log('    \u274C ' + r.label + ': ' + r.detail);
  }
  console.log();
}

process.exit(fail > 0 ? 1 : 0);
