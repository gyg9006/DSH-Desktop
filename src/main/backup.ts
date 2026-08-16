/**
 * M5：备份与恢复（规格 6.21~6.25）。
 * 备份内容：data/ skills/ plugins/ config/（不含 runtime/，体积大且机器相关）；
 * 用 Windows 自带 bsdtar（tar.exe）打包 zip；自动备份按周期 + 保留份数滚动删除。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runCommand } from './utils/process'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'

export const BACKUP_DIRS = ['data', 'skills', 'plugins', 'config'] as const

export const ZIP_TIMEOUT_MS = 600000

export interface BackupEntry {
  name: string
  path: string
  sizeBytes: number
  mtime: number
}

export interface BackupSettings {
  enabled?: boolean
  period?: 'daily' | 'weekly'
  keep?: number
  lastAt?: number
}

function backupTimestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds())}`
}

export function getBackupsDir(workspaceDir: string): string {
  return path.join(workspaceDir, 'backups')
}

/** 一键备份：打包业务数据为带时间戳 zip（规格 6.21）。 */
export async function createBackup(
  workspaceDir: string,
  destDir?: string
): Promise<{ ok: boolean; path?: string; sizeBytes?: number; error?: string }> {
  const backupsDir = destDir ?? getBackupsDir(workspaceDir)
  fs.mkdirSync(backupsDir, { recursive: true })
  const zipPath = path.join(backupsDir, `backup-${backupTimestamp()}.zip`)
  const result = await runCommand({
    command: 'tar',
    args: ['-a', '-cf', zipPath, '-C', workspaceDir, ...BACKUP_DIRS],
    timeoutMs: ZIP_TIMEOUT_MS
  })
  if (result.error) {
    logger.error(`备份失败：${result.error}`)
    return { ok: false, error: `备份失败：${result.error}` }
  }
  if (!fs.existsSync(zipPath)) {
    return { ok: false, error: '备份失败：未生成备份文件' }
  }
  const sizeBytes = fs.statSync(zipPath).size
  logger.info(`备份完成：${zipPath}（${Math.round(sizeBytes / 1024)} KB）`)
  return { ok: true, path: zipPath, sizeBytes }
}

/** 列出全部备份。 */
export function listBackups(workspaceDir: string): BackupEntry[] {
  const dir = getBackupsDir(workspaceDir)
  if (!fs.existsSync(dir)) return []
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.zip'))
      .map((name) => {
        const full = path.join(dir, name)
        const stat = fs.statSync(full)
        return { name, path: full, sizeBytes: stat.size, mtime: stat.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

/** 恢复备份：解压覆盖到工作文件夹（规格 6.23，调用前 UI 已红字二次确认）。 */
export async function restoreBackup(workspaceDir: string, zipPath: string): Promise<{ ok: boolean; error?: string }> {
  if (!fs.existsSync(zipPath)) return { ok: false, error: '备份文件不存在' }
  const ext = path.extname(zipPath).toLowerCase()
  if (ext !== '.zip') return { ok: false, error: '请选择 .zip 备份文件' }

  // 安全校验：仅允许备份白名单顶层目录，拒绝路径穿越（../、绝对路径）。
  const listing = await runCommand({ command: 'tar', args: ['-tf', zipPath], timeoutMs: ZIP_TIMEOUT_MS })
  if (listing.error || listing.code !== 0) return { ok: false, error: `无法读取备份内容：${listing.error ?? `exit ${listing.code}`}` }
  const entries = (listing.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (entries.length === 0) return { ok: false, error: '备份文件内容为空' }
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/')
    if (normalized.startsWith('/') || normalized.includes('..') || /^[a-zA-Z]:/.test(normalized)) {
      return { ok: false, error: `备份内容异常，已拒绝恢复：${entry}` }
    }
    const top = normalized.split('/')[0]
    if (!(BACKUP_DIRS as readonly string[]).includes(top)) {
      return { ok: false, error: `备份包含非业务目录「${top}」，已拒绝恢复` }
    }
  }

  const result = await runCommand({
    command: 'tar',
    args: ['-xf', zipPath, '-C', workspaceDir],
    timeoutMs: ZIP_TIMEOUT_MS
  })
  if (result.error) return { ok: false, error: `恢复失败：${result.error}` }
  logger.info(`备份已恢复：${zipPath}`)
  return { ok: true }
}

export function deleteBackup(workspaceDir: string, name: string): { ok: boolean; error?: string } {
  const full = path.join(getBackupsDir(workspaceDir), name)
  if (!full.startsWith(getBackupsDir(workspaceDir)) || !name.endsWith('.zip')) {
    return { ok: false, error: '非法文件名' }
  }
  try {
    fs.rmSync(full, { force: true })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `删除失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 滚动删除：仅保留最新 keep 份。 */
export function pruneBackups(workspaceDir: string, keep: number): number {
  const all = listBackups(workspaceDir)
  let removed = 0
  for (const entry of all.slice(keep)) {
    try {
      fs.rmSync(entry.path, { force: true })
      removed += 1
    } catch {
      /* 忽略 */
    }
  }
  if (removed > 0) logger.info(`自动备份滚动清理：移除 ${removed} 个旧备份`)
  return removed
}

// ---------------------------------------------------------------------------
// 自动备份（规格 6.22）
// ---------------------------------------------------------------------------

export function readBackupSettings(workspaceDir: string): BackupSettings {
  const raw = readJsonFile(path.join(workspaceDir, 'config', 'app.json')) as { backup?: BackupSettings } | null
  return raw?.backup && typeof raw.backup === 'object' ? raw.backup : {}
}

export function writeBackupSettings(workspaceDir: string, patch: Partial<BackupSettings>): BackupSettings {
  const current = readBackupSettings(workspaceDir)
  const next: BackupSettings = { ...current, ...patch }
  const configPath = path.join(workspaceDir, 'config', 'app.json')
  const raw = (readJsonFile(configPath) ?? {}) as Record<string, unknown>
  writeJsonAtomic(configPath, { ...raw, backup: next })
  return next
}

/** 判断是否到了备份周期（纯函数，可单测）。 */
export function isBackupDue(settings: BackupSettings, now: number): boolean {
  if (!settings.enabled || !settings.period) return false
  const lastAt = settings.lastAt ?? 0
  if (lastAt <= 0) return true
  const last = new Date(lastAt)
  const current = new Date(now)
  if (settings.period === 'daily') {
    return (
      last.getFullYear() !== current.getFullYear() ||
      last.getMonth() !== current.getMonth() ||
      last.getDate() !== current.getDate()
    )
  }
  // weekly：按周一为一周起点
  const weekStart = (d: Date): number => {
    const day = (d.getDay() + 6) % 7 // 周一=0
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
    return start.getTime()
  }
  return weekStart(current) > weekStart(last)
}

/** 自动备份调度（启动时 + 每小时检查一次）。 */
export function scheduleAutoBackup(workspaceDir: string): void {
  const run = (): void => {
    const settings = readBackupSettings(workspaceDir)
    if (!isBackupDue(settings, Date.now())) return
    void (async () => {
      const result = await createBackup(workspaceDir)
      if (result.ok) {
        writeBackupSettings(workspaceDir, { lastAt: Date.now() })
        pruneBackups(workspaceDir, settings.keep ?? 5)
      } else {
        logger.warn(`自动备份失败：${result.error ?? ''}`)
      }
    })()
  }
  run()
  setInterval(run, 60 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// 导出全部（规格 6.24）
// ---------------------------------------------------------------------------

/** 整目录复制到指定位置（可选是否包含 runtime/，便于换机）。 */
export async function exportWorkspace(
  workspaceDir: string,
  destDir: string,
  includeRuntime: boolean
): Promise<{ ok: boolean; error?: string; sizeBytes?: number }> {
  try {
    fs.mkdirSync(destDir, { recursive: true })
    const dirs = ['data', 'skills', 'plugins', 'config', 'backups', 'logs', ...(includeRuntime ? ['runtime'] : [])]
    let total = 0
    for (const dir of dirs) {
      const src = path.join(workspaceDir, dir)
      if (!fs.existsSync(src)) continue
      const dest = path.join(destDir, dir)
      fs.cpSync(src, dest, { recursive: true })
      const walk = (d: string): number => {
        let sum = 0
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name)
          if (e.isDirectory()) sum += walk(full)
          else if (e.isFile()) sum += fs.statSync(full).size
        }
        return sum
      }
      total += walk(dest)
    }
    logger.info(`导出完成：${destDir}（${Math.round(total / 1024 / 1024)} MB）`)
    return { ok: true, sizeBytes: total }
  } catch (error) {
    return { ok: false, error: `导出失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
