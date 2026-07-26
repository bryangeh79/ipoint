# OPENCLAW PHASE 4 READINESS HANDOFF REPORT

> **Prepared:** 2026-07-23 19:03 MYT (UTC+8)
> **Author:** OpenClaw (Project General Manager)
> **Status:** PHASE_4_PLANNING_PREPARATION_AUTHORIZED / PHASE_4_IMPLEMENTATION_FORBIDDEN
> **Audience:** New ChatGPT Command Center

---

## 1. Governance State

| Governance Item | Status |
|---|---|
| Baseline Acknowledgment V1.1 | **APPROVED** |
| Phase 0 | **CLOSED** (D-009) |
| Phase 1 | **COMPLETE / ACCEPTED** (D-013) |
| Phase 2 | **COMPLETE** (D-027) |
| Phase 3 | **ACCEPTED / COMPLETE / FROZEN** (D-029) |
| Phase 4 | **NOT_AUTHORIZED** |
| Main Merge | **NOT_AUTHORIZED** |
| Production Deployment | **NOT_AUTHORIZED** |
| PR #4 (Phase 0) | **MERGED** |
| Latest Decision | D-029 (Phase 3 Acceptance) |

---

## 2. Phase 3 Accepted SHA and CI Run

| Item | Value |
|---|---|
| **Phase 3 Final Code SHA** | `2ed57f4eedb6b99d316a20813b0fffa8e500d5a7` |
| **Phase 3 Final Governance SHA** | `a2ab124068a6114c3d267298597f8d175206a40e` (D-029 recorded) |
| **Phase 3 CI Run** | **30000394880** |
| **Phase Branch** | `phase/3-multi-market-wallet-reward-ledger` |
| **Task Branch** | `task/p3-s1-wallet-reward-contract-freeze` |
| **Current D-029 HEAD** | `a2ab1240` — `docs(governance): record Phase 3 acceptance D-029 — COMPLETE/ACCEPTED/FROZEN` |

> Note: The accepted **code** SHA is `2ed57f4e`. The governance commit `a2ab1240` (which records D-029) sits on top and is the current HEAD of the phase branch. Both are on origin.

---

## 3. Repository Current Branch and SHA

| Item | Value |
|---|---|
| **Current Local Branch** | `task/p3-s1-wallet-reward-contract-freeze` |
| **Local HEAD SHA** | `a2ab124068a6114c3d267298597f8d175206a40e` |
| **HEAD Message** | `docs(governance): record Phase 3 acceptance D-029 — COMPLETE/ACCEPTED/FROZEN` |

---

## 4. origin/main Current SHA

| Item | Value |
|---|---|
| **origin/main SHA** | `69240bf84d7d8e0cf58c86ce25a88a5aa105db05` |
| **origin/HEAD SHA** | `69240bf8` (same as origin/main) |

---

## 5. origin/Phase 3 Current SHA

| Item | Value |
|---|---|
| **origin/phase/3-multi-market-wallet-reward-ledger SHA** | `a2ab124068a6114c3d267298597f8d175206a40e` |
| **GitHub connectivity to ls-remote** | ✅ `69240bf8` returned successfully |

---

## 6. Ahead/Behind Status

| Metric | Count |
|---|---|
| **Phase 3 branch ahead of origin/main** | 156 commits |
| **Phase 3 branch behind origin/main** | 0 commits |
| **HEAD vs origin/phase/3-multi-market-wallet-reward-ledger** | IDENTICAL (a2ab1240) |

---

## 7. Tracked Worktree Status

| Metric | Count |
|---|---|
| **Tracked modifications** | 1 file |
| **Changes not staged** | None |
| **Untracked items** | 69 files/directories |

### Tracked Modification

| File | Issue |
|---|---|
| `scripts/codex-supervisor.ps1` | CRLF→LF line-ending conversion (benign whitespace; trailing whitespace on lines 66, 70, 73 reported by `git diff --check`) |

### Untracked Files Categorization

| Artifact Path | Tracked/Untracked | Likely Owner | Likely Purpose | Safety |
|---|---|---|---|---|
| `.tools/` | Untracked | Bridge tools | Execution bridge tooling | Uncertain |
| `node/` | Untracked | Host executor | Local Node binary extraction | Move outside repo |
| `node22/` | Untracked | Host executor | Local Node v22 binary | Move outside repo |
| `pnpm/` | Untracked | Host executor | Local pnpm binary | Move outside repo |
| `tools/` | Untracked | Host executor | Execution tools | Move outside repo |
| `v8-compile-cache-0/` | Untracked | Node runtime | V8 compilation cache | Delete (auto-generated) |
| `test/` (root) | Untracked | Likely accidental | Empty or ephemeral test artifact | Delete |
| `nul` | Untracked | Accidental | Redirect artifact | Delete |
| `isomorphic-git-1.38.10.tgz` | Untracked | Host bridge | Git fallback package | Uncertain |
| `fix-symlinks.js`, `git-audit.js`, `git-execute.js`, `git-helper.js` | Untracked | Host bridge | Symlink/git helper scripts | Move outside repo |
| `scripts/bridge-*`, `scripts/push-*`, `scripts/fix-*`, `scripts/p3-*`, `scripts/git-*`, `scripts/raw-*`, `scripts/install-*`, `scripts/pnpm*`, `scripts/deploy-*`, `scripts/watcher-*`, `scripts/verify-*`, `scripts/wave1-*`, `scripts/final-*`, `scripts/restore-*`, `scripts/update-*`, `scripts/host-*`, `scripts/issue7-*` (34 total in `scripts/`) | Untracked | Host bridge / Codex supervisor | Bridge scripts, push helpers, symlink fixes | Move outside repo |
| `*.txt` files at root (8) | Untracked | Temp prompts/staging | Codex prompt files, CI temp files, delivery notes | Delete after handoff |
| `*.md` files at root (2) | Untracked | Host executor | Host executor reports | Move to `docs/` |
| `*.sh` (2) | Untracked | Host executor | Shell scripts | Move outside repo |
| `apps/api/src/reward/COMMIT_MSG.md` | Untracked | Codex | Commit message draft | Delete |
| `packages/database/database/` | Untracked | Accidental | Empty directory artifact | Delete |
| `docs/06-phase-reports/p3-s1/*.md` (HOST reports) | Untracked | Host executor | Bridge incident/execution reports | Preserve in docs |

**Recommended .gitignore coverage:** `node/`, `node22/`, `pnpm/`, `tools/`, `v8-compile-cache-0/`, `*.txt` root temp files, `isomorphic-git-*.tgz`, bridge scripts in `scripts/`, root helper `*.js` files.

---

## 8. Git Proxy Status

| Check | Result |
|---|---|
| `git config --list \| findstr proxy` | **No proxy configured** in Git |
| Environment `HTTP_PROXY` / `HTTPS_PROXY` / `http_proxy` / `https_proxy` | **Not set** (empty) |
| `NO_PROXY` | **Not set** (empty) |
| **Assessment** | Clean — no proxy interference expected |

---

## 9. GitHub Connectivity

| Check | Result |
|---|---|
| `curl.exe` to `https://github.com` | **HTTP 200** — direct connectivity OK |
| `git ls-remote origin HEAD` | **Success** — SHA `69240bf8` returned |
| `git fetch --all --prune` | **Success** — no errors |
| **Assessment** | GitHub fully reachable; no routing issues at this time. Historical 127.0.0.1:9 issue not reproduced. |

---

## 10. .git Write Capability Status

| Check | Result |
|---|---|
| Current branch tracked modification | 1 file (`scripts/codex-supervisor.ps1` — CRLF-only) |
| Repository is **not** sandbox-mounted | **Native Windows** — no FUSE/sandbox filesystem |
| `.git/index.lock` creation risk | **Low** — native NTFS filesystem, no sandbox bridging |
| **Assessment** | Native Windows Git should write `.git/index.lock` without issue. The historical sandbox limitation is fully avoided by executing natively. |

---

## 11. Current Node Version

| Item | Value |
|---|---|
| **Current local Node** | **v26.4.0** |
| **CI target Node** | **Node 24** (both `ci.yml` and `p3-ci.yml` use `NODE_VERSION: '24'`) |
| **Gap** | **MISMATCH** — Local v26.4.0 vs CI Node 24 |
| **Risk** | Node 26 may introduce runtime behavior differences vs Node 24. Corepack and pnpm version may also differ. |
| **pnpm version** | 9.15.9 (matches CI `PNPM_VERSION: '9.15.9'` in `ci.yml`) |

---

## 12. Desired Node 24 Alignment

| Recommendation | Details |
|---|---|
| **Action required** | Install Node 24 LTS alongside current Node 26, or use `nvm`/`fnm` to switch |
| **Test code path** | Ensure Codex runs tests against Node 24 before committing |
| **Corepack** | Ensure Corepack is enabled for pnpm version alignment |
| **Node 24 install location** | Outside the repository (not `C:\AI_WORKSPACE\iPoint App\node` or `node22`) |

---

## 13. pnpm Status

| Item | Value |
|---|---|
| **Current pnpm version** | 9.15.9 |
| **CI pnpm version (ci.yml)** | 9.15.9 ✅ |
| **CI pnpm version (p3-ci.yml)** | Not specified (uses `pnpm/action-setup@v4` without version) |
| **node_modules integrity** | Unknown — not verified in this session |
| **Assessment** | Version matches CI baseline. `node_modules` integrity needs verification before Phase 4 work. |

---

## 14. Real Codex Executable/Version/Auth Status

| Item | Value |
|---|---|
| **Executable path** | `C:\Users\MSI\AppData\Roaming\npm\codex.ps1` |
| **Command name** | `codex` (PowerShell external script) |
| **Version** | `codex-cli 0.144.5` |
| **Historical model** | `gpt-5.6-sol` |
| **Auth method** | ChatGPT Account Session (OpenAI) |
| **Last verified working** | During Phase 3 implementation |
| **Session ID capture** | Not tested in this session |
| **PID capture** | Not tested in this session |

---

## 15. Real Codex Read-Only Smoke Readiness

| Prerequisite | Status |
|---|---|
| Executable exists at verified path | ✅ `codex.ps1` / `codex-cli 0.144.5` |
| Known working model | ✅ `gpt-5.6-sol` |
| Native Windows repository | ✅ No sandbox mount |
| Harmless read-only script prepared | **NOT YET** — requires Command Center authorization |
| Read tasks defined | Read AGENTS.md, read repo state, run `git status`, exit |
| **Execute only after** | Command Center authorizes smoke test |

### Proposed Smoke Test Command (read-only)

```
codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-sol "
Read AGENTS.md and openclaw-operating-rules and the docs/00-master documents.
Then run git status, git log --oneline -3.
Do NOT modify any tracked files.
Do NOT commit or push.
Provide a brief summary of what you see in AGENTS.md and the current git state.
"
```

---

## 16. Windows Gateway / Elevated Route Status

| Item | Value |
|---|---|
| **Current elevated level** | `on` (full auto-approve) |
| **Gateway** | OpenClaw Gateway — running natively on Windows |
| **Shell** | `powershell` (native) |
| **Route** | OpenClaw → elevated → Gateway → native PowerShell → Codex CLI → repository |
| **Execution target** | `host=auto` (default) — resolves to sandbox via Docker |
| **Note** | Commands run with `elevated=true` execute on the host Windows OS directly |
| **Security concern** | Wildcard elevated permission (`on` / auto-approve) allows unrestricted host-level execution. Consider restricting to `ask` mode for future Codex sessions. |

---

## 17. Security Concern Around Wildcard Elevated Permission

**Current state:** Elevated level is `on` (full auto-approve). Any command run with elevated flag executes with host permissions.

**Risks:**
- Codex CLI could make uncontrolled changes to file system outside the repository
- Accidental `git push` to wrong remote or `git reset --hard` on wrong branch
- Potential for shell injection through prompt arguments
- Sandbox isolation is bypassed for elevated commands

**Recommendation:**
- Keep elevated mode for OpenClaw orchestration commands (git fetch, status, diff)
- Use `elevated` only for Codex execution commands
- Consider toggling to `ask` during day-to-day Phase 4 work to add a confirmation gate

---

## 18. AGENTS.md Summary

| Section | Summary |
|---|---|
| **Roles** | Bryan (business), ChatGPT Command Center (product/architecture), OpenClaw (PM, no code), Codex CLI (engineering executor) |
| **Reading order** | AGENTS.md → PROJECT_MASTER_CONTROL.md → DOCUMENT_AUTHORITY.md → OPENCLAW_OPERATING_RULES.md → BASELINE_ACKNOWLEDGMENT_V1.1.md → DECISION_LOG.md → OPEN_QUESTIONS.md → PHASE_REGISTRY.md → Phase Brief |
| **Immutable lines** | LOCKED (implement as specified), CONFIGURABLE (structure only, no hard-coding), DEFERRED (design boundaries only), OPEN (no invention) |
| **Codex pre-work** | Must read AGENTS.md, CODEX_WORKFLOW_RULES.md, and Phase Brief + PRDs |
| **Prohibitions** | OpenClaw writing code, starting Phase without approved brief, changing LOCKED rules, hard-coding CONFIGURABLE, implementing DEFERRED, inventing OPEN, merging to main without review, bulk-adding untracked files |
| **Startup check** | Must verify repo, remote, branch, git status, and log before work |

---

## 19. D-027 / D-028 / D-029 Verification

| Decision | Status | Verified |
|---|---|---|
| **D-027** | Phase 2 Member Core final acceptance (2026-07-21) | ✅ **Unchanged in current DECISION_LOG** |
| **D-028** | Phase 3 authorization with 7 approved business contracts (2026-07-22) | ✅ **Unchanged in current DECISION_LOG** |
| **D-029** | Phase 3 ACCEPTED/COMPLETE/FROZEN (2026-07-23) | ✅ **Recorded as final entry** |
| D-001 through D-026 | All prior decisions | ✅ **All intact, append-only** |

**No governance files have been modified outside the D-029 recording commit.**

---

## 20. Phase 4 Architecture Summary

Phase 4 is the **Transaction Engine**. It sits between Phase 3 (Wallet + Reward Ledger) and Phase 5 (Agent & Commission).

### What Phase 4 Must Integrate

- **Merchant Transaction** — The core atomic business event
- **Member Identity** — Who is the consumer
- **Consumption Market** — Which market's rules apply
- **Merchant Package** — Which service-fee package is active
- **Service-Fee Calculation** — Gross × service-fee %
- **MCP Deduction** — Debit from merchant's MCP wallet
- **Transaction Snapshot** — Immutable record of all calculation inputs
- **Reward Source** — Phase 3 reward source contract invocation
- **Pending Wallet Ledger** — iPoint pending credit (before daily settlement)
- **Receipt** — POS receipt binding with 60-minute window
- **Idempotency** — Double-submission prevention
- **Concurrency** — Race condition protection
- **Reversal / Refund** — Compensating entries (not destructive undo)
- **Audit** — Complete audit trail

### Key Phase 3 Dependencies

Phase 4 consumes Phase 3:
- `wallet_ledger` — append-only MCP ledger entries
- `reward_source_contract` — minimal interface for reward eligibility
- `pending_wallet_entries` — iPoint pending credit for daily settlement
- Transaction snapshot structure (defined in Phase 3 contract)

Phase 4 must NOT replace or bypass Phase 3.

---

## 21. Unresolved Phase 4 Questions

These 30 questions require Command Center resolution before or during Phase 4 planning:

| # | Question | Category | Recommended Decision Timing |
|---|---|---|---|
| 1 | Is transaction initiated by **merchant only**, or may **member initiate**? | Scope | P4-S0 |
| 2 | Is QR **static member QR** or **dynamic transaction QR**? | Architecture | P4-S0 |
| 3 | What exactly **expires after 60 minutes**? (Receipt? Scan token? Both?) | Behavior | P4-S0 |
| 4 | Can a merchant **draft a transaction** before scanning? | UX | P4-S0 |
| 5 | Is `receipt_id` **globally unique**, **merchant-unique**, or **market-unique**? | Schema | P4-S1 |
| 6 | Is **POS receipt optional or mandatory**? | Business Rule | P4-S0 |
| 7 | Is confirmation **irreversible without Admin**? | Behavior | P4-S0 |
| 8 | Are **partial refunds allowed**? | Business Rule | P4-S6 |
| 9 | What **restores MCP during reversal**? (Original amount at original rate?) | Ledger | P4-S6 |
| 10 | What happens if **reward is still pending** (pre-settlement) at reversal time? | Integration | P4-S6 |
| 11 | What happens if **reward is already available** (post-settlement) at reversal time? | Integration | P4-S6 |
| 12 | **Who may request reversal**? (Merchant? Member? Admin?) | Security | P4-S6 |
| 13 | **Who approves reversal**? (Admin only? Maker/Checker?) | Security | P4-S6 |
| 14 | Is **Maker/Checker required** for transaction reversal? | Security | P4-S0 |
| 15 | Are **suspended merchants blocked immediately**? | Concurrency | P4-S4 |
| 16 | Can **MCP balance reach exactly zero**? | Behavior | P4-S2 |
| 17 | Is **negative MCP always forbidden**? | Invariant | P4-S2 |
| 18 | Which **currency decimal scale applies per market**? | Config | P4-S1 |
| 19 | How is **transaction amount rounded**? | Precision | P4-S2 |
| 20 | Is **service fee rounded before reward calculation**? | Precision | P4-S2 |
| 21 | Is **reward principal gross amount or another basis**? | Integration | P4-S2 |
| 22 | Is **package chosen per transaction** or per session? | Behavior | P4-S2 |
| 23 | How is **package availability versioned**? | Schema | P4-S1 |
| 24 | Can an **Admin retroactively modify transaction package**? | Governance | P4-S7 |
| 25 | Which **IDs are exposed to member and merchant**? | Privacy | P4-S5 |
| 26 | What **PII is returned in merchant scans**? | Privacy | P4-S0 |
| 27 | How is **QR replay prevented**? (One-time token? Time-bound?) | Security | P4-S4 |
| 28 | Does transaction confirmation require **staff identity**? | Security | P4-S0 |
| 29 | Is **branch-level merchant identity required**? | Schema | P4-S1 |
| 30 | How are **offline transactions synchronized**? | Resilience | P4-S8 |

**No answers should be inferred without Command Center approval.**

---

## 22. Proposed P4-S0 Plan

### P4-S0: Contract Freeze and Acceptance Matrix

| Item | Details |
|---|---|
| **Proposed Decision ID** | D-030 (Phase 4 Authorization) |
| **Goal** | Freeze all Phase 4 contracts before any code is written |
| **Deliverables** | Transaction Engine Master Plan, Architecture, ERD, API Contract, State Machine, Idempotency Spec, Security Model, Migration Plan, Test Matrix, Acceptance Criteria |
| **Resolution required** | All 30 questions above answered |
| **Scope boundaries** | Explicit non-goals and excluded features documented |
| **Key frozen assumptions** | Merchant package snapshots, MCP deduction, reward source contract, market-local receipt expiry |
| **Risk register** | Started in this document (see §28 below) |

### P4-S0 Deliverables Checklist

| # | Deliverable | Proposed File |
|---|---|---|
| 1 | Existing System Audit | `docs/06-phase-reports/p4-s0/EXISTING_SYSTEM_AUDIT.md` |
| 2 | Phase 4 Master Plan | `docs/06-phase-reports/p4-s0/PHASE_4_MASTER_PLAN.md` |
| 3 | Phase 4 Architecture | `docs/06-phase-reports/p4-s0/PHASE_4_ARCHITECTURE.md` |
| 4 | Phase 4 ERD | `docs/06-phase-reports/p4-s0/PHASE_4_ERD.md` |
| 5 | Transaction State Machine | `docs/06-phase-reports/p4-s0/PHASE_4_STATE_MACHINES.md` |
| 6 | API Contract Draft | `docs/06-phase-reports/p4-s0/PHASE_4_API_CONTRACT_DRAFT.md` |
| 7 | Idempotency Specification | `docs/06-phase-reports/p4-s0/PHASE_4_IDEMPOTENCY_SPEC.md` |
| 8 | Security and Privacy Model | `docs/06-phase-reports/p4-s0/PHASE_4_SECURITY_AND_PRIVACY.md` |
| 9 | Migration and Rollback Strategy | `docs/06-phase-reports/p4-s0/PHASE_4_MIGRATION_AND_ROLLBACK_STRATEGY.md` |
| 10 | Testing Matrix | `docs/06-phase-reports/p4-s0/PHASE_4_TEST_AND_E2E_MATRIX.md` |
| 11 | Acceptance Criteria | `docs/06-phase-reports/p4-s0/PHASE_4_ACCEPTANCE_CRITERIA.md` |
| 12 | Risk Register | `docs/06-phase-reports/p4-s0/PHASE_4_RISK_REGISTER.md` |

---

## 23. Proposed Phase 4 Branch Name

| Branch | Purpose |
|---|---|
| **Phase branch** | `phase/4-transaction-engine` |
| **Task branches** | `task/p4-s0-contract-freeze`, `task/p4-s1-schema-transaction-domain`, `task/p4-s2-transaction-preview`, etc. (one per sub-phase) |

---

## 24. Proposed CI Workflow Strategy

| Strategy Element | Proposal |
|---|---|
| **Phase-specific CI** | Create `p4-ci.yml` modeled on `p3-ci.yml`, triggered by `phase/4-**` and `task/p4-**` |
| **Build matrix** | Node 24 LTS on ubuntu-latest |
| **Services** | PostgreSQL 17-alpine for database + API integration tests; Redis for concurrency tests |
| **Test isolation** | Unit tests, Phase 4 module tests, Database tests, API integration tests (separate jobs) |
| **Idempotency tests** | CI job for concurrent transaction submission |
| **Reversal/Refund tests** | CI job for reversal flow validation |
| **Security tests** | CI job for authorization boundary tests |
| **Pre-merge gate** | All CI jobs must pass before merge to phase branch |
| **Main CI** | Existing `ci.yml` remains unchanged until Phase 4 merged to main |

---

## 25. Proposed Phase 4 Sub-Phase Breakdown

| Sub-Phase | Scope | Estimated Complexity | Codex Task Boundaries |
|---|---|---|---|
| **P4-S0** | Contract freeze and acceptance matrix | Documentation only | DeepSeek planning (no code) |
| **P4-S1** | Database schema and transaction domain | Medium | New migrations, entity types, enums |
| **P4-S2** | Transaction preview and validation | Medium | Preview endpoint, validation logic, MCP check |
| **P4-S3** | Atomic transaction confirmation | High | Core confirm endpoint, snapshot, ledger write, reward source |
| **P4-S4** | Idempotency and concurrency | High | Idempotency key handling, advisory locks, race scenarios |
| **P4-S5** | History and receipt APIs | Medium | Transaction list, detail, receipt binding, member/merchant views |
| **P4-S6** | Reversal/refund compensation | High | Compensating entries, MCP restore, reward consideration |
| **P4-S7** | Security, performance and migration hardening | Medium | RBAC audit, rate limiting, migration forward-testing |
| **P4-S8** | Full regression and final acceptance | Medium | All-CI pass, acceptance matrix, delivery report |

---

## 26. Risks and Blockers

| Risk ID | Description | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | **Node version mismatch** (26 vs 24) | High | Medium | Install Node 24, align Corepack before Phase 4 coding |
| R-02 | **Repository pollution** (69 untracked items) | High | Low | Document and .gitignore, do not bulk-delete without authorization |
| R-03 | **Codex CLI version drift** (0.144.5 may change) | Medium | Medium | Verify and pin before Phase 4 start |
| R-04 | **Proxy routing regressions** (historical 127.0.0.1:9) | Low | High | Verify `git ls-remote` and `curl` before every push |
| R-05 | **Untracked bridge scripts** in `scripts/` conflict with Phase 4 | Medium | Low | Move outside repo or add to .gitignore |
| R-06 | **Elevated permission risk** | Medium | High | Consider toggling to `ask` mode for routine Codex sessions |
| R-07 | **30 unanswered Phase 4 questions** | High | High | Must be resolved in P4-S0 before implementation |
| R-08 | **Phase 3 reward source contract** is minimal; may need extension | Medium | Medium | Document in P4-S0 architecture, do not modify Phase 3 files |
| R-09 | **No Redis instance** for concurrency tests in this environment | Medium | Low | CI PostgreSQL + advisory locks cover most scenarios |
| R-10 | **Codex prompt transport** issues (nested quoting, encoding) | Medium | Medium | Use UTF-8 temporary files outside repository, avoid inline prompts |

---

## 27. Sandbox Remediation Plan (for Phase 4 Execution)

| Category | Issue | Resolution |
|---|---|---|
| **A. Repository write access** | Codex must modify tracked files and create .git/index.lock | ✅ **Native Windows path** — the repository is on NTFS, not sandbox-mounted. Codex runs natively. No sandbox write limitation expected. |
| **B. Native execution** | Prefer direct native over Linux sandbox mount | ✅ **Current approach** — use `elevated` exec to run Codex directly in native PowerShell |
| **C. Prompt transport** | Large prompts need clean UTF-8 transport | Install step: write task prompt to temp file outside repo (`%TEMP%\codex-p4-*.txt`), then `codex exec --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-sol (Get-Content -Raw \`$tempFile\`)` |
| **D. Timeouts** | Codex timeout management | Git-only: 10-15min. Small scoped fixes: 20-30min. Full scopes: 45-90min. Monitor output. Kill and retry on known toolchain failures. |
| **E. Validation** | CI is authorative | Local static checks for fast feedback, GitHub CI for acceptance. Never mark infra failure as product failure. |
| **F. Proxy** | Verify before push | On every push: check `git config --list \| findstr proxy`, `$env:HTTP_PROXY`, `curl.exe https://github.com`, `git ls-remote origin`. |
| **G. Node** | Align with CI | Install Node 24 LTS outside repo. Use `nvm` or direct install. Do not rely on Node 26 parity. |
| **H. Dependency hygiene** | No ad hoc workarounds inside repo | Prepare clean Node 24 + Corepack + pnpm environment in `C:\Tools\ipoint-node24\` outside tracked content. |

---

## 28. Backup Executor Planning (Not Active)

| Executor | Path | Version | Auth Method | Git Write | Notes |
|---|---|---|---|---|---|
| **Codex CLI (Primary)** | `C:\Users\MSI\AppData\Roaming\npm\codex.ps1` | 0.144.5 | ChatGPT Account Session | ✅ Full | Known working |
| **Claude Code** (Secondary) | `npm install -g @anthropic-ai/claude-code` | TBD | API key | ✅ Full | Not yet installed/verified |
| **Gemini CLI** (Tertiary) | `npm install -g @google-gemini/cli` | TBD | API key | ✅ Full | Not yet installed/verified |

**Do not activate secondary/tertiary executors without Command Center authorization.**

---

## 29. Exact User Actions Required

The following actions **genuinely require human intervention** and cannot be completed by OpenClaw:

1. **Resolve 30 Phase 4 open questions** — Mark each with a binding product decision in the new Command Center session.
2. **Authorize P4-S0** — Issue a Phase 4 Authorization decision (D-030) before any contract work begins.
3. **Approve sandbox remediation** — Specifically: install Node 24 LTS outside repo; approve .gitignore additions for untracked artifacts.
4. **Set elevated permission mode** — Confirm whether `ask` or `on` is preferred for Phase 4 Codex sessions.
5. **Authorize read-only Codex smoke test** — Before Phase 4 implementation, confirm the harmless smoke test plan.
6. **Appoint Main PR authorization gate** — Decide when Phase 4 is allowed to open a Main PR (cannot be during implementation).

---

## 30. Command Center Session Handoff Summary

### Files Read This Session

| File | Status |
|---|---|
| AGENTS.md | ✅ |
| PROJECT_MASTER_CONTROL.md | ✅ |
| DOCUMENT_AUTHORITY.md | ✅ |
| OPENCLAW_OPERATING_RULES.md | ✅ |
| BASELINE_ACKNOWLEDGMENT_V1.1.md | ✅ |
| DECISION_LOG.md | ✅ |
| OPEN_QUESTIONS.md | ✅ |
| PHASE_REGISTRY.md | ✅ |
| PHASE_3_MASTER_PLAN.md | ✅ |
| PHASE_3_CI_WORKFLOW (p3-ci.yml) | ✅ |
| MAIN_CI_WORKFLOW (ci.yml) | ✅ |
| P3-S1_DELIVERY_REPORT.md | ✅ |
| OPENCLAW_OPERATING_RULES.md | ✅ |

### Git Status Summary

- **Branch:** `task/p3-s1-wallet-reward-contract-freeze`
- **HEAD:** `a2ab1240` (Phase 3 accepted + D-029 recorded)
- **origin/main:** `69240bf8` (156 commits behind Phase 3)
- **origin/phase/3-multi-market-wallet-reward-ledger:** `a2ab1240` ✅ (synced with HEAD)
- **Tracked modifications:** 1 (scripts/codex-supervisor.ps1 — CRLF-only)
- **Untracked artifacts:** 69 (bridge scripts, temp prompts, node/pnpm binaries)
- **Proxy:** None
- **GitHub connectivity:** ✅

### Allowable Actions

- Read repository files and governance documents
- Update this handoff report
- Prepare Phase 4 planning documents (P4-S0 contract-freeze style)
- Execute DeepSeek analytical tasks (log analysis, planning, reporting)

### Prohibited Actions

- Begin Phase 4 implementation code
- Create Phase 4 database migrations
- Modify Phase 3 accepted code
- Edit D-027, D-028, or D-029
- Merge Phase 3 into Main
- Open Main PR
- Push to Main
- Delete or bulk-add repository artifacts
- Use `sessions_spawn` as a coding executor
- Allow DeepSeek to edit tracked files
- Claim COMPLETE or ACCEPTED
- Use Claude Code or Gemini CLI without authorization

---

## 31. Environmental Snapshot (for next session continuity)

```
GATEWAY RUNTIME:   2026.7.1-2 (0790d9f)
GATEWAY UPTIME:    1d 2h
SYSTEM UPTIME:     7d 19h
HOST OS:           Windows_NT 10.0.26200 (x64)
NODE VERSION:      v26.4.0 (HOST) / CI: Node 24
PNPM VERSION:      9.15.9
CODEX CLI:         0.144.5 (C:\Users\MSI\AppData\Roaming\npm\codex.ps1)
WORKING DIRECTORY: C:\AI_WORKSPACE\iPoint App
REMOTE ORIGIN:     https://github.com/bryangeh79/ipoint.git
GIT PROXY:         None
GITHUB STATUS:     ✅ Reachable (HTTP 200, ls-remote OK)
ELEVATED MODE:     on (auto-approve)
MODEL:             deepseek/deepseek-v4-flash
CURRENT TIME:      2026-07-23 19:03 MYT (UTC+8)
```

---

```
PHASE_4_READY_FOR_COMMAND_CENTER_PLANNING
PHASE_4_IMPLEMENTATION_NOT_AUTHORIZED
```
