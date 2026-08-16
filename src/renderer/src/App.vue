<script setup lang="ts">
import { computed, onMounted, onErrorCaptured } from 'vue'
import { ElMessage } from 'element-plus'
import MainLayout from './components/MainLayout.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import Wizard from './components/wizard/Wizard.vue'
import { useAppStore } from './stores/app'
import { useUiStore } from './stores/ui'
import { useInstallStore } from './stores/install'
import { useMigrateStore } from './stores/migrate'
import { useServiceStore } from './stores/service'

const appStore = useAppStore()
const ui = useUiStore()
const installStore = useInstallStore()
const migrateStore = useMigrateStore()
const serviceStore = useServiceStore()

/** 向导未完成前主界面不可用（规格 7.2） */
const onboarded = computed(() => appStore.config?.onboarded === true)

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  window.dshw.reportLog('error', `界面异常：${message}`).catch(() => undefined)
  ElMessage.error(`界面出现异常：${message}`)
}

onMounted(async () => {
  try {
    await appStore.init()
  } catch (error) {
    reportError(error)
  }
  // 从配置恢复任务栏收起状态（状态持久化，规格 5.2）
  ui.sidebarCollapsed = appStore.config?.sidebarCollapsed === true
  // 安装/迁移事件流
  installStore.init()
  migrateStore.init()
  serviceStore.init()
  // 主进程全局快捷键（Ctrl+B / Ctrl+N / Ctrl+,）驱动
  window.dshw.onUiEvent((type) => {
    if (type === 'toggle-sidebar') ui.toggleSidebar()
    else if (type === 'new-chat') ui.newChat()
    else if (type === 'open-settings') ui.openSettings()
    else if (type === 'sidebar-data-changed') {
      // 重命名等操作后侧边栏数据已变：通知侧边栏刷新
      window.dispatchEvent(new CustomEvent('dshw:sidebar-data-changed'))
    }
  })
})

onErrorCaptured((error) => {
  reportError(error)
  return false
})
</script>

<template>
  <div class="h-screen w-screen overflow-hidden">
    <!-- 首次启动向导（未完成前主界面不可用） -->
    <Wizard v-if="!appStore.initialized || !onboarded" />
    <template v-else>
      <MainLayout />
      <SettingsDialog v-model:open="ui.settingsOpen" />
    </template>
  </div>
</template>
