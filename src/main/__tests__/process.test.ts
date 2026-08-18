import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildChildEnv, runCommand, killProcessTree, resolveWindowsCommand } from '../utils/process'
import { buildDshEnv } from '../envCheck'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-proc-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// 隔离外部 PATH：测试进程的 PATH 可能被开发环境注入 portable runtime 目录，
// 导致「不存在的运行时目录被过滤」断言受宿主环境干扰。这里在 buildChildEnv 相关
// 用例中固定 process.env.PATH，保证确定性。
const ORIGINAL_PATH = process.env.PATH
beforeEach(() => {
  // 置为干净的最小 PATH（不含 runtime），构建环境断言只关心注入逻辑本身
  process.env.PATH = 'C:\\Windows\\System32;C:\\Windows'
})
afterEach(() => {
  process.env.PATH = ORIGINAL_PATH
})

describe('buildChildEnv（子进程环境构造）', () => {
  it('便携运行时目录注入 PATH 最前，顺序为 node 再 git/cmd', () => {
    const ws = makeTempDir()
    const nodeDir = path.join(ws, 'runtime', 'node')
    const gitCmd = path.join(ws, 'runtime', 'git', 'cmd')
    fs.mkdirSync(nodeDir, { recursive: true })
    fs.mkdirSync(gitCmd, { recursive: true })

    const env = buildChildEnv(ws)
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path')!
    const parts = env[pathKey]!.split(path.delimiter)
    expect(parts[0]).toBe(nodeDir)
    expect(parts[1]).toBe(gitCmd)
    // 原有 PATH 内容保留在末尾
    expect(parts.length).toBeGreaterThan(2)
  })

  it('不存在的运行时目录被过滤，不影响 PATH', () => {
    const ws = makeTempDir() // 空 workspace，runtime 不存在
    const env = buildChildEnv(ws)
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path')!
    const parts = env[pathKey]!.split(path.delimiter)
    // 只应包含原 PATH
    expect(parts.some((p) => p.includes('runtime'))).toBe(false)
  })

  it('额外变量注入且不覆盖已有同名变量之外的键', () => {
    const ws = makeTempDir()
    const env = buildChildEnv(ws, [], { MY_TEST_VAR: 'hello', PATH: 'SHOULD_NOT_OVERRIDE' })
    expect(env['MY_TEST_VAR']).toBe('hello')
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path')!
    expect(env[pathKey]).not.toBe('SHOULD_NOT_OVERRIDE')
  })
})

describe('buildDshEnv（dsh 启动环境）', () => {
  it('注入 DSH_HOME=workspace/data 与遥测关闭开关', () => {
    const ws = makeTempDir()
    const env = buildDshEnv(ws)
    expect(env['DSH_HOME']).toBe(path.join(ws, 'data'))
    expect(env['DSH_TELEMETRY_DISABLED']).toBe('1')
  })

  it('可叠加额外变量', () => {
    const ws = makeTempDir()
    const env = buildDshEnv(ws, { DEEPSEEK_API_KEY: 'sk-test' })
    expect(env['DEEPSEEK_API_KEY']).toBe('sk-test')
    expect(env['DSH_HOME']).toBe(path.join(ws, 'data'))
  })
})

describe('runCommand（子进程执行）', () => {
  it('成功执行并返回输出', async () => {
    const result = await runCommand({ command: process.execPath, args: ['--version'], timeoutMs: 10000 })
    expect(result.error).toBeUndefined()
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+/)
  })

  it('可执行文件不存在时给出可读中文错误', async () => {
    const result = await runCommand({ command: 'dshw-nonexistent-binary-xyz', timeoutMs: 5000 })
    expect(result.error).toContain('未找到可执行文件')
    expect(result.code).toBeNull()
  })

  it('超时后终止进程并给出中文超时错误', async () => {
    const result = await runCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 300
    })
    expect(result.timedOut).toBe(true)
    expect(result.error).toContain('超时')
  }, 10000)

  it('取消信号（abort）会终止进程并标记 aborted', async () => {
    const controller = new AbortController()
    const promise = runCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 60000,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 200)
    const result = await promise
    expect(result.aborted).toBe(true)
    expect(result.error).toBeUndefined()
  }, 10000)
})

describe('killProcessTree', () => {
  it('对已退出进程调用是安全的（不抛异常）', () => {
    expect(() => killProcessTree(-1)).not.toThrow()
    expect(() => killProcessTree(0)).not.toThrow()
    expect(() => killProcessTree(99999999)).not.toThrow()
  })
})

describe('resolveWindowsCommand（Windows 垫片解析）', () => {
  it('裸命令按 PATH 解析出 .cmd/.exe 真实路径（npm/pnpm 场景）', () => {
    const dir = makeTempDir()
    fs.writeFileSync(path.join(dir, 'npm.cmd'), '@echo off\r\n')
    fs.writeFileSync(path.join(dir, 'pnpm.cmd'), '@echo off\r\n')
    fs.writeFileSync(path.join(dir, 'git.exe'), '')
    const pathEnv = `${dir};C:\\Windows\\System32`
    expect(resolveWindowsCommand('npm', pathEnv)).toBe(path.join(dir, 'npm.cmd'))
    expect(resolveWindowsCommand('pnpm', pathEnv)).toBe(path.join(dir, 'pnpm.cmd'))
    expect(resolveWindowsCommand('git', pathEnv)).toBe(path.join(dir, 'git.exe'))
  })

  it('带扩展名 / 含路径分隔符 / 找不到时原样返回', () => {
    const dir = makeTempDir()
    const pathEnv = `${dir};C:\\Windows\\System32`
    expect(resolveWindowsCommand('npm.cmd', pathEnv)).toBe('npm.cmd')
    expect(resolveWindowsCommand('C:\\tools\\node.exe', pathEnv)).toBe('C:\\tools\\node.exe')
    expect(resolveWindowsCommand('./scripts/x', pathEnv)).toBe('./scripts/x')
    expect(resolveWindowsCommand('no-such-tool', pathEnv)).toBe('no-such-tool')
  })
})
