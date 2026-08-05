# P7-S6C — Final Forward-Only Gate Record (Canonical Owner Rewire, CG-03)

| Field | Value |
|---|---|
| **Record** | P7-S6C FINAL GATE — redemption-rate configuration rewired to the D-053 secured canonical Phase 6 owner |
| **Status** | `D-053_OWNER_REMEDIATION_INTEGRATED` / `CG-03_REDEMPTION_RATE_OWNER_GATE_PASSED` / `P7-S6C_DELIVERY_COMPLETE` / `P7-S6C_OPENCLAW_INTERNAL_GATE_PASSED` / `CONTINUING_UNDER_D-047_D-048_D-049_D-050_D-051_D-052_D-053` |
| **Order** | ChatGPT Command Center — D-053 §15 (P7-S6C canonical rewire) + HOST ADMIN ORDER (2026-08-05) |
| **Date** | 2026-08-05 |
| **Supersedes** | `P7-S6C_PAUSED_DEPENDENCY_GATE.md` (retained unmodified; provisional status superseded) |

> Forward-only record. OpenClaw internal gate — NOT Command Center acceptance.

---

## 1. Rewire range

| Item | Value |
|---|---|
| **Branch** | `task/p7-s6c-redemption-config` (updated to latest Phase 7 HEAD incl. D-053 via merge `ee4dcb3f`) |
| **Commits** | `6b1bebad` (refactor: rewire adapter to canonical Phase 6 owner) · `8b427f91` (feat api-client: cancellation typed client) · `631752e0` (feat admin-web: cancellation orchestration behind owner capability gate) · `77f5b7ef` (docs: rewiring delivery report) |
| **Pushed** | `task/p7-s6c-redemption-config` @ `77f5b7ef` (local = remote) |
| **Scope** | `apps/api/src/admin-redemption-ops/**` (8) + `packages/api-client/src/**` (2) + `apps/admin-web/src/**` redemption-config files (7) + rewiring report (1) — 18 files; `redemption/**` (owner) byte-identical, zero migration/permission-catalog change |

## 2. What was removed (adapter-owned controls)

Idempotency storage/claims (`merchant_api_idempotency_keys` writes, scope, `canonicalPayloadHash`); privileged audit creation (`AuditService` injection + `ADMIN_REDEMPTION_RATE_VERSION_CREATED`); session-level advisory lock (`pg_advisory_lock/unlock`); overlap pre-check (chain semantics); rate-bound business validation (in-memory rules map + provider removed); any direct `redemption_rate_versions` write. The adapter's 5 DB accesses are all `.select()` read projections.

## 3. What was preserved / added

- Creation and cancellation route **exclusively** through the secured canonical Phase 6 owner (`RedemptionService.createRateVersion` / `cancelRateVersion`) with `reason` + `Idempotency-Key` + RbacGuard `currentMarketId`/`marketContextVersion`.
- Read projections (exact precision, window status SCHEDULED/ACTIVE/SUPERSEDED/EXPIRED/CANCELLED, local + resolved UTC); explicit blocked state for unconfigured markets (`configured:false`, 422 `REDEMPTION_RATE_MARKET_BLOCKED`, no cross-market fallback).
- Typed api-client cancellation method (append-only); Admin Web cancellation affordance gated by `redemption.rate.manage` + sensitive-admin-write environment (double gate), SCHEDULED-only, mandatory reason, auto Idempotency-Key; Cancelled badge state.
- Owner error mapping 18/18 codes → external contract (no swallow to 2xx; unknown codes rethrow → 500).

## 4. D-053 contract deltas (recorded, tested)

1. **Legal successor versions now return 201** (D-053 §8/§9 half-open successor contract; pre-D-053 surface rejected any second version with 409 OVERLAP). Same-start still 409 `REDEMPTION_RATE_OVERLAP`; predecessor projected SUPERSEDED; historical rows byte-identical.
2. **Cancel response rate normalization**: cancel returns the owner-normalized value (`1.55`); create response reads back full stored precision (`1.5500000000`); read projection always full precision — explicit contract with tests.

## 5. Independent review — APPROVED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (independent reviewer, D-048): **17/17 dimensions PASS, 0 Critical / 0 High** (owner-only create/cancel delegation, no duplicated controls, 18/18 error mapping, contract deltas consistent, double-gated UI, no drift, evidence consistent, clean worktree). Verdict file `.local/s6c-gate/review/REVIEWER_VERDICT.md`.

## 6. Test gates

### 6.1 Host matrix (Node v26.4.0 / pnpm 9.15.9, real PostgreSQL, fresh isolated DBs)

| Gate | Result | Exit | Log |
|---|---|---|---|
| Migration checksum | **32/32** | 0 | `01-checksum.log` |
| S6C unit | **19/19** | 0 | `02-s6c-unit.log` |
| S6C PostgreSQL integration | **30/30** | 0 | `03-s6c-integration.log` |
| Phase 6 redemption regression (11 files) | **235/235** | 0 | `04-redemption-regression.log` |
| D-053 owner regression | **59/59** | 0 | `05-d053-owner.log` |
| P7-S6B regression | **38/38** | 0 | `06-s6b-regression.log` |
| api-client typecheck / test / build | exit 0 / **66/66** / exit 0 | 0 | `07/08/09` |
| admin-web typecheck / test / build | exit 0 / **209/209** / exit 0 | 0 | `10/11/12` |
| api typecheck / build | exit 0 / exit 0 | 0 | `13/14` |
| OpenAPI | **237 paths / 0 missing / 0 duplicate — ✅ passed** (non-self-exit quirk; killed after PASS) | 0 | `15-openapi-rerun.log` |
| Lint (changed paths) | 0 errors (7 admin-web ignore warnings, existing convention) | 0 | `16-lint-changed-rerun.log` |
| Format (changed paths) | Prettier clean | 0 | `17-format-changed-rerun.log` |

DBs: `ipoint_gate_s6c` (self-managed), `ipoint_gate_s6c_redem` (pre-migrated+seeded), `ipoint_gate_s6c_d053`, `ipoint_gate_s6c_s6b`. Every suite migrated + seeded.

### 6.2 Independent verification — **TEST GATE PASSED**

`OPENCLAW_MANAGED_CODING_SUBAGENT` (separate verifier, D-048) independently re-ran the key matrix on **fresh isolated databases** (Node v24.19.0): checksum 32/32, S6C unit 19/19, S6C integration 30/30, redemption regression 235/235, D-053 owner 59/59, S6B 38/38, S6A 36/36, api-client 66/66 + typecheck/build, admin-web 209/209 + typecheck/build, api typecheck/build, OpenAPI 237 paths / 0 errors, eslint/prettier — **all PASSED**. Verdict file `.local/s6c-gate/evidence/VERIFIER_VERDICT.md`.

## 7. Integration and post-push verification

| Check | Result |
|---|---|
| Merge commit | `24a88c54` (merge branch 'task/p7-s6c-redemption-config' into `phase/7-admin-operations`, --no-ff, no conflicts) |
| `77f5b7ef` ancestor of Phase 7 HEAD | ✅ |
| D-053 integration `09279dc5` ancestor of Phase 7 HEAD | ✅ |
| Migration 0031 unique + complete; 32 migration files | ✅ |
| Migration checksums | ✅ 32/32 (post-integration re-run) |
| Tracked modifications | ✅ 0 |
| Historical untracked artifacts | ✅ 102 (after this record's commit; the draft itself is the +1 before commit) |
| `main` | ✅ unchanged `69240bf84d7d8e0cf58c86ce25a88a5aa105db05` |
| No Main PR / Merge / Deployment | ✅ (gh pr list --base main empty; main untouched) |
| No secrets / probe / cache / `.local` evidence committed | ✅ pushed range scan clean |

*Post-push local = remote verification recorded in the commit that adds this record.*
