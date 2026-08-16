<script setup lang="ts">
/**
 * Tab9：日志与初始化（规格 6.26 + 6.28）。
 * - 日志：应用日志 / dsh 运行日志，支持关键字过滤、刷新、导出 zip、清空。
 * - 初始化（出厂重置）：清除业务数据（保留运行环境）或完全重置，恢复首次启动状态。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Download, Delete, Filter, WarningFilled } from '@element-plus/icons-vue'

type LogPane = 'app' | 'dsh'
const pane = ref<LogPane>('app')
const logs = ref<{ app: string[]; dsh: string[] }>({ app: [], dsh: [] })
const keyword = ref('')
const loading = ref(false)

onMounted(() => {
  void refreshLogs()
})

async function refreshLogs(): Promise<void> {
  loading.value = true
  try {
    logs.value = await window.dshw.readLogs()
  } finally {
    loading.value = false
  }
}

const visibleLines = computed(() => {
  const lines = pane.value === 'app' ? logs.value.app : logs.value.dsh
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return lines
  return lines.filter((l) => l.toLowerCase().includes(kw))
})

async function clear(): Promise<void> {
  try {
    await ElMessageBox.confirm('确定清空全部日志吗？', '清空日志', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  const result = await window.dshw.clearLogs()
  if (result.ok) {
    ElMessage.success('日志已清空')
    await refreshLogs()
  } else {
    ElMessage.error(result.error ?? '清空失败')
  }
}

async function exportLogs(): Promise<void> {
  const result = await window.dshw.exportLogs()
  if (result.ok) ElMessage.success('日志已导出')
  else if (!result.canceled) ElMessage.error(result.error ?? '导出失败')
}

const resetting = ref(false)
async function confirmReset(keepRuntime: boolean): Promise<void> {
  try {
    await ElMessageBox.confirm(
      keepRuntime
        ? '将清除全部对话、技能、插件、API 凭据与工作路径配置（保留运行环境），恢复为首次启动状态。此操作不可撤销，确定继续？'
        : '将清除包括运行环境在内的全部内容，恢复为首次启动状态。此操作不可撤销，确定继续？',
      '初始化（危险操作）',
      { confirmButtonText: '确定重置', cancelButtonText: '取消', type: 'error', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  resetting.value = true
  try {
    const result = await window.dshw.resetApp(keepRuntime)
    if (result.ok) {
      ElMessage.success('已重置，应用即将重启进入初始化向导')
      await new Promise((r) => setTimeout(r, 1200))
      await window.dshw.relaunchApp()
    } else {
      ElMessage.error(result.message)
    }
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">日志与初始化</h3>

    <!-- 6.26 日志 -->
    <section class="mt-4">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <el-radio-group v-model="pane" size="small">
          <el-radio-button value="app">应用日志</el-radio-button>
          <el-radio-button value="dsh">dsh 运行日志</el-radio-button>
        </el-radio-group>
        <el-input v-model="keyword" size="small" placeholder="关键字过滤" clearable class="!w-44">
          <template #prefix><el-icon><Filter /></el-icon></template>
        </el-input>
        <div class="flex-1"></div>
        <el-button size="small" text @click="refreshLogs()">
          <el-icon class="mr-1"><Refresh /></el-icon>
          刷新
        </el-button>
        <el-button size="small" text @click="exportLogs()">
          <el-icon class="mr-1"><Download /></el-icon>
          导出 zip
        </el-button>
        <el-button size="small" text type="danger" @click="clear()">
          <el-icon class="mr-1"><Delete /></el-icon>
          清空
        </el-button>
      </div>
      <pre
        class="max-h-72 min-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-gray-100 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-600 dark:border-[#23262C] dark:bg-[#16171B] dark:text-gray-300"
      >{{ visibleLines.join('\n') || '（暂无日志）' }}</pre>
    </section>

    <!-- 初始化（出厂重置） -->
    <section class="mt-5 rounded-lg border border-red-100 p-4 dark:border-red-900/40">
      <h4 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
        <el-icon><WarningFilled /></el-icon>
        初始化（把应用交给别人前的出厂重置）
      </h4>
      <p class="mb-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        将清除你的对话记录、技能、插件、API 凭据与工作路径配置，恢复为全新状态（首次启动向导）。
        运行环境默认保留（别人拿到即可使用，无需重新下载）。
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <el-button size="small" type="danger" plain :loading="resetting" @click="confirmReset(true)">
          重置业务数据（保留运行环境）
        </el-button>
        <el-button size="small" type="danger" :loading="resetting" @click="confirmReset(false)">
          完全重置（连运行环境一起清除）
        </el-button>
      </div>
    </section>
  </div>
</template>
