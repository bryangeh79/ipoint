# Phase 3 — DECISION_REQUIRED Register

> **Author:** Agent 7 — Documentation & Delivery Evidence
> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Source:** Compiled from Agent 0 (Decimal Strategy, Open Questions, Integration Plan), Agent 1 (Wallet Contract), Agent 4 (Settlement Spec), cross-contract analysis
> **Status:** All items require ChatGPT Command Center resolution before P3-S2+ implementation

---

## 1. Purpose

This register consolidates every open decision across all Phase 3 agents into a single authoritative list. Each decision is prioritized, assigned an owner, and provided with a recommendation.

---

## 2. Priority Definitions

| Priority | Meaning                                           | Required By         |
| -------- | ------------------------------------------------- | ------------------- |
| **P0**   | Must be resolved before ANY P3-S2+ implementation | Before P3-S2 starts |
| **P1**   | Must be resolved before P3-S3 or P3-S4            | During P3-S2        |
| **P2**   | Must be resolved before P3-S5 (integration)       | During P3-S3/S4     |

---

## 3. Architecture Decisions

### A-01: Settlement Worker Framework

| Attribute              | Value                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| **Question**           | What technology should power the settlement background worker?                |
| **Options**            | BullMQ / pg-boss / Database polling / Custom scheduler                        |
| **Recommendation**     | **BullMQ** (Redis-based, proven job queue with retry, monitoring, scheduling) |
| **Priority**           | P0                                                                            |
| **Dependencies**       | Redis module (A-04); impacts: lock strategy (A-02), queue infra (A-03)        |
| **Risk if unresolved** | Settlement worker cannot be implemented                                       |
| **Source**             | P3-S1 Open Questions A-01; Integration Plan §6                                |
| **Status**             | OPEN                                                                          |

### A-02: Distributed Lock Mechanism

| Attribute              | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| **Question**           | How should concurrent settlement execution be prevented per market?         |
| **Options**            | Redis SETNX with TTL / PostgreSQL advisory lock / PostgreSQL row-level lock |
| **Recommendation**     | **Redis SETNX with TTL** (fast, no DB connection dependency)                |
| **Priority**           | P0                                                                          |
| **Dependencies**       | Redis module (A-04) if Redis chosen                                         |
| **Risk if unresolved** | Duplicate accrual during concurrent execution                               |
| **Source**             | P3-S1 Open Questions A-02; Settlement Spec                                  |
| **Status**             | OPEN                                                                        |

### A-03: Queue Infrastructure

| Attribute              | Value                                               |
| ---------------------- | --------------------------------------------------- |
| **Question**           | What queue infrastructure should be used if needed? |
| **Options**            | BullMQ / pg-boss / None (database polling only)     |
| **Recommendation**     | **BullMQ** (same as worker — single queue solution) |
| **Priority**           | P0                                                  |
| **Dependencies**       | A-01 (same decision drives both)                    |
| **Risk if unresolved** | Fragmented infrastructure decisions                 |
| **Source**             | P3-S1 Open Questions A-03                           |
| **Status**             | OPEN                                                |

### A-04: Redis Integration Module

| Attribute              | Value                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| **Question**           | Should a dedicated NestJS Redis module be built or use raw ioredis? |
| **Options**            | Build dedicated NestJS module / Use raw ioredis in services         |
| **Recommendation**     | **NestJS module** (reusable, testable, follows existing pattern)    |
| **Priority**           | P0                                                                  |
| **Dependencies**       | A-01 (only needed if BullMQ chosen)                                 |
| **Risk if unresolved** | Ad-hoc Redis usage leads to inconsistent patterns                   |
| **Source**             | P3-S1 Open Questions A-04                                           |
| **Status**             | OPEN                                                                |

### A-05: Wallet Idempotency Table

| Attribute              | Value                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| **Question**           | Should a dedicated wallet idempotency table be created?                                          |
| **Options**            | Yes (separate table) / No (UNIQUE constraints on business tables)                                |
| **Recommendation**     | **No** — UNIQUE constraint on `member_wallet_entries(account_id, idempotency_key)` is sufficient |
| **Priority**           | P1                                                                                               |
| **Risk if unresolved** | Low — both options work; UNIQUE constraint is simpler                                            |
| **Source**             | P3-S1 Open Questions A-05                                                                        |
| **Status**             | OPEN                                                                                             |

### A-06: Wallet API Rate Limiting

| Attribute              | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| **Question**           | What rate limiting strategy should apply to wallet APIs?              |
| **Options**            | Per-member rate limit / Per-IP / None beyond existing auth rate limit |
| **Recommendation**     | **Same as auth rate limit** for P3-S2; extend later if needed         |
| **Priority**           | P2                                                                    |
| **Risk if unresolved** | Low — existing global rate limit provides basic protection            |
| **Source**             | P3-S1 Open Questions A-06; API Contract Draft §9                      |
| **Status**             | OPEN                                                                  |

### A-07: Settlement Worker Frequency

| Attribute              | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| **Question**           | How often should the settlement worker poll for pending accruals? |
| **Options**            | Every N minutes / Cron-based / Market midnight detection          |
| **Recommendation**     | **Configurable polling** (default every 5 minutes)                |
| **Priority**           | P1                                                                |
| **Risk if unresolved** | Low — can be configured at deployment                             |
| **Source**             | P3-S1 Open Questions A-07                                         |
| **Status**             | OPEN                                                              |

### A-08: Wallet Creation Timing

| Attribute              | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Question**           | When should wallet accounts be created?                                      |
| **Options**            | Lazy (on first reward) / Eager (at member registration)                      |
| **Recommendation**     | **Lazy** — created on first qualifying event (reward source or admin action) |
| **Priority**           | P1                                                                           |
| **Risk if unresolved** | Low — both approaches work; lazy reduces unused wallets                      |
| **Source**             | P3-S1 Open Questions A-08                                                    |
| **Status**             | OPEN                                                                         |

---

## 4. Product Decisions

### P-01: Reward Cap Model

| Attribute              | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| **Question**           | What reward cap model should apply to reward plans?                      |
| **Options**            | Flat cap per plan / Ratio of transaction amount / Tiered / No cap        |
| **Recommendation**     | **Flat cap per plan** (configurable per market)                          |
| **Priority**           | P0                                                                       |
| **Risk if unresolved** | Reward plan design cannot be finalized; cap model affects plan lifecycle |
| **Source**             | P3-S1 Open Questions P-01; Contract Map                                  |
| **Status**             | OPEN                                                                     |

### P-02: iPoint Reward Rate Model

| Attribute              | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| **Question**           | How should iPoint reward rates be defined?                         |
| **Options**            | Fixed percentage / Dynamic / Configurable per market               |
| **Recommendation**     | **Configurable per market** via `reward_rule_versions` (versioned) |
| **Priority**           | P0                                                                 |
| **Risk if unresolved** | Core business rule cannot be configured                            |
| **Source**             | P3-S1 Open Questions P-02                                          |
| **Status**             | OPEN                                                               |

### P-03: Minimum Reward Amount

| Attribute              | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| **Question**           | What is the minimum iPoint reward that can be accrued?            |
| **Options**            | 0.01 iPoint / 1 iPoint / Configurable                             |
| **Recommendation**     | **0.01 iPoint** (100 satang equivalent; minimum displayable unit) |
| **Priority**           | P1                                                                |
| **Risk if unresolved** | Low — can be configured at deployment                             |
| **Source**             | P3-S1 Open Questions P-03                                         |
| **Status**             | OPEN                                                              |

### P-04: Cap Relationship to Transaction Amount

| Attribute              | Value                                                                     |
| ---------------------- | ------------------------------------------------------------------------- |
| **Question**           | Is the reward cap a function of the transaction amount or a fixed number? |
| **Options**            | `cap = f(transaction_amount)` / `cap = fixed_number`                      |
| **Recommendation**     | **DECISION_REQUIRED** — Product must specify relationship                 |
| **Priority**           | P0                                                                        |
| **Risk if unresolved** | Reward plan cap design is ambiguous                                       |
| **Source**             | P3-S1 Open Questions P-04                                                 |
| **Status**             | OPEN — requires product input                                             |

### P-05: CAPPED → COMPLETED Auto-Transition

| Attribute              | Value                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| **Question**           | Should CAPPED plans auto-transition to COMPLETED, or remain CAPPED for admin review? |
| **Options**            | Yes (auto-complete) / No (separate state for admin review)                           |
| **Recommendation**     | **EXPLICITLY REQUIRES PRODUCT DECISION**                                             |
| **Priority**           | P1                                                                                   |
| **Risk if unresolved** | Plans may accumulate in CAPPED state if no auto-transition                           |
| **Source**             | P3-S1 Open Questions P-05                                                            |
| **Status**             | OPEN — requires product input                                                        |

### P-06: Duplicate Idempotent Response

| Attribute              | Value                                                 |
| ---------------------- | ----------------------------------------------------- |
| **Question**           | How should a duplicate idempotent request be handled? |
| **Options**            | 200 (return existing) / 409 (conflict)                |
| **Recommendation**     | **200 with existing resource** + warning header       |
| **Priority**           | P1                                                    |
| **Risk if unresolved** | Low — both are valid; 200 is more client-friendly     |
| **Source**             | P3-S1 Open Questions P-06; Idempotency Spec           |
| **Status**             | OPEN                                                  |

---

## 5. Decimal and Precision Decisions

### D-01: Wallet Balance Database Precision

| Attribute              | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| **Question**           | What numeric precision for `member_wallet_accounts.balance`?   |
| **Options**            | `numeric(38,10)` match MCP / `numeric(20,4)` / `numeric(18,2)` |
| **Recommendation**     | **`numeric(38,10)`** — match MCP ledger convention             |
| **Priority**           | P0                                                             |
| **Risk if unresolved** | Schema cannot be implemented; ALL wallet fields affected       |
| **Source**             | P3-S1 Open Questions D-01; Decimal Strategy §2                 |
| **Status**             | OPEN                                                           |

### D-02: Reward Amount Database Precision

| Attribute              | Value                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| **Question**           | What numeric precision for reward amounts (`total_earned`, `cap_amount`, accruals)? |
| **Options**            | `numeric(38,10)` / `numeric(20,4)` / `numeric(12,2)`                                |
| **Recommendation**     | **`numeric(38,10)`** — consistent with wallet balance                               |
| **Priority**           | P0                                                                                  |
| **Risk if unresolved** | Schema cannot be implemented                                                        |
| **Source**             | P3-S1 Open Questions D-02; Decimal Strategy §2                                      |
| **Status**             | OPEN                                                                                |

### D-03: Rule Version Rate Precision

| Attribute              | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| **Question**           | What numeric precision for `reward_rule_versions.rate`?               |
| **Options**            | `numeric(12,8)` / `numeric(8,6)`                                      |
| **Recommendation**     | **`numeric(12,8)`** — supports rates from 0.000001% to 9999.99999999% |
| **Priority**           | P0                                                                    |
| **Risk if unresolved** | Schema cannot be implemented                                          |
| **Source**             | P3-S1 Open Questions D-03; Decimal Strategy §4                        |
| **Status**             | OPEN                                                                  |

### D-04: Rounding Mode

| Attribute              | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| **Question**           | What rounding mode should be used for accrual calculation?            |
| **Options**            | HALF_UP / HALF_DOWN / HALF_EVEN                                       |
| **Recommendation**     | **HALF_UP** — standard financial rounding, most intuitive for members |
| **Priority**           | P0                                                                    |
| **Risk if unresolved** | Accrual amounts differ by rounding mode; audit impact                 |
| **Source**             | P3-S1 Open Questions D-04; Decimal Strategy §6                        |
| **Status**             | OPEN                                                                  |

### D-05: Smallest iPoint Unit

| Attribute              | Value                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Question**           | What is the smallest iPoint unit for member display?                                        |
| **Options**            | 1 (whole) / 0.01 (2dp) / 0.000001 (6dp) / 0.0000000001 (10dp)                               |
| **Recommendation**     | **Display:** 0.01 iPoint (2dp) / **Calculation:** 0.000001 iPoint (6dp) / **Storage:** 10dp |
| **Priority**           | P0                                                                                          |
| **Risk if unresolved** | UI formatting and calculation precision ambiguous                                           |
| **Source**             | P3-S1 Open Questions D-05; Decimal Strategy §5                                              |
| **Status**             | OPEN                                                                                        |

### D-06: Accrual Calculation Order

| Attribute              | Value                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| **Question**           | Should accrual be rounded per-step or at final amount?                  |
| **Options**            | Full precision then round / Round per step                              |
| **Recommendation**     | **Round per step** — prevents micro-fraction overflow in cap comparison |
| **Priority**           | P0                                                                      |
| **Risk if unresolved** | Cap comparison may behave differently                                   |
| **Source**             | P3-S1 Open Questions D-06; Decimal Strategy §7                          |
| **Status**             | OPEN                                                                    |

### D-07: API Decimal Serialization

| Attribute              | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| **Question**           | How should decimal values be serialized in API responses?   |
| **Options**            | String / Number / Object `{value, currency}`                |
| **Recommendation**     | **String** — lossless, matches financial API best practices |
| **Priority**           | P1                                                          |
| **Risk if unresolved** | Clients must parse consistently                             |
| **Source**             | P3-S1 Open Questions D-07; Decimal Strategy §9              |
| **Status**             | OPEN                                                        |

### D-08: Frontend Display Precision

| Attribute              | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| **Question**           | How many decimal places should be shown in member UI?                       |
| **Options**            | 2 dp / 4 dp / Locale-aware                                                  |
| **Recommendation**     | **2 decimal places default** — locale-aware precision as future enhancement |
| **Priority**           | P2                                                                          |
| **Risk if unresolved** | Low — UI can be adjusted later                                              |
| **Source**             | P3-S1 Open Questions D-08; Decimal Strategy §10                             |
| **Status**             | OPEN                                                                        |

---

## 6. Type System Decisions

### T-01: Branded Type Convention

| Attribute              | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| **Question**           | Should branded types use `__brand` or `__type` pattern?                  |
| **Options**            | `__brand` / `__type`                                                     |
| **Recommendation**     | **`__brand`** — matches existing codebase usage where pattern is applied |
| **Priority**           | P1                                                                       |
| **Risk if unresolved** | Type system inconsistency                                                |
| **Source**             | Shared Types Registry §12                                                |
| **Status**             | OPEN                                                                     |

### T-02: Amount Type in CreateLedgerEntryParams

| Attribute              | Value                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Question**           | Should `CreateLedgerEntryParams` use `string` for amounts or a `Decimal` wrapper? |
| **Options**            | `string` / `Decimal` wrapper class                                                |
| **Recommendation**     | **`string`** — simpler, matches API serialization format (D-07)                   |
| **Priority**           | P1                                                                                |
| **Risk if unresolved** | Type inconsistency between agents                                                 |
| **Source**             | Shared Types Registry §12                                                         |
| **Status**             | OPEN                                                                              |

### T-03: MarketLocalDate.localDate Type

| Attribute              | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| **Question**           | Should `MarketLocalDate.localDate` be a string or Date object? |
| **Options**            | `string` (YYYY-MM-DD) / `Date`                                 |
| **Recommendation**     | **`string` (YYYY-MM-DD)** — avoids timezone ambiguity          |
| **Priority**           | P1                                                             |
| **Risk if unresolved** | Timezone-mangled date values                                   |
| **Source**             | Shared Types Registry §12                                      |
| **Status**             | OPEN                                                           |

### T-04: AuditEventType Format

| Attribute              | Value                                                 |
| ---------------------- | ----------------------------------------------------- |
| **Question**           | Should `AuditEventType` be a string union or an enum? |
| **Options**            | Union type / Enum                                     |
| **Recommendation**     | **Union type** — more flexible for extensibility      |
| **Priority**           | P2                                                    |
| **Risk if unresolved** | Low — both work; union is more TypeScript-idiomatic   |
| **Source**             | Shared Types Registry §12                             |
| **Status**             | OPEN                                                  |

---

## 7. Security Decisions

### S-01: Rate Limit Values

| Attribute              | Value                                                      |
| ---------------------- | ---------------------------------------------------------- |
| **Question**           | What numeric rate limits should apply to wallet endpoints? |
| **Options**            | Same as auth (N req/min) / Different values                |
| **Recommendation**     | **100 requests/minute per member** for wallet reads        |
| **Priority**           | P1                                                         |
| **Risk if unresolved** | Low — can be adjusted at config without code changes       |
| **Source**             | P3-S1 Open Questions S-01                                  |
| **Status**             | OPEN                                                       |

### S-02: Market-Level Rate Limiting

| Attribute              | Value                                                   |
| ---------------------- | ------------------------------------------------------- |
| **Question**           | Is per-market rate limiting needed?                     |
| **Options**            | Yes / No (per-member is sufficient)                     |
| **Recommendation**     | **No** — per-member rate limiting is sufficient for MVP |
| **Priority**           | P2                                                      |
| **Risk if unresolved** | None for MVP                                            |
| **Source**             | P3-S1 Open Questions S-02                               |
| **Status**             | OPEN                                                    |

### S-03: Audit Retention Duration

| Attribute              | Value                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| **Question**           | How long should wallet/reward audit events be retained?                |
| **Options**            | Configurable duration / Archival strategy                              |
| **Recommendation**     | **Configurable** — align with existing platform audit retention policy |
| **Priority**           | P2                                                                     |
| **Risk if unresolved** | Low — follows existing Phase 2 rules                                   |
| **Source**             | P3-S1 Open Questions S-03                                              |
| **Status**             | OPEN                                                                   |

---

## 8. Migration Decisions

### M-01: Migration Deployment Window

| Attribute              | Value                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| **Question**           | What type of maintenance window for Phase 3 migration?                        |
| **Options**            | Maintenance window / Rolling / Zero-downtime                                  |
| **Recommendation**     | **Zero-downtime preferred** — all new tables, no existing schema modification |
| **Priority**           | P2                                                                            |
| **Risk if unresolved** | Low — can be decided at deployment time                                       |
| **Source**             | P3-S1 Open Questions M-01                                                     |
| **Status**             | OPEN                                                                          |

### M-02: Index Creation Method

| Attribute              | Value                                                      |
| ---------------------- | ---------------------------------------------------------- |
| **Question**           | Should indexes be created with CONCURRENTLY?               |
| **Options**            | CONCURRENTLY / Standard (blocking)                         |
| **Recommendation**     | **CONCURRENTLY** for production; standard for dev/staging  |
| **Priority**           | P2                                                         |
| **Risk if unresolved** | Low — standard indexes are fine for small tables initially |
| **Source**             | P3-S1 Open Questions M-02                                  |
| **Status**             | OPEN                                                       |

### M-03: Seed Data Requirements

| Attribute              | Value                                                     |
| ---------------------- | --------------------------------------------------------- |
| **Question**           | What seed data should be included with Phase 3 migration? |
| **Options**            | Test markets / Test rule versions / Demo data             |
| **Recommendation**     | **TBD per test environment** — not production-critical    |
| **Priority**           | P2                                                        |
| **Risk if unresolved** | Low — seed data defined during test setup                 |
| **Source**             | P3-S1 Open Questions M-03                                 |
| **Status**             | OPEN                                                      |

---

## 9. Test Decisions

### T-01: Test Database Strategy

| Attribute              | Value                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Question**           | What test database approach should Phase 3 use?                              |
| **Options**            | In-memory SQLite / Dedicated PostgreSQL test DB / Shared DB                  |
| **Recommendation**     | **Follow existing pattern** — consistent with Phase 0/1/2 test configuration |
| **Priority**           | P2                                                                           |
| **Risk if unresolved** | Low — existing pattern is proven                                             |
| **Source**             | P3-S1 Open Questions T-01                                                    |
| **Status**             | OPEN                                                                         |

### T-02: E2E Test Framework

| Attribute              | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| **Question**           | What E2E test approach for Phase 3?                                |
| **Options**            | Playwright (existing) / API-only tests / Full browser tests        |
| **Recommendation**     | **API tests** for wallet/reward; Playwright if UI components added |
| **Priority**           | P2                                                                 |
| **Risk if unresolved** | Low — both frameworks available                                    |
| **Source**             | P3-S1 Open Questions T-02                                          |
| **Status**             | OPEN                                                               |

### T-03: Settlement Worker Test Approach

| Attribute              | Value                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| **Question**           | How should the settlement worker be tested?                      |
| **Options**            | Integration tests with real DB / Mocked worker / Both            |
| **Recommendation**     | **Integration tests** for core logic; **mocked** for error cases |
| **Priority**           | P2                                                               |
| **Risk if unresolved** | Low — test approach refined as code is written                   |
| **Source**             | P3-S1 Open Questions T-03                                        |
| **Status**             | OPEN                                                             |

---

## 10. Decision Summary Dashboard

### By Priority

| Priority  | Count  |
| --------- | ------ |
| **P0**    | 15     |
| **P1**    | 11     |
| **P2**    | 12     |
| **Total** | **38** |

### By Category

| Category          | Count |
| ----------------- | ----- |
| Architecture      | 8     |
| Product           | 6     |
| Decimal/Precision | 8     |
| Type System       | 4     |
| Security          | 3     |
| Migration         | 3     |
| Test              | 3     |

### Recommended Batch Decision (Agent 0 Proposal)

Agent 0's Decimal Strategy proposes converting these 11 decisions to one batch approval:

| Decision                            | Recommendation    |
| ----------------------------------- | ----------------- |
| D-01 Wallet balance precision       | `numeric(38,10)`  |
| D-02 Reward amount precision        | `numeric(38,10)`  |
| D-03 Rule version rate precision    | `numeric(12,8)`   |
| D-04 Rounding mode                  | HALF_UP           |
| D-05 Smallest iPoint unit (display) | 2 dp (0.01)       |
| D-05 Smallest iPoint unit (calc)    | 6 dp (0.000001)   |
| D-06 Accrual calc order             | Per-step rounding |
| D-07 API serialization              | String            |
| D-08 Frontend display precision     | 2 dp default      |
| T-02 Amount type in params          | String            |
| T-03 LocalDate type                 | String YYYY-MM-DD |

**If approved in batch**, 11 individual decisions become 1.

---

## 11. Quick Resolution Path

### Must Resolve Before P3-S2 (P0, in priority order)

| #   | ID           | Summary                                    | Recommended                        |
| --- | ------------ | ------------------------------------------ | ---------------------------------- |
| 1   | D-01 to D-08 | Batch precision + rounding + serialization | Match MCP (38,10), HALF_UP, String |
| 2   | P-01         | Reward cap model                           | Flat cap per plan                  |
| 3   | P-02         | Reward rate model                          | Configurable per market via rules  |
| 4   | P-04         | Cap vs transaction relationship            | Product specification needed       |
| 5   | A-01         | Worker framework                           | BullMQ                             |
| 6   | A-02         | Distributed lock                           | Redis SETNX with TTL               |
| 7   | A-03         | Queue infrastructure                       | BullMQ                             |
| 8   | A-04         | Redis module                               | Build NestJS module                |

### Can Defer to P3-S2 (P1)

| #   | ID   | Summary                                                      |
| --- | ---- | ------------------------------------------------------------ |
| 1   | A-05 | Wallet idempotency table (recommend: use UNIQUE constraints) |
| 2   | A-07 | Settlement frequency (recommend: configurable 5 min polling) |
| 3   | A-08 | Wallet creation timing (recommend: lazy)                     |
| 4   | P-03 | Minimum reward amount (recommend: 0.01)                      |
| 5   | P-05 | CAPPED → COMPLETED auto-transition (product decision)        |
| 6   | P-06 | Duplicate idempotent response (recommend: 200)               |
| 7   | T-01 | Branded type convention (recommend: \_\_brand)               |
| 8   | T-02 | Amount type in params (recommend: string)                    |
| 9   | T-03 | LocalDate type (recommend: string)                           |
| 10  | S-01 | Rate limit values (recommend: 100 req/min)                   |

### Safe to Defer to P3-S3/S4 (P2)

All remaining items in Security, Migration, Test, and Type categories.

---

## 12. Related Documents

| Document                  | Location                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Open Questions (P3-S1)    | [`../p3-s1/PHASE_3_OPEN_QUESTIONS.md`](../p3-s1/PHASE_3_OPEN_QUESTIONS.md)                       |
| Decimal Strategy          | [`../p3-agent0/PHASE_3_DECIMAL_STRATEGY.md`](../p3-agent0/PHASE_3_DECIMAL_STRATEGY.md)           |
| Shared Types Registry     | [`../p3-agent0/PHASE_3_SHARED_TYPES_REGISTRY.md`](../p3-agent0/PHASE_3_SHARED_TYPES_REGISTRY.md) |
| Delivery Evidence Summary | [`./P3_S1_DELIVERY_EVIDENCE.md`](./P3_S1_DELIVERY_EVIDENCE.md)                                   |
| Known Risk Register       | [`./KNOWN_RISK_REGISTER.md`](./KNOWN_RISK_REGISTER.md)                                           |
| Phase 3 Architecture      | [`../../03-architecture/PHASE_3_ARCHITECTURE.md`](../../03-architecture/PHASE_3_ARCHITECTURE.md) |
