# TASK_BRIEF_P8S9_L06 - Bounded Implementation of the L-06 Member QR Surface

> Phase 8 - L-06 closure task (P8-S9 gate input) - Execution branch `fix/p8-l06-member-qr` (based on `phase/8-final-delivery-readiness` HEAD)
> Authorization: **D-080 (2026-08-11, Bryan)** - Option A bounded implementation; D-079 (OpenClaw succeeds Command Center, revocable); D-058 (Phase 8); D-060 (alternate executor; Codex CLI preferred per D-058)
> Contract: `docs/06-phase-reports/p2-s1/PHASE_2_API_CONTRACT.md` §4.4 + route table (frozen)
> Executor: **Codex CLI (A)** - independent review: **Reviewer B'** - integration gate + gate record: OpenClaw
> Risk class: **HIGH (LOCKED-rule closure at final gate)** -> A->B->C; OpenClaw does not write production code

---

## 1. Mission

Close the **L-06 gap** (OBS-07/D-074): implement the frozen Phase 2 API contract surface `GET/POST/DELETE /members/me/qr` that the LOCKED rule L-06 (BASELINE_ACKNOWLEDGMENT_V1.1: "Member universal QR with short-lived rotating signed security token (not permanent static QR)") mandates but which the API does not currently expose. The database table `member_qr_identities` **already exists** (migration 0007, Phase 2) - **this task is an API-layer-only implementation. NO migration. NO schema change.**

Outcome: P8-S9 gate row G-30 closes GREEN for the QR item; the final gate (P8-S9) then executes on this integrated state.

## 2. Frozen contract (do not deviate)

Route table (PHASE_2_API_CONTRACT.md §route table, verbatim):

| Method | Path | Auth | Guard | Query | Body | Response | Errors | Idempotent? | Audited? | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/members/me/qr` | Authenticated member | Ownership only | N/A | none | `MemberQrResponse` | `MEMBER_NOT_FOUND`, `QR_REVOKED`, `MEMBER_CLOSED` | No | Yes | Never expose raw sensitive token material |
| POST | `/members/me/qr` | Authenticated member | Ownership only | N/A | `RotateMemberQrRequest` | `MemberQrResponse` | `QR_ACTIVE_EXISTS`, `QR_REVOKED`, `MEMBER_CLOSED` | Required | Yes | Return only signed view token or display payload |
| DELETE | `/members/me/qr` | Authenticated member | Ownership only | N/A | `RevokeMemberQrRequest` | 204 | `QR_NOT_FOUND`, `MEMBER_CLOSED` | Required | Yes | No raw token in errors |

`MemberQrResponse` (§4.4) returns: QR public ID, status, issued and expiry timestamps, display token or signed payload suitable for rendering. Public QR payload must NOT include internal database IDs, email, phone, or sensitive data. Stored QR material is token hash only; plaintext token is never persisted. NEVER return: internal UUIDs, account email, phone, token secret.

Error code model (§5): `MEMBER_NOT_FOUND`, `MEMBER_CLOSED`, `QR_REVOKED`, `QR_ACTIVE_EXISTS`, `QR_NOT_FOUND`, `STATE_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `VALIDATION_ERROR`. Error responses must not expose implementation details or hidden data.

L-06 semantics (D-14): unified QR with secure token only; token is SHORT-LIVED and ROTATING (not a permanent static QR).

## 3. Existing infrastructure (verified by OpenClaw, 2026-08-11)

- **Table `member_qr_identities`** (migration 0007): columns `id, member_id, public_qr_id, token_hash, status, rotated_from_id, rotated_to_id, issued_at, expires_at, revoked_at, reason, created_at, updated_at`; status enum `('ACTIVE','ROTATED','REVOKED')`; `UNIQUE(public_qr_id)`, `UNIQUE(token_hash)`; CHECK `char_length(token_hash) = 64`; self-FKs `rotated_from_id`/`rotated_to_id`; **partial unique index `member_qr_identities_active_unique ON (member_id) WHERE status = 'ACTIVE'`** (one ACTIVE QR per member - the DB enforces this).
- **No Drizzle mapping exists** for this table (`packages/database/src/**` has only `expected-schema.ts` checksum-validation entry). **Use raw SQL via the existing DatabaseService pattern** (`db.execute` precedent: `apps/api/src/admin-reconciliation-ops/admin-reconciliation-ops.service.ts`, `apps/api/src/admin-agent-ops/*`). **DO NOT touch `packages/database/**`** - checksums 40/40 frozen (P8-S9 Do-Not-Touch; D-080 Affected Files = `apps/api/src/**` only).
- **Token utilities** (`apps/api/src/auth/secret-tokens.ts`): `createOpaqueToken()` = `randomBytes(32).toString('base64url')`; `hashOpaqueToken(token)` = SHA-256 hex (64 chars - exactly matches the CHECK constraint). Reuse these; do not reinvent.
- **Signed token pattern**: HMAC-SHA256 signing with a server secret (see `apps/api/src/auth/admin-mfa.crypto.ts` for the project's HMAC usage pattern). The QR display token must be a SIGNED short-lived payload (L-06: "signed security token"). Secret comes from environment config (CONFIGURABLE - never hard-code; follow existing env-key conventions in the auth module / .env.example). Signed payload must contain only non-sensitive claims (e.g. public_qr_id + issued/expiry + random nonce), never member internal IDs, email, or phone. HMAC verification must not require a DB lookup (self-contained signed payload); status/expiry revocation checks still apply at verification time.
- **Controller pattern**: mirror `apps/api/src/profile/member-self.controller.ts` (AuthGuard + `@CurrentActor()` + ACCOUNT type check + clean 4xx mapping). `GET /members/me` exists there; the QR routes may live in a new `apps/api/src/member-qr/` module or an extension of the member-self surface - implementer's choice, but keep the canonical guard pattern and register the module in `apps/api/src/app.module.ts`.
- **Idempotency**: POST and DELETE require idempotency (no duplicate history rows on replay). Reuse the existing idempotency mechanism used across the codebase (e.g. the `withIdempotency`-style helper referenced in FIX-002/FIX-004 records; check `apps/api/src` for the canonical idempotency util and its error code `IDEMPOTENCY_CONFLICT`).
- **Audit**: all three routes audited per contract. Follow the existing audit-write pattern used by member-facing controllers (search for the audit service usage in `apps/api/src` - e.g. admin-audit-ops or the audit module); record actor, action, QR public ID, before/after status, reason where applicable, and result; no sensitive token material in audit payloads.
- **Rotation semantics**: POST rotates - in ONE transaction: mark current ACTIVE row `status='ROTATED'` (+ `rotated_to_id` -> new row), create new row `status='ACTIVE'` with fresh token hash + new issued_at/expires_at (link `rotated_from_id`). The partial unique index is the DB backstop for the "one ACTIVE per member" invariant. `QR_ACTIVE_EXISTS` is the conflict error for concurrent/duplicate rotate attempts (e.g. two POSTs racing: second sees an ACTIVE already being rotated or the index rejects it) - map DB constraint violations to clean error codes, never expose raw DB errors. DELETE revokes: ACTIVE -> REVOKED (set `revoked_at`, `reason`); `QR_NOT_FOUND` when no QR row exists for the member; `QR_REVOKED` when already revoked. If no row exists at all on GET: return `MEMBER_NOT_FOUND`-family? NO - follow the contract error list literally: GET errors are `MEMBER_NOT_FOUND` / `QR_REVOKED` / `MEMBER_CLOSED`; when the member exists but has no QR row yet, decide the cleanest contract-consistent behavior (e.g. return the response with a `null`/absent QR state rather than an error, OR a documented 404 with a code in the contract list - pick one, document it in the delivery note, keep it consistent across routes).
- **Market isolation**: QR is member-identity-level, not market-scoped (member universal QR). No market header needed. No cross-market behavior.

## 4. Scope boundaries (STRICT)

IN SCOPE (apps/api only):
- New member-QR controller/service/DTOs/errors under `apps/api/src/**`
- Module registration in `apps/api/src/app.module.ts`
- Unit + integration tests (fresh dedicated DB, fail-closed opt-in pattern per P8-S9 brief; `ipoint_p8s9_*` or task-scoped `ipoint_p8l06_*` DB names, never `ipoint_ci`)
- OpenAPI spec updates (baseline 300 paths at S8 close -> +3 = 303)
- api-client additions ONLY if the existing typed client has a member-QR section to extend (append-only style per P8-S5b/S5c precedent); otherwise no client change
- member-web QR page/component ONLY if a minimal display surface is trivial and non-invasive (member-web 311/311 must stay green); otherwise document as follow-up (P9 item) - do NOT expand scope without OpenClaw sign-off

OUT OF SCOPE (PROHIBITED):
- NO migration, NO change to `packages/database/**` (checksums 40/40 frozen)
- NO change to frozen owners (Phase 1 merchant/MCP, Phase 2 member/auth, Phase 3 wallet/reward, Phase 4 transaction, Phase 5 agent/commission, Phase 6 redemption, Phase 7 admin-ops + SEC-01/02 + P6-R2 routes, P8-S1..S4 owners)
- NO change to LOCKED rules, NO new permission codes, NO export surface, NO raw token in any response/log/audit/error
- NO `.npmrc`, NO untracked-baseline additions, NO `git add .`/`-A` (exact-path staging only)
- NO lint/format/TS-strictness config changes; NO deletion of existing tests
- UTF-8 WITHOUT BOM on all committed files; ASCII-safe punctuation in docs (D-061 L-1..L-3 precedent)

## 5. Definition of done (gate-keeper will verify)

1. GET/POST/DELETE `/members/me/qr` implemented per the frozen contract (§2), ownership-only, ACCOUNT-type guarded, clean error mapping, no sensitive material exposed.
2. Signed short-lived rotating token per L-06/D-14; token hash (SHA-256 hex, 64 chars) stored; plaintext NEVER persisted; rotation/revocation in single transactions; partial-unique-index invariant respected; idempotency on POST/DELETE; audit on all three routes.
3. Evidence:
   - `pnpm exec tsc -p tsconfig.build.json --noEmit` (api) green; `pnpm --filter @ipoint/api build` green; lint 0 errors; prettier clean
   - Unit tests green; integration tests green on fresh dedicated DB (fail-closed opt-in; DB name `ipoint_p8l06_*`)
   - `openapi:validate` green at 303 paths (0 duplicate operationId, 0 broken $refs)
   - Zero-owner-bypass re-scan over the changed scope (S5e method) - 0 direct bypass
   - `git diff` shows NO `packages/database/**` change; NO migration/checksum change; `main` untouched
4. Scoped conventional commits (`feat(p8-l06): ...`); exact-path staging; branch `fix/p8-l06-member-qr` pushed; delivery note `docs/06-phase-reports/p8-s9/P8_S9_L06_DELIVERY_NOTE.md` (scope, decisions incl. the no-QR-row GET behavior choice, test results, risks, rollback note).

## 6. Execution sequence (A -> B -> C)

1. **A (Codex CLI)**: implement + test + commit on `fix/p8-l06-member-qr`; push branch; write delivery note.
2. **B' (independent reviewer, D-060 pool)**: review diff + evidence against this brief; verdict APPROVED / CHANGES REQUIRED (0C/0H/0M bar; Lows documented).
3. **C (OpenClaw integration gate)**: host re-verification (typecheck/build/lint/OpenAPI/tests), zero-bypass re-scan, git invariants; then merge `fix/p8-l06-member-qr` -> `phase/8-final-delivery-readiness`; update DECISION_LOG (D-081 closure), PHASE_REGISTRY, EXECUTOR_PROVENANCE_REGISTER.
4. Then dispatch **P8-S9 gate execution** (per TASK_BRIEF_P8S9.md) on the final integrated state.

_Forward-only brief. Do not delete or rewrite. Superseded only by a bounded addendum recorded by OpenClaw._
