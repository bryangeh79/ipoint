# iPoint API Contract Specification V1.0

## 1. API style

Use versioned REST APIs for V1 unless a later approved architecture decision changes this. Suggested base path: `/api/v1`.

## 2. Standard response envelope

Successful response:

```json
{
  "data": {},
  "meta": {},
  "requestId": "req_xxx"
}
```

Error response:

```json
{
  "error": {
    "code": "TRANSACTION_MCP_INSUFFICIENT",
    "message": "Merchant MCP balance is insufficient.",
    "details": {}
  },
  "requestId": "req_xxx"
}
```

Do not expose stack traces, internal SQL, secrets, or sensitive KYC details.

## 3. Authentication and authorization

- Protected endpoints require authenticated sessions or access tokens.
- Role checks are mandatory on the server.
- Admin endpoints require role, market-access, and action-permission checks.
- Merchant access is restricted to authorized merchant organization/branch scope.
- Member endpoints may only access the authenticated member's protected data unless an approved delegated flow exists.
- Sensitive actions may require recent authentication or step-up verification.

## 4. Request context

Where relevant, requests carry:

- `X-Request-Id`
- `Idempotency-Key` for retryable writes
- Current Market through an approved explicit context field or header
- Locale/language preference

The server validates market access and never trusts a client market identifier without authorization checks.

## 5. Idempotency

Required for:

- Transaction confirmation
- Payment/top-up callbacks
- Manual top-up approval execution
- Reward settlement item execution
- Redemption confirmation
- Commission qualification/payment posting
- Webhook processing

Repeated requests with the same valid key and payload must return the same logical outcome. Reuse with a different payload must be rejected.

## 6. Pagination, sorting, and filtering

Use consistent query parameters:

- `page`
- `pageSize`
- `sort`
- `order`
- domain filters such as `marketId`, `status`, `dateFrom`, `dateTo`

Responses include total or cursor metadata according to the approved implementation. Do not invent different pagination formats per module.

## 7. Validation

- Validate all input server-side.
- Use exact decimal handling for amounts and percentages.
- Normalize email, phone, and public identifier searches.
- Return stable machine-readable error codes.
- Do not accept client-calculated service fee, reward, commission, or balance as authoritative.

## 8. Core endpoint groups

### Identity

- Registration
- Email OTP verification
- Login/logout
- Password reset
- Session management
- Terms/consent capture

### Member

- Profile
- Current Market
- Account Country change request
- KYC
- Universal QR
- Merchant discovery
- Wallet and ledger
- Reward entitlement/history
- Team/referral
- Agent activation
- Commission summary
- Redemption

### Merchant

- Profile and media
- KYC submission
- Branches
- Package assignments
- MCP balance and ledger
- Top-up and refund requests
- Transaction draft and confirmation
- Receipt lookup
- Transaction history
- Advertisement submission

### Admin

- Member and merchant review
- Market configuration
- Rule versions
- MCP/iPoint manual adjustment
- Maker/Checker approval
- Settlement monitoring
- Agent and commission administration
- Advertisement review
- Risk case management
- Reports and audit logs
- Roles, permissions, and market access

## 9. Transaction confirmation contract

The client submits only approved identifiers and sale input. The server resolves and calculates:

- Merchant/branch status
- Member status
- Consumption market
- Package assignment/version
- Gross amount validity
- Service-fee amount
- MCP requirement and balance
- Reward entitlement inputs
- Commission entitlement inputs
- Receipt validity and duplicate protection

The confirmation response returns the authoritative calculation snapshot and public IDs.

## 10. Webhooks and external integrations

- Verify signatures and timestamps.
- Store raw delivery metadata securely.
- Process idempotently.
- Return fast acknowledgment and perform durable asynchronous processing where suitable.
- Maintain retry and dead-letter visibility.
- Never trust external payment status without verification against provider rules.

## 11. Versioning and compatibility

- Breaking changes require a new API version or approved migration plan.
- Additive response fields should remain backward compatible.
- Deprecated endpoints require a sunset notice and telemetry before removal.
- API contract changes must be documented in the relevant Phase report.

## 12. Observability

Every request must be traceable through request ID, authenticated actor, market context, and relevant domain identifiers. Sensitive data must be redacted from logs.
