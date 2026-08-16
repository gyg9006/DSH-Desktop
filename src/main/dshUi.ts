/**
 * 通用设置（与 dsh 客户端「通用设置 / Agent 预设」同步）：
 * - 语言   → settings.yaml 的 `locale.preference`（zh | en，dsh-client-locale 源码核实）
 * - 外观   → settings.yaml 的 `ui-theme.preference`（light | dark | system，dsh-client-ui-theme 源码核实）
 * - Agent 预设 → settings.yaml 的 `agent-presets.default`（预设 id，dsh-agent-presets 源码核实；
 *   预设 = 含 agent.cordis.yml 的目录，目录名为 id，preset.yml 提供显示名）
 * 全部写入 $DSH_HOME/settings.yaml（dsh-settings-file 热重载），与 dsh 网页端共用同一份配置。
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { logger } from './logger'
import type { AgentPresetInfo, DshUiSettingsPayload } from '../shared/ipc'

const SHIPPED_PRESETS_ROOT = ['runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets']

function settingsPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'settings.yaml')
}

function appConfigPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'app.json')
}

/** 读取应用配置中的 showDshSidebar（直接读文件，避免依赖 electron app 模块，便于单测）。 */
function readShowDshSidebar(workspaceDir: string): boolean {
  try {
    const p = appConfigPath(workspaceDir)
    if (!fs.existsSync(p)) return false
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { showDshSidebar?: unknown }
    return j.showDshSidebar === true
  } catch {
    return false
  }
}

/** 写应用配置 showDshSidebar（合并保留其它键，白名单语义由调用方保证）。 */
function writeShowDshSidebar(workspaceDir: string, value: boolean): void {
  const p = appConfigPath(workspaceDir)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  let current: Record<string, unknown> = {}
  try {
    if (fs.existsSync(p)) current = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
  } catch {
    // 损坏时从空配置重建
  }
  current.showDshSidebar = value
  fs.writeFileSync(p, JSON.stringify(current, null, 2), 'utf8')
}

function readSettingsDoc(workspaceDir: string): Record<string, unknown> {
  const p = settingsPath(workspaceDir)
  if (!fs.existsSync(p)) return {}
  try {
    const parsed = yaml.load(fs.readFileSync(p, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** 读取 Agent 预设清单：随 dsh 安装的（只读）+ $DSH_HOME/.agent-presets 用户自建。 */
export function listAgentPresets(workspaceDir: string): AgentPresetInfo[] {
  const out: AgentPresetInfo[] = []
  const shippedRoot = path.join(workspaceDir, ...SHIPPED_PRESETS_ROOT)
  const userRoot = path.join(workspaceDir, 'data', '.agent-presets')

  const scan = (root: string, shipped: boolean): void => {
    if (!fs.existsSync(root)) return
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name)
      if (!fs.existsSync(path.join(dir, 'agent.cordis.yml'))) continue
      let name = entry.name
      let description: string | undefined
      const metaPath = path.join(dir, 'preset.yml')
      if (fs.existsSync(metaPath)) {
        try {
          const meta = yaml.load(fs.readFileSync(metaPath, 'utf8')) as { name?: unknown; description?: unknown } | null
          name = str(meta?.name) ?? entry.name
          description = str(meta?.description)
        } catch {
          // 忽略损坏的元数据
        }
      }
      out.push({ id: entry.name, name, description, shipped })
    }
  }

  scan(shippedRoot, true)
  scan(userRoot, false)
  // 稳定排序：随 dsh 安装的在前（保持目录顺序 = order），用户自建在后
  const order = ['standard', 'code', 'minimal', 'cordis']
  return out.sort((a, b) => {
    if (a.shipped !== b.shipped) return a.shipped ? -1 : 1
    const ai = order.indexOf(a.id)
    const bi = order.indexOf(b.id)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

/** 读取当前通用设置（含默认值）。 */
export function readUiSettings(workspaceDir: string): {
  locale: 'zh' | 'en'
  theme: 'light' | 'dark' | 'system'
  defaultAgentPreset: string
  showDshSidebar: boolean
  presets: AgentPresetInfo[]
} {
  const doc = readSettingsDoc(workspaceDir)
  const localeRaw = str((doc.locale as Record<string, unknown> | undefined)?.preference)
  const themeRaw = str((doc['ui-theme'] as Record<string, unknown> | undefined)?.preference)
  const presetRaw = str((doc['agent-presets'] as Record<string, unknown> | undefined)?.default)
  const locale = localeRaw === 'en' ? 'en' : 'zh'
  const theme = themeRaw === 'light' || themeRaw === 'dark' || themeRaw === 'system' ? themeRaw : 'system'
  const defaultAgentPreset = presetRaw ?? 'standard'
  const showDshSidebar = readShowDshSidebar(workspaceDir)
  return { locale, theme, defaultAgentPreset, showDshSidebar, presets: listAgentPresets(workspaceDir) }
}

/**
 * 合并写入 settings.yaml 的命名空间段（保留其它段，如 ui-onboarding / llm-*）。
 * sections: { <namespace>: { <field>: value } } —— 按命名空间浅合并。
 */
export function mergeSettingsNamespaces(
  text: string | undefined,
  sections: Record<string, Record<string, unknown>>
): string {
  const existing: Record<string, unknown> = text && text.trim() ? ((yaml.load(text) as Record<string, unknown>) ?? {}) : {}
  const merged: Record<string, unknown> = { ...existing }
  for (const [ns, fields] of Object.entries(sections)) {
    const prev = existing[ns] && typeof existing[ns] === 'object' && !Array.isArray(existing[ns])
      ? (existing[ns] as Record<string, unknown>)
      : {}
    merged[ns] = { ...prev, ...fields }
  }
  return yaml.dump(merged, { lineWidth: -1, noRefs: true, noCompatMode: true, sortKeys: false })
}

/** 保存通用设置：写 settings.yaml 命名空间 + 应用配置（showDshSidebar）。 */
export function writeUiSettings(
  workspaceDir: string,
  patch: DshUiSettingsPayload
): { ok: boolean; error?: string; result?: ReturnType<typeof readUiSettings> } {
  try {
    const sections: Record<string, Record<string, unknown>> = {}
    if (patch.locale === 'zh' || patch.locale === 'en') sections.locale = { preference: patch.locale }
    if (patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'system') {
      sections['ui-theme'] = { preference: patch.theme }
    }
    if (typeof patch.defaultAgentPreset === 'string' && patch.defaultAgentPreset.trim()) {
      const presets = listAgentPresets(workspaceDir)
      if (!presets.some((p) => p.id === patch.defaultAgentPreset)) {
        return { ok: false, error: `未知的 Agent 预设：${patch.defaultAgentPreset}` }
      }
      sections['agent-presets'] = { default: patch.defaultAgentPreset.trim() }
    }
    if (Object.keys(sections).length > 0) {
      const p = settingsPath(workspaceDir)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined
      fs.writeFileSync(p, mergeSettingsNamespaces(text, sections), 'utf8')
      logger.info('通用设置已同步到 dsh（settings.yaml）')
    }
    if (typeof patch.showDshSidebar === 'boolean') {
      writeShowDshSidebar(workspaceDir, patch.showDshSidebar)
    }
    return { ok: true, result: readUiSettings(workspaceDir) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error(`保存通用设置失败：${reason}`)
    return { ok: false, error: `保存失败：${reason}` }
  }
}
