#!/usr/bin/env node
/**
 * 平台无关的 Python 入口：全仓唯一出现「虚拟环境解释器路径」差异的地方。
 *
 * 用法（macOS / Linux / Windows 命令逐字相同）：
 *   npm run py -- -m pytest -q
 *   npm run py -- -m ruff check app migrations tests
 *
 * 相对路径参数（app、migrations、tests、alembic.ini）以 backend/ 为工作目录解析，
 * 与 backend/README.md 的约定一致；PY_CWD=root 可让命令改在仓库根目录执行。
 * PYTHON=<解释器路径> 可覆盖探测结果。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** backend/README.md 约定虚拟环境位于 backend/.venv；Windows 在 Scripts/，POSIX 在 bin/。 */
const VENV_INTERPRETERS = ['backend/.venv/bin/python', 'backend/.venv/Scripts/python.exe']
const PATH_INTERPRETERS = ['python3', 'python']

function probeOnPath(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

/**
 * 解析要使用的解释器。探测逻辑依赖全部可注入，便于在不装 Python 的机器上验证平台分支。
 *
 * @param {object} options
 * @param {string} options.root 仓库根目录
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(candidate: string) => boolean} [options.fileExists]
 * @param {(command: string) => boolean} [options.probe] PATH 上是否存在可用解释器
 * @returns {{ command: string, source: string, warning?: string } | null}
 */
export function resolveInterpreter({
  root,
  env = process.env,
  fileExists = existsSync,
  probe = probeOnPath,
}) {
  if (env.PYTHON) {
    return { command: env.PYTHON, source: 'PYTHON' }
  }

  for (const relative of VENV_INTERPRETERS) {
    if (fileExists(path.join(root, relative))) {
      return { command: path.join(root, relative), source: relative }
    }
  }

  // CI 用 setup-python 装到系统解释器，没有虚拟环境。只在确实找不到 venv 时回退并告警，
  // 避免本机漏建 venv 时静默跑到缺依赖的解释器上。
  for (const command of PATH_INTERPRETERS) {
    if (probe(command)) {
      return {
        command,
        source: 'PATH',
        warning: `未找到 backend/.venv，回退到 PATH 上的 ${command}（依赖可能缺失）。`,
      }
    }
  }

  return null
}

/** 判断本模块是被直接执行还是被 import（import 时不得产生副作用）。 */
export function isDirectRun(argv1, moduleUrl) {
  return Boolean(argv1) && path.resolve(argv1) === fileURLToPath(moduleUrl)
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const interpreter = resolveInterpreter({ root })

  if (!interpreter) {
    console.error('py: 未找到 Python 解释器。')
    console.error('  请先创建虚拟环境（见 backend/README.md 的 Local development）：')
    console.error('    python3.12 -m venv backend/.venv')
    console.error('  或用 PYTHON=<解释器路径> 指定一个已装好依赖的解释器。')
    return 1
  }

  if (interpreter.warning) {
    console.error(`py: ${interpreter.warning}`)
  }

  const cwd = process.env.PY_CWD === 'root' ? root : path.join(root, 'backend')
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    console.error(`py: 工作目录不存在：${cwd}`)
    return 1
  }

  const result = spawnSync(interpreter.command, process.argv.slice(2), {
    cwd,
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`py: 无法执行 ${interpreter.command}：${result.error.message}`)
    return 1
  }

  return result.status ?? 1
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  process.exit(main())
}
