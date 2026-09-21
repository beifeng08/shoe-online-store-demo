// Explicit import snapshot. Never run automatically during application startup.
import fs from 'node:fs'
import path from 'node:path'
import Module from 'node:module'
import ts from 'typescript'

const root = process.cwd()
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(
    this,
    request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request,
    ...args,
  )
}
Module._extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText,
    filename,
  )
}
const require = Module.createRequire(import.meta.url)
const { seedProducts } = require('../src/server/catalog/seed.ts')
fs.mkdirSync('backend/data', { recursive: true })
fs.writeFileSync('backend/data/catalog.json', JSON.stringify(seedProducts, null, 2) + '\n')
console.log(
  `Exported ${seedProducts.length} products. Existing backend prices/inventory are never reset.`,
)
