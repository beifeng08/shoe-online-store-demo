import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'
import ts from 'typescript'
import { format, resolveConfig } from 'prettier'

const executeFile = promisify(execFile)

export const root = fileURLToPath(new URL('../', import.meta.url))
export const artifacts = [
  'src/domain/commerce-api.generated.ts',
  'src/test/fixtures/commerce-openapi.generated.json',
  'src/test/fixtures/commerce-responses.generated.json',
]

export function assertLocalReferences(value) {
  if (Array.isArray(value)) {
    for (const entry of value) assertLocalReferences(entry)
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (
        key === 'externalValue' ||
        (key === '$ref' && (typeof entry !== 'string' || !entry.startsWith('#/')))
      ) {
        throw new Error('Commerce contracts must contain only local references')
      }
      if (key === 'discriminator' && entry && typeof entry === 'object' && entry.mapping) {
        for (const reference of Object.values(entry.mapping)) {
          if (typeof reference !== 'string' || !reference.startsWith('#/')) {
            throw new Error('Commerce contracts must contain only local references')
          }
        }
      }
      assertLocalReferences(entry)
    }
  }
}

export async function exportContract(samples = false) {
  const python = process.env.COMMERCE_PYTHON || 'python'
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(SYSTEMROOT|WINDIR|SYSTEMDRIVE|TEMP|TMP|TMPDIR|COMSPEC|PATH|PATHEXT|OS|PROCESSOR_ARCHITECTURE|PROCESSOR_ARCHITEW6432|NUMBER_OF_PROCESSORS)$/i.test(
        key,
      ),
    ),
  )
  let stdout
  try {
    ;({ stdout } = await executeFile(
      python,
      [
        '-I',
        '-B',
        path.join(root, 'backend/export_contract.py'),
        ...(samples ? ['--samples'] : []),
      ],
      {
        cwd: root,
        env: environment,
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    ))
  } catch (error) {
    const code = error.code || 'unknown'
    throw new Error(
      `Offline commerce export failed (${code}); set COMMERCE_PYTHON to a locked backend Python`,
    )
  }
  return JSON.parse(stdout)
}

export async function renderArtifacts(schema, samples) {
  assertLocalReferences(schema)
  const options = await resolveConfig(path.join(root, '.prettierrc.json'))
  const nodes = await openapiTS(schema, { alphabetize: true })
  const generated = astToString(
    nodes.filter((node) => {
      if (!ts.isTypeAliasDeclaration(node)) return true
      if (!['webhooks', '$defs'].includes(node.name.text)) return true
      return Object.hasOwn(schema, node.name.text)
    }),
  )
  const banner = '// Generated from Python OpenAPI by npm run contract:generate. Do not edit.\n'
  return new Map([
    [artifacts[0], await format(banner + generated, { ...options, parser: 'typescript' })],
    [artifacts[1], await format(JSON.stringify(schema), { ...options, parser: 'json' })],
    [artifacts[2], await format(JSON.stringify(samples), { ...options, parser: 'json' })],
  ])
}

export async function checkArtifacts(directory, rendered) {
  const stale = []
  for (const [file, expected] of rendered) {
    let actual
    try {
      actual = await readFile(path.join(directory, file), 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (actual !== expected) stale.push(file)
  }
  if (stale.length) {
    throw new Error(`Commerce contract drift: ${stale.join(', ')}; run npm run contract:generate`)
  }
}

export async function main(check) {
  const schema = await exportContract()
  const samples = await exportContract(true)
  const rendered = await renderArtifacts(schema, samples)
  if (check) await checkArtifacts(root, rendered)
  else {
    for (const [file, content] of rendered) await writeFile(path.join(root, file), content, 'utf8')
  }
  console.log(check ? 'Commerce contracts are up to date' : 'Commerce contracts generated')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2)
  if (arguments_.some((argument) => argument !== '--check') || arguments_.length > 1) {
    console.error('Usage: node scripts/commerce-contract.mjs [--check]')
    process.exitCode = 2
  } else {
    main(arguments_.includes('--check')).catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
  }
}
