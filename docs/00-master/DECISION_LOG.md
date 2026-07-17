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
