import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeSettingsNamespaces, listAgentPresets, readUiSettings } from '../dshUi'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-ui-test-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function dataDir(): string {
  const d = path.join(tmp, 'data')
  fs.mkdirSync(d, { recursive: true })
  return d
}

describe('mergeSettingsNamespaces（同步 dsh settings.yaml）', () => {
  it('写入命名空间并保留其它段', () => {
    const text = mergeSettingsNamespaces('ui-onboarding:\n  welcomeNoticeVersion: x\n', {
      locale: { preference: 'en' },
      'ui-theme': { preference: 'dark' },
      'agent-presets': { default: 'code' }
    })
    expect(text).toContain('ui-onboarding:')
    expect(text).toContain('locale:')
    expect(text).toContain('preference: en')
    expect(text).toContain('ui-theme:')
    expect(text).toContain('preference: dark')
    expect(text).toContain('agent-presets:')
    expect(text).toContain('default: code')
  })

  it('合并而非覆盖：命名空间内未管理的字段保留', () => {
    const text = mergeSettingsNamespaces('ui-theme:\n  preference: system\n  otherField: keep\n', {
      'ui-theme': { preference: 'light' }
    })
    expect(text).toContain('preference: light')
    expect(text).toContain('otherField: keep')
  })
})

describe('listAgentPresets / readUiSettings', () => {
  it('识别随 dsh 安装的预设目录（agent.cordis.yml + preset.yml 显示名）', () => {
    const shipped = path.join(tmp, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')
    fs.mkdirSync(path.join(shipped, 'standard'), { recursive: true })
    fs.writeFileSync(path.join(shipped, 'standard', 'agent.cordis.yml'), '- id: agent\n')
    fs.writeFileSync(path.join(shipped, 'standard', 'preset.yml'), 'name: 标准模式\ndescription: 功能完整的编码 Agent\n')
    fs.mkdirSync(path.join(shipped, 'code'), { recursive: true })
    fs.writeFileSync(path.join(shipped, 'code', 'agent.cordis.yml'), '- id: agent\n')

    const presets = listAgentPresets(tmp)
    expect(presets.map((p) => p.id)).toEqual(['standard', 'code'])
    expect(presets[0].name).toBe('标准模式')
    expect(presets[0].shipped).toBe(true)
  })

  it('读取当前设置（含默认值）', () => {
    dataDir()
    const s = readUiSettings(tmp)
    expect(s.locale).toBe('zh')
    expect(s.theme).toBe('system')
    expect(s.defaultAgentPreset).toBe('standard')
    expect(s.showDshSidebar).toBe(false)
    expect(Array.isArray(s.presets)).toBe(true)
  })
})
