# P5-R1 — Independent Review Record (Phase 5 Agent/Commission Owner Remediation)

> **Task ID:** P5-R1-REVIEW
> **Reviewer executor class:** OPENCLAW_MANAGED_CODING_SUBAGENT (independent reviewer under D-048 §7B)
> **Branch:** `fix/p5-r1-agent-commission-owner` (worktree `.local/wt-p5-r1`)
> **Starting SHA (review base):** `06f00964a8f640da397064377a4731d3b01cb80e`
> **HEAD reviewed:** `8566c2c1f5397db2bf4471a59c4c0c56c1ce83d2`
> **Commits reviewed (5):**
> - `5f81e8847c2366e3462dbef9b9e7da648f45b387` fix(p5): retire doubled and dead commission/agent/referral routes (4.1)
> - `f165802d6e1c788a3a590cc125e886882834a387` fix(p5): enforce permissions, selected market and actor attribution (4.2, 4.5)
> - `01cc1c7b32400ae51f3b2ed9117f8e306f4e0b00` feat(p5): version and snapshot the RM388.00 MYR activation fee (4.3, 4.4)
> - `00ae6555e3e7a06f531be0d5dd6f6ee370ccaf8b` test(p5): owner remediation suite and canonical expectation updates
> - `8566c2c1f5397db2bf4471a59c4c0c56c1ce83d2` docs(p5-r1): record owner remediation fix record
> **Review date:** 2026-08-04
> **Implementer's fix record reviewed:** `docs/06-phase-reports/p5-r1/P5-R1_OWNER_REMEDIATION_FIX_RECORD.md`
> **Governance read:** AGENTS.md; DOCUMENT_AUTHORITY.md (ranks 1–12); DECISION_LOG D-042/D-042-A, D-047, D-048; P5-S0 contract (`docs/05-phase-contracts/P5-S0-AGENT-COMMISSION-ENGINE-CONTRACT.md`); P7-S0 contract §6.3/§7/§13–15; P7-S1 breakdown §5.
> **Independent test DB:** `ipoint_p5r1_review_test` (PostgreSQL `172.23.0.3:5432`, user `ipoint`) — dropped and recreated by this reviewer; migrations 0000–0029 applied via `tsx packages/database/src/migration-runner.ts`; seeds applied via `tsx packages/database/seeds/index.ts`; `db:drift` reports **no schema drift**; migration count verified = **30** (min `0000_database_foundation.sql`, max `0029_p5_r1_agent_fee_version_snapshot.sql`).

---

## 1. Per-dimension findings (D-048 §7B)

### 1.1 Diff scope — **VERIFIED**
Full `git diff 06f00964..8566c2c1` reviewed (21 files, +1675/−156). All changed paths are inside the Phase 5 owner package: `apps/api/src` (commission module/controllers, agent-activation + commission domain), `packages/database` (migration 0029, checksums, schema, expected-schema, p5-s1 schema test expectations), and `docs/06-phase-reports/p5-r1`. **No admin-web, no admin-*-ops, no frozen B/C/D specs** (`git diff 06f00964..HEAD -- apps/api/src/__tests__/b-transaction-commission.integration.spec.ts apps/api/src/__tests__/c-merchant-attribution.integration.spec.ts apps/api/src/__tests__/d-correction-compensation.integration.spec.ts` = **empty**, verified 0 lines), no Phase 1–4/6–7 code, no LOCKED rule changes. `commission.controller.ts` (unguarded `calculate` dispatcher + fake `ledger`) deleted and unregistered from `CommissionModule`; no dangling references remain. Doubled `/api/v1/api/v1/...` mounts retired to canonical single prefix (global prefix confirmed in `apps/api/src/app.setup.ts:15`). Only non-commit worktree artifact: untracked `jiti/` cache directory (environment artifact of `prisma:generate`; not implementation, not staged).

### 1.2 State machine — **VERIFIED**
`ALLOWED_TRANSITIONS` map unchanged (no new states invented): NOT_APPLIED→PENDING_PAYMENT→PAYMENT_CONFIRMED→COURSE_PENDING→COURSE_COMPLETED→PENDING_APPROVAL→ACTIVE; ACTIVE↔SUSPENDED; ACTIVE→DEACTIVATED; REJECTED/DEACTIVATED terminal. Every transition still passes through `assertAllowedTransition`; reject limited to `PRE_ACTIVE_STATUSES`; `DEACTIVATED_CANNOT_REACTIVATE` / `REJECTED_CANNOT_TRANSITION` guards intact. No regression; P5-R1 additions (ownership/market assertions, fee snapshot) are orthogonal to the transition map.

### 1.3 Transaction boundary — **VERIFIED with 1 LOW contract issue (ISSUE-1)**
Removed `.catch(() => {})` verified; `approve` now commits the activation transition atomically (ACTIVE + audit in one transaction) and then posts agent-upgrade commission; a posting failure surfaces as an explicit exception with code `COMMISSION_POSTING_FAILED`, activation id and retry guidance — never a false success, and the posting transaction rolls back whole (no partial ledger; verified by owner 4.5 test: zero `commission_ledger` rows after failure, and by frozen B-14). Retry is via the canonical reprocess command (idempotent). **ISSUE-1 (LOW):** the endpoint documents `@ApiResponse({status: 502})` (controller line 81) and the fix record claims "502 COMMISSION_POSTING_FAILED", but the implementation throws Nest `ServiceUnavailableException`, which empirically returns **HTTP 503** (`getStatus() === 503` verified directly against `@nestjs/common` 10.4.22; the global `all-exceptions.filter.ts` passes HttpException status through unchanged). The error body code `COMMISSION_POSTING_FAILED` is correct and stable; only the HTTP status contract is inconsistent (503 actual vs 502 documented). Not exercised by any test. See Conditions.

### 1.4 Locks / concurrency — **VERIFIED**
Posting concurrency: `commission_processing.canonical_processing_key` has unique `uq_processing_key`; an `IN_FLIGHT` row makes a concurrent reprocess throw `UPGRADE_PROCESSING_CONFLICT`; a race between the pre-transaction idempotency check and the insert is closed by the unique constraint (second insert fails → whole transaction rolls back). Rate/fee scheduling overlap is prevented by the pre-existing `uq_rate_period` EXCLUDE USING gist on `(commission_type, generation, market)` effective period (schema/index.ts, from migration 0018; unchanged). Migration runner uses `pg_advisory_lock` (pre-existing). No race windows found in the changed code.

### 1.5 Idempotency — **VERIFIED**
Posting is idempotent via `canonicalProcessingKey = market:sourceType:sourceReference`; a COMPLETED processing record short-circuits to the stored result (`loadExistingResult`); replay cannot create duplicate ledger rows (frozen B-04 passes: "Same idempotency key replay does not create duplicates"; B-13 worker failure+retry → exactly one ledger). Retry-safety of the 4.5 path verified in the owner suite (double `processAgentUpgrade` → both `SKIPPED_INELIGIBLE`, no duplicates).

### 1.6 Payload hash — **VERIFIED**
`request_hash` = `encode(sha256(canonical_processing_key), 'hex')`, stored on `commission_processing` with a `char_length = 64` check (schema `chk_processing_request_hash`). Hashing consistent with the frozen B/C/D machinery; the plaintext `canonical_processing_key` is the pre-existing frozen idempotency key design (non-secret composite of market/source identifiers, needed for the unique idempotency lookup); no secret/credential material is stored. P5-R1 did not alter hash semantics.

### 1.7 Permission enforcement — **VERIFIED**
Every admin route carries `@UseGuards(AuthGuard, RbacGuard)` + `@RequirePermission` with catalog permissions (all `marketScoped: true` in `packages/database/src/permission-catalog.ts`): admin agent-activation writes → `agent.activation.manage` (SUPER_ADMIN/OPERATIONS_ADMIN); ledger search + audit → `commission.read`; rate read → `commission.rate.read`; rate write + **reprocess (previously the `commission.read` write-via-read-permission defect)** → `commission.rate.manage` (SUPER_ADMIN only). `RbacGuard.canActivate` is deny-by-default (`if (!requirement) return this.deny()`, unknown permission codes → `deny()`), resolves the server-owned current market and sets `request.adminMarketContext` (never client input). P5-R1 controllers derive the market code only from that server context.

### 1.8 Market enforcement — **VERIFIED**
Admin agent transitions call `assertActivationMarket` → `AGENT_ACTIVATION_MARKET_MISMATCH` (403). Ledger search / audit log are server-bounded to the selected market; a disagreeing client `market` filter is rejected (`COMMISSION_MARKET_CONTEXT_MISMATCH`). Rate editor rejects any market (query or body) differing from the selected market (`MARKET_CONTEXT_MISMATCH`). Reprocess verifies the source event's market (agent activation or transaction→market join) before posting (`COMMISSION_MARKET_CONTEXT_MISMATCH` / `COMMISSION_SOURCE_NOT_FOUND`). Member-side activation applies are per-member-market with the existing `MARKET_ALREADY_EXISTS` guard. No cross-market leakage path found.

### 1.9 Audit evidence — **VERIFIED**
Admin transitions now record the executing admin in the append-only `agent_activation_status_log`: `changed_by = adminId`, `changed_by_type = 'ADMIN'` on reject/suspend/reactivate/deactivate (previously NULL / `SYSTEM`), plus `revoked_by = adminId` + `revocation_reason` on deactivate (verified in the owner suite 4.2 actor test). Ownership checks on member commands (`AGENT_ACTIVATION_OWNERSHIP_MISMATCH`, 403) on confirmPayment/enrollCourse/completeCourse/submitApproval/getStatusById. The full P7 privileged-audit metadata contract (IP/UA etc., P7-S0 §15/§239) belongs to the P7-S6/S8 facade layer, which is outside this remediation's allowed paths; the Phase 5 status-log audit surface is correctly the remediation's audit record.

### 1.10 Failure rollback — **VERIFIED**
Owner 4.5 test: after a forced posting failure (`AGENT_UPGRADE_RATE_NOT_FOUND`), `commission_ledger` has **zero** rows for the source reference; the activation remains ACTIVE (committed atomically with its audit); after configuring G1/G2 rates, the retry completes idempotently (`SKIPPED_INELIGIBLE`), and a second replay is also safe. Frozen B-14 ("No partial ledger on processing failure — G1/G2 rollback") passes on the clean DB. Failure is never swallowed (ISSUE-1 concerns only the documented vs actual HTTP status).

### 1.11 Fee versioning (4.3) — **VERIFIED**
Migration `0029_p5_r1_agent_fee_version_snapshot.sql` is additive and forward-only: relaxes `chk_commission_type` to admit `AGENT_ACTIVATION_FEE` (configuration only — `commission_ledger.entry_type` check unchanged and does **not** admit the fee type, so the frozen D-042-A three-source ledger contract is intact); seeds MY `AGENT_ACTIVATION_FEE` gen 0 FIXED `388.0000000000` (system seed actor, effective 2026-07-25 — currently in force, i.e. prospective "future-effective" per P5-S0 line 250: version applies to future activations, no backfill); seeds canonical MY `MERCHANT_RECRUITMENT` gen-0 `0.0050000000`. Adds `agent_activation.fee_rate_version_id` (FK RESTRICT), `activation_fee numeric(38,10)`, `activation_fee_currency varchar(3)` with pair/currency checks; the `DEFAULT 'MYR'` is safe for pre-existing rows (fee fields null ⇒ pair check holds). Checksums: `checksums.json` diff appends only the 0029 entry; entries 0000–0028 byte-identical (verified via git diff). Snapshot set at APPLY from `resolveFeeVersion` (market registry currency, never hard-coded; market must have BOTH registry entry and effective fee version, else `AGENT_ACTIVATION_FEE_NOT_CONFIGURED` — other markets blocked; owner test verifies `ZZ` rejects). Historical activations never repriced: owner test schedules a future RM500 version and the original snapshot (`388.0000000000`, same `fee_rate_version_id`) is retained. `RateManagementService.createRate` supports AGENT_ACTIVATION_FEE (FIXED, gen 0) with existing overlap/immutability/prospective guarantees. `AgentUpgradeCommissionService` uses the activation snapshot currency instead of the hard-coded `{MY:'MYR'}` map.

### 1.12 Generation/source (4.4) — **VERIFIED**
`COMMISSION_GENERATIONS` reconciled with the frozen P5-S0 contract: `MEMBER_CONSUMPTION: [1,2]` (was erroneously `[0]`; the seed and the member-consumption service use generations 1/2 — verified `member-consumption.service.ts` resolves G1/G2; seed `0.0100000000`/`0.0050000000`), `MERCHANT_RECRUITMENT: [0]` (service resolves gen 0 — verified `merchant-recruitment.service.ts`; migration 0029 seeds the canonical gen-0 MY 0.5% row; the legacy seed's gen-1 row is never read), `AGENT_UPGRADE: [1,2]`, `AGENT_ACTIVATION_FEE: [0]`. Source = recognized (company-received) service fee snapshot in `transaction_service_fees` at CONFIRMED time — unchanged, consistent with D-042-A. Window semantics unchanged (`effective_from <= t AND (effective_until IS NULL OR effective_until > t)` ORDER BY effective_from LIMIT 1; the new `resolveFeeVersion` uses the same window pattern).

### 1.13 Tests — **VERIFIED (independently re-run by this reviewer on the clean DB)**
| Suite | Result (reviewer) |
|---|---|
| B `b-transaction-commission.integration.spec.ts` | **15/15 passed** |
| C `c-merchant-attribution.integration.spec.ts` | **10/10 passed** |
| D `d-correction-compensation.integration.spec.ts` | **10/10 passed** |
| Owner `p5-r1-owner-remediation.integration.spec.ts` | **13/13 passed** |
| Commission/agent/referral unit suites (+ module spec) | **188/188 passed** (187 in `src/domain/commission|agent-activation|referral` + 1 `commission.module.spec`) |
| Phase 3 wallet/reward (`src/wallet|reward|transaction-reward|admin-reward`) | **79 passed / 4 skipped** |
| Database tests | **60/62** — the 2 failures are the migration-list-freeze tests (`schema.unit.test.ts` "keeps migrations explicit SQL and in the checksum set" expects exactly 20 migrations; `phase3-schema.test.ts` "should allow Phase 5 migrations to be appended" expects last migration `/^0019_/`) — **reproduced identically at the base SHA `06f00964`** in a temporary worktree (same 2 failures, last migration there = `0028_admin_market_session_context.sql`), i.e. pre-existing, caused by Phase 6/7 migrations 0020–0028, outside P5-R1 allowed paths. |
| Combined totals | **315 passed / 0 failed / 4 skipped** (15+10+10+13+188+79 = 315) — matches the implementer's claim. |
| Quality | `tsc -p apps/api` exit 0; `tsc -p packages/database` exit 0; ESLint on all changed source files exit 0. |

Exact reviewer commands (run from `/workspace/.local/wt-p5-r1`; env `DATABASE_URL=postgresql://ipoint:ipoint-local-only@172.23.0.3:5432/ipoint_p5r1_review_test REDIS_URL=redis://127.0.0.1:6379 AUTH_OTP_PEPPER=test-otp-pepper-with-at-least-32-characters REDEMPTION_VOUCHER_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef NODE_ENV=test`):
- DB reset: `DROP DATABASE IF EXISTS ipoint_p5r1_review_test WITH (FORCE); CREATE DATABASE ipoint_p5r1_review_test;` (via `pg` client) → `tsx packages/database/src/migration-runner.ts` → `tsx packages/database/seeds/index.ts`
- `cd apps/api && vitest run src/__tests__/b-transaction-commission.integration.spec.ts` (15/15)
- `cd apps/api && vitest run src/__tests__/c-merchant-attribution.integration.spec.ts` (10/10)
- `cd apps/api && vitest run src/__tests__/d-correction-compensation.integration.spec.ts` (10/10)
- `cd apps/api && vitest run src/__tests__/p5-r1-owner-remediation.integration.spec.ts` (13/13)
- `cd apps/api && vitest run src/domain/commission src/domain/agent-activation src/domain/referral` (187) + `vitest run src/commission/commission.module.spec.ts` (1)
- `cd apps/api && vitest run src/wallet src/reward src/transaction-reward src/admin-reward` (79/4)
- `cd packages/database && vitest run tests` (60/62; 2 pre-existing, base-SHA reproduction)
- `tsx packages/database/src/drift-check.ts` → "No database schema drift detected."

### 1.14 Known risks from the implementer — assessed
- **(a) Inert gen-1 merchant-recruitment seed row** — CONFIRMED inert: `merchant-recruitment.service.ts` resolves generation 0 only; the migration seeds the canonical gen-0 MY 0.5% row; the rate service now rejects creating gen-1 merchant-recruitment rows. Acceptable, documented.
- **(b) Adjustment maker/checker routes deny-by-default** — CONFIRMED: `commission.adjustment.maker/checker` are not in the canonical permission catalog and `RbacGuard` denies unknown codes (`if (!definition) return this.deny()`). Safe (no surface enabled); catalog changes are outside P5-R1 allowed paths and belong to P7-S6 (implementer notes a P7-S6 decision). Acceptable.
- **(c) Dead duplicate activation service retained with its spec** — CONFIRMED: `apps/api/src/domain/agent-activation/agent-activation.service.ts` is not wired (no Nest provider, no routes); its unit spec (part of the 188) still passes unmodified. Deletion would require spec deletion (prohibited). Acceptable, documented as dead code.
- **(d) 2 pre-existing DB migration-count failures** — CONFIRMED pre-existing at base SHA (reproduced above); both freeze the list at 0019; outside allowed paths; reported, not hidden. Acceptable.

---

## 2. Issues

| ID | Severity | Location | Finding | Recommended fix |
|---|---|---|---|---|
| ISSUE-1 | LOW | `apps/api/src/controllers/admin-agent-activation.controller.ts:81` (Swagger `@ApiResponse({status: 502})`) and `:103` (`throw new ServiceUnavailableException({code:'COMMISSION_POSTING_FAILED',…})`); also fix record §6 wording | The posting-failure path is correctly surfaced (never swallowed; activation committed atomically; retry idempotent), but Nest `ServiceUnavailableException` returns **HTTP 503**, not the documented **502** (`getStatus()` empirically verified = 503; global exception filter passes the status through). No test locks this status, so the mismatch is latent but will surface in P7-S6/S8 API contracts. | Either throw `new HttpException({code:'COMMISSION_POSTING_FAILED',…}, HttpStatus.BAD_GATEWAY)` to emit a true 502, or correct the `@ApiResponse` (and fix record) to 503. Align code + docs + fix record before P7 consumption. |

No other issues found. No out-of-scope changes; no frozen rule, spec, or ledger contract violations; no state-machine, idempotency, concurrency, permission, market, or audit defects.

---

## 3. Verdict

# APPROVED_WITH_CONDITIONS

The P5-R1 owner remediation satisfies all fourteen review dimensions functionally: canonical wiring, permission/market/actor enforcement, RM388.00 MYR fee versioning with per-activation snapshot and no historical repricing, generation/source reconciliation, atomic idempotent posting with surfaced failures, and full frozen B/C/D + owner regression on a clean database. The only finding is a LOW-severity HTTP status-code contract inconsistency on the posting-failure path.

**Conditions (to resolve before P7-S6 / P7-S8 consumption):**
1. Resolve ISSUE-1: make the actual HTTP status match the documented contract — either emit true 502 (e.g., `HttpException` with `HttpStatus.BAD_GATEWAY`) or correct the `@ApiResponse`/fix-record wording to 503 — and align the retry-guidance contract accordingly.
2. Track (not block) the four documented known risks (a)–(d) into P7-S6/S8 planning: gen-1 merchant-recruitment seed cleanup, adjustment maker/checker catalog decision, dead duplicate service removal under a future owner, and the 2 pre-existing DB migration-count test freezes.

---

## 4. Review integrity confirmation

- This reviewer did **not** modify any implementation code, migration, schema, or test file. Review evidence only: this file.
- No push was performed. One local documentation commit follows (exact-path staging): `docs(p5-r1): record independent review`.
- Reviewer-created artifacts: clean test DB `ipoint_p5r1_review_test` (dropped/recreated for this review), temporary base-SHA worktree (removed), scratch logs in `/tmp`.
- Executor class stated per D-048: **OPENCLAW_MANAGED_CODING_SUBAGENT**.
