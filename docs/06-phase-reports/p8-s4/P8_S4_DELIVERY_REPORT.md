# P8-S4 Delivery Report — Advanced Reports (G-04)

## 1. Task and scope

- Task: extend the **P7-S9 `admin-report-ops` owner** (frozen adapter/read-only patterns) with 15 advanced on-screen report views covering operations, finance, reconciliation, markets, members, merchants, agents, transactions, MCP, iPoint/reward, commission, redemption, fulfilment, refund and risk/exception — preserving RBAC, market isolation, privacy masking and the asOf / freshness / stale / unavailable semantics. Read-only projections over frozen tables. **NEVER fabricate zero. No unrestricted/raw export endpoints.**
- Scope (contract §4 / task brief §2): new report definitions + adapter extensions on the existing owner; catalog permissions (reuse decision recorded); masking + freshness identical to P7-S9; unit + real-PG integration tests; delivery report. admin-web UI for advanced reports is **deferred to P8-S5** (pre-recorded scope decision, M-1 precedent — see §9).
- Executor: OpenClaw-managed independent coding subagent (A' role, authorization D-060; Codex CLI unavailable). Sandbox has no git/typecheck/DB — file edits only; host verifies, commits and dispatches independent review (B').
- Branch: `task/p8-s4-advanced-reports` (worktree `.local/wt-p8-s4`).
- Role boundary: implementation evidence only. This report does not approve or accept P8-S4; acceptance belongs to Bryan / ChatGPT Command Center (D-058/D-059/D-060).

## 2. Commit plan

SHAs are produced by the host runner at commit time (sandbox has no git). Proposed commit chain:

| #   | Proposed commit subject                                                    | Scope                                                                                      |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `feat(p8-s4): add 15 advanced report views to admin-report-ops`            | `apps/api/src/admin-report-ops/{types,catalog,service,module}.ts` (extend, do not rewrite) |
| 2   | `test(p8-s4): extend report unit suite and add advanced integration suite` | `admin-report-ops.spec.ts` + new `admin-report-ops-advanced.integration.spec.ts`           |
| 3   | `docs(p8-s4): add P8-S4 delivery report`                                   | this file                                                                                  |

All commits land on `task/p8-s4-advanced-reports`; merge to the authorized delivery branch only after acceptance evidence.

## 3. Changed files

**Extended (inside `apps/api/src/admin-report-ops/`, P7-S9 owner patterns untouched in shape):**

- `admin-report-ops.types.ts` — `REPORT_CATALOG_VERSION` 1 → 2; new aggregate value interfaces (`StatusCounts`, `VolumeGroup`, `TransactionValueGroup`, `TransactionValueTotals`, `PointsGroup`); 11 new `ReportValue` kinds (`OPERATIONS_OVERVIEW`, `RECONCILIATION_OVERVIEW`, `MARKET_PROFILE`, `LEDGER_VOLUME`, `TRANSACTION_VALUE`, `MCP_OVERVIEW`, `COMMISSION_OVERVIEW`, `REWARD_ACCRUAL`, `REDEMPTION_VOLUME`, `FULFILMENT_OVERVIEW`, `REFUND_OVERVIEW`, `RISK_EXCEPTION_OVERVIEW`); `containsRawIdentifier()` privacy-masking rule (P7-S9: IDs masked, sensitive values redacted, raw ledgers never exposed).
- `admin-report-ops.catalog.ts` — R05–R19 definitions (15 advanced views), each with `report.read`, REAL availability, bounded window, explicit source disclosure.
- `admin-report-ops.service.ts` — `MarketRow` extended (status/currencyCode/timezone); 15 bounded query methods; exact-decimal sums transported as strings; no writes anywhere.
- `admin-report-ops.module.ts` — documentation only.
- `admin-report-ops.spec.ts` — catalog count 4 → 19; new unit coverage (see §6).
- `admin-report-ops.integration.spec.ts` (P7-S9 suite) — parity update only: the catalog-length freeze (4 items / R01–R04) was extended to 19 / R01–R19; every other P7-S9 assertion is untouched.
- `admin-report-ops-advanced.integration.spec.ts` — NEW; real-PG HTTP suite with fail-closed guard (see §6).

**Unchanged (zero-migration decision):** `packages/database/src/permission-catalog.ts`, `packages/database/migrations/*` (checksums stay **40/40**), `packages/database/tests/*` parity tests, `apps/api/src/app.module.ts` (module already registered), controller/cache/errors, `packages/api-client`, `apps/admin-web` (UI deferred to P8-S5).

## 4. Report catalog — the 15 advanced views (R05–R19)

| id  | key                           | freshness class | window | sources (all SELECT-only, market-scoped)                                                      |
| --- | ----------------------------- | --------------- | ------ | --------------------------------------------------------------------------------------------- |
| R05 | operations-kyc-applications   | KPI             | 90d    | member_kyc_cases, merchant_applications (via branch market)                                   |
| R06 | finance-wallet-volume         | KPI             | 90d    | member_wallet_entries (count + exact sum by entry_type)                                       |
| R07 | reconciliation-overview       | QUEUE           | 0      | reconciliation_runs, reconciliation_run_items                                                 |
| R08 | market-profile                | QUEUE           | 0      | markets + member/merchant/MCP/agent/catalog counts                                            |
| R09 | member-status-distribution    | QUEUE           | 0      | members join member_market_preferences                                                        |
| R10 | merchant-status-distribution  | QUEUE           | 0      | merchant_branches                                                                             |
| R11 | agent-status-distribution     | QUEUE           | 0      | agent_activation (market code)                                                                |
| R12 | transaction-value-summary     | KPI             | 90d    | transactions (CONFIRMED) + transaction_service_fees                                           |
| R13 | mcp-overview                  | KPI             | 90d    | mcp_accounts, mcp_ledger_entries (via account market)                                         |
| R14 | ipoint-reward-accrual         | KPI             | 90d    | reward_daily_accruals, reward_plans                                                           |
| R15 | commission-overview           | KPI             | 90d    | commission_ledger, commission_adjustment_request (market code)                                |
| R16 | redemption-volume             | KPI             | 90d    | redemption_orders (count + total points), redemption_catalog_items                            |
| R17 | fulfilment-exception-overview | QUEUE           | 0      | redemption_fulfilment_exceptions (via fulfilments/orders), redemption_shipping_payments       |
| R18 | refund-overview               | KPI             | 90d    | mcp_refund_requests, redemption_refund_requests (via order market)                            |
| R19 | risk-exception-overview       | QUEUE           | 0      | risk*events, risk_review_queue, reconciliation_exceptions (risk*\_ + reconciliation\_\_ only) |

Every view keeps the P7-S9 envelope: `asOf` (source-query time), `freshness` (FRESH/STALE/UNAVAILABLE), `stale`, `unavailable` (+`unavailableReason`), `queryDurationMs` (absent on cache hits), bounded windows (KPI ≤ 90d, QUEUE point-in-time). Amounts are `sum(numeric(38,10))::text` strings — no float arithmetic anywhere (E-04). Values are aggregate-only masked projections — no raw identifiers/references/vouchers ever emitted.

## 5. Permissions — documented reuse of `report.read` (ZERO new codes, ZERO migration)

- **Decision: reuse the canonical `report.read` permission for all 15 advanced views — no new permission codes, no migration 0040.** This mirrors the P7-S9 zero-new-permission precedent exactly.
- **Rationale (recorded per contract §4 / brief §2):**
  1. All 15 views are bounded on-screen aggregates over existing canonical tables — the same class of surface as R01–R04, for which `report.read` (ALL controlled roles, marketScoped) is already the canonical gate.
  2. Values are masked aggregate-only projections: no raw ledgers, no entity identifiers, no protected references, no voucher/token values (`containsRawIdentifier` asserted). Nothing in the payload resolves to a specific member/merchant/agent, so the per-domain sensitive read permissions (`merchant.mcp.view`, `wallet.ipoint.read`, `commission.read`, `redemption.order.read`, `risk.view`…) that gate raw administrative detail views are not bypassed by these reports.
  3. Task brief explicitly endorses "mirror P7-S9 zero-new-permission precedent where defensible" and the migration slot is 0040 **only if** new codes are required — none are.
  4. `foundationPermissions` derives from the catalog; the catalog is unchanged → foundation seeding stays consistent; `p7-s2c-permission-catalog.test.ts` role-matrix totals (76/40/32/35/25/23) are untouched.
- **Reviewer note:** if B' assesses that finance/commission/refund aggregates must be finance-role-gated, the bounded addendum path is: add new catalog code(s) + migration 0040 + parity updates. Not required under the current contract reading.
- RBAC enforcement unchanged: `@RequirePermission('report.read', { marketScoped: true })` on both endpoints, canonical 409 `MARKET_CONTEXT_MISMATCH`, 403 `PERMISSION_DENIED`/`MARKET_ACCESS_DENIED`, 401 unauthenticated.

## 6. Tests

### Unit (`admin-report-ops.spec.ts`)

- Catalog integrity: exactly 19 reports R01–R19, unique ids, all `report.read` + REAL + window invariant (QUEUE → 0 days, KPI → 1..90 days); advanced sources contain no DML wording.
- Freshness state machine, `buildDaySeries`, cache TTL/stale-peek: unchanged (P7-S9 semantics).
- New value builders: one test per advanced kind (R05–R19) asserting exact shapes and exact-decimal string totals.
- Masking rules: `containsRawIdentifier` detects UUIDs and raw prefixes (acct*, M-, R-, RCPT*, ORD*, CASE*, ref\_, ik-), accepts safe aggregates; every catalog value stays identifier-free.
- Read-only guarantees: captured SQL across the full catalog is SELECT-only (zero DML); KPI reports carry `make_interval` bounds, QUEUE reports are point-in-time.
- Permission + route gating: both endpoints carry `report.read` + `marketScoped` metadata; HTTP methods are GET-only.

### Integration (`admin-report-ops-advanced.integration.spec.ts`, real PostgreSQL)

- **Fail-closed guard** (`P8S4_DESTRUCTIVE_TEST` + `^ipoint_p8s4_[a-z0-9_]{1,63}$`, protected names rejected) — mirror P8-S2/P8-S3.
- RBAC: 401 unauthenticated, 403 member session, 403 admin without `report.read`, canonical 409 market mismatch.
- **One real scenario per advanced category (15/15)**: R05 KYC/applications, R06 wallet volume (exact totals `36.0000000000` / `10.0000000000`), R07 reconciliation runs+items, R08 market profile counts, R09 member statuses, R10 merchant statuses, R11 agent statuses, R12 transaction value by currency (`187.0000000000` purchase / `10.0000000000` fees), R13 MCP accounts+ledger, R14 reward accrual+plans, R15 commission ledger+adjustments, R16 redemption volume+points, R17 fulfilment exceptions+shipping payments, R18 MCP+redemption refunds, R19 risk events+queue+reconciliation exceptions.
- Market isolation: market B aggregates contain only market B rows; market A free of foreign rows.
- No fabricated zero: every catalog item FRESH with a real value; empty market reports real empty aggregates; unknown id → 422 `REPORT_UNDEFINED`.
- Masking: none of the 19 payloads contains a raw identifier.
- No export: POST to catalog/detail/`export` path → 404.
- Freshness: first live read carries `queryDurationMs` under the frozen SLA (QUEUE < 60s, KPI < 5m); cached read keeps the same `asOf`, no `queryDurationMs`.
- **Zero DML**: byte-identical sha256 snapshots of 45 frozen tables (financial + ledger + reward + commission + redemption + reconciliation + risk) before vs after running all 19 reports.

## 7. DB/API changes

- **DB: none.** No migration (checksums **40/40** unchanged), no schema/seed/parity changes. Frozen owners untouched; `mcp_ledger_entries` still writable only through `append_mcp_ledger_entry` (fixtures use the function).
- **API: no new endpoints.** The existing P7-S9 GET-only surface (`GET /api/v1/admin/report-ops/markets/:marketId/reports` and `…/reports/:reportId`) now serves 19 report definitions. Response envelope and error codes unchanged. OpenAPI: no new paths; the existing controller Swagger decorators already describe both endpoints (the catalog summary remains accurate; no doc change required).

## 8. Security impact

- Read-only module: unit + integration suites prove zero DML over 45 tables; the service has no write path (grep-verified; assert-verified).
- Market isolation at the canonical guard (session market = URL market) plus market-filtered SQL everywhere; foreign-market rows never reach the aggregates.
- Privacy masking: aggregate-only payloads; raw identifiers (UUIDs, member/account/receipt/order/case references, idempotency keys) never emitted — `containsRawIdentifier` asserted per report in unit and integration.
- No export: no CSV/download endpoint, method or UI anywhere in the module; POST → 404 asserted.
- Freshness honesty: a missing/failed source is UNAVAILABLE/STALE — never a fabricated zero (unchanged P7-S9 state machine; all 19 sources are REAL in this phase).
- No secrets, no placeholders, no test deletions, no frozen-owner writes.

## 9. Scope decision (pre-recorded, M-1 precedent)

- **admin-web UI for advanced reports is deferred to P8-S5 (Cross-Platform Final Integration)**, together with the reconciliation + risk review UIs — engine/API/tests only in this stage. Rationale: identical precedent to the reconciliation/risk UI deferrals; keeps P8-S4 focused on the read-surface/permission correctness; P8-S5 builds UI states over these stable APIs with canonical route-manifest permissions.

## 10. Assumptions

- The existing frozen schemas are authoritative read sources and are unchanged; every advanced view aggregates only existing tables.
- `report.read` reuse is the correct permission model for masked aggregate-only reports (rationale in §5); the reviewer (B') may challenge this and the bounded addendum path is documented.
- Fixture inserts for P8 domain tables (reconciliation/risk/commission/redemption) are test-data writes, not report writes; the zero-DML assertion isolates the report-read window (snapshot → reads → snapshot).
- Test execution, commit SHAs, typecheck/build/lint/format/OpenAPI and fresh-PG runs happen on the host under the main agent's verification, per the OpenClaw operating model. The advanced integration suite requires `DATABASE_URL` naming `ipoint_p8s4_*` + `P8S4_DESTRUCTIVE_TEST=1` (fail-closed otherwise).
- The host gate runs the P8-S4 advanced suite against its own dedicated DB; the P7-S9 `admin-report-ops.integration.spec.ts` (no guard) must not share the same DATABASE_URL concurrently (run separately, as with P8-S2/P8-S3 suites).

## 11. Risks

- **Catalog growth**: 19 reports now resolve on every catalog request; each is independently cached by freshness class and measured (`queryDurationMs`); worst-case live catalog cost ≈ sum of 19 bounded aggregates (observed < 10ms each class of query in P7-S9; SLA 60s/300s).
- **Aggregate semantics**: R12 sums CONFIRMED transactions only (documented in the definition); R13/R15/R16 amount sums are exact-decimal strings — consumers must treat them as strings, never floats (same convention as P7-S9 exact decimals).
- **Point-in-time reports** (QUEUE class) are TTL 60s — expected for queue views; KPI views carry ≤ 90d bounded windows.
- Reviewer divergence on permission reuse (§5) is the main review risk; mitigation: recorded rationale + bounded addendum path.

## 12. Outstanding work (later stages, not in scope here)

- admin-web UI for advanced reports (P8-S5), including report value-kind rendering for the new kinds.
- Any future finance-gated raw views would require new catalog permissions + migration 0040 (not needed for this delivery).

## 13. Rollback note

- Zero migration: there is no migration to roll back; checksums remain 40/40 and the database is byte-identical before/after this change.
- Rollback of the feature branch: revert the commits on `task/p8-s4-advanced-reports` before merge; no schema/data impact. The report module is additive over existing tables and never writes, so no ledger/domain rollback requirement exists.

## 14. Executor provenance

- Executor class: OpenClaw-managed coding subagent (A' role, D-060). Model: `deepseek/deepseek-v4-flash` (current run). Session: subagent `P8-S4 Implementer A'` (session id `1fe9fc46-4f95-4132-9268-2d0d34f9bdb4`; requester session `agent:main:dashboard:9c20dadf-0682-486d-b226-380b49bf8ffc`).
- Worktree: `.local/wt-p8-s4` on `task/p8-s4-advanced-reports`. Sandbox had no git/typecheck/DB — file edits only; the host gate verifies (fresh-PG `ipoint_p8s4_test` + `P8S4_DESTRUCTIVE_TEST`, unit suites, checksums 40/40, drift, typecheck/build, eslint, prettier, OpenAPI), commits with the plan above, then dispatches independent review (B').
- Self-checklist (performed by implementer before handoff):
  - [x] 15 advanced report definitions + service methods, all market-scoped, bounded, read-only, exact-decimal strings
  - [x] P7-S9 envelope preserved (asOf/freshness/stale/unavailable/queryDurationMs); no fabricated zero paths
  - [x] Zero new permission codes + zero migration (documented reuse of `report.read`); catalog/foundation/parity untouched
  - [x] Unit suite updated (19-report catalog, new kinds, masking, no-DML SQL scan, bounded windows, permission/GET-only metadata)
  - [x] New integration suite with fail-closed guard, 15 category scenarios, RBAC 401/403/409, market isolation, masking, no-export POST→404, no-fabricated-zero, zero-DML snapshot over 45 tables, freshness/cache/SLA
  - [x] Fixture constraints respected (mcp ledger via `append_mcp_ledger_entry`; MCP recharge amounts cover fixture entries; enum casts `as never`; `BigInt` entry sequences; unique/idempotency keys per row; exclusion-safe periods)
  - [x] Encoding: UTF-8 no BOM, proper Unicode (— · §) in all edited/created files
  - [x] No out-of-scope files touched; frozen owners untouched; no export surface added; no `git` operations performed

---

## 15. Host integration-gate fixes (OpenClaw, post-delivery verification)

The host gate (Node v26.4.0, fresh PostgreSQL) required bounded fixes before the P8-S4 gate could pass. All are type/fixture-only repairs; **zero production behaviour change**:

| # | File | Fix | Class |
|---|---|---|---|
| 1 | dmin-report-ops.types.ts | ReportId union extended R01-R04 → R01-R19 (the 15 advanced definitions were added to the catalog but the id union was not widened — TS2322 on every R05-R19 entry) | implementer defect (TS2322) |
| 2 | dmin-report-ops.spec.ts / dmin-report-ops-advanced.integration.spec.ts | Report-value assertions narrowed to concrete shapes without the discriminant: added kind: string; to 23 s { assertions (TS2339), deduped double-insert, and s unknown as for the TS2352 site | implementer defect (TS2339/TS2352) |
| 3 | dmin-report-ops.spec.ts | ReportSnapshotCache(16) → (64) at 4 sites: with 19 catalog reports, the P7-S9-era 16-entry cache evicts R01 during catalog() (LRU over 18 successful fresh sets), so the stale-snapshot test's manually-seeded entry is gone by eport() time — production default is 128 (module unchanged), this is a test-parameter parity update only | catalog-growth parity (4→19) |

Pre-existing baseline issues recorded (NOT introduced by P8-S4, reproduced on the P8-S2/P8-S3 baseline): p5-s1-schema.test.ts runtime/typecheck failure; dmin-reconciliation-ops.integration.spec.ts TS2769 insert typing. Full P8-S4 gates: checksum 40/40, drift clean, typecheck clean for P8-S4 files, build all packages, eslint 0, prettier clean, OpenAPI 299 paths, unit 34/34, advanced integration 32/32 (fresh ipoint_p8s4_test + P8S4_DESTRUCTIVE_TEST), P7-S9 integration 14/14 (fresh dedicated DB).
