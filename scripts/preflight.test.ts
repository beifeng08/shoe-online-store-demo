// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluatePreflight, parseEnvironment } from './preflight.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const scriptPath = path.join(repoRoot, 'scripts/preflight.mjs')

/**
 * Pester 版本里那条「可接受的」生产配置，改成显式对象后不再污染测试进程的环境变量。
 * 两个密钥用 repeat 生成：既明确表达「这里是 32 字节」，也避免被密钥扫描器当成本地真实凭据。
 */
const verifiableProductionEnv = {
  APP_ENV: 'production',
  DB_DRIVER: 'postgres',
  DATABASE_URL: 'postgresql://db.example/evoloop',
  PG_SSL: 'verify-full',
  PYTHON_API_URL: 'http://commerce.internal:8000',
  AI_SESSION_SECRET: 's'.repeat(32),
  COMMERCE_PROXY_SECRET: 'p'.repeat(32),
}

/**
 * 只给子进程一份最小且确定的环境：PATH + 显式变量，绝不继承宿主环境，否则断言会受开发机
 * .env.local / shell 变量影响。NODE_ENV 必须显式给出：Next.js 的类型把它声明为 ProcessEnv 的必填成员。
 */
function runCli(args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'development', ...env },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('preflight CLI', () => {
  it('rejects local and insecure production settings', () => {
    const { status, stderr } = runCli(['--environment', 'production'], {
      NODE_ENV: 'production',
      DB_DRIVER: 'sqlite',
      DATABASE_URL: 'sqlite:///./data/local.db',
      PG_SSL: '0',
      PYTHON_API_URL: 'http://127.0.0.1:8000',
      AI_SESSION_SECRET: 'short',
      APP_ENV: 'development',
      SHOPIFY_ENABLED: 'false',
    })

    for (const needle of [
      'AI_SESSION_SECRET',
      'APP_ENV',
      'DB_DRIVER',
      'DATABASE_URL',
      'PG_SSL',
      'PYTHON_API_URL',
    ]) {
      expect(stderr).toContain(needle)
    }
    expect(status).toBe(1)
  })

  it('accepts verified PostgreSQL and internal service configuration', () => {
    const { status, stdout } = runCli(['--environment', 'production'], verifiableProductionEnv)

    expect(stdout).toContain('configuration passed')
    expect(status).toBe(0)
  })

  it('rejects a missing explicit production environment', () => {
    const { status, stderr } = runCli(['--environment', 'production'], {
      ...verifiableProductionEnv,
      APP_ENV: '',
    })

    expect(stderr).toContain('APP_ENV')
    expect(status).toBe(1)
  })

  it('still accepts the legacy PowerShell argument spelling', () => {
    // README 曾记录 `npm run preflight -- -Environment production`；移植后不能把它弄坏。
    const { status } = runCli(['-Environment', 'production'], verifiableProductionEnv)

    expect(status).toBe(0)
  })

  it('rejects an unknown environment value instead of defaulting silently', () => {
    const { status, stderr } = runCli(['--environment', 'staging'], verifiableProductionEnv)

    expect(stderr).toContain('--environment')
    expect(status).toBe(1)
  })

  it('reports a rejected secret by name without echoing its value', () => {
    // 故意低于 32 字节：这样它既会被列入失败项，又能验证输出没有回显取值。
    const notASecret = 'do-not-print-this'
    const { stdout, stderr } = runCli(['--environment', 'production'], {
      ...verifiableProductionEnv,
      AI_SESSION_SECRET: notASecret,
      COMMERCE_PROXY_SECRET: notASecret,
    })

    expect(stdout).not.toContain(notASecret)
    expect(stderr).not.toContain(notASecret)
    expect(stderr).toContain('AI_SESSION_SECRET')
    expect(stderr).toContain('COMMERCE_PROXY_SECRET')
  })
})

describe('evaluatePreflight', () => {
  it('returns no failures for a verified production configuration', () => {
    expect(evaluatePreflight(verifiableProductionEnv, 'production')).toEqual([])
  })

  it('treats a local plaintext development configuration as acceptable', () => {
    expect(evaluatePreflight({ PG_SSL: '0', SHOPIFY_ENABLED: 'false' }, 'development')).toEqual([])
  })

  it('keeps the Shopify compatibility purchase path disabled in every environment', () => {
    for (const value of ['1', 'true', 'yes', 'TRUE']) {
      const failures = evaluatePreflight({ SHOPIFY_ENABLED: value }, 'development')
      expect(failures.join('\n')).toContain('SHOPIFY_ENABLED')
    }
  })

  it('counts secret length in bytes, not characters', () => {
    const thirtyOneBytes = 'a'.repeat(31)
    const thirtyTwoBytes = 'a'.repeat(32)
    const sixteenMultibyteChars = '密'.repeat(16)

    const rejects = (secret: string) =>
      evaluatePreflight(
        { ...verifiableProductionEnv, AI_SESSION_SECRET: secret },
        'production',
      ).some((failure) => failure.includes('AI_SESSION_SECRET'))

    expect(rejects(thirtyOneBytes)).toBe(true)
    expect(rejects(thirtyTwoBytes)).toBe(false)
    // 16 个三字节 UTF-8 字符 = 48 字节，必须通过；按字符数比较会误判为不合格。
    expect(rejects(sixteenMultibyteChars)).toBe(false)
  })

  it('mirrors the case-insensitive comparisons of the PowerShell original', () => {
    const failures = evaluatePreflight(
      { ...verifiableProductionEnv, PG_SSL: 'VERIFY-FULL', DB_DRIVER: 'POSTGRES' },
      'production',
    )

    expect(failures).toEqual([])
  })

  it('does not accept a loopback PYTHON_API_URL in production', () => {
    for (const url of ['http://127.0.0.1:8000', 'http://localhost:8000', 'http://[::1]:8000']) {
      const failures = evaluatePreflight(
        { ...verifiableProductionEnv, PYTHON_API_URL: url },
        'production',
      )
      expect(failures.join('\n')).toContain('PYTHON_API_URL')
    }
  })

  it('rejects plaintext TLS when a CA file is configured', () => {
    const caFile = path.join(mkdtempSync(path.join(tmpdir(), 'preflight-')), 'ca.pem')
    writeFileSync(caFile, 'certificate')

    const failures = evaluatePreflight({ PG_SSL: '0', PG_SSL_CA_FILE: caFile }, 'development')

    expect(failures.join('\n')).toContain('development-only')
  })

  it('requires PG_SSL_CA_FILE to be an existing file rather than a directory', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'preflight-'))
    const file = path.join(directory, 'ca.pem')
    writeFileSync(file, 'certificate')
    const nested = path.join(directory, 'nested')
    mkdirSync(nested)

    const fails = (candidate: string) =>
      evaluatePreflight({ PG_SSL_CA_FILE: candidate }, 'development').join('\n')

    expect(fails(path.join(directory, 'missing.pem'))).toContain('PG_SSL_CA_FILE')
    expect(fails(nested)).toContain('PG_SSL_CA_FILE')
    expect(fails(file)).toBe('')
  })
})

describe('parseEnvironment', () => {
  it('accepts both GNU and PowerShell spellings, plus =value', () => {
    expect(parseEnvironment(['--environment', 'production'], {})).toBe('production')
    expect(parseEnvironment(['--environment=production'], {})).toBe('production')
    expect(parseEnvironment(['-Environment', 'production'], {})).toBe('production')
  })

  it('falls back to NODE_ENV and then to development', () => {
    expect(parseEnvironment([], { NODE_ENV: 'production' })).toBe('production')
    expect(parseEnvironment([], {})).toBe('development')
  })
})
