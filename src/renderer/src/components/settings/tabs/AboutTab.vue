<script setup lang="ts">
/**
 * Tab10：关于（规格 6.27）。
 * 展示客户端版本号 + dsh / Node / Git 版本号与更新方式（自动/手动、检查更新、下载、应用）。
 */
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Download, CircleCheck, SwitchButton } from '@element-plus/icons-vue'
import type { UpdateEventPayload, UpdateMode } from '@shared/ipc'

const about = ref({
  appVersion: '',
  electron: '',
  chrome: '',
  dshVersion: '',
  nodeVersion: '',
  gitVersion: ''
})

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
  await loadAbout()
  await loadUpdateSettings()
  unsubUpdate = window.dshw.onUpdateEvent(handleUpdateEvent)
})

onBeforeUnmount(() => {
  unsubUpdate?.()
})

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
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">关于</h3>

    <!-- 版本信息卡片 -->
    <section class="mt-4 rounded-lg border border-gray-100 bg-gradient-to-r from-[#F7F9FF] to-white p-4 dark:border-[#23262C] dark:from-[#171A20] dark:to-[#15171B]">
      <div class="flex items-center gap-3">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E2A78] to-[#3B82F6] text-sm font-bold text-white">DSH</div>
        <div class="min-w-0">
          <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">DSH 桌面</div>
          <div class="text-[11px] text-gray-400 dark:text-gray-500">DeepSeek Harness 便携式桌面客户端</div>
        </div>
        <div class="flex-1"></div>
        <div class="text-right">
          <div class="text-2xl font-bold text-gray-900 dark:text-gray-50">v{{ about.appVersion }}</div>
          <div class="text-[10px] text-gray-400 dark:text-gray-500">客户端版本</div>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400 sm:grid-cols-4">
        <span>dsh：<strong class="font-medium text-gray-700 dark:text-gray-200">{{ about.dshVersion }}</strong></span>
        <span>Node：<strong class="font-medium text-gray-700 dark:text-gray-200">{{ about.nodeVersion }}</strong></span>
        <span>Git：<strong class="font-medium text-gray-700 dark:text-gray-200">{{ about.gitVersion }}</strong></span>
        <span>Electron：<strong class="font-medium text-gray-700 dark:text-gray-200">{{ about.electron }}</strong></span>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400 sm:grid-cols-4">
        <span>Chromium：<strong class="font-medium text-gray-700 dark:text-gray-200">{{ about.chrome }}</strong></span>
      </div>
    </section>

    <!-- 更新方式 -->
    <section class="mt-4 rounded-lg border border-gray-100 p-4 dark:border-[#23262C]">
      <h4 class="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">更新方式</h4>
      <div class="space-y-3">
        <div class="flex items-center gap-3">
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
  </div>
</template>
