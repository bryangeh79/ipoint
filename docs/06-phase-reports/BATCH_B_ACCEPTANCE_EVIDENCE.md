# Phase 1 Batch B — Final Acceptance Evidence Package

> Status: PENDING COMMAND CENTER REVIEW
> Generated: 2026-07-17 13:10 MYT
> Author: OpenClaw (evidence compilation)

---

## 1. Repository State

| Item                        | Value                                          |
| --------------------------- | ---------------------------------------------- |
| Repository                  | `bryangeh79/ipoint`                            |
| Phase branch                | `phase/1-merchant-onboarding-mcp`              |
| **Phase branch remote SHA** | **`ff0b49aa76d25e465970eed1292077732194066a`** |
| Governance commit           | `ab61b0168e70d8e4fc22edff9169b092765b0321`     |
| Approved baseline           | `73f94653c541273db2830f146298524a06a65301`     |
| Main merge                  | ❌ NOT PERFORMED                               |
| P1-S8+                      | ❌ NOT ENTERED                                 |

---

## 2. Task Commits

| Sub-phase      | Task branch                       | Completion commit | Integration commit           |
| -------------- | --------------------------------- | ----------------- | ---------------------------- |
| P1-S5          | `task/p1-s5-service-fee-packages` | `4bb8852b...`     | `148a8fde...`                |
| P1-S6          | `task/p1-s6-mcp-ledger-recharge`  | `35a18364...`     | `6946ee1e...`                |
| P1-S7          | `task/p1-s7-mcp-governance`       | `d7b60928...`     | `23bf2e4c...`                |
| Batch B report | —                                 | —                 | `3b8e314d...`, `ff0b49aa...` |

---

## 3. Database Migrations

| Migration                                   | Purpose                                                                                                                                                                        | SHA-256 Checksum |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `0004_service_fee_package_management.sql`   | Service Fee Version/DRAFT/SCHEDULED/ACTIVE/EXPIRED/CANCELLED state machine, special_percentages immutability, merchant_package_change_requests                                 | `f8df637c...`    |
| `0005_mcp_ledger_recharge.sql`              | MCP Account status enum, numeric precision upgrade (38,10), append_mcp_ledger_entry() function, projection guard trigger, ledger insert guard trigger, payload_hash validation | `cfb63d6e...`    |
| `0006_mcp_adjustment_refund_governance.sql` | payload_hash on refund/adjustment requests, governance request identity protection trigger                                                                                     | `fadc6ad6...`    |

All checksums verified via `pnpm db:checksum` ✅

---

## 4. Verification Gates

| Gate                               | Result  | Details                         |
| ---------------------------------- | ------- | ------------------------------- |
| `pnpm format:check`                | ✅ PASS | —                               |
| `pnpm lint`                        | ✅ PASS | ESLint exit 0                   |
| `pnpm typecheck`                   | ✅ PASS | All workspace typecheck scripts |
| `pnpm build`                       | ✅ PASS | All workspace builds            |
| `pnpm test`                        | ✅ PASS | 16 files, 72 tests              |
| `pnpm test:api`                    | ✅ PASS | 12 files, 56 tests              |
| `pnpm test:database`               | ✅ PASS | 2 files, 20 tests               |
| `pnpm db:checksum`                 | ✅ PASS | 7 migrations verified           |
| `pnpm db:migrate` (fresh)          | ✅ PASS | All 7 migrations applied        |
| `pnpm db:seed` (first)             | ✅ PASS | Foundation seed                 |
| `pnpm db:seed` (second/idempotent) | ✅ PASS | No duplicates                   |
| `pnpm db:drift`                    | ✅ PASS | No schema drift                 |

---

## 5. Specific Verification Evidence

### P1-S5 — Service Fee Package Management

- Package version effective-window overlap detection ✅
- Multiple assignment / exactly-one-active-default constraint ✅
- Special percentage boundary (>0% AND <=100%) ✅
- Last-active-package cannot be paused ✅
- RBAC/MarketAccess negative tests (wrong market, unprivileged admin) ✅
- Version reference data immutability after assignment ✅

### P1-S6 — MCP Ledger and Recharge

- Append-only ledger (UPDATE/DELETE rejected via DB trigger) ✅
- Scoped idempotency (same key + payload → cached; same key + different → 409) ✅
- Negative balance prevention ✅
- Recharge exactly-once posting ✅
- MCP projection guard (direct balance update rejected) ✅
- Suspension preserves MCP ✅
- Account balance reconciliation (stored vs computed from ledger) ✅
- Compensation reversal foundation (reversal_of_entry_id) ✅

### P1-S7 — MCP Adjustment, Refund and Activation

- Maker/Checker enforced (maker != checker, no threshold exception, no Super Admin bypass) ✅
- Dual-stage validation (at APPROVAL and EXECUTION) ✅
- Refund foundation (PENDING → UNDER_REVIEW → APPROVED/REJECTED; writes Refund debit on approval) ✅
- Activation condition (Application APPROVED + KYC APPROVED + MCP >= 100 → ACTIVE) ✅
- Post-activation balance drop below 100 does NOT auto-deactivate ✅
- Suspend preserves MCP; Reactivate re-evaluates conditions ✅
- Status history, audit log, entity timeline for all transitions ✅
- Governance request financial identity immutable after creation ✅

---

## 6. Codex CLI Execution Evidence

| Field               | Value                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Session ID**      | `019f6e49-7905-7bf3-9a4e-0cbd835630c3`                                                            |
| **CLI version**     | `codex-cli 0.144.4`                                                                               |
| **Auth mode**       | `ChatGPT subscription` (`Logged in using ChatGPT`)                                                |
| **Model provider**  | `openai` (model: `gpt-5.6-sol`)                                                                   |
| **Custom base URL** | None                                                                                              |
| **Manual API key**  | None                                                                                              |
| **Start time**      | `2026-07-17 12:15:36 MYT` (04:15:36 UTC)                                                          |
| **End time**        | `2026-07-17 12:58:00 MYT` (04:58:00 UTC)                                                          |
| **Duration**        | ~42 minutes                                                                                       |
| **Originator**      | `codex_exec`                                                                                      |
| **Session log**     | `%USERPROFILE%\.codex\sessions\2026\07\17\rollout-2026-07-17T12-15-36-...jsonl` (2,103,655 bytes) |
| **Exit code**       | 0 (normal completion)                                                                             |
| **Final answer**    | Confirmed Batch B complete with all SHAs                                                          |

### Environment Variable Check

| Variable           | Exists?    |
| ------------------ | ---------- |
| `OPENAI_API_KEY`   | ❌ Not set |
| `CODEX_API_KEY`    | ❌ Not set |
| `OPENAI_TOKEN`     | ❌ Not set |
| `CODEX_AUTH_TOKEN` | ❌ Not set |
| `OPENAI_BASE_URL`  | ❌ Not set |
| `OPENAI_API_BASE`  | ❌ Not set |

---

## 7. Repository Hygiene Audit

- `.acceptance/` files: 0 (removed in Batch A hygiene commit)
- `.local/` files: 0 (removed in Batch A hygiene commit)
- `.codex-*-result.txt` files: 0 (removed in Batch A hygiene commit)
- `.gitignore` updated with `.codex-execution-logs/` and `.codex-*.md` patterns ✅
- `.prettierignore` updated with `.codex-*.md` ✅
- Force push: NOT USED
- Stash/clean/amend: NOT USED
- Main merge: NOT PERFORMED

---

## 8. Scope Leakage Audit

| Scope                                                                                                                              | Leaked? |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P1-S5 prohibited items (transaction snapshot, sale calc, receipt, reward, commission, advertising)                                 | NONE    |
| P1-S6 prohibited items (fake payment gateway, production provider, transaction deduction, advertising deduction, negative balance) | NONE    |
| P1-S7 prohibited items (real payment/payout provider, maker self-approval, MarketAccess bypass)                                    | NONE    |
| P1-S8+ code                                                                                                                        | NONE    |
| Main merge                                                                                                                         | NONE    |

---

## 9. Repair Loops

| Gate      | Count | Details                                               |
| --------- | ----- | ----------------------------------------------------- |
| Format    | 1     | Normalized UTF-16LE tracked files                     |
| Lint      | 1     | Matcher typing, Node globals for JS/MJS               |
| API/KYC   | 3     | Swagger route scan, controller injection, OTP fixture |
| Database  | 1     | Expected column order, permission seed count          |
| **Total** | **6** | No gate exceeded max 3                                |

---

## 10. Open Blockers

- **NONE** — all gates pass, no P1-S5/S6/S7 item remains unimplemented, no prohibited scope entered.

---

## 11. Batch B Milestone Report

Already generated and committed:

- **Commit:** `3b8e314d docs(report): record Phase 1 Batch B milestone evidence`
- **Format commit:** `ff0b49aa docs(report): format Batch B milestone evidence`
- **File:** `docs/06-phase-reports/BATCH_B_MILESTONE_REPORT.md`

---

_End of evidence package. Ready for Command Center review._
