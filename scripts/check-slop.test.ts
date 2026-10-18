// @vitest-environment node
/**
 * check-slop 的回归测试。
 *
 * 重点不是「能扫出东西」，而是**锁住曾经出现过的假阳性**：本项目的人工审计里，
 * 扫描器连续产出过四批错误结论（51 条不可达、14 条被注释掉的代码、45 条死导出、
 * 0 条 skip）。每一条都已在下面对应一个用例。改动判据时若这些用例变红，说明在重犯。
 */
import { describe, expect, it } from 'vitest'
import { RULES, analyzeFile, analyzeProject, resolveSpecifier } from './check-slop.mjs'

type Finding = { rule: string; file: string; line: number; symbol?: string; message: string }

const file = (fileName: string, text: string) => ({ fileName, text })

// analyzeProject 来自 .mjs，此处收敛为本地 Finding 类型，便于断言 message/symbol。
const analyze = (
  files: { fileName: string; text: string }[],
  options?: { manifestText?: string },
) => analyzeProject(files, options) as Finding[]

const withRule = (findings: Finding[], rule: string) =>
  findings.filter((finding) => finding.rule === rule)

describe('alwaysTerminates：只有必然终止才算终止', () => {
  it('无 else 的 if 不终止（这正是 51 条假阳性不可达的根因）', () => {
    const { text } = file('a.ts', 'function f(c: boolean) { if (c) { return 1 } return 2 }')
    const findings = analyze([file('a.ts', text)])
    expect(withRule(findings, 'unreachable')).toHaveLength(0)
  })

  it('if/else 两支都终止时，其后的语句确实不可达', () => {
    const findings = analyze([
      file(
        'a.ts',
        [
          'export function f(c: boolean): number {',
          '  if (c) { return 1 } else { return 2 }',
          '  return 3',
          '}',
        ].join('\n'),
      ),
    ])
    expect(withRule(findings, 'unreachable').length).toBeGreaterThan(0)
  })

  it('return 后的语句不可达，函数声明除外（会被提升）', () => {
    const findings = analyze([
      file(
        'a.ts',
        [
          'export function f() {',
          '  return 1',
          '  function hoisted() {}',
          '  const dead = 2',
          '}',
        ].join('\n'),
      ),
    ])
    const unreachable = withRule(findings, 'unreachable')
    expect(unreachable).toHaveLength(1)
    expect(unreachable[0].message).toContain('dead')
  })
})

describe('被注释掉的代码：不把文档注释当垃圾', () => {
  it('单行块注释 /** ... */ 不是被注释掉的代码（曾误报 14 条）', () => {
    const findings = analyze([
      file('src/lib/a.ts', '/** 单篇查询；slug 不合法或不存在 → null。 */\nexport const a = 1\n'),
    ])
    expect(withRule(findings, 'commented-out-code')).toHaveLength(0)
  })

  it('多行文档注释内部的星号行不是被注释掉的代码', () => {
    const findings = analyze([
      file(
        'src/lib/a.ts',
        ['/**', ' * 说明第二行', ' * @returns 结果', ' */', 'export const a = 1'].join('\n'),
      ),
    ])
    expect(withRule(findings, 'commented-out-code')).toHaveLength(0)
  })

  it('真正被注释掉的代码会被报出来', () => {
    const findings = analyze([
      file('src/lib/a.ts', ['// const legacy = compute()', 'export const a = 1'].join('\n')),
    ])
    expect(withRule(findings, 'commented-out-code')).toHaveLength(1)
  })
})

describe('死导出：区分框架入口、本地使用与真死', () => {
  it('src/app/** 的导出由 Next.js 消费，不是死导出（曾误报 45 条中的多数）', () => {
    const findings = analyze([
      file('src/app/page.tsx', 'export default function HomePage() { return null }\n'),
    ])
    expect(findings).toHaveLength(0)
  })

  it('仅在文件内使用的导出类型不是死代码（属导出面偏大）', () => {
    const findings = analyze([
      file(
        'src/lib/b.ts',
        [
          'export interface Props { x: number }',
          'function own(p: Props) { return p.x }',
          'own({ x: 1 })',
        ].join('\n'),
      ),
    ])
    // Props 只在本文件内使用，属导出面偏大，不是死导出
    expect(withRule(findings, 'dead-export')).toHaveLength(0)
  })

  it('字符串字面量里的名字不算跨文件消费者（夹具不得遮蔽死导出）', () => {
    const findings = analyze([
      file('src/lib/c.ts', 'export const siteUrl = () => 1\n'),
      // 另一个文件只在字符串里提到这个名字：这不是消费者
      file('src/lib/fixture.test.ts', "const label = 'siteUrl'\n"),
    ])
    expect(withRule(findings, 'dead-export').map((finding) => finding.symbol)).toEqual(['siteUrl'])
  })

  it('真实的标识符引用算消费者', () => {
    const findings = analyze([
      file('src/lib/c.ts', 'export const siteUrl = () => 1\n'),
      file('src/lib/use.ts', 'export const u = () => siteUrl()\n'),
    ])
    // use.ts 自己的 u 无人引用本就该被报出，所以只断言 siteUrl 不是死导出
    expect(withRule(findings, 'dead-export').map((finding) => finding.symbol)).not.toContain(
      'siteUrl',
    )
  })

  it('文件内外都没有消费者的导出会被报出来', () => {
    const findings = analyze([file('src/lib/c.ts', 'export const siteUrl = () => 1\n')])
    const dead = withRule(findings, 'dead-export')
    expect(dead).toHaveLength(1)
    expect(dead[0].symbol).toBe('siteUrl')
  })

  it('被其他文件引用的导出不是死导出', () => {
    const findings = analyze([
      file('src/lib/d.ts', 'export const shared = 1\n'),
      file('src/lib/e.ts', "import { shared } from './d'\nexport const use = () => shared\n"),
    ])
    expect(withRule(findings, 'dead-export').map((finding) => finding.symbol)).not.toContain(
      'shared',
    )
  })
})

describe('无入口文件：manifest 与相对导入都算入口', () => {
  it('由 package.json 按文件名调用的脚本不是无入口文件', () => {
    const findings = analyze([file('scripts/tool.mjs', 'console.log(1)\n')], {
      manifestText: '"check:tool": "node scripts/tool.mjs"',
    })
    expect(withRule(findings, 'unreferenced-file')).toHaveLength(0)
  })

  it('既无导入也无 manifest 引用的文件会被报出来', () => {
    const findings = analyze([file('scripts/orphan.mjs', 'console.log(1)\n')], {
      manifestText: '',
    })
    expect(withRule(findings, 'unreferenced-file')).toHaveLength(1)
  })

  it('被相对路径导入的文件不是无入口文件', () => {
    const findings = analyze([
      file('src/lib/f.ts', 'export const f = 1\n'),
      file('src/lib/g.ts', "import { f } from './f'\nexport const g = f\n"),
    ])
    // g.ts 自身确实是孤儿（无人导入它），但 f.ts 被导入了，不该被报。
    expect(withRule(findings, 'unreferenced-file').map((finding) => finding.file)).not.toContain(
      'src/lib/f.ts',
    )
  })

  it('@/ 别名解析到 src/', () => {
    expect(resolveSpecifier('src/app/x.ts', '@/lib/seo', new Set(['src/lib/seo.ts']))).toBe(
      'src/lib/seo.ts',
    )
    expect(resolveSpecifier('src/app/x.ts', '@/lib/seo', new Set(['src/lib/seo.tsx']))).toBe(
      'src/lib/seo.tsx',
    )
    expect(resolveSpecifier('src/app/x.ts', 'react', new Set())).toBeNull()
  })
})

describe('测试文件：区分真 focus 与合法条件跳过', () => {
  it('describe.runIf 是合法的选择性集成测试，不是 stray-focus（曾导致 skip 计数为 0）', () => {
    const findings = analyze([
      file('src/db/a.integration.test.ts', "describe.runIf(Boolean(url))('tls', () => {})"),
    ])
    expect(withRule(findings, 'stray-focus-test')).toHaveLength(0)
    expect(withRule(findings, 'conditional-skip-test')).toHaveLength(1)
  })

  it('.only 会静默跳过其余测试，属阻塞项', () => {
    const findings = analyze([file('src/db/a.test.ts', "it.only('x', () => {})")])
    expect(withRule(findings, 'stray-focus-test')).toHaveLength(1)
    expect(RULES['stray-focus-test'].blocking).toBe(true)
  })

  it('非测试文件里的 .only 方法调用不触发该判据', () => {
    const findings = analyze([file('src/lib/h.ts', 'export const h = (q) => db.only(q)')])
    expect(withRule(findings, 'stray-focus-test')).toHaveLength(0)
  })
})

describe('抑制指令：只有 @ts-ignore 缺理由才阻塞', () => {
  it('@ts-ignore 无理由 → 阻塞', () => {
    const findings = analyze([file('src/lib/i.ts', '// @ts-ignore\nexport const i = 1')])
    expect(withRule(findings, 'ts-ignore-without-reason')).toHaveLength(1)
    expect(RULES['ts-ignore-without-reason'].blocking).toBe(true)
  })

  it('@ts-ignore 带理由 → 不报', () => {
    const findings = analyze([
      file('src/lib/i.ts', '// @ts-ignore 第三方类型与运行时不一致\nexport const i = 1'),
    ])
    expect(withRule(findings, 'ts-ignore-without-reason')).toHaveLength(0)
  })

  it('eslint-disable 未用 -- 说明理由 → 仅提示，不阻塞', () => {
    const findings = analyze([
      file(
        'src/lib/j.ts',
        '// eslint-disable-next-line react-hooks/exhaustive-deps\nexport const j = 1',
      ),
    ])
    expect(withRule(findings, 'eslint-disable-without-reason')).toHaveLength(1)
    expect(RULES['eslint-disable-without-reason'].blocking).toBe(false)
  })
})

describe('analyzeFile：单文件契约', () => {
  it('返回导出清单，且不产生跨文件判据', () => {
    const single = analyzeFile('src/lib/k.ts', 'export const k = 1\nexport type K = number\n')
    expect(single.exports.map((entry) => entry.name).sort()).toEqual(['K', 'k'])
    expect(single.findings).toHaveLength(0)
  })
})

describe('判据表自身的约束', () => {
  it('每条规则都有阻塞标记与说明', () => {
    for (const [rule, definition] of Object.entries(RULES)) {
      expect(typeof definition.blocking, rule).toBe('boolean')
      expect(definition.summary.length, rule).toBeGreaterThan(0)
    }
  })
})
