/**
 * 工作区树（对应 dsh 侧边栏的工作区视图）：
 * - 数据源：data/storages/workspace.json（dsh 工作区注册表，含 id/title/path/sessionIds）
 *   与 data/sessions/<workspace>/<session-id>/（会话目录）+ storages/session_projcache.json（标题）。
 * - 重命名/删除：优先调用 dsh 的 workspace.rename / workspace.delete RPC（服务运行时）；
 *   否则直接编辑注册表文件（dsh-storage-json 热重载）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile } from '../shared/workspace'
import { readSessionMeta } from './sessions'
import { getWorkspaceDir } from './config'
import { logger } from './logger'
import { listSessionGroups, readFavorites, listArchived, readGroupMap } from './sessionOps'
import type { SidebarDataPayload, WorkspaceEntryPayload, WorkspacesPayload } from '../shared/ipc'

interface WorkspaceRecord {
  path?: unknown
  title?: unknown
  sessionIds?: unknown
}

interface WorkspaceDoc {
  tables?: { workspaces?: Record<string, WorkspaceRecord> }
}

interface RegistryDoc extends WorkspaceDoc {
  unit?: { name?: string; version?: number }
  global: { initialized: boolean; workspaceIds: string[]; archivedSessionIds?: string[] }
  tables: { workspaces: Record<string, WorkspaceRecord> }
}

function registryPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'storages', 'workspace.json')
}

function readRegistry(workspaceDir: string): { global: { workspaceIds: string[] }; tables: Record<string, WorkspaceRecord> } {
  const raw = readJsonFile(registryPath(workspaceDir)) as WorkspaceDoc & { global?: { workspaceIds?: unknown } } | null
  const tables = raw?.tables?.workspaces ?? {}
  const ids = Array.isArray(raw?.global?.workspaceIds) ? (raw.global.workspaceIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  return { global: { workspaceIds: ids }, tables }
}

/** 读取工作区树。 */
export function readWorkspaces(workspaceDir: string): WorkspacesPayload {
  const { global, tables } = readRegistry(workspaceDir)
  const meta = readSessionMeta(readJsonFile(path.join(workspaceDir, 'data', 'storages', 'session_projcache.json')))
  const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')

  const workspaces: WorkspaceEntryPayload[] = []
  const orderedIds = global.workspaceIds.length > 0 ? global.workspaceIds : Object.keys(tables)
  for (const id of orderedIds) {
    const rec = tables[id]
    if (!rec) continue
    const title = typeof rec.title === 'string' ? rec.title : id
    const wsPath = typeof rec.path === 'string' ? rec.path : ''
    const sessionIds = Array.isArray(rec.sessionIds) ? rec.sessionIds.filter((x): x is string => typeof x === 'string') : []
    const sessions = sessionIds
      .map((sid) => {
        const info = meta.get(sid)
        // 会话文件（dsh 布局：sessions/<cwd>/<sid>/session.jsonl[.zstd]）
        let time = 0
        const cwdGroup = wsPath.replace(/[\\/:*?"<>|]/g, '-')
        const sessionDir = path.join(sessionsRoot, cwdGroup, sid)
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir)
          const log = files.find((f) => /^session\.jsonl(\.zstd)?$/.test(f))
          if (log) time = fs.statSync(path.join(sessionDir, log)).mtimeMs
        }
        return {
          id: sid,
          title: info?.title?.trim() || sid,
          time: info?.createdAt ?? time
        }
      })
      .sort((a, b) => b.time - a.time)
    workspaces.push({ id, title, path: wsPath, sessionCount: sessions.length, sessions })
  }

  // 当前工作区 = 应用 workspacePath 对应注册的目录
  let currentId: string | null = null
  try {
    const appPath = getWorkspaceDir()
    const appCwd = (readJsonFile(path.join(appPath, 'config', 'app.json')) as { workspacePath?: unknown } | null)?.workspacePath
    if (typeof appCwd === 'string') {
      const canonical = appCwd.replace(/\\/g, '/').replace(/\/+$/, '')
      for (const ws of workspaces) {
        if (ws.path.replace(/\\/g, '/').replace(/\/+$/, '') === canonical) {
          currentId = ws.id
          break
        }
      }
    }
  } catch {
    // 忽略
  }

  return { workspaces, currentId }
}

/** 侧边栏会话视图完整数据：工作区树 + 分组 + 归档 + 收藏。 */
export function readSidebarData(workspaceDir: string): SidebarDataPayload {
  const archivedIndex = readArchivedIndexRaw(workspaceDir)
  // 日常会话 = 未归档的会话
  const base = readWorkspaces(workspaceDir)
  for (const ws of base.workspaces) {
    ws.sessions = ws.sessions.filter((s) => !archivedIndex[s.id])
    ws.sessionCount = ws.sessions.length
  }
  const groups = listSessionGroups(workspaceDir)
  const archived = listArchived(workspaceDir)
  const favorites = readFavorites(workspaceDir)
  const groupMap = readGroupMap(workspaceDir)
  return { workspaces: base.workspaces, groups, archived, favorites, groupMap }
}

/** 读取归档索引原始条目（判断会话是否已归档）。 */
function readArchivedIndexRaw(workspaceDir: string): Record<string, unknown> {
  const raw = readJsonFile(path.join(workspaceDir, 'config', 'archived-index.json')) as { entries?: unknown } | null
  return raw?.entries && typeof raw.entries === 'object' ? (raw.entries as Record<string, unknown>) : {}
}

/** dsh RPC 调用（服务运行时优先走 RPC，保证与 dsh 注册表一致）。 */
async function callWorkspaceRpc(workspaceDir: string, method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = readJsonFile(path.join(workspaceDir, 'config', 'app.json')) as { service?: { lastPort?: unknown } } | null
    const port = typeof cfg?.service?.lastPort === 'number' ? cfg.service.lastPort : 3080
    const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `dshw-${Date.now()}`, method, payload }),
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = (await res.json()) as { result?: { ok?: unknown; error?: { message?: unknown } } }
    if (body.result?.ok !== true) {
      return { ok: false, error: body.result?.error?.message ? String(body.result.error.message) : 'RPC 失败' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'RPC 不可达' }
  }
}

function writeRegistry(workspaceDir: string, mutate: (doc: RegistryDoc) => void): void {
  const p = registryPath(workspaceDir)
  let doc: RegistryDoc = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
    tables: { workspaces: {} }
  }
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<RegistryDoc>
      doc = {
        ...raw,
        global: {
          initialized: true,
          workspaceIds: Array.isArray(raw.global?.workspaceIds) ? (raw.global.workspaceIds as string[]) : [],
          archivedSessionIds: Array.isArray(raw.global?.archivedSessionIds) ? (raw.global.archivedSessionIds as string[]) : []
        },
        tables: { workspaces: raw.tables?.workspaces ?? {} }
      }
    }
  } catch {
    // 损坏时从空配置重建
  }
  mutate(doc)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(doc, null, 2), 'utf8')
}

/** 从工作区注册表移除会话（sessionIds + archivedSessionIds），供删除会话时同步 dsh。 */
export function removeSessionFromRegistry(workspaceDir: string, sessionId: string): void {
  writeRegistry(workspaceDir, (doc) => {
    for (const ws of Object.values(doc.tables?.workspaces ?? {})) {
      if (Array.isArray(ws.sessionIds)) {
        ws.sessionIds = (ws.sessionIds as string[]).filter((x) => x !== sessionId)
      }
    }
    doc.global.archivedSessionIds = (doc.global.archivedSessionIds ?? []).filter((x) => x !== sessionId)
  })
}

/** 取消归档：把会话从 archivedSessionIds 移除（保留在 sessionIds 中，回到原工作区）。 */
export function unarchiveSessionInRegistry(workspaceDir: string, sessionId: string): void {
  writeRegistry(workspaceDir, (doc) => {
    doc.global.archivedSessionIds = (doc.global.archivedSessionIds ?? []).filter((x) => x !== sessionId)
  })
}

/** 读取会话所属工作区（id/path），未找到返回 null。 */
export function findSessionWorkspace(workspaceDir: string, sessionId: string): { id: string; path: string } | null {
  const { tables } = readRegistry(workspaceDir)
  for (const [id, rec] of Object.entries(tables)) {
    const ids = Array.isArray(rec.sessionIds) ? (rec.sessionIds as string[]) : []
    if (ids.includes(sessionId) && typeof rec.path === 'string') return { id, path: rec.path }
  }
  return null
}

/** 重命名工作区。 */
export async function renameWorkspace(workspaceDir: string, id: string, title: string): Promise<{ ok: boolean; error?: string }> {
  const t = title.trim()
  if (!t) return { ok: false, error: '名称不能为空' }
  const rpc = await callWorkspaceRpc(workspaceDir, 'workspace.rename', { workspaceId: id, title: t })
  if (rpc.ok) {
    logger.info(`工作区 ${id} 已重命名为 ${t}`)
    return { ok: true }
  }
  // RPC 不可达 → 直接编辑注册表（dsh-storage-json 热重载）
  try {
    writeRegistry(workspaceDir, (doc) => {
      if (doc.tables?.workspaces?.[id]) doc.tables.workspaces[id].title = t
    })
    logger.info(`工作区 ${id} 已重命名为 ${t}（本地注册表）`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `重命名失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 删除工作区（注册表移除；RPC 不可达时同时询问是否删除会话目录由调用方决定）。 */
export async function deleteWorkspace(workspaceDir: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const rpc = await callWorkspaceRpc(workspaceDir, 'workspace.delete', { workspaceId: id })
  if (rpc.ok) {
    logger.info(`工作区 ${id} 已删除`)
    return { ok: true }
  }
  try {
    let removedPath = ''
    writeRegistry(workspaceDir, (doc) => {
      const rec = doc.tables?.workspaces?.[id]
      if (rec && typeof rec.path === 'string') removedPath = rec.path
      if (doc.tables?.workspaces) delete doc.tables.workspaces[id]
      doc.global.workspaceIds = doc.global.workspaceIds.filter((x) => x !== id)
    })
    // 删除对应会话目录（sessions/<cwd 转义>/）
    if (removedPath) {
      const group = removedPath.replace(/[\\/:*?"<>|]/g, '-')
      const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
      const dir = path.join(sessionsRoot, group)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    }
    logger.info(`工作区 ${id} 已删除（本地注册表）`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `删除失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
