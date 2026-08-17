import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { syncModelsConfigToDsh, collectProviderEnv } from '../modelsDshSync'
import { updateProviderConfig, updateCustomProvider } from '../provider-registry'
import { saveApiKeySecure } from '../secure-storage'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mds-'))
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'settings.yaml'), 'locale:\n  preference: zh\n')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('模型配置 → dsh 同步', () => {
  it('deepseek 启用 → llm-deepseek.models + 顶层 model', () => {
    updateProviderConfig(dir, 'deepseek', {
      enabled: true,
      models: ['deepseek-chat', 'deepseek-reasoner'],
      defaultChat: 'deepseek-chat'
    })
    syncModelsConfigToDsh(dir)
    const yaml = fs.readFileSync(path.join(dir, 'data', 'settings.yaml'), 'utf8')
    expect(yaml).toContain('llm-deepseek:')
    expect(yaml).toContain('baseURL: https://api.deepseek.com')
    expect(yaml).toContain('id: deepseek-chat')
    expect(yaml).toContain('id: deepseek-reasoner')
    expect(yaml).toContain('model: deepseek-chat')
  })

  it('其他厂商 → llm-pi-ai.providers（含自定义）', () => {
    updateProviderConfig(dir, 'qwen', { enabled: true, models: ['qwen-max'], baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
    updateCustomProvider(dir, { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai', models: ['anthropic/claude-3.5'], enabled: true })
    syncModelsConfigToDsh(dir)
    const yaml = fs.readFileSync(path.join(dir, 'data', 'settings.yaml'), 'utf8')
    expect(yaml).toContain('llm-pi-ai:')
    expect(yaml).toContain('qwen:')
    expect(yaml).toContain('baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(yaml).toContain('openrouter:')
    expect(yaml).toContain('DSHW_PROVIDER_QWEN')
    expect(yaml).toContain('DSHW_PROVIDER_OPENROUTER')
  })

  it('未启用厂商不同步；禁用后删除对应段', () => {
    updateProviderConfig(dir, 'deepseek', { enabled: true, models: ['deepseek-chat'] })
    syncModelsConfigToDsh(dir)
    expect(fs.readFileSync(path.join(dir, 'data', 'settings.yaml'), 'utf8')).toContain('llm-deepseek:')
    updateProviderConfig(dir, 'deepseek', { enabled: false })
    syncModelsConfigToDsh(dir)
    expect(fs.readFileSync(path.join(dir, 'data', 'settings.yaml'), 'utf8')).not.toContain('llm-deepseek:')
  })

  it('collectProviderEnv：解密注入各厂商 Key env', () => {
    saveApiKeySecure(dir, 'deepseek', 'sk-deep')
    saveApiKeySecure(dir, 'qwen', 'sk-qwen')
    updateProviderConfig(dir, 'deepseek', { enabled: true, models: ['deepseek-chat'] })
    updateProviderConfig(dir, 'qwen', { enabled: true, models: ['qwen-max'] })
    const env = collectProviderEnv(dir)
    expect(env.DEEPSEEK_API_KEY).toBe('sk-deep')
    expect(env.DSHW_PROVIDER_QWEN).toBe('sk-qwen')
    // 未启用的厂商不注入
    updateProviderConfig(dir, 'qwen', { enabled: false })
    const env2 = collectProviderEnv(dir)
    expect(env2.DSHW_PROVIDER_QWEN).toBeUndefined()
  })
})
