# Architecture Invariants

## Account and market boundaries

- A person has one account identity and may participate in multiple markets.
- Market and country context must be explicit in domain records and requests; Malaysia is the launch market, not a hard-coded global default.
- Tenant, role, and market authorization must be checked server-side before customer data is read or changed.

## Precision and ledger integrity

- MCP, iPoint, and commissions use immutable ledger entries. A displayed balance is a derived projection, never the source of truth.
- Monetary and point values use database decimal columns and decimal-safe application types. JavaScript floating-point arithmetic is prohibited for business calculations.
- Ledger, financial, transaction, and audit records are never hard-deleted.
- Every posting command must have an idempotency key and preserve the relationship between reversal and original entries.

## Time and scheduled processing

- Store timestamps as UTC instants and retain the IANA timezone used for market/business-day decisions.
- Daily reward runs are scoped by market business date and rule version.
- Scheduled processing must be idempotent, retryable, observable, and auditable; retries must not duplicate ledger entries.

## API and operational behavior

- Validate external input at the boundary and return stable public error codes without leaking internal exceptions.
- Liveness confirms the process can serve requests. Readiness checks required dependencies and returns a failure status when they are unavailable.
- Structured logs include a request identifier and must not contain credentials, tokens, raw secrets, or unnecessary customer data.
