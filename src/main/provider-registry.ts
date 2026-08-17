/**
 * 全域模型对接中心：厂商注册表 + 模型/提供商配置存储。
 * - 预设厂商（联网核实 OpenAI 兼容端点）：国际 5 家 + 国内 8 家 + 本地 Ollama；
 * - 自定义厂商：任意 OpenAI 兼容端点（OpenRouter / SiliconFlow / One API 等）；
 * - 存储：<workspace>/config/models.json（Key 只存密文引用，见 secure-storage.ts）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'

export type ProviderRegion = 'international' | 'china' | 'local'
export type ProviderProtocol = 'openai' | 'anthropic' | 'ollama'

export interface ModelProviderPreset {
  id: string
  name: string
  region: ProviderRegion
  protocol: ProviderProtocol
  baseUrl: string
  /** 常见模型名（离线展示；连接后可拉取在线列表） */
  defaultModels: string[]
  /** 是否需要 API Key（Ollama 本地不需要） */
  keyRequired: boolean
  docs?: string
}

/** 预设厂商清单（Base URL 为 OpenAI 兼容 / 原生端点，均经联网核实）。 */
export const PROVIDER_PRESETS: ModelProviderPreset[] = [
  // ---- 国际 ----
  { id: 'openai', name: 'OpenAI', region: 'international', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3-mini'], keyRequired: true },
  { id: 'anthropic', name: 'Anthropic', region: 'international', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModels: ['claude-sonnet-4-5', 'claude-3-7-sonnet', 'claude-3-5-haiku'], keyRequired: true },
  { id: 'google', name: 'Google Gemini', region: 'international', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'], keyRequired: true },
  { id: 'xai', name: 'xAI Grok', region: 'international', protocol: 'openai', baseUrl: 'https://api.x.ai/v1', defaultModels: ['grok-3', 'grok-3-mini', 'grok-2'], keyRequired: true },
  { id: 'mistral', name: 'Mistral', region: 'international', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', defaultModels: ['mistral-large-latest', 'mistral-small-latest'], keyRequired: true },
  // ---- 国内 ----
  { id: 'deepseek', name: 'DeepSeek', region: 'china', protocol: 'openai', baseUrl: 'https://api.deepseek.com', defaultModels: ['deepseek-chat', 'deepseek-reasoner'], keyRequired: true },
  { id: 'qwen', name: '通义千问 DashScope', region: 'china', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'], keyRequired: true },
  { id: 'zhipu', name: '智谱 GLM', region: 'china', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModels: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'], keyRequired: true },
  { id: 'moonshot', name: 'Moonshot Kimi', region: 'china', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', defaultModels: ['kimi-k2', 'moonshot-v1-8k', 'moonshot-v1-32k'], keyRequired: true },
  { id: 'baidu', name: '百度千帆', region: 'china', protocol: 'openai', baseUrl: 'https://qianfan.baidubce.com/v2', defaultModels: ['ernie-4.5-turbo-128k', 'ernie-4.0-turbo-8k', 'ernie-speed-128k'], keyRequired: true },
  { id: 'hunyuan', name: '腾讯混元', region: 'china', protocol: 'openai', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModels: ['hunyuan-turbos-latest', 'hunyuan-turbo-latest', 'hunyuan-standard'], keyRequired: true },
  { id: 'spark', name: '讯飞星火', region: 'china', protocol: 'openai', baseUrl: 'https://spark-api-open.xf-yun.com/v1', defaultModels: ['generalv3.5', '4.0Ultra', 'lite'], keyRequired: true },
  { id: 'minimax', name: 'MiniMax', region: 'china', protocol: 'openai', baseUrl: 'https://api.minimax.chat/v1', defaultModels: ['MiniMax-Text-01', 'abab6.5s-chat'], keyRequired: true },
  // ---- 本地 ----
  { id: 'ollama', name: 'Ollama（本地）', region: 'local', protocol: 'ollama', baseUrl: 'http://localhost:11434', defaultModels: [], keyRequired: false, docs: '本地模型：地址可配（默认 http://localhost:11434），拉取已安装模型列表' }
]

// ---------------------------------------------------------------------------
// 配置存储（models.json）
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  enabled: boolean
  baseUrl?: string
  /** 已启用模型列表 */
  models: string[]
  /** 默认对话模型 */
  defaultChat?: string
  /** 默认提炼/知识模型（可用便宜模型降本） */
  defaultExtract?: string
  /** 默认 Embedding 模型 */
  defaultEmbedding?: string
}

export interface CustomProviderConfig {
  id: string
  name: string
  baseUrl: string
  protocol: ProviderProtocol
  models: string[]
  enabled: boolean
}

export interface ModelsConfig {
  version: number
  providers: Record<string, ProviderConfig>
  customProviders: Record<string, CustomProviderConfig>
  /** 兼容旧配置：deepseek apiKey 直接迁移（见 migrateFromApiConfig） */
  migratedFrom?: string
}

export function modelsConfigFile(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'models.json')
}

export function readModelsConfig(workspaceDir: string): ModelsConfig {
  const raw = readJsonFile(modelsConfigFile(workspaceDir))
  if (!raw || typeof raw !== 'object') return { version: 1, providers: {}, customProviders: {} }
  const cfg = raw as Partial<ModelsConfig>
  return {
    version: 1,
    providers: (cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {}) as Record<string, ProviderConfig>,
    customProviders:
      cfg.customProviders && typeof cfg.customProviders === 'object' ? (cfg.customProviders as Record<string, CustomProviderConfig>) : {}
  }
}

export function writeModelsConfig(workspaceDir: string, cfg: ModelsConfig): void {
  try {
    writeJsonAtomic(modelsConfigFile(workspaceDir), cfg)
  } catch (error) {
    logger.error(`模型配置保存失败：${String(error)}`)
    throw error
  }
}

export function updateProviderConfig(
  workspaceDir: string,
  providerId: string,
  patch: Partial<ProviderConfig>
): ModelsConfig {
  const cfg = readModelsConfig(workspaceDir)
  const current = cfg.providers[providerId] ?? { enabled: false, models: [] }
  cfg.providers[providerId] = { ...current, ...patch }
  writeModelsConfig(workspaceDir, cfg)
  return cfg
}

export function updateCustomProvider(
  workspaceDir: string,
  input: { id: string; name: string; baseUrl: string; protocol?: ProviderProtocol; models?: string[]; enabled?: boolean }
): ModelsConfig {
  const cfg = readModelsConfig(workspaceDir)
  const current = cfg.customProviders[input.id]
  cfg.customProviders[input.id] = {
    ...(current ?? { id: input.id, name: input.name, baseUrl: input.baseUrl, protocol: input.protocol ?? 'openai', models: [], enabled: true }),
    ...input
  }
  writeModelsConfig(workspaceDir, cfg)
  return cfg
}

export function deleteCustomProvider(workspaceDir: string, id: string): ModelsConfig {
  const cfg = readModelsConfig(workspaceDir)
  delete cfg.customProviders[id]
  writeModelsConfig(workspaceDir, cfg)
  return cfg
}

/** 合并预设 + 自定义 + 本地配置的完整视图（供 UI 渲染）。 */
export function getAllProviders(workspaceDir: string): {
  presets: ModelProviderPreset[]
  custom: CustomProviderConfig[]
  providers: Record<string, ProviderConfig>
} {
  const cfg = readModelsConfig(workspaceDir)
  return { presets: PROVIDER_PRESETS, custom: Object.values(cfg.customProviders), providers: cfg.providers }
}

/** 迁移旧 apiConfig 的 DeepSeek Key 到 secure-storage（保留向后兼容）。 */
export function migrateLegacyApiConfig(workspaceDir: string, legacyApiKey: string | undefined, saveKey: (id: string, key: string) => void): void {
  if (legacyApiKey?.trim()) {
    saveKey('deepseek', legacyApiKey)
    const cfg = readModelsConfig(workspaceDir)
    cfg.migratedFrom = 'api.json'
    writeModelsConfig(workspaceDir, cfg)
  }
}

export function ensureModelsDir(workspaceDir: string): void {
  fs.mkdirSync(path.join(workspaceDir, 'config'), { recursive: true })
}
