# P8-S5c Delivery Report — Merchant Transaction UI (Preview / Confirm / Receipt / History)

## 1. Task and scope

- Task (TASK_BRIEF_P8S5C.md): close the merchant-web UI gap (gap audit F-01: "merchant-web … **no Transaction UI** (Phase 4 backend complete)") by adding a **Transactions** surface to the single-file SPA (`apps/merchant-web/src/merchant-app.tsx`) as an adapter over the frozen Phase 4 merchant transaction endpoints: **history → preview → confirm → receipt**.
- Also delivered: merchant-web **test infrastructure** (none existed — `merchant-model.test.ts` was unwired) and the wired test suite.
- Contract: `P8_S0_CONTRACT_FREEZE.md` §5 (G-05 part (a)) + gap audit F-01. Executor: independent coding subagent (D-060 alternate executor authorization). Verifier: OpenClaw host integration gate. Reviewer: independent Reviewer B' (D-060).
- Branch: `task/p8-s5c-merchant-transaction-ui` (worktree `.local/wt-p8-s5c`, base `93932e00`).
- Role boundary: implementation evidence only. This report does not approve or accept P8-S5c; acceptance belongs to Bryan / ChatGPT Command Center.

## 2. Backend endpoint inventory (paths + DTO sources)

All paths mirror the frozen controller (`apps/api/src/transaction/transaction.controller.ts`, `@Controller('merchant/transactions')`) **exactly**; no runtime shape probing. Amounts are exact decimal strings passed through untouched (`TransactionFinancialSnapshot`/`transaction.types.ts` note: "JavaScript Number must not be used").

| Method + path                                                                                                                | DTO source                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /merchant/transactions?cursor&limit&status&marketCode&dateFrom&dateTo&branchId&merchantReceiptNumber&transactionNumber` | `transaction-read.dto.ts` → `MerchantTransactionListQuery` / `TransactionListResponse<MerchantTransactionReadModel>` (cursor paging, newest first, CONFIRMED only) |
| `GET /merchant/transactions/:transactionNumber`                                                                              | `transaction-read.dto.ts` → `MerchantTransactionReadModel` (receipt + `mcpDeducted`/`mcpBalanceAfter`)                                                             |
| `POST /merchant/transactions/preview` (requires **Idempotency-Key** + **x-market-id** headers)                               | `transaction.dto.ts` → `TransactionPreviewDto` / `TransactionPreviewResponse`                                                                                      |
| `POST /merchant/transactions/:previewSessionId/confirm` (requires **Idempotency-Key** header)                                | `transaction.dto.ts` → `TransactionConfirmDto` / `TransactionConfirmResponse` (incl. `receiptData`)                                                                |

Not used by the UI (frozen but **out of scope** for G-05(a)): `POST /merchant/transactions/:transactionNumber/reversal-requests`, `POST .../refund-requests`, `GET .../reversal-request`, `GET .../refund-request`. No UI, no typed-client methods, no action buttons; the frozen read DTOs only ever expose `CONFIRMED` receipts, which are rendered read-only.

## 3. Page flow and UI changes

### 3.1 Navigation (`apps/merchant-web/src/merchant-app.tsx`)

- `'transactions'` added to the `MerchantPage` union and to the `navigation` array (label **Transactions**, between Packages and MCP) — appears in the desktop side nav and the mobile bottom nav.
- `MerchantPageView` gained `case 'transactions'` → `<TransactionsPage context={context} />`.
- The module-level `api = new ApiClient(...)` singleton moved to a new `apps/merchant-web/src/api/client.ts` (mirrors the member-web layout), which also exports the typed `merchantTransactionApi`. No behavior change (the old storage-key second argument is deprecated and ignored by `ApiClient`).

### 3.2 Transactions page (`apps/merchant-web/src/transactions-page.tsx`, new)

Flow: **history list → preview form → server quote → confirm → receipt**.

- **History** — bounded cursor paging (`limit: 20`, "Load more" when `nextCursor`), newest first. Rows: transaction number, formatted time, masked member reference, **exact amount** (`MYR 120.5` from `'120.5000000000'` via `trimAmount`), CONFIRMED badge, "View receipt" (→ `GET /:transactionNumber`). Explicit "No transactions yet" empty state; error state with Retry; a 403 market error surfaces the existing `describeApiError` market copy ("Market access denied"); load-more failures keep the list and show an inline alert.
- **Preview form** — Amount (exact decimal input, `pattern="[0-9]+(\.[0-9]+)?"`), Member QR token, optional Note (`transactionNote`). Market context is read from `context.marketId` (persisted `ipoint.merchant.context`); the client never invents a market id.
- **Quote** — server `TransactionPreviewResponse` rendered with exact amounts: amount, service-fee rate, package, estimated MCP debit, current/after MCP balance, expected daily reward, reward cap, reward rate, member reference, market code/timezone, quote expiry. When `mcpSufficient`/`confirmAllowed` is false the confirm button is disabled and the shortfall is shown. "Start over" abandons the attempt.
- **Confirm** — `POST /:previewSessionId/confirm` (body `{}`; `merchantReceiptNumber` is optional on the frozen DTO and no UI field was invented). Success → receipt view from the confirm response's `receiptData`; failure → error alert, form/quote retained for retry.
- **Receipt** — renders exactly the frozen `TransactionReceiptData` fields (transaction number, status, merchant/branch, masked member, market, exact purchase amount, service fee + rate, package, reward rate/daily/cap/start-date, merchant receipt number or "Not provided", note or "None", transaction time). Buttons: "Create another transaction" (fresh attempt) and "Back to history" (reloads the list).
- **No export/download/CSV** anywhere; **no reversal/refund UI**; no fabricated zeros or fields.

### 3.3 Amounts

New local helper `apps/merchant-web/src/amount.ts` (`trimAmount` trailing-zero trim for display only + `money(currency, amount)`), mirroring the member-web helper — no shared package helper exists. **Never** `Number(...)`/`parseFloat(...)` on amounts anywhere in the new UI (static scan clean; the only `Number(` uses in merchant-web `src` are in the pre-existing, untouched `merchant-model.ts` threshold logic).

## 4. Idempotency design (P8-S5b M-1 lesson — REQUIRED)

- **One key per logical order attempt.** A single `attemptKey` is created lazily at the first preview submit and reused for the whole attempt — including the confirm step. The frozen backend stores idempotency records keyed by `(merchantBranchId, operation, keyHash)` with `operation ∈ {PREVIEW, CONFIRM}`, so the same key string is safe across the two calls (verified in `transaction.service.ts`); a COMPLETED confirm record replays the receipt.
- **Reused on retry.** A failed preview or confirm keeps the key, so the next submit replays the same key (same payload → server replays/retries; validation failures before the idempotency insert leave no record, so an edited payload after a validation error is also safe).
- **Reset after success (M-1).** On confirm success the key is cleared and the receipt's "Create another transaction" (and "Start over") begin a fresh attempt with a new key — this is the exact regression class the S5b gate found (`85b4f811`).
- **Double-submit prevention.** The preview submit button is disabled while in flight (`LiveForm` pending state, plus a handler-level guard); the confirm button has a dedicated `confirmPending` flag + guard.
- Behavior is covered by tests: key reused after failed preview, key reused after failed confirm, **fresh key after success (M-1 regression)**, and double-submit guards for both preview and confirm.

## 5. Typed client placement decision

**Append-only typed client in `packages/api-client`** (consistent with P8-S5b): `MerchantTransactionApiClient` + DTOs (`MerchantTransactionListQuery`, `MerchantTransactionReceiptDto`, `MerchantTransactionListItemDto`, `MerchantTransactionListPageDto`, `MerchantTransactionPreviewRequest/PreviewDto`, `MerchantTransactionConfirmRequest/ConfirmDto`) added as an append-only section at the end of `packages/api-client/src/index.ts`. `preview(input, marketId, idempotencyKey)` and `confirm(previewSessionId, input, idempotencyKey)` pass the key and market through the existing `ApiClient` options, which set the literal `idempotency-key` / `x-market-id` headers (already covered by api-client's own header tests). The merchant-web app wires it through the local `apps/merchant-web/src/api/client.ts` wrapper (same pattern as member-web). `queryString` was loosened to a generic so interface query DTOs are accepted (backward compatible; all existing callers unchanged).

## 6. Test infrastructure (merchant-web previously had none)

- `apps/merchant-web/package.json`: `"test": "vitest run"` + devDeps mirrored from member-web (`vitest@4.0.14`, `@testing-library/react@16.1.0`, `@testing-library/jest-dom@6.6.3`, `@testing-library/user-event@14.5.2`, `jsdom@25.0.1`); `pnpm-lock.yaml` updated by offline install.
- `apps/merchant-web/vitest.config.ts`: jsdom, `environmentOptions.url`, setup file, `include: src/**/*.test.{ts,tsx}`, `css: true`, `globals: true` (mirrors member-web).
- `apps/merchant-web/src/test/setup.ts`: jest-dom matchers + React 19 act-wrapped cleanup + `matchMedia`/`navigator.languages` mocks + `crypto.randomUUID` guard (ported from member-web).
- `vitest.workspace.ts`: `apps/merchant-web/**` added to the node-unit excludes (no double-run) and `./apps/merchant-web/vitest.config.ts` added as a workspace project.
- Root `tsconfig.json`: `apps/merchant-web/vitest.config.ts` added to the include list (exact member-web precedent) so the project-service lint/typecheck sees it.

## 7. Tests + results

### 7.1 Wired suite (`pnpm --filter @ipoint/merchant-web exec vitest run`) — **24/24 green**

| File                                                   | Tests | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/merchant-model.test.ts` (pre-existing, now wired) | 3     | activation hints / onboarding progress / operational status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/amount.test.ts` (new)                             | 3     | `trimAmount` lossless display, no Number conversion, `money` formatting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/transactions-page.test.tsx` (new)                 | 16    | history rows with exact amount strings (`'120.5000000000'` → `MYR 120.5`, `'88.0000000000'` → `MYR 88`); empty state; 403 market error state; generic error + retry; cursor load-more (second call `{limit: 20, cursor}`); receipt-from-history via detail; preview submits with market id + non-empty idempotency key; quote renders exact decimals; confirm uses the same attempt key and shows the receipt; **preview double-submit guard (1 call)**; **confirm double-submit guard (1 call)**; **key reused after failed preview**; **key reused after failed confirm**; **fresh key after success (M-1 regression)**; failed-preview error keeps the form; **no export/download/reversal/refund affordance** |
| `src/merchant-app.test.tsx` (new)                      | 2     | Transactions present in side + bottom nav; clicking navigates and loads history (localStorage stubbed per member-web convention)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### 7.2 Typed client tests (`pnpm --filter @ipoint/api-client exec vitest run`) — **100/100 green**

New `MerchantTransactionApiClient (P8-S5C …)` describe block: list path + cursor/limit query; detail path; preview asserts body + literal `idempotency-key` and `x-market-id` headers; confirm asserts path + body + `idempotency-key` header; server error propagates as `ApiError` (409 idempotency mismatch).

### 7.3 Build / typecheck / lint / format

- `pnpm --filter @ipoint/merchant-web typecheck` — clean; `build` (`tsc -p tsconfig.build.json && vite build`) — clean.
- `pnpm --filter @ipoint/api-client typecheck` + `build` — clean.
- `pnpm lint` — **0 errors** (2 pre-existing warnings in frozen `apps/api` files, untouched).
- `pnpm exec prettier --check` — clean on all changed files.
- Root `pnpm test` (vitest workspace) — merchant-web project 24/24; the 4 failing files are pre-existing environment/baseline failures untouched by this change (`apps/api/src/redemption/*.spec.ts` DB-dependent integration specs requiring a live PostgreSQL, and `apps/admin-web/src/pwa-policy.test.ts` which reads a root `public/sw.js` that is not in the repository at any commit).

### 7.4 Static scan

- No `Number(`/`parseFloat(` on amounts in any new/changed file (only the untouched baseline `merchant-model.ts` threshold logic and a doc comment in `amount.ts`).
- No export/download/CSV affordance (UI + typed client); no reversal/refund surface.
- `git diff --name-only` excludes `apps/api/`, `packages/database/`, `docs/00-master/`, migrations and checksums.

## 8. Assumptions / differences from the brief

1. **Typed client placed in api-client (append-only), not a merchant-web local helper** — consistent with P8-S5b and the brief's preference; the local `api/client.ts` wrapper mirrors member-web and gives a clean test seam.
2. **One idempotency key shared by preview and confirm** within a logical attempt. The frozen backend discriminates idempotency records by `operation`, so a shared key is safe; this is the strictest reading of "ONE idempotency key per logical order attempt" and keeps retry semantics simple.
3. **Receipt view uses the confirm response's `receiptData`** (brief explicitly allows "confirm 响应或 GET 详情"); history rows use `GET /:transactionNumber`. No extra network call after confirm.
4. **`merchantReceiptNumber` (confirm body) is not exposed as a form field** — the brief's "optional reference" maps to the preview `transactionNote`; sending an invented receipt-number UI would go beyond the brief.
5. **History is CONFIRMED-only** — the frozen list query default (`status` optional, rows always CONFIRMED receipts) and the read model only expose confirmed transactions; the page renders exactly that.
6. **Market-gate handling** reuses the existing merchant-web pattern (`describeApiError` → "Market access denied" + Retry) — merchant-web has no dedicated market-gate component like member-web; the 403 path is covered by a test.
7. **`x-market-id` sent only where the frozen controller reads it** (preview). `GET /` and `GET /:transactionNumber` never read the header, so the typed client does not send it there (list/detail scope is server-derived from the authenticated account's branch access).
8. **Merchant-web devDeps + `vitest.workspace.ts` + root `tsconfig.json` edits** are part of the mandated test infrastructure (merchant-web had none); the workspace/tsconfig changes follow the exact member-web precedent.
9. Root `pnpm test` baseline failures (§7.3) are environmental/pre-existing and outside this scope; the verifier's DoD commands for this sub-phase (`--filter @ipoint/merchant-web …`, api-client, lint, prettier) are all green.

## 9. Commit map

| Commit | Type        | Contents                                                                                                                                                                                  |
| ------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TBD`  | docs(p8-s5) | task brief `TASK_BRIEF_P8S5C.md`                                                                                                                                                          |
| `TBD`  | feat(p8-s5) | api-client append-only `MerchantTransactionApiClient` + DTOs (`packages/api-client/src/index.ts`)                                                                                         |
| `TBD`  | test(p8-s5) | api-client P8-S5C describe block (`index.test.ts`)                                                                                                                                        |
| `TBD`  | feat(p8-s5) | merchant transactions page + nav (`api/client.ts`, `amount.ts`, `transactions-page.tsx`, `merchant-app.tsx`)                                                                              |
| `TBD`  | test(p8-s5) | merchant-web vitest infra + wired tests (package.json, vitest.config.ts, setup.ts, vitest.workspace.ts, tsconfig.json, pnpm-lock.yaml, model/amount/transactions-page/merchant-app tests) |
| `TBD`  | docs(p8-s5) | this delivery report                                                                                                                                                                      |

`.npmrc` (copied into the worktree for the executor environment) deleted before commit; `git status` clean after the final commit.
