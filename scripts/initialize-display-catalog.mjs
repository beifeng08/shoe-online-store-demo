import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createTsRequire } from './lib/ts-require.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createTsRequire(root, import.meta.url)

async function initialize() {
  // No implicit dotenv/default destination: operators must select the display DB.
  if (process.argv.length !== 2 || process.cwd() !== root || !process.env.DATABASE_URL?.trim()) {
    throw new Error('Explicit DATABASE_URL and repository-root invocation are required')
  }
  if (process.env.DATABASE_URL !== process.env.DATABASE_URL.trim()) {
    throw new Error('DATABASE_URL must not contain surrounding whitespace')
  }
  const { resolveDbDriver } = require('../src/db/dialect.ts')
  const driver = resolveDbDriver()
  if (driver === 'postgres') {
    const target = new URL(process.env.DATABASE_URL)
    const authority = process.env.DATABASE_URL.match(/^[^:]+:\/\/([^/?#]*)/)?.[1] ?? ''
    if (
      // WHATWG uses the last @, while postgres.js splits userinfo at the first.
      authority.indexOf('@') !== authority.lastIndexOf('@') ||
      !['postgres:', 'postgresql:'].includes(target.protocol) ||
      !target.hostname ||
      decodeURIComponent(target.hostname).includes(',') ||
      !target.pathname.slice(1).trim() ||
      target.searchParams.has('database')
    ) {
      throw new Error('An explicit PostgreSQL host and database are required')
    }
  } else if (/^(:|[a-z][a-z0-9+.-]+:)/i.test(process.env.DATABASE_URL)) {
    // Only a persistent file: reject `:memory:` and scheme-prefixed URLs (drive letters are one character).
    throw new Error('A persistent SQLite file path is required')
  }
  const check = spawnSync(process.execPath, [path.join(root, 'scripts/check-catalog-drift.mjs')], {
    cwd: root,
    env: process.env,
    // Keep raw drift/driver failures out of operator logs; the check is unchanged.
    stdio: 'pipe',
    maxBuffer: 1024 * 1024,
    timeout: 30000,
  })
  if (check.error || check.status !== 0) throw new Error('Catalog drift check failed')

  const { createDb, createPostgresDb } = require('../src/db/client.ts')
  const { initializeDisplayCatalog } = require('../src/server/catalog/initialize.ts')
  let connection
  let initializationLock
  try {
    if (driver === 'postgres') {
      const { createPostgresRepository } = require('../src/server/search/repository-postgres.ts')
      connection = createPostgresDb()
      const inserted = await initializeDisplayCatalog(createPostgresRepository(connection))
      console.log(JSON.stringify({ operation: 'initialize-display-catalog', inserted }))
    } else {
      const { createRepository } = require('../src/server/search/repository.ts')
      const absolute = path.resolve(process.env.DATABASE_URL)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      const leaf = fs.lstatSync(absolute, { throwIfNoEntry: false })
      const file = leaf
        ? fs.realpathSync(absolute)
        : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute))
      if (file !== file.trim()) throw new Error('Canonical SQLite target must not be trimmed')
      const Database = require('better-sqlite3')
      // Lock before opening the target: two first starts can race in schema/WAL setup.
      // Keep the sidecar inode; deleting it could split contenders across different locks.
      initializationLock = new Database(`${file}.initialize-lock`)
      initializationLock.exec('BEGIN EXCLUSIVE')
      connection = createDb(file)
      const inserted = await initializeDisplayCatalog(createRepository(connection))
      console.log(JSON.stringify({ operation: 'initialize-display-catalog', inserted }))
    }
  } finally {
    try {
      if (connection) {
        if (driver === 'postgres') await connection.$client.end({ timeout: 5 })
        else connection.$client.close()
      }
    } finally {
      if (initializationLock) {
        try {
          if (initializationLock.inTransaction) initializationLock.exec('ROLLBACK')
        } finally {
          initializationLock.close()
        }
      }
    }
  }
}

initialize().catch(() => {
  // Driver errors may include credentials, paths or SQL; do not print their details.
  console.error(
    'Display catalog initialization failed. Check the explicit environment, catalog drift and database constraints; existing product rows are never overwritten.',
  )
  process.exitCode = 1
})
