#!/usr/bin/env node
/**
 * 部署前环境预检：只读取环境变量，逐条输出不通过项，绝不打印任何密钥值。
 *
 * 用法：
 *   npm run preflight -- --environment production
 *   npm run preflight                       # 默认取 NODE_ENV，否则 development
 *
 * 本文件是 scripts/preflight.ps1 的平台无关移植（原文件已删除，历史实现见 git log）。
 * 判定逻辑集中在可测的 evaluatePreflight()，CLI 只是薄壳。
 */
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENVIRONMENTS = ['development', 'production']

const TRUTHY = ['1', 'true', 'yes']
const TRUSTED_TLS_MODES = ['1', 'true', 'require', 'verify-full']
const PLAINTEXT_TLS_MODES = ['0', 'false']
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]']

/**
 * PowerShell 的 -in / -ne / -notin 默认大小写不敏感，-cne 才区分大小写。
 * 这里保持同样语义，以免移植后打断既有部署配置（例如 PG_SSL=VERIFY-FULL）。
 */
const inList = (value, list) => list.includes(String(value ?? '').toLowerCase())
const isBlank = (value) => value === undefined || value === null || String(value).trim() === ''
const byteLength = (value) => Buffer.byteLength(String(value), 'utf8')

function isLoopbackUrl(value) {
  try {
    return LOOPBACK_HOSTS.includes(new URL(value).hostname.toLowerCase())
  } catch {
    // 原 PowerShell 的 Is-LoopbackUrl 在解析失败时返回 $false；保持一致。
    return false
  }
}

function isReadableFile(value) {
  try {
    return existsSync(value) && statSync(value).isFile()
  } catch {
    return false
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {'development' | 'production'} environment
 * @returns {string[]} 不通过项；空数组表示通过
 */
export function evaluatePreflight(env, environment) {
  const failures = []

  if (environment === 'production') {
    if (env.APP_ENV !== 'production') {
      failures.push('APP_ENV must be explicitly set to production in production.')
    }
    if (isBlank(env.AI_SESSION_SECRET) || byteLength(env.AI_SESSION_SECRET) < 32) {
      failures.push('AI_SESSION_SECRET must contain at least 32 bytes in production.')
    }
    if (isBlank(env.COMMERCE_PROXY_SECRET) || byteLength(env.COMMERCE_PROXY_SECRET) < 32) {
      failures.push('COMMERCE_PROXY_SECRET must contain at least 32 bytes in production.')
    }
    if (!inList(env.DB_DRIVER, ['postgres'])) {
      failures.push('DB_DRIVER must be postgres in production.')
    }
    if (!/^postgres(?:ql)?:\/\//i.test(String(env.DATABASE_URL ?? ''))) {
      failures.push('DATABASE_URL must be a PostgreSQL URL in production.')
    }
    if (!inList(env.PG_SSL, TRUSTED_TLS_MODES)) {
      failures.push('PG_SSL must enable certificate verification in production.')
    }
    if (!isBlank(env.PYTHON_API_URL) && isLoopbackUrl(env.PYTHON_API_URL)) {
      failures.push('PYTHON_API_URL must not point to loopback in production.')
    }
  }

  if (inList(env.SHOPIFY_ENABLED, TRUTHY)) {
    failures.push(
      'SHOPIFY_ENABLED=true is outside this MVP; keep the compatibility purchase path disabled.',
    )
  }

  if (
    inList(env.PG_SSL, PLAINTEXT_TLS_MODES) &&
    (environment === 'production' || !isBlank(env.PG_SSL_CA_FILE))
  ) {
    failures.push(
      'PG_SSL plaintext mode is development-only and cannot be combined with PG_SSL_CA_FILE.',
    )
  }

  if (!isBlank(env.PG_SSL_CA_FILE) && !isReadableFile(env.PG_SSL_CA_FILE)) {
    failures.push('PG_SSL_CA_FILE must point to a readable certificate bundle.')
  }

  return failures
}

/**
 * 解析 `--environment <value>` / `--environment=<value>`；
 * 同时接受旧的 PowerShell 写法 `-Environment <value>`。
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function parseEnvironment(argv, env) {
  for (let index = 0; index < argv.length; index += 1) {
    const match = /^-{1,2}([A-Za-z]+)(?:=(.*))?$/.exec(argv[index])
    if (!match || match[1].toLowerCase() !== 'environment') {
      continue
    }
    return match[2] ?? argv[index + 1] ?? ''
  }
  return env.NODE_ENV || 'development'
}

function main() {
  const environment = parseEnvironment(process.argv.slice(2), process.env)

  if (!ENVIRONMENTS.includes(environment)) {
    console.error(
      `preflight: --environment must be one of ${ENVIRONMENTS.join(', ')} (got ${JSON.stringify(environment)}).`,
    )
    return 1
  }

  const failures = evaluatePreflight(process.env, environment)

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`preflight: ${failure}`)
    }
    return 1
  }

  console.log(`preflight: ${environment} configuration passed without printing secrets.`)
  return 0
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
