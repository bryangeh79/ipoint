# P8-S5C Independent Review Report — Merchant Transaction UI

> Reviewer: independent Reviewer B' (D-060 authorization)
> Reviewed worktree: `.local/wt-p8-s5c` · Branch `task/p8-s5c-merchant-transaction-ui` @ `fadbd806`
> Base: `93932e00` · Review date: 2026-08-10
> This review is based on **independent reading of the actual code and independent execution of the verification commands**. It does not rely on the executor's self-assessment (delivery report §7 claims were re-verified from scratch).

---

## Verdict: APPROVED

The delivery satisfies the P8-S5c brief: a Transactions surface (history → preview → confirm → receipt) built strictly as an adapter over the frozen Phase 4 merchant transaction controller, with a correctly implemented M-1 idempotency discipline, honest exact-decimal amount display, and a newly wired merchant-web test infrastructure. All hard DoD gates were independently re-run and are green. One Medium finding (403 market-error code mismatch between the UI test and the real frozen backend) and three Low findings are recorded below; none blocks acceptance.

### Verification evidence (independently executed)

| Gate | Result | Evidence |
|---|---|---|
| `pnpm --filter @ipoint/merchant-web exec vitest run` | ✅ 24/24 (4 files) | model 3, amount 3, transactions-page 16, merchant-app 2 |
| `pnpm --filter @ipoint/api-client exec vitest run` | ✅ 100/100 | incl. 5-test `MerchantTransactionApiClient (P8-S5C…)` describe |
| `pnpm --filter @ipoint/merchant-web typecheck` | ✅ clean | — |
| `pnpm --filter @ipoint/merchant-web build` (tsc + vite) | ✅ clean | — |
| `pnpm --filter @ipoint/api-client typecheck` | ✅ clean | — |
| `pnpm lint` | ✅ 0 errors | no output beyond the script banner |
| `pnpm exec prettier --check` (per changed file) | ✅ all pass | — |
| Static scans (Number/parseFloat, export/download, secrets, BOM/mojibake) | ✅ clean | see §G |
| Commit map vs `git log` | ✅ 6 commits match | `2e65d956` brief, `39f43e5e` feat api-client, `e22af3db` test api-client, `b306906e` feat page, `84447428` test infra, `fadbd806` delivery report; `git status` clean; `.npmrc` untracked |

---

## Findings

### Critical

None.

### High

None.

### Medium

#### M-1 — 403 market-error test uses a code the frozen backend never returns; real 403 renders "Permission denied", not "Market access denied"

- **File / lines**:
  - `apps/merchant-web/src/transactions-page.test.tsx` — test `shows the market gate on a 403 market error` (mocks `ApiError(403, { code: 'MARKET_ACCESS_DENIED' })`).
  - `packages/api-client/src/index.ts` — `describeApiError` market branch (codes `MARKET_ACCESS_DENIED`, `MARKET_SELECTION_REQUIRED`, `MARKET_CONTEXT_MISMATCH`, `RESOURCE_MARKET_MISMATCH`, `MARKET_INACTIVE`).
  - Frozen backend (`apps/api/src/transaction/transaction.errors.ts` + `transaction.service.ts` `resolveMerchantContext`): real 403 codes on the transaction surface are **`TRANSACTION_MERCHANT_ACCESS_DENIED`**, **`TRANSACTION_MARKET_MISMATCH`**, **`TRANSACTION_MERCHANT_INACTIVE`** (preview) and **`TRANSACTION_RECEIPT_ACCESS_DENIED`** (list/detail via `assertMerchantActor`).
- **Problem**: `describeApiError` does not recognize any `TRANSACTION_*` code in its market branch, so a real backend 403 (e.g. `TRANSACTION_MARKET_MISMATCH`) falls through to `error.status === 403` → title **"Permission denied"**. The delivery report's assumption §6 and the page test both claim "Market access denied" on a market 403, but the test's mocked code is never emitted by the frozen controller. The 403 path is therefore covered by a test that does not reflect real backend behaviour.
- **Reasoning**: Functional impact is bounded — the error still renders with the backend message and a Retry action (recoverable), so this is not a blocker. It is a test-honesty/contract-consistency defect of the exact class this review is chartered to catch (review point E: "403 市场错误 → describeApiError → Market access denied + Retry").
- **Suggestion**: (a) Update the test to mock the real code (e.g. `TRANSACTION_MARKET_MISMATCH`) and assert the actual rendered title; and/or (b) add the transaction codes (`TRANSACTION_MERCHANT_ACCESS_DENIED`, `TRANSACTION_MARKET_MISMATCH`, `TRANSACTION_MERCHANT_INACTIVE`) to the `describeApiError` market list — a backward-compatible, additive change to the shared helper (all existing mappings untouched).

### Low

#### L-1 — Delivery report commit map lists `TBD` instead of actual SHAs
- **File**: `docs/06-phase-reports/p8-s5/P8_S5C_DELIVERY_REPORT.md` §9.
- **Problem**: All six rows show `TBD`; the actual commit map (`2e65d956` … `fadbd806`) is verifiable but not recorded in the report.
- **Suggestion**: Fill in the SHAs for the acceptance record.

#### L-2 — Null-placeholder style is inconsistent, and em dash is used in user-visible copy
- **File**: `apps/merchant-web/src/transactions-page.tsx` — `ReceiptRow` values: `branchName ?? '—'`, `displayName ?? '—'`, `merchantReceiptNumber ?? 'Not provided'`, `transactionNote ?? 'None'`; plus `' — MCP shortfall '` inside the confirm-blocked alert.
- **Problem**: Three different placeholder conventions on one receipt; and although the encoding is correct (UTF-8 verified, zero U+FFFD), user-visible em dashes contradict the P8-S3 L-1..L-3 lesson context and differ from member-web (which uses none).
- **Suggestion**: Pick one placeholder (e.g. `—` or `Not provided`) consistently and avoid em dash in UI copy (use a hyphen or reword).

#### L-3 — `act(...)` warning in merchant-app navigation test
- **File**: `apps/merchant-web/src/merchant-app.test.tsx` (navigates away while OverviewPage's async load resolves).
- **Problem**: Test passes (2/2) but emits "An update to OverviewPage inside a test was not wrapped in act(...)" on stderr.
- **Suggestion**: Await the overview resource settling or wrap the final assertion in `waitFor` to keep the suite output clean.

### Info (no action required)

- `queryString` was loosened from `Record<string, string|number|boolean|undefined>` to a generic `<T>`. This is a modification of a pre-existing shared helper (not strictly "append-only"), but it is behavior-preserving for all existing callers (string/number/boolean/undefined handling is identical; object/null values were never passed by typed callers) and the full api-client suite stays 100/100. Acceptable.
- `trimAmount('-0.0000000000')` yields `'-0'` (negative zero). Same behaviour as the member-web helper; backend business amounts are non-negative in practice. No action.
- `formatTimestamp` renders ISO timestamps in the browser's local timezone via `toLocaleString`; this is honest display (no fabrication), consistent with a local-time UI convention.
- Amount input has no client-side minimum/scale hint; the backend enforces scale/min/max (`TRANSACTION_AMOUNT_*` codes) and errors surface via `ErrorAlert`. Backend-authoritative validation is correct.

---

## Checklist A–G

### A. Frozen boundary — ✅

- `git diff --name-only 93932e00..HEAD` = 17 files: merchant-web (10), api-client (2), p8-s5 docs (2), root infra (3: `vitest.workspace.ts`, `tsconfig.json`, `pnpm-lock.yaml`). **No** `apps/api/`, **no** `packages/database/`, **no** `docs/00-master/`, no migrations, no checksum files.
- api-client is append-only: the P8-S5C section is at the end of `index.ts`; no existing section was moved or deleted. The only pre-existing-code touch is the `queryString` generic loosening (see Info above; backward compatible, all existing callers unchanged — verified by the 100/100 suite).
- No new permission codes; no export/download/CSV affordance anywhere (UI + typed client; static scan clean); no reversal/refund UI or typed-client methods (frozen endpoints intentionally not exposed).
- `.npmrc` not tracked; `git status` clean; commit scope matches the delivery report map.

### B. Endpoint contract consistency — ✅

Per-field verification of all four typed methods against the frozen controller/DTOs:

- `list` → `GET /merchant/transactions` — query keys (`cursor/limit/status/marketCode/dateFrom/dateTo/branchId/merchantReceiptNumber/transactionNumber`) exactly mirror `merchantTransactionListQuerySchema`; `status` typed as the `'CONFIRMED'` literal; response typed as `TransactionListResponse<MerchantTransactionReadModel>` (`items` + `nextCursor`). No `x-market-id` header sent — controller `list` never reads it (scope is `actor.accountId`). ✅
- `detail` → `GET /merchant/transactions/:transactionNumber` — path matches; response typed as `MerchantTransactionReadModel` (`MerchantTransactionListItemDto extends MerchantTransactionReceiptDto` + `mcpDeducted`/`mcpBalanceAfter`). No market header — controller `detail` does not read it. ✅
- `preview` → `POST /merchant/transactions/preview` — `MerchantTransactionPreviewRequest` field-for-field equals `transactionPreviewSchema` (`amount`, `memberQrToken`, `packageId?`, `marketId?`, `transactionNote?`); UI sends only `{amount, memberQrToken, transactionNote?}` (market via header, no invented `packageId`); response DTO `MerchantTransactionPreviewDto` field-for-field equals `TransactionPreviewResponse` (all 17 fields incl. `selectedPackage{name,rate}`, `transactionMarket{code,timezone}`). `Idempotency-Key` + `x-market-id` passed via `ApiClient` options → literal headers (verified in `executeRequest` and 401-retry path, and asserted in tests). ✅
- `confirm` → `POST /merchant/transactions/:previewSessionId/confirm` — `MerchantTransactionConfirmRequest.merchantReceiptNumber?` matches `transactionConfirmSchema` (optional, trim/min1/max100); UI sends `{}` (no invented field — assumption 4 honored); response DTO matches `TransactionConfirmResponse` incl. `receiptData`. `Idempotency-Key` header only (controller confirm does not read `x-market-id`). ✅
- No runtime shape probing anywhere — all access is typed. ✅

### C. Idempotency design (M-1 lesson) — ✅

- One key per logical order attempt: `attemptKey` created lazily on first preview submit, shared with confirm (verified in tests: confirm receives the exact preview key). Backend safety of the shared key confirmed against `transaction.service.ts`: idempotency records are keyed by `(merchantBranchId, operation, keyHash)` with `operation ∈ {PREVIEW, CONFIRM}` — the same key string across preview and confirm never collides; a COMPLETED confirm record replays the receipt.
- Failed attempts keep the key: verified by code (`setError` paths leave `attemptKey` intact) and tests (`reuses the same idempotency key on retry after a failed preview` / `…failed confirm`). Validation failures before the idempotency insert leave no record, so an edited payload retry is safe.
- Reset after success (M-1): `setAttemptKey(undefined)` on confirm success and on `startNewAttempt` ("Start over" / "Create another transaction"); regression covered by `starts a fresh idempotency key after success (M-1 regression)` — new key asserted `not.toBe` the old one.
- Double-submit prevention: preview — `LiveForm` pending flag disables the submit button plus a handler-level `if (pending) return` guard; confirm — dedicated `confirmPending` flag + guard + disabled button. Both covered by 1-call assertions.
- All five required behaviours are genuinely tested (double-submit ×2, reuse ×2, reset ×1). ✅

### D. Amount honesty — ✅

- `amount.ts` mirrors the member-web helper: string-only trailing-zero trim (`replace(/0+$/,'').replace(/\.$/,'')`), zero/negative-zero guarded, no `Number`/`parseFloat` anywhere in new code (static scan: only a doc comment in `amount.ts`; the pre-existing `merchant-model.ts` threshold `Number()` uses are baseline and untouched).
- `trimAmount('0.0000000000') → '0'` and `money()` formatting verified by tests; no fabricated zeros — the empty state is a dedicated "No transactions yet" EmptyState, never a zero row.
- CONFIRMED-only history rendered exactly as the frozen read model returns (status badge from the DTO); no "unconfirmed" fabrication; receipt fields all sourced from the frozen DTOs.

### E. Market context / error states — ✅ (with Medium M-1 caveat)

- `x-market-id` sent **only** on preview (the only endpoint the frozen controller reads it on); list/detail/confirm never send it — matches the controller. Client never invents a market id; it uses the persisted `context.marketId`.
- Loading (Skeleton), error (ErrorState with Retry; inline ErrorAlert for load-more), empty ("No transactions yet") states all present and tested.
- 403 handling routes through `describeApiError` + Retry; the test asserts "Market access denied", but see **M-1** — the mocked code is not a real backend code, so the literal title the real 403 produces is "Permission denied". Recovery path (Retry) is intact.

### F. Test infrastructure correctness — ✅

- `apps/merchant-web/package.json`: `"test": "vitest run"` + devDeps mirror member-web exactly (vitest 4.0.14, @testing-library/react 16.1.0, jest-dom 6.6.3, user-event 14.5.2, jsdom 25.0.1).
- `vitest.config.ts`: jsdom + `environmentOptions.url` + setup file + `include: src/**/*.test.{ts,tsx}` + `css`/`globals` — structurally identical to the member-web precedent.
- `vitest.workspace.ts`: `apps/merchant-web/**` added to node-unit excludes and `./apps/merchant-web/vitest.config.ts` registered as a project — exact member-web pattern.
- Root `tsconfig.json`: `apps/merchant-web/vitest.config.ts` added to include — exact member-web precedent.
- Pre-existing `merchant-model.test.ts` wired and passing (3 tests). No dependencies on files outside the repo: the root `pnpm test` failures are pre-existing and environmental — `apps/api/src/redemption/*.spec.ts` require a live PostgreSQL, and `apps/admin-web/src/pwa-policy.test.ts` reads a root `public/sw.js` that **never existed in any commit** (`git log --all -- public/sw.js` = 0). Both untouched by this change. ✅

### G. Code quality / i18n / a11y / hygiene — ✅

- merchant-web has no i18n layer (no i18next dependency); the app is English-only and the new page's copy is consistent with the existing pages' hard-coded English pattern — no mixing of locales, no untranslated leftovers.
- `data-testid`s are stable and descriptive (`transaction-history-row/-empty/-load-more`, `transaction-preview-form/-quote`, `transaction-confirm`, `transaction-start-over`, `transaction-receipt`, `transaction-new-attempt`, `transaction-back-to-history`).
- Accessibility: labelled fields via `FormField` + `useId`, `<dl>` receipt, `<thead>` table, loading region has `aria-label`, buttons have readable names.
- No BOM (byte-checked), zero U+FFFD (no mojibake), em dashes are legitimate UTF-8 (see L-2 for style).
- No secrets in the diff (only the brief's own "no secrets" wording matched).
- Commit scope matches the commit map; worktree clean after final commit.

---

## Reviewer declaration

I, Reviewer B', performed this review by reading the actual source in the worktree (transactions page, SPA wiring, typed client, DTOs, tests, configs) and by **independently executing** the test suites, typecheck, build, lint, prettier, and static scans — not by trusting the executor's self-assessment. Frozen-backend semantics (idempotency keying, header usage, schemas) were verified directly against `apps/api/src/transaction/*`. The verdict reflects my own judgment under D-060 authorization; formal acceptance remains with Bryan / ChatGPT Command Center.
