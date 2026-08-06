# D-051 — Final Forward-Only Gate Record (Phase 1 Special-Percentage Owner Remediation)

| Field | Value |
|---|---|
| **Record** | D-051 FINAL GATE — Phase 1 special-percentage canonical owner remediation (mandatory reason + idempotency + atomic audit) |
| **Status** | `D-051_OWNER_REMEDIATION_INTEGRATED` / `P7-S6A_WRITE_SURFACE_REMAINS_BLOCKED_UNTIL_REWIRE` / `CONTINUING_UNDER_D-055` |
| **Order** | ChatGPT Command Center — D-051 (special-percentage reason/audit) + D-055 full continuous completion authorization (2026-08-06) |
| **Date** | 2026-08-06 |
| **Declaration** | OpenClaw internal gate — NOT Command Center acceptance/closure/freeze |

> Forward-only record. Do not delete or rewrite.

---

## 1. Remediation range

| Item | Value |
|---|---|
| **Branch** | `fix/p1-p7-special-percentage-owner` (base `69537e7c` = phase HEAD incl. S6D final gate record) |
| **Commits** | `5aa46870` (feat(database): migration 0033 reason column) · `c4257a8a` (feat(merchant): secured special-percentage owner command) · `fb4dc276` (test: evidence suite) · `5b7921c3` (docs: delivery report) |
| **Integration** | Merge `dd481bd4` (--no-ff, ort, no conflicts) into `phase/7-admin-operations` |
| **Scope** | `apps/api/src/merchant/**` (dto/controller/errors/service/types + package.dto.spec) + `apps/api/src/__tests__/d051-special-percentage.owner.integration.spec.ts` + `packages/database` (0033 + checksums + schema + expected-schema) + delivery report — 12 files, 2249+/38-; `admin-package-ops/**` (S6A) byte-identical (blocked surface retained); migrations 0000-0032 byte-identical; checksums 33/33 → 34/34 |

## 2. Owner contract (all inside the canonical Phase 1 owner command)

1. **Authorization**: `merchant.special_package.manage` re-checked server-side via `RbacService.isAllowed` (ACTIVE admin + ACTIVE account + non-revoked grant; SUPER_ADMIN-only catalog); transport guards defense-in-depth only. Server Current Admin Market required and must equal command market; market ACTIVE + active `market_access` grant; revoked grant denies next request.
2. **Mandatory reason**: DTO `z.string().trim().min(1).max(500)` + owner re-check → `SPECIAL_PERCENTAGE_REASON_REQUIRED` 400; migration 0033 `reason` column + CHECK; legacy NULL never backfilled (2 dedicated tests).
3. **Idempotency**: operation-scoped `package.special.owner.create:<marketId>:<adminUserId>` (dedicated scope, pre-D-051 rows never replayed); canonical payload hash (operation/market/rate/description/reason/actor scope); same key+payload exact replay; same key+different payload 409 `SPECIAL_PERCENTAGE_IDEMPOTENCY_CONFLICT`; concurrent same-key one committed row.
4. **Atomic immutable audit**: row + idempotency claim + `SPECIAL_PERCENTAGE_CREATED` audit (reason/actor/market/idempotencyDigest) in one DB transaction via `AuditService.appendWithinTransaction`; injected audit failure → 500 + full rollback (row/claim/audit absent) + retry succeeds — no false replay record.
5. **Actor immutability**: `createdByAdminUserId` only from server actor (session + RbacGuard `adminMarketContext`); DTO `.strict()` rejects actor-shaped fields; in-process callers cannot override creator.
6. **Assignments pinning**: owner create touches only `special_percentages`; `merchant_package_assignments` byte-identical before/after (tested); `assign`/`set-default` remain the only explicit audited reassignment paths.
7. **History/frozen integrity**: no historical row changed; immutable trigger (migration 0004) untouched; 0033 is append-only column + CHECK; schema/expected-schema reflect only the appended column.

## 3. Independent review — APPROVED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (independent reviewer, D-048): verdict file `.local/d051-gate/review/REVIEWER_VERDICT.md`:
- **APPROVED — 0 Critical / 0 High / 0 Medium / 3 Low** (L-1 stale owner-gap comment in `admin-package-ops.module.ts` — to be corrected during S6A rewire; L-2 `SPECIAL_PERCENTAGE_CREATE_FAILED` mapped 409 vs 500 semantics on an unreachable-in-practice path; L-3 OpenAPI evidence log exit 143 = PASS_DETECTED wrapper quirk — all non-blocking).
- 12/12 dimensions PASS (authorization, reason contract, idempotency, atomic audit, actor immutability, assignments pinning, history/frozen integrity, scope boundary, tests, error mapping, DB constraints, no unrelated changes).

## 4. Independent verification — TEST GATE PASSED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (separate verifier, D-048) on fresh isolated databases `ipoint_ver_d051_*` (Node v24.19.0 — different from implementer's v26.4.0; counts grep-verified from logs): checksum 34/34, D-051 owner suite 27/27, DTO unit 19/19, S6A 34/36 (2 failures independently confirmed as by-design — pre-remediation gap tests posting without `reason` now correctly 400, direct positive evidence of the fix; rewiring belongs to the S6A rewire dispatch), S6B 38/38, S6C 49/49, D-054 owner 51/51, P5-R1 13/13, api typecheck/build clean, OpenAPI 238 paths / 0 errors, eslint 0 errors, prettier clean. Behavioral spot-checks: same-key/different-payload 409; injected audit failure atomic rollback; non-SUPER_ADMIN 403; missing/blank reason 400; reason row + immutable audit persisted; assignments zero-change. Verdict file `.local/d051-gate/evidence/VERIFIER_VERDICT.md`.

## 5. Post-integration verification

| Check | Result |
|---|---|
| Phase 7 merge | `dd481bd4` (--no-ff, no conflicts) |
| Tracked modifications (worktree) | 0 |
| Migration checksums | 34/34 (0033 appended; 0000-0032 byte-identical) |
| S6A surface | byte-identical (create surface still blocked 404 until rewire) |
| `main` | unchanged `69240bf84d7d8e0cf58c86ce25a88a5aa105db05`; no PR/merge/deploy |
| Push / local = remote | PENDING — host push channel temporarily unavailable (see S6D gate record §6; batch push planned on first available channel) |

## 6. Next steps (D-055 sequence)

1. **P7-S6A rewire**: rewire `admin-package-ops` create surface to the secured Phase 1 owner (`PackageService.createSpecialPercentage` with mandatory reason + Idempotency-Key + server actor/market), correct the stale owner-gap comment (reviewer L-1), rewrite the 2 by-design failing gap tests to the post-remediation contract, run S6A final gate.
2. **O-13** verification/remediation, then S6E → SEC-01 → S7 → SEC-02 → Phase 6 Admin Route Security → S8 → S9 → S10 → Phase 7 Final Delivery Report.

## 7. Declarations

```
D-051_OWNER_REMEDIATION_INTEGRATED
```

OpenClaw internal gate — NOT Command Center acceptance. P7-S6A rewire starts next under D-055 continuous authorization.

*Forward-only record. Do not delete or rewrite.*
