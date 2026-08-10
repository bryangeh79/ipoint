# P8-S5e Final Gate Record — Cross-Platform Consistency Matrix

> Sub-phase: P8-S5e | Branch: `task/p8-s5e-cross-platform-consistency` @ `6b7dce37` (base `b9d5f876`)
> Merge into phase/8: `b043e932` | Date: 2026-08-10
> Decision: D-068 (OPENCLAW-ACTING-COMMAND-CENTER per D-059, revocable)
> Contract: `P8_S0_CONTRACT_FREEZE.md` §5 (G-05 parts (b)/(d)/(e)) + S5 AC items
> Executor: independent coding subagent (D-060) | Reviewer: independent Reviewer B' (D-060) | Verifier: OpenClaw host integration gate

---

## 1. Verdict

**APPROVED** — Reviewer B' independent review: **0 Critical / 0 High / 0 Medium / 4 Low** (L-A..L-D, documentation precision only, non-blocking, recorded as optional follow-up corrections). No CHANGES REQUIRED condition. All key claims independently reproduced; no fabricated evidence; zero Do-Not-Touch violations.

## 2. Deliverables (docs-only, 3 files, 510 insertions)

| File | Content |
|---|---|
| `P8_S5E_CONSISTENCY_MATRIX.md` | 11 dimensions (permissions, market scope, API/error contracts, decimal/currency, timezone/date, state lifecycles, idempotency, retry, audit, privacy masking, UI capability states) × surfaces (member-web / merchant-web / admin-web / api-client / API / workers). All cells CONSISTENT; 5 Low observations (L-1..L-5) documented with severity + rationale (documented-only per §11). Every cell carries an evidence reference (file/line, test id, or scan output). |
| `P8_S5E_CONTROLLER_MAP.md` | F-04 reconciliation: **45 vs 46/46 vs 48** explained as a count-method artifact, not a deleted controller. `git ls-tree` at P7-era commit points (cf42f843/cd5b94cb/ff0206bd) = 45 controller files each; HEAD = 48 (exactly +3 P8 additions: ads-content, admin-reconciliation-ops, admin-risk-controls; 0 deletions; the only `--diff-filter=D` deletion `5f81e884` predates P7-S10). RBAC spec structure (1 collection assertion + 1 it() per file) makes 45 files → 46 tests, consistent with the P7-S10 "46/46" record. Current spec: **49/49 passed** (48 files + 1 assertion). All 48 controllers have guard coverage (25 RBAC + 1 ADMIN + 18 AUTH + 1 PUBLIC/NONE + 3 mixed). |
| `P8_S5E_DELIVERY_REPORT.md` | Methodology, per-dimension evidence, discrepancy log with severities, F-04/F-06 closure statements, zero-owner-bypass scan (command + scope + result), commit map, assumptions, risks. |

## 3. Reviewer B' key reproduced evidence (host re-runs)

- RBAC matrix spec: `vitest run p7-s10-rbac-matrix.spec.ts` → **49/49 passed** (exit 0)
- Zero-bypass scan (P7-S10 gate-18 method): 307 files / 13 hits — all benign after line-by-line manual review
- Zero-bypass scan (P8 extension `scan-zerobypass.mjs`): **445 files / 5 hits**, 0 DIRECT_SERVICE_INSTANTIATION, 0 frozen-owner direct `new`
- OpenAPI validate: **285 paths / 31 auth ops / 0 missing schemas / 0 duplicate operationId** — all runtime validations passed
- Error-registry cross-check: 444 vs 23 → 12 unmatched (3 local + 3 HTTP method literals + 6 DRAFT codes), all accounted
- Amount-coercion scan: 53 flagged, api-client 0; merchant-model.ts:24/36/48 `Number(mcpBalance)` confirmed (frozen file, documented)
- Enum/type + permission scans: canonical sets consistent across packages/types, api-client, apps
- Route-manifest tests: **5/5 passed**
- F-06 drift set — all 6 items re-verified at Phase 8 state: `merchant-admin.spec.ts` testIgnored (playwright.config.ts, K-02/D-056 annotations), doubled-mount retired paths 404 (p5-r1 spec:302-318), `commission/calculate` 404, deprecated permission aliases zero-granted (isCanonicalPermission gate), `AUTH_REFRESH_REUSED` legacy alias (runtime emits `SESSION_REUSE_DETECTED`), 6 legacy controllers still mounted as documented. **No new drift, no re-activation.**

## 4. Integration gate (OpenClaw host)

- `git diff b9d5f876..6b7dce37 --stat` = **3 files, 510 insertions, all under `docs/06-phase-reports/p8-s5/`** — zero production code, zero migrations, zero checksum changes (40/40 frozen), no `.npmrc`, no `docs/00-master/` change in task branch
- All 3 files byte-verified **UTF-8 without BOM**
- Merge `b043e932` (no-ff) onto `phase/8-final-delivery-readiness`; post-merge `git fsck --connectivity-only` exit 0; tracked files 0 modified
- Repo hygiene (D-067): `git fsck --full` completely clean, single pack 25,783 objects, `git gc --auto` exit 0

## 5. Low findings recorded (non-blocking, optional follow-ups)

| ID | Location | Note |
|---|---|---|
| L-A | Matrix §1.5 | `toISOString()` file count (69) methodology undocumented; numbers to be corrected or scoped (does not affect UTC ISO-8601 conclusion) |
| L-B | Matrix §1.6 | "16 status/type enums" = redemption.ts 14 + agent-activation.ts 2; wording to be adjusted |
| L-C | Matrix §1.5 | market timezone field: actual validation is non-empty string ≤100 chars, not IANA format validation; wording to be tightened |
| L-D | Matrix §1.1 | `scan-perms.mjs` capture semantics fragile (matches first class-code string after route id); add comment + dedup counting |

Optional notes: CONTROLLER_MAP legend PUBLIC vs NONE overlap (health controller); scanner exit-1-on-benign-hits convention to be documented in Delivery Report §7.

## 6. Closure

- F-04: **CLOSED** — 45 vs 46/46 vs 48 fully reconciled; authoritative mapping in `P8_S5E_CONTROLLER_MAP.md`
- F-06: **CLOSED** — drift set re-verified at Phase 8 state, no new drift
- Zero-owner-bypass AC: **PASSED** (445 files / 0 direct bypass)
- Cross-platform contract matrix AC: **PASSED** (11 dimensions, all CONSISTENT, evidence-backed)
- P8-S5e: **COMPLETE / APPROVED** (revocable per D-059). Next: P8-S6 Load / Performance / Concurrency (G-06).
