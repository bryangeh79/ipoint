# Phase 1 Final Acceptance Report

> - Phase: Phase 1 — Merchant Onboarding + MCP Ledger
> - Authorization: ChatGPT Command Center Order, 2026-07-17 13:12 +08:00
> - Approved baseline: `ff0b49aa76d25e465970eed1292077732194066a`
> - Phase branch: `phase/1-merchant-onboarding-mcp`
> - Main merge: **NOT PERFORMED**
> - Status: **IMPLEMENTATION COMPLETE — COMMAND CENTER ACCEPTANCE REQUIRED**

## 1. Authorization and final-batch scope

D-012 approved Batch B and authorized sequential execution of P1-S8 followed by P1-S9. This report records implementation and verification evidence only. It does not approve Phase 1, merge `main`, or authorize Phase 2.

The final batch remained limited to Merchant/Admin UI, authentication exposure, integration, E2E, and acceptance evidence. Receipt, QR, Transaction, Reward, Commission, Advertising, and payment-provider integrations were not implemented.

## 2. Phase status

| Sub-phase | Scope                            | Delivery status  | Governance status / evidence                                                                    |
| --------- | -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| P1-S1     | Planning and architecture        | Complete         | Approved under D-010; commits `2bbf7d02`, `89e71fe1`, `8e484715`                                |
| P1-S2     | Merchant schema and migrations   | Complete         | Commit `e8870a92`                                                                               |
| P1-S3     | Merchant onboarding domain/API   | Complete         | Commits `d40c4250`, `a5cc85f9`                                                                  |
| P1-S4     | Merchant KYC and review          | Complete         | Integration `2ff37a6f`; Batch A approved under D-011                                            |
| P1-S5     | Service fee packages             | Complete         | Integration `148a8fde`; Batch B approved under D-012                                            |
| P1-S6     | MCP ledger and recharge          | Complete         | Integration `6946ee1e`; Batch B approved under D-012                                            |
| P1-S7     | Adjustment, refund, activation   | Complete         | Integration `23bf2e4c`; Batch B approved under D-012                                            |
| P1-S8     | Merchant/Admin UI                | Complete         | Task `2ebd819b`; integration `d32483a4`                                                         |
| P1-S9     | Integration, E2E, final evidence | Acceptance ready | Auth `f84701ab`; test isolation `fb8299aa`; UI/E2E `daac5731`; report commit contains this file |

Phase 1 remains `IN_PROGRESS` until the ChatGPT Command Center issues final acceptance. Phase 2 remains `NOT_AUTHORIZED`.

## 3. Final-batch commit and execution evidence

| Item                            | Branch                              | Commit                                     | Remote status           |
| ------------------------------- | ----------------------------------- | ------------------------------------------ | ----------------------- |
| Governance D-012                | `phase/1-merchant-onboarding-mcp`   | `d4431342d6256e38c1d631e7e87f6e5daf732c98` | Verified                |
| P1-S8 task                      | `task/p1-s8-merchant-admin-ui`      | `2ebd819bfc24e513dccbc2cfc0535a7af21c987a` | Verified                |
| P1-S8 integration               | `phase/1-merchant-onboarding-mcp`   | `d32483a4c4c21737a395472f82a25ae663218d9b` | Verified                |
| P1-S9 auth HTTP surface         | `task/p1-s9-integration-acceptance` | `f84701abd338206232738de19e5c61962a786538` | Pending final task push |
| P1-S9 auth acceptance isolation | `task/p1-s9-integration-acceptance` | `fb8299aa`                                 | Pending final task push |
| P1-S9 UI/PWA/E2E                | `task/p1-s9-integration-acceptance` | `daac5731`                                 | Pending final task push |

Local Codex execution records are stored under `.codex-execution-logs/` and remain gitignored. The execution identity is `originator=codex_exec`, `auth=ChatGPT`, `provider=openai`, and model `GPT-5 Codex`.

## 4. Final entity, API, and UI inventory

### Entity inventory

- Access and audit: accounts, credentials, sessions, OTPs, security events, markets, admin users, roles, permissions, role assignments, market access, audit logs, and entity timelines.
- Merchant onboarding: merchant groups, account access, branches, profiles, gallery entries, applications, submissions, reviews, KYC submissions/reviews, documents, referrals, terms acceptances, status history, Merchant ID counters, and API idempotency keys.
- Packages: service fee profiles/versions, special percentages, assignments, and change requests.
- MCP: accounts, append-only ledger entries, recharge requests, refund requests, adjustment requests, and adjustment decisions.

### API inventory

- Auth: login, refresh, logout, OTP issue/verify, and password reset.
- Merchant: register, profile read/update, gallery, application submit/read, KYC submit/read, document upload/read metadata, package read/pause/resume/change, MCP account/ledger, and refund request.
- Admin: application/KYC queues and review, suspend/reactivate/close, package/version/special-percentage/assignment operations, MCP account/ledger/reconciliation, recharge review, refund review, and Maker/Checker adjustment workflow.
- Access boundaries: merchant branch ownership, RBAC, MarketAccess, idempotency, immutable ledger constraints, audit log, and entity timeline.

OTP issuance explicitly returns `delivery_status=NOT_SENT`; no email provider or fake production send was added. Development codes are limited to development/test environments.

### UI inventory

- Merchant responsive/PWA workspace: Access, Overview, Profile, Verification, Packages, and MCP.
- Merchant states: login/register/reset, terms version and referrer, onboarding progress, profile/media/about/business hours, application/KYC resubmission, package default/pause/resume/change, MCP balance/ledger/recharge/refund, activation hints, and suspended read-only notice.
- Admin desktop workspace: Overview, Merchants, Reviews, Packages, MCP, and Audit.
- Admin states: merchant search/filter/detail, Application and side-by-side KYC review, package versions/special percentages/assignment, recharge/refund decisions, Maker/Checker, suspend/reactivate, audit log, and entity timeline.
- Shared acceptance states: loading, error, empty, offline, forbidden, expired session, keyboard skip link, responsive navigation, and no horizontal page overflow.

## 5. End-to-end business evidence

- Registration creates the default group and branch, assigns a market-scoped Merchant ID, records the current Terms/Disclaimer version, and preserves the referrer relationship.
- OTP issuance/verification, login, refresh rotation, logout revocation, password reset, and session revocation are exercised over HTTP.
- Profile updates and gallery additions enforce ownership and immutable account email rules.
- Application and KYC independently support approved, rejected, and resubmission-required paths; KYC resubmission preserves history and supports side-by-side review evidence.
- Admin package assignment is visible to merchants; exactly one active default and last-active protections are enforced.
- Recharge completes exactly once. Concurrent/idempotent replays produce one credit and mismatched payload reuse is rejected.
- Activation requires Application approved, KYC approved, and available MCP at least 100. Suspension preserves MCP; reactivation re-evaluates current conditions.
- Manual credit/debit enforces Maker/Checker separation and exactly-once execution.
- Refund approval creates the authorized non-cash obligation/ledger foundation without invoking a provider.
- Wrong-market, unauthorized, branch ownership, and permission denial paths are covered.
- Privileged actions write and verify AuditLog and EntityTimeline evidence.

## 6. Database migrations and checksums

- Published migrations were not edited.
- Seven immutable migration checksums pass.
- Fresh and upgrade migration scenarios pass in isolated databases.
- `db:migrate` reports current; `db:seed` passes twice; `db:drift` reports no drift.
- Append-only ledger UPDATE/DELETE protection, direct balance mutation protection, numeric precision, concurrency, and idempotency checks pass.

## 7. Verification results

| Gate                      | Result                    | Evidence                                                                                                                                        |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Task-owned Prettier check | PASS                      | P1-S9 changed files formatted with Prettier                                                                                                     |
| `pnpm format:check`       | EXTERNAL WORKTREE BLOCKER | Only pre-existing untracked `docs/06-phase-reports/BATCH_B_ACCEPTANCE_EVIDENCE.md` is reported; it was preserved and excluded from task commits |
| `pnpm lint`               | PASS                      | Repository ESLint                                                                                                                               |
| `pnpm typecheck`          | PASS                      | 12 workspace projects                                                                                                                           |
| `pnpm build`              | PASS                      | API and all three web applications                                                                                                              |
| `pnpm test`               | PASS                      | 131/131 with isolated PostgreSQL                                                                                                                |
| `pnpm test:database`      | PASS                      | 22/22                                                                                                                                           |
| `pnpm test:api`           | PASS                      | 92/92 with isolated PostgreSQL                                                                                                                  |
| `pnpm test:e2e`           | PASS                      | 5/5 browser scenarios                                                                                                                           |
| `pnpm db:checksum`        | PASS                      | 7 immutable checksums                                                                                                                           |
| `pnpm db:migrate`         | PASS                      | Current                                                                                                                                         |
| `pnpm db:seed` twice      | PASS                      | Foundation seed current both runs                                                                                                               |
| `pnpm db:drift`           | PASS                      | No drift                                                                                                                                        |

The API/database suites include append-only, concurrency/idempotency, RBAC/MarketAccess, wrong-market, unauthorized, activation, recharge, Maker/Checker, refund, suspension/reactivation, audit, and timeline scenarios.

## 8. Repository hygiene and scope audit

- Task commits contain only authorized governance, auth, Merchant/Admin UI, PWA metadata, tests, and this report.
- `.codex-execution-logs/` and Playwright local artifacts are ignored.
- Existing `memory/2026-07-16.md`, untracked Batch B evidence, and `media/` were preserved and excluded.
- No secrets, private keys, tokens, provider credentials, generated logs, production sends, real payments, or deployment changes were committed.
- Prohibited implementation count: **0**.
- Scope leakage: **NONE**.
- Main merge: **NOT PERFORMED**.

## 9. Known limitations and deferred items

- The P1-S8 interface is an acceptance-ready product shell backed by deterministic view models; live UI-to-API wiring beyond the verified HTTP/API integration remains a later implementation concern.
- OTP delivery remains intentionally `NOT_SENT`; production email delivery is deferred and requires explicit provider authorization.
- Refund remains a non-cash obligation foundation; payment/payout integration is deferred.
- Receipt, QR, Transaction, Reward, Commission, Advertising, and Phase 2 product work remain deferred/not authorized.
- Repository-wide Prettier cannot be marked PASS until the owner authorizes formatting or disposition of the pre-existing untracked Batch B evidence file.

## 10. Acceptance request

The authorized P1-S8 and P1-S9 implementation is ready for phase-branch integration and ChatGPT Command Center review. After integration and remote SHA verification, stop and await the Command Center Phase 1 final acceptance decision.
