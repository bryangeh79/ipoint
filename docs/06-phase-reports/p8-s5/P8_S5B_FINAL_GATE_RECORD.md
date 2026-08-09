# P8-S5b Final Gate Record — Member Web UI Gap Closure

> Gate type: **Host verification + independent review + acceptance**
> Date: 2026-08-09 · Branch: `task/p8-s5b-member-web-ui-gaps` → merge target `phase/8-final-delivery-readiness`
> Gate keeper: OpenClaw (project GM, D-059/D-060 authorization) · Reviewer: Independent Reviewer B' (D-060)

## 1. Scope

Close the member-web UI gaps (gap audit F-01 / contract §5 G-05 part (a)): four new member pages — **Wallet, Reward, Team, Redemption** — as adapters over the frozen Phase 3/5/6 backends, plus api-client append-only member-domain clients, routing, navigation activation, i18n (en/zh), and tests. Zero API / database / governance changes.

## 2. Host verification results (Node v26.4.0, pnpm 9.15.9)

| Gate | Result | Evidence |
|---|---|---|
| Changed-file scope | ✅ | `c85ebe73..HEAD` = 18 files: member-web (pages/routes/layout/client/i18n/tests/utils) + api-client + p8-s5 docs only; `apps/api/`, `packages/database/`, `docs/00-master/` untouched (git diff name-only) |
| member-web test suite | ✅ 311/311 (24 files) | `pnpm --filter @ipoint/member-web exec vitest run` (independent re-run, includes new M-1 regression test) |
| api-client test suite | ✅ 95/95 | `pnpm --filter @ipoint/api-client exec vitest run` |
| member-web build + typecheck | ✅ | `build` and `typecheck` exit 0 |
| eslint / prettier | ✅ | lint 0 errors; all changed files prettier-clean |
| Static scan (amounts) | ✅ | no `Number(`/`parseFloat(` on amount strings (only pre-existing NearbyPage radius input + phone validator, not amounts); `trimAmount` lossless string display |
| Static scan (export) | ✅ | no download/CSV/export affordance in new pages (3 hits are pre-existing KYC pages, not in diff) |
| Redemption write path | ✅ (post-fix) | POST /redemption/orders owner payload field-accurate; idempotency key created once per logical attempt, reused on retry, **reset on success (M-1 fix)**; double-submit guard; PICKUP-only with explicit delivery-unavailable note; history-unavailable honest state |

## 3. Independent review (Reviewer B', D-060)

- **Verdict: APPROVED** — 0 Critical / 0 High / 1 Medium / 9 Low / 6 informational.
- Review report: `docs/06-phase-reports/p8-s5/P8_S5B_REVIEW_REPORT.md`.
- All 11 api-client methods cross-checked field-for-field against frozen controllers/types; no runtime shape probing; no `x-market-id` requirement (server derives scope from actor); append-only api-client (0 deleted lines); 310/310 + 95/95 independently re-run.
- **M-1 (Medium) — FIXED by OpenClaw bounded fix (`85b4f811`)**: after a successful order, the confirm button ("Confirm another order") reused the same idempotency key and replayed the same order instead of starting a fresh attempt. Fix: reset the key on success + success-state button closes the checkout (new quote/key on next selection). No financial risk existed; regression test added (`starts a fresh order attempt after success`). Verified 311/311 green.
- Lows: §8.2/§8.3 rationale wording corrected in the delivery report (member/market UUIDs are in fact available to member-web; the DELIVERY `requestHash` is a server settlement convention, not a client capability; agent `market` param is a code, not persisted). L-3 (`-0` boundary), L-4 (server enums not localized), L-7 (quote race) etc. are non-blocking, recorded for later polish.

## 4. Acceptance decision

Under D-059 (Command Center proxy authorization, revocable) and D-060 (alternate executor), **P8-S5b is ACCEPTED**:
- 4 member pages wired to frozen backends with canonical semantics ✅
- Amounts lossless exact-decimal; no fabricated zeros; honest unavailable states ✅
- Redemption write path: owner payload + idempotency + double-submit guard + M-1 fixed ✅
- No export surface; no new permission codes; api/database/governance untouched ✅
- Tests 311/311 member-web + 95/95 api-client green ✅

**Decision ID: D-064** · Recorded in DECISION_LOG.md · PHASE_REGISTRY.md updated.

## 5. Merge

- Source: `task/p8-s5b-member-web-ui-gaps` @ `c58058f4`
- Target: `phase/8-final-delivery-readiness`
- Commits: `84424111` feat (api-client) · `da072b6b` feat (pages/routes/nav) · `2e7822e2` feat (i18n) · `ca428dba` test · `45ebe9c8` docs (delivery report) · `db622307` docs (task brief) · `85b4f811` fix (M-1) · `c58058f4` docs (review approval)
- Method: fast-forward merge (no conflicts); no `git add .`; no untracked files touched; `.npmrc` excluded.
