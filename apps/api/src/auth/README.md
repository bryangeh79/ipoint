# Authentication foundation

The `InMemoryRateLimiter` is a development and single-process test baseline only.
It is not a production-safe distributed rate limiter because counters are local to
one Node.js process and disappear on restart.

Before production deployment, bind `AUTH_RATE_LIMITER` to a shared, atomic,
distributed implementation (for example, the project's approved Redis
infrastructure) with an explicit failure policy, key TTLs, monitoring, and tests
covering multiple API replicas. PostgreSQL remains the source of truth for
sessions, OTP state, and security events.

## Phase 7 Admin authentication

Admin authentication reuses the canonical Account password and session engine;
there is no separate Admin credential. An Admin session is issued only when the
Account is active, the non-archived Admin record is active, a controlled active
role is assigned, and an app-based TOTP challenge succeeds. Ordinary email OTP
is not an Admin MFA factor.

TOTP secrets are encrypted with AES-256-GCM using an Auth-domain-separated key
derived from `AUTH_OTP_PEPPER`. Ciphertext is authenticated against the Account,
Admin, and factor IDs. Ten recovery codes are shown once after enrollment and
stored only as salted scrypt hashes; each code is consumed atomically. Factor
secrets and recovery material must never be logged, audited, exported, or
returned after their one-time enrollment response.

Admin MFA endpoints are under `/api/v1/auth/admin`. They cover enrollment,
login challenge/recovery, step-up, and assisted reset. Step-up grants are
server-side, single-use, action/market/target-bound, and expire within ten
minutes without outliving the canonical session. Assisted reset requires the
dedicated `admin.mfa.reset` permission, a fresh step-up grant, a reason/case,
and two distinct active Super Admin identities; it revokes the target factor,
recovery codes, step-up grants, and Admin sessions.

Admin session endpoints are under `/api/v1/admin/sessions`. Server policy is a
30-minute idle timeout, eight-hour absolute duration, and seven-day refresh
family ceiling. Refresh rotation preserves the original family boundaries;
reuse revokes the family. Only requests explicitly marked with
`x-ipoint-user-activity: foreground` can coalesce an activity update. Client
timers and background polling are not security controls. Password reset revokes
all Account sessions; Admin suspension, archival, last-role removal, and MFA
reset revoke Admin-purpose sessions, with revocation enforced on the next
request.

The Phase 7 permission catalog/seeds remain owned by P7-S2C. This module exposes
the step-up and permission plumbing but does not add or modify RBAC seeds.
