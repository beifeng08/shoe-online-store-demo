> ⚠️ **已归档（2026-10-12）。** 本文描述的分支与路径已不存在：本地没有
> `sql-certificate-and-AI-stock` 分支，文中的 `F:\shoe-online-store-demo` 是 Windows 盘符。
> 本文要求保留的未跟踪教学文档 `docs/从最小后端到交易闭环-图解教学-2026-09-30.md`
> 经核验**已不存在**。当前有效状态请看 `AGENTS.md`、`docs/agents/`、`docs/implementation-report.md`；
> **不要按本文的「当前状态」章节行动。**

# 新 Agent 工作交接 — Evoloop

> **提交与合并授权更新：2026-10-05。** 用户已明确要求主动发起合并和提交；下方检查点的“不提交、不 push”仅描述此前状态。本次提交仅包含已验收的 14 个文件，保留用户 `.gitignore` 与未跟踪教学文档。远端已核实存在上游 `WhatDamon/shoe-online-store-demo` 草稿 PR #14（`beifeng08:sql-certificate-and-AI-stock` → `main`）；提交前本地还有 26 个历史提交未推送。远端更新范围与关联自动部署副作用需明确后再推进，不强推、不部署、不操作业务数据库。局部测试通过不等于全仓阶段 C 或生产验收完成。

> **续做验收：2026-10-05，仍基于 `f8e0964`，未提交。** 显式 UTC-8 `now` 的 SQLite expiry 漏选已独立复现，SQL 前复用 `as_utc`；回归覆盖 UTC-8/UTC/UTC+8/naive、截止前无写锁、精确截止释放一次及重复扫描。旧 AI smoke 的 `delta != error` 已复现，脚本改为签名 Cookie 合同；最新生产构建两个隔离 Mock 实例共 17 次 HTTP、229 条断言通过，包含第三回合 `turns` 拒绝。路由测试另验证实际 AI 入参为 Cookie UUID、不是完整签名串。最终 verify 593 passed/16 skipped；Python 109 passed/1 skipped；Ruff/format/mypy/compileall、全新 SQLite Alembic、45/45 构建通过。测试目录保留，临时服务全部停止，用户 `.gitignore` 与教学文档哈希保持一致。无新 schema/依赖/配置项；PG/TLS、浏览器 HTTPS、远端 CI、部署与其余阶段 C 审查仍待验收，不提交、不 push、不部署。下方较早检查点的两个候选已在本段关闭。

> **本轮局部可靠性修复：2026-10-05，基于 `f8e0964`，未提交。** AI/commerce 共用逐块校验的 16 KiB 请求读取器，超限立即取消、不继续整流缓冲；生产购物 Cookie 强制 Secure。Python 购物车缺库存行不再被内连接隐藏：保留 unavailable 行并拒绝部分结账，避免整车清空。先失败回归后修复；verify 593 passed/16 skipped，Python 105 passed/1 skipped，静态质量、45/45 构建、隔离 Alembic 和真实回环双服务 HTTP 闭环通过。详情及限制见 [更新后的请求边界报告](../ai-request-boundary-2026-10-03.md)。本轮 PG/TLS、远端 CI、浏览器 HTTPS 和正式部署未验收；测试使用全新数据库、已停止服务，业务库与用户已有文件保留。待续：非 UTC 显式 now 的 SQLite expiry 候选、过时 AI smoke 断言、其余阶段 C 全仓审查；不提交、不 push、不部署。

> **目录停售传播：2026-10-03，F:/shoe-online-store-demo，基于 `54c6fa7`。** 阶段 C 新增商品/变体 `is_active` 与 Alembic 迁移 `c73a28f06b19`；显式 `app.sync_catalog` 默认只读预览，应用必须匹配计划版本，缺失身份停用但不删除，恢复必须显式 `--restore-present`。加购、数量修改和创建订单从 Python 重读可售状态；已有购物车显示停售并允许移除，历史订单、幂等重试、取消和到期释放保持可用。同步不导入价格、不调整库存、不改订单。前端 verify/build、双数据库回归、CLI 与迁移保护证据见 [停售传播报告](../catalog-availability-2026-10-03.md)。新增商品、改名迁移、自动持续同步和正式部署仍按后续独立步骤处理。

> **生产配置门禁：2026-10-03。** 新增 `npm run preflight -- -Environment production`，要求显式 `APP_ENV=production`，并在构建/启动前检查 PostgreSQL + TLS 验证、32 字节 AI Session 签名材料、非回环 Python 内部地址和 Shopify 默认关闭；输出不包含连接串、密钥或证书内容。Pester 回归覆盖缺失/错误/正确 `APP_ENV` 及其他不安全组合。该脚本是配置门禁，不证明真实证书、代理、域名或部署已上线。

> **TypeScript 数据库迁移：2026-10-03。** 展示/AI 五张表已从 `src/db/client.ts` 内联 DDL 收敛为 `drizzle/sqlite` 与 `drizzle/postgres` 双方言版本化迁移。运行时仍自动应用空库迁移，初始 SQL 使用 `IF NOT EXISTS` 接管旧 DDL 创建的表并保留数据；`next.config.ts` 已把迁移 SQL 加入生产文件追踪。Python commerce 仍只使用 Alembic。实现与边界见 [ADR 0007](../adr/0007-versioned-typescript-migrations.md) 和 [迁移报告](../typescript-migrations-2026-10-03.md)。

> **PostgreSQL 迁移并发：2026-10-03。** `ensurePgTables()` 改为在同一 `postgres.js` 事务内取得 `pg_advisory_xact_lock`，再读取/执行/登记迁移，避免 Drizzle 默认实现把读取放在事务外造成多实例竞态；失败由事务回滚并允许下一次重试。新增两个独立 `max=1` client 的真实集成测试，CI 会在隔离 `typescript_migrations_test` 数据库中运行；本机未配置 `AI_TEST_POSTGRES_MIGRATIONS_URL`，所以本地仅有 fake-client 证据。

> **AI 请求边界与追踪：2026-10-03。** `/api/ai/chat` 现在在创建 Session 前限制请求体 16 KiB，严格校验 mode/text/product/footMm，拒绝 malformed JSON、未知字段、超长输入和超范围脚长；无效请求返回 422，不调用 chat、不消耗预算。每个响应使用服务端 UUIDv4 `X-Request-ID`，可信代理转发 IP 进入限流前限制为 128 字符，非法或超长值回退到可信直接 peer；没有可用 peer 时使用有界 `untrusted` 桶。AI 拒绝、provider 失败、预算结算和流清理日志使用安全 JSON 字段与耗时，不记录 Session、正文、Cookie、Token 或内部异常。证据见 [AI 请求边界报告](../ai-request-boundary-2026-10-03.md)。

> **Python 交易库 TLS 边界：2026-10-03。** `backend` 新增 `APP_ENV`；生产进程创建 SQLAlchemy 引擎前必须使用带显式主机名的 PostgreSQL URL 且明确 `sslmode=verify-full`，SQLite、无主机、缺失验证、重复模式、`require` 和 `verify-ca` 均 fail closed。`NODE_ENV=production` 时，`.env` 不能把 `APP_ENV` 降级为 development；开发/测试仍可使用本地 SQLite 或专用 `_test` PostgreSQL。部署必须显式设置 `APP_ENV=production`。证据见 [Python PostgreSQL TLS 边界报告](../python-postgres-tls-2026-10-03.md)。

> **内部代理认证：2026-10-03。** Next → Python 的服务端代理新增 `COMMERCE_PROXY_SECRET` 与 `X-Internal-Proxy-Secret`；生产要求至少 32 字节，Python `/api/v1/*` 对缺失/错误凭证在数据库操作前拒绝，客户端伪造 Header 不会被转发。开发空密钥保持本地兼容；证据见 [内部代理认证报告](../commerce-proxy-auth-2026-10-03.md)。

> **AI 配置资源上限：2026-10-03。** `AI_MAX_MESSAGE_CHARS`、`AI_MAX_OUTPUT_TOKENS`、`AI_MAX_TURNS`、`AI_REQUEST_TIMEOUT_MS` 和 `AI_DAILY_TOKEN_CAP` 现在通过 `envIntMax` 应用硬上限；超大环境值会被截断，空值/非法值仍回退默认，不改变原子预算、Session 或多实例范围。证据见 [AI 配置边界报告](../ai-config-boundaries-2026-10-03.md)。

> **远端 CI 提交链核对：2026-10-02。** GitHub Actions 最新远端 SHA `cf40bc2`（其父提交 `14f0f75`）仍基于 `dd76ad8`，两个 Node 矩阵均在 TypeScript 阶段找不到 `@/components/shop/commerce-panel`；后续本地 `4177ec5` 已补齐组件，当前 HEAD 的 `npm run verify` 与 `npm run build` 已通过。此次本地合并保留远端 cleanup 删除的构建产物和数据库文件，不 push、不部署。远端失败不是 Node 22/24 测试行为差异，而是 CI checkout 的提交没有包含后续源码提交。

> **AI 用量精度与 embedding 预算更新：2026-10-02。** 真实 OpenAI-compatible 流默认请求最终 usage chunk，并在结算前校验非负安全整数；缺失/非法 usage 或 `AI_INCLUDE_USAGE=0` 时回退字符估算，不自动重试。检索的能力探测、查询和商品批量 embedding 现在各自通过原子预算 reservation，成功按输入字符估算结算；普通网络/网关失败保守记账后降级关键词，预算拒绝会阻断 provider 调用。新增回归覆盖精确写入、估算回退和 embedding reservation，详见 [AI 用量精度报告](../ai-usage-accuracy-2026-10-02.md) 与 [embedding 预算边界报告](../ai-embedding-budget-2026-10-02.md)。多实例共享护栏和正式网关兼容性仍需独立验收。

> **目录漂移与 CI 更新：2026-10-02。** 新增只读 `npm run check:catalog`，比较 TypeScript 展示快照与 Python commerce 导入快照的稳定商品/变体键、价格、颜色、尺码和无尺码款；本次 29 款、968 个变体键一致，规范化展示/交易快照版本均为 `109c32e3464f7e96`，`evo-05` 明确无可售尺码。检查不读取或修改运行时库存、预占和订单。PostgreSQL TLS CI 在写入测试证书后完整重启服务，并验证证书路径和 `ssl=on`，不再只依赖 reload。证据见 [目录漂移报告](../catalog-drift-2026-10-02.md)。

> **耦合检查：2026-10-01。** 按用户要求复核静态依赖与模块边界，并将护栏对整个 SQLite 仓储的类型依赖改为纯预算接口。`check:coupling` 已纳入 verify，检查循环、领域层和护栏具体实现依赖；详见 [耦合检查报告](../coupling-audit-2026-10-01.md)。ORM/双数据库重复和展示/交易目录同步仍按原边界记录，不以新增接口宣称这些问题已完成。

> **预算恢复更新：2026-10-01。** 阶段 C 继续修复 AI 调用失败/中断漏计、进程崩溃预占无恢复，以及流式请求取消和隐式重试。已调用 provider 的不确定工作保守记为 `abandoned`，陈旧 pending 分批恢复，完整回复超出估算仍记账；SSE 按需拉取并传递取消/超时，SDK 自动重试关闭。详见 [预算恢复报告](../ai-budget-recovery-2026-10-01.md)。不改变支付、交易权威来源或前台设计，阶段 C 仍有精确用量和部署共享状态等缺口。

> **PostgreSQL 实测更新：2026-10-01。** 在独立本地 PostgreSQL 16.4 上已通过 commerce 双数据库测试（112 项）及 AI 预算并发、真实 TLS 查询/拒绝验收。同请求结算/释放的竞态已修复，重试不能改变预占日期或金额；相应测试已接入 CI 配置，远端 CI 尚未执行。证据与下一步见 [PostgreSQL 验收报告](../postgres-acceptance-2026-10-01.md)。下方“PostgreSQL 未执行”仅为对应历史轮次状态。

> **继续实施：2026-10-01。** 用户已授权自行提交。上一轮统一基线已提交为 `4177ec5`；本轮继续补齐安全错误合同、请求追踪，以及隔离 PostgreSQL 测试/CI 入口。当前事实、实际结果和待验收范围见 [可靠性更新报告](../reliability-2026-10-01.md)。下方 2026-09-30 的“未提交”是历史状态；本轮不 push、不部署。

> **实施更新：2026-09-30，F:/shoe-online-store-demo。** 用户本次要求继续推进更新后，已在原分支 `sql-certificate-and-AI-stock` / HEAD `dd76ad8` 上形成未提交的统一工作树。当前目录已经恢复 Python commerce 源码、代理、购物车/订单 UI 与响应合同；原有文档、SEO 页面和业务数据库保留。
>
> 已按文件/补丁核对并整合本地 `44a94e0` 的交易实现，以及 `d005c04`（TLS）、`c0e8980`（有界护栏）、`8f1d7a6` / `b345188`（Session/IP 与签名 Cookie）、`89b610e`（原子预算）、`bbf781b`（业务异常）。另外修复了组合验收发现的历史预算漏计，补充失败/中断/跨 UTC 日回归，并屏蔽代理 5xx 的内部响应和普通错误日志中的原始异常。
>
> **本轮事实、实际验证、启动方式、限制和回滚见 [统一基线实施报告](../unified-baseline-2026-09-30.md)。** 下文第 0～9 节保留为上一轮只读交接的历史快照；其中“A 无交易源码”“这些补丁待整合”“本轮未测试”不再描述当前未提交工作树。未 fetch、未 commit、未 push、未部署；本地测试不能代表真实 PostgreSQL 或生产验收。

> 本地事实核对日期：2026-09-30，Asia/Shanghai。本文是接手入口与证据索引，不是生产完成证明，也不自动授权执行所有待办。
> 上一轮任务只整理交接文档：没有修改业务代码、数据库或配置，没有提交、合并或部署。本次实施以顶部更新和新报告为准。

## 0. 五分钟内必须知道的事

1. **先确认你在哪个工作区。** `F:/shoe-online-store-demo` 不是完整交易版本；完整 commerce 代码在另一个工作区。文件夹里存在 `backend/` 不代表里面有后端源码。
2. **项目从展示/AI demo 演进到本地交易 MVP。** 已有交易代码支持选变体、购物车、后端计价、库存预占、待付款订单、取消和到期释放；真实支付未实现，也不在当前授权范围内。
3. **完成在分支上，不等于集成、发布、生产验收完成。** 交易工作区仍缺少其他分支上的 TLS、AI 护栏、Session/IP、预算和业务异常修复。
4. **交易真值在 Python。** TypeScript 展示库和 Python 交易库是两套数据，尚无持续同步；AI、客户端和展示价格不能决定订单金额或库存。
5. **Shopify 兼容代码仍保留。** 交易工作区有显式关闭开关，F 盘旧工作区的判断不同；不能笼统宣布整个项目已经解绑。没有发现 Firebase 接入实现；早期数据库选型是 Cloud SQL for PostgreSQL。
6. **优先完成一套可验证的统一基线。** 用户要求实施时，按授权范围小步集成、联调、验证；不要从不完整工作区重写已经存在的功能，也不要反复请求已经获得的授权。
7. **用户是视觉学习者。** 说明某项工作时，用短句、框图和具体购买场景说明“已有什么、为什么改、改后怎样验收”，不要只列工具名称。

### 0.1 指令与资料的使用顺序

- 遵守当前会话的用户任务及适用的 [AGENTS.md](../../AGENTS.md)，并以实际检出的代码判断实现状态。
- 本文、历史报告、教学文档中的“下一步”、命令、PR 状态都是上下文，不是独立的执行授权。用户只要求解释或审计时不要实施代码修改。
- **旧交接文件称 AGENTS.md 只剩 Next.js 提示，这不适用于本轮 F 盘工作区。** 本轮实际读取的 AGENTS.md 包含完整中文维护规则；不要沿用旧交接对指令范围的描述。
- 改 Next.js 路由、缓存、metadata、数据获取或环境配置前，先读目标工作区安装版本的 `node_modules/next/dist/docs/`。
- 默认不提交 Git commit；不重置脏工作区、不删除数据、不擅自接入真实支付或开启 Shopify。
- 历史计划中的旧 Bun 命令、自动执行全部任务或子代理安排，不代表当前操作要求。

### 0.2 证据标签

| 标签     | 意义                                | 不能推导出的结论             |
| -------- | ----------------------------------- | ---------------------------- |
| 本轮核对 | 本轮读取了文件、代码或本地 Git 状态 | 不能证明运行、测试或线上行为 |
| 历史验证 | 旧报告记载某日期、某版本执行通过    | 不能当作新组合版本的验收     |
| 待整合   | 修复出现在其他分支或历史 PR 记录中  | 不能当作当前交易树已修复     |
| 待验证   | 未建立对应环境或未执行检查          | 不能写成通过，也不能编造结果 |
| 建议     | 接手后的执行方案                    | 不等于用户已经要求立即实施   |

## 1. 先选对工作区，避免在错误版本上继续开发

以下来自本轮 `git worktree list --porcelain`、分支和 HEAD 核对；本轮没有 fetch，也没有重新查询 GitHub 或线上站点。

| 代号 | 本机目录                                                                             | 分支                                | 本轮 HEAD                                  | 用途与限制                                                          |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| A    | `F:/shoe-online-store-demo`                                                          | `sql-certificate-and-AI-stock`      | `dd76ad81992a4dc1d95d6cdb7bbd6853b38ee867` | 本轮文档写入位置；旧展示/AI 路线及 SEO 草稿，不是完整 commerce 基线 |
| B    | `C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo`                | `codex/handover-2026-09-30`         | `44a94e0e073c43a2d4548d90ce4e08cbf7c1b5bc` | 本地交易实现和旧交接的证据位置；仍非安全补丁全集                    |
| C    | `C:/Users/Administrator/.codex/worktrees/security-guardrails/shoe-online-store-demo` | `codex/commerce-error-boundary`     | `bbf781b18ccff015fa2aa94173d14892aececd92` | 业务异常分支；目录名字不证明含全部安全修改                          |
| D    | `C:/Users/Administrator/.codex/worktrees/seo-cleanup/shoe-online-store-demo`         | `codex/cleanup-generated-artifacts` | `2f7b6fbf6d2c8841d3894747431ab86e5b0c5a53` | 已提交构建产物清理分支；不代表其他分支已清理                        |

这里只详细核对 A/B；C/D 的登记信息来自 Git，没有核验其当前工作区是否适合写入或复用。跨工作区写入仍应检查会话权限及是否有其他任务占用。

本轮开始时，A 有未跟踪的 `docs/从最小后端到交易闭环-图解教学-2026-09-30.md`，必须保留；B 的 `git status --short --branch` 未报告改动。A 的若干旧 pytest 缓存目录存在读取权限警告，不能据此判定应用测试失败，也不能为清理警告删除目录。本文与 README 导航改动在该快照之后产生。

```text
                         同一项目的不同工作区
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
     A：展示/AI + SEO       B：本地交易闭环       安全/预算/异常分支
     不是完整交易版本       响应校验已加入         修复尚待组合验证
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  ▼
                      建议：选定统一集成基线
                                  ▼
                      门禁 + 双服务 + 浏览器验收
                                  ▼
                         再判断是否具备发布条件
```

### 1.1 只读的接手检查

在实际目标目录执行，不要复制下面的路径后误把 A 当成 B：

```powershell
Get-Location
git status --short --branch
git log -1 --format='%H %cI %s'
git worktree list --porcelain
git ls-files backend/app/main.py backend/pyproject.toml
Test-Path -LiteralPath 'src/app/api/commerce/[...path]/route.ts'
Test-Path -LiteralPath 'backend/app/schemas/responses.py'
Test-Path -LiteralPath 'src/domain/commerce-response.ts'
Get-ChildItem -Force -File -Filter '.env*' | Select-Object Name
```

有 Git ownership 警告时，只对核实过的目录使用命令级 `git -c safe.directory=<目标绝对路径> ...`；不要把所有目录都列为全局信任。只记录环境变量名、文件是否存在和非敏感模式，不打印 Token、Cookie、密码或完整连接串。

### 1.2 本机路径不是远端状态

旧交接记载 fork 为 `beifeng08/shoe-online-store-demo`，上游为 `WhatDamon/shoe-online-store-demo`。本轮未重查远端，仓库名称、PR 号、head/base 和是否合并都应在实施前重新核实。

旧记录中的 fork 交易集成分支是 `codex/commerce-python-ci-docs`，历史集成提交为 `0e180fb186c71038ab5d1e4250c1d46e850bc588`；不能硬编码它为“最新”。本地提交与 squash 后提交可能文件树相同，不能仅因 SHA 不同就重复应用补丁。

## 2. 系统边界与数据流

以下图描述 **B 交易工作区**，不表示 A 或线上已经包含全部模块。Next.js 同时承担页面和部分服务端代码；不能把整个 TypeScript 部分都当作浏览器前端。

```text
┌────────────────────────────── 浏览器 ──────────────────────────────┐
│ 浏览/筛选/收藏/文章             AI 对话                购买与订单  │
└────────────┬──────────────────────┬────────────────────────┬──────┘
             ▼                      ▼                        ▼
┌───────────────────────── Next.js / TypeScript ─────────────────────┐
│ 页面 + catalog service      /api/ai/chat        commerce-client    │
│        │                    护栏、检索、SSE     + 响应运行时解析    │
│        ▼                        │                       │          │
│ Drizzle 展示目录库 ◀─────────────┘                       ▼          │
│ 商品文案/图片、embedding、ai_usage          /api/commerce/[...path] │
└────────────────────────────────────────────────────────┬──────────┘
                                                        │ 内部 HTTP
                                                        ▼
┌────────────────────────── Python / FastAPI ───────────────────────┐
│ 输入与响应模型 → 业务层 → SQLAlchemy → 独立交易数据库               │
│                          变体、价格、库存、购物车、订单、审计       │
│ Alembic 负责表结构版本；seed 负责初始演示商品                       │
└───────────────────────────────────────────────────────────────────┘
```

| 概念                      | 本项目中的位置                                     | 重要区别                                                                      |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Python / FastAPI          | 自建交易服务                                       | 决定交易规则，不代替数据库                                                    |
| SQL / SQLite / PostgreSQL | SQL 是操作语言；后两者是数据库系统                 | Python 与 SQL 数据库需要协作，不应简单“解绑”                                  |
| Cloud SQL                 | 早期设计选择的云端 PostgreSQL 托管路线             | 兼容代码和选型记录不是已部署证明                                              |
| Firebase / Firestore      | 本轮检查未发现接入实现；早期设计没有选择 Firestore | 不要把 Cloud SQL 叫作本项目的 Firebase 后端；不对 Firebase 产品能力作绝对断言 |
| Shopify Buy Button        | 保留的另一条商品选择/结账路径                      | 不经过 Python 交易服务；B 默认关闭，兼容代码尚未删除                          |
| SQLAlchemy / Drizzle      | Python / TypeScript 各自的数据访问工具             | 不是同一个 ORM，也不是同一份业务 schema                                       |

### 2.1 数据权威与目录漂移

| 数据                           | 当前权威来源                             | 不允许的误解                                   |
| ------------------------------ | ---------------------------------------- | ---------------------------------------------- |
| 展示文案、图片、博客、搜索材料 | TS 目录、供应商导入和内容文件            | 展示完整不代表可销售，营销内容仍需证据         |
| 可售 variant、订单价格、库存   | Python 交易库                            | 不接受客户端或 AI 提交的价格、库存、状态作真值 |
| 订单身份、所有权、历史价格     | Python orders/order_items 和购物会话关联 | 不能只凭订单 ID 访问，商品改价不能改历史订单   |
| AI 回复与推荐                  | TS 检索材料与现有规则                    | 不是实时库存、下单或支付工具；AI 卡片不带价格  |

默认本地 TS 文件为 `data/local.db`，Python 从 `backend/` 启动时为 `backend/commerce.db`。两边环境配置独立，即使都叫 `DATABASE_URL`，也不得指向同一份旧 SQLite 文件。

```text
TS 导入与展示资料
       │ 显式导出，不是持续同步
       ▼
backend/data/catalog.json
       │ python -m app.seed
       ▼
Python 商品/变体/初始演示库存
       │
       └─ 重复 seed 跳过已存在商品，不更新已有价格或重置库存
```

Python 种子为每个颜色/尺码组合建立稳定 UUIDv5，初始库存是演示值。后续更名要保留身份；现有前端仍通过 handle + 颜色名 + canonical EU 尺码匹配变体，更名/下架同步仍需设计。TS adapter 会补回缺失的 seed ID，不能用直接删展示行实现可靠停售。

### 2.2 Shopify 的精确状态

- B 的 `shopifyBuyConfigFor` 先检查 `SHOPIFY_ENABLED === 'true'`，再检查凭据与商品映射；默认本地 MVP 保持关闭。
- A 的旧实现只检查商品映射与购买凭据，没有同样的总开关；不能只加一个未被代码读取的环境变量就宣布关闭。
- B 的 `ProductActions` 在 Shopify 配置存在时显示 Buy Button 并跳过 Python 商品读取，否则进入本地交易路径。
- 关闭开关不等于删除兼容代码、撤销 Shopify 账号授权或停止外部商店；本轮没有核对这些外部状态。

## 3. 交易合同：修改时必须保住什么

下面是 B 的实际实现，不把 AGENTS.md 中的目标描述当作已完成代码。

### 3.1 一次下单的边界

```text
购物 Cookie → Next 生成/校验会话 ID → 内部 X-Session-ID
                                     + Idempotency-Key
                                              │
                                              ▼
┌──────────────── 同一个数据库事务 ────────────────────────┐
│ 锁当前购物车，再查同一会话 + 幂等键是否已有订单            │
│      ├─ 已有：检查到期，返回原订单                        │
│      └─ 没有：重读价格/库存，检查购物车                    │
│                  ↓                                      │
│ 新订单 → 条件更新库存 → 订单项快照 → 预占与审计 → 清购物车 │
│                  ↓                                      │
│         成功响应通过 Pydantic 校验                       │
└─────────────┬───────────────────────────┬────────────────┘
              │ 成功                      │ 异常/校验失败
              ▼                           ▼
          COMMIT 提交                 ROLLBACK 回滚
              ▼                           ▼
      返回 pending_payment         本次业务写入不生效
```

- 事务由 `backend/app/dependencies.py` 的 `session.begin()` 和路由的 `Depends(..., scope='function')` 配合。`flush()` 不是最终提交；不要在业务层每保存一步就 commit。
- 锁购物车用于串行化同一会话的修改、下单、取消/到期操作；实际为 upsert 后更新 `Cart.revision`。PostgreSQL 是相应行的写锁，SQLite 写锁范围更广，不能把 SQLite 并发测试当作 PostgreSQL 锁行为验收。
- 不同购物车竞争同一库存，还依赖 `available >= quantity` 的条件 UPDATE、影响行数检查及事务回滚；只锁购物车不足以防止超卖。
- 数据库唯一约束是 `(cart_id, idempotency_key)`。同一次请求重试应复用原 key；原订单到期或取消后仍是原订单，不保证返回体永远不变。
- 浏览器保留待处理 key，直到成功响应通过解析才删除；响应丢失或无效时，不应直接生成新 key 假装开启一笔新交易。客户端解析失败不能回滚已经提交的服务端事务，重试保护因此必要。
- 加入购物车与 checkout preview 不预占库存；创建订单才执行 `available -= quantity`、`reserved += quantity`。取消/到期释放只执行一次。

### 3.2 会话、金额、状态和到期

| 合同            | 现有实现与限制                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 购物身份        | `evoloop_cart_session` HttpOnly、SameSite=Lax Cookie；HTTPS 时 Secure；Next 转为内部 `X-Session-ID`。不是完整登录/账号恢复系统 |
| 所有权          | 购物车项、订单、支付按当前会话限定；Cookie 丢失不能找回原匿名订单                                                              |
| Python 暴露范围 | 本地绑定 `127.0.0.1`；内部 UUID 是 bearer credential，不能当成可直接公开的完整认证系统                                         |
| 金额            | Python `Decimal` + `Numeric(12,2)`；HTTP 用非负两位小数字符串，例 `"59.00"`；不让 JS 浮点决定订单真值                          |
| 当前结算范围    | USD 商品小计；没有税费、运费、折扣、退款或完整多币种购物车                                                                     |
| 订单状态        | 仅 `pending_payment` / `cancelled`；到期以取消原因 `expired` 表达                                                              |
| 支付            | 只有 `MockPaymentProvider`，返回 `payment_disabled`、`charged=false`，不能变为 paid                                            |
| 支付记录时机    | 当前是在请求 Mock 支付会话时惰性创建 payment/event，不是在下单时就创建支付占位                                                 |
| 到期            | 默认 1800 秒；进程内扫描默认 30 秒、每批最多 100；CLI 和部分订单请求也可触发释放。停机/积压可能延迟                            |
| 响应合同        | 后端 Pydantic 成功模型 + 前端手写 parser 已存在；不是 Zod/OpenAPI 自动生成，不覆盖所有跨字段计算一致性                         |
| 错误与日志      | B 仍有 `HTTPException` 进入 Application，统一安全错误、request ID 和日志边界尚待整合复核                                       |

AI Session 与购物会话是两条边界。购物 Cookie 已存在，不代表 AI 已经完成服务端身份/IP 修复。

### 3.3 表结构与迁移

13 张业务表：`products`、`product_variants`、`product_media`、`carts`、`cart_items`、`inventory`、`inventory_reservations`、`orders`、`order_items`、`payments`、`payment_events`、`webhook_events`、`audit_logs`；`alembic_version` 另计。Webhook 表存在不代表 webhook 业务已接入。

```text
41e28c896353_initial_commerce
              ↓
a682dde201b4_reservation_expiry
```

第二项增加到期/取消信息及索引。响应模型和前端 parser 补丁没有新增迁移。Python 正式 schema 通过 Alembic；TS 展示库现在通过 Drizzle 双方言版本化迁移，两者仍是独立数据库和独立边界。新增字段应同步 ORM、迁移、响应模型、种子（如适用）和测试。

## 4. 阅读代码时的最短路径

下表中的路径均相对于**选定的目标工作区根目录**。标为 B 的文件在 A 缺失时，先参考 B 或正确 Git 引用，不要据此重新实现。

| 要解决的问题          | 首先阅读                                                                                                                                | 直接相关验证                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 商品展示/导入         | `src/domain/product.ts`、`src/server/catalog/adapter-contract.ts`、`db-adapter.ts`、`src/db/schema*.ts`、`src/app/api/catalog/route.ts` | catalog/DB 相关测试；检查缺失 seed 自动补回行为                  |
| 商品变体和购买（B）   | `src/components/shop/product-actions.tsx`、`product-buy-bar.tsx`                                                                        | `product-actions.test.tsx`、购买条测试                           |
| 购物车/结账/订单（B） | `src/components/shop/commerce-panel.tsx`、`src/app/cart/`、`checkout/`、`orders/`                                                       | commerce panel 测试、真实双服务 smoke                            |
| 请求与响应（B）       | `src/lib/commerce-client.ts`、`src/domain/commerce-response.ts`、`backend/app/schemas/responses.py`                                     | TS parser/client 测试、`backend/tests/test_response_contract.py` |
| Next 代理（B）        | `src/app/api/commerce/[...path]/route.ts`                                                                                               | 同源、Cookie、错误状态、超时、路径白名单测试                     |
| Python 业务（B）      | `backend/app/api/v1/routes.py` → `app/dependencies.py` → `app/application/commerce.py` → `app/domain/models.py`                         | `backend/tests/test_commerce.py`：回滚、所有权、幂等、竞争库存   |
| 预占到期（B）         | `backend/app/application/expiry.py`、`app/expire_orders.py`、`app/main.py`                                                              | `test_expiry.py`、`test_expiry_migration.py`                     |
| 数据库生命周期（B）   | `backend/app/infrastructure/database.py`、`migrations/`、`app/seed.py`、`app/config.py`                                                 | 独立数据库迁移；`test_database_snapshot.py`                      |
| AI 与护栏             | `src/app/api/ai/chat/route.ts`、`src/server/ai/`、`guardrails/`、`search/repository.ts`                                                 | 选择已整合版本的 Session/IP、TTL/容量、预算并发测试              |
| SEO（A 有草稿）       | `docs/seo-geo-plan.md`、`src/lib/site.ts`、`seo.ts`、`src/app/robots.ts`、`sitemap.ts`                                                  | 域名/metadata 测试、生产构建、发布后真实 URL GET                 |

保留 `src/domain` 的纯 TS 领域边界，Client Component 不得运行时导入 `src/server/**`；`import type` 擦除后不构成运行时依赖。`CanonicalSize` 使用 EU 整档；色号数组下标只是图库坐标，不是 variant ID。尺码换算表和部分商品文案是演示资料，不能升级为未经核实的商品承诺。

## 5. 已完成、待整合、未实现：不要混成一个进度百分比

### 5.1 当前能力矩阵

| 能力                                       | A                                                                                | B                                              | 交接判断                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| 展示/搜索/收藏/AI                          | 有                                                                               | 保留                                           | 本轮读代码；不代表无缺陷或生产验收             |
| Python 交易源码、代理与交易页面            | 缺失；残留被跟踪的 `.pyc`、数据库                                                | 有                                             | 本地 MVP 已有实现，不要在 A 误判成“后端已搭好” |
| 预占到期释放                               | 无完整源码                                                                       | 有                                             | 历史测试通过，组合基线须复测                   |
| 成功响应模型、前端 parser                  | 无                                                                               | 有                                             | 2026-09-30 工作已进入 B；错误规范仍待整合      |
| TLS 身份校验                               | 已整合验证：生产强制 `rejectUnauthorized:true`、CA/主机名校验与 fail-closed 配置 | 同样已整合；真实握手/数据库验收见 TLS 报告     | 当前代码不再提供生产明文或证书绕过路径         |
| AI Map 有界、Session/IP、原子预算          | 旧路径                                                                           | 旧路径                                         | 独立修复存在，不能宣布已经整体解决             |
| Shopify 显式关闭开关                       | 无相同总开关                                                                     | 有                                             | 保留兼容入口，不等于删除账号/外部商店          |
| robots/sitemap、SEO 方案                   | 有草稿/文件                                                                      | 对应文件缺失                                   | A 文件存在不代表正确或上线                     |
| PostgreSQL 运行时及 TLS 联调               | 已有独立本地 PostgreSQL/TLS 验收报告与集成测试                                   | 已有独立本地 PostgreSQL/TLS 验收报告与集成测试 | 仍不等同于远端 CI、证书轮换或正式部署验收      |
| 真实支付、账号恢复、后台管理、自动目录同步 | 不作为已完成能力                                                                 | 未实现                                         | 明确范围，不能靠 UI 或表名推断                 |

历史回答中的粗略百分比不是验收指标。本项目尚无统一加权需求清单；报告应分别给出“实现、集成、测试、发布”的状态，不编造一个精确完成率。

### 5.2 修复线索，不是自动合并清单

这些本地提交能用于找代码；提交日期/本地分支名不保证它是远端最新 head。

| 主题                | 本地线索                                     | 旧交接中的 PR 位置    | 组合时保护什么                                                        |
| ------------------- | -------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| PostgreSQL TLS      | `d005c04` / `codex/verify-postgres-tls`      | 上游 #15 包含相关修复 | 可信 CA/主机身份、错误信息不含秘密；真实 TLS 验证                     |
| AI 内存边界         | `c0e8980` / `codex/bound-ai-guardrail-state` | 上游 #15              | TTL 真清理、容量、key 校验、历史长度、单实例约束                      |
| AI Session/IP       | `8f1d7a6`；Cookie 补丁 `b345188`             | 上游 #15；fork #1     | Cookie 真实性/期限、可信代理策略；不能只随机生成 ID                   |
| 原子预算            | `89b610e` / `codex/atomic-ai-budget`         | 上游 #16              | 预占、结算、失败/中断释放、UTC 日期、并发与 schema 变化               |
| 业务异常解耦        | `bbf781b` / `codex/commerce-error-boundary`  | 上游 #17              | Application 不依赖 FastAPI，同时保留 B 新增 response_model 和事务范围 |
| SQLite 测试快照     | B 含 `413a59f`；原补丁 `99b963a`             | fork #2               | 用 backup 读取已提交 WAL 内容，不退回仅拷贝 `.db`                     |
| 成功响应/客户端解析 | B 含 `eccb15e`、`857bb5e`                    | fork #3/#4            | 严格输出、回滚校验、未知字段隔离、失败重试复用 key                    |
| 生成产物清理        | `2f7b6fb` / D                                | 旧上游 #14 另需复核   | 不把已有业务库、缓存和构建目录打包提交；不能擅删用户数据              |

**PR 编号必须带仓库。** 上游 #15 与 fork #15 不是同一对象。旧记录称 #15/#16/#17 是相同旧基线上的并列分支，不能假设相互包含；本轮没有重新查询 OPEN/merged/CI 状态。`codex/server-owned-ai-session` 的本地 head 当前为 `5bf12d4`，也不能只凭名字断定内容或最新程度。

集成前重新检查远端、head/base、祖先关系、文件树和 patch 等价性；区分同一修改的 cherry-pick/squash，避免重复应用。不要机械执行“把上表每个 SHA 都 cherry-pick 一遍”。

### 5.3 旧资料的明确纠偏

- A 的 README 描述没有购物车/结账，适用于 A 的旧实现；不能用它否定 B 的交易代码。反过来也不能把 B 的 README 当作 A 的运行说明。
- 旧交接关于 AGENTS.md 已缩短的说法已过时，本轮 A 的实际规则更完整。
- `CONTEXT.md` 仍有旧 Shopify 和护栏描述；它的纯领域约束有用，但状态和配置必须结合选定版本核实。
- 老实现报告里的 Bun、历史测试数量、QR 购买入口和“无 Cookie”不能覆盖新的 Node/npm、交易 Cookie 和 Mock 禁支付事实。
- 旧交接记载 2026-09-30 正式站分享图使用 localhost、robots/sitemap 404；**本轮未访问线上**，只能当作需要复测的历史问题。
- 没有真实支付、供应商实时库存、物流和完整登录；不把这些包装成上线完成。MIT 适用于代码，供应商照片/目录等素材有独立限制，见 LICENSE-ASSETS。

## 6. 接下来怎样推进

前后端可以并行实现，但要先共享最小接口和业务规则，并逐小功能接通；不要全程隔绝，到最后才补所有权、金额、幂等和错误语义。以下是建议，不是本轮已执行动作。

| 顺序                | 具体工作                                                                                 | 本阶段交付/退出条件                                                                |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. 统一基线         | 核对远端与可用 checkout，保留现有修改；选实际最新的交易基线，逐主题整合既有补丁          | 有明确分支/SHA、补丁包含矩阵；没有重复补丁；没有被覆盖的响应校验/事务规则          |
| 2. 安全与交易回归   | 按依赖分别合入 TLS/护栏/Session/IP、预算、异常边界；先局部测试后完整门禁                 | SQLite 门禁、幂等、越权、并发、失败回滚、过期释放与预算释放有实际证据              |
| 3. 双服务闭环       | 运行 Next + Python，在同一套代码/数据库上做 smoke 和浏览器验收                           | 选变体 → 改购物车 → 创建待付款订单 → 重试同 ID → 取消/到期释放；不存在支付成功提示 |
| 4. 生产与数据一致性 | 明确展示/交易字段权威；设计版本、对账、更名/停售传播；验证实际 PostgreSQL/TLS 与部署边界 | 真实环境连接与并发结果、迁移/备份/恢复方案、Python 内部访问策略、sweeper 存活证据  |
| 5. 性能与 SEO       | 先记录 SQL 数量/P95/N+1/分页问题，再处理域名、canonical、robots/sitemap、事实与内容      | 局部性能改进有对比；SEO 通过生产构建和真实 URL 验收，不以草稿数量验收              |

阶段 4 不要求一次性引入复杂同步平台；先把实际漂移问题与最小方案写清楚。只有确有多实例容量/共享状态需求后再评估 Redis 等基础设施，不默认拆微服务。

下一次实施任务的建议范围：**统一交易与安全基线并复现本地闭环**。先产出选定基线和缺失补丁清单，再实施这个范围；不顺带接真实支付或大规模改写页面。需要部署账号、实际域名或业务事实而代码无法给出答案时，记录明确缺口，不猜测。

### 6.1 保留的历史脉络

| 日期           | 历史阶段                                                 | 对接手的意义                                       |
| -------------- | -------------------------------------------------------- | -------------------------------------------------- |
| 2026-09-04～06 | 展示、目录、AI、供应商素材与兼容购买入口                 | 原始目标含 demo，不能假定一开始就承诺完整商城      |
| 2026-09-15     | 领域层、共享规则、AI 编排、状态处理、npm/Node 与架构记录 | 保留现有模块边界，不为接 Python 重写全部 TS        |
| 2026-09-21～22 | Python commerce、Next 代理、UI、到期释放与 Python CI     | 交易闭环已有实现和历史验收；后来拆成多个交付分支   |
| 2026-09-28～29 | TLS、AI 状态/身份/预算、业务异常、SQLite 快照等修复线    | 分散于多个分支，不代表所有修复已经组合             |
| 2026-09-30     | 后端响应模型、前端解析/重试与交接                        | B 包含最新本地响应合同；本轮新增文档入口和状态辨析 |

上述为日志/报告里的里程碑，不代表每天全部工作时长或部署时间。没有记录的日期不能补写“当天做了什么”。

## 7. 启动和验证：只在包含交易源码的目标版本执行

### 7.1 前置检查与安装

要求 Node 22+ 且满足锁文件依赖的 patch 范围、Python 3.12+。`package.json` 声明 npm 12.0.1；本轮 shell 实际是 Node 24.20.0 / npm 11.19.0，这是环境差异，不是已验证安装兼容的结论。B 的 CI 配置使用 Node 22/24 与 Python 3.12。

选定目标 checkout 后，确认端口和进程来源再启动，不能结束归属未知的进程。环境文件只在不存在时复制；不覆盖已有凭据。以下命令**本轮未执行**：

```powershell
# 当前目录必须是已确认包含 backend 源码的仓库根目录
if (!(Test-Path -LiteralPath 'backend/app/main.py')) { throw '当前目录不是交易源码基线' }
node --version
npm --version
py -3.12 --version
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
if (!(Test-Path -LiteralPath '.env.local')) { Copy-Item '.env.example' '.env.local' }
if (!(Test-Path -LiteralPath 'backend/.venv/Scripts/python.exe')) {
    py -3.12 -m venv backend/.venv
    if ($LASTEXITCODE -ne 0) { throw 'venv creation failed' }
}
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.lock
if ($LASTEXITCODE -ne 0) { throw 'backend dependency installation failed' }
if (!(Test-Path -LiteralPath 'backend/.env')) { Copy-Item 'backend/.env.example' 'backend/.env' }
```

没有 `py` launcher 时换成已经确认的 Python 3.12+ 可执行文件；不要复制另一个工作区的 `.venv`、数据库或 node_modules。安装可能需要网络/权限，失败应记录实际原因，不能把失败忽略后继续当作已安装。

在目标工作区的 `.env.local` 核对本地模式：

```dotenv
PYTHON_API_URL=http://127.0.0.1:8000
SHOPIFY_ENABLED=false
AI_DISABLE_REAL=1
DB_DRIVER=sqlite
DATABASE_URL=./data/local.db
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
```

Python `backend/.env` 使用独立的 `DATABASE_URL=sqlite:///./commerce.db`。这些是开发示例；生产域名、数据库、代理、证书、服务端 Session 等配置必须按整合后的 `.env.example` 和实际部署核实，不能照搬 localhost。

### 7.2 双服务启动

先确认目标数据库是可用于演示的本地库。已有需要保留的数据先按实际数据库方式备份；不要简单拷贝运行中的 SQLite `.db` 忽略 WAL。迁移和 seed 会写数据库，不是只读检查。

终端一，从目标仓库根目录进入后端：

```powershell
Set-Location backend
.venv/Scripts/python.exe -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'migration failed' }
.venv/Scripts/python.exe -m app.seed
if ($LASTEXITCODE -ne 0) { throw 'seed failed' }
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

终端二，从同一个目标仓库根目录：

```powershell
npm run dev -- --hostname 127.0.0.1
```

本地入口：`http://127.0.0.1:3000/shop`；Python health 为 `http://127.0.0.1:8000/health`，接口文档为 `http://127.0.0.1:8000/docs`。浏览 `/product/dc-1001`，选明确颜色/尺码，加入 `/cart`，修改数量，去 `/checkout` 创建待付款订单，再刷新和取消。

### 7.3 代码实施后的验收命令

每条独立记录退出码与版本；失败先区分环境问题、本次回归和既有无关失败。不要删测试、加兜底零值或降低规则来制造绿灯。

仓库根目录：

```powershell
npm run verify
npm run build
git diff --check
```

`verify` 已串联 format、typecheck、server boundary、lint、test。后端目录：

```powershell
.venv/Scripts/python.exe -m ruff check app migrations tests
.venv/Scripts/python.exe -m ruff format --check app migrations tests
.venv/Scripts/python.exe -m mypy
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m compileall -q app migrations tests
```

迁移核验从 `backend/` 执行，使用新的本地测试数据库；保留并恢复原有进程环境变量：

```powershell
$hadDatabaseUrl = Test-Path Env:DATABASE_URL
$previousDatabaseUrl = $env:DATABASE_URL
$migrationCheckName = 'handover-check-' + [guid]::NewGuid().ToString('N') + '.db'
try {
    $env:DATABASE_URL = 'sqlite:///./' + $migrationCheckName
    .venv/Scripts/python.exe -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'temporary database migration failed' }
    .venv/Scripts/python.exe -m alembic check
    if ($LASTEXITCODE -ne 0) { throw 'schema drift check failed' }
} finally {
    if ($hadDatabaseUrl) { $env:DATABASE_URL = $previousDatabaseUrl }
    else { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
}
```

该测试文件保留供检查，没有自动删除，也不应提交。不要对业务库执行 `alembic downgrade base`。PostgreSQL/TLS、迁移兼容和并发必须用独立的实际 PostgreSQL 环境验收，SQLite 命令不能代替。

双服务启动后，从仓库根目录运行：

```powershell
backend/.venv/Scripts/python.exe scripts/smoke-commerce.py
```

脚本固定访问 `127.0.0.1:3000`，会增加购物车、创建/取消演示订单并留下审计记录；需要可售 demo 变体，不可对真实业务数据随意运行。另做浏览器验收：颜色/图片/尺码对应、刷新、重复点击/网络失败重试、跨会话拒绝、取消和到期库存回补。

### 7.4 历史测试结果与本轮证据分开

| 项目                                     | 旧交接/报告记载                         | 本轮证据                                                         |
| ---------------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| Python pytest                            | 阶段 C 最近基线：104 passed、1 skipped  | 上一小步已重跑；本轮只改 TypeScript 限流输入边界                 |
| TS verify                                | 阶段 C 旧基线：67 文件 / 427 项         | 本轮通过：78 文件、581 passed、15 skipped                        |
| 生产 build                               | 阶段 C 旧基线：成功、44 个静态页面      | 本轮通过：Next 16.3.4，45 个静态页面生成；trace 含双方言迁移文件 |
| Ruff/format/mypy/compileall、SQLite 迁移 | 旧交接记载通过；TS 迁移单元测试本轮通过 | 后端门禁未在本轮重跑；TS PostgreSQL 迁移需独立测试库             |
| 双服务 smoke 与浏览器                    | 早期 MVP 报告有成功闭环及库存恢复记录   | 未执行；没有启动服务或下单                                       |
| GitHub CI/PR、线上 SEO GET               | 旧交接有日期与结果                      | 未重新查询，不沿用为当前状态                                     |
| PostgreSQL/TLS、负载、移动端指标         | 缺少当前组合版本完整验收证据            | 未执行；本轮没有相应验证环境                                     |
| 本轮文档                                 | 新 HANDOVER + README 入口               | 目标 Markdown 格式、文件引用与 Git 差异检查，见本轮交付说明      |

旧报告提到 TestClient/httpx/anyio 弃用警告与 Windows 测试临时目录权限问题；遇到时记录实际输出，区分依赖警告、权限失败和业务失败。

### 7.5 历史文档验证记录

- `node node_modules/prettier/bin/prettier.cjs --check HANDOVER.md`：通过。
- 本地链接存在性检查：21 个链接，0 个失效；README 的 HANDOVER 导航存在。绝对路径仅证明本机存在，不保证跨机器可用。
- PowerShell Parser 静态检查：8 个命令块，0 个语法错误；这些是语法检查，没有执行安装、迁移、启动或应用测试命令。
- Markdown 代码围栏：15 对，闭合完整。
- `git -c safe.directory=F:/shoe-online-store-demo diff --check`：通过；该命令不包含未跟踪的新文件，HANDOVER 另由格式/内容检查覆盖。
- 本轮包含 TypeScript 双方言迁移、运行时接入、迁移测试、Next 文件追踪和文档更新；原有未跟踪教学文件保留。未部署，未修改 Python commerce 业务库。

### 7.6 本次 TypeScript 迁移验证

- `npm run verify`：通过；格式、类型、边界、耦合、目录漂移、lint 和全量测试均通过。
- `npm test -- --run src/db/migrations.test.ts src/db/db.test.ts src/db/schema-parity.test.ts`：3 文件、15 项通过。
- `npm run build`：通过；Next 16.3.4 生成 45 个静态页面。
- Next route trace 已包含 `drizzle/sqlite`、`drizzle/postgres` 的 SQL 与 metadata 文件。
- `git diff --check`：通过。PostgreSQL 迁移路径和后端全量门禁未在本轮重跑，需独立 PostgreSQL 测试库复核。

## 8. 发布、回滚与观察边界

发布前记录：仓库/分支/SHA、前后端托管位置、正式域名、实际数据库与备份、迁移顺序、TLS/可信代理/内部访问、到期扫描运行方式、回滚版本。CI 成功或 Vercel 授权失败都不等于发布成功。

- 代码：默认不 commit；用户要求提交时只暂存明确文件，复核 staged diff，不提交 `.env`、数据库/WAL、缓存、日志、虚拟环境或构建产物。
- 数据：迁移按兼容性和实际恢复策略回滚/前向修复；取消订单需要正常事务释放库存，不靠手工改状态字段。
- 回归：回退版本不能重新引入旧 TLS/Session/预算漏洞；至少复测 health、目录、购物车、幂等、所有权、释放库存与禁支付。
- 观察：关注 5xx/P95、库存冲突、长期 reserved/过期积压、预算预占释放、AI provider 失败、内存容量；request ID/安全日志等未整合部分不要当作现有完整监控。
- SEO：先事实和交易门禁，再上线复测 canonical、分享图、robots、sitemap、私有页 noindex、失效 URL 与缓存。历史 404/localhost 是复测线索，不是本轮线上发现。

本轮交接记录了 TypeScript 迁移小步和验证边界。需要回滚时，保留旧迁移目录和数据，按 ADR 0007 的向前修复策略处理；不要用 reset/clean 回滚整个工作区。

## 9. 证据与阅读索引

### 9.1 当前工作区 A 的资料

- [AGENTS.md](../../AGENTS.md)：本轮适用的完整维护约束。
- [README](../../README.md)、[CONTEXT](../../CONTEXT.md)：A 的运行说明、术语与依赖边界，结合版本读。
- [历史实现报告](../implementation-report.md)：有历史时效标注，不是当前上线验收。
- [架构执行记录](../superpowers/plans/execution-notes.md)、[ADR 目录](../adr/)：解释已有结构为何形成。
- [早期设计决策](../superpowers/specs/2026-09-04-shoe-store-ai-design.md)：Cloud SQL/Firestore 等选型记录。
- [SEO/GEO 方案](../seo-geo-plan.md)：后续技术、事实与发布复测要求。
- [图解教学文档](../从最小后端到交易闭环-图解教学-2026-09-30.md)：供用户理解概念；本轮开始时未跟踪，换机器未必存在。
- [素材许可](../../LICENSE-ASSETS)：不要把 MIT 代码许可扩展到全部商品素材。

### 9.2 交易工作区 B 的证据

以下为**当前机器绝对路径链接**；迁移到其他机器后，用相应分支/提交中的同名相对路径查找，不必复制整个工作区。

- [旧交接](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/docs/handover-2026-09-30.md)：更细的历史 PR、测试和线上记录，注意其 AGENTS 状态说明已不适用于 A。
- [交易版 README](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/README.md)：双服务入口。
- [Backend README](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/backend/README.md)：迁移、API、种子、会话与限制。
- [Commerce MVP 报告](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/docs/commerce-mvp-report.md)：2026-09-21/22 验证背景与后续补充。
- [业务事务实现](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/backend/app/application/commerce.py)、[数据库依赖](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/backend/app/dependencies.py)：锁、幂等、回滚和 Mock 支付事实。
- [后端响应模型](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/backend/app/schemas/responses.py)、[前端响应解析](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/src/domain/commerce-response.ts)：当前成功响应合同。
- [交易 UI](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/src/components/shop/commerce-panel.tsx)、[Shopify 开关](C:/Users/Administrator/.codex/worktrees/9106/shoe-online-store-demo/src/server/catalog/shopify-buy.ts)：重试状态和两条购买路线。

### 9.3 新 Agent 首次回复与交付格式

接手先给出简短定位：

```text
本次用户目标：……
工作目录 / 分支 / SHA：……
与目标有关的既有实现和缺口：……
要修改的文件、兼容/迁移影响：……
本次验收方法与暂时无法验证的部分：……
```

完成后记录：修改文件、实际行为、数据库/配置变化、运行命令、实际测试结果及未测原因、已知风险和回滚方法。更新本文时保留“日期 + 工作区 + SHA + 证据级别”；不要把历史结果悄悄改写成今天通过。

**接手完成的标准：能选对版本、解释两套数据与两条购买路线、定位未合入修复，并给出一个范围清楚且可验收的下一步任务。**
