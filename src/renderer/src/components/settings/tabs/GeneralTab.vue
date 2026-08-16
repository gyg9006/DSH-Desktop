<script setup lang="ts">
/**
 * 通用设置 Tab：与 dsh 网页端「通用设置 / Agent 预设」同步。
 * 保存后写入 $DSH_HOME/settings.yaml（locale / ui-theme / agent-presets 命名空间，热重载），
 * 桌面端与 dsh 共用同一份配置；同时控制是否显示 dsh 内置侧边栏。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import type { AgentPresetInfo, DshUiSettingsPayload } from '@shared/ipc'

const locale = ref<'zh' | 'en'>('zh')
const theme = ref<'light' | 'dark' | 'system'>('system')
const preset = ref('standard')
const presets = ref<AgentPresetInfo[]>([])
const showDshSidebar = ref(false)
const saving = ref(false)
const saved = ref(false)
const loaded = ref(false)

onMounted(async () => {
  try {
    const data = await window.dshw.getDshUiSettings()
    locale.value = data.locale
    theme.value = data.theme
    preset.value = data.defaultAgentPreset
    presets.value = data.presets
    showDshSidebar.value = data.showDshSidebar
    loaded.value = true
  } catch (error) {
    // 加载失败：保持表单隐藏且保存按钮禁用，避免用默认值覆盖真实配置
    ElMessage.error(`加载通用设置失败：${error instanceof Error ? error.message : String(error)}`)
  }
})

async function save(): Promise<void> {
  saving.value = true
  saved.value = false
  try {
    const patch: DshUiSettingsPayload = { locale: locale.value, theme: theme.value, defaultAgentPreset: preset.value, showDshSidebar: showDshSidebar.value }
    const result = await window.dshw.setDshUiSettings(patch)
    if (result.ok) {
      saved.value = true
      if (result.result) {
        presets.value = result.result.presets
        showDshSidebar.value = result.result.showDshSidebar
      }
      ElMessage.success('已保存并同步到 dsh（热重载生效）')
    } else {
      ElMessage.error(result.error ?? '保存失败')
    }
  } finally {
    saving.value = false
  }
}

/** 用系统默认编辑器打开 $DSH_HOME/settings.yaml（与 dsh 网页端「打开配置文件」一致）。 */
async function openSettingsFile(): Promise<void> {
  const result = await window.dshw.openSettingsFile()
  if (!result.ok) ElMessage.error(result.error ?? '打开失败')
}
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">通用设置</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      与 dsh 网页端「通用设置 / Agent 预设」同步：保存后写入
      <code class="rounded bg-gray-100 px-1 dark:bg-[#1E2126]">$DSH_HOME/settings.yaml</code>（热重载），
      桌面端与 dsh 共用同一份配置。
    </p>

    <div v-if="loaded" class="mt-5 space-y-4">
      <!-- 语言 -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">语言</label>
        <el-select v-model="locale" size="small" style="width: 200px">
          <el-option label="简体中文" value="zh" />
          <el-option label="English" value="en" />
        </el-select>
      </div>

      <!-- 外观 -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">dsh 界面外观</label>
        <el-radio-group v-model="theme" size="small">
          <el-radio-button value="light">浅色</el-radio-button>
          <el-radio-button value="dark">深色</el-radio-button>
          <el-radio-button value="system">跟随系统</el-radio-button>
        </el-radio-group>
        <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">作用于 dsh 对话窗口；应用窗口自身的深浅色在左下角主题按钮切换。</p>
      </div>

      <!-- Agent 预设 -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">Agent 预设（对新会话生效）</label>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="p in presets"
            :key="p.id"
            class="rounded-lg border p-3 text-left transition-colors"
            :class="
              preset === p.id
                ? 'border-brand bg-brand-50 dark:border-brand dark:bg-brand-900/20'
                : 'border-gray-200 hover:border-gray-300 dark:border-[#2A2E35] dark:hover:border-gray-600'
            "
            @click="preset = p.id"
          >
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-gray-800 dark:text-gray-100">{{ p.name }}</span>
              <span v-if="!p.shipped" class="status-chip">自建</span>
            </div>
            <p class="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{{ p.description }}</p>
          </button>
        </div>
      </div>

      <!-- dsh 侧边栏 -->
      <div class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs font-medium text-gray-700 dark:text-gray-200">显示 dsh 内置侧边栏</div>
            <p class="mt-0.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
              默认隐藏，对话窗口更干净（新建会话/预设等已由桌面端接管）；需要会话搜索等原 dsh 功能时再开启，或随时点对话窗口顶部的「☰」。
            </p>
          </div>
          <el-switch v-model="showDshSidebar" size="small" />
        </div>
      </div>
    </div>

    <div class="mt-6 flex items-center gap-3">
      <el-button size="small" type="primary" :loading="saving" :disabled="!loaded" @click="save()">保存并同步到 dsh</el-button>
      <el-button size="small" plain :icon="Document" @click="openSettingsFile()">打开配置文件</el-button>
      <span v-if="saved" class="text-xs text-green-600">✓ 已同步：dsh 网页端即时生效</span>
    </div>
  </div>
</template>
