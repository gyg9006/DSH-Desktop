<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { CaretRight, Setting } from '@element-plus/icons-vue'
import AppLogo from '../AppLogo.vue'
import { useAppStore } from '../../stores/app'
import { useUiStore } from '../../stores/ui'
import { useServiceStore } from '../../stores/service'
import { truncateMiddle } from '../../utils/format'
import type { EnvItem } from '@shared/ipc'

const appStore = useAppStore()
const ui = useUiStore()
const service = useServiceStore()

onMounted(() => {
  void appStore.refreshEnv()
})

async function startService(): Promise<void> {
  const result = await service.start()
  if (!result.ok && result.error) {
    ElMessage.error(result.error)
  }
}

const items = computed<EnvItem[]>(() => appStore.envReport?.items ?? [])

const shortPath = computed(() => truncateMiddle(appStore.workspacePath, 30))

function dotClass(state: string): string {
  return `status-dot status-dot--${state === 'ok' ? 'running' : state === 'incompatible' ? 'starting' : 'stopped'}`
}

function shortName(name: string): string {
  const m = /^(Node\.js|npm|pnpm|Git|DeepSeek Harness)/.exec(name)
  return m ? m[1] : name
}

async function openWorkspace(): Promise<void> {
  const result = await window.dshw.openWorkspaceFolder()
  if (!result.ok) ElMessage.error(result.error ?? '打开失败')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 居中 Hero（对齐 DeepSeek Harness 空态） -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-16">
      <AppLogo :size="64" />
      <h1 class="mt-6 text-[26px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
        DSH 桌面
      </h1>
      <p class="mt-3 max-w-md text-center text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        DeepSeek Harness 便携桌面客户端 —— 对话、技能与数据全部收纳在一个文件夹中，拷贝即迁移
      </p>

      <div class="mt-10 flex items-center gap-3">
        <el-button type="primary" size="large" round :loading="service.starting" @click="startService()">
          <el-icon class="mr-1.5"><CaretRight /></el-icon>
          一键启动服务
        </el-button>
        <el-button size="large" round @click="ui.openSettings()">
          <el-icon class="mr-1.5"><Setting /></el-icon>
          打开设置
        </el-button>
      </div>

      <!-- 环境状态条：紧凑、克制 -->
      <div class="mt-14 flex items-center gap-5">
        <div v-for="item in items" :key="item.key" class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span :class="dotClass(item.state)"></span>
          <span>{{ shortName(item.name) }}</span>
        </div>
      </div>

      <p class="mt-6 text-xs text-gray-400 dark:text-gray-600">
        工作文件夹：{{ shortPath || '尚未设置' }}
        <el-button text size="small" class="!px-1" @click="openWorkspace()">打开</el-button>
      </p>
    </div>
  </div>
</template>
