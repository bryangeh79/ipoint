---
title: Phase 1 API and Permission Matrix
phase: P1-S1
status: planning-only
implementation_authorized: false
api_base: /api/v1
date: 2026-07-16
---

# Phase 1 API and Permission Matrix

## 1. Guard strategy

- Merchant endpoints use existing `AuthGuard` plus a future `MerchantBranchGuard` that binds the authenticated account to the route branch and verifies market/status capability.
- Admin endpoints use `AuthGuard` + existing `RbacGuard` + `RequirePermission(code, { marketScoped: true })`.
- The server resolves the target entity's `market_id`; it rejects any route/header mismatch and never trusts `X-Market-Id` alone.
- Critical writes require `Idempotency-Key`; all responses use the existing request-ID/error-envelope conventions.
- KYC/document responses expose least-privilege metadata/read grants and never raw object keys to unauthorized callers.

## 2. Merchant-facing endpoints

| Method and path                                         | Purpose                                       | Auth/permission                                  | Market/ownership scope            | Idempotency |
| ------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ | --------------------------------- | ----------- |
| `POST /merchant/registrations`                          | Create account/application/branch draft       | Public rate-limited + verified registration flow | Market code validated server-side | Required    |
| `POST /merchant/registrations/:id/terms-acceptances`    | Accept terms/disclaimer version               | Auth + application ownership                     | Application market                | Required    |
| `GET /merchant/me/application`                          | View onboarding state                         | Auth + branch ownership                          | Own branch only                   | No          |
| `POST /merchant/me/kyc/submissions`                     | Submit/resubmit KYC snapshot                  | Auth + branch ownership                          | Own branch/market                 | Required    |
| `POST /merchant/me/documents/upload-intents`            | Request private upload intent                 | Auth + branch ownership                          | Own KYC/market                    | Required    |
| `GET /merchant/me/profile`                              | View profile                                  | Auth + branch ownership                          | Own branch                        | No          |
| `PATCH /merchant/me/profile`                            | Update display profile                        | Auth + branch ownership                          | Own branch; login email excluded  | Required    |
| `GET /merchant/me/service-fee-profiles`                 | List assignments/versions                     | Auth + branch ownership                          | Own branch                        | No          |
| `POST /merchant/me/service-fee-profiles/:id/pause`      | Pause assignment                              | Auth + branch ownership                          | Own branch; last-active guard     | Required    |
| `POST /merchant/me/service-fee-profiles/:id/resume`     | Resume assignment                             | Auth + branch ownership                          | Own branch/effective version      | Required    |
| `POST /merchant/me/service-fee-profile-change-requests` | Request assignment change                     | Auth + branch ownership                          | Own branch                        | Required    |
| `GET /merchant/me/mcp`                                  | MCP position summary                          | Auth + branch ownership                          | Own branch/account                | No          |
| `GET /merchant/me/mcp/ledger`                           | Paginated ledger                              | Auth + branch ownership                          | Own MCP account                   | No          |
| `POST /merchant/me/mcp/recharge-requests`               | Submit manual/gateway-intent recharge request | Auth + branch ownership                          | Own account/market                | Required    |
| `POST /merchant/me/mcp/refund-requests`                 | Submit refund foundation request              | Auth + branch ownership                          | Own account/eligible balance      | Required    |
| `POST /merchant/me/closure-requests`                    | Request closure                               | Auth + branch ownership                          | Own branch                        | Required    |

## 3. Admin Merchant/package endpoints

| Method and path                                                                       | Permission                  | Market check                       | Notes                                              |
| ------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------- | -------------------------------------------------- |
| `GET /admin/markets/:marketId/merchants`                                              | `merchant.view`             | Active grant required              | Paginated/filterable                               |
| `GET /admin/markets/:marketId/merchants/:merchantId`                                  | `merchant.view`             | Route, entity and grant must match | Mask sensitive fields                              |
| `POST /admin/markets/:marketId/merchants/:merchantId/kyc/approve`                     | `merchant.approve`          | Required                           | Reason/audit; no maker/checker                     |
| `POST /admin/markets/:marketId/merchants/:merchantId/kyc/reject`                      | `merchant.approve`          | Required                           | Rejection reason mandatory                         |
| `POST /admin/markets/:marketId/merchants/:merchantId/activate`                        | `merchant.approve`          | Required                           | KYC + initial MCP guard                            |
| `POST /admin/markets/:marketId/merchants/:merchantId/suspend`                         | `merchant.suspend`          | Required                           | Reason mandatory; preserves MCP                    |
| `POST /admin/markets/:marketId/merchants/:merchantId/reactivate`                      | `merchant.suspend`          | Required                           | Reason/audit                                       |
| `POST /admin/markets/:marketId/merchants/:merchantId/close`                           | `merchant.close`            | Required                           | No payout side effect                              |
| `POST /admin/markets/:marketId/merchants/:merchantId/referral-corrections`            | `merchant.referral.correct` | Required                           | Super Admin role policy + reason; no maker/checker |
| `GET /admin/markets/:marketId/service-fee-profiles`                                   | `merchant.package.view`     | Required                           | Version/effective history                          |
| `POST /admin/markets/:marketId/service-fee-profiles`                                  | `merchant.package.manage`   | Required                           | Creates definition/draft only                      |
| `POST /admin/markets/:marketId/service-fee-profiles/:id/versions`                     | `merchant.package.manage`   | Required                           | Exact numeric/effective window                     |
| `POST /admin/markets/:marketId/special-percentages`                                   | `merchant.package.manage`   | Required                           | O-07 range not invented                            |
| `POST /admin/markets/:marketId/merchants/:merchantId/package-assignments`             | `merchant.package.assign`   | Required                           | Versioned assignment                               |
| `POST /admin/markets/:marketId/merchants/:merchantId/package-assignments/:id/default` | `merchant.package.assign`   | Required                           | Atomic single default                              |

## 4. Admin MCP endpoints

| Method and path                                                   | Permission                     | Market check | Workflow control                                     |
| ----------------------------------------------------------------- | ------------------------------ | ------------ | ---------------------------------------------------- |
| `GET /admin/markets/:marketId/mcp/accounts/:accountId`            | `merchant.mcp.view`            | Required     | Summary/projection only                              |
| `GET /admin/markets/:marketId/mcp/accounts/:accountId/ledger`     | `merchant.mcp.view`            | Required     | Immutable history                                    |
| `POST /admin/markets/:marketId/mcp/recharge-requests/:id/process` | `merchant.mcp.recharge.review` | Required     | General review; not maker/checker; idempotent credit |
| `POST /admin/markets/:marketId/mcp/recharge-requests/:id/fail`    | `merchant.mcp.recharge.review` | Required     | Reason mandatory                                     |
| `POST /admin/markets/:marketId/mcp/refund-requests/:id/review`    | `merchant.mcp.refund.review`   | Required     | Foundation only; no provider payout                  |
| `POST /admin/markets/:marketId/mcp/adjustments`                   | `merchant.mcp.adjust`          | Required     | Maker creates Credit/Debit request                   |
| `POST /admin/markets/:marketId/mcp/adjustments/:id/approve`       | `merchant.mcp.adjust.approve`  | Required     | Checker != maker                                     |
| `POST /admin/markets/:marketId/mcp/adjustments/:id/reject`        | `merchant.mcp.adjust.approve`  | Required     | Checker != maker; reason                             |
| `POST /admin/markets/:marketId/mcp/adjustments/:id/execute`       | `merchant.mcp.adjust.execute`  | Required     | Approved only; separation rechecked; idempotent      |
| `POST /admin/markets/:marketId/mcp/ledger/:entryId/reversals`     | `merchant.mcp.reverse`         | Required     | Compensating entry; reason/evidence                  |

## 5. Permission seed proposal

```text
merchant.view
merchant.approve
merchant.suspend
merchant.close
merchant.referral.correct
merchant.package.view
merchant.package.manage
merchant.package.assign
merchant.mcp.view
merchant.mcp.recharge.review
merchant.mcp.refund.review
merchant.mcp.adjust
merchant.mcp.adjust.approve
merchant.mcp.adjust.execute
merchant.mcp.reverse
```

Roles are assignments of permissions, not authorization shortcuts. Super Admin still passes explicit permission and market policy; maker/checker separation is a domain invariant, not only a permission.

## 6. Deferred endpoints

No purchase transaction, QR scan, receipt creation/claim, advertising, production payment webhook/refund, payout, member wallet, reward, commission or redemption endpoint is authorized in Phase 1. A future gateway callback route requires separate provider/security approval.
