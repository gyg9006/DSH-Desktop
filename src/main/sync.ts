/**
 * 异地同步（需求：A/B 两台 PC 之间同步，丝滑切换工作）。
 * 机制：基于便携 Git（runtime/git）管理 workspace/sync 仓库；
 * 同步内容（镜像整工作区数据，技能与插件随同步可用）：
 *   - data/sessions、data/storages、data/archived（会话与元数据）
 *   - data/profiles（插件依赖，换机后插件可用）
 *   - skills/（技能）
 *   - data/knowledge.json、data/agents.json（知识库 / Agent）
 *   - config 关键配置（app.json / session-groups / favorites / sync.json）
 * 凭据（.credentials.yaml、api.json、config/electron-userdata）绝不同步。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runCommand } from './utils/process'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { getWorkspaceDir } from './config'
import { logger } from './logger'

export interface SyncConfig {
  remoteUrl?: string
  branch?: string
  lastSyncAt?: number
}

const GIT_TIMEOUT_MS = 120000

function gitExe(workspaceDir: string): string {
  const portable = path.join(workspaceDir, 'runtime', 'git', 'cmd', 'git.exe')
  return fs.existsSync(portable) ? portable : 'git'
}

export function getSyncDir(workspaceDir: string): string {
  return path.join(workspaceDir, 'sync')
}

/** 校验同步远端地址：仅接受 http(s)/ssh/git scheme，拒绝前导 `-`（防被 git 解析为选项）。 */
export function isValidRemoteUrl(url: string): boolean {
  const t = url.trim()
  if (!t || t.startsWith('-')) return false
  return /^(https?|ssh|git):\/\//i.test(t)
}

function getSyncConfigPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'sync.json')
}

export function readSyncConfig(): SyncConfig {
  const raw = readJsonFile(getSyncConfigPath(getWorkspaceDir()))
  if (!raw || typeof raw !== 'object') return {}
  return raw as SyncConfig
}

export function writeSyncConfig(patch: Partial<SyncConfig>): SyncConfig {
  const current = readSyncConfig()
  const next: SyncConfig = { ...current, ...patch }
  writeJsonAtomic(getSyncConfigPath(getWorkspaceDir()), next)
  return next
}

/**
 * 按会话 id 对齐删除：把 destRoot（镜像侧）中「源侧已不存在」的会话目录删掉，
 * 保证删除操作能经 git 传播。
 * 结构：<root>/<projectKey>/<sessionId>/。
 */
export function pruneMissing(srcRoot: string, destRoot: string): number {
  if (!fs.existsSync(destRoot)) return 0
  let removed = 0
  for (const groupEntry of fs.readdirSync(destRoot, { withFileTypes: true })) {
    if (!groupEntry.isDirectory()) continue
    const destGroup = path.join(destRoot, groupEntry.name)
    const srcGroup = path.join(srcRoot, groupEntry.name)
    // 源侧整个组已不存在 → 删除整个组目录
    if (!fs.existsSync(srcGroup)) {
      fs.rmSync(destGroup, { recursive: true, force: true })
      removed += 1
      continue
    }
    for (const sidEntry of fs.readdirSync(destGroup, { withFileTypes: true })) {
      if (!sidEntry.isDirectory()) continue
      const destSid = path.join(destGroup, sidEntry.name)
      if (!fs.existsSync(path.join(srcGroup, sidEntry.name))) {
        fs.rmSync(destSid, { recursive: true, force: true })
        removed += 1
      }
    }
  }
  return removed
}

/** 同步镜像目录清单（相对 workspace）：skills/plugins 换机后直接可用。 */
const SYNC_DIRS = ['data/sessions', 'data/storages', 'data/archived', 'data/profiles', 'skills'] as const

/** 同步镜像文件清单（相对 workspace；凭据/大目录除外）。 */
const SYNC_FILES = [
  'data/knowledge.json',
  'data/agents.json',
  'config/app.json',
  'config/session-groups.json',
  'config/session-favorites.json',
  'config/sync.json'
] as const

/** 通用目录镜像：复制 + 删除对齐（删除可经 git 传播）。 */
function mirrorDir(srcDir: string, destDir: string): number {
  if (!fs.existsSync(srcDir)) return 0
  fs.mkdirSync(destDir, { recursive: true })
  let copied = 0
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copied += mirrorDir(s, d)
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
      copied++
    }
  }
  // 删除对齐：dest 有而 src 无的条目删除
  for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (!fs.existsSync(path.join(srcDir, entry.name))) {
      fs.rmSync(path.join(destDir, entry.name), { recursive: true, force: true })
    }
  }
  return copied
}

/** 把本地工作区同步到 sync 仓库工作区（复制 + 删除对齐，使删除可传播）。 */
export function prepareLocal(workspaceDir: string): number {
  const syncDir = getSyncDir(workspaceDir)
  fs.mkdirSync(syncDir, { recursive: true })
  let copied = 0
  for (const rel of SYNC_DIRS) {
    copied += mirrorDir(path.join(workspaceDir, rel), path.join(syncDir, rel))
  }
  for (const rel of SYNC_FILES) {
    const src = path.join(workspaceDir, rel)
    if (fs.existsSync(src)) {
      const dest = path.join(syncDir, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      copied++
    }
  }
  return copied
}

/** 把远端（sync 仓库）内容合并回本地（复制 + 删除对齐）。 */
export function applyRemote(workspaceDir: string): number {
  const syncDir = getSyncDir(workspaceDir)
  let copied = 0
  for (const rel of SYNC_DIRS) {
    copied += mirrorDir(path.join(syncDir, rel), path.join(workspaceDir, rel))
  }
  for (const rel of SYNC_FILES) {
    const src = path.join(syncDir, rel)
    if (fs.existsSync(src)) {
      const dest = path.join(workspaceDir, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      copied++
    }
  }
  return copied
}

async function git(workspaceDir: string, args: string[]): Promise<{ ok: boolean; stdout: string; error?: string }> {
  const result = await runCommand({
    command: gitExe(workspaceDir),
    args,
    cwd: getSyncDir(workspaceDir),
    timeoutMs: GIT_TIMEOUT_MS
  })
  if (result.error) {
    return { ok: false, stdout: result.stdout, error: result.error }
  }
  return { ok: true, stdout: result.stdout }
}

async function ensureRepo(workspaceDir: string, config: SyncConfig): Promise<string | null> {
  const syncDir = getSyncDir(workspaceDir)
  fs.mkdirSync(syncDir, { recursive: true })
  const branch = config.branch || 'main'
  if (!fs.existsSync(path.join(syncDir, '.git'))) {
    const init = await git(workspaceDir, ['init', '-b', branch])
    if (!init.ok) return init.error ?? 'git init 失败'
    await git(workspaceDir, ['config', 'user.name', 'DSH 桌面'])
    await git(workspaceDir, ['config', 'user.email', 'dsh-workbench@local'])
  }
  if (config.remoteUrl) {
    const setRemote = await git(workspaceDir, ['remote', 'set-url', 'origin', config.remoteUrl])
    if (!setRemote.ok) {
      const addRemote = await git(workspaceDir, ['remote', 'add', 'origin', config.remoteUrl])
      if (!addRemote.ok) return addRemote.error ?? '设置远端失败'
    }
  }
  return null
}

/** 远端分支是否已存在（首次推送时远端为空仓库）。 */
async function remoteBranchExists(workspaceDir: string, branch: string): Promise<boolean> {
  const r = await git(workspaceDir, ['ls-remote', '--heads', 'origin', branch])
  if (!r.ok) return false
  return r.stdout.trim().length > 0
}

/** 推送本地会话到远端。 */
export async function syncPush(): Promise<{ ok: boolean; error?: string; pushed?: number; conflict?: boolean }> {
  const workspaceDir = getWorkspaceDir()
  const config = readSyncConfig()
  if (!config.remoteUrl) return { ok: false, error: '尚未配置同步远端仓库地址' }
  const initError = await ensureRepo(workspaceDir, config)
  if (initError) return { ok: false, error: initError }
  const branch = config.branch || 'main'

  const pushed = prepareLocal(workspaceDir)
  const add = await git(workspaceDir, ['add', '-A'])
  if (!add.ok) return { ok: false, error: `git add 失败：${add.error}` }
  // 无变更时 commit 失败（nothing to commit）可接受，继续 push 检查远端
  await git(workspaceDir, ['commit', '-m', `sync ${new Date().toISOString()}`])

  if (!(await remoteBranchExists(workspaceDir, branch))) {
    // 首次推送：远端尚无该分支，直接建立
    const first = await git(workspaceDir, ['push', '-u', 'origin', branch])
    if (!first.ok) return { ok: false, error: `首次推送失败：${first.error}` }
    writeSyncConfig({ lastSyncAt: Date.now() })
    logger.info(`同步首次推送完成（${pushed} 个文件）`)
    return { ok: true, pushed }
  }

  const pull = await git(workspaceDir, ['pull', '--rebase', 'origin', branch])
  if (!pull.ok) {
    // rebase 冲突 → 返回错误（conflict=true），由 UI 提供强制方案
    return { ok: false, conflict: true, error: `同步冲突：${pull.error}。可尝试「以本地为准强制推送」或「以远端为准」` }
  }
  const push = await git(workspaceDir, ['push', 'origin', branch])
  if (!push.ok) {
    return { ok: false, error: `推送失败：${push.error}` }
  }
  writeSyncConfig({ lastSyncAt: Date.now() })
  logger.info(`同步推送完成（${pushed} 个文件）`)
  return { ok: true, pushed }
}

/** 拉取远端会话到本地。 */
export async function syncPull(): Promise<{ ok: boolean; error?: string; pulled?: number; conflict?: boolean }> {
  const workspaceDir = getWorkspaceDir()
  const config = readSyncConfig()
  if (!config.remoteUrl) return { ok: false, error: '尚未配置同步远端仓库地址' }
  const initError = await ensureRepo(workspaceDir, config)
  if (initError) return { ok: false, error: initError }
  const branch = config.branch || 'main'

  if (!(await remoteBranchExists(workspaceDir, branch))) {
    return { ok: false, error: '远端仓库还没有同步数据：请先在另一台电脑上执行「推送本地 → 远端」' }
  }

  // 先提交本地未推送变更，避免 pull 冲突（会话为增量文件，通常可快进）
  await prepareLocal(workspaceDir)
  await git(workspaceDir, ['add', '-A'])
  await git(workspaceDir, ['commit', '-m', `sync local ${Date.now()}`])
  const pull = await git(workspaceDir, ['pull', '--rebase', 'origin', branch])
  if (!pull.ok) {
    return { ok: false, conflict: true, error: `同步冲突：${pull.error}。可尝试「以远端为准」` }
  }
  const pulled = applyRemote(workspaceDir)
  writeSyncConfig({ lastSyncAt: Date.now() })
  logger.info(`同步拉取完成（${pulled} 个文件）`)
  return { ok: true, pulled }
}

/** 冲突强制解决：以远端为准（丢弃本地会话变更）。先 fetch 保证引用最新，再 reset。 */
export async function syncForceRemote(): Promise<{ ok: boolean; error?: string; pulled?: number; conflict?: boolean }> {
  const workspaceDir = getWorkspaceDir()
  const config = readSyncConfig()
  if (!config.remoteUrl) return { ok: false, error: '尚未配置同步远端仓库地址' }
  const initError = await ensureRepo(workspaceDir, config)
  if (initError) return { ok: false, error: initError }
  const branch = config.branch || 'main'
  const fetch = await git(workspaceDir, ['fetch', 'origin', branch])
  if (!fetch.ok) return { ok: false, error: `拉取远端失败：${fetch.error}` }
  const reset = await git(workspaceDir, ['reset', '--hard', `origin/${branch}`])
  if (!reset.ok) return { ok: false, error: `重置失败：${reset.error}` }
  const pulled = applyRemote(workspaceDir)
  writeSyncConfig({ lastSyncAt: Date.now() })
  return { ok: true, pulled }
}

/** 冲突强制解决：以本地为准（强制推送覆盖远端）。 */
export async function syncForceLocal(): Promise<{ ok: boolean; error?: string; pushed?: number; conflict?: boolean }> {
  const workspaceDir = getWorkspaceDir()
  const config = readSyncConfig()
  const branch = config.branch || 'main'
  const pushed = prepareLocal(workspaceDir)
  await git(workspaceDir, ['add', '-A'])
  await git(workspaceDir, ['commit', '-m', `sync force ${Date.now()}`])
  const push = await git(workspaceDir, ['push', '--force', 'origin', branch])
  if (!push.ok) return { ok: false, error: `强制推送失败：${push.error}` }
  writeSyncConfig({ lastSyncAt: Date.now() })
  return { ok: true, pushed }
}

/** 会话数统计（同步状态展示）。 */
export function syncSessionCount(workspaceDir: string): { local: number; remote: number } {
  const count = (dir: string): number => {
    if (!fs.existsSync(dir)) return 0
    let n = 0
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += count(path.join(dir, e.name))
      else if (/^session\.jsonl(\.zstd)?$/.test(e.name)) n += 1
    }
    return n
  }
  return {
    local: count(path.join(workspaceDir, 'data', 'sessions')),
    remote: count(path.join(getSyncDir(workspaceDir), 'sessions'))
  }
}
