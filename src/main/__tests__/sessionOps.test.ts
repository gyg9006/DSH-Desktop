import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createSessionGroup,
  moveSessionToGroup,
  deleteSessionGroup,
  deleteLiveSessions,
  deleteLiveSession,
  archiveSession,
  unarchiveSession,
  deleteArchivedSessions,
  listArchived,
  readGroupMap
} from '../sessionOps'
import { readWorkspaces, readSidebarData } from '../workspaces'
import { dshProjectKey } from '../sessions'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-sessionops-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** 构造带工作区注册表 + 会话目录的临时工作文件夹。 */
function makeWorkspace(ws: string, wsPath: string, sessionIds: string[]): string {
  const sessionsRoot = path.join(ws, 'data', 'sessions')
  for (const id of sessionIds) {
    // dsh projectKey 规则：--<sanitized>--；写入足够内容避免被判为空会话
    const dir = path.join(sessionsRoot, dshProjectKey(wsPath), id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'session.jsonl.zstd'), Buffer.alloc(8192, 1))
  }
  const registry = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [] },
    tables: {
      workspaces: {
        'ws-1': {
          path: wsPath,
          title: 'workspace',
          sessionIds,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }
  }
  fs.mkdirSync(path.join(ws, 'data', 'storages'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'data', 'storages', 'workspace.json'), JSON.stringify(registry))
  fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
  return ws
}

describe('deleteSessionGroup（删除分组）', () => {
  it('不包含内容：仅删分组，会话移回工作文件夹（未分组）', () => {
    const ws = makeWorkspace(makeTempDir(), 'C:\\work', ['session-a', 'session-b'])
    createSessionGroup(ws, '旧分组', 'ws-1')
    const gid = fs.readdirSync(path.join(ws, 'config')).find((f) => f.includes('groups')) ? undefined : undefined
    // 通过列表读取分组 id
    const groups = JSON.parse(fs.readFileSync(path.join(ws, 'config', 'session-groups.json'), 'utf8')) as { groups: { id: string }[] }
    const id = groups.groups[0].id
    void gid
    moveSessionToGroup(ws, 'session-a', id)
    moveSessionToGroup(ws, 'session-b', id)
    expect(readGroupMap(ws)['session-a']).toBe(id)

    const result = deleteSessionGroup(ws, id, false)
    expect(result.ok).toBe(true)
    // 分组已删
    const after = JSON.parse(fs.readFileSync(path.join(ws, 'config', 'session-groups.json'), 'utf8')) as { groups: unknown[]; map: Record<string, string> }
    expect(after.groups.length).toBe(0)
    expect(after.map['session-a']).toBeUndefined()
    // 会话文件仍在（移回工作文件夹）
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-a'))).toBe(true)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-b'))).toBe(true)
  })

  it('包含内容：分组与会话一起删除', () => {
    const ws = makeWorkspace(makeTempDir(), 'C:\\work', ['session-a', 'session-b'])
    createSessionGroup(ws, '旧分组', 'ws-1')
    const groups = JSON.parse(fs.readFileSync(path.join(ws, 'config', 'session-groups.json'), 'utf8')) as { groups: { id: string }[] }
    const id = groups.groups[0].id
    moveSessionToGroup(ws, 'session-a', id)

    const result = deleteSessionGroup(ws, id, true)
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    // 会话目录被删除
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-a'))).toBe(false)
    // 未分组的 session-b 不受影响
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-b'))).toBe(true)
    // 注册表同步移除
    const workspaces = readWorkspaces(ws)
    const wsEntry = workspaces.workspaces.find((w) => w.id === 'ws-1')!
    expect(wsEntry.sessions.some((s) => s.id === 'session-a')).toBe(false)
  })
})

describe('deleteLiveSessions（批量删除会话）', () => {
  it('删除目录、分组映射与注册表', () => {
    const ws = makeWorkspace(makeTempDir(), 'C:\\work', ['session-a', 'session-b', 'session-c'])
    createSessionGroup(ws, 'G', 'ws-1')
    const groups = JSON.parse(fs.readFileSync(path.join(ws, 'config', 'session-groups.json'), 'utf8')) as { groups: { id: string }[] }
    const gid = groups.groups[0].id
    moveSessionToGroup(ws, 'session-a', gid)

    const result = deleteLiveSessions(ws, ['session-a', 'session-b'])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-a'))).toBe(false)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-b'))).toBe(false)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-c'))).toBe(true)
    // 分组映射清理
    expect(readGroupMap(ws)['session-a']).toBeUndefined()
    // 注册表清理
    const workspaces = readWorkspaces(ws)
    const ids = workspaces.workspaces.find((w) => w.id === 'ws-1')!.sessions.map((s) => s.id)
    expect(ids).toEqual(['session-c'])
  })

  it('单条删除', () => {
    const ws = makeWorkspace(makeTempDir(), 'C:\\work', ['session-x'])
    const result = deleteLiveSession(ws, 'session-x')
    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-x'))).toBe(false)
  })
})

describe('空会话过滤（dsh 不展示 blank 会话，侧边栏同步过滤）', () => {
  it('空会话（仅 header，<2KB）不出现在侧边栏；正常会话保留', () => {
    const ws = makeWorkspace(makeTempDir(), 'C:\\work', ['session-full', 'session-empty'])
    // 正常会话：写入较大内容
    fs.writeFileSync(
      path.join(ws, 'data', 'sessions', '--C-work--', 'session-full', 'session.jsonl.zstd'),
      Buffer.alloc(8192, 1)
    )
    // 空会话：仅 header 大小的文件
    fs.writeFileSync(
      path.join(ws, 'data', 'sessions', '--C-work--', 'session-empty', 'session.jsonl.zstd'),
      Buffer.alloc(300, 1)
    )
    const sidebar = readSidebarData(ws)
    const ids = sidebar.workspaces[0].sessions.map((s) => s.id)
    expect(ids).toContain('session-full')
    expect(ids).not.toContain('session-empty')
  })
})

describe('archive / unarchive / deleteArchived', () => {
  it('归档后可还原到工作区', async () => {
    const ws = makeWorkspace(makeTempDir(), 'C:\\work', ['session-a'])
    const r = await archiveSession(ws, 'session-a', '我的会话', 1700000000000)
    expect(r.ok).toBe(true)
    expect(listArchived(ws).length).toBe(1)
    // 归档后从日常工作消失（侧边栏数据按归档索引过滤）
    const sidebar = readSidebarData(ws)
    expect(sidebar.workspaces[0].sessions.some((s) => s.id === 'session-a')).toBe(false)

    const u = unarchiveSession(ws, 'session-a')
    expect(u.ok).toBe(true)
    expect(listArchived(ws).length).toBe(0)
    // 目录回到 sessions 下
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', '--C-work--', 'session-a'))).toBe(true)
    // dsh 归档集移除
    const registry = JSON.parse(fs.readFileSync(path.join(ws, 'data', 'storages', 'workspace.json'), 'utf8')) as { global: { archivedSessionIds: string[] } }
    expect(registry.global.archivedSessionIds).not.toContain('session-a')
  })

  it('批量删除归档会话', async () => {
    const ws = makeWorkspace(makeTempDir(), 'C:\\work', ['session-a', 'session-b'])
    await archiveSession(ws, 'session-a', 'A', 1700000000000)
    await archiveSession(ws, 'session-b', 'B', 1700000001000)
    const result = deleteArchivedSessions(ws, ['session-a', 'session-b'])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
    expect(listArchived(ws).length).toBe(0)
  })
})
