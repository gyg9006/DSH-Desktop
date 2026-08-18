import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setPluginEnabled, getPluginStates, readBundlePluginNames, expandQuery, BUILTIN_PLUGINS } from '../plugins'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-plugins-test-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('BUILTIN_PLUGINS 目录', () => {
  it('内置插件全部随 dsh 安装（@deepseek-ai 作用域、id 与短名一致）', () => {
    expect(BUILTIN_PLUGINS.length).toBeGreaterThanOrEqual(5)
    for (const p of BUILTIN_PLUGINS) {
      expect(p.name).toMatch(/^@deepseek-ai\/dsh-/)
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      expect(p.tags.length).toBeGreaterThan(0)
    }
  })
})

describe('setPluginEnabled（用户层补丁）', () => {
  it('启用 → 写入条目；停用 → 移除条目', () => {
    const pkg = BUILTIN_PLUGINS[0].name
    const r1 = setPluginEnabled(tmp, pkg, true)
    expect(r1.ok).toBe(true)
    const patch = fs.readFileSync(path.join(tmp, 'data', 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain(pkg)
    const r2 = setPluginEnabled(tmp, pkg, false)
    expect(r2.ok).toBe(true)
    expect(fs.readFileSync(path.join(tmp, 'data', 'cordis.patch.yml'), 'utf8')).not.toContain(pkg)
  })

  it('保留既有条目（skill-filesystem）', () => {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'data', 'cordis.patch.yml'),
      '- id: skill-filesystem\n  config:\n    customSkillDirs:\n      - /tmp/skills\n',
      'utf8'
    )
    setPluginEnabled(tmp, BUILTIN_PLUGINS[0].name, true)
    const text = fs.readFileSync(path.join(tmp, 'data', 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('skill-filesystem')
    expect(text).toContain('/tmp/skills')
    expect(text).toContain(BUILTIN_PLUGINS[0].name)
  })

  it('未知插件 → 拒绝', () => {
    const r = setPluginEnabled(tmp, '@deepseek-ai/does-not-exist', true)
    expect(r.ok).toBe(false)
  })
})

describe('readBundlePluginNames / getPluginStates', () => {
  it('扫描 bundle 层补丁识别已随 dsh 加载的插件', () => {
    const baseDir = path.join(tmp, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-base')
    fs.mkdirSync(baseDir, { recursive: true })
    fs.writeFileSync(path.join(baseDir, 'cordis.patch.yml'), '- id: x\n  name: \'@deepseek-ai/dsh-mcp-client\'\n', 'utf8')
    const names = readBundlePluginNames(tmp)
    expect(names.has('@deepseek-ai/dsh-mcp-client')).toBe(true)
    const states = getPluginStates(tmp)
    const mcp = states.find((s) => s.name === '@deepseek-ai/dsh-mcp-client')
    expect(mcp?.enabledInBundle).toBe(true)
    expect(mcp?.enabledByUser).toBe(false)
  })
})

describe('expandQuery（中文功能词 → npm 检索词）', () => {
  it('中文词映射英文检索词（npm 索引不匹配中文，返回纯英文）', () => {
    const q1 = expandQuery('搜索')
    expect(q1).toContain('web-search')
    expect(q1).not.toMatch(/[\u4e00-\u9fff]/)
    expect(expandQuery('数据库')).toContain('database')
    expect(expandQuery('mcp 客户端')).toBe('mcp')
    expect(expandQuery('  ')).toBe('')
    expect(expandQuery('web-search')).toBe('web-search')
    expect(expandQuery('mcp')).toBe('mcp')
  })
})
