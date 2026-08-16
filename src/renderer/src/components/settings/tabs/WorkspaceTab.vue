<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  FolderOpened,
  FolderChecked,
  Refresh,
  SwitchButton,
  EditPen,
  DataLine
} from '@element-plus/icons-vue'
import { useAppStore } from '../../../stores/app'
import { useMigrateStore } from '../../../stores/migrate'
import { validateWorkspacePathInput } from '../../../utils/workspaceValidation'
import type { DshDataItemKey, DshDataSource, MigrateConflictPolicy, WorkspaceInfo } from '@shared/ipc'
import { truncateMiddle } from '../../../utils/format'

const appStore = useAppStore()
const migrate = useMigrateStore()

// ---------- 工作文件夹信息 ----------
const workspaceInfo = ref<WorkspaceInfo | null>(null)

async function refreshWorkspaceInfo(): Promise<void> {
  workspaceInfo.value = await window.dshw.getWorkspaceInfo()
}

onMounted(() => {
  void refreshWorkspaceInfo()
})

async function openWorkspaceFolder(): Promise<void> {
  const result = await window.dshw.openWorkspaceFolder()
  if (!result.ok) ElMessage.error(result.error ?? '打开失败')
}

// ---------- 更改工作文件夹（6.6 / 6.10） ----------
const showManualInput = ref(false)
const manualPath = ref('')
const manualError = ref('')
const changing = ref(false)

function onManualInput(): void {
  manualError.value = manualPath.value.trim() ? validateWorkspacePathInput(manualPath.value) : ''
}

async function applyManualInput(): Promise<void> {
  manualError.value = validateWorkspacePathInput(manualPath.value)
  if (manualError.value) return
  await applyWorkspaceChange(manualPath.value.trim())
}

async function applyWorkspaceChange(newPath: string): Promise<void> {
  if (changing.value) return
  changing.value = true
  try {
    const result = await window.dshw.setWorkspacePath(newPath)
    if (!result.ok) {
      ElMessage.error(result.error ?? '更改失败')
      return
    }
    try {
      await ElMessageBox.confirm(
        '工作文件夹已更改，重启后生效。是否立即重启应用？',
        '重启生效',
        { confirmButtonText: '立即重启', cancelButtonText: '稍后手动重启', type: 'warning' }
      )
      await window.dshw.relaunchApp()
    } catch {
      /* 用户选择稍后重启 */
    }
  } finally {
    changing.value = false
  }
}

async function chooseWorkspaceFolder(): Promise<void> {
  const result = await window.dshw.chooseWorkspaceFolder()
  if (result.ok && result.path) {
    await applyWorkspaceChange(result.path)
  }
}

// ---------- 迁移（6.8） ----------
const selectedSourcePath = ref<string | null>(null)
const selectedItems = ref<Set<DshDataItemKey>>(new Set())
const plan = ref<{ entryCount: number; conflicts: string[] } | null>(null)
const conflictPolicy = ref<MigrateConflictPolicy>('rename')
const planning = ref(false)

const sources = computed(() => migrate.sources)

function sourceHasData(source: DshDataSource): boolean {
  return source.items.some((i) => i.exists && i.count > 0)
}

function selectSource(source: DshDataSource): void {
  selectedSourcePath.value = source.path
  selectedItems.value = new Set(
    source.items.filter((i) => i.exists && i.count > 0).map((i) => i.key)
  )
  plan.value = null
}

async function runScan(): Promise<void> {
  await migrate.scan()
  const usable = sources.value.filter(sourceHasData)
  if (usable.length > 0 && !selectedSourcePath.value) {
    // 默认选择数据最多的非工作文件夹源
    const best = [...usable]
      .sort((a, b) => b.totalSessions + b.totalSkills - (a.totalSessions + a.totalSkills))
      .find((s) => !s.isWorkspaceData) ?? usable[0]
    selectSource(best)
  } else {
    plan.value = null
  }
}

async function planMigration(): Promise<void> {
  if (!selectedSourcePath.value || selectedItems.value.size === 0) return
  planning.value = true
  try {
    plan.value = await window.dshw.planMigration(selectedSourcePath.value, [...selectedItems.value])
  } finally {
    planning.value = false
  }
}

async function startMigration(): Promise<void> {
  if (!selectedSourcePath.value || selectedItems.value.size === 0) return
  const result = await migrate.run(selectedSourcePath.value, [...selectedItems.value], conflictPolicy.value)
  if (result.ok) {
    ElMessage.success('迁移完成（源文件保留在原位置，可手动清理）')
  } else if (result.cancelled) {
    ElMessage.info('迁移已取消')
  } else {
    ElMessage.error(result.error ?? '迁移失败')
  }
}

// 日志自动滚动
const logBox = ref<HTMLElement | null>(null)
watch(
  () => migrate.logs.length,
  async () => {
    await nextTick()
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
  }
)

// ---------- 目录结构说明（6.7） ----------
const DIR_TREE = [
  { dir: 'runtime/', desc: '便携运行环境：node/（Node.js）、git/（Portable Git）、dsh/（DeepSeek Harness 本体）' },
  { dir: 'data/', desc: 'dsh 业务数据：对话记录（sessions/）、设置、凭据、profiles、storages（经 DSH_HOME 指向）' },
  { dir: 'skills/', desc: '用户 skills（已接入 dsh 技能根）' },
  { dir: 'plugins/', desc: '插件' },
  { dir: 'config/', desc: '应用与 API 配置（JSON）、窗口状态、Electron 缓存' },
  { dir: 'backups/', desc: '备份产物' },
  { dir: 'logs/', desc: '应用与运行日志' }
]

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

const shortPath = computed(() => truncateMiddle(workspaceInfo.value?.workspacePath ?? appStore.workspacePath, 46))
</script>

<template>
  <div class="space-y-5">
    <!-- 工作文件夹（6.6 / 6.9 / 6.10） -->
    <section class="rounded-lg border border-gray-100 p-4 dark:border-[#2a2a2c]">
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        <el-icon><FolderOpened /></el-icon>
        工作文件夹
      </h4>
      <div class="flex flex-wrap items-center gap-2">
        <code class="min-w-0 flex-1 break-all rounded bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:bg-[#161617] dark:text-gray-300">
          {{ shortPath }}
        </code>
        <el-button size="small" @click="openWorkspaceFolder()">
          <el-icon class="mr-1"><FolderChecked /></el-icon>
          打开文件夹
        </el-button>
        <el-button size="small" @click="chooseWorkspaceFolder()">
          <el-icon class="mr-1"><SwitchButton /></el-icon>
          更改…
        </el-button>
        <el-button size="small" text @click="showManualInput = !showManualInput">
          <el-icon class="mr-1"><EditPen /></el-icon>
          手动输入
        </el-button>
      </div>

      <div v-if="showManualInput" class="mt-3">
        <div class="flex items-center gap-2">
          <el-input
            v-model="manualPath"
            size="small"
            placeholder="输入绝对路径，如 D:\MyData"
            @input="onManualInput()"
            @keyup.enter="applyManualInput()"
          />
          <el-button size="small" type="primary" :disabled="changing" @click="applyManualInput()">应用</el-button>
        </div>
        <p v-if="manualError" class="mt-1 text-xs text-red-500">{{ manualError }}</p>
      </div>
      <p class="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
        更改工作文件夹后重启生效（规格 6.10）；重启后全部路径切换，DSH_HOME 自动指向新 data/。
      </p>
    </section>

    <!-- 数据目录自检（4.4） -->
    <section class="rounded-lg border border-gray-100 p-4 dark:border-[#2a2a2c]">
      <h4 class="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        <el-icon><DataLine /></el-icon>
        数据目录状态
      </h4>
      <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <span class="status-dot" :class="`status-dot--${workspaceInfo?.dataDir.status === 'ok' ? 'running' : 'error'}`"></span>
        <template v-if="workspaceInfo?.dataDir.status === 'ok'">
          正常：dsh 数据将写入 <code class="rounded bg-gray-50 px-1 dark:bg-[#161617]">{{ workspaceInfo.dataDir.path }}</code>
        </template>
        <template v-else-if="workspaceInfo?.dataDir.status === 'missing'">
          缺失（将自动重建）
        </template>
        <template v-else>目录不可写（请检查权限）</template>
      </div>
      <p class="mt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        策略：dsh 官方支持 <code>$DSH_HOME</code> 环境变量（已联网核实），应用每次启动注入
        <code>DSH_HOME=&lt;工作文件夹&gt;/data</code> 并自检目录可用性；无需目录联结（Junction），拷贝文件夹即完整迁移。
      </p>
    </section>

    <!-- 目录结构说明（6.7） -->
    <section class="rounded-lg border border-gray-100 p-4 dark:border-[#2a2a2c]">
      <h4 class="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">目录结构说明</h4>
      <div class="rounded bg-gray-50 p-3 dark:bg-[#161617]">
        <div class="font-mono text-xs text-gray-500 dark:text-gray-400">DSH-Workbench/</div>
        <div v-for="entry in DIR_TREE" :key="entry.dir" class="ml-4 mt-1 font-mono text-xs">
          <span class="text-gray-700 dark:text-gray-200">├─ {{ entry.dir }}</span>
          <span class="ml-2 text-gray-400 dark:text-gray-500">{{ entry.desc }}</span>
        </div>
      </div>
    </section>

    <!-- 一键迁移（6.8） -->
    <section class="rounded-lg border border-gray-100 p-4 dark:border-[#2a2a2c]">
      <h4 class="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
        <el-icon><FolderChecked /></el-icon>
        一键迁移本机存量 dsh 数据
      </h4>
      <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
        扫描本机已有 dsh 数据（$DSH_HOME / ~/.dsh），勾选后复制到工作文件夹；采用「复制」而非「移动」，完成后可手动清理原位置。
      </p>

      <div class="mb-3 flex items-center gap-2">
        <el-button size="small" type="primary" :loading="migrate.scanning" @click="runScan()">
          <el-icon class="mr-1"><Refresh /></el-icon>
          扫描本机数据
        </el-button>
      </div>

      <!-- 数据源列表 -->
      <div v-if="sources.length > 0" class="space-y-3">
        <div
          v-for="source in sources"
          :key="source.path"
          class="rounded border border-gray-100 p-3 dark:border-[#2a2a2c]"
          :class="{ 'border-brand': selectedSourcePath === source.path }"
        >
          <label class="flex cursor-pointer items-center gap-2">
            <el-radio v-model="selectedSourcePath" :value="source.path" @change="selectSource(source)">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-200">{{ source.label }}</span>
            </el-radio>
            <code class="min-w-0 flex-1 truncate text-[11px] text-gray-400 dark:text-gray-500">{{ source.path }}</code>
            <el-tag v-if="source.isWorkspaceData" size="small" type="info" effect="plain">当前工作文件夹</el-tag>
          </label>
          <div v-if="selectedSourcePath === source.path" class="mt-2 grid grid-cols-1 gap-1 pl-7 sm:grid-cols-2">
            <label
              v-for="item in source.items"
              :key="item.key"
              class="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
            >
              <el-checkbox
                :model-value="selectedItems.has(item.key)"
                :disabled="!item.exists || item.count === 0"
                @change="(v: boolean) => { if (v) selectedItems.add(item.key); else selectedItems.delete(item.key) }"
              >
                {{ item.label }}
                <span v-if="item.exists" class="text-gray-400">
                  （{{ item.key === 'sessions' || item.key === 'skills' ? item.count + ' 项' : item.count > 0 ? '存在' : '空' }}{{ item.sizeBytes > 0 ? '，' + formatSize(item.sizeBytes) : '' }}）
                </span>
                <span v-else class="text-gray-300 dark:text-gray-600">（无）</span>
              </el-checkbox>
            </label>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <el-button size="small" :loading="planning" :disabled="!selectedSourcePath || selectedItems.size === 0" @click="planMigration()">
            预检迁移计划
          </el-button>
          <span v-if="plan" class="text-xs text-gray-500 dark:text-gray-400">
            {{ plan.entryCount }} 个文件
            <span v-if="plan.conflicts.length > 0" class="text-amber-500">，{{ plan.conflicts.length }} 个冲突</span>
          </span>
        </div>

        <!-- 冲突策略（6.8：覆盖 / 跳过 / 重命名） -->
        <div v-if="plan && plan.conflicts.length > 0" class="flex flex-wrap items-center gap-3 rounded bg-amber-50 p-3 text-xs dark:bg-[#2a2415]">
          <span class="text-amber-600 dark:text-amber-400">以下文件在目标位置已存在，请选择处理方式：</span>
          <el-radio-group v-model="conflictPolicy" size="small">
            <el-radio-button value="overwrite">覆盖</el-radio-button>
            <el-radio-button value="skip">跳过</el-radio-button>
            <el-radio-button value="rename">重命名</el-radio-button>
          </el-radio-group>
          <span class="max-w-xs truncate text-gray-500 dark:text-gray-400" :title="plan.conflicts.join('\n')">
            {{ plan.conflicts.slice(0, 3).join('、') }}{{ plan.conflicts.length > 3 ? ` 等 ${plan.conflicts.length} 个` : '' }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <el-button
            size="small"
            type="primary"
            :disabled="migrate.running || !selectedSourcePath || selectedItems.size === 0"
            @click="startMigration()"
          >
            开始迁移
          </el-button>
          <el-button v-if="migrate.running" size="small" @click="migrate.cancel()">取消</el-button>
          <el-button v-else-if="migrate.status !== 'idle'" size="small" @click="migrate.clear()">清除</el-button>
        </div>

        <!-- 进度与日志 -->
        <div v-if="migrate.running || migrate.status !== 'idle'" class="rounded border border-gray-100 p-3 dark:border-[#2a2a2c]">
          <el-progress
            v-if="migrate.progress"
            :percentage="Math.round((migrate.progress.done / Math.max(1, migrate.progress.total)) * 100)"
            :stroke-width="8"
            class="mb-2"
          />
          <div class="mb-2 flex items-center gap-2 text-xs">
            <span class="status-chip" :class="{
              'status-chip--success': migrate.status === 'done',
              'status-chip--danger': migrate.status === 'error',
              'status-chip--info': migrate.status === 'cancelled',
              'status-chip--warning': migrate.status === 'running'
            }">
              {{ migrate.status === 'done' ? '完成' : migrate.status === 'error' ? '失败' : migrate.status === 'cancelled' ? '已取消' : '进行中' }}
            </span>
            <span v-if="migrate.result" class="text-gray-500 dark:text-gray-400">
              复制 {{ migrate.result.copied }} · 覆盖 {{ migrate.result.overwritten }} · 跳过 {{ migrate.result.skipped }} · 重命名 {{ migrate.result.renamed }}
            </span>
          </div>
          <pre
            ref="logBox"
            class="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 font-mono text-[11px] leading-relaxed text-gray-600 dark:bg-[#161617] dark:text-gray-300"
          >{{ migrate.logs.join('\n') || '（等待迁移输出…）' }}</pre>
        </div>
      </div>

      <p v-else-if="!migrate.scanning" class="text-xs text-gray-400 dark:text-gray-500">
        尚未扫描。点击「扫描本机数据」查找本机已有的 dsh 数据（对话记录、技能、配置）。
      </p>
    </section>
  </div>
</template>
