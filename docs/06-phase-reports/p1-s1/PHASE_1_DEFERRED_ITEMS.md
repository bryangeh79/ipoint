---
title: Phase 1 Deferred Items
phase: P1-S1
status: planning-only
implementation_authorized: false
date: 2026-07-16
---

# Phase 1 Deferred Items

| Deferred item                  | Phase 1 permitted boundary               | Explicitly prohibited now                                    | Revisit gate                                             |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Member purchase transaction    | Domain interface/reference IDs only      | Sale creation/confirmation                                   | Authorized Transaction Engine phase                      |
| QR scan transaction            | No implementation                        | QR token validation/binding                                  | Member QR + Transaction phase                            |
| Receipt engine                 | State/contract planning only             | Receipt generation, binding, expiry job                      | Transaction Engine                                       |
| MCP sale deduction             | Reserve enum/type and future port only   | Any live transaction debit                                   | Transaction Engine                                       |
| iPoint reward                  | No coupling from MCP                     | Entitlement, wallet credit, 00:00 job                        | iPoint Reward phase                                      |
| Wallet engine                  | MCP account only; no member wallet       | iPoint wallet/balance/ledger                                 | iPoint Wallet phase                                      |
| Commission                     | Reference boundary only                  | Calculation, entitlement, posting                            | Agent & Commission phase                                 |
| Redemption                     | None                                     | Catalog/order/wallet debit                                   | Redemption phase                                         |
| Advertising center             | Reserve ledger type only                 | Ad UI, pricing, review, debit                                | Advertising phase; O-03 resolved as needed               |
| Production payment integration | Adapter/callback contract only           | Provider SDK, live webhook, charge                           | Separate approved integration gate                       |
| Production payout/refund       | Review/request foundation only           | Bank/gateway refund or payout                                | Finance/legal/integration approval                       |
| Merchant Group UI              | Nullable `group_id` only                 | Group entity behavior, reporting UI, permissions, shared MCP | O-01 decision                                            |
| Merchant staff/sub-accounts    | No implementation                        | Staff identities, roles, delegation                          | O-04 decision                                            |
| Production object storage      | Private adapter contract + metadata only | Bucket/provider/key/signed URL implementation                | Phase 1 implementation authorization + provider decision |
| Real notifications             | Notification intent/port only            | Email/push/SMS send                                          | Provider/side-effect approval                            |

## Guardrails

- Deferred types must not acquire controllers, jobs, provider adapters or production seeds.
- Foreign IDs for future domains are optional source references, not dependencies on nonexistent tables.
- No placeholder may simulate successful payment, payout, KYC provider or notification delivery.
- Promotion requires a new explicit Command Center decision, updated scope/phase registry, tests and migration ownership.
