import type { Repository } from '@/server/search/repository'
import { createDefaultRepository } from '@/server/search/repository'
import { productFromRecord } from '@/db/product-row'
import { collections } from './collections'
import { filterProducts } from './filter'
import type { Collection, Product, ProductFilter } from '@/domain/product'
import type { CatalogAdapter } from './adapter-contract'

// DB 运行时目录适配器只读 products；空表保持空、缺失 handle 返回 null。
// 导入层只由显式初始化命令补缺，不在请求路径修复或重建产品行。
// 注入 repoFactory 便于测试用 :memory:；构造不做任何 DB 访问（懒）。
export class DbCatalogAdapter implements CatalogAdapter {
  private repoInstance: Repository | null = null

  constructor(private readonly repoFactory: () => Repository = createDefaultRepository) {}

  private repo(): Repository {
    this.repoInstance ??= this.repoFactory()
    return this.repoInstance
  }

  async getProducts(filter: ProductFilter = {}): Promise<Product[]> {
    const rows = await this.repo().listAllProducts()
    return filterProducts(rows.map(productFromRecord), filter)
  }

  async getProductByHandle(handle: string): Promise<Product | null> {
    const row = await this.repo().findProductByHandle(handle)
    return row ? productFromRecord(row) : null
  }

  async getCollections(): Promise<Collection[]> {
    return collections
  }

  // 无 store → null（与 seed 阶段同一契约；真 Shopify 接入后由对应实现替换）。
  async getBuyUrl(_product?: Product): Promise<null> {
    void _product
    return null
  }
}
