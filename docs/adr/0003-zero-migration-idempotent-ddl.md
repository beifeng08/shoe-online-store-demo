# 0003 — 建表用幂等 DDL，不引入迁移工具

**状态：** 已被 [ADR 0007](./0007-versioned-typescript-migrations.md) 取代 · **日期：** 2026-09-15（重构期决策）

本文保留当时的历史决策和背景。当前 TypeScript 展示/AI 数据库已改为版本化
Drizzle 迁移；Python commerce 仍由 Alembic 管理，二者不共用迁移目录。

## 背景

表结构有**三个**潜在真源：`src/db/schema.ts`（drizzle sqlite）、`src/db/schema-postgres.ts`，
以及 `src/db/client.ts` 里内联的 `CREATE TABLE IF NOT EXISTS` DDL。一次架构审查指出这是重复，
并提出两件事：把 DDL 收敛成单一来源，以及**改用 drizzle-kit 迁移**来取代内联 DDL。

必须先把两件事分开：**「DDL 重复」与「该不该用迁移工具」是两个独立问题。**

## 决策

**不引入 drizzle-kit 迁移。** 保留「启动时幂等建表」这一形态。

理由：本项目的部署形态决定了迁移工具解决的是一个**不存在的问题**。

- 演示站的运行时库是 SQLite，落在 Vercel 函数的 `/tmp/evoloop.db` —— **每个实例冷启动都是空库**。
  `DbCatalogAdapter` 的设计正是「表空则从导入层灌种一次」。没有需要跨版本保留的数据，
  迁移脚本无从谈起。
  （2026-10-19 R3 起读取不再灌种：任何空库部署都必须先运行 `npm run catalog:initialize`，
  否则运行时目录为空；该冷启动前提已不成立。）
- 需要建的表只有三张（`products` / `product_embeddings` / `ai_usage`），且 DDL 只有
  `CREATE TABLE IF NOT EXISTS` 这一种形态，没有 `ALTER`。
- 引入迁移会带来一条**必须在部署前手工执行**的步骤，这是演示站最不该有的运维面。

关于 DDL 重复：`schema-parity.test.ts` 已断言 sqlite 与 postgres 定义同构，`product-row.ts` 是
唯一的行编解码真源。把 `client.ts` 的内联 DDL 与 drizzle schema 合一，需要 drizzle 在运行时不依赖
迁移产物地导出 DDL —— 收益是消除一处三份文本，代价是给「启动即可用」这条路径增加耦合。
**本次重构不做**（记为「不做 C2/C3」），理由与 ADR 0002 同源：不为了让文本更短而给关键路径加机制。

## 后果

#### 正面

- 部署零步骤：冷启动直接可用。
- 无迁移产物、无 `drizzle-kit` 依赖、无 schema 快照文件需要维护。

#### 负面 / 接受的风险

- **没有版本化演进能力**：将来真要保留数据，必须补迁移，且届时需处理既有部署的空库/半库状态。
- 三处表形状真源继续存在，靠 `schema-parity.test.ts` 与人工纪律约束。
- `ensurePgTables()` 目前作为**每个** postgres repository 方法的前置调用（用 `pgTablesReady`
  WeakMap 去重）—— 这是一个泄漏的抽象：新增方法必须记得调用它。已知，未修（C3）。

## 相关

`src/db/client.ts` · `src/db/schema.ts` · `src/db/schema-postgres.ts` ·
`src/db/schema-parity.test.ts` · 本计划「不做 C2/C3」
