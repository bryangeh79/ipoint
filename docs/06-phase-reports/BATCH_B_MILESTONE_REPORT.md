# Phase 1 Batch B Milestone Report

## Authorization and repository state

- Authorization: ChatGPT Command Center Order, 2026-07-17
- Approved baseline: `73f94653c541273db2830f146298524a06a65301`
- Governance commit: `ab61b0168e70d8e4fc22edff9169b092765b0321`
- Phase implementation remote SHA before this report: `23bf2e4ce1cef276a10c6d5a547051365d6bf395`
- Phase branch: `phase/1-merchant-onboarding-mcp`
- Main merge: not performed

## Task branch evidence

| Task | Branch | Completion commit | Integration commit | Remote verified |
|---|---|---|---|---|
| P1-S5 | `task/p1-s5-service-fee-packages` | `4bb8852bcbe55aab6a9d3032516004a025be578a` | `148a8fdeb7f54e6c29269fd189aaf54864df2776` | Yes |
| P1-S6 | `task/p1-s6-mcp-ledger-recharge` | `35a183643f391b3b93bd72cc4bd3dc5c42102dfe` | `6946ee1ef55fa354635d156ffdc170017a5c2fc2` | Yes |
| P1-S7 | `task/p1-s7-mcp-governance` | `d7b609288d0a00db89ec455cd1f46b6f6684708b` | `23bf2e4ce1cef276a10c6d5a547051365d6bf395` | Yes |

## Codex CLI execution evidence

| Field | Evidence |
|---|---|
| Executable | `C:\Users\MSI\AppData\Roaming\npm\codex.ps1` |
| Version | `codex-cli 0.144.4` |
| Authentication | ChatGPT account session |
| Provider / model | OpenAI / GPT-5 session runtime |
| Command | Command Center Phase 1 Batch B order executed sequentially in the active Codex CLI session |
| Codex PID / parent PID | `21772` / `28620` |
| API key environment | Not present |
| Base URL override | Not present |
| P1-S5 interval | 2026-07-17 12:20:02 +08:00 to 12:36:09 +08:00 |
| P1-S6 interval | 2026-07-17 12:37:32 +08:00 to 12:47:22 +08:00 |
| P1-S7 interval | 2026-07-17 12:47:55 +08:00 to 12:55:58 +08:00 |
| Exit code | `0` for each final task gate run |
| Local-only logs | `.codex-execution-logs/p1-s5.log`, `p1-s6.log`, `p1-s7.log` (gitignored) |

## P1-S5 package implementation evidence

- Standard A-F profiles retain locked initial exact rates of 2.5%, 5%, 10%, 15%, 20%, and 25%.
- Package profiles, version lifecycle/effective windows, market-specific immutable special percentages, assignments, default selection, pause/resume, and change requests are implemented.
- Exactly one active default per branch and last-active pause protection are enforced.
- Assigned version financial fields become immutable after first reference.
- Admin RBAC/MarketAccess and merchant branch ownership negative paths are covered.
- Rates remain exact PostgreSQL `numeric(12,6)` and API decimal strings; floating-point arithmetic is not used.

## P1-S6 ledger and recharge evidence

- MCP balances use `numeric(38,10)` and are projections of the append-only ledger.
- `append_mcp_ledger_entry` locks the account, allocates a per-account sequence, checks deltas, rejects negative/invalid available balance, updates the projection, and inserts the ledger row atomically.
- Direct balance projection updates and direct ledger inserts are rejected; existing ledger UPDATE/DELETE protection remains active.
- Account-scoped idempotency returns the original posting for the same payload and rejects mismatched payloads.
- Concurrent replay tests produce one ledger entry and one balance credit.
- Recharge `COMPLETED` credits exactly once; `FAILED` writes no credit.
- Merchant/admin summary, ledger view, and reconciliation endpoints are protected by ownership or market-scoped RBAC.
- Reversal foundation is preserved through `reversal_of_entry_id`; no transaction, advertising, payment-provider, or payout runtime was added.

## P1-S7 adjustment, refund, and activation evidence

- Manual credit/debit uses DRAFT -> PENDING_APPROVAL -> EXECUTED or REJECTED governance.
- Reason and non-empty evidence are required. There is no amount threshold exception.
- Maker self-approval is rejected at both the service boundary and database trigger; no Super Admin bypass exists.
- Approval and exactly-once ledger execution occur atomically after approval-stage and execution-stage revalidation.
- Refunds require PENDING -> UNDER_REVIEW -> APPROVED or REJECTED. Approval creates one REFUND debit/reservation entry and records a `NON_CASH` obligation; no payment or payout provider is invoked.
- Initial activation requires approved Application, approved KYC, and available MCP >= 100.
- Falling below 100 after activation does not auto-deactivate. Suspension preserves MCP. Reactivation re-evaluates the current three conditions and returns `PENDING_MCP` when the current balance is below 100.
- Status history, audit logs, and entity timelines are written for governed operations.

## Migration and checksum evidence

- Forward-only migrations added:
  - `0004_service_fee_package_management.sql`
  - `0005_mcp_ledger_recharge.sql`
  - `0006_mcp_adjustment_refund_governance.sql`
- No already-published migration file was modified.
- Seven migration checksums verified.
- Migration from zero and upgrade from the 0001 baseline both pass in disposable databases.
- `db:migrate`, double `db:seed`, and `db:drift` pass; no schema drift remains.

## Verification results

Each task's final run passed:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm test:api`
- `pnpm test:database`
- `pnpm db:checksum`
- `pnpm db:migrate`
- `pnpm db:seed` twice
- `pnpm db:drift`

Targeted evidence includes effective-window, special-percentage boundary, default/last-active, RBAC/MarketAccess, ledger concurrency, idempotency mismatch, negative balance, recharge exactly-once, maker/checker, refund obligation, suspension preservation, activation, and reactivation tests.

## Repair loops

- P1-S5: one local applied-checksum metadata repair after confirming the published migration blob matched the approved checksum; no migration source was changed.
- P1-S6: one schema expectation placement correction and one API BigInt serialization correction.
- P1-S7: one deterministic seed-count expectation correction after adding the authorized refund permission.
- No gate exceeded three repair loops.

## Repository hygiene and scope

- Task commits contain only authorized P1-S5, P1-S6, P1-S7, migration, test, and governance-support changes.
- Local Codex execution logs are gitignored and were not committed.
- Existing local `memory/2026-07-16.md` modification and untracked `media/` files were preserved and excluded from every commit.
- No secrets, API keys, provider credentials, generated logs, or production integration artifacts were committed.
- Scope leakage: **0**.
- Prohibited implementations: **0**.
- Main merge: **not performed**.

## Open blockers

NONE. Batch B is ready for ChatGPT Command Center review. P1-S8 and later remain not authorized.
