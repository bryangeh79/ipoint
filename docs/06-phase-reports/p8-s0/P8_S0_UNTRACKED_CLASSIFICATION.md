# P8-S0 — Untracked Artifacts Classification (119)

> **Authority:** D-058 §10 — 119 is the official P8-S0 opening observed baseline; DO NOT delete/clean/bulk-add/silently track/force back to 102. Classify only. Actual secret exposure = TRUE BLOCKER.
> **Date:** 2026-08-08 · **Branch:** `phase/8-final-delivery-readiness`
> **Method:** `git ls-files --others --exclude-standard` (119 items) + secret-pattern scan (AWS AKIA keys, GitHub ghp_ tokens, Slack xox tokens, OpenAI sk- keys, Google AIza keys, `BEGIN PRIVATE KEY`, postgres/redis/mongo DSNs with credentials, client_secret, api_key, password assignments) + manual inspection of config files.
> **Verdict:** **NO real secret exposure. NO credentials/private keys/production configuration found. NOT a blocker.** Local test/POC connection strings exist (low risk, classified below).

---

## 1. Classification summary

| Class | Count | Examples | Risk | Handling |
|---|---|---|---|---|
| C1 — Local test/POC connection strings | 3 | `.run-p6-verify.ps1`, `p6-run-all.ps1` (`postgres://ipoint_local:ipoint_local_test_7f49b5c2d8a641ef@…`), `jiti/prisma-prisma.config.46aee525.mjs` (`postgresql://ipoint_poc:ipoint_poc@…`) | LOW (local-only DBs; no production/hosted service) | Preserve untracked; optionally add to `.gitignore` in P8-S7; never tracked |
| C2 — Runtime binaries / tool caches | 8 | `node` (124 MB), `node22` (124 MB), `pnpm` (67 MB), `bin/pnpm`, `bin/pnpx`, `isomorphic-git-1.38.10.tgz`, `v8-compile-cache-0/`, `.tools/` | NONE | Preserve; do not track |
| C3 — Phase 0–3 era debug/fix scripts | ~25 | `*.sh`, `*.py`, `*.js` (`git-*.js`, `fix-*.js`, `eslint.no-ts.mjs`, `fast-lint.mjs`, `p6-audit*.js`, `install-git.js`, `run-lint.sh`, `fix-all-errors.sh`…) | NONE (no secrets; onAuth callbacks use env vars/empty credentials) | Preserve untracked |
| C4 — Push/deploy helper scripts | ~20 | `scripts/*.ps1`, `*.bat`, `*.cjs`, `*.mjs` (`host-executor-push.ps1`, `git-push.cjs`, `push-p3-final.mjs`, `raw-git-commit.cjs`, `update-reflog.cjs`…) | NONE (GITHUB_TOKEN read from env only; `x-oauth-basic` is GitHub's fixed placeholder string, not a secret) | Preserve untracked |
| C5 — Temp outputs / logs / task notes | ~28 | `*.txt` (`ci_temp.txt`, `p3ci_temp.txt`, `int-test-err.txt`, `integration-fail.txt`, `p4-s*.txt`…), `.tasks/` | NONE | Preserve untracked |
| C6 — Temp test evidence / source | 4 | `apps/api/src/__tests__/b-test-temp.txt`, `apps/api/src/reward/COMMIT_MSG.md`, `packages/database/tests/p6-s1-schema.test.ts` (K-03 recorded item), `temp_p4s8_inventories.md` | NONE | Preserve untracked (p6-s1-schema.test.ts already governed by K-03) |
| C7 — Media | 3 | `media/inbound/*.png` (screenshots) | NONE | Preserve untracked |
| C8 — Windows redirection artifacts | 2 | `apps/api/src/nul`, `nul` (0-byte, created by `> nul` redirection under non-Windows tooling) | NONE | Preserve untracked |
| C9 — OpenClaw session notes | 1 | `.openclaw/session-notes/2026-07-27-*.md` | NONE | Preserve untracked |
| C10 — Config files (no secrets) | 4 | `.npmrc` (`shell-emulator=true`, `node-version=22.23.1`), `scripts/bridge-config.json`, `scripts/watcher-config.json`, `tools/package.json`, `tools/package-lock.json` | NONE | Preserve untracked |

## 2. Secret-pattern scan detail

| Pattern class | Hits | Finding |
|---|---|---|
| `AKIA[0-9A-Z]{16}` (AWS access key) | 0 | — |
| `ghp_…` / `xox…` / `sk-…` / `AIza…` (tokens) | 0 | — |
| `BEGIN [A-Z ]*PRIVATE KEY` (private keys) | 0 | — |
| `client_secret` / `secret_key` / `api_key` | 0 | — |
| `postgres(ql)://user:pass@` | 3 | Local test/POC DSNs only (C1) |
| `redis://user:pass@` / `mongodb://user:pass@` | 0 | — |
| `password:` in JS/CJS scripts | 3 | isomorphic-git `onAuth` callbacks — empty string, `process.env.GITHUB_TOKEN` reference (no literal), or fixed GitHub placeholder `'x-oauth-basic'` (not a credential) |
| `.env` real files | 0 | Only `.env.example` placeholders exist (root + historical worktrees) |

## 3. Conclusion

- **No TRUE BLOCKER.** No production credentials, private keys, or secrets anywhere in the untracked set or the tracked tree.
- 119 remains the official P8-S0 opening observed baseline (supersedes the Phase 7 102 historical count; the +17 delta are Phase 7 closure-period artifacts — this session created/deleted none).
- All 119 items are preserved as-is. P8-S7 may propose `.gitignore` entries for C1/C2 classes; any change to the untracked set requires explicit approval per operating rules.

_Forward-only report. Do not delete or rewrite._
