import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSessionMeta, listSessions, pinSession, readSessionPins, deleteSession } from '../sessions'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-session-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeWorkspaceWithSessions(ws: string, ids: string[]): void {
  const sessionsRoot = path.join(ws, 'data', 'sessions')
  for (const id of ids) {
    const dir = path.join(sessionsRoot, '--ws--', id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), 'zstd-bytes')
  }
  fs.mkdirSync(path.join(ws, 'data', 'storages'), { recursive: true })
}

describe('readSessionMeta（projcache 解析）', () => {
  it('提取标题与创建时间', () => {
    const meta = readSessionMeta({
      tables: {
        sessions: {
          'session-1': {
            identity: { createdAt: 1700000000000 },
            rows: { title: { val: '我的会话标题' } }
          },
          'session-2': {
            identity: { createdAt: 1700000001000 },
            rows: { sessionStats: { val: {} } }
          }
        }
      }
    })
    expect(meta.get('session-1')).toEqual({ title: '我的会话标题', createdAt: 1700000000000 })
    expect(meta.get('session-2')).toEqual({ createdAt: 1700000001000 })
  })

  it('非法输入返回空 Map', () => {
    expect(readSessionMeta(null).size).toBe(0)
    expect(readSessionMeta({}).size).toBe(0)
    expect(readSessionMeta({ tables: {} }).size).toBe(0)
  })
})

describe('listSessions（会话列表）', () => {
  it('从嵌套布局读取会话，标题取自 projcache，未收录的用会话 id', () => {
    const ws = makeTempDir()
    makeWorkspaceWithSessions(ws, ['session-aaa', 'session-bbb'])
    const proj = {
      tables: {
        sessions: {
          'session-aaa': { identity: { createdAt: 1700000000000 }, rows: { title: { val: '第一个会话' } } }
        }
      }
    }
    fs.writeFileSync(path.join(ws, 'data', 'storages', 'session_projcache.json'), JSON.stringify(proj))

    const entries = listSessions(ws)
    expect(entries.length).toBe(2)
    const a = entries.find((e) => e.id === 'session-aaa')!
    const b = entries.find((e) => e.id === 'session-bbb')!
    expect(a.title).toBe('第一个会话')
    expect(a.pinned).toBe(false)
    expect(b.title).toBe('session-bbb') // 无标题信息时回退 id
    expect(b.time).toBeGreaterThan(0) // 文件 mtime
  })

  it('置顶优先排序', () => {
    const ws = makeTempDir()
    makeWorkspaceWithSessions(ws, ['session-old', 'session-new'])
    const proj = {
      tables: {
        sessions: {
          'session-old': { identity: { createdAt: 1000 }, rows: {} },
          'session-new': { identity: { createdAt: 2000 }, rows: {} }
        }
      }
    }
    fs.writeFileSync(path.join(ws, 'data', 'storages', 'session_projcache.json'), JSON.stringify(proj))
    pinSession(ws, 'session-old', true)

    const entries = listSessions(ws)
    expect(entries[0].id).toBe('session-old') // 置顶优先于时间
    expect(entries[1].id).toBe('session-new')
  })
})

describe('pinSession / deleteSession', () => {
  it('置顶状态持久化', () => {
    const ws = makeTempDir()
    pinSession(ws, 'session-x', true)
    expect(readSessionPins(ws).has('session-x')).toBe(true)
    pinSession(ws, 'session-x', false)
    expect(readSessionPins(ws).has('session-x')).toBe(false)
  })

  it('删除会话目录并清理置顶', () => {
    const ws = makeTempDir()
    makeWorkspaceWithSessions(ws, ['session-del'])
    pinSession(ws, 'session-del', true)
    const result = deleteSession(ws, 'session-del')
    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--ws--', 'session-del'))).toBe(false)
    expect(readSessionPins(ws).has('session-del')).toBe(false)
    // 再删一次应报未找到
    const again = deleteSession(ws, 'session-del')
    expect(again.ok).toBe(false)
  })
})
