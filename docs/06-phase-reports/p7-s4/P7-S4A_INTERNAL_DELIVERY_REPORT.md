# P7-S4A Internal Delivery Report (Continuation)

| Status          | Value                                                             |
| --------------- | ----------------------------------------------------------------- |
| Delivery        | `DELIVERY_COMPLETE`                                               |
| Internal gate   | `OPENCLAW_INTERNAL_GATE_PASSED`                                   |
| Phase authority | `CONTINUING_UNDER_D-047` via `D-048 §5`                           |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (written handoff continuation) |

## 1. Scope delivered

P7-S4A delivered the Admin Dashboard bounded read-model API and its typed
client surface authorized by D-047/P7-S4:

- `AdminDashboardModule` with `GET /api/v1/admin/dashboard/metrics` and
  `GET /api/v1/admin/dashboard/metrics/:metricId`, guarded by
  `dashboard.view` + server-selected Current Admin Market (RbacGuard).
- M01–M14 metric catalog (M10 = `NO_DURABLE_SOURCE` per SEC-01), bounded
  read-only queries over canonical owner tables, freshness
  `FRESH`/`STALE`/`UNAVAILABLE`, source-permission gating
  (`merchant.mcp.view`, `reward.job.read`), and drill-down references that
  preserve market, permission, masking, metric filter, and time boundary.
- Typed DTOs and `AdminApiClient.dashboardMetrics()` /
  `AdminApiClient.dashboardMetricDetail()` in `@ipoint/api-client` so the
  P7-S4B Admin Web UI can consume the endpoints.
- Unit (16) and HTTP integration (14) suites, all passing against a fresh
  PostgreSQL test database with migrations applied.

## 2. Branch and worktree map

| Worktree    | Branch                              | Starting SHA                               | Delivered commits |
| ----------- | ----------------------------------- | ------------------------------------------ | ----------------: |
| `wt-p7-s4a` | `task/p7-s4a-dashboard-read-models` | `301f6a7a6d077dbbd51892d8a35c5ff0b82a3a93` |                 2 |

No push was performed; OpenClaw reviews and pushes.

## 3. Commit map

1. `a91887862a4da75c94d534790607bafa4c607489` — `feat(admin-api): add bounded dashboard read models`
2. `404ca4d7375f73b8e32ff4ac3c47f298869ac690` — `docs(p7-s4a): record internal delivery report` (this report; SHA map filled by a follow-up docs commit after the report SHA was known)

## 4. API delivery

### `GET /api/v1/admin/dashboard/metrics`

- Auth: `AuthGuard` + `RbacGuard`, requires `dashboard.view`.
- Market: server-selected Current Admin Market from the admin session; a
  client-supplied market that differs returns `409 MARKET_CONTEXT_MISMATCH`; a
  missing selection returns `409 MARKET_SELECTION_REQUIRED`.
- Response: `{ asOf, marketId, items: DashboardMetricState[] }` — 14 items
  (M01–M14), each with definition, freshness state, `asOf`, and value.

### `GET /api/v1/admin/dashboard/metrics/:metricId`

- Same guard/market contract; adds `marketId` + `drillDown` reference.
- `422 DASHBOARD_METRIC_UNDEFINED` for unknown ids; `503
DASHBOARD_DATA_UNAVAILABLE` for `NO_DURABLE_SOURCE` (M10) and other
  unavailable states.

### Metric catalog (M01–M14)

| Id  | Metric                          | Source permission (if any) |
| --- | ------------------------------- | -------------------------- |
| M01 | Members                         | —                          |
| M02 | Active members                  | —                          |
| M03 | Suspended/closed members        | —                          |
| M04 | Merchant branches breakdown     | —                          |
| M05 | Merchant applications pending   | —                          |
| M06 | Merchant KYC submissions        | —                          |
| M07 | Member KYC cases                | —                          |
| M08 | Agent activations               | —                          |
| M09 | MCP adjustments pending checker | `merchant.mcp.view`        |
| M10 | (blocked — no durable source)   | — (always `UNAVAILABLE`)   |
| M11 | Redemption queue summary        | —                          |
| M12 | Reward job status               | `reward.job.read`          |
| M13 | Today's confirmed transactions  | —                          |
| M14 | MCP available balance           | `merchant.mcp.view`        |

## 5. Failures found and fixed (continuation)

The previous subagent's code was complete and reviewed; the integration spec
had never been exercised end-to-end. On a fresh database the following were
found and fixed (all in test fixtures except where noted):

1. **`mcp_adjustment_requests.payload_hash`** — fixture used a 42-char
   `hash_<uuid>` value; `mcp_adjustment_payload_hash_check` requires exactly
   64 chars. Fixed with `createHash('sha256').update(randomUUID()).digest('hex')`.
2. **Deferred trigger `merchant_package_assignments_active_default`**
   requires exactly one ACTIVE default assignment per merchant branch; the
   transaction fixture created a new `isDefault: true` assignment per call.
   Only the first assignment per branch is now default.
3. **`market_transaction_settings` is keyed on `market_id` (PK)** — one
   settings row per market, so a USD transaction in market A is impossible
   (FK `(market_id, currency)`). The USD fixture row now uses MYR and the
   M13 expectations were updated to `160.5000000000` / `20.0000000000`
   (numeric(38,10) scale from `sum(...)::text`).
4. **`createRedemptionFixture` wallet** — the member wallet may already exist
   (created by the transaction fixtures), so the `onConflictDoNothing` insert
   returned no row and the order referenced an empty id. Wallet is now
   selected first, inserted only when missing.
5. **Admin sessions** — `auth.login` creates ACCOUNT-purpose sessions, so the
   dashboard RbacGuard (which needs `actor.adminUserId`) always denied with 403. Fixtures now use `auth.createAdminSession(...)`.
6. **Template role codes** — `postgres-auth.store.findAccessSession` only
   sets `hasActiveRole` for the six template role codes, and `seedFoundation`
   pre-loads those roles with their canonical permission sets. `createAdmin`
   now reuses one template-code role per distinct permission-set signature
   (registry, 5 distinct sets used) and reshapes its `role_permissions` to
   exactly the requested set.
7. **Test 1 throwaway member** polluted M01/M02/M03 counts (M01 counts
   `member_market_preferences` rows). The member is now created with
   `withPreference: false`.
8. **Service SQL bug (production code, `apps/api/src/admin-dashboard/**`)** —
`countMembers`used`m.status = ANY($2::text[])`, which fails with
`operator does not exist: member_status = text`(M02/M03 always`UNAVAILABLE`). Fixed to `m.status::text = ANY($2::text[])`.
9. **Isolation test contradiction** — it asserted M09 = FRESH 0 while the
   gating design makes M09/M14 `SOURCE_PERMISSION_DENIED` without
   `merchant.mcp.view`. The isolation admin now holds
   `['dashboard.view', 'merchant.mcp.view']`.
10. **TypeScript `noUncheckedIndexedAccess`** on the template-code tuple
    index — added a `?? 'SUPER_ADMIN'` fallback so `roleCode` narrows to
    `string`.
11. **Prettier** — all changed files reformatted to repo style.

No database schema, migration, or frozen Phase 1–6 owner code was modified.

## 6. Typed API client (missing scope item — delivered)

Added to `packages/api-client/src/index.ts`:

- DTO types mirroring `apps/api/src/admin-dashboard/admin-dashboard.types.ts`:
  `AdminDashboardMetricId`, `AdminDashboardFreshnessState`,
  `AdminDashboardUnavailableReason`, `AdminDashboardFreshnessClass`,
  `AdminDashboardJobRunSnapshot`, `AdminDashboardMetricValue`,
  `AdminDashboardMetricState`, `AdminDashboardCatalogDto`,
  `AdminDashboardDrillDownReference`, `AdminDashboardMetricDetailDto`.
- Methods on `AdminApiClient` (no client-supplied market header — the market
  is server-selected):
  - `dashboardMetrics(): Promise<AdminDashboardCatalogDto>` →
    `GET /admin/dashboard/metrics`
  - `dashboardMetricDetail(metricId): Promise<AdminDashboardMetricDetailDto>`
    → `GET /admin/dashboard/metrics/:metricId`
- Two new tests in `packages/api-client/src/index.test.ts` (exact paths +
  DTO shape passthrough, including the no-`x-market-id`-header assertion).

## 7. Tests and verification (exact commands, all inside the worktree)

Environment: Linux sandbox; `DATABASE_URL=postgresql://ipoint:ipoint-local-only@172.23.0.3:5432/ipoint_dashboard_test`
(test database dropped and recreated before the integration run; migrations
apply in `beforeAll`). Root `/workspace/node_modules` symlinks are broken, so
all commands ran with cwd inside `/workspace/.local/wt-p7-s4a`.

| Command                                                                                             | Result                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/api exec vitest run src/admin-dashboard/admin-dashboard.spec.ts`             | 16 passed / 0 failed / 0 skipped, exit 0                                                                                                                                                                  |
| `pnpm --filter @ipoint/api exec vitest run src/admin-dashboard/admin-dashboard.integration.spec.ts` | 14 passed / 0 failed / 0 skipped, exit 0                                                                                                                                                                  |
| `pnpm --filter @ipoint/api typecheck`                                                               | exit 0                                                                                                                                                                                                    |
| `pnpm --filter @ipoint/api build`                                                                   | exit 0                                                                                                                                                                                                    |
| `pnpm --filter @ipoint/api openapi:validate`                                                        | ✅ all runtime validations passed (204 paths, 0 schema/operationId errors) — requires `REDEMPTION_VOUCHER_ENCRYPTION_KEY` env (script provides no default; pre-existing gap, script not in allowed paths) |
| `pnpm --filter @ipoint/api-client typecheck`                                                        | exit 0                                                                                                                                                                                                    |
| `pnpm --filter @ipoint/api-client test`                                                             | 29 passed / 0 failed, exit 0                                                                                                                                                                              |
| `pnpm exec prettier --check` on changed paths                                                       | clean                                                                                                                                                                                                     |
| `pnpm exec eslint` on changed paths                                                                 | exit 0                                                                                                                                                                                                    |

Environment limitations:

- `openapi:validate` prints the success summary, then the process does not
  exit because a background outbox worker keeps the event loop alive
  (pre-existing script quirk; the worker's failed-tick log noise is unrelated
  to the validation). The validation output itself is unambiguous PASS.
- Redis is not required; the spec stubs `REDIS_URL` internally.

## 8. Risks and limitations

- The dashboard never writes and never fabricates values; M10 remains
  `UNAVAILABLE` until a durable source exists (SEC-01).
- Fixture role-permission reshaping mutates the shared template roles inside
  the throwaway test database only; it has no effect outside the test run.
- The integration suite requires a clean database (count assertions are
  absolute); OpenClaw CI must recreate `ipoint_dashboard_test` before running
  (same as this continuation did).
- `openapi:validate` needs `REDEMPTION_VOUCHER_ENCRYPTION_KEY` exported; the
  script should default it (out of scope for this task's allowed paths).

## 9. Git state

- Worktree: `/workspace/.local/wt-p7-s4a` (branch `task/p7-s4a-dashboard-read-models`).
- Starting SHA: `301f6a7a6d077dbbd51892d8a35c5ff0b82a3a93`.
- Commits: 2 (code, then report). No amend, no rebase, no force, NO PUSH.
- Left untracked on purpose: `jiti/` (tooling cache) and the prior
  subagent's scratch probes `constr.cjs`, `mkdb.cjs`, `probe4.cjs`,
  `scan2.cjs` — none are staged or committed.

## 10. Internal gate result

`OPENCLAW_INTERNAL_GATE_PASSED` — all unit/integration/type/build/lint/format
checks green; typed client scope item delivered; commits scoped exactly;
nothing pushed.
