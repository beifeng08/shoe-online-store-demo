# 任务路由：开工前读什么

> 外移自 `AGENTS.md` 旧第 2.1 章。原章节平铺 23 个「必读文件」，但**没有任何任务需要每次都读全部**；
> 这里改成按任务类型给最小阅读集，并补上原章节完全遗漏的 `docs/adr/`。
> 发现失效路径请就地修正，不要留着。

## 每次任务都要

1. `AGENTS.md` —— 边界、纪律、阶段门禁、交付格式。
2. **当前**的 `npm run verify` 输出 —— 真实基线，不要引用任何文档里的历史数字。
3. `git status --short --branch` 与 `git log -5 --oneline` —— 工作区状态与最近意图。
4. `docs/agents/open-issues.md` —— **先确认问题是否已经修好，不要重复改造**。

## 按任务类型

| 任务类型 | 必读 | 相关 ADR |
| --- | --- | --- |
| AI / embedding / 预算 / 护栏 | `src/app/api/ai/chat/route.ts`、`src/server/guardrails/`、`src/server/search/`、`docs/ai-request-boundary-2026-10-03.md`、`docs/ai-usage-accuracy-2026-10-02.md` | 0004 |
| 首次上手 / 环境问题 | `README.md`、`backend/README.md`、`docs/implementation-report.md`、`docs/agents/verification.md` | — |
| 交易闭环（购物车/订单/支付/库存） | `backend/README.md`、`backend/app/main.py`、`backend/app/api/v1/routes.py`、`backend/app/application/`、`backend/app/domain/models.py`、`backend/app/infrastructure/database.py`、`backend/app/schemas/`、`backend/migrations/`、`backend/tests/`、`src/app/api/commerce/[...path]/route.ts`、`docs/commerce-mvp-report.md`、`docs/agents/commerce-contract.md` | — |
| 展示目录 / 变体 / 尺码 | `src/domain/product.ts`、`src/server/catalog/adapter-contract.ts`、`src/server/catalog/db-adapter.ts`、`src/db/schema.ts`、`src/db/schema-postgres.ts`、`src/app/api/catalog/route.ts`、`scripts/check-catalog-drift.mjs` | 0001、0002、0005、0007 |
| 前端 / UI / 客户端组件 | `src/domain/`（同构层）、`src/components/`、`CONTEXT.md` | 0005 |
| SEO / metadata / sitemap / JSON-LD | `src/lib/seo.ts`、`src/lib/site.ts`、`src/app/robots.ts`、`src/app/sitemap.ts`、`docs/seo-geo-plan.md` | — |
| 依赖 / 包管理器 / 构建 | `package.json`、`backend/pyproject.toml`、`.github/workflows/verify.yml` | 0006 |
| 数据库结构 | 先读下方「数据库双轨」，再按上面对应行读代码 | 0002、0003、0007 |

## 数据库双轨（最容易搞错的地方）

- **Python 交易库**（价格、库存、变体可售、订单、支付）：由 Alembic 管理，`backend/migrations/`。
- **TypeScript 展示 / AI 库**：版本化 Drizzle 迁移在 `drizzle/sqlite/` 与 `drizzle/postgres/`；
  Postgres 侧另有 `ensurePgTables()` 运行时幂等 DDL（`src/db/client.ts`，在事务内配合
  `pg_advisory_xact_lock` 使用，见 `src/server/search/repository-postgres.ts`），与 ADR 0003 一致。
- 两侧不得互相建表。动手前先确认自己动的是哪一侧。

## 决策记录 `docs/adr/`

改动组件间接口之前先读对应 ADR。接口决策不能只体现在代码里。

| ADR | 决策 | 何时必读 |
| --- | --- | --- |
| 0001 | canonical 尺码以 EU 整档存储 | 碰尺码、换算、尺码表 |
| 0002 | 保留两份 repository 薄壳，不合并 | 想「顺便合并」SQLite/Postgres 实现时 |
| 0003 | 建表用幂等 DDL，不引入迁移工具 | 碰 TypeScript 侧建表 |
| 0004 | AI 输出永不携带价格 | 碰 AI 输出、prompt、商品卡片 |
| 0005 | 共享领域层 `src/domain/`，`server/` 不得被客户端运行时导入 | 碰客户端组件导入 |
| 0006 | 包管理器层从 Bun 迁移到 npm | 碰依赖、锁文件、CI |
| 0007 | TypeScript 展示库使用版本化 Drizzle 迁移 | 碰 `drizzle/` 迁移 |

## 改 Next.js 之前

先读当前安装版本随包发布的文档：`node_modules/next/dist/docs/`。这是本项目指定的权威来源；
不要用旧版本的记忆，也不要用搜索引擎文章替代仓库内文档。缓存、metadata、Route Handler、
环境变量与数据获取的行为都可能与本项目既有约定不同。
