# P7-S2C-STEPUP-FIX — Step-Up Action-Class Case Alignment

| Field        | Value                                                             |
| ------------ | ----------------------------------------------------------------- |
| Task ID      | `P7-S2C-STEPUP-FIX`                                                |
| Executor     | `OPENCLAW_MANAGED_CODING_SUBAGENT` (implementer; D-048)            |
| Governing    | D-048 continuing authority; P7-S2 delivery report §8 security      |
| Branch       | `fix/p7-s2-stepup-action-class`                                    |
| Worktree     | `.local/wt-p7-s2fix`                                               |
| Base SHA     | `11088babd5c8c6be651418030fbfa95c06853539` (phase branch HEAD;     |
|              | task-stated `06f00964a8f640da397064377a4731d3b01cb80e` is two      |
|              | docs/merge commits behind and contained within this base)          |
| Fix type     | Code-level normalization — **no migration created**                |
| Status       | Implemented, tested, committed locally. **Not pushed.**            |

## 1. Defect (root cause)

The step-up MFA flow stores `admin_step_up_grants.action_class` in a case
that the `RbacGuard` lookup never matches, so every step-up-protected action
(evidence view today; financial actions in P7-S7/S8) is **always denied**
(403 `MFA_STEP_UP_REQUIRED`) in the real flow. Exact divergence chain:

1. **Wire contract rejects canonical codes** —
   `apps/api/src/auth/auth.dto.ts` `adminStepUpStartSchema.action_class`
   regex `/^[A-Z0-9_:.]+$/u` allowed **UPPER_CASE only**. The real client
   (`apps/admin-web/src/kyc-evidence-panel.tsx:98`) sends the canonical
   **lowercase** catalog permission code (e.g. `member.kyc.evidence.view`),
   so `POST /auth/admin/mfa/step-up/challenge` answered **400** and step-up
   could not even begin. The regex also excluded `-`, rejecting the
   canonical `audit.sensitive-diff.view` outright.
2. **No normalization at grant creation** —
   `apps/api/src/auth/admin-auth.service.ts` `beginStepUp` stored the raw
   client value in `request_context.actionClass`; `verifyStepUp` copied it
   verbatim into `admin_step_up_grants.action_class`.
3. **Guard lookup uses canonical lowercase** —
   `apps/api/src/platform-access/rbac.service.ts:118` consumes grants with
   `AND action_class = $4` bound to the canonical lowercase permission code
   from the decorator catalog. Stored uppercase/mixed values never match →
   fail-closed 403 on every real-flow grant.
4. **Secondary inconsistency** — the assisted-MFA-reset consumer
   (`admin-auth.service.ts` private `consumeStepUpGrant`, called with the
   hard-coded legacy purpose code `ADMIN_MFA_RESET`) used a non-catalog
   value, so the MFA-reset step-up contract was also not aligned to the
   canonical `admin.mfa.reset` catalog permission.

The P7-S2C integration suites passed only because tests seeded
`admin_step_up_grants` rows directly with the canonical lowercase
`action_class` (e.g. `seedStepUpGrant` in the P7-S5C kyc-ops spec), which is
why the defect was not caught by the original suites.

## 2. Affected action classes (all step-up-required catalog permissions)

All 17 catalog permissions with `stepUpRequired: true` were affected
(`packages/database/src/permission-catalog.ts`):

`admin.user.manage`, `admin.mfa.reset`, `admin.session.revoke.any`,
`rbac.role.assign`, `rbac.permission.assign`, `rbac.market.grant`,
`market.manage`, `member.kyc.evidence.view`,
`merchant.kyc.evidence.view`, `merchant.special_package.manage`,
`merchant.mcp.adjust.approve`, `merchant.mcp.adjust.execute`,
`wallet.ipoint.adjust.checker`, `wallet.ipoint.adjust.execute`,
`redemption.refund.approve`, `redemption.voucher.reveal`,
`audit.sensitive-diff.view`.

## 3. Fix (single source of truth at grant creation AND at guard lookup)

1. `apps/api/src/auth/auth.constants.ts` — new exported
   `normalizeActionClass(value)` = `value.trim().toLowerCase()`. This is the
   single normalization point shared by grant creation and every consumer.
2. `apps/api/src/auth/auth.dto.ts` — `action_class` regex widened to
   `/^[A-Za-z0-9_:.-]+$/u` (accepts canonical lowercase codes incl.
   `audit.sensitive-diff.view`, and legacy UPPER_CASE forms) with a
   `.transform` to lowercase, so the parsed DTO always carries the canonical
   form.
3. `apps/api/src/auth/admin-auth.service.ts` —
   - `beginStepUp`: normalizes `input.actionClass` **before** writing
     `request_context` (and the audit event), so the challenge context and
     the derived grant row are canonical by construction.
   - `verifyStepUp`: re-normalizes defensively when reading the context, so
     the grant row can never carry a case the guard cannot consume.
   - private `consumeStepUpGrant` (assisted reset): normalizes the action
     class; the call site now uses the canonical `admin.mfa.reset` instead
     of the legacy `ADMIN_MFA_RESET` purpose code.
4. `apps/api/src/platform-access/rbac.service.ts` — `consumeStepUpGrant`
   normalizes `input.permission` with the same function before the SQL
   lookup, so creation and consumption cannot diverge by case.

Fail-closed semantics are preserved: wrong/no token, wrong action class,
wrong session, wrong market, expired, or already-consumed grants still
return 403/deny; the SQL `UPDATE ... WHERE ...` atomically marks the grant
`used_at` only when every binding matches. The legacy `ADMIN_MFA_RESET`
underscore form now folds to `admin_mfa_reset`, which matches no catalog
consumer and therefore fails closed (the DTO tolerates it, but it no longer
authorizes anything) — the canonical `admin.mfa.reset` (or `ADMIN.MFA.RESET`)
is the supported form.

**No migration was created or needed**: `admin_step_up_grants.action_class`
is an unconstrained `text` column (migration `0027`), so the fix is purely
code-level.

## 4. Tests added

- `apps/api/src/auth/action-class.spec.ts` (10 unit tests):
  `normalizeActionClass` behavior (canonical, legacy UPPER_CASE, mixed-case,
  whitespace, idempotence); **case consistency across every one of the 17
  step-up catalog codes** (each is the fixed point of the normalizer and
  accepted by the DTO); DTO wire contract (accepts canonical + legacy forms,
  rejects non-code-shaped values fail-closed).
- `apps/api/src/platform-access/step-up-consume.integration.spec.ts`
  (7 real-DB tests, **no direct grant seeding** — every grant is minted via
  the real `challenge → verify` HTTP flow against a real enrolled TOTP
  factor):
  1. real-flow grant consumed by the `RbacGuard` on `POST /api/v1/admin/users`
     (`admin.user.manage`) and marked `used_at`;
  2. no token → 403; one-use (second use of same token → 403);
  3. action-class mismatch (`rbac.role.assign` grant vs `admin.user.manage`
     route) → 403;
  4. legacy UPPER_CASE (`ADMIN.USER.MANAGE`) and mixed-case
     (`Admin.User.Manage`) action classes still mint consumable grants;
  5. expiry (row aged past `expires_at`) → 403;
  6. session binding (different session cannot consume) → deny, owning
     session can;
  7. market binding (grant minted with `market_id`, wrong market cannot
     consume) → deny, correct market can.

## 5. Existing tests updated (justified)

- `apps/api/src/auth/admin-auth.http.integration.spec.ts` — the two
  step-up challenge call sites for the assisted-MFA-reset flow changed from
  the legacy `ADMIN_MFA_RESET` purpose code to the canonical
  `admin.mfa.reset` / `ADMIN.MFA.RESET`. **Justification**: the fix
  legitimately changes the step-up action-class wire form for that flow from
  a non-catalog purpose code to the canonical catalog permission code
  (task §4.3 permits a test change when the fix changes behavior).
- `apps/api/src/admin-kyc-ops/admin-kyc-ops.integration.spec.ts` — the
  P7-S5C test that pinned the broken behavior
  (`documents the upstream step-up action-class constraint`, which asserted
  lowercase `action_class` returns 400) is replaced by a test proving the
  remediated contract: the real challenge/verify flow with the canonical
  lowercase code mint a grant that the guard consumes end-to-end on
  `GET /members/:id/evidence` (200, `used_at` set, `action_class` stored
  canonical). **Justification**: this test's own docstring said it pinned
  the frozen behavior "so the upstream remediation (P7-S2 owner) is
  visible" — this task is that remediation. The test uses a dedicated KYC
  case so it does not change the row counts the seeded-grant tests assert on
  `caseA1`. The `seedStepUpGrant` docstring was refreshed to reflect that
  the real flow now produces the same canonical action class.

## 6. Verification evidence

Environment: Linux sandbox worktree `/workspace/.local/wt-p7-s2fix`;
dedicated DB `ipoint_p7s2fix_test` at `172.23.0.3:5432`, dropped and
recreated before every integration run (clean-DB rule); migrations applied
by the suites' `migrate()` bootstrap; fixture method = real HTTP
enrollment/login/challenge flows plus direct account/role/permission rows
(the same pattern the P7-S2A/P7-S5C specs use).

| Command (fresh DB) | Result |
| --- | --- |
| `pnpm --filter @ipoint/api typecheck` | PASS, exit 0 |
| `pnpm --filter @ipoint/api build` | PASS, exit 0 |
| `pnpm exec eslint <8 changed paths>` | clean, exit 0 |
| `pnpm exec prettier --check <8 changed paths>` | clean |
| `vitest run src/auth/ src/platform-access/` | **136 passed / 4 failed / 0 skipped (140)** — the 4 failures are pre-existing `AUTH_REFRESH_REUSED` → `SESSION_REUSE_DETECTED` drift in the Phase-2 member-auth suites (`auth.integration.spec.ts`, `auth.http.integration.spec.ts`), present identically at the base SHA before this fix and outside this task's allowed paths |
| P7-S2 core suites (`admin-auth.http.integration` 2, `platform-access.integration` 6, `p7-s2c-rbac.guard` 6, `p7-s2c-openapi` 16, `platform-access.spec` 3, `action-class.spec` 10) | **43/43 passed** |
| `vitest run src/admin-kyc-ops/` | **69/69 passed** |
| `pnpm --filter @ipoint/database test:integration` | **22/22 passed** |
| `pnpm --filter @ipoint/database db:checksum` | **29/29 immutable checksums verified** |
| `pnpm --filter @ipoint/database test` | 60/62 — 2 pre-existing failures (`tests/phase3-schema.test.ts`, `tests/schema.unit.test.ts`) assert the migration set ends at `0019`; stale since Phase 6/7 added `0020–0028`. Unrelated to this fix (database package untouched). |

No CI run identifier was assigned; the evidence above is the task record.

## 7. Git state

- Branch `fix/p7-s2-stepup-action-class` from phase HEAD
  `11088babd5c8c6be651418030fbfa95c06853539`.
- Commits (exact-path staging, full SHAs):
  - `<filled at commit time>` `fix(p7-s2): align step-up action class casing end-to-end`
  - `<filled at commit time>` `docs(p7-s2): record step-up fix`
- **Not pushed.** No amend/rebase/force. No migration created.
- Main worktree (`phase/7-admin-operations`) was left clean of these
  changes (the implementer's file-tool edits initially landed there and were
  moved to the worktree; the main worktree files were restored to HEAD).

## 8. Risk note for reviewers

- The legacy `ADMIN_MFA_RESET` underscore purpose code is now
  non-authorizing (folds to `admin_mfa_reset`, matched by no consumer).
  Any runbook/client still sending it will get `403 MFA_STEP_UP_REQUIRED`
  until updated to `admin.mfa.reset` — the intended canonical contract.
- The DTO still accepts legacy UPPER_CASE forms (case-insensitive wire
  contract), which keeps backward compatibility for existing clients while
  making the canonical lowercase code the stored value.
