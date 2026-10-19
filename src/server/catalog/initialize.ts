import { productToRecord } from '@/db/product-row'
import type { Repository } from '@/server/search/repository'
import { seedProducts } from './seed'

/** Explicit add-only initialization; each call can retry or restore missing IDs. */
export async function initializeDisplayCatalog(
  repository: Pick<Repository, 'insertMissingProducts'>,
): Promise<number> {
  return repository.insertMissingProducts(seedProducts.map(productToRecord))
}
