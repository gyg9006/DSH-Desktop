<script setup lang="ts">
/**
 * Tab3：服务与运行（规格 6.11~6.15）。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'

const serviceConfig = ref<{
  extraArgs: string[]
  portMode: 'auto' | 'fixed'
  port: number
  startupTimeoutMs: number
  useSystemNode: boolean
  autoStart: boolean
}>({ extraArgs: ['web'], portMode: 'auto', port: 3080, startupTimeoutMs: 60, useSystemNode: false, autoStart: false })

const argsText = ref('web')
const saving = ref(false)

async function load(): Promise<void> {
  const config = await window.dshw.getConfig()
  const svc = (config.service ?? {}) as Record<string, unknown>
  serviceConfig.value = {
    extraArgs: Array.isArray(svc.extraArgs) ? (svc.extraArgs as string[]) : ['web'],
    portMode: svc.portMode === 'fixed' ? 'fixed' : 'auto',
    port: typeof svc.port === 'number' ? svc.port : 3080,
    startupTimeoutMs: typeof svc.startupTimeoutMs === 'number' ? svc.startupTimeoutMs : 60,
    useSystemNode: svc.useSystemNode === true,
    autoStart: svc.autoStart === true
  }
  argsText.value = serviceConfig.value.extraArgs.join(' ')
}

onMounted(() => {
  void load()
})

async function save(): Promise<void> {
  saving.value = true
  try {
    const parsedArgs = argsText.value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const next = {
      ...serviceConfig.value,
      extraArgs: parsedArgs.length > 0 ? parsedArgs : ['web']
    }
    const result = await window.dshw.updateConfig({ service: next })
    if (result.ok) {
      ElMessage.success('服务配置已保存（下次启动服务时生效）')
    } else {
      ElMessage.error(result.error ?? '保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function toggleLoginItem(enabled: boolean): Promise<void> {
  const result = await window.dshw.setLoginItem(enabled)
  if (!result.ok) ElMessage.error('设置开机自启失败')
}
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">服务与运行</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      配置 dsh web 服务的启动参数、端口、超时与自启动行为。
    </p>

    <div class="mt-5 space-y-4">
      <!-- 6.11 启动参数 -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">dsh 启动参数</label>
        <el-input v-model="argsText" size="small" placeholder="web（默认），可追加参数，如 --profile web --host 127.0.0.1" />
        <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">默认参数为 <code>web</code>；追加参数会追加在命令尾部（--port 由应用管理）。</p>
      </div>

      <!-- 6.12 端口 -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">端口设置</label>
        <el-radio-group v-model="serviceConfig.portMode" size="small">
          <el-radio-button value="auto">自动探测（默认，被占用自动更换）</el-radio-button>
          <el-radio-button value="fixed">手动指定</el-radio-button>
        </el-radio-group>
        <el-input-number
          v-if="serviceConfig.portMode === 'fixed'"
          v-model="serviceConfig.port"
          :min="1024"
          :max="65535"
          size="small"
          class="mt-2 !w-40"
        />
      </div>

      <!-- 6.13 启动超时 -->
      <div>
        <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">启动超时时间（秒）</label>
        <el-input-number v-model="serviceConfig.startupTimeoutMs" :min="10" :max="600" size="small" class="!w-40" />
      </div>

      <!-- 6.14 开机自启 -->
      <div class="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 dark:border-[#23262C]">
        <div>
          <div class="text-xs font-medium text-gray-700 dark:text-gray-200">开机自动启动 dsh 服务</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">仅后台服务 + 托盘，不弹主窗口</div>
        </div>
        <el-switch v-model="serviceConfig.autoStart" size="small" @change="toggleLoginItem($event as boolean)" />
      </div>

      <!-- 6.15 使用系统 Node -->
      <div class="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 dark:border-[#23262C]">
        <div>
          <div class="text-xs font-medium text-gray-700 dark:text-gray-200">使用系统 Node 而非便携版</div>
          <div class="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">默认关闭（优先便携版，保证可移植性）</div>
        </div>
        <el-switch v-model="serviceConfig.useSystemNode" size="small" />
      </div>
    </div>

    <div class="mt-6">
      <el-button size="small" type="primary" :loading="saving" @click="save()">保存配置</el-button>
    </div>
  </div>
</template>
