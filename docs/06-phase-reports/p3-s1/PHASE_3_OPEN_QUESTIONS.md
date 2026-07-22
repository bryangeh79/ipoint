# Phase 3 Open Questions and Decision Register

> **Date:** 2026-07-22
> **Base SHA:** 49735cd4552b9312425324c76c7c7f41032a8357
> **Status:** All items are DECISION_REQUIRED until Command Center resolves.

---

## 1. Architecture Decisions

| # | Question | Options | Recommended | Priority |
|---|---|---|---|---|
| A-01 | Worker infrastructure technology | BullMQ / pg-boss / database polling / custom scheduler | BullMQ (Redis-based, proven) | P0 — settlement depends on this |
| A-02 | Distributed lock mechanism | Redis SETNX / PostgreSQL advisory lock / PostgreSQL row-level lock | Redis SETNX with TTL | P0 — concurrent worker prevention |
| A-03 | Queue infrastructure | BullMQ / pg-boss / custom | BullMQ (same as worker) | P0 |
| A-04 | Redis integration module | Build dedicated NestJS module / use raw ioredis in services | NestJS module (reusable) | P0 |
| A-05 | Dedicated wallet idempotency table | Yes (follow existing pattern) / No (business-table UNIQUE constraints only) | Business-table UNIQUE constraints only | P1 |
| A-06 | Rate limiting for wallet APIs | Per-member rate limit / per-IP / none beyond existing auth rate limit | Same as auth rate limit for P3-S2; extend later | P2 |
| A-07 | Settlement worker frequency | Every N minutes / cron-based / triggered by market midnight detection | Configurable polling (default every 5 min) | P1 |
| A-08 | Wallet creation timing | Lazy (on first reward) / Eager (at member registration) | Lazy (on first qualifying event) | P1 |

---

## 2. Product Decisions

| # | Question | Options | Recommended | Priority |
|---|---|---|---|---|
| P-01 | Reward cap model | Flat cap per plan / Ratio of transaction amount / Tiered / No cap | Flat cap per plan (configurable per market) | P0 — affects plan design |
| P-02 | iPoint reward rate | Fixed percentage / Dynamic / Configurable per market | Configurable per market via reward_rule_versions | P0 — core business rule |
| P-03 | Minimum reward amount | 0.01 iPoint / 1 iPoint / Configurable | 0.01 iPoint (100 satang equivalent) | P1 |
| P-04 | Reward cap relationship to transaction amount | cap = f(transaction_amount) / cap = fixed number | DECISION_REQUIRED — product must specify | P0 |
| P-05 | Whether CAPPED auto-transitions to COMPLETED | Yes / No (separate state for admin review) | EXPLICITLY REQUIRES PRODUCT DECISION | P1 |
| P-06 | Duplicate idempotent request response | 200 (return existing) / 409 (conflict) | 200 with existing resource + warning header | P1 |

---

## 3. Decimal and Precision Decisions

| # | Question | Options | Priority |
|---|---|---|---|
| D-01 | Database numeric precision for wallet balance | (38,10) match MCP / (20,4) / (18,2) | P0 |
| D-02 | Database numeric precision for reward amounts | (38,10) / (20,4) / (12,2) | P0 |
| D-03 | Database precision for rule version rate | (12,8) / (8,6) | P0 |
| D-04 | Rounding mode | HALF_UP / HALF_DOWN / HALF_EVEN | P0 |
| D-05 | Smallest iPoint unit | 1 / 0.01 / 0.000001 / 0.0000000001 | P0 |
| D-06 | Accrual calculation order | Full precision then round / Round per step | P0 |
| D-07 | API decimal serialization | String / Number / Object {value, currency} | P1 |
| D-08 | Frontend display precision | 2 dp / 4 dp / locale-aware | P2 |

---

## 4. Security Decisions

| # | Question | Options | Priority |
|---|---|---|---|
| S-01 | Rate limit values | Numeric values for wallet endpoints | P1 |
| S-02 | Market-level rate limiting needed? | Yes / No (per-member is sufficient) | P2 |
| S-03 | Admin wallet operations audit retention | Duration / archival strategy | P2 |

---

## 5. Migration Decisions

| # | Question | Options | Priority |
|---|---|---|---|
| M-01 | Migration deployment window | Maintenance window / Rolling / Zero-downtime | Zero-downtime preferred |
| M-02 | Index creation method | CONCURRENTLY / standard | CONCURRENTLY for production |
| M-03 | Seed data requirements | Test markets / Test rule versions / Demo data | TBD per test environment |

---

## 6. Test Decisions

| # | Question | Options | Priority |
|---|---|---|---|
| T-01 | Test database strategy | In-memory SQLite / Dedicated PostgreSQL test DB / Shared DB | Follow existing pattern |
| T-02 | E2E test framework | Playwright (existing) / API-only tests / Full browser tests | API tests for wallet; Playwright if UI involved |
| T-03 | Settlement worker test approach | Integration tests with real DB / Mocked worker / Both | Integration tests for core logic; mocked for error cases |

---

## 7. Previously Resolved (from LOCKED contracts)

These decisions are already made and NOT open:

| Item | Decision |
|---|---|
| Wallet ownership | member_id + market_id |
| Reward destination | Consumption market (not Current Market, not Account Country) |
| Ledger immutability | Append-only. Corrections use compensating entries. |
| No JavaScript Number | Database numeric for all financial calculations |
| No host timezone | IANA timezone per market, stored in each accrual record |
| NetworkOnly | Wallet APIs must be NetworkOnly |
| Memory-only tokens | No localStorage/sessionStorage for tokens |
| Merchant snapshot | Preserved at plan creation time; not rewritten |
| No PII in logs | Existing Phase 2 rule applies |
