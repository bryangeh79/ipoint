# TASK_BRIEF_P8S5B — Member Web UI Gap Closure (Wallet / Reward / Team / Redemption)

> Phase 8 · Sub-phase **P8-S5b** · Branch `task/p8-s5b-member-web-ui-gaps` @ `c85ebe73`
> Contract: `P8_S0_CONTRACT_FREEZE.md` §5 (G-05 part (a)) + gap audit F-01: "member-web: **no Wallet, Team, Redemption, Agent UI** (Phase 3/5/6 backends complete)"
> Executor: independent coding subagent (D-060 alternate executor authorization) · Verifier: OpenClaw host integration gate · Reviewer: independent Reviewer B' (D-060)

---

## 1. Mission

Close the member-web UI gaps by building **four new member pages** as adapters over the frozen Phase 3/5/6 backends:

1. **Wallet** (`/wallet`) — member iPoint wallet balance + ledger history + reward summary (Phase 3 wallet/reward owners are frozen-complete).
2. **Reward** (`/reward`) — iPoint reward activity (accrual/redemption history) for the member (may share data with Wallet; separate page or tabbed section is acceptable — see §3.1).
3. **Team** (`/team`) — referral/agent team view: referral code/status, invited members, commission summary (Phase 5 referral/commission backends frozen-complete).
4. **Redemption** (`/redemption`) — redemption center: catalogue of redeemable items/points pricing + my redemption orders/history (Phase 6 redemption owner frozen-complete; **member self-service redemption must respect the frozen owner contract — read-only catalogue + history; submit only via the frozen member redemption endpoint if one exists and only with the owner's required payload/idempotency semantics**).

The `Wallet` nav item in `apps/member-web/src/layouts/MemberLayout.tsx` is currently a disabled "Coming Soon" placeholder (Phase 3 comment) — **this sub-phase activates it** and adds Team/Redemption nav items.

## 2. Frozen / Do Not Touch

- ❌ `apps/api/` — all Phase 3/5/6 backend code is frozen. **Zero API changes.** UI is an adapter over existing endpoints only.
- ❌ `packages/database/`, migrations (40/40 frozen), `docs/00-master/`, frozen owners.
- ❌ No CSV/download/export surface anywhere in the UI.
- ❌ No new permission codes (member surfaces use the member's own account scope; existing endpoints already enforce ownership).
- ❌ Do NOT modify the public-route section of `apps/member-web/src/app/routes.tsx` or auth flows; only ADD protected routes.
- ❌ No `git add .`; no `.npmrc` commit (delete the copied `.npmrc` in the worktree before committing); UTF-8 no BOM, correct Unicode (no em-dash mojibake — P8-S3 L-1..L-3 lesson).

## 3. Required work

### 3.1 Pages (new files in `apps/member-web/src/pages/`)
- `WalletPage.tsx` — balance card(s) + paginated ledger history; reward summary section (or link).
- `RewardPage.tsx` — reward activity (accruals, redemptions) for the member.
- `TeamPage.tsx` — referral/agent info: referral code (exposed only as the owner contract exposes it), invited members list, commission summary (exact-decimal amounts).
- `RedemptionPage.tsx` — catalogue + my orders/history; submit via the frozen member redemption endpoint **only if** one exists and **only with owner-required payload + idempotency key**; otherwise read-only (catalogue + history) with a documented note in the delivery report.

All pages:
- Follow existing page conventions (`MemberLayout` wrapper via routes, `useAuth` for actor, i18n via `useTranslation`, `@ipoint/ui` components, `data-testid` for assertions).
- **Amounts are exact-decimal strings** (e.g. `'187.0000000000'`): display losslessly (trailing-zero trim for display only), **never** `Number(...)`/`parseFloat` for display.
- **Market context**: send the member's current market (`x-market-id` header via api-client `marketId` option) wherever the backend requires it; never invent a market id client-side beyond what member-web already persists.
- Error/empty states: reuse existing patterns (`describeApiError` in api-client); empty list → explicit "No records" copy; loading → skeleton/spinner; 403/market errors → existing market-gate UX.
- No fabricated zeros: absence of rows renders as empty state, not `0`; real zeros from the API render as `0`.

### 3.2 Routing & navigation
- `apps/member-web/src/app/routes.tsx`: add protected routes `/wallet`, `/reward`, `/team`, `/redemption` (inside `MemberLayout`).
- `apps/member-web/src/layouts/MemberLayout.tsx`: activate the existing Wallet nav item (remove the "Coming Soon" early-return and `disabled` flags), add `Reward`, `Team`, `Redemption` nav items (desktop side nav + mobile bottom nav + drawer). Keep nav ids stable; update existing nav assertions deliberately if they change, and note it in the delivery report.

### 3.3 api-client additions (append-only — REQUIRED)
`packages/api-client/src/index.ts` currently has **no member-domain wallet/reward/redemption/commission client** (only Admin clients + `MemberAdsContentApiClient`). Add typed member-domain clients as **append-only sections** (do not move/merge existing sections):
- Explore the frozen backend controllers in `apps/api/src/{wallet,reward,referral,commission,redemption,agent-activation,transaction-reward}/` to derive exact paths/DTO shapes; mirror them exactly (no shape probing at runtime).
- Suggested: `MemberWalletApiClient` (balance + ledger pages), `MemberRewardApiClient` (reward activity), `MemberTeamApiClient` (referral code/status + invited members + commission summary), `MemberRedemptionApiClient` (catalogue + orders + submit if the frozen endpoint exists).
- Wire them up in `apps/member-web/src/api/client.ts` (export singletons like `memberAdsContentApi`).
- **Read-only defaults**: no write method unless a frozen member-facing write endpoint exists and the page genuinely needs it.

### 3.4 i18n
- Add all new copy to the member-web i18n resource files (en + any locales present). Follow the existing key structure. No hard-coded user-facing strings.

### 3.5 Tests (REQUIRED — gate is red without them)
- Page tests (`WalletPage.test.tsx` / `RewardPage.test.tsx` / `TeamPage.test.tsx` / `RedemptionPage.test.tsx`, or one consolidated test file per the repo convention): per page — render with mocked client (established mock pattern), assert balance/amounts as exact strings, ledger/order rows visible, empty state, error state (e.g. 403 market), loading state; Redemption: catalogue + history assertions; if submit exists, assert payload + idempotency key sent and no double-submit on retry click.
- `MemberLayout` test updates if nav assertions changed.
- api-client additions: type-level only (no new unit tests required beyond what the pages exercise), but page tests must cover each new client method path via the mocks.
- Existing tests must keep passing unchanged (regression) unless a deliberate nav change is documented.

### 3.6 Hygiene
- UTF-8 no BOM; correct Unicode; scoped conventional commits (`feat(p8-s5): ...`, `test(p8-s5): ...`, `docs(p8-s5): ...`); delete `.npmrc` in worktree before commit; no secrets.

## 4. Definition of done (verifier will check)

1. `pnpm --filter @ipoint/member-web exec vitest run` — all member-web tests pass (existing + new).
2. `pnpm --filter @ipoint/member-web build` + `pnpm --filter @ipoint/member-web typecheck` — clean.
3. `pnpm --filter @ipoint/api-client typecheck` (or repo typecheck for the api-client package) — clean.
4. `pnpm lint` clean; `pnpm exec prettier --check` clean on changed files.
5. Static scan: no `Number(`/`parseFloat(` on amount strings; no export/download affordance; git diff name-only must exclude `apps/api/`, `packages/database/`, `docs/00-master/`.
6. Delivery report `docs/06-phase-reports/p8-s5/P8_S5B_DELIVERY_REPORT.md`: scope, backend endpoint inventory (paths + DTO sources), pages/routes/nav changes, api-client additions, tests + results, commit map, assumptions (incl. which member redemption write endpoint, if any, was wired and why).

## 5. Deliverables

- `apps/member-web/src/pages/{WalletPage,RewardPage,TeamPage,RedemptionPage}.tsx` (+ tests)
- `apps/member-web/src/app/routes.tsx`, `apps/member-web/src/layouts/MemberLayout.tsx` (extended)
- `apps/member-web/src/api/client.ts` (new client singletons)
- `packages/api-client/src/index.ts` (append-only member-domain sections)
- member-web i18n resources (en + locales)
- `docs/06-phase-reports/p8-s5/P8_S5B_DELIVERY_REPORT.md`

## 6. Notes

- The four backend domains are **frozen-complete** (Phase 3 wallet/reward, Phase 5 referral/commission, Phase 6 redemption): the UI must not compensate for or "improve" backend semantics; surface exactly what the frozen contracts return.
- If any endpoint needed for the UI genuinely does not exist on the backend, **do not add it**: record the gap in the delivery report (assumptions/risks section) — the bounded-addendum path is a separate decision.
- Honesty semantics apply: asOf/timestamps shown where the DTO provides them; no fabricated zeros; no export.
