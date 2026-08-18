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
import { fastDownload, pickFastestMirror, verifySha256File } from './fastDownloader'

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
  /** 已忽略的版本（「稍后提醒」后不再提示，直到出现更新版本） */
  dismissedVersion?: string
  /** 下载分片线程数（默认 4） */
  threads?: number
  /** 自定义镜像前缀列表（如 https://ghproxy.com/） */
  mirrors?: string[]
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
  /** 更新包直链（browser_download_url，下载加速用） */
  browserUrl?: string
  /** SHA256SUMS 校验文件地址（发布侧随包上传） */
  checksumUrl?: string
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
    lastVersion: typeof updater.lastVersion === 'string' ? updater.lastVersion : undefined,
    dismissedVersion: typeof updater.dismissedVersion === 'string' ? updater.dismissedVersion : undefined,
    threads: typeof updater.threads === 'number' && updater.threads > 0 ? Math.round(updater.threads) : undefined,
    mirrors: Array.isArray(updater.mirrors) ? updater.mirrors.filter((s): s is string => typeof s === 'string') : undefined
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

/** 挑选 SHA256SUMS 校验文件 asset（发布侧随更新包上传）。 */
export function pickChecksumAsset(release: GithubRelease): GithubRelease['assets'] extends (infer A)[] | undefined ? A | undefined : never {
  const assets = release.assets ?? []
  return assets.find((a) => /^SHA256SUMS$/i.test(a.name ?? '')) ?? assets.find((a) => /\.sha256$/i.test(a.name ?? ''))
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
    const checksumAsset = pickChecksumAsset(release)
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
      downloadUrl: release.html_url,
      browserUrl: asset.browser_download_url,
      checksumUrl: checksumAsset?.browser_download_url
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

/** 拉取最新 release（供下载阶段取直链/校验文件）。 */
async function fetchLatestRelease(signal: AbortSignal): Promise<GithubRelease> {
  const res = await fetch(`${UPDATE_API_BASE}/repos/${UPDATE_REPO}/releases/latest`, {
    signal,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-Desktop' }
  })
  if (!res.ok) throw new Error(`获取更新信息失败（HTTP ${res.status}）`)
  return (await res.json()) as GithubRelease
}

/**
 * 下载更新包 zip 到 workspace/tmp/update/，带进度事件。
 * - 多线程 Range 分片（默认 4） + 断点续传（.parts）；
 * - 候选下载源 = 官方直链 + 用户配置镜像前缀，首字节测速选最快；
 * - 下载完成后按发布侧 SHA256SUMS 校验，失败自动换下一镜像源重试。
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
  const controller = new AbortController()
  task.timer = setTimeout(() => controller.abort(), 30 * 60 * 1000)
  try {
    // 1. 获取 release：直链 + SHA256SUMS
    const release = await fetchLatestRelease(controller.signal)
    const asset = (release.assets ?? []).find((a) => a.id === assetId)
    const browser = asset?.browser_download_url
    if (!browser) throw new Error('更新包下载地址缺失（发布侧未附带直链）')
    const checksumAsset = pickChecksumAsset(release)

    // 2. 候选源：官方直链 + 镜像前缀
    const settings = readUpdateSettings()
    const threads = settings.threads ?? 4
    const mirrors = settings.mirrors ?? []
    const candidates = [
      browser,
      ...mirrors.map((m) => `${m.replace(/\/+$/, '')}/${browser.replace(/^https?:\/\//, '')}`)
    ].filter(Boolean)

    // 3. 测速选最快，逐个尝试（校验失败换下一个）
    const ordered = await pickFastestMirror(candidates)
    const attemptList = ordered ? [ordered, ...candidates.filter((u) => u !== ordered)] : candidates
    let lastError: string | null = null
    for (const url of attemptList) {
      if (task.aborted) throw new Error('下载已取消')
      emit({ phase: 'downloading', percent: 5, message: `下载源：${url.slice(0, 80)}…` })
      const result = await fastDownload({
        url,
        dest,
        threads,
        signal: controller.signal,
        onProgress: (received, total, percent) => {
          emit({
            phase: 'downloading',
            percent,
            message: total > 0 ? `下载中 ${formatBytes(received)} / ${formatBytes(total)}` : `下载中 ${formatBytes(received)}`
          })
        }
      })
      if (result.canceled || task.aborted) throw new Error('下载已取消')
      if (!result.ok) {
        lastError = result.error ?? '下载失败'
        emit({ phase: 'downloading', message: `该源失败（${lastError}），尝试备用源…` })
        fs.rmSync(dest + '.parts', { recursive: true, force: true })
        continue
      }
      // 4. SHA256 校验
      if (checksumAsset?.browser_download_url) {
        const checksumRes = await fetch(checksumAsset.browser_download_url, { signal: controller.signal })
        const text = await checksumRes.text()
        const match = /^([0-9a-fA-F]{64})\s+\*?\S*$/m.exec(text)
        if (match && verifySha256File(dest, match[1])) {
          emit({ phase: 'downloading', message: 'SHA256 校验通过' })
        } else if (match) {
          lastError = 'SHA256 校验失败（包可能损坏或被篡改）'
          emit({ phase: 'downloading', message: `${lastError}，尝试备用源…` })
          fs.rmSync(dest, { force: true })
          fs.rmSync(dest + '.parts', { recursive: true, force: true })
          continue
        }
      }
      emit({ phase: 'downloaded', percent: 100, message: `下载完成（${formatBytes(result.bytes ?? 0)}）` })
      logger.info(`更新包下载完成：${dest}（${formatBytes(result.bytes ?? 0)}，源 ${url.slice(0, 80)}）`)
      return { ok: true, path: dest }
    }
    throw new Error(`所有下载源均失败：${lastError ?? '未知原因'}`)
  } catch (error) {
    const aborted = task.aborted || (error instanceof Error && error.message === '下载已取消')
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
 * 版本更新后冒烟测试（版本保护）：校验新 app 目录关键产物与功能注册表，
 * 任一失败 → 不安装（返回 false，由调用方中止更新流程，旧版本保持可用）。
 * 校验项（对应 feature-registry.json 的 requiredArtifacts + required features 文件）：
 * 1. 可执行文件名 DSH-Desktop.exe；
 * 2. resources/portable-env 关键可执行文件齐备（node/git/pnpm/dsh + env-manifest）；
 * 3. app.asar 存在。
 */
export function smokeTestApp(appDir: string): { ok: boolean; error?: string } {
  const problems: string[] = []
  const exeName = process.platform === 'win32' ? 'DSH-Desktop.exe' : 'DSH-Desktop'
  if (!fs.existsSync(path.join(appDir, exeName))) problems.push(`缺少可执行文件 ${exeName}`)
  const envDir = path.join(appDir, 'resources', 'portable-env')
  for (const rel of ['node/node.exe', 'git/cmd/git.exe', 'pnpm/pnpm.exe', 'dsh-cli/package.json', 'env-manifest.json']) {
    if (!fs.existsSync(path.join(envDir, rel))) problems.push(`内置环境缺失：resources/portable-env/${rel}`)
  }
  if (!fs.existsSync(path.join(appDir, 'resources', 'app.asar'))) problems.push('缺少 app.asar')
  return problems.length === 0 ? { ok: true } : { ok: false, error: problems.join('；') }
}

/**
 * 生成更新报告 update-report.md（版本保护留档）：更新版本、变更、冒烟结果、回滚状态。
 * 更新报告写在工作文件夹 <ws>/logs/update-report.md。
 */
export function writeUpdateReport(ws: string, payload: { fromVersion: string; toVersion: string; smoke: boolean; smokeError?: string; rolledBack?: boolean }): void {
  try {
    const lines = [
      '# DSH 桌面 更新报告',
      '',
      `- 更新时间：${new Date().toISOString()}`,
      `- 更新版本：${payload.fromVersion} → ${payload.toVersion}`,
      `- 冒烟测试：${payload.smoke ? '✅ 通过' : `❌ 失败（${payload.smokeError ?? ''}）`}`,
      `- 是否回滚：${payload.rolledBack ? '是' : '否'}`,
      '',
      '## 变更文件（本次更新包内容）',
      '- 客户端主程序（app 目录整体替换）',
      '- 内置便携环境（resources/portable-env：node/git/pnpm/dsh）',
      '- 功能注册表（resources/feature-registry.json）'
    ]
    fs.mkdirSync(path.join(ws, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'logs', 'update-report.md'), lines.join('\n'), 'utf8')
  } catch (error) {
    logger.warn(`更新报告写入失败：${String(error)}`)
  }
}

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
    const fromVersion = app.getVersion()

    // 解压 zip（zip 根 = app 目录内容，解压后 stage 即新 app 目录）
    fs.rmSync(stageDir, { recursive: true, force: true })
    fs.mkdirSync(stageDir, { recursive: true })
    const unzip = spawnSyncUnzip(zipPath, stageDir)
    if (!unzip) {
      writeUpdateReport(ws, { fromVersion, toVersion: '?', smoke: false, smokeError: '解压失败（缺少 tar）' })
      return { ok: false, error: '解压更新包失败（系统缺少 tar，无法解压 zip）' }
    }
    // 校验解压结果：应包含可执行文件或 resources
    if (!fs.existsSync(path.join(stageDir, 'resources')) && !fs.readdirSync(stageDir).some((f) => /\.exe$/i.test(f))) {
      writeUpdateReport(ws, { fromVersion, toVersion: '?', smoke: false, smokeError: '更新包内容异常（缺少应用文件）' })
      return { ok: false, error: '更新包内容异常（缺少应用文件）' }
    }

    // 版本保护：安装前冒烟测试（exe 名 / 内置环境 / asar），任一失败 → 不替换，旧版本保持可用
    const smoke = smokeTestApp(stageDir)
    if (!smoke.ok) {
      writeUpdateReport(ws, { fromVersion, toVersion: '?', smoke: false, smokeError: smoke.error })
      logger.error(`更新包冒烟测试失败，已中止更新：${smoke.error}`)
      return { ok: false, error: `更新包冒烟测试失败（${smoke.error}），已中止更新，当前版本不受影响` }
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
      // 版本保护：替换后二次校验 exe；失败回滚到 app.old
      `if not exist "${appDir}\\${exeName}" goto rollback`,
      `if not exist "${appDir}\\resources\\portable-env\\node\\node.exe" goto rollback`,
      `if exist "${oldDir}" rmdir /s /q "${oldDir}"`,
      `start "" "${path.join(appDir, exeName)}"`,
      'del "%~f0"',
      'exit /b 0',
      ':rollback',
      'rem 冒烟失败：回滚旧版本',
      `if exist "${appDir}" rmdir /s /q "${appDir}"`,
      `if exist "${oldDir}" ren "${oldDir}" "app"`,
      `if exist "${appDir}\\${exeName}" start "" "${path.join(appDir, exeName)}"`,
      'del "%~f0"',
      'exit /b 1'
    ].join('\r\n')
    fs.writeFileSync(batPath, bat, 'utf8')
    writeUpdateReport(ws, { fromVersion, toVersion: '?', smoke: true })
    logger.info(`更新脚本已生成：${batPath}（新 exe：${exeName}，冒烟测试通过）`)
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

/** 自动模式：定时检查；发现新版本仅广播「found」，由 UI 决定下载（立即更新/稍后提醒/查看日志）。 */
export function scheduleAutoUpdate(): void {
  if (autoTimer) clearInterval(autoTimer)
  const run = (): void => {
    const settings = readUpdateSettings()
    if (settings.mode !== 'auto') return
    void (async () => {
      const result = await checkForUpdate()
      if (!result.ok || !result.hasUpdate || !result.latest) return
      // 已提示过该版本（lastVersion）或被「稍后提醒」忽略（dismissedVersion）→ 不重复打扰
      const done = readUpdateSettings()
      if (done.lastVersion === result.latest || done.dismissedVersion === result.latest) return
      writeUpdateSettings({ lastVersion: result.latest })
      emit({ phase: 'found', version: result.latest, message: `发现新版本 v${result.latest}` })
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
