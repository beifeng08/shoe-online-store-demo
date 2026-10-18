> ⚠️ **已归档（2026-10-12）。** 这是给已停用的 Aider 会话写的启动提示词。其中的
> `Set-Location -LiteralPath 'F:\shoe-online-store-demo'`、`aider --read AGENTS.md …`
> 与分支 `sql-certificate-and-AI-stock` 均已失效（既无该分支，也无该盘符）。
> 保留仅为历史参考；当前入口是仓库根的 `AGENTS.md`。

# Aider 暂停交接提示词

这是一份给后续 Aider 会话使用的当前交接。当前任务已暂停；除非用户明确恢复，不要继续阶段 C，不要自行寻找并修复新发现的局部问题。

## 正确启动方式

必须在 PowerShell 中先执行下面两行，并等待 Aider 启动：

```powershell
Set-Location -LiteralPath 'F:\shoe-online-store-demo'
aider --no-auto-commits --read AGENTS.md --read README.md --read HANDOVER.md --message-file HANDOVER-CLI-PROMPT.md
```

注意：

- 两行命令必须在 PowerShell 提示符执行，不能先在 `C:\Users\Administrator` 启动 Aider。
- Aider 启动后，`--message-file` 已经把本文作为首条消息传入；不要再把这两行 PowerShell 命令或整段提示词粘贴到 Aider 的 `>` 输入框。
- Aider 的 `>` 输入框只接受任务消息。不要把 `cd ...`、下一条 `aider ...` 或多条命令粘在同一行。
- Aider 应使用正常的文件编辑格式，不要求返回完整文件内容；不要为了满足旧提示词而输出无文件名的代码围栏。
- 如果启动输出显示 `Git repo: none`、read-only 文件不存在或本文找不到，立即退出并从仓库根目录重新启动。

## 当前状态

- 工作区：`F:\shoe-online-store-demo`
- 分支：`sql-certificate-and-AI-stock`
- 当前代码基线：以启动时 `git status --short --branch` 和 `git log -5 --oneline` 的实际输出为准；交接生成前 HEAD 为 `8bb1138`。
- 分支较远端领先 25 个提交；这些提交尚未 push，也未部署。
- 用户已有未跟踪教学文档 `docs/从最小后端到交易闭环-图解教学-2026-09-30.md`，必须保留，不得编辑、删除、暂存或提交。
- 当前目标是暂停，不是继续追求阶段 C 的下一项缺口。

## 已完成的技术实现

以下内容已经在当前代码和提交中完成，接手时先以实际代码复核，不要重复重写：

- Python commerce 作为价格、库存、变体可售状态、订单和支付状态真值；TypeScript 展示目录、客户端和 AI 不提供交易真值。
- 生产 PostgreSQL TLS 要求显式主机名和 `sslmode=verify-full`；生产 `APP_ENV` 门禁、内部 commerce 代理认证、可信代理 IP 和 AI Session/资源边界已经实现。
- AI 预算、请求体、输出、回合、Session、历史和进程内状态均有界；进程内护栏仍只适用于单实例，不能宣称多实例安全。
- 目录停售传播已经覆盖同步、加购、购物车数量修改和创建订单；历史订单、幂等重试、取消和到期释放保持可用。
- TypeScript 展示/AI 五张表使用 `drizzle/sqlite` 与 `drizzle/postgres` 版本化迁移；Python commerce 交易表仍只由 Alembic 管理。
- `ensurePgTables()` 使用同一个 `postgres.js` 事务取得 `pg_advisory_xact_lock`，再读取、执行和登记迁移；失败会回滚并允许重试，避免多实例迁移竞态。
- 新增两个独立 `max=1` PostgreSQL client 的迁移并发集成测试；CI 创建隔离的 `typescript_migrations_test` 数据库。
- `.env.example` 和 README 已记录 `AI_TEST_POSTGRES_MIGRATIONS_URL`。

## 已有验证证据

- TypeScript 全量测试：79 个文件，583 passed，16 skipped。
- `npm run check:coupling`：145 个 production modules、259 条 runtime edges，无循环和边界违规。
- `npm run build`：Next 16.3.4，45 个静态页面成功生成。
- Python：104 passed，1 skipped；ruff、ruff format、mypy、Alembic check 均通过。
- 真实 PostgreSQL 迁移并发测试在本机未执行，因为没有设置 `AI_TEST_POSTGRES_MIGRATIONS_URL`；CI 已配置隔离数据库。不要把本机跳过写成通过。

## 暂停边界

在用户明确说“恢复/继续阶段 C”之前，Aider 不得：

- 修改业务代码、迁移、测试或配置来追逐新发现的问题。
- 执行阶段 C 后续开发、部署、线上操作、push 或远端 PR 操作。
- 删除数据或文件，使用 `git reset`、`git clean`、`git checkout --`，或覆盖用户已有改动。
- 把教学文档、`.env`、数据库、WAL、缓存、日志、虚拟环境或构建产物加入提交。
- 因为本机缺少 PostgreSQL、证书、代理或其他可选环境而伪造成功结果。

如用户只要求查看状态，仅读取实际 Git 状态和文档并报告，不编辑代码。

## 用户明确恢复后的工作流

1. 在仓库根目录读取 `AGENTS.md`、`README.md`、`HANDOVER.md` 和本文，并运行 `git status --short --branch`、`git log -5 --oneline`。
2. 先确认用户指定的唯一目标、受影响边界、当前事实、风险和验证方法；不要把历史报告或旧 SHA 当作当前事实。
3. 只用 `/add` 加入本次小步需要编辑的文件；先做受影响测试，再按风险扩大到 `npm run verify`、`npm run build`、`npm run check:coupling` 及后端门禁。
4. 保持现有 Next.js、Drizzle、FastAPI、Alembic、Pydantic、Zod/解析器和代理边界。客户端不能提交价格、库存、订单状态或支付结果；事务、幂等、所有权和错误合同必须保持完整。
5. 不为局部发现重写目录、支付、AI 或数据库架构；没有容量证据时不引入 Redis、Celery 或微服务。
6. 每步只产生一个范围清楚、可回滚的本地提交。提交前检查 staged diff、`git diff --cached --check` 和未跟踪文件；默认不 push、不部署。

恢复工作后的交付说明必须用中文写明：问题根因、修改文件和技术实现、数据库/配置影响、实际命令与结果、未执行项目及原因、安全/事务/所有权/耦合影响、已知风险、监控和回滚提交。不要只列失败测试，也不要把未验证内容写成已完成。

本交接只描述当前状态和暂停规则；下一次恢复时必须重新读取代码、测试输出和 Git 状态，以实际事实为准。
