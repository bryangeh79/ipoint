# P8-S5d Final Gate Record — Full-Repo Phase 8 CI Workflow

> Gate type: **Host verification + independent review (2 rounds) + acceptance**
> Date: 2026-08-10 · Branch: `task/p8-s5d-full-repo-ci` → merge target `phase/8-final-delivery-readiness`
> Gate keeper: OpenClaw (project GM, D-059/D-060 authorization) · Reviewer: Independent Reviewer B' (D-060)

## 1. Scope

Close gap audit F-03 / contract §5 G-05 part (c): a full-repo Phase 8 CI workflow `.github/workflows/p8-ci.yml` covering all 4 apps (api, member-web, merchant-web, admin-web), all 8 packages, and the four P8 fail-closed integration suites (P8-S1..S4) against dedicated `ipoint_p8sN_*` databases with their destructive-test opt-in guards. Plus the required merchant-web test infrastructure wiring (vitest workspace registration).

## 2. Host verification results (Node v26.4.0, pnpm 9.15.9)

| Gate | Result | Evidence |
|---|---|---|
| YAML parse | ✅ | `yaml.load` OK — jobs: quality, build, unit, database, openapi, api-integration; on: workflow_dispatch/push/pull_request; permissions contents:read; concurrency cancel-in-progress |
| Guard env table | ✅ | P8-S1..S4 spec paths + `ipoint_p8sN_*` patterns + `P8SN_DESTRUCTIVE_TEST` opt-ins match the real fail-closed guards in each spec (reviewer cross-checked); guarded steps use step-level env with dedicated test DBs; never run against ipoint_ci |
| quality | ✅ | lint 0 errors (2 pre-existing warnings); prettier scoped check green; repo-wide typecheck (11 projects, api/database excluded + build-config src checks) green |
| build | ✅ | `pnpm -r --if-present build` — 13 projects green (merchant-web re-enabled after TS2322 fix) |
| unit | ✅ | 2,070 tests local: node-unit 1,416 + member-web 311 + merchant-web 24 + admin-web 319 (excludes documented baseline/flaky files) |
| database | ✅ | checksum 40/40 → migrate (40/132) → seed×2 idempotent → drift clean → db tests 64/64 → integration 22/22 → post-checksum/drift clean |
| openapi / api-integration | ✅ | api build + openapi:validate (0 duplicate operationId); P8 guarded suites run green locally (S1 12/12, S2 18/18, S3 20/20, S4 32/32) |
| **TS2322 (P8-S5c defect)** | ✅ FIXED | merchant-web `transactions-page.tsx:752` `error.body.message` (`string \| string[]`) → normalized `ApiError.message`; fixed on main `5326c3de` and cherry-picked as `fdbe9000` (patch-id identical, reviewer-verified); merchant-web typecheck/build/tests re-verified green; exclusion removed from workflow |

## 3. Independent review (Reviewer B', D-060)

- **Round 1**: CHANGES REQUIRED — H-1 (verify the TS2322 fix is actually on the tree and the quality/build jobs truly go green at HEAD; reviewer could not confirm from the worktree alone), M-1 (workflow still referenced merchant-web exclusions), L-1..L-3 (exclusion-table wording, follow-up ownership, patch provenance note).
- **Round 2: APPROVED** — H-1 confirmed: `fdbe9000` patch-id identical to `5326c3de`, patch on tree, merchant-web typecheck + build re-run exit 0, quality/build jobs genuinely green at HEAD. M-1 confirmed: §3.3/workflow agree, no merchant-web exclusion residue. L-1/L-2/L-3 recorded in the follow-up table (§10, owner OpenClaw, target P8-S5e/S9). Quick regression all green (lint, prettier, YAML, diff scope 5 files in expectation). Remaining 3 Lows are non-blocking tracking items.
- Reports: `P8_S5D_REVIEW_REPORT.md` (round 1), `P8_S5D_REVIEW2_REPORT.md` (round 2).

## 4. Acceptance decision

Under D-059 (Command Center proxy authorization, revocable) and D-060 (alternate executor), **P8-S5d is ACCEPTED**:
- Full-repo Phase 8 CI workflow with 6 jobs ✅
- Four P8 guarded suites wired with exact fail-closed guard semantics ✅
- Baseline-failing files documented and scoped out with compensation checks (no silent masking; TS2322 fixed outright) ✅
- merchant-web test infrastructure wired (vitest workspace) ✅
- Zero apps/packages/governance changes; no secrets; no `git add .` ✅

**Decision ID: D-066** · Recorded in DECISION_LOG.md · PHASE_REGISTRY.md updated.

## 5. Merge

- Source: `task/p8-s5d-full-repo-ci` @ `edc1c419`
- Target: `phase/8-final-delivery-readiness` (head `5326c3de` — includes the same TS2322 fix as `fdbe9000`; identical patch-id, merge-safe)
- Commits: `92517b5a` docs (brief) · `62e95458` ci (workflow) · `bc06a7ab` docs (delivery report) · `c730e6cf` ci (re-enable merchant-web after fix) · `fdbe9000` fix (TS2322 cherry-pick) · `0ad80dcb` docs (address round-1 findings) · `d4ca94d9` docs (round-1 report) · `edc1c419` docs (round-2 approval)
- Method: fast-forward merge; no `git add .`; no untracked files touched; `.npmrc` excluded.

## 6. Follow-ups (tracked, non-blocking)

- L-1/L-2/L-3 → P8-S5e/S9 (OpenClaw owner): exclusion-table wording alignment, pwa-policy/flaky-test coverage decision, patch-provenance documentation pattern.
