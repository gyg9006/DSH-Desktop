<script setup lang="ts">
/**
 * Tab6：日志与关于（规格 6.26~6.27）。
 * 含版本更新：自动/手动模式选择、检查更新、下载进度、应用更新。
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Download, Delete, Filter, WarningFilled, CircleCheck, SwitchButton } from '@element-plus/icons-vue'
import type { UpdateEventPayload, UpdateMode } from '@shared/ipc'

type LogPane = 'app' | 'dsh'
const pane = ref<LogPane>('app')
const logs = ref<{ app: string[]; dsh: string[] }>({ app: [], dsh: [] })
const keyword = ref('')
const loading = ref(false)
const about = ref({
  appVersion: '',
  electron: '',
  chrome: '',
  dshVersion: '',
  nodeVersion: '',
  gitVersion: ''
})

onMounted(() => {
  void refreshLogs()
  void loadAbout()
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

async function loadAbout(): Promise<void> {
  const info = await window.dshw.getAppInfo()
  const dshPkg = await window.dshw.detectEnv().catch(() => null)
  const dshItem = dshPkg?.items.find((i) => i.key === 'dsh')
  const nodeItem = dshPkg?.items.find((i) => i.key === 'node')
  const gitItem = dshPkg?.items.find((i) => i.key === 'git')
  about.value = {
    appVersion: info.appVersion,
    electron: info.electron,
    chrome: info.chrome,
    dshVersion: dshItem?.version ?? '未安装',
    nodeVersion: nodeItem?.version ?? '未检测',
    gitVersion: gitItem?.version ?? '未检测'
  }
}

const updateResult = ref('')
const checking = ref(false)

// 更新模式（自动/手动）
const updateMode = ref<UpdateMode>('auto')
const updateReady = ref<{ version?: string; notes?: string; assetId?: number; size?: number; downloadUrl?: string } | null>(null)
const downloadPercent = ref(0)
const downloading = ref(false)
const downloadedPath = ref('')
const applying = ref(false)

let unsubUpdate: (() => void) | null = null

onMounted(async () => {
  void refreshLogs()
  void loadAbout()
  void loadUpdateSettings()
  unsubUpdate = window.dshw.onUpdateEvent(handleUpdateEvent)
})

onBeforeUnmount(() => {
  unsubUpdate?.()
})

function handleUpdateEvent(event: UpdateEventPayload): void {
  if (event.phase === 'downloading' && typeof event.percent === 'number') {
    downloadPercent.value = event.percent
    updateResult.value = event.message ?? '正在下载更新…'
  } else if (event.phase === 'downloaded') {
    downloadPercent.value = 100
    downloading.value = false
    updateResult.value = event.message ?? '更新已下载完成'
  } else if (event.phase === 'found') {
    updateResult.value = event.message ?? '发现新版本'
  } else if (event.phase === 'error') {
    downloading.value = false
    updateResult.value = event.error ?? event.message ?? '更新失败'
  }
}

async function loadUpdateSettings(): Promise<void> {
  const settings = await window.dshw.getUpdateSettings()
  updateMode.value = settings.mode === 'manual' ? 'manual' : 'auto'
}

async function saveUpdateMode(mode: UpdateMode): Promise<void> {
  await window.dshw.setUpdateSettings({ mode })
  if (mode === 'auto') {
    ElMessage.success('已开启自动更新：应用将定期检测新版本并自动下载')
  } else {
    ElMessage.success('已切换为手动更新：需要时点击「检查更新」')
  }
}

async function checkUpdate(): Promise<void> {
  checking.value = true
  updateReady.value = null
  try {
    const result = await window.dshw.checkUpdate()
    updateResult.value = `${result.message}（当前 v${result.current}${result.latest ? ' → 最新 v' + result.latest : ''}）`
    if (result.hasUpdate) {
      updateReady.value = {
        version: result.latest,
        notes: result.notes,
        assetId: result.assetId,
        size: result.size,
        downloadUrl: result.downloadUrl
      }
      if (result.assetId === undefined) {
        updateResult.value = `${result.message}：请前往 GitHub 发布页手动下载更新包`
      }
    }
  } finally {
    checking.value = false
  }
}

async function cancelDownload(): Promise<void> {
  await window.dshw.cancelUpdateDownload()
}

async function startDownload(): Promise<void> {
  if (!updateReady.value?.assetId) {
    ElMessage.warning('该版本未提供自动更新包，请手动下载')
    if (updateReady.value?.downloadUrl) {
      void window.dshw.openExternal(updateReady.value.downloadUrl)
    }
    return
  }
  downloading.value = true
  downloadPercent.value = 0
  updateResult.value = '正在下载更新…'
  const result = await window.dshw.downloadUpdate(updateReady.value.assetId)
  if (result.ok && result.path) {
    downloadedPath.value = result.path
    updateResult.value = '更新包下载完成，点击「重启并更新」完成安装'
  } else if (!result.canceled) {
    ElMessage.error(result.error ?? '下载失败')
  }
  downloading.value = false
}

async function applyNow(): Promise<void> {
  if (!downloadedPath.value) return
  try {
    await ElMessageBox.confirm(
      '将停止 dsh 服务并重启应用完成更新（约 10 秒）。重启后自动进入新版本，确定继续？',
      '应用更新',
      { confirmButtonText: '重启并更新', cancelButtonText: '稍后', type: 'warning' }
    )
  } catch {
    return
  }
  applying.value = true
  updateResult.value = '正在应用更新…'
  const result = await window.dshw.applyUpdate(downloadedPath.value)
  if (!result.ok) {
    applying.value = false
    ElMessage.error(result.error ?? '应用更新失败')
  }
  // 成功时主进程即将退出，无需恢复状态
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
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">日志与关于</h3>

    <!-- 6.26 日志 -->
    <section class="mt-4">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <el-radio-group v-model="pane" size="small">
          <el-radio-button value="app">应用日志</el-radio-button>
          <el-radio-button value="dsh">dsh 运行日志</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          size="small"
          placeholder="关键字过滤"
          clearable
          class="!w-44"
        >
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

    <!-- 6.27 关于 -->
    <section class="mt-5 rounded-lg border border-gray-100 p-4 dark:border-[#23262C]">
      <h4 class="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">关于</h4>
      <div class="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
        <div class="flex justify-between text-gray-600 dark:text-gray-300"><span>应用版本</span><span class="font-medium">v{{ about.appVersion }}</span></div>
        <div class="flex justify-between text-gray-600 dark:text-gray-300"><span>DeepSeek Harness（dsh）</span><span class="font-medium">{{ about.dshVersion }}</span></div>
        <div class="flex justify-between text-gray-600 dark:text-gray-300"><span>Node.js</span><span class="font-medium">{{ about.nodeVersion }}</span></div>
        <div class="flex justify-between text-gray-600 dark:text-gray-300"><span>Git</span><span class="font-medium">{{ about.gitVersion }}</span></div>
        <div class="flex justify-between text-gray-600 dark:text-gray-300"><span>Electron</span><span class="font-medium">{{ about.electron }}</span></div>
        <div class="flex justify-between text-gray-600 dark:text-gray-300"><span>Chromium</span><span class="font-medium">{{ about.chrome }}</span></div>
      </div>
      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-500 dark:text-gray-400">更新方式</span>
          <el-radio-group v-model="updateMode" size="small" @change="saveUpdateMode">
            <el-radio-button value="auto">
              <el-icon class="mr-1"><Refresh /></el-icon>自动更新
            </el-radio-button>
            <el-radio-button value="manual">
              <el-icon class="mr-1"><SwitchButton /></el-icon>手动更新
            </el-radio-button>
          </el-radio-group>
          <div class="flex-1"></div>
          <el-button size="small" type="primary" plain :loading="checking" @click="checkUpdate()">
            <el-icon class="mr-1"><Refresh /></el-icon>
            检查更新
          </el-button>
        </div>
        <p class="text-[11px] text-gray-400 dark:text-gray-500">
          自动更新：应用启动后与每 6 小时自动检测新版本并下载，下载完成后提示重启应用；
          手动更新：仅在点击「检查更新」时检测。
        </p>
        <div v-if="updateResult" class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <el-icon v-if="updateReady" class="text-green-500"><CircleCheck /></el-icon>
          <span>{{ updateResult }}</span>
          <span v-if="updateReady?.size" class="text-gray-400">（更新包 {{ (updateReady.size / 1024 / 1024).toFixed(1) }} MB）</span>
        </div>
        <div v-if="downloading || downloadPercent > 0" class="flex items-center gap-3">
          <el-progress :percentage="downloadPercent" :stroke-width="8" class="flex-1" />
          <el-button v-if="downloading" size="small" text type="danger" @click="cancelDownload()">取消</el-button>
        </div>
        <div v-if="updateReady?.notes" class="rounded-lg border border-gray-100 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-500 dark:border-[#23262C] dark:bg-[#16171B] dark:text-gray-400">
          <div class="mb-1 font-semibold text-gray-600 dark:text-gray-300">更新内容</div>
          <div class="whitespace-pre-wrap">{{ updateReady.notes }}</div>
        </div>
        <div v-if="updateReady && !downloadedPath" class="flex items-center gap-2">
          <el-button size="small" type="primary" :loading="downloading" @click="startDownload()">
            <el-icon class="mr-1"><Download /></el-icon>
            下载更新
          </el-button>
        </div>
        <div v-if="downloadedPath" class="flex items-center gap-2">
          <el-button size="small" type="success" :loading="applying" @click="applyNow()">
            <el-icon class="mr-1"><SwitchButton /></el-icon>
            重启并更新
          </el-button>
        </div>
      </div>
      <p class="mt-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        开源许可：本应用（MIT）与 DeepSeek Harness（MIT）均基于 MIT 协议开源；
        数据与配置全部保存在工作文件夹内，可随时整文件夹迁移。
      </p>
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
