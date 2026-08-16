import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { useServiceStore } from './service'

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarCollapsed: false,
    settingsOpen: false,
    settingsTab: 'env' as string,
    /** 侧边栏视图：会话列表 / 设置面板 */
    sidebarView: 'chat' as 'chat' | 'settings'
  }),
  actions: {
    async setSidebarCollapsed(value: boolean): Promise<void> {
      this.sidebarCollapsed = value
      await window.dshw.updateConfig({ sidebarCollapsed: value })
    },
    toggleSidebar(): void {
      void this.setSidebarCollapsed(!this.sidebarCollapsed)
    },
    setSidebarView(view: 'chat' | 'settings'): void {
      this.sidebarView = view
    },
    openSettings(tab?: string): void {
      if (tab) this.settingsTab = tab
      this.settingsOpen = true
    },
    closeSettings(): void {
      this.settingsOpen = false
    },
    /** 新建对话：服务运行中则回到对话根页（dsh web 内部管理会话）。 */
    newChat(): void {
      const service = useServiceStore()
      if (service.status === 'running' && service.port) {
        window.dispatchEvent(new CustomEvent('dshw:new-chat'))
      } else {
        ElMessage.info('请先启动服务')
      }
    },
    /** 启动/停止服务（对接 dshService）。 */
    async toggleService(): Promise<void> {
      const service = useServiceStore()
      if (service.status === 'running' || service.status === 'starting') {
        await service.stop()
      } else {
        const result = await service.start()
        if (!result.ok && result.error) {
          ElMessage.error(result.error)
        }
      }
    }
  }
})
