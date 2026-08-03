# P7-S0C Admin Web, Authentication, RBAC and Market Context Audit

## 1. Audit metadata

| Field             | Value                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase / task      | Phase 7 planning audit / P7-S0C                                                                                                                                                                                     |
| Scope             | Documentation-only audit of Admin Web, shared frontend packages, authentication, RBAC and multi-market admin context                                                                                                |
| Branch            | `task/p7-s0c-admin-web-rbac-market`                                                                                                                                                                                 |
| Base SHA          | `99c35c7c5581747a8eb8b9e6600b4489691c4fa0`                                                                                                                                                                          |
| Audit date        | 2026-08-01 (Asia/Kuala_Lumpur)                                                                                                                                                                                      |
| Worker            | `/root` — Codex CLI worker                                                                                                                                                                                          |
| Repository        | `https://github.com/bryangeh79/ipoint.git`                                                                                                                                                                          |
| Worktree          | `C:\AI_WORKSPACE\wt-p7-s0c`                                                                                                                                                                                         |
| Change boundary   | This report only. No production code, schema, migration, test, CI workflow, frozen Phase 3–6 code, `DECISION_LOG.md`, or `PHASE_REGISTRY.md` was modified.                                                          |
| Authority posture | Bryan's P7-S0C documentation dispatch authorizes this audit only. `PHASE_REGISTRY.md` still records Phase 7 as `NOT_AUTHORIZED`; therefore every proposal below is non-binding and cannot authorize implementation. |
| Cross-reference   | P7-S0A and P7-S0B were read from their sibling worktrees because they were not present at this base in the P7-S0C worktree.                                                                                         |

## 2. Admin UI state findings (Section A)

### 2.1 Application existence and package boundaries

- `apps/admin-web` **exists** and is the current Admin frontend.
- `apps/admin` **does not exist** at the audited base.
- Other application shells that do exist are `apps/member-web`, `apps/merchant-web`, and `apps/api`.
- `apps/admin-web/package.json` declares React 19 and Vite 7 and directly consumes:
  - `@ipoint/ui` from `packages/ui`;
  - `@ipoint/design-tokens` from `packages/design-tokens`;
  - `@ipoint/api-client` from `packages/api-client`.
- It does **not** consume `@ipoint/types`. Admin page data is represented mainly as local `JsonRecord` values, while `AdminContext` and presentation models are defined locally in `apps/admin-web/src/admin-app.tsx` and `apps/admin-web/src/admin-model.ts`. This makes current Admin API typing shallow and permits casing fallbacks such as `branchId ?? branch_id`.

### 2.2 App shell, routes, layout and navigation

| Finding           | Actual behavior observed                                                                                                                                                                                                                                                            | Evidence                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Shell             | `AdminApp` renders shared `AppShell`, `TopBar`, `SideNavigation`, `PageHeader`, cards, tables, tabs, inputs, alerts, skeletons and empty states.                                                                                                                                    | `apps/admin-web/src/admin-app.tsx`; `packages/ui/src/navigation.tsx`; `packages/ui/src/components.tsx`        |
| Navigation model  | Six in-memory pages exist: Overview, Merchants, Reviews, Packages, MCP and Audit. Clicking a shared navigation link calls `setPage`.                                                                                                                                                | `apps/admin-web/src/admin-app.tsx`                                                                            |
| Routing           | There is no React Router dependency or route tree. Hash values are added as `href="#..."`, but initial state is always `overview` and no `hashchange` handler restores/deep-links page state. Browser refresh/back/forward are therefore not a reliable application route contract. | `apps/admin-web/package.json`; `apps/admin-web/src/admin-app.tsx`                                             |
| Desktop layout    | Shared shell supplies fixed top bar, side navigation and semantic main content. Admin CSS adds responsive metric, two-column, review and adjustment grids.                                                                                                                          | `packages/ui/src/navigation.tsx`; `packages/ui/src/styles.css`; `apps/admin-web/src/admin.css`                |
| Mobile navigation | At widths below 768 px the shared CSS hides a direct child side navigation. Admin Web does not pass `TopBar.onMenuClick`, a drawer, or `bottomNavigation`, so its six-page navigation disappears on mobile. Content grids collapse, but navigation is not PWA-ready.                | `apps/admin-web/src/admin-app.tsx`; `packages/ui/src/styles.css`; compare `packages/ui/src/product-shell.tsx` |
| Global actions    | Top bar only shows `Live API` or `Sign in`. There is no logout, session/device, user menu, role display, current-market switcher or accessible-market selector.                                                                                                                     | `apps/admin-web/src/admin-app.tsx`                                                                            |

### 2.3 Authentication pages, session handling and protected behavior

1. The only Admin auth page is an inline login form. It asks for email, password, a free-form Market UUID and optional Branch/MCP Account UUIDs.
2. Login calls the shared `POST /auth/login` through `ApiClient.login`. There is no `/admin/auth/*` contract.
3. The UI considers the workspace protected only when both `api.tokens` and local `AdminContext` exist. This is a component conditional, not a route guard.
4. Access and refresh tokens are held in memory by `@ipoint/api-client`; the deprecated constructor storage key is ignored. A reload clears token state and returns the user to the login form.
5. Although `ApiClient.attemptSessionRestore()` exists, Admin Web never calls it. With the current body-based refresh-token contract, a cold reload has no in-memory refresh token anyway.
6. A 401 triggers a single-flight refresh and exactly one retry. Failed refresh clears the in-memory session and dispatches `ipoint:session-expired`; Admin Web shows an expiry alert. It does not navigate to a dedicated login route because no route system exists.
7. Admin Web listens for `ipoint:session-changed`, but the shared client dispatches `ipoint:session-restored` and `ipoint:session-expired`; no audited source dispatches `ipoint:session-changed`. Login still rerenders because `onContext` changes state, but the event contract is inconsistent.
8. There is no logout control, forgot-password page, reset-password page, MFA page, session list, device list, or forced reauthentication/step-up screen.

Evidence: `apps/admin-web/src/admin-app.tsx`; `packages/api-client/src/index.ts`; `packages/api-client/src/index.test.ts`; `apps/api/src/auth/auth.controller.ts`; `apps/api/src/auth/auth.service.ts`; `apps/api/src/auth/postgres-auth.store.ts`.

### 2.4 Dashboard and current operational screens

| Screen    | Actual behavior                                                                                                                                     | Important limitation                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview  | Requests `/admin/markets/:marketId/merchants?limit=20` and derives merchant, active and pending counts in the browser.                              | These are counts from at most 20 returned merchant rows, not reliable market or platform totals. There is no dashboard aggregate endpoint or as-of timestamp. |
| Merchants | Market-scoped list/search; selects branch/account context; submits suspend/reactivate commands with idempotency keys.                               | Search is request-driven without debounce/cancel. Permission-aware action hiding is absent; the server remains authoritative.                                 |
| Reviews   | Loads merchant application and KYC queues; supports approve actions across tabs.                                                                    | Only an approve button is exposed; reject/evidence workflows and member KYC are absent.                                                                       |
| Packages  | Creates package profiles/versions/special percentages, activates versions, assigns packages and sets defaults.                                      | Forms accept raw IDs and raw strings. There is no typed catalog picker, permission-aware display or review confirmation.                                      |
| MCP       | Displays one MCP account and ledger; creates/reviews recharge/refund requests; exposes manual MCP Maker/Checker submission, approval and execution. | Context depends on raw IDs. Role separation is not represented in the UI; server identity checks are the essential control.                                   |
| Audit     | Requests merchant-branch audit logs and entity timeline for a typed entity ID.                                                                      | No general filter/pagination/export UI, and the screen itself does not select an explicit market even though the description says market-access filtered.     |

No Admin Web pages exist for admin-user lifecycle, role/permission management, market grants, member management, member KYC, agent operations, iPoint wallet Maker/Checker, transactions, rewards/jobs, commissions, redemption, reports/exports, notifications, or risk operations.

### 2.5 Shared Design System usage

- Tokens come from `@ipoint/design-tokens/base.css`, imported in `apps/admin-web/src/main.tsx`. The authoritative package is `packages/design-tokens`, not local hard-coded Admin CSS.
- Shared components come from `@ipoint/ui` in `packages/ui`. Admin-specific CSS mostly composes the token variables for layout and does not establish a second token system.
- The manifest repeats the approved green/white theme as metadata, but visual component styling still comes from the shared packages.
- Shared foundation accessibility evidence includes labelled inputs, keyboard-operable tabs/switches, dialog focus management, semantic shell/main navigation, focus styles, reduced-motion handling and an axe check in `packages/ui/src/components.test.tsx`.
- Admin-specific gaps remain: no Admin page axe run, no Admin keyboard navigation suite, no permission announcement/focus recovery validation after async errors, and mobile navigation is unavailable as described above.

### 2.6 API client integration and UI states

| Area             | Current state                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API base         | `VITE_API_BASE_URL`, falling back to `/api/v1`.                                                                                                                                                                      |
| Authentication   | Bearer token in memory; shared login; refresh token rotation; one retry after 401.                                                                                                                                   |
| Market transport | Admin Web embeds `marketId` in route paths. It does not pass the `ApiClient` `marketId` option, so `x-market-id` is not used by these screens.                                                                       |
| Write safety     | Admin forms generate UUID idempotency keys for writes.                                                                                                                                                               |
| Error handling   | `describeApiError` maps network, 401, generic 403, market 403, validation and other failures to user-facing states. Request IDs are parsed by the client but are not visibly rendered in the Admin error UI.         |
| Loading          | Resource screens show shared skeletons. Forms disable the submit button and show `Working…`.                                                                                                                         |
| Empty            | Generic resource empty state and a dedicated empty review queue are present.                                                                                                                                         |
| Success          | Inline success alerts render status messages or raw JSON results.                                                                                                                                                    |
| Offline/retry    | Runtime network failures map to an offline error with retry. Query-string forced states also exist for deterministic visual inspection. There is no service-worker-backed offline shell or queued privileged action. |
| Cancellation     | `useResource` prevents stale state writes after unmount but does not abort the underlying fetch.                                                                                                                     |
| Shared types     | Admin Web does not import `@ipoint/types`; endpoint DTOs remain `JsonRecord`/ad hoc local types.                                                                                                                     |

### 2.7 PWA readiness

`apps/admin-web/public/manifest.webmanifest` and the manifest/theme-color links in `apps/admin-web/index.html` provide install metadata (`display: standalone`). However:

- no service worker, Workbox integration, install flow, cache policy or offline navigation shell was found;
- mobile navigation disappears because no drawer/bottom navigation is wired;
- no icons or screenshots are declared in the manifest;
- privileged writes must never be silently queued/replayed offline;
- O-09 remains OPEN, so which Admin approvals are allowed in a PWA is not decided.

Result: **PARTIAL manifest-level readiness only**, not an operational Admin PWA.

### 2.8 Test coverage

| Exact test file                                                                                                            | Classification                                                                                                             | What it proves                                                                                                                                                                                                                                                             | Limitation                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/admin-web/src/admin-model.test.ts`                                                                                   | Pure model/unit; 3 tests                                                                                                   | Merchant filtering, a presentation-level Maker/Checker predicate, and KYC diff calculation.                                                                                                                                                                                | No DOM, component, API, accessibility or routing behavior. The Maker/Checker helper is not imported by `admin-app.tsx`, so it is not UI enforcement.                                                                                                                                                               |
| `tests/e2e/merchant-admin.spec.ts`                                                                                         | Real Playwright browser + live Nest API + PostgreSQL E2E; 3 top-level scenarios, of which the first two exercise Admin Web | Merchant/Admin lifecycle; merchant/KYC approval; package/version assignment; MCP recharge; merchant suspend/reactivate; self-approval failure; second-admin approval/execution; refund review; audit display; market denial; idempotency mismatch; unauthenticated denial. | Broad serial fixture using `SUPER_ADMIN`; it does not prove least-privilege roles, Admin MFA/password reset, component accessibility, mobile navigation, deep links, service worker/offline behavior, or multi-market switching. The third scenario is Merchant Web static-state coverage, not Admin Web coverage. |
| `packages/api-client/src/index.test.ts`                                                                                    | Shared client unit tests with mocked `fetch`                                                                               | In-memory tokens, header/idempotency behavior, refresh, expiry and network/timeout mapping.                                                                                                                                                                                | Mock-only; not an Admin component or E2E test.                                                                                                                                                                                                                                                                     |
| `packages/ui/src/components.test.tsx`                                                                                      | Shared component DOM/unit + axe                                                                                            | Shared semantic and accessibility foundation.                                                                                                                                                                                                                              | Does not render `AdminApp`.                                                                                                                                                                                                                                                                                        |
| `apps/api/src/auth/*.spec.ts` and `apps/api/src/auth/*.integration.spec.ts`                                                | Backend unit/mock plus real HTTP/DB auth suites                                                                            | Credential, OTP, password reset, session rotation/revocation and rate-limit contracts.                                                                                                                                                                                     | Not Admin-specific MFA/device/session UI coverage.                                                                                                                                                                                                                                                                 |
| `apps/api/src/platform-access/platform-access.spec.ts`; `apps/api/src/platform-access/platform-access.integration.spec.ts` | Platform access unit/static plus PostgreSQL integration                                                                    | Permission/market access primitives and audited grants.                                                                                                                                                                                                                    | No RBAC administration HTTP/UI surface.                                                                                                                                                                                                                                                                            |

There are **no Admin Web component spec files** and **no Admin-specific visual/accessibility spec**.

## 3. Authentication contract matrix (Section B)

Status evaluates the end-to-end Admin capability at this base, not the existence of a reusable primitive.

| Contract item                  | Status      | Evidence and assessment                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin-only identity separation | **PARTIAL** | `admin_users` is a one-to-one extension of `accounts`; `resolveActor` emits `ADMIN_USER` when that row exists; `AdminGuard`/`RbacGuard` distinguish Admin actors. Login is still the shared `/auth/login`, does not prove Admin eligibility at login, and a single account model is shared rather than a separately authenticated Admin realm.                         |
| Session expiry                 | **PARTIAL** | Access and refresh expiry are persisted; `resolveActor` checks access expiry; refresh rotation and client 401 retry exist. Admin Web has no cold restore, idle-timeout UX or expiry countdown and only shows an inline alert on failed refresh.                                                                                                                        |
| Session revocation             | **PARTIAL** | Current-session logout, refresh-family reuse revocation and password-reset revocation of all account sessions exist. There is no Admin session list, Admin “revoke all”, forced revocation API/UI, or device-level control.                                                                                                                                            |
| Password reset                 | **PARTIAL** | Generic `/auth/password-reset/{initiate,verify,complete}` works at account level, rate-limits requests, revokes sessions and records evidence. The implementation/audit naming is member-oriented and Admin Web exposes no reset flow.                                                                                                                                 |
| MFA / 2FA                      | **MISSING** | `otps` reserves `STEP_UP`, but no factor enrollment/binding, login challenge, recovery code, trusted-device, disable/recovery policy or Admin MFA UI/API exists. Generic OTP is not MFA evidence. This conflicts with the baseline expectation that Super Admin has mandatory 2FA.                                                                                     |
| Failed-login controls          | **PARTIAL** | Composite email/IP rate limiting and `AUTH_LOGIN_FAILED` security events exist. No persistent per-account failed-attempt counter, timed lock, progressive challenge, unlock workflow or Admin security console was evidenced. The current in-memory limiter is not a multi-instance production control.                                                                |
| Account suspension             | **PARTIAL** | `accounts.status != ACTIVE` blocks login/session resolution. `admin_users.status` supports `SUSPENDED`, and `RbacService` requires active Admin and account status. However shared login and `AdminGuard` do not check `admin_users.status`; no Admin lifecycle API/UI exists, so identity-only Admin endpoints may not receive the same protection as RBAC endpoints. |
| Last-login visibility          | **MISSING** | Sessions store `created_at`, `last_seen_at`, IP and user agent, but no `last_login_at` contract, Admin query or UI was found; `last_seen_at` is not evidenced as an actively updated visibility feature.                                                                                                                                                               |
| Security audit events          | **PARTIAL** | `security_events` records login success/failure, refresh and logout activity; `audit_logs` records many privileged domain actions. There is no Admin security-event viewer/export, and several auth events lack a complete privileged actor/resource/reason shape.                                                                                                     |
| Device/session management      | **MISSING** | Session rows contain IP/user agent and token-family data, but there is no Admin device/session listing, naming, current-device marker, per-device revoke, trusted-device policy or UI.                                                                                                                                                                                 |

Authentication conclusion: reuse the existing shared credential/session engine; do not create a parallel token system. Before sensitive Phase 7 use, an authorized Admin auth contract must close Admin eligibility/status enforcement, mandatory MFA, session/device management and complete audit gaps.

## 4. Proposed simplified RBAC model (Section C)

### 4.1 Current repository model

The data model already matches the locked three dimensions:

1. **Role** — `roles`, `role_assignments`, `role_permissions`;
2. **Market Access** — zero-to-many active `market_access` rows per Admin;
3. **Action Permission** — server-owned strings in `permissions`, enforced by `RbacGuard`/`RbacService` where wired.

There is no department table or department hierarchy, and none is needed for the Phase 7 MVP.

Only two roles are seeded: `SUPER_ADMIN` and `VIEWER`. The baseline's suggested Admin, Finance and Customer Service roles are not seeded. The seed grants all permissions to Super Admin and grants Viewer only codes ending in `.view`; this suffix heuristic omits read permissions such as `member.read` and would omit `.read` codes.

### 4.2 Smallest viable proposed roles — evaluation only

| Proposed role                                                                                      | Business purpose                                         | Permitted operations (draft)                                                                                                                                               | Explicitly prohibited                                                                                                         | Market scope                                                                                                  | Maker/Checker compatibility                                                                                           | Least-privilege risks                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Super Admin** (`SUPER_ADMIN`, existing)                                                          | Emergency platform governance and access administration  | Full approved permission catalog; Admin lifecycle; roles; market grants; market registry; audited break-glass operations                                                   | No same-person Maker/Checker bypass; no unaudited direct DB edits; no invented OPEN behavior                                  | Explicit assigned markets for market data; truly global identity/config reads only where contract says global | May hold both permission families, but runtime must still reject same actor. Mandatory 2FA and very small membership. | Current “all seeded permissions” expands automatically when seed grows; requires controlled catalog review and break-glass monitoring.                                                                                                      |
| **Operations Admin** (`OPERATIONS_ADMIN`, new)                                                     | Daily member, merchant and fulfilment operations         | Member/merchant reads and lifecycle commands; notes; merchant application operations; non-financial catalog/fulfilment commands; operational audit read                    | RBAC/market grants; commercial rate changes; manual MCP/iPoint adjustments; commission adjustments; voucher reveal by default | One or more explicitly granted markets                                                                        | Neither financial Maker nor Checker by default                                                                        | Existing broad codes can combine multiple actions; permissions must be reviewed route by route.                                                                                                                                             |
| **Finance Operator** (`FINANCE_OPERATOR`, new)                                                     | Prepare/reconcile money and point operations             | MCP/wallet/commission read; reconciliation; create/submit manual MCP/iPoint adjustment as Maker; prepare permitted finance requests                                        | Approve or execute own request; RBAC; KYC decisions; system settings                                                          | Explicit assigned markets; every request targets one market                                                   | **Maker** role. Must not receive checker permission.                                                                  | Existing recharge/refund permission codes combine create/review semantics; permission splitting is required before claiming clean segregation.                                                                                              |
| **Finance Approver** (`FINANCE_APPROVER`, new)                                                     | Independently check and authorize sensitive finance work | Read finance evidence; approve/reject manual MCP/iPoint adjustments; execute only where frozen command permits; domain-specific redemption-refund checker only under D-043 | Create the request it checks; RBAC; KYC; unrelated operations                                                                 | Explicit assigned markets; target market always explicit                                                      | **Checker** role. Runtime identity inequality remains mandatory; role separation alone is insufficient.               | Existing `merchant.mcp.adjust.execute` permits a non-maker executor and may be held by the checker; exact execution policy requires Command Center confirmation.                                                                            |
| **KYC Reviewer** (`KYC_REVIEWER`, new)                                                             | Review member and merchant KYC evidence                  | Member/merchant read, KYC queue/evidence read, KYC approve/reject/reverification commands, relevant audit read                                                             | Financial operations; RBAC; package/rate changes; unrelated status changes                                                    | Only assigned markets; retention/legal policy remains market-specific under O-08                              | Not a financial Maker/Checker role                                                                                    | `member.kyc.review` is used by code but absent from foundation seed; merchant permissions overlap and need reconciliation.                                                                                                                  |
| **Support / Read-only Auditor** (reuse existing `VIEWER` code; proposed display/policy refinement) | Customer support lookup and independent read-only audit  | Explicit allow-list of member/merchant/package/MCP/order/audit reads and note reads; no generic mutation                                                                   | Every write, reveal, export of unredacted sensitive data, RBAC and market management                                          | Only assigned markets; global registry read only if granted                                                   | Not compatible with Maker/Checker actions                                                                             | Current `.view` suffix grant is incomplete and can be misleading; use an explicit read-only allow-list. Combining support notes with independent audit may later warrant two roles, but splitting now is not required for the smallest MVP. |

This six-role proposal deliberately reuses `VIEWER` instead of adding both `SUPPORT` and `AUDITOR`. If operational support later needs note creation while auditors must remain strictly read-only, Command Center should split them in a later reviewed change.

### 4.3 Current permission comparison

| Area            | Seeded permission evidence                                                                                                                            | Controller/service usage                                                                                            | Conflict, duplicate or gap                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform        | `market.view`, `market.manage`, `rbac.view`, `rbac.manage`, `audit.view`                                                                              | RBAC and access services exist; only audit has an HTTP controller.                                                  | No Admin-user/role/permission/market-grant management API. `audit.view` is not market-scoped in the decorator and depends on service filtering.                                                                  |
| Member          | `member.read`, `member.status.manage`, `member.session.revoke`, `member.reverification.require`, `member.note.read`, `member.note.create`             | Admin member controller uses these exact codes.                                                                     | Viewer suffix seeding omits `member.read` and both `.read` note patterns.                                                                                                                                        |
| Member KYC      | No `member.kyc.review` seed                                                                                                                           | Admin KYC controller requires `member.kyc.review`.                                                                  | **Missing code in standard seed**; endpoint cannot be assumed grantable.                                                                                                                                         |
| Merchant review | `merchant.view`, `merchant.approve`, `merchant.kyc.view`, `merchant.kyc.approve`, `merchant.suspend`, `merchant.close`, `merchant.referral.correct`   | Merchant controller uses view, approve, KYC and status codes.                                                       | `merchant.approve` description says application and KYC while separate KYC permissions also exist: overlapping semantics. Referral correction remains governance-sensitive/open and must not be broadly granted. |
| Packages        | `merchant.package.view`, `.manage`, `.assign`                                                                                                         | Package controller uses `.manage` for create/version/activate/special/assignment/default actions.                   | Seeded `.assign` is not used for assignment routes; `.manage` is overly broad and duplicates intended separation.                                                                                                |
| MCP             | `merchant.mcp.view`, `.recharge.review`, `.refund.review`, `.adjust`, `.adjust.approve`, `.adjust.execute`, `.reverse`, plus `merchant.refund.manage` | MCP controller uses view, recharge review, adjust/approve/execute and `merchant.refund.manage`.                     | `merchant.mcp.refund.review` is seeded but audited routes use `merchant.refund.manage`; create/review semantics are combined. `.reverse` has no evidenced Admin UI route.                                        |
| Reward/iPoint   | No `reward.rule.read/create`, `reward.job.read`, or `wallet.adjustment.create` seed                                                                   | Admin reward controller requires those codes.                                                                       | **Missing seed codes**. The one-step iPoint adjustment path is not Maker/Checker compliant and must not be exposed.                                                                                              |
| Agent           | No `agent.activation.manage` seed                                                                                                                     | Admin agent activation controller requires it.                                                                      | **Missing seed code**; market-scoping is also incomplete in the inherited adapter.                                                                                                                               |
| Commission      | No `commission.rate.read`, `.rate.manage`, `commission.admin`, `commission.adjustment.maker`, `.checker` seeds                                        | Phase 5 Admin controllers require them.                                                                             | **Missing seed codes** and some inherited endpoints are not market-scoped. Frozen Phase 5 ownership applies.                                                                                                     |
| Redemption      | Catalog, rate, inventory, pickup, order, fulfilment, refund maker/checker, voucher reveal and audit codes are seeded.                                 | Some catalog/rate source controllers are unreachable; refund/fulfilment controllers use identity-only Admin guards. | Permission presence does not prove reachability or enforcement. `redemption.refund.maker/checker` is a D-043 frozen domain-specific dual-approval exception, not permission to add Maker/Checker elsewhere.      |

### 4.4 RBAC proposal rules

1. Permission codes remain server-owned constants/catalog entries; the UI never invents or trusts a role name.
2. Every protected route requires authenticated Admin identity plus action permission; every market-scoped route also requires a current active `market_access` grant.
3. UI hiding/disabling is usability only. A crafted request must still be denied by the server.
4. Manual MCP and iPoint adjustments require distinct Maker and Checker identities. D-043's redemption-refund Maker/Checker remains a frozen domain-specific rule. No other Phase 7 operation gains dual approval by implication.
5. The proposed role matrix is an assignment template, not a substitute for per-action server checks.
6. System roles must not be silently archived or mutated through generic CRUD. Any custom-role support is deferred until explicitly authorized.

## 5. Multi-market Admin context findings and proposal (Section D)

### 5.1 Current findings

| Question                                | Repository-backed answer                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How is Admin market access stored?      | `market_access` stores `admin_user_id`, `market_id`, grant actor/time and `revoked_at`. A partial unique index permits one active grant per Admin/market pair. Evidence: migration `0000_database_foundation.sql`, schema `packages/database/schema/index.ts`.                                                                                                                                             |
| May one Admin access multiple markets?  | **Yes.** The primary key is per grant and uniqueness is on the Admin/market pair, not on Admin alone. Multiple active rows for different markets are supported.                                                                                                                                                                                                                                            |
| How is Current Admin Market stored now? | It is not a server-side Admin preference. Admin Web accepts a free-form Market ID during login and stores `{marketId, branchId?, accountId?}` in `localStorage` under `ipoint.admin.context`.                                                                                                                                                                                                              |
| How is context selected now?            | Login-form text input only. There is no API-backed list of accessible markets, selector, switcher, default market, URL route contract or validated saved preference.                                                                                                                                                                                                                                       |
| How is it sent?                         | Current Admin screens primarily embed it as `/admin/markets/:marketId/...`. The shared client can send `x-market-id`, but these screens do not use that option.                                                                                                                                                                                                                                            |
| How does the server enforce it?         | Where `@RequirePermission(..., { marketScoped: true })` is used, `RbacGuard` resolves route `:marketId` first and falls back to `x-market-id`, then checks active role permission and active market grant. Some services also apply market predicates. Enforcement is inconsistent across inherited Admin endpoints; Phase 5 and some Phase 6 identity-only routes do not establish equivalent protection. |
| Are switches audited?                   | **No.** Grant/revoke operations are audited by `AccessAdministrationService`, but changing `ipoint.admin.context` only writes browser local storage and emits no server audit event.                                                                                                                                                                                                                       |

The UI must never be the only market-access enforcement layer. A locally stored or client-supplied Market ID is context, not authorization.

### 5.2 Smallest viable Phase 7 proposal — evaluation only

1. After Admin authentication and required MFA, load a server-authorized list of active markets for the Admin. Do not accept an arbitrary text UUID as the primary selector.
2. Select one **Current Admin Market** for ordinary pages. Put the selected market in a stable route or request context, but revalidate the grant on every server request.
3. Do not persist authorization in local storage. A local last-selection hint may be used only after the server revalidates it.
4. Prefer explicit `:marketId` route parameters for mutations and market-owned resources. `x-market-id` may be used for approved query endpoints, but must be resolved and validated by the same server-side policy.
5. A **Global View is not necessary for MVP**. The smallest safe MVP is one active market context at a time. Super Admin can switch among granted markets.
6. If Command Center later authorizes a read-only Global View, it must be a distinct permission and server aggregate—not a browser loop over market APIs.
7. Cross-market counts may show a total plus a per-market breakdown and an as-of timestamp. Monetary, MCP, iPoint, wallet, commission and redemption values must remain grouped by market and currency; do not add unlike currencies or market wallets into one financial total. If conversion is ever needed, it requires an authorized FX/as-of contract.
8. Always require an explicit target market for writes; commercial/rule changes; KYC decisions; member/merchant/agent status changes; manual MCP/iPoint operations; refunds/reversals; commission/redemption actions; job controls; voucher reveal; exports; and any sensitive audit lookup.
9. Record successful and denied market-switch attempts as security/audit evidence with Admin ID, from/to market, time, request ID, IP/device metadata and result. The audit event confirms context activity; it does not grant access.
10. If a grant is revoked while a session is active, the next request must fail server-side even if the browser still displays the old selection. The UI should then clear the invalid selection and require a newly validated market.

### 5.3 Server enforcement target

```text
Authenticated Admin session
        + active Admin/account status
        + action permission
        + explicit target market
        + active market_access grant
        + owning-domain validation/audit/idempotency
        = permitted operation
```

No UI state, role label, hidden button, URL, header or local-storage value may bypass any term in that equation.

## 6. DRAFT role/permission matrix

Legend: `R` read; `M` manage/command; `MK` adjustment Maker; `CK` adjustment Checker; `—` prohibited by default; `*` requires code/catalog reconciliation or a separately safe/reachable owner contract.

| Permission family / operation                       |                                  Super Admin |                  Operations Admin |                   Finance Operator |                   Finance Approver |        KYC Reviewer | Support / Read-only Auditor (`VIEWER`) |
| --------------------------------------------------- | -------------------------------------------: | --------------------------------: | ---------------------------------: | ---------------------------------: | ------------------: | -------------------------------------: |
| Admin users, roles, role permissions, market grants |                                            M |                                 — |                                  — |                                  — |                   — |                                      — |
| Market registry                                     |                                            M |                                 R |                                  R |                                  R |                   R |                                      R |
| Member lookup                                       |                                          R/M |                               R/M |                                  R |                                  R |                   R |                                      R |
| Member status/session/reverification                |                                            M |                                 M |                                  — |                                  — | Reverification only |                                      — |
| Member notes                                        |                                          R/M |                               R/M |                                  R |                                  R |                   R |                                 R only |
| Member KYC (`member.kyc.review`)\*                  |                                            M |                                 — |                                  — |                                  — |                   M |                             R/redacted |
| Merchant lookup/status                              |                                          R/M |                               R/M |                                  R |                                  R |                   R |                                      R |
| Merchant application/KYC                            |                                            M |                     M application |                                  — |                                  — |               M KYC |                             R/redacted |
| Package read                                        |                                          R/M |                               R/M |                                  R |                                  R |                   R |                                      R |
| Package/rate assignment                             |                                            M |      M within approved ops policy |                                  — |                                  — |                   — |                                      — |
| MCP account/ledger/reconciliation                   |                                          R/M |                                 R |                                  R |                                  R |                   — |                             R/redacted |
| MCP manual adjustment                               |         MK/CK subject to identity separation |                                 — |                                 MK |                                 CK |                   — |                                      — |
| iPoint wallet/ledger                                |                                        R/M\* |                                 R |                                  R |                                  R |                   — |                             R/redacted |
| iPoint manual adjustment\*                          |        MK/CK only after compliant API exists |                                 — | MK only after compliant API exists | CK only after compliant API exists |                   — |                                      — |
| Agent activation\*                                  |                                            M |                               M\* |                                  — |                                  — |      KYC evidence R |                                      R |
| Commission read/reconciliation\*                    |                                          R/M |                                 R |                                  R |                                  R |                   — |                             R/redacted |
| Commission rate management\*                        |                                            M |                                 — |                                  — |      M only if separately assigned |                   — |                                      — |
| Commission manual adjustment\*                      |         MK/CK subject to identity separation |                                 — |                                 MK |                                 CK |                   — |                                      — |
| Redemption catalog/inventory/pickup\*               |                                            M |                                 M |                                  R |                                  R |                   — |                                      R |
| Redemption orders/fulfilment\*                      |                                            M |                                 M |                                  R |                                  R |                   — |                                      R |
| Redemption refund under D-043\*                     | Maker/Checker subject to identity separation | Maker only if explicitly assigned |                              Maker |                            Checker |                   — |                                      — |
| Voucher reveal\*                                    |                               M with step-up |                                 — |                                  — |         M with step-up if required |                   — |                                      — |
| Audit logs                                          |                      R/M export under policy |                     R operational |                          R finance |                          R finance |               R KYC |   R redacted; export denied by default |
| Cross-market Global View                            |              Separate future permission only |                                 — |                                  — |                                  — |                   — |                                      — |

This table is a DRAFT assignment proposal. It does not create permission codes, authorize unsafe or unreachable endpoints, or change frozen domain ownership.

## 7. Evidence index

### 7.1 Governance and cross-reference evidence

- `AGENTS.md`
- `docs/00-master/PROJECT_MASTER_CONTROL.md`
- `docs/00-master/DOCUMENT_AUTHORITY.md`
- `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md` — especially E-19 through E-23 and §8.11
- `docs/00-master/DECISION_LOG.md` — D-024 and D-028 through D-045
- `docs/00-master/PHASE_REGISTRY.md`
- `docs/00-master/OPEN_QUESTIONS.md` — O-09
- `docs/04-engineering/CODEX_WORKFLOW_RULES.md`
- `C:\AI_WORKSPACE\wt-p7-s0a\docs\06-phase-reports\p7-s0\P7-S0A_GOVERNANCE_AND_FROZEN_DOMAIN_AUDIT.md`
- `C:\AI_WORKSPACE\wt-p7-s0b\docs\06-phase-reports\p7-s0\P7-S0B_ADMIN_BACKEND_CAPABILITY_INVENTORY.md`

### 7.2 Admin Web and shared frontend evidence

- `apps/admin-web/package.json`
- `apps/admin-web/index.html`
- `apps/admin-web/public/manifest.webmanifest`
- `apps/admin-web/src/main.tsx`
- `apps/admin-web/src/admin-app.tsx`
- `apps/admin-web/src/admin.css`
- `apps/admin-web/src/admin-model.ts`
- `apps/admin-web/src/admin-model.test.ts`
- `apps/admin-web/vite.config.ts`
- `packages/api-client/src/index.ts`
- `packages/api-client/src/index.test.ts`
- `packages/ui/src/index.ts`
- `packages/ui/src/components.tsx`
- `packages/ui/src/components.test.tsx`
- `packages/ui/src/navigation.tsx`
- `packages/ui/src/product-shell.tsx`
- `packages/ui/src/styles.css`
- `packages/design-tokens/src/base.css`
- `packages/design-tokens/src/index.ts`
- `packages/types/src/index.ts`
- `vitest.workspace.ts`
- `playwright.config.ts`
- `scripts/run-e2e.mjs`
- `tests/e2e/merchant-admin.spec.ts`

### 7.3 Authentication, RBAC, market and audit evidence

- `packages/database/migrations/0000_database_foundation.sql`
- `packages/database/migrations/0001_auth_session_access_expiry.sql`
- `packages/database/migrations/0009_add_sessions_family_id_index.sql`
- `packages/database/schema/index.ts`
- `packages/database/seeds/foundation.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/postgres-auth.store.ts`
- `apps/api/src/auth/auth-store.port.ts`
- `apps/api/src/auth/auth.guard.ts`
- `apps/api/src/auth/admin.guard.ts`
- `apps/api/src/auth/auth.types.ts`
- `apps/api/src/auth/rate-limit.port.ts`
- `apps/api/src/platform-access/rbac.guard.ts`
- `apps/api/src/platform-access/rbac.service.ts`
- `apps/api/src/platform-access/access-administration.service.ts`
- `apps/api/src/platform-access/market.service.ts`
- `apps/api/src/platform-access/audit.controller.ts`
- `apps/api/src/platform-access/audit.service.ts`
- `apps/api/src/platform-access/platform-access.module.ts`
- `apps/api/src/platform-access/platform-access.spec.ts`
- `apps/api/src/platform-access/platform-access.integration.spec.ts`
- `apps/api/src/admin-member/admin-member.controller.ts`
- `apps/api/src/admin-member/admin-member.http.integration.spec.ts`
- `apps/api/src/admin-kyc/admin-kyc.controller.ts`
- `apps/api/src/admin-kyc/admin-kyc.http.integration.spec.ts`
- `apps/api/src/merchant/merchant.controller.ts`
- `apps/api/src/merchant/mcp.controller.ts`
- `apps/api/src/merchant/mcp.service.ts`
- `apps/api/src/merchant/package.controller.ts`
- `apps/api/src/admin-reward/admin-reward.controller.ts`
- `apps/api/src/controllers/admin-agent-activation.controller.ts`
- `apps/api/src/controllers/admin-commission.controller.ts`
- `apps/api/src/controllers/admin-rate.controller.ts`
- `apps/api/src/redemption/admin-redemption.controller.ts`
- `apps/api/src/redemption/redemption-admin-refund.controller.ts`
- `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`

## 8. Document status

**DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**

This audit records evidence at base SHA `99c35c7c5581747a8eb8b9e6600b4489691c4fa0`. It is not FINAL, ACCEPTED or FROZEN. It does not authorize production code, schema, migration, test, CI, route, permission, role, security policy, PWA approval, or Phase 3–6 frozen-domain changes.
