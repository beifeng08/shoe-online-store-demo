// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '@/db/client'
import { productToRecord } from '@/db/product-row'
import { createRepository } from '@/server/search/repository'
import { initializeDisplayCatalog } from './initialize'
import { seedProducts } from './seed'

const connections: ReturnType<typeof createDb>[] = []
afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close()
})
function make() {
  const db = createDb(':memory:')
  connections.push(db)
  return createRepository(db)
}

describe('explicit display catalog initialization', () => {
  it('inserts the seed once and reports actual insert counts on retries', async () => {
    const repo = make()
    expect(await initializeDisplayCatalog(repo)).toBe(seedProducts.length)
    expect(await initializeDisplayCatalog(repo)).toBe(0)
    expect(await repo.countProducts()).toBe(seedProducts.length)
  })

  it('only adds missing IDs and preserves every column of existing edits and custom rows', async () => {
    const repo = make()
    const edited = { ...productToRecord(seedProducts[1]), title: 'Kept edit', priceAmount: 19 }
    const custom = { ...productToRecord(seedProducts[2]), id: 'custom-id', handle: 'custom-handle' }
    await repo.insertMissingProducts([edited, custom])
    expect(await initializeDisplayCatalog(repo)).toBe(seedProducts.length - 1)
    expect(await repo.findProductByHandle(edited.handle)).toEqual(edited)
    expect(await repo.findProductByHandle(custom.handle)).toEqual(custom)
    expect(await repo.countProducts()).toBe(seedProducts.length + 1)
  })

  it('allows an explicit retry after a transient failure without caching failure or success', async () => {
    const repo = make()
    const insert = vi.spyOn(repo, 'insertMissingProducts')
    insert.mockRejectedValueOnce(new Error('connection interrupted'))
    await expect(initializeDisplayCatalog(repo)).rejects.toThrow('connection interrupted')
    expect(await repo.countProducts()).toBe(0)
    expect(await initializeDisplayCatalog(repo)).toBe(seedProducts.length)
    expect(await initializeDisplayCatalog(repo)).toBe(0)
    expect(insert).toHaveBeenCalledTimes(3)
  })

  it('keeps concurrent explicit calls idempotent without sharing a cached result', async () => {
    const repo = make()
    const counts = await Promise.all([
      initializeDisplayCatalog(repo),
      initializeDisplayCatalog(repo),
    ])
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(seedProducts.length)
    expect(await repo.countProducts()).toBe(seedProducts.length)
  })

  it('never reads before inserting and retains edits made immediately before insertion', async () => {
    const repo = make()
    const edited = { ...productToRecord(seedProducts[0]), title: 'Concurrent edit' }
    const insert = repo.insertMissingProducts.bind(repo)
    const list = vi.spyOn(repo, 'listAllProducts')
    await initializeDisplayCatalog({
      insertMissingProducts: async (records) => {
        await insert([edited])
        return insert(records)
      },
    })
    expect(list).not.toHaveBeenCalled()
    expect(await repo.findProductByHandle(edited.handle)).toEqual(edited)
  })
})
