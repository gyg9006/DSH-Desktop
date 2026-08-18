/**
 * IPC 路由：注册主进程全部 handle，供 preload 白名单调用。
 */
import { ipcMain, shell, clipboard, dialog, app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import type {
  AppConfig,
  DshDataItemKey,
  DshUiSettingsPayload,
  InstallEvent,
  InstallKey,
  InstallMode,
  LogLevel,
  MigrateConflictPolicy,
  MigrateEvent,
  ProviderConfigPayload,
  UiEventType,
  KnowledgeSearchQuery,
  KnowledgeExtractInput,
  KnowledgePipelineInput,
  AgentCollaborateInput,
  ModelsProviderSetInput,
  ModelsCustomUpsertInput,
  ModelsTestInput
} from '../shared/ipc'
import { logger } from './logger'
import { getWorkspaceDir, getRootDir, readAppConfig, updateAppConfig } from './config'
import { detectEnv } from './envCheck'
import { getMainWindow, minimizeMainWindow, toggleMaximizeMainWindow, closeMainWindow, isMainWindowMaximized } from './window'
import { runInstall, cancelInstall, INSTALL_KEYS } from './installer'
import {
  checkDshDataDir,
  scanAllDshHomes,
  runMigration,
  writeHomePatch,
  buildMigrationPlan,
  cancelMigration,
  isMigrationCancelled
} from './migrate'
import { validateWorkspacePath, writeJsonAtomic, readJsonFile } from '../shared/workspace'
import { startDshService, stopDshService, getServiceSnapshot, onServiceStatusChange, cleanupStaleDsh } from './dshService'
import { listSessions, pinSession, deleteSession, importSessionsFrom, expandImportArchives } from './sessions'
import { resetApp } from './reset'
import { readSyncConfig, writeSyncConfig, syncPush, syncPull, syncForceRemote, syncForceLocal, syncSessionCount, isValidRemoteUrl } from './sync'
import {
  buildPreview,
  smartPush,
  smartPull,
  resolveConflictFile,
  readSyncSettings,
  writeSyncSettings,
  scheduleAutoSync
} from './smartSync'
import { relocateWorkspace } from './workspaceRelocate'
import type { SyncRunInput, SyncSettingsPayload, SyncMode, RelocateEventPayload } from '../shared/ipc'
import { readApiConfig, writeApiConfig, testApiConnection, discoverModels, syncApiToDsh, validateProvider } from './apiConfig'
import {
  getPluginStates,
  setPluginEnabled,
  listInstalledPlugins,
  searchNpmPlugins,
  installPlugin,
  uninstallPlugin,
  isValidPkgSpec
} from './plugins'
import { skillMarketItems, installSkill, listInstalledSkills, CURATED_SKILLS, searchNpmSkills, installSkillFromNpmPackage } from './skillsMarket'
import { readUiSettings, writeUiSettings } from './dshUi'
import { readWorkspaces, renameWorkspace, deleteWorkspace, readSidebarData } from './workspaces'
import {
  createSessionGroup,
  renameSessionGroup,
  pinSessionGroup,
  deleteSessionGroup,
  moveSessionToGroup,
  setSessionFavorite,
  renameSessionRpc,
  forkSessionRpc,
  archiveSession,
  deleteArchivedSession,
  deleteArchivedSessions,
  deleteLiveSessions,
  unarchiveSession
} from './sessionOps'
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  exportWorkspace,
  readBackupSettings,
  writeBackupSettings
} from './backup'
import { readAppLog, readDshLog, clearLogs, exportLogsZip } from './logs'
import { getKnowledge, createKnowledgeCategory, renameKnowledgeCategory, deleteKnowledgeCategory, createKnowledgeEntry, updateKnowledgeEntry, deleteKnowledgeEntry, searchKnowledge, extractKnowledgeToStore, iterateKnowledge } from './knowledge'
import { runExtractionPipeline, readRecentSessionText } from './skillOrchestrator'
import { ensureGlobalRules, getRulesFilePath, saveGlobalRules } from './rules'
import { getAllProviders, updateProviderConfig, updateCustomProvider, deleteCustomProvider, migrateLegacyApiConfig } from './provider-registry'
import { saveApiKeySecure, readApiKeySecure, deleteApiKeySecure, maskKey } from './secure-storage'
import { testAdapterConnection, listModelsFor } from './adapters'
import { syncModelsConfigToDsh, syncKeysToCredentials } from './modelsDshSync'
import { listThemes, getActiveTheme, setActiveTheme } from './theme'
import { refreshTrayTheme } from './tray'
import { listAgents, importAgent, renameAgent, deleteAgent, runAgent, collaborateAgents } from './agents'
import {
  checkForUpdate,
  downloadUpdate,
  cancelUpdateDownload,
  applyUpdate,
  readUpdateSettings,
  writeUpdateSettings,
  setUpdateEventBroadcast
} from './updater'
import type {
  ApiConfigPayload,
  BackupSettingsPayload,
  SyncConfigPayload,
  UpdateEventPayload,
  UpdateSettingsPayload
} from '../shared/ipc'

/** 向主窗口推送 IPC 事件（窗口未就绪/已销毁时静默跳过）。 */
export function broadcast(channel: string, payload: unknown, target?: BrowserWindow): void {
  const win = target ?? getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

/** 向主窗口推送 UI 事件（全局快捷键触发）。 */
export function broadcastUiEvent(type: UiEventType, target?: BrowserWindow): void {
  broadcast(IPC.UiEvent, type, target)
}

function broadcastInstallEvent(event: InstallEvent): void {
  broadcast(IPC.InstallEvent, event)
}

function broadcastMigrateEvent(event: MigrateEvent): void {
  broadcast(IPC.MigrateEvent, event)
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.AppGetInfo, () => {
    const config = readAppConfig()
    return {
      appName: 'DSH 桌面',
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      workspacePath: getWorkspaceDir(),
      isPackaged: !process.env['ELECTRON_RENDERER_URL'],
      config
    }
  })

  ipcMain.handle(IPC.ConfigGet, () => readAppConfig())

  ipcMain.handle(IPC.ConfigSet, (_event, patch: Partial<AppConfig>) => {
    try {
      const next = updateAppConfig(patch ?? {})
      return { ok: true, config: next }
    } catch (error) {
      logger.error(`配置保存失败：${String(error)}`)
      return { ok: false, error: `配置保存失败：${String(error)}` }
    }
  })

  ipcMain.handle(IPC.WorkspaceOpen, async () => {
    const workspaceDir = getWorkspaceDir()
    const errorMessage = await shell.openPath(workspaceDir)
    return { ok: errorMessage.length === 0, error: errorMessage || undefined }
  })

  ipcMain.handle(IPC.OpenPath, async (_event, p: string) => {
    try {
      const target = String(p ?? '')
      if (!target) return { ok: false, error: '路径为空' }
      const error = await shell.openPath(target)
      return { ok: !error, error: error || undefined }
    } catch (error) {
      return { ok: false, error: `打开路径失败：${String(error)}` }
    }
  })

  ipcMain.handle(IPC.OpenExternal, async (_event, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: '仅允许打开 http/https 链接' }
      }
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `打开外部链接失败：${String(error)}` }
    }
  })

  ipcMain.handle(IPC.LogReport, (_event, level: LogLevel, message: string) => {
    const safeLevel: LogLevel = level === 'debug' || level === 'info' || level === 'warn' || level === 'error' ? level : 'info'
    logger.log(safeLevel, `[渲染进程] ${String(message ?? '').slice(0, 2000)}`)
    return { ok: true }
  })

  ipcMain.handle(IPC.EnvDetect, () => detectEnv(getWorkspaceDir()))

  ipcMain.handle(IPC.InstallRun, async (_event, key: InstallKey, mode: InstallMode) => {
    if (!INSTALL_KEYS.includes(key)) return { ok: false, error: '非法的安装项' }
    if (mode !== 'install' && mode !== 'update') return { ok: false, error: '非法的安装模式' }
    const result = await runInstall(getWorkspaceDir(), key, mode, {
      log: (message) => broadcastInstallEvent({ key, phase: 'log', message }),
      progress: (percent) => broadcastInstallEvent({ key, phase: 'progress', percent })
    })
    broadcastInstallEvent({
      key,
      phase: result.cancelled ? 'cancelled' : result.ok ? 'done' : 'error',
      error: result.error,
      message: result.cancelled ? '任务已取消' : result.ok ? '任务完成' : result.error
    })
    return result
  })

  ipcMain.handle(IPC.InstallCancel, () => {
    cancelInstall()
    return { ok: true }
  })

  ipcMain.handle(IPC.ClipboardWrite, (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return { ok: true }
  })

  ipcMain.handle(IPC.WorkspaceGetInfo, () => {
    return {
      workspacePath: getWorkspaceDir(),
      dataDir: checkDshDataDir(getWorkspaceDir())
    }
  })

  ipcMain.handle(IPC.WorkspaceChoose, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择工作文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    return { ok: true, path: result.filePaths[0] }
  })

  ipcMain.handle(IPC.WorkspaceSet, (_event, newPath: string) => {
    const validation = validateWorkspacePath(newPath, [getWorkspaceDir()])
    if (!validation.ok) return { ok: false, error: validation.error }
    const resolved = validation.resolved
    try {
      // 当前应用配置（onboarded/theme/sidebarCollapsed/service/backup 等）合并进新目录，
      // 保证重启后初始化状态与设置不丢失（修复：改目录后反复进向导、环境检测缺失）
      const currentConfig = readAppConfig()
      const nextConfig = { ...currentConfig, workspacePath: resolved }
      const newCfgPath = path.join(resolved, 'config', 'app.json')
      writeJsonAtomic(newCfgPath, nextConfig)
      // 同步写入默认位置的指针（确保下次启动能解析到新工作文件夹）
      const defaultWs = path.join(getRootDir(), 'workspace')
      const defaultCfgPath = path.join(defaultWs, 'config', 'app.json')
      const defaultCfg = (readJsonFile(defaultCfgPath) ?? {}) as Record<string, unknown>
      writeJsonAtomic(defaultCfgPath, { ...defaultCfg, ...nextConfig })
      logger.info(`工作文件夹已更改：${resolved}（重启后生效；运行环境不随目录迁移，如需使用需在新目录重新安装环境）`)
      return { ok: true, restartRequired: true }
    } catch (error) {
      logger.error(`工作文件夹更改失败：${String(error)}`)
      return { ok: false, error: `保存失败：${String(error)}` }
    }
  })

  ipcMain.handle(IPC.MigrateScan, () => {
    const workspaceDir = getWorkspaceDir()
    writeHomePatch(workspaceDir) // 确保 workspace/skills 已接入 dsh 技能根
    return scanAllDshHomes(workspaceDir)
  })

  ipcMain.handle(IPC.MigratePlan, (_event, sourceHome: string, selection: DshDataItemKey[]) => {
    const validKeys: DshDataItemKey[] = ['sessions', 'skills', 'settings', 'credentials', 'profiles', 'storages', 'patch']
    const filtered = (Array.isArray(selection) ? selection : []).filter((k): k is DshDataItemKey => validKeys.includes(k))
    const { entries, conflicts } = buildMigrationPlan(String(sourceHome), getWorkspaceDir(), filtered)
    return { entryCount: entries.length, conflicts }
  })

  ipcMain.handle(
    IPC.MigrateRun,
    async (
      _event,
      sourceHome: string,
      selection: DshDataItemKey[],
      conflictPolicy: MigrateConflictPolicy
    ) => {
      const workspaceDir = getWorkspaceDir()
      const validKeys: DshDataItemKey[] = ['sessions', 'skills', 'settings', 'credentials', 'profiles', 'storages', 'patch']
      const filtered = (Array.isArray(selection) ? selection : []).filter((k): k is DshDataItemKey => validKeys.includes(k))
      if (typeof conflictPolicy !== 'string' || !['overwrite', 'skip', 'rename'].includes(conflictPolicy)) {
        return { ok: false, error: '非法的冲突策略' }
      }
      const result = await runMigration(workspaceDir, String(sourceHome), filtered, conflictPolicy, {
        log: (message) => broadcastMigrateEvent({ phase: 'log', message }),
        progress: (done, total) => broadcastMigrateEvent({ phase: 'progress', done, total }),
        isCancelled: () => isMigrationCancelled()
      })
      broadcastMigrateEvent({
        phase: result.cancelled ? 'cancelled' : result.ok ? 'done' : 'error',
        error: result.error,
        message: result.cancelled ? '迁移已取消' : result.ok ? '迁移完成' : result.error
      })
      return result
    }
  )

  ipcMain.handle(IPC.MigrateCancel, () => {
    cancelMigration()
    return { ok: true }
  })

  ipcMain.handle(IPC.AppRelaunch, async () => {
    // 优雅重启：先显式停止 dsh 服务（含进程树清理），再 relaunch + quit。
    // 不能用 app.exit(0) 直接退出——会跳过 before-quit，导致 dsh 服务残留占端口。
    try {
      await stopDshService()
    } catch {
      /* 忽略：before-quit 还会兜底 */
    }
    app.relaunch()
    app.quit()
    return { ok: true }
  })

  // ---------- M4：服务生命周期 ----------
  ipcMain.handle(IPC.ServiceStart, async () => {
    const result = await startDshService()
    return { ok: result.ok, port: result.port, error: result.error }
  })

  ipcMain.handle(IPC.ServiceStop, async () => {
    const result = await stopDshService()
    return result
  })

  ipcMain.handle(IPC.ServiceStatus, () => getServiceSnapshot())

  // 手动清理残留 dsh 进程（服务启动报「旧进程残留 / 端口被占用」时使用）
  ipcMain.handle(IPC.ServiceCleanup, async () => {
    const cleaned = await cleanupStaleDsh()
    return { ok: true, cleaned }
  })

  onServiceStatusChange((snapshot) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.ServiceEvent, snapshot)
    }
  })

  // ---------- M4：会话列表 ----------
  ipcMain.handle(IPC.SessionsList, () => listSessions(getWorkspaceDir()))

  ipcMain.handle(IPC.SessionsPin, (_event, id: string, pinned: boolean) => {
    pinSession(getWorkspaceDir(), String(id ?? ''), pinned === true)
    return { ok: true }
  })

  ipcMain.handle(IPC.SessionsDelete, (_event, id: string) => deleteSession(getWorkspaceDir(), String(id ?? '')))

  ipcMain.handle(IPC.SessionsImport, async (_event, mode: string, targetWorkspacePath?: string) => {
    // Windows 原生对话框不能同时友好地选「文件夹 + 文件」：按模式分开打开，均可多选
    const isFileMode = mode === 'file'
    const result = await dialog.showOpenDialog({
      title: isFileMode ? '选择要导入的会话文件（可多选）' : '选择要导入的会话文件夹（可多选）',
      properties: isFileMode
        ? ['openFile', 'multiSelections']
        : ['openDirectory', 'multiSelections'],
      filters: isFileMode
        ? [
            { name: '会话与压缩包', extensions: ['jsonl', 'zstd', 'json', 'zip', 'tar', 'tgz', 'gz'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        : undefined
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true, count: 0 }
    const wsPath = typeof targetWorkspacePath === 'string' && targetWorkspacePath.trim() ? targetWorkspacePath.trim() : undefined
    // 压缩包自动解压后导入
    const expanded = await expandImportArchives(getWorkspaceDir(), result.filePaths)
    try {
      const imported = await importSessionsFrom(getWorkspaceDir(), expanded.paths, wsPath, expanded.archiveRoots)
      return { ok: imported.ok, count: imported.count, skipped: imported.skipped, error: imported.error }
    } finally {
      expanded.cleanup()
    }
  })

  // ---------- M5：模型与 API（Tab4） ----------
  ipcMain.handle(IPC.ApiGet, () => readApiConfig())

  ipcMain.handle(IPC.ApiSet, (_event, patch: ApiConfigPayload) => {
    const prev = readApiConfig()
    const safe: ApiConfigPayload = {}
    if (typeof patch?.apiKey === 'string') safe.apiKey = patch.apiKey
    if (typeof patch?.baseUrl === 'string') safe.baseUrl = patch.baseUrl
    // 模型名放开为任意合法字符串（全域模型中心可配置任意模型），仅限长度防注入
    if (typeof patch?.model === 'string' && patch.model.trim() && patch.model.length <= 100) {
      safe.model = patch.model.trim()
    }
    if (patch?.proxy && typeof patch.proxy === 'object') safe.proxy = patch.proxy
    if (patch?.providers && typeof patch.providers === 'object' && !Array.isArray(patch.providers)) {
      const providers: Record<string, ProviderConfigPayload> = {}
      for (const [route, p] of Object.entries(patch.providers)) {
        const src = p && typeof p === 'object' ? p : {}
        const clean: ProviderConfigPayload = {
          displayName: typeof src.displayName === 'string' ? src.displayName : undefined,
          api:
            src.api === 'openai-completions' || src.api === 'openai-responses' || src.api === 'anthropic-messages'
              ? src.api
              : undefined,
          baseUrl: typeof src.baseUrl === 'string' ? src.baseUrl : undefined,
          apiKey: typeof src.apiKey === 'string' ? src.apiKey : undefined,
          models: Array.isArray(src.models) ? src.models.map((m) => String(m)) : undefined
        }
        const routeName = String(route).trim()
        if (!routeName) continue
        const invalid = validateProvider(routeName, clean)
        if (invalid) return { ok: false, error: `提供方「${routeName}」：${invalid}` }
        providers[routeName] = clean
      }
      safe.providers = providers
    }
    const next = writeApiConfig(safe)
    const sync = syncApiToDsh(prev, next)
    return { ok: true, config: next, synced: sync.ok, syncError: sync.error }
  })

  ipcMain.handle(IPC.ApiTest, async () => {
    const result = await testApiConnection(readApiConfig())
    return result
  })

  ipcMain.handle(IPC.ApiDiscoverModels, async (_event, payload: { baseUrl?: string; apiKey?: string }) => {
    return discoverModels(String(payload?.baseUrl ?? ''), payload?.apiKey)
  })

  // ---------- 插件：功能插件 + 在线市场 ----------
  ipcMain.handle(IPC.PluginsGet, () => {
    return { curated: getPluginStates(getWorkspaceDir()), installed: listInstalledPlugins(getWorkspaceDir()) }
  })

  ipcMain.handle(IPC.PluginSetEnabled, (_event, pkgName: string, enabled: boolean) => {
    const name = String(pkgName ?? '')
    if (!name) return { ok: false, error: '缺少插件名' }
    return setPluginEnabled(getWorkspaceDir(), name, enabled === true)
  })

  ipcMain.handle(IPC.PluginSearch, async (_event, query: string) => {
    return searchNpmPlugins(String(query ?? ''))
  })

  ipcMain.handle(IPC.PluginInstall, async (_event, pkgSpec: string) => {
    const spec = String(pkgSpec ?? '').trim()
    if (!spec) return { ok: false, error: '缺少包名' }
    if (!isValidPkgSpec(spec)) return { ok: false, error: '包名格式非法' }
    const lines: string[] = []
    const result = await installPlugin(getWorkspaceDir(), spec, {
      log: (chunk) => {
        const t = chunk.trim()
        if (t && lines.length < 80) lines.push(t)
      }
    })
    return { ok: result.ok, error: result.error, bundle: result.bundle, log: lines.join('\n') }
  })

  ipcMain.handle(IPC.PluginUninstall, async (_event, pkgName: string) => {
    const name = String(pkgName ?? '').trim()
    if (!name) return { ok: false, error: '缺少包名' }
    if (!isValidPkgSpec(name)) return { ok: false, error: '包名格式非法' }
    const lines: string[] = []
    const result = await uninstallPlugin(getWorkspaceDir(), name, {
      log: (chunk) => {
        const t = chunk.trim()
        if (t && lines.length < 80) lines.push(t)
      }
    })
    return { ok: result.ok, error: result.error, log: lines.join('\n') }
  })

  // ---------- 推荐技能市场 ----------
  ipcMain.handle(IPC.SkillsList, () => {
    return { items: skillMarketItems(getWorkspaceDir()), installed: listInstalledSkills(getWorkspaceDir()) }
  })

  // 联网搜索技能（npmmirror，按名字 / 功能词）
  ipcMain.handle(IPC.SkillsSearch, async (_event, query: string) => {
    return searchNpmSkills(String(query ?? ''))
  })

  ipcMain.handle(IPC.SkillInstall, async (_event, skillId: string) => {
    const id = String(skillId ?? '').trim()
    const skill = CURATED_SKILLS.find((s) => s.id === id)
    if (!skill) return { ok: false, error: `未知技能：${id}` }
    const lines: string[] = []
    const result = await installSkill(getWorkspaceDir(), skill, (msg) => {
      const t = msg.trim()
      if (t && lines.length < 80) lines.push(t)
    })
    return { ok: result.ok, error: result.error, installed: result.installed, log: lines.join('\n') }
  })

  // 按 npm 包名安装技能（搜索结果中的技能包）
  ipcMain.handle(IPC.SkillInstallNpm, async (_event, pkg: string) => {
    const name = String(pkg ?? '').trim()
    if (!name) return { ok: false, error: '包名不能为空' }
    const lines: string[] = []
    const result = await installSkillFromNpmPackage(getWorkspaceDir(), name, (msg) => {
      const t = msg.trim()
      if (t && lines.length < 80) lines.push(t)
    })
    return { ok: result.ok, error: result.error, installed: result.installed, log: lines.join('\n') }
  })

  // ---------- 通用设置（同步 dsh：locale / ui-theme / agent-presets） ----------
  ipcMain.handle(IPC.DshUiGet, () => readUiSettings(getWorkspaceDir()))

  ipcMain.handle(IPC.DshUiSet, (_event, patch: DshUiSettingsPayload) => {
    const safe: DshUiSettingsPayload = {}
    if (patch?.locale === 'zh' || patch?.locale === 'en') safe.locale = patch.locale
    if (patch?.theme === 'light' || patch?.theme === 'dark' || patch?.theme === 'system') safe.theme = patch.theme
    if (typeof patch?.defaultAgentPreset === 'string') safe.defaultAgentPreset = patch.defaultAgentPreset
    if (typeof patch?.showDshSidebar === 'boolean') safe.showDshSidebar = patch.showDshSidebar
    return writeUiSettings(getWorkspaceDir(), safe)
  })

  ipcMain.handle(IPC.OpenSettingsFile, async () => {
    const p = path.join(getWorkspaceDir(), 'data', 'settings.yaml')
    try {
      if (!fs.existsSync(p)) fs.writeFileSync(p, '{}', 'utf8')
      const error = await shell.openPath(p)
      return { ok: !error, error: error || undefined }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ---------- 工作区树（侧边栏：工作文件夹 + 会话列表） ----------
  ipcMain.handle(IPC.WorkspacesGet, () => readWorkspaces(getWorkspaceDir()))

  ipcMain.handle(IPC.WorkspaceRename, async (_event, id: string, title: string) => {
    const result = await renameWorkspace(getWorkspaceDir(), String(id ?? ''), String(title ?? ''))
    if (result.ok) broadcastUiEvent('sidebar-data-changed')
    return result
  })

  ipcMain.handle(IPC.WorkspaceDelete, async (_event, id: string) => {
    return deleteWorkspace(getWorkspaceDir(), String(id ?? ''))
  })

  // ---------- 侧边栏会话视图：分组 / 归档 / 收藏 / 会话操作 ----------
  ipcMain.handle(IPC.SidebarDataGet, () => readSidebarData(getWorkspaceDir()))

  ipcMain.handle(IPC.SessionGroupCreate, (_event, name: string, workspaceId: string) => {
    return createSessionGroup(getWorkspaceDir(), String(name ?? ''), String(workspaceId ?? ''))
  })
  ipcMain.handle(IPC.SessionGroupRename, async (_event, id: string, name: string) => {
    const result = renameSessionGroup(getWorkspaceDir(), String(id ?? ''), String(name ?? ''))
    if (result.ok) broadcastUiEvent('sidebar-data-changed')
    return result
  })
  ipcMain.handle(IPC.SessionGroupPin, (_event, id: string) => {
    return pinSessionGroup(getWorkspaceDir(), String(id ?? ''))
  })
  ipcMain.handle(IPC.SessionGroupDelete, (_event, id: string, deleteContents?: boolean) => {
    return deleteSessionGroup(getWorkspaceDir(), String(id ?? ''), deleteContents === true)
  })
  ipcMain.handle(IPC.SessionMoveToGroup, (_event, sessionId: string, groupId: string | null) => {
    return moveSessionToGroup(getWorkspaceDir(), String(sessionId ?? ''), groupId === null ? null : String(groupId))
  })
  ipcMain.handle(IPC.SessionSetFavorite, (_event, sessionId: string, favorite: boolean) => {
    return setSessionFavorite(getWorkspaceDir(), String(sessionId ?? ''), favorite === true)
  })
  ipcMain.handle(IPC.SessionRename, async (_event, sessionId: string, title: string) => {
    const result = await renameSessionRpc(getWorkspaceDir(), String(sessionId ?? ''), String(title ?? ''))
    if (result.ok) broadcastUiEvent('sidebar-data-changed')
    return result
  })
  ipcMain.handle(IPC.SessionFork, (_event, sessionId: string) => {
    return forkSessionRpc(getWorkspaceDir(), String(sessionId ?? ''))
  })
  ipcMain.handle(IPC.SessionArchive, async (_event, sessionId: string, title: string, time: number) => {
    return archiveSession(getWorkspaceDir(), String(sessionId ?? ''), String(title ?? ''), Number(time) || Date.now())
  })
  ipcMain.handle(IPC.SessionDeleteArchived, (_event, sessionId: string) => {
    return deleteArchivedSession(getWorkspaceDir(), String(sessionId ?? ''))
  })
  ipcMain.handle(IPC.SessionDeleteArchivedBatch, (_event, sessionIds: string[]) => {
    return deleteArchivedSessions(getWorkspaceDir(), Array.isArray(sessionIds) ? sessionIds.map(String) : [])
  })
  ipcMain.handle(IPC.SessionDeleteBatch, (_event, sessionIds: string[]) => {
    return deleteLiveSessions(getWorkspaceDir(), Array.isArray(sessionIds) ? sessionIds.map(String) : [])
  })
  ipcMain.handle(IPC.SessionUnarchive, (_event, sessionId: string) => {
    return unarchiveSession(getWorkspaceDir(), String(sessionId ?? ''))
  })

  // 导出会话：调用 dsh 官方 /api/session.export（含子代理与附件）下载 ZIP，保存到用户选择的位置
  ipcMain.handle(IPC.SessionExport, async (_event, sessionId: string, title: string) => {
    try {
      const id = String(sessionId ?? '')
      if (!id) return { ok: false, error: '会话不存在' }
      const cfg = readAppConfig()
      const port = (cfg.service as { lastPort?: unknown } | undefined)?.lastPort
      const p = typeof port === 'number' && port > 0 ? port : 3080
      const url = `http://127.0.0.1:${p}/api/session.export?sessionId=${encodeURIComponent(id)}&includeDescendants=true`
      const res = await fetch(url, { headers: { accept: 'application/zip' }, signal: AbortSignal.timeout(300000) })
      if (!res.ok) return { ok: false, error: `导出失败：HTTP ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) return { ok: false, error: '导出失败：会话内容为空' }
      // 保存对话框（默认名：dsh-session-<短id>.zip）
      const safe = title ? String(title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) : id.slice(0, 12)
      const save = await dialog.showSaveDialog({
        title: '导出会话',
        defaultPath: `dsh-session-${safe}.zip`,
        filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }]
      })
      if (save.canceled || !save.filePath) return { ok: false, canceled: true }
      fs.writeFileSync(save.filePath, buf)
      logger.info(`会话 ${id} 已导出到 ${save.filePath}（${Math.round(buf.length / 1024)} KB）`)
      return { ok: true, path: save.filePath, sizeBytes: buf.length }
    } catch (error) {
      return { ok: false, error: `导出失败：${error instanceof Error ? error.message : String(error)}` }
    }
  })

  // ---------- M5：备份与恢复（Tab5） ----------
  ipcMain.handle(IPC.BackupCreate, async () => {
    const result = await createBackup(getWorkspaceDir())
    return result
  })

  ipcMain.handle(IPC.BackupList, () => listBackups(getWorkspaceDir()))

  ipcMain.handle(IPC.BackupRestore, async (_event, zipPath: string) => {
    // 恢复会覆盖 data/（会话/设置/凭据），必须先停止 dsh 服务避免文件占用与内存状态冲突
    const wasRunning = (await getServiceSnapshot()).status === 'running'
    if (wasRunning) {
      await stopDshService()
    }
    const result = await restoreBackup(getWorkspaceDir(), String(zipPath ?? ''))
    if (result.ok) {
      logger.info('备份恢复完成；dsh 服务已停止，需重启应用/服务后生效')
    }
    return result
  })

  ipcMain.handle(IPC.BackupDelete, (_event, name: string) => deleteBackup(getWorkspaceDir(), String(name ?? '')))

  ipcMain.handle(IPC.BackupExport, async (_event, destDir: string, includeRuntime: boolean) => {
    const result = await exportWorkspace(getWorkspaceDir(), String(destDir ?? ''), includeRuntime === true)
    return result
  })

  // 备份设置（走 config 白名单 backup 键）
  ipcMain.handle(IPC.BackupSettingsGet, () => readBackupSettings(getWorkspaceDir()))

  ipcMain.handle(IPC.BackupSettingsSet, (_event, patch: BackupSettingsPayload) => {
    const safe: BackupSettingsPayload = {}
    if (typeof patch?.enabled === 'boolean') safe.enabled = patch.enabled
    if (patch?.period === 'daily' || patch?.period === 'weekly') safe.period = patch.period
    if (typeof patch?.keep === 'number' && patch.keep >= 1 && patch.keep <= 50) safe.keep = Math.floor(patch.keep)
    const next = writeBackupSettings(getWorkspaceDir(), safe)
    return { ok: true, settings: next }
  })

  // ---------- M5：日志（Tab6） ----------
  ipcMain.handle(IPC.LogsRead, () => {
    const ws = getWorkspaceDir()
    return { app: readAppLog(ws), dsh: readDshLog(ws) }
  })

  ipcMain.handle(IPC.LogsClear, () => clearLogs(getWorkspaceDir()))

  ipcMain.handle(IPC.LogsExport, async () => {
    const result = await dialog.showSaveDialog({
      title: '导出日志',
      defaultPath: `dsh-workbench-logs-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const exported = await exportLogsZip(getWorkspaceDir(), result.filePath)
    return exported
  })

  // ---------- M5：关于 ----------
  // 更新事件广播（updater 模块注入）
  setUpdateEventBroadcast((event: UpdateEventPayload) => {
    broadcast(IPC.UpdateEvent, event)
  })

  ipcMain.handle(IPC.AppCheckUpdate, async (_event, force = false) => {
    return checkForUpdate({ force: force === true })
  })

  ipcMain.handle(IPC.AppUpdateSettingsGet, () => readUpdateSettings())

  ipcMain.handle(IPC.AppUpdateSettingsSet, (_event, patch: Partial<UpdateSettingsPayload>) => {
    const safe: Partial<UpdateSettingsPayload> = {}
    if (patch?.mode === 'auto' || patch?.mode === 'manual') safe.mode = patch.mode
    const next = writeUpdateSettings(safe)
    return { ok: true, settings: next }
  })

  ipcMain.handle(IPC.AppUpdateDownload, async (_event, assetId: number) => {
    if (!Number.isInteger(assetId) || assetId <= 0) return { ok: false, error: '更新包参数无效' }
    return downloadUpdate(assetId)
  })

  ipcMain.handle(IPC.AppUpdateCancel, () => cancelUpdateDownload())

  ipcMain.handle(IPC.AppUpdateApply, async (_event, zipPath: string) => {
    const result = applyUpdate(String(zipPath ?? ''))
    if (result.ok) {
      // 停止服务并退出，交由 update.bat 完成替换与重启
      await stopDshService()
      const win = getMainWindow()
      if (win) win.destroy()
      app.exit(0)
    }
    return result
  })

  ipcMain.handle(IPC.AppSetLoginItem, (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled === true, args: ['--background'] })
    return { ok: true, enabled: app.getLoginItemSettings().openAtLogin }
  })

  ipcMain.handle(IPC.DialogChooseDirectory, async (_event, title: string) => {
    const result = await dialog.showOpenDialog({
      title: String(title ?? '选择目录'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    return { ok: true, path: result.filePaths[0] }
  })

  ipcMain.handle(IPC.DialogChooseFile, async (_event, title: string, filters?: { name?: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog({
      title: String(title ?? '选择文件'),
      properties: ['openFile'],
      filters: Array.isArray(filters) && filters.length > 0 ? (filters as Electron.FileFilter[]) : undefined
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    return { ok: true, path: result.filePaths[0] }
  })

  // ---------- 初始化（出厂重置） ----------
  ipcMain.handle(IPC.AppReset, async (_event, keepRuntime: boolean) => {
    const result = await resetApp(keepRuntime !== false)
    return result
  })

  // ---------- 异地同步（会话） ----------
  ipcMain.handle(IPC.SyncGet, () => {
    const config = readSyncConfig()
    const counts = syncSessionCount(getWorkspaceDir())
    return { config, counts }
  })

  ipcMain.handle(IPC.SyncSet, (_event, patch: SyncConfigPayload) => {
    const safe: SyncConfigPayload = {}
    if (typeof patch?.remoteUrl === 'string') {
      if (!isValidRemoteUrl(patch.remoteUrl)) {
        return { ok: false, config: readSyncConfig(), error: '远端地址需为 http(s)://、ssh:// 或 git:// 开头的合法 URL' }
      }
      safe.remoteUrl = patch.remoteUrl.trim()
    }
    if (typeof patch?.branch === 'string' && /^[\w.-]+$/.test(patch.branch)) safe.branch = patch.branch
    const next = writeSyncConfig(safe)
    return { ok: true, config: next }
  })

  ipcMain.handle(IPC.SyncPush, async () => syncPush())
  ipcMain.handle(IPC.SyncPull, async () => syncPull())
  ipcMain.handle(IPC.SyncForceRemote, async () => syncForceRemote())
  ipcMain.handle(IPC.SyncForceLocal, async () => syncForceLocal())

  // ---------- 智能同步（Git 时间戳比对） ----------
  ipcMain.handle(IPC.SyncPreview, (_event, mode?: SyncMode, toleranceMs?: number) =>
    buildPreview(getWorkspaceDir(), mode, toleranceMs)
  )
  ipcMain.handle(IPC.SyncRun, (_event, input: SyncRunInput) => {
    const safe = input ?? ({} as SyncRunInput)
    const mode = safe.mode ?? readSyncSettings(getWorkspaceDir()).mode ?? 'smart'
    const selection = Array.isArray(safe.selection) ? safe.selection.filter((s): s is string => typeof s === 'string') : []
    return safe.direction === 'pull' ? smartPull(getWorkspaceDir(), selection, mode) : smartPush(getWorkspaceDir(), selection, mode)
  })
  ipcMain.handle(IPC.SyncSettingsGet, () => readSyncSettings(getWorkspaceDir()))
  ipcMain.handle(IPC.SyncSettingsSet, (_event, patch: SyncSettingsPayload) => {
    const safe: SyncSettingsPayload = {
      mode: patch?.mode === 'force' || patch?.mode === 'add-only' ? patch.mode : 'smart',
      toleranceMs: typeof patch?.toleranceMs === 'number' && patch.toleranceMs > 0 ? Math.round(patch.toleranceMs) : undefined,
      exclude: Array.isArray(patch?.exclude) ? patch.exclude : undefined,
      autoSyncMinutes: typeof patch?.autoSyncMinutes === 'number' ? Math.max(0, Math.round(patch.autoSyncMinutes)) : undefined
    }
    const next = writeSyncSettings(safe, getWorkspaceDir())
    scheduleAutoSync(() => broadcastUiEvent('sync-completed'), getWorkspaceDir())
    return { ok: true, settings: next }
  })
  ipcMain.handle(IPC.SyncResolveConflict, (_event, rel: string, choice: 'local' | 'remote') =>
    resolveConflictFile(String(rel ?? ''), choice === 'remote' ? 'remote' : 'local')
  )

  // ---------- 工作文件夹原子迁移（需求二） ----------
  ipcMain.handle(IPC.WorkspaceRelocate, async (_event, newPath: string) => {
    return relocateWorkspace(String(newPath ?? ''), (payload: RelocateEventPayload) => broadcast(IPC.WorkspaceRelocateEvent, payload))
  })

  // ===== v2.0：窗口控制（无边框标题栏） =====
  ipcMain.handle(IPC.WindowMinimize, () => minimizeMainWindow())
  ipcMain.handle(IPC.WindowMaximize, () => toggleMaximizeMainWindow())
  ipcMain.handle(IPC.WindowClose, () => closeMainWindow())
  ipcMain.handle(IPC.WindowIsMaximized, () => isMainWindowMaximized())

  // ===== v2.0：知识库 =====
  ipcMain.handle(IPC.KnowledgeGet, () => getKnowledge(getWorkspaceDir()))
  ipcMain.handle(IPC.KnowledgeCategoryCreate, (_event, name: string) => {
    try {
      return { ok: true, category: createKnowledgeCategory(getWorkspaceDir(), String(name ?? '')) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.KnowledgeCategoryRename, (_event, id: string, name: string) => {
    try {
      return { ok: renameKnowledgeCategory(getWorkspaceDir(), String(id), String(name ?? '')) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.KnowledgeCategoryDelete, (_event, id: string) => {
    try {
      return { ok: deleteKnowledgeCategory(getWorkspaceDir(), String(id)) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.KnowledgeEntryCreate, (_event, categoryId: string, input: { title?: string; content?: string; tags?: string[] }) => {
    try {
      return { ok: true, entry: createKnowledgeEntry(getWorkspaceDir(), String(categoryId), {
        title: String(input?.title ?? ''),
        content: String(input?.content ?? ''),
        tags: Array.isArray(input?.tags) ? input.tags.map(String) : []
      }) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.KnowledgeEntryUpdate, (_event, id: string, patch: { title?: string; content?: string; tags?: string[] }) => {
    try {
      return { ok: updateKnowledgeEntry(getWorkspaceDir(), String(id), {
        title: patch?.title !== undefined ? String(patch.title) : undefined,
        content: patch?.content !== undefined ? String(patch.content) : undefined,
        tags: Array.isArray(patch?.tags) ? patch.tags.map(String) : undefined
      }) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.KnowledgeEntryDelete, (_event, id: string) => {
    try {
      return { ok: deleteKnowledgeEntry(getWorkspaceDir(), String(id)) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.KnowledgeSearch, (_event, query: KnowledgeSearchQuery) =>
    searchKnowledge(getWorkspaceDir(), query ?? {})
  )
  ipcMain.handle(IPC.KnowledgeExtract, (_event, input: KnowledgeExtractInput) =>
    extractKnowledgeToStore(getWorkspaceDir(), input ?? {})
  )
  ipcMain.handle(IPC.KnowledgeIterate, () => iterateKnowledge(getWorkspaceDir()))

  // 一键智能提炼流水线（进度经 IPC.KnowledgeExtractProgress 广播）
  ipcMain.handle(IPC.KnowledgeExtractPipeline, (_event, input: KnowledgePipelineInput) =>
    runExtractionPipeline(getWorkspaceDir(), input ?? {}, (progress) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.KnowledgeExtractProgress, progress)
    })
  )
  ipcMain.handle(IPC.SessionGetRecentText, (_event, maxChars?: number) =>
    readRecentSessionText(getWorkspaceDir(), typeof maxChars === 'number' ? maxChars : 8000)
  )

  // ===== v2.0：全局行为规则 =====
  ipcMain.handle(IPC.RulesGet, () => {
    const content = ensureGlobalRules(getWorkspaceDir())
    return { ok: true, path: getRulesFilePath(getWorkspaceDir()), content }
  })
  ipcMain.handle(IPC.RulesSave, (_event, content: string) =>
    saveGlobalRules(getWorkspaceDir(), String(content ?? ''))
  )

  // ===== v2.0：全域模型对接中心 =====
  ipcMain.handle(IPC.ModelsGet, () => {
    const view = getAllProviders(getWorkspaceDir())
    const keyMasks: Record<string, string> = {}
    for (const p of view.presets) {
      const key = readApiKeySecure(getWorkspaceDir(), p.id)
      if (key) keyMasks[p.id] = maskKey(key)
    }
    for (const c of view.custom) {
      const key = readApiKeySecure(getWorkspaceDir(), c.id)
      if (key) keyMasks[c.id] = maskKey(key)
    }
    return { ...view, keyMasks }
  })
  ipcMain.handle(IPC.ModelsProviderSet, (_event, input: ModelsProviderSetInput) => {
    try {
      updateProviderConfig(getWorkspaceDir(), String(input?.providerId ?? ''), input?.patch ?? {})
      syncModelsConfigToDsh(getWorkspaceDir())
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.ModelsCustomUpsert, (_event, input: ModelsCustomUpsertInput) => {
    try {
      updateCustomProvider(getWorkspaceDir(), input)
      syncModelsConfigToDsh(getWorkspaceDir())
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.ModelsCustomDelete, (_event, id: string) => {
    try {
      deleteCustomProvider(getWorkspaceDir(), String(id))
      deleteApiKeySecure(getWorkspaceDir(), String(id))
      syncModelsConfigToDsh(getWorkspaceDir())
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.ModelsKeySave, (_event, providerId: string, key: string) => {
    const id = String(providerId ?? '')
    if (!id) return { ok: false, error: '缺少厂商 id' }
    saveApiKeySecure(getWorkspaceDir(), id, String(key ?? ''))
    syncModelsConfigToDsh(getWorkspaceDir())
    syncKeysToCredentials(getWorkspaceDir())
    const plain = readApiKeySecure(getWorkspaceDir(), id)
    return { ok: true, mask: plain ? maskKey(plain) : '' }
  })
  ipcMain.handle(IPC.ModelsKeyDelete, (_event, providerId: string) => {
    deleteApiKeySecure(getWorkspaceDir(), String(providerId ?? ''))
    syncModelsConfigToDsh(getWorkspaceDir())
    syncKeysToCredentials(getWorkspaceDir())
    return { ok: true }
  })
  ipcMain.handle(IPC.ModelsTest, async (_event, input: ModelsTestInput) => {
    const id = String(input?.providerId ?? '')
    const key = id ? readApiKeySecure(getWorkspaceDir(), id) : undefined
    return testAdapterConnection(input?.protocol ?? 'openai', String(input?.baseUrl ?? ''), key, input?.model)
  })
  ipcMain.handle(IPC.ModelsList, async (_event, input: ModelsTestInput) => {
    const id = String(input?.providerId ?? '')
    const key = id ? readApiKeySecure(getWorkspaceDir(), id) : undefined
    return listModelsFor(input?.protocol ?? 'openai', String(input?.baseUrl ?? ''), key)
  })
  ipcMain.handle(IPC.ModelsMigrateLegacy, () => {
    try {
      const legacy = readApiConfig()
      migrateLegacyApiConfig(getWorkspaceDir(), legacy.apiKey, (id, k) => saveApiKeySecure(getWorkspaceDir(), id, k))
      syncModelsConfigToDsh(getWorkspaceDir())
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  // ===== v2.0：主题全局化 =====
  ipcMain.handle(IPC.ThemeList, () => listThemes(getWorkspaceDir()))
  ipcMain.handle(IPC.ThemeGet, () => getActiveTheme(getWorkspaceDir()))
  ipcMain.handle(IPC.ThemeSet, (_event, id: string) => {
    const theme = setActiveTheme(getWorkspaceDir(), String(id ?? 'default'))
    if (!theme) return { ok: false, error: '主题不存在' }
    // 托盘图标随主题切换（存在 tray-icon.png 时）
    refreshTrayTheme(theme.hasTrayIcon ? path.join(theme.dir ?? '', 'tray-icon.png') : undefined)
    // 广播给渲染层：全局应用新主题（CSS 变量 + theme.css 热切换）
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.ThemeEvent, theme)
    return { ok: true, theme }
  })

  // ---------- 会话背景图片（需求五） ----------
  ipcMain.handle(IPC.ImageReadDataUrl, async (_event, filePath: string) => {
    try {
      const resolved = String(filePath ?? '')
      if (!fs.existsSync(resolved)) return { ok: false, error: '文件不存在' }
      const ext = path.extname(resolved).replace('.', '').toLowerCase() || 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
      const buf = fs.readFileSync(resolved)
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (error) {
      return { ok: false, error: `读取图片失败：${error instanceof Error ? error.message : String(error)}` }
    }
  })

  ipcMain.handle(IPC.ImageSaveSessionBg, (_event, dataUrl: string, name: string) => {
    try {
      const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(String(dataUrl ?? ''))
      if (!match) return { ok: false, error: '图片数据格式无效' }
      const buf = Buffer.from(match[2], 'base64')
      const safeName = String(name ?? `session-bg-${Date.now()}`).replace(/[^\w.-]/g, '_')
      const dir = path.join(getWorkspaceDir(), 'data', 'session-bg')
      fs.mkdirSync(dir, { recursive: true })
      const target = path.join(dir, safeName)
      fs.writeFileSync(target, buf)
      return { ok: true, relPath: path.join('data', 'session-bg', safeName) }
    } catch (error) {
      return { ok: false, error: `保存图片失败：${error instanceof Error ? error.message : String(error)}` }
    }
  })

  // ===== v2.0：Agent 管理 =====
  ipcMain.handle(IPC.AgentsGet, () => listAgents(getWorkspaceDir()))
  ipcMain.handle(IPC.AgentImport, (_event, url: string) => importAgent(getWorkspaceDir(), String(url ?? '')))
  ipcMain.handle(IPC.AgentRename, (_event, id: string, name: string) => {
    try {
      return { ok: renameAgent(getWorkspaceDir(), String(id), String(name ?? '')) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.AgentDelete, (_event, id: string) => {
    try {
      return { ok: deleteAgent(getWorkspaceDir(), String(id)) }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })
  ipcMain.handle(IPC.AgentRun, (_event, id: string) => runAgent(getWorkspaceDir(), String(id ?? '')))
  ipcMain.handle(IPC.AgentsCollaborate, (_event, input: AgentCollaborateInput) =>
    collaborateAgents(getWorkspaceDir(), input ?? {})
  )
}
