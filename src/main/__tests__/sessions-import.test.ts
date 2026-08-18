import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { importSessionsFrom, expandImportArchives, getDshSessionCompression, repairSessionEncodings, dshProjectKey } from '../sessions'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-import-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeSessionDir(root: string, id: string): void {
  const dir = path.join(root, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), 'zstd')
  fs.writeFileSync(path.join(dir, 'meta.json'), '{}')
}

describe('importSessionsFrom（导入其他 PC 的 dsh 会话）', () => {
  function findSession(ws: string, id: string): string | null {
    const root = path.join(ws, 'data', 'sessions')
    if (!fs.existsSync(root)) return null
    for (const group of fs.readdirSync(root, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      const groupDir = path.join(root, group.name)
      for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name === id) return path.join(groupDir, id)
      }
    }
    return null
  }

  it('从会话目录导入单个会话', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    makeSessionDir(src, 'session-aaa')
    const result = await importSessionsFrom(ws, [src])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    const imported = findSession(ws, 'session-aaa')
    expect(imported).not.toBeNull()
    expect(fs.existsSync(path.join(imported!, 'session.jsonl.zstd'))).toBe(true)
    expect(fs.existsSync(path.join(imported!, 'meta.json'))).toBe(true)
  })

  it('从含多个会话的目录树导入全部', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    makeSessionDir(src, 'session-1')
    fs.mkdirSync(path.join(src, 'nested'))
    makeSessionDir(path.join(src, 'nested'), 'session-2')
    const result = await importSessionsFrom(ws, [src])
    expect(result.count).toBe(2)
    expect(findSession(ws, 'session-1')).not.toBeNull()
    expect(findSession(ws, 'session-2')).not.toBeNull()
  })

  it('id 冲突时跳过，不覆盖本地、不重复导入', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    makeSessionDir(src, 'session-x')
    // 本地已有同名会话（真实 dsh 会话 id 全局唯一，重复导入会触发 dsh duplicate 报错）
    const local = path.join(ws, 'data', 'sessions', '--local--', 'session-x')
    fs.mkdirSync(local, { recursive: true })
    fs.writeFileSync(path.join(local, 'session.jsonl.zstd'), 'local-data')
    const result = await importSessionsFrom(ws, [src])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(0)
    expect(result.skipped).toBe(1)
    // 本地未被覆盖
    expect(fs.readFileSync(path.join(local, 'session.jsonl.zstd'), 'utf8')).toBe('local-data')
    // 没有产生额外副本
    const root = path.join(ws, 'data', 'sessions')
    let copies = 0
    for (const group of fs.readdirSync(root, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      for (const entry of fs.readdirSync(path.join(root, group.name), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name === 'session-x') copies++
      }
    }
    expect(copies).toBe(1)
  })

  it('不存在的源忽略', async () => {
    const ws = makeTempDir()
    const result = await importSessionsFrom(ws, [path.join(makeTempDir(), 'missing')])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(0)
  })

  it('独立会话文件（父目录非会话目录）→ 以文件本身创建会话', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    const file = path.join(src, 'session.jsonl.zstd')
    fs.writeFileSync(file, 'standalone-log')
    const result = await importSessionsFrom(ws, [file])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    const imported = findSession(ws, 'session')
    expect(imported).not.toBeNull()
    expect(fs.readFileSync(path.join(imported!, 'session.jsonl.zstd'), 'utf8')).toBe('standalone-log')
  })

  it('多选混搭：会话目录 + 独立会话文件，去重后正确导入', async () => {
    const ws = makeTempDir()
    const srcDir = makeTempDir()
    makeSessionDir(srcDir, 'session-dir-a')
    const srcFile = makeTempDir()
    const file = path.join(srcFile, 'session.jsonl')
    fs.writeFileSync(file, 'file-log')
    // 同一目录传两次 → 去重只导入一次
    const result = await importSessionsFrom(ws, [srcDir, srcDir, file])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(findSession(ws, 'session-dir-a')).not.toBeNull()
    expect(findSession(ws, 'session')).not.toBeNull()
  })

  it('单个会话文件（父目录是会话目录）→ 导入父目录', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    makeSessionDir(src, 'session-full')
    const file = path.join(src, 'session-full', 'session.jsonl.zstd')
    const result = await importSessionsFrom(ws, [file])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect(findSession(ws, 'session-full')).not.toBeNull()
  })

  it('zip 压缩包导入时自动解压（含会话目录 + 独立会话文件）', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    // 构造压缩内容：一个会话目录 + 一个独立会话文件
    makeSessionDir(src, 'zipped-session')
    fs.writeFileSync(path.join(src, 'session.jsonl.zstd'), 'standalone')
    // 用系统 bsdtar 打包 zip
    const zipPath = path.join(makeTempDir(), 'sessions.zip')
    execFileSync('tar', ['-a', '-cf', zipPath, '-C', src, '.'])

    const expanded = await expandImportArchives(ws, [zipPath])
    try {
      const result = await importSessionsFrom(ws, expanded.paths, undefined, expanded.archiveRoots)
      expect(result.ok).toBe(true)
      expect(result.count).toBe(2)
      expect(findSession(ws, 'zipped-session')).not.toBeNull()
      expect(findSession(ws, 'session')).not.toBeNull()
    } finally {
      expanded.cleanup()
    }
    // 临时目录已清理
    expect(fs.existsSync(path.join(ws, 'tmp')) ? fs.readdirSync(path.join(ws, 'tmp')).length : 0).toBe(0)
  })

  it('dshProjectKey：F:\\deepseek_workspace → --F-deepseek_workspace--（dsh 规则）', () => {
    expect(dshProjectKey('F:\\deepseek_workspace')).toBe('--F-deepseek_workspace--')
    expect(dshProjectKey('C:\\Users\\test\\project')).toBe('--C-Users-test-project--')
    expect(dshProjectKey('')).toBe('--imported--')
  })

  it('按日志 header 的 id/cwd 定位导入（目录名无关，保证 dsh 可加载）', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    // 会话目录名随意（session / 任意名），但 header 里有真实 id 与 cwd
    const dir = path.join(src, 'session')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'session.jsonl'),
      '{"type":"session","version":0,"id":"session-real-123","cwd":"D:\\\\other\\\\project"}\n{"type":"msg","seq":0}\n'
    )
    const result = await importSessionsFrom(ws, [dir])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    // 必须落在 dsh projectKey 组 + header id 目录
    const target = path.join(ws, 'data', 'sessions', '--D-other-project--', 'session-real-123')
    expect(fs.existsSync(path.join(target, 'session.jsonl.zstd'))).toBe(true)
  })

  it('header id 与目录名不一致时以 header id 为准', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    const dir = path.join(src, 'wrong-dir-name')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'session.jsonl'),
      '{"type":"session","version":0,"id":"session-correct-id","cwd":"C:\\\\ws"}\n'
    )
    const result = await importSessionsFrom(ws, [dir])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-ws--', 'session-correct-id', 'session.jsonl.zstd'))).toBe(true)
  })

  it('导入后登记到工作区注册表（cwd 匹配的 workspace 的 sessionIds）', async () => {
    const ws = makeTempDir()
    // 预置注册表：workspace path = F:\work，sessionIds 空
    fs.mkdirSync(path.join(ws, 'data', 'storages'), { recursive: true })
    fs.writeFileSync(
      path.join(ws, 'data', 'storages', 'workspace.json'),
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [] },
        tables: {
          workspaces: {
            'ws-1': { path: 'F:\\work', title: 'work', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
          }
        }
      })
    )
    const src = makeTempDir()
    const dir = path.join(src, 'session')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'session.jsonl'),
      '{"type":"session","version":0,"id":"session-reg-1","cwd":"F:\\\\work"}\n{"type":"msg","seq":0}\n'
    )
    const result = await importSessionsFrom(ws, [dir])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    const registry = JSON.parse(fs.readFileSync(path.join(ws, 'data', 'storages', 'workspace.json'), 'utf8')) as {
      tables: { workspaces: Record<string, { sessionIds: string[] }> }
    }
    expect(registry.tables.workspaces['ws-1'].sessionIds).toContain('session-reg-1')
  })
})

describe('压缩格式适配（导入后与 dsh 配置一致，防止服务启动失败）', () => {
  it('未压缩 .jsonl 会话导入后自动转换为 .jsonl.zstd（目标 zstd）', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    const dir = path.join(src, 'session-plain')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.jsonl'), '{"plain":true}\n{"second":true}\n')
    const result = await importSessionsFrom(ws, [src])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    // 找到导入的会话
    const root = path.join(ws, 'data', 'sessions')
    let found: string | null = null
    for (const group of fs.readdirSync(root, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      const gd = path.join(root, group.name)
      for (const e of fs.readdirSync(gd, { withFileTypes: true })) {
        if (e.isDirectory() && e.name === 'session-plain') found = path.join(gd, e.name)
      }
    }
    expect(found).not.toBeNull()
    // 必须是 zstd 压缩文件，且原 .jsonl 已移除
    expect(fs.existsSync(path.join(found!, 'session.jsonl.zstd'))).toBe(true)
    expect(fs.existsSync(path.join(found!, 'session.jsonl'))).toBe(false)
  })

  it('zstd 会话导入后保持不变', async () => {
    const ws = makeTempDir()
    const src = makeTempDir()
    const dir = path.join(src, 'session-zstd')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), 'raw-zstd-bytes')
    const result = await importSessionsFrom(ws, [src])
    expect(result.ok).toBe(true)
    const root = path.join(ws, 'data', 'sessions')
    let found: string | null = null
    for (const group of fs.readdirSync(root, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      for (const e of fs.readdirSync(path.join(root, group.name), { withFileTypes: true })) {
        if (e.isDirectory() && e.name === 'session-zstd') found = path.join(root, group.name, e.name)
      }
    }
    expect(found).not.toBeNull()
    expect(fs.existsSync(path.join(found!, 'session.jsonl.zstd'))).toBe(true)
    expect(fs.readFileSync(path.join(found!, 'session.jsonl.zstd'), 'utf8')).toBe('raw-zstd-bytes')
  })

  it('getDshSessionCompression：缺省 zstd，settings.yaml 声明 none 时返回 none', () => {
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data'), { recursive: true })
    expect(getDshSessionCompression(ws)).toBe('zstd')
    fs.writeFileSync(
      path.join(ws, 'data', 'settings.yaml'),
      'session-persistence-jsonl:\n  compression: none\n',
      'utf8'
    )
    expect(getDshSessionCompression(ws)).toBe('none')
  })

  it('repairSessionEncodings：把已存在的未压缩 .jsonl 会话转换为 .zstd（服务启动前修复）', async () => {
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data', 'sessions', 'group', 'session-bad'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'data', 'sessions', 'group', 'session-bad', 'session.jsonl'), '{"plain":1}\n')
    // 正常会话保持原样
    fs.mkdirSync(path.join(ws, 'data', 'sessions', 'group', 'session-ok'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'data', 'sessions', 'group', 'session-ok', 'session.jsonl.zstd'), 'zstd-bytes')

    const result = await repairSessionEncodings(ws)
    expect(result.fixed).toBe(1)
    expect(result.target).toBe('zstd')
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', 'group', 'session-bad', 'session.jsonl.zstd'))).toBe(true)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', 'group', 'session-bad', 'session.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', 'group', 'session-ok', 'session.jsonl.zstd'))).toBe(true)
  })

  it('repairSessionEncodings：目标为 none 时反向转换 zstd → .jsonl', async () => {
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'data', 'settings.yaml'), 'session-persistence-jsonl:\n  compression: none\n', 'utf8')
    fs.mkdirSync(path.join(ws, 'data', 'sessions', 'group', 'session-z'), { recursive: true })
    // 用真实 zstd 压缩数据（node:zlib）
    const { zstdCompressSync } = await import('node:zlib')
    const compressed = zstdCompressSync(Buffer.from('{"real":1}\n', 'utf8'))
    fs.writeFileSync(path.join(ws, 'data', 'sessions', 'group', 'session-z', 'session.jsonl.zstd'), compressed)

    const result = await repairSessionEncodings(ws)
    expect(result.fixed).toBe(1)
    expect(result.target).toBe('none')
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', 'group', 'session-z', 'session.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', 'group', 'session-z', 'session.jsonl.zstd'))).toBe(false)
    // 内容可解回原文
    expect(fs.readFileSync(path.join(ws, 'data', 'sessions', 'group', 'session-z', 'session.jsonl'), 'utf8')).toContain('"real":1')
  })
})
