/**
 * 主题插件全局化：Design Token → 全局 CSS 变量注入 + 主题 CSS 热切换。
 *
 * - 主题插件目录：<workspace>/themes/<id>/（theme-plugin.json + tokens.json + theme.css [+ tray-icon.png]）
 * - 激活主题：<workspace>/config/theme.json（{"active":"default"}）
 * - 内置默认主题：当前赛博朋克色板（tokens 映射同结构）
 * - 应用机制：启动/切换时把 tokens 映射为 :root CSS 变量并注入每个窗口；
 *   theme.css 作为全局样式表（<link id="active-theme">）热替换；
 *   原生层：窗口背景色 / 托盘图标（tray-icon.png）/ nativeTheme 明暗同步。
 */
import fs from 'node:fs'
import path from 'node:path'
import { nativeTheme } from 'electron'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'

export interface ThemeColors {
  primary: string
  secondary: string
  background: string
  surface: string
  'surface-elevated': string
  'text-primary': string
  'text-secondary': string
  border: string
  accent: string
  success: string
  warning: string
  error: string
  [k: string]: string
}

export interface ThemeTokens {
  colors: Partial<ThemeColors>
  typography?: { 'font-family'?: string; 'font-mono'?: string }
  radii?: Record<string, string>
  shadows?: Record<string, string>
  spacing?: { unit?: number }
  animations?: Record<string, string>
}

export interface ThemePluginMeta {
  id: string
  name: string
  version: string
  author?: string
  type?: string
  scope?: string
  entry?: string
  tokens?: string
  preview?: string
  darkMode?: boolean
  compatibility?: string
}

export interface ThemeInfo {
  id: string
  name: string
  version: string
  author?: string
  darkMode: boolean
  isDefault: boolean
  hasPreview: boolean
}

/** 默认主题（内置赛博朋克色板）。 */
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  colors: {
    primary: '#00E5FF',
    secondary: '#8B5CF6',
    background: '#0A0C12',
    surface: '#10131C',
    'surface-elevated': '#161A26',
    'text-primary': '#E6EAF2',
    'text-secondary': '#8B93A7',
    border: '#1E2433',
    accent: '#F0ABFC',
    success: '#22E584',
    warning: '#FFB020',
    error: '#FF4D6A'
  },
  typography: { 'font-family': "'Segoe UI','PingFang SC','Microsoft YaHei',system-ui,sans-serif", 'font-mono': "'JetBrains Mono',Consolas,monospace" },
  radii: { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
  shadows: { card: '0 4px 16px rgba(0,0,0,0.3)', popup: '0 8px 40px rgba(0,0,0,0.5)' },
  spacing: { unit: 4 },
  animations: { 'duration-fast': '150ms', 'duration-normal': '300ms' }
}

export interface ActiveThemePayload {
  id: string
  name: string
  darkMode: boolean
  tokens: ThemeTokens
  /** theme.css 内容（默认主题为空串） */
  css: string
  /** 主题目录（含 tray-icon.png 时原生层可切换托盘图标） */
  dir: string | null
  hasTrayIcon: boolean
}

function themesRoot(workspaceDir: string): string {
  return path.join(workspaceDir, 'themes')
}

function themeDir(workspaceDir: string, id: string): string {
  return path.join(themesRoot(workspaceDir), id)
}

function activeThemeFile(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'theme.json')
}

export function getActiveThemeId(workspaceDir: string): string {
  const raw = readJsonFile(activeThemeFile(workspaceDir))
  if (raw && typeof raw === 'object' && typeof (raw as { active?: string }).active === 'string') {
    return (raw as { active: string }).active
  }
  return 'default'
}

function setActiveThemeId(workspaceDir: string, id: string): void {
  writeJsonAtomic(activeThemeFile(workspaceDir), { active: id })
}

/** 扫描主题插件目录（仅 type=theme 且 scope=application 的插件）。 */
export function listThemes(workspaceDir: string): ThemeInfo[] {
  const out: ThemeInfo[] = [{ id: 'default', name: '赛博朋克（默认）', version: '1.0.0', darkMode: true, isDefault: true, hasPreview: false }]
  const root = themesRoot(workspaceDir)
  if (!fs.existsSync(root)) return out
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(root, entry.name, 'theme-plugin.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ThemePluginMeta
      if (meta.type !== 'theme' || (meta.scope && meta.scope !== 'application')) continue
      out.push({
        id: meta.id || entry.name,
        name: meta.name || entry.name,
        version: meta.version || '0.0.0',
        author: meta.author,
        darkMode: meta.darkMode !== false,
        isDefault: false,
        hasPreview: Boolean(meta.preview && fs.existsSync(path.join(root, entry.name, meta.preview)))
      })
    } catch (error) {
      logger.warn(`主题插件解析失败（${entry.name}）：${String(error)}`)
    }
  }
  return out
}

/** 读取主题 tokens（插件 tokens.json 与默认合并；缺失回退默认）。 */
export function getThemeTokens(workspaceDir: string, id: string): ThemeTokens {
  if (id === 'default') return DEFAULT_THEME_TOKENS
  const dir = themeDir(workspaceDir, id)
  const tokensPath = path.join(dir, 'tokens.json')
  if (!fs.existsSync(tokensPath)) return DEFAULT_THEME_TOKENS
  try {
    const plugin = JSON.parse(fs.readFileSync(tokensPath, 'utf8')) as ThemeTokens
    return {
      colors: { ...DEFAULT_THEME_TOKENS.colors, ...(plugin.colors ?? {}) },
      typography: { ...DEFAULT_THEME_TOKENS.typography, ...(plugin.typography ?? {}) },
      radii: { ...DEFAULT_THEME_TOKENS.radii, ...(plugin.radii ?? {}) },
      shadows: { ...DEFAULT_THEME_TOKENS.shadows, ...(plugin.shadows ?? {}) },
      spacing: { ...DEFAULT_THEME_TOKENS.spacing, ...(plugin.spacing ?? {}) },
      animations: { ...DEFAULT_THEME_TOKENS.animations, ...(plugin.animations ?? {}) }
    }
  } catch (error) {
    logger.warn(`主题 tokens 读取失败（${id}）：${String(error)}`)
    return DEFAULT_THEME_TOKENS
  }
}

/** 读取主题 css（theme.css 内容；默认主题为空）。 */
export function getThemeCss(workspaceDir: string, id: string): string {
  if (id === 'default') return ''
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(themeDir(workspaceDir, id), 'theme-plugin.json'), 'utf8')) as ThemePluginMeta
    const entry = manifest.entry ?? 'theme.css'
    const cssPath = path.join(themeDir(workspaceDir, id), entry)
    return fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
  } catch {
    return ''
  }
}

/** hex → "r g b"（供 Tailwind alpha 修饰符使用）。 */
export function hexToRgbChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** tokens → CSS 自定义属性（:root 注入内容；含 RGB 通道变量供透明度修饰）。 */
export function tokensToCssVars(tokens: ThemeTokens): string {
  const c = tokens.colors ?? {}
  const lines: string[] = []
  const map: Array<[string, string | undefined]> = [
    ['--color-primary', c.primary],
    ['--color-secondary', c.secondary],
    ['--color-bg', c.background],
    ['--color-panel', c.surface],
    ['--color-panel2', c['surface-elevated']],
    ['--color-text', c['text-primary']],
    ['--color-dim', c['text-secondary']],
    ['--color-border', c.border],
    ['--color-accent', c.accent],
    ['--color-green', c.success],
    ['--color-amber', c.warning],
    ['--color-red', c.error]
  ]
  for (const [k, v] of map) {
    if (!v) continue
    lines.push(`  ${k}: ${v};`)
    const rgb = hexToRgbChannels(v)
    if (rgb) lines.push(`  ${k}-rgb: ${rgb};`)
  }
  if (tokens.typography?.['font-family']) lines.push(`  --font-family: ${tokens.typography['font-family']};`)
  if (tokens.typography?.['font-mono']) lines.push(`  --font-mono: ${tokens.typography['font-mono']};`)
  if (tokens.radii) {
    for (const [k, v] of Object.entries(tokens.radii)) lines.push(`  --radius-${k}: ${v};`)
  }
  if (tokens.shadows) {
    for (const [k, v] of Object.entries(tokens.shadows)) lines.push(`  --shadow-${k}: ${v};`)
  }
  if (tokens.spacing?.unit) lines.push(`  --spacing-unit: ${tokens.spacing.unit}px;`)
  if (tokens.animations) {
    for (const [k, v] of Object.entries(tokens.animations)) lines.push(`  --anim-${k}: ${v};`)
  }
  return lines.join('\n')
}

/** 获取激活主题完整配置（渲染层注入用）。 */
export function getActiveTheme(workspaceDir: string): ActiveThemePayload {
  const id = getActiveThemeId(workspaceDir)
  const info = listThemes(workspaceDir).find((t) => t.id === id)
  const darkMode = info?.darkMode ?? true
  const dir = id === 'default' ? null : themeDir(workspaceDir, id)
  const hasTrayIcon = dir ? fs.existsSync(path.join(dir, 'tray-icon.png')) : false
  return {
    id,
    name: info?.name ?? '赛博朋克（默认）',
    darkMode,
    tokens: getThemeTokens(workspaceDir, id),
    css: getThemeCss(workspaceDir, id),
    dir,
    hasTrayIcon
  }
}

/** 切换激活主题（返回新主题配置 + 同步 nativeTheme）。 */
export function setActiveTheme(workspaceDir: string, id: string): ActiveThemePayload | null {
  const info = listThemes(workspaceDir).find((t) => t.id === id)
  if (!info) {
    logger.warn(`主题不存在：${id}`)
    return null
  }
  setActiveThemeId(workspaceDir, id)
  try {
    nativeTheme.themeSource = info.darkMode ? 'dark' : 'light'
  } catch {
    /* ignore */
  }
  logger.info(`主题已切换：${info.name}`)
  return getActiveTheme(workspaceDir)
}

/** 启动时同步 nativeTheme（读取持久化主题）。 */
export function syncNativeThemeFromActive(workspaceDir: string): void {
  try {
    const theme = getActiveTheme(workspaceDir)
    nativeTheme.themeSource = theme.darkMode ? 'dark' : 'light'
  } catch {
    /* ignore */
  }
}

/** 激活主题的背景色（窗口创建时用）。 */
export function getActiveThemeBackground(workspaceDir: string): string {
  const theme = getActiveTheme(workspaceDir)
  return theme.tokens.colors?.background ?? '#0A0C12'
}
