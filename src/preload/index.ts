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
  SyncResultPayload,
  UpdateSettingsPayload,
  UpdateCheckResultPayload,
  UpdateEventPayload,
  UpdateDownloadResultPayload,
  KnowledgePayload,
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeSearchQuery,
  KnowledgeSearchResult,
  KnowledgeExtractInput,
  KnowledgeExtractResult,
  KnowledgeIterateResult,
  KnowledgePipelineInput,
  KnowledgePipelineResult,
  KnowledgePipelineProgress,
  RecentSessionTextResult,
  AgentsPayload,
  AgentImportResult,
  AgentRunResult,
  AgentCollaborateInput,
  AgentCollaborateResult
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

  /** 清理残留 dsh 进程（启动报「端口被占用 / 旧进程残留」时使用）。 */
  cleanupService: (): Promise<{ ok: boolean; cleaned: number }> => ipcRenderer.invoke(IPC.ServiceCleanup),

  /** 会话列表（规格 5.2）。 */
  listSessions: (): Promise<SessionEntry[]> => ipcRenderer.invoke(IPC.SessionsList),

  /** 置顶/取消置顶会话。 */
  pinSession: (id: string, pinned: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SessionsPin, id, pinned),

  /** 删除会话。 */
  deleteSession: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.SessionsDelete, id),

  /** 导入会话（选择其他电脑的 dsh 会话目录/文件）。 */
  importSessions: (mode: 'folder' | 'file', targetWorkspacePath?: string): Promise<{ ok: boolean; canceled?: boolean; count: number; skipped?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.SessionsImport, mode, targetWorkspacePath),
  openPath: (p: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.OpenPath, p),

  /** 初始化（出厂重置）。keepRuntime=true 保留运行环境。 */
  resetApp: (keepRuntime: boolean): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.AppReset, keepRuntime),

  /** 同步配置。 */
  getSyncConfig: (): Promise<{ config: SyncConfigPayload; counts: { local: number; remote: number } }> =>
    ipcRenderer.invoke(IPC.SyncGet),
  setSyncConfig: (patch: SyncConfigPayload): Promise<{ ok: boolean; config?: SyncConfigPayload; error?: string }> =>
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
  searchSkills: (query: string): Promise<{ ok: boolean; hits: Array<{ name: string; description: string; keywords: string[] }>; error?: string }> =>
    ipcRenderer.invoke(IPC.SkillsSearch, query),
  installSkill: (skillId: string): Promise<{ ok: boolean; error?: string; installed?: string[]; log?: string }> =>
    ipcRenderer.invoke(IPC.SkillInstall, skillId),
  installSkillNpm: (pkg: string): Promise<{ ok: boolean; error?: string; installed?: string[]; log?: string }> =>
    ipcRenderer.invoke(IPC.SkillInstallNpm, pkg),

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
  deleteSessionGroup: (id: string, deleteContents = false): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionGroupDelete, id, deleteContents),
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
  deleteArchivedSessions: (sessionIds: string[]): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionDeleteArchivedBatch, sessionIds),
  deleteSessions: (sessionIds: string[]): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionDeleteBatch, sessionIds),
  unarchiveSession: (sessionId: string): Promise<SessionOpResult> =>
    ipcRenderer.invoke(IPC.SessionUnarchive, sessionId),
  exportSession: (sessionId: string, title: string): Promise<{ ok: boolean; canceled?: boolean; path?: string; sizeBytes?: number; error?: string }> =>
    ipcRenderer.invoke(IPC.SessionExport, sessionId, title),

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
  setBackupSettings: (patch: BackupSettingsPayload): Promise<{ ok: boolean; settings?: BackupSettingsPayload; error?: string }> =>
    ipcRenderer.invoke(IPC.BackupSettingsSet, patch),

  // ---------- M5：日志 ----------
  readLogs: (): Promise<LogsPayload> => ipcRenderer.invoke(IPC.LogsRead),
  clearLogs: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.LogsClear),
  exportLogs: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => ipcRenderer.invoke(IPC.LogsExport),

  // ---------- M5：关于 ----------
  checkUpdate: (): Promise<UpdateCheckResultPayload> => ipcRenderer.invoke(IPC.AppCheckUpdate),
  getUpdateSettings: (): Promise<UpdateSettingsPayload> => ipcRenderer.invoke(IPC.AppUpdateSettingsGet),
  setUpdateSettings: (patch: Partial<UpdateSettingsPayload>): Promise<{ ok: boolean; settings?: UpdateSettingsPayload }> =>
    ipcRenderer.invoke(IPC.AppUpdateSettingsSet, patch),
  downloadUpdate: (assetId: number): Promise<UpdateDownloadResultPayload> =>
    ipcRenderer.invoke(IPC.AppUpdateDownload, assetId),
  cancelUpdateDownload: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.AppUpdateCancel),
  applyUpdate: (zipPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.AppUpdateApply, zipPath),
  /** 订阅更新事件（进度/状态）；返回取消订阅函数。 */
  onUpdateEvent: (callback: (event: UpdateEventPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UpdateEventPayload): void => callback(payload)
    ipcRenderer.on(IPC.UpdateEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.UpdateEvent, listener)
    }
  },
  setLoginItem: (enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> =>
    ipcRenderer.invoke(IPC.AppSetLoginItem, enabled),

  /** 通用目录选择框。 */
  chooseDirectory: (title: string): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.DialogChooseDirectory, title),

  /** 通用文件选择框（可带扩展名过滤）。 */
  chooseFile: (
    title: string,
    filters?: { name?: string; extensions: string[] }[]
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.DialogChooseFile, title, filters),

  /** 订阅主进程 UI 事件（全局快捷键触发）；返回取消订阅函数。 */
  onUiEvent: (callback: (type: UiEventType) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, type: UiEventType): void => callback(type)
    ipcRenderer.on(IPC.UiEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.UiEvent, listener)
    }
  },

  // ===== v2.0：窗口控制（无边框标题栏） =====
  windowMinimize: (): Promise<void> => ipcRenderer.invoke(IPC.WindowMinimize),
  windowToggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.WindowMaximize),
  windowClose: (): Promise<void> => ipcRenderer.invoke(IPC.WindowClose),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.WindowIsMaximized),

  // ===== v2.0：知识库 =====
  knowledgeGet: (): Promise<KnowledgePayload> => ipcRenderer.invoke(IPC.KnowledgeGet),
  knowledgeCategoryCreate: (name: string): Promise<{ ok: boolean; category?: KnowledgeCategory; error?: string }> =>
    ipcRenderer.invoke(IPC.KnowledgeCategoryCreate, name),
  knowledgeCategoryRename: (id: string, name: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.KnowledgeCategoryRename, id, name),
  knowledgeCategoryDelete: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.KnowledgeCategoryDelete, id),
  knowledgeEntryCreate: (
    categoryId: string,
    input: { title?: string; content?: string; tags?: string[] }
  ): Promise<{ ok: boolean; entry?: KnowledgeEntry; error?: string }> =>
    ipcRenderer.invoke(IPC.KnowledgeEntryCreate, categoryId, input),
  knowledgeEntryUpdate: (
    id: string,
    patch: { title?: string; content?: string; tags?: string[] }
  ): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.KnowledgeEntryUpdate, id, patch),
  knowledgeEntryDelete: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.KnowledgeEntryDelete, id),
  knowledgeSearch: (query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult> =>
    ipcRenderer.invoke(IPC.KnowledgeSearch, query),
  knowledgeExtract: (input: KnowledgeExtractInput): Promise<KnowledgeExtractResult> =>
    ipcRenderer.invoke(IPC.KnowledgeExtract, input),
  knowledgeIterate: (): Promise<KnowledgeIterateResult> => ipcRenderer.invoke(IPC.KnowledgeIterate),
  /** 一键智能提炼流水线（六步 Skill 编排，进度经 onKnowledgeExtractProgress 广播）。 */
  extractKnowledgePipeline: (input: KnowledgePipelineInput): Promise<KnowledgePipelineResult> =>
    ipcRenderer.invoke(IPC.KnowledgeExtractPipeline, input),
  /** 订阅提炼流水线进度事件；返回取消订阅函数。 */
  onKnowledgeExtractProgress: (callback: (p: KnowledgePipelineProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, p: KnowledgePipelineProgress): void => callback(p)
    ipcRenderer.on(IPC.KnowledgeExtractProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC.KnowledgeExtractProgress, listener)
    }
  },
  /** 读取最近会话文本（供「提炼会话」自动填充）。 */
  getRecentSessionText: (maxChars?: number): Promise<RecentSessionTextResult> =>
    ipcRenderer.invoke(IPC.SessionGetRecentText, maxChars),

  // ===== v2.0：Agent 管理 =====
  agentsGet: (): Promise<AgentsPayload> => ipcRenderer.invoke(IPC.AgentsGet),
  agentImport: (url: string): Promise<AgentImportResult> => ipcRenderer.invoke(IPC.AgentImport, url),
  agentRename: (id: string, name: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.AgentRename, id, name),
  agentDelete: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.AgentDelete, id),
  agentRun: (id: string): Promise<AgentRunResult> => ipcRenderer.invoke(IPC.AgentRun, id),
  agentsCollaborate: (input: AgentCollaborateInput): Promise<AgentCollaborateResult> =>
    ipcRenderer.invoke(IPC.AgentsCollaborate, input)
}

export type DshwApi = typeof api

contextBridge.exposeInMainWorld('dshw', api)
