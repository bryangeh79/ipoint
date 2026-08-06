# P7-S6 — O-13 Member Reward Rule Create Route Remediation Delivery Report

| Field         | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| **Record**    | O-13 delivery — HIGH security: remove/ban the member-facing reward rule creation route                   |
| **Status**    | `O13_DELIVERY_COMPLETE` / pending review + verification                                                 |
| **Decisions** | D-048 (subagent authorization class) / D-055 §4 (Bounded Owner Hardening Authority — no new authorization required; DECISION_LOG.md:1632–1634) |
| **Branch**    | `fix/p3-p7-reward-member-route` (base `91c59bd6` = latest verified `phase/7-admin-operations` HEAD)      |
| **Executor**  | `OPENCLAW_MANAGED_CODING_SUBAGENT` (D-048, implementer role)                                             |
| **Pushed**    | NO (integration/push is OpenClaw's)                                                                      |
| **Date**      | 2026-08-06                                                                                               |

## 1. Scope delivered

`POST /api/v1/rewards/rules` — the only member-facing reward rule creation
surface — is **removed** (route → 404 for every actor), and the underlying
`RewardService.createRuleVersion` raw-insert method is **banned** (tripwire:
always rejects). Creation of reward rule versions now exists **exclusively**
through the secured Phase 3 owner `AdminRewardService.createRuleVersion`
(D-052, exercised by P7-S6B 38/38). No new write surface is introduced, no
reward rate business rules change, and zero data is modified.

| O-13 requirement | Delivery |
|---|---|
| 1. Member can never create reward rules | `@Post('rules')` handler removed from `reward.controller.ts`; the path now resolves to Nest's default 404 for unauthenticated **and** authenticated member actors (proven by HTTP tests). |
| 2. Non-authorized admin cannot create | Unchanged — creation only through the secured Phase 3 owner (`admin-reward` / `admin-reward-ops`, D-052/D-050); this task adds no write surface. |
| 3. Direct route **and** in-process callers cannot bypass | `RewardService.createRuleVersion` retained as a tripwire that always rejects with `REWARD_RULE_CREATE_DISABLED` (deep defense). Grep-verified: the removed controller route was its only caller; after removal there are **zero reachable call sites** (only the disabled method itself and spec assertions that pin the rejection). |
| 4. Reward rate business rules unchanged | Untouched: 0.05%/day governance cap, decimal precision, existing rule data — no changes (no edits outside `reward.controller.ts` / `reward.service.ts` / specs). |
| 5. No historical recalculation / wallet / ledger | Zero data changes, no migration, no seeds touched. |
| 6. Read routes retained | `GET /api/v1/rewards/plans`, `GET /api/v1/rewards/plans/:id`, `GET /api/v1/rewards/rules`, `GET /api/v1/rewards/rules/:id` unchanged and re-verified (member GET rules → 200; no-auth → 401). |

## 2. Changed files

```
apps/api/src/reward/reward.controller.ts            (modified — removed @Post('rules') handler + unused imports: Body, Post, createRuleVersionSchema, CreateRuleVersionDto; ZodValidationPipe kept, still used by GET query pipes)
apps/api/src/reward/reward.service.ts               (modified — createRuleVersion body replaced with unconditional rejection tripwire; imports/helpers cleaned; read methods untouched)
apps/api/src/reward/reward.service.spec.ts          (modified — the two "creates a rule version" tests replaced by two tripwire tests: rejects REWARD_RULE_CREATE_DISABLED + never touches the DB (insert mock not called))
apps/api/src/reward/reward-o13-route.spec.ts        (new — HTTP integration suite: POST rules → 404 for unauthenticated and member actors, no row inserted, read routes still 200/401)
docs/06-phase-reports/p7-s6/O13_MEMBER_REWARD_ROUTE_REMEDIATION_REPORT.md  (this report)
```

Not modified: `admin-reward/**`, `admin-reward-ops/**` (secured owner + Phase 7
surface, D-052/CG-02), `reward.dto.ts` (kept: `createRuleVersionSchema` /
`CreateRuleVersionDto` remain the declared types of the disabled method —
exported definitions, not call sites), `packages/database/**`, any migration,
any other domain. `jiti/` and probe artifacts are untracked and excluded.

## 3. Security analysis — no bypass path remains

**Before (O-13 finding):** `POST /api/v1/rewards/rules` (reward.controller.ts:90,
`@UseGuards(AuthGuard)` only) → `RewardService.createRuleVersion`
(reward.service.ts:52, raw `INSERT INTO reward_rule_versions`): no RBAC, no
market enforcement, no 0.05%/day governance cap, no 6-decimal rate bound, no
reason, no audit, no idempotency, forgeable `createdBy` — any logged-in
ACCOUNT/MEMBER could write arbitrary reward rule rows.

**After — direct route:** the handler no longer exists. Nest registers no
`POST /api/v1/rewards/rules` route; the request falls through to the 404
handler. Proven by HTTP tests for both unauthenticated and authenticated
member actors, and by the OpenAPI path dump (`/api/v1/rewards/rules` exposes
only `get`).

**After — in-process callers:** `RewardService.createRuleVersion` is a
tripwire. Every invocation rejects with
`REWARD_RULE_CREATE_DISABLED: member-facing reward rule creation is removed
(O-13); attempted rule "<name>" — use AdminRewardService.createRuleVersion`
and never touches the database (the insert path was deleted; unit test pins
`insertReturningMock` not called).

**Grep evidence (post-change, no reachable callers):**

```
$ grep -rn "createRuleVersion" apps/api/src --include="*.ts" | grep -v admin-reward
apps/api/src/reward/reward.dto.ts:22        export const createRuleVersionSchema = ...   (type export only)
apps/api/src/reward/reward.dto.ts:71        export type CreateRuleVersionDto = ...       (type export only)
apps/api/src/reward/reward.service.spec.ts:184/200  service.createRuleVersion({...})    (tripwire pin tests, expect rejects)
apps/api/src/reward/reward.service.ts:61    async createRuleVersion(input) { ... }      (disabled method itself)
$ grep -n "@Post" apps/api/src/reward/reward.controller.ts
→ no output (no POST routes remain in the reward controller)
```

The sole surviving legitimate creation path is
`AdminRewardService.createRuleVersion` (D-052 secured owner) reached via the
Phase 7 `admin-reward-ops` adapter (S6B, 38/38) — untouched and re-verified.

## 4. Test matrix (real PostgreSQL, isolated DBs)

See `/workspace/.local/o13-gate/evidence/SUMMARY.md` + per-gate logs
(`01-…`–`20-…`). Node v26.4.0, pnpm 9.15.9, Postgres 172.23.0.3, Redis
172.23.0.2. DBs created fresh per gate (DROP/CREATE + migrate; seed where the
suite requires).

| Gate | Suite(s) | DB | Result |
|---|---|---|---|
| 01 | `reward.service.spec.ts` (unit) | ipoint_gate_o13_unit | **33/33** |
| 02 | `reward-o13-route.spec.ts` (new HTTP integration) | ipoint_gate_o13 (self-created) | **4/4** |
| 03 | `transaction-reward` linkage + negative-input | ipoint_gate_o13_tx | **15/15** |
| 04 | **S6B** `admin-reward-ops` spec + integration (secured surface) | ipoint_gate_o13_s6b (self-created) | **38/38** |
| 05 | `admin-reward` owner integration + service (D-052) | ipoint_gate_o13_owner (self-created) | **56/56** |
| 06 | **S6A** `admin-package-ops` spec + integration (rewire) | ipoint_gate_o13_s6a (fresh) | **54/54** (14 unit + 40 integration) |
| 07 | **S6D** `admin-commission-ops` spec + integration | ipoint_gate_o13_s6d (self-created) | **41/41** |
| 08 | api `typecheck` | — | EXIT 0 |
| 09 | api `build` | — | EXIT 0 |
| 10 | OpenAPI runtime validation | ipoint_gate_o13_openapi (migrated+seeded) | ✅ passed — **0 missing / 0 dup / 0 broken $ref** |
| 11 | OpenAPI rewards path dump (probe) | same | `POST` gone: `/api/v1/rewards/rules` methods = `["get"]` |
| 12 | eslint (4 changed files) | — | 0 errors |
| 13 | prettier (4 changed files) | — | clean |

Behavioural assertions (gate 02): unauthenticated `POST /api/v1/rewards/rules`
→ **404**; authenticated member → **404**; `reward_rule_versions` row count
unchanged (0) after the member attempt; member `GET /api/v1/rewards/rules` →
**200** `{items: [], total: 0}`; no-auth GET → 401 (unchanged).

**Note on the S6A first attempt:** the initial S6A run (matrix gate 06, 08:01)
failed with a `service_fee_versions_no_overlap` exclusion-constraint violation
because the spec requires a completely empty database (fixed-range fixtures)
and the earlier 40/40 run had left rows. Re-run on a freshly recreated DB:
54/54 EXIT 0. This is the documented `TEST_ENVIRONMENT_CONTAMINATION` class
(P7-S4/S5), not a code regression.

## 5. OpenAPI — 238 paths (POST operation removed from the spec)

Expected per task brief: 238 → 237 paths. Actual: **238 paths / 0 missing /
0 dup**, and the `POST /api/v1/rewards/rules` operation is absent from the
spec. Explanation (evidence `20-openapi-dump.log`): OpenAPI paths are keyed by
path, not by method. `/api/v1/rewards/rules` was a single entry grouping
`get` + `post` (already documented in the S6A gate record: "POST registered as
`get,post`, not a missing route"). Because O-13 requirement #6 retains the read
route `GET /api/v1/rewards/rules`, the path entry necessarily remains — with
`methods: ["get"]` only. The security-relevant assertion — no POST operation
exists on that path — is satisfied and verified:

```json
{ "path": "/api/v1/rewards/rules", "methods": ["get"] }
```

## 6. Commits (logical, conventional — not pushed)

- `fix(reward): remove member-facing reward rule create route (o-13)` — controller + service
- `test(reward): assert member rule create route removed (404)` — reward.service.spec tripwire tests + new reward-o13-route.spec
- `docs(reward): record o-13 member route remediation` — this report

SHAs (branch `fix/p3-p7-reward-member-route`, base `91c59bd6`):

- `0e6080e2` — `fix(reward): remove member-facing reward rule create route (o-13)`
- `39d25514` — `test(reward): assert member rule create route removed (404)`
- `docs(reward): record o-13 member route remediation` — the commit carrying this report (branch HEAD at delivery; full SHA via `git log`; SHA rotates on any future amend)

## 7. Known limitations / notes

- `reward.dto.ts` still exports `createRuleVersionSchema` /
  `CreateRuleVersionDto` (the disabled method's declared types). They are dead
  exports by design (kept so the tripwire keeps its exact original signature);
  no code path consumes them.
- The outbox-worker `ERROR` lines visible in test logs
  (`TransactionCommissionOutboxWorker tick failed`) are pre-existing background
  noise on every integration suite (present on the base commit too); they do
  not affect assertions or exit codes.
- The `openapi:validate` process does not self-exit after printing the pass
  verdict (background worker keeps the event loop alive); the verdict and path
  dump are captured in the log before termination, matching the S6D matrix
  watchdog behaviour.
- No governance files were modified; nothing was pushed.

## 8. Status

`O13_DELIVERY_COMPLETE` — pending independent review + verification
(per D-055/D-048 model: separate reviewing Coding Subagent + integration/test
verifier before integration into `phase/7-admin-operations`).
