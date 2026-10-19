// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import * as dbClient from '@/db/client'
import type { PgAppDb } from '@/db/client'
import { createPostgresRepository } from './repository-postgres'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDb } from '@/db/client'
import { createRepository } from '@/server/search/repository'
import { seedProducts } from '@/server/catalog/seed'
import { productToRecord } from '@/db/product-row'
import { products } from '@/db/schema'
import { eq } from 'drizzle-orm'

describe('products table repository (decision #17)', () => {
  const db = createDb(':memory:')
  const repo = createRepository(db)
  beforeEach(async () => {
    await repo.wipe()
  })
  afterAll(() => db.$client.close())

  it('inserts only missing IDs, counts actual writes and accepts an empty batch', async () => {
    const rows = seedProducts.slice(0, 2).map(productToRecord)
    await expect(repo.insertMissingProducts([])).resolves.toBe(0)
    await expect(repo.insertMissingProducts(rows)).resolves.toBe(2)
    const edited = { ...rows[0], title: 'Keep every column', priceAmount: 3 }
    db.update(products)
      .set({ title: edited.title, priceAmount: edited.priceAmount })
      .where(eq(products.id, edited.id))
      .run()
    await expect(repo.insertMissingProducts([rows[0], rows[1], rows[0]])).resolves.toBe(0)
    expect(await repo.findProductByHandle(edited.handle)).toEqual(edited)
  })

  it('rejects handle conflicts and rolls back the entire missing-row batch', async () => {
    const rows = seedProducts.slice(0, 3).map(productToRecord)
    await repo.insertMissingProducts([rows[1]])
    const before = await repo.listAllProducts()
    await expect(
      repo.insertMissingProducts([rows[0], { ...rows[2], handle: rows[1].handle }]),
    ).rejects.toThrow()
    expect(await repo.listAllProducts()).toEqual(before)
  })

  it('preserves a concurrent SQLite edit after a proven writer-lock conflict and retry', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'catalog-init-'))
    const file = path.join(directory, 'display.db')
    const left = createDb(file)
    const right = createDb(file)
    const signals = new SharedArrayBuffer(16)
    const state = new Int32Array(signals)
    const workers: Worker[] = []
    try {
      const first = createRepository(left)
      const second = createRepository(right)
      const rows = seedProducts.map(productToRecord)
      await first.insertMissingProducts([rows[0]])
      const edited = { ...rows[0], title: 'Concurrent DB edit', priceAmount: 7 }
      const code = `
        const { parentPort, workerData } = require('node:worker_threads')
        const path = require('node:path')
        const { pathToFileURL } = require('node:url')
        const state = new Int32Array(workerData.signals)
        const wait = (index) => {
          if (Atomics.wait(state, index, 0, 5000) === 'timed-out') throw new Error('Worker barrier timed out')
        }
        ;(async () => {
          const root = process.cwd()
          const helper = pathToFileURL(path.join(root, 'scripts/lib/ts-require.mjs')).href
          const { createTsRequire } = await import(helper)
          const load = createTsRequire(root, pathToFileURL(path.join(root, 'package.json')).href)
          const { createDb } = load('./src/db/client.ts')
          const { createRepository } = load('./src/server/search/repository.ts')
          const db = createDb(workerData.file)
          const repo = createRepository(db)
          try {
            parentPort.postMessage({ event: 'ready' })
            wait(workerData.mode === 'editor' ? 0 : 1)
            if (workerData.mode === 'editor') {
              db.$client.exec('BEGIN IMMEDIATE')
              db.$client.prepare('UPDATE products SET title=?, price_amount=? WHERE id=?')
                .run(workerData.edited.title, workerData.edited.priceAmount, workerData.edited.id)
              parentPort.postMessage({ event: 'edit-locked' })
              wait(2)
              db.$client.exec('COMMIT')
              parentPort.postMessage({ event: 'committed' })
            } else {
              db.$client.pragma('busy_timeout = 0')
              try {
                await repo.insertMissingProducts(workerData.rows)
                parentPort.postMessage({ event: 'unexpected-success' })
              } catch (error) {
                parentPort.postMessage({ event: 'blocked', code: error.cause?.code ?? error.code })
              }
              wait(3)
              const count = await repo.insertMissingProducts(workerData.rows)
              const retry = await repo.insertMissingProducts(workerData.rows)
              parentPort.postMessage({ event: 'initialized', count, retry })
            }
          } finally { db.$client.close() }
        })().catch(error => { throw error })
      `
      const editor = new Worker(code, {
        eval: true,
        workerData: { file, signals, edited, mode: 'editor' },
      })
      workers.push(editor)
      const editorExit = once(editor, 'exit')
      expect((await once(editor, 'message'))[0]).toEqual({ event: 'ready' })
      const initializer = new Worker(code, {
        eval: true,
        workerData: { file, signals, rows, mode: 'initializer' },
      })
      workers.push(initializer)
      const initializerExit = once(initializer, 'exit')
      expect((await once(initializer, 'message'))[0]).toEqual({ event: 'ready' })
      const locked = once(editor, 'message')
      Atomics.store(state, 0, 1)
      Atomics.notify(state, 0)
      expect((await locked)[0]).toEqual({ event: 'edit-locked' })
      const blocked = once(initializer, 'message')
      Atomics.store(state, 1, 1)
      Atomics.notify(state, 1)
      expect((await blocked)[0]).toEqual({ event: 'blocked', code: 'SQLITE_BUSY' })
      expect(await second.findProductByHandle(rows[0].handle)).toEqual(rows[0])
      const committed = once(editor, 'message')
      Atomics.store(state, 2, 1)
      Atomics.notify(state, 2)
      expect((await committed)[0]).toEqual({ event: 'committed' })
      expect((await editorExit)[0]).toBe(0)
      const initialized = once(initializer, 'message')
      Atomics.store(state, 3, 1)
      Atomics.notify(state, 3)
      expect((await initialized)[0]).toEqual({
        event: 'initialized',
        count: rows.length - 1,
        retry: 0,
      })
      expect((await initializerExit)[0]).toBe(0)
      expect(await first.countProducts()).toBe(rows.length)
      expect(await second.findProductByHandle(edited.handle)).toEqual(edited)
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()))
      left.$client.close()
      right.$client.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses one PostgreSQL insert lock order even for distinct locale-equivalent IDs', async () => {
    const rows = [
      { ...productToRecord(seedProducts[0]), id: '\u00e9' },
      { ...productToRecord(seedProducts[1]), id: 'e\u0301' },
    ]
    expect(rows[0].id).not.toBe(rows[1].id)
    const orders: string[][] = []
    const migration = vi.spyOn(dbClient, 'ensurePgTables').mockResolvedValue()
    const fake = {
      transaction: async (action: (tx: unknown) => Promise<number>) => {
        const order: string[] = []
        orders.push(order)
        return action({
          insert: () => ({
            values: (record: { id: string }) => ({
              onConflictDoNothing: () => ({
                returning: async () => {
                  order.push(record.id)
                  return [{ id: record.id }]
                },
              }),
            }),
          }),
        })
      },
    } as unknown as PgAppDb
    try {
      const pg = createPostgresRepository(fake)
      expect(await pg.insertMissingProducts(rows)).toBe(2)
      expect(await pg.insertMissingProducts([...rows].reverse())).toBe(2)
      expect(orders[0]).toEqual(orders[1])
      expect(orders[0]).toEqual(['e\u0301', '\u00e9'])
    } finally {
      migration.mockRestore()
    }
  })

  it('counts and lists all rows', async () => {
    const rows = seedProducts.slice(0, 2).map(productToRecord)
    await repo.insertMissingProducts(rows)
    expect(await repo.countProducts()).toBe(2)
    expect((await repo.listAllProducts()).map((r) => r.handle).sort()).toEqual(
      [rows[0].handle, rows[1].handle].sort(),
    )
  })

  it('finds one product by its indexed handle without requiring a full list', async () => {
    const row = productToRecord(seedProducts[0])
    await repo.insertMissingProducts([row])
    await expect(repo.findProductByHandle(row.handle)).resolves.toEqual(row)
    await expect(repo.findProductByHandle('missing-handle')).resolves.toBeNull()
  })

  it('keeps products out of embedding/usage wipe isolation scope (wipe clears all three)', async () => {
    await repo.insertMissingProducts(seedProducts.slice(0, 1).map(productToRecord))
    await repo.wipe()
    expect(await repo.countProducts()).toBe(0)
  })
})
