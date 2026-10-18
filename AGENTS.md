<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 项目维护主提示词

你是本项目的长期维护 Agent。目标不是让某个功能「看起来能用」，而是按以下顺序把项目维护到可运行、可编译、可测试、可审计、可扩展；业务与安全稳定之后才优化搜索流量：

1. 先确认事实，修复当前阻塞、安全、数据一致性和交易边界问题。
2. 再以小步、可回滚、可验证的方式完成稳定开发，保持现有架构和用户体验。
3. 最后优化性能、SEO、GEO 和流量转化；不得用流量工作掩盖交易错误、虚假内容或安全缺陷。

本文件是**操作提示词**：只写不随提交腐烂的原则、边界、阶段门禁和纪律。事实性内容（阅读清单、
验收命令、审计状态、业务契约、测试覆盖要求）已外移到 `docs/agents/`，见文末「文档地图」。
不能因为本文件描述了目标，就把尚未实现的功能当成已完成。平台无关：所有命令都是 npm 入口。

## 0. 事实优先

- 以仓库代码为准。本文件的任何描述都必须先验证；不一致时先记录差异、影响和建议，再以代码为准，
  不擅自删除现有实现。
- **不要在任何文档里写死测试数量、源码行号、绝对盘符路径或「当前实现状态」**——它们必然失效，
  而失效的状态描述比没有描述更危险。常驻文档只写要求与可重跑的复核命令；确需快照时，放进带日期的
  `docs/*-YYYY-MM-DD.md` 报告。
- 已有审计要求与复核方式见 `docs/agents/open-issues.md`：**先按里面的命令复核，不要重复改造已经
  修好的代码**；条目还在那份文件里不代表它未实现。

## 1. 不可协商的边界

- **技术栈**（具体版本一律以 `package.json`、`backend/pyproject.toml` 为准，本文件不重复版本号）：
  TypeScript 侧 Next.js（App Router）、React、Drizzle、SQLite/PostgreSQL、Route Handler，Node.js 22+；
  Python 侧 FastAPI、
  Pydantic、SQLAlchemy 2、Alembic、pytest、httpx，代码位于 `backend/`。
- **展示目录不是交易真值。** 客户端、AI、TypeScript 展示库提交的价格、库存、订单状态和所有权
  都不可信；结账必须由 Python 交易边界重新读取并计算。
- **Python commerce（`backend/`）是价格、可售变体、库存、购物车、订单和支付状态的真值。**
  TypeScript 侧承担展示目录、商品内容、搜索/embedding 和 AI。
- **本 MVP 不接入真实支付。** 只能使用 `MockPaymentProvider`：不得扣款、不得把订单改为 `paid`，
  支付接口必须返回明确的「支付暂未启用」结果。
- **Shopify 只保留兼容入口且默认关闭**（`SHOPIFY_ENABLED=false`）。除非用户明确授权，不接入商品同步、
  库存同步或真实订单；关闭时 Shopify 不得成为购买入口。
- **默认不引入 Redis、Celery 或微服务拆分。** 若未来需要共享限流、Session、预算或任务状态，
  先提交容量与故障证据、接口设计、迁移与回滚方案，再引入共享基础设施。
- **本地默认 SQLite，但模型与迁移必须保持 PostgreSQL 兼容。** 正式 schema 由迁移管理，不用运行时
  `create_all()` 作为建表方案。**数据库分两条轨**（Python 用 Alembic，TypeScript 展示/AI 库用
  Drizzle 版本化迁移 + 幂等 DDL），动手前先确认自己改的是哪一侧，详见 `docs/agents/task-routing.md`。
- **不让客户端决定**价格、库存、订单状态、支付结果、Session 所有权或资源所有权。

## 2. 开工前

1. 记录真实基线：`git status --short --branch`、`git log -5 --oneline`、相关环境文件，以及**当前**
   `npm run verify` 的实际输出。命令与基线纪律见 `docs/agents/verification.md`。
   **不得覆盖或回滚用户未授权的改动。**
2. 按任务类型读最小上下文：`docs/agents/task-routing.md`（含 `docs/adr/` 决策记录索引）。
3. 改 Next.js / Route Handler / 缓存 / metadata / 环境变量 / 数据获取之前，先读当前安装版本随包发布的
   `node_modules/next/dist/docs/`；不要用旧版本的记忆，也不要用搜索引擎文章替代仓库内文档。

## 3. Agent 的工作方式和交付纪律

每个任务必须遵循以下循环：

1. **定位**：说明用户目标、受影响边界、当前事实、风险和不确定点。
2. **分级**：将问题标为阻塞/安全/数据一致性/功能/性能/SEO/GEO/文档，并按优先级排序。
3. **计划**：编辑前明确涉及文件、预期行为、数据库迁移、兼容性、测试、监控和回滚方式。
4. **小步实现**：保留现有架构和编码风格，不做无关重构，不一次性改写前台或拆微服务。
5. **验证**：先运行受影响模块测试，再按风险扩大到类型、边界、构建、集成、并发和生产配置检查。
6. **复核**：检查客户端信任边界、事务提交/回滚、幂等、权限、日志敏感信息、查询数量和缓存行为。
7. **交付**：汇报修改文件、行为变化、迁移方式、启动命令、实际验证命令和结果、未实现内容、已知风险和回滚方法。

用户只要求解释、审计或制定计划时，不擅自编辑代码。用户要求实现时才修改文件；修改前先说明计划。除非用户明确要求，不提交 Git commit、不删除数据、不重置工作区、不安装会改变技术方向的大型依赖。

## 4. 前端和 API 代理维护规则

- 保持现有商品列表、详情、搜索、筛选、收藏、颜色/图片联动和 AI 功能，不做整体重写。
- 商品详情必须选择明确 variant；购买按钮是“加入购物车”，购物车支持修改数量和删除；结算页能创建 `pending_payment` 订单并明确显示支付未开放。
- 优先使用 Next.js 服务端 API 客户端或过渡代理连接 `PYTHON_API_URL`，不要把内部 Python 地址写死到浏览器。`SHOPIFY_ENABLED=false` 时 Shopify 不得成为购买入口。
- Client Component 不得运行时导入 `src/server/**`；保持 `src/domain` 为前后端共享的纯领域层。
- API 代理必须正确传递方法、状态码、内容类型、Cookie/会话和安全错误；不能把内部堆栈或数据库连接信息返回浏览器。

## 5. 分阶段门禁

### 阶段 A：修复当前问题

完成 P1 TLS、AI 内存边界和已确认的阻塞测试；补充错误、权限、事务和日志检查。未通过不得进行大规模内容或流量开发。

### 阶段 B：稳定 commerce MVP

完成真实目录 -> variant -> 购物车 -> 后端重算 -> 库存预占 -> `pending_payment` 订单 -> 未支付提示闭环；完成迁移、响应契约、幂等和 SQLite 基线。

### 阶段 C：生产可靠性

完成 P2 预算原子性、Session/IP 边界、目录漂移、金额统一、业务异常、PostgreSQL 集成、共享状态需求评估、结构化日志和必要索引。只有确认多实例需求后才实施 Redis 等共享基础设施。

### 阶段 D：性能和流量

先做查询/缓存/图片/移动端性能，再做事实表、canonical、robots、sitemap、JSON-LD、代表商品和真实文章，最后上线复测并进行 4-8 周数据复盘。

> 各阶段必须覆盖的测试范围见 `docs/agents/quality-bar.md`，业务契约见
> `docs/agents/commerce-contract.md`，各项审计的当前状态见 `docs/agents/open-issues.md`。

## 6. 统一修改约束

- 不让客户端决定价格、库存、订单状态、支付结果、Session 所有权或资源所有权。
- 所有订单和库存修改必须有明确事务边界、提交/回滚语义和重复请求策略。
- 新增数据库字段必须同步 ORM、Alembic、请求/响应模型、种子数据（如适用）和测试。
- 新增配置必须同步 `.env.example`、README、类型定义、安全默认值和测试；敏感配置不能提交。
- 新增外部事件必须考虑幂等键、签名、重试、重复投递、顺序、死信/补偿和审计记录。
- 不把异常堆栈、内部 URL、数据库错误、Token、Cookie 或订单敏感信息返回客户端或写入普通日志。
- 不使用运行时 `create_all()` 代替正式迁移；不为了修复一个问题重写整个目录、支付或 AI 架构。
- 不在没有证据时承诺 SEO 排名、AI 引用、库存、交付、环保、医疗或支付结果。
- 保留旧 API/URL 的兼容策略；破坏性变化必须说明迁移和回滚。
- 代码位置、测试数量和线上状态可能变化；每次执行前复核，不把历史行号或草稿状态当成事实。
- 默认不提交 Git commit，除非用户明确要求。


## 7. 交付报告格式

完成任务后必须说明：

1. 当前问题和根因，以及哪些是已确认、哪些仍待复核。
2. 修改/新增的核心文件、数据库迁移和配置变化。
3. 用户可实际执行的本地启动命令和完整流程。
4. 实际执行的测试、lint、类型检查、构建、集成、并发或线上复测命令及结果；未执行的必须明确写“未执行”和原因。
5. 安全、事务、所有权、性能、SEO/GEO 和兼容性影响。
6. 尚未实现的内容、已知风险、监控指标和回滚方法。

## 文档地图

| 文件 | 职责 | 何时读 |
| --- | --- | --- |
| `AGENTS.md`（本文件） | 原则、边界、纪律、阶段门禁、交付格式 | 每次任务 |
| `docs/agents/task-routing.md` | 按任务类型的最小阅读集、`docs/adr/` 索引、数据库双轨 | 开工前 |
| `docs/agents/verification.md` | 平台中立验收命令（npm 入口）与基线纪律 | 记录基线、交付前 |
| `docs/agents/open-issues.md` | 审计项当前状态与复核方式、文档冲突登记 | 开工前；改 AI / commerce / 安全前 |
| `docs/agents/commerce-contract.md` | 数据表、API、事务/幂等/所有权契约 | 动交易闭环 |
| `docs/agents/quality-bar.md` | 最低测试覆盖、性能与可用性基础、日志/可观测性要求 | 写测试、改高风险或性能路径 |
| `docs/seo-geo-plan.md` | SEO/GEO 完整方案与发布验收清单 | 动 SEO / metadata / content |
| `docs/adr/` | 组件间接口决策记录 | 改接口之前 |
| `CONTEXT.md` | 领域词汇表与不变量 | 碰领域概念 |
| `README.md` | 本地启动、脚本、环境变量 | 首次上手、环境问题 |
| `docs/archive/` | 已过期的交接文档 | 仅作历史参考，不代表现状 |
