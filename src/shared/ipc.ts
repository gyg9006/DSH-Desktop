/**
 * 主进程 / preload / 渲染进程 共享的 IPC 通道名与数据类型。
 * 渲染进程只能通过 preload 暴露的白名单 API 与主进程通信。
 */

export const IPC = {
  AppGetInfo: 'app:get-info',
  ConfigGet: 'config:get',
  ConfigSet: 'config:set',
  WorkspaceOpen: 'workspace:open',
  OpenPath: 'app:open-path',
  OpenExternal: 'app:open-external',
  LogReport: 'log:report',
  EnvDetect: 'env:detect',
  UiEvent: 'ui:event',
  InstallRun: 'install:run',
  InstallCancel: 'install:cancel',
  InstallEvent: 'install:event',
  ClipboardWrite: 'clipboard:write',
  WorkspaceGetInfo: 'workspace:get-info',
  WorkspaceSet: 'workspace:set',
  WorkspaceChoose: 'workspace:choose',
  MigrateScan: 'migrate:scan',
  MigratePlan: 'migrate:plan',
  MigrateRun: 'migrate:run',
  MigrateCancel: 'migrate:cancel',
  MigrateEvent: 'migrate:event',
  AppRelaunch: 'app:relaunch',
  ServiceStart: 'service:start',
  ServiceStop: 'service:stop',
  ServiceStatus: 'service:status',
  ServiceEvent: 'service:event',
  ServiceCleanup: 'service:cleanup',
  SessionsList: 'sessions:list',
  SessionsPin: 'sessions:pin',
  SessionsDelete: 'sessions:delete',
  SessionsImport: 'sessions:import',
  ApiGet: 'api:get',
  ApiSet: 'api:set',
  ApiTest: 'api:test',
  ApiDiscoverModels: 'api:discover-models',
  PluginsGet: 'plugins:get',
  PluginSetEnabled: 'plugins:set-enabled',
  PluginSearch: 'plugins:search',
  PluginInstall: 'plugins:install',
  PluginUninstall: 'plugins:uninstall',
  SkillsList: 'skills:list',
  SkillsSearch: 'skills:search',
  SkillInstall: 'skills:install',
  SkillInstallNpm: 'skills:install-npm',
  DshUiGet: 'dsh-ui:get',
  DshUiSet: 'dsh-ui:set',
  OpenSettingsFile: 'dsh-ui:open-settings-file',
  WorkspacesGet: 'workspaces:get',
  WorkspaceRename: 'workspaces:rename',
  WorkspaceDelete: 'workspaces:delete',
  SidebarDataGet: 'sidebar:data',
  SessionGroupCreate: 'session-groups:create',
  SessionGroupRename: 'session-groups:rename',
  SessionGroupPin: 'session-groups:pin',
  SessionGroupDelete: 'session-groups:delete',
  SessionMoveToGroup: 'sessions:move-to-group',
  SessionSetFavorite: 'sessions:set-favorite',
  SessionRename: 'sessions:rename',
  SessionFork: 'sessions:fork',
  SessionArchive: 'sessions:archive',
  SessionDeleteArchived: 'sessions:delete-archived',
  SessionDeleteArchivedBatch: 'sessions:delete-archived-batch',
  SessionDeleteBatch: 'sessions:delete-batch',
  SessionUnarchive: 'sessions:unarchive',
  SessionExport: 'sessions:export',
  BackupCreate: 'backup:create',
  BackupList: 'backup:list',
  BackupRestore: 'backup:restore',
  BackupDelete: 'backup:delete',
  BackupExport: 'backup:export',
  BackupSettingsGet: 'backup:settings:get',
  BackupSettingsSet: 'backup:settings:set',
  LogsRead: 'logs:read',
  LogsClear: 'logs:clear',
  LogsExport: 'logs:export',
  AppCheckUpdate: 'app:check-update',
  AppUpdateSettingsGet: 'app:update-settings:get',
  AppUpdateSettingsSet: 'app:update-settings:set',
  AppUpdateDownload: 'app:update:download',
  AppUpdateCancel: 'app:update:cancel',
  AppUpdateApply: 'app:update:apply',
  UpdateEvent: 'app:update:event',
  AppSetLoginItem: 'app:set-login-item',
  DialogChooseDirectory: 'dialog:choose-directory',
  DialogChooseFile: 'dialog:choose-file',
  AppReset: 'app:reset',
  SyncGet: 'sync:get',
  SyncSet: 'sync:set',
  SyncPush: 'sync:push',
  SyncPull: 'sync:pull',
  SyncForceRemote: 'sync:force-remote',
  SyncForceLocal: 'sync:force-local'
} as const

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ThemeMode = 'light' | 'dark' | 'system'

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error'

export type UiEventType = 'toggle-sidebar' | 'new-chat' | 'open-settings' | 'sidebar-data-changed'

export interface AppInfo {
  appName: string
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  arch: string
  workspacePath: string
  isPackaged: boolean
}

/** workspace/config/app.json 的结构（后续里程碑逐步扩充字段）。 */
export interface AppConfig {
  workspacePath?: string
  onboarded?: boolean
  theme?: ThemeMode
  sidebarCollapsed?: boolean
  [key: string]: unknown
}

export type EnvItemKey = 'node' | 'npm' | 'pnpm' | 'git' | 'dsh'

export type EnvItemState = 'ok' | 'missing' | 'incompatible' | 'error'

export interface EnvItem {
  key: EnvItemKey
  name: string
  state: EnvItemState
  version: string | null
  /** 检测到的来源：便携版 / 系统 / 无 */
  source: 'portable' | 'system' | 'none'
  message?: string
}

export interface EnvReport {
  items: EnvItem[]
  checkedAt: string
  summary: {
    ok: number
    missing: number
    incompatible: number
    error: number
  }
}

export type InstallKey = 'node' | 'npm' | 'pnpm' | 'git' | 'dsh'

export type InstallMode = 'install' | 'update'

export interface InstallEvent {
  key: InstallKey
  phase: 'start' | 'log' | 'progress' | 'done' | 'error' | 'cancelled'
  message?: string
  /** 0-100；null 表示不确定进度（如解压/命令执行阶段） */
  percent?: number | null
  error?: string
}

export interface InstallResult {
  ok: boolean
  error?: string
  cancelled?: boolean
}

/** 存量 dsh 数据扫描项（规格 6.8）。 */
export type DshDataItemKey = 'sessions' | 'skills' | 'settings' | 'credentials' | 'profiles' | 'storages' | 'patch'

export interface DshDataScanItem {
  key: DshDataItemKey
  label: string
  sourcePath: string
  /** 条目数：sessions=jsonl 数；skills=SKILL.md 数；profiles=profile 目录数；配置文件=0/1 */
  count: number
  exists: boolean
  sizeBytes: number
}

export interface DshDataSource {
  path: string
  label: string
  isWorkspaceData: boolean
  items: DshDataScanItem[]
  totalSessions: number
  totalSkills: number
}

export type MigrateConflictPolicy = 'overwrite' | 'skip' | 'rename'

export interface MigrateResult {
  ok: boolean
  error?: string
  cancelled?: boolean
  copied: number
  skipped: number
  renamed: number
  overwritten: number
}

export interface MigratePlan {
  entryCount: number
  conflicts: string[]
}

export interface MigrateEvent {
  phase: 'log' | 'progress' | 'done' | 'error' | 'cancelled'
  message?: string
  done?: number
  total?: number
  error?: string
}

/** 数据目录自检结果（规格 4.4：DSH_HOME 策略下每次启动校验 workspace/data）。 */
export interface DshDataDirStatus {
  path: string
  status: 'ok' | 'missing' | 'unwritable'
  exists: boolean
  writable: boolean
}

export interface WorkspaceInfo {
  workspacePath: string
  dataDir: DshDataDirStatus
}

export interface WorkspaceSetResult {
  ok: boolean
  error?: string
  restartRequired?: boolean
}

/** 会话列表条目（规格 5.2）。 */
export interface SessionEntry {
  id: string
  title: string
  time: number
  path: string
  pinned: boolean
}

export interface ServiceSnapshot {
  status: ServiceStatus
  port: number | null
  pid: number | null
  log: string[]
}

/** 自定义提供方（同步到 dsh 的 llm-pi-ai 段）。 */
export interface ProviderConfigPayload {
  /** 显示名称（dsh Models 页展示）。 */
  displayName?: string
  /** 线缆协议：默认 openai-completions。 */
  api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages'
  baseUrl?: string
  apiKey?: string
  /** 模型 id 列表（手声明路由必填 ≥1）。 */
  models?: string[]
}

/** 模型与 API 配置（workspace/config/api.json）。 */
export interface ApiConfigPayload {
  apiKey?: string
  baseUrl?: string
  model?: string
  proxy?: {
    mode: 'none' | 'system' | 'manual'
    http?: string
    https?: string
    socks5?: string
  }
  /** 自定义提供方，key = 路由名（如 acme-gateway）。 */
  providers?: Record<string, ProviderConfigPayload>
}

/** 从端点获取的模型列表（dsh 的 discoverModels 同源：GET {baseURL}/models）。 */
export interface ApiDiscoverResult {
  ok: boolean
  models?: string[]
  error?: string
}

/** 功能插件状态（内置、可启用）。 */
export interface PluginStatePayload {
  id: string
  name: string
  title: string
  description: string
  tags: string[]
  enabledInBundle: boolean
  enabledByUser: boolean
}

/** 已安装插件（profile 的 pnpm dependencies）。 */
export interface InstalledPluginPayload {
  name: string
  version: string
  /** 声明 dsh.bundle（安装后自动成为 profile 层）。 */
  bundle: boolean
  enabled: boolean
}

/** npm 搜索结果条目。 */
export interface NpmPluginHitPayload {
  name: string
  version: string
  description: string
  author?: string
  keywords: string[]
  date: string
  url?: string
}

export interface PluginsPayload {
  curated: PluginStatePayload[]
  installed: InstalledPluginPayload[]
}

/** Agent 预设（dsh-agent-presets：目录名 = 预设 id，preset.yml 提供显示文本）。 */
export interface AgentPresetInfo {
  id: string
  name: string
  description?: string
  /** true = 随 dsh 安装（只读）；false = 用户自建（$DSH_HOME/.agent-presets）。 */
  shipped: boolean
}

/** 通用设置（同步到 dsh settings.yaml 的 locale / ui-theme / agent-presets 命名空间）。 */
export interface DshUiSettingsPayload {
  locale?: 'zh' | 'en'
  theme?: 'light' | 'dark' | 'system'
  defaultAgentPreset?: string
  /** 桌面端是否显示 dsh 内置侧边栏（应用配置）。 */
  showDshSidebar?: boolean
}

export interface DshUiSettingsResult {
  locale: 'zh' | 'en'
  theme: 'light' | 'dark' | 'system'
  defaultAgentPreset: string
  showDshSidebar: boolean
  presets: AgentPresetInfo[]
}

/** 推荐技能（来自知名开源技能库，如 anthropics/skills、obra/superpowers）。 */
export interface SkillMarketItem {
  id: string
  name: string
  description: string
  tags: string[]
  /** 来源：GitHub 仓库路径 / npm 包 / npm 技能合集内的单个技能。 */
  source:
    | { type: 'github'; repo: string; path: string }
    | { type: 'npm'; pkg: string }
    | { type: 'npm-skill'; pkg: string; skill: string }
  /** 是否社区强烈推荐（绿色标签）。 */
  recommended: boolean
  /** 已安装 */
  installed: boolean
}

export interface InstalledSkillInfo {
  id: string
  path: string
  sizeBytes: number
  mtime: number
}

/** 工作区树（对应 dsh 侧边栏的工作区视图）。 */
export interface WorkspaceSessionEntry {
  id: string
  title: string
  time: number
  /** 空会话（dsh 不展示，侧边栏过滤） */
  blank?: boolean
}

export interface WorkspaceEntryPayload {
  id: string
  title: string
  path: string
  /** 会话数 */
  sessionCount: number
  sessions: WorkspaceSessionEntry[]
}

export interface WorkspacesPayload {
  workspaces: WorkspaceEntryPayload[]
  /** 当前工作区（应用配置的 workspacePath 对应的工作区 id，无则 null）。 */
  currentId: string | null
}

/** 对话分组（桌面端管理）。 */
export interface SessionGroupInfo {
  id: string
  name: string
  workspaceId: string
  pinned: boolean
}

/** 归档会话条目。 */
export interface ArchivedSessionEntry {
  sessionId: string
  title: string
  /** 会话时间戳（ms） */
  time: number
  /** 归档时间戳（ms） */
  archivedAt: number
  /** 关键字（标题分词 + 人工标注） */
  keywords: string[]
  /** 分组 id（可选） */
  groupId: string | null
  /** 收藏 */
  favorite: boolean
  /** 归档前所在工作区路径（还原到工作区时使用） */
  workspacePath?: string
  /** 归档前所在工作区 id */
  workspaceId?: string
}

/** 侧边栏会话视图的完整数据。 */
export interface SidebarDataPayload {
  workspaces: WorkspaceEntryPayload[]
  groups: SessionGroupInfo[]
  archived: ArchivedSessionEntry[]
  favorites: string[]
  /** sessionId → groupId（未分组为 null） */
  groupMap: Record<string, string | null>
}

export interface SessionOpResult {
  ok: boolean
  error?: string
  /** fork 产生的新会话 id */
  forkedId?: string
  /** 批量操作成功数量 */
  count?: number
}

export interface BackupEntryPayload {
  name: string
  path: string
  sizeBytes: number
  mtime: number
}

export interface BackupSettingsPayload {
  enabled?: boolean
  period?: 'daily' | 'weekly'
  keep?: number
  lastAt?: number
}

export interface LogsPayload {
  app: string[]
  dsh: string[]
}

export interface SyncConfigPayload {
  remoteUrl?: string
  branch?: string
  lastSyncAt?: number
}

export interface SyncResultPayload {
  ok: boolean
  error?: string
  pushed?: number
  pulled?: number
  /** true = 同步冲突（rebase 失败），UI 据此显示「以远端/本地为准」操作 */
  conflict?: boolean
}

/** 更新模式：auto=自动检测并下载；manual=仅手动检查。 */
export type UpdateMode = 'auto' | 'manual'

export interface UpdateSettingsPayload {
  mode: UpdateMode
  /** 最近一次检查时间（ms） */
  lastCheckAt?: number
  /** 已检查到的远端版本（防止重复提示） */
  lastVersion?: string
}

export interface UpdateCheckResultPayload {
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

export type UpdateEventPhase =
  | 'checking'
  | 'found'
  | 'none'
  | 'downloading'
  | 'downloaded'
  | 'applying'
  | 'error'

export interface UpdateEventPayload {
  phase: UpdateEventPhase
  percent?: number
  message?: string
  version?: string
  error?: string
}

export interface UpdateDownloadResultPayload {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}
