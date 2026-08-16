/**
 * 异地同步（需求：A/B 两台 PC 之间同步会话，丝滑切换工作）。
 * 机制：基于便携 Git（runtime/git）管理 workspace/sync 仓库；
 * 同步内容：会话（data/sessions）与会话元数据（storages/session_projcache.json）。
 * 凭据（.credentials.yaml、api.json）等敏感文件绝不同步。
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

/** 复制目录：仅复制缺失或源较新的文件（会话为 append-only，避免覆盖本地更新）。 */
function syncTree(srcRoot: string, destRoot: string): number {
  if (!fs.existsSync(srcRoot)) return 0
  fs.mkdirSync(destRoot, { recursive: true })
  let copied = 0
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    const src = path.join(srcRoot, entry.name)
    const dest = path.join(destRoot, entry.name)
    if (entry.isDirectory()) {
      copied += syncTree(src, dest)
    } else if (entry.isFile()) {
      const srcStat = fs.statSync(src)
      let needCopy = !fs.existsSync(dest)
      if (!needCopy) {
        const destStat = fs.statSync(dest)
        needCopy = srcStat.mtimeMs > destStat.mtimeMs + 1000
      }
      if (needCopy) {
        fs.copyFileSync(src, dest)
        copied += 1
      }
    }
  }
  return copied
}

/** 把本地会话同步到 sync 仓库工作区。 */
function prepareLocal(workspaceDir: string): number {
  const syncDir = getSyncDir(workspaceDir)
  fs.mkdirSync(syncDir, { recursive: true })
  const sessionsSrc = path.join(workspaceDir, 'data', 'sessions')
  const sessionsDest = path.join(syncDir, 'sessions')
  const copied = syncTree(sessionsSrc, sessionsDest)
  // 会话元数据（projcache）作为同步副本
  const projSrc = path.join(workspaceDir, 'data', 'storages', 'session_projcache.json')
  if (fs.existsSync(projSrc)) {
    fs.copyFileSync(projSrc, path.join(syncDir, 'session_projcache.json'))
  }
  return copied
}

/** 把远端（sync 仓库）内容合并回本地 data/sessions。 */
function applyRemote(workspaceDir: string): number {
  const syncDir = getSyncDir(workspaceDir)
  const sessionsSrc = path.join(syncDir, 'sessions')
  const sessionsDest = path.join(workspaceDir, 'data', 'sessions')
  const copied = syncTree(sessionsSrc, sessionsDest)
  const projFile = path.join(syncDir, 'session_projcache.json')
  if (fs.existsSync(projFile)) {
    const destDir = path.join(workspaceDir, 'data', 'storages')
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(projFile, path.join(destDir, 'session_projcache.json'))
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
export async function syncPush(): Promise<{ ok: boolean; error?: string; pushed?: number }> {
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
    // rebase 冲突 → 返回错误，由 UI 提供强制方案
    return { ok: false, error: `同步冲突：${pull.error}。可尝试「以本地为准强制推送」或「以远端为准」` }
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
export async function syncPull(): Promise<{ ok: boolean; error?: string; pulled?: number }> {
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
    return { ok: false, error: `同步冲突：${pull.error}。可尝试「以远端为准」` }
  }
  const pulled = applyRemote(workspaceDir)
  writeSyncConfig({ lastSyncAt: Date.now() })
  logger.info(`同步拉取完成（${pulled} 个文件）`)
  return { ok: true, pulled }
}

/** 冲突强制解决：以远端为准（丢弃本地会话变更）。 */
export async function syncForceRemote(): Promise<{ ok: boolean; error?: string; pulled?: number }> {
  const workspaceDir = getWorkspaceDir()
  const config = readSyncConfig()
  const branch = config.branch || 'main'
  const reset = await git(workspaceDir, ['reset', '--hard', `origin/${branch}`])
  if (!reset.ok) return { ok: false, error: `重置失败：${reset.error}` }
  const pulled = applyRemote(workspaceDir)
  writeSyncConfig({ lastSyncAt: Date.now() })
  return { ok: true, pulled }
}

/** 冲突强制解决：以本地为准（强制推送覆盖远端）。 */
export async function syncForceLocal(): Promise<{ ok: boolean; error?: string; pushed?: number }> {
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
