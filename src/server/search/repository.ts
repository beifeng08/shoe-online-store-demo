import { and, asc, eq, lt, sql } from 'drizzle-orm'
import {
  aiBudgetDays,
  aiBudgetReservations,
  aiUsage,
  productEmbeddings,
  products,
} from '@/db/schema'
import { db } from '@/db/client'
import type { AppDb, PgAppDb } from '@/db/client'
import { resolveDbDriver } from '@/db/dialect'
import type { ProductRecord } from '@/db/product-row'
import { parseVector } from './vector'
import { createPostgresRepository } from './repository-postgres'
import type { EmbeddingRow } from './embedding-row'
import type {
  BudgetReservationInput,
  BudgetSettlementInput,
  BudgetUsage,
} from '@/server/guardrails/budget-contract'

// 仓储负责持久化读写；目录组合筛选留在内存，精确键查询下推到 SQL。
// listAllProducts 适用于需要完整目录快照的场景；按 handle 查找使用 findProductByHandle，避免重复整表读取。
export function createRepository(db: AppDb) {
  async function abandonDailyBudget(requestId: string, before?: number): Promise<boolean> {
    return db.transaction((tx) => {
      const [reservation] = tx
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.requestId, requestId))
        .limit(1)
        .all()
      if (!reservation) return false
      if (reservation.status === 'abandoned') return before === undefined
      if (
        reservation.status !== 'pending' ||
        (before !== undefined && reservation.createdAt >= before)
      )
        return false
      const [updated] = tx
        .update(aiBudgetDays)
        .set({
          reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${reservation.reservedTokens}`,
          usedTokens: sql`${aiBudgetDays.usedTokens} + ${reservation.reservedTokens}`,
        })
        .where(eq(aiBudgetDays.day, reservation.day))
        .returning()
        .all()
      if (!updated) throw new Error('AI budget reservation day is missing')
      tx.update(aiBudgetReservations)
        .set({
          status: 'abandoned',
          actualTokens: reservation.reservedTokens,
        })
        .where(eq(aiBudgetReservations.requestId, requestId))
        .run()
      return true
    })
  }

  return {
    // Unknown provider costs retain the full estimate rather than refunding the budget.
    abandonDailyBudget,
    async recoverDailyBudgetReservations(before: number, limit = 100): Promise<number> {
      if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(limit) || limit <= 0) return 0
      const rows = db
        .select({ requestId: aiBudgetReservations.requestId })
        .from(aiBudgetReservations)
        .where(
          and(
            eq(aiBudgetReservations.status, 'pending'),
            lt(aiBudgetReservations.createdAt, before),
          ),
        )
        .orderBy(asc(aiBudgetReservations.createdAt), asc(aiBudgetReservations.requestId))
        .limit(Math.min(100, Math.floor(limit)))
        .all()
      let recovered = 0
      for (const row of rows) if (await abandonDailyBudget(row.requestId, before)) recovered++
      return recovered
    },
    async reserveDailyBudget(input: BudgetReservationInput): Promise<boolean> {
      const tokens = Math.max(0, Math.floor(input.tokens))
      const cap = Math.max(0, Math.floor(input.cap))
      if (
        !input.requestId ||
        !input.day ||
        !Number.isSafeInteger(tokens) ||
        !Number.isSafeInteger(cap) ||
        tokens <= 0 ||
        cap <= 0
      )
        return false
      return db.transaction((tx) => {
        const [existing] = tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
          .all()
        if (existing)
          return (
            existing.status === 'pending' &&
            existing.day === input.day &&
            existing.reservedTokens === tokens
          )

        tx.insert(aiBudgetDays)
          .values({
            day: input.day,
            reservedTokens: 0,
            // Bootstrap existing ledgers when upgrading to atomic reservations.
            usedTokens: sql`(select coalesce(sum(prompt_tokens + completion_tokens), 0) from ai_usage where day = ${input.day})`,
          })
          .onConflictDoNothing()
          .run()
        const [updated] = tx
          .update(aiBudgetDays)
          .set({ reservedTokens: sql`${aiBudgetDays.reservedTokens} + ${tokens}` })
          .where(
            and(
              eq(aiBudgetDays.day, input.day),
              sql`${aiBudgetDays.reservedTokens} + ${aiBudgetDays.usedTokens} + ${tokens} <= ${cap}`,
            ),
          )
          .returning({ day: aiBudgetDays.day })
          .all()
        if (!updated) return false
        tx.insert(aiBudgetReservations)
          .values({
            requestId: input.requestId,
            day: input.day,
            reservedTokens: tokens,
            actualTokens: 0,
            status: 'pending',
            createdAt: Date.now(),
          })
          .run()
        return true
      })
    },
    async settleDailyBudget(input: BudgetSettlementInput): Promise<boolean> {
      if (
        ![input.usage.promptTokens, input.usage.completionTokens].every(
          (tokens) => Number.isSafeInteger(tokens) && tokens >= 0,
        )
      )
        return false
      const actualTokens = input.usage.promptTokens + input.usage.completionTokens
      if (!Number.isSafeInteger(actualTokens)) return false
      return db.transaction((tx) => {
        const [reservation] = tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
          .all()
        if (!reservation || reservation.day !== input.usage.day) return false
        if (reservation.status === 'settled') return reservation.actualTokens === actualTokens
        if (reservation.status !== 'pending') return false
        const [claimed] = tx
          .update(aiBudgetReservations)
          .set({ status: 'settling' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, input.requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
          .all()
        if (!claimed) return false
        // Admission enforces the cap; already incurred usage must still be accounted for.
        const [updated] = tx
          .update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens}`,
            usedTokens: sql`${aiBudgetDays.usedTokens} + ${actualTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
          .returning()
          .all()
        if (!updated) throw new Error('AI budget reservation day is missing')
        tx.insert(aiUsage)
          .values({ ...input.usage, createdAt: Date.now() })
          .run()
        tx.update(aiBudgetReservations)
          .set({ status: 'settled', actualTokens })
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .run()
        return true
      })
    },
    async releaseDailyBudget(requestId: string): Promise<boolean> {
      return db.transaction((tx) => {
        const [reservation] = tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, requestId))
          .limit(1)
          .all()
        if (!reservation) return false
        if (reservation.status === 'released') return true
        if (reservation.status !== 'pending') return false
        const [claimed] = tx
          .update(aiBudgetReservations)
          .set({ status: 'released' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
          .all()
        if (!claimed) return false
        tx.update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
          .run()
        return true
      })
    },
    async getEmbedding(productId: string): Promise<EmbeddingRow | null> {
      const row = await db
        .select()
        .from(productEmbeddings)
        .where(eq(productEmbeddings.productId, productId))
        .limit(1)
      return row[0]
        ? {
            productId: row[0].productId,
            contentHash: row[0].contentHash,
            model: row[0].model,
            vector: parseVector(row[0].vector),
          }
        : null
    },
    async upsertEmbedding(row: EmbeddingRow): Promise<void> {
      await db
        .insert(productEmbeddings)
        .values({
          productId: row.productId,
          contentHash: row.contentHash,
          model: row.model,
          vector: JSON.stringify(row.vector),
        })
        .onConflictDoUpdate({
          target: productEmbeddings.productId,
          set: {
            contentHash: row.contentHash,
            model: row.model,
            vector: JSON.stringify(row.vector),
          },
        })
    },
    async allEmbeddings(model: string): Promise<EmbeddingRow[]> {
      const rows = await db
        .select()
        .from(productEmbeddings)
        .where(eq(productEmbeddings.model, model))
      return rows.map((r) => ({
        productId: r.productId,
        contentHash: r.contentHash,
        model: r.model,
        vector: parseVector(r.vector),
      }))
    },
    async insertUsage(u: BudgetUsage): Promise<void> {
      await db.insert(aiUsage).values({ ...u, createdAt: Date.now() })
    },
    async dayTokenUsage(day: string): Promise<number> {
      const [row] = await db
        .select({
          total: sql<number>`coalesce(sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens}), 0)
            + (select coalesce(sum(actual_tokens), 0) from ai_budget_reservations
               where day = ${day} and status = 'abandoned')`,
        })
        .from(aiUsage)
        .where(eq(aiUsage.day, day))
      return Number(row?.total ?? 0)
    },
    async wipe(): Promise<void> {
      // 仅测试
      await db.delete(aiBudgetReservations)
      await db.delete(aiBudgetDays)
      await db.delete(productEmbeddings)
      await db.delete(aiUsage)
      await db.delete(products)
    },
    // ---- products 表（DB 为运行时目录源）----
    async countProducts(): Promise<number> {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(products)
      return Number(row?.n ?? 0)
    },
    async listAllProducts(): Promise<ProductRecord[]> {
      return db.select().from(products)
    },
    async findProductByHandle(handle: string): Promise<ProductRecord | null> {
      const [row] = await db.select().from(products).where(eq(products.handle, handle)).limit(1)
      return row ?? null
    },
    // Atomic add-only initialization: ignore ID conflicts, never overwrite edits.
    async insertMissingProducts(records: ProductRecord[]): Promise<number> {
      if (records.length === 0) return 0
      return db.transaction((tx) => {
        let inserted = 0
        for (const record of records) {
          inserted += tx
            .insert(products)
            .values(record)
            .onConflictDoNothing({ target: products.id })
            .run().changes
        }
        return inserted
      })
    },
  }
}

export type Repository = ReturnType<typeof createRepository>

/** 按 DB_DRIVER 返回默认驱动实现（sqlite 本地 / postgres 云端）。
 * db() 负责 driver 分派并缓存两种连接；此处仅做类型收窄到对应驱动接口。 */
export function createDefaultRepository(): Repository {
  const connection = db()
  return resolveDbDriver() === 'postgres'
    ? createPostgresRepository(connection as PgAppDb)
    : createRepository(connection as AppDb)
}
