import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createTsRequire } from './lib/ts-require.mjs'

const root = process.cwd()
const require = createTsRequire(root, import.meta.url)
const { seedProducts } = require('../src/server/catalog/seed.ts')
const commerceProducts = JSON.parse(
  fs.readFileSync(path.join(root, 'backend/data/catalog.json'), 'utf8'),
)

const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
function stableVariantId(handle, color, size) {
  const name = `evoloop/${handle}/${color.trim().toLowerCase()}/${size}`
  const hash = createHash('sha1')
    .update(Buffer.concat([namespace, Buffer.from(name, 'utf8')]))
    .digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const differences = []
const displayById = new Map(seedProducts.map((product) => [product.id, product]))
const commerceById = new Map(commerceProducts.map((product) => [product.id, product]))

function snapshotOf(products) {
  return {
    products: products
      .map((product) => ({
        id: product.id,
        handle: product.handle,
        title: product.title,
        price: product.price,
        sizes: product.sizes ?? [],
        colors: product.colors ?? [],
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    variants: [...variants(products).entries()].sort(([a], [b]) => a.localeCompare(b)),
  }
}

function snapshotVersion(products) {
  return createHash('sha256')
    .update(JSON.stringify(snapshotOf(products)))
    .digest('hex')
    .slice(0, 16)
}

const displayVersion = snapshotVersion(seedProducts)
const commerceVersion = snapshotVersion(commerceProducts)
if (displayVersion !== commerceVersion) {
  differences.push(`catalog snapshot version: ${displayVersion} != ${commerceVersion}`)
}

for (const id of displayById.keys()) {
  if (!commerceById.has(id)) differences.push(`missing commerce product: ${id}`)
}
for (const id of commerceById.keys()) {
  if (!displayById.has(id)) differences.push(`extra commerce product: ${id}`)
}

function compareProduct(id, display, commerce) {
  const fields = [
    ['handle', display.handle, commerce.handle],
    ['title', display.title, commerce.title],
    ['price.amount', display.price.amount, commerce.price?.amount],
    ['price.currencyCode', display.price.currencyCode, commerce.price?.currencyCode],
    ['sizes', JSON.stringify(display.sizes), JSON.stringify(commerce.sizes)],
    ['colors', JSON.stringify(display.colors ?? []), JSON.stringify(commerce.colors ?? [])],
  ]
  for (const [field, expected, actual] of fields) {
    if (expected !== actual) differences.push(`product ${id} ${field}: ${expected} != ${actual}`)
  }
}

for (const [id, display] of displayById) {
  const commerce = commerceById.get(id)
  if (commerce) compareProduct(id, display, commerce)
}

function variants(products) {
  const result = new Map()
  for (const product of products) {
    for (const color of product.colors ?? []) {
      for (const size of product.sizes ?? []) {
        const key = `${product.id}|${product.handle}|${color.name.trim().toLowerCase()}|${size}`
        result.set(key, stableVariantId(product.handle, color.name, size))
      }
    }
  }
  return result
}

const displayVariants = variants(seedProducts)
const commerceVariants = variants(commerceProducts)
for (const key of displayVariants.keys()) {
  if (!commerceVariants.has(key)) differences.push(`missing commerce variant: ${key}`)
}
for (const key of commerceVariants.keys()) {
  if (!displayVariants.has(key)) differences.push(`extra commerce variant: ${key}`)
}

const unsellable = seedProducts.filter((product) => (product.sizes ?? []).length === 0)
const duplicateVariantIds = [...displayVariants.entries()]
  .filter(
    ([, id], index, entries) => entries.findIndex(([, candidate]) => candidate === id) !== index,
  )
  .map(([key, id]) => `${key} -> ${id}`)
const runtimeUnavailable = []
const runtimeRetired = []

function checkRuntimeDatabase(databasePath) {
  const Database = require('better-sqlite3')
  const database = new Database(path.resolve(root, databasePath), {
    fileMustExist: true,
    readonly: true,
  })
  try {
    database.pragma('query_only = ON')
    const runtimeProducts = database
      .prepare('SELECT id, handle, title, is_active FROM products ORDER BY id')
      .all()
    const runtimeById = new Map(runtimeProducts.map((product) => [product.id, product]))
    for (const id of displayById.keys()) {
      if (!runtimeById.has(id)) differences.push(`missing runtime product: ${id}`)
    }
    for (const id of runtimeById.keys()) {
      if (!displayById.has(id) && runtimeById.get(id).is_active)
        differences.push(`extra active runtime product: ${id}`)
      if (!runtimeById.get(id).is_active) runtimeRetired.push(`product ${id}`)
    }
    for (const [id, display] of displayById) {
      const runtime = runtimeById.get(id)
      if (!runtime) continue
      if (runtime.handle !== display.handle) {
        differences.push(`runtime product ${id} handle: ${display.handle} != ${runtime.handle}`)
      }
      if (runtime.title !== display.title) {
        differences.push(`runtime product ${id} title: ${display.title} != ${runtime.title}`)
      }
    }

    const runtimeVariants = database
      .prepare(
        `SELECT p.id AS product_id, p.handle, v.id, v.color, v.size, v.price, v.currency,
                p.is_active AS product_active, v.is_active AS variant_active,
                i.variant_id AS inventory_variant_id, i.available
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
           LEFT JOIN inventory i ON i.variant_id = v.id
          ORDER BY v.id`,
      )
      .all()
    const runtimeByKey = new Map()
    for (const variant of runtimeVariants) {
      const key = `${variant.product_id}|${variant.handle}|${variant.color.trim().toLowerCase()}|${variant.size}`
      runtimeByKey.set(key, variant)
      const expectedId = displayVariants.get(key)
      const retired = !variant.product_active || !variant.variant_active
      if (retired) runtimeRetired.push(`variant ${variant.id}`)
      if (!expectedId) {
        if (!retired) differences.push(`extra active runtime variant: ${key}`)
        continue
      }
      if (variant.id !== expectedId) {
        differences.push(`runtime variant ${key} id: ${expectedId} != ${variant.id}`)
      }
      const expectedProduct = displayById.get(variant.product_id)
      const expectedPrice = expectedProduct?.price.amount.toFixed(2)
      if (expectedPrice !== Number(variant.price).toFixed(2)) {
        differences.push(`runtime variant ${key} price: ${expectedPrice} != ${variant.price}`)
      }
      if (variant.currency !== 'USD') {
        differences.push(`runtime variant ${key} currency: USD != ${variant.currency}`)
      }
      if (!variant.inventory_variant_id)
        differences.push(`missing runtime inventory: ${variant.id}`)
      if (variant.available === 0) runtimeUnavailable.push(`${key} (available=0)`)
    }
    for (const key of displayVariants.keys()) {
      if (!runtimeByKey.has(key)) differences.push(`missing runtime variant: ${key}`)
    }
    console.log(
      `Runtime catalog checked read-only: ${runtimeProducts.length} products / ${runtimeVariants.length} variants`,
    )
  } finally {
    database.close()
  }
}

if (process.env.CATALOG_DRIFT_DATABASE) {
  checkRuntimeDatabase(process.env.CATALOG_DRIFT_DATABASE)
}

console.log(
  `Catalog drift check: ${seedProducts.length} display / ${commerceProducts.length} commerce products`,
)
console.log(`Display snapshot version: ${displayVersion}`)
console.log(`Commerce snapshot version: ${commerceVersion}`)
console.log(`Stable variant mapping: ${displayVariants.size} keys (UUIDv5)`)
if (unsellable.length) {
  console.log(`No sellable size variants: ${unsellable.map((product) => product.id).join(', ')}`)
}
if (runtimeUnavailable.length) {
  console.log(`Runtime variants with zero available stock: ${runtimeUnavailable.join(', ')}`)
}
if (runtimeRetired.length) {
  console.log(`Runtime retired entries retained for history: ${runtimeRetired.length}`)
}
if (duplicateVariantIds.length) {
  differences.push(`duplicate stable variant IDs: ${duplicateVariantIds.slice(0, 3).join('; ')}`)
}
if (differences.length) {
  console.error(`Catalog drift detected (${differences.length} differences):`)
  for (const difference of differences.slice(0, 30)) console.error(`- ${difference}`)
  if (differences.length > 30) console.error(`- ... ${differences.length - 30} more`)
  process.exit(1)
}
console.log('Product, price, color, size and sellable-variant snapshots match.')
if (process.env.CATALOG_DRIFT_DATABASE) {
  console.log(
    'Runtime inventory was inspected read-only; reservations and orders were not read or modified.',
  )
} else {
  console.log(
    'Runtime inventory, reservations and orders are not modified or inspected by this check.',
  )
}
