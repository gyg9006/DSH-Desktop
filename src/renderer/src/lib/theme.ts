import type { ActiveThemePayload } from '@shared/ipc'

const CSS_VAR_STYLE_ID = 'dshw-theme-vars'
const THEME_LINK_ID = 'dshw-active-theme'

/** hex → "r g b"（Tailwind alpha 修饰符）。 */
function hexToRgbChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** tokens（主进程已归一化的结构）→ :root CSS 变量（含 RGB 通道变量）。 */
function tokensToVars(tokens: Record<string, unknown>): string {
  const colors = (tokens.colors ?? {}) as Record<string, string>
  const lines: string[] = []
  const map: Array<[string, string | undefined]> = [
    ['--color-primary', colors.primary],
    ['--color-secondary', colors.secondary],
    ['--color-bg', colors.background],
    ['--color-panel', colors.surface],
    ['--color-panel2', colors['surface-elevated']],
    ['--color-text', colors['text-primary']],
    ['--color-dim', colors['text-secondary']],
    ['--color-border', colors.border],
    ['--color-accent', colors.accent],
    ['--color-green', colors.success],
    ['--color-amber', colors.warning],
    ['--color-red', colors.error]
  ]
  for (const [k, v] of map) {
    if (!v) continue
    lines.push(`  ${k}: ${v};`)
    const rgb = hexToRgbChannels(v)
    if (rgb) lines.push(`  ${k}-rgb: ${rgb};`)
  }
  const typo = (tokens.typography ?? {}) as Record<string, string>
  if (typo['font-family']) lines.push(`  --font-family: ${typo['font-family']};`)
  if (typo['font-mono']) lines.push(`  --font-mono: ${typo['font-mono']};`)
  const radii = (tokens.radii ?? {}) as Record<string, string>
  for (const [k, v] of Object.entries(radii)) lines.push(`  --radius-${k}: ${v};`)
  const shadows = (tokens.shadows ?? {}) as Record<string, string>
  for (const [k, v] of Object.entries(shadows)) lines.push(`  --shadow-${k}: ${v};`)
  if (typeof tokens.spacing === 'object' && tokens.spacing && 'unit' in tokens.spacing) {
    lines.push(`  --spacing-unit: ${(tokens.spacing as { unit: number }).unit}px;`)
  }
  return lines.join('\n')
}

/** 应用客户端主题：注入 CSS 变量 + 主题样式表（热切换）。 */
export function applyClientTheme(theme: ActiveThemePayload): void {
  const root = document.documentElement
  // 1) CSS 变量（:root）
  let style = document.getElementById(CSS_VAR_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = CSS_VAR_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = `:root {\n${tokensToVars(theme.tokens)}\n}`

  // 2) 主题 CSS（theme.css 热替换）
  let link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null
  if (theme.css) {
    if (!link) {
      link = document.createElement('link')
      link.id = THEME_LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    const css = theme.css
    link.textContent = ''
    link.href = ''
    // 用 style 注入（避免 href blob 生命周期问题）
    link.remove()
    const styleEl = document.createElement('style')
    styleEl.id = THEME_LINK_ID
    styleEl.textContent = css
    document.head.appendChild(styleEl)
  } else if (link) {
    link.remove()
  }

  // 3) 明暗模式
  root.classList.toggle('dark', theme.darkMode)
  root.style.colorScheme = theme.darkMode ? 'dark' : 'light'
}
