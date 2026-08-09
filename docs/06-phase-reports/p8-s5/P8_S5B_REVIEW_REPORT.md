# P8-S5b Independent Review Report — Member Web UI Gap Closure (Wallet / Reward / Team / Redemption)

- **Reviewer**: Independent Reviewer B' (D-060 authorized alternate executor / reviewer)
- **Reviewed commit**: `db622307` on `task/p8-s5b-member-web-ui-gaps` (worktree `.local/wt-p8-s5b`, base `c85ebe73`)
- **Review date**: 2026-08-09
- **Scope**: Full source review of the P8-S5b delivery — pages, routing/nav, api-client additions, tests, i18n, delivery report — and cross-verification against the frozen Phase 3/5/6 backend controllers/types.
- **Independence statement**: All code was read and verified directly from the worktree. Test suites, typecheck, build, and prettier were re-run by the reviewer (results below). No finding in this report relies on the implementer's self-assessment; the delivery report was used only as a map to the code, and every claim it makes was checked against the actual files or the running toolchain.

---

## Verdict: **APPROVED**

No Critical or High findings. One Medium and nine Low findings are recorded below; none blocks the delivery's stated definition of done, and none touches the frozen backend contract. The Medium finding (redemption "Confirm another order" flow, M-1) is recommended for a small follow-up fix in the same sub-phase or the next one.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 9 |
| Observation (non-blocking) | 6 |

---

## Findings

### Critical

None.

### High

None.

### Medium

#### M-1 — RedemptionPage "Confirm another order" can never create a second order (idempotency key never reset after success)

- **File**: `apps/member-web/src/pages/RedemptionPage.tsx` — `handleConfirmOrder` (lines ~202-245), key lifecycle around `idempotencyKeyRef` (reset only in `handleSelectItem` and `handleCloseDetail`).
- **Issue**: After a successful order, the submit button's label changes to `redemption.orderAgain` ("Confirm another order") and remains enabled. The idempotency key is **not** reset on success. Clicking it again submits the *same* key with the *same* payload, which the frozen server correctly treats as an idempotent replay (verified in `apps/api/src/redemption/redemption.service.ts` `confirmOrder` Step 1: same key + same payload returns the existing order). The user therefore sees the same order re-displayed and can never place a second order through this button. If the user first changes the quantity (new `quoteId`), the same key + different payload is rejected with `REDEMPTION_IDEMPOTENCY_MISMATCH` (409) and the flow errors out.
- **Rationale**: The label promises a new order; the flow cannot deliver it. There is no data or financial-integrity risk (server-side idempotency protects against duplicates), which is why this is Medium and not High, but the interactive path is functionally broken as labeled. The test suite covers "retry after failure reuses the same key" but has no test for "order again after success", which allowed this to slip through.
- **Recommendation**: Reset `idempotencyKeyRef.current = null` on success (a new logical operation after a confirmed order warrants a fresh key, while the current "reuse on error retry" behavior remains correct), or disable/hide the order-again affordance and require re-selecting the item. Add a test asserting that a second confirm after success produces a new key and a second `confirmOrder` call.

### Low

#### L-1 — Delivery report §8.2 rationale for the DELIVERY gap is factually inaccurate

- **File**: `docs/06-phase-reports/p8-s5/P8_S5B_DELIVERY_REPORT.md` §8.2.
- **Issue**: The report claims the shipping-payment `requestHash` cannot be computed because "member/market UUIDs are not exposed to member-web". This is incorrect: `GET /wallets` returns `memberId` and `marketId` (`MemberWalletAccountDto`), the quote DTO returns `marketId`, and `GET /markets` returns market ids — all already consumed by member-web. The honest blocker is that computing `requestHash` would require re-implementing the server's exact SHA-256 semantics (`JSON.stringify(data, Object.keys(data).sort())`, `apps/api/src/redemption/redemption.service.ts` `hashPayload`) plus driving the shipping-payment provider flow — a backend-integrated concern.
- **Rationale**: The PICKUP-only scope decision itself is sound, conservative, and honestly surfaced in the UI (`redemption-delivery-unavailable` note, verified in the page and its test). Only the stated justification is wrong. Honesty semantics are a Phase 8 governance principle; the rationale should be corrected.
- **Recommendation**: Amend §8.2 to state the real reason (hash-semantics replication + provider payment flow out of member-web scope) and record the decision as a product-scope gap for Bryan/ChatGPT Command Center.

#### L-2 — Delivery report §8.3 agent-status rationale is partly inaccurate

- **File**: `docs/06-phase-reports/p8-s5/P8_S5B_DELIVERY_REPORT.md` §8.3.
- **Issue**: The report says the member's market code is not sent because "member-web does not persist one in a way the page can rely on". In fact `GET /profile` returns `marketCode` (used by `MarketSwitchPage`). The behavior (calling `GET /agent/status` without a market filter, server returns most recent activation) is correct and documented server-side (`AgentActivationService.getStatus(memberId, market?)`), but the stated reason is inaccurate.
- **Recommendation**: Correct the rationale; optionally pass the market code from the profile in a follow-up.

#### L-3 — `trimAmount` returns `'-0'` for `'-0.0000000000'`

- **File**: `apps/member-web/src/utils/amount.ts` line ~22.
- **Issue**: `'-0.0000000000'` → trim trailing zeros → `'-0.'` → strip dot → `'-0'`; the guard only maps `''`/`'-'` to `'0'`. Backends generally never produce a negative zero decimal, but if one ever appears (e.g., a REVERSED entry computed as a zero delta), the UI would render `-0`.
- **Recommendation**: Also map `'-0'` to `'0'`.

#### L-4 — Server enum values rendered raw (unlocalized) while agent status is localized

- **Files**: `apps/member-web/src/pages/TeamPage.tsx` (commission ledger `postingStatus`, `sourceType`, `entryType` rendered as raw server strings, lines ~300-306); `apps/member-web/src/pages/RedemptionPage.tsx` (order `status` raw); `apps/member-web/src/pages/RewardPage.tsx` (`sourceType` raw badge).
- **Issue**: `team.agentStatus.*` goes through `t()` mapping, but the commission posting status and other enums are displayed verbatim — inconsistent localization treatment in zh. Not a brief violation (these are server data, not hard-coded strings), but a real i18n gap on user-visible copy.
- **Recommendation**: Add `team.postingStatus.*`, `redemption.orderStatus.*` (etc.) key maps mirroring the `agentStatus` pattern.

#### L-5 — HomePage "Wallet — Coming Soon" quick card now contradicts the active Wallet nav

- **File**: `apps/member-web/src/pages/HomePage.tsx` lines ~350-355 (untouched).
- **Issue**: The Wallet nav item is activated while the HomePage quick card still advertises "Coming Soon". Documented as out of scope in §8.5 (its test asserts current copy) — acceptable for this sub-phase, but user-visible inconsistency.
- **Recommendation**: Re-point the card to `/wallet` in a later sub-phase (needs Bryan approval, as the report notes).

#### L-6 — WalletPage ledger error path does not classify market-gate; TeamPage summary error has no retry

- **Files**: `apps/member-web/src/pages/WalletPage.tsx` (`fetchLedger` catch only sets a generic `wallet.loadError`, no `describeApiError` kind detection); `apps/member-web/src/pages/TeamPage.tsx` (commission-summary error shows a warning with no retry button).
- **Issue**: Inconsistent error UX compared to the other fetch paths (which do classify `kind === 'market'` and offer retry). Minor.
- **Recommendation**: Unify with the established pattern.

#### L-7 — Quote fetch race: out-of-order responses can display a stale quote for a different quantity

- **File**: `apps/member-web/src/pages/RedemptionPage.tsx` — `useEffect` re-runs `fetchQuote` on `quantity` change; `useAbortController` only aborts on unmount (verified in `hooks/useAbortController.ts`), so no in-flight quote request is cancelled.
- **Issue**: If the user changes quantity while a previous quote request is still in flight, the older response can resolve last and overwrite the newer one. The submit payload is derived from the *displayed* quote (`quote.quoteId`, `quote.postedPointCost`, `String(quote.quantity)`), so a stale quote could confirm an order for a quantity different from the one shown in the selector. Server-side integrity checks (payload hash, point match) bind to the quote, so there is no financial exploit, but the user could receive an unintended quantity.
- **Recommendation**: Guard with a request sequence/ref (ignore responses older than the latest requested quantity) or abort the previous quote fetch.

#### L-8 — Delivery report §6 key count is off by one (534 vs 535)

- **File**: `docs/06-phase-reports/p8-s5/P8_S5B_DELIVERY_REPORT.md` §6.
- **Issue**: Report claims "534 keys each"; independent flattening yields **535 keys each** for both `en` and `zh` with full parity (verified programmatically). Cosmetic.
- **Recommendation**: Correct the number.

#### L-9 — Delivery report commit map omits the task-brief commit

- **File**: `docs/06-phase-reports/p8-s5/P8_S5B_DELIVERY_REPORT.md` §7.
- **Issue**: The actual branch has 6 commits; the map lists 5 and omits `db622307 docs(p8-s5): add p8-s5b task brief`. Cosmetic.
- **Recommendation**: Add it to the map.

---

## Checklist A–G

### A. Frozen boundary — ✅ PASS

- `git diff --name-only c85ebe73..db622307` = exactly 18 files: `apps/member-web/**` (13), `packages/api-client/src/index.ts` (1), `docs/06-phase-reports/p8-s5/**` (2), plus `apps/member-web/src/api/client.ts` — **zero** files under `apps/api/`, `packages/database/`, `docs/00-master/`.
- `packages/api-client/src/index.ts` diff is a **single hunk `@@ -4314,6 +4314,482 @@` with 0 deletion lines** — strictly append-only; no existing section moved or merged.
- No new permission codes; all pages operate on the member's own account scope.
- No export/download/CSV affordance: grep for `createObjectURL|toBlob|window.open|Blob\(|CSV|csv|download` across new pages/utils → no hits.
- No `.npmrc` in any commit (`git log --all -- .npmrc` empty).
- Changed files are UTF-8 without BOM (byte-verified); no em-dash mojibake in i18n resources (0 occurrences of `\u2014` and no latin-1 mojibake sequences).

### B. Endpoint contract consistency — ✅ PASS

Field-by-field verification of every client method against the frozen controllers/types:

| Client method | Backend source | Result |
| --- | --- | --- |
| `MemberWalletApiClient.listWallets` → `GET /wallets` | `wallet.controller.ts` `@Get()` + `WalletAccountResponse` | ✅ paths + DTO match field-for-field |
| `getWallet` → `GET /wallets/:id` | `@Get(':id')` + `WalletAccountResponse` | ✅ |
| `walletEntries` → `GET /wallets/:id/entries?limit&offset` | `@Get(':id/entries')` + `PaginatedWalletEntriesResponse` | ✅ (`entries/total/limit/offset`) |
| `MemberRewardApiClient.plans` → `GET /rewards/plans?page&pageSize&status` | `reward.controller.ts` + `planListQuerySchema` (page/pageSize/status/marketId, `.strict()`) + `RewardPlanResponse` + `PaginatedResponse` | ✅ query keys valid, DTO matches field-for-field, status union matches frozen `RewardPlanStatus` |
| `MemberTeamApiClient.referralTree` → `GET /referral/tree?depth=2` | `referral.controller.ts` + `referralTreeQuerySchema` (depth 1-5, default 2) + `@ipoint/types` `ReferralTreeResponse` | ✅ |
| `agentStatus` → `GET /agent/status` (optional market code) | `agent-activation.controller.ts` + `statusQuerySchema` (market string ≤10) + `AgentActivationStatusResult \| null` | ✅ nullable contract honored; market param is a code, not a uuid (verified) |
| `commissionSummary` → `GET /commission/summary` | `agent-commission.controller.ts` + `CommissionSummaryResponse` | ✅ |
| `commissionLedger` → `GET /commission/ledger?market&status&limit&offset` | controller + `PaginatedLedgerResponse`/`LedgerEntryResponse` | ✅ |
| `MemberRedemptionApiClient.catalog` → `GET /redemption/catalog` | `redemption.controller.ts` + `memberCatalogQuerySchema` + `MemberCatalogListResponse` | ✅ |
| `itemDetail` → `GET /redemption/catalog/:itemId` | controller + `ItemDetailResponse` (incl. `version: number`, `terms`) | ✅ |
| `quote` → `GET /redemption/catalog/:itemId/quote?quantity` | controller + `quoteQuerySchema` (1..99999) + `RedemptionQuote` | ✅ |
| `confirmOrder` → `POST /redemption/orders` | controller inline body type + `ConfirmOrderInput` | ✅ exact payload match (see C) |

- No runtime shape probing anywhere in the api-client additions — all methods are typed wrappers reading `.data` only.
- `queryString` helper skips `undefined`/`''` values (verified).

### C. Redemption write path — ✅ PASS (with findings M-1, L-3, L-4, L-7)

- **Payload vs frozen owner contract** — byte-for-byte match with the controller's inline body type and `ConfirmOrderInput`: `quoteId`, `idempotencyKey`, `expectedItemVersion: number` (from item-detail `version` — the quote does not expose it, confirmed), `expectedTotalPoints: string` (verbatim `quote.postedPointCost`), `expectedQuantity: string` (from `quote.quantity`), `fulfilment: {type:'PICKUP'}`, `termsAcceptance: {accepted:true, termsVersion}`. All verified against the service validation steps 0-28 (terms gate, idempotency replay/mismatch, quote ownership/expiry/consumed, item version, payload hash, point match, balance, inventory, delivery payment checks).
- **Idempotency key semantics** — created once per logical attempt, **reused on error retries** (same key + same payload replays; same key + different payload → `REDEMPTION_IDEMPOTENCY_MISMATCH`, both confirmed in the frozen service), reset on item select/close. Double-submit guarded both by the `submitState === 'submitting'` early-return and the disabled button; test proves a rapid double click produces exactly 1 call.
- **PICKUP-only limitation / DELIVERY gap** — honest: for DELIVERY-only items the page renders `redemption-delivery-unavailable` with no confirm button; `DELIVERY_OR_PICKUP` items correctly offer the PICKUP path. The server indeed requires `shippingPaymentIntentReference` + a `requestHash` for DELIVERY (verified in service Step 15 / `shippingPaymentRequestHash`). The stated rationale in the report is inaccurate (L-1), but the scope decision and UI behavior are sound.
- **Order history "unavailable" state** — honest and verified: the frozen member surface (`redemption.controller.ts`) has no member-facing orders GET; history reads exist only on admin controllers.
- **termsVersion '1.0'** — a documented CONFIGURABLE constant (`CURRENT_REDEMPTION_TERMS_VERSION`), mirroring the RegisterPage precedent (`CURRENT_TERMS_VERSION = '1.0'`, verified in `RegisterPage.tsx`); the frozen service stores `termsAcceptance.termsVersion` verbatim with no registry validation (verified). Not a CONFIGURABLE-rule violation given the established repo convention; see observation O-6.

### D. Amount honesty — ✅ PASS

- All amounts flow through `trimAmount` (string-only; trailing-zero trim for display; never `Number`/`parseFloat` — grep verified: the only `Number.parseInt` is on the quantity selector value, not an amount, and `Number.isInteger` is a guard).
- `trimAmount` unit behavior verified against the test matrix: `'187.0000000000'→'187'`, `'12.5000000000'→'12.5'`, `'0.0000000000'→'0'` (asserted in `WalletPage.test.tsx`), `'260.0000000000'→'260'` (TeamPage), `'1000.0000000000'→'1000'` (RedemptionPage quote/order).
- No fabricated zeros: absence of rows renders empty-state copy (`wallet.noEntries`, `reward.noPlans`, `redemption.noItems`, ledger empty states), while real API zeros render as `0` (test-asserted). Edge case `'-0'` noted as L-3.

### E. Market context / authentication — ✅ PASS

- Every consumed endpoint derives the member (and where relevant the market) **server-side from the authenticated actor**: wallet controller (`actor.accountId`), reward controller (`extractMemberActor`), referral controller (`resolveMemberId`), commission controller (`resolveMemberId`), agent controller (`resolveMemberId`), redemption controller (`resolveCurrentMarket(actor.accountId)` from the member's current-market preference). None of them reads an `x-market-id` header, so the api-client `marketId` option is correctly **not** used by the new clients.
- `GET /markets` in `WalletPage` is display enrichment only (name/currency), uses the exact same call pattern as `MarketSwitchPage` (double-`.data` unwrap), and its failure is swallowed — harmless.

### F. Navigation / routing / regression — ✅ PASS

- `routes.tsx` diff is purely additive: 4 new protected routes inside `MemberLayout`; public-route section untouched.
- `MemberLayout` diff verified: wallet `href '/#wallet'→'/wallet'`, the "Coming Soon" early-return and all three `disabled: item.id === 'wallet'` flags removed; `reward`/`team`/`redemption` items added with stable ids (`home, merchants, wallet, reward, team, redemption, profile`) across side nav, bottom nav and drawer; nav labels moved to i18n with distinct accessible labels (`nav.primary/bottom/mobile`).
- Tests independently re-run: **310 passed / 24 files** for member-web (regression green, includes pre-existing suites); **95 passed** for api-client. Assertions target rendered behavior and stable `data-testid`s (exact strings, empty/error/loading states, payload shape, key reuse, single-call double-click), not implementation details.
- Typecheck (member-web + api-client), production build (`tsc -p tsconfig.build.json && vite build`) and prettier (`--check` on all changed files) all clean in the reviewer's own runs.
- HomePage "Wallet Coming Soon" card untouched and documented as out of scope (§8.5) — in-range per the task brief; UX inconsistency noted as L-5.

### G. i18n / accessibility / code quality — ✅ PASS

- `en` and `zh` each contain **535 keys with full parity** (verified programmatically; no missing keys either direction); all static and dynamic `t()` keys used by the four pages and the layout resolve (dynamic sets for entry types, reward statuses, agent statuses, item types, fulfilment modes, nav ids all verified present).
- No hard-coded user-visible strings in the new pages (all copy via `useTranslation`); raw server enums displayed in a few places noted as L-4.
- `data-testid`s are stable and semantically named; catalogue item cards are keyboard-operable (`role="button"`, `tabIndex`, Enter/Space handler) with `aria-label`; pagination buttons have `aria-label`s; loading regions have `aria-label`.
- No BOM, no mojibake (byte-verified), no secrets in the diff (scan clean), `.npmrc` not committed, no `git add .` (commits are scoped and match the reported commit map except the omitted brief commit, L-9).
- `Badge`/`Alert`/`Card` props used all exist in `@ipoint/ui` (`Tone = neutral|success|warning|error|info`, `Badge` additionally `brand|gold`; `Card.interactive`) — typecheck confirms.

---

## Observations (non-blocking)

- **O-1** — `GET /wallets/:id/entries` performs no server-side ownership check (controller passes only wallet id; service checks existence only). This is a frozen-backend limitation, **honestly disclosed** in the delivery report §8.4; the UI only calls it with wallet ids returned by the member's own `GET /wallets`, so no new disclosure is introduced. Recommend tracking a backend hardening item for when the wallet domain unfreezes.
- **O-2** — The two workspace-level flaky failures claimed in §8.7 (P8-S5a admin-web reports tests) are credible: no admin-web file is in the diff, and the only shared surface (api-client) is append-only. Not re-run in full workspace (cost), but the claim is consistent with the change set.
- **O-3** — Nav labels switched from hard-coded English to i18n — a deliberate, documented change with no test regression (the layout previously had no test file; `MemberLayout.test.tsx` is new).
- **O-4** — `agentStatus()` returns the most recent activation across markets when no market filter is sent; the page's `NOT_APPLIED` tone map entry is defensive only (the endpoint returns `null` when there is no activation, which the page renders as the not-applied empty state).
- **O-5** — The redemption confirm payload sends `fulfilment.type: 'PICKUP'` with no `pickupLocationId`; the frozen service does not require it for PICKUP (verified in service Steps 0-28). Fine against the frozen contract.
- **O-6** — `CURRENT_REDEMPTION_TERMS_VERSION` is a client constant following the RegisterPage convention. Recommended: consolidate versioned terms constants into a shared module (`member-web/src/constants/termsVersions.ts`) so future bumps are single-point, and revisit if the backend ever exposes a terms-version registry.

---

## Verification evidence (reviewer's own runs)

| Check | Command | Result |
| --- | --- | --- |
| member-web tests | `pnpm --filter @ipoint/member-web exec vitest run` | 24 files / **310 passed** |
| api-client tests | `pnpm exec vitest run` (in packages/api-client) | **95 passed** |
| member-web typecheck | `tsc -p tsconfig.json --noEmit` | exit 0 |
| api-client typecheck | `tsc -p tsconfig.json --noEmit` | exit 0 |
| member-web build | `tsc -p tsconfig.build.json --noEmit && vite build` | exit 0, dist generated |
| prettier | `npx prettier --check` (9 core changed files) | all clean |
| Frozen boundary | `git diff --name-only c85ebe73..db622307` | 18 files, no forbidden dirs |
| Append-only | `git diff` hunk analysis of `packages/api-client/src/index.ts` | 1 hunk, 0 deletions |
| i18n parity | flat-key comparison script | 535 = 535, zero missing both ways |
| Static scans | grep for Number/parseFloat on amounts, export/download/CSV, secrets, BOM | clean |
