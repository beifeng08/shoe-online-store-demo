// Explicit import snapshot. Never run automatically during application startup.
import fs from 'node:fs'
import { createTsRequire } from './lib/ts-require.mjs'

const require = createTsRequire(process.cwd(), import.meta.url)
const { seedProducts } = require('../src/server/catalog/seed.ts')
fs.mkdirSync('backend/data', { recursive: true })
fs.writeFileSync('backend/data/catalog.json', JSON.stringify(seedProducts, null, 2) + '\n')
console.log(
  `Exported ${seedProducts.length} products. Existing backend prices/inventory are never reset.`,
)
