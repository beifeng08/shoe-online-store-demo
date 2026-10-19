import { X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkServerIdentity, type PeerCertificate } from 'node:tls'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import postgres from 'postgres'
import { schema } from './schema'
import { schema as pgSchema } from './schema-postgres'
import { resolveDbDriver } from './dialect'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export type AppDb = BetterSQLite3Database<typeof schema>
export type PgAppDb = PostgresJsDatabase<typeof pgSchema>
type PgClientDb = PgAppDb & { $client: ReturnType<typeof postgres> }
type AnyDb = AppDb | PgAppDb
const sqliteMigrations = { migrationsFolder: resolve(process.cwd(), 'drizzle/sqlite') }
const postgresMigrations = { migrationsFolder: resolve(process.cwd(), 'drizzle/postgres') }

export function createDb(
  file: string = process.env.DATABASE_URL ?? './data/local.db',
): AppDb & { $client: Database.Database } {
  const sqlite = new Database(file)
  try {
    sqlite.exec('PRAGMA journal_mode = WAL;')
    const database = drizzle(sqlite, { schema })
    migrateSqlite(database, sqliteMigrations)
    return database
  } catch (error) {
    sqlite.close()
    throw error
  }
}

let _db: AppDb | null = null
let _pg: PgAppDb | null = null
/** 默认 sqlite 连接（类型化 AppDb）；懒创建本地文件。 */
export function sqliteDb(): AppDb {
  if (!_db) {
    const file = process.env.DATABASE_URL ?? './data/local.db'
    if (!file.startsWith(':'))
      mkdirSync(file.slice(0, file.lastIndexOf('/')) || '.', {
        recursive: true,
      })
    _db = createDb(file)
  }
  return _db
}

/** 默认连接：按 DB_DRIVER 懒分派 sqlite/postgres；单例缓存。 */
export function db(): AnyDb {
  return resolveDbDriver() === 'postgres' ? (_pg ??= createPostgresDb()) : sqliteDb()
}

export function createPostgresDb(url: string = process.env.DATABASE_URL ?? ''): PgAppDb {
  return drizzlePg(createPostgresClient(url), { schema: pgSchema })
}

export function createPostgresClient(
  url: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (!url) throw new Error('DB_DRIVER=postgres requires DATABASE_URL (postgres://…) URL')
  const ssl = pgConnectOptions(env)
  let hostname = ''
  if (ssl) {
    try {
      const parsed = new URL(url)
      hostname = parsed.hostname.replace(/^\[|\]$/g, '')
      if (
        !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        !hostname ||
        hostname.includes(',')
      ) {
        throw new Error('invalid endpoint')
      }
    } catch {
      throw new Error('Verified PostgreSQL TLS requires one explicit DATABASE_URL hostname')
    }
  }
  // Always pass ssl explicitly: URL/PGSSL options must not weaken this policy.
  return postgres(url, {
    max: 10,
    ssl: ssl
      ? {
          ...ssl,
          // postgres.js omits SNI for IPs; Node can otherwise validate 'localhost'.
          checkServerIdentity: (_name: string, certificate: PeerCertificate) =>
            checkServerIdentity(hostname, certificate),
        }
      : false,
  })
}

// Production always verifies TLS. Development can use an explicit local plaintext
// connection; neither connection strings nor legacy `require` disable verification.
export function pgConnectOptions(
  env: Record<string, string | undefined> = process.env,
): { rejectUnauthorized: true; ca?: string } | null {
  const mode = (env.PG_SSL ?? '').trim().toLowerCase()
  const caFile = (env.PG_SSL_CA_FILE ?? '').trim()
  const production = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
  // Node's process-wide TLS escape hatch must never be present in a
  // production process, even though the client below passes an explicit
  // rejectUnauthorized=true option. Fail closed before creating a client.
  if (production && (env.NODE_TLS_REJECT_UNAUTHORIZED ?? '').trim() === '0') {
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed in production')
  }
  if (!['', '0', 'false', '1', 'true', 'require', 'verify-full'].includes(mode)) {
    throw new Error('Invalid PG_SSL: use 1/verify-full, or 0 for local development')
  }
  const disabled = mode === '0' || mode === 'false'
  if (disabled && (production || caFile)) {
    throw new Error('PostgreSQL TLS cannot be disabled in production or with PG_SSL_CA_FILE')
  }
  if (disabled || (!mode && !production && !caFile)) return null
  if (!caFile) return { rejectUnauthorized: true }
  try {
    const ca = readFileSync(caFile, 'utf8')
    // Reject empty/malformed mounts before attempting a network connection.
    new X509Certificate(ca)
    return { rejectUnauthorized: true, ca }
  } catch {
    // Do not expose the file path, certificate, or underlying filesystem error.
    throw new Error('PG_SSL_CA_FILE must contain a readable PEM certificate bundle')
  }
}

const postgresMigrationLockKey = 'evoloop:postgres-schema-migrations'

/**
 * Run PostgreSQL migrations while holding a database-level transaction lock.
 * Drizzle's built-in migrator reads the last migration before opening its
 * transaction, so independent processes can otherwise execute the same file.
 */
async function migratePostgresWithLock(client: ReturnType<typeof postgres>): Promise<void> {
  const migrations = readMigrationFiles(postgresMigrations)
  await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${postgresMigrationLockKey}, 0))`
    await tx`CREATE SCHEMA IF NOT EXISTS "drizzle"`
    await tx`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `

    const dbMigrations = await tx`
      SELECT id, hash, created_at
      FROM "drizzle"."__drizzle_migrations"
      ORDER BY created_at DESC
      LIMIT 1
    `
    const lastDbMigration = dbMigrations[0] as { created_at: string | number | null } | undefined
    for (const migration of migrations) {
      if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
        for (const statement of migration.sql) await tx.unsafe(statement)
        await tx`
          INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
          VALUES (${migration.hash}, ${migration.folderMillis})
        `
      }
    }
  })
}

// 每个 pg 实例只运行一次版本化迁移，失败可重试。
const pgTablesReady = new WeakMap<object, Promise<void>>()

export function ensurePgTables(database: PgAppDb): Promise<void> {
  const pending = pgTablesReady.get(database)
  if (pending) return pending
  const run = migratePostgresWithLock((database as PgClientDb).$client).catch((e) => {
    pgTablesReady.delete(database)
    throw e
  })
  pgTablesReady.set(database, run)
  return run
}
