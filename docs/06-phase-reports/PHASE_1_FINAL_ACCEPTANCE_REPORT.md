# Phase 1 Final Acceptance Report

> - Phase: Phase 1 — Merchant Onboarding + MCP Ledger
> - Repair authorization: ChatGPT Command Center Repair Order, 2026-07-17 14:00 +08:00
> - Previous phase head: `eb9149503714ed36ec075deb018fa39c61452f71`
> - Phase branch: `phase/1-merchant-onboarding-mcp`
> - Repair implementation head: `c97324ef`
> - Main merge: **NOT PERFORMED**
> - Phase 2: **NOT AUTHORIZED**
> - Status: **FINAL REPAIR VERIFIED — COMMAND CENTER ACCEPTANCE REQUIRED**

## 1. Summary

The Phase 1 final-acceptance repair is complete. Merchant and Admin workspaces now use the live NestJS HTTP API and PostgreSQL-backed workflows. P1-S9 integration status is **Verified**. The earlier product-shell/live-wiring limitation has been removed.

This report records engineering evidence only. It does not accept Phase 1, merge `main`, or authorize Phase 2.

## 2. Files and repair commits

| Commit     | Scope                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| `8d8fb923` | Idempotent verified-OTP handoff for explicit verify then registration                 |
| `74a6b851` | Merchant list, audit/timeline API, MarketAccess errors, CORS/test bootstrap           |
| `1d604b55` | Recharge activation, refund aliases, and separated Maker/Checker adjustment execution |
| `06136893` | Shared browser API client and live Merchant/Admin UI wiring                           |
| `c97324ef` | Real UI→API→PostgreSQL Playwright acceptance and CI database setup                    |

The final documentation commit and final remote SHA are verified in Git history and in the delivery output after push; a commit cannot contain its own SHA.

## 3. What was implemented

- Added a typed browser `fetch` client with access/refresh-token storage, one-time refresh on 401, session-expired events, idempotency keys, and normalized API error envelopes.
- Replaced static Merchant success view models with live registration, OTP, login, password reset, profile, application, KYC/document, packages, MCP ledger, recharge, and refund requests.
- Replaced static Admin success view models with live merchant/application/KYC queues, reviews, packages, MCP operations, Maker/Checker adjustment, suspend/reactivate, and audit/timeline requests.
- Added loading, error, empty, offline, permission-denied, MarketAccess-denied, validation, and session-expired states.
- Added missing Merchant list and admin audit HTTP contracts and preserved RBAC, MarketAccess, branch ownership, and audit enforcement.
- Re-evaluated activation after recharge completion so approved merchants become `ACTIVE` only when available MCP reaches the locked threshold.
- Kept adjustment approval and execution as separate governed operations; maker self-approval/execution remains forbidden.
- Audited `BATCH_B_ACCEPTANCE_EVIDENCE.md` as legitimate, unique Phase 1 evidence and formatted it for inclusion on the phase branch.

## 4. Product and business value

Phase 1 is now demonstrably usable through the actual browser interfaces rather than only through API tests. The evidence covers onboarding, compliance review, package assignment, MCP funding, activation, suspension/reactivation, governed balance changes, refunds, and auditability without fake production integrations.

## 5. Complexity and maintenance risk

- The shared API client prevents duplicated token-refresh and error-mapping logic across Merchant and Admin applications.
- Existing endpoints and legacy adjustment decision behavior remain compatible while the UI uses explicit approve/execute routes.
- No new external service, payment provider, message delivery, database technology, or production side effect was introduced.
- Remaining risk is limited to normal browser/API contract evolution; the acceptance E2E suite now protects the critical cross-layer paths.

## 6. Real UI→API→DB evidence

The live browser suite creates isolated test actors and data, then verifies persisted outcomes through PostgreSQL-backed API responses.

- Merchant: register, issue/verify OTP, login, update profile, submit application, submit KYC with document intents, view packages, view MCP summary/ledger, request refund, and observe suspended read-only state.
- Admin: application/KYC queues and approval, package profile/version activation and assignment/default, recharge completion, adjustment maker/checker approval/execution, refund review, suspend/reactivate, and audit/timeline.
- Activation: approved Application + approved KYC + MCP below 100 remains `PENDING_MCP`; completed recharge to at least 100 changes status to `ACTIVE`.
- Negative paths: wrong market 403 with MarketAccess display, unauthorized/session expiry with refresh failure and login return, maker self-approval 403, insufficient MCP, duplicate idempotent recharge replay, and idempotency payload mismatch 409.

Final Playwright result: **4/4 passed**.

## 7. Tests and verification

| Gate                 | Result | Evidence                                                             |
| -------------------- | ------ | -------------------------------------------------------------------- |
| `pnpm format:check`  | PASS   | All matched files use Prettier style                                 |
| `pnpm lint`          | PASS   | Repository ESLint                                                    |
| `pnpm typecheck`     | PASS   | 13 of 14 workspace projects in scope                                 |
| `pnpm build`         | PASS   | API, shared packages, and all three web applications                 |
| `pnpm test`          | PASS   | 91 passed; 40 integration tests intentionally skipped without DB env |
| `pnpm test:api`      | PASS   | 92/92 with isolated PostgreSQL                                       |
| `pnpm test:database` | PASS   | 22/22, including isolated upgrade from migration `0001`              |
| `pnpm test:e2e`      | PASS   | 4/4 real browser scenarios                                           |
| `pnpm db:checksum`   | PASS   | 7 immutable migration checksums                                      |
| `pnpm db:migrate`    | PASS   | Database current                                                     |
| `pnpm db:seed` twice | PASS   | Foundation seed current on both runs                                 |
| `pnpm db:drift`      | PASS   | No database schema drift                                             |

Fresh migration and upgrade migration are both covered by the database integration suite. The upgrade scenario explicitly applies Phase 1 migrations to an isolated database starting from `0001`.

## 8. Results and repository hygiene

- P1-S9 live integration: **Verified**.
- Prohibited implementation/files introduced: **0**.
- Scope leakage into Receipt, QR, Transaction, Reward, Commission, Advertising, payment-provider integration, or Phase 2: **NONE**.
- Main merge: **NOT PERFORMED**.
- Existing local `memory/2026-07-16.md` and untracked `media/` artifacts were preserved and excluded from repair commits.
- No secrets, credentials, private keys, generated logs, real sends, real payments, or deployment changes were committed.

## 9. Known issues, limitations, and deferred items

- OTP delivery remains intentionally `NOT_SENT`; production delivery requires separately authorized provider work.
- Refund remains the authorized non-cash obligation/ledger workflow; provider payout is deferred.
- Receipt, QR, Transaction, Reward, Commission, Advertising, and all Phase 2 work remain deferred/not authorized.
- The workspace still contains pre-existing user-owned `memory/` and `media/` changes. They are outside repair scope and were intentionally not deleted, stashed, or committed.

## 10. Next recommended step

Push the repair commits to `origin/phase/1-merchant-onboarding-mcp`, verify the remote head, then stop for ChatGPT Command Center final Phase 1 acceptance. Do not merge `main` and do not begin Phase 2.
