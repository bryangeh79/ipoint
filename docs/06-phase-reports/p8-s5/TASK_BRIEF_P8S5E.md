# TASK_BRIEF_P8S5E — Cross-Platform Consistency Matrix (G-05 part (b)/(d)/(e))

> Phase 8 · Sub-phase **P8-S5e** · Branch `task/p8-s5e-cross-platform-consistency`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §5 (G-05) scope parts (b), (d), (e) + AC "cross-platform contract matrix verified; controller mapping documented"
> Gap audit: F-04 (controller count 45 vs 46/46) + F-06 (legacy/deprecated path drift set)
> Executor: independent coding subagent (D-060 alternate executor authorization) · Verifier: OpenClaw host integration gate · Reviewer: independent Reviewer B' (D-060)
> Risk class: HIGH (broad integration surface) → A→B→C model

---

## 1. Mission

Produce the **Cross-Platform Consistency Matrix** for iPoint V1 at Phase 8 state: a verifiable, evidence-backed audit that every consumer surface (member-web, merchant-web, admin-web, api-client, API controllers/services, workers) agrees with the canonical API/domain contracts on **permissions, market scope, API/error contracts, decimal/currency/timezone semantics, date handling, state lifecycles, idempotency, retry behavior, audit, privacy masking, and UI capability states**. Plus: reconcile the F-04 controller-count delta (45 vs 46/46) with an exact mapping, and re-verify the F-06 legacy/deprecated drift set. Deliver the matrix as a checked-in document (not a one-off script dump), with every cell backed by a concrete evidence reference (file/line, test, or scan output).

This is primarily a **verification/documentation** sub-phase. No production code changes are expected. If a genuine defect is found, it is handled as a bounded fix per the contract §11 repair policy and §5 Do-Not-Touch.

## 2. Background — what S5a..S5d already closed (do NOT redo)

| Sub-phase | Closed | Evidence |
|---|---|---|
| S5a | admin-web renders all 19 reports (R01–R19), freshness honesty, no-export | `P8_S5A_FINAL_GATE_RECORD.md` (merge `e701ebd3`), admin-web 336/336 |
| S5b | member-web Wallet / Reward / Team / Redemption pages over frozen Phase 3/5/6 backends | `P8_S5B_FINAL_GATE_RECORD.md` (merge `a71d0a46`), member-web 311/311 |
| S5c | merchant-web transactions preview/confirm/receipt/history over frozen Phase 4 endpoints | `P8_S5C_FINAL_GATE_RECORD.md` (merge `7fe4ed28`), merchant-web 24/24 + api-client 100/100 |
| S5d | full-repo Phase 8 CI workflow (`.github/workflows/p8-ci.yml`, 6 jobs, fail-closed guards) | `P8_S5D_FINAL_GATE_RECORD.md` (merge `eb83daaf`), D-066 |

P8-S5e therefore covers ONLY contract §5 parts (b), (d), (e) + the S5 AC items not yet evidenced: **cross-platform contract matrix verified** + **controller mapping documented** (+ re-run of the zero-owner-bypass static scan over the full repo at Phase 8 state).

## 3. Scope — contract §5 parts (b), (d), (e)

### 3.1 (b) Full consistency verification matrix

Verify consistency **across** Member/Merchant/Admin Web + API + api-client + workers for each dimension below. For each dimension, produce a matrix: rows = surface/layer, columns = dimension, cells = status (CONSISTENT / DRIFT / NOT_APPLICABLE) + evidence reference.

1. **Permissions** — every API route's guard permission codes vs `api-client` typed method permission expectations vs UI route/menu/nav permission gates vs admin-web route manifest (38/38). Flag any UI affordance that renders for a role that cannot call the API it invokes (and vice versa: any permission code the UI references that no API guard uses). Evidence: RBAC scan (mirror P7-S10 gate-18 static scan, extended to all P8 code), route manifests, api-client source.
2. **Market scope** — every API controller's market-scoped behavior (current-market resolution, cross-market 409/403, resource-market consistency) vs UI current-market context handling (market switch, x-market-id headers, market-scoped lists). Zero cross-market fallback allowed. Evidence: controller scan + UI market-context code paths.
3. **API/error contracts** — OpenAPI (266 paths baseline, P8 additions) vs api-client error mapping vs UI error rendering. Error code sets must match the canonical error registries (Phase 3/4/5/6/7 registries + P8 additions); no UI string that invents an error the API cannot produce; no api-client mapping that swallows a real API error code. Evidence: `openapi:validate`, error registry diffs, api-client error-map diff.
4. **Decimal/currency semantics** — amounts travel as exact-decimal strings (`numeric(38,10)` shape) end-to-end; no `Number(`/`parseFloat(` on any amount path in api-client or UI (mirror the S5a rule); currency codes consistent (MYR etc.); never fabricated zero. Evidence: static scan for numeric coercion on amount paths across all apps + api-client; per-surface spot checks.
5. **Timezone/date handling** — API timestamps UTC ISO-8601; UI local-time rendering consistent; asOf/freshness semantics identical across surfaces; no client-side date arithmetic that shifts financial dates. Evidence: spot checks + type/format audits.
6. **State lifecycles** — every state machine (orders, fulfilment, refund, redemption, commission, reconciliation exceptions, maker/checker, risk queues) has ONE canonical enum/types definition; api-client and UI consume the canonical set; UI renders every state the API can emit (no unknown-state crash, no invented state). Evidence: enum/type diff across packages/types, api-client, apps.
7. **Idempotency** — idempotency-key semantics consistent: one key per attempt, reuse rules, reset rules, double-submit guards (mirror S5c findings); api-client exposes the same idempotency contract the API enforces; UI passes keys per contract (never regenerates mid-flight). Evidence: api-client + UI write-path audit + API idempotency spec cross-check.
8. **Retry behavior** — bounded retries only; no unbounded retry loops; retry-safe for idempotent operations; UI/worker retry copy does not claim guarantees the API does not provide. Evidence: worker + api-client retry audit.
9. **Audit** — every mutating journey writes audit via canonical audit infrastructure; UI/API surfaces do not bypass audit (no direct owner invocation). Evidence: audit coverage scan + zero-bypass static scan (below).
10. **Privacy masking** — masking rules (KYC, phone, email, vouchers, ledger raw views) identical across API responses, api-client, and UI rendering; no surface unmasks what another masks. Evidence: masking spot-check matrix.
11. **UI capability states** — FRESH / STALE / UNAVAILABLE / loading / disabled / empty-state semantics consistent with API freshness contract; no fabricated zero on unavailable; no capability state that the API cannot produce. Evidence: per-surface capability-state audit (mirror S5a honesty contract).

### 3.2 (d) F-04 — Controller count reconciliation (45 vs 46/46)

- Gap audit records **45 controller files** vs the **46/46 guarded** RBAC scan recorded at P7-S10 gate. Root cause hypothesis in the audit: one controller file removed/merged during SEC-01/SEC-02/P6-R2 work. Note: current scan shows **48** `*.controller.ts` files under `apps/api/src` — enumerate precisely (what counts as a controller, what the P7-S10 "46/46" guard counted, whether specs/exports affect the count) and produce the **exact mapping** (controller file → guard status → RBAC scan row).
- Deliverable: `P8_S5E_CONTROLLER_MAP.md` — authoritative controller inventory with per-file guard coverage, explaining the 45/46/48 discrepancy definitively. Update the F-04 row of the gap audit to CLOSED with the mapping reference (documentation only — do not edit P8_S0_GAP_AUDIT_REPORT.md itself; record in the delivery report).

### 3.3 (e) F-06 — Legacy/deprecated path drift re-verification

- Re-verify at Phase 8 state: `merchant-admin.spec.ts` remains testIgnored (documented D-056); deprecated routes/aliases maintained as the K-04/D-056 drift set are still exactly that set (no new drift, no re-activation); no legacy path bypasses the canonical security chain.
- Deliverable: drift-set verification table (path → status → evidence), recorded in the delivery report. Any NEW deprecated/legacy path discovered must be flagged (severity-classified) — do not silently repair.

### 3.4 Zero-owner-bypass static scan (S5 AC, re-run at Phase 8 state)

- Re-run the canonical-owner static scan over the FULL repo at Phase 8 state (P7-S10 gate 18 scanned 292 files, 0 direct owner bypass; P8-S1..S4 added new code that must be re-scanned). Assert: zero direct invocation of frozen owners outside the adapter/delegation pattern (Phase 5/6/7 owners frozen).
- Deliverable: scan scope + result (expected 0 bypass) recorded in the delivery report.

## 4. Do Not Touch (frozen / prohibited)

- ❌ `apps/api/` production code, `packages/database/` (incl. migrations/checksums 40/40), frozen Phase 3–7 owners, `docs/00-master/`.
- ❌ No production-code changes at all **unless** a genuine defect is proven — then apply the contract §11 bounded repair policy (Critical/High → bounded repair round 1 → independent review/verification → round 2 → only then Command Center), with a written fix record. Cosmetic drift (style, copy) is recorded, not "fixed".
- ❌ No weakening/skipping of existing guards or tests; no deletion of tests; no TypeScript strictness reduction.
- ❌ No CSV/download/export surface creation; no new permission codes.
- ❌ No merge to `main`, no push to `main`, no production deployment, no destructive DB operations.

## 5. Definition of done (verifier will check)

1. `docs/06-phase-reports/p8-s5/P8_S5E_CONSISTENCY_MATRIX.md` — the 11-dimension × surface matrix with per-cell status + evidence reference (file/line or test id or scan output). Every DRIFT cell has a severity (C/H/M/L) and either a bounded-fix record or an explicit rationale for documenting-only.
2. `docs/06-phase-reports/p8-s5/P8_S5E_CONTROLLER_MAP.md` — exact controller inventory reconciling 45 vs 46/46 (and 48 raw files) with per-file guard/RBAC coverage.
3. F-06 drift-set verification table (in the delivery report) — every legacy/deprecated path re-verified, no new drift.
4. Zero-owner-bypass static scan re-run — scan command + scope + result (0 bypass) in the delivery report.
5. Delivery report `docs/06-phase-reports/p8-s5/P8_S5E_DELIVERY_REPORT.md` — methodology, evidence summary per dimension, discrepancy log with severity, F-04/F-06 closure statements, commit map, assumptions, and (if any) bounded-fix records.
6. Evidence commands actually run and summarized (RBAC scan, controller inventory, static scans, error-registry diffs, enum/type diffs, openapi validate on current state) — outputs summarized, not fabricated; where a scan tool does not exist in-repo, the implementer writes a throwaway scanner under the worktree only (never committed as production tooling unless authorized) and records its method.
7. Zero changes to frozen owners / production code (except documented bounded fixes). Worktree `.npmrc` must not be committed. UTF-8 no BOM.
8. Scoped commits: `docs(p8-s5e): add cross-platform consistency matrix` (+ controller map, delivery report; separate scoped commits per artifact if preferred). No production files in the commit set.

## 6. Deliverables

- `docs/06-phase-reports/p8-s5/P8_S5E_CONSISTENCY_MATRIX.md`
- `docs/06-phase-reports/p8-s5/P8_S5E_CONTROLLER_MAP.md`
- `docs/06-phase-reports/p8-s5/P8_S5E_DELIVERY_REPORT.md`
- Optional bounded-fix commits (only per §11 repair policy, with fix records)

## 7. Notes / guidance for the executor

- Read first: `P8_S0_CONTRACT_FREEZE.md` §5, `P8_S0_GAP_AUDIT_REPORT.md` (F-04/F-06 rows), `P7-S10_FINAL_GATE_RECORD.md` (gate-18 RBAC scan method), `P7-S9`/`P8-S4` report-owner contracts, the error-code registries under `docs/04-engineering/`, and the S5a–S5d delivery reports for what is already evidenced (reuse their evidence; do not regenerate identical work).
- The matrix is a living artifact for P8-S9 (Production Readiness Gate) and P8-S10 (Final Delivery Report) — write it so a later verifier can re-run each check from the evidence references.
- Where a dimension is NOT_APPLICABLE for a surface, say so explicitly with a one-line reason.
- Severity guide: Critical = financial invariant/security bypass; High = broken contract a real user journey hits; Medium = contract drift with no current user-visible break; Low = cosmetic/documentation drift.
- Verifier expectation: this sub-phase is evidence-heavy; the quality bar is *every claim traceable*. Do not pad the matrix with unverifiable assertions.
