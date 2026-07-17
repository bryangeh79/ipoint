---
title: Phase 2 ERD
phase: P2-S1
status: freeze
implementation_authorized: false
date: 2026-07-17
---

# Phase 2 ERD

## 1. Modeling principles

- Keep `accounts` as the authentication and account-country anchor.
- Create a dedicated `members` aggregate for member-facing identity and lifecycle.
- Do not duplicate mutable `account_country` on `members`; `accounts.account_country` is the single source of truth.
- Use UUID primary keys internally.
- Use separate public identifiers for member-facing references.
- Keep public IDs unique and never reused.
- Use exact decimal or integer representations where applicable.
- Keep history append-only.
- Keep sensitive documents outside the relational binary store.

## 1.1 Market concept separation

- **Account Country**: authoritative compliance anchor on `accounts.account_country`.
- **Current Market**: exactly one active market selection per member, persisted in `member_market_preferences` with `is_current = true`.
- **Available/Enabled Markets**: the set of member-eligible markets where `is_enabled = true` and the referenced market is ACTIVE.
- Current Market must be independent of Account Country.
- Current Market must be independent of the available/enabled list, except that the selected market must still be ACTIVE and member-accessible.
- Do not use `primary_market_id` or any similar ambiguous single-field shortcut.

## 2. Entity overview

### 2.1 `members`

Purpose: top-level member aggregate anchored to one account.

Suggested columns:

| Column                     | Type                     | Notes                                                         |
| -------------------------- | ------------------------ | ------------------------------------------------------------- |
| `id`                       | UUID PK                  | Internal key                                                  |
| `account_id`               | UUID FK -> `accounts.id` | One-to-one with account                                       |
| `public_member_id`         | text unique              | Member-facing ID                                              |
| `referral_code`            | text unique              | Unique per member                                             |
| `status`                   | enum                     | `PENDING_EMAIL_VERIFICATION`, `ACTIVE`, `SUSPENDED`, `CLOSED` |
| `kyc_level`                | enum                     | `NONE`, `LEVEL_1`, `LEVEL_2`                                  |
| `closed_at`                | timestamptz              | Terminal closure timestamp                                    |
| `created_at`, `updated_at` | timestamptz              | Audit timestamps                                              |
| `archived_at`              | timestamptz              | Only for non-history mutable rows                             |

Constraints:

- `account_id` unique
- `public_member_id` unique
- `referral_code` unique
- `status` and `kyc_level` are independent
- `members` must not contain a mutable `account_country` column

### 2.2 `member_profiles`

Purpose: mutable member profile data.

Suggested columns:

| Column                     | Type                    | Notes                           |
| -------------------------- | ----------------------- | ------------------------------- |
| `id`                       | UUID PK                 | Internal key                    |
| `member_id`                | UUID FK -> `members.id` | One-to-one                      |
| `display_name`             | text                    | Public profile name             |
| `full_name`                | text                    | KYC-linked, masked where needed |
| `phone`                    | text                    | Sensitive                       |
| `birth_date`               | date                    | Sensitive                       |
| `address`                  | jsonb                   | Sensitive                       |
| `avatar_object_key`        | text                    | Object storage reference        |
| `language`                 | text                    | Preference                      |
| `locale`                   | text                    | Preference                      |
| `marketing_opt_in`         | boolean                 | Consent flag                    |
| `created_at`, `updated_at` | timestamptz             | Audit timestamps                |
| `archived_at`              | timestamptz             | Soft-delete for profile only    |

Constraints:

- one profile per member
- sensitive fields masked in admin list views unless required

### 2.3 `member_market_preferences`

Purpose: member market access, enabled-market tracking, and current market persistence.

Suggested columns:

| Column                     | Type                    | Notes                                 |
| -------------------------- | ----------------------- | ------------------------------------- |
| `id`                       | UUID PK                 | Internal key                          |
| `member_id`                | UUID FK -> `members.id` | Member owner                          |
| `market_id`                | UUID FK -> `markets.id` | Enabled market                        |
| `is_enabled`               | boolean                 | Whether member can use the market     |
| `is_current`               | boolean                 | Exactly one current market per member |
| `sort_order`               | integer                 | UI ordering                           |
| `last_selected_at`         | timestamptz             | Last current-market selection         |
| `created_at`, `updated_at` | timestamptz             | Audit timestamps                      |

Constraints:

- unique(`member_id`, `market_id`)
- exactly one current market per member
- current market must reference an ACTIVE market
- current market selection is persisted, not derived from session state alone

### 2.4 `member_referrals`

Purpose: current direct referrer state for each member.

Suggested columns:

| Column                     | Type                    | Notes                            |
| -------------------------- | ----------------------- | -------------------------------- |
| `id`                       | UUID PK                 | Internal key                     |
| `member_id`                | UUID FK -> `members.id` | Referred member                  |
| `referrer_member_id`       | UUID FK -> `members.id` | Direct referrer only             |
| `referral_code_snapshot`   | text                    | Immutable snapshot of code used  |
| `source`                   | text                    | Registration or admin correction |
| `status`                   | enum                    | `ACTIVE`, `VOIDED`               |
| `created_at`, `updated_at` | timestamptz             | Audit timestamps                 |

Constraints:

- one current direct referrer per member
- `member_id != referrer_member_id`
- no referral cycles

### 2.5 `member_referral_history`

Purpose: immutable referral correction and assignment history.

Suggested columns:

| Column                   | Type                    | Notes                             |
| ------------------------ | ----------------------- | --------------------------------- |
| `id`                     | UUID PK                 | Internal key                      |
| `member_id`              | UUID FK -> `members.id` | Referred member                   |
| `old_referrer_member_id` | UUID FK -> `members.id` | Previous referrer, if any         |
| `new_referrer_member_id` | UUID FK -> `members.id` | New referrer                      |
| `correction_reason`      | text                    | Required for admin correction     |
| `authorized_actor_type`  | text                    | Admin or system actor type        |
| `authorized_actor_id`    | UUID                    | Authorized actor identity         |
| `request_id`             | text                    | Idempotency or request reference  |
| `occurred_at`            | timestamptz             | Event time                        |
| `event_type`             | text                    | `ASSIGNED`, `CORRECTED`, `VOIDED` |

Constraints:

- append-only
- no physical delete
- every correction row must preserve the prior state in history

### 2.6 `member_terms_acceptances`

Purpose: immutable consent evidence.

Suggested columns:

| Column               | Type                    | Notes                             |
| -------------------- | ----------------------- | --------------------------------- |
| `id`                 | UUID PK                 | Internal key                      |
| `member_id`          | UUID FK -> `members.id` | Owner                             |
| `document_type`      | text                    | Terms, disclaimer, privacy policy |
| `document_version`   | text                    | Version snapshot                  |
| `locale`             | text                    | Content locale                    |
| `accepted_at`        | timestamptz             | Event time                        |
| `ip_address`         | text                    | Evidence                          |
| `user_agent`         | text                    | Evidence                          |
| `device_fingerprint` | text                    | Optional if approved              |

Constraints:

- unique(`member_id`, `document_type`, `document_version`)
- append-only

### 2.7 `member_qr_identities`

Purpose: active and historical QR identity lifecycle.

Suggested columns:

| Column            | Type                                 | Notes                                                   |
| ----------------- | ------------------------------------ | ------------------------------------------------------- |
| `id`              | UUID PK                              | Internal key                                            |
| `member_id`       | UUID FK -> `members.id`              | Owner                                                   |
| `public_qr_id`    | text unique                          | Public QR reference                                     |
| `token_hash`      | text                                 | Hash of unpredictable token; no plaintext token storage |
| `status`          | enum                                 | `ACTIVE`, `ROTATED`, `REVOKED`                          |
| `rotated_from_id` | UUID FK -> `member_qr_identities.id` | Chain reference                                         |
| `rotated_to_id`   | UUID FK -> `member_qr_identities.id` | Chain reference                                         |
| `issued_at`       | timestamptz                          | Event time                                              |
| `expires_at`      | timestamptz                          | Short-lived if token is rotating                        |
| `revoked_at`      | timestamptz                          | Revocation time                                         |
| `reason`          | text                                 | Rotation/revocation reason                              |

Constraints:

- one active QR identity per member
- no sensitive fields in token payload
- token material is not stored in plain text
- manual rotation and revocation only in Phase 2

### 2.8 `member_kyc_cases`

Purpose: KYC workflow head for each member.

Suggested columns:

| Column                       | Type                        | Notes                            |
| ---------------------------- | --------------------------- | -------------------------------- |
| `id`                         | UUID PK                     | Internal key                     |
| `member_id`                  | UUID FK -> `members.id`     | One open case per member         |
| `market_id`                  | UUID FK -> `markets.id`     | Case market context if required  |
| `status`                     | enum                        | See state machine                |
| `version`                    | integer                     | Increment on resubmission/review |
| `level_requested`            | enum                        | `LEVEL_1`, `LEVEL_2`             |
| `submitted_at`               | timestamptz                 | Current submission time          |
| `reviewed_at`                | timestamptz                 | Review time                      |
| `reviewed_by_admin_user_id`  | UUID FK -> `admin_users.id` | Reviewer                         |
| `decision_reason`            | text                        | Required on review               |
| `reverification_required_at` | timestamptz                 | If later re-review is needed     |

Constraints:

- one current KYC case per member
- KYC status is independent from member status

### 2.9 `member_kyc_documents`

Purpose: document metadata only, not binary storage.

Suggested columns:

| Column               | Type                             | Notes                               |
| -------------------- | -------------------------------- | ----------------------------------- |
| `id`                 | UUID PK                          | Internal key                        |
| `member_kyc_case_id` | UUID FK -> `member_kyc_cases.id` | Case owner                          |
| `member_id`          | UUID FK -> `members.id`          | Convenience FK                      |
| `market_id`          | UUID FK -> `markets.id`          | Scope                               |
| `document_type`      | text                             | Identity, address, selfie, etc.     |
| `object_key`         | text unique                      | Private object storage key          |
| `original_filename`  | text                             | Sensitive metadata                  |
| `content_type`       | text                             | MIME type                           |
| `byte_size`          | numeric                          | Exact size                          |
| `sha256`             | text                             | Integrity hash                      |
| `scan_status`        | text                             | Pending, clean, blocked             |
| `classification`     | text                             | Private KYC                         |
| `created_at`         | timestamptz                      | Event time                          |
| `archived_at`        | timestamptz                      | Only if superseded by a new version |

Constraints:

- append-only metadata with no direct binary payload
- file access is signed URL only

### 2.10 `member_account_country_change_requests`

Purpose: controlled review for account-country changes.

Suggested columns:

| Column                      | Type                        | Notes                                          |
| --------------------------- | --------------------------- | ---------------------------------------------- |
| `id`                        | UUID PK                     | Internal key                                   |
| `member_id`                 | UUID FK -> `members.id`     | Request owner                                  |
| `account_id`                | UUID FK -> `accounts.id`    | Authoritative account                          |
| `current_country`           | text                        | Snapshot                                       |
| `requested_country`         | text                        | Requested value                                |
| `status`                    | enum                        | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `reason`                    | text                        | Member reason                                  |
| `reviewed_by_admin_user_id` | UUID FK -> `admin_users.id` | Reviewer                                       |
| `review_reason`             | text                        | Required for review                            |
| `submitted_at`              | timestamptz                 | Event time                                     |
| `reviewed_at`               | timestamptz                 | Event time                                     |
| `created_at`, `updated_at`  | timestamptz                 | Audit timestamps                               |

Constraints:

- one open request per member
- pending request blocks duplicates until rejected, approved, or cancelled
- approved requests update `accounts.account_country`
- request history is append-only

## 3. History and timeline

### 3.1 `member_status_history`

Append-only history for member status transitions.

Fields:

- `id`
- `member_id`
- `from_status`
- `to_status`
- `actor_type`
- `actor_id`
- `reason`
- `occurred_at`

### 3.2 `member_kyc_history`

Append-only record of KYC case submissions and review outcomes.

Fields:

- `id`
- `member_kyc_case_id`
- `event_type`
- `actor_type`
- `actor_id`
- `summary`
- `metadata`
- `occurred_at`

### 3.3 `entity_timelines` and `audit_logs`

Existing global tables remain the authoritative cross-cutting history layer.

Phase 2 should use them for:

- account-country review
- referral correction
- QR rotation and revocation
- KYC review
- member suspension and reactivation

## 4. Relationship summary

```text
accounts 1--1 members
members 1--1 member_profiles
members 1--* member_market_preferences
members 1--1 member_referrals (current)
members 1--* member_referral_history
members 1--* member_terms_acceptances
members 1--* member_qr_identities
members 1--1 member_kyc_cases
member_kyc_cases 1--* member_kyc_documents
members 1--* member_account_country_change_requests
members 1--* member_status_history
members 1--* member_kyc_history
```

## 5. Relationship to existing auth models

- `accounts` remains the auth identity and password/session anchor.
- `credentials` stores password hashes.
- `sessions` stores access/refresh session families.
- `otps` stores email OTPs for verification and password reset.
- `accounts.status` may remain the auth gating field, but member lifecycle must be represented independently in `members.status`.
- `accounts.account_country` remains the authoritative country value.
- `member_market_preferences` stores the authoritative current market row and enabled market rows.
- `member_referrals` stores the current direct referrer state.
- `member_referral_history` stores the immutable referral audit trail.

## 6. Soft delete and close strategy

- Append-only tables: no physical delete, no update of historical rows.
- Mutable profile or preference tables may use `archived_at` only if needed.
- Closed members keep their public IDs, referral history, KYC history, QR history, and country-change history, but they cannot resume business operation automatically.
- QR rotation and referral correction must append new rows or status transitions rather than overwrite history.

## 7. Sensitive fields

Sensitive fields include:

- email
- phone
- address
- KYC document metadata
- QR token material
- reviewer notes
- country-change notes

These fields require masking, redaction, and audit visibility controls.
