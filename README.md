# iPoint

iPoint 是面向会员、商家与平台运营团队的多市场消费回馈 SaaS 平台。本仓库采用
pnpm TypeScript monorepo、React/Vite Web 应用、NestJS API、PostgreSQL 17、Redis 7
及 Drizzle ORM。Phase 0 仅建立工程、数据、访问控制和设计系统基础，不包含会员、
商家、钱包、MCP、iPoint 或佣金业务页面。

## 环境要求

- Node.js 24 LTS
- pnpm 9.15.9（以根目录 `packageManager` 为准）
- Docker Desktop / Docker Engine + Compose v2

## 本地启动

1. 创建本地环境文件：

   ```powershell
   Copy-Item .env.example .env
   ```

2. 启动 PostgreSQL 与 Redis：

   ```powershell
   docker compose up -d
   docker compose ps
   ```

3. 安装依赖并建立数据库：

   ```powershell
   pnpm install --frozen-lockfile
   pnpm db:checksum
   pnpm db:migrate
   pnpm db:seed
   pnpm db:drift
   ```

4. 启动 Web 与 API 开发服务：

   ```powershell
   pnpm dev
   ```

`.env.example` 只包含本地占位值。不要提交 `.env`、生产凭据、令牌或真实支付/
消息服务配置。Compose 端口默认只绑定 `127.0.0.1`，其密码不适用于共享或生产环境。

## 常用命令

| 命令                 | 用途                                                     |
| -------------------- | -------------------------------------------------------- |
| `pnpm dev`           | 并行启动所有应用开发服务                                 |
| `pnpm build`         | 构建全部可构建 workspace                                 |
| `pnpm format:check`  | 检查 Prettier 格式                                       |
| `pnpm lint`          | 执行 ESLint                                              |
| `pnpm typecheck`     | 执行全部 TypeScript 类型检查                             |
| `pnpm test`          | 执行单元/组件测试；有 `DATABASE_URL` 时也执行集成测试    |
| `pnpm test:api`      | 执行 API 单元与数据库集成测试                            |
| `pnpm test:database` | 执行数据库单元与集成测试                                 |
| `pnpm test:e2e`      | 构建并以 Playwright 验证 Member shell                    |
| `pnpm db:migrate`    | 从当前版本向前执行显式 SQL migration                     |
| `pnpm db:seed`       | 执行可重复的 foundation seed                             |
| `pnpm db:checksum`   | 验证 migration 文件不可变 checksum                       |
| `pnpm db:drift`      | 比对 live schema 与预期 schema                           |
| `pnpm ci:verify`     | 执行完整本地 CI 门禁（需要数据库与 Playwright Chromium） |

首次执行 E2E 前安装 Chromium：

```powershell
pnpm exec playwright install chromium
```

## CI

`.github/workflows/ci.yml` 使用 Node 24、pnpm frozen install 与依赖缓存，运行以下
required jobs：

- `quality`：format、lint、typecheck、build
- `unit-tests`：无外部服务的单元与组件测试
- `database-tests`：全新 PostgreSQL、migration、双次 seed、checksum、drift、集成测试
- `api-tests`：PostgreSQL 上的 API 单元与集成测试
- `e2e`：Chromium 上的响应式 Member shell smoke test

Phase 0 CI 不读取 repository secrets，也没有 `continue-on-error`。CI 数据库凭据仅是
隔离 runner 内的临时测试值。

## 设计系统

- `packages/design-tokens`：官方 iPoint tokens 的 TypeScript 与 CSS variables
- `packages/ui`：Member、Merchant、Admin 共用的 WCAG 2.1 AA 组件基础
- 默认 light theme；`data-theme="dark"` 仅提供未来扩展点

详见 `docs/03-architecture/ADR-007_DESIGN_SYSTEM_FOUNDATION.md`。
