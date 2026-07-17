# P2-S5 Readiness Report

> **Date:** 2026-07-18
> **Author:** OpenClaw
> **Status:** READINESS ASSESSMENT — AWAITING COMMAND CENTER PHASE INSTRUCTION

---

## 1. Source Documents

| Document | Path | Status |
|----------|------|--------|
| Phase Registry | `docs/00-master/PHASE_REGISTRY.md` | ✅ Current |
| Decision Log | `docs/00-master/DECISION_LOG.md` | ✅ D-001 through D-019 recorded |
| Open Questions | `docs/00-master/OPEN_QUESTIONS.md` | ✅ Current |
| Phase 2 Master Plan | `docs/06-phase-reports/p2-s1/PHASE_2_MASTER_PLAN.md` | ✅ P2-S1 freeze |
| Phase 2 Architecture | `docs/06-phase-reports/p2-s1/PHASE_2_ARCHITECTURE.md` | ✅ P2-S1 freeze |
| Phase 2 API Contract | `docs/06-phase-reports/p2-s1/PHASE_2_API_CONTRACT.md` | ✅ P2-S1 freeze |
| Phase 2 ERD | `docs/06-phase-reports/p2-s1/PHASE_2_ERD.md` | ✅ P2-S1 freeze |
| Phase 2 Security & Privacy | `docs/06-phase-reports/p2-s1/PHASE_2_SECURITY_AND_PRIVACY.md` | ✅ P2-S1 freeze |
| Phase 2 State Machines | `docs/06-phase-reports/p2-s1/PHASE_2_STATE_MACHINES.md` | ✅ P2-S1 freeze |
| Phase 2 Idempotency Spec | `docs/06-phase-reports/p2-s1/PHASE_2_IDEMPOTENCY_SPEC.md` | ✅ P2-S1 freeze |
| Phase 2 RBAC Matrix | `docs/06-phase-reports/p2-s1/PHASE_2_RBAC_MARKET_ACCESS_MATRIX.md` | ✅ P2-S1 freeze |
| Phase 2 Test & E2E Matrix | `docs/06-phase-reports/p2-s1/PHASE_2_TEST_AND_E2E_MATRIX.md` | ✅ P2-S1 freeze |
| Architecture & ERD Specification | `docs/03-architecture/03_iPoint_Database_ERD_and_Ledger_Specification_V1.0.md` | ✅ V1.0 |

---

## 2. Current Project Baseline

| Item | Value |
|------|-------|
| **Last completed phase** | P2-S4 ACCEPTED AND CLOSED |
| **Current branch** | `task/p2-s4-auth-hardening` |
| **Baseline commit** | `d7bf33c6` (P2-S4 closure) |
| **P2-S3 final commit** | `d4c51caa` |
| **P2-S2 final commit** | `72a02f3c` |
| **P2-S1 final commit** | `8cdc0b29` |
| **Root Phase 2 branch** | `phase/2-member-core-multi-market` at `8f4a35d1` |
| **All tests** | 317 passed, 0 failed, 0 skipped |
| **Existing schema** | `member_profiles`, `member_market_preferences`, `member_account_country_change_requests` already created in P2-S2 |

---

## 3. Formal P2-S5 Definition

### 3.1 Registry Entry

| Field | Value |
|-------|-------|
| **Phase** | Phase 2 — Member Core Multi-Market |
| **Sub-phase** | P2-S5 |
| **Title** | Member Profile and Multi-Market Preferences |
| **Status** | NOT_AUTHORIZED |
| **Authority** | Awaiting Command Center authorization |

### 3.2 Phase 2 Master Plan Description

| Field | Value |
|-------|-------|
| **Focus** | Member Profile and Multi-Market Preferences |
| **Output** | Profile, current market, enabled markets, and preference persistence |
| **Planned after** | P2-S4 (Member Identity, Referral and QR Foundation) |

### 3.3 Phase 2 Architecture — Domain Boundaries

| Domain | Covers | Data Sources |
|--------|--------|--------------|
| Member Profile | Profile fields and contact data | members, accounts, member_profiles, audit, timeline |
| Member Market Context | Current market and preferences | markets, member_market_preferences, audit, timeline |

### 3.4 Phase 2 API Contract — Planned Endpoints

**Member self-service (under `/members/me/`):**

| Method | Path | Purpose | P2-S5? |
|--------|------|---------|--------|
| GET | `/members/me/profile` | Read own profile | ✅ Yes |
| PATCH | `/members/me/profile` | Update own profile | ✅ Yes |
| GET | `/members/me/market` | Get current market & enabled markets | ✅ Yes |
| PATCH | `/members/me/market` | Switch current market | ✅ Yes |
| POST | `/members/me/account-country-change` | Request account country change | ✅ Yes |
| GET | `/members/me/account-country-change` | View pending country change requests | ✅ Yes |
| DELETE | `/members/me/account-country-change` | Cancel pending request | ✅ Yes |

**Endpoints NOT in P2-S5 scope** (listed for boundary clarity):
- GET/POST/DELETE `/members/me/qr` → P2-S4 (QR Foundation)
- GET `/members/me/referral` → P2-S4 (Referral)
- GET/POST `/members/me/kyc` → P2-S6 (KYC Level 2)
- GET `/member-merchants` → P2-S7 (Merchant Discovery)
- Admin endpoints → P2-S8 (Admin Member Management)

### 3.5 Existing Database Schema (from P2-S2)

All P2-S5 tables already exist:

**`member_profiles`** — columns include: `id`, `member_id`, `display_name`, `bio`, `avatar_url`, `phone_country_code`, `phone_number`, `date_of_birth`, `gender`, `preferred_language`, `preferred_currency`, `notification_preferences`, `created_at`, `updated_at`

**`member_market_preferences`** — columns include: `id`, `member_id`, `market_id`, `is_current`, `is_enabled`, `sort_order`, `created_at`, `updated_at`, with unique constraints on `(member_id, market_id)` and a partial unique on `(member_id)` where `is_current = true`

**`member_account_country_change_requests`** — columns include: `id`, `member_id`, `current_country`, `requested_country`, `status`, `reason`, `evidence_ref`, `reviewed_by`, `reviewed_at`, `review_notes`, `created_at`, `updated_at`

---

## 4. Dependencies

### 4.1 Hard Prerequisites

| Dependency | Met? | Notes |
|-----------|------|-------|
| P2-S2 (Member Schema) | ✅ | All tables exist with correct constraints |
| P2-S3 (Registration & Auth) | ✅ | Identity and authentication complete |
| P2-S4 (Identity, Referral, QR) | ✅ Completed | Member identity established |
| Auth module (AuthGuard, AuthService) | ✅ | Session management ready |
| Drizzle ORM & DatabaseService | ✅ | Production infrastructure stable |
| InMemoryRateLimiter | ✅ | Acceptable for single-instance dev/test |

### 4.2 Soft Dependencies

| Dependency | Met? | Notes |
|-----------|------|-------|
| Frontend DTOs | ❌ Not yet | API client package exists but no member-specific DTOs |
| Frontend UI | ❌ Not yet | member-web app exists but shell only |
| Redis rate limiter (AUTH-INFRA-001) | ⏸️ Deferred | Not needed for single-instance dev/test |

---

## 5. Scope Boundaries

### 5.1 In Scope (P2-S5)

- `GET /members/me/profile` — read own profile
- `PATCH /members/me/profile` — update non-immutable profile fields
- `GET /members/me/market` — get current market + enabled market list
- `PATCH /members/me/market` — switch current market (server-validated)
- `GET /members/me/account-country-change` — view pending/cancelled requests
- `POST /members/me/account-country-change` — submit country change request
- `DELETE /members/me/account-country-change` — cancel own pending request
- Profile field validation rules (display name length, phone format, date-of-birth range)
- Market switch validation (enabled market check, market active check)
- Audit logging for profile changes, market switches, country change requests
- Entity timeline entries for all mutations

### 5.2 Not in Scope

| Feature | Assigned To |
|---------|-------------|
| QR identity endpoints | P2-S4 (schema exists, API defined) |
| Referral endpoints | P2-S4 (schema exists) |
| KYC Level 2 | P2-S6 |
| Merchant discovery | P2-S7 |
| Admin member operations | P2-S8 |
| Admin country change review | P2-S8 |
| Member status changes (suspend/reactivate) | P2-S8 |
| Frontend UI | P2-S9 |
| Redis rate limiter | AUTH-INFRA-001 |

### 5.3 Product Decisions Required

| Decision | Impact | Blocks |
|----------|--------|--------|
| Profile field mandatory/optional rules | Affects PATCH validation | P2-S5 start |
| Country change request workflow (auto vs manual review) | Affects POST /account-country-change endpoint behavior | P2-S5 start |

---

## 6. Proposed Workstream Breakdown

Given the scope, P2-S5 can be split into sub-phases for parallel execution:

### Proposed Sub-Phases

| Sub-phase | Name | Scope | Parallel? |
|-----------|------|-------|-----------|
| **P2-S5A** | Profile API | `GET/PATCH /members/me/profile`, profile DTOs, validation logic, profile service | ✅ Parallel with S5B |
| **P2-S5B** | Market Context API | `GET/PATCH /members/me/market`, market preference service, current-market persistence | ✅ Parallel with S5A |
| **P2-S5C** | Country Change Request | `GET/POST/DELETE /members/me/account-country-change`, country change service | ✅ Parallel with S5A, S5B |
| **P2-S5D** | Integration & Testing | Combined HTTP integration tests, E2E flows, audit verification | ⛔ Serial (depends on A, B, C) |

### Agent Allocation

| Sub-phase | Agent | Branch |
|-----------|-------|--------|
| P2-S5A | Codex CLI #1 | `task/p2-s5a-profile-api` |
| P2-S5B | Codex CLI #2 | `task/p2-s5b-market-context` |
| P2-S5C | Codex CLI #3 | `task/p2-s5c-country-change` |
| P2-S5D | Codex CLI #4 | `task/p2-s5d-integration` |

### Branch/Worktree Plan

```
       phase/2-member-core-multi-market
       │
       ├── task/p2-s5a-profile-api
       ├── task/p2-s5b-market-context
       ├── task/p2-s5c-country-change
       │
       └── task/p2-s5d-integration ← merges A + B + C
```

Each independent sub-phase creates its own branch from the P2-S4 final state (`d7bf33c6`). The integration sub-phase merges the completed branches and adds E2E coverage.

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Profile field validation rules not defined | Medium | Medium | Must be decided by Command Center before start |
| Country change workflow undefined (auto vs manual) | Medium | Medium | Must be decided by Command Center before start |
| Frontend DTOs missing | Low | Low | API can be built without frontend DTOs; DTOs created in P2-S9 |
| P2-S4 scope leakage into P2-S5 (QR, referral) | Low | Low | Clear API contract boundaries documented in P2-S1 freeze |
| Database migration conflict | Low | Low | Existing schema covers all P2-S5 needs; no new migrations expected |

---

## 8. Recommended Execution Order

```
Step 1: Command Center issues P2-S5 authorization
        → Decision on profile field validation rules
        → Decision on country change workflow (auto vs manual review)

Step 2: ↓ (parallel)
  ├── P2-S5A: Profile API (Codex #1)
  ├── P2-S5B: Market Context API (Codex #2)
  └── P2-S5C: Country Change API (Codex #3)

Step 3: ↓
  P2-S5D: Integration & Testing (Codex #4)

Step 4: ↓
  Final verification → Delivery report → Command Center acceptance
```

---

## 9. Summary

| Item | Status |
|------|--------|
| Formal P2-S5 definition | ✅ EXIST — "Member Profile and Multi-Market Preferences" in Phase Registry, Master Plan, API Contract |
| Phase Brief | ❌ NOT CREATED — needs authoring |
| Product decisions open | ✅ 2 items (profile field rules, country change workflow) |
| Database schema | ✅ EXIST — member_profiles, member_market_preferences, member_account_country_change_requests from P2-S2 |
| API contract | ✅ DESIGNED — endpoints defined in P2-S1 freeze |
| Architecture | ✅ DOCUMENTED — domain boundaries and flows defined |
| Parallel execution possible | ✅ YES — 3 parallel workstreams (A, B, C) + 1 serial integration (D) |
| No new migrations expected | ✅ Likely — all required tables already created in P2-S2 |
| Committed test baseline | ✅ — 317 passing tests from P2-S4 |

---

**P2-S5 READINESS REPORT — COMPLETE**

Awaiting Command Center:
1. P2-S5 formal authorization
2. Decision on profile field validation rules
3. Decision on country change workflow (auto vs manual review)
4. Approval of proposed sub-phase breakdown
5. Phase Brief template or approval to author one
