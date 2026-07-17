---
title: Phase 2 RBAC and Market Access Matrix
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 RBAC and Market Access Matrix

## 1. Access model

- Member routes use authenticated ownership, not admin RBAC.
- Admin routes require role, permission, and market-access enforcement.
- Discovery routes are member-owned and market-sensitive.
- All routes must validate the server-resolved market context.

## 2. Matrix

| Endpoint family                                | Actor         | Permission                     | Market scope                      | Access conditions                                                               | Notes                          |
| ---------------------------------------------- | ------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| `/auth/member/*`                               | Public/member | None                           | Registration market must be valid | OTP and rate-limit checks                                                       | Shared auth service contract   |
| `/members/me`                                  | Member        | Ownership                      | None                              | Authenticated member only; closed members are denied business operations        | Own aggregate only             |
| `/members/me/profile`                          | Member        | Ownership                      | None                              | Authenticated member only                                                       | Full self-profile access       |
| `/members/me/market`                           | Member        | Ownership                      | Enabled markets only              | Current market must be enabled; selection must persist on success               | Switch and read current market |
| `/members/me/qr`                               | Member        | Ownership                      | None                              | Authenticated member only                                                       | QR lifecycle controls          |
| `/members/me/referral`                         | Member        | Ownership                      | None                              | Authenticated member only; no self-modify path                                  | Read-only self referral view   |
| `/members/me/kyc`                              | Member        | Ownership                      | None                              | Authenticated member only                                                       | KYC draft and submission       |
| `/members/me/account-country-change`           | Member        | Ownership                      | None                              | Authenticated member only                                                       | Request/cancel own change      |
| `/member-merchants`                            | Member        | Ownership                      | Current market only               | Authenticated member and enabled market                                         | Read-only discovery            |
| `/member-merchants/:branchId`                  | Member        | Ownership                      | Current market only               | Branch must belong to current market                                            | Read-only detail               |
| `/admin/members`                               | Admin         | `member.view`                  | Market-filtered                   | Active market grant required for filtered view                                  | Default deny                   |
| `/admin/members/:memberId`                     | Admin         | `member.view`                  | Derived from target member        | Active grant must cover target market                                           | Detail view                    |
| `/admin/member-kyc/:caseId/review`             | Admin         | `member.kyc.review`            | Derived from case market          | Reviewer must be assigned and market-access allowed                             | Review action                  |
| `/admin/member-country-changes`                | Admin         | `member.country.change.review` | Market-filtered                   | Active grant required for filtered view                                         | Review queue                   |
| `/admin/members/:memberId/suspend`             | Admin         | `member.suspend`               | Derived from member market        | Admin, market grant, reason required                                            | Suspension only                |
| `/admin/members/:memberId/reactivate`          | Admin         | `member.suspend`               | Derived from member market        | Admin, market grant, reason required                                            | Reactivation only              |
| `/admin/members/:memberId/referral-correction` | Admin         | `member.referral.correct`      | Derived from member market        | Admin, market grant, reason required; transaction must append immutable history | Super-admin policy may apply   |
| `/admin/members/:memberId/timeline`            | Admin         | `member.timeline.view`         | Derived from member market        | Admin, market grant                                                             | Timeline read-only             |
| `/admin/members/:memberId/audit`               | Admin         | `audit.view`                   | Derived from member market        | Admin, market grant                                                             | Audit read-only                |

## 3. Permission seed proposal

| Permission code                | Purpose                        |
| ------------------------------ | ------------------------------ |
| `member.view`                  | View member list and detail    |
| `member.kyc.review`            | Review member KYC              |
| `member.country.change.review` | Review country change requests |
| `member.suspend`               | Suspend or reactivate member   |
| `member.referral.correct`      | Correct referral linkage       |
| `member.timeline.view`         | View member timelines          |
| `audit.view`                   | View audit logs                |

## 4. Market access rules

- Market access must be validated on the server, never inferred from the client.
- List endpoints require a valid market filter or an explicit all-market authorization if later approved.
- Detail endpoints must resolve target resource market and compare it against the actor's grants.
- Member self-service current market selection must only accept enabled markets.
- Discovery must filter by current market, not by account country.
- Current market persistence must be updated in the preference table, not treated as a session-only setting.
- Closed members are denied all business operations, including member self-service writes.

## 5. Denial behavior

- Missing auth returns an authentication error.
- Missing permission returns `AUTH_PERMISSION_DENIED`.
- Missing market access returns `AUTH_MARKET_ACCESS_DENIED`.
- Unauthorized ownership returns a member-ownership denial.
- Invalid current market selection returns a market validation error.
