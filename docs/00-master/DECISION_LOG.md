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

---

## D-009: Phase 0 final acceptance and closure

| Field | Value |
|---|---|
| **Decision ID** | D-009 |
| **Date** | 2026-07-16 |
| **Source** | ChatGPT Command Center — Phase 0 Final Acceptance Decision |
| **Old Rule** | Phase 0 PENDING, P0-S9 IN_PROGRESS |
| **New Decision** | Accept Phase 0 at PR #4 head `f9706c4bd4719a180cd83953d3c1ca94bda9eef4`. GitHub CI both runs SUCCESS. P0-S9 COMPLETE. Phase 0 APPROVED and CLOSED. Phase 1 requires new authorization. |
| **Reason** | All sub-phases complete, full audit passed, all verification gates passed, CI SUCCESS, no business leakage |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, docs/06-phase-reports/PHASE_0_FINAL_ACCEPTANCE_REPORT.md, PR #4 |
| **Affected Phases** | P0-S9, Phase 0 |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | Phase 0 Final Acceptance Decision (2026-07-16) |
| **Status** | **APPROVED** |

## D-010: Phase 1 implementation authorized (P1-S1 approved, Batch A S2-S4 authorized)

| Field | Value |
|---|---|
| **Decision ID** | D-010 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center — CHATGPT_ACCOUNT_SESSION |
| **Old Rule** | Phase 1 NOT_AUTHORIZED; Phase 0 CLOSED under D-009; Phase 1 awaited Big Phase Brief |
| **New Decision** | **Phase 0:** CLOSED AND MERGED. **P1-S1:** APPROVED. **Phase 1:** IMPLEMENTATION AUTHORIZED. **Batch A (P1-S2, P1-S3, P1-S4):** AUTHORIZED. **P1-S5 and beyond:** NOT YET AUTHORIZED. **Main merge:** NOT AUTHORIZED until Phase 1 Batch A acceptance. **Special service fee range:** >0% AND <=100% — LOCKED (resolves O-07). Phase branch: `phase/1-merchant-onboarding-mcp`. Execution Engine: Codex CLI. OpenClaw sub-agents are not authorized for engineering execution. |
| **Reason** | Phase 0 fully accepted and merged. Phase 1 Merchant Onboarding + MCP Ledger authorized with P1-S1 approved and Batch A (P1-S2 through P1-S4) authorized. Remaining sub-phases require separate authorization. Main branch remains protected until Batch A acceptance. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, docs/00-master/OPEN_QUESTIONS.md (O-07 resolved) |
| **Affected Phases** | Phase 0, Phase 1, P1-S1, P1-S2, P1-S3, P1-S4, O-07 |
| **Migration** | Governance file updates only; no code migration |
| **Approver** | ChatGPT Command Center |
| **Basis** | CHATGPT_ACCOUNT_SESSION (2026-07-17) |
| **Status** | **APPROVED** |

## D-011: Phase 1 Batch A approved and Batch B authorized

| Field | Value |
|---|---|
| **Decision ID** | D-011 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center — Batch B authorization |
| **Old Rule** | Batch A CHANGES_REQUIRED (resolved via hygiene + checksum repair); P1-S5+ NOT_AUTHORIZED |
| **New Decision** | Batch A APPROVED. Batch B (P1-S5, P1-S6, P1-S7) AUTHORIZED. P1-S8+ NOT_AUTHORIZED. Main merge NOT AUTHORIZED. |
| **Reason** | Batch A repairs complete and accepted; Batch B authorized for Service Fee Package, MCP Ledger/Recharge, MCP Adjustment/Refund/Activation |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | Batch A, Batch B, P1-S5, P1-S6, P1-S7 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | COMMAND CENTER ORDER (2026-07-17) |
| **Status** | **APPROVED** |

## D-012: Phase 1 Batch B approved and Final Batch authorized

| Field | Value |
|---|---|
| **Decision ID** | D-012 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center — Final Batch authorization |
| **Old Rule** | Batch B IN_PROGRESS; P1-S8+ NOT_AUTHORIZED |
| **New Decision** | Batch B APPROVED. Final Batch (P1-S8, P1-S9) AUTHORIZED. Main merge NOT AUTHORIZED. |
| **Reason** | Batch B implementation complete and accepted; Final Batch authorized for Merchant/Admin UI and Integration/E2E |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | Batch B, Final Batch, P1-S8, P1-S9 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | COMMAND CENTER ORDER (2026-07-17) |
| **Status** | **APPROVED** |

## D-013: Phase 1 final acceptance and main integration authorization

| Field | Value |
|---|---|
| **Decision ID** | D-013 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center — Phase 1 Final Acceptance |
| **Old Rule** | Phase 1 IN_PROGRESS; Main merge NOT_AUTHORIZED |
| **New Decision** | Phase 1 ACCEPTED at SHA `48239fea58716c3df0facbfa2c1b4a1865c05b21`. Pull Request to main AUTHORIZED. Phase 2 NOT_AUTHORIZED. |
| **Reason** | All Phase 1 sub-phases complete and accepted |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | Phase 1 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | COMMAND CENTER ORDER (2026-07-17) |
| **Status** | **APPROVED** |

## D-014: Phase 2 architecture and contract freeze authorization

| Field | Value |
|---|---|
| **Decision ID** | D-014 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center - Phase 2 authorization |
| **Old Rule** | Phase 2 NOT_AUTHORIZED |
| **New Decision** | Phase 2 is AUTHORIZED for the P2-S1 architecture and contract freeze documentation. P2-S1 is AUTHORIZED. P2-S2 through P2-S9 are NOT_AUTHORIZED. Main merge is NOT AUTHORIZED. Development implementation is NOT AUTHORIZED. Database migration is NOT AUTHORIZED. Business code changes are NOT AUTHORIZED. |
| **Reason** | Phase 2 Member Core must begin with a controlled documentation freeze before any implementation authorization is granted. |
| **Affected Files** | docs/06-phase-reports/p2-s1/*, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | Phase 2, P2-S1, P2-S2, P2-S3, P2-S4, P2-S5, P2-S6, P2-S7, P2-S8, P2-S9 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | D-014 (2026-07-17) |
| **Status** | **APPROVED** |


## D-015: Phase 2 P2-S1 documentation repair authorization

| Field | Value |
|---|---|
| **Decision ID** | D-015 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center - P2-S1 CHANGES_REQUIRED review |
| **Old Rule** | P2-S1 COMPLETE; awaiting review |
| **New Decision** | P2-S1 CHANGES_REQUIRED. Documentation repair authorized. All corrections listed in the review directive must be applied. |
| **Reason** | The P2-S1 freeze package required targeted documentation corrections before it could move from review back into an accepted freeze state. |
| **Affected Files** | docs/06-phase-reports/p2-s1/PHASE_2_MASTER_PLAN.md, docs/06-phase-reports/p2-s1/PHASE_2_ARCHITECTURE.md, docs/06-phase-reports/p2-s1/PHASE_2_ERD.md, docs/06-phase-reports/p2-s1/PHASE_2_API_CONTRACT.md, docs/06-phase-reports/p2-s1/PHASE_2_STATE_MACHINES.md, docs/06-phase-reports/p2-s1/PHASE_2_RBAC_MARKET_ACCESS_MATRIX.md, docs/06-phase-reports/p2-s1/PHASE_2_SECURITY_AND_PRIVACY.md, docs/06-phase-reports/p2-s1/PHASE_2_IDEMPOTENCY_SPEC.md, docs/06-phase-reports/p2-s1/PHASE_2_TEST_AND_E2E_MATRIX.md, docs/06-phase-reports/p2-s1/PHASE_2_OPEN_QUESTIONS.md, docs/06-phase-reports/p2-s1/P2-S1_DELIVERY_REPORT.md, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | Phase 2, P2-S1, P2-S2, P2-S3, P2-S4, P2-S5, P2-S6, P2-S7, P2-S8, P2-S9 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S1 COMMAND CENTER REVIEW - CHANGES_REQUIRED (2026-07-17) |
| **Status** | **APPROVED** |


## D-016: Phase 2 P2-S1 final acceptance and P2-S2 authorization

| Field | Value |
|---|---|
| **Decision ID** | D-016 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center - P2-S1 APPROVED and P2-S2 authorization |
| **Old Rule** | P2-S1 UNDER_REVIEW awaiting review; P2-S2 NOT_AUTHORIZED |
| **New Decision** | P2-S1 APPROVED at SHA 8cdc0b2938ee7ceedb89c13716c6dae07d029c2f. Architecture and contract freeze complete. D-001 through D-015 history intact. No code, migration, schema, UI, or provider leakage. P2-S2 (Member Schema and Forward Migrations) AUTHORIZED. P2-S3 through P2-S9 remain NOT_AUTHORIZED. Main PR/Main Merge remain NOT_AUTHORIZED. |
| **Reason** | P2-S1 documentation freeze completed and accepted after all repair loops. Phase 2 may proceed to database schema and migration phase. |
| **Affected Files** | packages/database/schema/*, packages/database/migrations/*, packages/database/tests/*, docs/06-phase-reports/p2-s2/*, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | P2-S1, P2-S2 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S1 COMMAND CENTER FINAL DECISION - APPROVED (2026-07-17) |
| **Status** | **APPROVED** |



## D-017: P2-S2 final acceptance and P2-S3 authorization

| Field | Value |
|---|---|
| **Decision ID** | D-017 |
| **Date** | 2026-07-17 |
| **Source** | ChatGPT Command Center - P2-S2 final acceptance and P2-S3 authorization |
| **Old Rule** | P2-S2 CHANGES_REQUIRED under repair; P2-S3 NOT_AUTHORIZED |
| **New Decision** | P2-S2 APPROVED at SHA d9e4496fdc40fa8ff20d5d625a6dfc534aba7529. Member Schema and Forward Migration complete. Task branch `task/p2-s2-member-schema-migrations` and phase branch `phase/2-member-core-multi-market` are fully synchronized at identical SHA. format, lint, typecheck, build, tests, checksum, migrate, seed (idempotent x2), drift all passing. Memory file removed, ignore rules correct. P2-S3 (Registration, OTP and Authentication) AUTHORIZED. P2-S4 through P2-S9 remain NOT_AUTHORIZED. Main PR/Main Merge remain NOT_AUTHORIZED. |
| **Reason** | P2-S2 final repair complete. All Command Center hygiene directives satisfied. Branches synchronized. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, packages/database/schema/*, packages/database/migrations/*, docs/06-phase-reports/p2-s2/* |
| **Affected Phases** | P2-S2, P2-S3, P2-S4, P2-S5, P2-S6, P2-S7, P2-S8, P2-S9 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S2 COMMAND CENTER FINAL DECISION - APPROVED (2026-07-17) |
| **Status** | **APPROVED** |

*— End of current entries. New decisions must be appended below —*


## D-025: P2-S3 retrospective closure final acceptance

| Field | Value |
|---|---|
| **Decision ID** | D-025 |
| **Date** | 2026-07-19 |
| **Source** | ChatGPT Command Center — P2-S3 retrospective closure final decision |
| **Old Rule** | P2-S3 = CHANGES_REQUIRED — FINAL EVIDENCE CORRECTION |
| **New Decision** | P2-S3 = COMPLETE / APPROVED at SHA `919e71a97eff7a18e5e2e7d2c23cb18636b1b870`. Original 11 CHANGES_REQUIRED items (G-01 through G-11) all RESOLVED. |
| **Reason** | All gaps traced to fixing commits with full 40-char SHAs. Fix attribution verified per commit. test:api: 403 passed / 0 failed / 0 skipped. test:database: 39 passed / 0 failed / 0 skipped. OpenAPI: 100 paths / 23 auth / 0 errors. Final SHA lowest verification passed. Repository hygiene clean. Task and Phase branches identical. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, docs/06-phase-reports/p2-s3/P2-S3_RETROSPECTIVE_CLOSURE_REPORT.md |
| **Affected Phases** | P2-S3 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S3 retrospective closure final acceptance (2026-07-19) |
| **Status** | **APPROVED** |

### Primary fixing commits

| Gap ID | Fixing Commit Full SHA |
|---|---|
| G-01 | `91cc0f074d974d2483b099e0001764f36fbaf9bc` |
| G-02 | `91cc0f074d974d2483b099e0001764f36fbaf9bc` |
| G-03 | `91cc0f074d974d2483b099e0001764f36fbaf9bc` |
| G-04 | `91cc0f074d974d2483b099e0001764f36fbaf9bc` |
| G-05 | `91cc0f074d974d2483b099e0001764f36fbaf9bc`, `2c61bb0eabddb01e7ca25a03223a636b805fe7e2` |
| G-06 | `91cc0f074d974d2483b099e0001764f36fbaf9bc` |
| G-07 | `b6bf7bd5b59d1aaad7441ad9b7bfd6655434853f`, `213a17b7e93ac31e218c8aca83bd9df2e8f87ec3`, `c3a05901d8a013f494cbc7cf6631031d6ed0dadc` |
| G-08 | `b6bf7bd5b59d1aaad7441ad9b7bfd6655434853f`, `213a17b7e93ac31e218c8aca83bd9df2e8f87ec3`, `91cc0f074d974d2483b099e0001764f36fbaf9bc` |
| G-09 | `213a17b7e93ac31e218c8aca83bd9df2e8f87ec3` |
| G-10 | `91cc0f074d974d2483b099e0001764f36fbaf9bc` (partial), `2c61bb0eabddb01e7ca25a03223a636b805fe7e2` (completed) |
| G-11 | `9b51514e868536ea10f1fd98da5685d5287f3133` |

### Verification evidence

- **Acceptance SHA:** `919e71a97eff7a18e5e2e7d2c23cb18636b1b870`
- **Closure Report:** `docs/06-phase-reports/p2-s3/P2-S3_RETROSPECTIVE_CLOSURE_REPORT.md`
- **test:api:** 403 passed / 0 failed / 0 skipped
- **test:database:** 39 passed / 0 failed / 0 skipped
- **OpenAPI:** 100 paths / 23 auth / 0 errors
- **Repository hygiene:** clean
- **Task/Phase SHA:** identical
- **P2-S9:** NOT_AUTHORIZED
- **Phase 2:** NOT CLOSED — IN PROGRESS
- **Main PR / Main Merge:** NOT_AUTHORIZED

## D-018: P2-S3 test recovery - Drizzle Proxy refactor to stable test boundary

| Field | Value |
|---|---|
| **Decision ID** | D-018 |
| **Date** | 2026-07-18 |
| **Source** | Bryan & OpenClaw root cause investigation |
| **Old Rule** | Tests injected INSERT failure via vi.spyOn(database.db.transaction) and direct property assignment on Drizzle Proxy objects |
| **New Decision** | Add DatabaseService.runTransaction<T>(cb) wrapper. Replace 6 Drizzle Proxy injection tests with 3 stable spy-based tests. Email uniqueness tests updated: initiateRegistration checks email availability, so duplicate catch at initiation not completion. |
| **Reason** | Drizzle v0.45.2 Proxy blocks vi.spyOn/direct assignment/Object.defineProperty. PL/pgSQL trigger and pool.query approaches also failed. runTransaction provides stable spyable boundary without behavior change. |
| **Affected Files** | database.service.ts, auth.service.ts, auth.integration.spec.ts |
| **Affected Phases** | P2-S3 |
| **Migration** | NONE |
| **Approver** | Bryan |
| **Basis** | Drizzle Proxy investigation 2026-07-17/18 - all known workarounds exhausted |
| **Status** | **APPROVED** |

## D-019: Auth API Compatibility and Production Hardening Decisions

| Field | Value |
|---|---|
| **Decision ID** | D-019 |
| **Date** | 2026-07-18 |
| **Source** | ChatGPT Command Center — P2-S4 final acceptance review |
| **Old Rule** | No formal standard for response casing, route conventions, or error code contract scope |
| **New Decision** | See below (5 sub-decisions) |
| **Reason** | P2-S4 delivery acceptance; formalize contract standards and infrastructure backlog |
| **Affected Files** | docs/03-api/auth-api-contract.md, docs/05-security/auth-security-review.md, docs/06-phase-reports/p2-s4/P2-S4_DELIVERY_REPORT.md |
| **Affected Phases** | P2-S4 |
| **Migration** | NONE (documentation and backlog only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S4 final acceptance (2026-07-18) |
| **Status** | **APPROVED** |

### Sub-decisions

**D-019-A — Response Field Casing**: camelCase is the canonical standard for all new API responses. Currently mixed fields (token responses in camelCase, OTP responses in snake_case) are NOT modified in P2-S4 to avoid breaking consumers. A dedicated compatibility phase is required before enforcing uniform camelCase.

**D-019-B — Canonical Routes**: Non-member paths under /auth/ are canonical. Member aliases under /auth/member/ are retained temporarily and marked deprecated: true in OpenAPI. No new aliases may be created. Removal requires a future API version migration.

**D-019-C — Redis Rate Limiter**: InMemoryRateLimiter is accepted for single-instance dev/test. Redis distributed rate limiter is declared a hard prerequisite before: multi-API-instance deployment, horizontal scaling, load-balanced multi-node, or production public launch. Backlog item AUTH-INFRA-001 created.

**D-019-D — Unimplemented Error Codes**: AUTH_PASSWORD_WEAK, AUTH_FLOW_EXPIRED, and AUTH_IDEMPOTENCY_REQUIRED are removed from the public API contract's endpoint error response descriptions. They remain in the internal type union as reserved/future codes. Public contract must match real runtime behavior.

**D-019-E — P2-S4 Acceptance**: P2-S4 (Registration & Auth Production Hardening) is **ACCEPTED FOR CLOSURE**. Branch: 	ask/p2-s4-auth-hardening. Commits: 91cc0f07, 2c61bb0e, 1dfb902f. All verification criteria satisfied.


## D-020: P2-S5 Command Center Review - CHANGES_REQUIRED

| Field | Value |
|---|---|
| **Decision ID** | D-020 |
| **Date** | 2026-07-18 |
| **Source** | ChatGPT Command Center - P2-S5 COMMAND CENTER REVIEW - CHANGES_REQUIRED |
| **Old Rule** | P2-S5 FINAL HARDENING submitted for review; status awaited |
| **New Decision** | P2-S5 = CHANGES_REQUIRED. Git verification confirmed: remote branch origin/task/p2-s5-member-profile-integration at SHA 640300a2 matches local HEAD. P2-S5 remote diff does NOT contain expected Phone Schema Migration, DB display_name NULL fix, or member_profiles phone fields. Migration 0010 exists ONLY as an untracked local file and is INCOMPLETE (missing phone constraint rules, no config-based fallback market, missing CHECK constraints). |
| **Reason** | P2-S5 delivery failed Command Center review with 4 critical failures. All fixes must be implemented by Codex CLI only. |
| **Affected Files** | packages/database/migrations/*, packages/database/schema/*, packages/database/tests/*, packages/config/src/index.ts, apps/api/src/config/*, apps/api/src/profile/*, apps/api/src/market/*, apps/api/src/country-change/*, docs/06-phase-reports/p2-s5/*, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | P2-S5 |
| **Migration** | 0010_member_profile_phone_and_default_market_hardening.sql (new forward migration) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S5 COMMAND CENTER REVIEW - CHANGES_REQUIRED (2026-07-18) |
| **Status** | **APPROVED** |


## D-021: P2-S5 final acceptance and P2-S6 authorization

| Field | Value |
|---|---|
| **Decision ID** | D-021 |
| **Date** | 2026-07-18 |
| **Source** | ChatGPT Command Center - P2-S5 COMMAND CENTER FINAL DECISION - APPROVED |
| **Old Rule** | P2-S5 CHANGES_REQUIRED; P2-S6 NOT_AUTHORIZED |
| **New Decision** | P2-S5 APPROVED at SHA c089e7365ba7cccaa1a24612ee60cba79469910c. P2-S6 (Member KYC Level 2) AUTHORIZED. P2-S7 through P2-S9 remain NOT_AUTHORIZED. Main PR/Main Merge remain NOT_AUTHORIZED. |
| **Reason** | P2-S5 full host verification completed: 359 tests passed, 0 failed, 0 skipped. All DB commands exit 0. Branches synchronized. |
| **Affected Files** | docs/06-phase-reports/p2-s5/P2-S5_FINAL_DELIVERY_REPORT.md, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | P2-S5, P2-S6 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S5 COMMAND CENTER FINAL DECISION - APPROVED (2026-07-18) |
| **Status** | **APPROVED** |


## D-022: P2-S6 final acceptance and P2-S7 authorization

| Field | Value |
|---|---|
| **Decision ID** | D-022 |
| **Date** | 2026-07-18 |
| **Source** | ChatGPT Command Center - P2-S6 COMMAND CENTER FINAL DECISION - APPROVED |
| **Old Rule** | P2-S6 CHANGES_REQUIRED; P2-S7 NOT_AUTHORIZED |
| **New Decision** | P2-S6 APPROVED at SHA 071b65a6aaf4cafbf117594816b1ae7b8afd4676. Member KYC Level 2 complete. Migration 0011 complete. Member and Admin KYC APIs complete. KYC state machine complete. Atomic approval transaction with Case+Member level update. Idempotency, concurrency, RBAC, MarketAccess, self-review isolation complete. Sensitive ID number masking complete. KYC History, AuditLog, EntityTimeline complete. Retention uses market-configurable policy reference. O-03 remains LEGAL_DECISION_REQUIRED. 402 tests passed, 0 failed, 0 skipped. lint, typecheck, build, OpenAPI, checksum, migration, seed twice, drift all passed. Branches synchronized. P2-S7 (Member Merchant Discovery) AUTHORIZED. P2-S8 through P2-S9 remain NOT_AUTHORIZED. Main PR/Main Merge remain NOT_AUTHORIZED. |
| **Reason** | P2-S6 full verification completed. All 402 tests passed with real PostgreSQL. |
| **Affected Files** | docs/06-phase-reports/p2-s6/P2-S6_DELIVERY_REPORT.md, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | P2-S6, P2-S7 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S6 COMMAND CENTER FINAL DECISION - APPROVED (2026-07-18) |
| **Status** | **APPROVED** |


## D-023: P2-S7 final acceptance and P2-S8 authorization

| Field | Value |
|---|---|
| **Decision ID** | D-023 |
| **Date** | 2026-07-18 |
| **Source** | ChatGPT Command Center - P2-S7 COMMAND CENTER FINAL DECISION - APPROVED |
| **Old Rule** | P2-S7 CHANGES_REQUIRED; P2-S8 NOT_AUTHORIZED |
| **New Decision** | P2-S7 APPROVED at SHA 89ccd6d499414c536e249616a11f5ee77c5e92b1. Member Merchant Discovery complete. Migration 0012 complete. 431 tests passed, 0 failed, 0 skipped. All verification commands exit 0. Branches synchronized. P2-S8 (Admin Member Management) AUTHORIZED. P2-S9 remains NOT_AUTHORIZED. Main PR/Main Merge remain NOT_AUTHORIZED. |
| **Reason** | P2-S7 full verification completed with real PostgreSQL: 431 tests passed, 0 skipped. |
| **Affected Files** | docs/06-phase-reports/p2-s7/P2-S7_DELIVERY_REPORT.md, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | P2-S7, P2-S8 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S7 COMMAND CENTER FINAL DECISION - APPROVED (2026-07-18) |
| **Status** | **APPROVED** |


## D-024: P2-S8 final acceptance

| Field | Value |
|---|---|
| **Decision ID** | D-024 |
| **Date** | 2026-07-18 |
| **Source** | ChatGPT Command Center - P2-S8 COMMAND CENTER FINAL DECISION - APPROVED |
| **Old Rule** | P2-S8 CHANGES_REQUIRED; P2-S9 NOT_AUTHORIZED |
| **New Decision** | P2-S8 APPROVED at SHA cb902fc96a6f8ddc5be469c38e3caa64d0eb87cb. Admin Member Management complete. Migration 0013 complete. 9 Admin Member API endpoints complete. RBAC permissions (member.read, member.status.manage, member.session.revoke, member.reverification.require, member.note.read, member.note.create) complete. MarketAccess isolation complete. Idempotency and concurrency protection complete. Sensitive data masking complete. Status History, AuditLog, EntityTimeline complete. 459 tests passed, 0 failed, 0 skipped. OpenAPI 100 paths, 0 missing. checksum, migration, seed twice, drift all passed. Branches synchronized. P2-S9 remains NOT_AUTHORIZED awaiting Command Center scope definition. Main PR/Main Merge remain NOT_AUTHORIZED. |
| **Reason** | P2-S8 full verification completed. SHA evidence corrected. All 459 tests passed with real PostgreSQL. |
| **Affected Files** | docs/06-phase-reports/p2-s8/P2-S8_DELIVERY_REPORT.md, docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | P2-S8 |
| **Migration** | NONE (governance only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S8 COMMAND CENTER FINAL DECISION - APPROVED (2026-07-18) |
| **Status** | **APPROVED** |

---

## D-026: P2-S9 Member UI integration and Phase 2 final acceptance authorization

| Field | Value |
|---|---|
| **Decision ID** | D-026 |
| **Date** | 2026-07-19 |
| **Source** | ChatGPT Command Center — P2-S9 authorization |
| **Old Rule** | P2-S9 NOT_AUTHORIZED; P2-S3 through P2-S8 COMPLETE / APPROVED |
| **New Decision** | P2-S9 formally AUTHORIZED. Scope: Member UI Integration, End-to-End Validation and Phase 2 Final Acceptance. P2-S3 through P2-S8 all COMPLETE / APPROVED. |
| **Reason** | All Phase 2 backend sub-phases complete and approved. P2-S9 is the final sub-phase integrating Member UI, E2E validation, and Phase 2 closure. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, apps/member-web/*, docs/06-phase-reports/p2-s9/* |
| **Affected Phases** | P2-S9, Phase 2 |
| **Migration** | NONE (governance only; minimal forward migrations only if backend defects found) |
| **Approver** | ChatGPT Command Center |
| **Basis** | P2-S9 Member UI integration and Phase 2 final acceptance authorization (2026-07-19) |
| **Status** | **APPROVED** |

### Scope summary

- Member Web/PWA UI integration for all P2-S1 through P2-S8 backend capabilities
- Auth flow: Registration, OTP, Login, Refresh, Logout, Password Reset
- Member Profile, Current Market switching, Account Country Change
- KYC Level 2 submission and document upload
- Personal QR with secure token
- Merchant Discovery (List, Detail, Nearby, Categories, Search)
- Account Status UX (ACTIVE, SUSPENDED, CLOSED)
- PWA, Responsive (Mobile/Tablet/Desktop), Accessibility (WCAG 2.1 AA)
- 20 E2E scenarios on real PostgreSQL
- Full Phase 2 regression + Delivery Report

### Sub-stage split (suggested)

| Sub-stage | Scope |
|---|---|
| P2-S9A | Governance, UI Audit, Integration Plan, Frontend Foundation |
| P2-S9B | Registration, OTP, Login, Password Reset, Protected Routing |
| P2-S9C | Profile, Current Market, Account Country Change |
| P2-S9D | KYC Level 2, Reverification, Document Upload |
| P2-S9E | My QR, Merchant List, Detail, Nearby, Categories |
| P2-S9F | Responsive, PWA, Accessibility, Security Hardening |
| P2-S9G | E2E, Full Regression, Phase 2 Final Delivery Report |

### Governance base

- **Governance base SHA:** `f596aac0b20b713766f41320c25b88aaa64f6ef9`
- **Phase 3:** NOT_AUTHORIZED
- **Main PR / Main Merge:** NOT_AUTHORIZED

---

## D-027: Phase 2 Member Core and Multi-Market final acceptance

| Field | Value |
|---|---|
| **Decision ID** | D-027 |
| **Date** | 2026-07-21 |
| **Source** | ChatGPT Command Center — Checkpoint 3 final acceptance |
| **Old Rule** | Phase 2 IN PROGRESS; P2-S9 IN PROGRESS |
| **New Decision** | Phase 2 Member Core & Multi-Market formally accepted. P2-S9 COMPLETE. Phase 2 COMPLETE. |
| **Reason** | All P2-S9 sub-phases (A-F) approved. Checkpoint 3 phase sync verified. 271 tests passing. All pipelines exit 0. Security/PWA/Accessibility audits complete. |
| **Affected Files** | docs/00-master/PHASE_REGISTRY.md, docs/00-master/DECISION_LOG.md |
| **Affected Phases** | P2-S9, Phase 2 |
| **Migration** | NONE |
| **Approver** | ChatGPT Command Center |
| **Basis** | Checkpoint 3 final acceptance (2026-07-21) |
| **Status** | **APPROVED** |

---

## D-028: Phase 3 — Multi-Market Wallet & Reward Ledger Foundation authorization

| Field | Value |
|---|---|
| **Decision ID** | D-028 |
| **Date** | 2026-07-22 |
| **Source** | ChatGPT Command Center — Phase 3 Formal Authorization |
| **Old Rule** | Phase 3 NOT_AUTHORIZED; Phase 2 COMPLETE/FROZEN |
| **New Decision** | Phase 3 — Multi-Market Wallet & Reward Ledger Foundation authorized. P3-S1 only authorized. P3-S2+ NOT_AUTHORIZED. Main PR/Main Merge NOT_AUTHORIZED. Production schema and migration NOT_AUTHORIZED during P3-S1. |
| **Reason** | Phase 2 Member Core & Multi-Market complete. Phase 3 covers Wallet Ledger, Reward Plan, Rule Version, Settlement, Idempotency and Security contracts. P3-S1 is contract/architecture only. |
| **Approved Business Contracts** | 1. Phase 3 centers on Wallet + Reward Ledger. 2. Full Transaction Engine remains Phase 4. 3. Phase 3 establishes only a minimal Reward Source Contract. 4. Settlement follows consumption-market local time at 00:00. 5. Each daily accrual uses the Reward Rule Version effective at accrual time. 6. Merchant package and service-fee history is preserved through transaction-time snapshots. 7. Admin adjustment UI and Maker/Checker workflow remain deferred; Phase 3 establishes only underlying ledger capabilities. |
| **Base SHA** | 49735cd4552b9312425324c76c7c7f41032a8357 |
| **Phase Branch** | phase/3-multi-market-wallet-reward-ledger |
| **First Task Branch** | task/p3-s1-wallet-reward-contract-freeze |
| **P3-S2+** | NOT_AUTHORIZED |
| **Main PR/Main Merge** | NOT_AUTHORIZED |
| **Production Schema/Migration** | NOT_AUTHORIZED during P3-S1 |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | Phase 3, P3-S1 |
| **Migration** | NONE (design-only) |
| **Approver** | ChatGPT Command Center |
| **Basis** | Phase 3 / P3-S1 Formal Authorization (2026-07-22) |
| **Status** | **APPROVED** |

---

## D-029: Phase 3 Acceptance

| Field | Value |
|---|---|
| **Decision ID** | D-029 |
| **Date** | 2026-07-23 |
| **Source** | ChatGPT Command Center — Phase 3 Final Acceptance |
| **Old Rule** | Phase 3 NOT_ACCEPTED; P3-S1 ACTIVE |
| **New Decision** | Phase 3 — Multi-Market Wallet & Reward Ledger ACCEPTED / COMPLETE / FROZEN |
| **Reason** | All required CI jobs pass: Quality (format, lint, typecheck), Build, Unit tests, Database tests, Phase 3 module tests, API integration tests. Final SHA 2ed57f4e. CI Run 30000394880. |
| **Final SHA** | 2ed57f4eedb6b99d316a20813b0fffa8e500d5a7 |
| **CI Run** | 30000394880 |
| **Phase Branch** | phase/3-multi-market-wallet-reward-ledger |
| **Main PR/Main Merge** | NOT_AUTHORIZED |
| **Production Deployment** | NOT_AUTHORIZED |
| **Phase 4** | NOT_AUTHORIZED |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md |
| **Affected Phases** | Phase 3, P3-S1 |
| **Approver** | ChatGPT Command Center |
| **Basis** | Phase 3 CI Run 30000394880 — SHA 2ed57f4e |
| **Status** | **ACCEPTED / COMPLETE / FROZEN** |
---

## D-030: Phase 4 � Transaction Engine Batch A authorization

| Field | Value |
|---|---|
| **Decision ID** | D-030 |
| **Date** | 2026-07-23 |
| **Source** | ChatGPT Command Center � Phase 4 Batch A Authorization |
| **Old Rule** | Phase 4 NOT_AUTHORIZED; P4-S0 contract freeze pending |
| **New Decision** | Phase 4 � Transaction Engine Batch A (P4-S1 through P4-S4) authorized with 43 frozen product contracts (P4-D01 through P4-D44). P4-S5 through P4-S8 NOT_AUTHORIZED. Main PR/Main Merge NOT_AUTHORIZED. Production deployment NOT_AUTHORIZED. |
| **Reason** | Command Center approved Phase 4 contracts (P4-D01 through P4-D44). P4-S0 contract freeze accepted. Batch A engineering execution authorized for schema, preview, confirmation, and idempotency/concurrency. |
| **Affected Files** | docs/00-master/DECISION_LOG.md, docs/00-master/PHASE_REGISTRY.md, docs/06-phase-reports/p4-s0/*, .github/workflows/p4-ci.yml |
| **Affected Phases** | Phase 4, P4-S1, P4-S2, P4-S3, P4-S4 |
| **Migration** | Forward migration for transaction schema (P4-S1 scope) |
| **Approver** | ChatGPT Command Center |
| **Basis** | Phase 4 Batch A Authorization (2026-07-23) � 43 frozen contracts P4-D01 through P4-D44 |
| **Status** | **AUTHORIZED** |

### Authorized scope

| Sub-phase | Scope |
|---|---|
| **P4-S1** | Database Schema & Transaction Domain Model |
| **P4-S2** | Merchant Transaction Preview & Validation |
| **P4-S3** | Atomic Transaction Confirmation |
| **P4-S4** | Idempotency, Duplicate Protection & Concurrency |

### Not authorized

* P4-S5 (History & Receipt List)
* P4-S6 (Reversal/Refund)
* P4-S7 (Hardening)
* P4-S8 (Final Acceptance)
* Main PR
* Main merge
* Production deployment