// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import { ensurePgTables, type PgAppDb } from '@/db/client'
import { schema, products, aiBudgetDays, aiBudgetReservations, aiUsage } from '@/db/schema-postgres'
import { productToRecord } from '@/db/product-row'
import { DbCatalogAdapter } from '@/server/catalog/db-adapter'
import { seedProducts } from '@/server/catalog/seed'
import { createPostgresRepository } from './repository-postgres'

const testUrl = process.env.AI_TEST_POSTGRES_URL

describe.runIf(Boolean(testUrl))('PostgreSQL product and atomic budget integration', () => {
  const ownedSchema = `ai_budget_test_${randomUUID().replaceAll('-', '')}`
  let admin: ReturnType<typeof postgres> | undefined
  let client: ReturnType<typeof postgres> | undefined
  let db: PgAppDb
  let repo: ReturnType<typeof createPostgresRepository>
  let created = false
  const day = '2026-10-01'
  const usage = { day, model: 'mock', promptTokens: 20, completionTokens: 10, sessionKey: 'test' }

  beforeAll(async () => {
    const url = new URL(testUrl!)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.pathname.endsWith('_test') ||
      url.searchParams.has('options')
    ) {
      throw new Error('AI integration requires a dedicated loopback PostgreSQL _test database')
    }
    admin = postgres(testUrl!, { max: 1, ssl: false, connect_timeout: 10, onnotice: () => {} })
    await admin`CREATE SCHEMA ${admin(ownedSchema)}`
    created = true
    client = postgres(testUrl!, {
      max: 10,
      ssl: false,
      connect_timeout: 10,
      onnotice: () => {},
      connection: { search_path: ownedSchema, statement_timeout: 15000, lock_timeout: 10000 },
    })
    db = drizzle(client, { schema })
    await ensurePgTables(db)
    repo = createPostgresRepository(db)
    // Warm independent connections so simultaneous operations do not serialize at startup.
    await Promise.all(Array.from({ length: 10 }, () => client!`SELECT pg_sleep(0.02)`))
  }, 20000)

  beforeEach(async () => {
    await db.delete(aiBudgetReservations)
    await db.delete(aiBudgetDays)
    await db.delete(aiUsage)
    await db.delete(products)
  })

  afterAll(async () => {
    await client?.end({ timeout: 5 })
    try {
      if (created && admin) await admin`DROP SCHEMA ${admin(ownedSchema)} CASCADE`
    } finally {
      await admin?.end({ timeout: 5 })
    }
  })

  it('inserts only missing product IDs and preserves existing edits', async () => {
    const rows = seedProducts.slice(0, 2).map(productToRecord)
    expect(await repo.insertMissingProducts([])).toBe(0)
    expect(await repo.insertMissingProducts(rows)).toBe(2)
    const edited = { ...rows[0], title: 'PostgreSQL retained edit', priceAmount: 13 }
    await db
      .update(products)
      .set({ title: edited.title, priceAmount: edited.priceAmount })
      .where(eq(products.id, edited.id))
    expect(await repo.insertMissingProducts([rows[0], rows[1], rows[0]])).toBe(0)
    expect(await repo.findProductByHandle(edited.handle)).toEqual(edited)
  })

  it('rolls back the entire product batch on a conflicting handle', async () => {
    const rows = seedProducts.slice(0, 3).map(productToRecord)
    await repo.insertMissingProducts([rows[1]])
    const before = await repo.listAllProducts()
    await expect(
      repo.insertMissingProducts([rows[0], { ...rows[2], handle: rows[1].handle }]),
    ).rejects.toThrow()
    expect(await repo.listAllProducts()).toEqual(before)
  })

  it('counts concurrent reversed product batches once without overwriting edits', async () => {
    const rows = seedProducts.map(productToRecord)
    const edited = { ...rows[0], title: 'Concurrent PostgreSQL edit', priceAmount: 17 }
    await repo.insertMissingProducts([edited])
    const counts = await Promise.all([
      repo.insertMissingProducts(rows),
      repo.insertMissingProducts([...rows].reverse()),
    ])
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(rows.length - 1)
    expect(await repo.countProducts()).toBe(rows.length)
    expect(await repo.findProductByHandle(edited.handle)).toEqual(edited)
  })

  it('counts reversed batches with distinct Unicode IDs using one lock order', async () => {
    const rows = [
      { ...productToRecord(seedProducts[0]), id: '\u00e9' },
      { ...productToRecord(seedProducts[1]), id: 'e\u0301' },
    ]
    const counts = await Promise.all([
      repo.insertMissingProducts(rows),
      repo.insertMissingProducts([...rows].reverse()),
    ])
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2)
    expect(await repo.countProducts()).toBe(2)
    expect(await repo.findProductByHandle(rows[0].handle)).toEqual(rows[0])
    expect(await repo.findProductByHandle(rows[1].handle)).toEqual(rows[1])
  })

  it('reads empty and edited products on a read-only PostgreSQL connection', async () => {
    const readClient = postgres(testUrl!, {
      max: 1,
      ssl: false,
      connect_timeout: 10,
      onnotice: () => {},
      connection: { search_path: ownedSchema, statement_timeout: 15000, lock_timeout: 10000 },
    })
    try {
      const readDb = drizzle(readClient, { schema })
      // Schema migration is explicitly completed before applying the read-only boundary.
      await ensurePgTables(readDb)
      await readClient`SET default_transaction_read_only = on`
      const adapter = new DbCatalogAdapter(() => createPostgresRepository(readDb))
      expect(await adapter.getProducts()).toEqual([])
      expect(await adapter.getProductByHandle(seedProducts[0].handle)).toBeNull()
      const edited = { ...productToRecord(seedProducts[1]), title: 'Read-only PostgreSQL edit' }
      await repo.insertMissingProducts([edited])
      const before = await repo.listAllProducts()
      expect(await adapter.getProducts()).toHaveLength(1)
      expect((await adapter.getProductByHandle(edited.handle))?.title).toBe(edited.title)
      expect(await adapter.getProductByHandle(seedProducts[0].handle)).toBeNull()
      expect(await repo.listAllProducts()).toEqual(before)
    } finally {
      await readClient.end({ timeout: 5 })
    }
  })

  it('serializes duplicate reservation requests without errors or double counting', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repo.reserveDailyBudget({ requestId: 'duplicate', day, tokens: 60, cap: 100 }),
      ),
    )
    expect(results).toEqual(Array(8).fill(true))
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 60, usedTokens: 0 },
    ])
    expect(await db.select().from(aiBudgetReservations)).toHaveLength(1)
  })

  it('reserves no more than the cap across independent connections', async () => {
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        repo.reserveDailyBudget({ requestId: `parallel-${i}`, day, tokens: 60, cap: 100 }),
      ),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 60, usedTokens: 0 },
    ])
  })

  it('settles concurrent retries exactly once', async () => {
    await repo.reserveDailyBudget({ requestId: 'settle', day, tokens: 80, cap: 100 })
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repo.settleDailyBudget({ requestId: 'settle', usage, cap: 100 }),
      ),
    )
    expect(results).toEqual(Array(8).fill(true))
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 0, usedTokens: 30 },
    ])
    expect(await db.select().from(aiUsage)).toHaveLength(1)
  })

  it('releases concurrent retries exactly once', async () => {
    await repo.reserveDailyBudget({ requestId: 'release', day, tokens: 80, cap: 100 })
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repo.releaseDailyBudget('release')),
    )
    expect(results).toEqual(Array(8).fill(true))
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 0, usedTokens: 0 },
    ])
  })

  it('records usage above the admission cap and rejects changed settlement retries', async () => {
    await repo.reserveDailyBudget({ requestId: 'overrun', day, tokens: 80, cap: 100 })
    const input = { requestId: 'overrun', usage: { ...usage, completionTokens: 100 }, cap: 100 }
    expect(await repo.settleDailyBudget(input)).toBe(true)
    expect(await repo.settleDailyBudget(input)).toBe(true)
    expect(await repo.settleDailyBudget({ ...input, usage })).toBe(false)
    expect(await repo.reserveDailyBudget({ requestId: 'next', day, tokens: 1, cap: 100 })).toBe(
      false,
    )
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 0, usedTokens: 120 },
    ])
    expect(await repo.dayTokenUsage(day)).toBe(120)
    expect(await db.select().from(aiUsage)).toHaveLength(1)
  })

  it('recovers at most 100 old reservations per batch and leaves live work pending', async () => {
    for (let i = 0; i < 101; i++)
      await repo.reserveDailyBudget({ requestId: `old-${i}`, day, tokens: 1, cap: 1000 })
    await db.update(aiBudgetReservations).set({ createdAt: 0 })
    await repo.reserveDailyBudget({ requestId: 'live', day, tokens: 1, cap: 1000 })
    expect(await repo.recoverDailyBudgetReservations(1, 1000)).toBe(100)
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 2, usedTokens: 100 },
    ])
    expect(await repo.recoverDailyBudgetReservations(1)).toBe(1)
    expect(await repo.recoverDailyBudgetReservations(1)).toBe(0)
    expect(
      await db
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.requestId, 'live')),
    ).toMatchObject([{ status: 'pending' }])
    expect(await repo.dayTokenUsage(day)).toBe(101)
    expect(await db.select().from(aiUsage)).toHaveLength(0)
  })

  it.each(['settle', 'release'] as const)(
    'serializes stale recovery racing with %s',
    async (operation) => {
      await repo.reserveDailyBudget({ requestId: 'race', day, tokens: 80, cap: 100 })
      await db.update(aiBudgetReservations).set({ createdAt: 0 })
      await Promise.all([
        ...Array.from({ length: 8 }, () => repo.recoverDailyBudgetReservations(1)),
        operation === 'settle'
          ? repo.settleDailyBudget({ requestId: 'race', usage })
          : repo.releaseDailyBudget('race'),
      ])
      const [reservation] = await db.select().from(aiBudgetReservations)
      const usedTokens = reservation.status === 'abandoned' ? 80 : operation === 'settle' ? 30 : 0
      expect(['abandoned', operation === 'settle' ? 'settled' : 'released']).toContain(
        reservation.status,
      )
      expect(await db.select().from(aiBudgetDays)).toMatchObject([
        { reservedTokens: 0, usedTokens },
      ])
      expect(await repo.dayTokenUsage(day)).toBe(usedTokens)
      expect(await repo.recoverDailyBudgetReservations(1)).toBe(0)
      if (reservation.status === 'abandoned') {
        expect(await repo.settleDailyBudget({ requestId: 'race', usage })).toBe(false)
        expect(await repo.releaseDailyBudget('race')).toBe(false)
      }
    },
  )

  it('rolls back recovery counters if persisting the abandoned status fails', async () => {
    await repo.reserveDailyBudget({ requestId: 'recovery-failure', day, tokens: 80, cap: 100 })
    await db.execute(
      sql`ALTER TABLE ai_budget_reservations ADD CONSTRAINT reject_recovery CHECK (status <> 'abandoned')`,
    )
    try {
      await expect(repo.abandonDailyBudget('recovery-failure')).rejects.toThrow()
      expect(await db.select().from(aiBudgetDays)).toMatchObject([
        { reservedTokens: 80, usedTokens: 0 },
      ])
      expect(await db.select().from(aiBudgetReservations)).toMatchObject([{ status: 'pending' }])
    } finally {
      await db.execute(sql`ALTER TABLE ai_budget_reservations DROP CONSTRAINT reject_recovery`)
    }
    expect(await repo.abandonDailyBudget('recovery-failure')).toBe(true)
    expect(await repo.abandonDailyBudget('recovery-failure')).toBe(true)
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 0, usedTokens: 80 },
    ])
  })

  it('keeps the pending reservation and counters intact if usage insertion fails', async () => {
    await db.execute(
      sql`ALTER TABLE ai_usage ADD CONSTRAINT reject_test_model CHECK (model <> 'fail')`,
    )
    try {
      await repo.reserveDailyBudget({ requestId: 'rollback', day, tokens: 80, cap: 100 })
      await expect(
        repo.settleDailyBudget({
          requestId: 'rollback',
          usage: { ...usage, model: 'fail' },
          cap: 100,
        }),
      ).rejects.toThrow()
      expect(await db.select().from(aiBudgetDays)).toMatchObject([
        { reservedTokens: 80, usedTokens: 0 },
      ])
      expect(await db.select().from(aiBudgetReservations)).toMatchObject([{ status: 'pending' }])
      expect(await db.select().from(aiUsage)).toHaveLength(0)
      expect(await repo.settleDailyBudget({ requestId: 'rollback', usage, cap: 100 })).toBe(true)
    } finally {
      await db.execute(sql`ALTER TABLE ai_usage DROP CONSTRAINT reject_test_model`)
    }
  })

  it('accounts for pre-upgrade usage when the first day counter is created', async () => {
    await db.insert(aiUsage).values({ ...usage, promptTokens: 80, createdAt: Date.now() })
    expect(
      await repo.reserveDailyBudget({ requestId: 'too-large', day, tokens: 20, cap: 100 }),
    ).toBe(false)
    expect(await repo.reserveDailyBudget({ requestId: 'fits', day, tokens: 10, cap: 100 })).toBe(
      true,
    )
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { reservedTokens: 10, usedTokens: 90 },
    ])
  })

  it('rejects changed retry inputs and settlement on a different UTC day', async () => {
    expect(
      await repo.reserveDailyBudget({ requestId: 'identity', day, tokens: 80, cap: 100 }),
    ).toBe(true)
    expect(
      await repo.reserveDailyBudget({ requestId: 'identity', day, tokens: 20, cap: 100 }),
    ).toBe(false)
    expect(
      await repo.reserveDailyBudget({
        requestId: 'identity',
        day: '2026-10-02',
        tokens: 80,
        cap: 100,
      }),
    ).toBe(false)
    expect(
      await repo.settleDailyBudget({
        requestId: 'identity',
        usage: { ...usage, day: '2026-10-02' },
      }),
    ).toBe(false)
    expect(await db.select().from(aiBudgetDays)).toMatchObject([
      { day, reservedTokens: 80, usedTokens: 0 },
    ])
    expect(await db.select().from(aiUsage)).toHaveLength(0)
  })
})
