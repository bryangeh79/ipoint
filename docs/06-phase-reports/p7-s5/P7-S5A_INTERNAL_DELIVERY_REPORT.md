# P7-S5A Internal Delivery Report — Member Operations

| Status          | Value                                |
| --------------- | ------------------------------------ |
| Delivery        | `DELIVERY_COMPLETE`                  |
| Internal gate   | `OPENCLAW_INTERNAL_GATE_PASSED`      |
| Phase authority | `CONTINUING_UNDER_D-047` via `D-048` |
| Executor class  | `OPENCLAW_MANAGED_CODING_SUBAGENT`   |
| Task ID         | `P7-S5A`                             |

## 1. Scope delivered

P7-S5A delivered the safe selected-market Member Operations surface on the
frozen Phase 2 Admin Member owner (D-048):

- **Selected-market member list + detail** — server-scoped to the Current
  Admin Market via the P7-S2 platform-access machinery (`RbacGuard` +
  `RequirePermission` market-scoped definitions); masked sensitive fields;
  deterministic ordering and cursor/paged output.
- **Accepted status transitions** — suspend / reactivate / close via the
  owner commands (no new state logic), with permission-denied, suspended /
  closed display, conflict/stale, and unavailable-owner-capability states.
- **Session revocation and require-reverification** via owner commands.
- **Notes** — create + list via owner commands.
- **Masking + audit-of-view** — owner masking preserved verbatim; every
  privileged member detail view writes an audit-of-view record through the
  canonical `AuditService` (no new audit invention); no wallet/ledger/balance
  field exists anywhere on the Member Operations surface.
- **Admin Web UI** — `/admin/:marketId/members` (list with search/filter by
  status, paging, states) and `/admin/:marketId/members/:memberId` (detail:
  masked profile summary, status + history, actions, notes, states) following
  the P7-S4B dashboard UI patterns (design tokens, shell state components,
  responsive desktop + 320px, keyboard + axe-verified accessibility).
- **Typed client** — self-contained append-only Member Operations section in
  `packages/api-client` (DTOs + `AdminApiClient` methods).

## 2. Reuse-vs-adapter decision (4.1) — evidence

**Decision: a Phase 7 adapter layer was required and created**
(`apps/api/src/admin-member-ops/**`). The frozen Phase 2 endpoints were NOT
modified.

Evidence from inspection of `apps/api/src/admin-member` (read-only):

1. **List** (`AdminMemberService.listMembers`) accepts the market filter from
   the **client** via the `currentMarket` / `marketId` **query parameters**.
   The P7-S2 `RbacGuard.assertMarketConsistency` only compares route params,
   the `x-market-id` header, and body `marketId`/`market_id` — never query
   parameters. An admin holding grants to two markets could therefore list
   members of a non-selected market, violating P7-S0 §3.2 ("every ordinary
   read is a selected-market read").
2. **Detail and all writes** (`getMember`, `suspendMember`, …) assert only a
   market **grant** on the member's market (`assertMarketAccess`); they never
   require the member's current market to equal the server-owned Current
   Admin Market resolved from the admin session.
3. The owner read endpoints do not audit views; the P7-S5A task requires
   audit-of-view evidence for privileged views.

The adapter therefore adds exactly the selected-market contract on top of the
unchanged owner commands:

- Every route uses `@RequirePermission(...)` with the catalog's
  `marketScoped: true` (all `member.*` permissions), so the P7-S2 guard
  resolves the Current Admin Market server-side and rejects any client market
  disagreement (409 `MARKET_CONTEXT_MISMATCH`) before the adapter runs.
- The adapter list schema reuses the frozen `memberListQuerySchema` with
  `.omit({ marketId: true, currentMarket: true })` — client market input is
  structurally impossible (400 if attempted) and the adapter forces
  `currentMarket = server market` into the owner call.
- Detail/writes call the owner `getMember` first (owner grant check +
  owner masking), then reject with `MARKET_CONTEXT_MISMATCH` when the
  member's current market is not the selected market, then delegate the
  original DTO untouched to the owner command.
- All domain behaviour (typed validation, state/concurrency checks, required
  reason, masking, idempotency, atomic audit) remains inside the owner
  commands — the adapter duplicates no formulas, writes no domain tables, and
  exposes no wallet/ledger projection.
- Audit-of-view uses the canonical `AuditService` (the owner audit trail)
  with the internal member id so the future Audit Viewer correlates views and
  owner write-audit on one entity.

Owner-reuse evidence: `git diff` against HEAD shows **zero changes** under
`apps/api/src/admin-member/`, `apps/api/src/admin-kyc/`, or
`packages/database/`. The integration suite also proves owner behaviour is
preserved end-to-end through the adapter (status history rows, owner audit
rows, session revocation, KYC reverification transition, idempotency replay).

## 3. Branch and worktree map

| Worktree    | Branch                   | Starting SHA                               | Delivered commits |
| ----------- | ------------------------ | ------------------------------------------ | ----------------: |
| `wt-p7-s5a` | `task/p7-s5a-member-ops` | `c6e530bfe3ce3548950dd1c1667163d582303585` |                 2 |

No push was performed; OpenClaw reviews and pushes.

## 4. Commit map (full SHAs)

1. `4e6d216ac8354e303921ba92414ad26c3b878c05` — `feat(admin): add selected-market member operations` (code + tests)
2. `<COMMIT_2_SHA>` — `docs(p7-s5a): record internal delivery report` (this report)

## 5. API delivery (`apps/api/src/admin-member-ops/**`, new)

| Path                                                                      | Method | Permission                      | Behaviour                                                                                       |
| ------------------------------------------------------------------------- | ------ | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/api/v1/admin/member-ops/members`                                        | GET    | `member.read`                   | Selected-market paged list; market = server Current Admin Market; no client market param exists |
| `/api/v1/admin/member-ops/members/:publicMemberId`                        | GET    | `member.read`                   | Masked detail; market equality enforced; audit-of-view (`member.ops.view`) written              |
| `/api/v1/admin/member-ops/members/:publicMemberId/suspend`                | POST   | `member.status.manage`          | Owner suspend (reason + idempotency; sessions revoked; history + audit)                         |
| `/api/v1/admin/member-ops/members/:publicMemberId/reactivate`             | POST   | `member.status.manage`          | Owner reactivate                                                                                |
| `/api/v1/admin/member-ops/members/:publicMemberId/close`                  | POST   | `member.status.manage`          | Owner close (literal `CONFIRM`, terminal)                                                       |
| `/api/v1/admin/member-ops/members/:publicMemberId/revoke-sessions`        | POST   | `member.session.revoke`         | Owner session revocation                                                                        |
| `/api/v1/admin/member-ops/members/:publicMemberId/require-reverification` | POST   | `member.reverification.require` | Owner KYC reverification (approved case only)                                                   |
| `/api/v1/admin/member-ops/members/:publicMemberId/notes`                  | POST   | `member.note.create`            | Owner note create                                                                               |
| `/api/v1/admin/member-ops/members/:publicMemberId/notes`                  | GET    | `member.note.read`              | Owner notes list (paged, newest first)                                                          |

Error contract preserved from the owner: `ADMIN_MEMBER_NOT_FOUND` → 404,
`ADMIN_MEMBER_MARKET_ACCESS_DENIED` → 403, all other owner codes → 409;
adapter market mismatch → 409 `MARKET_CONTEXT_MISMATCH`; guard denials →
403 `PERMISSION_DENIED` / 409 `MARKET_SELECTION_REQUIRED` / 409
`MARKET_CONTEXT_MISMATCH`. Body DTOs are the frozen owner schemas imported
verbatim. Registration is a two-line addition to `apps/api/src/app.module.ts`
(import + module list), the same minimal wiring P7-S4A used
(`a9188786feat(admin-api)`); the frozen `AdminMemberModule` is imported as-is.

Files: `admin-member-ops.module.ts`, `admin-member-ops.controller.ts`,
`admin-member-ops.service.ts`, `admin-member-ops.dto.ts`,
`admin-member-ops.errors.ts`, `admin-member-ops.types.ts`,
`admin-member-ops.service.spec.ts`, `admin-member-ops.integration.spec.ts`.

## 6. UI delivery (`apps/admin-web/src/**`)

| Path                                                                                   | Purpose                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `member-ops-model.ts`                                                                  | pure presentation model: status labels/tones, action availability (status + permission + write environment), reverification capability gate, href builder, stable error copy                                                    |
| `member-ops-states.tsx`                                                                | list skeleton, status badge, suspended/closed notice, unavailable-owner-capability action state                                                                                                                                 |
| `member-list-page.tsx`                                                                 | list: search (Enter), status filter, refresh, paging, masked rows, loading/empty/error/denied/conflict states                                                                                                                   |
| `member-detail-page.tsx`                                                               | detail: masked profile summary, status + history table, action forms (reason + idempotency key; CONFIRM gate for close; reused key on retry, new key after success), notes create + list, feedback alerts, read-only-PWA gating |
| `admin-app.tsx`                                                                        | append-only route wiring: `members` → `MemberListPage`, `member-detail` → `MemberDetailPage` (two new cases at the END of the switch; no existing case reordered)                                                               |
| `admin.css`                                                                            | member-ops styles on design tokens only (appended section)                                                                                                                                                                      |
| `test/member-ops-fixtures.ts`, `test/member-ops-mock.ts`                               | shared fixtures + shell/member-ops fetch mock                                                                                                                                                                                   |
| `member-ops-model.test.ts`, `member-list-page.test.tsx`, `member-detail-page.test.tsx` | 26 new model/component tests incl. axe                                                                                                                                                                                          |

Required UI states covered and tested: permission-denied, suspended/closed
member display, conflict/stale (market mismatch + status conflict), offline
(environment gating), unavailable owner capability (permission/status/PWA
gates), loading, empty, error with retry, success with server-confirmed
message. Member detail carries no wallet/ledger/balance field (asserted in
tests).

## 7. Typed client (`packages/api-client/src/index.ts`)

Self-contained append-only section at the end of the file:
`AdminMemberOpsListQuery`, `AdminMemberOpsListItemDto`,
`AdminMemberOpsListPageDto`, `AdminMemberOpsProfileDto`,
`AdminMemberOpsNoteDto`, `AdminMemberOpsNotesPageDto`,
`AdminMemberOpsReasonRequest`, `AdminMemberOpsCloseRequest`,
`AdminMemberOpsNoteCreateRequest`, plus `AdminApiClient` methods
`memberOpsList`, `memberOpsDetail`, `memberOpsSuspend`, `memberOpsReactivate`,
`memberOpsClose`, `memberOpsRevokeSessions`,
`memberOpsRequireReverification`, `memberOpsAddNote`, `memberOpsNotes`.
No market id is ever sent by the client. A parallel P7-S5B section may be
appended after this one without conflict (tests appended in
`packages/api-client/src/index.test.ts` as a delimited block).

## 8. Tests and verification (exact commands, inside worktree)

Environment: Linux sandbox; worktree `/workspace/.local/wt-p7-s5a` (root
`/workspace/node_modules` symlinks are broken, so everything ran inside the
worktree). Dedicated test database `ipoint_p7s5a_test` at
`172.23.0.3:5432` (dropped/recreated before each integration run — the
suite asserts exact row counts and requires a clean schema; procedure:
recreate DB, then run once).

| Command                                                                                                                                              | Result                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @ipoint/api typecheck`                                                                                                                | PASS, exit 0                                                                                                                    |
| `DATABASE_URL=postgres://ipoint:ipoint-local-only@172.23.0.3:5432/ipoint_p7s5a_test pnpm --filter @ipoint/api exec vitest run src/admin-member-ops/` | **42/42 passed** (18 unit + 24 real-DB integration), exit 0                                                                     |
| `pnpm --filter @ipoint/admin-web typecheck`                                                                                                          | PASS, exit 0                                                                                                                    |
| `pnpm --filter @ipoint/admin-web test`                                                                                                               | **87/87 passed** (11 files; 60 pre-existing + 27 new incl. axe), exit 0                                                         |
| `pnpm --filter @ipoint/admin-web build`                                                                                                              | PASS; **1614 modules transformed**, exit 0                                                                                      |
| `pnpm --filter @ipoint/api-client typecheck`                                                                                                         | PASS, exit 0                                                                                                                    |
| `pnpm --filter @ipoint/api-client test`                                                                                                              | **32/32 passed** (27 pre-existing + 5 new), exit 0                                                                              |
| `pnpm exec prettier --check` on all changed paths                                                                                                    | clean                                                                                                                           |
| `pnpm exec eslint apps/api/src/admin-member-ops apps/api/src/app.module.ts`                                                                          | clean, exit 0                                                                                                                   |
| `pnpm exec eslint packages/api-client/src/index.ts packages/api-client/src/index.test.ts`                                                            | clean, exit 0                                                                                                                   |
| `pnpm exec eslint apps/admin-web/src/member-list-page.tsx`                                                                                           | file ignored by pre-existing repo eslint ignore pattern (`apps/admin-web/src/**` excluded by design — same as P7-S4B); 0 errors |
| axe (component-level, jsdom)                                                                                                                         | zero serious/critical on loaded member list and detail paths                                                                    |

Coverage delivered (mapped to P7-S0 §17): market isolation server-side
(list/detail/notes/writes across two markets with two grants), permission
denial (401/403/guard + crafted-request negative tests), masking
(email/name/phone/identification exact owner masks; birth date/address
nulled), status-transition flows (suspend/reactivate/close + invalid
transition + close confirmation), session revocation, reverification
(approved-only), notes (create/list/empty/validation/market-scope),
audit-of-view evidence (`member.ops.view` row asserted in the DB), no
wallet/ledger exposure, idempotency replay, and the required UI states with
axe coverage.

### Browser limitation (exact, unchanged from P7-S4B)

Browsers cannot launch in this sandbox (Chromium was registered previously
but the image lacks browser runtime libraries — `libglib-2.0`, `libnss3`,
`libX11`, `libxcb` missing under `/usr/lib` — and apt package lists are on a
read-only filesystem). Accessibility of the covered paths is therefore
verified with jsdom `axe-core` runs in `member-list-page.test.tsx` and
`member-detail-page.test.tsx` (zero serious/critical). No browser run is
claimed as passed.

## 9. Risks and limitations

- `memberOpsClose` / empty notes return 400 (strict owner schema at the pipe)
  rather than the owner's service-level 409 codes
  (`ADMIN_MEMBER_CLOSE_CONFIRMATION_REQUIRED` / `ADMIN_MEMBER_NOTE_EMPTY`);
  this is identical to the frozen owner routes and is documented in the
  integration spec (service-level guards remain as defense-in-depth).
- Audit-of-view is written for member detail views only; the bounded
  masked-summary list matches the owner's list behaviour (no view audit),
  consistent with P7-S4B's dashboard read models.
- The integration suite requires a freshly recreated dedicated database
  (exact-count assertions); the recreate-then-run procedure is in §8.
- Root e2e (`playwright.admin.config.ts`, `tests/e2e/admin-shell.spec.ts`)
  remain out of allowed paths; browser execution requires the host/CI
  (pre-existing limitation, unchanged).
- `jiti/` tooling cache left untracked (same pattern as P7-S4A/S4B).

## 10. Git state

- Worktree: `/workspace/.local/wt-p7-s5a` (branch `task/p7-s5a-member-ops`).
- Starting SHA: `c6e530bfe3ce3548950dd1c1667163d582303585`.
- Commits: 2 (code, then report). No amend, no rebase, no force, NO PUSH.
- Exact-path staging only; the 102 historical untracked artifacts in the
  main checkout were untouched; `jiti/` left untracked.

## 11. Internal gate result

`OPENCLAW_INTERNAL_GATE_PASSED` — API/adapter unit + real-DB integration
42/42, Admin Web 87/87 + build 1614 modules, API client 32/32, all
typechecks, prettier, and eslint (API + client) green; axe zero
serious/critical on covered paths; frozen Phase 2 owner code byte-identical;
commits scoped exactly; nothing pushed.
