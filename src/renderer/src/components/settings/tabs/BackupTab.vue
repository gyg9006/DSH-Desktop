<script setup lang="ts">
/**
 * Tab5：备份与恢复（规格 6.21~6.25）。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened, Refresh } from '@element-plus/icons-vue'
import type { BackupEntryPayload, BackupSettingsPayload } from '@shared/ipc'

const backups = ref<BackupEntryPayload[]>([])
const busy = ref(false)
const settings = ref<BackupSettingsPayload>({ enabled: false, period: 'daily', keep: 5 })
const includeRuntime = ref(false)
const exporting = ref(false)

onMounted(() => {
  void refresh()
  void loadSettings()
})

async function refresh(): Promise<void> {
  backups.value = await window.dshw.listBackups()
}

async function loadSettings(): Promise<void> {
  settings.value = await window.dshw.getBackupSettings()
}

async function saveSettings(): Promise<void> {
  // contextBridge 传参需可结构化克隆的普通对象（响应式 Proxy 会抛 DataCloneError）
  const result = await window.dshw.setBackupSettings(JSON.parse(JSON.stringify(settings.value)))
  if (result.ok) ElMessage.success('自动备份设置已保存')
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${units[i]}`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 取文件名（渲染进程无 node:path）。 */
function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

async function createBackup(): Promise<void> {
  busy.value = true
  try {
    const result = await window.dshw.createBackup()
    if (result.ok && result.sizeBytes !== undefined) {
      ElMessage.success(`备份完成（${formatSize(result.sizeBytes)}）`)
    } else {
      ElMessage.error(result.error ?? '备份失败')
    }
    await refresh()
  } finally {
    busy.value = false
  }
}

async function restore(name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `恢复备份「${name}」将用备份内容覆盖当前 data/skills/plugins/config 目录。` +
        '\n\n注意：换机后请在新机器上重新执行环境检测安装，数据无损（备份不含运行环境）。' +
        '\n\n此操作不可撤销，确定继续吗？',
      '恢复备份（危险操作）',
      { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'error', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busy.value = true
  try {
    const entry = backups.value.find((b) => b.name === name)
    if (!entry) return
    const result = await window.dshw.restoreBackup(entry.path)
    if (result.ok) {
      ElMessage.success('备份已恢复')
    } else {
      ElMessage.error(result.error ?? '恢复失败')
    }
  } finally {
    busy.value = false
  }
}

async function removeBackup(name: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除备份「${name}」吗？`, '删除备份', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  const result = await window.dshw.deleteBackup(name)
  if (result.ok) ElMessage.success('已删除')
  else ElMessage.error(result.error ?? '删除失败')
  await refresh()
}

/** 从外部备份文件恢复（选择任意 .zip，如换机后从 U 盘/网盘拷贝来的备份）。 */
async function restoreFromFile(): Promise<void> {
  const picked = await window.dshw.chooseFile('选择备份文件（backup-*.zip）', [{ name: '备份文件', extensions: ['zip'] }])
  if (!picked.ok || !picked.path) return
  try {
    await ElMessageBox.confirm(
      `恢复备份「${basename(picked.path)}」将用备份内容覆盖当前 data/skills/plugins/config 目录。` +
        '\n\n注意：换机后请在新机器上重新执行环境检测安装，数据无损（备份不含运行环境）。' +
        '\n\n此操作不可撤销，确定继续吗？',
      '恢复备份（危险操作）',
      { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'error', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  busy.value = true
  try {
    const result = await window.dshw.restoreBackup(picked.path)
    if (result.ok) {
      ElMessage.success('备份已恢复')
      ElMessageBox.alert('恢复完成。为避免旧数据残留，建议重启应用（设置 → 日志与关于 → 重启）后再继续使用。', '恢复完成', {
        confirmButtonText: '知道了'
      }).catch(() => undefined)
    } else {
      ElMessage.error(result.error ?? '恢复失败')
    }
  } finally {
    busy.value = false
  }
}

async function exportAll(): Promise<void> {
  const picked = await window.dshw.chooseDirectory('选择导出目标位置（U 盘 / 网盘目录）')
  if (!picked.ok || !picked.path) return
  exporting.value = true
  try {
    const result = await window.dshw.exportWorkspace(picked.path, includeRuntime.value)
    if (result.ok) {
      ElMessage.success(`导出完成（${result.sizeBytes !== undefined ? formatSize(result.sizeBytes) : ''}）到 ${picked.path}`)
    } else {
      ElMessage.error(result.error ?? '导出失败')
    }
  } finally {
    exporting.value = false
  }
}

const hasBackups = computed(() => backups.value.length > 0)
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">备份与恢复</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      备份打包 data / skills / plugins / config（不含 runtime 运行环境）；换机后重新执行一次环境检测安装即可，数据无损。
    </p>

    <div class="mt-5 space-y-5">
      <!-- 6.21 一键备份 -->
      <section class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-medium text-gray-700 dark:text-gray-200">一键备份</div>
            <div class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">带时间戳 zip 存入 backups/</div>
          </div>
          <el-button size="small" type="primary" :loading="busy" @click="createBackup()">一键备份</el-button>
        </div>
      </section>

      <!-- 6.23 从备份文件恢复（独立入口，换机/应急时使用） -->
      <section class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-medium text-gray-700 dark:text-gray-200">从备份文件恢复</div>
            <div class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">选择任意 backup-*.zip 恢复（含从 U 盘 / 网盘拷贝来的备份），将覆盖当前 data / skills / plugins / config</div>
          </div>
          <el-button size="small" type="warning" plain :loading="busy" @click="restoreFromFile()">选择备份并恢复</el-button>
        </div>
      </section>

      <!-- 6.22 自动备份 -->
      <section class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="flex items-center justify-between">
          <div class="text-xs font-medium text-gray-700 dark:text-gray-200">自动备份</div>
          <el-switch v-model="settings.enabled" size="small" @change="saveSettings()" />
        </div>
        <div v-if="settings.enabled" class="mt-3 flex flex-wrap items-center gap-4">
          <label class="text-xs text-gray-500 dark:text-gray-400">
            周期
            <el-select v-model="settings.period" size="small" class="ml-2 !w-28" @change="saveSettings()">
              <el-option value="daily" label="每天" />
              <el-option value="weekly" label="每周" />
            </el-select>
          </label>
          <label class="text-xs text-gray-500 dark:text-gray-400">
            保留份数
            <el-input-number v-model="settings.keep" :min="1" :max="50" size="small" class="ml-2 !w-28" @change="saveSettings()" />
          </label>
        </div>
      </section>

      <!-- 6.23 备份列表与恢复 -->
      <section class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-gray-700 dark:text-gray-200">备份列表</span>
          <el-button size="small" text @click="refresh()">
            <el-icon class="mr-1"><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
        <div v-if="hasBackups" class="max-h-56 space-y-1 overflow-y-auto">
          <div
            v-for="entry in backups"
            :key="entry.name"
            class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-[#1D2026]"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs text-gray-700 dark:text-gray-200" :title="entry.name">{{ entry.name }}</div>
              <div class="text-[10px] text-gray-400 dark:text-gray-500">{{ formatTime(entry.mtime) }} · {{ formatSize(entry.sizeBytes) }}</div>
            </div>
            <el-button size="small" text type="danger" @click="restore(entry.name)">恢复</el-button>
            <el-button size="small" text @click="removeBackup(entry.name)">删除</el-button>
          </div>
        </div>
        <p v-else class="text-xs text-gray-400 dark:text-gray-500">暂无备份。可使用上方「从备份文件恢复」选择外部备份，或先「一键备份」。</p>
      </section>

      <!-- 6.24 导出全部 -->
      <section class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="text-xs font-medium text-gray-700 dark:text-gray-200">导出全部（便于换机）</div>
        <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">整目录复制到指定位置（U 盘 / 网盘目录）。</p>
        <div class="mt-2 flex items-center gap-3">
          <el-checkbox v-model="includeRuntime" size="small">包含 runtime/（体积大，换机后可重新安装）</el-checkbox>
          <el-button size="small" type="primary" plain :loading="exporting" @click="exportAll()">
            <el-icon class="mr-1"><FolderOpened /></el-icon>
            选择位置并导出
          </el-button>
        </div>
      </section>
    </div>
  </div>
</template>
