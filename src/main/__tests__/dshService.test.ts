import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { probeFreePort, isPortHealthy, dshInstallBroken, resolveSystemDshBin } from '../dshService'

const servers: Array<http.Server | net.Server> = []

afterEach(() => {
  for (const s of servers.splice(0)) {
    s.close()
  }
})

describe('probeFreePort（端口探测，规格 4.5）', () => {
  it('空闲端口直接返回', async () => {
    const port = await probeFreePort(41990, 5)
    expect(port).toBe(41990)
  })

  it('被占用端口自动顺延', async () => {
    const blocker = net.createServer()
    await new Promise<void>((resolve) => blocker.listen(41980, '127.0.0.1', () => resolve()))
    servers.push(blocker)
    const port = await probeFreePort(41980, 10)
    expect(port).toBeGreaterThan(41980)
  })

  it('全部占用时抛错', async () => {
    const blockers: net.Server[] = []
    for (let i = 0; i < 5; i++) {
      const s = net.createServer()
      await new Promise<void>((resolve) => s.listen(41900 + i, '127.0.0.1', () => resolve()))
      blockers.push(s)
      servers.push(s)
    }
    await expect(probeFreePort(41900, 2)).rejects.toThrow('未找到可用端口')
  })
})

describe('isPortHealthy（HTTP 探活）', () => {  it('服务可访问返回 true', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200)
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    servers.push(server)
    const port = (server.address() as net.AddressInfo).port
    expect(await isPortHealthy(port)).toBe(true)
  })

  it('无服务监听返回 false', async () => {
    expect(await isPortHealthy(43999, 800)).toBe(false)
  })

  it('非 200 响应返回 false', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(500)
      res.end('err')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    servers.push(server)
    const port = (server.address() as net.AddressInfo).port
    expect(await isPortHealthy(port)).toBe(false)
  })
})

describe('dshInstallBroken（历史 symlink/依赖缺失检测）', () => {
  function makeDsh(workspaceDir: string, opts: { symlink?: boolean; deps?: string[]; pkg?: boolean }): string {
    const pkgDir = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh')
    if (opts.symlink) {
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-symlink-target-'))
      fs.mkdirSync(path.dirname(pkgDir), { recursive: true })
      fs.symlinkSync(target, pkgDir, 'junction')
      return target
    }
    fs.mkdirSync(pkgDir, { recursive: true })
    if (opts.pkg !== false) {
      fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true })
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.0.0', dependencies: Object.fromEntries((opts.deps ?? ['@deepseek-ai/dsh-app-boot']).map((d) => [d, '^1.0.0'])) }))
      fs.writeFileSync(path.join(pkgDir, 'lib', 'bin.js'), 'x')
    }
    return pkgDir
  }

  it('未安装 dsh → false（走自动启用分支）', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-broken-'))
    try {
      expect(dshInstallBroken(ws)).toBe(false)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('symlink 安装（v2.1.3 file:link 产物）→ true', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-broken-'))
    try {
      makeDsh(ws, { symlink: true })
      expect(dshInstallBroken(ws)).toBe(true)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('正常目录安装 + 依赖齐 → false', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-broken-'))
    try {
      const pkgDir = makeDsh(ws, { deps: ['commander', 'js-yaml', '@deepseek-ai/dsh-app-boot'] })
      for (const d of ['commander', 'js-yaml', '@deepseek-ai/dsh-app-boot']) {
        fs.mkdirSync(path.join(pkgDir, 'node_modules', d), { recursive: true })
      }
      expect(dshInstallBroken(ws)).toBe(false)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })

  it('依赖缺失（无 node_modules）→ true', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-broken-'))
    try {
      makeDsh(ws, { deps: ['commander', '@deepseek-ai/dsh-app-boot'] })
      expect(dshInstallBroken(ws)).toBe(true)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
    }
  })
})

describe('resolveSystemDshBin（系统 dsh 解析）', () => {
  it('返回系统 dsh bin 路径或 null（不抛异常）', () => {
    const bin = resolveSystemDshBin()
    // 有系统 dsh（全局/npx 缓存）→ 返回 bin.js 路径；没有 → null。两者均合法，关键是稳定不抛
    expect(typeof bin).toBe('string')
  })

  it('连续调用结果稳定（幂等）', () => {
    const a = resolveSystemDshBin()
    const b = resolveSystemDshBin()
    expect(a).toBe(b)
  })
})
