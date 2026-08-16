/**
 * 会话组织与操作（桌面端）：
 * - 对话分组：config/session-groups.json（groups + sessionId → groupId 映射）
 * - 收藏：config/session-favorites.json
 * - 归档：会话目录移动到 data/archived/<yyyy>/<mm>/<dd>/<sessionId>/，
 *   索引写入 config/archived-index.json（标题/时间/关键词）；同时调用 dsh 的
 *   workspace.archiveSession（registry 全局归档集，dsh UI 同步隐藏）。
 * - 会话操作：重命名/分叉走 dsh 的 sessions.rename / sessions.fork RPC。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'
import { removeSessionFromRegistry, unarchiveSessionInRegistry, findSessionWorkspace } from './workspaces'
import { dshProjectKey, updateSessionTitleInProjCache } from './sessions'
import type { ArchivedSessionEntry, SessionGroupInfo, SessionOpResult } from '../shared/ipc'

// ---------------------------------------------------------------------------
// 分组
// ---------------------------------------------------------------------------

interface GroupsDoc {
  groups: SessionGroupInfo[]
  /** sessionId → groupId */
  map: Record<string, string>
}

function groupsPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'session-groups.json')
}

function readGroupsDoc(workspaceDir: string): GroupsDoc {
  const raw = readJsonFile(groupsPath(workspaceDir)) as Partial<GroupsDoc> | null
  return {
    groups: Array.isArray(raw?.groups) ? raw.groups : [],
    map: raw?.map && typeof raw.map === 'object' ? raw.map : {}
  }
}

function writeGroupsDoc(workspaceDir: string, doc: GroupsDoc): void {
  writeJsonAtomic(groupsPath(workspaceDir), doc)
}

export function listSessionGroups(workspaceDir: string): SessionGroupInfo[] {
  const doc = readGroupsDoc(workspaceDir)
  return [...doc.groups].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name))
}

export function createSessionGroup(workspaceDir: string, name: string, workspaceId: string): SessionOpResult {
  const t = name.trim()
  if (!t) return { ok: false, error: '分组名称不能为空' }
  const doc = readGroupsDoc(workspaceDir)
  const group: SessionGroupInfo = { id: randomUUID(), name: t, workspaceId, pinned: false }
  doc.groups.push(group)
  writeGroupsDoc(workspaceDir, doc)
  logger.info(`创建对话分组 ${t}`)
  return { ok: true }
}

export function renameSessionGroup(workspaceDir: string, groupId: string, name: string): SessionOpResult {
  const t = name.trim()
  if (!t) return { ok: false, error: '分组名称不能为空' }
  const doc = readGroupsDoc(workspaceDir)
  const g = doc.groups.find((x) => x.id === groupId)
  if (!g) return { ok: false, error: '分组不存在' }
  g.name = t
  writeGroupsDoc(workspaceDir, doc)
  return { ok: true }
}

export function pinSessionGroup(workspaceDir: string, groupId: string): SessionOpResult {
  const doc = readGroupsDoc(workspaceDir)
  const g = doc.groups.find((x) => x.id === groupId)
  if (!g) return { ok: false, error: '分组不存在' }
  g.pinned = !g.pinned
  writeGroupsDoc(workspaceDir, doc)
  return { ok: true }
}

export function deleteSessionGroup(workspaceDir: string, groupId: string, deleteContents = false): SessionOpResult {
  const doc = readGroupsDoc(workspaceDir)
  const g = doc.groups.find((x) => x.id === groupId)
  if (!g) return { ok: false, error: '分组不存在' }
  const memberIds = Object.entries(doc.map).filter(([, gid]) => gid === groupId).map(([sid]) => sid)
  doc.groups = doc.groups.filter((x) => x.id !== groupId)
  for (const [sid, gid] of Object.entries(doc.map)) {
    if (gid === groupId) delete doc.map[sid]
  }
  writeGroupsDoc(workspaceDir, doc)
  if (deleteContents && memberIds.length > 0) {
    const res = deleteLiveSessions(workspaceDir, memberIds)
    if (!res.ok) return { ok: false, error: `分组已删除，但删除会话失败：${res.error ?? ''}` }
  }
  return { ok: true, count: memberIds.length }
}

/** 会话所在分组 id（无则 null）。 */
export function sessionGroupOf(workspaceDir: string, sessionId: string): string | null {
  return readGroupsDoc(workspaceDir).map[sessionId] ?? null
}

/** 全量分组映射（sessionId → groupId）。 */
export function readGroupMap(workspaceDir: string): Record<string, string | null> {
  const map: Record<string, string | null> = {}
  for (const [sid, gid] of Object.entries(readGroupsDoc(workspaceDir).map)) map[sid] = gid
  return map
}

export function moveSessionToGroup(workspaceDir: string, sessionId: string, groupId: string | null): SessionOpResult {
  const doc = readGroupsDoc(workspaceDir)
  if (groupId !== null && !doc.groups.some((g) => g.id === groupId)) return { ok: false, error: '分组不存在' }
  if (groupId === null) delete doc.map[sessionId]
  else doc.map[sessionId] = groupId
  writeGroupsDoc(workspaceDir, doc)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 收藏
// ---------------------------------------------------------------------------

function favoritesPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'session-favorites.json')
}

export function readFavorites(workspaceDir: string): string[] {
  const raw = readJsonFile(favoritesPath(workspaceDir)) as { favorites?: unknown } | null
  return Array.isArray(raw?.favorites) ? raw.favorites.filter((x): x is string => typeof x === 'string') : []
}

export function setSessionFavorite(workspaceDir: string, sessionId: string, favorite: boolean): SessionOpResult {
  const favorites = readFavorites(workspaceDir)
  const next = new Set(favorites)
  if (favorite) next.add(sessionId)
  else next.delete(sessionId)
  writeJsonAtomic(favoritesPath(workspaceDir), { favorites: [...next] })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 归档（年-月-日递归目录 + 索引 + 关键词）
// ---------------------------------------------------------------------------

interface ArchivedIndexDoc {
  /** sessionId → 条目 */
  entries: Record<string, Omit<ArchivedSessionEntry, 'favorite' | 'sessionId'>>
}
function archivedIndexPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'archived-index.json')
}

function archivedRoot(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'archived')
}

function readArchivedIndex(workspaceDir: string): ArchivedIndexDoc {
  const raw = readJsonFile(archivedIndexPath(workspaceDir)) as Partial<ArchivedIndexDoc> | null
  return { entries: raw?.entries && typeof raw.entries === 'object' ? raw.entries : {} }
}

function writeArchivedIndex(workspaceDir: string, doc: ArchivedIndexDoc): void {
  writeJsonAtomic(archivedIndexPath(workspaceDir), doc)
}

/** 从标题/会话内容提取关键词（标题分词 + 常见英文词 + 中文词）。 */
export function extractKeywords(title: string): string[] {
  const words = new Set<string>()
  const t = title || ''
  // 英文/数字词
  for (const m of t.toLowerCase().match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []) words.add(m)
  // 中文词（2-4 字滑窗）
  const cn = t.replace(/[^\u4e00-\u9fff]/g, '')
  if (cn.length >= 2) {
    for (let i = 0; i < cn.length - 1; i++) {
      const w = cn.slice(i, i + 2)
      if (w.trim()) words.add(w)
    }
  }
  return [...words].slice(0, 20)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 定位会话目录（data/sessions/<group>/<id>/ 或 data/archived/<y>/<m>/<d>/<id>/）。 */
function findSessionDir(workspaceDir: string, sessionId: string): string | null {
  const candidates: string[] = []
  const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
  if (fs.existsSync(sessionsRoot)) {
    for (const group of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      const dir = path.join(sessionsRoot, group.name, sessionId)
      if (fs.existsSync(dir)) candidates.push(dir)
    }
  }
  // 归档目录（可能在任何日期目录下）
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || candidates.length > 0) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      if (e.name === sessionId && fs.readdirSync(path.join(dir, e.name)).some((f) => /^session\.jsonl(\.zstd)?$/.test(f))) {
        candidates.push(path.join(dir, e.name))
      } else if (depth < 3) {
        walk(path.join(dir, e.name), depth + 1)
      }
    }
  }
  const archRoot = archivedRoot(workspaceDir)
  if (fs.existsSync(archRoot)) walk(archRoot, 0)
  return candidates[0] ?? null
}

/** 归档会话：移动到 data/archived/<y>/<m>/<d>/<id>/ + 索引 + dsh RPC。 */
export async function archiveSession(workspaceDir: string, sessionId: string, title: string, time: number): Promise<SessionOpResult> {
  try {
    const src = findSessionDir(workspaceDir, sessionId)
    if (!src) return { ok: false, error: '未找到会话目录' }
    const d = new Date(time || Date.now())
    const dest = path.join(archivedRoot(workspaceDir), String(d.getFullYear()), pad2(d.getMonth() + 1), pad2(d.getDate()), sessionId)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
    fs.renameSync(src, dest)

    const ws = findSessionWorkspace(workspaceDir, sessionId)
    const index = readArchivedIndex(workspaceDir)
    index.entries[sessionId] = {
      title: title || sessionId,
      time,
      archivedAt: Date.now(),
      keywords: extractKeywords(title),
      groupId: sessionGroupOf(workspaceDir, sessionId),
      workspacePath: ws?.path,
      workspaceId: ws?.id
    }
    writeArchivedIndex(workspaceDir, index)
    logger.info(`会话 ${sessionId} 已归档到 ${dest}`)
    // dsh registry 归档（隐藏于 dsh 分组视图）
    void callRpc(workspaceDir, 'workspace.archiveSession', { sessionId })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `归档失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 取消归档：把会话目录移回原工作区，并从归档索引与 dsh 归档集移除。 */
export function unarchiveSession(workspaceDir: string, sessionId: string): SessionOpResult {
  try {
    const dir = findSessionDir(workspaceDir, sessionId)
    if (!dir || !dir.includes(path.join('archived'))) return { ok: false, error: '未找到归档会话目录' }
    const index = readArchivedIndex(workspaceDir)
    const entry = index.entries[sessionId]
    const workspacePath = entry?.workspacePath

    // 目标目录：原工作区路径转义组名（dsh projectKey 规则）；无记录时回退到当前工作区组
    let groupName: string
    if (typeof workspacePath === 'string' && workspacePath.trim()) {
      groupName = dshProjectKey(workspacePath)
    } else {
      const ws = findSessionWorkspace(workspaceDir, sessionId)
      groupName = ws ? dshProjectKey(ws.path) : '--restored--'
    }
    const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
    const destDir = path.join(sessionsRoot, groupName, sessionId)
    fs.mkdirSync(path.dirname(destDir), { recursive: true })
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true })
    fs.renameSync(dir, destDir)

    delete index.entries[sessionId]
    writeArchivedIndex(workspaceDir, index)
    // dsh registry：从 archivedSessionIds 移除（会话保留在 sessionIds 中）
    unarchiveSessionInRegistry(workspaceDir, sessionId)
    logger.info(`会话 ${sessionId} 已还原到工作区`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `还原失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 删除归档会话（目录 + 索引 + 分组映射 + dsh registry）。 */
export function deleteArchivedSession(workspaceDir: string, sessionId: string): SessionOpResult {
  try {
    const dir = findSessionDir(workspaceDir, sessionId)
    if (dir && dir.includes(path.join('archived'))) fs.rmSync(dir, { recursive: true, force: true })
    const index = readArchivedIndex(workspaceDir)
    delete index.entries[sessionId]
    writeArchivedIndex(workspaceDir, index)
    const groups = readGroupsDoc(workspaceDir)
    delete groups.map[sessionId]
    writeGroupsDoc(workspaceDir, groups)
    removeSessionFromRegistry(workspaceDir, sessionId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `删除失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 批量删除归档会话。 */
export function deleteArchivedSessions(workspaceDir: string, sessionIds: string[]): SessionOpResult {
  let okCount = 0
  let firstError: string | undefined
  for (const id of sessionIds) {
    const r = deleteArchivedSession(workspaceDir, id)
    if (r.ok) okCount++
    else if (!firstError) firstError = r.error
  }
  return okCount > 0 ? { ok: true, count: okCount } : { ok: false, error: firstError ?? '没有可删除的归档会话' }
}

/** 删除未归档会话（目录 + 分组映射 + 收藏 + dsh registry）。 */
export function deleteLiveSession(workspaceDir: string, sessionId: string): SessionOpResult {
  try {
    const dir = findSessionDir(workspaceDir, sessionId)
    if (dir && !dir.includes(path.join('archived'))) fs.rmSync(dir, { recursive: true, force: true })
    const groups = readGroupsDoc(workspaceDir)
    delete groups.map[sessionId]
    writeGroupsDoc(workspaceDir, groups)
    const favorites = readFavorites(workspaceDir)
    if (favorites.includes(sessionId)) {
      writeJsonAtomic(favoritesPath(workspaceDir), { favorites: favorites.filter((x) => x !== sessionId) })
    }
    removeSessionFromRegistry(workspaceDir, sessionId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `删除失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 批量删除未归档会话。 */
export function deleteLiveSessions(workspaceDir: string, sessionIds: string[]): SessionOpResult {
  let okCount = 0
  let firstError: string | undefined
  for (const id of sessionIds) {
    const r = deleteLiveSession(workspaceDir, id)
    if (r.ok) okCount++
    else if (!firstError) firstError = r.error
  }
  return okCount > 0 ? { ok: true, count: okCount } : { ok: false, error: firstError ?? '没有可删除的会话' }
}

/** 归档列表（含收藏标记）。 */
export function listArchived(workspaceDir: string): ArchivedSessionEntry[] {
  const index = readArchivedIndex(workspaceDir)
  const favorites = new Set(readFavorites(workspaceDir))
  return Object.entries(index.entries)
    .map(([sessionId, e]) => ({ ...e, sessionId, favorite: favorites.has(sessionId) }))
    .sort((a, b) => b.archivedAt - a.archivedAt)
}

// ---------------------------------------------------------------------------
// dsh RPC（重命名 / 分叉 / 归档）
// ---------------------------------------------------------------------------

async function callRpc(workspaceDir: string, method: string, payload: Record<string, unknown>): Promise<SessionOpResult> {
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
    const body = (await res.json()) as { result?: { ok?: unknown; error?: { message?: unknown }; value?: { sessionId?: unknown } } }
    if (body.result?.ok !== true) {
      return { ok: false, error: body.result?.error?.message ? String(body.result.error.message) : 'RPC 失败' }
    }
    return { ok: true, forkedId: typeof body.result.value?.sessionId === 'string' ? body.result.value.sessionId : undefined }
  } catch {
    return { ok: false, error: 'RPC 不可达（请先启动 dsh 服务）' }
  }
}

export async function renameSessionRpc(workspaceDir: string, sessionId: string, title: string): Promise<SessionOpResult> {
  const t = title.trim()
  if (!t) return Promise.resolve({ ok: false, error: '标题不能为空' })
  const result = await callRpc(workspaceDir, 'session.rename', { sessionId, title: t })
  if (result.ok) {
    // 立即同步本地 projcache 标题，避免侧边栏刷新读到 dsh 异步写入前的旧值
    updateSessionTitleInProjCache(workspaceDir, sessionId, t)
  }
  return result
}

export function forkSessionRpc(workspaceDir: string, sessionId: string): Promise<SessionOpResult> {
  return callRpc(workspaceDir, 'session.fork', { sessionId })
}
