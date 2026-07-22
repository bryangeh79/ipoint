# ADR-008: Phase 3 Decimal Precision, Worker Framework, and Distributed Lock

**Date:** 2026-07-22
**Status:** APPROVED
**Approver:** ChatGPT Command Center

## Decision 1: Decimal Precision

- **Database type:** `numeric(38, 10)` — match existing MCP ledger convention
- **Rounding mode:** HALF_UP
- **Application layer:** Server-side decimal library (e.g., decimal.js); JavaScript Number/float prohibited for authoritative financial calculation
- **API serialization:** Decimal string

## Decision 2: Worker Framework

- **Framework:** pg-boss + PostgreSQL
- **Scope:** Daily Reward Job
- **No BullMQ, no Redis as job fact source**
- **Job enqueue** should share PostgreSQL transaction with business writes where possible
- **Configuration:** retry, exponential backoff, dead-letter, job retention, concurrency, monitoring

## Decision 3: Distributed Lock

- **Mechanism:** PostgreSQL transaction-level advisory lock
- **Lock dimensions:** `job_type + market_id + local_business_date`
- **Layered approach:** pg-boss handles job claim; advisory lock provides second-level mutual exclusion per market/day
- **Not sole dedup mechanism:** entitlement table has unique constraint, ledger has idempotency key, daily job run has unique constraint

## Affected Phases

- Phase 3 — all sub-phases and agents

## Migration

- pg-boss schema must be added to database migrations
- advisory lock usage documented in runbook
