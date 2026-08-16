import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clearBusinessData } from '../reset'
import { syncSessionCount } from '../sync'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-reset-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('clearBusinessData（初始化重置清理逻辑）', () => {
  function makeDirtyWs(ws: string): void {
    fs.mkdirSync(path.join(ws, 'data', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'data', 'sessions', 'a.jsonl'), '{}')
    fs.writeFileSync(path.join(ws, 'data', '.credentials.yaml'), 'key')
    fs.mkdirSync(path.join(ws, 'skills'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'skills', 's.md'), '# s')
    fs.mkdirSync(path.join(ws, 'plugins'), { recursive: true })
    fs.mkdirSync(path.join(ws, 'backups'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'backups', 'b.zip'), 'zip')
    fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'config', 'api.json'), '{"apiKey":"sk"}')
    fs.mkdirSync(path.join(ws, 'runtime', 'node'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'runtime', 'node', 'node.exe'), 'node')
  }

  it('保留运行环境时清空业务数据与敏感配置', () => {
    const ws = makeTempDir()
    makeDirtyWs(ws)
    clearBusinessData(ws, true)
    // 业务目录内容清空（sessions 等子目录被整体删除，骨架由启动时重建）
    expect(fs.readdirSync(path.join(ws, 'data'))).toHaveLength(0)
    expect(fs.readdirSync(path.join(ws, 'skills'))).toHaveLength(0)
    expect(fs.readdirSync(path.join(ws, 'plugins'))).toHaveLength(0)
    expect(fs.readdirSync(path.join(ws, 'backups'))).toHaveLength(0)
    expect(fs.readdirSync(path.join(ws, 'config'))).toHaveLength(0)
    // 运行环境保留
    expect(fs.existsSync(path.join(ws, 'runtime', 'node', 'node.exe'))).toBe(true)
  })

  it('完全重置时连运行环境一起清除', () => {
    const ws = makeTempDir()
    makeDirtyWs(ws)
    clearBusinessData(ws, false)
    expect(fs.existsSync(path.join(ws, 'runtime', 'node'))).toBe(false)
    expect(fs.readdirSync(path.join(ws, 'data'))).toHaveLength(0)
  })
})

describe('syncSessionCount（同步会话统计）', () => {
  it('统计本地与远端（sync 目录）会话数', () => {
    const ws = makeTempDir()
    const mk = (base: string, id: string): void => {
      const dir = path.join(ws, base, '--ws--', id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), 'z')
    }
    mk('data/sessions', 'session-a')
    mk('data/sessions', 'session-b')
    mk('sync/sessions', 'session-a')
    const counts = syncSessionCount(ws)
    expect(counts.local).toBe(2)
    expect(counts.remote).toBe(1)
  })
})
