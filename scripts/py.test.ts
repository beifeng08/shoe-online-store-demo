// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDirectRun, resolveInterpreter } from './py.mjs'

/** 造一个假的仓库目录，只放需要的解释器文件。 */
function fakeRepo(layout: string[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'py-runner-'))
  for (const relative of layout) {
    const target = path.join(root, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, '')
  }
  return root
}

const neverProbe = () => false
const alwaysProbe = () => true

describe('resolveInterpreter', () => {
  it('honours an explicit PYTHON override before probing layouts', () => {
    const root = fakeRepo(['backend/.venv/bin/python'])

    const resolved = resolveInterpreter({
      root,
      env: { PYTHON: '/opt/custom/python' },
      probe: alwaysProbe,
    })

    expect(resolved).toEqual({ command: '/opt/custom/python', source: 'PYTHON' })
  })

  it('finds the POSIX virtualenv layout', () => {
    const root = fakeRepo(['backend/.venv/bin/python'])

    const resolved = resolveInterpreter({ root, env: {}, probe: neverProbe })

    expect(resolved).toEqual({
      command: path.join(root, 'backend/.venv/bin/python'),
      source: 'backend/.venv/bin/python',
    })
    // 平台无关的关键断言：路径必须是仓库相对位置拼出来的，不能是写死的绝对路径。
    expect(resolved?.command.startsWith(root)).toBe(true)
  })

  it('finds the Windows virtualenv layout', () => {
    const root = fakeRepo(['backend/.venv/Scripts/python.exe'])

    const resolved = resolveInterpreter({ root, env: {}, probe: neverProbe })

    expect(resolved).toEqual({
      command: path.join(root, 'backend/.venv/Scripts/python.exe'),
      source: 'backend/.venv/Scripts/python.exe',
    })
  })

  it('falls back to PATH with a visible warning when no virtualenv exists', () => {
    const root = fakeRepo()
    const probed: string[] = []

    const resolved = resolveInterpreter({
      root,
      env: {},
      probe: (command: string) => {
        probed.push(command)
        return command === 'python3'
      },
    })

    expect(probed).toEqual(['python3'])
    expect(resolved?.command).toBe('python3')
    expect(resolved?.warning).toContain('backend/.venv')
  })

  it('returns null when neither a virtualenv nor a PATH interpreter exists', () => {
    // CLI 依赖 null 来打印建虚拟环境的指引，而不是抛栈或静默失败。
    expect(resolveInterpreter({ root: fakeRepo(), env: {}, probe: neverProbe })).toBeNull()
  })
})

describe('isDirectRun', () => {
  it('is true only for the module actually being executed', () => {
    const target = path.join(process.cwd(), 'scripts/py.mjs')
    const moduleUrl = new URL('file://' + target).href

    expect(isDirectRun(target, moduleUrl)).toBe(true)
    expect(isDirectRun(undefined, moduleUrl)).toBe(false)
    expect(isDirectRun(path.join(process.cwd(), 'scripts/other.mjs'), moduleUrl)).toBe(false)
  })
})
