# P7-S0B Admin Backend Capability Inventory

> **Document status: DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**
>
> Documentation-only repository audit. This document does not authorize Phase 7 implementation or any modification of the Phase 3–6 frozen baselines.

## 1. Audit metadata

| Field | Value |
|---|---|
| Audit | P7-S0B — Admin Backend Capability Inventory |
| Repository | `bryangeh79/ipoint` |
| Worktree | `C:\AI_WORKSPACE\wt-p7-s0b` |
| Branch | `task/p7-s0b-admin-backend-inventory` |
| Base SHA | `99c35c7c5581747a8eb8b9e6600b4489691c4fa0` |
| Base commit | `docs(governance): close and freeze Phase 6 under D-045` |
| Date | 2026-08-01 (Asia/Kuala_Lumpur) |
| Worker | Codex CLI worker |
| Scope | Read-only inventory of `apps/api`, `packages/database`, `apps/admin-web`, shared packages, tests, migrations and OpenAPI machinery |
| `apps/admin` | Does not exist at the audited SHA |
| P7-S0A cross-reference | Read from commit `586c108d` on `task/p7-s0a-governance-frozen-audit`; the file is not present at the P7-S0B base SHA |

## 2. Method and evidence rules

1. Every finding was traced from route registration through guard, controller, service and database evidence. A controller class alone is not treated as an operational API.
2. `configureApplication()` sets the global prefix `/api/v1`. Paths below are runtime paths after applying that prefix. Controllers which incorrectly include `api/v1` therefore expose `/api/v1/api/v1/...`, not the intended `/api/v1/...`.
3. Runtime registration was checked in every Nest module. `AdminRedemptionController` and `AdminAdjustmentController` are declared in source but are not registered in their modules; their routes are classified as unreachable.
4. Permission strings were checked both at decorators and against `packages/database/seeds/foundation.ts`. A required string absent from the seed is not assumed grantable in a standard seeded deployment.
5. Market scope is recorded only when enforced server-side by route/header plus RBAC, or by a service/database predicate. A query/body market supplied by the client is not authorization.
6. Audit means a persisted audit/status-history event with actor/action/resource/reason where implemented. Logger messages and business rows alone are not privileged-action audit.
7. Test counts are counts of `it`/`test` declarations where determinable. Parameterized cases can execute more cases than the declaration count. “Real integration” means a real Nest HTTP or PostgreSQL boundary; mock/static tests are identified separately.
8. OpenAPI is generated at runtime; no generated OpenAPI JSON/YAML is committed. The runtime validator comprehensively checks only 23 auth paths. Most admin controllers have Swagger tags at best, and merchant/MCP/package controllers have no Swagger operation metadata.
9. Status vocabulary is restricted to `COMPLETE`, `PARTIAL`, `TEMPORARY`, `DUPLICATED`, `UNSAFE`, `MISSING`, and `OUT_OF_SCOPE`. A primary status is stated for each capability; additional risk is described separately.
10. Phase 3–6 code is frozen under D-029, D-038, D-042 and D-045. “Phase 7 action” means planning/remediation dependency, not authorization to change a frozen owner.

### 2.1 Cross-cutting test evidence

| Area | Evidence and declaration counts | Nature |
|---|---|---|
| Auth/session | `auth.service.spec.ts` 11; `auth.controller.spec.ts` 3; `auth.integration.spec.ts` 25; `auth.http.integration.spec.ts` 36; `auth.performance.spec.ts` 7 | First two mock/unit; integration suites exercise real DB/HTTP boundaries |
| Platform access | `platform-access.spec.ts` 3; `platform-access.integration.spec.ts` 4; `database.integration.test.ts` 22 | Unit/static plus PostgreSQL integration |
| Admin member | `admin-member.service.spec.ts` 12; `admin-member.http.integration.spec.ts` 14 | Mock service plus real HTTP/PostgreSQL |
| Admin member KYC | `admin-kyc.service.spec.ts` 17; `admin-kyc.http.integration.spec.ts` 12 | Mock service plus real HTTP/PostgreSQL |
| Merchant/Package/MCP | `merchant.service.spec.ts` 6; `merchant.integration.spec.ts` 10 declarations; DTO/guard/storage/masking 6 declarations | One broad real HTTP/PostgreSQL integration file plus unit tests |
| Wallet/reward/job | `wallet.service.spec.ts` 19; `admin-reward.service.spec.ts` 12; `reward.service.spec.ts` 33; `job.service.spec.ts` 14; `timezone.integration.spec.ts` 29 | Mostly mocks; timezone suite is real integration; no AdminReward HTTP suite |
| Transaction | `transaction-read.spec.ts` 29; `transaction-preview.integration.spec.ts` 41; `transaction-correction.acceptance.integration.spec.ts` 35; `transaction-hardening.spec.ts` 8 | Strong Phase 4 integration, but no admin transaction API |
| Agent/commission | dead duplicate activation service spec 38; commission unit/static 83; mock concurrency 16; B/C/D real integration 15/10/10 | Strong frozen-domain semantics; weak admin HTTP/routing/access evidence |
| Redemption | real `redemption-integration.spec.ts` 28 and `redemption-p6-atomicity.spec.ts` 17; other redemption suites 190 declarations, mostly mock/static/harness | Frozen domain well exercised, admin authorization and successful refund-wallet credit not proven |
| Admin web | `admin-model.test.ts` 3 | Model-only; no component, browser or E2E admin UI test |
| OpenAPI | `openapi-consistency.spec.ts` 8 top-level/generated declarations; `openapi-validate.ts` | Auth-specific metadata checks; general runtime schema/ref check, not admin authorization/coverage verification |

## 3. Capability inventory — all 38 items

### 1. Admin authentication endpoints

| Field | Evidence |
|---|---|
| Capability name | Admin authentication endpoints |
| Source phase | Phase 0 auth foundation; reused by Phase 7 |
| Repository path | `apps/api/src/auth/auth.controller.ts`; `apps/api/src/auth/auth.service.ts`; `apps/api/src/auth/postgres-auth.store.ts`; `apps/api/src/auth/auth.guard.ts` |
| Controller / endpoint | `POST /api/v1/auth/login`; shared `POST /api/v1/auth/refresh`; protected `POST /api/v1/auth/logout`. There is no `/admin/auth/*` endpoint. |
| Service / command | `AuthService.login`, `rotateRefreshToken`, `logout`, `resolveActor`; `PostgresAuthStore.findPasswordIdentity`, session create/rotate/revoke methods |
| Database tables | `accounts`, `credentials`, `admin_users`, `sessions`, `security_events` |
| Required permission | Login: none. Admin eligibility is inferred later because `resolveActor` returns `ADMIN_USER` when the session account has an `admin_users` row; no admin-login permission. |
| Market scope | Not applicable to global identity/session; no market is selected or granted at login. |
| Audit behavior | `security_events`: `AUTH_LOGIN_SUCCEEDED/FAILED`, refresh success/reuse/failure, logout. Actor/resource/reason is less complete than privileged audit. |
| Idempotency behavior | Login/logout: none; logout revoke is naturally repeatable. Refresh rotation detects token reuse. |
| Concurrency behavior | Store-level session rotation/revocation transaction semantics; refresh family/reuse protection and hashed opaque tokens. |
| Existing tests | Auth counts in §2.1; real HTTP/DB tests cover login, refresh, logout and reuse. OpenAPI auth path is validated. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse the shared credential/session engine, but expose an explicitly documented admin login contract or prove admin eligibility at login. |
| Phase 7 action required | Add an authorized admin-auth surface/contract, admin status checks, session policy and full admin audit only under a later implementation brief. |
| Frozen-contract risk | Replacing auth or issuing a second token type could break Phase 0/2 session contracts; reuse is mandatory. |

### 2. Admin session lifecycle

| Field | Evidence |
|---|---|
| Capability name | Admin session lifecycle |
| Source phase | Phase 0 / Phase 2 auth hardening |
| Repository path | `apps/api/src/auth/auth.controller.ts`; `apps/api/src/auth/auth.service.ts`; `apps/api/src/auth/postgres-auth.store.ts`; `packages/database/migrations/0001_auth_session_access_expiry.sql` |
| Controller / endpoint | `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`; no admin session list, “logout all”, device list, idle-timeout control, or admin self-revoke API. Admin member operations can revoke a member’s sessions at `POST /api/v1/admin/members/:publicMemberId/revoke-sessions`, not an admin’s own sessions. |
| Service / command | `AuthService.rotateRefreshToken`, `logout`, `resolveActor`; `AdminMemberService.revokeSessions` for member targets only |
| Database tables | `sessions`, `security_events`, `accounts`, `admin_users` |
| Required permission | Own refresh/logout: authenticated token only. Member revoke: `member.session.revoke`. |
| Market scope | Admin sessions are global identity records; member revoke is service-enforced against the member’s current accessible market. |
| Audit behavior | Security events for refresh/logout; `member.sessions.revoke` privileged audit for member revocation. No admin-session administration audit surface. |
| Idempotency behavior | Refresh-token one-time rotation/reuse protection; logout repeated revocation is safe. |
| Concurrency behavior | Atomic refresh rotation and family indexing; no admin device/session concurrency UI. |
| Existing tests | Auth integration/HTTP suites plus admin-member HTTP suite. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse session rotation/revocation primitives. |
| Phase 7 action required | Specify admin session listing, forced revocation, idle/absolute expiry and audit requirements before implementation. |
| Frozen-contract risk | Direct session-table updates can bypass reuse detection and security events. |

### 3. Admin MFA / 2FA capability

| Field | Evidence |
|---|---|
| Capability name | Admin MFA / 2FA capability |
| Source phase | Required by Admin PRD; not implemented in Phase 0–6 |
| Repository path | `apps/api/src/auth/auth.controller.ts`; `apps/api/src/auth/auth.service.ts`; `apps/api/src/auth/postgres-auth.store.ts`; `packages/database/migrations/0000_database_foundation.sql` |
| Controller / endpoint | Generic `POST /api/v1/auth/otp/issue` and `/otp/verify`; no enrollment, challenge-on-login, recovery codes, factor binding, trusted device or disable endpoint. |
| Service / command | Generic `AuthService.issueOtp` / `verifyOtp`; no MFA policy/service. |
| Database tables | `otps` can store `STEP_UP`; no MFA factor/enrollment table. |
| Required permission | None on generic OTP issue/verify. |
| Market scope | Global identity; not applicable. |
| Audit behavior | Generic OTP security events; no factor lifecycle audit. |
| Idempotency behavior | OTP attempts/expiry/consume controls; not an MFA transaction. |
| Concurrency behavior | OTP attempt/consume guards; no factor concurrency semantics. |
| Existing tests | Generic OTP covered by auth suites; zero admin MFA tests. |
| Current status | `MISSING` |
| Reuse recommendation | Reuse OTP primitives only as a component after an approved admin MFA contract. |
| Phase 7 action required | Define and implement mandatory admin MFA/step-up separately before sensitive operations. |
| Frozen-contract risk | Treating generic OTP as MFA would create a false security claim. |

### 4. Admin users

| Field | Evidence |
|---|---|
| Capability name | Admin users |
| Source phase | Phase 0 platform access |
| Repository path | `packages/database/schema/index.ts`; `apps/api/src/platform-access/rbac.service.ts`; `apps/api/src/platform-access/access-administration.service.ts`; `apps/api/src/platform-access/platform-access.module.ts` |
| Controller / endpoint | None for create/list/get/suspend/archive admin users. `PlatformAccessModule` registers only `AuditController`. |
| Service / command | No admin-user lifecycle service. Access service can grant roles/markets to an existing admin ID only. |
| Database tables | `accounts`, `admin_users`, `role_assignments`, `market_access` |
| Required permission | Intended `rbac.view` / `rbac.manage`; no endpoint applies them. |
| Market scope | `admin_users` is global; assigned market grants are separate. |
| Audit behavior | Role/market grant/revoke is audited; admin user creation/status lifecycle is absent. |
| Idempotency behavior | Grant inserts use `onConflictDoNothing`; no admin-user lifecycle idempotency. |
| Concurrency behavior | DB uniqueness on one admin row per account; no lifecycle locks/versioning. |
| Existing tests | Platform access tests cover authorization primitives, not an admin-users API. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse `admin_users` and access services; do not create a parallel identity model. |
| Phase 7 action required | Add approved lifecycle/query commands and controller with `rbac.manage`, reason and audit. |
| Frozen-contract risk | Direct inserts/status updates could create privileged accounts without traceability. |

### 5. Roles

| Field | Evidence |
|---|---|
| Capability name | Roles |
| Source phase | Phase 0 platform access |
| Repository path | `packages/database/schema/index.ts`; `packages/database/migrations/0000_database_foundation.sql`; `packages/database/seeds/foundation.ts`; `apps/api/src/platform-access/access-administration.service.ts` |
| Controller / endpoint | None. |
| Service / command | `AccessAdministrationService.assignRole`, `revokeRole`; no role CRUD/list or role-permission composition service. |
| Database tables | `roles`, `role_assignments`, `role_permissions`, `permissions`, `admin_users` |
| Required permission | Intended `rbac.view` / `rbac.manage`; unenforced without controller. |
| Market scope | Role is global; market access is orthogonal. |
| Audit behavior | `rbac.role.assign` / `rbac.role.revoke` with actor, target, role and reason. |
| Idempotency behavior | Duplicate active assignment insert is ignored; revoke returns false when absent. |
| Concurrency behavior | Partial unique active assignment index; transactional audit. |
| Existing tests | Platform access unit/integration; no HTTP API/UI. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse normalized role tables and assign/revoke commands. |
| Phase 7 action required | Expose read/manage endpoints only after defining immutable system roles and custom-role rules. |
| Frozen-contract risk | A generic CRUD UI could archive system roles or bypass separation of role and market access. |

### 6. Permissions

| Field | Evidence |
|---|---|
| Capability name | Permissions |
| Source phase | Phase 0 plus later controller additions |
| Repository path | `apps/api/src/platform-access/rbac.guard.ts`; `apps/api/src/platform-access/rbac.service.ts`; `packages/database/schema/index.ts`; `packages/database/seeds/foundation.ts` |
| Controller / endpoint | None for permission catalog or role-permission assignments. |
| Service / command | `RbacService.isAllowed`; no permission administration method. |
| Database tables | `permissions`, `role_permissions`, `roles` |
| Required permission | Intended `rbac.view` / `rbac.manage`; no endpoint. |
| Market scope | Permission is global; guard optionally combines it with market access. |
| Audit behavior | None for role-permission changes because no service exists. |
| Idempotency behavior | Seed and join-table uniqueness only. |
| Concurrency behavior | DB primary/unique constraints; no service-level transaction. |
| Existing tests | Platform access and DB seed integration. |
| Current status | `PARTIAL` |
| Reuse recommendation | Keep permission codes server-owned and catalogued; never let UI invent strings. |
| Phase 7 action required | Reconcile all decorator codes with seed/migration. Missing seeded codes include `reward.*`, `wallet.adjustment.create`, `agent.activation.manage`, and all `commission.*`. |
| Frozen-contract risk | Current seed/controller drift makes valid endpoints permanently denied in a standard seeded environment or encourages unsafe manual DB inserts. |

### 7. Market access

| Field | Evidence |
|---|---|
| Capability name | Market access |
| Source phase | Phase 0 platform access |
| Repository path | `apps/api/src/platform-access/rbac.guard.ts`; `apps/api/src/platform-access/rbac.service.ts`; `apps/api/src/platform-access/access-administration.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | None for grant/revoke/list. Market-scoped merchant/MCP/package endpoints do enforce route `:marketId`; member/KYC services enforce access internally. |
| Service / command | `grantMarketAccess`, `revokeMarketAccess`, `hasMarketAccess`; `RbacGuard.resolveMarketId` uses route param then `x-market-id`. |
| Database tables | `market_access`, `markets`, `admin_users` |
| Required permission | Intended `rbac.manage`; no administration endpoint. Downstream permission varies. |
| Market scope | Correctly combined in merchant/MCP/package guards; absent from Phase 5 admin endpoints and redemption identity-only endpoints. |
| Audit behavior | `rbac.market.grant` / `rbac.market.revoke`, with target market and reason. |
| Idempotency behavior | Duplicate grant ignored; repeat revoke returns false. |
| Concurrency behavior | Partial unique active grant index plus transaction. |
| Existing tests | Platform access integration and numerous merchant/member HTTP isolation tests. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse this as the single market authorization source. |
| Phase 7 action required | Add an authorized admin API and require every Phase 7 read/write, export and audit query to use it. |
| Frozen-contract risk | Client-selected market without a server grant breaks tenant isolation. |

### 8. Member lookup and operations

| Field | Evidence |
|---|---|
| Capability name | Member lookup and operations |
| Source phase | Phase 2 P2-S8 |
| Repository path | `apps/api/src/admin-member/admin-member.controller.ts`; `apps/api/src/admin-member/admin-member.service.ts`; `packages/database/schema/index.ts`; `packages/database/migrations/0013_admin_member_notes.sql` |
| Controller / endpoint | `GET /api/v1/admin/members`; `GET /:publicMemberId`; `POST /:publicMemberId/suspend`, `/reactivate`, `/close`, `/revoke-sessions`, `/require-reverification`, `/notes`; `GET /:publicMemberId/notes` under the same base. |
| Service / command | `AdminMemberService.listMembers`, `getMember`, `suspendMember`, `reactivateMember`, `closeMember`, `revokeSessions`, `requireReverification`, `addAdminNote`, `getMemberNotes` |
| Database tables | `accounts`, `members`, `member_profiles`, `member_market_preferences`, `member_status_history`, `sessions`, `member_kyc_cases/history`, `admin_member_notes`, `market_access`, `audit_logs`, `entity_timelines` |
| Required permission | `member.read`, `member.status.manage`, `member.session.revoke`, `member.reverification.require`, `member.note.create`, `member.note.read` |
| Market scope | No route market; service joins/asserts active `market_access` against the member’s current market. |
| Audit behavior | Status timeline/privileged audit; `member.sessions.revoke`; `member.note.add`; actor, target, market and reason retained. |
| Idempotency behavior | Status transition is state-checked; notes/revoke have no explicit idempotency key. |
| Concurrency behavior | Mutations lock member rows and run audit in the same transaction. |
| Existing tests | 12 mock service declarations and 14 real HTTP/PostgreSQL declarations, including permission/market isolation and concurrent status actions. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse directly as the Phase 7 member operations backend. |
| Phase 7 action required | Build UI/read models without bypassing masking, current-market access or audit. |
| Frozen-contract risk | “Global member” lookup must not expose a member through a market the admin cannot access. |

### 9. Merchant lookup and operations

| Field | Evidence |
|---|---|
| Capability name | Merchant lookup and operations |
| Source phase | Phase 1 |
| Repository path | `apps/api/src/merchant/merchant.controller.ts`; `apps/api/src/merchant/merchant.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | `GET /api/v1/admin/markets/:marketId/merchants`; `/applications`; `/kyc`; `GET /:branchId/kyc/review`; POST review/status routes listed in items 11 and 14. |
| Service / command | `listMerchants`, `listApplications`, `listKycQueue`, `getKycForReview`, `reviewKyc`, `reviewApplication`, `suspend`, `reactivate`, `close` |
| Database tables | `merchant_branches`, `merchant_profiles`, `merchant_applications/submissions/reviews`, `merchant_kyc_submissions/reviews`, `merchant_documents`, `merchant_status_history`, `mcp_accounts`, audit tables |
| Required permission | `merchant.view`, `merchant.kyc.view/approve`, `merchant.approve`, `merchant.suspend`, `merchant.close`; route is market-scoped. |
| Market scope | `:marketId` is checked by `RbacGuard`; every service query/locked row also predicates/asserts `market_id`. |
| Audit behavior | Review/status actions persist privileged audit with actor/action/entity/market/reason. Read of KYC review detail writes `MERCHANT_KYC_REVIEW_STARTED`. |
| Idempotency behavior | Review/status commands use required idempotency key and service idempotency records; list/read none. |
| Concurrency behavior | Transactional state locks and transition checks. |
| Existing tests | Merchant unit/helper tests plus 10 broad real integration declarations; Admin web has live merchant list/review/status coverage but no browser E2E. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse these market-scoped commands; do not use member discovery endpoints for admin lookup. |
| Phase 7 action required | Add richer UI only; preserve separate application/KYC state machines. |
| Frozen-contract risk | Direct branch/status/attribution edits would bypass Phase 1 and Phase 5 invariants. |

### 10. Agent lookup and operations

| Field | Evidence |
|---|---|
| Capability name | Agent lookup and operations |
| Source phase | Phase 5 |
| Repository path | `apps/api/src/controllers/admin-agent-activation.controller.ts`; `apps/api/src/domain/agent-activation/service.ts`; `apps/api/src/domain/agent-activation/agent-activation.service.ts`; `apps/api/src/agent-activation/agent-activation.module.ts` |
| Controller / endpoint | Runtime command paths are `POST /api/v1/api/v1/admin/agent-activations/:id/{approve|reject|suspend|reactivate|deactivate}` because the controller duplicates the prefix. No admin list/search/detail queue endpoint. |
| Service / command | Live `AgentActivationService.approveAndActivate`, `reject`, `suspend`, `reactivate`, `deactivate`; two different classes share the same name, and the 38-test suite targets the non-wired repository abstraction. |
| Database tables | `agent_activation`, `agent_activation_status_log`, member/KYC records, commission processing/ledger on approval |
| Required permission | `agent.activation.manage`, absent from foundation permission seed. |
| Market scope | Activation stores a two-letter `market`, but guard is not market-scoped and service does not check the admin’s `market_access`. |
| Audit behavior | Status log exists. Approval records admin ID; reject/suspend/deactivate write `changedByType='ADMIN'` but `changedBy=null`; reason is present where supplied. |
| Idempotency behavior | State-transition replay protection; no request idempotency key. Approval triggers commission and swallows commission errors with `.catch(() => {})`. |
| Concurrency behavior | Live service reads then updates in a transaction but does not lock/version the activation before transition. |
| Existing tests | 38 declarations test the dead duplicate service, not the live wired service; no admin HTTP integration for the runtime route/policy. |
| Current status | `DUPLICATED` |
| Reuse recommendation | Retain the Phase 5 tables/contract, but first select one live service and verify it under separate frozen-domain authorization. |
| Phase 7 action required | Add read queue/search, correct routing/permission seed/market authorization/audit actor, and prove commission failure semantics before exposure. |
| Frozen-contract risk | Very high: current duplication creates misleading coverage and admin actions can cross markets or lose actor attribution. |

### 11. Merchant KYC

| Field | Evidence |
|---|---|
| Capability name | Merchant KYC |
| Source phase | Phase 1 P1-S4 |
| Repository path | `apps/api/src/merchant/merchant.controller.ts`; `apps/api/src/merchant/merchant.service.ts`; `apps/api/src/merchant/dto/kyc.dto.ts`; `apps/api/src/merchant/kyc-masking.ts`; `apps/api/src/merchant/kyc-storage.adapter.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | `GET /api/v1/admin/markets/:marketId/merchants/kyc`; `GET /api/v1/admin/markets/:marketId/merchants/:branchId/kyc/review`; `POST` same path for decision. Merchant-facing submit/read/upload endpoints are separate and guarded by `MerchantOwnershipGuard`. |
| Service / command | `listKycQueue`, `getKycForReview`, `reviewKyc`; merchant-facing `submitKyc`, `createDocumentUploadIntent` must not be repurposed by admin. |
| Database tables | `merchant_kyc_submissions`, `merchant_kyc_reviews`, `merchant_documents`, `merchant_branches`, audit tables, merchant idempotency keys |
| Required permission | `merchant.kyc.view` and `merchant.kyc.approve`, with `marketScoped: true`. |
| Market scope | Route market + guard grant + service branch-market assertion. |
| Audit behavior | `MERCHANT_KYC_REVIEW_STARTED` on review detail and `MERCHANT_KYC_REVIEWED` on decision, with actor, market, reason/evidence. |
| Idempotency behavior | Required idempotency key on decision; payload mismatch rejected. |
| Concurrency behavior | KYC row is locked and status/version revalidated in transaction. |
| Existing tests | Merchant real integration plus masking/storage unit tests; Admin web calls queue/detail/approve but has no browser E2E. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse directly. |
| Phase 7 action required | Provide masked evidence UI, explicit reject-field input and no raw-document export. |
| Frozen-contract risk | Market/legal retention O-08 remains open; UI must not invent policy. |

### 12. Member KYC

| Field | Evidence |
|---|---|
| Capability name | Member KYC |
| Source phase | Phase 2 P2-S6/P2-S8 |
| Repository path | `apps/api/src/admin-kyc/admin-kyc.controller.ts`; `apps/api/src/admin-kyc/admin-kyc.service.ts`; `apps/api/src/kyc/kyc.controller.ts`; `apps/api/src/kyc/kyc.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | Under `/api/v1/admin/kyc/cases`: `GET /`, `GET /:id`, and `POST /:id/{start-review|request-more-info|approve|reject|require-reverification}`. |
| Service / command | `AdminKycService.listCases`, `getCase`, internal transition command used by the five mutation methods, `requireReverification` |
| Database tables | `member_kyc_cases`, `member_kyc_documents`, `member_kyc_history`, `members`, `member_profiles`, `market_access`, audit tables |
| Required permission | Class-wide `member.kyc.review`; this code is used by tests but is absent from `foundationPermissions`. |
| Market scope | No route market; list joins active grants and detail/mutations call service `assertMarketAccess`. |
| Audit behavior | Immutable KYC history plus privileged audit with reviewer/action/case/market/reason. |
| Idempotency behavior | State transition validation; member submission has idempotency, admin review endpoints have no request key. |
| Concurrency behavior | Review mutations lock case rows and revalidate state in one transaction. |
| Existing tests | 17 mock service and 12 real HTTP/PostgreSQL declarations including permissions and cross-market denial. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse service/controller after permission catalog reconciliation. |
| Phase 7 action required | Seed/catalogue `member.kyc.review` through an authorized permission change and add UI. |
| Frozen-contract risk | Direct status edits would bypass immutable history and Level 2 rules. |

### 13. Agent activation review

| Field | Evidence |
|---|---|
| Capability name | Agent activation review |
| Source phase | Phase 5 |
| Repository path | `apps/api/src/controllers/admin-agent-activation.controller.ts`; `apps/api/src/domain/agent-activation/service.ts`; `apps/api/src/domain/agent-activation/agent-activation.service.ts`; `apps/api/src/agent-activation/agent-activation.module.ts` |
| Controller / endpoint | Runtime `POST /api/v1/api/v1/admin/agent-activations/:id/approve` and `/reject`; no pending-review list/detail endpoint. |
| Service / command | `approveAndActivate(id, adminId)`, `reject(id, reason)`; approval then calls `processAgentUpgrade(id)` outside the activation transaction and suppresses errors. |
| Database tables | `agent_activation`, status log, commission processing/rates/ledger/status events |
| Required permission | `agent.activation.manage`, not seeded. |
| Market scope | NOT enforced against admin market grant. |
| Audit behavior | Approve records admin; reject status log records ADMIN type with null admin ID. No platform `audit_logs` entry. |
| Idempotency behavior | State gating only; no request key. Commission posting has its own idempotency but failure is hidden. |
| Concurrency behavior | No row lock/version around live activation transition; commission is a later separate transaction. |
| Existing tests | Dead-service unit tests only for lifecycle; B integration covers commission semantics, not this HTTP chain. |
| Current status | `UNSAFE` |
| Reuse recommendation | Reuse frozen domain after separately authorized consolidation/hardening. |
| Phase 7 action required | Block UI until correct queue, route, permission seed, market access, actor audit, concurrency and commission failure visibility exist. |
| Frozen-contract risk | High financial and audit risk; do not treat the current controller as production-ready. |

### 14. Merchant status and suspension

| Field | Evidence |
|---|---|
| Capability name | Merchant status and suspension |
| Source phase | Phase 1 |
| Repository path | `apps/api/src/merchant/merchant.controller.ts`; `apps/api/src/merchant/merchant.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | `POST /api/v1/admin/markets/:marketId/merchants/:branchId/suspend`; `/reactivate`; `/close` |
| Service / command | `MerchantService.suspend`, `reactivate`, `close`, shared locked transition helper |
| Database tables | `merchant_branches`, `merchant_status_history`, `mcp_accounts`, audit/timeline, idempotency records |
| Required permission | `merchant.suspend` for suspend/reactivate; `merchant.close` for close; market-scoped. |
| Market scope | Route + RBAC grant + locked branch `market_id` assertion. |
| Audit behavior | Status history and privileged audit include admin, action, merchant, market and reason. MCP is preserved. |
| Idempotency behavior | Required key and canonical admin action scope. |
| Concurrency behavior | Row lock/transaction and allowed-transition checks. |
| Existing tests | Merchant integration covers activation/suspension and market/access behavior; Admin web exposes suspend/reactivate. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse directly. |
| Phase 7 action required | UI confirmation/reason and visible MCP-preservation notice; close should remain separately privileged. |
| Frozen-contract risk | Changing merchant status directly can desynchronize transaction eligibility and MCP behavior. |

### 15. MCP recharge and ledger

| Field | Evidence |
|---|---|
| Capability name | MCP recharge and ledger |
| Source phase | Phase 1 P1-S6 |
| Repository path | `apps/api/src/merchant/mcp.controller.ts`; `apps/api/src/merchant/mcp.service.ts`; `packages/database/migrations/0002_phase_1_merchant_package_mcp.sql`; `packages/database/migrations/0005_mcp_ledger_recharge.sql`; `packages/database/schema/index.ts` |
| Controller / endpoint | GET `/api/v1/admin/markets/:marketId/mcp/accounts/:accountId`, `/ledger`, `/reconcile`; POST `/api/v1/admin/markets/:marketId/merchants/:branchId/recharge`; POST `/api/v1/admin/markets/:marketId/recharge/:requestId/review`. Merchant read/refund endpoints are ownership-guarded and not admin substitutes. |
| Service / command | `adminAccount`, `adminLedger`, `reconcile`, `createRecharge`, `reviewRecharge` |
| Database tables | `mcp_accounts`, `mcp_ledger_entries`, `mcp_recharge_requests`, merchant branches, audit/timeline |
| Required permission | `merchant.mcp.view`; `merchant.mcp.recharge.review`, all market-scoped. |
| Market scope | Route/guard and account/branch/request predicates. |
| Audit behavior | `MCP_RECHARGE_REQUESTED` plus review/ledger audit written transactionally with actor/market/reason. |
| Idempotency behavior | Required key on creation; stored request key/payload replay checks; review locks current state. |
| Concurrency behavior | `FOR UPDATE`, projection guard/ledger insert guard and transaction. |
| Existing tests | Broad real merchant integration and DB invariant tests; no isolated admin MCP HTTP suite. Admin web covers account/ledger/recharge/review. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse directly; no direct balance update. |
| Phase 7 action required | Add reconciliation UI and make provider/sandbox status explicit; no real payment side effect is present. |
| Frozen-contract risk | MCP projection/ledger writes outside service violate append-only accounting. |

### 16. Manual MCP adjustment

| Field | Evidence |
|---|---|
| Capability name | Manual MCP adjustment |
| Source phase | Phase 1 P1-S7 |
| Repository path | `apps/api/src/merchant/mcp.controller.ts`; `apps/api/src/merchant/mcp.service.ts`; `packages/database/migrations/0006_mcp_adjustment_refund_governance.sql`; `packages/database/schema/index.ts` |
| Controller / endpoint | POST `/api/v1/admin/markets/:marketId/mcp/accounts/:accountId/adjustments`; alias `/merchants/:branchId/adjustments`; `/mcp/adjustments/:requestId/submit`; `/mcp/adjustments/:requestId/decision`; alias `/adjustments/:requestId/approve`; `/adjustments/:requestId/execute`. |
| Service / command | `createAdjustment`, `createAdjustmentForBranch`, `submitAdjustment`, `decideAdjustment`, `approveAdjustment`, `executeAdjustment` |
| Database tables | `mcp_adjustment_requests`, `mcp_adjustment_decisions`, `mcp_accounts`, `mcp_ledger_entries`, audit tables |
| Required permission | Maker `merchant.mcp.adjust`; checker `merchant.mcp.adjust.approve`; executor `merchant.mcp.adjust.execute`, all market-scoped. |
| Market scope | Route/guard plus request/account predicates. |
| Audit behavior | Domain decision plus privileged audit via helper; actor/action/account/market/reason/evidence retained. |
| Idempotency behavior | Required maker key; unique request key; execution returns existing result/guards final state. |
| Concurrency behavior | Request `FOR UPDATE`, maker/checker/executor separation, DB trigger, atomic ledger/projection execution. |
| Existing tests | Merchant integration exercises adjustment stages and negative paths; Admin web exposes maker/submit/checker/execute. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse exactly; aliases should be rationalized in documentation, not duplicated in a new service. |
| Phase 7 action required | Provide queues/history and enforce distinct authenticated operators in UI. |
| Frozen-contract risk | All amounts require Maker/Checker; never add a threshold bypass. |

### 17. iPoint wallets and wallet ledger

| Field | Evidence |
|---|---|
| Capability name | iPoint wallets and wallet ledger |
| Source phase | Phase 3 |
| Repository path | `apps/api/src/wallet/wallet.controller.ts`; `apps/api/src/wallet/wallet.service.ts`; `apps/api/src/admin-reward/admin-reward.controller.ts`; `packages/database/migrations/0014_phase_3_reward_and_wallet_schema.sql`; `packages/database/schema/index.ts` |
| Controller / endpoint | Member/account-only `GET /api/v1/wallets`, `GET /wallets/:id`, `GET /wallets/:id/entries`, `GET /entries/:entryId`; `POST /wallets`. No admin wallet lookup/ledger endpoint. |
| Service / command | `WalletService` read/create/append methods; no admin read service. |
| Database tables | `member_wallet_accounts`, `member_wallet_entries`, `members`, `markets`, reward/transaction/redemption linkage tables |
| Required permission | Member endpoints use `AuthGuard` and account ownership. No `wallet.view` admin permission. |
| Market scope | Member ownership and wallet market; no admin market access path. |
| Audit behavior | Ledger entry itself has actor/reason/reference; privileged admin read audit absent. |
| Idempotency behavior | Append uses unique idempotency key; reads none. |
| Concurrency behavior | Optimistic wallet version and transaction; Phase 3 schema lacks a DB update/delete immutability trigger on wallet entries, so service discipline matters. |
| Existing tests | Wallet 19 mock declarations; HTTP integration file uses generated cases; Phase 3 schema 32 and timezone/ledger tests. |
| Current status | `PARTIAL` |
| Reuse recommendation | Build an admin read model over owning wallet service/repository with market access; do not call member endpoints using admin identity. |
| Phase 7 action required | Add read-only admin wallet/ledger query API and access-audit contract. |
| Frozen-contract risk | Direct SQL can bypass ownership, paired balance/ledger atomicity and append-only discipline. |

### 18. Manual iPoint adjustment

| Field | Evidence |
|---|---|
| Capability name | Manual iPoint adjustment |
| Source phase | Underlying ledger Phase 3; compliant admin workflow intended Phase 7 |
| Repository path | `apps/api/src/admin-reward/admin-reward.controller.ts`; `apps/api/src/admin-reward/admin-reward.service.ts`; `apps/api/src/wallet/wallet.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | `POST /api/v1/admin/rewards/wallets/:id/adjustment` |
| Service / command | `AdminRewardService.requestWalletAdjustment` immediately updates wallet and inserts `ADJUSTMENT`; optional compensation is also executed by the same actor/request. |
| Database tables | `member_wallet_accounts`, `member_wallet_entries`, `market_access`, audit/timeline; no wallet adjustment request/decision table. |
| Required permission | `wallet.adjustment.create`, absent from foundation seed; no checker permission. |
| Market scope | Guard is not market-scoped; service asserts wallet market access after locking. |
| Audit behavior | `wallet.adjustment.create` and optional `.compensate`, actor/reason/before/after; but no maker/checker decision trail. |
| Idempotency behavior | Input contains idempotency key; existing entry replay returns executed result. Compensation derives `-comp` key. |
| Concurrency behavior | Wallet `FOR UPDATE`, optimistic version and one DB transaction. |
| Existing tests | 12 mock-only AdminReward declarations; no HTTP/real-DB Maker/Checker acceptance. |
| Current status | `UNSAFE` |
| Reuse recommendation | Do not expose. Reuse only lower-level wallet append/transaction primitives in a separately authorized Maker/Checker workflow. |
| Phase 7 action required | Block endpoint/UI; design request-submit-approve/reject-execute with distinct maker/checker, reason/evidence and immutable audit. |
| Frozen-contract risk | Directly violates baseline L-16: all manual iPoint credit/debit requires dual approval. |

### 19. Transaction search and operational actions

| Field | Evidence |
|---|---|
| Capability name | Transaction search and operational actions |
| Source phase | Phase 4 |
| Repository path | `apps/api/src/transaction/transaction.controller.ts`; `apps/api/src/transaction/member-transaction.controller.ts`; `apps/api/src/transaction/transaction-read.service.ts`; `apps/api/src/transaction/transaction-correction.service.ts` |
| Controller / endpoint | Merchant-only `GET /api/v1/merchant/transactions[/ :transactionNumber]` and correction request routes; member-only `GET /api/v1/members/me/transactions[/ :transactionNumber]`. No admin search/detail/correction execution endpoint. Controllers explicitly reject actor type `ADMIN_USER`. |
| Service / command | `listMerchantTransactions`, `getMerchantTransaction`, `listMemberTransactions`, `getMemberTransaction`, `requestCorrection`, `getCorrection`; no platform admin command. |
| Database tables | Phase 4 transaction, preview, fee, MCP debit, reward link, idempotency, audit reference, correction request/execution tables |
| Required permission | Member/merchant ownership only; no admin permission. |
| Market scope | Derived from owned merchant/member/transaction; no admin grant path. |
| Audit behavior | Transaction/correction domain audit references; no admin operational audit. |
| Idempotency behavior | Strong keys for preview/confirm/correction request. |
| Concurrency behavior | Advisory locks, row locks, atomic correction and immutable triggers. |
| Existing tests | 41 preview/confirm integration, 35 correction acceptance, 29 read, 8 hardening declarations; zero admin transaction tests. |
| Current status | `MISSING` |
| Reuse recommendation | Add admin read/command adapters over frozen read/correction services; never impersonate member/merchant. |
| Phase 7 action required | Define transaction search, status filters, correction approval/execution permissions and audit in the Phase 7 brief. |
| Frozen-contract risk | High: direct transaction status/ledger mutation would break Phase 4 immutability and compensating semantics. |

### 20. Reward rules and rule versions

| Field | Evidence |
|---|---|
| Capability name | Reward rules and rule versions |
| Source phase | Phase 3 |
| Repository path | `apps/api/src/admin-reward/admin-reward.controller.ts`; `apps/api/src/admin-reward/admin-reward.service.ts`; `packages/database/migrations/0014_phase_3_reward_and_wallet_schema.sql`; `packages/database/schema/index.ts` |
| Controller / endpoint | `GET /api/v1/admin/rewards/rules`; `GET /rules/:id`; `GET /rules/:id/versions`; `POST /rules` |
| Service / command | `listRuleVersions`, `getRuleVersion`, `getRuleVersionHistory`, `createRuleVersion` |
| Database tables | `reward_rule_versions`, `markets`, `market_access`, audit/timeline |
| Required permission | `reward.rule.read` / `reward.rule.create`, neither seeded. |
| Market scope | Guard not market-scoped. List/detail/history do not enforce market access; caller can omit/filter arbitrary market. Create accepts `marketId` but does not call `assertMarketAccess`. |
| Audit behavior | Create writes `reward.rule_version.create`, but insert commits before a separate audit transaction, so audit failure can leave an unaudited rule. Reads not audited. |
| Idempotency behavior | None on create. |
| Concurrency behavior | No overlap/exclusion lock or serializable transaction in this service; DB uniqueness does not fully prohibit overlapping effective periods. |
| Existing tests | 12 mock-only AdminReward declarations; Phase 3 reward/domain tests do not prove admin authorization. |
| Current status | `UNSAFE` |
| Reuse recommendation | Reuse schema/domain calculations, not this write path until access, validation, idempotency and atomic audit are fixed by owner authorization. |
| Phase 7 action required | Block create UI; define server bounds for O-06, market grant, append/version scheduling and atomic audit. |
| Frozen-contract risk | Unauthorized cross-market or overlapping rules can change future wallet accruals. |

### 21. Reward jobs and retry operations

| Field | Evidence |
|---|---|
| Capability name | Reward jobs and retry operations |
| Source phase | Phase 3 |
| Repository path | `apps/api/src/admin-reward/admin-reward.controller.ts`; `apps/api/src/admin-reward/admin-reward.service.ts`; `apps/api/src/daily-job/job.service.ts`; `apps/api/src/daily-job/job-scheduler.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | `GET /api/v1/admin/rewards/jobs`; `GET /jobs/:id`; no admin retry endpoint. |
| Service / command | Admin methods `listJobRuns` / `getJobRunDetail` are explicit placeholders reading `reward_rule_versions` and fabricating completed zero-count jobs. Real `JobService.listJobRuns`, `getJobRun`, `retryFailedItems` and scheduler queue are not wired to admin controller. |
| Database tables | Placeholder reads `reward_rule_versions`; real engine uses `daily_job_runs`, `reward_daily_accruals`, member wallet/ledger, and runtime-created `job_queue`. |
| Required permission | `reward.job.read`, not seeded; no retry permission. |
| Market scope | Placeholder accepts no proven accessible-market enforcement; real jobs are market/date scoped. |
| Audit behavior | Placeholder none; real accruals carry audit correlation but no privileged retry audit endpoint. |
| Idempotency behavior | Real accrual/job engine has unique market/date/job keys and same-key replay; placeholder none. |
| Concurrency behavior | Real scheduler uses advisory locks and `FOR UPDATE SKIP LOCKED`; placeholder none. |
| Existing tests | 14 mock job service, 29 timezone integration, scheduler/concurrency static tests; AdminReward mock tests assert placeholder response. |
| Current status | `TEMPORARY` |
| Reuse recommendation | Wire a future read/retry controller to real `JobService`; delete no history and do not replicate scheduler logic. |
| Phase 7 action required | Replace placeholder only under authorized Phase 3 integration work; add retry permission, market access and audit. |
| Frozen-contract risk | Presenting fabricated completed jobs hides failures and can mislead operations. |

### 22. Commission operations

| Field | Evidence |
|---|---|
| Capability name | Commission operations |
| Source phase | Phase 5 |
| Repository path | `apps/api/src/controllers/admin-commission.controller.ts`; `apps/api/src/domain/commission/query.service.ts`; `apps/api/src/domain/commission/adjustment.service.ts`; `apps/api/src/commission/commission.module.ts` |
| Controller / endpoint | Registered runtime endpoints: `GET /api/v1/api/v1/admin/commission/ledger`, `GET .../audit`, `POST .../reprocess`. Declared but unreachable because not registered: `POST /api/v1/api/v1/admin/commission-adjustments`, `POST /:id/approve`, `POST /:id/reject`. |
| Service / command | `CommissionQueryService.adminSearch`, `getAuditLog`; reprocess dispatches to `processAgentUpgrade`, `processMemberConsumption`, `processMerchantRecruitment`; dead controller calls `AdjustmentService.create/approve/rejectAdjustment`. |
| Database tables | `commission_ledger`, `commission_status_event`, `commission_processing/results`, `commission_adjustment_request`, `commission_rate_version`, `merchant_attribution`, `idempotency_key` |
| Required permission | `commission.admin`; dead routes require maker/checker codes. All are absent from foundation seed. |
| Market scope | Client query/body uses two-letter market code, but guards are not market-scoped and services do not check admin `market_access`. Audit-by-entry and reprocess can cross markets. |
| Audit behavior | Immutable commission status events/adjustment audit linkage exist; admin query/reprocess does not append platform privileged audit. |
| Idempotency behavior | Domain source processors and compensation use canonical keys; admin reprocess has no request key but delegates to idempotent processors. |
| Concurrency behavior | Domain transactions/unique keys; adjustment checker uses locking in service, but controller is unreachable. |
| Existing tests | 83 mock/static commission declarations, 16 mock concurrency, B/C/D real 15/10/10; one module compile test; no admin HTTP route/access test. |
| Current status | `UNSAFE` |
| Reuse recommendation | Reuse frozen query/process services only behind corrected route/permission/market/audit adapter. |
| Phase 7 action required | Block reprocess UI; register or intentionally retire adjustment controller only through authorized Phase 5 remediation; fix prefix and market access. |
| Frozen-contract risk | Cross-market search/reprocess and misleading dead Maker/Checker surface are high-risk financial operations defects. |

### 23. Redemption catalog management

| Field | Evidence |
|---|---|
| Capability name | Redemption catalog management |
| Source phase | Phase 6 P6-S2 |
| Repository path | `apps/api/src/redemption/admin-redemption.controller.ts`; `apps/api/src/redemption/redemption.service.ts`; `apps/api/src/redemption/redemption.module.ts`; `packages/database/schema/redemption.ts`; `packages/database/migrations/0020_phase_6_redemption_center_canonical.sql` |
| Controller / endpoint | Declared `POST /api/v1/admin/redemption/catalog`, `PUT /catalog/:itemId`, `POST /catalog/:itemId/status`, `GET /market/:marketId/catalog`, `GET /catalog/:itemId`. **None are runtime routes** because `AdminRedemptionController` is not in `RedemptionModule.controllers`. |
| Service / command | `createCatalogItem`, `updateCatalogItem`, `setCatalogStatus`, `listCatalogItems`, `getCatalogItem` |
| Database tables | `redemption_catalog_items`, `redemption_inventory`, `redemption_audit_log`, `markets` |
| Required permission | Decorators say `redemption.catalog.manage` (seeded) but not `marketScoped`; unreachable in any case. |
| Market scope | Service queries use item/route `market_id`, but no admin market-grant check. Get/update by item ID can act without a route market. |
| Audit behavior | Catalog service writes redemption audit records for mutations; actor and entity present. |
| Idempotency behavior | No controller idempotency key; SKU uniqueness supplies limited duplicate protection. |
| Concurrency behavior | DB transaction/constraints on service operations; no optimistic version. |
| Existing tests | Redemption integration/domain tests exercise service; no operational controller HTTP test. |
| Current status | `MISSING` |
| Reuse recommendation | Reuse Phase 6 service after separate authorization to register a market-scoped controller. |
| Phase 7 action required | Do not build UI until runtime registration, market permission, audit and idempotency are proven. |
| Frozen-contract risk | Registering/changing Phase 6 code is outside this task and requires frozen-domain authorization. |

### 24. Redemption rate management

| Field | Evidence |
|---|---|
| Capability name | Redemption rate management |
| Source phase | Phase 6 P6-S2 |
| Repository path | `apps/api/src/redemption/admin-redemption.controller.ts`; `apps/api/src/redemption/redemption.service.ts`; `apps/api/src/redemption/redemption.module.ts`; `packages/database/schema/redemption.ts` |
| Controller / endpoint | Declared but unreachable: `POST /api/v1/admin/redemption/market/:marketId/rates`, `GET` same, `POST /api/v1/admin/redemption/rates/:rateId/cancel`. |
| Service / command | `createRateVersion`, `listRateVersions`, `cancelRateVersion`, `getEffectiveRate` |
| Database tables | `redemption_rate_versions`, quote/order snapshot columns, redemption audit |
| Required permission | `redemption.rate.manage` seeded; decorator not market-scoped. |
| Market scope | Create/list predicates route market; cancel by rate ID lacks admin grant enforcement. |
| Audit behavior | Mutation audit in redemption audit log. |
| Idempotency behavior | No request key; DB exclusion prevents overlapping effective ranges. |
| Concurrency behavior | Database exclusion/immutability triggers protect versions; service transaction. |
| Existing tests | Redemption integration/atomicity cover rate locking; no registered admin HTTP test. |
| Current status | `MISSING` |
| Reuse recommendation | Reuse immutable version service only through corrected market-scoped API. |
| Phase 7 action required | Add runtime API under authorized Phase 6 integration; preserve quote/order snapshot. |
| Frozen-contract risk | Direct updates or retroactive rate changes violate OD-22 and order locking. |

### 25. Redemption order administration

| Field | Evidence |
|---|---|
| Capability name | Redemption order administration |
| Source phase | Phase 6 |
| Repository path | `apps/api/src/redemption/redemption.controller.ts`; `apps/api/src/redemption/redemption.service.ts`; `apps/api/src/redemption/redemption-admin-refund.controller.ts`; `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`; `packages/database/schema/redemption.ts` |
| Controller / endpoint | No admin order list/search/detail endpoint. Only `GET /api/v1/admin/redemption/fulfilments/pending`, `GET /fulfilments/:id`, and refund lookup routes expose fragments. Member order creation is not an admin API. |
| Service / command | No dedicated admin order query service; fulfilment/refund lookup methods query related records. |
| Database tables | `redemption_orders`, quotes, fulfilments, refunds, shipping payments, terms, audit |
| Required permission | Intended seeded `redemption.orders.view`; unused by any controller. |
| Market scope | Existing fulfilment/refund list/detail queries are global and do not filter admin market access. |
| Audit behavior | Order mutations write redemption audit; reads not audited. |
| Idempotency behavior | Order confirmation has strong idempotency; admin reads none. |
| Concurrency behavior | Order confirm locks/transactions; no admin query issue. |
| Existing tests | Phase 6 domain integration; no admin order HTTP/search test. |
| Current status | `MISSING` |
| Reuse recommendation | Build a read-only market-scoped order query service over frozen schema. |
| Phase 7 action required | Add order search/detail with `redemption.orders.view`, safe fields and as-of status. |
| Frozen-contract risk | Do not add generic “edit order/status” actions; use domain commands only. |

### 26. Redemption refund Maker / Checker

| Field | Evidence |
|---|---|
| Capability name | Redemption refund Maker / Checker |
| Source phase | Phase 6 P6-S6/P6-S8 |
| Repository path | `apps/api/src/redemption/redemption-admin-refund.controller.ts`; `apps/api/src/redemption/redemption-refund.service.ts`; `packages/database/schema/redemption.ts`; `packages/database/schema/index.ts`; `packages/database/migrations/0023_phase_6_final_contract_alignment.sql` |
| Controller / endpoint | Under `/api/v1/admin/redemption/refunds`: `POST /`, `POST /approve`, `POST /reject`, `GET /pending`, `GET /`, `GET /:id`, `GET /order/:orderId`. |
| Service / command | `createRefundRequest`, `approveRefundRequest`, `rejectRefundRequest`, lookup/list methods; private `executeAtomicRefund` |
| Database tables | `redemption_refund_requests`, `redemption_orders`, `redemption_inventory`, `redemption_shipping_payment_recovery`, intended `member_wallet_entries`, `redemption_audit_log` |
| Required permission | Controller uses only `AuthGuard + AdminGuard`; seeded maker/checker permissions are not applied. Any active admin can make, check, list or decide. |
| Market scope | NOT enforced. Lists/details are global; audit helper writes `marketId: null`. |
| Audit behavior | `REFUND_REQUESTED`, `REFUND_EXECUTED`, `REFUND_REJECTED`, failure event, but market is null; actor/reason partly present. |
| Idempotency behavior | One request per order/state checks; no request idempotency key. |
| Concurrency behavior | Refund request `FOR UPDATE`, distinct maker/checker check, transaction isolation. |
| Existing tests | 24/8 mock/harness refund suites and some 17-test real atomicity coverage; tests do not prove a successful wallet credit. |
| Current status | `UNSAFE` |
| Reuse recommendation | Do not expose for successful refund execution. Keep domain tables and separately authorize remediation. |
| Phase 7 action required | Apply maker/checker permissions and market grants; block approval because `executeAtomicRefund` contains a placeholder and never inserts the exact-opposite `REDEMPTION_REFUND` wallet entry or updates wallet projection. |
| Frozen-contract risk | Critical: current path can mark order refunded/restore inventory without returning points. |

### 27. Voucher reveal authorization

| Field | Evidence |
|---|---|
| Capability name | Voucher reveal authorization |
| Source phase | Phase 6 P6-S5/P6-S8 |
| Repository path | `apps/api/src/redemption/redemption-fulfilment.service.ts`; `apps/api/src/redemption/redemption-security-privacy.spec.ts`; `packages/database/schema/redemption.ts`; `packages/database/migrations/0021_phase_6_redemption_contract_corrections.sql` |
| Controller / endpoint | None. No controller calls `revealVoucher`. |
| Service / command | `RedemptionFulfilmentService.revealVoucher(orderId, memberId, actor)` decrypts AES-256-GCM value and writes `VOUCHER_REVEAL`. |
| Database tables | `redemption_orders`, `redemption_voucher_codes`, `redemption_audit_log` |
| Required permission | Seeded `redemption.voucher.reveal` exists but is unused. Service authorizes any `actorType='ADMIN'` without checking permission/market. |
| Market scope | Order market exists; admin market access is not checked in service. |
| Audit behavior | Explicit `VOUCHER_REVEAL` with actor/order/market, without plaintext in audit. |
| Idempotency behavior | None; every reveal is separately audited. |
| Concurrency behavior | Read/decrypt and audit in one transaction; voucher rows immutable. |
| Existing tests | Mock checkpoint/security tests cover owner/admin logic, encryption and audit; no HTTP/permission test. |
| Current status | `MISSING` |
| Reuse recommendation | Reuse service only behind explicit permission, market access and step-up MFA. |
| Phase 7 action required | Define a narrow reveal endpoint and UI; never include code in list/detail/export/logs. |
| Frozen-contract risk | Exposing current service directly to any admin leaks bearer-value secrets. |

### 28. Shipping and fulfilment recovery

| Field | Evidence |
|---|---|
| Capability name | Shipping and fulfilment recovery |
| Source phase | Phase 6 P6-S3/P6-S7/P6-S8 |
| Repository path | `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`; `apps/api/src/redemption/redemption-fulfilment.service.ts`; `apps/api/src/redemption/redemption-refund.service.ts`; `apps/api/src/redemption/redemption.service.ts`; `packages/database/migrations/0026_phase_6_shipping_recovery_v2.sql` |
| Controller / endpoint | Under `/api/v1/admin/redemption/fulfilments`: `POST /`; `PUT /status`; POST `/:fulfilmentId/pickup-code`, `/verify-pickup`, `/retry`; POST `/:orderId/{suspend|resume|backorder|restock}`; POST `/waitlist`; DELETE `/waitlist/:subscriptionId`; POST `/:itemId/notify-waitlist`; POST `/waitlist/:subscriptionId/expire`; GET `/pending`; GET `/:id`. No endpoint exposes `createShippingRecovery` / `processShippingRecovery`. |
| Service / command | `createFulfilment`, `updateStatus`, pickup methods, `retryFulfilment`, suspension/backorder/restock, waitlist methods; refund service recovery methods remain internal/unwired. |
| Database tables | fulfilments, fulfilment exceptions/audit, orders, inventory, pickup locations, waitlist, shipping payment/recovery v1 and v2, redemption audit |
| Required permission | Only `AdminGuard`; seeded `redemption.fulfilment.update` is unused. |
| Market scope | NOT enforced; pending/detail and commands use IDs globally. |
| Audit behavior | Fulfilment/order transitions mostly write domain audit; waitlist notify/expire and some operations do not include admin actor. |
| Idempotency behavior | State/unique constraints; no HTTP idempotency keys. `notifyWaitlist` only marks rows `NOTIFIED`; it sends nothing. |
| Concurrency behavior | Transactions and some transition checks, but not every lookup is locked; recovery functions have DB upsert semantics. |
| Existing tests | Fulfilment 10+41 mock, concurrency 8, security/static 20, real redemption integration/atomicity; no permission/market HTTP test. |
| Current status | `UNSAFE` |
| Reuse recommendation | Reuse domain commands only after permissions/market filtering and recovery API contract are authorized. |
| Phase 7 action required | Add queue/read scope, action permission, market predicates, actor audit and idempotency; expose recovery separately. |
| Frozen-contract risk | Any admin can currently mutate any market’s fulfilment; CORS dev allowlist also omits PUT/DELETE used here. |

### 29. Audit logs

| Field | Evidence |
|---|---|
| Capability name | Audit logs |
| Source phase | Phase 0; domain audit tables in Phases 4–6 |
| Repository path | `apps/api/src/platform-access/audit.controller.ts`; `apps/api/src/platform-access/audit.service.ts`; `apps/api/src/platform-access/audit-redaction.ts`; `packages/database/schema/index.ts`; `packages/database/schema/redemption.ts` |
| Controller / endpoint | `GET /api/v1/admin/audit?entityType=&entityId=&limit=` only. No list-by-actor/action/date/result, no domain federation, no export. |
| Service / command | `AuditService.queryEntity`, `appendWithinTransaction`, `recordPrivilegedAction` |
| Database tables | `audit_logs`, `entity_timelines`; plus transaction audit references, activation logs, commission status events, redemption audit/fulfilment audit |
| Required permission | `audit.view` (seeded). |
| Market scope | Service resolves entity market from merchant branch or existing audit row, then checks active market access. Entities without resolvable market are denied; it is not a global audit viewer. |
| Audit behavior | Audit/timeline tables are append-only with redaction. Viewing audit is not itself audited. |
| Idempotency behavior | None on append; callers must prevent duplicate domain action. |
| Concurrency behavior | Append occurs transactionally with owning action when caller uses `appendWithinTransaction`; some services use separate transactions. |
| Existing tests | Platform access integration and service callers; Admin web offers merchant-branch entity view only. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse writer and redaction; extend read model rather than querying raw tables from UI. |
| Phase 7 action required | Add market-scoped filters/pagination, cross-domain adapters, access-view audit and safe export policy. |
| Frozen-contract risk | Raw audit export can leak KYC, voucher, token or cross-market data. |

### 30. Reports and exports

| Field | Evidence |
|---|---|
| Capability name | Reports and exports |
| Source phase | Basic reports expected Phase 7; advanced reporting Phase 9 |
| Repository path | Repository-wide inspection of `apps/api/src`; representative reads in `apps/api/src/admin-member/admin-member.service.ts`, `apps/api/src/merchant/merchant.service.ts`, `apps/api/src/domain/commission/query.service.ts`, and `apps/api/src/merchant/mcp.service.ts` |
| Controller / endpoint | None for CSV/XLSX/PDF/export jobs or consolidated reports. MCP `/reconcile` is a single-account operational check, not reporting. |
| Service / command | Domain reads such as member/merchant/commission/admin search and MCP reconcile only. |
| Database tables | No report job/export artifact tables. |
| Required permission | None defined for reports/exports. |
| Market scope | Not implemented. |
| Audit behavior | Not implemented. |
| Idempotency behavior | Not implemented. |
| Concurrency behavior | Not implemented. |
| Existing tests | None. |
| Current status | `MISSING` |
| Reuse recommendation | Compose server-owned read models with as-of timestamps; keep advanced risk/analytics out of Phase 7. |
| Phase 7 action required | Define minimal market-scoped operational reports and export redaction/audit/retention. |
| Frozen-contract risk | Recomputing ledger truth in reporting can double-count compensations or cross markets. |

### 31. Existing dashboard endpoints

| Field | Evidence |
|---|---|
| Capability name | Existing dashboard endpoints |
| Source phase | Admin web Phase 1 P1-S8; no backend phase owner |
| Repository path | `apps/admin-web/src/admin-app.tsx`; `apps/api/src/merchant/merchant.controller.ts`; `apps/api/src/merchant/merchant.service.ts` |
| Controller / endpoint | No dashboard API. UI calls `GET /api/v1/admin/markets/:marketId/merchants?limit=20` and computes merchant/active/pending counts from only that page. |
| Service / command | `MerchantService.listMerchants`; client-side array filters. |
| Database tables | Merchant read-model joins only. |
| Required permission | `merchant.view`; no `dashboard.view`. |
| Market scope | Merchant endpoint is correctly route/guard scoped. |
| Audit behavior | Dashboard read not audited. |
| Idempotency behavior | Read-only. |
| Concurrency behavior | Snapshotless paged read; metrics can change and are not totals. |
| Existing tests | Three admin model tests do not cover dashboard; no browser/E2E. |
| Current status | `TEMPORARY` |
| Reuse recommendation | Do not label page-length counts as authoritative metrics; build a dedicated read-only aggregate API. |
| Phase 7 action required | Define metric formulas, permissions, market, as-of/freshness and empty/error behavior. |
| Frozen-contract risk | Client recomputation can misstate operational/financial truth. |

### 32. Market configuration

| Field | Evidence |
|---|---|
| Capability name | Market configuration |
| Source phase | Phase 0 |
| Repository path | `apps/api/src/platform-access/market.service.ts`; `apps/api/src/market/market.controller.ts`; `apps/api/src/market/market.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | No admin market registry controller. Member-only `GET/PATCH /api/v1/members/me/market` changes a member preference and cannot be used for admin configuration. |
| Service / command | `MarketService.list`, `create`, `setStatus`; no registered controller. |
| Database tables | `markets`, `market_access`, audit/timeline; many domain tables reference market ID. |
| Required permission | Seeded `market.view` / `market.manage`, unused by admin endpoint. |
| Market scope | Market registry is global; status affects access. |
| Audit behavior | `market.create`, `market.activate/deactivate` with actor/reason. |
| Idempotency behavior | Code uniqueness; no request key. |
| Concurrency behavior | Transactional writes; no version/lock on status race. |
| Existing tests | One mock market service declaration and platform DB tests; no admin HTTP. |
| Current status | `PARTIAL` |
| Reuse recommendation | Reuse service and global market schema. |
| Phase 7 action required | Expose explicit read/manage API with high-risk activation/deactivation confirmation and dependency checks. |
| Frozen-contract risk | Deactivation can affect all domains; must not be a generic row edit. |

### 33. Merchant service packages

| Field | Evidence |
|---|---|
| Capability name | Merchant service packages |
| Source phase | Phase 1 P1-S5 |
| Repository path | `apps/api/src/merchant/package.controller.ts`; `apps/api/src/merchant/package.service.ts`; `packages/database/schema/index.ts`; `packages/database/migrations/0004_service_fee_package_management.sql` |
| Controller / endpoint | POST `/api/v1/admin/markets/:marketId/packages`; POST `/:packageId/versions`; PATCH `/:packageId/versions/:versionId`, `/activate`, `/cancel`; POST `/merchants/:branchId/packages/assignments`; PATCH `/assignments/:assignmentId/set-default`. |
| Service / command | `createProfile`, `createVersion`, `updateDraftVersion`, `activateVersion`, `cancelVersion`, `assign`, `setDefault` |
| Database tables | `service_fee_profiles`, `service_fee_versions`, `merchant_package_assignments`, `merchant_package_change_requests`, `special_percentages`, audit tables/idempotency keys |
| Required permission | All routes use `merchant.package.manage` market-scoped; seeded but narrower `merchant.package.view/assign` are unused. |
| Market scope | Route grant plus service market/branch/version predicates. |
| Audit behavior | `SERVICE_FEE_*`, `MERCHANT_PACKAGE_ASSIGNED/DEFAULT_SET`, actor/market/reason within transaction. |
| Idempotency behavior | All admin writes require key and canonical replay checking. |
| Concurrency behavior | Transactions, version lifecycle synchronization and locked branch/assignment rows. |
| Existing tests | Merchant integration and DTO tests; Admin web supports create/version/activate/assign/default. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse directly; consider permission least-privilege later. |
| Phase 7 action required | Add list/history UI and effective-time warnings; do not edit active history. |
| Frozen-contract risk | Transaction-time snapshots must remain unchanged. |

### 34. Special merchant percentage support

| Field | Evidence |
|---|---|
| Capability name | Special merchant percentage support |
| Source phase | Phase 1 P1-S5; range frozen under D-010 |
| Repository path | `apps/api/src/merchant/package.controller.ts`; `apps/api/src/merchant/package.service.ts`; `packages/database/schema/index.ts`; `packages/database/migrations/0004_service_fee_package_management.sql` |
| Controller / endpoint | `POST /api/v1/admin/markets/:marketId/special-percentages`; assignment uses the standard assignment route. |
| Service / command | `PackageService.createSpecialPercentage`, `assign` |
| Database tables | `special_percentages`, `merchant_package_assignments`, audit/idempotency |
| Required permission | `merchant.package.manage`, market-scoped. |
| Market scope | Route grant plus service `market_id` checks. |
| Audit behavior | `SPECIAL_PERCENTAGE_CREATED`, assignment audit. |
| Idempotency behavior | Required key and stored replay. |
| Concurrency behavior | Transaction/immutability trigger; assignment locks merchant. |
| Existing tests | Merchant integration/DTO evidence; Admin web exposes rate `>0 and <=100`. |
| Current status | `COMPLETE` |
| Reuse recommendation | Reuse existing validated service. |
| Phase 7 action required | Display range/effective scope and audit; no arbitrary override field. |
| Frozen-contract risk | Direct update or out-of-range value changes transaction and commission inputs. |

### 35. Agent commission configuration

| Field | Evidence |
|---|---|
| Capability name | Agent commission configuration |
| Source phase | Phase 5 |
| Repository path | `apps/api/src/controllers/admin-rate.controller.ts`; `apps/api/src/domain/commission/rate.service.ts`; `packages/database/schema/index.ts`; `packages/database/seeds/agent-commission.ts` |
| Controller / endpoint | Runtime `GET /api/v1/api/v1/admin/commission-rates/active`, `/history`, `/:id`; POST base and `/schedule`. |
| Service / command | `getActiveRates`, `getRateHistory`, `getRateById`, `createRate` |
| Database tables | `commission_rate_version`, commission ledger snapshots, markets (indirectly) |
| Required permission | `commission.rate.read/manage`, not seeded. |
| Market scope | Query/body two-letter market; guard not market-scoped and no `market_access` check. Get-by-ID is completely unscoped. |
| Audit behavior | Rate rows carry creator/reason/snapshot metadata, but no general privileged audit append was found. |
| Idempotency behavior | No request key; overlap checks and uniqueness. |
| Concurrency behavior | Overlap query then insert, without explicit serializable/advisory lock; potential race relies on DB constraints. |
| Existing tests | Commission unit/static tests cover rate validation/history; no admin HTTP/market-access test. |
| Current status | `UNSAFE` |
| Reuse recommendation | Reuse immutable rate service only after route/permission/market/audit hardening. |
| Phase 7 action required | Fix doubled prefix and enforce admin market grant; seed permissions; preserve G1/G2 and effective-time snapshots. |
| Frozen-contract risk | Cross-market rate creation can change future payouts; historical entries must never recalculate. |

### 36. Merchant referral commission configuration

| Field | Evidence |
|---|---|
| Capability name | Merchant referral commission configuration |
| Source phase | Phase 5 |
| Repository path | `apps/api/src/controllers/admin-rate.controller.ts`; `apps/api/src/domain/commission/rate.service.ts`; `apps/api/src/domain/commission/merchant-recruitment.service.ts`; `packages/database/schema/index.ts` |
| Controller / endpoint | Same runtime commission-rate endpoints, using `commissionType=MERCHANT_RECRUITMENT` and generation contract. No dedicated merchant-referral configuration endpoint. |
| Service / command | `RateManagementService.createRate/get*`; `MerchantRecruitmentCommissionService.processMerchantRecruitment` consumes effective version. |
| Database tables | `commission_rate_version`, `merchant_attribution`, `commission_ledger`, processing/results |
| Required permission | `commission.rate.read/manage`, not seeded. |
| Market scope | Client market code only; no admin market access. |
| Audit behavior | Version metadata/domain processing evidence; no platform privileged audit for config. |
| Idempotency behavior | Processing exactly-once canonical keys; rate creation lacks request key. |
| Concurrency behavior | Processing transaction/unique keys; rate overlap race concerns as item 35. |
| Existing tests | C integration 10 and B regression prove attribution/posting; config HTTP access is untested. |
| Current status | `UNSAFE` |
| Reuse recommendation | Reuse one-generation frozen source and rate service after access hardening. |
| Phase 7 action required | Do not add attribution reassignment; expose only versioned rate schedule when authorized. |
| Frozen-contract risk | Attribution-change policy is open and merchant recruitment is one generation only. |

### 37. Notifications relevant to Admin operations

| Field | Evidence |
|---|---|
| Capability name | Notifications relevant to Admin operations |
| Source phase | Fragment in Phase 6 waitlist; general admin notification capability not implemented |
| Repository path | `apps/api/src/redemption/redemption-fulfilment.service.ts`; `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`; `apps/api/src/transaction/transaction-commission-outbox.worker.ts` |
| Controller / endpoint | `POST /api/v1/admin/redemption/fulfilments/:itemId/notify-waitlist`; no admin alert inbox, email/push/in-app send, template, preference or delivery endpoint. |
| Service / command | `notifyWaitlist` only updates ACTIVE rows to `NOTIFIED`; it does not send or enqueue a message. `checkAndNotifyWaitlist` is internal. |
| Database tables | `redemption_waitlist_entries`; no general notification/delivery/outbox table. |
| Required permission | Only admin identity; no notification permission or market grant. |
| Market scope | Item ID query; no admin market access and service does not verify item/entry market before global update. |
| Audit behavior | Notify operation has no actor/audit record. |
| Idempotency behavior | Status prevents re-notifying already NOTIFIED rows; no delivery idempotency. |
| Concurrency behavior | Transaction loops and updates rows; no lock/skip-locked. |
| Existing tests | Waitlist/mock fulfilment tests; no real delivery test because no delivery exists. |
| Current status | `TEMPORARY` |
| Reuse recommendation | Treat as waitlist state transition only, not notification delivery. |
| Phase 7 action required | Define admin operational alerts and delivery/outbox scope; no real sends without explicit approval. |
| Frozen-contract risk | UI must not claim members were notified when only a DB status changed. |

### 38. Existing risk indicators

| Field | Evidence |
|---|---|
| Capability name | Existing risk indicators |
| Source phase | Scattered Phase 0–6 signals; formal risk operations deferred to Phase 9 |
| Repository path | `packages/database/schema/index.ts`; `packages/database/schema/redemption.ts`; `apps/api/src/platform-access/audit.service.ts`; `apps/api/src/domain/commission/security.service.ts`; `apps/api/src/transaction/transaction-reliability.ts`; `apps/api/src/redemption/redemption-fulfilment.service.ts` |
| Controller / endpoint | No risk module/API. Signals can be inferred from admin member/merchant lists, audit entity lookup, reward job placeholder (not trustworthy), commission processing data (unsafe route), and global redemption pending/exception data. |
| Service / command | No risk aggregation/case command. `CommissionSecurityService` exposes internal validation helpers, not an admin risk engine. |
| Database tables | `security_events`, status histories, correction requests, transaction idempotency/audit, `daily_job_runs`, commission processing/results, fulfilment exceptions, shipping recovery, audit tables |
| Required permission | No `risk.view/manage` codes. Domain permissions vary and several are missing/unsafe. |
| Market scope | Each domain stores market differently; no unified enforced risk query. |
| Audit behavior | Source events are auditable in their domains; no risk case/decision audit. |
| Idempotency behavior | Source operations vary; no risk-case idempotency. |
| Concurrency behavior | Source domains vary; no risk workflow. |
| Existing tests | Domain tests cover individual failure flags; no risk indicator/case integration tests. |
| Current status | `PARTIAL` |
| Reuse recommendation | Phase 7 may show read-only existing flags with provenance; rule-based case workflow/advanced analytics belongs to later authorization. |
| Phase 7 action required | Define a minimal read-only indicator contract or classify as Phase 9; do not invent scoring/AI decisions. |
| Frozen-contract risk | Reinterpreting source flags as automated risk decisions could suspend users or financial activity without approved rules. |

## 4. Admin API matrix summary

Legend: **Actor** `A` = authenticated admin required, `I` = admin identity only, `P` = action permission; **Market** `R` = route `:marketId` + RBAC grant, `S` = service-level grant/predicate, `N` = not enforced, `G` = global identity. **MC** = Maker/Checker. “Test” describes the strongest evidence. All paths are runtime paths after the global prefix.

### 4.1 Registered and reachable routes

| Endpoint | Method | Permission | Actor | Market | MC | Audit | Idempotency / concurrency | Test coverage | UI coverage | Owning phase | Frozen / modifiable |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/auth/login` | POST | none | account credential | G | no | security event | rate limit; session transaction | real HTTP/DB | login form | P0/P2 | auth contract frozen; adapter only |
| `/api/v1/auth/refresh` | POST | none | refresh token | G | no | security event | atomic rotation/reuse detection | real HTTP/DB | API client automatic refresh | P0/P2 | frozen |
| `/api/v1/auth/logout` | POST | authenticated | any session | G | no | security event | revoke | real HTTP/DB | no visible logout control | P0/P2 | frozen |
| `/api/v1/admin/members` | GET | `member.read` | P | S | no | none on read | read-only | real HTTP/DB | none | P2 | frozen owner; Phase 7 UI modifiable |
| `/api/v1/admin/members/:publicMemberId` | GET | `member.read` | P | S | no | none on read | read-only | real HTTP/DB | none | P2 | same |
| `/api/v1/admin/members/:publicMemberId/suspend` | POST | `member.status.manage` | P | S | no | status + privileged | locked transaction | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/members/:publicMemberId/reactivate` | POST | `member.status.manage` | P | S | no | status + privileged | locked transaction | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/members/:publicMemberId/close` | POST | `member.status.manage` | P | S | no | status + privileged | locked transaction | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/members/:publicMemberId/revoke-sessions` | POST | `member.session.revoke` | P | S | no | `member.sessions.revoke` | transaction | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/members/:publicMemberId/require-reverification` | POST | `member.reverification.require` | P | S | no | KYC history + audit | locked transition | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/members/:publicMemberId/notes` | POST | `member.note.create` | P | S | no | `member.note.add` | append-only | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/members/:publicMemberId/notes` | GET | `member.note.read` | P | S | no | none on read | read-only | real HTTP/DB | none | P2 | frozen read |
| `/api/v1/admin/kyc/cases` | GET | `member.kyc.review` (not seeded) | P | S | no | none on read | read-only | real HTTP/DB | none | P2 | frozen owner |
| `/api/v1/admin/kyc/cases/:id` | GET | same | P | S | no | none on read | read-only | real HTTP/DB | none | P2 | frozen owner |
| `/api/v1/admin/kyc/cases/:id/start-review` | POST | same | P | S | no | history + audit | row lock | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/kyc/cases/:id/request-more-info` | POST | same | P | S | no | history + audit | row lock | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/kyc/cases/:id/approve` | POST | same | P | S | no | history + audit | row lock | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/kyc/cases/:id/reject` | POST | same | P | S | no | history + audit | row lock | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/kyc/cases/:id/require-reverification` | POST | same | P | S | no | history + audit | row lock | real HTTP/DB | none | P2 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants` | GET | `merchant.view` | P | R | no | none | read-only | broad real integration | merchant + overview | P1 | frozen owner |
| `/api/v1/admin/markets/:marketId/merchants/applications` | GET | `merchant.view` | P | R | no | none | read-only | broad real integration | reviews | P1 | frozen owner |
| `/api/v1/admin/markets/:marketId/merchants/kyc` | GET | `merchant.kyc.view` | P | R | no | none | read-only | broad real integration | reviews | P1 | frozen owner |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/kyc/review` | GET | `merchant.kyc.approve` | P | R | no | review-started | read | broad real integration | reviews | P1 | frozen owner |
| same KYC review path | POST | `merchant.kyc.approve` | P | R | no | reviewed | key + row lock | broad real integration | reviews | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/application/review` | POST | `merchant.approve` | P | R | no | application review | key + row lock | broad real integration | reviews | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/suspend` | POST | `merchant.suspend` | P | R | no | status + audit | key + row lock | broad real integration | merchants | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/reactivate` | POST | `merchant.suspend` | P | R | no | status + audit | key + row lock | broad real integration | merchants | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/close` | POST | `merchant.close` | P | R | no | status + audit | key + row lock | broad real integration | none | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/packages` | POST | `merchant.package.manage` | P | R | no | profile created | key + transaction | broad integration | packages | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/packages/:packageId/versions` | POST | same | P | R | no | version created | key + transaction | broad integration | packages | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/packages/:packageId/versions/:versionId` | PATCH | same | P | R | no | version updated | key + lifecycle sync | broad integration | none | P1 | draft only |
| `/api/v1/admin/markets/:marketId/packages/:packageId/versions/:versionId/activate` | PATCH | same | P | R | no | version activated | key + transaction | broad integration | packages | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/packages/:packageId/versions/:versionId/cancel` | PATCH | same | P | R | no | version cancelled | key + transaction | broad integration | none | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/special-percentages` | POST | same | P | R | no | special created | key + immutable row | broad integration | packages | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/packages/assignments` | POST | same | P | R | no | assignment audit | key + branch lock | broad integration | packages | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/packages/assignments/:assignmentId/set-default` | PATCH | same | P | R | no | default audit | key + branch lock | broad integration | packages | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/mcp/accounts/:accountId` | GET | `merchant.mcp.view` | P | R | no | none | read | broad integration | MCP | P1 | frozen read |
| `/api/v1/admin/markets/:marketId/mcp/accounts/:accountId/ledger` | GET | same | P | R | no | none | read | broad integration | MCP | P1 | frozen read |
| `/api/v1/admin/markets/:marketId/mcp/accounts/:accountId/reconcile` | GET | same | P | R | no | none | read | broad integration | none | P1 | frozen read |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/recharge` | POST | `merchant.mcp.recharge.review` | P | R | no | recharge requested | key + transaction | broad integration | MCP | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/recharge/:requestId/review` | POST | same | P | R | no | recharge review | request lock | broad integration | MCP | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/mcp/accounts/:accountId/adjustments` | POST | `merchant.mcp.adjust` | P | R | maker | request/audit | key + transaction | broad integration | none | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/adjustments` | POST | same | P | R | maker | request/audit | key + transaction | broad integration | MCP | P1 | alias |
| `/api/v1/admin/markets/:marketId/mcp/adjustments/:requestId/submit` | POST | same | P | R | maker | request/audit | request lock | broad integration | MCP | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/mcp/adjustments/:requestId/decision` | POST | `merchant.mcp.adjust.approve` | P | R | checker | decision/audit | request lock | broad integration | none | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/adjustments/:requestId/approve` | POST | same | P | R | checker | decision/audit | request lock | broad integration | MCP | P1 | alias |
| `/api/v1/admin/markets/:marketId/adjustments/:requestId/execute` | POST | `merchant.mcp.adjust.execute` | P | R | separate executor | ledger/audit | exactly-once + lock | broad integration | MCP | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/merchants/:branchId/refund` | POST | `merchant.refund.manage` | P | R | no | refund requested | key + transaction | broad integration | MCP | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/mcp/refunds/:requestId/review` | POST | same | P | R | no | review/audit | request lock | broad integration | none | P1 | frozen command |
| `/api/v1/admin/markets/:marketId/refund/:requestId/review` | POST | same | P | R | no | review/audit | request lock | broad integration | MCP | P1 | alias |
| `/api/v1/admin/rewards/rules` | GET | `reward.rule.read` (not seeded) | P | N | no | none | read | mock only | none | P3 | frozen; unsafe adapter |
| `/api/v1/admin/rewards/rules/:id` | GET | same | P | N | no | none | read | mock only | none | P3 | same |
| `/api/v1/admin/rewards/rules/:id/versions` | GET | same | P | N | no | none | read | mock only | none | P3 | same |
| `/api/v1/admin/rewards/rules` | POST | `reward.rule.create` (not seeded) | P | N | no | separate audit transaction | none / no overlap lock | mock only | none | P3 | blocked |
| `/api/v1/admin/rewards/jobs` | GET | `reward.job.read` (not seeded) | P | N | no | none | placeholder | mock only | none | P3 | temporary |
| `/api/v1/admin/rewards/jobs/:id` | GET | same | P | N | no | none | placeholder | mock only | none | P3 | temporary |
| `/api/v1/admin/rewards/wallets/:id/adjustment` | POST | `wallet.adjustment.create` (not seeded) | P | S | **no, required** | wallet audit | key + wallet lock | mock only | none | P3 | blocked/unsafe |
| `/api/v1/api/v1/admin/agent-activations/:id/approve` | POST | `agent.activation.manage` (not seeded) | P | N | no | status actor only | state check; commission error hidden | dead-service tests | none | P5 | frozen/unsafe |
| `/api/v1/api/v1/admin/agent-activations/:id/reject` | POST | same | P | N | no | admin actor ID missing | state check | dead-service tests | none | P5 | frozen/unsafe |
| `/api/v1/api/v1/admin/agent-activations/:id/suspend` | POST | same | P | N | no | admin actor ID missing | state check | dead-service tests | none | P5 | frozen/unsafe |
| `/api/v1/api/v1/admin/agent-activations/:id/reactivate` | POST | same | P | N | no | system/null actor | state check | dead-service tests | none | P5 | frozen/unsafe |
| `/api/v1/api/v1/admin/agent-activations/:id/deactivate` | POST | same | P | N | no | admin actor ID missing | state check | dead-service tests | none | P5 | frozen/unsafe |
| `/api/v1/api/v1/admin/commission/ledger` | GET | `commission.admin` (not seeded) | P | N | no | none on read | read | mock/static | none | P5 | frozen/unsafe adapter |
| `/api/v1/api/v1/admin/commission/audit` | GET | same | P | N | no | reads status events | read | mock/static | none | P5 | same |
| `/api/v1/api/v1/admin/commission/reprocess` | POST | same | P | N | no | no platform action audit | domain canonical key | domain integration only | none | P5 | blocked/unsafe |
| `/api/v1/api/v1/admin/commission-rates/active` | GET | `commission.rate.read` (not seeded) | P | N | no | none | read | mock/static | none | P5 | frozen/unsafe adapter |
| `/api/v1/api/v1/admin/commission-rates/history` | GET | same | P | N | no | none | read | mock/static | none | P5 | same |
| `/api/v1/api/v1/admin/commission-rates/:id` | GET | same | P | N | no | none | read | mock/static | none | P5 | same |
| `/api/v1/api/v1/admin/commission-rates` | POST | `commission.rate.manage` (not seeded) | P | N | no | row metadata only | overlap validation | mock/static | none | P5 | blocked/unsafe |
| `/api/v1/api/v1/admin/commission-rates/schedule` | POST | same | P | N | no | row metadata only | overlap validation | mock/static | none | P5 | blocked/unsafe |
| `/api/v1/admin/audit` | GET | `audit.view` | P | S | no | reads append-only logs | read | platform integration | audit page | P0 | modifiable read adapter |
| `/api/v1/admin/redemption/refunds` | POST | none beyond identity | I | N | maker intent only | refund requested, market null | one-order state | mock/harness | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/refunds/approve` | POST | none beyond identity | I | N | service checks distinct IDs | refund executed, market null | row lock; wallet gap | mock/harness | none | P6 | frozen/blocked |
| `/api/v1/admin/redemption/refunds/reject` | POST | none beyond identity | I | N | service checks distinct IDs | rejected, market null | row lock | mock/harness | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/refunds/pending` | GET | none beyond identity | I | N | no | none | global read | mock/harness | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/refunds` | GET | none beyond identity | I | N | no | none | global read | mock/harness | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/refunds/:id` | GET | none beyond identity | I | N | no | none | global read | mock/harness | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/refunds/order/:orderId` | GET | none beyond identity | I | N | no | none | global read | mock/harness | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments` | POST | none beyond identity | I | N | no | fulfilment audit | transaction | mock + domain integration | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/status` | PUT | none beyond identity | I | N | no | fulfilment audit | state transition | mock + domain integration | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:fulfilmentId/pickup-code` | POST | none beyond identity | I | N | no | limited | state/unique | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:fulfilmentId/verify-pickup` | POST | none beyond identity | I | N | no | fulfilment audit | single-use code | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:fulfilmentId/retry` | POST | none beyond identity | I | N | no | retry audit | retry count/state | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:orderId/suspend` | POST | none beyond identity | I | N | no | order audit | transition | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:orderId/resume` | POST | none beyond identity | I | N | no | order audit | transition | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:orderId/backorder` | POST | none beyond identity | I | N | no | order audit | transition | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:orderId/restock` | POST | none beyond identity | I | N | no | order audit | transition | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/waitlist` | POST | none beyond identity | I | N | no | none | duplicate state check | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/waitlist/:subscriptionId` | DELETE | none beyond identity | I | N | no | cancel audit | state transition | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:itemId/notify-waitlist` | POST | none beyond identity | I | N | no | none | marks state only | mock | none | P6 | temporary/unsafe |
| `/api/v1/admin/redemption/fulfilments/waitlist/:subscriptionId/expire` | POST | none beyond identity | I | N | no | none | state transition | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/pending` | GET | none beyond identity | I | N | no | none | global read | mock | none | P6 | frozen/unsafe |
| `/api/v1/admin/redemption/fulfilments/:id` | GET | none beyond identity | I | N | no | none | global read | mock | none | P6 | frozen/unsafe |

### 4.2 Declared but unreachable routes

| Endpoint | Method | Declared permission | Break in call path | Test/UI coverage | Owning phase | Required treatment |
|---|---|---|---|---|---|---|
| `/api/v1/admin/redemption/catalog` | POST | `redemption.catalog.manage` | `AdminRedemptionController` absent from `RedemptionModule.controllers` | service tests; no HTTP/UI | P6 | Do not claim operational |
| `/api/v1/admin/redemption/catalog/:itemId` | PUT | same | same | same | P6 | same |
| `/api/v1/admin/redemption/catalog/:itemId/status` | POST | same | same | same | P6 | same |
| `/api/v1/admin/redemption/market/:marketId/catalog` | GET | same | same; permission also not market-scoped | same | P6 | same |
| `/api/v1/admin/redemption/catalog/:itemId` | GET | same | same | same | P6 | same |
| `/api/v1/admin/redemption/market/:marketId/rates` | POST | `redemption.rate.manage` | same; permission not market-scoped | service tests; no HTTP/UI | P6 | same |
| same rate path | GET | same | same | same | P6 | same |
| `/api/v1/admin/redemption/rates/:rateId/cancel` | POST | same | same | same | P6 | same |
| `/api/v1/admin/redemption/market/:marketId/pickup-locations` | POST | `redemption.pickup.manage` | same | service tests; no HTTP/UI | P6 | same |
| same pickup collection path | GET | same | same | same | P6 | same |
| `/api/v1/admin/redemption/pickup-locations/:locationId` | PUT | same | same | same | P6 | same |
| same pickup item path | GET | same | same | same | P6 | same |
| `/api/v1/api/v1/admin/commission-adjustments` | POST | `commission.adjustment.maker` | `AdminAdjustmentController` absent from `CommissionModule.controllers` | service/mock only | P5 | Do not claim Maker API exists |
| `/api/v1/api/v1/admin/commission-adjustments/:id/approve` | POST | `commission.adjustment.checker` | same | service/mock only | P5 | same |
| `/api/v1/api/v1/admin/commission-adjustments/:id/reject` | POST | same | same | service/mock only | P5 | same |

### 4.3 UI coverage summary

`apps/admin-web` covers shared login, market-context entry, merchant list/status, merchant application/KYC review, package/version/special-percentage/assignment actions, MCP account/ledger/recharge/refund/adjustment, and merchant-entity audit. It has no pages for admin users/RBAC/market grants, member operations/KYC, agents, wallets/iPoint Maker/Checker, transactions, rewards/jobs, commission, redemption, reports/exports, notifications or risk. The overview is not a dashboard API; it counts at most 20 returned merchant rows. The only tests are three pure model tests.

## 5. Duplicate, conflicting, temporary and unsafe findings

| Severity | Classification | Finding | Exact evidence | Phase 7 consequence |
|---|---|---|---|---|
| P0 | `UNSAFE` | Redemption refund approval marks an order `REFUNDED` and restores inventory, but the implementation explicitly leaves member-wallet credit as a production TODO. | `apps/api/src/redemption/redemption-refund.service.ts` (`executeAtomicRefund`) | Do not expose or reuse this command until the frozen P6 owner supplies an approved corrective contract and complete atomic refund. |
| P0 | `UNSAFE` | Admin iPoint adjustment is a one-person immediate mutation, although the frozen baseline requires Maker/Checker. | `apps/api/src/admin-reward/admin-reward.controller.ts`; `apps/api/src/admin-reward/admin-reward.service.ts`; D-029 | Phase 7 must not present this as an approved admin operation. Remediation belongs to the frozen P3 contract owner. |
| P0 | Conflicting route | The application has global prefix `/api/v1`, while Phase 5 admin controllers also declare `api/v1/admin/...`; their actual routes are `/api/v1/api/v1/admin/...`. | `apps/api/src/app.setup.ts`; `apps/api/src/controllers/admin-agent-activation.controller.ts`; `apps/api/src/controllers/admin-commission.controller.ts`; `apps/api/src/controllers/admin-rate.controller.ts` | Treat the intended single-prefix routes as absent. Any correction changes frozen P5 HTTP contracts and needs explicit authorization. |
| P0 | Missing authorization | Refund and fulfilment controllers check only `AdminGuard`; they do not require an action permission or enforce market access. Reads can be global and writes accept identifiers without an authorized-market predicate. | `apps/api/src/redemption/redemption-admin-refund.controller.ts`; `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts` | Block UI exposure. Define least-privilege permission and market-scope contracts first. |
| P1 | Unreachable | Catalog, rate and pickup-location admin routes are declared but their controller is absent from `RedemptionModule.controllers`. | `apps/api/src/redemption/admin-redemption.controller.ts`; `apps/api/src/redemption/redemption.module.ts` | Record as missing runtime API, not reusable operational capability. |
| P1 | Unreachable | Commission adjustment Maker/Checker routes are declared in a second controller class, but that controller is absent from `CommissionModule.controllers`. | `apps/api/src/controllers/admin-commission.controller.ts`; `apps/api/src/commission/commission.module.ts` | Do not claim that commission Maker/Checker HTTP operations exist. |
| P1 | Permission conflict | Controllers require permission strings that are not present in the foundation seed: `member.kyc.review`, `reward.*`, `wallet.adjustment.create`, `agent.activation.manage`, and `commission.*`. | Controller decorators above; `packages/database/seeds/foundation.ts` | Standard seeded environments cannot be assumed to grant these operations. Reconcile through approved RBAC governance, not hard-coded bypasses. |
| P1 | `DUPLICATED` | Two different `AgentActivationService` implementations exist. The module wires `service.ts`, while the 38-test spec imports `agent-activation.service.ts`. | `apps/api/src/domain/agent-activation/service.ts`; `apps/api/src/domain/agent-activation/agent-activation.service.ts`; `apps/api/src/agent-activation/agent-activation.module.ts`; `apps/api/src/domain/agent-activation/agent-activation.service.spec.ts` | Existing test volume does not prove the live service. Frozen P5 ownership must resolve the duplicate before Phase 7 reuse. |
| P1 | `UNSAFE` | Live agent approval starts commission creation in a separate call and suppresses the error; reject/suspend/deactivate omit the admin actor ID, and no market-access predicate is applied. | `apps/api/src/domain/agent-activation/service.ts`; controller above | Do not build operational UI over this path until atomicity, attribution and scope are corrected by the owning phase. |
| P1 | `TEMPORARY` | Reward-job endpoints fabricate completed zero-count jobs from rule-version rows instead of reading a job model. | `apps/api/src/admin-reward/admin-reward.service.ts` | Label as placeholder; exclude from dashboard/job recovery claims. |
| P1 | `TEMPORARY` | Waitlist notification only changes subscription status to `NOTIFIED`; it does not send or enqueue a notification. | `apps/api/src/redemption/redemption-fulfilment.service.ts` | Phase 7 may display the state only with an explicit warning; it must not claim delivery. |
| P1 | OpenAPI gap | No generated OpenAPI artifact is committed; the runtime consistency validator explicitly validates 23 auth paths, not the complete admin surface. Several admin controllers lack operation-level Swagger metadata. | `apps/api/src/app.setup.ts`; `apps/api/src/__tests__/openapi-consistency.spec.ts`; merchant/package/MCP controllers | Generate and validate the complete registered admin path set before UI client generation or contract acceptance. |
| P1 | UI/API conflict | Non-production CORS permits `GET,POST,PATCH,OPTIONS`, while registered redemption admin routes use `PUT` and `DELETE`. | `apps/api/src/main.ts`; fulfilment/controller routes | Browser calls to those routes can fail even before authorization; treat the UI surface as unavailable. |
| P2 | Misleading dashboard | The admin overview fetches a merchant page with `limit=20` and derives counts client-side; no aggregate dashboard API exists. | `apps/admin-web/src/admin-app.tsx` | Do not present the figures as platform totals. A scoped aggregate contract is required. |
| P2 | Missing operations | There is no admin transaction search/action API, order search, report/export API, voucher reveal controller, notification delivery console, or consolidated risk-case API. Member/merchant transaction routes explicitly require `ACCOUNT`, so they are not admin substitutes. | `apps/api/src/transaction/transaction.controller.ts`; `apps/api/src/transaction/member-transaction.controller.ts`; voucher reveal method in `apps/api/src/redemption/redemption.service.ts`; repository-wide controller/module search | Keep these capabilities `MISSING`; do not reuse member/merchant routes with admin tokens. |

### 5.1 Phase 7 reuse boundary

The strongest reusable vertical slices are the Phase 2 admin member and member-KYC services and the Phase 1 merchant/package/MCP administration flows because they combine explicit permissions, server-side market enforcement, privileged audit, idempotency/locking where money moves, real HTTP/PostgreSQL tests, and existing UI coverage. Reuse still requires preserving their frozen contracts.

All Phase 3 reward/wallet, Phase 5 agent/commission and Phase 6 redemption administration adapters remain frozen-domain dependencies. P7 may design a facade or UI around an approved contract, but this audit is not authorization to repair, register, rename or replace those routes. Identity-only admin guards, client-supplied market values, mock-only tests and source declarations without module registration are not sufficient evidence of an operational admin capability.

## 6. Evidence index

### 6.1 Governance and planning

- `AGENTS.md`
- `docs/00-master/PROJECT_MASTER_CONTROL.md`
- `docs/00-master/DOCUMENT_AUTHORITY.md`
- `docs/00-master/OPENCLAW_OPERATING_RULES.md`
- `docs/00-master/BASELINE_ACKNOWLEDGMENT_V1.1.md`
- `docs/00-master/DECISION_LOG.md` (D-028 through D-045)
- `docs/00-master/OPEN_QUESTIONS.md`
- `docs/00-master/PHASE_REGISTRY.md`
- `docs/04-engineering/CODEX_WORKFLOW_RULES.md`
- `docs/06-phase-reports/p7-s0/P7-S0A_GOVERNANCE_AND_FROZEN_DOMAIN_AUDIT.md` from Git commit `586c108d`

### 6.2 Bootstrap, authentication, RBAC and OpenAPI

- `apps/api/src/main.ts`
- `apps/api/src/app.setup.ts`
- `apps/api/src/__tests__/openapi-consistency.spec.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/auth.service.spec.ts`
- `apps/api/src/auth/auth.controller.spec.ts`
- `apps/api/src/auth/auth.integration.spec.ts`
- `apps/api/src/auth/auth.http.integration.spec.ts`
- `apps/api/src/__tests__/auth.performance.spec.ts`
- `apps/api/src/platform-access/platform-access.module.ts`
- `apps/api/src/platform-access/access-administration.service.ts`
- `apps/api/src/platform-access/market.service.ts`
- `apps/api/src/platform-access/audit.controller.ts`
- `apps/api/src/platform-access/platform-access.spec.ts`
- `apps/api/src/platform-access/platform-access.integration.spec.ts`
- `apps/api/src/auth/auth.guard.ts`
- `apps/api/src/auth/admin.guard.ts`
- `apps/api/src/platform-access/rbac.guard.ts`
- `apps/api/src/platform-access/rbac.service.ts`

### 6.3 Member, merchant, package and MCP administration

- `apps/api/src/admin-member/admin-member.controller.ts`
- `apps/api/src/admin-member/admin-member.service.ts`
- `apps/api/src/admin-member/admin-member.service.spec.ts`
- `apps/api/src/admin-member/admin-member.http.integration.spec.ts`
- `apps/api/src/admin-kyc/admin-kyc.controller.ts`
- `apps/api/src/admin-kyc/admin-kyc.service.ts`
- `apps/api/src/admin-kyc/admin-kyc.service.spec.ts`
- `apps/api/src/admin-kyc/admin-kyc.http.integration.spec.ts`
- `apps/api/src/merchant/merchant.controller.ts`
- `apps/api/src/merchant/merchant.service.ts`
- `apps/api/src/merchant/__tests__/merchant.service.spec.ts`
- `apps/api/src/merchant/__tests__/merchant.integration.spec.ts`
- `apps/api/src/merchant/package.controller.ts`
- `apps/api/src/merchant/package.service.ts`
- `apps/api/src/merchant/mcp.controller.ts`
- `apps/api/src/merchant/mcp.service.ts`

### 6.4 Reward, wallet and transaction

- `apps/api/src/admin-reward/admin-reward.controller.ts`
- `apps/api/src/admin-reward/admin-reward.service.ts`
- `apps/api/src/admin-reward/admin-reward.service.spec.ts`
- `apps/api/src/reward/reward.service.ts`
- `apps/api/src/daily-job/job.service.ts`
- `apps/api/src/wallet/wallet.service.ts`
- `apps/api/src/reward/reward.service.spec.ts`
- `apps/api/src/daily-job/job.service.spec.ts`
- `apps/api/src/wallet/wallet.service.spec.ts`
- `apps/api/src/__tests__/timezone.integration.spec.ts`
- `apps/api/src/transaction/transaction.controller.ts`
- `apps/api/src/transaction/member-transaction.controller.ts`
- `apps/api/src/transaction/transaction-read.service.ts`
- `apps/api/src/transaction/__tests__/transaction-read.spec.ts`
- `apps/api/src/transaction/__tests__/transaction-preview.integration.spec.ts`
- `apps/api/src/transaction/__tests__/transaction-correction.acceptance.integration.spec.ts`
- `apps/api/src/transaction/__tests__/transaction-hardening.spec.ts`

### 6.5 Agent and commission

- `apps/api/src/controllers/admin-agent-activation.controller.ts`
- `apps/api/src/domain/agent-activation/service.ts`
- `apps/api/src/domain/agent-activation/agent-activation.service.ts`
- `apps/api/src/agent-activation/agent-activation.module.ts`
- `apps/api/src/domain/agent-activation/agent-activation.service.spec.ts`
- `apps/api/src/controllers/admin-commission.controller.ts`
- `apps/api/src/controllers/admin-rate.controller.ts`
- `apps/api/src/commission/commission.module.ts`
- `apps/api/src/domain/commission/query.service.ts`
- `apps/api/src/domain/commission/rate.service.ts`
- `apps/api/src/domain/commission/adjustment.service.ts`
- `apps/api/src/domain/commission/commission.service.spec.ts`
- `apps/api/src/domain/commission/concurrency.spec.ts`
- `apps/api/src/__tests__/b-transaction-commission.integration.spec.ts`
- `apps/api/src/__tests__/c-merchant-attribution.integration.spec.ts`
- `apps/api/src/__tests__/d-correction-compensation.integration.spec.ts`

### 6.6 Redemption and fulfilment

- `apps/api/src/redemption/redemption.module.ts`
- `apps/api/src/redemption/admin-redemption.controller.ts`
- `apps/api/src/redemption/redemption-admin-refund.controller.ts`
- `apps/api/src/redemption/redemption-admin-fulfilment.controller.ts`
- `apps/api/src/redemption/redemption.controller.ts`
- `apps/api/src/redemption/redemption.service.ts`
- `apps/api/src/redemption/redemption-refund.service.ts`
- `apps/api/src/redemption/redemption-fulfilment.service.ts`
- `apps/api/src/redemption/redemption-integration.spec.ts`
- `apps/api/src/redemption/redemption-p6-atomicity.spec.ts`

### 6.7 Database and admin UI

- `packages/database/schema/index.ts`
- `packages/database/schema/redemption.ts`
- `packages/database/seeds/foundation.ts`
- `packages/database/migrations/0001_auth_session_access_expiry.sql`
- `packages/database/tests/database.integration.test.ts`
- `apps/admin-web/src/main.tsx`
- `apps/admin-web/src/admin-app.tsx`
- `apps/admin-web/src/admin-model.ts`
- `apps/admin-web/src/**/*.test.ts`

## 7. Document status

**DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**

This inventory records repository evidence at base SHA `99c35c7c5581747a8eb8b9e6600b4489691c4fa0`. It is not a Phase 7 implementation brief, does not change any Phase 3–6 frozen contract, and does not authorize production code, schema, migration, test, CI, route, permission or UI changes.
