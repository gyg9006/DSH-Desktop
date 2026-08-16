<script setup lang="ts">
/**
 * Tab4：模型与 API（规格 6.16~6.20）。
 * 保存时同步到 dsh（settings.yaml + .credentials.yaml），桌面端与 dsh Models 页共用配置，
 * 无需重复输入 API Key；支持自定义提供方（同步到 dsh llm-pi-ai 段）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { View, Hide, Connection, Plus, Delete, Refresh } from '@element-plus/icons-vue'
import type { ApiConfigPayload, ProviderConfigPayload } from '@shared/ipc'

const MODEL_OPTIONS = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash（dsh 默认 · 通用对话）' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro（深度推理）' }
]

const API_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' }
] as const

const api = ref<ApiConfigPayload>({})
const showKey = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; error?: string; latencyMs?: number } | null>(null)
const saving = ref(false)
const synced = ref(false)
/** 正在展开显示 Key 的自定义提供方路由集合 */
const revealed = reactive(new Set<string>())
/** 正在获取模型列表的提供方路由 */
const discovering = ref<string | null>(null)

/** 加载失败时禁用保存，避免用空配置覆盖已有 apiKey */
const loadFailed = ref(false)

onMounted(async () => {
  try {
    api.value = await window.dshw.getApiConfig()
  } catch (error) {
    loadFailed.value = true
    ElMessage.error(`加载 API 配置失败：${error instanceof Error ? error.message : String(error)}`)
  }
})

const proxyMode = computed({
  get: () => api.value.proxy?.mode ?? 'none',
  set: (v: 'none' | 'system' | 'manual') => {
    api.value = { ...api.value, proxy: { ...api.value.proxy, mode: v } }
  }
})

/** 跨 contextBridge 传参必须是可结构化克隆的普通对象（Vue 响应式 Proxy 会抛 DataCloneError）。 */
function plainApiConfig(): ApiConfigPayload {
  return JSON.parse(JSON.stringify(api.value)) as ApiConfigPayload
}

const providerRoutes = computed(() => Object.keys(api.value.providers ?? {}))

function ensureProviders(): void {
  if (!api.value.providers) api.value = { ...api.value, providers: {} }
}

function addProvider(): void {
  ensureProviders()
  let n = 1
  while (api.value.providers![`provider-${n}`]) n += 1
  const route = `provider-${n}`
  api.value = {
    ...api.value,
    providers: { ...api.value.providers, [route]: { displayName: '', api: 'openai-completions', models: [] } }
  }
}

async function removeProvider(route: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除提供方「${route}」？保存后 dsh 中对应的模型路由也会移除。`, '删除提供方', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return // 用户取消，静默返回
  }
  ensureProviders()
  const next = { ...api.value.providers! }
  delete next[route]
  api.value = { ...api.value, providers: next }
}

/** 提供方模型列表文本（逗号/换行分隔）↔ string[] */
function modelsText(route: string): string {
  return (api.value.providers?.[route]?.models ?? []).join('\n')
}
function setModelsText(route: string, text: string): void {
  ensureProviders()
  const models = text
    .split(/[\n,，;；]/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
  api.value = {
    ...api.value,
    providers: { ...api.value.providers, [route]: { ...api.value.providers![route], models } }
  }
}

function updateProvider(route: string, patch: Partial<ProviderConfigPayload>): void {
  ensureProviders()
  api.value = {
    ...api.value,
    providers: { ...api.value.providers, [route]: { ...api.value.providers![route], ...patch } }
  }
}

async function discoverFor(route: string): Promise<void> {
  const p = api.value.providers?.[route]
  if (!p) return
  discovering.value = route
  try {
    const result = await window.dshw.discoverModels({ baseUrl: p.baseUrl, apiKey: p.apiKey })
    if (result.ok && result.models) {
      updateProvider(route, { models: result.models })
      ElMessage.success(`已获取 ${result.models.length} 个模型`)
    } else {
      ElMessage.error(result.error ?? '获取失败')
    }
  } finally {
    discovering.value = null
  }
}

async function save(): Promise<void> {
  saving.value = true
  synced.value = false
  try {
    const result = await window.dshw.setApiConfig(plainApiConfig())
    if (result.ok) {
      if (result.synced === false) {
        ElMessage.warning(`配置已保存，但同步到 dsh 失败：${result.syncError ?? '未知错误'}`)
      } else {
        synced.value = true
        ElMessage.success('已保存并同步到 dsh（对话界面直接生效，无需重复输入）')
      }
    } else {
      ElMessage.error(result.error ?? '保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function testConnection(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    // 先保存再测试（保证主进程读到最新配置）；保存失败则停止，避免测试旧配置误导
    const saved = await window.dshw.setApiConfig(plainApiConfig())
    if (!saved.ok) {
      testResult.value = { ok: false, error: saved.error ?? '保存配置失败' }
      ElMessage.error(testResult.value.error)
      return
    }
    testResult.value = await window.dshw.testApiConnection()
    if (testResult.value.ok) {
      ElMessage.success(`连接成功（${testResult.value.latencyMs ?? '-'} ms）`)
    } else {
      ElMessage.error(testResult.value.error ?? '连接失败')
    }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">模型与 API</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
      凭据保存在工作文件夹中；保存后自动写入 dsh 的
      <code class="rounded bg-gray-100 px-1 dark:bg-[#1E2126]">$DSH_HOME/settings.yaml</code> 与
      <code class="rounded bg-gray-100 px-1 dark:bg-[#1E2126]">.credentials.yaml</code>（热重载，dsh 对话界面与 Models 页直接生效，无需重复输入）。
    </p>

    <div class="mt-5 space-y-4">
      <!-- 官方 DeepSeek 提供方 -->
      <div class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="mb-2 flex items-center gap-2">
          <span class="status-chip source-chip">官方</span>
          <span class="text-xs font-semibold text-gray-700 dark:text-gray-200">DeepSeek（dsh 默认提供方 deepseek-official）</span>
        </div>
        <div class="space-y-3">
          <!-- API Key -->
          <div>
            <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">DeepSeek API Key</label>
            <el-input
              v-model="api.apiKey"
              size="small"
              :type="showKey ? 'text' : 'password'"
              placeholder="sk-..."
              autocomplete="off"
            >
              <template #suffix>
                <el-icon class="cursor-pointer" @click="showKey = !showKey">
                  <View v-if="showKey" /><Hide v-else />
                </el-icon>
              </template>
            </el-input>
          </div>

          <!-- Base URL -->
          <div>
            <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">API Base URL</label>
            <el-input v-model="api.baseUrl" size="small" placeholder="https://api.deepseek.com（默认官方，可填代理/私有地址）" />
          </div>

          <!-- 默认模型（仅测试连接用） -->
          <div>
            <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">测试模型</label>
            <el-select v-model="api.model" size="small" placeholder="选择模型">
              <el-option v-for="m in MODEL_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
            </el-select>
            <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              仅用于「测试连接」；dsh 的默认模型请在对话界面的模型选择器/Models 页设置。
            </p>
          </div>
        </div>
      </div>

      <!-- 自定义提供方 -->
      <div class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-700 dark:text-gray-200">
            自定义提供方（同步到 dsh 的 llm-pi-ai 段）
          </span>
          <el-button size="small" type="primary" plain :icon="Plus" @click="addProvider()">添加提供方</el-button>
        </div>

        <div v-if="providerRoutes.length === 0" class="py-3 text-xs text-gray-400 dark:text-gray-500">
          尚未配置自定义提供方。适合接入 OpenAI 兼容网关、自建服务等；添加后可在 dsh Models 页看到并选用其模型。
        </div>

        <div v-for="route in providerRoutes" :key="route" class="mb-3 rounded-lg border border-dashed border-gray-200 p-3 dark:border-[#2A2E35]">
          <div class="mb-2 flex items-center justify-between">
            <span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:bg-[#1E2126] dark:text-gray-300">
              {{ route }}
            </span>
            <div class="flex items-center gap-1">
              <el-button size="small" text :icon="Refresh" :loading="discovering === route" @click="discoverFor(route)">
                获取模型列表
              </el-button>
              <el-button size="small" text type="danger" :icon="Delete" @click="removeProvider(route)">删除</el-button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">显示名称</label>
              <el-input
                :model-value="api.providers![route].displayName"
                size="small"
                placeholder="如：Acme Gateway"
                @update:model-value="updateProvider(route, { displayName: String($event) })"
              />
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">协议</label>
              <el-select
                :model-value="api.providers![route].api ?? 'openai-completions'"
                size="small"
                @update:model-value="updateProvider(route, { api: $event as ProviderConfigPayload['api'] })"
              >
                <el-option v-for="a in API_OPTIONS" :key="a.value" :label="a.label" :value="a.value" />
              </el-select>
            </div>
            <div class="col-span-2">
              <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">Base URL</label>
              <el-input
                :model-value="api.providers![route].baseUrl"
                size="small"
                placeholder="https://gateway.example.com/v1"
                @update:model-value="updateProvider(route, { baseUrl: String($event) })"
              />
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">API Key</label>
              <el-input
                :model-value="api.providers![route].apiKey"
                size="small"
                :type="revealed.has(route) ? 'text' : 'password'"
                placeholder="sk-..."
                autocomplete="off"
                @update:model-value="updateProvider(route, { apiKey: String($event) })"
              >
                <template #suffix>
                  <el-icon class="cursor-pointer" @click="revealed.has(route) ? revealed.delete(route) : revealed.add(route)">
                    <View v-if="revealed.has(route)" /><Hide v-else />
                  </el-icon>
                </template>
              </el-input>
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">模型 id（每行一个）</label>
              <el-input
                :model-value="modelsText(route)"
                type="textarea"
                :rows="2"
                size="small"
                placeholder="gpt-4o&#10;gpt-4o-mini"
                @update:model-value="setModelsText(route, String($event))"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 测试连接 -->
      <div>
        <el-button size="small" type="primary" plain :loading="testing" @click="testConnection()">
          <el-icon class="mr-1"><Connection /></el-icon>
          测试连接
        </el-button>
        <span
          v-if="testResult"
          class="ml-3 text-xs"
          :class="testResult.ok ? 'text-green-600' : 'text-red-500'"
        >
          {{ testResult.ok ? `连接成功（${testResult.latencyMs ?? '-'} ms）` : testResult.error }}
        </span>
      </div>

      <!-- 代理 -->
      <div class="rounded-lg border border-gray-100 p-3 dark:border-[#23262C]">
        <label class="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-300">网络代理（注入所有子进程环境）</label>
        <el-radio-group v-model="proxyMode" size="small">
          <el-radio-button value="none">不使用</el-radio-button>
          <el-radio-button value="system">系统代理</el-radio-button>
          <el-radio-button value="manual">手动</el-radio-button>
        </el-radio-group>

        <div v-if="proxyMode === 'manual'" class="mt-3 space-y-2">
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-xs text-gray-500">HTTP 代理</span>
            <el-input v-model="api.proxy!.http" size="small" placeholder="http://127.0.0.1:7890" />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-xs text-gray-500">HTTPS 代理</span>
            <el-input v-model="api.proxy!.https" size="small" placeholder="http://127.0.0.1:7890" />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-xs text-gray-500">SOCKS5</span>
            <el-input v-model="api.proxy!.socks5" size="small" placeholder="socks5://127.0.0.1:1080" />
          </div>
          <p class="text-[11px] text-gray-400 dark:text-gray-500">填入 SOCKS5 时优先使用 SOCKS5；本地地址自动豁免。</p>
        </div>
      </div>
    </div>

    <div class="mt-6 flex items-center gap-3">
      <el-button size="small" type="primary" :loading="saving" :disabled="loadFailed" @click="save()">保存并同步到 dsh</el-button>
      <span v-if="synced" class="text-xs text-green-600">✓ 已同步：dsh 对话界面 / Models 页即时生效</span>
    </div>
  </div>
</template>
