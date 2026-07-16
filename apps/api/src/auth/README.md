# Authentication foundation

The `InMemoryRateLimiter` is a development and single-process test baseline only.
It is not a production-safe distributed rate limiter because counters are local to
one Node.js process and disappear on restart.

Before production deployment, bind `AUTH_RATE_LIMITER` to a shared, atomic,
distributed implementation (for example, the project's approved Redis
infrastructure) with an explicit failure policy, key TTLs, monitoring, and tests
covering multiple API replicas. PostgreSQL remains the source of truth for
sessions, OTP state, and security events.
