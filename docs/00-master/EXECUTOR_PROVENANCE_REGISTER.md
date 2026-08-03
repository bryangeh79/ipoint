# iPoint Executor Provenance Register

> Established: 2026-08-03 under D-048 (Phase 7 Alternate Coding Subagent Execution Authorization)
> Owner: OpenClaw (project general manager)
> Purpose: Record the executor class and provenance of every Phase 7 engineering task executed under D-047 continuous execution.
> Rules:
> - Append-only. One entry per dispatched engineering task.
> - Executor class must be exactly `CODEX_CLI` or `OPENCLAW_MANAGED_CODING_SUBAGENT`.
> - Never record credentials, private tokens, secrets, or hidden chain-of-thought.
> - The complete register is included in the final Phase 7 delivery report.

---

## Register fields (per task)

| Field | Required content |
|---|---|
| **Task ID** | Sub-phase task identifier (e.g., P7-S4A) |
| **Sub-phase** | Authorized sub-phase |
| **Executor class** | `CODEX_CLI` or `OPENCLAW_MANAGED_CODING_SUBAGENT` |
| **Model/provider identity** | Where available (no credentials) |
| **Session start time** | UTC / MYT timestamp |
| **Worktree** | Repository-relative worktree path |
| **Task branch** | Branch name |
| **Starting SHA** | Full SHA the task branch was created from |
| **Allowed paths** | Exact allowed file paths/globs |
| **Commit SHA** | Full SHA of the scoped task commit(s) |
| **Tests executed** | Exact commands + suites |
| **Test results** | Passed / Failed / Skipped / Exit code |
| **Independent reviewer** | Reviewer identity/class + evidence |
| **Integration commit** | Full SHA of the phase-branch integration |
| **Known limitations** | Documented limitations or risks |

---

## Task entries

<!-- New entries appended below in chronological order -->

## P7-S4A — Dashboard Server Read Models

| Field | Value |
|---|---|
| **Task ID** | P7-S4A |
| **Sub-phase** | P7-S4 (Dashboard and bounded operational read models) |
| **Executor class** | `OPENCLAW_MANAGED_CODING_SUBAGENT` (initial dispatch + written-handoff continuation + integration attempt; all under D-048) |
| **Model/provider identity** | OpenClaw managed subagents (deepseek/deepseek-v4-flash runtime pool) |
| **Session start time** | 2026-08-03 MYT (initial ~09:40; continuation ~10:45; integration attempt ~11:10) |
| **Worktree** | `.local/wt-p7-s4a` |
| **Task branch** | `task/p7-s4a-dashboard-read-models` |
| **Starting SHA** | `301f6a7a6d077dbbd51892d8a35c5ff0b82a3a93` |
| **Allowed paths** | `apps/api/src/admin-dashboard/**`, `apps/api/src/app.module.ts`, `packages/api-client/src/**` (dashboard DTOs only), `docs/06-phase-reports/p7-s4/**` |
| **Commit SHA** | `a91887862a4da75c94d534790607bafa4c607489` (feat), `404ca4d7375f73b8e32ff4ac3c47f298869ac690` (docs report), `1af724a0015b8c1e19ac7b5495a2d0445c09bdbe` (docs commit SHAs) |
| **Tests executed** | `vitest run src/admin-dashboard/admin-dashboard.spec.ts`; `vitest run src/admin-dashboard/admin-dashboard.integration.spec.ts` (fresh PostgreSQL test DB `ipoint_dashboard_test`, migrations applied); `pnpm --filter @ipoint/api typecheck`; `pnpm --filter @ipoint/api build`; `pnpm --filter @ipoint/api openapi:validate`; `pnpm --filter @ipoint/api-client typecheck`; `pnpm --filter @ipoint/api-client test`; prettier/eslint on changed paths |
| **Test results** | Unit 16/16 (exit 0); integration 14/14 (exit 0); typecheck exit 0; build exit 0; openapi:validate 204 paths, 0 errors (process does not self-exit - pre-existing script quirk); api-client 29/29 (exit 0); format/lint clean. All re-verified by OpenClaw on a clean database. |
| **Independent reviewer** | OpenClaw integration review: full diff review (types/catalog/service/controller/errors/cache/specs/api-client), re-ran unit + integration suites on a clean PostgreSQL database, verified merged-tree equality with task branch, verified main/phase-branch protection and the 102-untracked baseline |
| **Integration commit** | `7336dd46cf707620188b288c5cfedb02d33aefb3` (merge(p7-s4a) on `phase/7-admin-operations`, --no-ff, no conflicts) |
| **Known limitations** | (1) PUSH BLOCKED in this runtime: sandbox has no GitHub credentials; elevated/gateway exec disabled by policy; origin push of task branch and phase branch pending host-side execution (see D-048 environment note below). (2) First dispatch ended before committing; completed via written handoff per D-048 §5. (3) Integration attempt subagent stopped at push step (401 anonymous write access) without changes. (4) `jiti/` cache left untracked in worktree. (5) openapi:validate requires `REDEMPTION_VOUCHER_ENCRYPTION_KEY` env (pre-existing script gap). (6) Test database `ipoint_dashboard_test` created on the `ipoint-postgres-1` container (172.23.0.3:5432). |

---

*End of register — new entries appended above this line.*
