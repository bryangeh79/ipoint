# TASK_BRIEF_P8S5C — Merchant Transaction UI (Preview / Confirm / Receipt / History)

> Phase 8 · Sub-phase **P8-S5c** · Branch `task/p8-s5c-merchant-transaction-ui` @ `93932e00`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §5 (G-05 part (a)) + gap audit F-01: "merchant-web … **no Transaction UI** (Phase 4 backend complete)"
> Executor: independent coding subagent (D-060 alternate executor authorization) · Verifier: OpenClaw host integration gate · Reviewer: independent Reviewer B' (D-060)

---

## 1. Mission

Add a **Transactions** surface to the merchant-web single-file SPA (`apps/merchant-web/src/merchant-app.tsx`) covering the frozen Phase 4 merchant endpoints: **preview → confirm → receipt → history**. The backend is frozen-complete; this sub-phase adds the UI adapter only (plus the test infrastructure merchant-web currently lacks).

Frozen backend surface (`apps/api/src/transaction/transaction.controller.ts`, `@Controller('merchant/transactions')`):

- `GET /merchant/transactions` — history list
- `GET /merchant/transactions/:transactionNumber` — single transaction (receipt view)
- `POST /merchant/transactions/preview` — create preview session (requires `Idempotency-Key` + `x-market-id` headers)
- `POST /merchant/transactions/:previewSessionId/confirm` — confirm preview (requires `Idempotency-Key` header)
- (Out of scope for this UI: `reversal-requests` / `refund-requests` — not part of G-05(a) preview/confirm/receipt/history; do NOT build them.)

## 2. Frozen / Do Not Touch

- ❌ `apps/api/` — Phase 4 backend frozen. **Zero API changes.**
- ❌ `packages/database/`, migrations (40/40 frozen), `docs/00-master/`, frozen owners.
- ❌ No CSV/download/export surface; no new permission codes; no `git add .`; no `.npmrc` commit (delete the copied `.npmrc` in the worktree before committing); UTF-8 no BOM, correct Unicode (no em-dash mojibake — P8-S3 L-1..L-3 lesson).

## 3. Required work

### 3.1 Merchant app — Transactions page

`apps/merchant-web/src/merchant-app.tsx` is a hash-nav single-page app with `MerchantPage` union (`overview | access | profile | verification | packages | mcp`) and a `navigation` array. Add:

- `'transactions'` to the `MerchantPage` union and the `navigation` array (desktop side nav + mobile bottom nav; keep label "Transactions").
- A `TransactionsPage` render branch (component can live in the same file or a new `transactions-page.tsx` imported by `merchant-app.tsx` — follow the existing single-file style; a separate file is acceptable if it keeps the pattern consistent).
- Page flow: **history list** (bounded, with paging if the API supports it; otherwise newest-first list) → **preview form** (amount, currency/market from context, optional reference) → **quote/preview result** (exact-decimal amounts, service fee if returned) → **confirm** (idempotency key, success → receipt) → **receipt view** (from the confirm response or `GET /transactions/:transactionNumber`).
- Market context: merchant-web persists `{branchId, marketId}` in `ipoint.merchant.context` (localStorage). Send `x-market-id` = context marketId on preview (the controller reads it) and on any call that needs it; never invent a market id.
- Amounts: exact-decimal strings; display losslessly (`trim` trailing zeros for display only), **never** `Number(...)`/`parseFloat` for amount display. Reuse/locate a lossless amount helper (member-web added `apps/member-web/src/utils/amount.ts` — merchant-web may add its own or a shared package util; prefer a small local helper if no shared one exists).
- **Idempotency (P8-S5b M-1 lesson — REQUIRED)**: a logical order attempt holds ONE idempotency key (created once, reused on retry, **reset after success** so "create another transaction" starts a fresh attempt); prevent double-submit while a request is in flight (disable the button / guard flag); failed attempts keep the key for replay.
- Error/empty/loading states: reuse existing patterns in the file (Skeleton, Alert, EmptyState); a 403/market error shows the existing market-gate handling; explicit "no transactions" empty state; no fabricated zeros.
- The `api` instance in `merchant-app.tsx` is a raw `ApiClient` (no typed client) — add a small typed `MemberMerchantTransactionClient` (or plain typed helper functions) in `apps/merchant-web/src/` OR an append-only typed client section in `packages/api-client/src/index.ts`. **Prefer api-client append-only** (consistent with P8-S5b) unless the merchant-web pattern clearly favours a local helper — document the choice in the delivery report.

### 3.2 Test infrastructure (REQUIRED — merchant-web has none today)

`apps/merchant-web/package.json` has **no `test` script and no vitest config**; `merchant-model.test.ts` exists but is not wired. Add:

- `vitest` + `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event` + `jsdom` devDependencies (mirror member-web's versions), a `vitest.config.ts` (jsdom environment, setup file), and a `test` script (`vitest run`).
- Port the existing `merchant-model.test.ts` into the wired suite (it must pass).
- Add page tests for the transactions flow: history renders rows with exact amount strings; preview form submits with `Idempotency-Key` + `x-market-id` headers (assert via mocked fetch/client); confirm sends the key and shows receipt; **double-submit prevented**; **idempotency key reused on retry after failure and reset after success**; empty state; error state (403 market); no export affordance.
- Follow the established mock style from member-web tests (`mockedXApi as ReturnType<typeof vi.fn>`).

### 3.3 Hygiene

- UTF-8 no BOM; correct Unicode; scoped conventional commits (`feat(p8-s5): ...`, `test(p8-s5): ...`, `docs(p8-s5): ...`); delete `.npmrc` in worktree before commit; no secrets.

## 4. Definition of done (verifier will check)

1. `pnpm --filter @ipoint/merchant-web exec vitest run` — all merchant-web tests pass (wired suite: existing model tests + new transactions tests).
2. `pnpm --filter @ipoint/merchant-web build` + `pnpm --filter @ipoint/merchant-web typecheck` — clean.
3. If api-client was extended: `pnpm --filter @ipoint/api-client exec vitest run` still green + typecheck clean.
4. `pnpm lint` clean (0 errors); `pnpm exec prettier --check` clean on changed files.
5. Static scan: no `Number(`/`parseFloat(` on amount strings; no export/download affordance; git diff name-only excludes `apps/api/`, `packages/database/`, `docs/00-master/`.
6. Delivery report `docs/06-phase-reports/p8-s5/P8_S5C_DELIVERY_REPORT.md`: scope, endpoint inventory, page flow, idempotency design (incl. M-1 lesson), test-infra addition, tests + results, commit map, assumptions (incl. typed-client placement decision).

## 5. Deliverables

- `apps/merchant-web/src/merchant-app.tsx` (transactions page + nav) and/or `apps/merchant-web/src/transactions-page.tsx`
- `apps/merchant-web/src/merchant-model.ts` (+ helpers if needed)
- api-client append-only section OR local typed helper (documented choice)
- `apps/merchant-web/vitest.config.ts` + test setup + `package.json` test script + devDependencies
- `apps/merchant-web/src/**/*.test.{ts,tsx}` (transactions flow + wired model tests)
- `docs/06-phase-reports/p8-s5/P8_S5C_DELIVERY_REPORT.md`

## 6. Notes

- Reversal/refund endpoints exist on the frozen backend but are **out of scope** for G-05(a) — do not build UI for them; if the history/detail DTO exposes their state, render it read-only as returned (no action buttons).
- The confirm response or the transaction detail returns the receipt data (order/receipt number, amounts, timestamps) — surface exactly what the frozen DTO provides; no fabricated fields.
- Follow the P8-S5b honesty contract: asOf/timestamps shown where provided; no fabricated zeros; no export.
