/**
 * 模型配置 → dsh 同步（核心：让 dsh 对话窗口的模型选择器可选桌面端配置的大模型）。
 *
 * 映射：
 * - deepseek 厂商 → settings.yaml 的 llm-deepseek 段（baseURL/apiKeyEnv/models）
 * - 其他厂商 + 自定义 → llm-pi-ai.providers[route]（displayName/baseURL/apiKeyEnv/models）
 * - 默认对话模型 → settings.yaml 顶层 `model`
 * - 各厂商 API Key → 服务启动时注入环境变量（DEEPSEEK_API_KEY / DSHW_PROVIDER_<ROUTE>）
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadYamlObject, dumpYaml } from '../shared/yaml'
import { readModelsConfig, PROVIDER_PRESETS } from './provider-registry'
import { readApiKeySecure } from './secure-storage'
import { providerApiKeyEnv, DEEPSEEK_API_KEY_ENV } from './apiConfig'
import { logger } from './logger'

function settingsFile(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'settings.yaml')
}

/** 收集模型中心所有「已启用厂商」的环境变量（Key 密文解密后注入服务进程）。 */
export function collectProviderEnv(workspaceDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const cfg = readModelsConfig(workspaceDir)
  for (const [id, pc] of Object.entries(cfg.providers)) {
    if (!pc.enabled) continue
    const key = readApiKeySecure(workspaceDir, id)
    if (!key) continue
    if (id === 'deepseek') {
      out[DEEPSEEK_API_KEY_ENV] = key
    } else {
      out[providerApiKeyEnv(id)] = key
    }
  }
  for (const [id, c] of Object.entries(cfg.customProviders)) {
    if (!c.enabled) continue
    const key = readApiKeySecure(workspaceDir, id)
    if (key) out[providerApiKeyEnv(id)] = key
  }
  return out
}

/** 把模型中心配置同步到 dsh settings.yaml（对话模型选择器数据源）。 */
export function syncModelsConfigToDsh(workspaceDir: string): { ok: boolean; error?: string } {
  try {
    const cfg = readModelsConfig(workspaceDir)
    const file = settingsFile(workspaceDir)
    const existing = loadYamlObject(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '') ?? {}

    // ---- llm-deepseek 段：官方提供方（含 models 目录） ----
    const ds = cfg.providers['deepseek']
    const dsPreset = PROVIDER_PRESETS.find((p) => p.id === 'deepseek')
    const dsModels = ds?.enabled ? (ds.models ?? []) : []
    if (ds?.enabled) {
      const section: Record<string, unknown> = {
        baseURL: ds.baseUrl?.trim() || dsPreset?.baseUrl || 'https://api.deepseek.com',
        apiKeyEnv: DEEPSEEK_API_KEY_ENV
      }
      if (dsModels.length > 0) {
        section.models = dsModels.map((m) => ({ id: m }))
      }
      existing['llm-deepseek'] = section
    } else {
      delete existing['llm-deepseek']
    }

    // ---- llm-pi-ai.providers：其他厂商 + 自定义 ----
    const piProviders: Record<string, unknown> = {}
    for (const [id, pc] of Object.entries(cfg.providers)) {
      if (id === 'deepseek' || !pc.enabled) continue
      const preset = PROVIDER_PRESETS.find((p) => p.id === id)
      const models = (pc.models ?? []).filter((m) => m.trim())
      if (models.length === 0) continue
      piProviders[id] = {
        displayName: preset?.name ?? id,
        baseURL: pc.baseUrl?.trim() || preset?.baseUrl,
        apiKeyEnv: providerApiKeyEnv(id),
        models: models.map((m) => ({ id: m }))
      }
    }
    for (const c of Object.values(cfg.customProviders)) {
      if (!c.enabled || !c.baseUrl?.trim()) continue
      const models = (c.models ?? []).filter((m) => m.trim())
      if (models.length === 0) continue
      piProviders[c.id] = {
        displayName: c.name || c.id,
        baseURL: c.baseUrl.trim(),
        apiKeyEnv: providerApiKeyEnv(c.id),
        models: models.map((m) => ({ id: m }))
      }
    }
    if (Object.keys(piProviders).length > 0) {
      existing['llm-pi-ai'] = { ...(typeof existing['llm-pi-ai'] === 'object' && !Array.isArray(existing['llm-pi-ai']) ? (existing['llm-pi-ai'] as Record<string, unknown>) : {}), providers: piProviders }
    } else {
      delete existing['llm-pi-ai']
    }

    // ---- 默认对话模型（顶层 model） ----
    const defaultChat = ds?.defaultChat || Object.values(cfg.providers).find((p) => p.enabled && p.defaultChat)?.defaultChat
    if (defaultChat) {
      existing['model'] = defaultChat
    }

    writeYaml(file, existing)
    logger.info('模型配置已同步到 dsh settings.yaml')
    return { ok: true }
  } catch (error) {
    logger.error(`模型配置同步 dsh 失败：${String(error)}`)
    return { ok: false, error: String(error) }
  }
}

function writeYaml(file: string, obj: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, dumpYaml(obj), 'utf8')
}
