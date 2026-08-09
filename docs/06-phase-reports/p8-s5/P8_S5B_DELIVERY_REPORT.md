# P8-S5b Delivery Report — Member Web UI Gap Closure (Wallet / Reward / Team / Redemption)

## 1. Task and scope

- Task (TASK_BRIEF_P8S5B.md): close the member-web UI gaps (gap audit F-01: "member-web: no Wallet, Team, Redemption, Agent UI") by building **four new member pages** as adapters over the frozen Phase 3/5/6 backends:
  1. **Wallet** (`/wallet`) — member iPoint wallet balances + paginated ledger history + reward-summary link.
  2. **Reward** (`/reward`) — member reward plans (accrual activity).
  3. **Team** (`/team`) — referral code/tree, agent activation status, commission summary + ledger.
  4. **Redemption** (`/redemption`) — redemption catalogue + quote + order confirmation (frozen `POST /redemption/orders`), with an explicit order-history-unavailable state.
- The `Wallet` nav placeholder in `MemberLayout` is now activated; `Reward`, `Team`, `Redemption` nav items added (side nav, bottom nav, drawer).
- Contract: `P8_S0_CONTRACT_FREEZE.md` §5 (G-05 part (a)) + gap audit F-01. Executor: independent coding subagent (D-060 alternate executor authorization). Verifier: OpenClaw host integration gate. Reviewer: independent Reviewer B' (D-060).
- Branch: `task/p8-s5b-member-web-ui-gaps` (worktree `.local/wt-p8-s5b`, base `c85ebe73`).
- Role boundary: implementation evidence only. This report does not approve or accept P8-S5b; acceptance belongs to Bryan / ChatGPT Command Center.

## 2. Backend endpoint inventory (paths + DTO sources)

All paths mirror the frozen controllers **exactly**; no runtime shape probing. Amounts are exact decimal strings passed through untouched.

| Domain     | Method + path                                                                     | DTO source                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet     | `GET /wallets` (list, member-scoped)                                              | `apps/api/src/wallet/wallet.types.ts` → `WalletAccountResponse`                                                                                           |
| Wallet     | `GET /wallets/:id`                                                                | `WalletAccountResponse`                                                                                                                                   |
| Wallet     | `GET /wallets/:id/entries?limit&offset` (newest first)                            | `PaginatedWalletEntriesResponse` / `WalletEntryResponse`                                                                                                  |
| Wallet     | `GET /wallets/:id/entries/:entryId`                                               | `WalletEntryResponse`                                                                                                                                     |
| Reward     | `GET /rewards/plans?page&pageSize&status&marketId`                                | `apps/api/src/reward/reward.types.ts` → `RewardPlanResponse` (paginated `items/total/page/pageSize/totalPages`)                                           |
| Reward     | `GET /rewards/plans/:id`                                                          | `RewardPlanResponse`                                                                                                                                      |
| Referral   | `GET /referral/tree?depth=2`                                                      | `packages/types/src/referral.ts` → `ReferralTreeResponse` (`myCode`, `referrer{maskedReference,isAgent}`, `referrals{g1Count,g2Count,g1Agents,g2Agents}`) |
| Agent      | `GET /agent/status?market=<code>` (optional)                                      | `apps/api/src/domain/agent-activation/service.ts` → `AgentActivationStatusResult`                                                                         |
| Commission | `GET /commission/summary`                                                         | `apps/api/src/domain/commission/query.service.ts` → `CommissionSummaryResponse`                                                                           |
| Commission | `GET /commission/ledger?market&status&limit&offset`                               | `PaginatedLedgerResponse` / `LedgerEntryResponse`                                                                                                         |
| Commission | `GET /commission/ledger/:entryId`                                                 | `LedgerEntryResponse`                                                                                                                                     |
| Redemption | `GET /redemption/catalog?page&pageSize&query&itemType&fulfilmentMode&sort`        | `apps/api/src/redemption/redemption.types.ts` → `MemberCatalogListResponse`                                                                               |
| Redemption | `GET /redemption/catalog/:itemId`                                                 | `ItemDetailResponse` (includes catalog `version` + `terms`)                                                                                               |
| Redemption | `GET /redemption/catalog/:itemId/quote?quantity`                                  | `RedemptionQuote` (`postedPointCost`, `expiresAt`, `payloadHash`)                                                                                         |
| Redemption | `POST /redemption/orders` (member confirm-order, **idempotency key inside body**) | `apps/api/src/redemption/redemption.controller.ts` inline body type + `redemption.types.ts` → `ConfirmOrderInput` / `RedemptionOrderResponse`             |

Not used by the UI (admin-only or internal): `POST /wallets` (internal ledger-entry creation), `POST /referral/register` (system-internal), `POST /agent/apply|confirm-payment|enroll-course|complete-course|submit-approval` (agent activation is admin-facilitated; the member surface is read-only here), all `admin/*` redemption controllers, `POST /redemption/checkout/shipping-payment` + `POST /redemption/shipping-payment/:paymentId/confirm` (see §8 assumptions).

## 3. Pages / routing / navigation changes

### 3.1 Pages (new, `apps/member-web/src/pages/`)

- **`WalletPage.tsx`** — one balance card per market wallet (`GET /wallets`), enriched with market name/currency from the already-persisted member-web `GET /markets` surface (matching `MarketSwitchPage`); ledger history for the selected wallet (`GET /wallets/:id/entries`, offset paging, newest first) with entry-type badges, exact amounts and balance-after; empty states for no-wallet and no-entries; 403 market error → market-gate alert (uses `describeApiError`); reward-summary card linking to `/reward`.
- **`RewardPage.tsx`** — member reward plans with status filter (`all` + the six frozen plan statuses) and page paging; per-card exact `totalEarned`/`capAmount` strings; empty/error/loading states (incl. market gate).
- **`TeamPage.tsx`** — referral section (`myCode` with copy button, referrer masked reference, G1/G2 + agent counts), agent activation status (or explicit "not applied" empty state), commission summary (per-market exact totals + grand total) and commission ledger (offset paging, exact amounts). Clipboard copy is best-effort (never throws).
- **`RedemptionPage.tsx`** — catalogue browse (page paging) with reference values as exact strings; item detail + quantity + server-locked quote (`postedPointCost` shown exactly, expiry disclosed); terms consent; **order confirmation for PICKUP-capable items only** via `POST /redemption/orders` with owner payload (`quoteId`, `idempotencyKey`, `expectedItemVersion`, `expectedTotalPoints`, `expectedQuantity`, `fulfilment{type:'PICKUP'}`, `termsAcceptance{accepted,termsVersion}`); the idempotency key is created once per logical attempt and **reused on retries** (same key + same payload replays; different payload rejected server-side with `REDEMPTION_IDEMPOTENCY_MISMATCH`); submit button disabled while in flight (no double submit); success state shows order reference/status/points; delivery-only items render an explicit "delivery checkout not available in this view" note; **My orders** section renders an explicit history-unavailable state (no member-facing order-history GET endpoint exists — see §8).
- All pages: `data-testid` on key elements, `useTranslation` (no hard-coded copy), `@ipoint/ui` components, `useAbortController`, exact-decimal display via new `apps/member-web/src/utils/amount.ts` (`trimAmount` — trailing-zero trim only, **never** `Number`/`parseFloat` on amounts; dates use `toLocaleString`).

### 3.2 Routes (`apps/member-web/src/app/routes.tsx`)

Four protected routes added inside `MemberLayout` (public-route section untouched):
`/wallet`, `/reward`, `/team`, `/redemption`.

### 3.3 Navigation (`apps/member-web/src/layouts/MemberLayout.tsx`)

- Wallet nav item **activated**: href `/#wallet` → `/wallet`; the "Coming Soon" early-return and all three `disabled: item.id === 'wallet'` flags removed.
- New nav items: `Rewards` (`/reward`, Gift icon), `My Team` (`/team`, Users icon), `Redemption` (`/redemption`, ShoppingBag icon).
- Nav labels now resolve through i18n (`nav.*`) — previously hard-coded English; ids stay stable (`home`, `merchants`, `wallet`, `reward`, `team`, `redemption`, `profile`).
- Distinct accessible labels for the three nav instances: side `nav.primary`, bottom `nav.bottom`, drawer `nav.mobile` (new keys) so tests can scope queries.
- No existing MemberLayout test asserted the old placeholder, so no existing nav assertion was changed (verified; `HomePage`'s own "Wallet — Coming Soon" quick card was left untouched as out of scope — see §8).

## 4. api-client additions (append-only)

`packages/api-client/src/index.ts` — new append-only section **"P8-S5B Member Wallet / Reward / Team / Redemption clients"** placed after the existing Member Ads section; nothing was moved or merged. New exports:

- **Types**: `MemberWalletAccountDto`, `MemberWalletEntryDto`, `MemberWalletEntriesPageDto`, `MemberWalletEntryType`; `MemberRewardPlanDto`, `MemberRewardPlansPageDto`, `MemberRewardPlanStatus`; `MemberReferralTreeDto`, `MemberAgentActivationStatusDto`, `MemberCommissionSummaryDto`, `MemberCommissionMarketSummaryDto`, `MemberCommissionLedgerEntryDto`, `MemberCommissionLedgerPageDto`; `MemberRedemptionCatalogQuery` (type alias), `MemberRedemptionCatalogItemDto`, `MemberRedemptionCatalogPageDto`, `MemberRedemptionItemDetailDto`, `MemberRedemptionQuoteDto`, `MemberRedemptionOrderInput`, `MemberRedemptionOrderDto`.
- **Clients**:
  - `MemberWalletApiClient` — `listWallets()`, `getWallet(id)`, `walletEntries(id, {limit, offset})`.
  - `MemberRewardApiClient` — `plans({page, pageSize, status})`.
  - `MemberTeamApiClient` — `referralTree()`, `agentStatus(market?)`, `commissionSummary()`, `commissionLedger({market, status, limit, offset})`.
  - `MemberRedemptionApiClient` — `catalog(query)`, `itemDetail(itemId)`, `quote(itemId, quantity)`, `confirmOrder(input)`.
- Read-only defaults: no write method exists unless the frozen member-facing endpoint is a write (`POST /redemption/orders` only).
- `apps/member-web/src/api/client.ts` — four new singletons wired like `memberAdsContentApi`: `memberWalletApi`, `memberRewardApi`, `memberTeamApi`, `memberRedemptionApi`.

## 5. i18n

`apps/member-web/src/i18n/locales/{en,zh}/translation.json`:

- `nav`: added `reward`, `team`, `redemption`, `primary`, `bottom`, `mobile`, `drawerTitle`.
- `errors`: added `marketAccess`, `marketAccessDescription`, `selectMarket` (market-gate copy).
- New top-level sections: `wallet` (28 keys incl. entry-type labels), `reward` (20), `team` (33 incl. agent-status labels + posting-status display values), `redemption` (36 incl. item-type/fulfilment-mode labels).
- Full en↔zh key parity maintained: **534 keys each, symmetric** (verified programmatically; the existing `Translations.test.tsx` parity suite passes). Files remain UTF-8 without BOM.

## 6. Tests

### New tests (member-web, `apps/member-web/src/test/`)

- `features/WalletPage.test.tsx` (8 tests) — exact balance strings rendered losslessly (`'187.0000000000' → '187'`, `'12.5000000000' → '12.5'`, `'0.0000000000' → '0'`), ledger rows with exact amounts + balance-after, no-wallet empty state, no-entries empty state, 403 market gate, generic error retry, loading skeleton, reward-link navigation.
- `features/RewardPage.test.tsx` (6 tests) — plans render with exact amounts, status filter passed to the client (`{page:1,pageSize:20,status:'ACTIVE'}`), empty state, market gate, error retry, loading.
- `features/TeamPage.test.tsx` (8 tests) — referral code + anonymized counts, agent status with exact activation fee, not-applied state, commission summary exact grand total (`'260.0000000000' → '260'`), ledger entries exact amounts, ledger empty state, market gate, error retry.
- `features/RedemptionPage.test.tsx` (10 tests) — catalogue with exact reference values, order-history-unavailable note, **submit asserts owner payload** (`quoteId`, string idempotency key, `expectedItemVersion: 3`, `expectedTotalPoints: '1000.0000000000'`, `expectedQuantity: '1'`, `fulfilment: {type:'PICKUP'}`, `termsAcceptance: {accepted:true, termsVersion:'1.0'}`) + success state, **no double-submit on rapid double click (1 call)**, **retry after failure reuses the same idempotency key**, terms-not-accepted blocks submission (client never calls), delivery-only item shows unavailable note + no confirm button, empty catalogue, market gate, error retry.
- `layouts/MemberLayout.test.tsx` (6 tests) — all seven nav items render; clicking Wallet/Rewards/My Team/Redemption navigates; active item marked for `/wallet`.

### Results

- `pnpm --filter @ipoint/member-web exec vitest run` — **310 passed (24 files)**, including all pre-existing suites (regression green).
- `pnpm --filter @ipoint/api-client test` — **95 passed** (append-only additions are type-level; existing suite unchanged).
- `pnpm --filter @ipoint/member-web build` + `typecheck` — clean; `pnpm --filter @ipoint/api-client typecheck` — clean.
- `pnpm lint` — 0 errors (2 pre-existing warnings in untouched `apps/api/src/transaction/*` files; `apps/member-web/src/**` is in the repo eslint ignore list — baseline decision, untouched).
- `pnpm exec prettier --check` on all 16 changed files — clean.
- Workspace `pnpm test` (full vitest workspace, incl. admin-web + api unit tests): 2205 passed / 2 failed / 89 skipped. The 2 failures are pre-existing flaky P8-S5a admin-web `reports-page.test.tsx` assertions (both pass when the file runs in isolation: 8/8; e.g. the "marks a report STALE" test) and are unrelated to this change set (no admin-web file touched; the only shared surface is the append-only api-client section). Recorded for Reviewer B'.

### Static scan (self-verification)

- No `Number(`/`parseFloat(` anywhere on amount strings (only `Number.parseInt` on the quantity selector value — not an amount — and `Number.isInteger` guard in `RedemptionPage`).
- No export/download/CSV affordance; no new permission codes; no `createObjectURL`/`toBlob`/`window.open`.
- `git diff --name-only` excludes `apps/api/`, `packages/database/`, `docs/00-master/`.
- Changed files UTF-8 without BOM; no em-dash mojibake (byte-verified).

## 7. Commit map (scoped conventional commits)

| #   | Commit subject                                                                 | Scope                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `feat(p8-s5b): add member wallet/reward/team/redemption api-client clients`    | `packages/api-client/src/index.ts`, `apps/member-web/src/api/client.ts`                                                                                                                                      |
| 2   | `feat(p8-s5b): add member wallet/reward/team/redemption pages, routes and nav` | `apps/member-web/src/pages/{WalletPage,RewardPage,TeamPage,RedemptionPage}.tsx`, `apps/member-web/src/utils/amount.ts`, `apps/member-web/src/app/routes.tsx`, `apps/member-web/src/layouts/MemberLayout.tsx` |
| 3   | `feat(p8-s5b): add wallet/reward/team/redemption i18n (en, zh)`                | `apps/member-web/src/i18n/locales/{en,zh}/translation.json`                                                                                                                                                  |
| 4   | `test(p8-s5b): cover new member pages and nav activation`                      | `apps/member-web/src/test/features/{WalletPage,RewardPage,TeamPage,RedemptionPage}.test.tsx`, `apps/member-web/src/test/layouts/MemberLayout.test.tsx`                                                       |
| 5   | `docs(p8-s5b): add P8-S5b delivery report`                                     | this file                                                                                                                                                                                                    |

## 8. Assumptions / gaps / decisions

1. **Redemption order history has no member-facing GET endpoint.** The frozen Phase 6 member surface (`redemption.controller.ts`) exposes catalogue, quote, shipping cost/payment and `POST /redemption/orders` only; order-history reads exist solely on admin surfaces (admin-only permissions). Per brief §6 ("if any endpoint needed … genuinely does not exist … record the gap"), the page renders an explicit **order-history-unavailable** state (`data-testid="redemption-history-unavailable"`) instead of fabricating data.
2. **Redemption submit IS wired** (endpoint exists): `POST /redemption/orders` with owner payload + body idempotency key. Scope-bounded to **PICKUP-type fulfilment** because:
   - `DELIVERY` requires `shippingPaymentIntentReference`, whose `requestHash` is a server-side-convention SHA-256 over `{memberId, marketId, quoteId, amount, currency}`. Although member-web does hold the member/market UUIDs (auth session and `GET /markets`), the `requestHash` contract is a server/trusted-client settlement convention that member-web does not implement; wiring DELIVERY would require reverse-engineering that hash without a documented member-facing contract, so the page deliberately does not offer it and shows an explicit note for delivery-only items. Recorded here per brief §6.
   - `expectedItemVersion` is taken from the frozen item-detail `version` (the quote itself does not expose it).
   - `termsVersion` follows the RegisterPage convention: a CONFIGURABLE client constant (`CURRENT_REDEMPTION_TERMS_VERSION = '1.0'`, documented in code). The frozen redemption surface exposes no terms-version source; the owner stores it verbatim without registry validation.
3. **Agent status** is read via `GET /agent/status` without a market filter. member-web does hold a current-market UUID (`GET /markets`), but the endpoint's `market` parameter is a market **code** (not a uuid) and member-web does not persist a code anywhere; sending a code would require a lookup that can race the server-selected market. The server returns the most recent activation across markets when no filter is sent, and the page surfaces that as-is. No `x-market-id` header is sent anywhere: every used endpoint derives the member/market scope server-side from the authenticated actor (verified per controller); `GET /markets` is used solely for wallet display enrichment (name/currency).
4. **`GET /wallets/:id/entries` performs no ownership check server-side** (controller passes only wallet id; service checks existence only). The UI only ever calls it with wallet ids returned by the member's own `GET /wallets`, so the adapter introduces no new disclosure; noted for the reviewer (backend is frozen — not fixed here).
5. **HomePage's own "Wallet — Coming Soon" quick card is left untouched** (out of scope; its test asserts the current copy). Only the layout nav placeholder was activated. Can be re-pointed to `/wallet` in a later sub-phase if Bryan approves.
6. **Nav labels are now i18n-driven** (existing keys `nav.home/merchants/wallet/profile` were previously unused by the layout). No existing test asserted the old hard-coded labels (only `PublicLayout` is covered by `Layouts.test.tsx`).
7. Workspace-level flaky failures (2) are pre-existing P8-S5a admin-web reports tests (pass in isolation); no file in the changed set is involved.

## 9. Definition of done (verifier checklist)

1. ✅ `pnpm --filter @ipoint/member-web exec vitest run` — all member-web tests pass (310, existing + new).
2. ✅ `pnpm --filter @ipoint/member-web build` + `typecheck` — clean; `pnpm --filter @ipoint/api-client typecheck` — clean.
3. ✅ `pnpm lint` 0 errors (2 pre-existing warnings); `pnpm exec prettier --check` clean on all changed files.
4. ✅ Static scan: no `Number(`/`parseFloat(` on amount strings; no export/download affordance; `git diff --name-only` excludes `apps/api/`, `packages/database/`, `docs/00-master/`.
5. ✅ Delivery report present (this file) with endpoint inventory (§2), pages/routes/nav (§3), api-client additions (§4), tests + results (§6), commit map (§7), assumptions (§8).
6. ✅ Hygiene: UTF-8 no BOM, no mojibake, `.npmrc` deleted before commit (not in any commit), no `git add .`, scoped commits only.

## 10. Open items / risks

- The two flaky workspace tests (§8.7) should be re-checked by Reviewer B' against the baseline branch; they are not caused by this change set.
- Delivery-order fulfilment for DELIVERY-only catalogue items is intentionally not wired in the member UI (assumption 2); the bounded-addendum path is a separate decision for Bryan / ChatGPT Command Center.
