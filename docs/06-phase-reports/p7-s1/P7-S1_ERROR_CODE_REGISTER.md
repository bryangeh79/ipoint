# Phase 7 Admin Operations — Canonical Error Code Register

> **Status: DRAFT / UNDER_COMMAND_CENTER_REVIEW / NOT_IMPLEMENTATION_AUTHORIZATION**
>
> Documentation-only P7-S1D register. It defines safe proposed API/UI contracts; it authorizes no endpoint, production code, schema, migration, test, CI, seed, dependency, remediation, or frozen Phase 3–6 owner change.

## 1. Contract rules

- Error envelope: `code`, `message`, safe `requestId`/`correlationId` when available, and allowlisted `details`. No SQL, stack, table/column name, secret, token, hash, encrypted value, raw KYC/evidence, internal key, or provider credential is returned.
- `401` means authentication/MFA/session proof is absent or terminal. `403` means an authenticated actor is denied. `404` may be used by the owner’s non-enumeration policy. `409` means state/idempotency/version conflict. `422` means a validly shaped command violates a domain rule. `423` means a bounded transient lock. `429` is rate limiting. `503` means unavailable prerequisite/service.
- Retryable `YES` means retry only as directed. Critical-write retry reuses the original idempotency key and identical canonical payload. Validation, permission, market, and payload mismatch errors are not blindly retried.
- `CAPABILITY_UNAVAILABLE` carries allowlisted `details.blockedPrerequisite` (for example `GATE-SEC-01`) and optional safe `details.capability`; no internal implementation description.
- Unknown exceptions map to `INTERNAL_ERROR` with a safe message and correlation ID; the internal cause remains server-side.

## 2. Admin authentication

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `ADMIN_AUTHENTICATION_REQUIRED` | 401 | Sign in to continue. | No valid canonical Admin authentication proof. | NO | Security denial event for protected request. | Clear protected state; route to Admin login. | Canonical Auth |
| `ADMIN_NOT_ELIGIBLE` | 403 | This account cannot access Admin. | Account/Admin status, role eligibility, or actor-purpose binding failed. | NO | Security denial with safe eligibility reason. | Show access-denied support path; no operational data. | Auth / Platform Access |
| `ADMIN_ACCOUNT_SUSPENDED` | 403 | Admin access is suspended. | Account or Admin record is suspended/locked. | NO | Denial plus session-revocation evidence. | End session and show suspended state. | Auth / Platform Access |
| `ADMIN_ACCOUNT_ARCHIVED` | 403 | Admin access is unavailable. | Account/Admin is permanently archived. | NO | Denial and archival reference. | End session; no retry control. | Auth / Platform Access |
| `ADMIN_LOGIN_RATE_LIMITED` | 429 | Too many attempts. Try again later. | Login throttle exceeded. | YES | Rate-limit security event without credential data. | Countdown from safe `Retry-After`; preserve email only if policy allows. | Canonical Auth |

## 3. MFA

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `MFA_REQUIRED` | 401 | Complete multi-factor authentication. | Password passed but an approved bound factor challenge is required. | YES | Challenge-issued security event. | Open MFA challenge; never create Admin workspace session. | Auth MFA |
| `MFA_CHALLENGE_FAILED` | 401 | The verification code was not accepted. | TOTP invalid, expired, exhausted, or replayed; detail remains internal. | YES | Failure/replay event with attempt count category. | Keep challenge until safe attempts remain; no secret hints. | Auth MFA |
| `MFA_ENROLLMENT_REQUIRED` | 403 | Set up multi-factor authentication to continue. | Eligible Admin has no active accepted factor. | NO | Enrollment-required event. | Route to no-store enrollment flow; block operations. | Auth MFA |
| `MFA_RECOVERY_INVALID` | 401 | The recovery code was not accepted. | Recovery code invalid, consumed, revoked, or expired. | YES | Recovery failure/abuse signal. | Keep recovery screen with bounded attempts. | Auth MFA |
| `MFA_FACTOR_DISABLED` | 403 | Your multi-factor method is unavailable. | Bound factor disabled/reset/revoked. | NO | Factor lifecycle denial. | Route to approved recovery/support flow. | Auth MFA |
| `MFA_STEP_UP_REQUIRED` | 403 | Verify your identity again to continue. | Sensitive action lacks a fresh action/market/target-bound step-up grant. | YES | Step-up-required event. | Open step-up modal; preserve non-secret command draft. | Auth MFA / owner command |

## 4. Session

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `SESSION_IDLE_EXPIRED` | 401 | Your session expired due to inactivity. | Server 30-minute idle deadline passed. | NO | Idle-expiry security event. | Clear session and require full password+MFA login. | Canonical Auth |
| `SESSION_ABSOLUTE_EXPIRED` | 401 | Your session has expired. Sign in again. | Eight-hour absolute or family maximum deadline passed. | NO | Absolute/family expiry event. | Clear session; full login only. | Canonical Auth |
| `SESSION_REUSE_DETECTED` | 401 | Your session was ended for security. | A rotated refresh token was reused; family revoked. | NO | High-priority reuse and family-revocation event. | Clear all local session material; show security notice. | Canonical Auth |
| `SESSION_REVOKED` | 401 | Your session has been revoked. | Current session/family revoked by self, admin, password/MFA/status action. | NO | Revocation reason category and actor. | Clear session and return to login. | Canonical Auth |
| `SESSION_NOT_FOUND` | 404 | Session not found. | Safe session ID is absent or not visible to actor. | NO | Audit cross-admin lookup denial when applicable. | Refresh bounded session list. | Canonical Auth |
| `SESSION_FAMILY_EXPIRED` | 401 | Your session has expired. Sign in again. | Seven-day refresh-family ceiling passed. | NO | Family-expiry event. | Full password+MFA login. | Canonical Auth |

## 5. RBAC

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `PERMISSION_DENIED` | 403 | You do not have permission for this action. | Required canonical action permission absent. | NO | Denied privileged action with permission code. | Disable action and show permission-denied state. | Platform Access / owner route |
| `ROLE_ASSIGNMENT_CONFLICT` | 409 | This role combination is not allowed. | Six-template exclusivity/mutual-exclusion rule failed. | NO | Denied assignment with safe role codes. | Keep editor open; identify conflicting role labels. | Platform Access |
| `ROLE_TEMPLATE_IMMUTABLE` | 409 | This system role cannot be changed here. | Attempt to ad hoc edit a controlled template. | NO | Audit attempted template mutation. | Offer only authorized template-version workflow. | Platform Access |
| `PERMISSION_CATALOG_MISMATCH` | 503 | This capability is temporarily unavailable. | Route/catalog/seed drift detected fail-closed. | NO | Security/operations event with route/capability reference. | Show blocked capability, not a role workaround. | Platform Access |

## 6. Market access

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `MARKET_ACCESS_DENIED` | 403 | You do not have access to this market. | No active Admin Market Access grant or market inactive. | NO | Market denial with actor/market/request. | Clear stale market context and return to selector. | Platform Access |
| `MARKET_SELECTION_REQUIRED` | 409 | Select an authorized market to continue. | Canonical Admin session has no Current Admin Market. | NO | Context-required event optional; selection itself audited. | Open server-provided market selector. | Admin Market Context |
| `MARKET_CONTEXT_MISMATCH` | 409 | The selected market changed. Refresh and try again. | Route/header/body market differs from session Current Admin Market/context version. | NO | Denied context mismatch. | Refresh bootstrap; never silently switch. | Admin Market Context / guard |
| `RESOURCE_MARKET_MISMATCH` | 403 | This resource is not available in the selected market. | Stored resource market differs from authorized Current Admin Market. | NO | Cross-market denial with non-sensitive resource type. | Return to selected-market list; avoid enumeration detail. | Owner domain + Platform Access |
| `MARKET_INACTIVE` | 409 | This market is not available for operations. | Market status prevents the requested operation. | NO | Denial and market status transition reference. | Show read-only/unavailable state. | Market owner / Platform Access |

## 7. Sensitive data

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `SENSITIVE_VIEW_REASON_REQUIRED` | 422 | Enter a reason to view this information. | Dedicated sensitive projection requires bounded reason/case reference. | NO | Denied view attempt; safe metadata only. | Focus reason field; do not reveal data. | Sensitive Projection / Audit |
| `SENSITIVE_DATA_DENIED` | 403 | You cannot view this sensitive information. | Permission, market, step-up, or projection policy denied access. | NO | Audit every denied sensitive view. | Keep masked projection; no raw fallback. | Sensitive Projection owner |
| `SENSITIVE_FIELD_NOT_AVAILABLE` | 404 | This information is not available. | Field is excluded by deny-by-default allowlist or source lacks it. | NO | Audit only when request itself is privileged. | Display unavailable field, not null-as-proof. | Sensitive Projection owner |
| `SENSITIVE_DATA_EXPORT_PROHIBITED` | 403 | Export of this information is not allowed. | Raw KYC/audit/voucher/ledger/evidence extraction prohibited. | NO | Audit export attempt. | Remove download path; show policy message. | Reports / Sensitive Projection |

## 8. Dashboard

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `DASHBOARD_DATA_UNAVAILABLE` | 503 | This metric is currently unavailable. | Required source failed/blocked; zero must not be fabricated. | YES | Operational telemetry; privileged audit only if sensitive source. | Show Unavailable with `asOf`/retry. | Phase 7 Dashboard Read Model |
| `DASHBOARD_DATA_STALE` | 503 | This metric is out of date. | Queue >60s or aggregate >5m freshness contract failed. | YES | Freshness telemetry. | Show stale badge, last `asOf`, and manual retry. | Phase 7 Dashboard Read Model |
| `DASHBOARD_METRIC_UNDEFINED` | 422 | This metric is not available. | Unknown/unapproved metric definition requested. | NO | Log contract misuse. | Hide metric and keep other tiles. | Phase 7 Dashboard Read Model |
| `DASHBOARD_FILTER_INVALID` | 422 | Check the dashboard filters. | Time/status/filter bounds invalid. | NO | No privileged audit unless sensitive filter. | Highlight invalid filter; do not query broadly. | Phase 7 Dashboard Read Model |

## 9. Member

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `MEMBER_NOT_FOUND` | 404 | Member not found. | Member absent or hidden by market/non-enumeration policy. | NO | Lookup audit only when policy requires. | Return to member search. | Phase 2 Admin Member |
| `MEMBER_STATE_CONFLICT` | 409 | The member status changed. Refresh and try again. | Requested transition invalid for current/expected state. | NO | Denied transition with safe before state. | Refresh detail and actions. | Phase 2 Admin Member |
| `MEMBER_OPERATION_NOT_ALLOWED` | 422 | This member action is not allowed. | Frozen Member rule blocks action. | NO | Privileged denial. | Explain safe rule; no direct edit fallback. | Phase 2 Admin Member |
| `MEMBER_SESSION_REVOCATION_FAILED` | 503 | Sessions could not be revoked. Try again. | Canonical revoke transaction did not commit. | YES | Failed privileged command. | Keep status unchanged; retry same key if supported. | Phase 2 Admin Member / Auth |

## 10. Merchant

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `MERCHANT_NOT_FOUND` | 404 | Merchant not found. | Branch absent or market-hidden. | NO | Lookup audit when sensitive. | Return to selected-market list. | Phase 1 Merchant |
| `MERCHANT_STATE_CONFLICT` | 409 | The merchant status changed. Refresh and try again. | Invalid/stale status transition. | NO | Denied transition audit. | Refresh detail/actions. | Phase 1 Merchant |
| `MERCHANT_PACKAGE_ASSIGNMENT_CONFLICT` | 409 | The package assignment changed. Refresh and try again. | Expected assignment/version/default constraint failed. | NO | Failed assignment audit. | Refresh package history; never auto-migrate. | Phase 1 Package |
| `MERCHANT_ATTRIBUTION_CHANGE_UNAVAILABLE` | 503 | Attribution changes are not available. | OPEN merchant/branch reassignment policy. | NO | Blocked capability event. | Read-only attribution with blocked badge. | Merchant Attribution owner |

## 11. KYC

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `KYC_CASE_NOT_FOUND` | 404 | KYC case not found. | Case absent or not visible in selected market. | NO | Lookup audit if raw evidence requested. | Return to KYC queue. | Phase 1/2 KYC owner |
| `KYC_STATE_CONFLICT` | 409 | This KYC case changed. Refresh and try again. | Decision/state/version stale. | NO | Denied decision audit. | Refresh case, preserve non-sensitive notes. | KYC owner |
| `KYC_EVIDENCE_UNAVAILABLE` | 503 | Review evidence is unavailable. | Evidence storage/scan/retention prerequisite not satisfied. | YES | Failed/blocked evidence-view audit. | Keep case read-only; do not bypass with raw storage. | KYC / Secure Evidence |
| `KYC_RETENTION_POLICY_UNAVAILABLE` | 503 | This retention action is not available. | Market legal retention policy remains OPEN. | NO | Blocked policy action. | Hide delete/archive automation; show prerequisite. | KYC Governance |

## 12. Configuration

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `RATE_OVERLAP` | 409 | This effective period overlaps an existing version. | Database/transaction overlap protection rejected version. | NO | Failed schedule audit with version references. | Show conflicting safe period; edit Draft/new version. | Owning configuration domain |
| `RATE_OUT_OF_RANGE` | 422 | The value is outside the allowed range. | Domain/market rate bounds failed. | NO | Denied privileged change. | Highlight value and display approved unit/bounds. | Owning configuration domain |
| `RATE_PRECISION_INVALID` | 422 | Use the allowed number of decimal places. | Decimal-string precision/scale invalid. | NO | Audit only submitted privileged change. | Keep string input; never coerce through floating point. | Owning configuration domain |
| `EFFECTIVE_TIME_INVALID` | 422 | Choose a valid future effective time. | Period ordering, past/same-day, or market-local midnight rule failed. | NO | Denied schedule with safe local/UTC values. | Show market-local and resolved UTC guidance. | Owning configuration domain |
| `CONFIGURATION_VERSION_IMMUTABLE` | 409 | This version cannot be edited. Create a new version. | Scheduled/active/expired immutable content targeted. | NO | Mutation attempt audit. | Open “create new version” flow. | Owning configuration domain |
| `CONFIGURATION_MARKET_NOT_CONFIGURED` | 503 | Configuration is not available for this market. | Required market-specific initial/bounds/currency/unit absent; no fallback. | NO | Blocked capability event. | Show prerequisite and disable command. | Owning configuration domain |
| `CONFIGURATION_SNAPSHOT_CONFLICT` | 409 | The configuration changed. Refresh and try again. | Expected version or owner snapshot differs. | NO | Failed privileged command. | Refresh current version; do not auto-resubmit changed payload. | Owning configuration domain |

## 13. MCP adjustment

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `MCP_ADJUSTMENT_NOT_FOUND` | 404 | Adjustment request not found. | Request absent or market-hidden. | NO | Sensitive lookup denial when applicable. | Return to MCP queue. | Phase 1 MCP |
| `MCP_ADJUSTMENT_STATE_CONFLICT` | 409 | The adjustment state changed. Refresh and try again. | Transition/expected version invalid. | NO | Denied transition audit. | Refresh request timeline. | Phase 1 MCP |
| `ADJUSTMENT_SOFT_CAP_EXCEEDED` | 422 | This amount requires Super Admin approval and supporting evidence. | Amount above effective soft cap but not hard cap. | NO | Routing/evidence requirement event. | Route to elevated Checker/evidence flow; do not submit to ordinary Checker. | Adjustment Policy / MCP |
| `ADJUSTMENT_HARD_CAP_REJECTED` | 422 | This amount exceeds the allowed limit. | Amount above effective hard cap. | NO | Denied financial request with limit version. | Block submission; require lower/new authorized policy. | Adjustment Policy / MCP |
| `ADJUSTMENT_MAKER_CHECKER_SAME_ACTOR` | 403 | A different authorized person must approve this request. | Server-derived Maker equals Checker. | NO | Mandatory denied decision audit. | Remove approval control for Maker; keep request pending. | MCP/iPoint owner |
| `ADJUSTMENT_ALREADY_DECIDED` | 409 | This request has already been decided. | Competing decision won or request terminal. | NO | Record losing decision attempt. | Show committed decision and timeline. | MCP/iPoint owner |
| `ADJUSTMENT_NOT_APPROVED` | 409 | This request is not approved for execution. | Execution attempted outside Approved/valid retry state. | NO | Denied execution audit. | Refresh state; no execute retry. | MCP/iPoint owner |
| `ADJUSTMENT_EVIDENCE_REQUIRED` | 422 | Add the required supporting evidence. | Attachment/high-risk/Checker-request evidence rule unmet. | NO | Evidence requirement event; no raw content. | Focus secure evidence control; above-soft execution remains disabled. | Adjustment Policy / Secure Evidence |

## 14. iPoint adjustment

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `IPOINT_ADJUSTMENT_NOT_FOUND` | 404 | Adjustment request not found. | Durable iPoint request absent or market-hidden. | NO | Sensitive lookup denial when applicable. | Return to iPoint queue. | Phase 3 Wallet / P7 integration |
| `IPOINT_ADJUSTMENT_BLOCKED` | 503 | Manual iPoint adjustment is not available. | SEC-01 not accepted or required owner integration unavailable. | NO | Gate-block event with `GATE-SEC-01`. | Explicit blocked-prerequisite screen; never call immediate endpoint. | Phase 3 Wallet / P7 integration |
| `IPOINT_WALLET_NOT_FOUND` | 404 | Wallet not found. | Wallet absent or not visible in selected market. | NO | Lookup/denial audit where privileged. | Return to member/wallet search. | Phase 3 Wallet |
| `IPOINT_WALLET_INSUFFICIENT_BALANCE` | 422 | The wallet does not have enough available iPoint. | Debit would violate available-balance invariant. | NO | Denied financial execution. | Keep request unexecuted; show refreshed available balance if permitted. | Phase 3 Wallet |
| `IPOINT_LEDGER_EXECUTION_FAILED` | 503 | The adjustment could not be completed. Try again safely. | Atomic owner ledger/projection/request/audit transaction failed. | YES | Failed execution attempt/correlation. | Retry same execution key/payload; never display success. | Phase 3 Wallet |
| `IPOINT_CORRECTION_LINK_INVALID` | 422 | The correction reference is not valid. | Original Wallet entry/request is incompatible, self-linked, or already corrected. | NO | Denied correction audit. | Require a valid owner entry; no direct balance edit. | Phase 3 Wallet |
| `IPOINT_ADJUSTMENT_STATE_CONFLICT` | 409 | The adjustment state changed. Refresh and try again. | Expected request/version/transition failed. | NO | Denied transition audit. | Refresh request timeline. | Phase 3 Wallet / P7 integration |

## 15. Agent

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `AGENT_OPERATION_UNAVAILABLE` | 503 | Agent operations are not available. | GATE-P5-01 capability not accepted. | NO | Gate-block event. | Read-only safe projection or blocked screen. | Phase 5 Agent |
| `AGENT_ACTIVATION_STATE_CONFLICT` | 409 | The activation state changed. Refresh and try again. | Invalid/stale lifecycle transition. | NO | Denied transition audit. | Refresh activation timeline. | Phase 5 Agent |
| `AGENT_FEE_NOT_CONFIGURED` | 503 | Agent activation is not configured for this market. | No accepted active market/currency fee version; no Malaysia fallback. | NO | Blocked configuration event. | Disable activation and show prerequisite. | Phase 5 Agent Fee |
| `AGENT_POLICY_UNAVAILABLE` | 503 | This agent action is not available. | Course verification/reapplication/inactivity behavior remains OPEN. | NO | Blocked-policy event. | Show existing state only; no invented workflow. | Phase 5 Agent / Governance |

## 16. Commission

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `COMMISSION_OPERATION_UNAVAILABLE` | 503 | Commission operations are not available. | GATE-P5-01 route/market/rate/posting prerequisite blocked. | NO | Gate-block event. | Show safe read-only/blocked state. | Phase 5 Commission |
| `COMMISSION_RATE_CONTRACT_CONFLICT` | 503 | Commission configuration is temporarily unavailable. | Source/generation/unit contract is unreconciled. | NO | Operations/security event. | Disable editor; do not normalize silently. | Phase 5 Commission Rate |
| `COMMISSION_POSTING_FAILED` | 503 | Commission processing could not be completed. | Atomic or durable posting contract reported failure. | YES | Failure event with processing/correlation reference. | Show visible pending/failed status; retry same key only if owner permits. | Phase 5 Commission |
| `COMMISSION_ENTRY_IMMUTABLE` | 409 | This commission entry cannot be changed. | Attempt to mutate original Ledger row instead of compensation. | NO | Mutation attempt audit. | Offer accepted correction flow only. | Phase 5 Commission Ledger |
| `COMMISSION_COMPENSATION_CONFLICT` | 409 | This correction has already been processed. | D-042 exact-opposite compensation exists or linkage conflicts. | NO | Losing/replay event with safe ledger references. | Show committed compensation; no duplicate. | Phase 5 Commission Compensation |

## 17. Redemption

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `REDEMPTION_NOT_FOUND` | 404 | Redemption record not found. | Order/refund/fulfilment absent or market-hidden. | NO | Privileged lookup audit when applicable. | Return to selected-market queue. | Phase 6 Redemption |
| `REDEMPTION_STATE_CONFLICT` | 409 | The redemption state changed. Refresh and try again. | Owner transition/expected version invalid. | NO | Denied transition audit. | Refresh timeline/actions. | Phase 6 Redemption |
| `REDEMPTION_REFUND_BLOCKED` | 503 | Refund approval is temporarily unavailable. | SEC-02 hard gate: exact wallet ledger/projection/atomicity acceptance missing. | NO | Gate-block event with `GATE-SEC-02`. | Permit safe read-only status only; hide approval command. | Phase 6 Redemption Refund |
| `REDEMPTION_REFUND_ALREADY_DECIDED` | 409 | This refund request has already been decided. | Competing Checker or terminal state. | NO | Losing decision audit. | Display committed outcome. | Phase 6 Redemption Refund |
| `REDEMPTION_REFUND_LEDGER_CONFLICT` | 409 | The refund could not be linked safely. | Debit/refund Wallet linkage or exact-opposite invariant failed. | NO | Critical financial failure audit. | Keep approval incomplete/failed; no DB workaround. | Phase 6 Redemption + Phase 3 Wallet |
| `REDEMPTION_RATE_NOT_CONFIGURED` | 503 | Redemption is not configured for this market. | No approved active market rate/bounds/currency/unit. | NO | Blocked configuration event. | Disable quote/config action as appropriate. | Phase 6 Redemption Rate |
| `REDEMPTION_VOUCHER_REVEAL_DENIED` | 403 | Voucher details cannot be shown. | Permission, market, step-up, reason, or no-store policy denied reveal. | NO | One audit event for each reveal/denial, no voucher material. | Keep voucher masked; never cache. | Phase 6 Voucher / Sensitive Projection |

## 18. Audit Viewer

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `AUDIT_VIEW_DENIED` | 403 | You cannot view these audit records. | Permission/market/projection policy denied query. | NO | Audit the denied audit-view attempt. | Keep results empty; no raw fallback. | Phase 7 Audit Viewer |
| `AUDIT_VIEW_REASON_REQUIRED` | 422 | Enter a reason to view these records. | Sensitive audit detail requires reason. | NO | Denied view event with safe filter hash. | Focus reason input. | Phase 7 Audit Viewer |
| `AUDIT_FILTER_INVALID` | 422 | Check the audit filters. | Filter bounds, cursor, time range, or allowlist invalid. | NO | Audit only privileged/suspicious attempts. | Highlight filters; do not broaden query. | Phase 7 Audit Viewer |
| `AUDIT_CURSOR_INVALID` | 422 | Refresh the audit results and try again. | Cursor malformed, expired, or mismatched to filter/market. | NO | Operational telemetry. | Restart bounded search from first page. | Phase 7 Audit Viewer |
| `AUDIT_EVENT_WRITE_FAILED` | 503 | The action could not be completed safely. | Required immutable privileged/audit-of-view event did not commit. | YES | Separate security telemetry outside failed transaction. | Show failure; retry same key; never claim action/view success. | Platform Audit / owner command |

## 19. Reports

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `REPORT_FILTER_INVALID` | 422 | Check the report filters. | Date range/status/market/currency bounds invalid. | NO | No audit unless sensitive scope. | Highlight invalid filter. | Phase 7 Reports |
| `REPORT_DATA_UNAVAILABLE` | 503 | This report section is unavailable. | One or more owner projections failed or are blocked. | YES | Source telemetry; audit sensitive access. | Show per-section Unavailable, never zero. | Phase 7 Reports |
| `EXPORT_NOT_ALLOWED` | 403 | Downloads are not available for this report. | MVP excludes CSV/download/client/async export. | NO | Audit attempted restricted export. | Keep on-screen bounded report; no client-generated file. | Phase 7 Reports |
| `REPORT_CROSS_CURRENCY_TOTAL_DENIED` | 422 | Values from different currencies cannot be combined. | Requested cross-market/currency aggregation violates contract. | NO | Denied report action. | Display separate market/currency buckets. | Phase 7 Reports |

## 20. Idempotency

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | A request key is required. | Critical write omitted operation-scoped idempotency key. | NO | Log rejected critical command; no raw key. | Generate one key and submit once. | Shared Idempotency / owner command |
| `IDEMPOTENCY_REPLAY_MISMATCH` | 409 | This request key was already used for different data. | Same key hash with different canonical payload hash. | NO | Security/consistency event with hashed references. | Stop automatic retry; create a new key only for an intentional new command. | Shared Idempotency / owner command |
| `IDEMPOTENCY_RESULT_PENDING` | 409 | This request is still processing. Check again shortly. | Matching key/payload is in flight and no committed result exists. | YES | Operational event only if prolonged. | Poll bounded status or retry same key after backoff. | Shared Idempotency / owner command |

## 21. Concurrency

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `CONCURRENCY_STALE_VERSION` | 409 | This record changed. Refresh and try again. | Expected optimistic version no longer current. | NO | Failed privileged command audit. | Refresh; require user review before new command/key. | Owner domain |
| `CONCURRENCY_LOCKED` | 423 | This record is being updated. Try again shortly. | Bounded lock could not be acquired. | YES | Telemetry; audit only after command claim if applicable. | Back off and retry same key/payload. | Owner domain |
| `CONCURRENCY_RETRY_EXHAUSTED` | 503 | The action could not be completed. Try again. | Bounded serialization/deadlock retries exhausted with no commit. | YES | Failed command/correlation event. | Retry same key after user-visible delay. | Owner domain |

## 22. Feature unavailable

| Code | HTTP status | Safe client message | Internal meaning | Retryable YES/NO | Audit requirement | UI behavior | Owning service |
|---|---:|---|---|---|---|---|---|
| `CAPABILITY_UNAVAILABLE` | 503 | This capability is not available yet. | Gate/open/deferred prerequisite blocks capability; response includes safe `blockedPrerequisite`. | NO | Gate-block event for attempted write/sensitive access. | Show explicit prerequisite and no workaround. | Phase 7 Capability Registry / owner |
| `FEATURE_DEFERRED` | 503 | This feature is not included in the current release. | Explicitly deferred scope such as export/global dashboard/PWA approval. | NO | Audit only privileged attempted use. | Show read-only explanation; no hidden API call. | Phase 7 Capability Registry |
| `OWNER_SERVICE_UNAVAILABLE` | 503 | The service needed for this action is unavailable. | Canonical owner is down/not accepted; adapter cannot synthesize success. | YES | Operational telemetry; failed privileged attempt if command. | Retry safely or display unavailable state. | Phase 7 Adapter / owner service |
| `INTERNAL_ERROR` | 500 | Something went wrong. Use the reference ID if you contact support. | Unexpected server failure; details retained server-side only. | YES | Secure error telemetry with correlation ID and redaction. | Show generic error and bounded retry; never expose internals. | API platform / owner service |

## 23. Ownership and mapping requirements

1. Each registered route maps owner exceptions to exactly one canonical code; controllers do not parse message strings.
2. Owner-specific codes take precedence over generic codes when they reveal no extra sensitive information.
3. Cross-market resources follow the accepted non-enumeration policy; `RESOURCE_MARKET_MISMATCH` may be internally audited while the external response uses an owner-safe `404` where required.
4. UI behavior is driven by `code`, never HTTP status or English message alone. Messages may be localized without changing code semantics.
5. Error details are allowlisted per code. Required safe examples: rate bounds/unit/local time; expected/current version only when non-sensitive; `blockedPrerequisite`; `retryAfterSeconds`; freshness `asOf`; no domain row/internal UUID unless already an approved public reference.
6. Every critical denial/failure records actor, market, target type/public reference, action, result, request/correlation, idempotency hash reference, and safe reason category when applicable.

## 24. Evidence index

- `C:\AI_WORKSPACE\wt-p7-s1d\docs\06-phase-reports\p7-s0\P7-S0_FROZEN_ADMIN_OPERATIONS_CONTRACT.md`
- `C:\AI_WORKSPACE\wt-p7-s1d\docs\06-phase-reports\p7-s0\P7-S0_FINAL_DECISION_REGISTER.md`
- `C:\AI_WORKSPACE\wt-p7-s1d\docs\06-phase-reports\p7-s0\P7-S0_CRITICAL_REMEDIATION_GATE_REGISTER.md`
- `C:\AI_WORKSPACE\wt-p7-s1d\docs\06-phase-reports\p7-s0\P7-S0B_ADMIN_BACKEND_CAPABILITY_INVENTORY.md`
- `C:\AI_WORKSPACE\wt-p7-s1d\docs\06-phase-reports\p7-s0\P7-S0D_GAP_MAKER_CHECKER_AUDIT_SECURITY_ANALYSIS.md`
- `C:\AI_WORKSPACE\wt-p7-s1a\docs\06-phase-reports\p7-s1\P7-S1_FINAL_PHASE_BRIEF.md`
- `C:\AI_WORKSPACE\wt-p7-s1b\docs\06-phase-reports\p7-s1\P7-S1_DOMAIN_OWNERSHIP_AND_API_ARCHITECTURE.md`
- `C:\AI_WORKSPACE\wt-p7-s1b\docs\06-phase-reports\p7-s1\P7-S1_CRITICAL_REMEDIATION_PLAN.md`
- `C:\AI_WORKSPACE\wt-p7-s1c\docs\06-phase-reports\p7-s1\P7-S1_ADMIN_IDENTITY_RBAC_AND_MARKET_ARCHITECTURE.md`
- `C:\AI_WORKSPACE\wt-p7-s1d\packages\database\schema\index.ts`
- `C:\AI_WORKSPACE\wt-p7-s1d\packages\database\schema\redemption.ts`
- `C:\AI_WORKSPACE\wt-p7-s1d\packages\database\migrations\0000_database_foundation.sql` through `0026_phase_6_shipping_recovery_v2.sql`

## 25. Authorization boundary

This register is a proposed Phase 7 contract for Command Center review. No code may rely on it until separately accepted and authorized. D-046 remains the controlling frozen authority.
