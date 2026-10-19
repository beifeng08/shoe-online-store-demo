# 0002 — 保留两份 repository 薄壳，不合并

**状态：** 已采纳 · **日期：** 2026-09-15（重构期决策）

## 背景

`src/server/search/repository.ts`（sqlite 走 `better-sqlite3`）与 `repository-postgres.ts`
（postgres 走 `postgres`）是**近乎逐行同构**的两份实现。一次架构审查据此提出：应当合并为一份
「按方言分派」的实现，消除重复。

当时的重复确实存在且刺眼：`ProductRecord` 的字段映射在两个文件里各写三遍（`listAllProducts`、
`upsertProducts` 的 insert values、`onConflictDoUpdate` 的 set），六处共 18 个字段的长手写法。

## 决策

分两步拆开这个「重复」：

1. **真正的重复是行映射**，它与方言无关 —— 用一个共享模块消除：`src/db/product-row.ts` 增加
   `withoutId(r)`，两处 `listAllProducts` 直接返回 drizzle 行（查询结果的形状**恰好**等于
   `ProductRecord`，18 列名与类型全对，六处映射其实都是恒等投影），`upsertProducts` 传 `.values(r)`
   与 `.onConflictDoUpdate({ target, set: withoutId(r) })`。**已执行。**
   2026-10-19（R3）：目录读取不再灌种后 `upsertProducts` 没有生产调用方，与 `withoutId` 一并删除；
   产品写入只剩显式初始化的 `insertMissingProducts`（`onConflictDoNothing`），两份实现仍各自保留。
2. **两份 repository 本体保留**，不做合并。**本条 ADR 记录的即为此决策。**

理由：drizzle 的 sqlite 与 postgres 驱动是**两套不同的 builder 类型**，`onConflictDoUpdate`、
`select().from()` 的返回类型与 `AppDb`/`PgAppDb` 都不同。把它们塞进一份实现，必然要么在函数内
做方言分支（把「哪个方言」这个已由 `DB_DRIVER` 决定的事实再判断一次），要么靠类型断言抹平差异。
两者都比两份 90 行的直白实现更糟：**合并消除的是文本重复，引入的是类型层面的不诚实。**

`repository-postgres.integration.test.ts` 与 `products-repo.test.ts` 复用同一批行为断言，这本身就是
「两份实现必须同形」的可执行契约，比合并更能防止它们漂移。

## 后果

#### 正面

- 每一份实现都是单一方言的直线代码，无分支、无断言。
- 方言差异（类型名、驱动构造）留在各自文件，不污染调用方。
- 行映射只有一处真源，新增列时只需改 `product-row.ts` 与两个 schema。

#### 负面 / 需要持续承担

- 新增一个 repository 方法要写两遍。缓解：行为断言共用，漂移会被测试抓到。
- `AppDb`/`PgAppDb` 的 `as` 转换仍留在 `createDefaultRepository`（一处，且有 `resolveDbDriver()`
  作依据）。

## 相关

`src/db/product-row.ts` · `src/server/search/repository.ts` · `repository-postgres.ts` ·
本计划「不做 C1」
