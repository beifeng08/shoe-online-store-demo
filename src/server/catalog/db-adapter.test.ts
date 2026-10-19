// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '@/db/client'
import { createRepository } from '@/server/search/repository'
import { DbCatalogAdapter } from './db-adapter'
import { seedProducts } from './seed'
import { productToRecord } from '@/db/product-row'

const connections: ReturnType<typeof createDb>[] = []
afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close()
})
function make() {
  const db = createDb(':memory:')
  connections.push(db)
  const repo = createRepository(db)
  return { db, repo, adapter: new DbCatalogAdapter(() => repo) }
}

describe('catalog reads never initialize products', () => {
  it('leaves an empty table empty across list and handle reads', async () => {
    const { adapter, repo } = make()
    const initialize = vi.spyOn(repo, 'insertMissingProducts')
    expect(await adapter.getProducts()).toEqual([])
    expect(await adapter.getProductByHandle(seedProducts[0].handle)).toBeNull()
    expect(await repo.countProducts()).toBe(0)
    expect(initialize).not.toHaveBeenCalled()
  })

  it('works with SQLite query_only and preserves every product row', async () => {
    const { db, repo, adapter } = make()
    const edited = productToRecord({ ...seedProducts[1], title: 'Read-only edit' })
    await repo.insertMissingProducts([edited])
    const before = await repo.listAllProducts()
    db.$client.pragma('query_only = ON')
    expect(await adapter.getProducts()).toHaveLength(1)
    expect((await adapter.getProductByHandle(edited.handle))?.title).toBe('Read-only edit')
    expect(await adapter.getProductByHandle(seedProducts[0].handle)).toBeNull()
    expect(await repo.listAllProducts()).toEqual(before)
  })
})

// Initialization guarantees live in initialize.test.ts; reads use persisted rows only.
describe('DbCatalogAdapter', () => {
  it('constructs lazily without accessing a repository', () => {
    const factory = vi.fn(() => {
      throw new Error('must not access DB during construction')
    })
    expect(new DbCatalogAdapter(factory)).toBeInstanceOf(DbCatalogAdapter)
    expect(factory).not.toHaveBeenCalled()
  })

  it('reads persisted edits instead of the import-layer values', async () => {
    const { adapter, repo } = make()
    const edited = seedProducts[0]
    await repo.insertMissingProducts([productToRecord({ ...edited, title: 'DB-Edited' })])
    expect((await adapter.getProductByHandle(edited.handle))?.title).toBe('DB-Edited')
  })

  it('uses the indexed handle lookup without listing the whole catalog', async () => {
    const { adapter, repo } = make()
    await repo.insertMissingProducts([productToRecord(seedProducts[0])])
    const find = vi.spyOn(repo, 'findProductByHandle')
    const list = vi.spyOn(repo, 'listAllProducts')
    await expect(adapter.getProductByHandle(seedProducts[0].handle)).resolves.toMatchObject({
      handle: seedProducts[0].handle,
    })
    expect(find).toHaveBeenCalledWith(seedProducts[0].handle)
    expect(list).not.toHaveBeenCalled()
  })

  it('does not restore removed seed rows on a new adapter read', async () => {
    const { adapter, repo } = make()
    const removed = seedProducts[0]
    const edited = seedProducts[1]
    await repo.insertMissingProducts([
      productToRecord({ ...edited, title: 'Kept-Edit' }),
      ...seedProducts.filter((p) => p.id !== removed.id && p.id !== edited.id).map(productToRecord),
    ])
    const all = await adapter.getProducts()
    expect(all).toHaveLength(seedProducts.length - 1)
    expect(all.find((p) => p.id === removed.id)).toBeUndefined()
    expect(all.find((p) => p.id === edited.id)?.title).toBe('Kept-Edit')
  })

  it('applies the existing filter and sort semantics to DB rows', async () => {
    const { adapter, repo } = make()
    await repo.insertMissingProducts(seedProducts.map(productToRecord))
    const comfort = await adapter.getProducts({ collection: 'comfort' })
    expect(comfort.length).toBeGreaterThan(0)
    expect(comfort.every((p) => p.collections.includes('comfort'))).toBe(true)
    const asc = await adapter.getProducts({ sort: 'price-asc' })
    const prices = asc.map((p) => p.price.amount)
    expect([...prices].sort((a, b) => a - b)).toEqual(prices)
  })

  it('retries a failed read without initializing an empty table', async () => {
    const { adapter, repo } = make()
    vi.spyOn(repo, 'listAllProducts').mockRejectedValueOnce(new Error('connection interrupted'))
    await expect(adapter.getProducts()).rejects.toThrow('connection interrupted')
    await expect(adapter.getProducts()).resolves.toEqual([])
    expect(await repo.countProducts()).toBe(0)
  })

  it('keeps concurrent reads independent of all product writers', async () => {
    const { adapter, repo } = make()
    await repo.insertMissingProducts([productToRecord(seedProducts[0])])
    const initialize = vi.spyOn(repo, 'insertMissingProducts')
    const [products, product] = await Promise.all([
      adapter.getProducts(),
      adapter.getProductByHandle(seedProducts[0].handle),
    ])
    expect(products).toHaveLength(1)
    expect(product?.handle).toBe(seedProducts[0].handle)
    expect(initialize).not.toHaveBeenCalled()
  })
})
