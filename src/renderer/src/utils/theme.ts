import type { ThemeMode } from '../../../shared/ipc'

const media = window.matchMedia('(prefers-color-scheme: dark)')

/** 应用主题：深色 / 浅色 / 跟随系统。 */
export function applyThemeMode(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'system' && media.matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** 跟随系统模式下监听系统主题变化。 */
export function watchSystemTheme(callback: () => void): () => void {
  const handler = (): void => callback()
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}
