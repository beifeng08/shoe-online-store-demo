import { afterEach, describe, expect, it, vi } from 'vitest'
import { shopifyEnabled } from './shopify-stub'
import {
  SHOPIFY_PRODUCT_IDS,
  shopifyBuyConfigFor,
  shopifyProductIdFor,
} from '@/server/catalog/shopify-buy'
import { seedProducts } from '@/server/catalog/seed'

// 商店直购映射（2026-09-06 全目录）：本地 seed handle ↔ Shopify 商店同 handle 商品。
describe('shopify-buy catalog map', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('defaults both Shopify entry points off even with legacy credentials', () => {
    vi.stubEnv('SHOPIFY_ENABLED', '')
    vi.stubEnv('SHOPIFY_BUY_DOMAIN', 'demo.myshopify.com')
    vi.stubEnv('SHOPIFY_BUY_TOKEN', 'legacy')
    vi.stubEnv('SHOPIFY_DOMAIN', 'demo.myshopify.com')
    vi.stubEnv('SHOPIFY_STOREFRONT_TOKEN', 'legacy')
    expect(shopifyBuyConfigFor('dc-1001')).toBeNull()
    expect(shopifyEnabled()).toBe(false)
  })
  it('covers every seed product handle (29/29) with a store numeric id', () => {
    expect(seedProducts.length).toBeGreaterThanOrEqual(29)
    const handles = seedProducts.map((p) => p.handle)
    const missing = handles.filter((h) => shopifyProductIdFor(h) == null)
    expect(missing).toEqual([])
  })

  it('ids are unique across the map', () => {
    const ids = Object.values(SHOPIFY_PRODUCT_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('maps each entry back to a real seed handle (no orphan rows)', () => {
    const handles = new Set(seedProducts.map((p) => p.handle))
    const orphans = Object.keys(SHOPIFY_PRODUCT_IDS).filter((h) => !handles.has(h))
    expect(orphans).toEqual([])
  })

  it('keeps the known snapshot ids for spot-checked products', () => {
    // 来自 admin 生成的 shopify_buy_button.txt（2026-09-06 商店快照）。
    expect(shopifyProductIdFor('dc-1001')).toBe('9407853625559')
    expect(shopifyProductIdFor('26016-m')).toBe('9407856148695') // 该款 txt 缺失、经 Storefront API 补齐
    expect(shopifyProductIdFor('dc-26075')).toBe('9407854870743') // 同上
  })

  it('returns null for unknown handles', () => {
    expect(shopifyProductIdFor('not-a-product')).toBeNull()
    expect(shopifyProductIdFor('')).toBeNull()
  })

  it('config is null when SHOPIFY_BUY_* env is not configured (demo fallback, P1)', () => {
    const prev = { d: process.env.SHOPIFY_BUY_DOMAIN, t: process.env.SHOPIFY_BUY_TOKEN }
    delete process.env.SHOPIFY_BUY_DOMAIN
    delete process.env.SHOPIFY_BUY_TOKEN
    try {
      expect(shopifyBuyConfigFor('dc-1001')).toBeNull()
    } finally {
      if (prev.d) process.env.SHOPIFY_BUY_DOMAIN = prev.d
      if (prev.t) process.env.SHOPIFY_BUY_TOKEN = prev.t
    }
  })

  it('config carries domain/token/moneyFormat only when both env keys are set', () => {
    vi.stubEnv('SHOPIFY_ENABLED', 'true')
    const prev = { d: process.env.SHOPIFY_BUY_DOMAIN, t: process.env.SHOPIFY_BUY_TOKEN }
    process.env.SHOPIFY_BUY_DOMAIN = 'demo.myshopify.com'
    process.env.SHOPIFY_BUY_TOKEN = 'tok123'
    try {
      const cfg = shopifyBuyConfigFor('dc-1001')
      expect(cfg).not.toBeNull()
      expect(cfg?.productId).toBe('9407853625559')
      expect(cfg?.domain).toBe('demo.myshopify.com')
      expect(cfg?.storefrontAccessToken).toBe('tok123')
      expect(cfg?.moneyFormat).toBe('¥{{amount}}')
      // 任一缺失 → null
      process.env.SHOPIFY_BUY_DOMAIN = ''
      expect(shopifyBuyConfigFor('dc-1001')).toBeNull()
    } finally {
      if (prev.d) process.env.SHOPIFY_BUY_DOMAIN = prev.d
      else delete process.env.SHOPIFY_BUY_DOMAIN
      if (prev.t) process.env.SHOPIFY_BUY_TOKEN = prev.t
      else delete process.env.SHOPIFY_BUY_TOKEN
    }
  })
})
