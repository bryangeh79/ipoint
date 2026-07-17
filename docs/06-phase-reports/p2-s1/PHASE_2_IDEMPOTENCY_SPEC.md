---
title: Phase 2 Idempotency Spec
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 Idempotency Spec

## 1. Scope

Idempotency is required for every write route that can be retried safely or that changes state.

## 2. Core rules

- The idempotency key scope must include actor, operation, and resource context.
- The payload fingerprint must be computed from a normalized request body.
- Reuse of the same key with a different payload must be rejected.
- Reuse of the same key with the same payload must return the same logical result.
- Idempotency records must be retained long enough to cover client retry windows and audit needs.

## 3. Recommended key shape

```text
<actor_type>:<actor_id>:<operation>:<resource_id or none>:<market_id or none>
```

The stored request hash must be a stable hash of the normalized request payload and relevant headers.

## 4. Route coverage

| Operation | Key scope | Payload fingerprint notes | Replay behavior | Mismatch behavior |
|---|---|---|---|---|
| Registration submit | Public actor + email + market | Include email, account country, market, referral input, terms version | Return the created account/member outcome | Reject with idempotency conflict |
| OTP verification handoff | Public actor + otp_id | Include otp_id and code only | Return verified outcome or the same login handoff | Reject if payload differs |
| KYC submit/resubmit | Member + member_id + case_id + market | Include case version, document references, form data | Return the same submission version | Reject if payload differs |
| Account-country change request | Member + member_id | Include current and requested country and reason | Return the same pending request | Reject if payload differs |
| Current market switch | Member + member_id + market | Include current and requested market plus reason | Return the same persisted current market | Reject if payload differs |
| Admin KYC decision | Admin + case_id + market | Include decision, reason, evidence digest | Return the same decision result | Reject if payload differs |
| Suspend | Admin + member_id + market | Include reason and status target | Return same status result | Reject if payload differs |
| Reactivate | Admin + member_id + market | Include reason and status target | Return same status result | Reject if payload differs |
| Referral correction | Admin + member_id + market | Include old and new referrer, correction reason, authorized actor, request ID, and occurred-at timestamp | Return same corrected relationship and history event | Reject if payload differs |
| QR rotation | Member + member_id | Include rotation reason and previous QR state | Return same active QR replacement | Reject if payload differs |

## 5. Concurrency rules

- Use a unique index or equivalent lock per idempotency scope.
- Ensure only one logical result can be created for the same scope and payload.
- If a request is in flight, concurrent retries should wait on the same outcome or return a conflict if the implementation cannot safely reuse it.
- Terminal decisions should remain reusable after completion.

## 6. Retention

- Keep registration and country-change idempotency keys long enough to cover the full retry horizon.
- Keep current-market switch idempotency keys long enough to prevent duplicate current-market history rows.
- Keep admin decision idempotency keys at least as long as the audit retention period for the reviewed action.
- Keep QR rotation idempotency keys long enough to prevent accidental duplicate rotations.

## 7. Response reuse rules

- The stored response should be the authoritative logical result.
- Replays must not create duplicate history rows, duplicate QR identities, duplicate KYC submissions, or duplicate current-market rows.
- The response body may be reserialized, but the logical outcome must be unchanged.
