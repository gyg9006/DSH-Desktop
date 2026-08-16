/**
 * M5：模型与 API 配置（规格 6.16~6.20）。
 * 凭据存 workspace/config/api.json；
 * 保存时同步到 dsh：API Key 写入 $DSH_HOME/.credentials.yaml（dsh-credentials-local 受管文档，
 * 热重载、Models 页可编辑），Base URL / 自定义提供方写入 $DSH_HOME/settings.yaml 的
 * llm-deepseek / llm-pi-ai 段（dsh-settings-file 热重载）——桌面端与 dsh 共用同一份配置，
 * 无需重复输入。schema 已从 dsh-llm-deepseek / dsh-llm-pi-ai / dsh-credentials-local 源码核实。
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { getWorkspaceDir } from './config'
import { logger } from './logger'

export interface ProxyConfig {
  mode: 'none' | 'system' | 'manual'
  http?: string
  https?: string
  socks5?: string
}

/** 自定义提供方（同步到 dsh llm-pi-ai.providers.<route>）。 */
export interface ProviderConfig {
  displayName?: string
  api?: 'openai-completions' | 'openai-responses' | 'anthropic-messages'
  baseUrl?: string
  apiKey?: string
  /** 模型 id 列表（手声明路由必填 ≥1）。 */
  models?: string[]
}

export interface ApiConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  proxy?: ProxyConfig
  providers?: Record<string, ProviderConfig>
}

/**
 * 默认模型列表（与 dsh-llm-deepseek 默认目录一致：deepseek-v4-flash / deepseek-v4-pro）。
 * 仅用于「测试连接」；dsh 的默认模型在对话界面/Models 页选择，桌面端不做二次管理。
 */
export const MODEL_LIST: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash（dsh 默认 · 通用对话）' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro（深度推理）' }
]

export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

function getApiConfigPath(): string {
  return path.join(getWorkspaceDir(), 'config', 'api.json')
}

/** dsh 官方主提供方路由（dsh-llm-deepseek 注册）。 */
export const DEEPSEEK_PROVIDER_ROUTE = 'deepseek-official'
/** 官方主提供方凭据引用（dsh-llm-deepseek 默认）。 */
export const DEEPSEEK_API_KEY_ENV = 'DEEPSEEK_API_KEY'

function readProviders(raw: unknown): Record<string, ProviderConfig> | undefined {
  const providers = (raw as ApiConfig)?.providers
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return undefined
  const out: Record<string, ProviderConfig> = {}
  for (const [route, p] of Object.entries(providers)) {
    if (!p || typeof p !== 'object') continue
    const src = p as ProviderConfig
    out[route] = {
      displayName: typeof src.displayName === 'string' && src.displayName.trim() ? src.displayName.trim() : undefined,
      api:
        src.api === 'openai-completions' || src.api === 'openai-responses' || src.api === 'anthropic-messages'
          ? src.api
          : undefined,
      baseUrl: typeof src.baseUrl === 'string' && src.baseUrl.trim() ? src.baseUrl.trim() : undefined,
      apiKey: typeof src.apiKey === 'string' && src.apiKey.trim() ? src.apiKey.trim() : undefined,
      models: Array.isArray(src.models)
        ? src.models.map((m) => String(m).trim()).filter((m) => m.length > 0)
        : undefined
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function readApiConfig(): ApiConfig {
  const raw = readJsonFile(getApiConfigPath())
  if (!raw || typeof raw !== 'object') return {}
  const cfg = raw as ApiConfig
  const proxy = cfg.proxy && typeof cfg.proxy === 'object' ? cfg.proxy : undefined
  return {
    apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : undefined,
    baseUrl: typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim() ? cfg.baseUrl.trim() : undefined,
    model: typeof cfg.model === 'string' ? cfg.model : undefined,
    proxy,
    providers: readProviders(raw)
  }
}

export function writeApiConfig(patch: Partial<ApiConfig>): ApiConfig {
  const current = readApiConfig()
  const next: ApiConfig = { ...current }
  if (typeof patch.apiKey === 'string') next.apiKey = patch.apiKey
  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl
  if (patch.model !== undefined) next.model = patch.model
  if (patch.proxy !== undefined) next.proxy = patch.proxy
  if (patch.providers !== undefined) next.providers = patch.providers
  writeJsonAtomic(getApiConfigPath(), next)
  logger.info('API 配置已保存')
  return next
}

/**
 * 路由名 → 凭据环境变量引用（POSIX 标识符）。
 * 例：acme-gateway → DSHW_PROVIDER_ACME_GATEWAY。
 */
export function providerApiKeyEnv(route: string): string {
  const upper = route.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const cleaned = upper.replace(/^[0-9]+/, '')
  return `DSHW_PROVIDER_${cleaned || 'ROUTE'}`
}

/** 校验自定义提供方；返回错误文案，无错返回 null。 */
export function validateProvider(route: string, p: ProviderConfig): string | null {
  const routeOk = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(route.trim())
  if (!routeOk) return '路由名只能包含字母、数字、点、下划线与连字符'
  if (!p.baseUrl?.trim()) return '请填写 Base URL'
  const models = p.models ?? []
  if (models.length === 0) return '请至少填写一个模型 id（或用「获取模型列表」从端点拉取）'
  return null
}

// ---------------------------------------------------------------------------
// dsh 同步（纯函数，便于测试）
// ---------------------------------------------------------------------------

/**
 * 生成 settings.yaml 的 llm-deepseek 段（官方提供方）。
 * 桌面端只管理 baseURL 与 apiKeyEnv 两个键，其余键（thinking/models/…）保留。
 */
export function buildDeepseekSection(
  baseUrl: string | undefined,
  apiKeyConfigured: boolean
): Record<string, unknown> | undefined {
  const section: Record<string, unknown> = {}
  if (baseUrl?.trim()) section.baseURL = baseUrl.trim()
  if (apiKeyConfigured || baseUrl?.trim()) section.apiKeyEnv = DEEPSEEK_API_KEY_ENV
  return Object.keys(section).length > 0 ? section : undefined
}

/** 生成 llm-pi-ai 段的 providers 字典（合并保留非桌面管理的路由）。 */
export function buildPiAiProviders(providers: Record<string, ProviderConfig> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [route, p] of Object.entries(providers ?? {})) {
    const entry: Record<string, unknown> = {
      displayName: p.displayName?.trim() || route,
      apiKeyEnv: providerApiKeyEnv(route)
    }
    if (p.api) entry.api = p.api
    if (p.baseUrl?.trim()) entry.baseURL = p.baseUrl.trim()
    const models = (p.models ?? []).filter((m) => m.trim().length > 0).map((m) => ({ id: m.trim() }))
    if (models.length > 0) entry.models = models
    out[route] = entry
  }
  return out
}

/**
 * 合并生成 settings.yaml 全文（注释与其它段由 js-yaml 保留为对象后重排）。
 * prevRoutes：上一次由桌面管理的提供方路由（用于删除）。
 */
export function renderSettingsDocument(
  text: string | undefined,
  prevRoutes: string[],
  next: ApiConfig
): string {
  const existing: Record<string, unknown> = text && text.trim() ? ((yaml.load(text) as Record<string, unknown>) ?? {}) : {}
  const merged: Record<string, unknown> = { ...existing }

  // llm-deepseek：合并官方段（桌面端只管理 baseURL / apiKeyEnv，先清掉再合并，避免残留）
  const prevDs = existing['llm-deepseek']
  const prevDsObj = prevDs && typeof prevDs === 'object' && !Array.isArray(prevDs) ? (prevDs as Record<string, unknown>) : {}
  const managed: Record<string, unknown> = { ...prevDsObj }
  delete managed.baseURL
  delete managed.apiKeyEnv
  const nextDs = buildDeepseekSection(next.baseUrl, Boolean(next.apiKey?.trim()))
  if (nextDs) {
    merged['llm-deepseek'] = { ...managed, ...nextDs }
  } else if (Object.keys(managed).length > 0) {
    merged['llm-deepseek'] = managed
  } else {
    delete merged['llm-deepseek']
  }

  // llm-pi-ai：合并 providers，先删除桌面曾管理、现已删除的路由
  const prevPi = existing['llm-pi-ai']
  const prevProviders =
    prevPi && typeof prevPi === 'object' && !Array.isArray(prevPi)
      ? ((prevPi as Record<string, unknown>).providers as Record<string, unknown> | undefined) ?? {}
      : {}
  const providers = { ...prevProviders }
  for (const route of prevRoutes) delete providers[route]
  Object.assign(providers, buildPiAiProviders(next.providers))
  if (Object.keys(providers).length > 0) {
    merged['llm-pi-ai'] = { providers }
  } else {
    delete merged['llm-pi-ai']
  }

  return yaml.dump(merged, { lineWidth: -1, noRefs: true, noCompatMode: true, sortKeys: false })
}

/**
 * 生成 .credentials.yaml 全文（ref → 非空字符串的扁平映射，与 dsh-credentials-local 一致）。
 * value 传 undefined 表示删除该引用。
 */
export function renderCredentialsDocument(text: string | undefined, ref: string, value: string | undefined): string {
  const existing: Record<string, unknown> = text && text.trim() ? ((yaml.load(text) as Record<string, unknown>) ?? {}) : {}
  if (value === undefined || value.length === 0) delete existing[ref]
  else existing[ref] = value
  return yaml.dump(existing, { lineWidth: -1, noRefs: true, noCompatMode: true, sortKeys: false })
}

/**
 * 计算 .credentials.yaml 的写入计划（ref → 值；undefined = 删除）。
 * 规则：桌面端配置了 Key 才写；桌面端原本有 Key 且被清空才删除；
 * 桌面端从未配置过（如旧 dsh 迁移、由 Models 页写入）则保留原值，避免误删。
 */
export function planCredentialWrites(
  prev: ApiConfig,
  next: ApiConfig
): Array<{ ref: string; value: string | undefined }> {
  const writes: Array<{ ref: string; value: string | undefined }> = []
  if (next.apiKey?.trim()) writes.push({ ref: DEEPSEEK_API_KEY_ENV, value: next.apiKey.trim() })
  else if (prev.apiKey?.trim()) writes.push({ ref: DEEPSEEK_API_KEY_ENV, value: undefined })

  const nextRoutes = Object.keys(next.providers ?? {})
  const prevRoutes = Object.keys(prev.providers ?? {})
  const allRoutes = [...new Set([...nextRoutes, ...prevRoutes])]
  for (const route of allRoutes) {
    const ref = providerApiKeyEnv(route)
    const p = next.providers?.[route]
    if (p?.apiKey?.trim()) {
      writes.push({ ref, value: p.apiKey.trim() })
    } else if (prev.providers?.[route]?.apiKey?.trim()) {
      writes.push({ ref, value: undefined })
    }
  }
  return writes
}

/**
 * 同步 API 配置到 dsh（$DSH_HOME 下）：settings.yaml + .credentials.yaml。
 * prev：同步前的配置（用于识别被删除的提供方路由）；next：同步后的配置。
 */
export function syncApiToDsh(prev: ApiConfig, next: ApiConfig): { ok: boolean; error?: string } {
  try {
    const home = path.join(getWorkspaceDir(), 'data')
    const settingsPath = path.join(home, 'settings.yaml')
    const credsPath = path.join(home, '.credentials.yaml')
    fs.mkdirSync(home, { recursive: true })

    const prevRoutes = Object.keys(prev.providers ?? {})
    const settingsText = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : undefined
    fs.writeFileSync(settingsPath, renderSettingsDocument(settingsText, prevRoutes, next), 'utf8')

    const credsText = fs.existsSync(credsPath) ? fs.readFileSync(credsPath, 'utf8') : undefined
    let creds = credsText ?? ''
    for (const { ref, value } of planCredentialWrites(prev, next)) {
      creds = renderCredentialsDocument(creds, ref, value)
    }
    fs.writeFileSync(credsPath, creds, 'utf8')

    logger.info('API 配置已同步到 dsh（settings.yaml / .credentials.yaml）')
    return { ok: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error(`同步 API 配置到 dsh 失败：${reason}`)
    return { ok: false, error: `同步到 dsh 失败：${reason}` }
  }
}

/** 测试连接：向 chat/completions 发一次最小请求（规格 6.19）。 */
export async function testApiConnection(cfg: ApiConfig): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  const key = (cfg.apiKey ?? '').trim()
  if (!key) return { ok: false, error: '请先填写 API Key' }
  const base = (cfg.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const model = cfg.model || MODEL_LIST[0].value
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000)
    })
    const latencyMs = Date.now() - start
    if (res.ok) return { ok: true, latencyMs }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `API Key 无效或无权访问（HTTP ${res.status}）`, latencyMs }
    }
    const body = (await res.text()).slice(0, 200)
    return { ok: false, error: `请求失败（HTTP ${res.status}）：${body}`, latencyMs }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, error: '请求超时（15 秒）' }
    }
    return { ok: false, error: `网络错误：${reason}` }
  }
}

/**
 * 从 OpenAI 兼容端点获取模型列表（dsh-llm-pi-ai 的 discoverModels 同源：
 * GET {baseURL}/models，Bearer 认证，4MB 上限）。用于自定义提供方「获取模型列表」。
 */
export async function discoverModels(
  baseUrl: string,
  apiKey: string | undefined
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const base = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return { ok: false, error: '请先填写 Base URL' }
  const url = `${base}/models`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(apiKey?.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {})
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? '；请检查 API Key' : ''
      return { ok: false, error: `端点返回 HTTP ${res.status}${hint}` }
    }
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> }
    const ids: string[] = []
    for (const entry of Array.isArray(body?.data) ? body.data : []) {
      if (entry && typeof entry.id === 'string' && entry.id.length > 0) ids.push(entry.id)
    }
    if (ids.length === 0) return { ok: false, error: '端点没有返回可用的模型列表（无 data[].id）' }
    return { ok: true, models: ids }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, error: '请求超时（15 秒）' }
    }
    return { ok: false, error: `网络错误：${reason}` }
  }
}

/** 代理环境变量（规格 6.20：注入所有子进程 env）。 */
export function buildProxyEnv(cfg: ApiConfig): { vars: Record<string, string>; remove: string[] } {
  const proxy = cfg.proxy
  if (!proxy || proxy.mode === 'system') return { vars: {}, remove: [] }
  if (proxy.mode === 'none') {
    return { vars: {}, remove: ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] }
  }
  const vars: Record<string, string> = {}
  const noProxy = '127.0.0.1,localhost,::1'
  if (proxy.socks5?.trim()) {
    vars['ALL_PROXY'] = proxy.socks5.trim()
    vars['all_proxy'] = proxy.socks5.trim()
  } else {
    if (proxy.http?.trim()) {
      vars['HTTP_PROXY'] = proxy.http.trim()
      vars['http_proxy'] = proxy.http.trim()
    }
    if (proxy.https?.trim()) {
      vars['HTTPS_PROXY'] = proxy.https.trim()
      vars['https_proxy'] = proxy.https.trim()
    }
  }
  vars['NO_PROXY'] = noProxy
  vars['no_proxy'] = noProxy
  return { vars, remove: [] }
}
