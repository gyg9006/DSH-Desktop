/**
 * 会话背景（需求五）纯逻辑：渐变预设 + CSS 背景串构造。
 */
import type { SessionBackgroundPayload } from '@shared/ipc'

/** 与 UI 风格匹配的渐变预设。 */
export const GRADIENT_PRESETS: Array<{ name: string; colors: string[] }> = [
  { name: '深空蓝紫', colors: ['#0f172a', '#1e1b4b'] },
  { name: '午夜蓝', colors: ['#111827', '#312e81'] },
  { name: '墨绿', colors: ['#1e293b', '#0f766e'] },
  { name: '炭黑', colors: ['#18181b', '#3f3f46'] },
  { name: '紫罗兰夜', colors: ['#2d1b4e', '#0f172a'] },
  { name: '深海', colors: ['#0c4a6e', '#1e3a8a'] },
  { name: '暗红', colors: ['#1c1917', '#7f1d1d'] },
  { name: '青墨', colors: ['#134e4a', '#1e293b'] }
]

/** 由配置构造背景 CSS（image 类型需外部提供 dataUrl，见 applySessionBackground）。 */
export function sessionBackgroundCss(cfg: SessionBackgroundPayload | undefined, imageDataUrl?: string): string {
  if (!cfg) return ''
  if (cfg.type === 'color') return cfg.color ?? ''
  if (cfg.type === 'gradient') {
    const colors = cfg.gradient?.filter(Boolean).join(', ') ?? ''
    return colors ? `linear-gradient(135deg, ${colors})` : ''
  }
  if (cfg.type === 'image') return imageDataUrl ? `url("${imageDataUrl}")` : ''
  return ''
}

/** 由背景 CSS 构造背景（含填充/透明度/模糊）。 */
export function backgroundStyle(cfg: SessionBackgroundPayload | undefined, imageDataUrl?: string): React.CSSProperties {
  const css = sessionBackgroundCss(cfg, imageDataUrl)
  if (!css) return {}
  const style: React.CSSProperties = {
    backgroundImage: css,
    backgroundSize: cfg?.fit === 'fill' ? '100% 100%' : cfg?.fit === 'contain' ? 'contain' : 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  }
  if (cfg?.opacity !== undefined && cfg.opacity < 1) style.opacity = cfg.opacity
  if (cfg?.blur) style.filter = `blur(${cfg.blur}px)`
  return style
}
