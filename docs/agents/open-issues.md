# 审计要求与未决条目

> 取代 `AGENTS.md` 旧第 4 章「第一优先级：修复当前问题和安全边界」。旧章节把一份大部分已关闭的
> 审计清单写成了待办任务，会让后续 agent 去改造已经修好的代码。
>
> **本文件不记录状态快照。** 不写「已实现」、不写日期、不写行号、不写数量——快照必然失效，而失效的
> 状态描述比没有描述更危险。本文件只保留三样不会腐烂的东西：**要求**（必须成立什么）、
> **复核**（按符号名或命令自己重跑）、**验收**（怎样算通过）。
>
> 条目还在本文件里**不代表它未实现**。动手前按「复核」重跑一遍；确认某条要求已满足，就地删除该条，
> 而不是把结论沉淀成本文件的新快照。真正待办的条目在文末「未决条目」。

## 复核入口

| 区域 | 命令 |
| --- | --- |
| TS 全部门禁 | `npm run verify` |
| Python 全部门禁 | `npm run verify:python`（需先建 `backend/.venv`，见 `verification.md`） |
| 部署环境预检 | `npm run preflight -- --environment production` |
| 目录漂移 | `npm run check:catalog` |

一条要求是否满足，以重跑结果与代码为准；本文件不代替复核。

---

## P1-A：PostgreSQL TLS 必须验证服务器

**复核：**
- TypeScript 侧：`src/db/client.ts` 的 `pgConnectOptions()` 返回 `{ rejectUnauthorized: true; ca?: string } | null`，
  同文件保留 `checkServerIdentity` / SNI 修补；`scripts/preflight.mjs` 在 production 要求
  `PG_SSL ∈ {1, true, require, verify-full}`。
- Python 侧：`make_engine` 在生产只接受显式主机 + `sslmode=verify-full`；`require` / `verify-ca` /
  hostless URL 在建连接池前失败。见 `backend/tests/test_database_tls.py`、
  `docs/python-postgres-tls-2026-10-03.md`。
- 反例检查：全仓检索 `rejectUnauthorized: false` 应无命中（历史实现曾如此，位置以行号记录已失效）。

**要求：**
- 生产默认 `rejectUnauthorized: true`，使用受信任 CA 或显式 CA 文件；不能把关闭验证作为默认、静默或永久的解决方案。
- 本地开发和生产环境分开配置。Cloud SQL 等托管 PostgreSQL 优先使用私有网络或 Auth Proxy，并记录证书轮换方案。
- 为 TLS 配置生成和连接失败增加测试；可用时增加真实 PostgreSQL TLS 集成测试。
- 日志只能记录非敏感连接模式，不打印密码、完整连接串和证书内容。

**验收：** 生产缺少可信证书时连接失败；不存在默认绕过证书验证的路径；本地开发有明确且可复现的配置。

---

## P1-B：AI 进程内护栏必须有界

**复核：** `src/server/guardrails/` 下的 `bounded-store.ts`、`config-limits.ts`、`rate-limit.ts`、
`session-state.ts`、`request-body.ts`（前两者配有同名测试）。逐项核对 TTL、周期清理、最大容量、
单 key 长度与字符集、单 Session 历史上限，并确认对应测试真的在跑清理与容量行为。
**多实例共享存储不在 MVP 范围内**（见 `AGENTS.md` 边界）；不得把进程内 Map 宣称为多实例安全边界。

**要求：**
- 在当前不引入 Redis 的 MVP 阶段，至少实现 TTL、周期清理、最大容量、单 key 长度/字符集、单 Session 历史长度上限，并测试清理和容量行为。
- 不把进程内 Map 宣称为多实例安全边界。若部署需要多实例，再抽象共享存储接口，评估 Redis 或等价存储，并明确 fail-open/fail-closed、监控、迁移和回滚。
- 限制 IP、Session、回合数、历史记录和失败重试的资源消耗，避免恶意创建 key 造成拒绝服务。

**验收：** 连续创建新 Session 不会无限增长；过期记录会被清理；超过容量有稳定行为；多实例方案未实现时文档明确禁止水平扩展到该模式。

---

## P2：预算、Session、IP 和运行时契约

### AI 日预算竞态

**复核：** `src/server/guardrails/budget.ts`、`budget-contract.ts` 的 `BudgetRepository`
（`reserveDailyBudget` / `settleDailyBudget` / `releaseDailyBudget`）、`src/server/search/repository.ts`
与 `repository-postgres.ts`。上限判断应写在条件更新的 WHERE 里，Postgres 侧再套
`pg_advisory_xact_lock`；预占、结算、释放三阶段都要在，重复请求按 `requestId` 幂等。

**要求：** `src/server/guardrails/budget.ts`、`src/server/guardrails/index.ts`、`src/server/search/repository.ts` 的「读取-判断-调用-写入」必须改为数据库原子计数、事务锁或受控的 `INCRBY` 方案。明确预占、实际结算、失败/超时/中断释放规则，使用统一 UTC 日期和请求 ID，并增加并发、重试、失败测试。

### AI Session 不由客户端决定

**复核：** `src/app/api/ai/chat/route.ts`：会话 id 必须由服务端生成并以 `httpOnly: true` 写入 Cookie；
请求体的 `sessionKey` 只能存在于允许字段白名单，不得参与服务端身份判定。改动该路由时必须重验。

**要求：** `src/app/api/ai/chat/route.ts` 和前端 hook 不得让客户端靠轮换 `sessionKey` 绕过限制。服务端生成不可预测、有过期时间、可绑定匿名会话/用户的 ID，通过 HttpOnly、SameSite、生产 Secure Cookie 或可信服务端 Session 传递。校验长度、字符集、过期、来源和所有权。

### 可信客户端 IP

**复核：** `src/server/guardrails/request.ts` 只有在配置了 `TRUSTED_PROXY_IPS`（见 `.env.example`）
之后才可采信 `x-forwarded-for`；未配置时使用连接来源地址。伪造 Header 的测试应当存在。

**要求：** 只有在部署代理清洗并配置可信代理列表时才读取 `x-forwarded-for`；未配置时不能盲信任客户端 Header。增加伪造 Session、轮换 key、伪造 IP 和跨用户访问测试。

### 目录漂移

**复核：** `npm run check:catalog`（`scripts/check-catalog-drift.mjs`）必须通过——它比较展示快照与
commerce 导入快照的稳定键、价格、颜色、尺码与可售变体。背景报告：
`docs/catalog-drift-2026-10-02.md`、`docs/catalog-availability-2026-10-03.md`。

**要求：** 明确展示目录与 Python 交易目录各字段权威来源，使用稳定 product/variant ID，增加版本、同步、差异报告、删除传播和不可售核验。结账永远重新读取 Python 价格和库存，AI 推荐加入购物车前再次校验可售状态。

### 金额统一

**复核：** 交易真值 `backend/app/domain/models.py` 用 `Numeric(12,2)` + `Decimal`
（`Product.price`、`Order.total`、`OrderItem.unit_price`）；`src/domain/product.ts` 的 `Price` 是
`{ amount: number; currencyCode: 'USD' }`，即 JavaScript 浮点，用于展示目录。
交易计算未使用浮点（符合要求）；展示层用浮点是现状而非缺陷，但边界必须写明（见「未决条目」第 3 条）。

**要求：** 订单真值使用整数最小货币单位或可明确序列化的 Decimal 字符串；不得以 JavaScript/数据库二进制浮点数进行订单计算。明确货币、精度、税费、折扣、运费和舍入顺序，并保存订单价格快照。

### API 运行时契约

**复核：** Python 侧 `backend/app/api/v1/routes.py` 的 `response_model` 覆盖商品、购物车、订单、
支付与错误。TypeScript 侧未引入 zod（`package.json` 无该依赖），而是
`src/domain/commerce-response.ts` 手写 `parseCommerceProduct` / `parseCartView` / `parseOrderView`，
经 `src/lib/commerce-client.ts` 的 `parse: (value: unknown) => T` 注入执行——
**不得**改回 `data as T`。调用方为 `src/components/shop/` 下的组件。

**要求：** Python 路由为商品、购物车、订单、支付和错误增加 Pydantic response model 与 `response_model`；前端用 Zod 或 OpenAPI 生成的解析器，不以 `data as T` 代替校验。错误响应包含稳定 `code`、消息和安全详情。

### Application 不依赖 FastAPI

**复核：** 在 `backend/app/application/` 内检索 `fastapi` 应为空。

**要求：** `backend/app/application/` 定义 `ProductNotFound`、`VariantNotFound`、`OrderNotFound`、`EmptyCart`、`InsufficientStock`、`QuantityLimitExceeded`、`OwnershipDenied` 等业务异常；API 层集中映射 HTTP 状态码。Application、CLI、后台任务和单元测试不能导入 FastAPI。

---

## 未决条目

以下是**确实尚未完成**的要求，不是状态快照。完成后就地删除。

### 1. 证书轮换方案没有留档

P1-A 要求「记录证书轮换方案」，但既有 TLS 文档只说明了 `sslrootcert` 支持私有 CA、主机名身份由
libpq 的 `verify-full` 负责；轮换步骤、CA 更新窗口与回滚都没有记录。
**复核：** 在 `docs/` 中检索轮换步骤；`docs/python-postgres-tls-2026-10-03.md` 是当前唯一相关文档。
**要求：** 补一份轮换与回滚说明：谁签发、多久轮换、新旧 CA 并行窗口、失败如何回退。

### 2. 建表说法与 ADR 0003 / 0007 冲突

外移前的 `AGENTS.md` §5.1 写「所有结构变化通过 Alembic migration；不得运行时自动建正式表」，
但 TypeScript 展示/AI 库实际使用 `drizzle/sqlite`、`drizzle/postgres` 版本化迁移，**并且**存在
`src/db/client.ts` 的 `ensurePgTables()` 运行时幂等 DDL（在事务内配合 `pg_advisory_xact_lock`，
见 `src/server/search/repository-postgres.ts`），与 ADR 0003 一致。
**影响：** 新 agent 可能误删 `ensurePgTables()` 并「改成 Alembic」。
**建议：** 把该说法限定为「Python 交易库由 Alembic 管理；TypeScript 展示/AI 库见 ADR 0003/0007」。
`commerce-contract.md` 保留了原文，未擅自改写。

### 3. 金额边界需要写进契约

展示层的 `Price.amount` 是 JavaScript 浮点，与交易侧的 `Numeric(12,2)` / `Decimal` 并存。
**风险：** 它会被误认为可用于交易计算。
**要求：** 在契约中写明「展示层 `Price.amount` 不得回流到交易计算」；若未来要统一为整数最小货币单位
或 Decimal 字符串，那是破坏性变更，需要迁移与回滚方案。

### 4. `HANDOVER*.md` 归档后仍有正文引用

两个交接文件已归档到 `docs/archive/`（原因见该目录的 `README.md`）。历史报告
`docs/ai-budget-recovery-2026-10-01.md`、`docs/unified-baseline-2026-09-30.md` 的正文仍按旧路径提到
`HANDOVER.md`。它们是有日期的历史记录，不应改写；此处登记以便读者找到新位置。

---

## 需要单独环境才能复核的项

这些不是失败，只是本地默认环境覆盖不到；**不要把它们当成已完成**：

- **真实 PostgreSQL TLS 连接与证书失败路径**：需要显式配置的 PostgreSQL 服务；本地默认 SQLite。
- **Python 全部门禁**（`npm run verify:python`）：必须先按 `backend/README.md` 建好 `backend/.venv`。
  未建环境时 `scripts/py.mjs` 会回退到 PATH 解释器并告警，缺依赖会以 `ModuleNotFoundError` 失败。
- **生产部署、远程 CI、正式域名 SEO 复测**：需要真实域名与部署环境。
