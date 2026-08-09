# P8-S5c Final Gate Record — Merchant Transaction UI

> Gate type: **Host verification + independent review + acceptance**
> Date: 2026-08-10 · Branch: `task/p8-s5c-merchant-transaction-ui` → merge target `phase/8-final-delivery-readiness`
> Gate keeper: OpenClaw (project GM, D-059/D-060 authorization) · Reviewer: Independent Reviewer B' (D-060)

## 1. Scope

Close the merchant-web UI gap (gap audit F-01 / contract §5 G-05 part (a)): **Transactions surface** (preview → confirm → receipt → history) as an adapter over the frozen Phase 4 `@Controller('merchant/transactions')` endpoints, plus the merchant-web test infrastructure (the app previously had no vitest wiring). Reversal/refund UI deliberately out of scope (not in G-05(a)). Zero API / database / governance changes.

## 2. Host verification results (Node v26.4.0, pnpm 9.15.9)

| Gate | Result | Evidence |
|---|---|---|
| Changed-file scope | ✅ | `93932e00..HEAD` = 16 files: merchant-web (transactions-page, merchant-app, api/client, amount, tests, vitest config/setup), api-client append-only section + test, p8-s5 docs, root vitest.workspace.ts / tsconfig.json / pnpm-lock.yaml (test infra, member-web precedent); `apps/api/`, `packages/database/`, `docs/00-master/` untouched |
| merchant-web test suite | ✅ 24/24 (4 files) | `pnpm --filter @ipoint/merchant-web exec vitest run` (independent re-run; includes M-1 market-gate regression) |
| api-client test suite | ✅ 100/100 | `pnpm --filter @ipoint/api-client exec vitest run` |
| build / typecheck | ✅ | merchant-web build + typecheck exit 0 |
| eslint / prettier | ✅ | lint 0 errors; all changed files prettier-clean |
| Static scans | ✅ | no `Number(`/`parseFloat(` on amounts (amount.ts lossless trim); no export/download/CSV affordance; no reversal/refund actions in UI |
| Idempotency design | ✅ | one key per logical attempt; reused on retry; reset after success (M-1 lesson); double-submit guard; tests cover reuse/reset/double-submit |
| Market scope | ✅ | `x-market-id` sent only on preview (only endpoint that reads it); list/detail server-derived; real 403 codes (`TRANSACTION_MARKET_MISMATCH` / `TRANSACTION_MARKET_SETTINGS_MISSING`) now map to the market gate |

## 3. Independent review (Reviewer B', D-060)

- **Verdict: APPROVED** — 0 Critical / 0 High / 1 Medium / 3 Low.
- Review report: `docs/06-phase-reports/p8-s5/P8_S5C_REVIEW_REPORT.md`.
- All 4 client methods cross-checked field-for-field against the frozen controller/DTOs; idempotency design verified safe against backend (branch, operation, keyHash) semantics; test infra matches member-web precedent; pwa-policy/sw.js baseline issues confirmed unrelated.
- **M-1 (Medium) — FIXED by OpenClaw bounded fix (`f5ce39bb`)**: the 403 market-error test mocked a code the frozen backend never returns (`MARKET_ACCESS_DENIED`; real: `TRANSACTION_MARKET_MISMATCH` / `TRANSACTION_MARKET_SETTINGS_MISSING`), so a real 403 rendered "Permission denied" instead of the claimed market gate. Fix: page-level `describeTransactionError` maps the real codes to the market-gate copy (+ `ApiError` import), and the test now mocks the real code and asserts the true behaviour. Verified 24/24 green.
- Lows (non-blocking): delivery-report commit map SHA placeholders (filled in this gate record), em-dash style in one user-visible string (legal Unicode, style preference), `act()` warnings in merchant-app tests (dev-only noise).

## 4. Acceptance decision

Under D-059 (Command Center proxy authorization, revocable) and D-060 (alternate executor), **P8-S5c is ACCEPTED**:
- Transactions surface (preview/confirm/receipt/history) wired to frozen Phase 4 endpoints ✅
- Idempotency + double-submit + post-success reset (M-1 lesson applied) ✅
- Amounts lossless exact-decimal; honest empty/error states; real 403 codes → market gate ✅
- No export; no reversal/refund UI (out of scope); api/database/governance untouched ✅
- Tests 24/24 merchant-web + 100/100 api-client green (incl. new test infra) ✅

**Decision ID: D-065** · Recorded in DECISION_LOG.md · PHASE_REGISTRY.md updated.

## 5. Merge

- Source: `task/p8-s5c-merchant-transaction-ui` @ `95241064`
- Target: `phase/8-final-delivery-readiness`
- Commits: `2e65d956` docs (task brief) · `39f43e5e` feat (typed client) · `e22af3db` test (client paths) · `b306906e` feat (transactions page) · `84447428` test (vitest infra + tests) · `fadbd806` docs (delivery report) · `f5ce39bb` fix (M-1 market gate) · `95241064` docs (review approval)
- Method: fast-forward merge (no conflicts); no `git add .`; no untracked files touched; `.npmrc` excluded.
