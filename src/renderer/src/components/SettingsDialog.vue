<script setup lang="ts">
import { computed } from 'vue'
import { Monitor, FolderOpened, Connection, Key, DataAnalysis, Document, RefreshLeft, Grid, Setting } from '@element-plus/icons-vue'
import { useUiStore } from '../stores/ui'
import EnvTab from './settings/tabs/EnvTab.vue'
import WorkspaceTab from './settings/tabs/WorkspaceTab.vue'
import ServiceTab from './settings/tabs/ServiceTab.vue'
import ApiTab from './settings/tabs/ApiTab.vue'
import BackupTab from './settings/tabs/BackupTab.vue'
import AboutTab from './settings/tabs/AboutTab.vue'
import SyncTab from './settings/tabs/SyncTab.vue'
import PluginTab from './settings/tabs/PluginTab.vue'
import GeneralTab from './settings/tabs/GeneralTab.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const ui = useUiStore()

interface TabDef {
  key: string
  name: string
  icon: unknown
  component: unknown
}

const tabs: TabDef[] = [
  { key: 'general', name: '通用设置', icon: Setting, component: GeneralTab },
  { key: 'env', name: '环境检测', icon: Monitor, component: EnvTab },
  { key: 'workspace', name: '工作文件夹', icon: FolderOpened, component: WorkspaceTab },
  { key: 'service', name: '服务与运行', icon: Connection, component: ServiceTab },
  { key: 'api', name: '模型与 API', icon: Key, component: ApiTab },
  { key: 'plugins', name: '插件', icon: Grid, component: PluginTab },
  { key: 'backup', name: '备份与恢复', icon: DataAnalysis, component: BackupTab },
  { key: 'sync', name: '异地同步', icon: RefreshLeft, component: SyncTab },
  { key: 'about', name: '日志与关于', icon: Document, component: AboutTab }
]

const activeTab = computed(() => tabs.find((t) => t.key === ui.settingsTab) ?? tabs[0])
</script>

<template>
  <el-dialog
    :model-value="props.open"
    width="960px"
    top="5vh"
    class="settings-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    destroy-on-close
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <template #header>
      <span class="text-base font-semibold text-gray-800 dark:text-gray-100">设置</span>
    </template>

    <div class="flex h-[580px]">
      <!-- 左侧 Tab 导航 -->
      <nav class="w-44 shrink-0 space-y-0.5 border-r border-gray-100 p-3 dark:border-[#23262C]">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
          :class="
            ui.settingsTab === tab.key
              ? 'bg-brand-50 font-medium text-brand dark:bg-brand-900/20'
              : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#1D2026]'
          "
          @click="ui.settingsTab = tab.key"
        >
          <el-icon :size="16"><component :is="tab.icon" /></el-icon>
          <span class="truncate">{{ tab.name }}</span>
        </button>
      </nav>

      <!-- 右侧内容 -->
      <div class="min-w-0 flex-1 overflow-y-auto p-5">
        <component :is="activeTab.component" />
      </div>
    </div>
  </el-dialog>
</template>
