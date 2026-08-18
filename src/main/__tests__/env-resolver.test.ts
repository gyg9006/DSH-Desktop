import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveEnvTool,
  portableEnvDir,
  bundledToolPath,
  readEnvManifest,
  hasBundledEnv
} from '../env-resolver'

describe('env-resolver 三级优先级（内置 → 工作区 → 系统）', () => {
  let prevEnv: string | undefined
  let tmp: string

  beforeEach(() => {
    prevEnv = process.env.DSH_PORTABLE_ENV_DIR
    delete process.env.DSH_PORTABLE_ENV_DIR
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-resolver-'))
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.DSH_PORTABLE_ENV_DIR
    else process.env.DSH_PORTABLE_ENV_DIR = prevEnv
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  /** 构造一个假内置目录：env-manifest.json + node/node.exe（平台可指定）。 */
  function makeBundled(platform: string = process.platform): string {
    const envDir = path.join(tmp, 'env')
    const nodeDir = path.join(envDir, 'node')
    fs.mkdirSync(nodeDir, { recursive: true })
    fs.writeFileSync(path.join(nodeDir, 'node.exe'), 'x')
    fs.writeFileSync(
      path.join(envDir, 'env-manifest.json'),
      JSON.stringify({ platform, arch: process.arch, node: { version: 'v24.0.0', dir: 'node', exe: 'node.exe' } })
    )
    return envDir
  }

  it('无任何来源（PATH 清空）→ none', () => {
    const ws = path.join(tmp, 'ws')
    fs.mkdirSync(ws, { recursive: true })
    const prevPath = process.env.PATH
    process.env.PATH = tmp // 无 node 的目录
    try {
      const tool = resolveEnvTool(ws, 'node')
      expect(tool.source).toBe('none')
      expect(tool.binPath).toBeNull()
    } finally {
      process.env.PATH = prevPath
    }
  })

  it('工作区便携版 → portable', () => {
    const ws = path.join(tmp, 'ws')
    const nodeDir = path.join(ws, 'runtime', 'node')
    fs.mkdirSync(nodeDir, { recursive: true })
    fs.writeFileSync(path.join(nodeDir, 'node.exe'), 'x')
    const tool = resolveEnvTool(ws, 'node')
    expect(tool.source).toBe('portable')
    expect(tool.binPath).toBe(path.join(nodeDir, 'node.exe'))
  })

  it('内置优先于工作区', () => {
    const envDir = makeBundled()
    process.env.DSH_PORTABLE_ENV_DIR = envDir
    const ws = path.join(tmp, 'ws')
    const nodeDir = path.join(ws, 'runtime', 'node')
    fs.mkdirSync(nodeDir, { recursive: true })
    fs.writeFileSync(path.join(nodeDir, 'node.exe'), 'x')
    const tool = resolveEnvTool(ws, 'node')
    expect(tool.source).toBe('bundled')
    expect(tool.binPath).toBe(path.join(envDir, 'node', 'node.exe'))
    expect(tool.bundledDir).toBe(envDir)
  })

  it('平台不匹配的内置包被忽略', () => {
    const other = process.platform === 'win32' ? 'darwin' : 'win32'
    process.env.DSH_PORTABLE_ENV_DIR = makeBundled(other)
    const ws = path.join(tmp, 'ws')
    fs.mkdirSync(ws, { recursive: true })
    expect(resolveEnvTool(ws, 'node').source).not.toBe('bundled')
  })

  it('system 级：PATH 中存在命令时命中', () => {
    const ws = path.join(tmp, 'ws')
    fs.mkdirSync(ws, { recursive: true })
    const prevPath = process.env.PATH
    process.env.PATH = path.dirname(process.execPath)
    try {
      const tool = resolveEnvTool(ws, 'node')
      expect(tool.source).toBe('system')
      expect(tool.binPath).toBe('node')
    } finally {
      process.env.PATH = prevPath
    }
  })

  it('hasBundledEnv：内置存在为 true，缺失为 false', () => {
    expect(hasBundledEnv()).toBe(false)
    process.env.DSH_PORTABLE_ENV_DIR = makeBundled()
    expect(hasBundledEnv()).toBe(true)
  })

  it('bundledToolPath：按 manifest 解析可执行；缺失返回 null', () => {
    const envDir = makeBundled()
    process.env.DSH_PORTABLE_ENV_DIR = envDir
    const hit = bundledToolPath('node')
    expect(hit?.abs).toBe(path.join(envDir, 'node', 'node.exe'))
    expect(bundledToolPath('git')).toBeNull()
    // manifest 声明但文件缺失 → null
    fs.rmSync(path.join(envDir, 'node', 'node.exe'))
    expect(bundledToolPath('node')).toBeNull()
  })

  it('portableEnvDir / readEnvManifest 基本行为', () => {
    expect(portableEnvDir()).toBeNull()
    expect(readEnvManifest(null)).toBeNull()
    const envDir = makeBundled()
    expect((readEnvManifest(envDir)?.node as { version?: string } | undefined)?.version).toBe('v24.0.0')
    expect(readEnvManifest(path.join(tmp, 'empty'))).toBeNull()
  })
})
