/**
 * 模型适配层（全局基础设施，供会话 / 弹窗 / 知识提炼流程共用）：
 * - OpenAICompatibleAdapter：覆盖 OpenAI / DeepSeek / 千问 / GLM / Kimi / Grok /
 *   中转（OpenRouter / SiliconFlow / One API）/ LM Studio / vLLM / LocalAI；
 * - AnthropicAdapter：Claude Messages API；
 * - OllamaNativeAdapter：本地 /api/tags 与 /api/chat。
 * 全部支持 SSE 流式输出；经主进程转发，规避 CORS。
 */
import { logger } from './logger'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatStreamParams {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface ModelAdapter {
  kind: 'openai' | 'anthropic' | 'ollama'
  listModels(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; models?: string[]; error?: string }>
  testConnection(baseUrl: string, apiKey?: string, model?: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
  chatStream(baseUrl: string, apiKey: string | undefined, params: ChatStreamParams): AsyncGenerator<string>
}

// ---------------------------------------------------------------------------
// SSE 解析
// ---------------------------------------------------------------------------

export function* parseSseLines(body: string): Generator<string> {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return
    if (!payload) continue
    yield payload
  }
}

// ---------------------------------------------------------------------------
// OpenAI 兼容适配器
// ---------------------------------------------------------------------------

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly kind = 'openai' as const

  private async req(baseUrl: string, path: string, init: RequestInit): Promise<Response> {
    return fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15000)
    })
  }

  async listModels(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const res = await this.req(baseUrl, '/models', {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const body = (await res.json()) as { data?: Array<{ id?: string }> }
      const models = (body.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string')
      return { ok: true, models }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async testConnection(baseUrl: string, apiKey?: string, model?: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now()
    try {
      if (!apiKey) return { ok: false, error: '未配置 API Key' }
      // 优先 /models 轻量探测；失败回退最小 chat 请求
      let res = await this.req(baseUrl, '/models', { headers: { Authorization: `Bearer ${apiKey}` } })
      if (!res.ok && model) {
        res = await this.req(baseUrl, '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
        })
      }
      if (!res.ok) {
        const reason = res.status === 401 ? 'Key 无效' : res.status === 404 ? '模型不存在或端点不支持' : `HTTP ${res.status}`
        return { ok: false, latencyMs: Date.now() - start, error: reason }
      }
      return { ok: true, latencyMs: Date.now() - start }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const reason = /fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(msg) ? '网络不通' : msg
      return { ok: false, latencyMs: Date.now() - start, error: reason }
    }
  }

  async *chatStream(baseUrl: string, apiKey: string | undefined, params: ChatStreamParams): AsyncGenerator<string> {
    const res = await this.req(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: true,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens
      }),
      signal: params.signal
    })
    if (!res.ok || !res.body) {
      throw new Error(`chat 请求失败（HTTP ${res.status}）`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (const payload of parseSseLines(buffer)) {
          try {
            const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
            const delta = json.choices?.[0]?.delta?.content
            if (delta) yield delta
          } catch {
            /* 忽略非 JSON 行 */
          }
        }
        // 保留未完成行
        const lastNl = buffer.lastIndexOf('\n')
        if (lastNl >= 0) buffer = buffer.slice(lastNl + 1)
      }
    } finally {
      reader.releaseLock()
    }
  }
}

// ---------------------------------------------------------------------------
// Anthropic 适配器
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ModelAdapter {
  readonly kind = 'anthropic' as const

  private async req(baseUrl: string, path: string, apiKey: string | undefined, init: RequestInit): Promise<Response> {
    return fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey ?? '',
        'anthropic-version': '2023-06-01',
        ...(init.headers ?? {})
      },
      signal: init.signal ?? AbortSignal.timeout(15000)
    })
  }

  async listModels(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    // Anthropic 无公开 /models 端点：返回 null（UI 用预设模型）
    return { ok: true, models: [] }
  }

  async testConnection(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now()
    try {
      if (!apiKey) return { ok: false, error: '未配置 API Key' }
      const res = await this.req(baseUrl, '/v1/messages', apiKey, {
        method: 'POST',
        body: JSON.stringify({ model: 'claude-3-5-haiku', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      })
      if (!res.ok) {
        const reason = res.status === 401 ? 'Key 无效' : `HTTP ${res.status}`
        return { ok: false, latencyMs: Date.now() - start, error: reason }
      }
      return { ok: true, latencyMs: Date.now() - start }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { ok: false, latencyMs: Date.now() - start, error: /fetch failed|ENOTFOUND|timeout/i.test(msg) ? '网络不通' : msg }
    }
  }

  async *chatStream(baseUrl: string, apiKey: string | undefined, params: ChatStreamParams): AsyncGenerator<string> {
    const res = await this.req(baseUrl, '/v1/messages', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: params.model,
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: params.maxTokens ?? 2000,
        stream: true
      }),
      signal: params.signal
    })
    if (!res.ok || !res.body) throw new Error(`Anthropic chat 请求失败（HTTP ${res.status}）`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (const payload of parseSseLines(buffer)) {
          try {
            const json = JSON.parse(payload) as { type?: string; delta?: { text?: string } }
            if (json.type === 'content_block_delta' && json.delta?.text) yield json.delta.text
          } catch {
            /* ignore */
          }
        }
        const lastNl = buffer.lastIndexOf('\n')
        if (lastNl >= 0) buffer = buffer.slice(lastNl + 1)
      }
    } finally {
      reader.releaseLock()
    }
  }
}

// ---------------------------------------------------------------------------
// Ollama 本地适配器
// ---------------------------------------------------------------------------

export class OllamaNativeAdapter implements ModelAdapter {
  readonly kind = 'ollama' as const

  async listModels(baseUrl: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const body = (await res.json()) as { models?: Array<{ name?: string }> }
      const models = (body.models ?? []).map((m) => m.name).filter((x): x is string => typeof x === 'string')
      return { ok: true, models }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { ok: false, error: /ECONNREFUSED|fetch failed/i.test(msg) ? '无法连接 Ollama（请确认已启动 http://localhost:11434）' : msg }
    }
  }

  async testConnection(baseUrl: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now()
    const r = await this.listModels(baseUrl)
    return { ok: r.ok, latencyMs: Date.now() - start, error: r.error }
  }

  async *chatStream(baseUrl: string, _apiKey: string | undefined, params: ChatStreamParams): AsyncGenerator<string> {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: params.model, messages: params.messages, stream: true }),
      signal: params.signal
    })
    if (!res.ok || !res.body) throw new Error(`Ollama chat 请求失败（HTTP ${res.status}）`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          try {
            const json = JSON.parse(line) as { message?: { content?: string } }
            if (json.message?.content) yield json.message.content
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}

export function createAdapter(protocol: 'openai' | 'anthropic' | 'ollama'): ModelAdapter {
  switch (protocol) {
    case 'anthropic':
      return new AnthropicAdapter()
    case 'ollama':
      return new OllamaNativeAdapter()
    default:
      return new OpenAICompatibleAdapter()
  }
}

/** 便捷：测试指定协议连接（供 IPC 调用）。 */
export async function testAdapterConnection(
  protocol: 'openai' | 'anthropic' | 'ollama',
  baseUrl: string,
  apiKey: string | undefined,
  model?: string
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  try {
    const adapter = createAdapter(protocol)
    return await adapter.testConnection(baseUrl, apiKey, model)
  } catch (error) {
    logger.warn(`连接测试异常：${String(error)}`)
    return { ok: false, error: String(error) }
  }
}

/** 便捷：拉取模型列表（供 IPC 调用）。 */
export async function listModelsFor(
  protocol: 'openai' | 'anthropic' | 'ollama',
  baseUrl: string,
  apiKey: string | undefined
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const adapter = createAdapter(protocol)
    return await adapter.listModels(baseUrl, apiKey)
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
