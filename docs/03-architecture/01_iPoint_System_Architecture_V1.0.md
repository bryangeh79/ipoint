# iPoint System Architecture V1.0

## 1. Architecture objective

Build an auditable, multi-market consumer platform that supports Member, Merchant, and Admin applications while keeping financial-like point movements deterministic, reversible through compensating entries, and traceable.

## 2. Recommended V1 architecture

Use a modular monolith for the first production version. Do not begin with independently deployed microservices. Domain boundaries must still be explicit so modules can be separated later if scale or regulation requires it.

Suggested logical modules:

- Identity and Authentication
- User and Profile
- Market and Localization
- Merchant and Branch
- Merchant Package and Special Rate
- MCP Wallet and Ledger
- Transaction and Receipt
- iPoint Reward and Wallet Ledger
- Agent and Referral
- Commission Ledger
- Redemption
- Advertising and Content
- KYC and Review
- Notification
- Risk and Case Management
- Admin RBAC and Market Access
- Audit and Reporting
- Configuration and Rule Versioning

## 3. Data stores

### PostgreSQL

PostgreSQL is the system of record for accounts, markets, merchants, packages, transactions, ledgers, rules, approvals, and audit events.

### Redis

Redis may be used for caching, distributed locks, OTP/session support, rate limiting, and job coordination. Redis must not be the sole source of truth for balances, transaction state, or settlement state.

### Object storage

Use object storage for merchant images, banners, KYC documents, receipts, and generated exports. Store metadata, ownership, checksum, retention, and review status in PostgreSQL.

## 4. Application surfaces

- Member: mobile-first responsive PWA, with future iOS and Android packaging paths
- Merchant: responsive PWA for onboarding, MCP, scanning, transaction, history, and advertising
- Admin: responsive web and PWA for operations, review, rules, risk, audit, and reporting

Shared components and design tokens should live in a shared package where the chosen repository structure supports it.

## 5. Multi-market architecture

- Every market has a stable `market_id`, currency, timezone, locale set, status, and policy configuration.
- Account Country is the account's registered jurisdiction and requires controlled change.
- Current Market is a browsing and operating context selected by the member.
- Market-scoped data must include `market_id`.
- Cross-market consumption is recorded under the merchant/consumption market.
- Market wallet balances must not be merged into a single global balance.
- Time-sensitive jobs use the market timezone, while persisted timestamps use UTC.

## 6. Rule versioning

The following must be represented as versioned rules with effective periods, market scope, status, and audit history:

- Merchant service-fee package percentages
- Merchant special percentages
- Daily reward percentages
- Redemption rates
- Commission percentages and fixed amounts
- Advertisement MCP prices
- KYC requirements
- Limits and risk thresholds

A confirmed transaction must store the exact rule/package version used. Later configuration changes must never mutate historical calculations.

## 7. Transaction consistency

Critical writes must be transactional. Confirmation of a merchant transaction should atomically create or update:

- Transaction record
- Receipt state
- Selected package/rule snapshot
- Merchant service-fee amount
- MCP debit ledger
- Reward entitlement source record
- Commission entitlement source records where applicable
- Audit event
- Outbox event for asynchronous work

Use idempotency keys and unique constraints to prevent duplicate confirmation.

## 8. Background jobs

Use a durable job queue or database-backed outbox pattern for:

- Market-local daily reward settlement
- Notification delivery
- Report generation
- Reconciliation
- Advertisement scheduling
- Expired receipt cleanup
- Retryable integrations

Jobs must be idempotent, observable, retry-safe, and resumable.

## 9. Security model

- Strong authentication and session controls
- Role-based access control
- Market access restrictions for Admin users
- Action-level permissions for sensitive operations
- Maker/Checker approval for manual MCP and iPoint adjustments
- Audit logging for all privileged actions
- Encryption in transit and at rest
- Rate limiting and abuse controls
- Secrets kept outside source control

## 10. Extensibility boundaries

The architecture may prepare interfaces for future payment gateways, e-wallet, lending, IPO-related eligibility, and cross-border settlement, but those modules must not be implemented as active financial products in the MVP.
