import { useCallback, useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/ipc'
import { applyClientTheme } from '../lib/theme'

/**
 * 应用主题：加载激活主题（tokens + theme.css）全局注入 CSS 变量，
 * 并同步 dsh ui settings（settings.yaml 热重载）与 Tailwind dark class。
 */
export function useTheme(): { theme: ThemeMode; setTheme: (t: ThemeMode) => Promise<void> } {
  const [theme, setThemeState] = useState<ThemeMode>('dark')

  useEffect(() => {
    // 主题全局化：注入激活主题的 CSS 变量与样式
    void window.dshw
      .themeGet()
      .then((t) => applyClientTheme(t))
      .catch(() => undefined)
    // 监听主题切换广播（设置页/插件等任何来源切换后全局即时生效）
    const unsubscribe = window.dshw.onThemeChanged((t) => applyClientTheme(t))
    // dsh 明暗偏好（历史兼容）
    void window.dshw
      .getDshUiSettings()
      .then((s) => {
        const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        document.documentElement.classList.toggle('dark', dark)
      })
      .catch(() => undefined)
    return unsubscribe
  }, [])

  const applyTheme = (t: ThemeMode): void => {
    setThemeState(t)
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  const setTheme = useCallback(async (t: ThemeMode): Promise<void> => {
    applyTheme(t)
    await window.dshw.setDshUiSettings({ theme: t })
  }, [])

  return { theme, setTheme }
}
