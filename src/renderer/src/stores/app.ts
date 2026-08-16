import { defineStore } from 'pinia'
import type { AppConfig, AppInfo, EnvReport } from '../../../shared/ipc'
import { applyThemeMode, watchSystemTheme } from '../utils/theme'

export const useAppStore = defineStore('app', {
  state: () => ({
    info: null as AppInfo | null,
    config: null as AppConfig | null,
    envReport: null as EnvReport | null,
    envChecking: false,
    initialized: false
  }),
  getters: {
    theme: (state): AppConfig['theme'] => state.config?.theme ?? 'system',
    workspacePath: (state): string => state.info?.workspacePath ?? ''
  },
  actions: {
    async init(): Promise<void> {
      await Promise.all([this.loadInfo(), this.loadConfig()])
      this.applyTheme()
      watchSystemTheme(() => this.applyTheme())
      this.initialized = true
    },
    async loadInfo(): Promise<void> {
      this.info = await window.dshw.getAppInfo()
    },
    async loadConfig(): Promise<void> {
      this.config = await window.dshw.getConfig()
    },
    async updateConfig(patch: Partial<AppConfig>): Promise<void> {
      const result = await window.dshw.updateConfig(patch)
      if (result.ok && result.config) {
        this.config = result.config
        this.applyTheme()
      }
    },
    applyTheme(): void {
      applyThemeMode(this.theme ?? 'system')
    },
    cycleTheme(): void {
      const order = ['light', 'dark', 'system'] as const
      const current = this.theme
      const next = order[(order.indexOf(current as (typeof order)[number]) + 1) % order.length]
      void this.updateConfig({ theme: next })
    },
    themeLabel(): string {
      switch (this.theme) {
        case 'light':
          return '浅色主题'
        case 'dark':
          return '深色主题'
        default:
          return '跟随系统主题'
      }
    },
    async refreshEnv(): Promise<void> {
      this.envChecking = true
      try {
        this.envReport = await window.dshw.detectEnv()
      } finally {
        this.envChecking = false
      }
    }
  }
})
