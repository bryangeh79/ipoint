# iPoint Decision Log (Append-only)

> Rules:
> - Every entry is append-only. **No entry may be deleted or silently overwritten.**
> - Superseded entries are marked with `SUPERSEDED` and linked to the replacing Decision ID.
> - Each entry: Decision ID / Date / Source / Old Rule / New Decision / Reason / Affected Files / Affected Phases / Migration / Approver / Basis / Status

---

## D-001: Governance file creation

| Field | Value |
|---|---|
| **Decision ID** | D-001 |
| **Date** | 2026-07-16 |
| **Source** | OpenClaw Persistent Project Memory Plan (ChatGPT APPROVED WITH CHANGES) |
| **Old Rule** | No persistent governance files existed on project-master-baseline |
| **New Decision** | Create 7 governance files: AGENTS.md, DOCUMENT_AUTHORITY.md, OPENCLAW_OPERATING_RULES.md, BASELINE_ACKNOWLEDGMENT_V1.1.md, DECISION_LOG.md, OPEN_QUESTIONS.md, PHASE_REGISTRY.md |
| **Reason** | Prevent context loss on session restart; GitHub is sole persistent memory |
| **Affected Files** | AGENTS.md, docs/00-master/DOCUMENT_AUTHORITY.md, docs/00-master/OPENCLAW_OPERATING_RULES.md, docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md, docs/00-master/DECISION_LOG.md, docs/00-master/OPEN_QUESTIONS.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | NONE (pre-Phase governance) |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | APPROVED WITH CHANGES (2026-07-16) |
| **Status** | **APPROVED** |

---

## D-002: Baseline Acknowledgment V1.1 Correction

| Field | Value |
|---|---|
| **Decision ID** | D-002 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center review of Baseline Acknowledgment |
| **Old Rule** | Original Baseline Acknowledgment (pre-V1.1) |
| **New Decision** | Apply 10 corrections: C-01 (Phase order), C-02 (Member QR token), C-03 (Maker/Checker no threshold), C-04 (Receipt 60 min locked), C-05 (Redemption refund no cap recalc), C-06 (market_id scope), C-07 (Merchant ID per branch), C-08 (Merchant staff moved to OPEN), C-09 (ORM neutral), C-10 (Git status reporting) |
| **Reason** | Correct inaccuracies and resolve open questions in baseline understanding |
| **Affected Files** | docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md, docs/00-master/OPEN_QUESTIONS.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | NONE (pre-Phase governance) |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | CHANGES REQUIRED → resubmitted → approved directionally |
| **Status** | **APPROVED** |

---

## D-003: Persistent Project Memory Plan approval

| Field | Value |
|---|---|
| **Decision ID** | D-003 |
| **Date** | 2026-07-16 |
| **Source** | OpenClaw Persistent Project Memory Plan proposal |
| **Old Rule** | No structured project memory plan |
| **New Decision** | Create 7 governance files as specified in the plan; follow 10 amendments |
| **Reason** | Enable session-resilient project memory; GitHub as single source of truth |
| **Affected Files** | AGENTS.md, docs/00-master/DOCUMENT_AUTHORITY.md, docs/00-master/OPENCLAW_OPERATING_RULES.md, docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md, docs/00-master/DECISION_LOG.md, docs/00-master/OPEN_QUESTIONS.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | NONE (pre-Phase governance) |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | APPROVED WITH CHANGES (2026-07-16) |
| **Status** | **APPROVED** |

---

## D-004: PR #2 merge and governance status update

| Field | Value |
|---|---|
| **Decision ID** | D-004 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center final approval |
| **Old Rule** | PR #2 as Draft on docs/project-master-baseline; Baseline Acknowledgment pending final sign-off |
| **New Decision** | PR #2 squash merged to main (3c850bd). Baseline Acknowledgment: APPROVED. Persistent governance files now on main. |
| **Reason** | Engineering starter pack and governance baseline complete. All documents reviewed and corrected. |
| **Affected Files** | docs/00-master/PHASE_REGISTRY.md (status update), docs/00-master/DECISION_LOG.md (this entry) |
| **Affected Phases** | NONE (pre-Phase governance) |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | APPROVED (2026-07-16) |
| **Status** | **APPROVED** |

---

## D-005: P0-S3 / P0-S4A sub-agent output invalidated

| Field | Value |
|---|---|
| **Decision ID** | D-005 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center — P0-S3 + P0-S4A: EXECUTION INVALID |
| **Old Rule** | OpenClaw sub-agent created commits for P0-S3 and P0-S4A using `sessions_spawn` |
| **New Decision** | All sub-agent output marked UNTRUSTED_SUBAGENT_OUTPUT. Two Codex CLI workers must independently re-validate and fix. No push, merge, or phase evidence from sub-agent commits. |
| **Reason** | CODEX-ONLY EXECUTION POLICY violation. Only real Codex CLI processes may execute engineering work. OpenClaw sub-agent token pool usage also unauthorized. |
| **Affected Files** | apps/api/ (all files), docs/06-phase-reports/P0-S4A_ORM_COMPARISON.md, pnpm-lock.yaml, package.json (root) |
| **Affected Phases** | P0-S3, P0-S4A |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | P0-S3 + P0-S4A: EXECUTION INVALID (2026-07-16) |
| **Status** | **ENFORCED** |

---

## D-006: Drizzle ORM selected for iPoint production baseline

| Field | Value |
|---|---|
| **Decision ID** | D-006 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center — ORM Gate decision and Batch A authorization |
| **Old Rule** | ORM Gate OPEN; Prisma and Drizzle evaluated with no production ORM selected |
| **New Decision** | Close the ORM Gate and approve Drizzle ORM for the iPoint production baseline. Prisma was evaluated but not selected. PostgreSQL remains the source of truth. Monetary, percentage, point, and commission decimal values use PostgreSQL `numeric`, never floating point. Production migrations use explicit, reviewable SQL and forward-fix recovery. Ledger immutability is enforced through database and application design, not delegated to the ORM. Migration checksums are mandatory. Node 24 LTS validation must pass before P0-S4B completion. |
| **Reason** | The checked-in P0-S4A comparison PoC demonstrated equivalent critical correctness behavior while Drizzle provides the approved SQL-oriented production baseline. The explicit migration, integrity, and target-runtime requirements preserve reviewability and operational safety. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, experiments/orm-comparison/, future production database integration files |
| **Affected Phases** | P0-S4A, ORM Gate, P0-S4B, P0-S5, P0-S6 and all later database-backed phases |
| **Migration** | Explicit reviewable SQL migrations; immutable migration-file checksums; append-only history; forward-fix recovery after an applied migration |
| **Approver** | ChatGPT Command Center |
| **Basis** | ORM Gate CLOSED — DRIZZLE APPROVED; Batch A (P0-S4B → P0-S5 → P0-S6) authorized (2026-07-16) |
| **Status** | **APPROVED** |

---

## D-007: Batch A accepted

| Field | Value |
|---|---|
| **Decision ID** | D-007 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center — Batch A acceptance |
| **Old Rule** | Batch A was authorized and executing sequentially; P0-S4B was IN_PROGRESS, while P0-S5 and P0-S6 were AUTHORIZED. |
| **New Decision** | Accept Batch A at remote head `760cb8b8916b569f1a6be057b8cd4ba8546d2e87`. Mark P0-S4B, P0-S5, and P0-S6 COMPLETE; mark Batch A APPROVED; move P0-S7 to IN_PROGRESS; authorize P0-S8; keep P0-S9 NOT_AUTHORIZED. Node 24.18.0 validation passed. GitHub CI is not configured. The in-memory rate limiter is explicitly non-production. Batch A contains no member, merchant, wallet, MCP, iPoint, or commission business logic. |
| **Reason** | Batch A acceptance evidence and current remote-head validation satisfy the authorized engineering-foundation scope while preserving explicit production and business-logic boundaries. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, PR #4 description |
| **Affected Phases** | Batch A, P0-S4B, P0-S5, P0-S6, P0-S7, P0-S8, P0-S9 |
| **Migration** | NONE (governance synchronization only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | Batch A Accepted; remote head `760cb8b8916b569f1a6be057b8cd4ba8546d2e87`; Node 24.18.0 validation passed (2026-07-16) |
| **Status** | **APPROVED** |

---

## D-008: Batch B accepted

| Field | Value |
|---|---|
| **Decision ID** | D-008 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center — P0-S9 Phase 0 final integration, audit, and acceptance authorization |
| **Old Rule** | P0-S7 was IN_PROGRESS, P0-S8 was AUTHORIZED, P0-S9 was NOT_AUTHORIZED, and Batch B awaited acceptance. |
| **New Decision** | Accept Batch B at remote head `fb3478f5e12724a837ece025024a375c673dc7ac`. Mark P0-S7 and P0-S8 COMPLETE; mark Batch B APPROVED; move P0-S9 to IN_PROGRESS; keep Phase 0 PENDING until final integration evidence and GitHub CI are complete. The accepted scope is limited to the shared Design System foundation, responsive application shells, test and CI gates, and local environment support. |
| **Reason** | Batch B implementation and existing local/GitHub evidence satisfy the authorized P0-S7 and P0-S8 engineering-foundation scope. P0-S9 performs the independent full-range audit and final acceptance verification before ChatGPT Command Center decides Phase 0. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, docs/06-phase-reports/PHASE_0_FINAL_ACCEPTANCE_REPORT.md, PR #4 description |
| **Affected Phases** | Batch B, P0-S7, P0-S8, P0-S9, Phase 0 |
| **Migration** | NONE (governance synchronization and acceptance evidence only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P0-S9 — Phase 0 Final Integration, Audit & Acceptance authorization (2026-07-16) |
| **Status** | **APPROVED** |

*— End of current entries. New decisions must be appended below —*
