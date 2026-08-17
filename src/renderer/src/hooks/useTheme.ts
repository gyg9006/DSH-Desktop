import { useCallback, useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/ipc'

/** 应用主题：同步 dsh ui settings（settings.yaml 热重载），并切换 Tailwind dark class。 */
export function useTheme(): { theme: ThemeMode; setTheme: (t: ThemeMode) => Promise<void> } {
  const [theme, setThemeState] = useState<ThemeMode>('dark')

  useEffect(() => {
    void window.dshw
      .getDshUiSettings()
      .then((s) => applyTheme(s.theme))
      .catch(() => undefined)
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
