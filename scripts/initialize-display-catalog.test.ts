// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { createDb } from '../src/db/client'
import { productToRecord } from '../src/db/product-row'
import { products } from '../src/db/schema'
import { createRepository } from '../src/server/search/repository'
import { seedProducts } from '../src/server/catalog/seed'

const owned: string[] = []
afterEach(() => {
  for (const directory of owned.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function destination() {
  const directory = mkdtempSync(path.join(tmpdir(), 'display-init-cli-'))
  owned.push(directory)
  return path.join(directory, 'display.sqlite3')
}
function run(
  database: string,
  extra: Record<string, string | undefined> = {},
  nodeArgs: string[] = [],
) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DB_DRIVER: 'sqlite', DATABASE_URL: database }
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  Object.assign(env, extra)
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, 'scripts/initialize-display-catalog.mjs'], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    })
    let output = ''
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    child.stderr.on('data', (data: Buffer) => {
      output += data.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}
function lockContentionProbe(file: string) {
  const probe = path.join(path.dirname(file), 'lock-contention-probe.cjs')
  writeFileSync(
    probe,
    `
    const Module = require('node:module')
    const fs = require('node:fs')
    const originalLoad = Module._load
    Module._load = function (request, ...args) {
      const value = originalLoad.call(this, request, ...args)
      if (request === 'better-sqlite3') {
        const originalExec = value.prototype.exec
        value.prototype.exec = function (sql) {
          const locking = this.name.endsWith('.initialize-lock') && sql === 'BEGIN EXCLUSIVE'
          if (locking) this.pragma('busy_timeout = 0')
          try { return originalExec.call(this, sql) }
          catch (error) {
            if (locking) fs.writeSync(1, 'lifecycle-lock-contended:' + error.code + '\\n')
            throw error
          }
        }
      }
      return value
    }
  `,
  )
  return probe
}
function inserted(output: string): number {
  const line = output.split(/\r?\n/).find((line) => line.startsWith('{"operation":'))
  expect(line).toBeDefined()
  return JSON.parse(line!).inserted
}
function commerceHash() {
  return createHash('sha256').update(readFileSync('backend/data/catalog.json')).digest('hex')
}

describe('explicit display catalog CLI (real subprocesses)', () => {
  it('initializes twice, keeps edits and never modifies the commerce snapshot', async () => {
    const file = destination()
    const before = commerceHash()
    const first = await run(file)
    expect(first.code).toBe(0)
    expect(inserted(first.output)).toBe(seedProducts.length)
    const db = createDb(file)
    const edited = { ...productToRecord(seedProducts[0]), title: 'CLI keeps edit', priceAmount: 11 }
    try {
      db.update(products)
        .set({ title: edited.title, priceAmount: edited.priceAmount })
        .where(eq(products.id, edited.id))
        .run()
    } finally {
      db.$client.close()
    }
    const second = await run(file)
    expect(second.code).toBe(0)
    expect(inserted(second.output)).toBe(0)
    const read = createDb(file)
    try {
      expect(await createRepository(read).findProductByHandle(edited.handle)).toEqual(edited)
    } finally {
      read.$client.close()
    }
    expect(commerceHash()).toBe(before)
  }, 15000)

  it('handles concurrent independent CLI processes without duplicate products', async () => {
    const file = destination()
    const results = await Promise.all([run(file), run(file)])
    expect(results.map((result) => result.code)).toEqual([0, 0])
    expect(results.reduce((sum, result) => sum + inserted(result.output), 0)).toBe(
      seedProducts.length,
    )
    const db = createDb(file)
    try {
      expect(await createRepository(db).countProducts()).toBe(seedProducts.length)
    } finally {
      db.$client.close()
    }
  }, 15000)

  it('does not open the target while another initializer owns its lifecycle lock', async () => {
    const file = destination()
    const lock = new Database(`${file}.initialize-lock`)
    lock.exec('BEGIN EXCLUSIVE')
    try {
      const result = await run(file, {}, ['--require', lockContentionProbe(file)])
      expect(result.code).toBe(1)
      expect(result.output).toContain('lifecycle-lock-contended:SQLITE_BUSY')
      expect(result.output).toContain('Display catalog initialization failed')
      expect(existsSync(file)).toBe(false)
      expect(lock.inTransaction).toBe(true)
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }
    const retry = await run(file)
    expect(retry.code).toBe(0)
    expect(inserted(retry.output)).toBe(seedProducts.length)
  }, 15000)

  it('releases the lifecycle lock after its initializer is forcibly terminated', async () => {
    const file = destination()
    const probe = path.join(path.dirname(file), 'crash-lock-probe.cjs')
    writeFileSync(
      probe,
      `
      const Module = require('node:module')
      const fs = require('node:fs')
      const originalLoad = Module._load
      Module._load = function (request, ...args) {
        const value = originalLoad.call(this, request, ...args)
        if (request === 'better-sqlite3') {
          const originalExec = value.prototype.exec
          value.prototype.exec = function (sql) {
            const locking = this.name.endsWith('.initialize-lock') && sql === 'BEGIN EXCLUSIVE'
            if (locking && process.env.INIT_LOCK_CONTENDER === '1') this.pragma('busy_timeout = 0')
            let result
            try { result = originalExec.call(this, sql) }
            catch (error) {
              if (locking && process.env.INIT_LOCK_CONTENDER === '1') {
                fs.writeSync(1, 'lifecycle-lock-contended:' + error.code + '\\n')
              }
              throw error
            }
            if (locking && process.env.INIT_LOCK_CONTENDER !== '1') {
              fs.writeSync(1, 'lifecycle-lock-held\\n')
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
            }
            return result
          }
        }
        return value
      }
    `,
    )
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DB_DRIVER: 'sqlite', DATABASE_URL: file }
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
      if (process.env[key]) env[key] = process.env[key]
    }
    const holder = spawn(
      process.execPath,
      ['--require', probe, 'scripts/initialize-display-catalog.mjs'],
      { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 },
    )
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        holder.once('close', (code, signal) => resolve({ code, signal }))
      },
    )
    let output = ''
    holder.stderr.on('data', (data: Buffer) => {
      output += data.toString()
    })
    try {
      await new Promise<void>((resolve, reject) => {
        holder.once('error', reject)
        holder.once('close', () =>
          reject(new Error(`Lock holder exited before readiness: ${output}`)),
        )
        holder.stdout.on('data', (data: Buffer) => {
          output += data.toString()
          if (output.includes('lifecycle-lock-held\n')) resolve()
        })
      })
      expect(existsSync(file)).toBe(false)
      // Fail this test's contender immediately, before the holder's safety timeout.
      const blocked = await run(file, { INIT_LOCK_CONTENDER: '1' }, ['--require', probe])
      expect(blocked.code).toBe(1)
      expect(blocked.output).toContain('lifecycle-lock-contended:SQLITE_BUSY')
      expect(blocked.output).toContain('Display catalog initialization failed')
      expect(existsSync(file)).toBe(false)
      expect(holder.exitCode).toBeNull()
      expect(holder.signalCode).toBeNull()
      expect(holder.kill('SIGKILL')).toBe(true)
      const exit = await closed
      expect(exit.code === 0 && exit.signal === null).toBe(false)
      expect(existsSync(`${file}.initialize-lock`)).toBe(true)
      const retry = await run(file)
      expect(retry.code).toBe(0)
      expect(inserted(retry.output)).toBe(seedProducts.length)
      const db = createDb(file)
      try {
        expect(await createRepository(db).countProducts()).toBe(seedProducts.length)
      } finally {
        db.$client.close()
      }
    } finally {
      if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL')
      await closed
    }
  }, 15000)

  it.each(['wal', 'migration'])(
    'closes a failed %s target before releasing its lifecycle lock',
    async (failure) => {
      const file = destination()
      const probe = path.join(path.dirname(file), 'lifecycle-probe.cjs')
      const events = path.join(path.dirname(file), 'lifecycle-events.jsonl')
      writeFileSync(
        probe,
        `
      const Module = require('node:module')
      const fs = require('node:fs')
      const originalLoad = Module._load
      const seen = new WeakSet()
      const record = (event) => fs.appendFileSync(process.env.INIT_EVENTS, JSON.stringify(event) + '\\n')
      Module._load = function (request, ...args) {
        const value = originalLoad.call(this, request, ...args)
        if (request === 'better-sqlite3' && !seen.has(value)) {
          seen.add(value)
          for (const method of ['exec', 'prepare', 'close']) {
            const original = value.prototype[method]
            value.prototype[method] = function (...parameters) {
              const kind = this.name.endsWith('.initialize-lock') ? 'lock' : 'target'
              const sql = String(parameters[0] || '')
              if (kind === 'target' && (
                (process.env.INIT_FAILURE === 'wal' && method === 'exec' && sql.includes('journal_mode')) ||
                (process.env.INIT_FAILURE === 'migration' && method === 'prepare' && sql.includes('__drizzle_migrations'))
              )) {
                record({ event: 'failure', kind, method })
                throw new Error('private-lifecycle-marker')
              }
              const result = original.apply(this, parameters)
              if (method === 'close' || (kind === 'lock' && sql === 'ROLLBACK')) {
                record({ event: method === 'close' ? 'close' : 'release', kind })
              }
              return result
            }
          }
        }
        return value
      }
    `,
      )
      const result = await run(file, { INIT_FAILURE: failure, INIT_EVENTS: events }, [
        '--require',
        probe,
      ])
      expect(result.code).toBe(1)
      expect(result.output).toContain('Display catalog initialization failed')
      expect(result.output).not.toContain('private-lifecycle-marker')
      expect(
        readFileSync(events, 'utf8')
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line)),
      ).toEqual([
        { event: 'failure', kind: 'target', method: failure === 'wal' ? 'exec' : 'prepare' },
        { event: 'close', kind: 'target' },
        { event: 'release', kind: 'lock' },
        { event: 'close', kind: 'lock' },
      ])
      const retry = await run(file)
      expect(retry.code).toBe(0)
      expect(inserted(retry.output)).toBe(seedProducts.length)
    },
    15000,
  )

  it('rejects surrounding SQLite whitespace before a second lock can be selected', async () => {
    const file = destination()
    const lock = new Database(`${file}.initialize-lock`)
    lock.exec('BEGIN EXCLUSIVE')
    try {
      for (const alias of [`${file} `, ` ${file}`, ':memory: ']) {
        const result = await run(alias)
        expect(result.code).toBe(1)
        expect(result.output).toContain('Display catalog initialization failed')
        expect(existsSync(file)).toBe(false)
        expect(existsSync(`${alias}.initialize-lock`)).toBe(false)
      }
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }
  }, 15000)

  it('rejects non-persistent and URL-shaped SQLite targets before creating any path', async () => {
    for (const target of [
      ':memory:',
      'file:display.sqlite3',
      'postgres://user@db.example/display',
    ]) {
      const result = await run(target)
      expect(result.code).toBe(1)
      expect(result.output).toContain('Display catalog initialization failed')
      expect(result.output).not.toContain('{"operation":')
      expect(existsSync(target)).toBe(false)
      expect(existsSync(`${target}.initialize-lock`)).toBe(false)
    }
    expect(existsSync('file')).toBe(false)
    expect(existsSync('postgres:')).toBe(false)
  }, 15000)

  it('rejects a dangling leaf symlink before creating an alias lifecycle lock', async () => {
    const target = destination()
    const alias = path.join(path.dirname(target), 'alias.sqlite3')
    symlinkSync(target, alias, 'file')
    expect(lstatSync(alias).isSymbolicLink()).toBe(true)
    expect(existsSync(alias)).toBe(false)
    const result = await run(alias)
    expect(result.code).toBe(1)
    expect(result.output).toContain('Display catalog initialization failed')
    expect(existsSync(target)).toBe(false)
    expect(existsSync(`${alias}.initialize-lock`)).toBe(false)
    const direct = await run(target)
    expect(direct.code).toBe(0)
    expect(inserted(direct.output)).toBe(seedProducts.length)
  }, 15000)

  it('uses the canonical lifecycle lock for an existing symbolic link', async () => {
    const target = destination()
    const initial = await run(target)
    expect(initial.code).toBe(0)
    const alias = path.join(path.dirname(target), 'alias.sqlite3')
    symlinkSync(target, alias, 'file')
    const lock = new Database(`${target}.initialize-lock`)
    lock.exec('BEGIN EXCLUSIVE')
    try {
      const blocked = await run(alias, {}, ['--require', lockContentionProbe(target)])
      expect(blocked.code).toBe(1)
      expect(blocked.output).toContain('lifecycle-lock-contended:SQLITE_BUSY')
      expect(blocked.output).toContain('Display catalog initialization failed')
      expect(existsSync(`${alias}.initialize-lock`)).toBe(false)
      expect(lock.inTransaction).toBe(true)
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }
    const retry = await run(alias)
    expect(retry.code).toBe(0)
    expect(inserted(retry.output)).toBe(0)
  }, 15000)

  it('rejects whitespace introduced by canonical resolution before opening either database', async () => {
    const file = destination()
    writeFileSync(file, '')
    const probe = path.join(path.dirname(file), 'canonical-path-probe.cjs')
    writeFileSync(
      probe,
      `
      const fs = require('node:fs')
      const path = require('node:path')
      const original = fs.realpathSync
      fs.realpathSync = function (file, ...args) {
        const result = original.call(this, file, ...args)
        return path.resolve(String(file)) === path.resolve(process.env.INIT_CANONICAL_FILE)
          ? result + ' '
          : result
      }
    `,
    )
    const result = await run(file, { INIT_CANONICAL_FILE: file }, ['--require', probe])
    expect(result.code).toBe(1)
    expect(result.output).toContain('Display catalog initialization failed')
    expect(readFileSync(file).length).toBe(0)
    expect(existsSync(`${file} .initialize-lock`)).toBe(false)
    expect(existsSync(`${file}.initialize-lock`)).toBe(false)
  })

  it('requires an explicit destination instead of reading ambient dotenv/defaults', async () => {
    const file = destination()
    const result = await run(file, { DATABASE_URL: '' })
    expect(result.code).toBe(1)
    expect(result.output).toContain('Display catalog initialization failed')
    expect(existsSync(file)).toBe(false)
  })

  it('refuses to open the destination if the drift check fails', async () => {
    const file = destination()
    const privatePath = path.join(path.dirname(file), 'private-drift-path-marker.db')
    const before = commerceHash()
    const result = await run(file, { CATALOG_DRIFT_DATABASE: privatePath })
    expect(result.code).toBe(1)
    expect(result.output).not.toContain('private-drift-path-marker')
    expect(result.output).not.toContain('SqliteError')
    expect(result.output).not.toMatch(
      /at (?:new |file:\/\/\/)|node:internal|check-catalog-drift\.mjs:\d/,
    )
    expect(existsSync(file)).toBe(false)
    expect(commerceHash()).toBe(before)
  })

  it('requires an explicit PostgreSQL host and database before invoking the driver', async () => {
    const file = destination()
    const probe = path.join(path.dirname(file), 'driver-selection-probe.cjs')
    const sentinel = path.join(path.dirname(file), 'driver-loaded.txt')
    writeFileSync(
      probe,
      `
      const Module = require('node:module')
      const original = Module._load
      Module._load = function (request, ...args) {
        if (request === '../src/db/client.ts') {
          require('node:fs').writeFileSync(process.env.INIT_DRIVER_SENTINEL, 'loaded')
          throw new Error('driver probe must never run')
        }
        return original.call(this, request, ...args)
      }
    `,
    )
    const nodeArgs = ['--require', probe]
    const environment = {
      DB_DRIVER: 'postgres',
      PGDATABASE: 'ambient-db-marker',
      INIT_DRIVER_SENTINEL: sentinel,
    }
    for (const url of [
      'postgres://127.0.0.1/display_test',
      'postgresql://127.0.0.1/display_test',
      'postgres://u:p%40localhost%2C127.0.0.1@127.0.0.1/display_test',
    ]) {
      const control = await run(file, { ...environment, DATABASE_URL: url }, nodeArgs)
      expect(control.code).toBe(1)
      expect(control.output).toContain('Display catalog initialization failed')
      expect(readFileSync(sentinel, 'utf8')).toBe('loaded')
      rmSync(sentinel)
    }
    for (const url of [
      'postgres://127.0.0.1/',
      'postgres:///display_test',
      'https://127.0.0.1/display_test',
      'postgres://127.0.0.1/display_test?database=',
      'postgres://127.0.0.1/display_test?database=other_test',
      'postgres://,127.0.0.1/display_test',
      'postgresql://127.0.0.1,/display_test',
      'postgres://127.0.0.1,localhost/display_test',
      'postgres://127.0.0.1%2Clocalhost/display_test',
      'postgresql://%2c127.0.0.1/display_test',
      'postgres://127.0.0.1%2C/display_test',
      'postgres://u:p@localhost,127.0.0.1@127.0.0.1/display_test',
    ]) {
      const result = await run(file, { ...environment, DATABASE_URL: url }, nodeArgs)
      expect(result.code).toBe(1)
      expect(result.output).toContain('Display catalog initialization failed')
      expect(result.output).not.toContain('ambient-db-marker')
      expect(existsSync(sentinel)).toBe(false)
    }
  }, 15000)

  it('redacts driver errors and leaves existing rows unchanged on constraint failure', async () => {
    const file = destination()
    const secret = 'private-driver-marker'
    const invalid = await run(file, { DB_DRIVER: secret })
    expect(invalid.code).toBe(1)
    expect(invalid.output).not.toContain(secret)
    const db = createDb(file)
    const conflict = {
      ...productToRecord(seedProducts[1]),
      id: 'custom-row',
      handle: seedProducts[1].handle,
    }
    try {
      await createRepository(db).insertMissingProducts([conflict])
    } finally {
      db.$client.close()
    }
    const result = await run(file)
    expect(result.code).toBe(1)
    const read = createDb(file)
    try {
      expect(await createRepository(read).listAllProducts()).toEqual([conflict])
    } finally {
      read.$client.close()
    }
  }, 15000)
})
