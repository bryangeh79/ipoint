# iPoint Deployment, Security, and Operations V1.0

## 1. Environments

Maintain isolated environments:

- Local development
- Shared development
- Staging/UAT
- Production

Production credentials, data, storage, and integrations must never be shared with development environments.

## 2. Configuration and secrets

- Store secrets in environment-specific secret management, not Git.
- Provide `.env.example` with names and descriptions only.
- Validate required configuration at application startup.
- Separate market configuration from deployment secrets.
- Commercial rules belong in versioned application configuration tables, not environment variables or hard-coded constants.

## 3. Deployment model

Phase 0 must document the chosen stack and deployment method. Regardless of platform:

- Builds must be reproducible.
- Database migrations run in a controlled step.
- Application and worker versions must be traceable to Git commit SHA.
- Deployment must support rollback or forward recovery.
- Background workers must not run incompatible code against an unmigrated database.

## 4. CI/CD gates

Before a deployable artifact is accepted:

- Formatting/lint pass
- Type check passes
- Unit and integration tests pass
- Build passes
- Migration validation passes
- Dependency and secret scans pass where configured
- Critical E2E smoke tests pass

Production deployment requires an approved Phase or release decision.

## 5. Security baseline

- TLS for all external traffic
- Secure password hashing
- Short-lived or revocable sessions/tokens
- CSRF protection where applicable
- Secure cookies where applicable
- Rate limiting for authentication, OTP, QR, transaction, and admin actions
- Input validation and output encoding
- Server-side authorization on every protected action
- Least-privilege database and cloud permissions
- Malware/file-type/size validation for uploads
- Encryption for sensitive stored data
- Redaction of secrets, credentials, KYC data, and full tokens from logs

## 6. Sensitive workflows

The following require elevated control and complete audit evidence:

- Manual MCP adjustment
- Manual iPoint adjustment
- Commission payment or override
- Merchant activation/suspension
- Member/agent status override
- Account Country change approval
- KYC review
- Rule publication
- Settlement rerun
- Redemption refund/reversal

Manual MCP and iPoint adjustments require Maker/Checker separation. The maker cannot approve the same request.

## 7. Observability

Implement structured logs, metrics, and alerting for:

- Authentication failures and abuse
- API error rate and latency
- Database and queue health
- Transaction confirmation failures
- MCP debit failures
- Reward settlement duration/failures
- Ledger reconciliation differences
- Payment webhook failures
- Notification failures
- Admin privileged actions

Logs must include request ID, service/module, environment, market context where appropriate, and safe domain identifiers.

## 8. Backup and recovery

- Automated PostgreSQL backups
- Point-in-time recovery where supported
- Object storage versioning/retention appropriate to policy
- Restore tests on a defined schedule
- Documented recovery time and recovery point objectives before production launch
- Ledger reconciliation after recovery

A backup is not considered valid until restoration has been tested.

## 9. Scheduled jobs and timezone operations

- Store execution time in UTC and resolve schedules with IANA market timezone.
- Daily reward settlement must account for daylight-saving changes in markets that use them.
- Each settlement batch has unique market/date identity.
- Reruns must be idempotent and auditable.
- Failed items must be retryable without duplicating successful credits.

## 10. Incident management

Define severity levels and a response runbook covering:

- Security incident
- Incorrect ledger balance
- Duplicate transaction
- Settlement failure
- Payment/top-up mismatch
- Data exposure
- Production outage

Incident records must include timeline, impact, containment, correction, reconciliation, root cause, and preventive action.

## 11. Data governance

- Collect only required personal data.
- Apply market-specific consent and retention policy.
- Restrict KYC access by role and market.
- Record download/export actions for sensitive reports.
- Use anonymization or aggregation for analytics where possible.
- Do not treat consumer data as freely transferable or monetizable without legal basis and approved policy.

## 12. Production readiness evidence

Before production launch, provide:

- Architecture and threat review
- Access-control matrix
- Backup restoration evidence
- Migration rehearsal
- Load/performance evidence for critical flows
- Security scan and remediation report
- Monitoring dashboards and alerts
- Incident and rollback runbooks
- Ledger reconciliation test
- Business UAT sign-off
