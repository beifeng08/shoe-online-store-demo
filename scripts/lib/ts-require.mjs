import fs from 'node:fs'
import path from 'node:path'
import Module from 'node:module'
import ts from 'typescript'

// Lets a plain Node process require app TypeScript with the `@/` → `<root>/src` alias.
// Patches the process-wide CommonJS loader, so call it once per process.
export function createTsRequire(root, from) {
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...args) {
    return originalResolve.call(
      this,
      request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request,
      ...args,
    )
  }
  Module._extensions['.ts'] = (module, filename) => {
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      }).outputText,
      filename,
    )
  }
  return Module.createRequire(from)
}
