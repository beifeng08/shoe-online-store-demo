// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '@/db/client'
import { productToRecord } from '@/db/product-row'
import { createRepository } from '@/server/search/repository'
import { seedProducts } from '@/server/catalog/seed'

const injected = vi.hoisted(() => ({ connection: null as unknown }))
vi.mock('@/db/client', async (original) => ({
  ...(await original<typeof import('@/db/client')>()),
  db: () => injected.connection,
}))

const connections: ReturnType<typeof createDb>[] = []
afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close()
  injected.connection = null
  vi.unstubAllEnvs()
  vi.resetModules()
})
async function fixture() {
  vi.resetModules()
  vi.stubEnv('CATALOG_SOURCE', 'db')
  vi.stubEnv('DB_DRIVER', 'sqlite')
  vi.stubEnv('SHOPIFY_ENABLED', 'false')
  const db = createDb(':memory:')
  connections.push(db)
  injected.connection = db
  const { GET } = await import('./route')
  return { db, repo: createRepository(db), GET }
}

describe('GET /api/catalog with the real DB adapter', () => {
  it('returns an empty catalog without initializing an empty read-only table', async () => {
    const { db, repo, GET } = await fixture()
    db.$client.pragma('query_only = ON')
    const response = await GET(
      new Request(`http://localhost/api/catalog?handles=${seedProducts[0].handle}`),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(await repo.countProducts()).toBe(0)
  })

  it('preserves edited rows and does not restore missing products across repeated requests', async () => {
    const { db, repo, GET } = await fixture()
    const edited = { ...productToRecord(seedProducts[1]), title: 'Persisted API title' }
    await repo.insertMissingProducts([edited])
    const before = await repo.listAllProducts()
    db.$client.pragma('query_only = ON')
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await GET(
        new Request(
          `http://localhost/api/catalog?handles=${seedProducts[0].handle},${edited.handle},${edited.handle}`,
        ),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject([{ handle: edited.handle, title: edited.title }])
      expect(await repo.listAllProducts()).toEqual(before)
    }
  })
})
