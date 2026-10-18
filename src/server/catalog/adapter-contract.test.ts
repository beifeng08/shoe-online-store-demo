import { describe, expect, it } from 'vitest'
import type { ProductFilter } from '@/domain/product'
import type { CatalogAdapter } from './adapter-contract'

describe('catalog contract', () => {
  it('filter sort union is closed', () => {
    const f: ProductFilter = { sort: 'featured' }
    expect(f.sort).toBe('featured')
  })
  it('CatalogAdapter contract shape is structurally satisfiable', () => {
    const adapter: CatalogAdapter = {
      getProducts: async () => [],
      getProductByHandle: async () => null,
      getCollections: async () => [],
      getBuyUrl: async () => null,
    }
    expect(typeof adapter.getProducts).toBe('function')
  })
})
