<script setup lang="ts">
/**
 * 设置 Tab7：异地同步（需求：A/B 两台 PC 之间同步会话）。
 * 机制：基于便携 Git 管理 workspace/sync 仓库，同步会话与会话元数据（不含凭据）。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Download, Refresh } from '@element-plus/icons-vue'
import type { SyncConfigPayload } from '@shared/ipc'

const config = ref<SyncConfigPayload>({})
const counts = ref({ local: 0, remote: 0 })
const busy = ref('') // '', 'push', 'pull', 'forceRemote', 'forceLocal'
const resultMsg = ref('')

onMounted(() => {
  void refresh()
})

async function refresh(): Promise<void> {
  const data = await window.dshw.getSyncConfig()
  config.value = data.config
  counts.value = data.counts
}

async function save(): Promise<void> {
  const result = await window.dshw.setSyncConfig({
    remoteUrl: config.value.remoteUrl?.trim() || undefined,
    branch: config.value.branch?.trim() || 'main'
  })
  if (result.ok) ElMessage.success('同步配置已保存')
}

async function doAction(action: 'push' | 'pull' | 'forceRemote' | 'forceLocal'): Promise<void> {
  if (busy.value) return
  busy.value = action
  resultMsg.value = ''
  try {
    let result
    if (action === 'push') result = await window.dshw.syncPush()
    else if (action === 'pull') result = await window.dshw.syncPull()
    else if (action === 'forceRemote') result = await window.dshw.syncForceRemote()
    else result = await window.dshw.syncForceLocal()

    if (result.ok) {
      const n = result.pushed ?? result.pulled ?? 0
      resultMsg.value = action === 'push' ? `已上传到服务器（${n} 个文件）` : action === 'pull' ? `已下载到本地（${n} 个文件）` : `已完成`
      ElMessage.success(resultMsg.value)
    } else {
      resultMsg.value = result.error ?? '同步失败'
      ElMessage.error(resultMsg.value)
    }
    await refresh()
  } finally {
    busy.value = ''
  }
}

async function confirmForce(kind: 'remote' | 'local'): Promise<void> {
  const isRemote = kind === 'remote'
  try {
    await ElMessageBox.confirm(
      isRemote
        ? '以远端为准将丢弃本地的会话变更（reset 到远端版本）。确定继续？'
        : '以本地为准将强制上传并覆盖远端会话（push --force）。确定继续？',
      isRemote ? '以远端为准' : '以本地为准',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  await doAction(isRemote ? 'forceRemote' : 'forceLocal')
}

const lastSyncText = computed(() => {
  if (!config.value.lastSyncAt) return '尚未同步'
  const d = new Date(config.value.lastSyncAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `上次同步：${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">异地同步</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      在 A/B 两台电脑之间同步会话：A 用完「上传到服务器」，B 上「下载到本地」即可看到全部会话。基于 Git 同步
      <code>sessions/</code> 与会话元数据；凭据与配置绝不同步。
    </p>

    <div class="mt-5 space-y-4">
      <!-- 远端配置 -->
      <section class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">远端仓库（Git）</div>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-xs text-gray-500">仓库地址</span>
            <el-input
              v-model="config.remoteUrl"
              size="small"
              placeholder="https://github.com/you/dsh-sessions.git 或自建 Git 仓库地址"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-xs text-gray-500">分支</span>
            <el-input v-model="config.branch" size="small" placeholder="main" class="!w-36" />
          </div>
          <p class="text-[11px] text-gray-400 dark:text-gray-500">
            建议使用私有仓库（会话内容包含你的对话）；首次使用需在仓库端完成空仓库初始化。
          </p>
          <div>
            <el-button size="small" type="primary" plain @click="save()">保存配置</el-button>
          </div>
        </div>
      </section>

      <!-- 同步操作 -->
      <section class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-gray-700 dark:text-gray-200">同步会话</span>
          <span class="text-[11px] text-gray-400 dark:text-gray-500">
            本地 {{ counts.local }} · 远端 {{ counts.remote }} · {{ lastSyncText }}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <el-button size="small" type="primary" :loading="busy === 'push'" @click="doAction('push')">
            <el-icon class="mr-1"><Upload /></el-icon>
            上传到服务器
          </el-button>
          <el-button size="small" :loading="busy === 'pull'" @click="doAction('pull')">
            <el-icon class="mr-1"><Download /></el-icon>
            下载到本地
          </el-button>
          <el-button size="small" text @click="refresh()">
            <el-icon class="mr-1"><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
        <p v-if="resultMsg" class="mt-2 break-all text-xs" :class="resultMsg.includes('失败') || resultMsg.includes('冲突') ? 'text-red-500' : 'text-green-600'">
          {{ resultMsg }}
        </p>

        <div v-if="resultMsg.includes('冲突')" class="mt-2 rounded bg-amber-50 p-2.5 text-xs dark:bg-[#2A2415]">
          <p class="text-amber-600 dark:text-amber-400">检测到同步冲突（两端都修改了会话），请选择处理方式：</p>
          <div class="mt-2 flex gap-2">
            <el-button size="small" type="danger" plain @click="confirmForce('remote')">以远端为准</el-button>
            <el-button size="small" type="warning" plain @click="confirmForce('local')">以本地为准（强制推送）</el-button>
          </div>
        </div>
      </section>

      <!-- 说明 -->
      <section class="rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-500 dark:bg-[#16171B] dark:text-gray-400">
        <p>· 使用方式：PC A 工作结束后点击「上传到服务器」；PC B 打开应用点击「下载到本地」，即可看到 A 的全部会话并在本地继续对话。</p>
        <p>· 会话为追加式文件，正常情况下自动合并；仅当两端同时修改同一会话时可能出现冲突，届时按提示选择「以远端为准」或「以本地为准」。</p>
        <p>· 首次使用前，请先在远端（如 GitHub/Gitee 私有仓库）创建空仓库并取得地址。</p>
      </section>
    </div>
  </div>
</template>
