/**
 * P8-S6 retry-site inventory (static scan, Stage D evidence).
 *
 * Scans the repo for every bounded-retry / double-submit-guard site and
 * classifies each as bounded (count + retryable-only) or unbounded (defect).
 * Output: JSON evidence under `.local/p8-s6-load/**` + a readable table.
 *
 *   pnpm exec tsx src/load/run-retry-scan.ts
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

interface RetrySite {
  file: string;
  line: number;
  kind: string;
  bound: string;
  evidence: string;
  verdict: 'BOUNDED' | 'UNBOUNDED' | 'REVIEW';
}

const SCAN_ROOTS = [
  'apps/api/src',
  'apps/api-client/src',
  'apps/member-web/src',
  'apps/merchant-web/src',
  'apps/admin-web/src',
].map((root) => join(process.cwd(), '..', '..', root));

const INCLUDE = /\.(ts|tsx|mjs|js)$/u;
const EXCLUDE =
  /(node_modules|dist|\.local|__tests__|\.spec\.|\.test\.|generated)/u;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE.test(full)) continue;
      walk(full, out);
    } else if (INCLUDE.test(entry.name) && !EXCLUDE.test(full)) {
      out.push(full);
    }
  }
}

function classify(
  line: string,
  context: string[],
): { kind: string; bound: string; verdict: RetrySite['verdict'] } {
  if (
    /maxRetries|max_attempts|maxAttempts|MAX_RETRIES|retries\s*[:=]\s*\d|retryCount\s*[<>]|attempts\s*[<>]\s*max|attempt\s*\+\+\s*.*<=|attempts\s*<\s*max/u.test(
      line,
    )
  ) {
    return {
      kind: 'bounded-count-retry',
      bound: 'count-limited',
      verdict: 'BOUNDED',
    };
  }
  if (
    /RETRYABLE_TRANSACTION_CODES|40001|40P01|serialization|deadlock|SQLSTATE/u.test(
      line,
    )
  ) {
    return {
      kind: 'retryable-only',
      bound: 'SQLSTATE-limited',
      verdict: 'BOUNDED',
    };
  }
  if (/setTimeout\(.*tick|setInterval\(|while\s*\(/u.test(line)) {
    const bounded = context.some((c) =>
      /max|limit|attempts|deadline|timeout|<=|<\s*\d/u.test(c),
    );
    return {
      kind: 'loop/schedule',
      bound: bounded ? 'loop-with-bound-context' : 'loop-no-visible-bound',
      verdict: bounded ? 'BOUNDED' : 'UNBOUNDED',
    };
  }
  if (
    /idempotency[-_ ]?key|Idempotency-Key|idempotencyKey|double.submit|submitting|isSubmitting|disabled\s*=\s*true/u.test(
      line,
    )
  ) {
    return {
      kind: 'idempotency/double-submit-guard',
      bound: 'key-or-guard',
      verdict: 'BOUNDED',
    };
  }
  if (/\.retry\(|retry\(/u.test(line)) {
    return { kind: 'http-retry', bound: 'library-default', verdict: 'REVIEW' };
  }
  return { kind: 'unclassified', bound: 'n/a', verdict: 'REVIEW' };
}

function main(): void {
  const files = SCAN_ROOTS.flatMap((root) => {
    try {
      const out: string[] = [];
      walk(root, out);
      return out;
    } catch {
      return [];
    }
  });

  const sites: RetrySite[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const hit =
        /retry|maxRetries|max_attempts|attempts|40001|40P01|setTimeout|setInterval|while\s*\(|idempotency|Idempotency|double.submit|isSubmitting/u.test(
          line,
        );
      if (!hit) continue;
      const context = lines.slice(Math.max(0, i - 2), i + 3);
      const { kind, bound, verdict } = classify(line, context);
      sites.push({
        file: file.replaceAll('\\', '/'),
        line: i + 1,
        kind,
        bound,
        evidence: line.trim().slice(0, 140),
        verdict,
      });
    }
  }

  const summary = {
    scannedFiles: files.length,
    sites: sites.length,
    bounded: sites.filter((s) => s.verdict === 'BOUNDED').length,
    review: sites.filter((s) => s.verdict === 'REVIEW').length,
    unbounded: sites.filter((s) => s.verdict === 'UNBOUNDED').length,
  };

  console.log(
    `scanned ${files.length} files; ${sites.length} retry-related sites`,
  );
  console.log(
    `bounded=${summary.bounded} review=${summary.review} unbounded=${summary.unbounded}`,
  );
  for (const verdict of ['UNBOUNDED', 'REVIEW'] as const) {
    for (const site of sites.filter((s) => s.verdict === verdict)) {
      console.log(
        `[${verdict}] ${site.file}:${site.line} ${site.kind} (${site.bound}) — ${site.evidence}`,
      );
    }
  }
  // Representative bounded sites for the report table.
  console.log('\n--- representative BOUNDED sites ---');
  for (const site of sites
    .filter((s) => s.verdict === 'BOUNDED')
    .slice(0, 24)) {
    console.log(
      `[BOUNDED] ${site.file}:${site.line} ${site.kind} (${site.bound}) — ${site.evidence}`,
    );
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const dir = join(
    process.cwd(),
    '.local',
    'p8-s6-load',
    `${timestamp}-retry-scan`,
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'retry-sites.json'),
    `${JSON.stringify({ summary, sites }, null, 2)}\n`,
    'utf-8',
  );
  console.log(`\n[P8-S6] retry scan evidence written to ${dir}`);
}

main();
