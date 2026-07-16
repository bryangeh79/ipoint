# P1-S1 Repair Order — CR-01 through CR-07

## Authorization

- Source: ChatGPT Command Center (2026-07-16 18:16 GMT+8)
- Scope: Only `docs/06-phase-reports/p1-s1/`
- Previous SHA: `7c1bd3ba48db82746376e360dca55735ec020b3a`
- Branch: `task/p1-s1-baseline-domain-map`
- Implementation NOT authorized
- P1-S2 NOT authorized
- No phase/1-\* branch
- No merge main

## Required reading

- All existing files under `docs/06-phase-reports/p1-s1/`
- Phasing 0 baseline governance documents
- Merchant PRD and Admin PRD extracted content under `.tmp_merchant_prd.txt` and `.tmp_admin_prd.txt`

## CR-01: MerchantGroup

Create a proper MerchantGroup entity. Replace all "nullable group_id reservation" with:

- `MerchantGroup` table: id, name, account_id (FK to accounts), market_id (FK to markets), created_at
- `MerchantBranch` has FK to `MerchantGroup`
- Single-branch merchants also get a default group
- No group-level permissions
- No shared MCP
- No group-level settlement
- O-01 is considered resolved for Phase 1 scope
- Update: BASELINE_AUDIT, SCOPE_MATRIX, ERD, DOMAIN_MAP, MIGRATION_PLAN

## CR-02: Account/Branch relationship

Remove any UNIQUE constraint on merchant_branches.account_id. Replace with:

- Account -> MerchantGroup ownership (account_id on MerchantGroup)
- MerchantGroup -> many MerchantBranches
- Or explicit MerchantAccountAccess table with account_id, merchant_group_id, access_type PRIMARY_OWNER
- Phase 1 only implements PRIMARY_OWNER boundary
- No staff roles
- Update: ERD, DOMAIN_MAP, SCOPE_MATRIX

## CR-03: Split state machines

Replace the single merchant lifecycle with three independent enum proposals:

MerchantApplicationStatus: DRAFT, SUBMITTED, UNDER_REVIEW, RESUBMISSION_REQUIRED, APPROVED, REJECTED
MerchantKycStatus: DRAFT, SUBMITTED, UNDER_REVIEW, RESUBMISSION_REQUIRED, APPROVED, REJECTED
MerchantOperationalStatus: PENDING_APPLICATION, PENDING_KYC, PENDING_MCP, ACTIVE, SUSPENDED, CLOSURE_PENDING, CLOSED

Rules:

- Application Review determines application result
- KYC Review determines KYC result
- Operational Status is deterministically driven by activation policy
- KYC approved + MCP >= 100 -> ACTIVE
- Suspend/Reactivate only affect Operational Status
- Suspend preserves MCP
- Update: STATE_MACHINES, ERD, ACCEPTANCE_PLAN, API_MATRIX, SCOPE_MATRIX

## CR-04: Remove Receipt scope leakage

Completely remove from ALL documents:

- Receipt Request Foundation
- Pending/WaitingMember/Completed/Expired states
- 60-minute receipt behavior
- Receipt binding
- Receipt completion race
- Any receipt entity/enum/table/endpoint proposal

Only record in DEFERRED_ITEMS.md:
"Receipt and Transaction Engine are fully deferred. No Phase 1 table, enum, endpoint or runtime behavior."

Remove from: SCOPE_MATRIX, STATE_MACHINES, ERD, ACCEPTANCE_PLAN, API_MATRIX

## CR-05: Merchant email immutability

Remove all "contact/profile email may change" language. Replace with:

- Merchant primary email = Account email (immutable)
- Merchant primary email CANNOT be modified
- Merchant Profile does NOT have a separately modifiable contact_email field
- phone/WhatsApp/website are modifiable
- public support email is a future independent product decision
- Add acceptance: PATCH Merchant Profile cannot modify any primary/login email
- API input with primary email is rejected
- Admin also cannot modify Merchant primary email
- Update: ERD, SCOPE_MATRIX, API_MATRIX, ACCEPTANCE_PLAN

## CR-06: Append-only table timestamps

Remove `updated_at` from append-only tables:

- mcp_ledger_entries
- merchant_status_history
- terms_acceptances
- approval decision evidence (mcp_adjustment_decisions)
- immutable KYC submission snapshots
- Any other append-only history/projection table

Only retain event time fields (created_at, occurred_at, effective_at, etc.)
Migration plan must specify:

- Append-only tables reject UPDATE
- Append-only tables reject DELETE
- Compensation instead of mutation
- No soft-delete column for ledger/history evidence
- Update: ERD, MIGRATION_PLAN, MCP_LEDGER_INVARIANTS

## CR-07: Special Percentage OPEN range

- Keep: numeric(12,6), rate > 0
- Remove any constraint claiming <= 100 is an approved business limit
- If a <= 100 constraint or similar was proposed, replace with:
  "Maximum allowed special percentage remains OPEN per O-07"
  "P1-S2 special-percentage production constraint is blocked until Command Center decision"
  "No implementation may invent maximum, minimum business increment or approval threshold"
- Standard A-F packages still recorded: 2.5/5/10/15/20/25
- Update: ERD, SCOPE_MATRIX, DOMAIN_MAP

## Cross consistency check (CR-08 implicit)

Search ALL 10 files for these banned terms and fix:

- "group reservation" or "nullable group_id" — replace with proper MerchantGroup entity
- "receipt" or "WaitingMember" — remove entirely
- "contact email may change" or "profile email" — make immutable
- "updated_at" on append-only tables — remove
- "ratePercent <= 100" or "<= 100" for special percentage — remove constraint
- "implementation_authorized" — must remain false

## Git discipline

- Only modify files under `docs/06-phase-reports/p1-s1/`
- Do NOT amend existing commit
- Do NOT force push
- Commit message: `docs(p1-s1): resolve command center architecture findings`
- Push to `origin/task/p1-s1-baseline-domain-map`
- Verify remote SHA matches

## Prohibited

- No production schema
- No migration file
- No API code
- No UI
- No phase/1 branch
- No P1-S2
- No merge main
- No modification of official business rules
- No modification of Phase 0 infrastructure
