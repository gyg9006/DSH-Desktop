import { describe, expect, it } from 'vitest'
import {
  allEnvOk,
  envItemsNeedingAction,
  buildTestInput,
  pickDefaultProvider,
  providerName
} from './onboarding'
import type { EnvReport, ModelsViewPayload, ModelProviderPreset } from '@shared/ipc'

function reportOf(states: Array<EnvReport['items'][number]['state']>): EnvReport {
  return {
    items: states.map((state, i) => ({
      key: ['node', 'npm', 'pnpm', 'git', 'dsh'][i] as EnvReport['items'][number]['key'],
      name: 'x',
      state,
      version: state === 'ok' ? 'v1.0.0' : null,
      source: 'none'
    })),
    checkedAt: new Date().toISOString(),
    summary: { ok: 0, missing: 0, incompatible: 0, error: 0 }
  }
}

describe('onboarding 纯逻辑', () => {
  it('allEnvOk：全部 ok 才通过，空报告/任一非 ok 均不通过', () => {
    expect(allEnvOk(reportOf(['ok', 'ok', 'ok', 'ok', 'ok']))).toBe(true)
    expect(allEnvOk(reportOf(['ok', 'missing', 'ok', 'ok', 'ok']))).toBe(false)
    expect(allEnvOk(reportOf(['ok', 'ok', 'ok', 'ok', 'incompatible']))).toBe(false)
    expect(allEnvOk(null)).toBe(false)
    expect(allEnvOk({ ...reportOf([]), items: [] })).toBe(false)
  })

  it('envItemsNeedingAction：只列 missing/incompatible', () => {
    expect(envItemsNeedingAction(reportOf(['ok', 'missing', 'ok', 'incompatible', 'ok']))).toEqual(['npm', 'git'])
    expect(envItemsNeedingAction(reportOf(['ok', 'ok', 'ok', 'ok', 'ok']))).toEqual([])
    expect(envItemsNeedingAction(null)).toEqual([])
  })

  it('buildTestInput：用预设 protocol/baseUrl 与默认模型', () => {
    const preset: ModelProviderPreset = {
      id: 'deepseek',
      name: 'DeepSeek',
      region: 'china',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com',
      defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
      keyRequired: true
    }
    expect(buildTestInput('deepseek', preset)).toEqual({
      providerId: 'deepseek',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    })
    expect(buildTestInput('deepseek', preset, 'deepseek-reasoner')?.model).toBe('deepseek-reasoner')
    expect(buildTestInput('x', undefined)).toBeNull()
  })

  it('pickDefaultProvider：优先已配 Key，其次 keyRequired，兜底第一个', () => {
    const view: ModelsViewPayload = {
      presets: [
        { id: 'a', name: 'A', region: 'international', protocol: 'openai', baseUrl: 'u', defaultModels: [], keyRequired: true },
        { id: 'b', name: 'B', region: 'china', protocol: 'openai', baseUrl: 'u', defaultModels: [], keyRequired: false }
      ],
      custom: [],
      providers: {},
      keyMasks: { b: 'sk-****1234' }
    }
    expect(pickDefaultProvider(view)).toBe('b')
    expect(pickDefaultProvider({ ...view, keyMasks: {} })).toBe('a')
    expect(pickDefaultProvider({ ...view, presets: [], keyMasks: {} })).toBeNull()
    expect(pickDefaultProvider(null)).toBeNull()
  })

  it('providerName：有名称用名称，无则回退 id', () => {
    expect(providerName({ id: 'x', name: 'X', region: 'china', protocol: 'openai', baseUrl: 'u', defaultModels: [], keyRequired: false }, 'x')).toBe('X')
    expect(providerName(undefined, 'x')).toBe('x')
  })
})
