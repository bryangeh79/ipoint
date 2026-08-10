# P8-S8 — Full Final UAT Defect Log

> Phase 8 · Sub-phase **P8-S8** · Branch `task/p8-s8-full-final-uat`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §8 / §11 · Brief: `TASK_BRIEF_P8S8.md` §3.8 (A→B→C) · D-073 O-5
> Severity guide: Critical = financial invariant/security bypass/cross-market contamination; High = broken contract a real user journey hits; Medium = contract drift without current user-visible break; Low = cosmetic/doc/evidence.
> Disposition rule (D-073 O-5): routine/repairable (test/fixture/doc) fixed in-brief with records; **Critical/High production defects → record with full repro evidence, do NOT fix in S8 — route via §11 A→B→C to the Command Center**; OBS-04/SEC-01-class items never route into S8 fixes.

---

## 1. UAT-introduced defect set (close state)

| ID | Severity | Scenario(s) | Status | Disposition |
|---|---|---|---|---|
| DEF-001 | **High** | U-07 (API), BW-M3 (browser) | OPEN — recorded | Route to Command Center via §11 A→B→C (production fix, out of S8 verifier scope) |
| DEF-002 | **High** | BW-M1 (browser, member login journey) | OPEN — recorded | Route to Command Center via §11 A→B→C (production fix, out of S8 verifier scope) |

0 Critical / 0 Medium UAT-introduced. The two Highs block any "0 unresolved HIGH" UAT-close declaration for the affected journeys; OBS-04/SEC-01 are recorded PENDING-Bryan gate dependencies (matrix §6), not UAT defects.

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

## 4. Observations recorded (not defects)

| ID | Class | Detail | UAT handling |
|---|---|---|---|
| OBS-06 | Observation (not confirmed product defect) | Merchant-web transactions page renders an `INTERNAL_ERROR` state against the real API in the UAT harness (`BW-MC1`, screenshot `p8s8-merchant-transactions.png`); the underlying merchant transaction API passes at U-04 (API) and BW-N1 (preview/confirm/replay). Root cause not isolated within UAT (harness fixture/context interplay cannot be excluded) — triage input for P8-S9/implementer. | Recorded; not counted as a defect |
| DOC-01 | Documented behavior (not a defect) | `redemption_voucher_codes.expiry_date` is stored metadata; no platform code path rejects an expired voucher at reveal/use (voucher use is off-platform; P6-S5 contract does not require platform-side expiry rejection). | U-27(c) note; recorded |
| DOC-02 | Fixture boundary (not a defect) | Admin merchant branch-DETAIL composition requires the merchant-application fixture set (owner `getProfile` + application/kyc composition); the S6 world fixture has none. Covered by `admin-merchant-ops.integration.spec.ts`. | U-17 note; recorded |
| DOC-03 | Cross-check (expected, not defects) | OBS-01 (quote race 409), OBS-02 (bounded 55P03), OBS-03 (outbox not-CONFIRMED rejection), OBS-05 (403-by-design recharge route) — verified/cited per the S6 expected-outcome catalogue. | Matrix §4 |

## 5. Routine/repairable items fixed in-brief (test/fixture/doc only)

All UAT-harness issues found during execution were test/fixture logic on the verifier side (wrong response-shape parsing, payload-hash mismatches on replay, enum/column name corrections, OTP-expiry fixture constraint, DB append-only triggers respected via sanctioned fixture paths, TOTP timing robustness, rate-limit-aware test design). Each was corrected in the suite itself (`apps/api/src/uat/**`, `tests/e2e/p8-s8-uat.spec.ts`) with the fixes recorded in the commit history; none touched production code, migrations (40/40 checksums frozen, verified), or `packages/database/**`.

## 6. OBS-04 / SEC-01 handling (explicitly NOT UAT defects, NOT fixed by S8)

- **OBS-04** (High, OPEN, D-070/D-072): engine-level reconciliation-path limitation; UAT executed U-21/U-36 at the mitigated profile and records the dependency — see matrix §6. No S8 fix attempted.
- **SEC-01** (10 pre-existing HIGH dependency advisories, D-072): structurally pre-existing, frozen lockfile, zero financial-path exposure; excluded from this log; gate-condition dependency for P8-S9 — see matrix §6.

## 7. Approval-bar status at S8 close

- UAT-introduced: **0 Critical / 2 High (DEF-001, DEF-002) / 0 Medium / 0 Low**. Both Highs recorded with full repro evidence and routed to the §11 A→B→C Command Center path.
- Overall "0 unresolved HIGH" declaration: **deferred to P8-S9** pending Bryan's decisions on DEF-001/DEF-002 (via A→B→C) and on OBS-04/SEC-01 (matrix §6 GATE CONDITION stamp).

_Forward-only log. Do not delete or rewrite._
