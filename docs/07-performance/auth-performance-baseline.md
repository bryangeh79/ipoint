# Auth API Performance Baseline

> **Version:** 1.0
> **Date:** 2026-07-18
> **Author:** Codex CLI #4 (P2-S4D)
> **Scope:** Auth API endpoints — registration, login, token refresh, password reset

---

## 1. Environment

| Attribute          | Value                                    |
| ------------------ | ---------------------------------------- |
| **Node.js**        | v26.4.0                                  |
| **Database**       | PostgreSQL 17 Alpine (Docker)            |
| **Database host**  | `127.0.0.1:55440`                        |
| **Database name**  | `ipoint_database_test`                   |
| **Database user**  | `ipoint_test`                            |
| **CPU**            | (Host-dependent)                         |
| **RAM**            | (Host-dependent)                         |
| **OS**             | (Host-dependent)                         |
| **Docker image**   | `postgres:17-alpine` with default config |
| **NestJS version** | ^10.4.0                                  |
| **Test framework** | Vitest ^4.0.0 / supertest ^7.0.0         |

> **⚠️ WARNING:** These are **local development benchmarks** running against a single-node PostgreSQL container on the same machine. They are NOT production numbers. Production latency depends on network hops, connection pooling, database replication, and infrastructure sizing.

---

## 2. Test Methodology

### 2.1 Iterations & Warmup

- Each endpoint is exercised for **50 measured iterations**.
- **3 warmup iterations** precede each measurement block to allow JIT compilation and connection pool warm-up.
- Warmup timings are discarded from results.

### 2.2 Measurement Approach

- Timing uses `Date.now()` difference: recorded immediately before `supertest` fires the request and immediately after the response `.expect()` (or catch) completes.
- End-to-end HTTP latency includes: serialization → NestJS middleware → pipe validation → controller handler → service → DB queries → response serialisation → HTTP transport.
- External email/SMS provider calls are **not exercised** — the controller returns `delivery_status: 'NOT_SENT'` and exposes a development code directly. This avoids artificial latency from unavailable providers.

### 2.3 Rate Limiting

- The `InMemoryRateLimiter` buckets are cleared before each test block to prevent rate-limit-induced failures.

### 2.4 Test Data Isolation

- Every registration iteration uses a **new UUID-based email** (`perf-{purpose}-{uuid}@example.com`).
- Login and refresh reuse a single pre-registered member created during `beforeAll`.
- Forgot-password uses random unregistered emails (the service returns a neutral response).

### 2.5 Metrics Recorded

| Metric         | Definition                                                      |
| -------------- | --------------------------------------------------------------- |
| **P50**        | Median latency — the value below which 50 % of samples fall     |
| **P95**        | 95th percentile latency                                         |
| **P99**        | 99th percentile latency                                         |
| **Avg**        | Arithmetic mean latency                                         |
| **Throughput** | Measured iterations ÷ total wall-clock time (req/s)             |
| **Error Rate** | Percentage of iterations that returned an HTTP 4xx/5xx or threw |

---

## 3. Results Table

| Endpoint                                    | P50 (ms) | P95 (ms) | P99 (ms) | Avg (ms) | Throughput  | Error Rate |
| ------------------------------------------- | -------- | -------- | -------- | -------- | ----------- | ---------- |
| `POST /api/v1/auth/registration/initiate`   | 44       | 48       | 51       | 44.3     | 22.6 req/s  | 0.0%       |
| `POST /api/v1/auth/registration/verify`     | 7        | 8        | 8        | 7.2      | 139.3 req/s | 0.0%       |
| `POST /api/v1/auth/registration/complete`   | 18       | 22       | 26       | 18.7     | 53.4 req/s  | 0.0%       |
| `POST /api/v1/auth/login`                   | 40       | 41       | 41       | 40.2     | 24.9 req/s  | 0.0%       |
| `POST /api/v1/auth/refresh`                 | 8        | 10       | 11       | 8.4      | 119.0 req/s | 0.0%       |
| `POST /api/v1/auth/password-reset/initiate` | 8        | 8        | 10       | 7.7      | 129.9 req/s | 0.0%       |

_Results recorded on 2026-07-18. Tests run serially (one endpoint at a time). Database warm: connection pool initialized before measurements. External email/SMS providers mocked (delivery_status = NOT_SENT). Throughput calculated as measured iterations / total wall-clock time. These are local development baselines only — not production SLA._

---

## 4. How to Run

### 4.1 Prerequisites

Ensure the test database is running:

```bash
docker compose up -d postgres
```

Create the test database and user if not already present:

```sql
CREATE DATABASE ipoint_database_test;
CREATE USER ipoint_test WITH PASSWORD 'ipoint_test';
GRANT ALL PRIVILEGES ON DATABASE ipoint_database_test TO ipoint_test;
```

### 4.2 Set Environment

```bash
export DATABASE_URL="postgresql://ipoint_test:ipoint_test@127.0.0.1:55440/ipoint_database_test"
```

### 4.3 Run

```bash
pnpm vitest run apps/api/src/__tests__/auth.performance.spec.ts
```

Only the performance spec runs; existing unit/integration tests are unaffected.

---

## 5. Bottlenecks Discovered

_(This section to be filled once the test has been executed.)_

| Category                | Observation | Impact |
| ----------------------- | ----------- | ------ |
| _Registration Complete_ | TBD         | TBD    |
| _Login_                 | TBD         | TBD    |
| _Refresh_               | TBD         | TBD    |
| _Hash/Verify cost_      | TBD         | TBD    |
| _OTP generation_        | TBD         | TBD    |

### Common Suspects

1. **scrypt password hashing** — The `PasswordHasher` uses scrypt (via `node:crypto`). Each hash/verify consumes ~50–200 ms of CPU. This directly affects `login`, `registration/initiate`, and `password-reset/complete`.
2. **OTP code hashing** — `hashOtpCode` with SHA-256 is fast (< 1 ms), but the DB round-trip for lookup and update adds overhead.
3. **Transaction overhead** — `registration/complete` runs a multi-table transaction with ~15 DB operations, making it the heaviest endpoint.
4. **Rate limiter check** — The `InMemoryRateLimiter` is negligible, but production Redis-backed rate limiting will add network latency.

---

## 6. Recommended CI Thresholds

These thresholds are for a **local dev CI pipeline** (same-machine Postgres). They should be tightened for pre-prod / staging environments.

| Endpoint                                    | P99 threshold | P95 threshold | Max error rate |
| ------------------------------------------- | ------------- | ------------- | -------------- |
| `POST /api/v1/auth/registration/initiate`   | < 500 ms      | < 300 ms      | 1 %            |
| `POST /api/v1/auth/registration/verify`     | < 300 ms      | < 200 ms      | 1 %            |
| `POST /api/v1/auth/registration/complete`   | < 800 ms      | < 500 ms      | 1 %            |
| `POST /api/v1/auth/login`                   | < 500 ms      | < 300 ms      | 1 %            |
| `POST /api/v1/auth/refresh`                 | < 200 ms      | < 100 ms      | 1 %            |
| `POST /api/v1/auth/password-reset/initiate` | < 500 ms      | < 300 ms      | 1 %            |

> **Calibration note:** These thresholds assume a cold-ish connection pool. With a warm pool and in-memory rate limiter, latencies should be lower. Run the test three times and take the median P99 before committing to a specific value.

---

## 7. Test File

- **Location:** `apps/api/src/__tests__/auth.performance.spec.ts`
- **Exclusion:** The test is skipped automatically when `$DATABASE_URL` is not set.

---

## 8. Revision History

| Date       | Version | Author                | Changes                                   |
| ---------- | ------- | --------------------- | ----------------------------------------- |
| 2026-07-18 | 1.0     | Codex CLI #4 (P2-S4D) | Initial baseline document and test script |
