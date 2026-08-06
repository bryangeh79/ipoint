# SEC-01 — Final Forward-Only Gate Record (Manual iPoint Adjustment Maker/Checker Owner Remediation)

| Field | Value |
|---|---|
| **Record** | SEC-01 FINAL GATE — manual iPoint adjustment Maker/Checker owner remediation (P7-OD-20) |
| **Status** | `SEC01_OWNER_REMEDIATION_INTEGRATED` / `GATE-SEC-01_RELEASE_PREPARED` / `P7-AC-15_SATISFIED` / `CONTINUING_UNDER_D-055` |
| **Order** | ChatGPT Command Center — D-047 (fix/p3-p7-sec01-ipoint-maker-checker exact scope) + D-055 sequence (SEC-01 → P7-S7) |
| **Date** | 2026-08-06 |
| **Declaration** | OpenClaw internal gate — NOT Command Center acceptance/closure/freeze |

> Forward-only record. Do not delete or rewrite.

---

## 1. Remediation range

| Item | Value |
|---|---|
| **Branch** | `fix/p3-p7-sec01-ipoint-maker-checker` (base `8192fbdd` = phase HEAD incl. S6E final gate record) |
| **Commits** | `b0640b4c` (feat(database): migration 0034) · `b7644429` (feat(wallet): SEC-01 adjustment owner) · `aa575301` (test: owner unit + integration suites) · `5539eb50` (fix(admin-reward): remove immediate adjustment endpoint) · `e5e934cc`/`5761b728`/`e5601e3e` (docs + drift cleanup) |
| **Integration** | Merge `167dc216` (--no-ff, ort, no conflicts) into `phase/7-admin-operations` |
| **Scope** | `apps/api/src/wallet/wallet-adjustment.owner.*` (5) + `wallet.module.ts` + `apps/api/src/admin-reward/*` (6, endpoint removal) + `packages/database` (0034 + checksums + schema + seed + expected-schema + p7-s2c test) + `docs/06-phase-reports/p7-sec01/` — 19 files; `wallet.service.ts` (frozen Phase 3) byte-identical; migrations 0000-0033 byte-identical; checksums 34/34 → 35/35 |

## 2. Owner contract (D-002 C-03 / P7-OD-03/10/11/18/20, GATE-SEC-01)

1. **Maker/Checker dual control**: full lifecycle `DRAFT→SUBMITTED→APPROVED|REJECTED→EXECUTING→EXECUTED|FAILED`; Maker ≠ Checker enforced at runtime (incl. Super Admin acting alone) + hard DB CHECK `checker_admin_user_id <> maker_admin_user_id`; no amount-threshold exemption (D-002 C-03).
2. **Caps routing**: per-market versioned `ipoint_adjustment_market_rules` (MY seed soft 10,000 / hard 100,000); at/below soft → Finance Approver may check; above soft through hard → Super Admin required; above hard → rejected; unconfigured market → explicit not-configured (no fallback); no cap values hard-coded in service.
3. **Evidence contract**: Reason Code (market-scoped catalog incl. high-risk) + explanation + Case/Ticket reference + Maker/Checker identities & timestamps; attachment (opaque reference only) mandatory above soft cap / high-risk / checker request; **above-soft execution disabled** until secure evidence storage approved (`secure_evidence_available=false` default; disable→enable→execute proven).
4. **Idempotency**: operation-scoped `ipoint.adjustment.owner.create:<wallet>:<actor>` + canonical payload hash (sha256, stable-sorted keys incl. amount/direction/reason/prior); same key+payload exact replay; same key+different payload conflict; concurrent first-submit single row; failed attempts never leave a fake success record.
5. **Atomic execution**: single transaction — lock request → revalidate (wallet/market/rules/caps/reason/evidence/secure-storage/Maker inequality) → EXECUTING → direction-aware immutable ledger append (version-guarded, exact before/after, ledger idempotency key) → EXECUTED + immutable audit; injected failure → full rollback (balance/ledger unchanged) → durable FAILED + audit; retry after FAILED never duplicates ledger effect.
6. **Immutability**: REJECTED requests cannot be resubmitted/re-decided; replacement = new request + validated `prior_request_id`; decisions append-only (UNIQUE per request); ledger entries immutable; no status/history overwrite.
7. **P7-AC-15**: immediate endpoint `POST /api/v1/admin/rewards/wallets/:id/adjustment` removed (OpenAPI 239→238 paths; repo-wide zero residual code references; deprecated-route drift set updated).

## 3. Independent review — APPROVED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (independent reviewer, D-048): verdict file `.local/sec01-gate/review/REVIEWER_VERDICT.md` — **APPROVED, 0 Critical / 0 High / 0 Medium / 3 Low + 1 informational** (13/13 dimensions PASS).

## 4. Independent verification — TEST GATE PASSED

`OPENCLAW_MANAGED_CODING_SUBAGENT` (separate verifier, D-048) on fresh isolated databases `ipoint_ver_sec01_*` (Node v24.19.0 ≠ implementer v26.4.0; every count grep-verified): **21/21 gates PASS, 0 FAIL** — checksum 35/35, SEC-01 unit 18/18, SEC-01 integration 22/22 (real PG), S6E 46/46, S6D 41/41, S6A 54/54, S6B 38/38, S6C 49/49, D-051 27/27, D-054 51/51, Phase 3 wallet invariants 68/68, wallet-domain 19/19 (4 pre-existing skips), reward-domain 37/37, api typecheck/build, OpenAPI 238 paths / passed, api-client 75/75, admin-web 250/250, lint 0 problems, prettier clean; endpoint-removal grep zero residue across apps+packages. Behavioral checks all confirmed (Maker≠Checker incl. Super Admin, caps routing boundaries, evidence/attachment rules, above-soft disable→enable, idempotency replay/conflict, concurrent single winner, atomic rollback → FAILED → no-duplicate retry, rejected immutable + replacement linkage). Verdict file `.local/sec01-gate/evidence/VERIFIER_VERDICT.md`.

## 5. Post-integration verification

| Check | Result |
|---|---|
| Phase 7 merge | `167dc216` (--no-ff, no conflicts) |
| Tracked modifications (worktree) | 0 |
| Migration checksums | 35/35 (0034 appended; 0000-0033 byte-identical) |
| Frozen Phase 3 owner | `wallet.service.ts` byte-identical (sha256 verified) |
| `main` | unchanged `69240bf84d7d8e0cf58c86ce25a88a5aa105db05`; no PR/merge/deploy |

## 6. Items escalated for Command Center awareness (non-blocking)

1. **Ledger-command contract interpretation**: frozen `WalletService.createLedgerEntry` is credit-only and self-manages its transaction, so it cannot express DEBIT or compose atomically with request state; SEC-01 therefore adds a direction-aware immutable `appendLedgerEntry` **in the wallet domain** (frozen service untouched), consistent with P7-OD-21 and GATE-SEC-01 "owner-ledger execution". Confirmation requested.
2. **Executor operating model (S7B)**: owner `execute` requires a distinct Maker/Checker decision and any non-maker admin with `wallet.ipoint.adjust.execute` may execute; if checker-only execution is the intended operating model, the S7B adapter/UI should enforce it.
3. **Low-1 cleanup**: dead type-union members in `admin-reward.types.ts` (leftover error codes) to be cleaned in a later same-class pass.
4. **Pre-existing DB-suite debt**: 4 baseline failures (stale migration-count expectations in `phase3-schema.test.ts` / `schema.unit.test.ts`) are byte-identical base↔head and unrelated to SEC-01; recorded for the final delivery report.

## 7. Next steps (D-055 sequence)

P7-S7 (Manual MCP conformance + iPoint admin workflow/UI + finance acceptance; SEC-01 now releases the iPoint consumption path) → SEC-02 → Phase 6 Admin Route Security → P7-S8 → P7-S9 → P7-S10 → Phase 7 Final Delivery Report.

## 8. Declarations

```
SEC01_OWNER_REMEDIATION_INTEGRATED
```

OpenClaw internal gate — NOT Command Center acceptance. P7-S7 starts next under D-055 continuous authorization.

*Forward-only record. Do not delete or rewrite.*
