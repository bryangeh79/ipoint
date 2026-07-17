# BATCH A COMPLETION EVIDENCE

## 1. Summary

Phase 1 Batch A 的 P1-S2、P1-S3 与 P1-S4 已在授权范围内完成并集成到 `phase/1-merchant-onboarding-mcp`。P1-S4 提供 Merchant KYC 私有文件元数据、mock 存储契约、提交/重提不可变快照、后台审核状态机、市场隔离、RBAC、敏感字段遮罩、审计日志与实体时间线。未合并 `main`，未执行 force push、stash、clean 或历史改写。

## 2. Phase Branch

- Branch: `phase/1-merchant-onboarding-mcp`
- Integration remote SHA: `2ff37a6f1f333288e14aa7d900614fdc496d8975`
- Governance commit SHA: `aff4a8fff7dd244ce3173f65334a5b3ac2919cf0`
- Authorization: D-010 / Phase 1 IMPLEMENTATION AUTHORIZED

## 3. P1-S2

- Commit: `e8870a92`
- Schema evidence: `packages/database/schema/index.ts` merchant section

## 4. P1-S3

- Commits: `d40c4250`, `a5cc85f9`
- Files: `apps/api/src/merchant/`

## 5. P1-S4

- Task branch: `task/p1-s4-merchant-kyc-review-v2`
- Task branch implementation remote SHA: `6ddc79b692164b7dc87bd7c10b8b19bc7ba6c54a`
- Original protection commit SHA: `7072d99c1a7513aa28ab7b06c4ea3d5ae3bd184c`
- Rebuilt-branch cherry-pick SHA: `9ff4d2a082bd2818836b8606a6635862f3bdba00`
- Completion commit SHA: `6ddc79b692164b7dc87bd7c10b8b19bc7ba6c54a`
- Phase integration commit SHA: `2ff37a6f1f333288e14aa7d900614fdc496d8975`

### Merchant KYC files

- `apps/api/src/merchant/dto/kyc.dto.ts`
- `apps/api/src/merchant/kyc-masking.ts`
- `apps/api/src/merchant/kyc-storage.adapter.ts`
- `apps/api/src/merchant/merchant.controller.ts`
- `apps/api/src/merchant/merchant.errors.ts`
- `apps/api/src/merchant/merchant.module.ts`
- `apps/api/src/merchant/merchant.service.ts`
- `apps/api/src/merchant/__tests__/kyc-masking.spec.ts`
- `apps/api/src/merchant/__tests__/kyc-storage.adapter.spec.ts`
- `apps/api/src/merchant/__tests__/merchant.integration.spec.ts`
- `apps/api/src/merchant/__tests__/merchant.service.spec.ts`
- `apps/api/src/merchant/__tests__/merchant-ownership.guard.spec.ts`
- `apps/api/src/merchant/guards/merchant-ownership.guard.ts`

## 6. What Was Implemented

- Business registration certificate、responsible-person identity document 与 supporting document 私有元数据。
- 开发/测试专用 storage adapter；只返回 mock upload intent、私有 `storage_key` 与短期过期契约，不上传真实二进制、不生成公开 URL。
- MIME、15 MB 文件上限、SHA-256 格式验证。
- KYC submit/resubmit append-only snapshots；数据库触发器拒绝 submission/review update 和 delete。
- Admin review queue 与 `UNDER_REVIEW`、`APPROVED`、`REJECTED`、`RESUBMISSION_REQUIRED` 状态转换及审核原因。
- RBAC、MarketAccess、merchant ownership 与 wrong-market denial。
- `identity_number`、`tax_id`、`phone` 等敏感字段遮罩。
- KYC 提交及审核的 AuditLog 和 EntityTimeline 记录。
- O-07 治理规则锁定：special service fee `> 0%` 且 `<= 100%`。

## 7. Product / Business Value

Merchant 可在不公开证件资料的前提下完成可追踪的 KYC 提交和补件；后台可按市场安全审核，并保留完整版本、理由和审计证据，为后续商户启用提供可信合规门槛。

## 8. Complexity / Maintenance Risk

- 风险等级：中低。
- 存储通过 adapter 隔离；本阶段没有云端凭证和真实上传副作用。
- 快照及审核记录不可变，降低历史覆盖和审计争议风险。
- 真实对象存储签名、恶意文件扫描及生产保留策略仍需后续已授权阶段设计。

## 9. Changed Files

Complete feature diff from governance base `aff4a8ff..6ddc79b6`:

- `apps/api/src/__tests__/app.e2e.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/app.setup.ts`
- `apps/api/src/common/filters/all-exceptions.filter.ts`
- `apps/api/src/merchant/__tests__/kyc-masking.spec.ts`
- `apps/api/src/merchant/__tests__/kyc-storage.adapter.spec.ts`
- `apps/api/src/merchant/__tests__/merchant-ownership.guard.spec.ts`
- `apps/api/src/merchant/__tests__/merchant.integration.spec.ts`
- `apps/api/src/merchant/__tests__/merchant.service.spec.ts`
- `apps/api/src/merchant/dto/application.dto.ts`
- `apps/api/src/merchant/dto/kyc.dto.ts`
- `apps/api/src/merchant/dto/profile.dto.ts`
- `apps/api/src/merchant/dto/registration.dto.ts`
- `apps/api/src/merchant/guards/merchant-ownership.guard.ts`
- `apps/api/src/merchant/kyc-masking.ts`
- `apps/api/src/merchant/kyc-storage.adapter.ts`
- `apps/api/src/merchant/merchant.controller.ts`
- `apps/api/src/merchant/merchant.errors.ts`
- `apps/api/src/merchant/merchant.module.ts`
- `apps/api/src/merchant/merchant.service.ts`
- `apps/api/src/platform-access/audit.service.ts`
- `docs/06-phase-reports/p1-s1/PHASE_1_ACCEPTANCE_PLAN.md`
- `docs/06-phase-reports/p1-s1/PHASE_1_API_AND_PERMISSION_MATRIX.md`
- `docs/06-phase-reports/p1-s1/PHASE_1_DEFERRED_ITEMS.md`
- `docs/06-phase-reports/p1-s1/PHASE_1_ERD_PROPOSAL.md`
- `docs/06-phase-reports/p1-s1/PHASE_1_SCOPE_MATRIX.md`
- `docs/06-phase-reports/p1-s1/PHASE_1_STATE_MACHINES.md`
- `eslint.config.mjs`
- `packages/database/migrations/0003_merchant_api_support.sql`
- `packages/database/migrations/checksums.json`
- `packages/database/schema/index.ts`
- `packages/database/seeds/foundation.ts`
- `packages/database/src/expected-schema.ts`
- `packages/database/tests/database.integration.test.ts`
- `scripts/p1-s4-task.md`

## 10. Migration / Checksum

- Migration file: `packages/database/migrations/0003_merchant_api_support.sql`
- Checksum: `f2be7be7efbdd616b1e3f77e2d76d2909d81d3869f6720fbe1278f487fa96efc`
- P1-S4 reused the authorized Phase 1 schema and P1-S3 support migration; no unrelated persistence technology was introduced.

## 11. Verification Results

- `pnpm format:check`: PASS
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm build`: PASS
- `pnpm test`: PASS (20 files, 104 tests)
- `pnpm test:api`: PASS (15 files, 73 tests)
- `pnpm test:database`: PASS (2 files, 20 tests)
- KYC masking/storage tests: PASS (2 files, 3 tests)
- KYC submit/resubmit history: PASS
- Wrong-market denial: PASS
- Unauthorized private-document read denial: PASS
- Immutable snapshot update/delete rejection: PASS
- `pnpm db:migrate`: PASS
- `pnpm db:seed` first run: PASS
- `pnpm db:seed` second run/idempotency: PASS
- `pnpm db:drift`: PASS
- `pnpm db:checksum`: PASS (4 migration checksums)
- Secret scan: PASS

Database gates ran against isolated local ports PostgreSQL `55432` and Redis `56379` because the shared host defaults were occupied. No production credentials or external side effects were used.

## 12. Results

- P1-S4 acceptance scope is implemented and all requested gates pass.
- Task branch and Phase branch were pushed to `origin`.
- Phase integration used `--no-ff`; `main` remains untouched.
- Governance remains accurate: P1-S4 is implementation-complete evidence awaiting Command Center acceptance; P1-S5+ remains NOT_AUTHORIZED.

## 13. Repair Loops

- Count: 6 total across gates; no gate exceeded the maximum of 3.
- Format (1): normalized inherited UTF-16LE tracked files to UTF-8, applied Prettier, refreshed the migration checksum manifest.
- Lint (1): corrected matcher typing and configured Node globals for repository JS/MJS tooling.
- API/KYC (3): disabled Swagger route scanning only in the Vitest harness, made controller injection explicit for test metadata behavior, corrected OTP fixture usage, then completed the final endpoint assertions.
- Database (1): aligned expected column order with ALTER TABLE behavior and updated the expected permission seed count.

## 14. Scope Leakage

- P1-S5 code: NONE
- Public KYC URLs: NONE
- Database binary storage: NONE
- Production cloud credentials: NONE
- Receipt/transaction/QR/MCP deduction/reward/commission/advertising: NONE
- Main merge: NONE
- Force push: NONE
- Stash/clean: NONE
- Amend pushed history: NONE

## 15. Known Issues / Limitations

- Storage adapter is intentionally mock/development-only; no real binary upload or cloud-signed URL exists.
- Malware scanning, production object retention, encryption-key operations and provider callbacks are deferred.
- Unrelated pre-existing working-tree items under `.acceptance`, `.local`, `memory/2026-07-16.md` and Codex scratch files were deliberately left unchanged and untracked from this delivery.

## 16. Anything Deferred

- P1-S5 and later Phase 1 scopes remain NOT_AUTHORIZED.
- Real object storage, production document-read signing and external provider integration are deferred pending explicit authorization.
- Phase completion status is not declared; acceptance remains with ChatGPT Command Center under repository governance.

## 17. Next Recommended Step

ChatGPT Command Center should review this report and the P1-S4 test evidence, issue an acceptance decision, and only then authorize any P1-S5 work.

## 18. Open Blockers

- NONE for P1-S4 implementation and integration.
