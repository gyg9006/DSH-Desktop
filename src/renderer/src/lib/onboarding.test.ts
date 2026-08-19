import { describe, expect, it } from 'vitest'
import { allEnvOk, envItemsNeedingAction } from './onboarding'
import type { EnvReport } from '@shared/ipc'

function reportOf(states: Array<EnvReport['items'][number]['state']>): EnvReport {
  return {
    items: states.map((state, i) => ({ key: ['node', 'npm', 'pnpm', 'git', 'dsh'][i] as EnvReport['items'][number]['key'], name: 'x', state, version: state === 'ok' ? 'v1.0.0' : null, source: 'none' })),
    checkedAt: new Date().toISOString(),
    summary: { ok: 0, missing: 0, incompatible: 0, error: 0 }
  }
}

describe('onboarding 环境逻辑', () => {
  it('allEnvOk：全部 ok 才通过', () => {
    expect(allEnvOk(reportOf(['ok', 'ok', 'ok', 'ok', 'ok']))).toBe(true)
    expect(allEnvOk(reportOf(['ok', 'missing', 'ok', 'ok', 'ok']))).toBe(false)
    expect(allEnvOk(null)).toBe(false)
  })
  it('envItemsNeedingAction：列出 missing/incompatible', () => {
    expect(envItemsNeedingAction(reportOf(['ok', 'missing', 'ok', 'incompatible', 'ok']))).toEqual(['npm', 'git'])
    expect(envItemsNeedingAction(null)).toEqual([])
  })
})
