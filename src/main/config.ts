/**
 * 应用配置存储：工作文件夹 / 运行时路径 / userData 重定向。
 * 所有业务数据均收敛在 <workspace> 内，不向 %APPDATA% 写入。
 */
import { app } from 'electron'
import path from 'node:path'
import { logger } from './logger'
import { ensureWorkspaceLayout, filterConfigPatch, readJsonFile, resolveWorkspaceDir, writeJsonAtomic } from '../shared/workspace'
import { checkDshDataDir, writeHomePatch } from './migrate'
import type { AppConfig, ThemeMode } from '../shared/ipc'

let workspaceDir: string | null = null

/**
 * 程序根目录（规格所称「程序目录」= DSH-Workbench 文件夹）：
 * - 打包后：exe 位于 DSH-Workbench/app/，故取 exe 目录的上一级；
 * - 开发时：electron-vite 以项目根为 cwd，app.getAppPath() 即项目根。
 * 默认工作文件夹 = <程序根目录>/workspace。
 */
export function getRootDir(): string {
  if (app.isPackaged) return path.dirname(path.dirname(process.execPath))
  return app.getAppPath()
}

/** 解析当前工作文件夹（首次调用后缓存）。 */
export function getWorkspaceDir(): string {
  if (workspaceDir) return workspaceDir
  const { workspaceDir: resolved } = resolveWorkspaceDir(getRootDir())
  workspaceDir = resolved
  return workspaceDir
}

export function getConfigFilePath(): string {
  return path.join(getWorkspaceDir(), 'config', 'app.json')
}

export function getWindowStateFilePath(): string {
  return path.join(getWorkspaceDir(), 'config', 'window-state.json')
}

export function readAppConfig(): AppConfig {
  const raw = readJsonFile(getConfigFilePath())
  if (!raw || typeof raw !== 'object') return {}
  return raw as AppConfig
}

/** 可经 IPC 从渲染进程写入的配置键白名单（防止任意字段写入）。 */
const CONFIG_WRITE_WHITELIST: ReadonlySet<string> = new Set([
  'theme',
  'sidebarCollapsed',
  'onboarded',
  'workspacePath',
  'service',
  'backup',
  'showDshSidebar',
  'sidebarView'
])

/** 合并并持久化配置；仅接受白名单内的键，返回最新配置。 */
export function updateAppConfig(patch: Partial<AppConfig>): AppConfig {
  const current = readAppConfig()
  const filtered = filterConfigPatch(patch as Record<string, unknown> | undefined, CONFIG_WRITE_WHITELIST)
  const next: AppConfig = { ...current, ...filtered }
  writeJsonAtomic(getConfigFilePath(), next)
  return next
}

export function getEffectiveTheme(): ThemeMode {
  const theme = readAppConfig().theme
  return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system'
}

/**
 * 把 Electron 的 userData / sessionData / logs 重定向进工作文件夹。
 * 必须在 app ready 之前（模块顶层）调用：
 * Chromium 会在 ready 前按默认位置初始化部分组件（Local State、DevToolsActivePort 等），
 * 调用晚了会向 %APPDATA% 写入残留（规格 9.3 硬性要求）。
 */
export function redirectUserDataPaths(): void {
  const ws = getWorkspaceDir()
  app.setPath('userData', path.join(ws, 'config', 'electron-userdata'))
  app.setPath('sessionData', path.join(ws, 'config', 'electron-userdata', 'session'))
  app.setPath('logs', path.join(ws, 'logs'))
}

/**
 * 初始化运行时：
 * 1. 重定向 Electron 数据路径（幂等，通常已在模块顶层调用过）；
 * 2. 创建工作文件夹目录骨架；
 * 3. 初始化文件日志；
 * 4. 数据目录自检（规格 4.4：每次启动校验 DSH_HOME 目标目录可用性）。
 */
export function initializeRuntime(): string {
  redirectUserDataPaths()
  const ws = getWorkspaceDir()
  ensureWorkspaceLayout(ws)
  // 保证 workspace/skills 接入 dsh 技能根（幂等；不依赖用户打开迁移页）
  writeHomePatch(ws)
  logger.init(path.join(ws, 'logs'))
  const dataStatus = checkDshDataDir(ws)
  logger.info(
    `运行时初始化完成，工作文件夹：${ws}；数据目录自检：${dataStatus.status === 'ok' ? '正常' : dataStatus.status === 'missing' ? '缺失（已自动重建）' : '不可写'}`
  )
  return ws
}
