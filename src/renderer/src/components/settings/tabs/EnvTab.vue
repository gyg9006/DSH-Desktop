<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, DocumentCopy, Close, VideoPlay } from '@element-plus/icons-vue'
import { useAppStore } from '../../../stores/app'
import { useInstallStore, INSTALL_KEY_LABELS } from '../../../stores/install'
import { envStateText } from '../../../utils/format'
import type { EnvItem, EnvItemKey, InstallKey, InstallMode } from '@shared/ipc'

const appStore = useAppStore()
const install = useInstallStore()

const items = computed<EnvItem[]>(() => appStore.envReport?.items ?? [])

function itemByKey(key: EnvItemKey): EnvItem | undefined {
  return items.value.find((i) => i.key === key)
}

/** 便携版缺失（来源非 portable）的项 —— 规格 4.1：默认使用便携版。 */
const portableMissingKeys = computed<InstallKey[]>(() =>
  items.value.filter((i) => i.source !== 'portable').map((i) => i.key as InstallKey)
)

const okKeys = computed<InstallKey[]>(() => items.value.filter((i) => i.state === 'ok').map((i) => i.key as InstallKey))

function dotClass(state: string): string {
  return `status-dot status-dot--${state === 'ok' ? 'running' : state === 'incompatible' ? 'starting' : 'stopped'}`
}

/**
 * 每项的操作按钮描述。
 * 便携版优先（规格 4.1）：只要便携版缺失就提供「一键安装」；
 * npm 需要便携 Node 就绪后才能安装。
 */
function actionFor(item: EnvItem): { label: string; mode: InstallMode; disabled: boolean; hint?: string } {
  if (item.key === 'npm') {
    if (item.source === 'portable' && item.state === 'ok') {
      return { label: '一键更新', mode: 'update', disabled: false }
    }
    const node = itemByKey('node')
    if (!node || node.source === 'none' || node.state === 'incompatible') {
      return { label: '一键安装', mode: 'install', disabled: true, hint: '请先安装便携版 Node.js' }
    }
    return { label: '一键安装', mode: 'install', disabled: false }
  }
  if (item.source === 'portable') {
    return { label: '一键更新', mode: 'update', disabled: false }
  }
  return { label: '一键安装', mode: 'install', disabled: false }
}

const isBusy = computed(() => install.running)

async function runOne(key: InstallKey, mode: InstallMode): Promise<void> {
  if (isBusy.value) {
    ElMessage.warning('已有安装任务进行中')
    return
  }
  const result = await install.run(key, mode)
  await appStore.refreshEnv()
  if (result.ok) {
    ElMessage.success(`${INSTALL_KEY_LABELS[key]}${mode === 'update' ? '更新' : '安装'}成功`)
  } else if (result.cancelled) {
    ElMessage.info('任务已取消')
  } else {
    ElMessage.error(`${INSTALL_KEY_LABELS[key]}${mode === 'update' ? '更新' : '安装'}失败`)
  }
}

/** 一键安装便携版缺失项（按依赖顺序：Node → npm → pnpm → Git → dsh）。 */
async function installMissingAll(): Promise<void> {
  if (isBusy.value) return
  const order: InstallKey[] = ['node', 'npm', 'pnpm', 'git', 'dsh']
  for (const key of order) {
    const item = itemByKey(key)
    if (!item || item.source === 'portable') continue
    const result = await install.run(key, 'install')
    await appStore.refreshEnv()
    if (!result.ok && !result.cancelled) {
      ElMessage.error(`${INSTALL_KEY_LABELS[key]} 安装失败，已停止后续安装`)
      return
    }
    if (result.cancelled) return
  }
  ElMessage.success('便携版缺失项已全部安装')
}

/** 一键更新全部已安装的便携版。 */
async function updateAll(): Promise<void> {
  if (isBusy.value) return
  for (const key of okKeys.value) {
    const item = itemByKey(key)
    if (item?.source !== 'portable') continue
    const result = await install.run(key, 'update')
    await appStore.refreshEnv()
    if (!result.ok && !result.cancelled) {
      ElMessage.error(`${INSTALL_KEY_LABELS[key]} 更新失败，已停止后续更新`)
      return
    }
    if (result.cancelled) return
  }
  ElMessage.success('已全部更新')
}

// 打开设置即自动检测（规格 6.1）
onMounted(() => {
  if (!appStore.envReport) void appStore.refreshEnv()
})

// 日志自动滚动到底部
const logBox = ref<HTMLElement | null>(null)
watch(
  () => install.logs.length,
  async () => {
    await nextTick()
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
  }
)
</script>

<template>
  <div>
    <!-- 标题 + 顶部操作 -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">环境检测</h3>
        <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          便携版优先，其次系统版本；安装/更新产物全部落在工作文件夹的 runtime/ 内，可随文件夹迁移。
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        <el-button size="small" :loading="appStore.envChecking" @click="appStore.refreshEnv()">
          <el-icon class="mr-1"><Refresh /></el-icon>
          全部重新检测
        </el-button>
        <el-tooltip :disabled="portableMissingKeys.length > 0" content="便携版均已就绪">
          <el-button size="small" type="primary" :disabled="isBusy || portableMissingKeys.length === 0" @click="installMissingAll()">
            一键安装全部缺失项
          </el-button>
        </el-tooltip>
        <el-tooltip :disabled="okKeys.length > 0" content="当前没有已安装的便携版">
          <el-button size="small" :disabled="isBusy || okKeys.length === 0" @click="updateAll()">
            一键更新全部
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 检测列表 -->
    <div class="mt-4 space-y-2">
      <div
        v-for="item in items"
        :key="item.key"
        class="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 dark:border-[#2a2a2c]"
      >
        <span :class="dotClass(item.state)"></span>
        <div class="w-36 shrink-0 text-sm font-medium text-gray-700 dark:text-gray-200">{{ item.name }}</div>
        <div class="min-w-0 flex-1">
          <template v-if="item.state === 'ok'">
            <span class="text-sm text-gray-700 dark:text-gray-200">{{ item.version }}</span>
            <span :class="item.source === 'portable' ? 'source-chip source-chip--portable' : 'source-chip source-chip--system'">
              {{ item.source === 'portable' ? '便携版' : '系统' }}
            </span>
            <span v-if="item.source === 'system'" class="ml-2 text-xs text-amber-500">建议安装便携版（默认使用）</span>
          </template>
          <template v-else>
            <span class="text-sm text-gray-500 dark:text-gray-400">{{ envStateText(item.state) }}</span>
            <span v-if="item.message" class="ml-2 text-xs text-gray-400 dark:text-gray-500">{{ item.message }}</span>
          </template>
        </div>
        <div class="w-24 shrink-0 text-right">
          <el-tooltip :disabled="!actionFor(item).disabled" :content="actionFor(item).hint ?? ''">
            <el-button
              size="small"
              :type="item.state === 'ok' ? 'default' : 'primary'"
              :disabled="isBusy || actionFor(item).disabled"
              @click="runOne(item.key as InstallKey, actionFor(item).mode)"
            >
              {{ actionFor(item).label }}
            </el-button>
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- 安装/更新日志区（规格 6.4：实时滚动日志 + 进度 + 取消 + 复制错误信息） -->
    <div
      v-if="isBusy || install.status !== 'idle'"
      class="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-[#2a2a2c] dark:bg-[#161617]"
    >
      <div class="mb-2 flex items-center justify-between">
        <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <el-icon :class="isBusy ? 'animate-spin text-brand' : ''"><VideoPlay /></el-icon>
          <span>
            任务：
            <template v-if="install.currentKey">{{ INSTALL_KEY_LABELS[install.currentKey] }}（{{ install.mode === 'update' ? '更新' : '安装' }}）</template>
            <template v-else>—</template>
          </span>
          <span v-if="install.status === 'done'" class="status-chip status-chip--success">完成</span>
          <span v-else-if="install.status === 'error'" class="status-chip status-chip--danger">失败</span>
          <span v-else-if="install.status === 'cancelled'" class="status-chip status-chip--info">已取消</span>
          <span v-else class="status-chip status-chip--warning">进行中</span>
        </div>
        <div class="flex items-center gap-2">
          <el-button v-if="isBusy" size="small" @click="install.cancel()">取消</el-button>
          <template v-else>
            <el-button v-if="install.status === 'error'" size="small" type="danger" plain @click="install.copyError()">
              <el-icon class="mr-1"><DocumentCopy /></el-icon>
              复制错误信息
            </el-button>
            <el-button size="small" @click="install.clear()">
              <el-icon class="mr-1"><Close /></el-icon>
              清除
            </el-button>
          </template>
        </div>
      </div>

      <el-progress
        v-if="isBusy"
        :percentage="install.progress ?? 0"
        :indeterminate="install.progress === null"
        :stroke-width="8"
        :duration="2"
        class="mb-2"
      />

      <pre
        ref="logBox"
        class="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-white p-2 font-mono text-[11px] leading-relaxed text-gray-700 dark:bg-[#0f0f10] dark:text-gray-300"
      >{{ install.logs.join('\n') || '（等待任务输出…）' }}</pre>
    </div>
  </div>
</template>
