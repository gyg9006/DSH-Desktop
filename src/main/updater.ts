/**
 * 版本更新：检查 / 下载 / 应用（规格 6.27「版本更新」扩展）。
 *
 * 更新源：GitHub Releases（仓库 gyg9006/DSH-Desktop）。
 * - 检查：GET https://api.github.com/repos/gyg9006/DSH-Desktop/releases/latest
 * - 下载：走 asset API（Accept: application/octet-stream），302 到
 *   objects.githubusercontent.com —— 绕过被 DNS 污染的 github.com 主站连接。
 * - 应用：便携版（dir target），exe 运行中无法覆盖，
 *   写入 update.bat（等待进程退出 → 替换 app 目录 → 启动新 exe → 自删）。
 *
 * 更新设置存于 workspace/config/app.json 的 updater 键：
 *   { mode: 'auto' | 'manual', lastCheckAt?: number, lastVersion?: string }
 * auto 模式：主进程定时检查（启动 10 秒后 + 每 6 小时），发现新版本自动下载，
 * 下载完成后经 update 事件提示用户重启应用完成更新。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { app } from 'electron'
import { logger } from './logger'
import { getWorkspaceDir, getRootDir } from './config'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { parseVersion, compareVersions, formatVersionString } from '../shared/version'

/** 更新源仓库（owner/repo）。可通过环境变量覆盖（如私有镜像仓库）。 */
export const UPDATE_REPO = (process.env.UPDATE_REPO as string | undefined) || 'gyg9006/DSH-Desktop'

/** 更新源 API 前缀（默认官方 GitHub API）。 */
export const UPDATE_API_BASE = (process.env.UPDATE_API_BASE as string | undefined) || 'https://api.github.com'

export type UpdateMode = 'auto' | 'manual'

export interface UpdateSettings {
  mode: UpdateMode
  /** 最近一次检查时间（ms） */
  lastCheckAt?: number
  /** 已检查到的远端版本（防止重复提示） */
  lastVersion?: string
}

export interface UpdateCheckResult {
  ok: boolean
  current: string
  hasUpdate: boolean
  latest?: string
  message: string
  notes?: string
  /** 更新包（zip）的 asset id，下载时用 */
  assetId?: number
  /** 更新包文件名 */
  assetName?: string
  /** 更新包大小（字节） */
  size?: number
  /** 下载地址（GitHub 网页地址，仅展示用） */
  downloadUrl?: string
}

export interface UpdateDownloadResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export type UpdateEventPhase =
  | 'checking'
  | 'found'
  | 'none'
  | 'downloading'
  | 'downloaded'
  | 'applying'
  | 'error'

export interface UpdateEvent {
  phase: UpdateEventPhase
  percent?: number
  message?: string
  version?: string
  error?: string
}

/** 注册到主进程的更新事件广播（由 ipc.ts 注入，避免循环依赖）。 */
let broadcast: ((event: UpdateEvent) => void) | null = null
export function setUpdateEventBroadcast(cb: (event: UpdateEvent) => void): void {
  broadcast = cb
}
function emit(event: UpdateEvent): void {
  try {
    broadcast?.(event)
  } catch (error) {
    logger.warn(`更新事件广播失败：${String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// 设置（config/app.json 的 updater 键）
// ---------------------------------------------------------------------------

export function readUpdateSettings(workspaceDir?: string): UpdateSettings {
  const ws = workspaceDir ?? getWorkspaceDir()
  const raw = readJsonFile(path.join(ws, 'config', 'app.json')) as { updater?: UpdateSettings } | null
  const updater = raw?.updater
  if (!updater || typeof updater !== 'object') return { mode: 'auto' }
  return {
    mode: updater.mode === 'manual' ? 'manual' : 'auto',
    lastCheckAt: typeof updater.lastCheckAt === 'number' ? updater.lastCheckAt : undefined,
    lastVersion: typeof updater.lastVersion === 'string' ? updater.lastVersion : undefined
  }
}

export function writeUpdateSettings(patch: Partial<UpdateSettings>, workspaceDir?: string): UpdateSettings {
  const ws = workspaceDir ?? getWorkspaceDir()
  const current = readUpdateSettings(ws)
  const next: UpdateSettings = { ...current, ...patch }
  const configPath = path.join(ws, 'config', 'app.json')
  const raw = (readJsonFile(configPath) ?? {}) as Record<string, unknown>
  writeJsonAtomic(configPath, { ...raw, updater: next })
  return next
}

// ---------------------------------------------------------------------------
// 检查更新
// ---------------------------------------------------------------------------

interface GithubRelease {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  assets?: { id?: number; name?: string; size?: number; browser_download_url?: string; content_type?: string }[]
}

/** 解析 GitHub API 返回的 tag（v0.2.0 / 0.2.0）。失败返回 null。 */
export function parseTagVersion(tag: string | undefined): ReturnType<typeof parseVersion> {
  return parseVersion(tag)
}

/** 远端版本是否高于本地。 */
export function isNewer(local: string, remote: string | undefined): boolean {
  const l = parseVersion(local)
  const r = parseVersion(remote)
  if (!l || !r) return false
  return compareVersions(r, l) > 0
}

/** 从 release 中挑选更新包 asset（首个 .zip 且名字含版本号/DSH-Desktop）。 */
export function pickUpdateAsset(release: GithubRelease): GithubRelease['assets'] extends (infer A)[] | undefined ? A | undefined : never {
  const assets = release.assets ?? []
  return assets.find((a) => /\.zip$/i.test(a.name ?? '') && /dsh[- ]?desktop/i.test(a.name ?? '')) ?? assets.find((a) => /\.zip$/i.test(a.name ?? ''))
}

/**
 * 检查更新（网络请求，超时 15s）。
 * 远端无 release / 无更新包时视为「无更新」。
 * @param opts.force 忽略 10 分钟冷却，强制请求
 * @param opts.localVersion 本地版本号（测试注入；默认读 app.getVersion()）
 * @param opts.workspaceDir 设置读写目录（测试注入）
 * @param opts.fetchImpl fetch 实现（测试注入；默认全局 fetch）
 */
export async function checkForUpdate(opts: {
  force?: boolean
  localVersion?: string
  workspaceDir?: string
  fetchImpl?: typeof fetch
} = {}): Promise<UpdateCheckResult> {
  const force = opts.force === true
  const current = opts.localVersion ?? app.getVersion()
  const ws = opts.workspaceDir
  const fetchImpl = opts.fetchImpl ?? fetch
  const settings = readUpdateSettings(ws)
  const now = Date.now()
  // 非强制且 10 分钟内刚检查过 → 直接复用上次结果（避免高频请求 GitHub API 限流）
  if (!force && settings.lastCheckAt && now - settings.lastCheckAt < 10 * 60 * 1000) {
    return {
      ok: true,
      current,
      hasUpdate: !!settings.lastVersion && isNewer(current, settings.lastVersion),
      latest: settings.lastVersion,
      message: '已是最新版本'
    }
  }
  emit({ phase: 'checking', message: '正在检查更新…' })
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetchImpl(`${UPDATE_API_BASE}/repos/${UPDATE_REPO}/releases/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-Desktop' }
    })
    clearTimeout(timer)
    if (res.status === 404) {
      writeUpdateSettings({ lastCheckAt: now }, ws)
      return { ok: true, current, hasUpdate: false, message: '暂无可用更新' }
    }
    if (!res.ok) {
      return { ok: false, current, hasUpdate: false, message: `检查更新失败（HTTP ${res.status}）` }
    }
    const release = (await res.json()) as GithubRelease
    const tag = release.tag_name ?? release.name
    const hasUpdate = isNewer(current, tag)
    const asset = pickUpdateAsset(release)
    writeUpdateSettings({ lastCheckAt: now, lastVersion: tag }, ws)
    if (!hasUpdate) {
      return { ok: true, current, hasUpdate: false, latest: formatVersionString(tag), message: '已是最新版本' }
    }
    if (!asset) {
      return {
        ok: true,
        current,
        hasUpdate: true,
        latest: formatVersionString(tag),
        message: `发现新版本 v${formatVersionString(tag)}，但发布缺少更新包`,
        notes: release.body,
        downloadUrl: release.html_url
      }
    }
    emit({ phase: 'found', version: formatVersionString(tag), message: `发现新版本 v${formatVersionString(tag)}` })
    return {
      ok: true,
      current,
      hasUpdate: true,
      latest: formatVersionString(tag),
      message: `发现新版本 v${formatVersionString(tag)}`,
      notes: release.body,
      assetId: asset.id,
      assetName: asset.name,
      size: asset.size,
      downloadUrl: release.html_url
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    const message = aborted ? '检查更新超时，请检查网络连接' : `检查更新失败：${error instanceof Error ? error.message : String(error)}`
    logger.warn(`检查更新失败：${message}`)
    emit({ phase: 'error', message })
    return { ok: false, current, hasUpdate: false, message }
  }
}

// ---------------------------------------------------------------------------
// 下载更新
// ---------------------------------------------------------------------------

/** 当前下载任务（同一时刻只允许一个）。 */
let activeDownload: { aborted: boolean; timer: NodeJS.Timeout | null } | null = null

export function cancelUpdateDownload(): { ok: boolean } {
  if (activeDownload) activeDownload.aborted = true
  return { ok: true }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${text} ${units[i]}`
}

/**
 * 下载更新包 zip 到 workspace/tmp/update/，带进度事件。
 * 走 asset API（Accept: application/octet-stream → 302 到 objects CDN）。
 */
export async function downloadUpdate(assetId: number): Promise<UpdateDownloadResult> {
  if (activeDownload) {
    return { ok: false, error: '已有下载任务进行中' }
  }
  const ws = getWorkspaceDir()
  const dir = path.join(ws, 'tmp', 'update')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, 'dsh-desktop-update.zip')
  const task = { aborted: false, timer: null as NodeJS.Timeout | null }
  activeDownload = task
  emit({ phase: 'downloading', percent: 0, message: '准备下载…' })
  try {
    const controller = new AbortController()
    task.timer = setTimeout(() => controller.abort(), 30 * 60 * 1000)
    const res = await fetch(`${UPDATE_API_BASE}/repos/${UPDATE_REPO}/releases/assets/${assetId}`, {
      signal: controller.signal,
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'DSH-Desktop' }
    })
    if (!res.ok || !res.body) {
      throw new Error(`下载更新包失败（HTTP ${res.status}）`)
    }
    const total = Number(res.headers.get('content-length') ?? 0)
    const reader = res.body.getReader()
    const file = fs.createWriteStream(dest)
    let received = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (task.aborted) {
        controller.abort()
        throw new Error('下载已取消')
      }
      const { done, value } = await reader.read()
      if (done) break
      file.write(Buffer.from(value))
      received += value.byteLength
      if (total > 0) {
        const percent = Math.min(100, Math.round((received / total) * 100))
        emit({
          phase: 'downloading',
          percent,
          message: `下载中 ${formatBytes(received)} / ${formatBytes(total)}`
        })
      } else {
        emit({ phase: 'downloading', message: `下载中 ${formatBytes(received)}` })
      }
    }
    await new Promise<void>((resolve, reject) => {
      file.end(() => {
        file.close((err) => (err ? reject(err) : resolve()))
      })
    })
    if (task.aborted) throw new Error('下载已取消')
    emit({ phase: 'downloaded', percent: 100, message: `下载完成（${formatBytes(received)}）` })
    logger.info(`更新包下载完成：${dest}（${formatBytes(received)}）`)
    return { ok: true, path: dest }
  } catch (error) {
    const aborted = task.aborted
    const message = aborted ? '下载已取消' : `下载失败：${error instanceof Error ? error.message : String(error)}`
    emit({ phase: 'error', message, error: message })
    logger.warn(`更新包下载失败：${message}`)
    return { ok: false, canceled: aborted, error: message }
  } finally {
    if (task.timer) clearTimeout(task.timer)
    activeDownload = null
  }
}

// ---------------------------------------------------------------------------
// 应用更新（便携版：update.bat 替换 app 目录后重启）
// ---------------------------------------------------------------------------

/**
 * 生成 update.bat 并触发退出。
 * 便携版 exe 运行中无法被覆盖，故：
 * 1. 把新包解压到 <root>/workspace/tmp/update-app/（zip 根 = app 目录内容）；
 * 2. 写 update.bat（等待进程退出 → 旧 app 改名 app.old → 新目录移入 app →
 *    启动新 exe → 删除 app.old 与自身）；
 * 3. 停止 dsh 服务并退出应用；bat 在进程退出后完成替换。
 */
export function applyUpdate(zipPath: string): { ok: boolean; error?: string } {
  try {
    const root = getRootDir()
    const ws = getWorkspaceDir()
    const appDir = path.join(root, 'app')
    const stageDir = path.join(ws, 'tmp', 'update-app')
    const oldDir = path.join(root, 'app.old')

    // 解压 zip（zip 根 = app 目录内容，解压后 stage 即新 app 目录）
    fs.rmSync(stageDir, { recursive: true, force: true })
    fs.mkdirSync(stageDir, { recursive: true })
    const unzip = spawnSyncUnzip(zipPath, stageDir)
    if (!unzip) return { ok: false, error: '解压更新包失败（系统缺少 tar，无法解压 zip）' }
    // 校验解压结果：应包含可执行文件或 resources
    if (!fs.existsSync(path.join(stageDir, 'resources')) && !fs.readdirSync(stageDir).some((f) => /\.exe$/i.test(f))) {
      return { ok: false, error: '更新包内容异常（缺少应用文件）' }
    }

    // 清理可能的残留
    fs.rmSync(oldDir, { recursive: true, force: true })

    const exeName = path.basename(process.execPath)
    const batPath = path.join(root, 'update.bat')
    const bat = [
      '@echo off',
      'chcp 65001 >nul',
      'rem DSH 桌面 自动更新：等待进程退出后替换 app 目录并重启',
      'timeout /t 4 /nobreak >nul',
      `if exist "${oldDir}" rmdir /s /q "${oldDir}"`,
      `if exist "${appDir}" ren "${appDir}" "app.old"`,
      `if not exist "${appDir}" move "${stageDir}" "${appDir}"`,
      `if exist "${stageDir}" xcopy /e /y /q "${stageDir}" "${appDir}" >nul`,
      `if exist "${oldDir}" rmdir /s /q "${oldDir}"`,
      `start "" "${path.join(appDir, exeName)}"`,
      'del "%~f0"'
    ].join('\r\n')
    fs.writeFileSync(batPath, bat, 'utf8')
    logger.info(`更新脚本已生成：${batPath}（新 exe：${exeName}）`)
    return { ok: true }
  } catch (error) {
    const message = `应用更新失败：${error instanceof Error ? error.message : String(error)}`
    logger.error(message)
    return { ok: false, error: message }
  }
}

/** 用系统 tar（Windows 10+ 自带 bsdtar）解压 zip 到目标目录。 */
function spawnSyncUnzip(zipPath: string, dest: string): boolean {
  const result = spawnSync('tar', ['-xf', zipPath, '-C', dest], { encoding: 'utf8', timeout: 120000 })
  return result.status === 0
}

// ---------------------------------------------------------------------------
// 自动更新调度
// ---------------------------------------------------------------------------

/** 自动检查间隔：6 小时。 */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** 启动后首次检查延迟：10 秒。 */
export const AUTO_CHECK_DELAY_MS = 10 * 1000

let autoTimer: NodeJS.Timeout | null = null

/** 自动模式：定时检查；发现新版本则自动下载（下载完成后经事件提示重启）。 */
export function scheduleAutoUpdate(): void {
  if (autoTimer) clearInterval(autoTimer)
  const run = (): void => {
    const settings = readUpdateSettings()
    if (settings.mode !== 'auto') return
    void (async () => {
      const result = await checkForUpdate()
      if (!result.ok || !result.hasUpdate || result.assetId === undefined) return
      // 已下载过同一版本则跳过
      const done = readUpdateSettings()
      if (done.lastVersion === result.latest && fs.existsSync(path.join(getWorkspaceDir(), 'tmp', 'update', 'dsh-desktop-update.zip'))) {
        return
      }
      emit({ phase: 'downloading', message: `自动更新：开始下载 v${result.latest}…` })
      const dl = await downloadUpdate(result.assetId)
      if (dl.ok && dl.path) {
        writeUpdateSettings({ lastVersion: result.latest })
        emit({ phase: 'downloaded', version: result.latest, message: `新版本 v${result.latest} 已下载完成` })
        logger.info(`自动更新：v${result.latest} 已下载，等待用户重启应用`)
      }
    })()
  }
  setTimeout(run, AUTO_CHECK_DELAY_MS)
  autoTimer = setInterval(run, AUTO_CHECK_INTERVAL_MS)
}

export function stopAutoUpdateSchedule(): void {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
}
