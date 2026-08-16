<script setup lang="ts">
/**
 * 首次启动向导（规格 7.1）：
 * ① 确认工作文件夹位置（默认程序目录下 workspace/，可更改/手动输入）；
 * ② 环境检测（复用 EnvTab，缺失项可当场一键安装，允许跳过）；
 * ③ 完成页：指引配置 API Key → 启动服务。
 * 向导完成前主界面不可用（7.2），完成状态写入 config，之后不再弹出。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderOpened, Check, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { useAppStore } from '../../stores/app'
import EnvTab from '../settings/tabs/EnvTab.vue'
import AppLogo from '../AppLogo.vue'
import { validateWorkspacePathInput } from '../../utils/workspaceValidation'

const appStore = useAppStore()

const step = ref(0)
/** 用户在向导中手动更改的工作文件夹（未更改时跟随 appStore 的默认值，init 完成后自动就绪） */
const manualOverride = ref<string | null>(null)
const workspacePath = computed(() => manualOverride.value ?? appStore.workspacePath)
const showManualInput = ref(false)
const manualPath = ref('')
const manualError = ref('')

const workspaceDisplay = computed(() => workspacePath.value || '尚未设置')

async function chooseFolder(): Promise<void> {
  const result = await window.dshw.chooseWorkspaceFolder()
  if (result.ok && result.path) {
    manualOverride.value = result.path
    manualPath.value = result.path
  }
}

/** 输入时即时校验（6.6 红字要求）。 */
function onManualInput(): void {
  manualError.value = manualPath.value.trim() ? validateWorkspacePathInput(manualPath.value) : ''
}

async function applyManual(): Promise<void> {
  manualError.value = validateWorkspacePathInput(manualPath.value)
  if (manualError.value) return
  manualOverride.value = manualPath.value.trim()
  showManualInput.value = false
  ElMessage.success('已应用，继续下一步')
}

async function next(): Promise<void> {
  if (workspacePath.value && workspacePath.value !== appStore.workspacePath) {
    // 用户在向导中更改了工作文件夹 → 持久化（重启后生效，本次会话继续使用新路径的目录骨架）
    const result = await window.dshw.setWorkspacePath(workspacePath.value)
    if (!result.ok) {
      ElMessage.error(result.error ?? '工作文件夹无效')
      return
    }
  }
  step.value += 1
}

async function finish(): Promise<void> {
  await appStore.updateConfig({ onboarded: true })
  ElMessage.success('初始化完成，欢迎使用 DSH 桌面')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-100 dark:bg-[#0f0f10]">
    <div class="w-[760px] max-w-[92vw]">
      <div class="mb-6 flex flex-col items-center">
        <AppLogo :size="48" />
        <h1 class="mt-3 text-xl font-semibold text-gray-800 dark:text-gray-100">欢迎使用 DSH 桌面</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">首次使用，请完成以下初始化（约 1 分钟）</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-[#2a2a2c] dark:bg-[#1d1e1f]">
        <el-steps :active="step" align-center finish-status="success" class="mb-6">
          <el-step title="工作文件夹" />
          <el-step title="环境检测" />
          <el-step title="完成" />
        </el-steps>

        <!-- ① 工作文件夹 -->
        <div v-if="step === 0">
          <h3 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">确认工作文件夹位置</h3>
          <p class="mb-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            全部运行环境与业务数据（对话、技能、插件、配置）都保存在这个文件夹里，拷贝它即可整机迁移。
            默认位于程序目录下，建议保持默认或放到方便备份的位置。
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="min-w-0 flex-1 break-all rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-600 dark:bg-[#161617] dark:text-gray-300">
              {{ workspaceDisplay }}
            </code>
            <el-button size="small" @click="chooseFolder()">
              <el-icon class="mr-1"><FolderOpened /></el-icon>
              更改…
            </el-button>
            <el-button size="small" text @click="showManualInput = !showManualInput">手动输入</el-button>
          </div>
          <div v-if="showManualInput" class="mt-3 flex items-center gap-2">
            <el-input
              v-model="manualPath"
              size="small"
              placeholder="输入绝对路径，如 D:\MyData"
              @input="onManualInput()"
              @keyup.enter="applyManual()"
            />
            <el-button size="small" type="primary" @click="applyManual()">应用</el-button>
          </div>
          <p v-if="manualError" class="mt-1 text-xs text-red-500">{{ manualError }}</p>
        </div>

        <!-- ② 环境检测（复用设置页 Tab1 组件） -->
        <div v-else-if="step === 1">
          <h3 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">环境检测与安装</h3>
          <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
            缺失的环境可当场一键安装（自动下载到工作文件夹）；也可跳过，稍后在「设置 → 环境检测」中安装。
          </p>
          <div class="max-h-[360px] overflow-y-auto pr-1">
            <EnvTab />
          </div>
        </div>

        <!-- ③ 完成 -->
        <div v-else>
          <h3 class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">初始化完成 🎉</h3>
          <ol class="space-y-2 text-sm text-gray-600 dark:text-gray-300">
            <li class="flex gap-2">
              <span class="font-semibold text-brand">①</span>
              打开「设置 → 模型与 API」，填入 DeepSeek API Key
            </li>
            <li class="flex gap-2">
              <span class="font-semibold text-brand">②</span>
              点击主界面的「一键启动服务」（服务功能将在 M4 提供）
            </li>
            <li class="flex gap-2">
              <span class="font-semibold text-brand">③</span>
              开始对话 —— 对话记录自动保存在工作文件夹内
            </li>
          </ol>
        </div>

        <!-- 底部操作 -->
        <div class="mt-6 flex items-center justify-between">
          <el-button v-if="step > 0" size="small" @click="step -= 1">
            <el-icon class="mr-1"><ArrowLeft /></el-icon>
            上一步
          </el-button>
          <span v-else></span>
          <div class="flex items-center gap-2">
            <el-button v-if="step === 1" size="small" @click="step += 1">跳过</el-button>
            <el-button v-if="step < 2" size="small" type="primary" @click="next()">
              下一步
              <el-icon class="ml-1"><ArrowRight /></el-icon>
            </el-button>
            <el-button v-else size="large" type="primary" @click="finish()">
              <el-icon class="mr-1"><Check /></el-icon>
              完成，开始使用
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
