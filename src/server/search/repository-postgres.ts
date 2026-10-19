import { and, asc, eq, lt, sql } from 'drizzle-orm'
import {
  aiBudgetDays,
  aiBudgetReservations,
  aiUsage,
  productEmbeddings,
  products,
} from '@/db/schema-postgres'
import { ensurePgTables } from '@/db/client'
import type { PgAppDb } from '@/db/client'
import type { ProductRecord } from '@/db/product-row'
import { parseVector } from './vector'
import type { EmbeddingRow } from './embedding-row'
import type {
  BudgetReservationInput,
  BudgetSettlementInput,
  BudgetUsage,
} from '@/server/guardrails/budget-contract'

// Lock an ID even before its reservation row exists; retries share this transaction lock.
const lockBudgetRequest = (tx: Pick<PgAppDb, 'execute'>, requestId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai_budget:${requestId}`}, 0))`)

/** Postgres 实现：方法形状与 sqlite 版完全一致 → 可当 Repository 用。 */
export function createPostgresRepository(db: PgAppDb) {
  async function abandonDailyBudget(requestId: string, before?: number): Promise<boolean> {
    await ensurePgTables(db)
    return db.transaction(async (tx) => {
      await lockBudgetRequest(tx, requestId)
      const [reservation] = await tx
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.requestId, requestId))
        .limit(1)
      if (!reservation) return false
      if (reservation.status === 'abandoned') return before === undefined
      if (
        reservation.status !== 'pending' ||
        (before !== undefined && reservation.createdAt >= before)
      )
        return false
      const [updated] = await tx
        .update(aiBudgetDays)
        .set({
          reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${reservation.reservedTokens}`,
          usedTokens: sql`${aiBudgetDays.usedTokens} + ${reservation.reservedTokens}`,
        })
        .where(eq(aiBudgetDays.day, reservation.day))
        .returning()
      if (!updated) throw new Error('AI budget reservation day is missing')
      await tx
        .update(aiBudgetReservations)
        .set({
          status: 'abandoned',
          actualTokens: reservation.reservedTokens,
        })
        .where(eq(aiBudgetReservations.requestId, requestId))
      return true
    })
  }

  return {
    abandonDailyBudget,
    async recoverDailyBudgetReservations(before: number, limit = 100): Promise<number> {
      if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(limit) || limit <= 0) return 0
      await ensurePgTables(db)
      const rows = await db
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
      await ensurePgTables(db)
      return db.transaction(async (tx) => {
        await lockBudgetRequest(tx, input.requestId)
        const [existing] = await tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
        if (existing)
          return (
            existing.status === 'pending' &&
            existing.day === input.day &&
            existing.reservedTokens === tokens
          )

        await tx
          .insert(aiBudgetDays)
          .values({
            day: input.day,
            reservedTokens: 0,
            // Bootstrap existing ledgers when upgrading to atomic reservations.
            usedTokens: sql`(select coalesce(sum(prompt_tokens + completion_tokens), 0) from ai_usage where day = ${input.day})`,
          })
          .onConflictDoNothing()
        const [updated] = await tx
          .update(aiBudgetDays)
          .set({ reservedTokens: sql`${aiBudgetDays.reservedTokens} + ${tokens}` })
          .where(
            and(
              eq(aiBudgetDays.day, input.day),
              sql`${aiBudgetDays.reservedTokens} + ${aiBudgetDays.usedTokens} + ${tokens} <= ${cap}`,
            ),
          )
          .returning({ day: aiBudgetDays.day })
        if (!updated) return false
        await tx.insert(aiBudgetReservations).values({
          requestId: input.requestId,
          day: input.day,
          reservedTokens: tokens,
          actualTokens: 0,
          status: 'pending',
          createdAt: Date.now(),
        })
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
      await ensurePgTables(db)
      return db.transaction(async (tx) => {
        await lockBudgetRequest(tx, input.requestId)
        const [reservation] = await tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
        if (!reservation || reservation.day !== input.usage.day) return false
        if (reservation.status === 'settled') return reservation.actualTokens === actualTokens
        if (reservation.status !== 'pending') return false
        const [claimed] = await tx
          .update(aiBudgetReservations)
          .set({ status: 'settling' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, input.requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
        if (!claimed) return false
        // Admission enforces the cap; already incurred usage must still be accounted for.
        const [updated] = await tx
          .update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens}`,
            usedTokens: sql`${aiBudgetDays.usedTokens} + ${actualTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
          .returning()
        if (!updated) throw new Error('AI budget reservation day is missing')
        await tx.insert(aiUsage).values({ ...input.usage, createdAt: Date.now() })
        await tx
          .update(aiBudgetReservations)
          .set({ status: 'settled', actualTokens })
          .where(eq(aiBudgetReservations.requestId, input.requestId))
        return true
      })
    },
    async releaseDailyBudget(requestId: string): Promise<boolean> {
      await ensurePgTables(db)
      return db.transaction(async (tx) => {
        await lockBudgetRequest(tx, requestId)
        const [reservation] = await tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, requestId))
          .limit(1)
        if (!reservation) return false
        if (reservation.status === 'released') return true
        if (reservation.status !== 'pending') return false
        const [claimed] = await tx
          .update(aiBudgetReservations)
          .set({ status: 'released' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
        if (!claimed) return false
        await tx
          .update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
        return true
      })
    },
    async getEmbedding(productId: string): Promise<EmbeddingRow | null> {
      await ensurePgTables(db)
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
      await ensurePgTables(db)
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
      await ensurePgTables(db)
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
      await ensurePgTables(db)
      await db.insert(aiUsage).values({ ...u, createdAt: Date.now() })
    },
    async dayTokenUsage(day: string): Promise<number> {
      await ensurePgTables(db)
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
      await ensurePgTables(db)
      await db.delete(aiBudgetReservations)
      await db.delete(aiBudgetDays)
      await db.delete(productEmbeddings)
      await db.delete(aiUsage)
      await db.delete(products)
    },
    // ---- products 表（DB 为运行时目录源；与 sqlite 实现同形）----
    async countProducts(): Promise<number> {
      await ensurePgTables(db)
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(products)
      return Number(row?.n ?? 0)
    },
    async listAllProducts(): Promise<ProductRecord[]> {
      await ensurePgTables(db)
      return db.select().from(products)
    },
    async findProductByHandle(handle: string): Promise<ProductRecord | null> {
      await ensurePgTables(db)
      const [row] = await db.select().from(products).where(eq(products.handle, handle)).limit(1)
      return row ?? null
    },
    async insertMissingProducts(records: ProductRecord[]): Promise<number> {
      if (records.length === 0) return 0
      await ensurePgTables(db)
      return db.transaction(async (tx) => {
        let inserted = 0
        // Use a total string order: locale collation can equate distinct Unicode IDs.
        for (const record of [...records].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        )) {
          const rows = await tx
            .insert(products)
            .values(record)
            .onConflictDoNothing({ target: products.id })
            .returning({ id: products.id })
          inserted += rows.length
        }
        return inserted
      })
    },
  }
}
