/**
 * preload：仅暴露安全白名单 API（contextBridge）。
 * 渲染进程无法访问 Node 模块；所有能力经由 window.dshw 调用。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppConfig,
  AppInfo,
  DshDataItemKey,
  DshDataSource,
  EnvReport,
  InstallEvent,
  InstallKey,
  InstallMode,
  InstallResult,
  LogLevel,
  MigrateConflictPolicy,
  MigrateEvent,
  MigratePlan,
  MigrateResult,
  ServiceSnapshot,
  SessionEntry,
  ApiConfigPayload,
  ApiDiscoverResult,
  PluginsPayload,
  NpmPluginHitPayload,
  SkillMarketItem,
  InstalledSkillInfo,
  DshUiSettingsResult,
  DshUiSettingsPayload,
  WorkspacesPayload,
  SidebarDataPayload,
  SessionOpResult,
  BackupEntryPayload,
  BackupSettingsPayload,
  LogsPayload,
  UiEventType,
  WorkspaceInfo,
  WorkspaceSetResult,
  SyncConfigPayload,
  SyncResultPayload
} from '../shared/ipc'

const api = {
  /** 应用与运行时信息（含工作文件夹路径）。 */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.AppGetInfo),

  /** 读取工作文件夹配置。 */
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigGet),

  /** 更新配置（白名单键）。 */
  updateConfig: (patch: Partial<AppConfig>): Promise<{ ok: boolean; config?: AppConfig; error?: string }> =>
    ipcRenderer.invoke(IPC.ConfigSet, patch),

  /** 在资源管理器中打开工作文件夹。 */
  openWorkspaceFolder: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.WorkspaceOpen),

  /** 在系统浏览器打开 http/https 链接。 */
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.OpenExternal, url),

  /** 上报渲染进程日志/错误（全局错误边界）。 */
  reportLog: (level: LogLevel, message: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.LogReport, level, message),

  /** 环境检测（Node/npm/pnpm/Git/dsh）。 */
  detectEnv: (): Promise<EnvReport> => ipcRenderer.invoke(IPC.EnvDetect),

  /** 一键安装/更新（返回任务终态；过程中经 onInstallEvent 推送日志与进度）。 */
  runInstall: (key: InstallKey, mode: InstallMode): Promise<InstallResult> =>
    ipcRenderer.invoke(IPC.InstallRun, key, mode),

  /** 取消当前安装/更新任务。 */
  cancelInstall: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.InstallCancel),

  /** 订阅安装/更新事件流；返回取消订阅函数。 */
  onInstallEvent: (callback: (event: InstallEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: InstallEvent): void => callback(payload)
    ipcRenderer.on(IPC.InstallEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.InstallEvent, listener)
    }
  },

  /** 写入系统剪贴板（复制错误信息等）。 */
  writeClipboard: (text: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.ClipboardWrite, text),

  /** 工作文件夹信息（路径 + 数据目录自检状态，规格 4.4）。 */
  getWorkspaceInfo: (): Promise<WorkspaceInfo> => ipcRenderer.invoke(IPC.WorkspaceGetInfo),

  /** 打开目录选择框选择工作文件夹。 */
  chooseWorkspaceFolder: (): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.WorkspaceChoose),

  /** 更改工作文件夹（校验 + 保存；返回 restartRequired）。 */
  setWorkspacePath: (newPath: string): Promise<WorkspaceSetResult> => ipcRenderer.invoke(IPC.WorkspaceSet, newPath),

  /** 扫描本机存量 dsh 数据源（规格 6.8）。 */
  scanDshData: (): Promise<DshDataSource[]> => ipcRenderer.invoke(IPC.MigrateScan),

  /** 迁移预检：条目数与冲突清单（运行前展示）。 */
  planMigration: (
    sourceHome: string,
    selection: DshDataItemKey[]
  ): Promise<MigratePlan> => ipcRenderer.invoke(IPC.MigratePlan, sourceHome, selection),

  /** 执行迁移（复制而非移动；冲突策略；过程经 onMigrateEvent 推送）。 */
  runMigration: (
    sourceHome: string,
    selection: DshDataItemKey[],
    conflictPolicy: MigrateConflictPolicy
  ): Promise<MigrateResult> => ipcRenderer.invoke(IPC.MigrateRun, sourceHome, selection, conflictPolicy),

  /** 取消当前迁移（规格 8.4：耗时操作可取消）。 */
  cancelMigration: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.MigrateCancel),

  /** 订阅迁移事件流。 */
  onMigrateEvent: (callback: (event: MigrateEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MigrateEvent): void => callback(payload)
    ipcRenderer.on(IPC.MigrateEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.MigrateEvent, listener)
    }
  },

  /** 重启应用（工作文件夹更改后生效，规格 6.10）。 */
  relaunchApp: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.AppRelaunch),

  /** 启动 dsh 服务。 */
  startService: (): Promise<{ ok: boolean; port?: number; error?: string }> => ipcRenderer.invoke(IPC.ServiceStart),

  /** 停止 dsh 服务。 */
  stopService: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.ServiceStop),

  /** 当前服务快照（状态/端口/启动日志）。 */
  getServiceStatus: (): Promise<ServiceSnapshot> => ipcRenderer.invoke(IPC.ServiceStatus),

  /** 订阅服务状态变化。 */
  onServiceEvent: (callback: (snapshot: ServiceSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ServiceSnapshot): void => callback(payload)
    ipcRenderer.on(IPC.ServiceEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.ServiceEvent, listener)
    }
  },

  /** 会话列表（规格 5.2）。 */
  listSessions: (): Promise<SessionEntry[]> => ipcRenderer.invoke(IPC.SessionsList),

  /** 置顶/取消置顶会话。 */
  pinSession: (id: string, pinned: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SessionsPin, id, pinned),

  /** 删除会话。 */
  deleteSession: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.SessionsDelete, id),

  /** 导入会话（选择其他电脑的 dsh 会话目录/文件）。 */
  importSessions: (mode: 'folder' | 'file', targetWorkspacePath?: string): Promise<{ ok: boolean; canceled?: boolean; count: number; error?: string }> =>
    ipcRenderer.invoke(IPC.SessionsImport, mode, targetWorkspacePath),
  openPath: (p: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.OpenPath, p),

  /** 初始化（出厂重置）。keepRuntime=true 保留运行环境。 */
  resetApp: (keepRuntime: boolean): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.AppReset, keepRuntime),

  /** 同步配置。 */
  getSyncConfig: (): Promise<{ config: SyncConfigPayload; counts: { local: number; remote: number } }> =>
    ipcRenderer.invoke(IPC.SyncGet),
  setSyncConfig: (patch: SyncConfigPayload): Promise<{ ok: boolean; config?: SyncConfigPayload }> =>
    ipcRenderer.invoke(IPC.SyncSet, patch),
  syncPush: (): Promise<SyncResultPayload> => ipcRenderer.invoke(IPC.SyncPush),
  syncPull: (): Promise<SyncResultPayload> => ipcRenderer.invoke(IPC.SyncPull),
  syncForceRemote: (): Promise<SyncResultPayload> => ipcRenderer.invoke(IPC.SyncForceRemote),
  syncForceLocal: (): Promise<SyncResultPayload> => ipcRenderer.invoke(IPC.SyncForceLocal),

  // ---------- M5：模型与 API ----------
  getApiConfig: (): Promise<ApiConfigPayload> => ipcRenderer.invoke(IPC.ApiGet),
  setApiConfig: (
    patch: ApiConfigPayload
  ): Promise<{ ok: boolean; config?: ApiConfigPayload; error?: string; synced?: boolean; syncError?: string }> =>
    ipcRenderer.invoke(IPC.ApiSet, patch),
  testApiConnection: (): Promise<{ ok: boolean; error?: string; latencyMs?: number }> => ipcRenderer.invoke(IPC.ApiTest),
  discoverModels: (payload: { baseUrl?: string; apiKey?: string }): Promise<ApiDiscoverResult> =>
    ipcRenderer.invoke(IPC.ApiDiscoverModels, payload),

  // ---------- 插件：功能插件 + 在线市场 ----------
  getPlugins: (): Promise<PluginsPayload> => ipcRenderer.invoke(IPC.PluginsGet),
  setPluginEnabled: (name: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.PluginSetEnabled, name, enabled),
  searchPlugins: (query: string): Promise<{ ok: boolean; hits: NpmPluginHitPayload[]; error?: string }> =>
    ipcRenderer.invoke(IPC.PluginSearch, query),
  installPlugin: (
    pkgSpec: string
  ): Promise<{ ok: boolean; error?: string; bundle?: boolean; log?: string }> =>
    ipcRenderer.invoke(IPC.PluginInstall, pkgSpec),
  uninstallPlugin: (pkgName: string): Promise<{ ok: boolean; error?: string; log?: string }> =>
    ipcRenderer.invoke(IPC.PluginUninstall, pkgName),

  // ---------- 推荐技能市场 ----------
  getSkills: (): Promise<{ items: SkillMarketItem[]; installed: InstalledSkillInfo[] }> =>
    ipcRenderer.invoke(IPC.SkillsList),
  installSkill: (skillId: string): Promise<{ ok: boolean; error?: string; installed?: string[]; log?: string }> =>
    ipcRenderer.invoke(IPC.SkillInstall, skillId),

  // ---------- 通用设置（同步 dsh） ----------
  getDshUiSettings: (): Promise<DshUiSettingsResult> => ipcRenderer.invoke(IPC.DshUiGet),
  setDshUiSettings: (
    patch: DshUiSettingsPayload
  ): Promise<{ ok: boolean; error?: string; result?: DshUiSettingsResult }> =>
    ipcRenderer.invoke(IPC.DshUiSet, patch),
  openSettingsFile: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.OpenSettingsFile),

  // ---------- 工作区树 ----------
  getWorkspaces: (): Promise<WorkspacesPayload> => ipcRenderer.invoke(IPC.WorkspacesGet),
  renameWorkspace: (id: string, title: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WorkspaceRename, id, title),
  deleteWorkspace: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WorkspaceDelete, id),

  // ---------- 侧边栏会话视图：分组 / 归档 / 收藏 / 会话操作 ----------
  getSidebarData: (): Promise<SidebarDataPayload> => ipcRenderer.invoke(IPC.SidebarDataGet),
  createSessionGroup: (name: string, workspaceId: string): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionGroupCreate, name, workspaceId),
  renameSessionGroup: (id: string, name: string): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionGroupRename, id, name),
  pinSessionGroup: (id: string): Promise<SessionOpResult> => ipcRenderer.invoke(IPC.SessionGroupPin, id),
  deleteSessionGroup: (id: string): Promise<SessionOpResult> => ipcRenderer.invoke(IPC.SessionGroupDelete, id),
  moveSessionToGroup: (sessionId: string, groupId: string | null): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionMoveToGroup, sessionId, groupId),
  setSessionFavorite: (sessionId: string, favorite: boolean): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionSetFavorite, sessionId, favorite),
  renameSession: (sessionId: string, title: string): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionRename, sessionId, title),
  forkSession: (sessionId: string): Promise<SessionOpResult> => ipcRenderer.invoke(IPC.SessionFork, sessionId),
  archiveSession: (sessionId: string, title: string, time: number): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionArchive, sessionId, title, time),
  deleteArchivedSession: (sessionId: string): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionDeleteArchived, sessionId),

  // ---------- M5：备份与恢复 ----------
  createBackup: (): Promise<{ ok: boolean; path?: string; sizeBytes?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.BackupCreate),
  listBackups: (): Promise<BackupEntryPayload[]> => ipcRenderer.invoke(IPC.BackupList),
  restoreBackup: (zipPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.BackupRestore, zipPath),
  deleteBackup: (name: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.BackupDelete, name),
  exportWorkspace: (destDir: string, includeRuntime: boolean): Promise<{ ok: boolean; error?: string; sizeBytes?: number }> =>
    ipcRenderer.invoke(IPC.BackupExport, destDir, includeRuntime),
  getBackupSettings: (): Promise<BackupSettingsPayload> => ipcRenderer.invoke(IPC.BackupSettingsGet),
  setBackupSettings: (patch: BackupSettingsPayload): Promise<{ ok: boolean; settings?: BackupSettingsPayload }> =>
    ipcRenderer.invoke(IPC.BackupSettingsSet, patch),

  // ---------- M5：日志 ----------
  readLogs: (): Promise<LogsPayload> => ipcRenderer.invoke(IPC.LogsRead),
  clearLogs: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.LogsClear),
  exportLogs: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke(IPC.LogsExport),

  // ---------- M5：关于 ----------
  checkUpdate: (): Promise<{ ok: boolean; current: string; hasUpdate: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.AppCheckUpdate),
  setLoginItem: (enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> =>
    ipcRenderer.invoke(IPC.AppSetLoginItem, enabled),

  /** 通用目录选择框。 */
  chooseDirectory: (title: string): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.DialogChooseDirectory, title),

  /** 订阅主进程 UI 事件（全局快捷键触发）；返回取消订阅函数。 */
  onUiEvent: (callback: (type: UiEventType) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, type: UiEventType): void => callback(type)
    ipcRenderer.on(IPC.UiEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.UiEvent, listener)
    }
  }
}

export type DshwApi = typeof api

contextBridge.exposeInMainWorld('dshw', api)
