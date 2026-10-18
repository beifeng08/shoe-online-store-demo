import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ===========================================================================
// 对比度契约测试（WCAG 1.4.3 AA）。锁定设计系统里「正文/次级文本/链接/按钮」
// 在浅色与深色底上的实际对比率，防未来调 token 时误伤可读性。
//
// jsdom 跑不了 axe 的 color-contrast（无真实布局），此文件是它的确定性替代：
// luminance()/contrast() 自己算，不依赖布局。这是本文件的核心资产，勿替换成解析 CSS
// 后重算——那需要 OKLCH→sRGB 转换（见 DARK_NEUTRAL 注释），写错会得到假绿。
//
// token 来源分三类，处理方式不同：
//   1. 语义色板（--canvas/--ink/--brand/--surface）：globals.css 里是 hex。
//      → 由「漂移断言」直接读文件核对，镜像过期即红。
//   2. 浅色 tailwind neutral 阶梯：hex 字面量，见 NEUTRAL。
//   3. 深色 neutral 阶梯：globals.css 用 oklch()，本文件用解析后的 hex 常量。
//      不假装解析：C=0 时线性 sRGB = L³，故恒可用一条短推导复现（见下）。
// ===========================================================================

/** globals.css 的语义色板。漂移断言会逐项核对，改动 globals.css 后这里必须同步。 */
const PALETTE = {
  light: { canvas: '#fafaf8', ink: '#111111', brand: '#0f766e', surface: '#ffffff' },
  dark: { canvas: '#141414', ink: '#f4f4f1', brand: '#2dd4bf', surface: '#202020' },
}

/** 浅色 tailwind neutral 阶梯（hex）。小字正文的下限是 500。 */
const NEUTRAL = { 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 900: '#171717' }

// 深色 ramp 在 globals.css 里是 oklch(L 0 0)。C=0 时 OKLab 的 l=m=s=L，
// 于是线性 sRGB = L³，再套 gamma 编码即得 hex：
//   oklch(0.5  0 0) → #636363   （深色 neutral-400）
//   oklch(0.63 0 0) → #898989   （深色 neutral-500，即正文下限）
// 注意 #898989 而非 #8f8f8f：用 #8f8f8f 会让深色断言偏乐观（5.04 而非真实的 4.66）。
const DARK_NEUTRAL = { 400: '#636363', 500: '#898989' }

function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i + 1, i + 3), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

function contrast(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** 普通文本需 ≥4.5:1；大文本/UI 组件边界需 ≥3:1（本系统不单列，统一按正文 4.5 要求）。 */
function expectAA(fg: string, bg: string, label: string) {
  const r = contrast(fg, bg)
  expect(r, `${label}: ${fg} on ${bg} = ${r.toFixed(2)} (need ≥4.5)`).toBeGreaterThanOrEqual(4.5)
}

// ---------------------------------------------------------------------------
// 漂移断言：镜像常量与 globals.css 的实际值不一致时失败。
// 只读 hex 语义色板（两边都是 hex），刻意不解析 oklch——这里的目标是「发现漂移」
// 而不是「从 CSS 重算对比度」，把事情做小才做得对。
// ---------------------------------------------------------------------------
// 用 process.cwd() 而非 import.meta.url：vitest 把 import.meta.url 转成非 file: 协议，
// new URL(..., import.meta.url) 会报「The URL must be of scheme file」。vitest 以仓库根为 cwd。
const GLOBALS_CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** 取出某个 CSS 块里的 `--<name>: #hex` 值；解析不到返回 null 以便失败信息可读。 */
function tokenValue(block: string, name: string): string | null {
  const marker = `--${name}`
  let from = 0
  for (;;) {
    const at = block.indexOf(marker, from)
    if (at < 0) return null
    // 必须紧跟冒号且后面是 hex：跳过 `var(--name)` 这类引用（其后面是右括号）。
    const match = /^:\s*(#[0-9a-fA-F]{3,8})/.exec(block.slice(at + marker.length))
    if (match) return match[1].toLowerCase()
    from = at + marker.length
  }
}

describe('a11y: 语义色板镜像未过期（drift）', () => {
  // 必须锚在行首：文件顶部有 `@custom-variant dark (@media (prefers-color-scheme: dark));`，
  // 裸 indexOf 会命中它，使浅色块被截断、深色块从第 5 行开始而抽出浅色值。
  const marker = '\n@media (prefers-color-scheme: dark)'
  const splitAt = GLOBALS_CSS.indexOf(marker)

  it('globals.css 仍可被本断言解析（结构变更时给出明确失败）', () => {
    expect(GLOBALS_CSS.length, 'globals.css 读成空文件 —— cwd 或路径不对').toBeGreaterThan(1000)
    expect(
      splitAt,
      'globals.css 的深色 @media 块位置变了或格式变了；请更新本文件的切分方式，不要静默跳过',
    ).toBeGreaterThan(0)
  })

  const lightBlock = GLOBALS_CSS.slice(0, splitAt)
  const darkBlock = GLOBALS_CSS.slice(splitAt)

  for (const [label, theme, block] of [
    ['浅色 :root', 'light', lightBlock],
    ['深色 @media', 'dark', darkBlock],
  ] as const) {
    for (const name of ['canvas', 'ink', 'brand', 'surface'] as const) {
      it(`${label} --${name} 与镜像常量一致`, () => {
        expect(
          tokenValue(block, name),
          `globals.css 的 ${label} --${name} 已变更；请同步本文件 PALETTE 与相应对比度断言`,
        ).toBe(PALETTE[theme][name])
      })
    }
  }
})

describe('a11y: contrast contract (WCAG 1.4.3 AA, normal text ≥4.5)', () => {
  it('light theme: ink & body text on canvas/surface', () => {
    expectAA(PALETTE.light.ink, PALETTE.light.canvas, 'ink on canvas')
    expectAA(PALETTE.light.ink, PALETTE.light.surface, 'ink on surface')
    expectAA(NEUTRAL[900], PALETTE.light.surface, 'card title neutral-900 on surface')
    expectAA(NEUTRAL[600], PALETTE.light.surface, 'secondary neutral-600 on surface')
    // 次级小字下限：neutral-500 是代码中的最浅正文（404/500 修复后的约定下限）。
    expectAA(NEUTRAL[500], PALETTE.light.surface, 'muted neutral-500 on surface')
    expectAA(NEUTRAL[500], PALETTE.light.canvas, 'muted neutral-500 on canvas')
  })

  it('light theme: brand link/eyebrow on canvas', () => {
    expectAA(PALETTE.light.brand, PALETTE.light.canvas, 'brand on canvas')
    expectAA(PALETTE.light.brand, PALETTE.light.surface, 'brand on surface')
  })

  it('dark theme: ink-like foreground on canvas/surface', () => {
    expectAA(PALETTE.dark.ink, PALETTE.dark.canvas, 'ink on canvas (dark)')
    expectAA(PALETTE.dark.ink, PALETTE.dark.surface, 'ink on surface (dark)')
    expectAA(PALETTE.dark.brand, PALETTE.dark.canvas, 'brand on canvas (dark)')
    expectAA(PALETTE.dark.brand, PALETTE.dark.surface, 'brand on surface (dark)')
  })

  it('dark theme: 深色 neutral-500 仍达 AA（余量薄，改 token 需同时复核此断言）', () => {
    expectAA(DARK_NEUTRAL[500], PALETTE.dark.canvas, 'dark neutral-500 on canvas')
    expectAA(DARK_NEUTRAL[500], PALETTE.dark.surface, 'dark neutral-500 on surface')
  })

  it('guardrail: neutral-400 在浅色与深色下都不达 AA，故不得用作正文', () => {
    // 这条断言原先叫「neutral-400 is NOT used as body text anymore」，但它只算比值、
    // 不检查用途，于是 my-size-guide 里 12px 的真实文字用回 neutral-400 时它照样全绿。
    // 现在只声明它能证实的事（比值约束），用途由组件层的类名与本断言共同保证。
    expect(contrast(NEUTRAL[400], PALETTE.light.surface)).toBeLessThan(4.5) // #a3a3a3 → 2.52
    expect(contrast(DARK_NEUTRAL[400], PALETTE.dark.surface)).toBeLessThan(4.5) // #636363 → 2.71
  })
})
