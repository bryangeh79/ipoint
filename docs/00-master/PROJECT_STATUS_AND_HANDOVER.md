# iPoint V1 - Project Status & Handover (进度总览与交接档案)

> **Purpose:** A single entry point for any new agent taking over this repository. Read this file FIRST (after AGENTS.md) to know exactly where the project stands, what is done, what is missing, and what is allowed next.
> **Status:** `IPOINT_V1_ENGINEERING_COMPLETE` (D-083, 2026-08-12) - iPoint V1 engineering is COMPLETE and FROZEN.
> **Last updated:** 2026-08-12 | **Maintained by:** OpenClaw (project GM). Update this file at every major state change; always reference decision IDs (D-xxx).

---

## 0. TL;DR (read this if you read nothing else)

- **Project:** iPoint - consumption-reward points platform (Member / Merchant / Admin apps; one account, multi-market). Modular monolith, pnpm TypeScript monorepo: React/Vite web apps + NestJS API + PostgreSQL 17 + Redis 7 + Drizzle ORM.
- **Engineering status:** **V1 ENGINEERING COMPLETE - CLOSED / FROZEN** (D-083). Final gate P8-S9 **32/32 GREEN**, **0 unresolved CRITICAL / 0 unresolved HIGH**. `main` untouched (`69240bf8`); all work lives on `phase/8-final-delivery-readiness`.
- **Progress:** SELLABLE_DELIVERABLE_PROGRESS **93.75%** (below 100% for exactly three UI gaps, see §6); PRODUCTION_READY_V1_PROGRESS **100%**.
- **Do NOT:** merge to `main`, push `main`, deploy to production, modify frozen domains, touch the untracked baseline, or implement Phase 12 backlog items - all require explicit new decisions (Bryan for business/commercial, per D-079).
- **Next decision point:** the **production-launch strategy gate** (Bryan-exclusive): production deployment, SEC-01 advisory re-review, backup/PITR config, Redis pool-acquire-timeout config.

---

## 1. Governance model (who decides what)

| Role | Persona | Authority |
|---|---|---|
| **Bryan** | Final business decision owner | Approves business/commercial/legal decisions (deployment, payment rules, commissions, reward rates, positioning, paid commitments). Highest authority. |
| **ChatGPT Command Center** | Product commander & architecture authority | Original acceptance authority. **Unavailable to the project since 2026-08-11**; Bryan authorized OpenClaw to fully succeed the role through V1 closure (D-079, revocable). |
| **OpenClaw** | Project general manager | Does NOT write production code. Decomposes phases, dispatches executors, prevents conflicts, collects evidence, records decisions, files gate records. Succeeded Command Center per D-079 for the remainder of V1 (incl. final acceptance; issued D-083). |
| **Codex CLI / OpenClaw-managed subagents** | Engineering executors | The only code writers (A implementer -> B independent reviewer -> C verifier model; D-048/D-060 alternate executors while Codex CLI unavailable). |

Key decisions: D-058 (Phase 8 authorization, consolidation), D-079 (OpenClaw full succession), D-082 (final gate green), D-083 (V1 closure + gap archive).

## 2. Repository layout

```
apps/
  api/            NestJS backend (domain modules, controllers, services)
  admin-web/      Admin UI (React/Vite PWA)
  member-web/     Member UI (React/Vite PWA)
  merchant-web/   Merchant UI (React/Vite PWA)
packages/
  database/       Drizzle schema + versioned migrations (40 migrations, checksums 40/40 frozen)
  api-client/     Typed API clients (append-only growth discipline)
  ...             shared packages (design system, config, etc.)
docs/
  00-master/      GOVERNANCE (read these): DECISION_LOG, PHASE_REGISTRY, OPEN_QUESTIONS,
                  PROJECT_MASTER_CONTROL, DOCUMENT_AUTHORITY, BASELINE_ACKNOWLEDGMENT_V1.1,
                  EXECUTOR_PROVENANCE_REGISTER, PROJECT_STATUS_AND_HANDOVER (this file)
  06-phase-reports/  Per-phase delivery reports, gate records, fix records (p1-s1 ... p8-s10)
.github/workflows/  p8-ci.yml - full-repo Phase 8 CI (6 jobs; fail-closed `ipoint_p8sN_*` test DBs)
```

## 3. Current engineering state (as of 2026-08-12)

| Item | Value |
|---|---|
| Branch | `phase/8-final-delivery-readiness` (local = remote) |
| Phase 8 status | **ACCEPTED / COMPLETE / CLOSED / FROZEN** (D-083) |
| V1 status | **IPOINT_V1_ENGINEERING_COMPLETE** (D-083) |
| Final gate | P8-S9 **32/32 GREEN**, unmet list none, **0 unresolved CRITICAL / 0 unresolved HIGH** (D-082) |
| Migrations | 40 migrations; checksums **40/40 frozen**; fresh+upgrade rehearsal 40/40 x2 |
| Tests | unit **2,114 passed / 52 skipped**; integration **116/116** real-PG + UAT L0 **36/36** (224 assertions); browser E2E **7/7** |
| OpenAPI | **301 paths**, 0 duplicate operationId, 0 missing schemas |
| RBAC | **51/51** controllers guarded; zero-owner-bypass scan 485 files / **0 direct bypass** |
| Secrets | 1,234 tracked files CLEAN |
| Dependency audit | prod **0C/6H/14M/2L** (6 HIGH = D-075 Bryan accepted set, financial-path zero exposure) |
| `main` | `69240bf8` - **untouched** (no Main PR / merge / push / deploy ever) |

## 4. Milestone timeline

| Phase | Scope | Final status | Authority |
|---|---|---|---|
| Phase 0 | Foundation: DB skeleton, auth, RBAC, market, audit, design tokens | APPROVED / CLOSED | D-009 |
| Phase 1 | Merchant Onboarding + MCP Ledger | COMPLETE / ACCEPTED | D-013 |
| Phase 2 | Member Core (profile, KYC, QR, discovery, market, referral) | COMPLETE | D-027 |
| Phase 3 | iPoint Wallet Ledger + Reward Plan + 00:00 Daily Job | COMPLETE / FROZEN | D-029 |
| Phase 4 | Transaction Engine | COMPLETE / CLOSED | D-038 |
| Phase 5 | Agent & Commission Engine | COMPLETE / CLOSED / FROZEN | D-042 |
| Phase 6 | Redemption Center | COMPLETE / CLOSED / FROZEN | D-045 |
| Phase 7 | Admin Operations (+ owner remediations D-051..D-054, SEC-01, SEC-02, O-13) | COMPLETE / CLOSED / FROZEN | D-057 |
| Phase 8 | Final Delivery & Production Readiness (P8-S0..P8-S10; consolidated old Phases 8-11) | **ACCEPTED / CLOSED / FROZEN** | D-058, D-082, **D-083** |
| Phase 12 | Deferred future backlog (incl. UI-1/UI-2/UI-3 added at closure) | DEFERRED (needs new decision) | D-058, D-083 |

Phase 8 sub-phase highlights: S1 Ads & Content (`d41a33d7`) · S2 Reconciliation engine (`8642ec2c`) · S3 Risk/Fraud engine (`04babe35`) · S4 Advanced Reports (`79a86e57`) · S5a reports UI (`e701ebd3`) · S5b member UI (`a71d0a46`) · S5c merchant transaction UI (`7fe4ed28`) · S5d full-repo CI (`eb83daaf`) · S5e consistency matrix (`b043e932`) · S6 Load/Perf (`dc6a69ee`) · S7 Backup/Monitoring/Security (`7916df69`) · S8 Final UAT (`6a64a3c6`+`8095a9b6`) · OBS-04 fix (`8d452835`) · SEC-01 fix (`50808892`) · L-06 member QR (`50a0ac94`) · P8-S9 gate (`63d3eb6e` + record `4a15b207`) · P8-S10 delivery report (`b3e3838a`) · **V1 closure (`26136cf0`, D-083)**.

## 5. Delivery evidence (where to look)

- **Final gate:** `docs/06-phase-reports/p8-s9/P8_S9_PRODUCTION_READINESS_GATE_REPORT.md` (32-row matrix) + `P8_S9_FINAL_GATE_RECORD.md` (independent audit addenda A1-A3)
- **Delivery inventory + progress recomputation:** `docs/06-phase-reports/p8-s10/PHASE_8_FINAL_DELIVERY_REPORT.md`
- **Gap archive (the honest list):** `docs/06-phase-reports/p8-s10/IPOINT_V1_CLOSURE_RECORD.md` (see §6 summary)
- **Per-phase reports:** `docs/06-phase-reports/p<phase>-s<sub>/` (gate records per sub-phase)
- **Decision history:** `docs/00-master/DECISION_LOG.md` (D-001..D-083, append-only)
- **Phase status matrix:** `docs/00-master/PHASE_REGISTRY.md`
- **Executor provenance:** `docs/00-master/EXECUTOR_PROVENANCE_REGISTER.md`

## 6. Known gaps - ACCEPTED WITH LIMITATION (recorded, not hidden)

All gaps below are formally accepted at V1 closure (D-083); none are defects and none affect the 0-Critical/0-High declaration. Full details: `IPOINT_V1_CLOSURE_RECORD.md` §4.

| ID | Gap | Impact | Disposition |
|---|---|---|---|
| UI-1 | Reconciliation admin-web management UI (run/exception queue surface) | Backend/API delivered (P8-S2); UI absent | Phase 12 backlog - future work, new decision required |
| UI-2 | Risk/fraud admin-web review UI | Backend/API delivered (P8-S3); UI absent | Phase 12 backlog |
| UI-3 | Merchant reversal/refund UI | Backend delivered (Phase 4); UI out of G-05(a) scope | Phase 12 backlog |
| OBS-06 | merchant-web transactions page INTERNAL_ERROR state in E2E harness | Low; backend green; root cause not isolated | P9-class triage (UI polish) |
| OBS-07 | member-web client path misuse (`/profile`, `/markets` etc. vs backend routes) | No backend impact | P9-class triage (routing polish) |
| OBS-10 | member-home red error panel (OBS-07 family) | Low | P9-class triage |
| QR display UI | member-web QR display page for delivered `/members/me/qr` API | API complete (D-081); display page absent | P9 follow-up (does NOT re-open the API) |
| SEC-01 remainder | 6 HIGH dependency advisories (lodash x1, js-yaml x2, fast-uri x2, react-router x1) | Financial-path zero exposure; Bryan written acceptance (D-075) | Re-review at production-launch gate |
| D-078 L-2 | Untracked stale-filename test artifact `packages/database/tests/p6-s1-schema.test.ts` | Excluded from CI; hygiene only | Cleanup requires explicit approval |

## 7. Handover checklist - what a new agent must do first

1. Verify repository state (must all hold):
   ```bash
   git rev-parse --show-toplevel        # C:/AI_WORKSPACE/iPoint App
   git remote -v                        # origin = https://github.com/bryangeh79/ipoint.git
   git branch --show-current            # phase/8-final-delivery-readiness
   git status --short                   # tracked 0 modified; untracked baseline untouched
   git log --oneline -3                 # 26136cf0 (closure) -> b3e3838a (P8-S10) -> 4a15b207 (gate record)
   ```
2. Read in order: `AGENTS.md` → this file → `PROJECT_MASTER_CONTROL.md` → `DOCUMENT_AUTHORITY.md` → `OPENCLAW_OPERATING_RULES.md` → `BASELINE_ACKNOWLEDGMENT_V1.1.md` → `DECISION_LOG.md` (tail) → `PHASE_REGISTRY.md` → `OPEN_QUESTIONS.md`.
3. Read the gap archive: `docs/06-phase-reports/p8-s10/IPOINT_V1_CLOSURE_RECORD.md`.
4. If resuming verification work: run `pnpm db:checksum` (expect 40/40), `pnpm typecheck`, `pnpm lint`, and consult `.github/workflows/p8-ci.yml` for the canonical CI envelope. Do NOT re-run heavy load/UAT evidence (recorded as standing, per D-082).
5. Communicate in Chinese (all sessions/channels, per Bryan directive D-049). Repository docs/commits stay in English.

## 8. Boundaries & prohibitions (unchanged, enforced)

- ❌ Main PR / Main Merge / Push Main / Production Deployment - **NOT_AUTHORIZED**
- ❌ Modifying frozen domain code (Phase 3-8 technical baseline) without explicit new authorization
- ❌ Implementing Phase 12 deferred backlog items (incl. UI-1/UI-2/UI-3) - new decision required
- ❌ Implementing OPEN questions from `OPEN_QUESTIONS.md`
- ❌ Changing LOCKED business rules / hard-coding CONFIGURABLE values
- ❌ Deleting, cleaning, stashing, or batch-adding untracked files (baseline discipline; 100+ untracked items are official observed baseline)
- ❌ Force-push / rebase / amend pushed history
- ✅ Allowed: reading/analyzing, governance updates, preparing proposals, evidence collection, and - after a new Bryan decision - executing the production-launch gate

## 9. Next decision points (all Bryan-exclusive per D-079)

| Decision | Gate | Held items |
|---|---|---|
| Production launch strategy | production-launch gate | Deployment authorization, SEC-01 6-HIGH re-review, production backup/PITR config, Redis pool-acquire-timeout config (D-077 note) |
| Post-V1 backlog prioritization | new decision | Phase 12 items + UI-1/UI-2/UI-3 + P9 triage items (OBS-06/07/10, QR display UI) |

## 10. How to keep this file truthful

- Update after every major state change (phase status, decisions D-xxx, new gaps, branch moves).
- Keep every claim traceable: cite decision IDs, gate records, or commit SHAs. Never write "done" without a reference.
- Never delete history: this file supersedes, it does not erase.

---

_End of Project Status & Handover. Maintained by OpenClaw (D-079, revocable). 2026-08-12._
