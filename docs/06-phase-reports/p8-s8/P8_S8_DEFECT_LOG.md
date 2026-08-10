# P8-S8 — Full Final UAT Defect Log

> Phase 8 · Sub-phase **P8-S8** · Branch `task/p8-s8-full-final-uat`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §8 / §11 · Brief: `TASK_BRIEF_P8S8.md` §3.8 (A→B→C) · D-073 O-5
> Severity guide: Critical = financial invariant/security bypass/cross-market contamination; High = broken contract a real user journey hits; Medium = contract drift without current user-visible break; Low = cosmetic/doc/evidence.
> Disposition rule (D-073 O-5): routine/repairable (test/fixture/doc) fixed in-brief with records; **Critical/High production defects → record with full repro evidence, do NOT fix in S8 — route via §11 A→B→C to the Command Center**; OBS-04/SEC-01-class items never route into S8 fixes.

---

## 1. UAT-introduced defect set (close state)

| ID      | Severity | Scenario(s)                           | Status                                     | Disposition                                                                                                                                                                  |
| ------- | -------- | ------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEF-001 | **High** | U-07 (API), BW-M3 (browser)           | **FIXED** — §11 round 1 (fix record below) | Bounded production fix `fix/p8-s8-uat-defects` @ `cff32767` (D-060 alternate executor, D-058 §5 Codex CLI unavailable for this round); re-test green (U-07 PASS, BW-M3 PASS) |
| DEF-002 | **High** | BW-M1 (browser, member login journey) | **FIXED** — §11 round 1 (fix record below) | Bounded production fix `fix/p8-s8-uat-defects` @ `eb4e599d` (D-060 alternate executor); re-test green (BW-M1 PASS — UI leaves `/login`)                                      |

0 Critical / 0 Medium UAT-introduced. The two Highs are FIXED in round 1 with re-test evidence (sections 2-3); the remaining "0 unresolved HIGH" declaration is deferred to P8-S9 pending Bryan's decisions on OBS-04/SEC-01 (matrix §6), per the GATE CONDITION stamp.

## 2. DEF-001 — Member wallet read surface returns empty / not-found for every member

- **Severity:** High — broken contract a real user journey hits (member wallet view).
- **Scenario link:** U-07 (API), BW-M3 (browser suite).
- **Repro evidence (real API + real PG, `ipoint_p8s8_test`):** a member with an existing current-market wallet (`member_wallet_accounts` row: `member_id = members.id`, `available_balance = 100000`):
  - `GET /api/v1/wallets` (member token) → **200 `[]`** (empty list).
  - `GET /api/v1/wallets/:id` (the member's own wallet id) → **400 `WALLET_NOT_FOUND`** (`{"error":{"code":"WALLET_NOT_FOUND","message":"Wallet not found."}}`).
  - Same behaviour reproduced in the browser suite (BW-M3) and in `U-07.json` (list `body=[]`, detail 400).
- **Root cause:** the wallet controller passes `actor.accountId` (the ACCOUNT id — `accounts.id`, per `findPasswordIdentity`/`resolveActor`) into `WalletService.getWallets/getBalance`, which filter `member_wallet_accounts.member_id`. Wallets are created keyed by the MEMBER id (`members.id`) — e.g. `transaction-confirmation-reward.writer.ts` inserts `memberId: input.memberId` (resolved from the preview session's `members.id`), and `job.service.ts` keys daily-reward wallets by `plan.memberId`. Account id ≠ member id → every member's wallet list is empty and detail/entries reads are `WALLET_NOT_FOUND`.
- **Impact:** the member-web wallet page (`MemberWalletApiClient.listWallets/getWallet/walletEntries` → `GET /wallets*`) cannot display balances over the real API. The S5b member-web suite (311/311) used mocked API responses and did not exercise this path over HTTP — this is the class of gap UAT exists to catch (cf. S6 FIX-001).
- **Fix record:** NONE in S8 (production code change → §11 A→B→C; candidate: resolve the member id from the account id at the controller boundary, mirroring the redemption quote route pattern from FIX-001, and add an HTTP-level wallet read integration test).
- **Re-test evidence:** U-07/BW-M3 evidence above; re-run after the authorized fix.

### 2.1 DEF-001 fix record (§11 A→B→C round 1, D-060 alternate executor)

- **Authorized:** D-060 backup-executor authorization for §11 bounded round 1; wallet module (Phase 3 frozen) touched only for this defect, per the round-1 brief red lines.
- **Root cause (confirmed code-level):** `WalletController.getWallets/getWallet` passed `actor.accountId` (the ACCOUNT id — `accounts.id`) into `WalletService.getWallets/getWallet`, which filter `member_wallet_accounts.member_id` (the MEMBER id — `members.id`). Account id ≠ member id → `GET /wallets` → `[]` and `GET /wallets/:id` → `WALLET_NOT_FOUND` for every member.
- **Fix (minimal diff, controller boundary + one service correction):**
  1. `wallet.controller.ts` — added the canonical account→member resolution at the controller boundary (mirrors `RedemptionController.resolveMemberId` / `ProfileService.resolveMemberId`: `select id from members where account_id = ?`), and `getWallets`/`getWallet` now pass the resolved member id. New `WALLET_MEMBER_NOT_FOUND` 400 for tokens with no member row.
  2. `wallet.service.ts` — `getWallet(memberId, marketId)` → `getWallet(walletId, memberId)`: the `GET /wallets/:id` route param is a wallet UUID (per U-07 and the api-client `MemberWalletApiClient.getWallet`), so the lookup is now `id = walletId AND member_id = memberId` (owner-scoped, consistent with `getBalance`/`getEntries`/`getEntry` which already key by wallet id). No other caller of the old signature existed (only the broken route + its spec).
  3. `wallet.service.spec.ts` — the two `getWallet` tests updated to the new signature.
- **No behavior change:** `getWallets` still returns the member's full cross-market wallet list; no other wallet route touched; ledger writes (`createLedgerEntry`) untouched.
- **Decision basis:** the route's documented semantics ("wallet details for the given wallet ID"), U-07 (passes the wallet UUID), and the api-client contract all key wallet reads by wallet id; the old `(memberId, marketId)` service signature had zero legitimate callers.
- **Re-test evidence:**
  - `apps/api/src/uat/uat.spec.ts` full guarded run (`P8S8_DESTRUCTIVE_TEST=1`, fresh `ipoint_p8s8_test`, run `2026-08-10T12-01-05.637Z-p8s8-uat-l0`): **36/36 scenarios PASS, 41/41 tests PASS**; U-07 assertions all green — list 200 containing the current-market wallet (`availableBalance 100000.0000000000`), detail 200 exact-decimal, entries 200. Evidence: `apps/api/.local/p8-s8-uat/2026-08-10T12-01-05.637Z-p8s8-uat-l0/U-07.json`.
  - Browser suite (`ipoint_p8s8_browser`, host Chromium): **BW-M3 PASS** — `GET /wallets` non-empty and contains the fixture wallet; `GET /wallets/:id` 200 with `availableBalance 100000`.
  - Unit: `wallet.service.spec.ts` 19/19 PASS; API `tsc -p tsconfig.build.json --noEmit` + build green; eslint/prettier clean on changed files; OpenAPI runtime validation green (300 paths, 0 errors).
  - Zero-owner-bypass re-scan (P7 gate-18/S5e method) over the changed scope: **0 findings** (repo hits unchanged benign baseline classes + UAT scenario-name strings).

## 3. DEF-002 — Member-web login can never reach the authenticated home (missing `GET /members/me` route)

- **Severity:** High — broken contract a real user journey hits (member-web login + all authenticated member journeys).
- **Scenario link:** BW-M1 (browser suite).
- **Repro evidence (real API + real PG, `ipoint_p8s8_browser`):**
  1. UI registration through the real API succeeds (initiate 202 → OTP screen → API verify 200 → complete 200, account created).
  2. UI login: `POST /api/v1/auth/login` → **200** with `accessToken` (captured via network listener).
  3. The member-web AuthProvider `loadUser()` then calls `GET /api/v1/members/me` — **no such route exists in the API** (controller scan: no `@Get('me')` under `members`; existing member routes are `members/me/profile`, `members/me/market`, `members/me/kyc`, `members/me/transactions`, `members/me/account-country-change`). The call 404s → `login()` throws → `isAuthenticated` stays false → the UI remains on `/login` (screenshot `p8s8-member-login-def002.png`).
  4. `packages/api-client` has no member-profile method either — there is no working "load my profile" path for member-web.
- **Impact:** all authenticated member-web journeys (home, merchants, wallet, reward, team, redemption) are unreachable through the real UI against the real API. S5b member-web tests were mock-based (311/311) and did not catch this.
- **Fix record:** NONE in S8 (production change → §11 A→B→C; candidate: add the member self-summary route the app calls — or point `loadUser` at an existing route — plus a real-HTTP member-web login E2E).
- **Re-test evidence:** BW-M1 evidence; re-run after the authorized fix.

### 3.1 DEF-002 fix record (§11 A→B→C round 1, D-060 alternate executor)

- **Authorized:** D-060 backup-executor authorization for §11 bounded round 1; the new route is exactly `GET /members/me` (red-line carve-out: "DEF-002 若需新路由：只能加 `GET /members/me` 且跟既有 guard 模式，OpenAPI 同步"). No other member surface changed.
- **Decision: option (b) — no equivalent endpoint exists (evidence):**
  1. Controller scan: member self-routes are `members/me/profile`, `members/me/market`, `members/me/kyc`, `members/me/transactions`, `members/me/account-country-change`; the auth controller is POST-only (no `/auth/me`); the discovery controller (`members`) has no `me`; there is no bare `GET /members/me`.
  2. Closest candidate `GET /members/me/profile` (`ProfileResponse`) does NOT return the member identity the app needs: no `email`, no `countryCode`, no `kycStatus`, and its `id` is the member_profiles record id, not `members.id`. The member-web `User` contract requires `email` (asserted in `AuthProvider.test.tsx` and displayed by `MemberLayout`).
  3. `packages/api-client` has no current-member method (confirmed by scan + DEFECT_LOG).
  4. Option (a) would therefore require degrading the `User` contract (drop email) or composing 2-3 calls client-side with no email source — strictly worse than (b).
- **Fix (minimal, canonical member guard):**
  1. `profile.service.ts` — new `getMemberSelf(accountId)`: resolves the member from the account id, joins `accounts` (email, account country) and `member_profiles` (display name, phone); `kycStatus` derived from the member KYC case status with a `kyc_level` fallback for legacy/fixture-approved rows (`APPROVED→approved`, `REJECTED→rejected`, DRAFT/SUBMITTED/UNDER_REVIEW/MORE_INFO_REQUIRED/REVERIFICATION_REQUIRED→pending`, none+NONE→not_started`, none+LEVEL_1→pending`, none+LEVEL_2→approved`).
  2. `member-self.controller.ts` (new) — `@Controller('members/me')` + `@Get()`, `AuthGuard` + `CurrentActor` + member-account type check (mirrors the KYC controller's member guard); 400 `MEMBER_SELF_NOT_ALLOWED` for non-ACCOUNT actors. Registered in `ProfileModule`.
  3. `profile.types.ts` — `MemberSelfResponse` shape aligned to the member-web `User` type (`id`, `email`, `name`, `phone`, `countryCode`, `kycStatus`, `createdAt`).
  4. `profile.service.spec.ts` — 4 new `getMemberSelf` unit tests (approved case, kyc_level fallback, rejected case, member-missing).
- **Member-web side:** `AuthProvider.tsx` already calls `GET /members/me` — no change needed; the endpoint now exists and returns the `User`-shaped payload.
- **Re-test evidence:**
  - Browser suite (`ipoint_p8s8_browser`, host Chromium): **BW-M1 PASS** — real-API registration + OTP + login; `POST /auth/login` 200; the member-web UI now transitions away from `/login` to the authenticated home (screenshot `test-results/p8s8-member-login-fixed.png`).
  - Full UAT API suite still 36/36 PASS (no regression; `GET /members/me` is exercised through the AppModule boot + OpenAPI validation).
  - OpenAPI runtime validation green — new path `/api/v1/members/me` registered, 300 paths, 0 broken $refs.
  - Unit: `profile.service.spec.ts` 13/13 PASS; API build-config typecheck + build green; eslint/prettier clean; zero-owner-bypass re-scan over changed scope **0 findings**.

## 4. Observations recorded (not defects)

| ID     | Class                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                             | UAT handling                      |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| OBS-06 | Observation (not confirmed product defect) | Merchant-web transactions page renders an `INTERNAL_ERROR` state against the real API in the UAT harness (`BW-MC1`, screenshot `p8s8-merchant-transactions.png`); the underlying merchant transaction API passes at U-04 (API) and BW-N1 (preview/confirm/replay). Root cause not isolated within UAT (harness fixture/context interplay cannot be excluded) — triage input for P8-S9/implementer. | Recorded; not counted as a defect |
| DOC-01 | Documented behavior (not a defect)         | `redemption_voucher_codes.expiry_date` is stored metadata; no platform code path rejects an expired voucher at reveal/use (voucher use is off-platform; P6-S5 contract does not require platform-side expiry rejection).                                                                                                                                                                           | U-27(c) note; recorded            |
| DOC-02 | Fixture boundary (not a defect)            | Admin merchant branch-DETAIL composition requires the merchant-application fixture set (owner `getProfile` + application/kyc composition); the S6 world fixture has none. Covered by `admin-merchant-ops.integration.spec.ts`.                                                                                                                                                                     | U-17 note; recorded               |
| DOC-03 | Cross-check (expected, not defects)        | OBS-01 (quote race 409), OBS-02 (bounded 55P03), OBS-03 (outbox not-CONFIRMED rejection), OBS-05 (403-by-design recharge route) — verified/cited per the S6 expected-outcome catalogue.                                                                                                                                                                                                            | Matrix §4                         |

## 5. Routine/repairable items fixed in-brief (test/fixture/doc only)

All UAT-harness issues found during execution were test/fixture logic on the verifier side (wrong response-shape parsing, payload-hash mismatches on replay, enum/column name corrections, OTP-expiry fixture constraint, DB append-only triggers respected via sanctioned fixture paths, TOTP timing robustness, rate-limit-aware test design). Each was corrected in the suite itself (`apps/api/src/uat/**`, `tests/e2e/p8-s8-uat.spec.ts`) with the fixes recorded in the commit history; none touched production code, migrations (40/40 checksums frozen, verified), or `packages/database/**`.

## 6. OBS-04 / SEC-01 handling (explicitly NOT UAT defects, NOT fixed by S8)

- **OBS-04** (High, OPEN, D-070/D-072): engine-level reconciliation-path limitation; UAT executed U-21/U-36 at the mitigated profile and records the dependency — see matrix §6. No S8 fix attempted.
- **SEC-01** (10 pre-existing HIGH dependency advisories, D-072): structurally pre-existing, frozen lockfile, zero financial-path exposure; excluded from this log; gate-condition dependency for P8-S9 — see matrix §6.

## 7. Approval-bar status at round-1 close (post §11 fixes)

- UAT-introduced: **0 Critical / 0 High / 0 Medium / 0 Low unresolved at round-1 close** — DEF-001 and DEF-002 are FIXED with fix records (§2.1/§3.1) and re-test evidence (U-07 PASS, BW-M1 PASS, BW-M3 PASS; full UAT suite 36/36 + browser suite 7/7 after the fix round).
- Overall "0 unresolved HIGH" declaration: **still deferred to P8-S9** — the GATE CONDITION dependencies OBS-04/SEC-01 remain PENDING Bryan (matrix §6). The §11 round-1 fix removes the UAT-introduced Highs from that gate; round 2 (independent review by Reviewer B') is the next step before Command Center acceptance per D-058 §21 / brief §3.8.

_Forward-only log. Do not delete or rewrite._
