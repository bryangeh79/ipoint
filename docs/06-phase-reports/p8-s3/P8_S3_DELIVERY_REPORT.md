# P8-S3 Delivery Report — Risk / Fraud / Operational Controls (Stage 1)

## 1. Task and scope

- Task: implement the Phase 8 P8-S3 Risk / Fraud / Operational Controls domain, stage 1 (detection engine + admin API + schema + tests + delivery report).
- Scope (contract §3 / task brief §2): configurable market-scoped versioned indicator definitions, manual detection runs across 8 indicator categories (suspicious transactions, duplicate/replay, abnormal adjustment, rate/config anomaly, cross-market violation, account/admin abuse, security event visibility, review-queue monitoring), immutable risk events, review queue with strict lifecycle, canonical RBAC, exact-decimal handling, idempotency, audit, and full unit + real-PG integration coverage.
- **Zero enforcement side-effects**: this domain flags and queues only. No freeze, no block, no debit, no disable, no penalty, no confiscation, no legal fraud declaration, no commercial blacklist, no automatic permanent ban — asserted byte-identical in integration tests.
- Out of scope (stage 1): admin-web UI (deferred to P8-S5), scheduling/jobs/notifications, and any enforcement/business-decision surface (Bryan/Command Center decision items — escalate, never implement).
- Executor: OpenClaw-managed independent coding subagent (A' role, authorization D-060; Codex CLI unavailable). Sandbox has no git/typecheck/DB — file edits only; host verifies, commits and dispatches independent review (B').
- Branch: `task/p8-s3-risk-fraud` (worktree `.local/wt-p8-s3`).
- Role boundary: implementation evidence only. This report does not approve or accept P8-S3; acceptance belongs to Bryan / ChatGPT Command Center (D-058/D-059/D-060).

## 2. Commit plan

SHAs are produced by the host runner at commit time (sandbox has no git). Proposed commit chain:

| #   | Proposed commit subject                                                         | Scope                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `feat(p8-s3): add risk controls schema, permissions and forward migration 0039` | `0039_risk_controls.sql`, `checksums.json`, `schema/index.ts`, `expected-schema.ts`, `permission-catalog.ts`, `tests/p8-s3-schema.test.ts`, catalog/migration-count parity updates in `tests/p7-s2c-permission-catalog.test.ts`, `tests/schema.unit.test.ts`, `tests/database.integration.test.ts` |
| 2   | `feat(p8-s3): implement risk detection engine and admin APIs`                   | `apps/api/src/admin-risk-controls/*` + `app.module.ts` registration                                                                                                                                                                                                                                |
| 3   | `test(p8-s3): add risk controls integration coverage`                           | integration spec (may be folded into #2)                                                                                                                                                                                                                                                           |
| 4   | `docs(p8-s3): add P8-S3 delivery report`                                        | this file                                                                                                                                                                                                                                                                                          |

All commits land on `task/p8-s3-risk-fraud`; merge to the authorized delivery branch only after acceptance evidence.

## 3. Changed files

### Database and permissions

- `packages/database/migrations/0039_risk_controls.sql` — new forward-only domain migration (sha256 `2e17d45eb0b055197b3e319006184b8af1385a047ec7aef1e22ca4b868ad4f16`, registered in `checksums.json` → 40/40)
- `packages/database/migrations/checksums.json` — 0039 appended; the existing 39 hashes are byte-identical (verified)
- `packages/database/schema/index.ts` — 6 risk enums + 5 Drizzle tables
- `packages/database/src/expected-schema.ts` — drift-check entries for the 5 tables
- `packages/database/src/permission-catalog.ts` — 2 canonical P8-S3 permissions (`risk.view`, `risk.review.manage`)
- `packages/database/tests/p8-s3-schema.test.ts` — new schema/enum freeze tests
- `packages/database/tests/p7-s2c-permission-catalog.test.ts` — catalog totals 74→76 and the six-role matrix updated (required additive parity, same precedent as P8-S1/P8-S2)
- `packages/database/tests/schema.unit.test.ts` — migration checksum-set list extended with `0038_reconciliation.sql` (missed by P8-S2) and `0039_risk_controls.sql`; without this the frozen test fails on the current branch even before 0039
- `packages/database/tests/database.integration.test.ts` — applied-migration list extended with `0039_risk_controls.sql`

### API

- `apps/api/src/app.module.ts` — `AdminRiskControlsModule` registered
- `apps/api/src/admin-risk-controls/admin-risk-controls.module.ts`
- `apps/api/src/admin-risk-controls/admin-risk-controls.controller.ts`
- `apps/api/src/admin-risk-controls/admin-risk-controls.service.ts`
- `apps/api/src/admin-risk-controls/admin-risk-controls.dto.ts`
- `apps/api/src/admin-risk-controls/admin-risk-controls.types.ts`
- `apps/api/src/admin-risk-controls/admin-risk-controls.spec.ts`
- `apps/api/src/admin-risk-controls/admin-risk-controls.integration.spec.ts`

## 4. DB/API changes

### Migration 0039 detail

- 6 new enums: `risk_indicator_category` (8 categories), `risk_event_severity` (LOW/MEDIUM/HIGH/CRITICAL), `risk_run_status` (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED), `risk_event_status` (FLAGGED), `risk_review_status` (OPEN/IN_REVIEW/RESOLVED), `risk_review_decision` (NO_ACTION/WATCH/ESCALATED — neutral operational outcomes only, never enforcement actions).
- 5 new tables:
  - `risk_indicator_definitions` — configurable, market-scoped, **versioned** indicator definitions. Versioning model: a new version is a NEW row (`UNIQUE (market_id, code, version)`) that supersedes the current one (`superseded_by_id`/`superseded_at` self-FK with a consistency CHECK); existing versions are write-once. `config jsonb` holds operator thresholds — the migration ships **no business values**; `severity` defaults to MEDIUM (label default, not a threshold). FKs to `markets` and `admin_users` (RESTRICT).
  - `risk_detection_runs` — manual per-market, single-category runs; CHECK constraints mirror 0038 (totals present on COMPLETED, per-status timestamp shape, `failure_reason` length, `version > 0`, archive ordering). Re-execution clears terminal timestamps (P8-S2 H-1).
  - `risk_events` — write-once immutable detection evidence (UPDATE blocked by `reject_risk_event_update` trigger; status CHECK `= 'FLAGGED'`); composite FKs `(run_id, market_id)` → runs and `(indicator_id, market_id)` → definitions; `UNIQUE (run_id, market_id, indicator_code, entity_type, entity_id)` makes re-runs idempotent; `entity_market_id` captures cross-market subjects; `numeric(38,10)` amounts where present.
  - `risk_review_queue` — one task per event; strict OPEN→IN_REVIEW→RESOLVED with per-status timestamp/assignee/decision CHECK, `decision_consistency` CHECK (decision ⇒ decision_reason 1..2000), append-only notes CHECK (≤ 20000), versioned optimistic locking, `UNIQUE (event_id, market_id)`.
  - `risk_idempotency_keys` — mirror 0038: `UNIQUE (admin_user_id, market_id, operation, key)`, sha256 `request_hash` CHECK length 64, response/status_code consistency.
- E-30: all five tables carry `reject_delete()` triggers — risk history is archived, never physically deleted.
- Canonical P8-S3 permissions inserted with explicit role grants (mirror P8-S2; no Super Admin bypass, no unmanaged role expansion).
- Migrations 0000–0038 remain byte-identical; no frozen ledger/balance/transaction/audit table is touched.

### API surface (admin, market-scoped, AuthGuard + RbacGuard)

Base path `/admin/risk-controls/markets/:marketId`:

- `GET /definitions` (list; current versions by default, `includeSuperseded` opt-in) · `POST /definitions` (create next version, supersedes current; idempotent) · `GET /definitions/:definitionId`
- `GET /runs` · `POST /runs` (create PENDING, idempotent) · `GET /runs/:runId` (with events) · `POST /runs/:runId/execute` (idempotent; COMPLETED replays original result; FAILED/CANCELLED re-execute with a fresh snapshot; RUNNING conflicts) · `POST /runs/:runId/cancel`
- `GET /events` (filter by category/severity/indicator/entity, paginated) · `GET /events/:eventId`
- `GET /queue` (review queue with joined event summary) · `GET /queue/:taskId` · `POST /queue/:taskId/assign` (claim/assign OPEN→IN_REVIEW) · `POST /queue/:taskId/decide` (neutral decision + rationale) · `POST /queue/:taskId/resolve` (IN_REVIEW→RESOLVED, decision required) · `POST /queue/:taskId/notes` (append-only actor-stamped)

Error semantics match P8-S1/P8-S2: 401 unauthenticated, 403 missing permission / foreign-market resource, 404 not found, 409 invalid transition / stale version / idempotency conflict / run in progress, 400 validation. The frozen guard supplies canonical 409 `MARKET_CONTEXT_MISMATCH` and 403 `MARKET_ACCESS_DENIED`; the service adds a second market-consistency line for resource-level isolation.

### Detectors (one canonical code per category, read-only over frozen tables)

| Category               | Detector code                     | Operator config (no code defaults; detector skips if absent) |
| ---------------------- | --------------------------------- | ------------------------------------------------------------ |
| SUSPICIOUS_TRANSACTION | `suspicious_amount_breach`        | `max_single_amount` (exact decimal string)                   |
| DUPLICATE_REPLAY       | `duplicate_confirmed_transaction` | `duplicate_window_minutes`                                   |
| ABNORMAL_ADJUSTMENT    | `adjustment_execution_velocity`   | `window_minutes`, `max_adjustment_count`                     |
| RATE_CONFIG_ANOMALY    | `rate_period_overlap`             | structural (none)                                            |
| CROSS_MARKET_VIOLATION | `cross_market_wallet_entry`       | structural (none)                                            |
| ACCOUNT_ADMIN_ABUSE    | `admin_action_velocity`           | `window_minutes`, `max_actions`                              |
| SECURITY_EVENT         | `security_event_failure_burst`    | `window_minutes`, `max_failures`                             |
| REVIEW_QUEUE           | `review_queue_aging`              | `max_open_days`                                              |

- Detection comparisons run inside PostgreSQL against `numeric(38,10)` columns with string thresholds — no float arithmetic anywhere (E-04). FILTER/aggregate syntax follows the P8-S2 convention (`count(*) > $n` with `HAVING`, `make_interval` windows).
- Rate-overlap detection is scoped per profile for service fees (same `service_fee_profile_id`) so distinct seeded packages never false-positive; reward-rule overlap is per market.
- Every non-suppressed detected event automatically enters the review queue (flagging only). Events are immutable; all review state lives in the queue.

## 5. RBAC codes added

| Permission           | Roles                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `risk.view`          | SUPER_ADMIN, OPERATIONS_ADMIN, FINANCE_OPERATOR, FINANCE_APPROVER, KYC_REVIEWER, SUPPORT_READONLY_AUDITOR |
| `risk.review.manage` | SUPER_ADMIN, OPERATIONS_ADMIN, FINANCE_OPERATOR, FINANCE_APPROVER                                         |

Both are `marketScoped: true`; `risk.view` is read-only (definitions/runs/events/queue listing and detail), `risk.review.manage` gates definition creation, run create/execute/cancel and queue mutations. Catalog ≡ migration grants; `foundationPermissions` derives from the catalog so seeding stays consistent.

## 6. Test inventory (host will execute; sandbox has no runner)

- `packages/database/tests/p8-s3-schema.test.ts` — enum values (8 categories, severities, run/review statuses, decisions), table columns vs `expected-schema`, constraint/unique/FK names on all five tables.
- `apps/api/src/admin-risk-controls/admin-risk-controls.spec.ts` (unit, ~24 assertions in 8 tests) — severity mapping, strict queue state machine, detector config gating (threshold detectors skip when operator config is absent; structural detectors always run; unknown codes ignored), exact-decimal threshold handling (floats rejected), DTO validation (definition codes, config shape, run windows, decision enums, notes bounds, event filters).
- `apps/api/src/admin-risk-controls/admin-risk-controls.integration.spec.ts` (real PostgreSQL, fresh dedicated `ipoint_p8s3_*` database, fail-closed destructive guard + `P8S3_DESTRUCTIVE_TEST` opt-in, `keepAlive: false` agent fix):
  - guard tests (name pattern, protected names, opt-in values)
  - RBAC 401 / 403 (viewer cannot create runs or definitions) / canonical 409 market mismatch; viewer read allowed
  - definition versioning (v1 → v2 supersede, v1 immutable and still retrievable, current-only listing)
  - **one flag scenario per indicator category** (all 8): amount breach (severity + queue entry), duplicate transaction, adjustment velocity, rate overlap (reward + service fee), cross-market wallet entry (with `entity_market_id`), admin audit velocity, security failure burst, aging OPEN review task
  - run lifecycle: idempotent replay with same/fresh keys (no duplicate events or tasks), FAILED re-execution → COMPLETED with no duplicates (H-1), RUNNING → 409, PENDING cancel → CANCELLED, COMPLETED cancel → 409
  - review queue lifecycle: decide/resolve from OPEN rejected, assign → notes → decide → resolve strict chain, stale version 409, notes after RESOLVED 409, actor-stamped notes, immutable audit actions present
  - market isolation (runs/events/definitions per market; foreign run detail 403; cross-market data never visible)
  - **no-enforcement assertion**: byte-identical snapshot of 18 frozen financial/account tables before vs after running all 8 categories; member stays ACTIVE, MCP account stays ACTIVE, wallet balance unchanged, zero suspended/closed members; flagged events are queued OPEN (flagging only)

## 7. Security impact

- Detectors are read-only queries over frozen tables; the engine writes only `risk_*` tables and audit rows. `mcp_ledger_entries` remains writable only through `append_mcp_ledger_entry`; no detector ever writes it.
- Idempotency replay returns the stored original response; reused keys with different payloads conflict (409).
- Run rows are locked `FOR UPDATE`; event inserts use `ON CONFLICT DO NOTHING` — concurrent or retried executions cannot duplicate evidence.
- Market isolation enforced at the RBAC guard (session-market consistency) plus service-level `assertMarket` and composite `(id, market_id)` keys.
- Events are write-once (trigger + CHECK); review decisions are neutral operational outcomes only — the schema cannot express a freeze/ban/penalty (no such columns exist).
- No secrets, no placeholders, no destructive operations, no deletion of history (E-30).

## 8. No-write / no-enforcement guarantees

- The engine never writes to `mcp_accounts`/`mcp_ledger_entries`, `member_wallet_accounts`/`member_wallet_entries`, `transactions`/`transaction_mcp_debits`/`transaction_reward_links`, `reward_sources`/`reward_plans`/`reward_rule_versions`, `service_fee_profiles`/`service_fee_versions`, `mcp_adjustment_requests`, `ipoint_adjustment_requests`, `members`, `member_market_preferences`, `security_events` or `accounts` — asserted byte-identical by the integration snapshot test after running all 8 categories.
- A flagged event never freezes an account, never blocks a transaction, never debits, never disables — asserted explicitly (member/MCP statuses remain ACTIVE, balances unchanged).
- Review decisions are advisory records (`NO_ACTION`/`WATCH`/`ESCALATED`); nothing downstream consumes them for enforcement in this stage.

## 9. Scope decision (pre-recorded, per M-1 precedent)

- **admin-web UI for risk review is deferred to P8-S5 (Cross-Platform Final Integration)**, together with the reconciliation UI. This stage delivers engine + admin API + tests only. Rationale: identical precedent to reconciliation UI deferral; keeps P8-S3 focused on the HIGH-risk detection/permission surface; UI states will be built in P8-S5 over these stable APIs with canonical route-manifest permissions.
- No auto-scheduling of detection runs in stage 1 (manual trigger per market only).

## 10. Assumptions

- Stage-1 delivery is detection + review + traceability only; any enforcement flow (freeze/ban/penalty/confiscation/blacklist) requires explicit Bryan/Command Center decisions and is out of contract.
- Operator-configurable thresholds are supplied through `risk_indicator_definitions.config`; detectors that lack required config keys skip (no invented defaults).
- The existing frozen schemas are authoritative read sources and unchanged.
- `schema.unit.test.ts` and `database.integration.test.ts` were extended with `0039_risk_controls.sql` (and `0038` where P8-S2 had missed it) because they freeze the exact migration list; this is an additive parity update required to keep the suite green, not a modification of migration files.
- Test execution, commit SHAs, typecheck/build/lint/format/OpenAPI and fresh-PG runs happen on the host under the main agent's verification, per the OpenClaw operating model.

## 11. Risks

- Detection volume: `risk_events` + `risk_review_queue` grow per run; runs are user-initiated in stage 1 (no scheduler), so growth is bounded by operator action. Events are write-once and paginated reads exist.
- Re-detection semantics: later runs re-scan the full window and re-flag unchanged fixtures; dedupe is per-run (`UNIQUE (run_id, …, indicator_code, entity_type, entity_id)`), so operators should use bounded windows or accept repeat flags (repeat flags are themselves operational signals).
- `rate_period_overlap` flags any overlapping effective periods per market (reward) / per profile (service fee); operators can disable the definition if their rule model legitimately overlaps.
- Concurrent definition creation for the same `(market, code)` can race; the version uniqueness constraint turns the loser into a 409 rather than corruption.

## 12. Outstanding work (later stages, not in scope here)

- Admin-web risk review UI (P8-S5), detection scheduling/jobs, notifications, and any business-approved enforcement flows.

## 13. Rollback note

- Migration 0039 is forward-only and additive: dropping it does not affect migrations 0000–0038 or any frozen financial table.
- Rollback strategy: revert/remove the migration commit on the feature branch before merge. After merge, risk tables are archived-never-deleted (E-30) and contain only domain-owned rows; no production ledger/account data is ever touched by this domain, so there is no ledger rollback requirement.

## 14. Executor provenance

- Executor class: OpenClaw-managed coding subagent (A' role, D-060). Model: `deepseek/deepseek-v4-flash` (current run). Session: subagent `P8-S3 implementer A'` (session id `9b37fe24-4e2b-4d8f-a1d6-822e5709bb78`).
- Worktree: `.local/wt-p8-s3` on `task/p8-s3-risk-fraud`. Sandbox had no git/typecheck/DB — file edits only; the host gate verifies (fresh-PG `ipoint_p8s3_*` + `P8S3_DESTRUCTIVE_TEST`, unit suites, checksums 40/40, drift, typecheck/build, eslint, prettier, OpenAPI), commits with the plan above, then dispatches independent review (B').
- Self-review performed by the implementer before handoff: imports/exports, DTO enum parity with types, constraint-name parity between migration and drizzle schema, expected-schema column lists, catalog role-matrix totals, integration fixture requirements (reward plan link, audit-log columns, seeded service-fee profiles), test-order re-detection coupling, and frozen-hash integrity of checksums.json.

---

## 15. Host integration-gate fixes (OpenClaw, post-delivery verification)

The host gate (Node v26.4.0, fresh PostgreSQL) required bounded fixes before the P8-S3 gate could pass. All are type/fixture-only repairs; **zero production behaviour change** beyond restoring compilation:

| # | File | Fix | Class |
|---|---|---|---|
| 1 | dmin-risk-controls.service.ts | equiredPositiveInt/equiredDecimal called with a single argument (config value) instead of (config, key) — 8+1 call sites corrected | implementer defect (TS2554) |
| 2 | dmin-risk-controls.service.ts | eq() right-hand operands from camelize() results typed unknown: current.id as string, un.version as number (2 sites) | implementer defect (TS2769) |
| 3 | dmin-reconciliation-ops.service.ts (P8-S2 domain) | Pre-existing Node-26 typecheck failures blocking all builds: eqScaled/	oScaledBigInt signatures widened to unknown (runtime identical), un.version as number | pre-existing baseline defect, fixed to unblock the P8-S3 gate |
| 4 | dmin-risk-controls.integration.spec.ts | MCP fixture recharge raised 100 → 100000 (7 accounts) so 25k–95k fixture transactions do not hit MCP_NEGATIVE_OR_INVALID_AVAILABLE_BALANCE | fixture defect |
| 5 | dmin-risk-controls.integration.spec.ts | rate-anomaly test redesigned: DB exclusion constraint service_fee_versions_no_overlap makes overlapping ACTIVE service-fee versions unrepresentable; test now seeds overlapping eward_rule_versions (2 events) + legal non-overlapping service-fee versions and asserts the detector flags reward overlap and does NOT false-positive on service fees | fixture design defect |
| 6 | dmin-risk-controls.integration.spec.ts | audit-velocity test isolated with a dedicated admin actor (shared-DB coupling: the shared super-admin accumulates audit rows from earlier API-driven tests) | fixture isolation defect |
| 7 | dmin-risk-controls.integration.spec.ts | replay/H-1 tests assert "no duplicate events on re-execution" relatively (count after replays equals count before) instead of assuming a globally empty database | fixture isolation defect |
| 8 | dmin-risk-controls.integration.spec.ts | missing walletId fixture in the adjustment-velocity test; ppendWalletEntry entryType narrowed to the drizzle enum union (TS2769) | implementer defect |
| 9 | phase3-schema.test.ts | migration-list parity: pipeline head updated 0038 → 0039 (was missed by the implementer; schema.unit.test.ts had it) | implementer omission |

Pre-existing baseline issues recorded (NOT introduced by P8-S3, reproduced on the P8-S2 baseline c849469f): p5-s1-schema.test.ts Object.values(schema) runtime failure; dmin-reconciliation-ops.integration.spec.ts TS2769 insert typing; untracked p6-s1-schema.test.ts TS2345 (main worktree only). Full P8-S3 gates: checksum 40/40, drift clean, api build, P8-S3 typecheck clean, eslint 0, prettier clean (P8-S3 files), OpenAPI 299 paths, unit 12/12, integration 20/20 (fresh ipoint_p8s3_test + P8S3_DESTRUCTIVE_TEST), p8-s3-schema 3/3, database suite 70/71 (sole failure = pre-existing p5-s1).
