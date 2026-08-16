import { describe, expect, it } from 'vitest'
import {
  buildProxyEnv,
  MODEL_LIST,
  DEFAULT_BASE_URL,
  renderSettingsDocument,
  renderCredentialsDocument,
  buildPiAiProviders,
  providerApiKeyEnv,
  validateProvider,
  planCredentialWrites
} from '../apiConfig'
import type { ApiConfig } from '../apiConfig'

describe('MODEL_LIST / DEFAULT_BASE_URL', () => {
  it('模型列表与 dsh-llm-deepseek 默认目录一致', () => {
    expect(MODEL_LIST.map((m) => m.value)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(DEFAULT_BASE_URL).toBe('https://api.deepseek.com')
  })
})

describe('providerApiKeyEnv / validateProvider', () => {
  it('路由名生成 POSIX 凭据引用', () => {
    expect(providerApiKeyEnv('acme-gateway')).toBe('DSHW_PROVIDER_ACME_GATEWAY')
    expect(providerApiKeyEnv('My Provider 2')).toBe('DSHW_PROVIDER_MY_PROVIDER_2')
    expect(providerApiKeyEnv('123abc')).toMatch(/^DSHW_PROVIDER_[A-Z]+$/)
  })

  it('校验：缺 Base URL / 缺模型 → 拒绝', () => {
    expect(validateProvider('ok-route', { baseUrl: 'https://x', models: ['m1'] })).toBeNull()
    expect(validateProvider('bad route!', { baseUrl: 'https://x', models: ['m1'] })).toContain('路由名')
    expect(validateProvider('ok', { baseUrl: '', models: ['m1'] })).toContain('Base URL')
    expect(validateProvider('ok', { baseUrl: 'https://x' })).toContain('模型')
  })
})

describe('renderSettingsDocument（同步到 dsh settings.yaml）', () => {
  it('空文档 + 官方 Key → 只写 llm-deepseek', () => {
    const text = renderSettingsDocument(undefined, [], { apiKey: 'sk-a', model: 'deepseek-v4-flash' })
    expect(text).toContain('llm-deepseek:')
    expect(text).toContain('apiKeyEnv: DEEPSEEK_API_KEY')
    expect(text).not.toContain('llm-pi-ai')
  })

  it('自定义 Base URL → llm-deepseek.baseURL；清除后不残留', () => {
    const text = renderSettingsDocument(undefined, [], { apiKey: 'sk-a', baseUrl: 'https://gw.example.com/v1' })
    expect(text).toContain('baseURL: https://gw.example.com/v1')
    const cleared = renderSettingsDocument(text, [], { apiKey: 'sk-a' })
    expect(cleared).not.toContain('baseURL')
    expect(cleared).toContain('llm-deepseek:')
  })

  it('保留既有段（如 ui-onboarding）', () => {
    const prev = 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n'
    const text = renderSettingsDocument(prev, [], { apiKey: 'sk-a' })
    expect(text).toContain('ui-onboarding:')
    expect(text).toContain('welcomeNoticeVersion: 2026-08-13.1')
  })

  it('自定义提供方 → llm-pi-ai.providers（含 displayName/api/baseURL/models/apiKeyEnv）', () => {
    const cfg: ApiConfig = {
      apiKey: 'sk-a',
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseUrl: 'https://gateway.acme.example/v1',
          apiKey: 'sk-acme',
          models: ['acme-large', 'acme-think']
        }
      }
    }
    const text = renderSettingsDocument(undefined, [], cfg)
    expect(text).toContain('llm-pi-ai:')
    expect(text).toContain('acme-gateway:')
    expect(text).toContain('displayName: Acme Gateway')
    expect(text).toContain('apiKeyEnv: DSHW_PROVIDER_ACME_GATEWAY')
    expect(text).toContain('baseURL: https://gateway.acme.example/v1')
    expect(text).toContain('- id: acme-large')
    expect(text).toContain('- id: acme-think')
  })

  it('删除桌面管理的路由 → 从 providers 移除，保留其它路由', () => {
    const prev = renderSettingsDocument(undefined, [], {
      providers: {
        'acme-gateway': { baseUrl: 'https://a', models: ['m1'] },
        'other-route': { baseUrl: 'https://b', models: ['m2'] }
      }
    })
    const text = renderSettingsDocument(prev, ['acme-gateway'], { providers: { 'other-route': { baseUrl: 'https://b', models: ['m2'] } } })
    expect(text).not.toContain('acme-gateway')
    expect(text).toContain('other-route:')
  })

  it('全部清空 → 不残留 llm 段', () => {
    const prev = renderSettingsDocument(undefined, [], { apiKey: 'sk-a', providers: { x: { baseUrl: 'https://x', models: ['m'] } } })
    const text = renderSettingsDocument(prev, ['x'], {})
    expect(text).not.toContain('llm-deepseek')
    expect(text).not.toContain('llm-pi-ai')
  })
})

describe('renderCredentialsDocument（同步到 dsh .credentials.yaml）', () => {
  it('设置 / 覆盖 / 删除引用', () => {
    const t1 = renderCredentialsDocument(undefined, 'DEEPSEEK_API_KEY', 'sk-1')
    expect(t1).toContain('DEEPSEEK_API_KEY: sk-1')
    const t2 = renderCredentialsDocument(t1, 'DEEPSEEK_API_KEY', 'sk-2')
    expect(t2).toContain('DEEPSEEK_API_KEY: sk-2')
    expect(t2).not.toContain('sk-1')
    const t3 = renderCredentialsDocument(t2, 'DEEPSEEK_API_KEY', undefined)
    // 空文档 = 空映射（与 dsh-credentials-local 的 Document({}) 行为一致）
    expect(t3.trim()).toBe('{}')
  })

  it('保留其它凭据条目', () => {
    const t1 = renderCredentialsDocument(undefined, 'DSHW_PROVIDER_A', 'sk-a')
    const t2 = renderCredentialsDocument(t1, 'DEEPSEEK_API_KEY', 'sk-d')
    expect(t2).toContain('DSHW_PROVIDER_A: sk-a')
    expect(t2).toContain('DEEPSEEK_API_KEY: sk-d')
  })
})

describe('planCredentialWrites（防误删迁移凭据）', () => {
  it('桌面端新配 Key → 写入；清空 → 删除', () => {
    const writes = planCredentialWrites({}, { apiKey: 'sk-new' })
    expect(writes).toContainEqual({ ref: 'DEEPSEEK_API_KEY', value: 'sk-new' })
    const clear = planCredentialWrites({ apiKey: 'sk-old' }, {})
    expect(clear).toContainEqual({ ref: 'DEEPSEEK_API_KEY', value: undefined })
  })

  it('桌面端从未配 Key（迁移自 dsh Models 页）→ 不动 dsh 凭据', () => {
    const writes = planCredentialWrites({}, {})
    expect(writes).toEqual([])
  })

  it('提供方 Key：写入 / 清空 / 路由删除', () => {
    const withKey = planCredentialWrites({}, { providers: { gw: { apiKey: 'sk-gw' } } })
    expect(withKey).toContainEqual({ ref: 'DSHW_PROVIDER_GW', value: 'sk-gw' })
    const cleared = planCredentialWrites({ providers: { gw: { apiKey: 'sk-gw' } } }, { providers: { gw: {} } })
    expect(cleared).toContainEqual({ ref: 'DSHW_PROVIDER_GW', value: undefined })
    const removed = planCredentialWrites({ providers: { gw: { apiKey: 'sk-gw' } } }, {})
    expect(removed).toContainEqual({ ref: 'DSHW_PROVIDER_GW', value: undefined })
  })
})

describe('buildPiAiProviders', () => {
  it('手声明路由包含 apiKeyEnv / api / baseURL / models', () => {
    const out = buildPiAiProviders({
      gw: { api: 'openai-completions', baseUrl: 'https://gw/v1', apiKey: 'sk', models: ['a', 'b'] }
    })
    expect(out['gw']).toMatchObject({
      apiKeyEnv: 'DSHW_PROVIDER_GW',
      api: 'openai-completions',
      baseURL: 'https://gw/v1',
      models: [{ id: 'a' }, { id: 'b' }]
    })
  })
})

describe('buildProxyEnv（规格 6.20 代理注入）', () => {
  it('不使用 → 移除所有代理变量', () => {
    const { vars, remove } = buildProxyEnv({ proxy: { mode: 'none' } })
    expect(Object.keys(vars).length).toBe(0)
    expect(remove).toContain('HTTP_PROXY')
    expect(remove).toContain('ALL_PROXY')
  })

  it('系统代理 → 不注入也不移除（继承环境）', () => {
    const { vars, remove } = buildProxyEnv({ proxy: { mode: 'system' } })
    expect(vars).toEqual({})
    expect(remove).toEqual([])
  })

  it('手动 HTTP/HTTPS → 注入对应变量并豁免本地地址', () => {
    const cfg: ApiConfig = { proxy: { mode: 'manual', http: 'http://127.0.0.1:7890', https: 'http://127.0.0.1:7890' } }
    const { vars } = buildProxyEnv(cfg)
    expect(vars['HTTP_PROXY']).toBe('http://127.0.0.1:7890')
    expect(vars['HTTPS_PROXY']).toBe('http://127.0.0.1:7890')
    expect(vars['NO_PROXY']).toContain('localhost')
  })

  it('SOCKS5 优先于 HTTP/HTTPS', () => {
    const cfg: ApiConfig = { proxy: { mode: 'manual', http: 'http://x', socks5: 'socks5://127.0.0.1:1080' } }
    const { vars } = buildProxyEnv(cfg)
    expect(vars['ALL_PROXY']).toBe('socks5://127.0.0.1:1080')
    expect(vars['HTTP_PROXY']).toBeUndefined()
  })

  it('未配置代理 → 等同系统模式', () => {
    const { vars, remove } = buildProxyEnv({})
    expect(vars).toEqual({})
    expect(remove).toEqual([])
  })
})
