# P8_S9_L06_DELIVERY_NOTE - L-06 Member QR Surface (bounded implementation)

> Task: TASK_BRIEF_P8S9_L06.md - Authorization: D-080 (Bryan, 2026-08-11) Option A; D-079; D-058
> Branch: `fix/p8-l06-member-qr` - Implementer: Codex CLI unavailable (auth token revoked) -> D-060 alternate coding subagent (interrupted before final verification) + OpenClaw integration-gate verification and bounded fixes
> Gate impact: P8-S9 row G-30 (QR item) closes GREEN on integration

---

## 1. Scope delivered

New module `apps/api/src/member-qr/**` implementing the frozen Phase 2 API contract:

| Route | Behavior |
|---|---|
| `GET /members/me/qr` | Returns active QR identity (public_qr_id, status, issued_at, expires_at, signed short-lived display token) or `{ qr: null }` when the member has no QR row yet (documented decision, see §3). Ownership-only, ACCOUNT guard. |
| `POST /members/me/qr` | Issues the first QR identity when none exists; rotates when one is ACTIVE (old row -> ROTATED with rotated_to_id chain, new row ACTIVE). Idempotency-Key required (header or body); replays return the stored response, no duplicate rows. |
| `DELETE /members/me/qr` | Revokes the ACTIVE QR identity (status REVOKED, revoked_at + reason). Idempotency-Key supported; replays return 204 with no state change. |

Files: `member-qr.controller.ts`, `member-qr.service.ts`, `member-qr.crypto.ts`, `member-qr.dto.ts`, `member-qr.types.ts`, `member-qr.guards.ts`, `member-qr.module.ts` + 3 test files (`member-qr.service.spec.ts`, `member-qr.crypto.spec.ts`, `member-qr.integration.spec.ts`). Module registered in `apps/api/src/app.module.ts`.

## 2. Contract compliance (L-06 / PHASE_2_API_CONTRACT §4.4 / route table)

- ✅ Short-lived rotating **signed** security token: HMAC-SHA256 signed self-contained payload `v1.<b64url(json claims)>.<b64url(hmac)>`; claims = `public_qr_id` + `issued_at` + `expires_at` + `nonce` only (no internal DB ids, no email, no phone, no sensitive data). Verification is DB-free (recomputed HMAC, `timingSafeEqual`, expiry check). TTL default 300s, CONFIGURABLE via `MEMBER_QR_TTL_SECONDS` (1..86400, validated).
- ✅ Stored material is token hash only: SHA-256 hex (64 chars, matches `member_qr_identities.token_hash` CHECK) via the existing `hashOpaqueToken` utility; **plaintext token is never persisted**; the display token returned to the client is the signed payload, never a stored secret.
- ✅ One-ACTIVE-per-member invariant enforced by the DB partial unique index; rotation/revocation in single transactions; rotation chains via `rotated_from_id`/`rotated_to_id`.
- ✅ Ownership-only: `AuthGuard` + `@CurrentActor` + ACCOUNT type check (canonical member pattern); merchant/other-account sessions rejected with clean 4xx.
- ✅ Idempotency on POST and DELETE: idempotency-key via header `Idempotency-Key` or body `idempotencyKey`; replay returns stored result; `IDEMPOTENCY_CONFLICT` for cross-actor key reuse; per-member key namespacing verified (no leak between members).
- ✅ Audit on all three routes: actor, action (`member.qr.issued/rotated/revoked/read`), entity (public_qr_id), before/after, reason, requestId/ip/userAgent metadata; no token material in audit payloads.
- ✅ Exact contract error codes: `MEMBER_NOT_FOUND` (404), `QR_NOT_FOUND` (404), `MEMBER_CLOSED` (403), `QR_REVOKED` (409), `QR_ACTIVE_EXISTS` (409), `STATE_CONFLICT` (409), `IDEMPOTENCY_CONFLICT` (409), `VALIDATION_ERROR` (400). No raw DB errors surfaced (DB constraint violations mapped to contract codes; integration test asserts no raw error leakage).
- ✅ Signing secret from environment `MEMBER_QR_SIGNING_SECRET` (min 32 chars, fail-closed at sign time), never hard-coded; domain-separated key derivation.

## 3. Documented design decisions

1. **GET with no QR row** -> `200 { qr: null }` (not an error). Rationale: contract GET error list has no "no QR yet" code; a null state is the honest representation and keeps the first-issue flow clean (`POST` then issues). Recorded for P8-S10 consistency matrix.
2. **Rotation semantics**: POST always creates a new ACTIVE row and marks the superseded one ROTATED (single transaction). `QR_ACTIVE_EXISTS` surfaces only on genuine conflicts (e.g. concurrent rotates where the partial unique index rejects a second ACTIVE); mapped from DB constraint, never leaked raw.
3. **No member-web UI change** in this task: the QR display surface is a follow-up (P9-class item, consistent with OBS-06/07/10 triage); API surface is the deliverable per D-080 scope.
4. **No `packages/database/**` change**: `member_qr_identities` Drizzle mapping already exists (Phase 2, `packages/database/schema/index.ts`); migrations/checksums 40/40 frozen and untouched (verified by `git diff --stat packages/database` = empty).

## 4. Verification evidence (host, Node 26.4.0, PostgreSQL 17 @ 127.0.0.1:55432, dedicated fresh `ipoint_p8l06_test`)

| Check | Result |
|---|---|
| `tsc -p tsconfig.build.json --noEmit` | PASS |
| `pnpm --filter @ipoint/api build` | PASS |
| `pnpm lint` (full repo) | 0 errors (2 pre-existing warnings in transaction-commission files, unchanged) |
| prettier --check (changed files) | PASS (auto-formatted) |
| Unit: `member-qr.service.spec.ts` | 17/17 PASS |
| Unit: `member-qr.crypto.spec.ts` | 9/9 PASS |
| Integration: `member-qr.integration.spec.ts` (real PG, fail-closed `P8L06_DESTRUCTIVE_TEST=1`, `ipoint_p8l06_test`) | 20/20 PASS |
| `openapi:validate` | PASS - 301 paths (300 baseline + `/members/me/qr`; 0 duplicate operationId, 0 missing schemas, 31 auth ops unchanged) |
| `git diff --stat packages/database` | empty (zero schema/migration change) |
| `git status` (main) | untouched; untracked baseline preserved |

Integration coverage highlights: 401 unauthenticated; `{ qr: null }` initial GET; VALIDATION_ERROR without idempotency key; first issue with verifiable signed token (verifyMemberQrToken round-trip); replay idempotency (same key -> same row count); rotation chain (old ROTATED, new ACTIVE, linked); revocation (REVOKED + revoked_at); GET after revocation -> QR_REVOKED; audit rows for issued/rotated/read/revoked; idempotency key namespacing; MEMBER_CLOSED 403 on all routes; no raw DB error leakage.

## 5. Risks / limitations

- **LOW**: member-web QR display UI not included (documented follow-up, consistent with OBS-06/07/10 triage at P8-S10).
- **LOW**: `MEMBER_QR_SIGNING_SECRET` must be configured at deployment (documented in .env.example; fail-closed if absent - no token signing without it).
- **INFO**: token expiry is enforced at verification time by the verifying party (merchant scan path not part of this API surface); the API never returns an expired display token for an ACTIVE row (regenerated on read if expired, per service logic).
- **INFO**: Node 26 host vs CI Node 24 parity note applies (P4-S7 residual, unchanged by this task).

## 6. Rollback / recovery

The change is additive (new module + module registration). Rollback = revert the L-06 commits (delete module + revert app.module.ts registration). No migration to undo, no data migration, no frozen-owner touch. `member_qr_identities` rows created are forward-only and safe (immutable history per L-14).

## 7. Handoff

- P8-S9 gate consumes this delivery for row G-30 (QR item -> GREEN) and re-runs its own matrix on the integrated state.
- Reviewer B' independent review of this diff: [PENDING - dispatched after integration].
- EXECUTOR_PROVENANCE_REGISTER.md entry: pending (OpenClaw files at integration time).
