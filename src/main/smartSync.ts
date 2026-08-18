/**
 * 智能同步引擎（需求六：上传/下载智能同步，Git 时间戳比对）。
 *
 * 核心规则：以文件最后修改时间（mtimeMs）与远程提交时间（git log %ct）比对，谁新谁赢；
 * 时间差在容差窗口内时比对内容（git hash-object vs rev-parse blob），一致=跳过，不一致=冲突。
 * 基于 sync.ts 的 git 基础设施（便携 git / workspace/sync 仓库 / 同步清单）。
 *
 * 模式：
 * - smart    智能比对（默认）：时间差 > 容差 → 新者胜；时间窗内 → 内容一致跳过，不一致冲突
 * - add-only 仅新增不覆盖：仅同步对方不存在的文件
 * - force    强制覆盖（复用 sync.ts 的强推/强拉）
 *
 * 性能：远程文件时间用一次 `git log --format=%ct --name-only` 批量获取（首见即最新提交），
 * 远程文件清单用一次 `git ls-tree -r --name-only`；内容比对仅对时间窗内的候选做。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceDir } from './config'
import { logger } from './logger'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import {
  SYNC_DIRS,
  SYNC_FILES,
  getSyncDir,
  prepareLocal,
  readSyncConfig,
  writeSyncConfig,
  ensureRepo,
  git,
  syncForceLocal,
  syncForceRemote
} from './sync'
import type { SyncFileItem, SyncFileStatus, SyncMode, SyncPreviewPayload, SyncSettingsPayload } from '../shared/ipc'

/** 默认时间容差：2 秒（Windows NTFS 时间精度） */
export const DEFAULT_TOLERANCE_MS = 2000

// ---------------------------------------------------------------------------
// 设置（config/sync.json 的 smart 键）
// ---------------------------------------------------------------------------

export function readSyncSettings(workspaceDir?: string): SyncSettingsPayload {
  const ws = workspaceDir ?? getWorkspaceDir()
  const raw = readJsonFile(path.join(ws, 'config', 'sync.json')) as { smart?: SyncSettingsPayload } | null
  const smart = raw?.smart
  if (!smart || typeof smart !== 'object') return {}
  return {
    mode: smart.mode === 'force' || smart.mode === 'add-only' || smart.mode === 'smart' ? smart.mode : 'smart',
    toleranceMs: typeof smart.toleranceMs === 'number' && smart.toleranceMs > 0 ? smart.toleranceMs : DEFAULT_TOLERANCE_MS,
    exclude: Array.isArray(smart.exclude) ? smart.exclude.filter((s): s is string => typeof s === 'string') : [],
    autoSyncMinutes: typeof smart.autoSyncMinutes === 'number' && smart.autoSyncMinutes > 0 ? smart.autoSyncMinutes : 0
  }
}

export function writeSyncSettings(patch: SyncSettingsPayload, workspaceDir?: string): SyncSettingsPayload {
  const ws = workspaceDir ?? getWorkspaceDir()
  const current = readSyncSettings(ws)
  const next: SyncSettingsPayload = {
    mode: patch.mode === 'force' || patch.mode === 'add-only' ? patch.mode : 'smart',
    toleranceMs: typeof patch.toleranceMs === 'number' && patch.toleranceMs > 0 ? Math.round(patch.toleranceMs) : DEFAULT_TOLERANCE_MS,
    exclude: Array.isArray(patch.exclude) ? patch.exclude : current.exclude ?? [],
    autoSyncMinutes: typeof patch.autoSyncMinutes === 'number' && patch.autoSyncMinutes > 0 ? Math.round(patch.autoSyncMinutes) : 0
  }
  const configPath = path.join(ws, 'config', 'sync.json')
  const raw = (readJsonFile(configPath) ?? {}) as Record<string, unknown>
  writeJsonAtomic(configPath, { ...raw, smart: next })
  return next
}

// ---------------------------------------------------------------------------
// 排除规则（.gitignore 语法最小实现：* / ** / ? / 目录尾 / 根锚定 / ! 取反）
// ---------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

function matchesPattern(norm: string, patternRaw: string): boolean {
  let pattern = patternRaw.replace(/\\/g, '/')
  const dirOnly = pattern.endsWith('/')
  if (dirOnly) pattern = pattern.slice(0, -1)
  const anchored = pattern.startsWith('/')
  if (anchored) pattern = pattern.slice(1)
  if (!pattern) return false

  if (dirOnly) {
    if (anchored) return globToRegExp(pattern).test(norm.split('/')[0] ?? '')
    return norm.split('/').some((seg) => globToRegExp(pattern).test(seg))
  }
  if (anchored) {
    const re = globToRegExp(pattern)
    if (re.test(norm)) return true
    // 目录语义：norm 从根起的前缀段整体匹配 pattern，则其下所有内容命中
    const segs = norm.split('/')
    for (let i = 1; i < segs.length; i++) {
      if (re.test(segs.slice(0, i).join('/'))) return true
    }
    return false
  }
  if (!pattern.includes('/')) {
    // 单段：匹配任意层级的 basename
    return norm.split('/').some((seg) => globToRegExp(pattern).test(seg))
  }
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return norm === prefix || norm.startsWith(prefix + '/')
  }
  const re = globToRegExp(pattern)
  if (anchored) return re.test(norm)
  // 多段未锚定：匹配任意后缀起点
  for (let i = 0; i <= norm.length; i++) {
    if (re.test(norm.slice(i))) return true
  }
  return false
}

/** 判断相对路径是否命中排除规则（支持 ! 取反；# 注释忽略）。 */
export function matchesExclude(rel: string, patterns: string[]): boolean {
  const norm = rel.replace(/\\/g, '/')
  let matched = false
  for (const raw of patterns) {
    const p = (raw ?? '').trim()
    if (!p || p.startsWith('#')) continue
    if (p.startsWith('!')) {
      if (matched && matchesPattern(norm, p.slice(1))) matched = false
      continue
    }
    if (matchesPattern(norm, p)) matched = true
  }
  return matched
}

// ---------------------------------------------------------------------------
// 本地文件收集
// ---------------------------------------------------------------------------

/** 收集工作文件夹内参与同步的文件（相对路径 → mtimeMs + size），应用排除规则。 */
export function collectLocalFiles(workspaceDir: string, exclude: string[]): Map<string, { timeMs: number; size: number }> {
  const out = new Map<string, { timeMs: number; size: number }>()
  const addFile = (rel: string): void => {
    const norm = rel.replace(/\\/g, '/')
    if (matchesExclude(norm, exclude)) return
    const abs = path.join(workspaceDir, norm)
    try {
      const st = fs.statSync(abs)
      if (st.isFile()) out.set(norm, { timeMs: st.mtimeMs, size: st.size })
    } catch {
      /* 忽略瞬时缺失 */
    }
  }
  const walk = (dirRel: string): void => {
    const abs = path.join(workspaceDir, dirRel)
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = path.join(dirRel, entry.name).replace(/\\/g, '/')
      if (matchesExclude(rel, exclude)) continue
      if (entry.isDirectory()) walk(rel)
      else if (entry.isFile()) addFile(rel)
    }
  }
  for (const rel of SYNC_DIRS) walk(rel)
  for (const rel of SYNC_FILES) addFile(rel)
  return out
}

// ---------------------------------------------------------------------------
// 远程文件清单与提交时间（各一次 git 调用批量获取）
// ---------------------------------------------------------------------------

/** 解析 `git log origin/branch --format=%ct --name-only` 输出：rel → 最近提交秒数。首见即最新。 */
export function parseRemoteLog(raw: string): Map<string, number> {
  const map = new Map<string, number>()
  let currentTime = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^\d+$/.test(trimmed)) {
      currentTime = Number(trimmed)
      continue
    }
    if (currentTime > 0 && !map.has(trimmed)) map.set(trimmed, currentTime)
  }
  return map
}

/** 远程当前树的文件清单（rel set）。 */
export function parseRemoteTree(raw: string): Set<string> {
  return new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean))
}

// ---------------------------------------------------------------------------
// 状态决策（纯函数，可单测）
// ---------------------------------------------------------------------------

export interface DecideStatusInput {
  localExists: boolean
  localTimeMs?: number | null
  remoteExists: boolean
  remoteTimeMs?: number | null
  /** 双方内容是否一致（仅时间窗内由调用方计算）；null = 无法比较 */
  sameContent: boolean | null
  toleranceMs: number
  mode: SyncMode
}

export function decideStatus(input: DecideStatusInput): SyncFileStatus {
  const { localExists, remoteExists, toleranceMs, mode } = input
  if (!localExists && !remoteExists) return 'skip'
  if (!localExists) return 'download' // 远程有、本地无 → 下载
  if (!remoteExists) return 'upload' // 本地有、远程无 → 上传
  // 双方都有
  if (mode === 'add-only') return 'skip' // 仅新增不覆盖
  if (mode === 'force') return 'skip' // 强制模式不走预览决策（UI 用强推/强拉）
  const diff = (input.localTimeMs ?? 0) - (input.remoteTimeMs ?? 0)
  if (Math.abs(diff) > toleranceMs) {
    return diff > 0 ? 'upload' : 'download'
  }
  // 时间窗内：内容一致 → 跳过；不一致 → 冲突；无法比较 → 保守冲突
  if (input.sameContent === true) return 'skip'
  return 'conflict'
}

// ---------------------------------------------------------------------------
// 内容比对（git blob hash 对比，仅时间窗内调用）
// ---------------------------------------------------------------------------

async function contentSame(workspaceDir: string, branch: string, rel: string, localAbs: string): Promise<boolean | null> {
  const remote = await git(workspaceDir, ['rev-parse', `origin/${branch}:${rel}`])
  if (!remote.ok) return null
  const local = await git(workspaceDir, ['hash-object', localAbs])
  if (!local.ok) return null
  return remote.stdout.trim() === local.stdout.trim()
}

// ---------------------------------------------------------------------------
// 预览
// ---------------------------------------------------------------------------

export async function buildPreview(
  workspaceDir: string = getWorkspaceDir(),
  mode?: SyncMode,
  toleranceMs?: number
): Promise<SyncPreviewPayload> {
  const config = readSyncConfig(workspaceDir)
  const fetchedAt = Date.now()
  if (!config.remoteUrl) {
    return { ok: false, error: '尚未配置同步远端仓库地址', items: [], stats: emptyStats(), mode: mode ?? 'smart', toleranceMs: toleranceMs ?? DEFAULT_TOLERANCE_MS, fetchedAt }
  }
  const initError = await ensureRepo(workspaceDir, config)
  if (initError) {
    return { ok: false, error: initError, items: [], stats: emptyStats(), mode: mode ?? 'smart', toleranceMs: toleranceMs ?? DEFAULT_TOLERANCE_MS, fetchedAt }
  }
  const branch = config.branch || 'main'
  const fetch = await git(workspaceDir, ['fetch', 'origin', branch])
  if (!fetch.ok) {
    return { ok: false, error: `拉取远端失败：${fetch.error}`, items: [], stats: emptyStats(), mode: mode ?? 'smart', toleranceMs: toleranceMs ?? DEFAULT_TOLERANCE_MS, fetchedAt }
  }

  const settings = readSyncSettings(workspaceDir)
  const m = mode ?? settings.mode ?? 'smart'
  const tol = toleranceMs ?? settings.toleranceMs ?? DEFAULT_TOLERANCE_MS
  const exclude = settings.exclude ?? []

  const local = collectLocalFiles(workspaceDir, exclude)
  const treeRaw = await git(workspaceDir, ['ls-tree', '-r', '--name-only', `origin/${branch}`])
  const remoteFiles = treeRaw.ok ? parseRemoteTree(treeRaw.stdout) : new Set<string>()
  const logRaw = await git(workspaceDir, ['log', `origin/${branch}`, '--format=%ct', '--name-only', '--no-renames'])
  const remoteTimes = logRaw.ok ? parseRemoteLog(logRaw.stdout) : new Map<string, number>()

  const rels = new Set<string>([...local.keys(), ...remoteFiles])
  const items: SyncFileItem[] = []
  for (const rel of [...rels].sort()) {
    const l = local.get(rel)
    const remoteTimeSec = remoteTimes.get(rel)
    const remoteTimeMs = remoteFiles.has(rel) ? (remoteTimeSec !== undefined ? remoteTimeSec * 1000 : 0) : null
    const localExists = l !== undefined
    const remoteExists = remoteFiles.has(rel)

    let sameContent: boolean | null = null
    const status = decideStatus({
      localExists,
      localTimeMs: l?.timeMs ?? null,
      remoteExists,
      remoteTimeMs: remoteTimeMs,
      sameContent,
      toleranceMs: tol,
      mode: m
    })
    // 时间窗内的冲突候选才做内容比对（避免对全量文件跑 hash-object）
    if (status === 'conflict' && localExists && remoteExists && m === 'smart') {
      sameContent = await contentSame(workspaceDir, branch, rel, path.join(workspaceDir, rel))
      const refined = decideStatus({
        localExists,
        localTimeMs: l?.timeMs ?? null,
        remoteExists,
        remoteTimeMs,
        sameContent,
        toleranceMs: tol,
        mode: m
      })
      items.push({
        rel,
        status: refined,
        localTime: l?.timeMs ?? null,
        remoteTime: remoteTimeMs,
        size: l?.size ?? 0,
        reason: refined === 'conflict' ? '双方在容差窗口内都有修改且内容不同' : refined === 'skip' ? '内容一致' : undefined
      })
      continue
    }

    items.push({
      rel,
      status,
      localTime: l?.timeMs ?? null,
      remoteTime: remoteTimeMs,
      size: l?.size ?? 0,
      reason: !localExists ? '远程新增' : !remoteExists ? '本地新增' : status === 'skip' ? '内容一致' : undefined
    })
  }

  const stats = { total: items.length, upload: 0, download: 0, skip: 0, conflict: 0 }
  for (const item of items) stats[item.status] += 1
  return { ok: true, items, stats, mode: m, toleranceMs: tol, fetchedAt }
}

function emptyStats(): SyncPreviewPayload['stats'] {
  return { total: 0, upload: 0, download: 0, skip: 0, conflict: 0 }
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

/** 清理上次异常遗留的 rebase 状态（否则后续 git 操作会被阻断）。 */
async function abortStaleRebase(workspaceDir: string): Promise<void> {
  const gitDir = path.join(getSyncDir(workspaceDir), '.git')
  for (const d of ['rebase-merge', 'rebase-apply']) {
    if (fs.existsSync(path.join(gitDir, d))) {
      await git(workspaceDir, ['rebase', '--abort'])
      return
    }
  }
}

/**
 * 首次同步（本地 sync 仓库尚无提交）时，把索引重置为远端状态：
 * 后续只暂存真实变更，提交以 origin/<branch> 为父，避免「根提交整树快照
 * 被 rebase 到远端历史」导致的 add/add 冲突。
 */
async function baseIndexOnRemoteIfUnborn(workspaceDir: string, branch: string): Promise<{ ok: boolean; error?: string; based: boolean }> {
  const head = await git(workspaceDir, ['rev-parse', '--verify', '-q', 'HEAD'])
  if (head.ok) return { ok: true, based: false } // 本地已有历史，正常 rebase 路径
  const remote = await git(workspaceDir, ['rev-parse', '--verify', '-q', `origin/${branch}`])
  if (!remote.ok) return { ok: true, based: false } // 远端无分支 → 直接建库
  const reset = await git(workspaceDir, ['reset', '--soft', `origin/${branch}`])
  if (!reset.ok) return { ok: false, error: `以远端为基线失败：${reset.error}`, based: false }
  return { ok: true, based: true }
}

/** 智能上传：仅将选中文件加入暂存 → commit →（必要时 pull --rebase）→ push。 */
export async function smartPush(
  workspaceDir: string,
  selection: string[],
  mode: SyncMode = 'smart'
): Promise<{ ok: boolean; error?: string; pushed?: number; conflict?: boolean }> {
  const config = readSyncConfig(workspaceDir)
  if (!config.remoteUrl) return { ok: false, error: '尚未配置同步远端仓库地址' }
  if (mode === 'force') return syncForceLocal()
  const initError = await ensureRepo(workspaceDir, config)
  if (initError) return { ok: false, error: initError }
  const branch = config.branch || 'main'
  const rels = (selection ?? []).filter((r) => typeof r === 'string' && r.length > 0)
  if (rels.length === 0) return { ok: true, pushed: 0 }

  await abortStaleRebase(workspaceDir)
  const fetch = await git(workspaceDir, ['fetch', 'origin', branch])
  if (!fetch.ok) return { ok: false, error: `拉取远端失败：${fetch.error}` }
  const based = await baseIndexOnRemoteIfUnborn(workspaceDir, branch)
  if (!based.ok) return { ok: false, error: based.error }

  prepareLocal(workspaceDir)
  const add = await git(workspaceDir, ['add', '--', ...rels])
  if (!add.ok) return { ok: false, error: `git add 失败：${add.error}` }
  const staged = await git(workspaceDir, ['diff', '--cached', '--quiet'])
  if (staged.ok) return { ok: true, pushed: 0, error: '没有需要上传的变更' }

  await git(workspaceDir, ['commit', '-m', `smart push ${new Date().toISOString()}`])
  if (!based.based) {
    const pull = await git(workspaceDir, ['pull', '--rebase', 'origin', branch])
    if (!pull.ok) {
      return { ok: false, conflict: true, error: `同步冲突：${pull.error}。可尝试「以本地为准强制推送」或「以远端为准」` }
    }
  }
  const push = await git(workspaceDir, ['push', 'origin', branch])
  if (!push.ok) return { ok: false, error: `推送失败：${push.error}` }
  writeSyncConfig({ lastSyncAt: Date.now() }, workspaceDir)
  logger.info(`智能同步上传完成（${rels.length} 个文件）`)
  return { ok: true, pushed: rels.length }
}

/** 智能下载：git checkout 选中文件到同步仓库 → commit → 复制回工作文件夹。 */
export async function smartPull(
  workspaceDir: string,
  selection: string[],
  mode: SyncMode = 'smart'
): Promise<{ ok: boolean; error?: string; pulled?: number; conflict?: boolean }> {
  const config = readSyncConfig(workspaceDir)
  if (!config.remoteUrl) return { ok: false, error: '尚未配置同步远端仓库地址' }
  if (mode === 'force') return syncForceRemote()
  const initError = await ensureRepo(workspaceDir, config)
  if (initError) return { ok: false, error: initError }
  const branch = config.branch || 'main'
  const rels = (selection ?? []).filter((r) => typeof r === 'string' && r.length > 0)
  if (rels.length === 0) return { ok: true, pulled: 0 }

  await abortStaleRebase(workspaceDir)
  const fetch = await git(workspaceDir, ['fetch', 'origin', branch])
  if (!fetch.ok) return { ok: false, error: `拉取远端失败：${fetch.error}` }
  const checkout = await git(workspaceDir, ['checkout', `origin/${branch}`, '--', ...rels])
  if (!checkout.ok) return { ok: false, error: `检出远端文件失败：${checkout.error}` }
  const staged = await git(workspaceDir, ['diff', '--cached', '--quiet'])
  if (!staged.ok) await git(workspaceDir, ['commit', '-m', `smart pull ${Date.now()}`])

  let copied = 0
  for (const rel of rels) {
    const src = path.join(getSyncDir(workspaceDir), rel)
    const dst = path.join(workspaceDir, rel)
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      copied++
    }
  }
  writeSyncConfig({ lastSyncAt: Date.now() }, workspaceDir)
  logger.info(`智能同步下载完成（${copied} 个文件）`)
  return { ok: true, pulled: copied }
}

/** 冲突三选一：保留本地（提交本地版本并推送） / 使用远程（检出远端版本并复制回本地）。 */
export async function resolveConflictFile(
  rel: string,
  choice: 'local' | 'remote'
): Promise<{ ok: boolean; error?: string }> {
  const workspaceDir = getWorkspaceDir()
  const config = readSyncConfig(workspaceDir)
  if (!config.remoteUrl) return { ok: false, error: '尚未配置同步远端仓库地址' }
  const initError = await ensureRepo(workspaceDir, config)
  if (initError) return { ok: false, error: initError }
  const branch = config.branch || 'main'

  if (choice === 'remote') {
    const checkout = await git(workspaceDir, ['checkout', `origin/${branch}`, '--', rel])
    if (!checkout.ok) return { ok: false, error: `检出远端版本失败：${checkout.error}` }
    const staged = await git(workspaceDir, ['diff', '--cached', '--quiet'])
    if (!staged.ok) await git(workspaceDir, ['commit', '-m', `conflict resolve remote ${Date.now()}`])
    const src = path.join(getSyncDir(workspaceDir), rel)
    const dst = path.join(workspaceDir, rel)
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
    }
    return { ok: true }
  }

  // 保留本地
  prepareLocal(workspaceDir)
  const add = await git(workspaceDir, ['add', '--', rel])
  if (!add.ok) return { ok: false, error: `git add 失败：${add.error}` }
  await git(workspaceDir, ['commit', '-m', `conflict resolve local ${Date.now()}`])
  const pull = await git(workspaceDir, ['pull', '--rebase', 'origin', branch])
  if (!pull.ok) {
    return { ok: false, error: '以本地为准需要先解决远端冲突，可改用「强制推送」' }
  }
  const push = await git(workspaceDir, ['push', 'origin', branch])
  if (!push.ok) return { ok: false, error: `推送失败：${push.error}` }
  writeSyncConfig({ lastSyncAt: Date.now() }, workspaceDir)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 自动同步调度
// ---------------------------------------------------------------------------

let autoTimer: NodeJS.Timeout | null = null

/** 启动自动同步（按 sync.json 的 smart.autoSyncMinutes）；返回停止函数。 */
export function scheduleAutoSync(onResult: (message: string) => void, workspaceDir?: string): () => void {
  stopAutoSyncSchedule()
  const ws = workspaceDir ?? getWorkspaceDir()
  const settings = readSyncSettings(ws)
  const minutes = settings.autoSyncMinutes ?? 0
  if (minutes <= 0) return () => undefined
  const run = (): void => {
    void (async () => {
      try {
        const mode = readSyncSettings(ws).mode ?? 'smart'
        const preview = await buildPreview(ws, mode)
        if (!preview.ok) return
        const uploads = preview.items.filter((i) => i.status === 'upload').map((i) => i.rel)
        const downloads = preview.items.filter((i) => i.status === 'download').map((i) => i.rel)
        let pushed = 0
        let pulled = 0
        if (uploads.length > 0) {
          const r = await smartPush(ws, uploads, mode)
          if (r.ok) pushed = r.pushed ?? 0
        }
        if (downloads.length > 0) {
          const r = await smartPull(ws, downloads, mode)
          if (r.ok) pulled = r.pulled ?? 0
        }
        if (pushed > 0 || pulled > 0) {
          onResult(`自动同步完成：上传 ${pushed} 个，下载 ${pulled} 个`)
        }
      } catch (error) {
        logger.warn(`自动同步失败：${String(error)}`)
      }
    })()
  }
  autoTimer = setInterval(run, minutes * 60 * 1000)
  return stopAutoSyncSchedule
}

export function stopAutoSyncSchedule(): void {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
}
