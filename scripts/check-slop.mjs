#!/usr/bin/env node
/**
 * 零依赖 AI Slop 扫描器（TypeScript 侧）：找「删掉不影响行为、却伪装成有信息量」的代码。
 *
 * 用法：
 *   npm run check:slop            # 人读输出，有阻塞项时退出码 1
 *   npm run check:slop -- --json  # 机器可读，供门禁消费
 *
 * 只覆盖机械可判定的部分。语义判据（注释是否空心、测试是否真在验证行为）机械测不出来，
 * 不属于本工具职责——不要因为扫描通过就认为没有 slop。
 *
 * 判定逻辑集中在可测的纯函数 analyzeFile() / analyzeProject()，CLI 只是薄壳。
 *
 * 本项目人工审计期间，扫描器连续产出过多批错误结论，每一批都固化为回归用例：
 *   · 51 条假的「不可达」：if (c) { return } 无 else 时，其后并非不可达
 *   · 14 条假的「被注释掉的代码」：单行块注释 /** ... *\/ 被当成代码
 *   · 45 条假的「死导出」：src/app/** 的框架导出、以及仅在本文件内使用的类型
 *   · 0 条 skip：条件集成测试 describe.runIf() 未被识别，且不是 stray-focus
 *   · 自指的假阳性：测试夹具里的字符串字面量、以及 RULES 表里的标记词本身
 *   · 被自指夹具遮住的假阴性：测试夹具的字符串被当成外部消费者，放过了真死导出
 *
 * 最后一条促成了本文件的核心实现选择：**注释类判据走注释 token，focus 类判据走 AST**，
 * 而不是逐行匹配文本。任何按行匹配字符串字面量的实现都会把夹具和常量当代码。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// typescript 从本文件所在包解析（而非调用时的 cwd），保证从任意目录调用都可用。
const requireFromHere = createRequire(import.meta.url)
const ts = requireFromHere('typescript')

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 规则的严重度决定退出码：blocking 会让 check:slop 失败，advisory 只提示。
 * 只有「在人工审计中被反复确认、且假阳性已被回归测试锁住」的判据才允许标 blocking。
 */
export const RULES = {
  'unreferenced-file': { blocking: true, summary: '没有任何入口可达的源文件' },
  'dead-export': { blocking: true, summary: '导出符号在文件内外都没有消费者' },
  unreachable: { blocking: true, summary: 'return/throw 之后永不可达的语句' },
  'stray-focus-test': { blocking: true, summary: '.only/fit/fdescribe 会静默跳过其余测试' },
  'ts-ignore-without-reason': { blocking: true, summary: '@ts-ignore 未说明理由' },
  'commented-out-code': { blocking: false, summary: '被注释掉的代码' },
  'todo-marker': { blocking: false, summary: 'TODO/FIXME 标记' },
  'conditional-skip-test': {
    blocking: false,
    summary: '条件跳过的测试（可能是合法选择性集成测试）',
  },
  'eslint-disable-without-reason': { blocking: false, summary: 'eslint-disable 未用 -- 说明理由' },
}

const SCAN_DIRS = ['src', 'scripts']
const SOURCE_FILE = /\.(ts|tsx|mjs|cjs|js|jsx)$/
const SKIP_DIR = /^(node_modules|\.next|\.git|\.worktrees|coverage|dist|__pycache__)$/
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
/** manifestText 的来源：由这些文件按文件名调用/记录的脚本是入口，不是无入口文件。 */
const MANIFEST_FILES = [
  'package.json',
  'README.md',
  'AGENTS.md',
  'backend/README.md',
  'docs/agents/verification.md',
  'docs/agents/task-routing.md',
]
const FOCUS_CALLS = ['only', 'fit', 'fdescribe']
const SKIP_CALLS = ['skip', 'todo', 'fails', 'skipIf', 'runIf', 'xit', 'xdescribe', 'xtest']
/** 只有这些属主上的方法名才算 vitest API，避免把普通同名方法当测试修饰符。 */
const TEST_API_OWNERS = ['it', 'test', 'describe']
const IDENTIFIER_TEST_CALLS = ['fit', 'xit', 'fdescribe', 'xdescribe', 'xtest']

/**
 * @typedef {{ rule: string, file: string, line: number, symbol?: string, message: string }} Finding
 * @typedef {{ name: string, kind: string, line: number, localUses: number }} ExportEntry
 * @typedef {{ exports: ExportEntry[], specifiers: string[], identifiers: Set<string>, findings: Finding[] }} FileAnalysis
 */

const isTestFile = (fileName) => TEST_FILE.test(fileName)
// Next.js App Router 的文件是框架入口：其导出不参与「有无消费者」判定。
const isFrameworkEntry = (fileName) => fileName.startsWith('src/app/')
const isExcludedFromDeadCode = (fileName) =>
  isFrameworkEntry(fileName) || isTestFile(fileName) || fileName.startsWith('src/test/')

/**
 * 只有「必然终止」的语句才算终止。这是本项目历史上最严重的假阳性来源：
 * 早期实现把 `if (cond) { return }` 当作必然终止，于是把它之后的每一行都报成不可达。
 * 带 else 且两支都终止的 if 才终止；try 需要 catch 且 try 块终止。
 */
function alwaysTerminates(statement) {
  if (!statement) return false
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return true
  }
  if (ts.isBlock(statement)) {
    return alwaysTerminates(statement.statements.at(-1))
  }
  if (ts.isIfStatement(statement)) {
    return (
      Boolean(statement.elseStatement) &&
      alwaysTerminates(statement.thenStatement) &&
      alwaysTerminates(statement.elseStatement)
    )
  }
  if (ts.isTryStatement(statement)) {
    return Boolean(statement.catchClause) && alwaysTerminates(statement.tryBlock)
  }
  return false
}

/**
 * 用 TS scanner 收集真正的注释 token 区间。
 * 关键：这样字符串字面量里的注释符与标记词不会被当成注释——逐行正则做不到这一点。
 *
 * @param {string} text
 * @param {import('typescript').ScriptKind} scriptKind
 * @returns {Array<{ pos: number, end: number, text: string }>}
 */
export function collectComments(text, scriptKind = ts.ScriptKind.TS) {
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, false, scriptKind, text)
  const comments = []
  let token = scanner.scan()
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      comments.push({
        pos: scanner.getTokenPos(),
        end: scanner.getTextPos(),
        text: text.slice(scanner.getTokenPos(), scanner.getTextPos()),
      })
    }
    token = scanner.scan()
  }
  return comments
}

/**
 * 单文件分析。纯函数：不读磁盘、不看其他文件，便于用假源码做回归测试。
 *
 * @param {string} fileName 仓库相对路径，统一用 `/` 分隔
 * @param {string} text 文件内容
 * @returns {FileAnalysis}
 */
export function analyzeFile(fileName, text) {
  const scriptKind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true, scriptKind)
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const exports = []
  const specifiers = []
  const findings = []
  // 标识符一律从 AST 取，绝不扫全文：字符串字面量里的名字不是引用。
  // 这里曾经用正则扫全文统计引用，结果本项目自己的测试夹具（里面的
  // 'export const siteUrl = ...' 字符串）把 src/lib/seo.ts 的死导出遮住了——
  // 门禁被自己的夹具骗过，比没有门禁更糟。
  const counts = new Map()
  const identifiers = new Set()
  const collectIdentifiers = (node) => {
    if (ts.isIdentifier(node)) {
      identifiers.add(node.text)
      counts.set(node.text, (counts.get(node.text) || 0) + 1)
    }
    ts.forEachChild(node, collectIdentifiers)
  }
  collectIdentifiers(sourceFile)
  const push = (name, kind, node) => {
    if (!name) return
    exports.push({ name, kind, line: lineOf(node), localUses: (counts.get(name) || 0) - 1 })
  }

  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    }
    const exported = (statement.modifiers || []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
    if (!exported) continue
    if (ts.isFunctionDeclaration(statement)) push(statement.name?.text, 'function', statement)
    else if (ts.isClassDeclaration(statement)) push(statement.name?.text, 'class', statement)
    else if (ts.isInterfaceDeclaration(statement)) push(statement.name.text, 'interface', statement)
    else if (ts.isTypeAliasDeclaration(statement)) push(statement.name.text, 'type', statement)
    else if (ts.isEnumDeclaration(statement)) push(statement.name.text, 'enum', statement)
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) push(declaration.name.text, 'const', declaration)
      }
    }
  }

  const walk = (node) => {
    if (ts.isBlock(node)) {
      let previousTerminated = false
      for (const statement of node.statements) {
        // 函数声明会被提升：它不算不可达，也不能清除已终止的状态，
        // 否则 `return; function h(){}; dead()` 里的 dead() 会被漏报。
        if (ts.isFunctionDeclaration(statement)) continue
        if (previousTerminated) {
          findings.push({
            rule: 'unreachable',
            file: fileName,
            line: lineOf(statement),
            message: statement.getText(sourceFile).slice(0, 90).replace(/\s+/g, ' '),
          })
        }
        previousTerminated = alwaysTerminates(statement)
      }
    }
    // focus / 条件跳过走 AST，避免把夹具里的字符串当代码。
    if (isTestFile(fileName) && ts.isCallExpression(node)) {
      const callee = node.expression
      // 必须确认这是测试 API：`fails(path)` 这类普通方法名太泛，直接看名字会误报。
      let name = null
      let isTestApi = false
      if (ts.isPropertyAccessExpression(callee)) {
        name = callee.name.text
        const owner = callee.expression
        isTestApi = ts.isIdentifier(owner) && TEST_API_OWNERS.includes(owner.text)
      } else if (ts.isIdentifier(callee)) {
        name = callee.text
        isTestApi = IDENTIFIER_TEST_CALLS.includes(callee.text)
      }
      if (!isTestApi) {
        ts.forEachChild(node, walk)
        return
      }
      if (name && FOCUS_CALLS.includes(name)) {
        findings.push({
          rule: 'stray-focus-test',
          file: fileName,
          line: lineOf(node),
          message: node.getText(sourceFile).slice(0, 100).replace(/\s+/g, ' '),
        })
      } else if (name && SKIP_CALLS.includes(name)) {
        findings.push({
          rule: 'conditional-skip-test',
          file: fileName,
          line: lineOf(node),
          message: node.getText(sourceFile).slice(0, 100).replace(/\s+/g, ' '),
        })
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)

  // 注释类判据只作用在注释 token 上，不会命中字符串字面量或正则字面量。
  for (const comment of collectComments(text, scriptKind)) {
    const startLine = sourceFile.getLineAndCharacterOfPosition(comment.pos).line + 1
    comment.text.split('\n').forEach((raw, offset) => {
      const line = startLine + offset
      const trimmed = raw.trim()
      // 文档注释以 /** 或 * 开头，不是被注释掉的代码——这里曾出现 14 条假阳性。
      const isDocComment =
        trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/')
      if (!isDocComment && trimmed.startsWith('//')) {
        const body = trimmed.slice(2).trim()
        if (
          /^(const|let|var|function|class|if|for|while|return|await|import|export|try|switch|throw|console\.|type |interface )/.test(
            body,
          ) &&
          /[;{}]$|\)\s*;?$|=>/.test(body)
        ) {
          findings.push({
            rule: 'commented-out-code',
            file: fileName,
            line,
            message: body.slice(0, 100),
          })
        }
      }
      const marker = /\b(TODO|FIXME|XXX|HACK)\b/.exec(trimmed)
      if (marker) {
        findings.push({
          rule: 'todo-marker',
          file: fileName,
          line,
          message: `${marker[1]}: ${trimmed.slice(0, 100)}`,
        })
      }
      const ignoreIndex = trimmed.indexOf('@ts-ignore')
      if (ignoreIndex >= 0) {
        const reason = trimmed.slice(ignoreIndex + '@ts-ignore'.length)
        if (reason.replace(/^[\s:–-]+/, '').length < 3) {
          findings.push({
            rule: 'ts-ignore-without-reason',
            file: fileName,
            line,
            message: trimmed.slice(0, 100),
          })
        }
      } else if (/eslint-disable(-next-line|-line)?/.test(trimmed) && !/--\s*\S/.test(trimmed)) {
        findings.push({
          rule: 'eslint-disable-without-reason',
          file: fileName,
          line,
          message: trimmed.slice(0, 100),
        })
      }
    })
  }

  return { exports, specifiers, identifiers, findings }
}

/** 解析 import/export 说明符到仓库相对路径；解析不到（第三方包）返回 null。 */
export function resolveSpecifier(fromFile, specifier, fileSet) {
  let base
  if (specifier.startsWith('@/')) {
    base = path.posix.join('src', specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  } else {
    return null
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null
}

/**
 * 跨文件分析：补上单文件看不到的两类判据（无入口文件、死导出）。
 *
 * @param {Array<{fileName: string, text: string}>} files 仓库相对路径 + 内容
 * @param {{ manifestText?: string }} [options] manifestText 用于识别由 package.json / 文档调用的脚本入口
 * @returns {Finding[]}
 */
export function analyzeProject(files, options = {}) {
  const manifestText = options.manifestText ?? ''
  const fileSet = new Set(files.map((file) => file.fileName))
  const analyzed = files.map((file) => ({ ...file, ...analyzeFile(file.fileName, file.text) }))
  const findings = []
  const importedBy = new Set()
  const mentions = new Map()

  for (const file of analyzed) {
    for (const specifier of file.specifiers) {
      const resolved = resolveSpecifier(file.fileName, specifier, fileSet)
      if (resolved) importedBy.add(resolved)
    }
    for (const name of file.identifiers) {
      if (!mentions.has(name)) mentions.set(name, new Set())
      mentions.get(name).add(file.fileName)
    }
    findings.push(...file.findings)
  }

  for (const file of analyzed) {
    // 由 package.json / 文档按文件名调用的脚本是入口，不是无入口文件。
    const isEntry =
      isExcludedFromDeadCode(file.fileName) ||
      importedBy.has(file.fileName) ||
      manifestText.includes(path.posix.basename(file.fileName))
    if (!isEntry) {
      findings.push({
        rule: 'unreferenced-file',
        file: file.fileName,
        line: 1,
        message: '没有被任何文件导入，也未出现在 package.json 或文档中',
      })
    }
    if (isExcludedFromDeadCode(file.fileName)) continue
    for (const entry of file.exports) {
      // 仅在文件内使用的导出属「导出面偏大」，不是死代码，故只报本地也为 0 次的。
      if (entry.localUses > 0) continue
      const external = [...(mentions.get(entry.name) ?? [])].filter(
        (other) => other !== file.fileName,
      )
      if (external.length === 0) {
        findings.push({
          rule: 'dead-export',
          file: file.fileName,
          line: entry.line,
          symbol: entry.name,
          message: `${entry.kind} ${entry.name} 在文件内外都没有消费者`,
        })
      }
    }
  }

  const order = Object.keys(RULES)
  findings.sort(
    (a, b) =>
      order.indexOf(a.rule) - order.indexOf(b.rule) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  )
  return findings
}

/** 列出待扫描的源文件；跳过生成目录与二进制。 */
export function collectFiles(root) {
  const collected = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(entry.name)) walk(path.join(directory, entry.name))
        continue
      }
      if (!SOURCE_FILE.test(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      collected.push({
        fileName: path.relative(root, absolute).split(path.sep).join('/'),
        text: readFileSync(absolute, 'utf8'),
      })
    }
  }
  for (const directory of SCAN_DIRS) {
    const absolute = path.join(root, directory)
    if (existsSync(absolute) && statSync(absolute).isDirectory()) walk(absolute)
  }
  return collected
}

function readManifestText(root) {
  return MANIFEST_FILES.map((relative) => {
    const absolute = path.join(root, relative)
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : ''
  }).join('\n')
}

function main() {
  const asJson = process.argv.slice(2).includes('--json')
  let findings
  try {
    findings = analyzeProject(collectFiles(REPO_ROOT), {
      manifestText: readManifestText(REPO_ROOT),
    })
  } catch (error) {
    console.error(`check:slop 无法完成扫描：${error instanceof Error ? error.message : error}`)
    return 2
  }

  const blocking = findings.filter((finding) => RULES[finding.rule]?.blocking)
  const advisory = findings.filter((finding) => !RULES[finding.rule]?.blocking)

  if (asJson) {
    console.log(JSON.stringify({ blocking, advisory, rules: RULES }, null, 1))
    return blocking.length > 0 ? 1 : 0
  }

  const report = (label, items) => {
    if (items.length === 0) return
    console.log(`\n${label}（${items.length}）`)
    for (const item of items) {
      const symbol = item.symbol ? ` :: ${item.symbol}` : ''
      console.log(`  ${item.file}:${item.line}${symbol}  [${item.rule}] ${item.message}`)
    }
  }
  report('阻塞项', blocking)
  report('提示项（需要人判断，不影响退出码）', advisory)

  if (findings.length === 0) {
    console.log(
      'check:slop: 机械判据未发现 slop。语义判据（空心注释、假测试强度）不在本工具覆盖内。',
    )
  } else {
    console.log(
      `\ncheck:slop: ${blocking.length} 项阻塞 / ${advisory.length} 项提示。注意：本工具只覆盖机械可判定部分。`,
    )
  }
  return blocking.length > 0 ? 1 : 0
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
