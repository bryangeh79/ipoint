# iPoint Database ERD and Ledger Specification V1.0

## 1. Core principles

- PostgreSQL is the authoritative store.
- Use UUIDs or equivalent internal immutable keys.
- Public IDs are separate, human-readable, unique, and never reused.
- All monetary amounts and percentages use exact decimal or integer minor-unit representations; never use floating point.
- All timestamps are stored in UTC. Market-local processing uses the market's configured IANA timezone.
- Transaction, ledger, approval, and audit records are never physically deleted.
- Corrections use state transitions or compensating ledger entries.

## 2. Main entity groups

### Identity

- `accounts`
- `account_credentials`
- `account_sessions`
- `account_roles`
- `member_profiles`
- `member_kyc_profiles`
- `account_country_change_requests`

### Market and configuration

- `markets`
- `market_locales`
- `market_currencies`
- `configuration_rules`
- `configuration_rule_versions`
- `configuration_effective_periods`

### Merchant

- `merchant_organizations`
- `merchant_branches`
- `merchant_profiles`
- `merchant_media`
- `merchant_kyc_submissions`
- `merchant_status_history`
- `merchant_package_assignments`
- `merchant_special_rate_assignments`

A branch has its own public Merchant ID. Suggested format remains compact and market-aware, such as `my-of-0001`, while the actual sequence policy must be centralized.

### Package and reward rules

- `merchant_service_fee_packages`
- `merchant_service_fee_package_versions`
- `reward_rule_versions`
- `redemption_rate_versions`
- `commission_rule_versions`

### Transaction and receipt

- `transaction_drafts`
- `receipts`
- `transactions`
- `transaction_rule_snapshots`
- `transaction_status_history`
- `transaction_risk_flags`

Each confirmed transaction stores the selected merchant package assignment and immutable calculation snapshot.

### Wallet and ledger

- `mcp_wallets`
- `mcp_ledger_entries`
- `ipoint_wallets`
- `ipoint_ledger_entries`
- `commission_accounts`
- `commission_ledger_entries`
- `ledger_reconciliation_batches`

Wallet tables contain current snapshots. Ledger entries are the audit source of truth.

### Reward settlement

- `reward_entitlements`
- `reward_settlement_batches`
- `reward_settlement_items`
- `reward_settlement_failures`

### Referral and agent

- `referral_relationships`
- `agent_profiles`
- `agent_activation_requests`
- `agent_course_records`
- `agent_fee_payments`
- `commission_entitlements`
- `merchant_referral_relationships`

### Redemption

- `redemption_catalog_items`
- `redemption_inventory`
- `redemption_orders`
- `redemption_order_status_history`

### Admin, approval, and audit

- `admin_users`
- `roles`
- `permissions`
- `role_permissions`
- `admin_market_access`
- `approval_requests`
- `approval_actions`
- `audit_events`
- `outbox_events`

## 3. Ledger entry minimum fields

Every MCP, iPoint, and commission ledger entry should contain:

- Internal ID
- Wallet/account ID
- Market ID
- Direction: credit or debit
- Exact amount
- Entry type
- Source entity type and ID
- Idempotency key
- Rule/version reference where applicable
- Effective timestamp
- Created timestamp
- Actor type and actor ID
- Approval request ID where applicable
- Reversal-of entry ID where applicable
- Balance after entry, if stored as a derived convenience field
- Metadata JSON for non-authoritative context

## 4. Ledger invariants

- A source event and entry type may produce only one logical ledger entry unless explicitly designed as installments.
- Debits may not reduce an available balance below allowed limits.
- A reversal never edits or deletes the original entry.
- Wallet snapshot update and ledger append occur in the same database transaction.
- Reconciliation can recompute wallet snapshots from ledger entries.
- Manual adjustments require reason, actor, evidence, and approval linkage.
- Manual MCP and iPoint adjustments require Maker/Checker separation.

## 5. Transaction calculation snapshot

A confirmed transaction snapshot must include:

- Merchant and branch
- Consumption market
- Member
- Gross sale amount and currency
- Selected package/rate version
- Service-fee percentage
- Service-fee amount
- MCP debit amount
- Reward rule version and calculation inputs
- Commission rule version and calculation inputs
- Receipt ID
- Confirmation time

Historical calculations must remain reproducible even after rules change.

## 6. Multi-market wallet rules

- One member may have multiple `ipoint_wallets`, one per supported market.
- A transaction credits the wallet of the consumption market.
- No cross-market transfer is included in MVP.
- Redemption debits the selected market wallet according to that market's active redemption rules.

## 7. Receipt rules

- Receipt public ID is unique.
- Draft/pending receipt has a 60-minute expiry.
- Confirmation is idempotent.
- Duplicate merchant/member/receipt confirmation is blocked with unique constraints or equivalent locking.
- Normal merchant UI does not provide destructive cancellation after confirmation.
- Administrative correction uses a governed dispute/reversal process and compensating entries.

## 8. Indexing and constraints

At minimum index:

- Public IDs
- Email and normalized contact identifiers
- Market-scoped foreign keys
- Merchant/member status
- Transaction date, merchant, member, receipt, and transaction public ID
- Ledger wallet/account and effective timestamp
- Settlement batch and entitlement eligibility
- Approval status and audit actor/time

Use database constraints for invariants whenever possible rather than application-only validation.

## 9. Migration requirements

- Every schema change uses a versioned migration.
- Migrations must be forward-tested and rollback or compensating strategy documented.
- Destructive changes require explicit approval.
- Seed data must be deterministic and environment-aware.
- Production data corrections use audited scripts, never ad hoc direct edits.
