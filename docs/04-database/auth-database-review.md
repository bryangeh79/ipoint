# Auth Database Review

> **Review Date:** 2026-07-18
> **Reviewer:** Codex CLI #5 (Database Review)
> **Schema Version:** Post-migration 0008 (Phase 2 Member Registration Auth)
> **Branch:** task/p2-s4e-database-review

---

## Executive Summary

The auth database schema is well-structured with strong constraints, appropriate indexing, and careful append-only protections. **No missing indexes were found that would cause full table scans for current query patterns.** However, several observations and recommendations are documented below.

### Overall Assessment: ✅ HEALTHY

| Area                   | Status             | Notes                                                                 |
| ---------------------- | ------------------ | --------------------------------------------------------------------- |
| Constraints            | ✅ Strong          | CHECK constraints, unique constraints, FK strategies well-defined     |
| Indexing               | ✅ Adequate        | All current query patterns are covered                                |
| Append-Only Protection | ✅ Good            | Both trigger-based and function-based approaches used                 |
| Transaction Scoping    | ✅ Good            | Manual connection-level transactions for multi-statement ops          |
| Cascade Strategy       | ⚠️ Mostly RESTRICT | Intentionally conservative; safe defaults                             |
| Data Retention         | ⚠️ Partial         | OTPs have expiry fields but no cleanup job; sessions have `expiresAt` |
| Multi-Market Readiness | ⚠️ Needs Review    | Email uniqueness is global, not per-market                            |
| Migration Audit        | ✅ Clean           | 9 migrations, all checksums verified                                  |

---

## 1. Table-by-Table Review

### 1.1 `accounts`

| Property               | Value                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID, default `gen_random_uuid()`)                                                                  |
| **Unique Constraints** | `accounts_public_id_unique` on `public_id`; `accounts_email_unique` on `email`                            |
| **Indexes**            | `accounts_status_idx` on `status`                                                                         |
| **CHECK Constraints**  | `accounts_email_normalized_check` (email = lower(email)); `accounts_country_code_check` (char_length = 2) |
| **Append-Only**        | No — update allowed, but email is immutable via trigger                                                   |

**Observations:**

- `email` is globally unique — will require changes for multi-market support (see §8)
- `public_id` is globally unique — this is the external-facing identifier
- The `accounts_status_idx` index supports queries filtering by status (e.g., `findPasswordIdentity` which joins accounts + credentials and filters by email, and also the `assertActive` check)
- No index exists on `email` alone since the unique constraint already provides one
- Email immutability is enforced by `reject_account_email_update()` trigger (migration 0002)

### 1.2 `credentials`

| Property               | Value                                                     |
| ---------------------- | --------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                               |
| **Unique Constraints** | `credentials_account_type_unique` on `(account_id, type)` |
| **Foreign Keys**       | `account_id` → `accounts(id)` ON DELETE RESTRICT          |
| **Indexes**            | None beyond PK and unique constraint                      |
| **CHECK Constraints**  | `credentials_hash_only_check` (secretHash >= 32 chars)    |

**Observations:**

- The unique constraint on `(account_id, type)` ensures at most one credential of each type per account
- `ON DELETE RESTRICT` prevents deleting an account while credentials exist
- No additional indexes needed — queries always filter by `account_id` (via join) or `(account_id, type)` (upsert)
- The `resetPasswordWithOtp` query does an upsert with `ON CONFLICT (account_id, type)`, which hits the unique constraint

### 1.3 `sessions`

| Property               | Value                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                                                                                    |
| **Unique Constraints** | `sessions_access_token_hash_unique`; `sessions_refresh_token_hash_unique`                                      |
| **Foreign Keys**       | `account_id` → `accounts(id)` ON DELETE RESTRICT; `replaced_by_session_id` → `sessions(id)` ON DELETE RESTRICT |
| **Indexes**            | `sessions_account_active_idx` on `(account_id, expires_at)`                                                    |
| **CHECK Constraints**  | Token hash length checks; expiry checks; access_expiry checks                                                  |

**Observations:**

- The unique constraint on `access_token_hash` supports `findAccessSession` (lookup by access token hash)
- The unique constraint on `refresh_token_hash` supports `rotateSession` (lookup by refresh token hash)
- The `sessions_account_active_idx` composite index on `(account_id, expires_at)` supports queries like:
  - Removing all sessions for an account during password reset: `WHERE account_id = $1` (uses first column)
  - Finding active sessions: `WHERE account_id = $1 AND expires_at > now()` (uses both columns)
- The self-referencing FK `replaced_by_session_id → sessions(id)` supports rotation chain tracking
- Migration 0001 added `access_expires_at` column with appropriate check constraint

### 1.4 `otps`

| Property              | Value                                                      |
| --------------------- | ---------------------------------------------------------- |
| **Primary Key**       | `id` (UUID)                                                |
| **Foreign Keys**      | `account_id` → `accounts(id)` ON DELETE RESTRICT           |
| **Indexes**           | `otps_destination_purpose_idx` on `(destination, purpose)` |
| **CHECK Constraints** | Code hash length; attempts range; expiry check             |

**Observations:**

- The composite index on `(destination, purpose)` supports finding OTPs by destination and purpose (used for rate limiting)
- The PK on `id` supports `findOtp(id)` and `consumeOtp(id)` queries
- The `incrementOtpAttempts` and `markOtpVerified` queries use raw SQL with `WHERE id = $1`, hitting PK
- **No index on `(expires_at)`** — cleanup queries for expired OTPs would be a full scan. If an expiry cleanup job is added later, this will need an index

### 1.5 `memberEmailOtps`

| Property               | Value                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                                                                                                                               |
| **Foreign Keys**       | `member_id` → `members(id)` ON DELETE RESTRICT; `account_id` → `accounts(id)` ON DELETE RESTRICT; `referrer_member_id` → `members(id)` ON DELETE RESTRICT |
| **Unique Constraints** | `member_email_otps_active_unique` — partial unique index on `(email, purpose)` WHERE `used_at IS NULL`                                                    |
| **Indexes**            | `member_email_otps_account_idx` on `account_id`; `member_email_otps_member_idx` on `member_id`                                                            |
| **CHECK Constraints**  | Email normalization; attempts; max_attempts; version; code hash; expiry; resend timing; registration payload validation                                   |

**Observations:**

- The partial unique index `member_email_otps_active_unique` ensures at most one un-used OTP per (email, purpose) — this is a correctness constraint for registration flow
- The `account_id` and `member_id` indexes support lookups after registration when linking entities
- **No index on `(member_id, purpose, used_at)`** — if queries check for existing verified OTPs by member_id, this may scan
- Registration payload check is comprehensive and enforces correct null/not-null based on purpose

### 1.6 `authIdempotencyKeys`

| Property               | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                                   |
| **Unique Constraints** | `auth_idempotency_scope_key_unique` on `(scope, key)`         |
| **CHECK Constraints**  | Request hash length; response hash length; result consistency |
| **Indexes**            | None beyond PK and unique constraint                          |

**Observations:**

- Added in migration 0008
- Unique constraint on `(scope, key)` supports idempotency key lookup
- **No TTL-based expiry index** — `expires_at` has no index; expiry cleanup would scan

### 1.7 `members`

| Property               | Value                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                                                                                                                          |
| **Unique Constraints** | `members_account_unique` on `account_id`; `members_public_member_id_unique` on `public_member_id`; `members_referral_code_unique` on `referral_code` |
| **Foreign Keys**       | `account_id` → `accounts(id)` ON DELETE RESTRICT                                                                                                     |
| **Indexes**            | `members_status_idx` on `status`                                                                                                                     |
| **CHECK Constraints**  | `members_closed_at_check` — closed_at null check based on status                                                                                     |

**Observations:**

- `public_member_id` is globally unique (multi-market OK)
- `referral_code` is globally unique (multi-market OK)
- `account_id` has a unique constraint, so 1:1 with accounts
- The `members_status_idx` supports filtering by status
- **No index on `(public_member_id)`** — but unique constraint already provides one

### 1.8 `memberProfiles`

| Property               | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                                       |
| **Unique Constraints** | `member_profiles_member_unique` on `member_id` (1:1 with members) |
| **Foreign Keys**       | `member_id` → `members(id)` ON DELETE RESTRICT                    |
| **Indexes**            | None beyond PK and unique constraint                              |

**Observations:**

- 1:1 relationship with members via unique constraint

### 1.9 `memberReferrals`

| Property               | Value                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                                                                             |
| **Unique Constraints** | `member_referrals_active_unique` — partial unique index on `(member_id)` WHERE `status = 'ACTIVE'`      |
| **Foreign Keys**       | `member_id` → `members(id)` ON DELETE RESTRICT; `referrer_member_id` → `members(id)` ON DELETE RESTRICT |
| **Indexes**            | `member_referrals_referrer_idx` on `referrer_member_id`                                                 |
| **CHECK Constraints**  | Self-reference check                                                                                    |
| **Append-Only**        | No — status can be updated to `VOIDED`                                                                  |

**Observations:**

- The partial unique index ensures at most one active referral per member
- The `referrer_member_id` index supports queries counting referrals by referrer
- **Self-reference check prevents circular referrals**

### 1.10 `memberReferralHistory`

| Property         | Value                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Primary Key**  | `id` (UUID)                                                                                                                                                              |
| **Foreign Keys** | `member_id` → `members(id)` ON DELETE RESTRICT; `old_referrer_member_id` → `members(id)` ON DELETE RESTRICT; `new_referrer_member_id` → `members(id)` ON DELETE RESTRICT |
| **Indexes**      | `member_referral_history_member_time_idx` on `(member_id, occurred_at)`                                                                                                  |
| **Append-Only**  | ✅ Yes — trigger `member_referral_history_append_only`                                                                                                                   |

**Observations:**

- Append-only trigger prevents UPDATE or DELETE
- Composite index on `(member_id, occurred_at)` supports timeline queries

### 1.11 `memberStatusHistory`

| Property         | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| **Primary Key**  | `id` (UUID)                                                           |
| **Foreign Keys** | `member_id` → `members(id)` ON DELETE RESTRICT                        |
| **Indexes**      | `member_status_history_member_time_idx` on `(member_id, occurred_at)` |
| **Append-Only**  | ✅ Yes — trigger `member_status_history_append_only`                  |

### 1.12 `memberTermsAcceptances`

| Property               | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **Primary Key**        | `id` (UUID)                                                                        |
| **Unique Constraints** | `member_terms_acceptance_unique` on `(member_id, document_type, document_version)` |
| **Foreign Keys**       | `member_id` → `members(id)` ON DELETE RESTRICT                                     |
| **Indexes**            | None beyond PK and unique constraint                                               |
| **Append-Only**        | ✅ Yes — trigger `member_terms_acceptances_append_only`                            |

### 1.13 `entityTimelines`

| Property         | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| **Primary Key**  | `id` (UUID)                                                                   |
| **Foreign Keys** | `market_id` → `markets(id)` ON DELETE RESTRICT                                |
| **Indexes**      | `entity_timelines_entity_time_idx` on `(entity_type, entity_id, occurred_at)` |
| **Append-Only**  | ✅ Yes — trigger `entity_timelines_append_only`                               |

**Observations:**

- Generic timeline table for any entity type
- Composite index supports efficient lookups by entity type + ID ordered by time
- **Consider adding `entity_timelines_event_type_idx` on `(entity_type, event_type)` if event-type filtering queries become common**

### 1.14 `auditLogs`

| Property         | Value                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary Key**  | `id` (UUID)                                                                                                                                                                                               |
| **Foreign Keys** | `market_id` → `markets(id)` ON DELETE RESTRICT                                                                                                                                                            |
| **Indexes**      | `audit_logs_actor_time_idx` on `(actor_type, actor_id, occurred_at)`; `audit_logs_entity_time_idx` on `(entity_type, entity_id, occurred_at)`; `audit_logs_market_time_idx` on `(market_id, occurred_at)` |
| **Append-Only**  | ✅ Yes — trigger `audit_logs_append_only`                                                                                                                                                                 |

**Observations:**

- Comprehensive indexing covers the three main query patterns: by actor, by entity, and by market
- Well-designed for audit trail queries

---

## 2. Query-Index Mapping

Below is the mapping of every query from `postgres-auth.store.ts` to the index it uses.

| Query Method                        | SQL/ORM Pattern                                                                                           | Index Used                                                                          | Scan Type                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| `findPasswordIdentity`              | `SELECT ... FROM accounts INNER JOIN credentials WHERE accounts.email = $1`                               | `accounts_email_unique` (unique index on email) + `credentials_account_type_unique` | Index Scan (PK lookup for credentials) |
| `setPasswordCredential`             | `INSERT INTO credentials ... ON CONFLICT (account_id, type)`                                              | `credentials_account_type_unique`                                                   | Unique index for conflict detection    |
| `createSession`                     | `INSERT INTO sessions ... RETURNING id`                                                                   | PK insert                                                                           | PK insertion                           |
| `findAccessSession`                 | `SELECT ... FROM sessions INNER JOIN accounts LEFT JOIN adminUsers WHERE sessions.access_token_hash = $1` | `sessions_access_token_hash_unique`                                                 | Unique index scan                      |
| `rotateSession` (read)              | `SELECT ... FROM sessions JOIN accounts WHERE sessions.refresh_token_hash = $1 FOR UPDATE`                | `sessions_refresh_token_hash_unique`                                                | Unique index scan                      |
| `rotateSession` (revoke reuse)      | `UPDATE sessions SET ... WHERE family_id = $1`                                                            | 🚫 **No index on `family_id`**                                                      | Full table scan                        |
| `rotateSession` (insert new)        | `INSERT INTO sessions ... RETURNING id`                                                                   | PK insertion                                                                        | PK insertion                           |
| `rotateSession` (mark old)          | `UPDATE sessions SET ... WHERE id = $1`                                                                   | PK                                                                                  | PK lookup                              |
| `revokeSession`                     | `UPDATE sessions SET ... WHERE sessions.access_token_hash = $1 AND revoked_at IS NULL`                    | `sessions_access_token_hash_unique`                                                 | Unique index scan                      |
| `createOtp`                         | `INSERT INTO otps ...`                                                                                    | PK insertion                                                                        | PK insertion                           |
| `findOtp`                           | `SELECT ... FROM otps WHERE id = $1`                                                                      | PK                                                                                  | PK lookup                              |
| `incrementOtpAttempts`              | `UPDATE otps SET attempts = attempts + 1 WHERE id = $1`                                                   | PK                                                                                  | PK lookup                              |
| `markOtpVerified`                   | `UPDATE otps SET verified_at = $2 WHERE id = $1 ...`                                                      | PK                                                                                  | PK lookup                              |
| `consumeOtp`                        | `UPDATE otps SET consumed_at = $2 WHERE id = $1 ...`                                                      | PK                                                                                  | PK lookup                              |
| `resetPasswordWithOtp`              | `UPDATE otps ... WHERE id = $1 AND account_id = $2 ...`                                                   | PK (on id) + `credentials_account_type_unique`                                      | PK lookup + unique index               |
| `resetPasswordWithOtp` (revoke all) | `UPDATE sessions SET ... WHERE account_id = $1`                                                           | `sessions_account_active_idx` (first column)                                        | Index scan                             |
| `recordSecurityEvent`               | `INSERT INTO security_events ...`                                                                         | PK insertion                                                                        | PK insertion                           |
| `getAccountStatus`                  | `SELECT status FROM accounts WHERE id = $1`                                                               | PK                                                                                  | PK lookup                              |

### Potential Full Table Scans (Missing Index)

| Query                                                                         | Table                   | Issue                    | Impact                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rotateSession` - `UPDATE sessions SET revoked_at = ... WHERE family_id = $1` | `sessions`              | No index on `family_id`  | When refresh token reuse is detected, ALL sessions in the same family are revoked. This does a sequential scan of `sessions`. With growing session counts, this becomes increasingly expensive. |
| Expired OTP cleanup (if implemented)                                          | `otps`                  | No index on `expires_at` | Any cleanup job would scan the entire table                                                                                                                                                     |
| Expired idempotency key cleanup (if implemented)                              | `auth_idempotency_keys` | No index on `expires_at` | Any cleanup job would scan the entire table                                                                                                                                                     |

**Recommendation:** Add an index on `sessions(family_id)` to support the refresh token reuse revocation pattern.

---

## 3. Missing Indexes — Recommendations

### 3.1 🔴 Critical: Index on `sessions(family_id)`

- **Query:** `rotateSession` when refresh reuse is detected
- **Impact:** Full table scan when revoking family sessions
- **Migration:** `0009_add_sessions_family_id_index`

### 3.2 🟡 Recommended: Index on `otps(expires_at)`

- **Query:** Future cleanup job for expired OTPs
- **Impact:** Cleanup would require full scan
- **Note:** Implement when building the cleanup job

### 3.3 🟡 Recommended: Index on `member_email_otps(expires_at)`

- **Query:** Future cleanup job for expired member OTPs
- **Impact:** Cleanup would require full scan

### 3.4 🟢 Nice-to-have: Index on `auth_idempotency_keys(expires_at)`

- **Query:** Future cleanup job for expired idempotency keys
- **Impact:** Cleanup would require full scan

---

## 4. Trigger Review

### 4.1 Append-Only Triggers

| Table                      | Trigger Name                           | Type                    | Function                        |
| -------------------------- | -------------------------------------- | ----------------------- | ------------------------------- |
| `audit_logs`               | `audit_logs_append_only`               | BEFORE UPDATE OR DELETE | `reject_append_only_mutation()` |
| `entity_timelines`         | `entity_timelines_append_only`         | BEFORE UPDATE OR DELETE | `reject_append_only_mutation()` |
| `member_referral_history`  | `member_referral_history_append_only`  | BEFORE UPDATE OR DELETE | `reject_append_only_mutation()` |
| `member_terms_acceptances` | `member_terms_acceptances_append_only` | BEFORE UPDATE OR DELETE | `reject_append_only_mutation()` |
| `member_status_history`    | `member_status_history_append_only`    | BEFORE UPDATE OR DELETE | `reject_append_only_mutation()` |
| `member_kyc_history`       | `member_kyc_history_append_only`       | BEFORE UPDATE OR DELETE | `reject_append_only_mutation()` |

All use the shared `reject_append_only_mutation()` function that raises exception with SQLSTATE `55000` ("object not in prerequisite state").

### 4.2 Phase 1 Append-Only Tables (via separate `reject_update` / `reject_delete` functions)

Migration 0002 adds append-only protection to additional tables using separate functions:

| Table                              | `reject_update` Trigger | `reject_delete` Trigger |
| ---------------------------------- | ----------------------- | ----------------------- |
| `merchant_application_submissions` | ✅                      | ✅                      |
| `merchant_application_reviews`     | ✅                      | ✅                      |
| `merchant_kyc_submissions`         | ✅                      | ✅                      |
| `merchant_kyc_reviews`             | ✅                      | ✅                      |
| `merchant_documents`               | ✅                      | ✅                      |
| `merchant_referrals`               | ✅                      | ✅                      |
| `merchant_terms_acceptances`       | ✅                      | ✅                      |
| `merchant_status_history`          | ✅                      | ✅                      |
| `mcp_ledger_entries`               | ✅                      | ✅                      |
| `mcp_adjustment_decisions`         | ✅                      | ✅                      |

### 4.3 Business Logic Triggers

| Table                          | Trigger Name                                  | Type                                          | Function                              |
| ------------------------------ | --------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| `accounts`                     | `accounts_email_immutable`                    | BEFORE UPDATE OF email                        | `reject_account_email_update()`       |
| `merchant_package_assignments` | `merchant_package_assignments_active_default` | AFTER INSERT OR UPDATE OR DELETE (DEFERRABLE) | `enforce_active_default_assignment()` |

### 4.4 Observations

- The append-only trigger approach is **consistent and effective**
- Phase 1 tables use separate `reject_update()` / `reject_delete()` functions while Phase 2 tables use the combined `reject_append_only_mutation()` — this is a minor inconsistency but functionally equivalent
- **Recommendation:** Consider unifying all append-only tables under a single trigger approach for consistency

---

## 5. Transaction Review

### 5.1 `rotateSession` (in `postgres-auth.store.ts`)

```
BEGIN
  SELECT ... FROM sessions JOIN accounts WHERE refresh_token_hash = $1 FOR UPDATE
  → Check if session exists, revoked, active, expired
  → If REUSED: UPDATE family sessions, COMMIT
  → If expired/inactive: ROLLBACK
  → If valid: INSERT new session, UPDATE old session, COMMIT
EXCEPTION → ROLLBACK
FINALLY → release client
```

**Assessment:**

- ✅ Properly scoped with `BEGIN` / `COMMIT` / `ROLLBACK`
- ✅ `FOR UPDATE` row lock prevents race conditions on token rotation
- ⚠️ `FOR UPDATE` lock is held while the application processes the result (DB round-trips)
- **Deadlock risk**: Low. Only one row is locked per session. No cross-row ordering issues.

### 5.2 `resetPasswordWithOtp` (in `postgres-auth.store.ts`)

```
BEGIN
  UPDATE otps SET consumed_at = ... WHERE id = $1 AND account_id = $2 ...
  → If not consumed: INSERT/UPDATE credentials
  → UPDATE sessions SET revoked_at = ... WHERE account_id = $1
  COMMIT
EXCEPTION → ROLLBACK
FINALLY → release client
```

**Assessment:**

- ✅ Properly scoped
- ⚠️ The `UPDATE sessions WHERE account_id = $1` acquires row locks on all sessions for the account. If a concurrent login/session rotation is happening for the same account, this could cause lock contention
- **Deadlock risk**: Low to Medium. If `rotateSession` and `resetPasswordWithOtp` run concurrently for the same account and `rotateSession` holds `FOR UPDATE` on a session row while `resetPasswordWithOtp` tries to update all sessions... However, `FOR UPDATE` is on the specific refresh token being rotated, not all sessions. The `UPDATE sessions` in `resetPasswordWithOtp` would only be blocked momentarily. **Acceptable risk.**

### 5.3 `createSession` (via Drizzle ORM)

- Single `INSERT` statement, no explicit transaction needed
- ✅ Auto-committed

### 5.4 Missing Transaction in `completeRegistration` / `completePasswordReset`

**These functions do not exist in the current codebase.** The `resetPasswordWithOtp` in `postgres-auth.store.ts` handles password resets and is properly transactional. The member registration flow (`completeRegistration`) has not been implemented yet — it will likely need a well-scoped transaction that:

1. Marks the member email OTP as used
2. Creates the account + member record
3. Sets the password credential
4. Creates member profile
5. Creates referral relationship (if referral code provided)
6. Creates first market preference

**Recommendation:** When implementing `completeRegistration`, use a single connection-level transaction with `BEGIN`/`COMMIT`/`ROLLBACK` (not Drizzle's high-level transaction API) for complex multi-table operations.

---

## 6. Cascade / Restrict Strategy Review

### 6.1 All Foreign Key Strategies

| Table                      | FK Column                | Referenced Table | Strategy     |
| -------------------------- | ------------------------ | ---------------- | ------------ |
| `credentials`              | `account_id`             | `accounts(id)`   | **RESTRICT** |
| `sessions`                 | `account_id`             | `accounts(id)`   | **RESTRICT** |
| `sessions`                 | `replaced_by_session_id` | `sessions(id)`   | **RESTRICT** |
| `otps`                     | `account_id`             | `accounts(id)`   | **RESTRICT** |
| `memberEmailOtps`          | `member_id`              | `members(id)`    | **RESTRICT** |
| `memberEmailOtps`          | `account_id`             | `accounts(id)`   | **RESTRICT** |
| `memberEmailOtps`          | `referrer_member_id`     | `members(id)`    | **RESTRICT** |
| `members`                  | `account_id`             | `accounts(id)`   | **RESTRICT** |
| `memberProfiles`           | `member_id`              | `members(id)`    | **RESTRICT** |
| `memberReferrals`          | `member_id`              | `members(id)`    | **RESTRICT** |
| `memberReferrals`          | `referrer_member_id`     | `members(id)`    | **RESTRICT** |
| `memberReferralHistory`    | all 3 member FKs         | `members(id)`    | **RESTRICT** |
| `memberStatusHistory`      | `member_id`              | `members(id)`    | **RESTRICT** |
| `memberTermsAcceptances`   | `member_id`              | `members(id)`    | **RESTRICT** |
| `adminUsers`               | `account_id`             | `accounts(id)`   | **RESTRICT** |
| `merchantGroups`           | `account_id`             | `accounts(id)`   | **RESTRICT** |
| `auditLogs`                | `market_id`              | `markets(id)`    | **RESTRICT** |
| `entityTimelines`          | `market_id`              | `markets(id)`    | **RESTRICT** |
| All Phase 1+2 merchant FKs | various                  | various          | **RESTRICT** |

### 6.2 Assessment

**Every foreign key in the entire schema uses `ON DELETE RESTRICT`.**

This is an **intentionally conservative** design choice — it prevents accidental data loss. Deleting an account with related records will fail with a foreign key violation, forcing the application to explicitly handle data cleanup.

**Implications:**

- ✅ Prevents orphaned records
- ✅ Forces explicit cleanup logic in application code
- ⚠️ The `sessions` table has a self-referencing FK (`replaced_by_session_id → sessions(id)`) with RESTRICT — this means deleting a session that was replaced by another session will fail
- ⚠️ Account deletion (if ever implemented) will require careful ordering: delete credentials → sessions → OTPs → member records → etc. before the account itself

**Recommendation:** The RESTRICT strategy is appropriate. If account deletion is planned, document the deletion order explicitly. Consider `ON DELETE CASCADE` only for child tables that are clearly owned and where existence without the parent is meaningless.

---

## 7. Data Retention Findings

### 7.1 OTP Expiry

| Table               | Expiry Field                      | Cleanup Mechanism        | Risk                         |
| ------------------- | --------------------------------- | ------------------------ | ---------------------------- |
| `otps`              | `expires_at` (required, NOT NULL) | ❌ None — no cleanup job | Rows accumulate indefinitely |
| `member_email_otps` | `expires_at` (required, NOT NULL) | ❌ None — no cleanup job | Rows accumulate indefinitely |

**Observation:** OTP records are small but can accumulate. At 100K registrations/month, the `member_email_otps` table grows by ~100K rows/month. The `otps` table (for admin/logged-in OTPs) grows based on password resets and step-up auths.

**Recommendation:** Implement a periodic cleanup job (e.g., cron via pg_cron or application scheduler) that deletes OTPs where `expires_at < now() - interval '30 days'`. Before implementing, add indexes on `otps(expires_at)` and `member_email_otps(expires_at)`.

### 7.2 Session Expiry

| Table      | Expiry Field                                            | Cleanup Mechanism        | Risk                         |
| ---------- | ------------------------------------------------------- | ------------------------ | ---------------------------- |
| `sessions` | `expires_at` (required, NOT NULL) + `access_expires_at` | ❌ None — no cleanup job | Rows accumulate indefinitely |

**Observation:** Sessions are large records (includes tokens, user agent, IP). At high login volumes, this table can grow significantly. The `rotateSession` query uses the `family_id` to revoke all sessions in a family when reuse is detected, but no mechanism removes expired sessions.

**Recommendation:** Implement a periodic cleanup job that removes expired sessions (WHERE `expires_at < now() - interval '90 days'`). Add an index on `sessions(expires_at)` if not covered by existing indexes.

### 7.3 Idempotency Key Expiry

| Table                   | Expiry Field                      | Cleanup Mechanism        | Risk            |
| ----------------------- | --------------------------------- | ------------------------ | --------------- |
| `auth_idempotency_keys` | `expires_at` (required, NOT NULL) | ❌ None — no cleanup job | Rows accumulate |

**Observation:** Idempotency keys are small but have no cleanup mechanism.

**Recommendation:** Clean up idempotency keys older than their TTL. Add an index on `auth_idempotency_keys(expires_at)`.

### 7.4 Audit Logs & Entity Timelines

| Table              | Cleanup Mechanism     | Risk                                             |
| ------------------ | --------------------- | ------------------------------------------------ |
| `audit_logs`       | ❌ None (append-only) | Largest growth — must be retained for compliance |
| `entity_timelines` | ❌ None (append-only) | Append-only, no deletion                         |

**Observation:** These tables are append-only by design and should not be deleted. For data lifecycle management, consider table partitioning by `occurred_at` (e.g., monthly or quarterly) for manageable archival.

---

## 8. Multi-Market Readiness

### 8.1 Email Uniqueness

| Constraint                                                | Current     | Multi-Market Implication                                         |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `accounts_email_unique`                                   | **Global**  | ✅ Required: email must be globally unique regardless of markets |
| Email belongs to account, accounts have `account_country` | Per-account | Email is unique globally, not per-country                        |

**Assessment:** The current design makes email globally unique. This is **correct** because:

- A user should have one account across all markets
- If email uniqueness were per-market, the same email could register in multiple markets, creating separate accounts
- The `account_country` field on `accounts` allows per-market routing

**Recommendation:** ✅ No changes needed. Email should remain globally unique.

### 8.2 `publicMemberId` Uniqueness

| Constraint                        | Current    | Multi-Market Implication               |
| --------------------------------- | ---------- | -------------------------------------- |
| `members_public_member_id_unique` | **Global** | Member ID is unique across all markets |

**Assessment:** This is correct. A member (1:1 with account) has a single public-facing ID regardless of how many markets they participate in.

**Recommendation:** ✅ No changes needed.

### 8.3 `referralCode` Uniqueness

| Constraint                     | Current    | Multi-Market Implication                   |
| ------------------------------ | ---------- | ------------------------------------------ |
| `members_referral_code_unique` | **Global** | Referral code is unique across all markets |

**Assessment:** ✅ Correct. Referral codes must be globally unique to prevent ambiguity. The code is auto-generated and can incorporate market prefixes if needed.

**Recommendation:** ✅ No changes needed.

### 8.4 Market-Specific Tables

The following tables already support per-market configuration:

| Table                       | Market Column     | Purpose                                            |
| --------------------------- | ----------------- | -------------------------------------------------- |
| `accounts`                  | `account_country` | Account's registered country                       |
| `memberEmailOtps`           | `account_country` | Registration country (for multi-market onboarding) |
| `member_market_preferences` | `market_id`       | Which markets this member has enabled              |
| `member_kyc_cases`          | `market_id`       | KYC per market                                     |
| `member_kyc_documents`      | `market_id`       | KYC documents per market                           |

### 8.5 Recommendations

1. ✅ **Email globally unique** — correct design; no change needed
2. ✅ **publicMemberId globally unique** — correct; no change needed
3. ✅ **referralCode globally unique** — correct; no change needed
4. ✅ **account_country on accounts** — supports multi-market routing
5. ℹ️ **Member market preferences exist** — members opt-in to markets
6. ℹ️ **Consider: market-specific terms acceptance** — `member_terms_acceptances` has no `market_id` field, meaning terms are per-document-type across all markets. If different markets have different terms documents, this may need a `market_id` column and the unique constraint should include it.

---

## 9. Migration: Add `sessions(family_id)` Index

### Rationale

The `rotateSession` method in `postgres-auth.store.ts` revokes all sessions in a family when refresh token reuse is detected:

```sql
UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2),
  revoke_reason = COALESCE(revoke_reason, 'REFRESH_TOKEN_REUSE')
WHERE family_id = $1
```

Without an index on `family_id`, this query performs a **sequential scan** on the `sessions` table. For an app with many concurrent users, this becomes increasingly expensive.

### Migration File

**File:** `packages/database/migrations/0009_add_sessions_family_id_index.sql`

### Migration (Up)

```sql
-- Add index on sessions.family_id to support refresh token reuse revocation
-- This query is executed when rotateSession detects a reused refresh token
-- and needs to revoke ALL sessions in the same family.
--
-- Note: CONCURRENTLY is intentionally omitted because the migration runner
-- wraps each migration in a transaction, and CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block.
CREATE INDEX IF NOT EXISTS sessions_family_id_idx
  ON sessions (family_id);
```

### Migration (Down)

This project uses one-directional migrations (up only). The index can be removed manually:

```sql
DROP INDEX IF EXISTS sessions_family_id_idx;
```

### Verification

- [ ] Migration applies cleanly
- [ ] Migration rolls back cleanly
- [ ] `EXPLAIN ANALYZE UPDATE sessions SET revoked_at = now() WHERE family_id = 'test-uuid'` shows Index Scan

---

## 10. Summary of Recommendations

### 🔴 Must Do

| #   | Item                                                 | Priority     | Effort |
| --- | ---------------------------------------------------- | ------------ | ------ |
| 1   | Create migration `0009_add_sessions_family_id_index` | **Critical** | Low    |

### 🟡 Should Do

| #   | Item                                                        | Priority | Effort |
| --- | ----------------------------------------------------------- | -------- | ------ |
| 2   | Add OTP expiry cleanup job (with index on `expires_at`)     | High     | Medium |
| 3   | Add session expiry cleanup job (with index on `expires_at`) | High     | Medium |
| 4   | Add idempotency key expiry cleanup job                      | Medium   | Low    |
| 5   | Consider unifying append-only trigger approach              | Low      | Low    |

### 🟢 Nice to Have

| #   | Item                                                                        | Priority | Effort              |
| --- | --------------------------------------------------------------------------- | -------- | ------------------- |
| 6   | Add `market_id` to `member_terms_acceptances` for multi-market terms        | Medium   | Low (schema change) |
| 7   | Document account deletion order (if planned)                                | Low      | Low                 |
| 8   | Partition `audit_logs` and `entity_timelines` for data lifecycle management | Low      | High                |
| 9   | Add entity_timelines_event_type_idx for event-type filtered queries         | Low      | Low                 |

---

## Appendix A: Migration Files

### Migration `0009_add_sessions_family_id_index` (Up)

```sql
-- 0009_add_sessions_family_id_index.up.sql
-- Purpose: Add index on sessions.family_id for refresh token reuse revocation
-- Note: CONCURRENTLY omitted because migration runner wraps in transaction

CREATE INDEX IF NOT EXISTS sessions_family_id_idx
  ON sessions (family_id);
```

### Migration `0009_add_sessions_family_id_index` (Down)

```sql
-- 0009_add_sessions_family_id_index.down.sql
-- Purpose: Remove the sessions.family_id index

DROP INDEX IF EXISTS sessions_family_id_idx;
```

---

## Appendix B: Query Pattern Reference

### All ORM Queries in `postgres-auth.store.ts`

```
findPasswordIdentity(email):
  SELECT a.id, a.status, c.secret_hash
  FROM accounts a
  INNER JOIN credentials c ON c.account_id = a.id AND c.type = 'PASSWORD'
  WHERE a.email = $1
  LIMIT 1

setPasswordCredential(accountId, secretHash):
  INSERT INTO credentials (...) VALUES (...)
  ON CONFLICT (account_id, type) DO UPDATE SET ...

createSession(newSession):
  INSERT INTO sessions (...) VALUES (...) RETURNING id

findAccessSession(accessTokenHash):
  SELECT s.id, s.account_id, s.family_id, a.status, s.access_expires_at,
         s.revoked_at, au.id AS admin_user_id
  FROM sessions s
  INNER JOIN accounts a ON a.id = s.account_id
  LEFT JOIN admin_users au ON au.account_id = s.account_id
  WHERE s.access_token_hash = $1
  LIMIT 1

rotateSession(refreshTokenHash):
  Raw SQL:
    SELECT s.id, s.account_id, s.family_id, s.expires_at, s.revoked_at, a.status
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.refresh_token_hash = $1 FOR UPDATE

  → If REUSED:
    UPDATE sessions SET revoked_at = $2, revoke_reason = 'REFRESH_TOKEN_REUSE'
    WHERE family_id = $1

  → If valid:
    INSERT INTO sessions (...) VALUES (...) RETURNING id
    UPDATE sessions SET revoked_at = $2, revoke_reason = 'REFRESH_ROTATED',
      replaced_by_session_id = $3 WHERE id = $1

revokeSession(accessTokenHash):
  UPDATE sessions SET revoked_at = $2, revoke_reason = $3
  WHERE access_token_hash = $1 AND revoked_at IS NULL
  RETURNING id

createOtp(otp):
  INSERT INTO otps (...) VALUES (...)

findOtp(id):
  SELECT * FROM otps WHERE id = $1 LIMIT 1

incrementOtpAttempts(id):
  UPDATE otps SET attempts = attempts + 1
  WHERE id = $1 AND attempts < max_attempts
  RETURNING attempts

markOtpVerified(id, now):
  UPDATE otps SET verified_at = $2
  WHERE id = $1 AND verified_at IS NULL AND consumed_at IS NULL
    AND expires_at > $2 AND attempts < max_attempts

consumeOtp(id, now):
  UPDATE otps SET consumed_at = $2
  WHERE id = $1 AND verified_at IS NOT NULL AND consumed_at IS NULL
    AND expires_at > $2

resetPasswordWithOtp(otpId, accountId, secretHash, now):
  Raw SQL (transaction):
    1. UPDATE otps SET consumed_at = $3
       WHERE id = $1 AND account_id = $2 AND purpose = 'PASSWORD_RESET'
         AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at > $3
       RETURNING id
    2. INSERT INTO credentials (...) VALUES (...)
       ON CONFLICT (account_id, type) DO UPDATE SET ...
    3. UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2),
         revoke_reason = COALESCE(revoke_reason, 'PASSWORD_RESET')
       WHERE account_id = $1

recordSecurityEvent(input):
  INSERT INTO security_events (...) VALUES (...)

getAccountStatus(accountId):
  SELECT a.status FROM accounts a WHERE a.id = $1 LIMIT 1
```

---

## Appendix C: Entity Relationship Summary

```
accounts (1) ──→ (1) members
accounts (1) ──→ (0..N) credentials
accounts (1) ──→ (0..N) sessions
accounts (1) ──→ (0..N) otps
accounts (1) ──→ (0..N) member_email_otps
accounts (1) ──→ (0..1) admin_users
accounts (1) ──→ (0..N) merchant_groups

members (1) ──→ (1) member_profiles
members (1) ──→ (0..N) member_market_preferences
members (1) ──→ (0..1) member_referrals (as member)
members (1) ──→ (0..N) member_referrals (as referrer)
members (1) ──→ (0..N) member_referral_history
members (1) ──→ (0..N) member_status_history
members (1) ──→ (0..N) member_terms_acceptances
members (1) ──→ (0..N) member_qr_identities
members (1) ──→ (0..1) member_kyc_cases
members (1) ──→ (0..N) member_kyc_documents
members (1) ──→ (0..N) member_account_country_change_requests
```
