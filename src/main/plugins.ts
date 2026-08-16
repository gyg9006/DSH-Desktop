/**
 * 插件管理：功能插件（内置、可启用）+ 在线插件市场（npmmirror 搜索 + dsh plugin 安装）。
 *
 * 启用机制（已从 dsh-app-boot / @deepseek-ai/dsh 源码核实）：
 * - dsh 的用户层补丁 $DSH_HOME/cordis.patch.yml 是加载器最后应用的 patch 层；
 *   追加 `{ id, name }` 条目即可在下次启动时加载对应插件（in-box 包经
 *   $DSH_HOME/profiles/node_modules 扁平回退目录解析）。
 * - `dsh plugin --profile web add <pkg>` = 在 profile 目录跑 pnpm，成功后按
 *   包的 dsh.bundle 声明自动并入 dsh.profile.bundles 层（reconcilePlugins）。
 * - dsh 自带的「插件」设置页只做已加载插件的配置编辑，不做安装 —— 本模块与之互补。
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { runCommand, buildChildEnv } from './utils/process'
import { buildDshEnv } from './envCheck'
import { logger } from './logger'

export interface BuiltinPluginInfo {
  /** 加载器条目 id（= 包短名，与 dsh-base 补丁的 id 风格一致）。 */
  id: string
  /** 包名（@deepseek-ai 作用域）。 */
  name: string
  title: string
  description: string
  tags: string[]
}

export interface PluginState extends BuiltinPluginInfo {
  /** 已随 dsh 基础/Web 配置加载（bundle 层已包含）。 */
  enabledInBundle: boolean
  /** 用户在桌面端启用（写入用户层补丁）。 */
  enabledByUser: boolean
}

export interface InstalledPluginInfo {
  name: string
  version: string
  /** 声明 dsh.bundle（安装后自动成为 profile 层）。 */
  bundle: boolean
  /** 已由用户在桌面端启用（用户层补丁）。 */
  enabled: boolean
}

export interface NpmPluginHit {
  name: string
  version: string
  description: string
  author?: string
  keywords: string[]
  date: string
  url?: string
}

/** 内置推荐功能插件（50 个，全部随 dsh 安装、无需联网；是否已加载由 bundle 扫描自动判定）。 */
export const BUILTIN_PLUGINS: BuiltinPluginInfo[] = [
  // ---- 可选增强（未随 base/web-app 默认加载，可一键启用） ----
  {
    id: 'mcp-client',
    name: '@deepseek-ai/dsh-mcp-client',
    title: 'MCP 客户端',
    description: '连接外部 MCP 服务器（数据库、浏览器、文件系统等），让 dsh 调用外部工具链。',
    tags: ['mcp', '工具', '外部', '数据库', '集成']
  },
  {
    id: 'session-title-llm',
    name: '@deepseek-ai/dsh-session-title-llm',
    title: 'LLM 会话标题',
    description: '用模型自动为会话生成标题，取代简单的「首条提示词」规则。',
    tags: ['会话', '标题', 'session', 'title']
  },
  {
    id: 'schedule',
    name: '@deepseek-ai/dsh-schedule',
    title: '定时任务',
    description: '按 cron 计划自动执行任务，适合周期性巡检、汇总等自动化场景。',
    tags: ['定时', '计划', 'schedule', 'cron', '自动化']
  },
  {
    id: 'persona',
    name: '@deepseek-ai/dsh-persona',
    title: '人格设定',
    description: '为助手配置固定角色、语气与行为风格，让每次对话保持一致的形象。',
    tags: ['人格', '角色', '风格', 'persona', '角色扮演']
  },
  {
    id: 'output-retention',
    name: '@deepseek-ai/dsh-output-retention',
    title: '输出保留策略',
    description: '控制模型长输出的保留与裁剪策略，避免无关历史占用上下文。',
    tags: ['输出', '上下文', '保留', 'retention']
  },
  {
    id: 'terminal-bash',
    name: '@deepseek-ai/dsh-terminal-bash',
    title: 'Bash 终端',
    description: '集成终端会话能力（POSIX shell），提供交互式终端工具。',
    tags: ['终端', 'bash', 'terminal', 'shell']
  },
  {
    id: 'tmux-context',
    name: '@deepseek-ai/dsh-tmux-context',
    title: 'tmux 上下文',
    description: '读取 tmux 会话/窗格状态作为上下文来源（适合远程/复用工作区场景）。',
    tags: ['tmux', '上下文', '终端']
  },

  // ---- 官方核心能力（随 dsh 加载，供查看与了解） ----
  {
    id: 'web-search-deepseek',
    name: '@deepseek-ai/dsh-web-search-deepseek',
    title: 'DeepSeek 联网搜索',
    description: '模型在对话中自动检索网页获取实时信息（dsh 官方搜索提供方）。',
    tags: ['搜索', '联网', 'web', '实时']
  },
  {
    id: 'tool-web',
    name: '@deepseek-ai/dsh-tool-web',
    title: '网页工具',
    description: '抓取与阅读网页内容，把 URL 变成模型可分析的上下文。',
    tags: ['网页', '抓取', 'tool', 'web']
  },
  {
    id: 'tool-bash',
    name: '@deepseek-ai/dsh-tool-bash',
    title: 'Shell 工具（bash）',
    description: '在沙箱中执行 shell 命令，支持读写文件与运行脚本。',
    tags: ['shell', 'bash', '命令', '沙箱']
  },
  {
    id: 'tool-pwsh',
    name: '@deepseek-ai/dsh-tool-pwsh',
    title: 'PowerShell 工具',
    description: '在 Windows 上执行 PowerShell 命令（含 PowerShell 沙箱）。',
    tags: ['powershell', 'shell', '命令', 'windows']
  },
  {
    id: 'tool-fs',
    name: '@deepseek-ai/dsh-tool-fs',
    title: '文件系统工具',
    description: '读写、编辑工作文件夹内的文件，支持创建/移动/删除。',
    tags: ['文件', 'fs', '读写', '编辑']
  },
  {
    id: 'tool-fs-search',
    name: '@deepseek-ai/dsh-tool-fs-search',
    title: '文件搜索',
    description: '按文件名/内容在工作区中搜索文件（grep / glob）。',
    tags: ['搜索', '文件', 'grep', 'glob']
  },
  {
    id: 'tool-subagent',
    name: '@deepseek-ai/dsh-tool-subagent',
    title: '子代理工具',
    description: '把独立任务分派给子代理并行处理，再汇总结果。',
    tags: ['子代理', '并行', 'subagent', '委派']
  },
  {
    id: 'tool-workflow',
    name: '@deepseek-ai/dsh-tool-workflow',
    title: '工作流工具',
    description: '编写并运行多阶段、多智能体的工作流脚本。',
    tags: ['工作流', 'workflow', '多智能体']
  },
  {
    id: 'tool-goal',
    name: '@deepseek-ai/dsh-tool-goal',
    title: '目标工具',
    description: '创建长期目标并跨轮次持续推进（goal 工具族）。',
    tags: ['目标', 'goal', '长期任务']
  },
  {
    id: 'tool-todo',
    name: '@deepseek-ai/dsh-tool-todo',
    title: '待办清单',
    description: '维护任务清单，跟踪当前进度与下一步。',
    tags: ['待办', 'todo', '任务', '清单']
  },
  {
    id: 'tool-skill',
    name: '@deepseek-ai/dsh-tool-skill',
    title: '技能工具',
    description: '调用已安装的技能（SKILL.md），按需加载与使用。',
    tags: ['技能', 'skill', 'SKILL.md']
  },
  {
    id: 'tool-ralph',
    name: '@deepseek-ai/dsh-tool-ralph',
    title: 'Ralph 循环',
    description: '以全新智能体反复迭代直到目标完成或报告阻塞（Ralph 工具）。',
    tags: ['ralph', '迭代', '循环']
  },
  {
    id: 'tool-jobs',
    name: '@deepseek-ai/dsh-tool-jobs',
    title: '任务队列',
    description: '把任务加入后台队列执行，支持进度与结果收集。',
    tags: ['任务', '队列', 'jobs', '后台']
  },
  {
    id: 'tool-ask-user',
    name: '@deepseek-ai/dsh-tool-ask-user',
    title: '询问用户',
    description: '需要决策时向用户提出结构化问题并获得回答。',
    tags: ['提问', '交互', 'ask-user']
  },
  {
    id: 'tool-cordis',
    name: '@deepseek-ai/dsh-tool-cordis',
    title: 'Cordis 控制台',
    description: '查看与操作 Cordis 插件树（诊断、调试运行状态）。',
    tags: ['cordis', '诊断', '插件树']
  },
  {
    id: 'command-goal',
    name: '@deepseek-ai/dsh-command-goal',
    title: '目标命令',
    description: '提供「设置目标 / 查看目标 / 完成目标」等自然语言命令。',
    tags: ['命令', '目标', 'command']
  },
  {
    id: 'command-compact',
    name: '@deepseek-ai/dsh-command-compact',
    title: '压缩命令',
    description: '对话过长时一键压缩历史，节省上下文空间。',
    tags: ['命令', '压缩', 'compact']
  },
  {
    id: 'command-feedback',
    name: '@deepseek-ai/dsh-command-feedback',
    title: '反馈命令',
    description: '对回复质量做评价与反馈，帮助模型改进。',
    tags: ['命令', '反馈', 'feedback']
  },
  {
    id: 'compaction-basic',
    name: '@deepseek-ai/dsh-compaction-basic',
    title: '基础上下文压缩',
    description: '把超长对话摘要压缩，保留关键信息继续对话。',
    tags: ['压缩', '上下文', '摘要', 'compaction']
  },
  {
    id: 'compaction-tool-result-pruner',
    name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
    title: '工具结果裁剪',
    description: '裁剪过长的工具输出，避免其占用完整上下文窗口。',
    tags: ['裁剪', '工具输出', '上下文']
  },
  {
    id: 'session-title',
    name: '@deepseek-ai/dsh-session-title',
    title: '会话标题服务',
    description: '会话标题生成的服务框架与规则。',
    tags: ['会话', '标题', 'session']
  },
  {
    id: 'session-title-first-prompt-llm',
    name: '@deepseek-ai/dsh-session-title-first-prompt-llm',
    title: '首条提示词标题',
    description: '用首条用户提示词为会话生成初始标题。',
    tags: ['会话', '标题', '提示词']
  },
  {
    id: 'session-stats',
    name: '@deepseek-ai/dsh-session-stats',
    title: '会话统计',
    description: '统计会话用量（消息数、Token 等），展示在会话详情中。',
    tags: ['会话', '统计', 'stats']
  },
  {
    id: 'session-log-export',
    name: '@deepseek-ai/dsh-session-log-export',
    title: '会话日志导出',
    description: '把会话记录导出为文件，便于分享与归档。',
    tags: ['会话', '导出', '日志', 'export']
  },
  {
    id: 'session-telemetry-otel',
    name: '@deepseek-ai/dsh-session-telemetry-otel',
    title: 'OpenTelemetry 遥测',
    description: '以 OpenTelemetry 标准导出会话遥测数据（用量、延迟等），供外部观测系统采集。',
    tags: ['遥测', 'otel', '观测', 'telemetry']
  },
  {
    id: 'message-feedback',
    name: '@deepseek-ai/dsh-message-feedback',
    title: '消息反馈',
    description: '对单条消息点赞/点踩，帮助模型持续改进。',
    tags: ['反馈', '点赞', 'message-feedback']
  },
  {
    id: 'user-approval',
    name: '@deepseek-ai/dsh-user-approval',
    title: '用户审批',
    description: '敏感操作（如文件修改）先征求用户确认再执行。',
    tags: ['审批', '安全', 'approval', '确认']
  },
  {
    id: 'sandbox-local',
    name: '@deepseek-ai/dsh-sandbox-local',
    title: '本地沙箱',
    description: '为命令执行提供本地沙箱与资源限制。',
    tags: ['沙箱', '安全', 'sandbox']
  },
  {
    id: 'bash-sandbox',
    name: '@deepseek-ai/dsh-bash-sandbox',
    title: 'Bash 沙箱',
    description: '限制 bash 工具的读写范围与权限（ACL 等）。',
    tags: ['沙箱', 'bash', '安全']
  },
  {
    id: 'pwsh-sandbox',
    name: '@deepseek-ai/dsh-pwsh-sandbox',
    title: 'PowerShell 沙箱',
    description: '限制 PowerShell 工具的执行范围与权限。',
    tags: ['沙箱', 'powershell', '安全']
  },
  {
    id: 'skill-badge',
    name: '@deepseek-ai/dsh-skill-badge',
    title: '技能徽章',
    description: '给技能显示徽章信息（作者、版本等），便于识别。',
    tags: ['技能', '徽章', 'badge']
  },
  {
    id: 'skill-filesystem',
    name: '@deepseek-ai/dsh-skill-filesystem',
    title: '技能文件系统',
    description: '从文件系统扫描与管理技能（workspace/skills 接入点）。',
    tags: ['技能', '文件系统', '扫描']
  },
  {
    id: 'permission-presets',
    name: '@deepseek-ai/dsh-permission-presets',
    title: '权限预设',
    description: '一键切换默认权限模式（只读 / 工作区写等）。',
    tags: ['权限', '预设', 'permission']
  },
  {
    id: 'repeat-tool-reminder',
    name: '@deepseek-ai/dsh-repeat-tool-reminder',
    title: '重复工具提醒',
    description: '提醒重复调用同一工具，避免无效循环。',
    tags: ['提醒', '去重', 'repeat']
  },
  {
    id: 'token-meter',
    name: '@deepseek-ai/dsh-token-meter',
    title: 'Token 计量',
    description: '实时统计每次请求的 Token 消耗与成本。',
    tags: ['token', '计量', '成本']
  },
  {
    id: 'agent-instructions',
    name: '@deepseek-ai/dsh-agent-instructions',
    title: '智能体指令',
    description: '向智能体注入系统级指令与约束。',
    tags: ['智能体', '指令', 'system-prompt']
  },
  {
    id: 'agent-presets',
    name: '@deepseek-ai/dsh-agent-presets',
    title: 'Agent 预设',
    description: '按预设组合工具与能力（标准 / 极简 / PTC / 创造）。',
    tags: ['预设', 'agent', '模式']
  },
  {
    id: 'subagent',
    name: '@deepseek-ai/dsh-subagent',
    title: '子代理',
    description: '子代理的创建、运行与汇报（spawn / fork）。',
    tags: ['子代理', 'subagent', '委派']
  },
  {
    id: 'workflow',
    name: '@deepseek-ai/dsh-workflow',
    title: '工作流引擎',
    description: '多智能体工作流的执行与协调。',
    tags: ['工作流', 'workflow', '多智能体']
  },
  {
    id: 'plan-mode',
    name: '@deepseek-ai/dsh-plan-mode',
    title: '计划模式',
    description: '先制定计划再执行，复杂任务更可控。',
    tags: ['计划', 'plan', '规划']
  },
  {
    id: 'goal',
    name: '@deepseek-ai/dsh-goal',
    title: '目标管理',
    description: '长期目标的生命周期管理（创建/暂停/完成）。',
    tags: ['目标', 'goal', '长期']
  },
  {
    id: 'terminal',
    name: '@deepseek-ai/dsh-terminal',
    title: '终端能力',
    description: '交互式终端会话（PTY）基础设施。',
    tags: ['终端', 'terminal', 'pty']
  },
  {
    id: 'headless',
    name: '@deepseek-ai/dsh-headless',
    title: '无头模式',
    description: '无界面运行：一次任务、打印结果并退出（CLI 场景）。',
    tags: ['无头', 'cli', 'headless']
  }
]

/** 用户层补丁路径 = $DSH_HOME/cordis.patch.yml。 */
function homePatchPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'cordis.patch.yml')
}

function readUserPatch(workspaceDir: string): unknown[] {
  const p = homePatchPath(workspaceDir)
  if (!fs.existsSync(p)) return []
  try {
    const parsed = yaml.load(fs.readFileSync(p, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 从补丁文件收集插件包名。 */
function collectNames(patch: unknown[]): Set<string> {
  const names = new Set<string>()
  for (const e of patch) {
    const name = e && typeof e === 'object' ? (e as { name?: unknown }).name : undefined
    if (typeof name === 'string' && name.length > 0) names.add(name)
  }
  return names
}

/** 已随 dsh 加载（bundle 层）：扫描 dsh-base / dsh-web-app 的 cordis.patch.yml。 */
export function readBundlePluginNames(workspaceDir: string): Set<string> {
  const names = new Set<string>()
  const candidates = [
    path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'),
    path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml'),
    path.join(workspaceDir, 'data', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'),
    path.join(workspaceDir, 'data', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml')
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    try {
      const parsed = yaml.load(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(parsed)) for (const n of collectNames(parsed)) names.add(n)
    } catch {
      // 忽略损坏的补丁文件
    }
  }
  return names
}

/** 功能插件状态总览。 */
export function getPluginStates(workspaceDir: string): PluginState[] {
  const userNames = collectNames(readUserPatch(workspaceDir))
  const bundleNames = readBundlePluginNames(workspaceDir)
  return BUILTIN_PLUGINS.map((p) => ({
    ...p,
    enabledInBundle: bundleNames.has(p.name),
    enabledByUser: userNames.has(p.name)
  }))
}

/** 启用 / 停用功能插件（写用户层补丁，保留 skill-filesystem 等既有条目）。 */
export function setPluginEnabled(
  workspaceDir: string,
  pkgName: string,
  enabled: boolean
): { ok: boolean; error?: string } {
  const info = BUILTIN_PLUGINS.find((p) => p.name === pkgName)
  if (!info) return { ok: false, error: `未知插件：${pkgName}` }
  try {
    const entries = readUserPatch(workspaceDir)
    const without = entries.filter((e) => !(e && typeof e === 'object' && (e as { id?: unknown }).id === info.id))
    if (enabled) without.push({ id: info.id, name: info.name })
    fs.mkdirSync(path.dirname(homePatchPath(workspaceDir)), { recursive: true })
    fs.writeFileSync(homePatchPath(workspaceDir), yaml.dump(without, { lineWidth: -1 }), 'utf8')
    logger.info(`插件 ${pkgName} 已${enabled ? '启用' : '停用'}（用户层补丁）`)
    return { ok: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error(`切换插件 ${pkgName} 失败：${reason}`)
    return { ok: false, error: `切换失败：${reason}` }
  }
}

/** profile 目录（web）。 */
function profileDir(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'profiles', 'web')
}

/** 读取 profile package.json（不存在返回 null）。 */
function readProfileManifest(workspaceDir: string): { dependencies: Record<string, string> } | null {
  const p = path.join(profileDir(workspaceDir), 'package.json')
  if (!fs.existsSync(p)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    return { dependencies: raw.dependencies ?? {} }
  } catch {
    return null
  }
}

/** 已安装插件清单（profile 的 pnpm dependencies）。 */
export function listInstalledPlugins(workspaceDir: string): InstalledPluginInfo[] {
  const manifest = readProfileManifest(workspaceDir)
  if (!manifest) return []
  const userNames = collectNames(readUserPatch(workspaceDir))
  const out: InstalledPluginInfo[] = []
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    out.push({
      name,
      version: version.replace(/^\^/, ''),
      bundle: declaresBundle(workspaceDir, name),
      enabled: userNames.has(name)
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 包是否声明 dsh.bundle（可自动成为 profile 层）。 */
function declaresBundle(workspaceDir: string, pkgName: string): boolean {
  const candidates = [
    path.join(profileDir(workspaceDir), 'node_modules', ...pkgName.split('/')),
    path.join(workspaceDir, 'data', 'profiles', 'node_modules', ...pkgName.split('/')),
    path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', ...pkgName.split('/'))
  ]
  for (const dir of candidates) {
    const pj = path.join(dir, 'package.json')
    if (!fs.existsSync(pj)) continue
    try {
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
      return Boolean(j.dsh?.bundle?.patch !== undefined)
    } catch {
      continue
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// 在线市场（npmmirror 搜索，中文关键词映射）
// ---------------------------------------------------------------------------

/** 中文功能词 → npm 检索词（覆盖 dsh 插件常用的英文描述）。 */
const CN_KEYWORD_MAP: Array<[RegExp, string[]]> = [
  [/搜索|联网/, ['web-search', 'search']],
  [/网页|浏览器|抓取/, ['web', 'browser', 'fetch']],
  [/数据库|sql|查询/, ['database', 'sql', 'query']],
  [/mcp/i, ['mcp']],
  [/技能/, ['skill']],
  [/定时|计划|调度/, ['schedule', 'cron']],
  [/备份/, ['backup']],
  [/会话/, ['session']],
  [/模型|llm/, ['llm', 'model']],
  [/标题/, ['title']],
  [/统计/, ['stats', 'statistics']],
  [/日志/, ['log']],
  [/导出|下载/, ['export', 'download']],
  [/工具/, ['tool']],
  [/终端|shell/, ['terminal', 'shell', 'bash']]
]

/**
 * 中文功能词 → npm 检索词（覆盖 dsh 插件常用的英文描述）。
 * 含中文时返回纯英文映射（npm 全文索引不匹配中文）；无映射时原样返回。
 */
export function expandQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return ''
  const hasCjk = /[\u4e00-\u9fff]/.test(trimmed)
  const extra: string[] = []
  for (const [re, terms] of CN_KEYWORD_MAP) {
    if (re.test(trimmed)) extra.push(...terms)
  }
  if (hasCjk) {
    const mapped = [...new Set(extra)]
    return mapped.length > 0 ? mapped.join(' ') : trimmed
  }
  return [...new Set([trimmed, ...extra])].join(' ')
}

/** 直接按包名查询元数据（适用于插件名称查询，如 @deepseek-ai/dsh-mcp-client）。 */
async function fetchPackageMeta(name: string): Promise<NpmPluginHit | null> {
  try {
    const res = await fetch(`https://registry.npmmirror.com/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      name?: unknown
      description?: unknown
      'dist-tags'?: { latest?: unknown }
      time?: Record<string, string>
    }
    if (typeof j.name !== 'string') return null
    const latest = typeof j['dist-tags']?.latest === 'string' ? j['dist-tags'].latest : ''
    const author = ''
    const date = typeof j.time?.[latest] === 'string' ? j.time[latest] : ''
    return {
      name: j.name,
      version: latest,
      description: typeof j.description === 'string' ? j.description : '',
      author: author || undefined,
      keywords: [],
      date,
      url: `https://www.npmjs.com/package/${encodeURIComponent(j.name)}`
    }
  } catch {
    return null
  }
}

/** npm 搜索（npmmirror 镜像）：包名查询走直查，功能词走全文检索 + 中文映射过滤。 */
export async function searchNpmPlugins(
  query: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; hits: NpmPluginHit[]; error?: string }> {
  const raw = query.trim()
  if (!raw) return { ok: true, hits: [] }

  // 包名查询：直接拉元数据（精确，不受镜像搜索索引影响）
  if (/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(raw) && !/[\u4e00-\u9fff]/.test(raw)) {
    const meta = await fetchPackageMeta(raw)
    if (meta) return { ok: true, hits: [meta] }
    // 直查未命中 → 退化为全文搜索（如常见词 mcp、skill）
  }

  const expanded = expandQuery(raw)
  if (!expanded) return { ok: true, hits: [] }
  const url = `https://registry.npmmirror.com/-/v1/search?text=${encodeURIComponent(expanded)}&size=30`
  try {
    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(15000)
    })
    if (!res.ok) return { ok: false, hits: [], error: `搜索服务返回 HTTP ${res.status}` }
    const body = (await res.json()) as { objects?: Array<{ package?: Record<string, unknown> }> }
    let hits: NpmPluginHit[] = []
    for (const obj of Array.isArray(body?.objects) ? body.objects : []) {
      const p = obj?.package
      if (!p || typeof p !== 'object') continue
      const name = typeof p.name === 'string' ? p.name : ''
      if (!name) continue
      const links = p.links && typeof p.links === 'object' ? (p.links as { homepage?: unknown }) : undefined
      hits.push({
        name,
        version: typeof p.version === 'string' ? p.version : '',
        description: typeof p.description === 'string' ? p.description : '',
        author:
          p.author && typeof p.author === 'object' && typeof (p.author as { name?: unknown }).name === 'string'
            ? (p.author as { name: string }).name
            : undefined,
        keywords: Array.isArray(p.keywords) ? p.keywords.map((k) => String(k)) : [],
        date: typeof p.date === 'string' ? p.date : '',
        url: typeof links?.homepage === 'string' ? links.homepage : undefined
      })
    }
    // 中文功能词查询：只保留命中映射词的条目，过滤无关库
    const hasCjk = /[\u4e00-\u9fff]/.test(raw)
    if (hasCjk) {
      const mapped = expandQuery(raw).split(' ').filter(Boolean)
      if (mapped.length > 0) {
        hits = hits.filter((h) => {
          const hay = `${h.name} ${h.description} ${h.keywords.join(' ')}`.toLowerCase()
          return mapped.some((t) => hay.includes(t.toLowerCase()))
        })
      }
    }
    // dsh 生态优先
    hits.sort((a, b) => Number(b.name.includes('@deepseek-ai')) - Number(a.name.includes('@deepseek-ai')))
    return { ok: true, hits }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, hits: [], error: '搜索超时（15 秒）' }
    }
    return { ok: false, hits: [], error: `搜索失败：${reason}` }
  }
}

// ---------------------------------------------------------------------------
// 安装 / 卸载（dsh plugin --profile web …）
// ---------------------------------------------------------------------------

export interface PluginOpCallbacks {
  log: (chunk: string) => void
}

function dshEnv(workspaceDir: string): NodeJS.ProcessEnv {
  return { ...buildChildEnv(workspaceDir), ...buildDshEnv(workspaceDir) }
}

/** 安装插件：dsh plugin --profile web add <spec>（pnpm），并做 bundle 层核对。 */
export async function installPlugin(
  workspaceDir: string,
  pkgSpec: string,
  cbs: PluginOpCallbacks,
  signal?: AbortSignal
): Promise<{ ok: boolean; error?: string; bundle?: boolean }> {
  const nodeExe = path.join(workspaceDir, 'runtime', 'node', 'node.exe')
  const dshBin = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.existsSync(nodeExe)) return { ok: false, error: '未找到便携 Node（请先在环境检测中安装）' }
  if (!fs.existsSync(dshBin)) return { ok: false, error: '未找到 dsh 运行时' }
  cbs.log(`安装 ${pkgSpec} …`)
  const result = await runCommand({
    command: nodeExe,
    args: [dshBin, 'plugin', '--profile', 'web', 'add', pkgSpec],
    cwd: workspaceDir,
    env: dshEnv(workspaceDir),
    timeoutMs: 300_000,
    signal,
    onStdout: (chunk) => cbs.log(chunk),
    onStderr: (chunk) => cbs.log(chunk)
  })
  if (result.aborted) return { ok: false, error: '已取消' }
  if (result.error || result.code !== 0) {
    const tail = (result.stderr || result.stdout).split('\n').slice(-6).join('\n')
    return { ok: false, error: `安装失败：${result.error ?? `退出码 ${result.code}`}\n${tail}` }
  }
  const pkgName = pkgSpec.split('@')[0].trim()
  const bundle = declaresBundle(workspaceDir, pkgName)
  logger.info(`插件 ${pkgSpec} 安装完成（bundle=${bundle}）`)
  return { ok: true, bundle }
}

/** 卸载插件：dsh plugin --profile web remove <pkg>。 */
export async function uninstallPlugin(
  workspaceDir: string,
  pkgName: string,
  cbs: PluginOpCallbacks,
  signal?: AbortSignal
): Promise<{ ok: boolean; error?: string }> {
  const nodeExe = path.join(workspaceDir, 'runtime', 'node', 'node.exe')
  const dshBin = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.existsSync(nodeExe)) return { ok: false, error: '未找到便携 Node' }
  if (!fs.existsSync(dshBin)) return { ok: false, error: '未找到 dsh 运行时' }
  cbs.log(`卸载 ${pkgName} …`)
  const result = await runCommand({
    command: nodeExe,
    args: [dshBin, 'plugin', '--profile', 'web', 'remove', pkgName],
    cwd: workspaceDir,
    env: dshEnv(workspaceDir),
    timeoutMs: 300_000,
    signal,
    onStdout: (chunk) => cbs.log(chunk),
    onStderr: (chunk) => cbs.log(chunk)
  })
  if (result.aborted) return { ok: false, error: '已取消' }
  if (result.error || result.code !== 0) {
    const tail = (result.stderr || result.stdout).split('\n').slice(-6).join('\n')
    return { ok: false, error: `卸载失败：${result.error ?? `退出码 ${result.code}`}\n${tail}` }
  }
  // 同时清掉用户层补丁中对应的启用条目（如存在）
  const entries = readUserPatch(workspaceDir).filter(
    (e) => !(e && typeof e === 'object' && (e as { name?: unknown }).name === pkgName)
  )
  fs.writeFileSync(homePatchPath(workspaceDir), yaml.dump(entries, { lineWidth: -1 }), 'utf8')
  logger.info(`插件 ${pkgName} 卸载完成`)
  return { ok: true }
}
